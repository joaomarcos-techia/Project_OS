/**
 * Handler `payments.patient_credit.granted` → crédito no Financial.
 *
 * Prova a fiação e as duas regras que não podem ceder:
 *   - o handler escreve com o clinicId do WORKER, e um payload de outra clínica
 *     é poison pill, não retentativa — dinheiro entrando na conta errada não se
 *     resolve tentando de novo;
 *   - **nenhum lançamento é criado aqui.** O recebível nasce no
 *     `appointment.completed`, pelo valor bruto (ADR-051 invariante 3).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerHandler: vi.fn(),
  grantCredit: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/lib/outbox/registry', () => ({ registerHandler: mocks.registerHandler }));
vi.mock('@/contexts/payments', () => ({
  PAYMENTS_EVENTS: { CREDIT_GRANTED: 'payments.patient_credit.granted' },
}));
vi.mock('../credit-store', () => ({ grantCredit: mocks.grantCredit }));

import { metrics } from '@/lib/observability/metrics';
import { PoisonPillError } from '@/lib/outbox/errors';

import './patient-credit-granted';

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
  patientId: 'pac-1',
  kind: 'deposit',
  amount: 150,
  paidAt: '2026-08-25T12:00:00.000Z',
  paymentMethod: 'pix',
  ...over,
});

const run = (over: Record<string, unknown> = {}) =>
  handler({ tx: 'TX', clinicId: 'clinic-1', payload: payload(over), eventId: 'evt-1' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.grantCredit.mockResolvedValue(true);
});

describe('handler de crédito concedido', () => {
  it('registra-se no evento de CRÉDITO, não no de cobrança', () => {
    // `patient_charge.paid` já é do Scheduling; e os dois fatos significam
    // coisas diferentes para domínios diferentes.
    expect(registration[0]).toBe('payments.patient_credit.granted');
  });

  it('grava o crédito com o que veio do pagamento', async () => {
    await run();

    expect(mocks.grantCredit).toHaveBeenCalledWith('TX', {
      clinicId: 'clinic-1',
      patientChargeId: 'charge-1',
      appointmentId: 'apt-1',
      patientId: 'pac-1',
      amount: 150,
      kind: 'deposit',
      paymentMethod: 'pix',
      grantedAt: new Date('2026-08-25T12:00:00.000Z'),
    });
  });

  it('clínica divergente é POISON PILL, não retentativa', async () => {
    // Retentar não conserta dinheiro entrando na conta errada; só repete.
    const err = await run({ clinicId: 'clinic-INTRUSA' }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PoisonPillError);
    expect(mocks.grantCredit).not.toHaveBeenCalled();
  });

  it('reentrega (UNIQUE barrou) conclui em silêncio, com métrica', async () => {
    mocks.grantCredit.mockResolvedValue(false);

    await expect(run()).resolves.toBeUndefined();
    const emitted = vi
      .mocked(metrics.emit)
      .mock.calls.find((c) => c[0] === 'financial.patient_credit.granted');
    expect(emitted?.[1]).toMatchObject({ created: false });
  });

  it('crédito do RESTANTE chega com o kind próprio', async () => {
    await run({ kind: 'remaining_payment' });

    expect(mocks.grantCredit).toHaveBeenCalledWith(
      'TX',
      expect.objectContaining({ kind: 'remaining_payment' }),
    );
  });

  it('paciente anônimo (encaixe) não impede o crédito', async () => {
    await run({ patientId: null });

    expect(mocks.grantCredit).toHaveBeenCalledWith(
      'TX',
      expect.objectContaining({ patientId: null }),
    );
  });
});
