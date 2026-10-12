import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

import { MetaCloudProvider } from '@/lib/messaging/meta-cloud';

const {
  afterMock,
  validateSignature,
  parseWebhook,
  resolveClinicByPhoneId,
  persistInbound,
  persistStatusEvents,
  persistBusinessAppEcho,
  deactivateConnectionsForRemovedPartner,
  quarantineOrphan,
  runOutboxEventsNow,
  captureBackgroundError,
  emit,
  recheckMessagingHealthAfterDeliveryFailure,
} = vi.hoisted(() => ({
  afterMock: vi.fn(),
  validateSignature: vi.fn(),
  parseWebhook: vi.fn(),
  resolveClinicByPhoneId: vi.fn(),
  persistInbound: vi.fn(),
  persistStatusEvents: vi.fn(),
  persistBusinessAppEcho: vi.fn(),
  deactivateConnectionsForRemovedPartner: vi.fn(),
  quarantineOrphan: vi.fn(),
  runOutboxEventsNow: vi.fn(),
  captureBackgroundError: vi.fn(),
  emit: vi.fn(),
  recheckMessagingHealthAfterDeliveryFailure: vi.fn(),
}));

vi.mock('next/server', () => ({ after: afterMock }));
vi.mock('@/app/api/cron/outbox/handlers', () => ({}));
vi.mock('@/lib/db/schema', () => ({}));
vi.mock('@/lib/env', () => ({
  assertMessagingRuntimeReady: vi.fn(),
  env: { META_APP_SECRET: 'app-secret', META_WEBHOOK_VERIFY_TOKEN: 'verify-token' },
}));
vi.mock('@/lib/audit/request-context', () => ({
  buildRequestContext: () => ({ requestId: 'request-1' }),
}));
vi.mock('@/lib/observability/context', () => ({
  runWithContext: (_context: unknown, callback: () => Promise<Response>) => callback(),
}));
vi.mock('@/lib/observability/capture', () => ({ captureBackgroundError }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit } }));
vi.mock('@/lib/outbox/worker', () => ({ runOutboxEventsNow }));
vi.mock('@/lib/messaging', () => ({
  getMessagingProvider: () => ({ validateSignature, parseWebhook }),
  resolveClinicByPhoneId,
  quarantineOrphan,
  deactivateConnectionsForRemovedPartner,
}));
vi.mock('@/contexts/messaging/internal/messaging-health-check', () => ({
  recheckMessagingHealthAfterDeliveryFailure,
}));
vi.mock('@/contexts/messaging/internal/inbound', () => ({
  persistInbound,
  persistStatusEvents,
  persistBusinessAppEcho,
  inboundEventKey: (provider: string, id: string) => `inbound:${provider}:${id}`,
  businessAppEchoEventKey: (provider: string, id: string) => `business_app_echo:${provider}:${id}`,
}));

/** Executa o que o webhook agendou em `after()` (o trabalho pós-200). */
async function runScheduledAfter(): Promise<void> {
  expect(afterMock).toHaveBeenCalledTimes(1);
  const scheduled = afterMock.mock.calls[0]![0] as () => Promise<void>;
  await scheduled();
}

import { POST, recheckHealthAfterDeliveryFailure, triggerOutboxAfterMetaIngress } from './route';

function webhookRequest(): Request {
  return new Request('https://app.qoro.test/api/webhooks/meta', {
    method: 'POST',
    headers: { 'x-hub-signature-256': 'sha256=signature' },
    body: JSON.stringify({ object: 'whatsapp_business_account' }),
  });
}

