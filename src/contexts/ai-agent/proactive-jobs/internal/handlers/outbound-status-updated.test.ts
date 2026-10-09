/**
 * EC-32 + ADR-064 — handler `messaging.outbound.status_updated` → job C14.
 *
 * Em 08/10/2026 o template `link_deposito` foi aceito pela Cloud API (job
 * `sent`) e a Meta o recusou em seguida com 131042; o evento terminava `skipped`
 * por falta de consumidor. Aqui se prova a ligação envio → chave da geração →
 * job da mesma clínica, a decisão da recusa (reenvio com chave nova só para
 * código retentável; o resto falha com `meta_<código>`), o retry quando o job
 * ainda está em voo e o no-op para tudo que não é recusa da geração atual.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HandlerError, PoisonPillError } from '@/lib/outbox/errors';

const mocks = vi.hoisted(() => ({
  registerHandler: vi.fn(),
  getOutboundIdempotencyKey:
    vi.fn<(tx: unknown, clinicId: string, id: string) => Promise<string | null>>(),
  lockJobBySendKeyTx: vi.fn(),
  settleRefusedJobTx: vi.fn(),
  getClinicTimezoneTx: vi.fn(async () => 'America/Sao_Paulo'),
}));

vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/lib/outbox/registry', () => ({ registerHandler: mocks.registerHandler }));
vi.mock('@/contexts/messaging', () => ({
  MESSAGING_EVENTS: { OUTBOUND_STATUS_UPDATED: 'messaging.outbound.status_updated' },
  messagingApiV1: { getOutboundIdempotencyKey: mocks.getOutboundIdempotencyKey },
}));
vi.mock('../../infra/repository', () => ({
  lockJobBySendKeyTx: mocks.lockJobBySendKeyTx,
  settleRefusedJobTx: mocks.settleRefusedJobTx,
  getClinicTimezoneTx: mocks.getClinicTimezoneTx,
}));

import { metrics } from '@/lib/observability/metrics';

import './outbound-status-updated';

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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const depositPayload = {
  patientId: CLINIC,
  chargeId: CLINIC,
  appointmentId: CLINIC,
  amount: 150,
  holdExpiresAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
};

const job = (over: Record<string, unknown> = {}) => ({
  id: JOB,
  type: 'deposit_link',
  status: 'sent',
  payload: depositPayload,
  attempts: 1,
  leaseToken: null,
  leaseExpired: false,
  ...over,
});

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

const settlement = () => mocks.settleRefusedJobTx.mock.calls[0]?.[3];

beforeEach(() => {
  mocks.getOutboundIdempotencyKey.mockReset().mockResolvedValue(JOB);
  mocks.lockJobBySendKeyTx.mockReset().mockResolvedValue(job());
  mocks.settleRefusedJobTx.mockReset().mockResolvedValue(undefined);
  vi.mocked(metrics.emit).mockClear();
});

describe('handler messaging.outbound.status_updated (C14)', () => {
  it('registers on the public Messaging event', () => {
    expect(registration[0]).toBe('messaging.outbound.status_updated');
  });

  it('a definitive refusal fails the job of the current generation, with the Meta code', async () => {
    await run();

    expect(mocks.getOutboundIdempotencyKey).toHaveBeenCalledWith('TX', CLINIC, OUTBOUND);
    expect(mocks.lockJobBySendKeyTx).toHaveBeenCalledWith('TX', CLINIC, JOB);
    expect(mocks.settleRefusedJobTx).toHaveBeenCalledWith('TX', CLINIC, job(), {
      status: 'failed',
      reason: 'meta_131042',
    });
    expect(metrics.emit).toHaveBeenCalledWith('proactive.job.failed', {
      clinicId: CLINIC,
      jobId: JOB,
      type: 'deposit_link',
      reason: 'meta_131042',
      stage: 'delivery',
      previousStatus: 'sent',
      outboundMessageId: OUTBOUND,
      eventId: 'evt-1',
      why: 'not_retryable',
    });
  });

  it('a transient refusal resends: back to pending with a NEW key and the outbox backoff', async () => {
    const before = Date.now();

    await run({ errorCode: '131000' });

    const s = settlement();
    expect(s).toMatchObject({ status: 'pending', reason: 'meta_131000' });
    expect(s.sendKey).toMatch(UUID);
    expect(s.sendKey).not.toBe(JOB);
    expect(s.nextAt.getTime()).toBeGreaterThanOrEqual(before + 30_000);
    expect(s.nextAt.getTime()).toBeLessThanOrEqual(Date.now() + 30_000);
    expect(metrics.emit).toHaveBeenCalledWith(
      'proactive.job.retried',
      expect.objectContaining({ jobId: JOB, reason: 'meta_131000', delayMs: 30_000, resend: true }),
    );
  });

  it('a transient refusal after the 5th attempt fails with the code', async () => {
    mocks.lockJobBySendKeyTx.mockResolvedValue(job({ attempts: 5 }));

    await run({ errorCode: '131000' });

    expect(settlement()).toEqual({ status: 'failed', reason: 'meta_131000' });
    expect(metrics.emit).toHaveBeenCalledWith(
      'proactive.job.failed',
      expect.objectContaining({ why: 'attempts_exhausted' }),
    );
  });

  it('deposit link: no resend once the next attempt would land after the hold', async () => {
    mocks.lockJobBySendKeyTx.mockResolvedValue(
      job({
        payload: { ...depositPayload, holdExpiresAt: new Date(Date.now() + 10_000).toISOString() },
      }),
    );

    await run({ errorCode: '131016' });

    expect(settlement()).toEqual({ status: 'failed', reason: 'meta_131016' });
    expect(metrics.emit).toHaveBeenCalledWith(
      'proactive.job.failed',
      expect.objectContaining({ why: 'past_deadline' }),
    );
  });

  it('reminder: no resend that would land on the appointment day ("amanhã" would lie)', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-08T22:00:00.000Z'), toFake: ['Date'] });
    try {
      // 19:00 em São Paulo; a 4ª tentativa voltaria em +6 h, já no dia da consulta.
      mocks.lockJobBySendKeyTx.mockResolvedValue(
        job({
          type: 'reminder',
          attempts: 4,
          payload: {
            patientId: CLINIC,
            appointmentId: CLINIC,
            scheduledAt: '2026-10-09T19:00:00.000Z',
            doctorNome: 'Dr X',
          },
        }),
      );

      await run({ errorCode: '131016' });

      expect(mocks.getClinicTimezoneTx).toHaveBeenCalledWith('TX', CLINIC);
      expect(settlement()).toEqual({ status: 'failed', reason: 'meta_131016' });
      expect(metrics.emit).toHaveBeenCalledWith(
        'proactive.job.failed',
        expect.objectContaining({ why: 'past_deadline' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('a job whose stored payload no longer parses is closed, never resent', async () => {
    mocks.lockJobBySendKeyTx.mockResolvedValue(job({ payload: { patientId: 'x' } }));

    await run({ errorCode: '131000' });

    expect(settlement()).toEqual({ status: 'failed', reason: 'meta_131000' });
    expect(metrics.emit).toHaveBeenCalledWith(
      'proactive.job.failed',
      expect.objectContaining({ why: 'invalid_payload' }),
    );
  });

  it('a rotated key (generation 1+) still leads to its job', async () => {
    const nextKey = '55555555-5555-4555-8555-555555555555';
    mocks.getOutboundIdempotencyKey.mockResolvedValue(nextKey);

    await run();

    expect(mocks.lockJobBySendKeyTx).toHaveBeenCalledWith('TX', CLINIC, nextKey);
    expect(settlement()).toEqual({ status: 'failed', reason: 'meta_131042' });
  });

  it('a refusal of a replaced generation (or of a non-C14 send) finds no job and changes nothing', async () => {
    mocks.lockJobBySendKeyTx.mockResolvedValue(null);

    await expect(run({ errorCode: '131000' })).resolves.toBeUndefined();
    expect(mocks.settleRefusedJobTx).not.toHaveBeenCalled();
    expect(metrics.emit).not.toHaveBeenCalled();
  });

  it('a pending job of the same generation (lease lost after the accept) is decided too', async () => {
    mocks.lockJobBySendKeyTx.mockResolvedValue(job({ status: 'pending' }));

    await run({ errorCode: '131000' });

    expect(settlement()).toMatchObject({ status: 'pending', reason: 'meta_131000' });
  });

  it('never logs the wamid: its prefix encodes the patient number', async () => {
    await run();
    await run({ errorCode: '131000' });

    expect(JSON.stringify(vi.mocked(metrics.emit).mock.calls)).not.toContain('wamid');
  });

  it('an event published before errorCode existed fails the job as meta_failed', async () => {
    await run({ errorCode: undefined });

    expect(settlement()).toEqual({ status: 'failed', reason: 'meta_failed' });
  });

  it('sent, delivered and read never touch a job', async () => {
    for (const status of ['sent', 'delivered', 'read']) {
      await run({ status, errorCode: undefined });
    }

    expect(mocks.getOutboundIdempotencyKey).not.toHaveBeenCalled();
    expect(mocks.lockJobBySendKeyTx).not.toHaveBeenCalled();
    expect(metrics.emit).not.toHaveBeenCalled();
  });

  it('a send this clinic does not have changes nothing', async () => {
    mocks.getOutboundIdempotencyKey.mockResolvedValue(null);

    await run();

    expect(mocks.lockJobBySendKeyTx).not.toHaveBeenCalled();
  });

  it('a send key that is not a uuid cannot be a C14 key', async () => {
    mocks.getOutboundIdempotencyKey.mockResolvedValue('manual:abc');

    await run();

    expect(mocks.lockJobBySendKeyTx).not.toHaveBeenCalled();
  });

  it('redelivery finds the job already terminal and does nothing', async () => {
    for (const status of ['failed', 'cancelled']) {
      mocks.lockJobBySendKeyTx.mockResolvedValue(job({ status }));

      await expect(run({ errorCode: '131000' })).resolves.toBeUndefined();
    }
    expect(mocks.settleRefusedJobTx).not.toHaveBeenCalled();
    expect(metrics.emit).not.toHaveBeenCalled();
  });

  it('a job still in flight (live lease) is retried by the outbox, not dropped', async () => {
    mocks.lockJobBySendKeyTx.mockResolvedValue(
      job({ status: 'processing', leaseToken: 'lease-1', leaseExpired: false }),
    );

    const error = await run().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(HandlerError);
    expect(error).not.toBeInstanceOf(PoisonPillError);
    expect((error as HandlerError).code).toBe('proactive_job_in_flight');
    expect(mocks.settleRefusedJobTx).not.toHaveBeenCalled();
    expect(metrics.emit).not.toHaveBeenCalled();
  });

  it('a processing job whose lease expired is a dead attempt: the handler decides for it', async () => {
    const dead = job({ status: 'processing', leaseToken: 'lease-1', leaseExpired: true });
    mocks.lockJobBySendKeyTx.mockResolvedValue(dead);

    await run({ errorCode: '131000' });

    expect(mocks.settleRefusedJobTx).toHaveBeenCalledWith(
      'TX',
      CLINIC,
      dead,
      expect.objectContaining({ status: 'pending', reason: 'meta_131000' }),
    );
    expect(metrics.emit).toHaveBeenCalledWith(
      'proactive.job.retried',
      expect.objectContaining({ previousStatus: 'processing' }),
    );
  });

  it('a payload of another clinic than the event tenant is poison, before any read', async () => {
    const other = '44444444-4444-4444-8444-444444444444';

    const error = await run({ clinicId: other }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(PoisonPillError);
    expect((error as PoisonPillError).code).toBe('clinic_mismatch');
    expect(mocks.getOutboundIdempotencyKey).not.toHaveBeenCalled();
    expect(mocks.lockJobBySendKeyTx).not.toHaveBeenCalled();
  });
});
