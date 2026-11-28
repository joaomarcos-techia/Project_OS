import { describe, expect, it } from 'vitest';

import {
  AGENT_INSURANCE_TEXT,
  agentChoiceVerdict,
  agentInsuranceOptions,
  coverageQuestionReply,
  findUnsafeAgentClaims,
  insuranceReplyGuard,
  insurerNotRecognizedReply,
  isInsuranceTalk,
  matchInsurerFromPatientText,
  pickAgentMembership,
  planNotRecognizedReply,
  resolveInsurerFromPatientText,
  resolvePlanFromPatientText,
  insurerOrPrivateReply,
  patientInsuranceIntent,
  plansSaidByPatient,
} from './agent-insurance';

const OPTIONS = {
  enabled: true,
  insurers: [
    {
      id: 'ins-unimed',
      name: 'Unimed Sintética',
      plans: [
        { id: 'pl-1', name: 'Enfermaria' },
        { id: 'pl-2', name: 'Apartamento' },
      ],
    },
    { id: 'ins-saude', name: 'Saúde Bem', plans: [{ id: 'pl-3', name: 'Único' }] },
    { id: 'ins-vida', name: 'Vida Plena', plans: [] },
  ],
};

describe('P11 — Convênios para o agente de IA (jornadas do handoff)', () => {
  it('jornada 1 (particular): a resposta comum do agente não dispara a guarda', () => {
    expect(findUnsafeAgentClaims('Tenho horário amanhã às 10h. Posso reservar para você?')).toEqual(
      [],
    );
    // preço do PARTICULAR não é convênio: a guarda do texto livre não age
    expect(insuranceReplyGuard('A consulta particular custa R$ 250,00.')).toEqual({ safe: true });
  });

  it('jornada 2 (convênio aceito): só operadoras e planos ativos da clínica; nasce convênio com o aviso da carteirinha', () => {
    const options = agentInsuranceOptions(OPTIONS);
    expect(options.kind).toBe('options');
    expect(matchInsurerFromPatientText(options, 'oi, eu tenho UNIMED sintetica')).toEqual({
      id: 'ins-unimed',
      name: 'Unimed Sintética',
    });
    expect(matchInsurerFromPatientText(options, 'tenho saude bem')).toEqual({
      id: 'ins-saude',
      name: 'Saúde Bem',
    });
    const verdict = agentChoiceVerdict({ refusal: null, requiresAuthorization: false });
    expect(verdict).toEqual({
      allowed: true,
      billingMode: 'convenio',
      notices: [AGENT_INSURANCE_TEXT.receptionChecksCard],
    });
    // nunca pede o número da carteirinha
    for (const n of (verdict as { notices: string[] }).notices)
      expect(n.toLowerCase()).not.toContain('número');
  });

  it('jornada 3 (sem convênio por aqui): módulo desligado, sem schema ou sem operadora ativa = agendamento pela recepção, sem "recusar"', () => {
    for (const o of [null, { enabled: false, insurers: [] }, { enabled: true, insurers: [] }]) {
      expect(agentInsuranceOptions(o)).toEqual({
        kind: 'not_available',
        reply: AGENT_INSURANCE_TEXT.managedByReception,
      });
    }
    expect(AGENT_INSURANCE_TEXT.managedByReception).not.toMatch(/não atende|não aceita/i);
    // operadora não cadastrada não casa (nada de "parecido")
    expect(matchInsurerFromPatientText(agentInsuranceOptions(OPTIONS), 'tenho Amil')).toBeNull();
    // a recusa da agenda (texto para a recepção) não vai para o paciente: fica para o handoff
    const refusal = 'Operadora inativa nesta clínica.';
    expect(agentChoiceVerdict({ refusal, requiresAuthorization: true })).toEqual({
      allowed: false,
      reply: AGENT_INSURANCE_TEXT.notAccepted,
      internalReason: refusal,
    });
  });

  it('jornada 4 (dúvida de cobertura): nenhuma afirmação e handoff para a recepção', () => {
    const r = coverageQuestionReply();
    expect(r.handoff).toBe(true);
    expect(findUnsafeAgentClaims(r.reply)).toEqual([]);
  });

  it('jornada 5 (procedimento com autorização): avisa que a operadora precisa autorizar antes, sem afirmar autorização', () => {
    const verdict = agentChoiceVerdict({ refusal: null, requiresAuthorization: true });
    expect(verdict.allowed && verdict.notices).toEqual([
      AGENT_INSURANCE_TEXT.receptionChecksCard,
      AGENT_INSURANCE_TEXT.authorizationNeeded,
    ]);
  });

  it('nome ambíguo ou curto demais não escolhe operadora por conta própria', () => {
    const twin = agentInsuranceOptions({
      enabled: true,
      insurers: [
        { id: 'a', name: 'Vida', plans: [] },
        { id: 'b', name: 'Vida', plans: [] },
        { id: 'c', name: 'AB', plans: [] },
      ],
    });
    expect(matchInsurerFromPatientText(twin, 'tenho vida')).toBeNull();
    expect(resolveInsurerFromPatientText(twin, 'tenho vida')).toEqual({ kind: 'ambiguous' });
    expect(matchInsurerFromPatientText(twin, 'tenho ab')).toBeNull();
    expect(resolveInsurerFromPatientText(twin, 'tenho ab')).toEqual({ kind: 'none' });
  });
});