describe('Meta webhook immediate outbox trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateSignature.mockReturnValue(true);
    parseWebhook.mockReturnValue({
      messages: [{ toPhoneId: 'phone-1', providerMessageId: 'wamid-1' }],
      statuses: [],
    });
    resolveClinicByPhoneId.mockResolvedValue('clinic-1');
    persistInbound.mockResolvedValue(undefined);
    persistStatusEvents.mockResolvedValue(undefined);
    runOutboxEventsNow.mockResolvedValue({
      processed: 1,
      failed: 0,
      skipped: 0,
      empty: 0,
      stuck_reclaimed: 0,
      circuit_paused: 0,
      duration_ms: 12,
    });
  });

  it('acknowledges persisted ingress and, only after the response, processes THIS message', async () => {
    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(persistInbound).toHaveBeenCalledWith(
      'clinic-1',
      'meta',
      expect.objectContaining({ providerMessageId: 'wamid-1' }),
    );
    expect(runOutboxEventsNow).not.toHaveBeenCalled();

    await runScheduledAfter();
    expect(runOutboxEventsNow).toHaveBeenCalledWith([
      { eventType: 'messaging.business_app_echo.received', idempotencyKeys: [] },
      { eventType: 'messaging.inbound.received', idempotencyKeys: ['inbound:meta:wamid-1'] },
    ]);
  });

  it('a delivery-status-only webhook publishes nothing and schedules nothing', async () => {
    parseWebhook.mockReturnValue({
      messages: [],
      statuses: [{ toPhoneId: 'phone-1', providerMessageId: 'wamid-out', status: 'read' }],
    });

    expect((await POST(webhookRequest())).status).toBe(200);
    expect(persistStatusEvents).toHaveBeenCalledTimes(1);
    expect(afterMock).not.toHaveBeenCalled();
  });

  it('does not schedule worker work for a rejected signature', async () => {
    validateSignature.mockReturnValue(false);

    expect((await POST(webhookRequest())).status).toBe(401);
    expect(persistInbound).not.toHaveBeenCalled();
    expect(afterMock).not.toHaveBeenCalled();
  });

  it('accepts a real HMAC and rejects a body changed after signing', async () => {
    const provider = new MetaCloudProvider();
    validateSignature.mockImplementation(provider.validateSignature.bind(provider));
    const raw = JSON.stringify({ object: 'whatsapp_business_account' });
    const signature = `sha256=${createHmac('sha256', 'app-secret').update(raw).digest('hex')}`;
    const signedRequest = (body: string) =>
      new Request('http://localhost/api/webhooks/meta', {
        method: 'POST',
        headers: { 'x-hub-signature-256': signature },
        body,
      });

    expect((await POST(signedRequest(raw))).status).toBe(200);
    expect((await POST(signedRequest(raw + ' '))).status).toBe(401);
    expect(persistInbound).toHaveBeenCalledTimes(1);
  });

  it('cancels an oversized stream before HMAC and persistence', async () => {
    const cancel = vi.fn();
    let chunks = 0;
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
      controller.enqueue(new Uint8Array(600_000));
      if (++chunks === 4) controller.close();
    });
    const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
    const init: RequestInit & { duplex: 'half' } = { method: 'POST', body, duplex: 'half' };

    expect((await POST(new Request('http://localhost/api/webhooks/meta', init))).status).toBe(413);
    expect(pull).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(validateSignature).not.toHaveBeenCalled();
    expect(persistInbound).not.toHaveBeenCalled();
  });

  it('requests provider redelivery when transactional persistence fails', async () => {
    const error = new Error('transaction rolled back');
    persistInbound.mockRejectedValueOnce(error);

    expect((await POST(webhookRequest())).status).toBe(500);
    expect(afterMock).not.toHaveBeenCalled();
    expect(captureBackgroundError).toHaveBeenCalledWith(error, { flow: 'messaging.webhook' });
  });

  it('processes only the events of this request — never the oldest event of the global queue', async () => {
    await expect(
      triggerOutboxAfterMetaIngress({ echoKeys: [], inboundKeys: ['inbound:meta:wamid-1'] }),
    ).resolves.toBeUndefined();

    expect(runOutboxEventsNow).toHaveBeenCalledTimes(1);
    expect(runOutboxEventsNow).toHaveBeenCalledWith([
      { eventType: 'messaging.business_app_echo.received', idempotencyKeys: [] },
      { eventType: 'messaging.inbound.received', idempotencyKeys: ['inbound:meta:wamid-1'] },
    ]);
    expect(emit).toHaveBeenCalledWith('messaging.webhook.outbox_triggered', {
      processed: 1,
      failed: 0,
      skipped: 0,
      empty: 0,
      stuck_reclaimed: 0,
      circuit_paused: 0,
      duration_ms: 12,
    });
  });

  it('does not turn a worker failure into an unhandled webhook error', async () => {
    const workerError = new Error('worker unavailable');
    runOutboxEventsNow.mockRejectedValue(workerError);

    await expect(
      triggerOutboxAfterMetaIngress({ echoKeys: [], inboundKeys: ['inbound:meta:wamid-1'] }),
    ).resolves.toBeUndefined();

    expect(captureBackgroundError).toHaveBeenCalledWith(workerError, {
      flow: 'messaging.webhook.outbox_trigger',
    });
    expect(emit).toHaveBeenCalledWith('messaging.webhook.outbox_trigger_failed', {
      error: workerError,
    });
  });
});

