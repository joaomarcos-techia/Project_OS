/**
 * MetaCloudProvider — WhatsApp via Meta Graph API (Cloud API).
 *
 * Implementa `MessagingProvider` direto. Graph API v18+ (configurável via
 * `META_GRAPH_API_VERSION`). Sem mídia/áudio/imagem em C10 — só texto + template.
 *
 * Timeout (3ª#4): todo fetch usa `AbortController`/`AbortSignal.timeout` de 10s
 * (`META_HTTP_TIMEOUT_MS`). A Meta pode segurar a conexão por dezenas de
 * segundos; sem o teto um request trava o sender.
 *
 * Classificação de erro (3ª#5): resposta HTTP de erro → `ProviderSendError`
 * (definitivo); timeout/abort/reset → `ProviderUnreachableError` (indeterminado).
 * O sender usa essa distinção para `failed` vs `unknown`.
 */
import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '@/lib/env';

import { ProviderSendError, ProviderUnreachableError } from './errors';
import type {
  MessageRef,
  MessagingProvider,
  ParsedBusinessAppEcho,
  ParsedInboundMessage,
  ParsedPartnerRemoval,
  ParsedStatusEvent,
  ParsedWebhookEvent,
  SendTemplateArgs,
  SendTextArgs,
} from './provider';

// --- minimal Meta webhook shapes (loose, validated by guards — sem `any`) ---
interface MetaWebhookBody {
  entry?: MetaEntry[];
}
interface MetaEntry {
  /** Id da WABA nos webhooks de conta (`account_update`). */
  id?: string;
  changes?: MetaChange[];
}
interface MetaChange {
  /** Qual assinatura de webhook produziu esta mudança. Ausente = legado (`messages`). */
  field?: string;
  value?: MetaValue;
}
interface MetaValue {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  messages?: MetaMessage[];
  statuses?: MetaStatus[];
  // Coexistência (Embedded Signup com app WhatsApp Business).
  message_echoes?: MetaEcho[];
  history?: { threads?: { messages?: unknown[] }[] }[];
  state_sync?: unknown[];
  // account_update
  event?: string;
  waba_info?: { waba_id?: string };
  disconnection_info?: { reason?: string; initiated_by?: string };
}
interface MetaEcho {
  id?: string;
  from?: string;
  to?: string;
  type?: string;
  text?: { body?: string };
  timestamp?: string;
}
interface MetaMessage {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  timestamp?: string;
}
interface MetaStatus {
  id?: string;
  status?: string;
  recipient_id?: string;
}

