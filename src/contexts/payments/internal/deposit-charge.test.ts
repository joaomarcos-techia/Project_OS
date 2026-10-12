/**
 * Cobrança do sinal (ADR-049 1.3 + ADR-050) — o caminho que decide se o paciente
 * é cobrado.
 *
 * A regra que estes testes protegem acima de tudo: **o padrão é NÃO cobrar**.
 * Cada saída silenciosa aqui é uma decisão de produto, não um `if` de conveniência,
 * e cada uma tem um teste próprio — se alguém remover uma guarda, o teste diz qual.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AsaasModule from '@/lib/payments/asaas';

const mocks = vi.hoisted(() => ({
  getDepositPolicy: vi.fn(),
  findChargeByAppointment: vi.fn(),
  createInitialHostedCheckout: vi.fn(),
  resolveCheckoutWindow: vi.fn(),
  getClinicAsaasClient: vi.fn(),
  getPaymentIdentity: vi.fn(),
  listPatientAppointments: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/lib/payments/account-store', () => ({
  getClinicAsaasClient: mocks.getClinicAsaasClient,
}));
vi.mock('@/contexts/patient', () => ({
  patientApiV1: { getPaymentIdentity: mocks.getPaymentIdentity },
}));
vi.mock('@/contexts/scheduling', () => ({
  schedulingApiV1: { listPatientAppointments: mocks.listPatientAppointments },
}));
vi.mock('../queries', () => ({ getDepositPolicy: mocks.getDepositPolicy }));
vi.mock('./charge-store', () => ({
  findChargeByAppointment: mocks.findChargeByAppointment,
}));
vi.mock('./hosted-checkout', () => ({
  createInitialHostedCheckout: mocks.createInitialHostedCheckout,
  resolveCheckoutWindow: mocks.resolveCheckoutWindow,
}));
// Erros REAIS (o código usa `instanceof`); só o client é trocado.
vi.mock('@/lib/payments/asaas', async (importActual) => {
  const actual = await importActual<typeof AsaasModule>();
  return { ...actual };
});

import { metrics } from '@/lib/observability/metrics';
import { BillingProviderError, BillingProviderUnreachableError } from '@/lib/payments/asaas';

import { createDepositCharge, resolveHoldExpiry } from './deposit-charge';

const APPOINTMENT = '11111111-1111-4111-8111-111111111111';
const PATIENT = '22222222-2222-4222-8222-222222222222';
const CLINIC = '33333333-3333-4333-8333-333333333333';

const POLICY_ON = {
  enabled: true,
  percent: 50,
  cancellationWindowHours: 24,
  appliesToFirstVisit: true,
  appliesToReturn: true,
  updatedAt: null,
};

/** Consulta longe o suficiente para o hold de 24h caber inteiro. */
const payload = (over: Record<string, unknown> = {}) => ({
  appointmentId: APPOINTMENT,
  clinicId: CLINIC,
  doctorId: CLINIC,
  patientId: PATIENT,
  procedureId: CLINIC,
  scheduledAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
  durationMin: 50,
  valor: 300,
  snapshotProcedureName: 'Consulta psiquiátrica',
  snapshotProcedureCodigo: null,
  snapshotProcedureCategoria: null,
  snapshotProcedureValor: 300,
  snapshotProcedureDuracaoMin: 50,
  snapshotDoctorNome: 'Dra. Exemplo',
  createdVia: 'attendant' as const,
  ...over,
});

const run = (over: Record<string, unknown> = {}) =>
  createDepositCharge({ clinicId: CLINIC, appointment: payload(over) as never });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDepositPolicy.mockResolvedValue(POLICY_ON);
  mocks.findChargeByAppointment.mockResolvedValue(null);
  mocks.listPatientAppointments.mockResolvedValue([{ id: APPOINTMENT }]);
  mocks.getPaymentIdentity.mockResolvedValue({ nome: 'Paciente Exemplo', cpf: '39053344705' });
  mocks.resolveCheckoutWindow.mockReturnValue({
    minutesToExpire: 1_440,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  mocks.createInitialHostedCheckout.mockResolvedValue('created');
  mocks.getClinicAsaasClient.mockResolvedValue({});
});

describe('caminho feliz', () => {
  it('cobra o percentual da política e grava a cobrança', async () => {
    await run();

    expect(mocks.createInitialHostedCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 150,
        kind: 'deposit',
        description: 'Sinal do agendamento',
      }),
    );
  });

  it('restringe o Checkout ao método comercial escolhido', async () => {
    await run({ commercialPaymentMethod: 'credit_card', commercialInstallmentCount: 3 });

    expect(mocks.createInitialHostedCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethod: 'credit_card', installmentCount: 3 }),
    );
  });

  it('NUNCA manda o nome do procedimento para a fatura (dado sensível)', async () => {
    await run();

    const [checkout] = mocks.createInitialHostedCheckout.mock.calls[0]!;
    expect(checkout.description).toBe('Sinal do agendamento');
    expect(JSON.stringify(checkout)).not.toContain('psiquiátrica');
  });

  it('valida a identidade local sem transmitir PII na criação do Checkout', async () => {
    await run();

    expect(mocks.getPaymentIdentity).toHaveBeenCalledWith(CLINIC, PATIENT);
    const [checkout] = mocks.createInitialHostedCheckout.mock.calls[0]!;
    expect(checkout).not.toHaveProperty('customerId');
    expect(JSON.stringify(checkout)).not.toMatch(/Paciente Exemplo|39053344705/);
  });
});

