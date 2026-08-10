import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  afterMock,
  validateSignature,
  parseWebhook,
  resolveClinicByPhoneId,
  persistInbound,
  persistStatusEvents,
  quarantineOrphan,
  runOutboxOnce,
  captureBackgroundError,
  emit,
} = vi.hoisted(() => ({
  afterMock: vi.fn(),
  validateSignature: vi.fn(),
  parseWebhook: vi.fn(),
  resolveClinicByPhoneId: vi.fn(),
  persistInbound: vi.fn(),
  persistStatusEvents: vi.fn(),
  quarantineOrphan: vi.fn(),
  runOutboxOnce: vi.fn(),
  captureBackgroundError: vi.fn(),
  emit: vi.fn(),
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
vi.mock('@/lib/outbox/worker', () => ({ runOutboxOnce }));
vi.mock('@/lib/messaging', () => ({
  getMessagingProvider: () => ({ validateSignature, parseWebhook }),
  resolveClinicByPhoneId,
  quarantineOrphan,
}));
vi.mock('@/contexts/messaging/internal/inbound', () => ({ persistInbound, persistStatusEvents }));

import { POST, triggerOutboxAfterMetaIngress } from './route';

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
    runOutboxOnce.mockResolvedValue({
      processed: 1,
      failed: 0,
      skipped: 0,
      empty: 0,
      stuck_reclaimed: 0,
      circuit_paused: 0,
      duration_ms: 12,
    });
  });

  it('acknowledges persisted ingress and schedules a single worker tick after the response', async () => {
    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(persistInbound).toHaveBeenCalledWith(
      'clinic-1',
      'meta',
      expect.objectContaining({ providerMessageId: 'wamid-1' }),
    );
    expect(afterMock).toHaveBeenCalledWith(triggerOutboxAfterMetaIngress);
    expect(runOutboxOnce).not.toHaveBeenCalled();
  });

  it('does not schedule worker work for a rejected signature', async () => {
    validateSignature.mockReturnValue(false);

    expect((await POST(webhookRequest())).status).toBe(401);
    expect(persistInbound).not.toHaveBeenCalled();
    expect(afterMock).not.toHaveBeenCalled();
  });

  it('processes at most one job in the best-effort ingress tick', async () => {
    await expect(triggerOutboxAfterMetaIngress()).resolves.toBeUndefined();

    expect(runOutboxOnce).toHaveBeenCalledWith({ batchSize: 1, parallelism: 1 });
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
    runOutboxOnce.mockRejectedValue(workerError);

    await expect(triggerOutboxAfterMetaIngress()).resolves.toBeUndefined();

    expect(captureBackgroundError).toHaveBeenCalledWith(workerError, {
      flow: 'messaging.webhook.outbox_trigger',
    });
    expect(emit).toHaveBeenCalledWith('messaging.webhook.outbox_trigger_failed', {
      error: workerError,
    });
  });
});