describe('Meta webhook — coexistência com o app WhatsApp Business', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateSignature.mockReturnValue(true);
    resolveClinicByPhoneId.mockResolvedValue('clinic-1');
    persistBusinessAppEcho.mockResolvedValue({ deduped: false });
    deactivateConnectionsForRemovedPartner.mockResolvedValue({ deactivated: 1 });
  });

  it('grava a resposta da recepção pela clínica do número que a enviou', async () => {
    parseWebhook.mockReturnValue({
      messages: [],
      statuses: [],
      echoes: [
        {
          providerMessageId: 'wamid-echo',
          toNumber: '5511988887777',
          fromPhoneId: 'phone-1',
          text: 'Oi, já te retorno',
          timestamp: '1790000000',
        },
      ],
    });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(resolveClinicByPhoneId).toHaveBeenCalledWith('phone-1');
    expect(persistBusinessAppEcho).toHaveBeenCalledWith(
      'clinic-1',
      'meta',
      expect.objectContaining({ providerMessageId: 'wamid-echo' }),
    );
    expect(persistInbound).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ received: 0, statuses: 0, echoes: 1 });

    // O eco pausa a IA: é processado logo, antes de qualquer mensagem do lote.
    await runScheduledAfter();
    expect(runOutboxEventsNow).toHaveBeenCalledWith([
      {
        eventType: 'messaging.business_app_echo.received',
        idempotencyKeys: ['business_app_echo:meta:wamid-echo'],
      },
      { eventType: 'messaging.inbound.received', idempotencyKeys: [] },
    ]);
  });

  it('eco de número não provisionado vai para a quarentena, como o inbound', async () => {
    resolveClinicByPhoneId.mockResolvedValue(null);
    parseWebhook.mockReturnValue({
      messages: [],
      statuses: [],
      echoes: [
        {
          providerMessageId: 'wamid-echo',
          toNumber: '5511988887777',
          fromPhoneId: 'phone-x',
          text: null,
          timestamp: '',
        },
      ],
    });

    expect((await POST(webhookRequest())).status).toBe(200);
    expect(quarantineOrphan).toHaveBeenCalledWith('meta', 'phone-x', expect.any(String));
    expect(persistBusinessAppEcho).not.toHaveBeenCalled();
  });

  it('PARTNER_REMOVED desativa a conexão da WABA e registra o motivo', async () => {
    parseWebhook.mockReturnValue({
      messages: [],
      statuses: [],
      partnerRemovals: [{ wabaId: 'waba-1', reason: 'PRIMARY_INACTIVITY', initiatedBy: 'SYSTEM' }],
    });

    expect((await POST(webhookRequest())).status).toBe(200);
    expect(deactivateConnectionsForRemovedPartner).toHaveBeenCalledWith(
      expect.objectContaining({
        wabaId: 'waba-1',
        reason: 'PRIMARY_INACTIVITY',
        initiatedBy: 'SYSTEM',
      }),
    );
    expect(emit).toHaveBeenCalledWith('messaging.webhook.partner_removed', {
      deactivated: 1,
      reason: 'PRIMARY_INACTIVITY',
      initiatedBy: 'SYSTEM',
    });
  });

  it('histórico e contatos só viram métrica: nada é gravado nem vai para a quarentena', async () => {
    parseWebhook.mockReturnValue({
      messages: [],
      statuses: [],
      discarded: { historyMessages: 42, stateSyncItems: 7 },
    });

    expect((await POST(webhookRequest())).status).toBe(200);
    expect(emit).toHaveBeenCalledWith('messaging.webhook.coexistence_sync_discarded', {
      historyMessages: 42,
      stateSyncItems: 7,
    });
    expect(resolveClinicByPhoneId).not.toHaveBeenCalled();
    expect(quarantineOrphan).not.toHaveBeenCalled();
    expect(persistInbound).not.toHaveBeenCalled();
    expect(persistBusinessAppEcho).not.toHaveBeenCalled();
  });
});

