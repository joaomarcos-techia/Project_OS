import { describe, expect, it } from 'vitest';

import {
  assertAgentSchedulePolicy,
  assertAgentSchedulingIdentity,
  classifyConfirmation,
  isExplicitConfirmation,
  parsePendingActionPayload,
  pendingActionIdemKey,
  type PendingActionPayload,
} from './pending-action';

describe('confirmação server-side de ações da IA', () => {
  it.each([
    'SIM',
    'confirmo',
    'Pode confirmar!',
    'autorizo',
    'sim, confirmo',
    // Linguagem natural do paciente real (antes falhava por exigir match exato):
    'SIM, confirmo o agendamento',
    'SIM, pode reagendar',
    'sim, confirmo o cancelamento',
    'pode agendar sim',
    'ok, confirmado',
  ])('aceita confirmação inequívoca: %s', (message) =>
    expect(isExplicitConfirmation(message)).toBe(true),
  );

  it.each([
    'posso confirmar?',
    'e se eu cancelar?',
    'talvez',
    'não',
    'sim, mas mude o horário',
    'quero informações',
    'não, deixa pra lá',
    'espera, ainda não',
  ])('rejeita pergunta, negação ou confirmação condicionada: %s', (message) => {
    expect(isExplicitConfirmation(message)).toBe(false);
  });

  /**
   * F-07 (auditoria 2026-08-14) — a tabela que motivou a reescrita.
   * O gate antigo bastava achar UMA palavra afirmativa em qualquer posição.
   */
  it.each([
    // Falsos POSITIVOS provados: o paciente não estava confirmando nada.
    ['ok e qual o endereço', 'pergunta disfarçada de concordância'],
    ['ok vou ver e te falo', 'o paciente está adiando'],
    ['ok obrigado', 'despedida, não consentimento'],
    ['acho que sim', 'hesitação'],
    ['sim acho', 'hesitação'],
    ['ok, mas antes me diz o preço', 'contraste'],
    ['pode ser, mas outro horario seria melhor', 'contraste'],
    ['sim, mas tenho uma dúvida', 'contraste'],
    ['talvez', 'hesitação'],
    ['tanto faz', 'indiferença não é consentimento'],
    ['qualquer um', 'indiferença não é consentimento'],
    ['de manhã', 'é uma preferência, não um SIM'],
    ['o primeiro', 'é uma seleção, não um SIM'],
    ['pera', 'pedido de espera'],
    ['nao', 'negação'],
    ['ok vou pensar', 'adiamento'],
    // Regressão pega pelo smoke contra o banco (smoke-c12 3b): pedir para
    // INICIAR a confirmação não é consentir com um resumo já apresentado.
    // Executar aqui pula a etapa que o paciente ainda vai ler.
    ['quero confirmar minha consulta', 'pedido, não consentimento'],
    ['quero esse', 'pedido, não consentimento'],
    ['gostaria de confirmar', 'pedido, não consentimento'],
    ['posso confirmar', 'pedido, não consentimento'],
    ['preciso remarcar', 'pedido, não consentimento'],
  ])('NÃO confirma %j (%s)', (message) => {
    expect(isExplicitConfirmation(message)).toBe(false);
  });

  it.each([
    // Falsos NEGATIVOS provados: é assim que o paciente brasileiro diz "sim".
    'blz',
    'beleza',
    'ss',
    's',
    'simmm',
    'ta bom',
    'fechado',
    'isso',
    'isso mesmo',
    'esse mesmo',
    'perfeito',
    'aham',
    'uhum',
    'ok',
    'pode ser',
    'pode marcar',
    'tudo certo',
    'combinado',
    'sim 👍',
    // O verbo de desejo só veta quando ABRE a mensagem: depois de um "sim"
    // explícito ele é só complemento.
    'sim, quero',
    'sim quero marcar',
  ])('confirma %j', (message) => {
    expect(isExplicitConfirmation(message)).toBe(true);
  });

  it('emoji sozinho nunca confirma', () => {
    expect(isExplicitConfirmation('👍')).toBe(false);
  });

  it('cada rejeição carrega um motivo canônico (para ajustar o léxico com dados)', () => {
    expect(classifyConfirmation('ok e qual o endereço').reason).toBe('not_affirmation_only');
    expect(classifyConfirmation('acho que sim').reason).toBe('hedge');
    expect(classifyConfirmation('ok obrigado').reason).toBe('closing');
    expect(classifyConfirmation('posso confirmar?').reason).toBe('question');
    expect(classifyConfirmation('sim').reason).toBe('strong');
    expect(classifyConfirmation('blz').reason).toBe('weak_short');
  });

  describe('verbo contraditório (o SIM pertence à ação que foi apresentada)', () => {
    it('"pode cancelar" NÃO confirma um agendamento preparado', () => {
      expect(isExplicitConfirmation('pode cancelar', 'schedule_appointment')).toBe(false);
      expect(classifyConfirmation('pode cancelar', 'schedule_appointment').reason).toBe(
        'contradicting_verb',
      );
    });

    it('"pode cancelar" confirma um CANCELAMENTO preparado', () => {
      expect(isExplicitConfirmation('pode cancelar', 'cancel_appointment')).toBe(true);
    });

    it('"sim, pode marcar" confirma o agendamento', () => {
      expect(isExplicitConfirmation('sim, pode marcar', 'schedule_appointment')).toBe(true);
    });

    it('"sim" puro serve para qualquer ação', () => {
      expect(isExplicitConfirmation('sim', 'reschedule_appointment')).toBe(true);
      expect(isExplicitConfirmation('sim', 'cancel_appointment')).toBe(true);
    });
  });

  it('valida payloads persistidos e rejeita ação fora da whitelist', () => {
    expect(
      parsePendingActionPayload({
        type: 'cancel_appointment',
        appointmentId: '11111111-1111-1111-1111-111111111111',
      }),
    ).toMatchObject({ type: 'cancel_appointment' });
    expect(() => parsePendingActionPayload({ type: 'delete_patient', patientId: 'x' })).toThrow();
  });

  it('mantém payload de agendamento antigo e valida preço comercial novo', () => {
    const legacy = {
      type: 'schedule_appointment',
      patientId: '33333333-3333-3333-3333-333333333333',
      doctorId: '44444444-4444-4444-4444-444444444444',
      procedureId: '55555555-5555-5555-5555-555555555555',
      scheduledAt: '2026-10-04T12:00:00.000Z',
    };
    expect(parsePendingActionPayload(legacy)).toEqual(legacy);
    expect(
      parsePendingActionPayload({
        ...legacy,
        commercialPrice: {
          paymentMethod: 'pix',
          installmentCount: null,
          priceId: '77777777-7777-7777-7777-777777777777',
          grossAmount: 180,
        },
      }),
    ).toMatchObject({ commercialPrice: { paymentMethod: 'pix', grossAmount: 180 } });
    expect(() =>
      parsePendingActionPayload({
        ...legacy,
        commercialPrice: {
          paymentMethod: 'credit_card',
          installmentCount: 3,
          priceId: '77777777-7777-7777-7777-777777777777',
          grossAmount: 200,
        },
      }),
    ).toThrow();
  });
});