describe('o padrão é NÃO cobrar', () => {
  it('agendamento sem paciente', async () => {
    await run({ patientId: null });
    expect(mocks.createInitialHostedCheckout).not.toHaveBeenCalled();
  });

  it('preço em dinheiro não cria Checkout Asaas', async () => {
    await run({ commercialPaymentMethod: 'cash' });

    expect(mocks.getDepositPolicy).not.toHaveBeenCalled();
    expect(mocks.createInitialHostedCheckout).not.toHaveBeenCalled();
  });

  it('política desligada', async () => {
    mocks.getDepositPolicy.mockResolvedValue({ ...POLICY_ON, enabled: false });
    await run();
    expect(mocks.getClinicAsaasClient).not.toHaveBeenCalled();
  });

  it('retorno quando a política só cobre primeira consulta', async () => {
    mocks.getDepositPolicy.mockResolvedValue({ ...POLICY_ON, appliesToReturn: false });
    mocks.listPatientAppointments.mockResolvedValue([{ id: 'outro-agendamento' }]);

    await run();

    expect(mocks.createInitialHostedCheckout).not.toHaveBeenCalled();
  });

  it('clínica sem conta Asaas conectada — e registra a métrica para o operador ver', async () => {
    mocks.getClinicAsaasClient.mockResolvedValue(null);

    await run();

    expect(mocks.createInitialHostedCheckout).not.toHaveBeenCalled();
    expect(metrics.emit).toHaveBeenCalledWith(
      'payments.deposit.skipped_no_account',
      expect.objectContaining({ clinicId: CLINIC }),
    );
  });

  it('paciente sem CPF válido (ADR-050 D6) — não cobra e não pede o dado', async () => {
    mocks.getPaymentIdentity.mockResolvedValue(null);

    await run();

    expect(mocks.createInitialHostedCheckout).not.toHaveBeenCalled();
    expect(metrics.emit).toHaveBeenCalledWith(
      'payments.deposit.skipped_no_identity',
      expect.objectContaining({ clinicId: CLINIC }),
    );
  });

  it('valor do procedimento igual a zero', async () => {
    await run({ valor: 0 });
    expect(mocks.createInitialHostedCheckout).not.toHaveBeenCalled();
  });

  it('sinal abaixo do mínimo do gateway (R$ 5,00) não vira cobrança', async () => {
    // 50% de R$ 8,00 = R$ 4,00 — o Asaas recusaria com `invalid_value`, e o
    // handler trataria como poison pill. Melhor não cobrar do que errar em loop.
    await run({ valor: 8 });

    expect(mocks.createInitialHostedCheckout).not.toHaveBeenCalled();
    expect(metrics.emit).toHaveBeenCalledWith(
      'payments.deposit.skipped_below_minimum',
      expect.objectContaining({ amount: 4 }),
    );
  });

  it('exatamente no mínimo ainda cobra', async () => {
    await run({ valor: 10 }); // 50% = R$ 5,00
    expect(mocks.createInitialHostedCheckout).toHaveBeenCalled();
  });

  it('consulta com menos de 10 minutos não cria Checkout inválido', async () => {
    mocks.resolveCheckoutWindow.mockReturnValue(null);

    await run();

    expect(mocks.getClinicAsaasClient).not.toHaveBeenCalled();
    expect(mocks.createInitialHostedCheckout).not.toHaveBeenCalled();
    expect(metrics.emit).toHaveBeenCalledWith(
      'payments.deposit.skipped_checkout_window',
      expect.objectContaining({ appointmentId: APPOINTMENT }),
    );
  });
});

describe('idempotência', () => {
  it('cobrança já existente para o agendamento não gera outra', async () => {
    mocks.findChargeByAppointment.mockResolvedValue({ id: 'charge-1', status: 'pending' });

    await run();

    expect(mocks.getClinicAsaasClient).not.toHaveBeenCalled();
    expect(mocks.createInitialHostedCheckout).not.toHaveBeenCalled();
  });

  it('corrida perdida no claim não emite métrica de cobrança criada', async () => {
    mocks.createInitialHostedCheckout.mockResolvedValue('existing');

    await run();

    expect(metrics.emit).not.toHaveBeenCalledWith('payments.deposit.created', expect.anything());
  });
});

describe('falhas do gateway', () => {
  it('recusa 4xx vira poison pill — retentar repetiria a mesma recusa', async () => {
    mocks.createInitialHostedCheckout.mockRejectedValue(
      new BillingProviderError('recusado', 'billing_provider_error', 400, ['invalid_customer']),
    );

    const error = await run().catch((e: unknown) => e);

    expect((error as Error).name).toBe('PoisonPillError');
    expect(metrics.emit).toHaveBeenCalledWith(
      'payments.deposit.failed',
      expect.objectContaining({ failureCode: 'invalid_customer' }),
    );
  });

  it('falha indeterminada sobe para o worker retentar', async () => {
    const unreachable = new BillingProviderUnreachableError('timeout');
    mocks.createInitialHostedCheckout.mockRejectedValue(unreachable);

    await expect(run()).rejects.toBe(unreachable);
  });
});

describe('resolveHoldExpiry', () => {
  const now = new Date('2026-09-01T12:00:00.000Z');

  it('segura a vaga por 24h quando a consulta está longe', () => {
    const consulta = new Date('2026-09-10T14:00:00.000Z');
    expect(resolveHoldExpiry(now, consulta)).toEqual(new Date('2026-09-02T12:00:00.000Z'));
  });

  it('nunca ultrapassa o horário da consulta', () => {
    // Consulta em 3h: segurar por 24h impediria a agenda de reaproveitar a vaga.
    const consulta = new Date('2026-09-01T15:00:00.000Z');
    expect(resolveHoldExpiry(now, consulta)).toEqual(consulta);
  });

  it('consulta no passado devolve o próprio horário (hold já vencido)', () => {
    const consulta = new Date('2026-08-30T10:00:00.000Z');
    expect(resolveHoldExpiry(now, consulta)).toEqual(consulta);
  });
});
