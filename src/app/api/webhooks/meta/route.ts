/**
 * Webhook Meta (WhatsApp Cloud API) — GET verify + POST receive (C10).
 *
 * Ordem inviolável do POST:
 *   0. size guard (Content-Length + leitura com cap) → 413 ANTES de qualquer HMAC.
 *   1. validateSignature (HMAC-SHA256 sobre o raw) → 401 e PARA se falhar.
 *   2. parseWebhook(raw).
 *   3. resolve clínica por meta_phone_id; persistInbound/persistStatusEvents
 *      (withTenant) OU quarantineOrphan (número não-provisionado).
 *   4. 200 (Meta re-tenta para sempre se não receber 200).
 *
 * A rota NÃO importa `dbAdmin` — usa o seam `@/lib/messaging` (que o encapsula)
 * + a persistência do contexto (withTenant). Sem alteração no eslint.
 */
import { buildRequestContext } from '@/lib/audit/request-context';
import { safeEqual } from '@/lib/auth/secret-compare';
import { assertMessagingRuntimeReady, env } from '@/lib/env';
import { captureBackgroundError } from '@/lib/observability/capture';
import { runWithContext } from '@/lib/observability/context';
import {
  getMessagingProvider,
  quarantineOrphan,
  resolveClinicByPhoneId,
  type ParsedInboundMessage,
  type ParsedStatusEvent,
} from '@/lib/messaging';
import { metrics } from '@/lib/observability/metrics';

import { persistInbound, persistStatusEvents } from '@/contexts/messaging/internal/inbound';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_WEBHOOK_BYTES = 1_000_000;
const PROVIDER = 'meta' as const;

/** Lê o body com teto de bytes (defesa contra Content-Length mentiroso). */
async function readBodyCapped(req: Request, cap: number): Promise<string | null> {
  if (!req.body) {
    const text = await req.text();
    return Buffer.byteLength(text, 'utf8') > cap ? null : text;
  }
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function groupByPhoneId(
  messages: ParsedInboundMessage[],
  statuses: ParsedStatusEvent[],
): Map<string, { messages: ParsedInboundMessage[]; statuses: ParsedStatusEvent[] }> {
  const map = new Map<
    string,
    { messages: ParsedInboundMessage[]; statuses: ParsedStatusEvent[] }
  >();
  const ensure = (phoneId: string) => {
    let g = map.get(phoneId);
    if (!g) {
      g = { messages: [], statuses: [] };
      map.set(phoneId, g);
    }
    return g;
  };
  for (const m of messages) ensure(m.toPhoneId).messages.push(m);
  for (const s of statuses) ensure(s.toPhoneId).statuses.push(s);
  return map;
}

export async function GET(req: Request): Promise<Response> {
  // O handshake de verificação SÓ precisa do verify_token. NÃO exigir
  // META_APP_SECRET aqui (ele valida a assinatura HMAC apenas no POST): exigir
  // os dois fazia a Meta receber 500 e falhar a validação da Callback URL antes
  // do app_secret existir no runtime. `verify_token` ausente → 403 (não 500).
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (
    mode === 'subscribe' &&
    challenge !== null &&
    Boolean(env.META_WEBHOOK_VERIFY_TOKEN) &&
    safeEqual(token, env.META_WEBHOOK_VERIFY_TOKEN)
  ) {
    return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  return new Response('forbidden', { status: 403 });
}

const FLOW = 'messaging.webhook';

/**
 * Abre o escopo de correlação e delega (mesmo padrão do webhook Asaas).
 *
 * NÃO fixa `clinicId`: um único webhook da Meta pode trazer mensagens de VÁRIAS
 * clínicas (agrupadas por `phone_id` logo abaixo), então não existe um clinicId
 * do request. Carimbar um seria mentira em toda linha de log do lote.
 */
export async function POST(req: Request): Promise<Response> {
  const { requestId } = buildRequestContext(req.headers);
  return runWithContext({ requestId, flow: FLOW }, () => handleWebhook(req));
}

async function handleWebhook(req: Request): Promise<Response> {
  assertMessagingRuntimeReady();

  // 0. size guard.
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    metrics.emit('messaging.webhook.oversized', { contentLength });
    return new Response('payload too large', { status: 413 });
  }
  const raw = await readBodyCapped(req, MAX_WEBHOOK_BYTES);
  if (raw === null) {
    metrics.emit('messaging.webhook.oversized', {});
    return new Response('payload too large', { status: 413 });
  }

  const provider = getMessagingProvider(PROVIDER);

  // 1. assinatura ANTES de tudo.
  if (
    !provider.validateSignature(raw, req.headers.get('x-hub-signature-256'), env.META_APP_SECRET!)
  ) {
    metrics.emit('messaging.webhook.invalid_signature', {});
    return new Response('invalid signature', { status: 401 });
  }

  // 2. parse.
  const parsed = provider.parseWebhook(raw);

  // 3. resolve tenant + persistir / quarentena.
  try {
    for (const [phoneId, group] of groupByPhoneId(parsed.messages, parsed.statuses)) {
      const clinicId = await resolveClinicByPhoneId(phoneId);
      if (!clinicId) {
        await quarantineOrphan(PROVIDER, phoneId, raw);
        continue;
      }
      for (const msg of group.messages) {
        await persistInbound(clinicId, PROVIDER, msg);
      }
      if (group.statuses.length > 0) {
        await persistStatusEvents(clinicId, PROVIDER, group.statuses);
      }
    }
  } catch (err) {
    // Persistência/publishEvent falhou → rollback já ocorreu na tx. 500 faz a
    // Meta re-tentar (nunca há inbound salvo sem evento — garantia transacional).
    // C3: o Sentry é o único caminho do stack — sem ele, uma falha de ingestão
    // de mensagem só deixava `{name,message}` no stdout.
    captureBackgroundError(err, { flow: FLOW });
    metrics.emit('messaging.webhook.error', { error: err });
    return new Response('internal error', { status: 500 });
  }

  return Response.json(
    { received: parsed.messages.length, statuses: parsed.statuses.length },
    { status: 200 },
  );
}