interface MetaSendResponse {
  messages?: { id?: string }[];
}

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export class MetaCloudProvider implements MessagingProvider {
  async sendText(args: SendTextArgs): Promise<MessageRef> {
    return this.post(args.fromPhoneId, args.accessToken, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: args.toNumber,
      type: 'text',
      text: { body: args.text },
    });
  }

  async sendTemplate(args: SendTemplateArgs): Promise<MessageRef> {
    const components =
      args.variables.length > 0
        ? [
            {
              type: 'body',
              parameters: args.variables.map((text) => ({ type: 'text', text })),
            },
          ]
        : [];
    return this.post(args.fromPhoneId, args.accessToken, {
      messaging_product: 'whatsapp',
      to: args.toNumber,
      type: 'template',
      template: {
        name: args.templateName,
        language: { code: args.languageCode },
        components,
      },
    });
  }

  private async post(
    fromPhoneId: string,
    accessToken: string,
    body: Record<string, unknown>,
  ): Promise<MessageRef> {
    const url = `https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${encodeURIComponent(
      fromPhoneId,
    )}/messages`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(env.META_HTTP_TIMEOUT_MS),
      });
    } catch (err) {
      // timeout / abort / connection reset — NÃO sabemos se a Meta recebeu.
      throw new ProviderUnreachableError(
        `[meta] envio inalcançável: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    const raw: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      throw new ProviderSendError(`[meta] HTTP ${res.status}`, res.status, raw);
    }

    const wamid = (raw as MetaSendResponse | null)?.messages?.[0]?.id;
    if (typeof wamid !== 'string' || wamid.length === 0) {
      throw new ProviderSendError('[meta] resposta sem message id', res.status, raw);
    }
    return { providerMessageId: wamid, raw };
  }

  parseWebhook(rawBody: string): ParsedWebhookEvent {
    const messages: ParsedInboundMessage[] = [];
    const statuses: ParsedStatusEvent[] = [];
    const echoes: ParsedBusinessAppEcho[] = [];
    const partnerRemovals: ParsedPartnerRemoval[] = [];
    const discarded = { historyMessages: 0, stateSyncItems: 0 };

    let body: MetaWebhookBody;
    try {
      body = JSON.parse(rawBody) as MetaWebhookBody;
    } catch {
      // Corpo não-parseável: a assinatura já validou; tratamos como vazio
      // (a rota colocará o raw em quarentena se não houver phone_id resolvível).
      return { messages, statuses, echoes, partnerRemovals, discarded };
    }

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        // O `field` decide o que a mudança é. Antes ele era ignorado e só se
        // lia `messages`/`statuses` — o que servia enquanto a única assinatura
        // era `messages`. Com a coexistência chegam outras, e um payload de
        // histórico lido como inbound faria a IA responder mensagens de meses
        // atrás. Sem `field` = legado, tratado como `messages`.
        const field = change.field ?? 'messages';
        const value = change.value;

        if (field === 'account_update') {
          if (value?.event === 'PARTNER_REMOVED') {
            const wabaId = value.waba_info?.waba_id ?? entry.id;
            if (typeof wabaId === 'string' && wabaId.length > 0) {
              partnerRemovals.push({
                wabaId,
                reason: stringOrNull(value.disconnection_info?.reason),
                initiatedBy: stringOrNull(value.disconnection_info?.initiated_by),
              });
            }
          }
          continue;
        }

        // Histórico e contatos da coexistência: contados e descartados. A Qoro
        // pede a sincronização porque a Meta exige, mas não guarda o conteúdo
        // (decisão de 30/09/2026 — minimização, LGPD). Nada daqui é persistido
        // nem vai para quarentena.
        if (field === 'history') {
          for (const chunk of value?.history ?? []) {
            for (const thread of chunk.threads ?? []) {
              discarded.historyMessages += thread.messages?.length ?? 0;
            }
          }
          continue;
        }
        if (field === 'smb_app_state_sync') {
          discarded.stateSyncItems += value?.state_sync?.length ?? 0;
          continue;
        }

        const phoneId = value?.metadata?.phone_number_id;
        if (typeof phoneId !== 'string') continue;

        if (field === 'smb_message_echoes') {
          for (const e of value?.message_echoes ?? []) {
            if (typeof e.id !== 'string' || typeof e.to !== 'string') continue;
            echoes.push({
              providerMessageId: e.id,
              toNumber: e.to,
              fromPhoneId: phoneId,
              text: e.type === 'text' && typeof e.text?.body === 'string' ? e.text.body : null,
              timestamp: typeof e.timestamp === 'string' ? e.timestamp : '',
            });
          }
          continue;
        }

        if (field !== 'messages') continue;
        const displayNumber = value?.metadata?.display_phone_number ?? null;

        for (const m of value?.messages ?? []) {
          if (typeof m.id !== 'string' || typeof m.from !== 'string') continue;
          messages.push({
            providerMessageId: m.id,
            fromNumber: m.from,
            toPhoneId: phoneId,
            toNumber: typeof displayNumber === 'string' ? displayNumber : null,
            text: m.type === 'text' && typeof m.text?.body === 'string' ? m.text.body : null,
            timestamp: typeof m.timestamp === 'string' ? m.timestamp : '',
          });
        }

        for (const s of value?.statuses ?? []) {
          if (typeof s.id !== 'string' || typeof s.status !== 'string') continue;
          statuses.push({
            providerMessageId: s.id,
            status: s.status,
            recipientNumber: typeof s.recipient_id === 'string' ? s.recipient_id : null,
            toPhoneId: phoneId,
            raw: s,
          });
        }
      }
    }
    return { messages, statuses, echoes, partnerRemovals, discarded };
  }

  validateSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
    if (!signatureHeader) return false;
    const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`;
    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