describe('idempotência da execução (R1 + emenda F-05)', () => {
  const conv = '22222222-2222-2222-2222-222222222222';
  const rowA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const rowB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const schedule = (scheduledAt: string): PendingActionPayload => ({
    type: 'schedule_appointment',
    patientId: '33333333-3333-3333-3333-333333333333',
    doctorId: '44444444-4444-4444-4444-444444444444',
    procedureId: '55555555-5555-5555-5555-555555555555',
    scheduledAt,
  });
  const at = '2026-08-01T12:00:00.000Z';

  it('retry do MESMO turno (mesma linha pendente) → MESMA chave', () => {
    // É esta a idempotência que importa: reentrega/retry sobre a MESMA ação
    // preparada nunca pode virar duas consultas.
    expect(pendingActionIdemKey(conv, rowA, schedule(at))).toBe(
      pendingActionIdemKey(conv, rowA, schedule(at)),
    );
  });

  it('F-05: episódios DIFERENTES com os mesmos argumentos → chaves diferentes', () => {
    // Agendar → cancelar → remarcar o MESMO horário é uma ação nova. Com a chave
    // puramente por conteúdo (e TTL de 7 dias) o core devolvia a consulta antiga,
    // já cancelada, do cache — e o agente anunciava um agendamento inexistente.
    expect(pendingActionIdemKey(conv, rowA, schedule(at))).not.toBe(
      pendingActionIdemKey(conv, rowB, schedule(at)),
    );
  });

  it('formato compatível com o idemKey() dos contextos (^[a-f0-9]{8,}$)', () => {
    expect(pendingActionIdemKey(conv, rowA, schedule(at))).toMatch(/^[a-f0-9]{8,}$/);
  });

  it('argumentos diferentes → chaves diferentes (não colapsa ações distintas)', () => {
    expect(pendingActionIdemKey(conv, rowA, schedule(at))).not.toBe(
      pendingActionIdemKey(conv, rowA, schedule('2026-08-02T12:00:00.000Z')),
    );
  });

  it('a chave separa tipo de ação e conversa', () => {
    const cancel: PendingActionPayload = {
      type: 'cancel_appointment',
      appointmentId: '66666666-6666-6666-6666-666666666666',
    };
    expect(pendingActionIdemKey(conv, rowA, cancel)).not.toBe(
      pendingActionIdemKey(conv, rowA, schedule(at)),
    );
    expect(pendingActionIdemKey(conv, rowA, cancel)).not.toBe(
      pendingActionIdemKey('77777777-7777-7777-7777-777777777777', rowA, cancel),
    );
  });
});

describe('maxDaysAhead autoritativo', () => {
  const now = new Date('2026-07-24T12:00:00.000Z');

  it('permite data dentro do limite configurado', () => {
    expect(() =>
      assertAgentSchedulePolicy({
        scheduledAt: '2026-08-23T12:00:00.000Z',
        now,
        maxDaysAhead: 30,
      }),
    ).not.toThrow();
  });

  it('rejeita data além do limite mesmo que o modelo tente chamar a tool', () => {
    expect(() =>
      assertAgentSchedulePolicy({
        scheduledAt: '2026-08-24T12:00:00.000Z',
        now,
        maxDaysAhead: 30,
      }),
    ).toThrow(/excede o limite de 30 dias/);
  });
});

describe('canScheduleAnonymous autoritativo', () => {
  it('bloqueia paciente ausente quando a clínica desativou agendamento anônimo', () => {
    expect(() =>
      assertAgentSchedulingIdentity({
        patientId: null,
        identityAmbiguous: false,
        canScheduleAnonymous: false,
      }),
    ).toThrow(/paciente não identificado/);
  });

  it('permite paciente ausente somente quando a clínica habilitou a opção', () => {
    expect(() =>
      assertAgentSchedulingIdentity({
        patientId: null,
        identityAmbiguous: false,
        canScheduleAnonymous: true,
      }),
    ).not.toThrow();
  });

  it('telefone ambíguo permanece bloqueado mesmo com agendamento anônimo habilitado', () => {
    expect(() =>
      assertAgentSchedulingIdentity({
        patientId: null,
        identityAmbiguous: true,
        canScheduleAnonymous: true,
      }),
    ).toThrow(/mais de um paciente/);
  });
});