describe('resolução no servidor (P11.1)', () => {
  const options = agentInsuranceOptions(OPTIONS);

  it('operadora não reconhecida: mostra só os nomes das ativas e oferece particular/recepção', () => {
    const reply = insurerNotRecognizedReply(options, false);
    expect(reply).toContain('Unimed Sintética, Saúde Bem, Vida Plena');
    expect(reply).toMatch(/particular/);
    expect(insurerNotRecognizedReply(options, true)).toMatch(/mais de um convênio/);
    expect(findUnsafeAgentClaims(reply)).toEqual([]);
    expect(insurerNotRecognizedReply(agentInsuranceOptions(null), false)).toBe(
      AGENT_INSURANCE_TEXT.managedByReception,
    );
  });

  it('plano: o dito entre os ativos; sem fala, o único; fala que não casa = perguntar de novo', () => {
    expect(resolvePlanFromPatientText(options, 'ins-unimed', 'é o apartamento')).toEqual({
      id: 'pl-2',
      name: 'Apartamento',
    });
    expect(resolvePlanFromPatientText(options, 'ins-unimed', undefined)).toBeNull();
    expect(resolvePlanFromPatientText(options, 'ins-saude', '')).toEqual({
      id: 'pl-3',
      name: 'Único',
    });
    expect(resolvePlanFromPatientText(options, 'ins-unimed', 'ouro master')).toBeUndefined();
    expect(resolvePlanFromPatientText(options, 'ins-de-outra-clinica', undefined)).toBeUndefined();
    expect(planNotRecognizedReply(options, 'ins-unimed')).toContain('Enfermaria, Apartamento');
    expect(planNotRecognizedReply(options, 'ins-vida')).toBe(AGENT_INSURANCE_TEXT.notAccepted);
  });

  it('carteirinha já cadastrada: só o id, uma só ou a preferida; dúvida = pendência da recepção', () => {
    const card = (id: string, insurerId: string, planId: string | null, preferred = false) => ({
      id,
      insurerId,
      planId,
      preferred,
    });
    expect(pickAgentMembership([card('m1', 'ins-unimed', 'pl-1')], 'ins-unimed', null)).toEqual({
      membershipId: 'm1',
      planId: 'pl-1',
    });
    // plano escolhido diferente do da carteirinha: não usa
    expect(
      pickAgentMembership([card('m1', 'ins-unimed', 'pl-1')], 'ins-unimed', 'pl-2'),
    ).toBeNull();
    // duas carteirinhas sem preferida: dúvida
    expect(
      pickAgentMembership(
        [card('m1', 'ins-unimed', 'pl-1'), card('m2', 'ins-unimed', 'pl-2')],
        'ins-unimed',
        null,
      ),
    ).toBeNull();
    expect(
      pickAgentMembership(
        [card('m1', 'ins-unimed', 'pl-1'), card('m2', 'ins-unimed', 'pl-2', true)],
        'ins-unimed',
        null,
      ),
    ).toEqual({ membershipId: 'm2', planId: 'pl-2' });
    // carteirinha de outra operadora nunca serve
    expect(pickAgentMembership([card('m3', 'ins-saude', null)], 'ins-unimed', null)).toBeNull();
  });
});

