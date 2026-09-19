/**
 * Handler `payments.patient_credit.released` → crédito sai de `available`.
 *
 * A regra central é a `disposition` vir EXPLÍCITA do payload. `refunded` e
 * `retained` são economicamente opostos — num o dinheiro saiu da conta da
 * clínica, no outro continua sendo receita — e inferir isso do nome de um evento
 * de outro context é o acoplamento que o ADR-051 D1 existe para impedir.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerHandler: vi.fn(),
  releaseCredit: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/lib/outbox/registry', () => ({ registerHandler: mocks.registerHandler }));
vi.mock('@/contexts/payments', () => ({
  PAYMENTS_EVENTS: { CREDIT_RELEASED: 'payments.patient_credit.released' },
}));
vi.mock('../credit-store', () => ({ releaseCredit: mocks.releaseCredit }));

import { metrics } from '@/lib/observability/metrics';
import { PoisonPillError } from '@/lib/outbox/errors';

import './patient-credit-released';

const registration = mocks.registerHandler.mock.calls[0]!;
type Handler = (ctx: {
  tx: unknown;
  clinicId: string;
  payload: Record<string, unknown>;
  eventId: string;
}) => Promise<void>;
const handler = registration[1] as Handler;

const payload = (over: Record<string, unknown> = {}) => ({
  chargeId: 'charge-1',
  clinicId: 'clinic-1',
  appointmentId: 'apt-1',
  amount: 150,
  disposition: 'refunded',
  releasedAt: '2026-08-25T13:00:00.000Z',
  ...over,
});

const run = (over: Record<string, unknown> = {}) =>
  handler({ tx: 'TX', clinicId: 'clinic-1', payload: payload(over), eventId: 'evt-1' });

const emitted = () =>
  vi.mocked(metrics.emit).mock.calls.find((c) => c[0] === 'financial.patient_credit.released');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.releaseCredit.mockResolvedValue('released');
});

describe('handler de crédito liberado', () => {
  it('registra-se no evento de crédito do Payments', () => {
    expect(registration[0]).toBe('payments.patient_credit.released');
  });

  it.each(['refunded', 'retained'] as const)(
    'repassa a disposition %s sem interpretar',
    async (disposition) => {
      await run({ disposition });

      expect(mocks.releaseCredit).toHaveBeenCalledWith('TX', {
        clinicId: 'clinic-1',
        patientChargeId: 'charge-1',
        disposition,
        releasedAt: new Date('2026-08-25T13:00:00.000Z'),
      });
    },
  );

  it('clínica divergente é POISON PILL', async () => {
    const err = await run({ clinicId: 'clinic-INTRUSA' }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PoisonPillError);
    expect(mocks.releaseCredit).not.toHaveBeenCalled();
  });

  it('crédito inexistente conclui: é a janela de deploy, não uma falha', async () => {
    // Cobrança paga ANTES da 1.5b.1 subir não tem crédito. Lançar aqui prenderia
    // o evento em retentativa por causa de um deploy.
    mocks.releaseCredit.mockResolvedValue('not_found');

    await expect(run()).resolves.toBeUndefined();
    expect(emitted()?.[1]).toMatchObject({ outcome: 'not_found' });
  });

  it('crédito já resolvido conclui em silêncio (reentrega)', async () => {
    mocks.releaseCredit.mockResolvedValue('already_resolved');

    await expect(run()).resolves.toBeUndefined();
    expect(emitted()?.[1]).toMatchObject({ outcome: 'already_resolved' });
  });
});
