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
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';
import { captureBackgroundError } from '@/lib/observability/capture';
import { runWithContext } from '@/lib/observability/context';
import {
  deactivateConnectionsForRemovedPartner,
  getMessagingProvider,
  quarantineOrphan,
  resolveClinicByPhoneId,
  type ParsedBusinessAppEcho,
  type ParsedInboundMessage,
  type ParsedStatusEvent,
} from '@/lib/messaging';
import { metrics } from '@/lib/observability/metrics';
import { after } from 'next/server';

import { MESSAGING_EVENTS } from '@/contexts/messaging/events';
import {
  businessAppEchoEventKey,
  inboundEventKey,
  persistBusinessAppEcho,
  persistInbound,
  persistStatusEvents,
} from '@/contexts/messaging/internal/inbound';
import { deliveryFailureNeedsHealthCheck } from '@/contexts/messaging/internal/messaging-health';
import type { RequestContext } from '@/lib/audit/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_WEBHOOK_BYTES = 1_000_000;
const PROVIDER = 'meta' as const;

interface PhoneGroup {
  messages: ParsedInboundMessage[];
  statuses: ParsedStatusEvent[];
  /** Coexistência: respostas da recepção pelo app do celular. */
  echoes: ParsedBusinessAppEcho[];
}

function groupByPhoneId(
  messages: ParsedInboundMessage[],
  statuses: ParsedStatusEvent[],
  echoes: ParsedBusinessAppEcho[] = [],
): Map<string, PhoneGroup> {
  const map = new Map<string, PhoneGroup>();
  const ensure = (phoneId: string) => {
    let g = map.get(phoneId);
    if (!g) {
      g = { messages: [], statuses: [], echoes: [] };
      map.set(phoneId, g);
    }
    return g;
  };
  for (const m of messages) ensure(m.toPhoneId).messages.push(m);
  for (const s of statuses) ensure(s.toPhoneId).statuses.push(s);
  for (const e of echoes) ensure(e.fromPhoneId).echoes.push(e);
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

/** Eventos que este webhook publicou: ecos primeiro (pausam a IA), depois mensagens. */
export interface IngressEvents {
  echoKeys: string[];
  inboundKeys: string[];
}

/**
 * The minute cron remains the retry/backstop. This best-effort run only reduces
 * ingress latency and never changes the webhook acknowledgement outcome.
 *
 * It processes exactly the events THIS request published, by idempotency key.
 * The previous tick took the oldest due event of the whole queue, which was this
 * message's turn only when the queue happened to be empty: under any backlog the
 * patient waited for the cron, and the Preview (no cron) never answered.
 */
export async function triggerOutboxAfterMetaIngress(events: IngressEvents): Promise<void> {
  try {
    // Load the worker wiring only after Meta has received its acknowledgement.
    // Importing every consumer before HMAC validation would enlarge the hot
    // webhook path and make a cold start slower precisely when a provider retry
    // is most costly.
    await import('@/app/api/cron/outbox/handlers');
    await import('@/lib/db/schema');
    const { runOutboxEventsNow } = await import('@/lib/outbox/worker');
    const summary = await runOutboxEventsNow([
      {
        eventType: MESSAGING_EVENTS.BUSINESS_APP_ECHO_RECEIVED,
        idempotencyKeys: events.echoKeys,
      },
      { eventType: MESSAGING_EVENTS.INBOUND_RECEIVED, idempotencyKeys: events.inboundKeys },
    ]);
    metrics.emit('messaging.webhook.outbox_triggered', summary);
  } catch (error) {
    captureBackgroundError(error, { flow: `${FLOW}.outbox_trigger` });
    metrics.emit('messaging.webhook.outbox_trigger_failed', { error });
  }
}

/**
 * Saúde de envio: a Meta recusou um template por forma de pagamento (131042 ou
 * 141006) — relê o `health_status` dessas clínicas para o aviso aparecer na tela
 * já na primeira recusa, e não só na varredura diária. Depois do 200, como o
 * gatilho do outbox; o módulo só carrega aqui, fora do caminho quente.
 */
export async function recheckHealthAfterDeliveryFailure(
  clinicIds: string[],
  requestContext: RequestContext,
): Promise<void> {
  try {
    const { recheckMessagingHealthAfterDeliveryFailure } =
      await import('@/contexts/messaging/internal/messaging-health-check');
    await recheckMessagingHealthAfterDeliveryFailure(clinicIds, requestContext);
  } catch (error) {
    captureBackgroundError(error, { flow: `${FLOW}.health_recheck` });
  }
}

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
  const raw = await readWebhookBodyCapped(req, MAX_WEBHOOK_BYTES);
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

  // Coexistência: histórico e contatos chegam, são contados e DESCARTADOS —
  // a Qoro pede a sincronização porque a Meta exige, mas não guarda o conteúdo
  // (decisão de 30/09/2026). Nada disso passa pela quarentena abaixo.
  if (
    parsed.discarded &&
    (parsed.discarded.historyMessages > 0 || parsed.discarded.stateSyncItems > 0)
  ) {
    metrics.emit('messaging.webhook.coexistence_sync_discarded', parsed.discarded);
  }

  // 3. resolve tenant + persistir / quarentena.
  const ingress: IngressEvents = { echoKeys: [], inboundKeys: [] };
  const healthRecheck = new Set<string>();
  try {
    for (const removal of parsed.partnerRemovals ?? []) {
      const { deactivated } = await deactivateConnectionsForRemovedPartner({
        wabaId: removal.wabaId,
        reason: removal.reason,
        initiatedBy: removal.initiatedBy,
        requestContext: buildRequestContext(req.headers),
      });
      metrics.emit('messaging.webhook.partner_removed', {
        deactivated,
        reason: removal.reason ?? 'unknown',
        initiatedBy: removal.initiatedBy ?? 'unknown',
      });
    }

    for (const [phoneId, group] of groupByPhoneId(
      parsed.messages,
      parsed.statuses,
      parsed.echoes,
    )) {
      const clinicId = await resolveClinicByPhoneId(phoneId);
      if (!clinicId) {
        await quarantineOrphan(PROVIDER, phoneId, raw);
        continue;
      }
      for (const msg of group.messages) {
        await persistInbound(clinicId, PROVIDER, msg);
        ingress.inboundKeys.push(inboundEventKey(PROVIDER, msg.providerMessageId));
      }
      for (const echo of group.echoes) {
        await persistBusinessAppEcho(clinicId, PROVIDER, echo);
        ingress.echoKeys.push(businessAppEchoEventKey(PROVIDER, echo.providerMessageId));
      }
      if (group.statuses.length > 0) {
        await persistStatusEvents(clinicId, PROVIDER, group.statuses);
        if (group.statuses.some((s) => deliveryFailureNeedsHealthCheck(s.status, s.raw))) {
          healthRecheck.add(clinicId);
        }
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

  // The provider receives 200 immediately after the transactional persistence.
  // `after` lets the same invocation process its own events without turning a
  // temporary worker/LLM failure into a duplicate Meta delivery. Statuses publish
  // `messaging.outbound.status_updated`, which no reply waits on: the minute cron
  // drains it (a `failed` closes the C14 job — EC-32).
  if (ingress.inboundKeys.length > 0 || ingress.echoKeys.length > 0) {
    after(() => triggerOutboxAfterMetaIngress(ingress));
  }
  if (healthRecheck.size > 0) {
    const clinicIds = [...healthRecheck];
    const requestContext = buildRequestContext(req.headers);
    after(() => recheckHealthAfterDeliveryFailure(clinicIds, requestContext));
  }

  return Response.json(
    {
      received: parsed.messages.length,
      statuses: parsed.statuses.length,
      echoes: parsed.echoes?.length ?? 0,
    },
    { status: 200 },
  );
}