describe('guarda de saída (findUnsafeAgentClaims / insuranceReplyGuard)', () => {
  it('os textos que o próprio Convênios entrega passam limpos', () => {
    for (const t of Object.values(AGENT_INSURANCE_TEXT))
      expect(findUnsafeAgentClaims(t)).toEqual([]);
  });

  it.each([
    ['Seu plano cobre esse exame, pode vir!', 'afirma cobertura'],
    ['A consulta está coberta pelo convênio.', 'afirma cobertura'],
    ['Você tem cobertura para psicoterapia.', 'afirma cobertura'],
    ['O procedimento já está autorizado.', 'afirma autorização'],
    ['A autorização foi aprovada hoje.', 'afirma autorização'],
    ['Você é elegível pelo seu plano.', 'afirma elegibilidade'],
    ['A coparticipação é de 30 reais.', 'informa valor'],
    ['Fica R$ 45,00 a parte do paciente.', 'informa valor'],
    ['Me passa o número da sua carteirinha?', 'pede o número da carteirinha'],
  ])('acusa: %s', (text, label) => {
    expect(findUnsafeAgentClaims(text)).toContain(label);
  });

  it.each([
    'Seu plano cobre esse exame, pode vir!',
    'Pelo convênio, a consulta fica R$ 30,00 de coparticipação.',
    'Me passa o número da sua carteirinha do convênio?',
    'Sim, a operadora já está autorizada para esse exame.',
    'Com o seu plano você é elegível.',
  ])('troca pela frase segura no texto livre: %s', (text) => {
    expect(isInsuranceTalk(text)).toBe(true);
    expect(insuranceReplyGuard(text)).toEqual({
      safe: false,
      labels: expect.any(Array),
      replacement: AGENT_INSURANCE_TEXT.coverageQuestion,
    });
  });

  it('sem assunto de convênio, nada muda (o resumo de sinal do particular é do servidor)', () => {
    expect(isInsuranceTalk('Seu horário é amanhã às 10h.')).toBe(false);
    expect(insuranceReplyGuard('O sinal é de R$ 50,00 pelo link.')).toEqual({ safe: true });
    expect(
      insuranceReplyGuard('Atendemos pelo convênio Unimed; a recepção confere a carteirinha.'),
    ).toEqual({
      safe: true,
    });
  });
});

describe('P11 (endurecimento) — o que o paciente disse, e não o que o modelo propôs', () => {
  const opts = {
    kind: 'options' as const,
    insurers: [
      {
        id: 'u',
        name: 'Unimed Sintética',
        plans: [
          { id: 'e', name: 'Enfermaria' },
          { id: 'a', name: 'Apartamento' },
        ],
      },
      { id: 'p', name: 'Unimed Sintética Plus', plans: [] },
      { id: 's', name: 'Saúde Bem', plans: [] },
    ],
  };

  it('nunca citou operadora: none (mesmo falando "convênio")', () => {
    expect(patientInsuranceIntent(opts, ['oi', 'quero pelo convênio'])).toEqual({ kind: 'none' });
  });

  it('a última menção vale; "particular" depois vira private', () => {
    expect(patientInsuranceIntent(opts, ['tenho saude bem', 'amanhã'])).toEqual({
      kind: 'insurer',
      insurers: [{ id: 's', name: 'Saúde Bem' }],
    });
    expect(patientInsuranceIntent(opts, ['tenho Saúde Bem', 'prefiro particular'])).toEqual({
      kind: 'private',
    });
    expect(patientInsuranceIntent(opts, ['particular', 'não, pela Saúde Bem'])).toMatchObject({
      kind: 'insurer',
    });
    expect(patientInsuranceIntent(opts, ['sem convênio'])).toEqual({ kind: 'private' });
  });

  it('operadora e "particular" na mesma frase: unclear', () => {
    expect(patientInsuranceIntent(opts, ['não quero particular, é Saúde Bem'])).toMatchObject({
      kind: 'unclear',
    });
  });

  it('nome mais longo vence o contido nele; os dois ditos separados ficam os dois', () => {
    expect(patientInsuranceIntent(opts, ['pela Unimed Sintética Plus'])).toEqual({
      kind: 'insurer',
      insurers: [{ id: 'p', name: 'Unimed Sintética Plus' }],
    });
    const both = patientInsuranceIntent(opts, ['tenho Unimed Sintética Plus e a Unimed Sintética']);
    expect(both.kind === 'insurer' && both.insurers.map((i) => i.id).sort()).toEqual(['p', 'u']);
    expect(resolveInsurerFromPatientText(opts, 'Unimed Sintética Plus')).toEqual({
      kind: 'match',
      insurer: { id: 'p', name: 'Unimed Sintética Plus' },
    });
    expect(resolveInsurerFromPatientText(opts, 'Unimed Sintética')).toMatchObject({
      kind: 'match',
      insurer: { id: 'u' },
    });
  });

  it('planos ditos pelo paciente, só da operadora escolhida', () => {
    expect(plansSaidByPatient(opts, 'u', ['é o apartamento'])).toEqual([
      { id: 'a', name: 'Apartamento' },
    ]);
    expect(plansSaidByPatient(opts, 'u', ['amanhã'])).toEqual([]);
    expect(plansSaidByPatient(opts, 's', ['apartamento'])).toEqual([]);
  });

  it('a pergunta "convênio ou particular" não afirma nada indevido', () => {
    for (const t of [
      insurerOrPrivateReply([{ name: 'Saúde Bem' }, { name: 'Saúde Bem' }]),
      insurerOrPrivateReply([]),
      AGENT_INSURANCE_TEXT.insurerNotDeclared,
    ]) {
      expect(findUnsafeAgentClaims(t)).toEqual([]);
    }
    expect(insurerOrPrivateReply([{ name: 'Saúde Bem' }, { name: 'Saúde Bem' }])).toBe(
      'Você quer agendar pelo convênio Saúde Bem ou como particular?',
    );
  });
});
