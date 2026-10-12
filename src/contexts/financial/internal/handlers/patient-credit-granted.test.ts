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
  applyCreditToExistingReceivable: vi.fn(),
  recordProviderExpense: vi.fn(),
  refreshProfessionalPayout: vi.fn(),
  publishEvent: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/lib/outbox/registry', () => ({ registerHandler: mocks.registerHandler }));
vi.mock('@/lib/outbox/publish', () => ({ publishEvent: mocks.publishEvent }));
vi.mock('@/contexts/payments', () => ({
  PAYMENTS_EVENTS: { CREDIT_GRANTED: 'payments.patient_credit.granted' },
}));
vi.mock('../credit-store', () => ({ grantCredit: mocks.grantCredit }));
vi.mock('../credit-allocation', () => ({
  applyCreditToExistingReceivable: mocks.applyCreditToExistingReceivable,
}));
vi.mock('../provider-expense', () => ({ recordProviderExpense: mocks.recordProviderExpense }));
vi.mock('../professional-payout', () => ({
  refreshProfessionalPayout: mocks.refreshProfessionalPayout,
}));
vi.mock('../../schema', () => ({
  faturamentoPendencias: { appointmentId: 'fp.appointment_id' },
}));

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
  providerGrossAmount: 150,
  providerFeeAmount: 5,
  providerNetAmount: 145,
  earlySettlementFeeAmount: null,
  installmentNumber: null,
  paidAt: '2026-08-25T12:00:00.000Z',
  paymentMethod: 'pix',
  ...over,
});

const run = (over: Record<string, unknown> = {}) =>
  handler({ tx: 'TX', clinicId: 'clinic-1', payload: payload(over), eventId: 'evt-1' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.grantCredit.mockResolvedValue('credit-1');
  mocks.applyCreditToExistingReceivable.mockResolvedValue({
    outcome: 'deferred',
    reason: 'receivable_not_open',
  });
  mocks.refreshProfessionalPayout.mockResolvedValue('missing');
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
      providerGrossAmount: 150,
      providerFeeAmount: 5,
      providerNetAmount: 145,
      earlySettlementFeeAmount: null,
      kind: 'deposit',
      paymentMethod: 'pix',
      grantedAt: new Date('2026-08-25T12:00:00.000Z'),
    });
  });

  it('registra a taxa real como despesa separada e idempotente', async () => {
    await run();

    expect(mocks.recordProviderExpense).toHaveBeenCalledWith('TX', {
      clinicId: 'clinic-1',
      patientChargeId: 'charge-1',
      kind: 'payment_processing_fee',
      amount: 5,
      occurredAt: new Date('2026-08-25T12:00:00.000Z'),
    });
  });

  it('projeta o payload legado do outbox sem criar taxa ou liquido', async () => {
    await handler({
      tx: 'TX',
      clinicId: 'clinic-1',
      eventId: 'evt-legacy',
      payload: {
        chargeId: 'charge-1',
        clinicId: 'clinic-1',
        appointmentId: 'apt-1',
        patientId: 'pac-1',
        kind: 'deposit',
        amount: 150,
        paidAt: '2026-08-25T12:00:00.000Z',
        paymentMethod: 'pix',
      },
    });

    expect(mocks.grantCredit).toHaveBeenCalledWith(
      'TX',
      expect.objectContaining({
        amount: 150,
        providerGrossAmount: null,
        providerFeeAmount: null,
        providerNetAmount: null,
        earlySettlementFeeAmount: null,
      }),
    );
    expect(mocks.applyCreditToExistingReceivable).toHaveBeenCalledOnce();
    expect(mocks.recordProviderExpense).not.toHaveBeenCalled();
  });

  it('clínica divergente é POISON PILL, não retentativa', async () => {
    // Retentar não conserta dinheiro entrando na conta errada; só repete.
    const err = await run({ clinicId: 'clinic-INTRUSA' }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PoisonPillError);
    expect(mocks.grantCredit).not.toHaveBeenCalled();
  });

  it('reentrega (UNIQUE barrou) conclui em silêncio, com métrica', async () => {
    mocks.grantCredit.mockResolvedValue(null);

    await expect(run()).resolves.toBeUndefined();
    const emitted = vi
      .mocked(metrics.emit)
      .mock.calls.find((c) => c[0] === 'financial.patient_credit.granted');
    expect(emitted?.[1]).toMatchObject({ created: false });
    expect(mocks.applyCreditToExistingReceivable).not.toHaveBeenCalled();
  });

  it('crédito do RESTANTE chega com o kind próprio', async () => {
    await run({ kind: 'remaining_payment' });

    expect(mocks.grantCredit).toHaveBeenCalledWith(
      'TX',
      expect.objectContaining({ kind: 'remaining_payment' }),
    );
  });

  it('recebível existente recebe o crédito na mesma transação', async () => {
    mocks.applyCreditToExistingReceivable.mockResolvedValue({
      outcome: 'applied',
      lancamentoId: 'lanc-1',
      transactionId: 'tx-1',
      appliedAmount: 150,
      unappliedAmount: 0,
      status: 'pago',
    });

    await run({ kind: 'remaining_payment' });

    expect(mocks.applyCreditToExistingReceivable).toHaveBeenCalledWith('TX', {
      clinicId: 'clinic-1',
      appointmentId: 'apt-1',
      creditId: 'credit-1',
      patientChargeId: 'charge-1',
      amount: 150,
      paymentMethod: 'pix',
      paidAt: new Date('2026-08-25T12:00:00.000Z'),
      correlationId: 'evt-1',
    });
    expect(metrics.emit).toHaveBeenCalledWith(
      'financial.patient_credit.granted',
      expect.objectContaining({ allocation: 'applied', appliedAmount: 150 }),
    );
    expect(mocks.refreshProfessionalPayout).toHaveBeenCalledWith('TX', {
      clinicId: 'clinic-1',
      appointmentId: 'apt-1',
    });
  });

  it('paciente anônimo (encaixe) não impede o crédito', async () => {
    await run({ patientId: null });

    expect(mocks.grantCredit).toHaveBeenCalledWith(
      'TX',
      expect.objectContaining({ patientId: null }),
    );
  });

  it('excedente abre pendência e publica pedido do valor exato', async () => {
    mocks.applyCreditToExistingReceivable.mockResolvedValue({
      outcome: 'applied',
      lancamentoId: 'lanc-1',
      transactionId: 'tx-1',
      appliedAmount: 100,
      unappliedAmount: 50,
      status: 'pago',
    });
    const pending = vi.fn();
    const tx = {
      insert: () => ({
        values: pending,
      }),
    };
    pending.mockReturnValue({ onConflictDoUpdate: async () => undefined });

    await handler({
      tx,
      clinicId: 'clinic-1',
      payload: payload({ kind: 'remaining_payment' }),
      eventId: 'evt-1',
    });

    expect(pending).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: 'apt-1', valor: '50.00', status: 'aberta' }),
    );
    expect(mocks.publishEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        eventType: 'financial.patient_refund.requested',
        idempotencyKey: 'excess-refund-requested:charge-1',
        payload: expect.objectContaining({ chargeId: 'charge-1', amount: 50 }),
      }),
    );
  });
});
