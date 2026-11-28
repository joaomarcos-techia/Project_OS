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
  getDepositPolicy: vi.fn(),
  previewDepositForBooking: vi.fn(),
  proposePendingAction: vi.fn(),
  getSchedulingInsuranceOptions: vi.fn(),
  listPatientCardsForScheduling: vi.fn(),
  schedulingTermsForProcedure: vi.fn(),
  checkSchedulingChoice: vi.fn(),
}));

vi.mock('@/contexts/scheduling', () => ({
  schedulingApiV1: { listProcedures: mocks.listProcedures, listSlots: mocks.listSlots },
}));
vi.mock('@/contexts/payments', () => ({
  getDepositPolicy: mocks.getDepositPolicy,
  paymentsApiV1: { previewDepositForBooking: mocks.previewDepositForBooking },
}));
// P11 — funções puras reais do Convênios; só as consultas ao banco são trocadas.
vi.mock('@/contexts/health-insurance', async () => ({
  ...(await vi.importActual<object>('@/contexts/health-insurance/agent-insurance')),
  getSchedulingInsuranceOptions: mocks.getSchedulingInsuranceOptions,
  listPatientCardsForScheduling: mocks.listPatientCardsForScheduling,
  schedulingTermsForProcedure: mocks.schedulingTermsForProcedure,
  checkSchedulingChoice: mocks.checkSchedulingChoice,
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
const APPOINTMENT_ACTION_ID = '88888888-8888-8888-8888-888888888888';
const INSURER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_INSURER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLAN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MEMBERSHIP_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

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
  mocks.getDepositPolicy.mockResolvedValue({ enabled: false });
  mocks.previewDepositForBooking.mockResolvedValue(null);
  mocks.proposePendingAction.mockImplementation(async (_tx, args: { summary: string }) => ({
    id: APPOINTMENT_ACTION_ID,
    action: 'schedule_appointment',
    summary: args.summary,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  }));
  mocks.getSchedulingInsuranceOptions.mockResolvedValue({
    enabled: true,
    insurers: [
      {
        id: INSURER_ID,
        name: 'Unimed Sintética',
        plans: [{ id: PLAN_ID, name: 'Enfermaria' }],
      },
      { id: OTHER_INSURER_ID, name: 'Saúde Bem', plans: [] },
    ],
  });
  mocks.listPatientCardsForScheduling.mockResolvedValue([]);
  mocks.schedulingTermsForProcedure.mockResolvedValue({
    guideType: 'consulta',
    requiresAuthorization: false,
  });
  mocks.checkSchedulingChoice.mockResolvedValue(null);
});

describe('prepare_appointment com preço único', () => {
  it('prepara agendamento sem pedir a forma de pagamento', async () => {
    const response = await getTool('prepare_appointment')!.handler({}, registeredPatientContext);
    expect(response).toMatchObject({ status: 'appointment_prepared' });
    expect(mocks.proposePendingAction).toHaveBeenCalledWith(
      registeredPatientContext.tx,
      expect.objectContaining({
        payload: expect.not.objectContaining({ commercialPrice: expect.anything() }),
      }),
    );
    expect(mocks.previewDepositForBooking).toHaveBeenCalledWith(
      expect.objectContaining({ basePrice: 250 }),
    );
  });

  it('mantém o sinal calculado a partir do preço padrão', async () => {
    mocks.previewDepositForBooking.mockResolvedValue({ amount: 125 });
    const response = await getTool('prepare_appointment')!.handler({}, registeredPatientContext);
    expect(response).toMatchObject({ status: 'appointment_prepared' });
    expect(mocks.proposePendingAction).toHaveBeenCalledWith(
      registeredPatientContext.tx,
      expect.objectContaining({
        payload: expect.objectContaining({ depositAmount: 125 }),
      }),
    );
  });
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

/** O paciente escreveu a operadora no turno (a regra da P11: a que só o modelo propõe não vale). */
const insuranceContext: ToolContext = {
  ...registeredPatientContext,
  currentMessage: 'quero marcar uma consulta pela Unimed Sintética',
};

describe('P11 — prepare_appointment pelo convênio', () => {
  const prepare = (input: Record<string, unknown>, ctx: ToolContext = insuranceContext) =>
    getTool('prepare_appointment')!.handler(input as never, ctx);

  it('jornada 2: operadora ativa → prepara convênio sem sinal, com o aviso da carteirinha e sem pedir o número', async () => {
    const response = await prepare({ insurer_name: 'Unimed Sintética' });
    expect(response).toMatchObject({ status: 'appointment_prepared' });
    expect(mocks.previewDepositForBooking).not.toHaveBeenCalled();
    expect(mocks.checkSchedulingChoice).toHaveBeenCalledWith(
      registeredPatientContext.clinicId,
      registeredPatientContext.patientId,
      { insurerId: INSURER_ID, planId: PLAN_ID, membershipId: null, guideType: 'consulta' },
    );
    const args = mocks.proposePendingAction.mock.calls[0]![1] as {
      payload: Record<string, unknown>;
      summary: string;
    };
    expect(args.payload).toMatchObject({
      type: 'schedule_appointment',
      insurance: {
        insurerId: INSURER_ID,
        planId: PLAN_ID,
        membershipId: null,
        guideType: 'consulta',
      },
    });
    expect(args.payload).not.toHaveProperty('depositAmount');
    expect(args.payload.insuranceSource).toEqual({
      insurer: 'patient_text',
      plan: 'single_active',
    });
    expect(args.summary).toContain('pelo convênio Unimed Sintética (plano Enfermaria)');
    expect(args.summary).toContain('A recepção da clínica vai conferir a sua carteirinha');
    expect(args.summary).not.toMatch(/R\$|sinal|link|número/i);
  });

  it('usa a carteirinha que a recepção já cadastrou (só o id) e o plano dela', async () => {
    mocks.getSchedulingInsuranceOptions.mockResolvedValue({
      enabled: true,
      insurers: [
        {
          id: INSURER_ID,
          name: 'Unimed Sintética',
          plans: [
            { id: PLAN_ID, name: 'Enfermaria' },
            { id: OTHER_INSURER_ID, name: 'Apartamento' },
          ],
        },
      ],
    });
    mocks.listPatientCardsForScheduling.mockResolvedValue([
      {
        id: MEMBERSHIP_ID,
        insurerId: INSURER_ID,
        planId: PLAN_ID,
        last4: '1234',
        validUntil: null,
        preferred: true,
      },
    ]);
    await prepare({ insurer_name: 'unimed sintetica' });
    expect(mocks.listPatientCardsForScheduling).toHaveBeenCalledWith(
      registeredPatientContext.clinicId,
      registeredPatientContext.patientId,
    );
    const args = mocks.proposePendingAction.mock.calls[0]![1] as {
      payload: { insurance: unknown };
      summary: string;
    };
    expect(args.payload.insurance).toEqual({
      insurerId: INSURER_ID,
      planId: PLAN_ID,
      membershipId: MEMBERSHIP_ID,
      guideType: 'consulta',
    });
    expect((args.payload as { insuranceSource?: unknown }).insuranceSource).toEqual({
      insurer: 'patient_text',
      plan: 'card',
    });
    expect(args.summary).not.toContain('1234');
  });

  it('jornada 5: contrato exige autorização → avisa o aval da operadora sem afirmar autorização', async () => {
    mocks.schedulingTermsForProcedure.mockResolvedValue({
      guideType: 'sp_sadt',
      requiresAuthorization: true,
    });
    await prepare({ insurer_name: 'Unimed Sintética' });
    const args = mocks.proposePendingAction.mock.calls[0]![1] as {
      payload: { insurance: { guideType: string } };
      summary: string;
    };
    expect(args.payload.insurance.guideType).toBe('sp_sadt');
    expect(args.summary).toContain('precisa do aval da operadora');
    expect(args.summary).not.toMatch(/está autorizad|foi autorizad/i);
  });

  it('jornada 3: operadora inativa (recusa da agenda) → nada preparado; o motivo técnico não vai ao paciente', async () => {
    mocks.checkSchedulingChoice.mockResolvedValue(
      'A operadora não está ativa no cadastro da clínica.',
    );
    const response = await prepare({ insurer_name: 'Unimed Sintética' });
    expect(response).toEqual({
      status: 'appointment_unavailable',
      patient_message: expect.stringContaining('não está entre os que a clínica agenda por aqui'),
    });
    expect(JSON.stringify(response)).not.toContain('cadastro da clínica');
    expect(mocks.listSlots).not.toHaveBeenCalled();
    expect(mocks.proposePendingAction).not.toHaveBeenCalled();
  });

  it('operadora inexistente (ou de outra clínica): mostra só as ativas desta clínica e não prepara', async () => {
    const response = await prepare({ insurer_name: 'Amil' });
    expect(response).toEqual({
      status: 'appointment_information_required',
      patient_message: expect.stringContaining('Unimed Sintética, Saúde Bem'),
    });
    expect(mocks.checkSchedulingChoice).not.toHaveBeenCalled();
    expect(mocks.proposePendingAction).not.toHaveBeenCalled();
  });

  it('nome ambíguo: pergunta de novo, sem escolher por conta própria', async () => {
    mocks.getSchedulingInsuranceOptions.mockResolvedValue({
      enabled: true,
      insurers: [
        { id: INSURER_ID, name: 'Vida', plans: [] },
        { id: OTHER_INSURER_ID, name: 'Vida', plans: [] },
      ],
    });
    const response = await prepare({ insurer_name: 'Vida' });
    expect(response).toMatchObject({ status: 'appointment_information_required' });
    expect((response as { patient_message: string }).patient_message).toMatch(
      /mais de um convênio/,
    );
    expect(mocks.proposePendingAction).not.toHaveBeenCalled();
  });

  it('plano dito que não é da operadora: pergunta de novo, sem chutar', async () => {
    const response = await prepare({ insurer_name: 'Unimed Sintética', plan_name: 'Ouro Master' });
    expect(response).toEqual({
      status: 'appointment_information_required',
      patient_message: expect.stringContaining('Enfermaria'),
    });
    expect(mocks.proposePendingAction).not.toHaveBeenCalled();
  });

  it('módulo desligado: "é com a recepção" (sem recusar convênio) e nada preparado', async () => {
    mocks.getSchedulingInsuranceOptions.mockResolvedValue({ enabled: false, insurers: [] });
    const response = await prepare({ insurer_name: 'Unimed Sintética' });
    expect(response).toEqual({
      status: 'appointment_unavailable',
      patient_message: expect.stringContaining('feito pela recepção'),
    });
    expect(mocks.proposePendingAction).not.toHaveBeenCalled();
  });

  it('indisponibilidade do Convênios: fail-closed, nada preparado nem afirmado', async () => {
    mocks.getSchedulingInsuranceOptions.mockRejectedValue(new Error('timeout'));
    const response = await prepare({ insurer_name: 'Unimed Sintética' });
    expect(response).toEqual({
      status: 'appointment_unavailable',
      patient_message: expect.stringContaining('Não consegui consultar os convênios'),
    });
    expect(mocks.proposePendingAction).not.toHaveBeenCalled();
  });

  it('contato sem cadastro: convênio exige o cadastro antes, mesmo com marcação anônima permitida', async () => {
    mocks.getDepositPolicy.mockResolvedValue({ enabled: false });
    const response = await prepare(
      { insurer_name: 'Unimed Sintética' },
      { ...unregisteredPatientContext, canScheduleAnonymous: true },
    );
    expect(response).toEqual({
      status: 'patient_registration_required',
      required_fields: ['nome', 'cpf', 'motivo'],
    });
    expect(mocks.getSchedulingInsuranceOptions).not.toHaveBeenCalled();
  });

  it('sem insurer_name e sem as falas do turno (chamada direta): o particular não muda, nenhuma consulta ao Convênios', async () => {
    await prepare({});
    expect(mocks.getSchedulingInsuranceOptions).not.toHaveBeenCalled();
    expect(mocks.previewDepositForBooking).toHaveBeenCalled();
  });
});

describe('P11 (endurecimento) — a operadora precisa ter sido dita pelo paciente', () => {
  const prepare = (input: Record<string, unknown>, ctx: ToolContext) =>
    getTool('prepare_appointment')!.handler(input as never, ctx);
  const summaryOf = () =>
    (mocks.proposePendingAction.mock.calls[0]![1] as { summary: string }).summary;
  const payloadOf = () =>
    (mocks.proposePendingAction.mock.calls[0]![1] as { payload: Record<string, unknown> }).payload;
  const twoPlans = () =>
    mocks.getSchedulingInsuranceOptions.mockResolvedValue({
      enabled: true,
      insurers: [
        {
          id: INSURER_ID,
          name: 'Unimed Sintética',
          plans: [
            { id: PLAN_ID, name: 'Enfermaria' },
            { id: MEMBERSHIP_ID, name: 'Apartamento' },
          ],
        },
        { id: OTHER_INSURER_ID, name: 'Saúde Bem', plans: [] },
      ],
    });

  it('operadora que só o modelo propôs (o paciente não falou de convênio): pergunta convênio ou particular, nada preparado', async () => {
    const response = await prepare({ insurer_name: 'Unimed Sintética' }, registeredPatientContext);
    expect(response).toEqual({
      status: 'appointment_information_required',
      patient_message:
        'Você quer agendar pelo convênio ou como particular? Se for pelo convênio, me diga o nome dele, por favor.',
    });
    expect(mocks.checkSchedulingChoice).not.toHaveBeenCalled();
    expect(mocks.proposePendingAction).not.toHaveBeenCalled();
  });

  it('indução: o paciente diz "qualquer convênio serve", o modelo escolhe um: nada preparado', async () => {
    const response = await prepare(
      { insurer_name: 'Saúde Bem' },
      { ...registeredPatientContext, currentMessage: 'pode marcar pelo convênio que você quiser' },
    );
    expect(response).toMatchObject({ status: 'appointment_information_required' });
    expect(mocks.proposePendingAction).not.toHaveBeenCalled();
  });

  it('operadora dita numa fala anterior vale (a de agora só traz a data)', async () => {
    const response = await prepare(
      { insurer_name: 'Unimed Sintética' },
      {
        ...registeredPatientContext,
        recentPatientTexts: ['oi, tenho Unimed Sintética', 'é uma consulta'],
        currentMessage: 'pode marcar, por favor',
      },
    );
    expect(response).toMatchObject({ status: 'appointment_prepared' });
    expect(payloadOf().insuranceSource).toEqual({ insurer: 'patient_text', plan: 'single_active' });
  });

  it('"particular" depois da operadora: o modelo insistir no convênio não prepara', async () => {
    const response = await prepare(
      { insurer_name: 'Unimed Sintética' },
      {
        ...registeredPatientContext,
        recentPatientTexts: ['tenho Unimed Sintética'],
        currentMessage: 'melhor fazer particular',
      },
    );
    expect(response).toMatchObject({ status: 'appointment_information_required' });
    expect(mocks.proposePendingAction).not.toHaveBeenCalled();
  });

  it('operadora e "particular" na mesma frase: pergunta, com o nome que o paciente disse', async () => {
    const response = await prepare(
      { insurer_name: 'Unimed Sintética' },
      {
        ...registeredPatientContext,
        currentMessage: 'não quero particular, é pela Unimed Sintética',
      },
    );
    expect(response).toEqual({
      status: 'appointment_information_required',
      patient_message: 'Você quer agendar pelo convênio Unimed Sintética ou como particular?',
    });
  });

  it('nomes parecidos: "Unimed Sintética Plus" casa só com ela; a operadora mais curta não', async () => {
    mocks.getSchedulingInsuranceOptions.mockResolvedValue({
      enabled: true,
      insurers: [
        { id: INSURER_ID, name: 'Unimed Sintética', plans: [] },
        { id: OTHER_INSURER_ID, name: 'Unimed Sintética Plus', plans: [] },
      ],
    });
    const ctx = { ...registeredPatientContext, currentMessage: 'pela Unimed Sintética Plus' };
    await expect(prepare({ insurer_name: 'Unimed Sintética Plus' }, ctx)).resolves.toMatchObject({
      status: 'appointment_prepared',
    });
    expect((payloadOf().insurance as { insurerId: string }).insurerId).toBe(OTHER_INSURER_ID);
    mocks.proposePendingAction.mockClear();
    await expect(prepare({ insurer_name: 'Unimed Sintética' }, ctx)).resolves.toMatchObject({
      status: 'appointment_information_required',
    });
    expect(mocks.proposePendingAction).not.toHaveBeenCalled();
  });

  it('plano que só o modelo propôs não vale: sem plano único nem carteirinha, fica para a recepção', async () => {
    twoPlans();
    await prepare(
      { insurer_name: 'Unimed Sintética', plan_name: 'Apartamento' },
      { ...registeredPatientContext, currentMessage: 'pela Unimed Sintética' },
    );
    expect(payloadOf().insurance).toMatchObject({ planId: null });
    expect(payloadOf().insuranceSource).toEqual({ insurer: 'patient_text', plan: 'none' });
    expect(summaryOf()).not.toContain('Apartamento');
  });

  it('plano dito pelo paciente vale', async () => {
    twoPlans();
    await prepare(
      { insurer_name: 'Unimed Sintética', plan_name: 'Apartamento' },
      { ...registeredPatientContext, currentMessage: 'pela Unimed Sintética, plano Apartamento' },
    );
    expect(payloadOf().insurance).toMatchObject({ planId: MEMBERSHIP_ID });
    expect(payloadOf().insuranceSource).toEqual({ insurer: 'patient_text', plan: 'patient_text' });
    expect(summaryOf()).toContain('(plano Apartamento)');
  });

  it('cadastro inconsistente: a carteirinha de outra operadora não é usada', async () => {
    mocks.listPatientCardsForScheduling.mockResolvedValue([
      {
        id: MEMBERSHIP_ID,
        insurerId: OTHER_INSURER_ID,
        planId: null,
        last4: '9876',
        validUntil: null,
        preferred: true,
      },
    ]);
    await prepare({ insurer_name: 'Unimed Sintética' }, insuranceContext);
    expect(payloadOf().insurance).toMatchObject({ insurerId: INSURER_ID, membershipId: null });
    expect(summaryOf()).not.toContain('9876');
  });
});

describe('P11 (endurecimento) — o inverso: o paciente disse o convênio e o modelo preparou particular', () => {
  const prepare = (ctx: ToolContext) => getTool('prepare_appointment')!.handler({} as never, ctx);
  const summaryOf = () =>
    (mocks.proposePendingAction.mock.calls[0]![1] as { summary: string }).summary;

  it('operadora ativa citada e sem "particular" depois: pergunta convênio ou particular, sem sinal nem resumo', async () => {
    const response = await prepare({
      ...registeredPatientContext,
      recentPatientTexts: ['quero marcar pela Unimed Sintética'],
      currentMessage: 'pode marcar, por favor',
    });
    expect(response).toEqual({
      status: 'appointment_information_required',
      patient_message: 'Você quer agendar pelo convênio Unimed Sintética ou como particular?',
    });
    expect(mocks.previewDepositForBooking).not.toHaveBeenCalled();
    expect(mocks.proposePendingAction).not.toHaveBeenCalled();
  });

  it('"particular" depois da operadora: prepara particular, com o sinal como antes e o resumo dizendo "como particular"', async () => {
    const response = await prepare({
      ...registeredPatientContext,
      recentPatientTexts: ['tenho Unimed Sintética', 'vou fazer particular'],
      currentMessage: 'pode marcar, por favor',
    });
    expect(response).toMatchObject({ status: 'appointment_prepared' });
    expect(mocks.previewDepositForBooking).toHaveBeenCalled();
    expect(summaryOf()).toContain('como particular');
  });

  it('paciente que nunca citou convênio: particular normal, com "como particular" no resumo', async () => {
    await prepare({
      ...registeredPatientContext,
      recentPatientTexts: ['oi', 'quero uma consulta'],
      currentMessage: 'pode marcar, por favor',
    });
    expect(summaryOf()).toContain('como particular');
    expect(summaryOf()).not.toMatch(/convênio/);
  });

  it('módulo desligado: o resumo do particular fica exatamente como antes', async () => {
    mocks.getSchedulingInsuranceOptions.mockResolvedValue({ enabled: false, insurers: [] });
    await prepare({
      ...registeredPatientContext,
      recentPatientTexts: ['tenho Unimed Sintética'],
      currentMessage: 'pode marcar, por favor',
    });
    expect(summaryOf()).not.toContain('particular');
  });

  it('falha ao consultar o Convênios: o particular segue como antes (a guarda não derruba o fluxo)', async () => {
    mocks.getSchedulingInsuranceOptions.mockRejectedValue(new Error('timeout'));
    const response = await prepare({
      ...registeredPatientContext,
      recentPatientTexts: ['tenho Unimed Sintética'],
      currentMessage: 'pode marcar, por favor',
    });
    expect(response).toMatchObject({ status: 'appointment_prepared' });
    expect(summaryOf()).not.toContain('particular');
  });
});