describe('Meta webhook — recusa por forma de pagamento relê a saúde de envio', () => {
  /** Callback `failed` na forma real da Meta (status + errors[0].code). */
  const failedStatus = (code: number, toPhoneId = 'phone-1') => ({
    providerMessageId: `wamid-${code}`,
    status: 'failed',
    recipientNumber: '5511988887777',
    toPhoneId,
    raw: { id: `wamid-${code}`, status: 'failed', errors: [{ code, title: 'x' }] },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    validateSignature.mockReturnValue(true);
    persistStatusEvents.mockResolvedValue(undefined);
    resolveClinicByPhoneId.mockImplementation(async (phoneId: string) =>
      phoneId === 'phone-2' ? 'clinic-2' : 'clinic-1',
    );
    recheckMessagingHealthAfterDeliveryFailure.mockResolvedValue(undefined);
  });

  it('131042 e 141006: agenda a releitura depois do 200, uma vez por clínica', async () => {
    parseWebhook.mockReturnValue({
      messages: [],
      statuses: [failedStatus(131042), failedStatus(141006), failedStatus(131042, 'phone-2')],
    });

    expect((await POST(webhookRequest())).status).toBe(200);
    expect(recheckMessagingHealthAfterDeliveryFailure).not.toHaveBeenCalled();

    await runScheduledAfter();
    expect(recheckMessagingHealthAfterDeliveryFailure).toHaveBeenCalledTimes(1);
    const [clinicIds, requestContext] = recheckMessagingHealthAfterDeliveryFailure.mock.calls[0]!;
    expect([...clinicIds].sort()).toEqual(['clinic-1', 'clinic-2']);
    expect(requestContext).toMatchObject({ requestId: 'request-1' });
  });

  it('outra recusa, ou um status que não é falha, não relê nada', async () => {
    parseWebhook.mockReturnValue({
      messages: [],
      statuses: [
        failedStatus(131026),
        { ...failedStatus(131042), status: 'delivered' },
        { ...failedStatus(131042), raw: { status: 'failed' } },
      ],
    });

    expect((await POST(webhookRequest())).status).toBe(200);
    expect(afterMock).not.toHaveBeenCalled();
  });

  it('persistência falhou: 500 e nenhuma releitura agendada', async () => {
    parseWebhook.mockReturnValue({ messages: [], statuses: [failedStatus(131042)] });
    persistStatusEvents.mockRejectedValueOnce(new Error('rollback'));

    expect((await POST(webhookRequest())).status).toBe(500);
    expect(afterMock).not.toHaveBeenCalled();
  });

  it('a releitura nunca vira erro do webhook', async () => {
    const boom = new Error('module failed');
    recheckMessagingHealthAfterDeliveryFailure.mockRejectedValueOnce(boom);

    await expect(
      recheckHealthAfterDeliveryFailure(['clinic-1'], {
        ip: null,
        userAgent: null,
        requestId: 'request-1',
        correlationId: 'request-1',
      }),
    ).resolves.toBeUndefined();
    expect(captureBackgroundError).toHaveBeenCalledWith(boom, {
      flow: 'messaging.webhook.health_recheck',
    });
  });
});
