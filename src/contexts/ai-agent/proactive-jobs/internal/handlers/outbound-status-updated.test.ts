/**
 * EC-32 — handler `messaging.outbound.status_updated` → job C14 em falha.
 *
 * Em 08/10/2026 o template `link_deposito` foi aceito pela Cloud API (job
 * `sent`) e a Meta o recusou em seguida com 131042; o evento terminava `skipped`
 * por falta de consumidor. Aqui se prova a ligação envio → chave → job da mesma
 * clínica, o motivo `meta_<código>`, o retry quando o job ainda está em voo e o
 * no-op para tudo que não é recusa de envio da C14.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HandlerError, PoisonPillError } from '@/lib/outbox/errors';

const mocks = vi.hoisted(() => ({
  registerHandler: vi.fn(),
  getOutboundIdempotencyKey:
    vi.fn<(tx: unknown, clinicId: string, id: string) => Promise<string | null>>(),
  markDeliveryFailedTx: vi.fn(),
}));

vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/lib/outbox/registry', () => ({ registerHandler: mocks.registerHandler }));
vi.mock('@/contexts/messaging', () => ({
  MESSAGING_EVENTS: { OUTBOUND_STATUS_UPDATED: 'messaging.outbound.status_updated' },
  messagingApiV1: { getOutboundIdempotencyKey: mocks.getOutboundIdempotencyKey },
}));
vi.mock('../../infra/repository', () => ({ markDeliveryFailedTx: mocks.markDeliveryFailedTx }));

import { metrics } from '@/lib/observability/metrics';

import { deliveryFailureReason } from './outbound-status-updated';

// Capturado no LOAD: `clearAllMocks` apagaria o registro.
const registration = mocks.registerHandler.mock.calls[0]!;
type Handler = (ctx: {
  tx: unknown;
  clinicId: string;
  payload: Record<string, unknown>;
  eventId: string;
}) => Promise<void>;
const handler = registration[1] as Handler;

const CLINIC = '11111111-1111-4111-8111-111111111111';
const OUTBOUND = '22222222-2222-4222-8222-222222222222';
const JOB = '33333333-3333-4333-8333-333333333333';

const payload = (over: Record<string, unknown> = {}) => ({
  clinicId: CLINIC,
  outboundMessageId: OUTBOUND,
  providerMessageId: 'wamid.HBgM',
  status: 'failed',
  errorCode: '131042',
  ...over,
});

const run = (over: Record<string, unknown> = {}, clinicId = CLINIC) =>
  handler({ tx: 'TX', clinicId, payload: payload(over), eventId: 'evt-1' });

beforeEach(() => {
  mocks.getOutboundIdempotencyKey.mockReset().mockResolvedValue(JOB);
  mocks.markDeliveryFailedTx.mockReset().mockResolvedValue({
    kind: 'failed',
    type: 'deposit_link',
    previousStatus: 'sent',
  });
  vi.mocked(metrics.emit).mockClear();
});

describe('handler messaging.outbound.status_updated (C14)', () => {
  it('registers on the public Messaging event', () => {
    expect(registration[0]).toBe('messaging.outbound.status_updated');
  });

  it('a Meta refusal fails the job whose id is the send key, with the Meta code', async () => {
    await run();

    expect(mocks.getOutboundIdempotencyKey).toHaveBeenCalledWith('TX', CLINIC, OUTBOUND);
    expect(mocks.markDeliveryFailedTx).toHaveBeenCalledWith('TX', CLINIC, JOB, 'meta_131042');
    expect(metrics.emit).toHaveBeenCalledWith('proactive.job.failed', {
      clinicId: CLINIC,
      jobId: JOB,
      type: 'deposit_link',
      reason: 'meta_131042',
      stage: 'delivery',
      previousStatus: 'sent',
      outboundMessageId: OUTBOUND,
      eventId: 'evt-1',
    });
  });

  it('never logs the wamid: its prefix encodes the patient number', async () => {
    await run();

    expect(JSON.stringify(vi.mocked(metrics.emit).mock.calls)).not.toContain('wamid');
  });

  it('an event published before errorCode existed still fails the job, as meta_failed', async () => {
    await run({ errorCode: undefined });

    expect(mocks.markDeliveryFailedTx).toHaveBeenCalledWith('TX', CLINIC, JOB, 'meta_failed');
  });

  it('sent, delivered and read never touch a job', async () => {
    for (const status of ['sent', 'delivered', 'read']) {
      await run({ status, errorCode: undefined });
    }

    expect(mocks.getOutboundIdempotencyKey).not.toHaveBeenCalled();
    expect(mocks.markDeliveryFailedTx).not.toHaveBeenCalled();
    expect(metrics.emit).not.toHaveBeenCalled();
  });

  it('a send this clinic does not have changes nothing', async () => {
    mocks.getOutboundIdempotencyKey.mockResolvedValue(null);

    await run();

    expect(mocks.markDeliveryFailedTx).not.toHaveBeenCalled();
  });

  it('a send key that is not a uuid cannot be a job id', async () => {
    mocks.getOutboundIdempotencyKey.mockResolvedValue('manual:abc');

    await run();

    expect(mocks.markDeliveryFailedTx).not.toHaveBeenCalled();
  });

  it('a refused send that is not a C14 job (AI or manual reply) is a silent no-op', async () => {
    mocks.markDeliveryFailedTx.mockResolvedValue({ kind: 'not_found' });

    await expect(run()).resolves.toBeUndefined();
    expect(metrics.emit).not.toHaveBeenCalled();
  });

  it('redelivery of the event finds the job already failed and does nothing', async () => {
    mocks.markDeliveryFailedTx.mockResolvedValue({
      kind: 'unchanged',
      type: 'deposit_link',
      status: 'failed',
    });

    await expect(run()).resolves.toBeUndefined();
    expect(metrics.emit).not.toHaveBeenCalled();
  });

  it('a job still in flight is retried by the outbox, not dropped', async () => {
    mocks.markDeliveryFailedTx.mockResolvedValue({ kind: 'in_flight', type: 'deposit_link' });

    const error = await run().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(HandlerError);
    expect(error).not.toBeInstanceOf(PoisonPillError);
    expect((error as HandlerError).code).toBe('proactive_job_in_flight');
    expect(metrics.emit).not.toHaveBeenCalled();
  });

  it('a payload of another clinic than the event tenant is poison, before any read', async () => {
    const other = '44444444-4444-4444-8444-444444444444';

    const error = await run({ clinicId: other }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(PoisonPillError);
    expect((error as PoisonPillError).code).toBe('clinic_mismatch');
    expect(mocks.getOutboundIdempotencyKey).not.toHaveBeenCalled();
    expect(mocks.markDeliveryFailedTx).not.toHaveBeenCalled();
  });
});

describe('deliveryFailureReason', () => {
  it('maps the Meta code to the failed_reason', () => {
    expect(deliveryFailureReason('131042')).toBe('meta_131042');
    expect(deliveryFailureReason(undefined)).toBe('meta_failed');
  });
});
