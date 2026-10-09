/**
 * Matching tolerante de procedimento (prepare_appointment) — cobre o bug real
 * do teste ao vivo: paciente diz "cardiologia", procedimento é "Consulta
 * Cardiológica"; substring simples não casava e o agendamento falhava.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/lib/db';
import type * as PendingActionModule from '../internal/pending-action';

import { __testing__ } from './prepare-appointment';
import { getTool, type ToolContext } from './registry';

const mocks = vi.hoisted(() => ({
  listProcedures: vi.fn(),
  listSlots: vi.fn(),
  getPaymentPricingPolicy: vi.fn(),
  listProcedurePaymentPrices: vi.fn(),
  resolveConfiguredProcedurePaymentPrice: vi.fn(),
  getDepositPolicy: vi.fn(),
  previewDepositForBooking: vi.fn(),
  proposePendingAction: vi.fn(),
}));

vi.mock('@/contexts/scheduling', () => ({
  schedulingApiV1: { listProcedures: mocks.listProcedures, listSlots: mocks.listSlots },
}));
vi.mock('@/contexts/payments', () => ({
  getDepositPolicy: mocks.getDepositPolicy,
  getPaymentPricingPolicy: mocks.getPaymentPricingPolicy,
  listProcedurePaymentPrices: mocks.listProcedurePaymentPrices,
  resolveConfiguredProcedurePaymentPrice: mocks.resolveConfiguredProcedurePaymentPrice,
  paymentsApiV1: { previewDepositForBooking: mocks.previewDepositForBooking },
}));
vi.mock('../internal/pending-action', async (importOriginal) => ({
  ...(await importOriginal<typeof PendingActionModule>()),
  proposePendingAction: mocks.proposePendingAction,
}));

const { matchesProcedure } = __testing__;
const cardio = { descricao: 'Consulta Cardiológica', categoria: 'consulta' };
const dermato = { descricao: 'Consulta Dermatológica', categoria: 'consulta' };
const PROCEDURE_ID = '55555555-5555-5555-5555-555555555555';
const DOCTOR_ID = '66666666-6666-6666-6666-666666666666';
const PRICE_ID = '77777777-7777-7777-7777-777777777777';
const APPOINTMENT_ACTION_ID = '88888888-8888-8888-8888-888888888888';

const unregisteredPatientContext: ToolContext = {
  tx: {} as Tx,
  clinicId: '11111111-1111-1111-1111-111111111111',
  conversationId: '22222222-2222-2222-2222-222222222222',
  eventId: '33333333-3333-3333-3333-333333333333',
  aiRequestId: '44444444-4444-4444-4444-444444444444',
  patientId: null,
  patientNome: null,
  identityAmbiguous: false,
  verifiedPhone: '+5511999990000',
  currentMessage: 'Quero marcar uma consulta',
  canScheduleAnonymous: false,
  maxDaysAhead: 30,
  clinicTimeZone: 'America/Sao_Paulo',
  pendingAppointmentProcedureName: null,
  canDisclosePayments: false,
};

const registeredPatientContext: ToolContext = {
  ...unregisteredPatientContext,
  patientId: '99999999-9999-9999-9999-999999999999',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listProcedures.mockResolvedValue([
    {
      id: PROCEDURE_ID,
      descricao: 'Consulta Cardiológica',
      categoria: 'consulta',
      valorPadrao: 250,
    },
  ]);
  mocks.listSlots.mockImplementation(async () => [
    { startAt: new Date(Date.now() + 86_400_000).toISOString(), doctorId: DOCTOR_ID },
  ]);
  mocks.getPaymentPricingPolicy.mockResolvedValue({ mode: 'payment_method_pricing' });
  mocks.getDepositPolicy.mockResolvedValue({ enabled: false });
  mocks.previewDepositForBooking.mockResolvedValue(null);
  mocks.listProcedurePaymentPrices.mockResolvedValue([
    {
      id: PRICE_ID,
      procedureId: PROCEDURE_ID,
      paymentMethod: 'pix',
      installmentCount: null,
      grossAmount: 180,
    },
    {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      procedureId: PROCEDURE_ID,
      paymentMethod: 'credit_card',
      installmentCount: 1,
      grossAmount: 200,
    },
  ]);
  mocks.resolveConfiguredProcedurePaymentPrice.mockResolvedValue({
    mode: 'payment_method_pricing',
    paymentMethod: 'pix',
    installmentCount: null,
    priceId: PRICE_ID,
    grossAmount: 180,
    source: 'explicit_method_price',
  });
  mocks.proposePendingAction.mockImplementation(async (_tx, args: { summary: string }) => ({
    id: APPOINTMENT_ACTION_ID,
    action: 'schedule_appointment',
    summary: args.summary,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  }));
});

describe('matchesProcedure (tolerante a especialidade vs nome)', () => {
  it('casa especialidade com o nome do procedimento (cardiologia ↔ Cardiológica)', () => {
    expect(matchesProcedure('cardiologia', cardio)).toBe(true);
    expect(matchesProcedure('dermatologia', dermato)).toBe(true);
  });

  it('casa por nome parcial e por categoria', () => {
    expect(matchesProcedure('cardio', cardio)).toBe(true);
    expect(matchesProcedure('consulta', cardio)).toBe(true);
    expect(matchesProcedure('Consulta Cardiológica', cardio)).toBe(true);
  });

  it('NÃO casa especialidade de outro procedimento', () => {
    expect(matchesProcedure('cardiologia', dermato)).toBe(false);
    expect(matchesProcedure('ortopedia', cardio)).toBe(false);
  });
});

describe('nome exato do procedimento vence o matching tolerante', () => {
  it('compara sem caixa, acento nem espaço extra', () => {
    expect(__testing__.isSameProcedureName('  consulta ', { descricao: 'Consulta' })).toBe(true);
    expect(
      __testing__.isSameProcedureName('Consulta [demo]', { descricao: 'Consulta [demo]' }),
    ).toBe(true);
    expect(__testing__.isSameProcedureName('Consulta', { descricao: 'Consulta [demo]' })).toBe(
      false,
    );
  });

  it('com "Consulta" e "Consulta [demo]", pedir "Consulta" escolhe a primeira em vez de travar', async () => {
    // Caso do DEV em 08/10/2026: o tolerante casava os dois e o paciente recebia
    // "Encontrei mais de um atendimento parecido" para sempre.
    mocks.listProcedures.mockResolvedValue([
      { id: PROCEDURE_ID, descricao: 'Consulta', categoria: null, valorPadrao: 150 },
      {
        id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        descricao: 'Consulta [demo]',
        categoria: null,
        valorPadrao: 380,
      },
    ]);
    mocks.getPaymentPricingPolicy.mockResolvedValue({ mode: 'absorb_fees' });

    const response = await getTool('prepare_appointment')!.handler(
      { procedure_name: 'Consulta' },
      registeredPatientContext,
    );

    expect(response.patient_message ?? '').not.toContain('mais de um atendimento');
    expect(mocks.listSlots).toHaveBeenCalledWith(
      expect.objectContaining({ procedureId: PROCEDURE_ID }),
    );
  });
});

describe('horário relativo no fuso da clínica', () => {
  // A resolução em si mora em internal/relative-datetime.test.ts (55 casos).
  // Aqui fica só o que esta tool ainda faz: apresentar o horário ao paciente.
  it('mostra o horário preparado no fuso da clínica', () => {
    expect(
      __testing__.appointmentTimeForPatient('2026-08-14T12:00:00.000Z', 'America/Sao_Paulo'),
    ).toBe('14/08/2026 às 09:00');
  });
});

describe('prepare_appointment para contato sem cadastro', () => {
  it('orienta o cadastro em vez de falhar e disparar o fallback operacional', async () => {
    const tool = getTool('prepare_appointment');
    expect(tool).toBeDefined();

    const response = await tool!.handler({}, unregisteredPatientContext);

    expect(response).toEqual({
      status: 'patient_registration_required',
      required_fields: ['nome', 'cpf', 'motivo'],
    });
  });
});

describe('com o sinal ligado exige o cadastro (decisão de 08/10/2026)', () => {
  const anonymousAllowedContext: ToolContext = {
    ...unregisteredPatientContext,
    canScheduleAnonymous: true,
    currentMessage: 'Quero marcar uma consulta amanhã, pago no pix',
  };

  it('contato sem cadastro e sinal ligado: pede o cadastro mesmo com agendamento anônimo permitido', async () => {
    // Antes: a marcação anônima era preparada e o sinal nunca era cobrado, porque
    // createDepositCharge sai sem paciente.
    mocks.getDepositPolicy.mockResolvedValue({ enabled: true });

    const response = await getTool('prepare_appointment')!.handler({}, anonymousAllowedContext);

    expect(response).toEqual({
      status: 'patient_registration_required',
      required_fields: ['nome', 'cpf', 'motivo'],
    });
    expect(mocks.getDepositPolicy).toHaveBeenCalledWith(anonymousAllowedContext.clinicId);
    expect(mocks.listSlots).not.toHaveBeenCalled();
    expect(mocks.proposePendingAction).not.toHaveBeenCalled();
  });

  it('contato sem cadastro e sinal desligado: segue a opção da clínica e prepara sem paciente', async () => {
    mocks.getDepositPolicy.mockResolvedValue({ enabled: false });

    const response = await getTool('prepare_appointment')!.handler({}, anonymousAllowedContext);

    expect(response).toMatchObject({ status: 'appointment_prepared' });
    expect(mocks.proposePendingAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({ type: 'schedule_appointment', patientId: null }),
      }),
    );
  });

  it('paciente identificado não depende da política de sinal para agendar', async () => {
    mocks.getDepositPolicy.mockResolvedValue({ enabled: true });

    const response = await getTool('prepare_appointment')!.handler(
      {},
      { ...registeredPatientContext, currentMessage: 'Quero marcar amanhã, pago no pix' },
    );

    expect(response).toMatchObject({ status: 'appointment_prepared' });
    expect(mocks.getDepositPolicy).not.toHaveBeenCalled();
  });

  it('telefone compartilhado continua bloqueado, com ou sem sinal', async () => {
    mocks.getDepositPolicy.mockResolvedValue({ enabled: false });

    await expect(
      getTool('prepare_appointment')!.handler(
        {},
        { ...anonymousAllowedContext, identityAmbiguous: true },
      ),
    ).rejects.toThrow('mais de um paciente');
    expect(mocks.proposePendingAction).not.toHaveBeenCalled();
  });
});

describe('prepare_appointment com preço por meio de pagamento', () => {
  it('pede escolha do paciente e mostra apenas opções com link disponível', async () => {
    const response = await getTool('prepare_appointment')!.handler({}, registeredPatientContext);
    expect(response).toMatchObject({ status: 'appointment_information_required' });
    expect(response.patient_message).toContain('Pix: R$ 180,00');
    expect(response.patient_message).toContain('cartão de crédito em 1x: R$ 200,00');
    expect(mocks.listSlots).not.toHaveBeenCalled();
    expect(mocks.proposePendingAction).not.toHaveBeenCalled();
  });

  it('não oferece cartão quando só há preço Pix configurado', async () => {
    mocks.listProcedurePaymentPrices.mockResolvedValue([
      { procedureId: PROCEDURE_ID, paymentMethod: 'pix', installmentCount: null, grossAmount: 180 },
    ]);
    const response = await getTool('prepare_appointment')!.handler({}, registeredPatientContext);
    expect(response.patient_message).toContain('Pix: R$ 180,00');
    expect(response.patient_message).not.toContain('cartão');
  });

  it('salva preço Pix consultado no servidor e o apresenta no resumo', async () => {
    const response = await getTool('prepare_appointment')!.handler(
      { payment_method: 'pix' },
      { ...registeredPatientContext, currentMessage: 'Quero pagar no Pix' },
    );
    expect(response).toMatchObject({ status: 'appointment_prepared' });
    expect(response.summary).toContain('valor total R$ 180,00 via Pix');
    expect(mocks.resolveConfiguredProcedurePaymentPrice).toHaveBeenCalledWith({
      clinicId: registeredPatientContext.clinicId,
      procedureId: PROCEDURE_ID,
      standardGrossAmount: 250,
      paymentMethod: 'pix',
      installmentCount: null,
    });
    expect(mocks.proposePendingAction).toHaveBeenCalledWith(
      registeredPatientContext.tx,
      expect.objectContaining({
        payload: expect.objectContaining({
          commercialPrice: {
            paymentMethod: 'pix',
            installmentCount: null,
            priceId: PRICE_ID,
            grossAmount: 180,
          },
        }),
      }),
    );
  });

  it('pede parcelas para cartão, sem assumir pagamento em 1x', async () => {
    const response = await getTool('prepare_appointment')!.handler(
      { payment_method: 'credit_card' },
      { ...registeredPatientContext, currentMessage: 'Quero pagar no cartão' },
    );
    expect(response.patient_message).toContain('responda "cartão em 1x"');
    expect(mocks.proposePendingAction).not.toHaveBeenCalled();
  });

  it('prepara cartão em 1x com o preço configurado', async () => {
    mocks.resolveConfiguredProcedurePaymentPrice.mockResolvedValue({
      mode: 'payment_method_pricing',
      paymentMethod: 'credit_card',
      installmentCount: 1,
      priceId: PRICE_ID,
      grossAmount: 200,
      source: 'explicit_method_price',
    });
    const response = await getTool('prepare_appointment')!.handler(
      { payment_method: 'credit_card', installment_count: 1 },
      { ...registeredPatientContext, currentMessage: 'Vou pagar no cartão em 1x' },
    );
    expect(response.summary).toContain('valor total R$ 200,00 via cartão de crédito em 1x');
    expect(mocks.proposePendingAction).toHaveBeenCalledWith(
      registeredPatientContext.tx,
      expect.objectContaining({
        payload: expect.objectContaining({
          commercialPrice: expect.objectContaining({
            paymentMethod: 'credit_card',
            installmentCount: 1,
            grossAmount: 200,
          }),
        }),
      }),
    );
  });

  it('não prepara cartão parcelado nem inventa preço indisponível', async () => {
    const tool = getTool('prepare_appointment')!;
    const parcelado = await tool.handler(
      { payment_method: 'credit_card', installment_count: 3 },
      { ...registeredPatientContext, currentMessage: 'Vou pagar no cartão em 3x' },
    );
    expect(parcelado.patient_message).toContain('não consigo gerar link de cartão parcelado');
    expect(mocks.resolveConfiguredProcedurePaymentPrice).not.toHaveBeenCalled();

    mocks.resolveConfiguredProcedurePaymentPrice.mockResolvedValue(null);
    const semPreco = await tool.handler(
      { payment_method: 'pix' },
      { ...registeredPatientContext, currentMessage: 'Pix' },
    );
    expect(semPreco.patient_message).toContain('preço dessa forma de pagamento mudou');
    expect(mocks.proposePendingAction).not.toHaveBeenCalled();
  });

  it('preserva o agendamento com preço padrão quando a política explícita não está ativa', async () => {
    mocks.getPaymentPricingPolicy.mockResolvedValue({ mode: 'absorb_fees' });
    const response = await getTool('prepare_appointment')!.handler({}, registeredPatientContext);
    expect(response).toMatchObject({ status: 'appointment_prepared' });
    expect(mocks.proposePendingAction).toHaveBeenCalledWith(
      registeredPatientContext.tx,
      expect.objectContaining({
        payload: expect.not.objectContaining({ commercialPrice: expect.anything() }),
      }),
    );
  });

  it('não aceita meio nem parcelas inventados pelo modelo', async () => {
    const tool = getTool('prepare_appointment')!;
    const semEscolha = await tool.handler({ payment_method: 'pix' }, registeredPatientContext);
    expect(semEscolha.patient_message).toContain('Como prefere pagar');

    const metodoDivergente = await tool.handler(
      { payment_method: 'credit_card', installment_count: 1 },
      { ...registeredPatientContext, currentMessage: 'Vou pagar no Pix' },
    );
    expect(metodoDivergente.patient_message).toContain('não corresponde à sua mensagem');

    const parcelaInventada = await tool.handler(
      { payment_method: 'credit_card', installment_count: 1 },
      { ...registeredPatientContext, currentMessage: 'Vou pagar no cartão' },
    );
    expect(parcelaInventada.patient_message).toContain('responda "cartão em 1x"');
    expect(mocks.proposePendingAction).not.toHaveBeenCalled();
  });

  it('pede escolha quando o paciente menciona Pix e cartão na mesma mensagem', async () => {
    const response = await getTool('prepare_appointment')!.handler(
      { payment_method: 'pix' },
      { ...registeredPatientContext, currentMessage: 'Pode ser Pix ou cartão?' },
    );
    expect(response.patient_message).toContain('Você mencionou mais de uma forma de pagamento');
    expect(mocks.resolveConfiguredProcedurePaymentPrice).not.toHaveBeenCalled();
    expect(mocks.proposePendingAction).not.toHaveBeenCalled();
  });
});

describe('dinheiro e sinal (decisão do usuário, 08/10/2026)', () => {
  const CASH_PRICE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  beforeEach(() => {
    mocks.listProcedurePaymentPrices.mockResolvedValue([
      { id: PRICE_ID, procedureId: PROCEDURE_ID, paymentMethod: 'pix', installmentCount: null, grossAmount: 180 },
      { id: CASH_PRICE_ID, procedureId: PROCEDURE_ID, paymentMethod: 'cash', installmentCount: null, grossAmount: 170 },
    ]);
  });

  it('sem sinal, oferece dinheiro na clínica entre as opções', async () => {
    const response = await getTool('prepare_appointment')!.handler({}, registeredPatientContext);
    expect(response.patient_message).toContain('Pix: R$ 180,00');
    expect(response.patient_message).toContain('dinheiro na clínica: R$ 170,00');
    expect(response.patient_message).not.toContain('sinal');
  });

  it('sem sinal, prepara em dinheiro com o preço configurado e sem linha de sinal', async () => {
    mocks.resolveConfiguredProcedurePaymentPrice.mockResolvedValue({
      mode: 'payment_method_pricing',
      paymentMethod: 'cash',
      installmentCount: null,
      priceId: CASH_PRICE_ID,
      grossAmount: 170,
      source: 'explicit_method_price',
    });
    const response = await getTool('prepare_appointment')!.handler(
      { payment_method: 'cash' },
      { ...registeredPatientContext, currentMessage: 'vou pagar em dinheiro' },
    );
    expect(response).toMatchObject({ status: 'appointment_prepared' });
    expect(response.summary).toContain('valor total R$ 170,00 em dinheiro, pago na clínica');
    expect(response.summary).not.toContain('sinal');
    expect(mocks.previewDepositForBooking).toHaveBeenCalledTimes(1); // só a sonda das opções
    expect(mocks.proposePendingAction).toHaveBeenCalledWith(
      registeredPatientContext.tx,
      expect.objectContaining({
        payload: expect.objectContaining({
          commercialPrice: {
            paymentMethod: 'cash',
            installmentCount: null,
            priceId: CASH_PRICE_ID,
            grossAmount: 170,
          },
        }),
      }),
    );
    const payload = mocks.proposePendingAction.mock.calls[0]![1].payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty('depositAmount');
  });

  it('com sinal, esconde "tudo em dinheiro" e explica que o restante pode ser em dinheiro', async () => {
    mocks.previewDepositForBooking.mockResolvedValue({ amount: 90 });
    const response = await getTool('prepare_appointment')!.handler({}, registeredPatientContext);
    expect(response.patient_message).toContain('Pix: R$ 180,00');
    expect(response.patient_message).not.toContain('dinheiro na clínica: R$ 170,00');
    expect(response.patient_message).toContain(
      'O horário é confirmado com o sinal pago pelo link que enviamos por aqui; o restante pode ser pago na clínica, inclusive em dinheiro.',
    );
  });

  it('com sinal, recusa agendar em dinheiro e pede a forma do sinal', async () => {
    mocks.previewDepositForBooking.mockResolvedValue({ amount: 90 });
    const response = await getTool('prepare_appointment')!.handler(
      { payment_method: 'cash' },
      { ...registeredPatientContext, currentMessage: 'quero pagar tudo em dinheiro' },
    );
    expect(response).toMatchObject({ status: 'appointment_information_required' });
    expect(response.patient_message).toContain('Para confirmar o horário, o sinal é pago pelo link');
    expect(response.patient_message).toContain('Pix: R$ 180,00');
    expect(mocks.resolveConfiguredProcedurePaymentPrice).not.toHaveBeenCalled();
    expect(mocks.proposePendingAction).not.toHaveBeenCalled();
  });

  it('"Pix e o restante em dinheiro" escolhe o Pix e o resumo traz sinal e restante', async () => {
    mocks.previewDepositForBooking.mockResolvedValue({ amount: 90 });
    const response = await getTool('prepare_appointment')!.handler(
      { payment_method: 'pix' },
      { ...registeredPatientContext, currentMessage: 'pix, e o restante pago em dinheiro aí' },
    );
    expect(response).toMatchObject({ status: 'appointment_prepared' });
    expect(response.summary).toContain('valor total R$ 180,00 via Pix');
    expect(response.summary).toContain(
      'Para confirmar o horário, o sinal de R$ 90,00 é pago pelo link que vamos enviar por aqui (o horário fica reservado por até 24 horas). O restante, R$ 90,00, pode ser pago na clínica, inclusive em dinheiro.',
    );
    const payload = mocks.proposePendingAction.mock.calls[0]![1].payload as Record<string, unknown>;
    expect(payload.depositAmount).toBe(90);
  });
});
