/**
 * Cobrança do RESTANTE (ADR-051 1.5b.3) — o caminho que decide se o paciente
 * recebe um segundo link.
 *
 * A regra que estes testes protegem acima de tudo: **o saldo vem do Financial**.
 * Se o Payments calculasse por conta própria (valor do procedimento menos o que
 * ELE recebeu), um pagamento feito em dinheiro na recepção e lançado no Caixa
 * não apareceria — e o paciente receberia link cobrando algo que já pagou.
 *
 * Como no sinal, **o padrão é NÃO COBRAR**: cada saída silenciosa aqui é uma
 * decisão de produto, e cada uma tem teste próprio.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AsaasModule from '@/lib/payments/asaas';

const mocks = vi.hoisted(() => ({
  getDepositPolicy: vi.fn(),
  findChargeByAppointment: vi.fn(),
  findPaymentCustomer: vi.fn(),
  linkPaymentCustomer: vi.fn(),
  createInitialHostedCheckout: vi.fn(),
  getClinicAsaasClient: vi.fn(),
  getPaymentIdentity: vi.fn(),
  getAppointmentBalance: vi.fn(),
  createCustomer: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/lib/payments/account-store', () => ({
  getClinicAsaasClient: mocks.getClinicAsaasClient,
}));
vi.mock('@/contexts/patient', () => ({
  patientApiV1: { getPaymentIdentity: mocks.getPaymentIdentity },
}));
vi.mock('@/contexts/financial', () => ({
  financialApiV1: { getAppointmentBalance: mocks.getAppointmentBalance },
}));
vi.mock('../queries', () => ({ getDepositPolicy: mocks.getDepositPolicy }));
vi.mock('./charge-store', () => ({
  findChargeByAppointment: mocks.findChargeByAppointment,
  findPaymentCustomer: mocks.findPaymentCustomer,
  linkPaymentCustomer: mocks.linkPaymentCustomer,
}));
vi.mock('./hosted-checkout', () => ({
  createInitialHostedCheckout: mocks.createInitialHostedCheckout,
}));
// Erros REAIS (o código usa `instanceof`); só o client é trocado.
vi.mock('@/lib/payments/asaas', async (importActual) => {
  const actual = await importActual<typeof AsaasModule>();
  return { ...actual };
});

import { metrics } from '@/lib/observability/metrics';
import { BillingProviderError, BillingProviderUnreachableError } from '@/lib/payments/asaas';
import { PoisonPillError } from '@/lib/outbox/errors';

import { createRemainderCharge } from './remainder-charge';

const CLINIC = 'clinic-1';
const APPOINTMENT = 'apt-1';
const PATIENT = 'pac-1';

const POLICY_ON = {
  enabled: true,
  percent: 50,
  cancellationWindowHours: 24,
  appliesToFirstVisit: true,
  appliesToReturn: true,
  updatedAt: null,
};

const appointment: { appointmentId: string; patientId: string | null; valor: number } = {
  appointmentId: APPOINTMENT,
  patientId: PATIENT,
  valor: 200,
};
const run = (over: Partial<typeof appointment> = {}) =>
  createRemainderCharge({ clinicId: CLINIC, appointment: { ...appointment, ...over } });

const emitted = (name: string) => vi.mocked(metrics.emit).mock.calls.filter((c) => c[0] === name);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDepositPolicy.mockResolvedValue(POLICY_ON);
  mocks.findChargeByAppointment.mockResolvedValue(null);
  mocks.getAppointmentBalance.mockResolvedValue({
    lancamentoId: 'lanc-1',
    valor: 200,
    valorPago: 100,
    saldo: 100,
  });
  mocks.getClinicAsaasClient.mockResolvedValue({
    createCustomer: mocks.createCustomer,
  });
  mocks.getPaymentIdentity.mockResolvedValue({ nome: 'Maria Silva', cpf: '24971563792' });
  mocks.findPaymentCustomer.mockResolvedValue('cus_1');
  mocks.createInitialHostedCheckout.mockResolvedValue('created');
});

describe('cobra o saldo que o FINANCIAL informa', () => {
  it('cobra exatamente o saldo, não o valor do procedimento', async () => {
    await run();

    expect(mocks.createInitialHostedCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 100, kind: 'remainder', customerId: 'cus_1' }),
    );
  });

  it('a descrição é genérica — procedimento é dado sensível', async () => {
    await run();

    const arg = mocks.createInitialHostedCheckout.mock.calls[0]![0] as { description: string };
    expect(arg.description).toBe('Restante do atendimento');
    expect(arg.description).not.toMatch(/psiqui|consulta|terapia/i);
  });

  it('preserva a janela de cobrança de 7 dias na mesma dívida', async () => {
    await run();

    const arg = mocks.createInitialHostedCheckout.mock.calls[0]![0] as {
      now: Date;
      collectionExpiresAt: Date;
    };
    expect(arg.collectionExpiresAt.getTime() - arg.now.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('o padrão é NÃO cobrar', () => {
  it('agendamento sem paciente não tem a quem cobrar', async () => {
    await run({ patientId: null });

    expect(mocks.getAppointmentBalance).not.toHaveBeenCalled();
  });

  it('política desligada: a clínica não passa a cobrar por ter concluído', async () => {
    mocks.getDepositPolicy.mockResolvedValue({ ...POLICY_ON, enabled: false });

    await run();

    expect(mocks.getAppointmentBalance).not.toHaveBeenCalled();
  });

  it('já existe cobrança de restante: sai antes de qualquer chamada externa', async () => {
    mocks.findChargeByAppointment.mockResolvedValue({ id: 'c1', status: 'pending' });

    await run();

    expect(mocks.getAppointmentBalance).not.toHaveBeenCalled();
    expect(mocks.createInitialHostedCheckout).not.toHaveBeenCalled();
  });

  it('procura a cobrança pelo kind `remainder`, não pelo sinal', async () => {
    await run();

    expect(mocks.findChargeByAppointment).toHaveBeenCalledWith(CLINIC, APPOINTMENT, 'remainder');
  });

  it('sem recebível em aberto NÃO cobra — pode já estar quitado no Caixa', async () => {
    // O caso que justifica perguntar ao Financial: pagamento em dinheiro na
    // recepção quitou o lançamento, e o gateway não sabe disso.
    mocks.getAppointmentBalance.mockResolvedValue(null);

    await run();

    expect(mocks.createInitialHostedCheckout).not.toHaveBeenCalled();
    expect(emitted('payments.remainder.skipped_no_balance')).toHaveLength(1);
  });

  it.each([0, -50])('saldo %s não gera cobrança', async (saldo) => {
    mocks.getAppointmentBalance.mockResolvedValue({
      lancamentoId: 'lanc-1',
      valor: 200,
      valorPago: 200,
      saldo,
    });

    await run();

    expect(mocks.createInitialHostedCheckout).not.toHaveBeenCalled();
  });

  it('saldo abaixo do mínimo do gateway vira métrica, não poison pill', async () => {
    // R$ 3,00 seria recusado pelo Asaas e viraria erro a cada varredura.
    mocks.getAppointmentBalance.mockResolvedValue({
      lancamentoId: 'lanc-1',
      valor: 200,
      valorPago: 197,
      saldo: 3,
    });

    await run();

    expect(mocks.createInitialHostedCheckout).not.toHaveBeenCalled();
    expect(emitted('payments.remainder.skipped_below_minimum')).toHaveLength(1);
  });

  it('clínica sem conta Asaas conectada', async () => {
    mocks.getClinicAsaasClient.mockResolvedValue(null);

    await run();

    expect(emitted('payments.remainder.skipped_no_account')).toHaveLength(1);
  });

  it('paciente sem CPF válido não é cobrado (ADR-050 D6)', async () => {
    mocks.getPaymentIdentity.mockResolvedValue(null);

    await run();

    expect(mocks.createInitialHostedCheckout).not.toHaveBeenCalled();
    expect(emitted('payments.remainder.skipped_no_identity')).toHaveLength(1);
  });
});

describe('falhas do gateway', () => {
  it('4xx é poison pill: retentar repete a recusa', async () => {
    mocks.createInitialHostedCheckout.mockRejectedValue(
      new BillingProviderError('recusou', 'x', 400),
    );

    await expect(run()).rejects.toBeInstanceOf(PoisonPillError);
  });

  it('indeterminado sobe para o worker retentar', async () => {
    mocks.createInitialHostedCheckout.mockRejectedValue(
      new BillingProviderUnreachableError('timeout'),
    );

    await expect(run()).rejects.toBeInstanceOf(BillingProviderUnreachableError);
  });

  it('corrida perdida no claim não emite métrica de criação', async () => {
    mocks.createInitialHostedCheckout.mockResolvedValue('existing');

    await run();

    expect(emitted('payments.remainder.created')).toHaveLength(0);
  });
});

describe('customer', () => {
  it('reusa o customer já mapeado, sem criar outro no Asaas', async () => {
    await run();

    expect(mocks.createCustomer).not.toHaveBeenCalled();
  });

  it('cria o customer quando o paciente ainda não tem (sinal nunca cobrado)', async () => {
    mocks.findPaymentCustomer.mockResolvedValue(null);
    mocks.createCustomer.mockResolvedValue({ customerId: 'cus_novo' });
    mocks.linkPaymentCustomer.mockResolvedValue('cus_novo');

    await run();

    // Só nome e CPF viajam (ADR-050 D2).
    expect(mocks.createCustomer).toHaveBeenCalledWith({
      name: 'Maria Silva',
      cpfCnpj: '24971563792',
    });
  });
});
