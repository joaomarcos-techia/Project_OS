import { describe, expect, it } from 'vitest';

import {
  AGENT_INSURANCE_TEXT,
  agentChoiceVerdict,
  agentInsuranceOptions,
  coverageQuestionReply,
  findUnsafeAgentClaims,
  matchInsurerFromPatientText,
} from './agent-insurance';

const OPTIONS = {
  enabled: true,
  insurers: [
    { id: 'ins-unimed', name: 'Unimed Sintética', plans: [{ id: 'pl-1', name: 'Enfermaria' }] },
    { id: 'ins-saude', name: 'Saúde Bem', plans: [] },
  ],
};

describe('P11 — Convênios para o agente de IA (jornadas do handoff)', () => {
  it('jornada 1 (particular): a resposta comum do agente não dispara a guarda', () => {
    expect(findUnsafeAgentClaims('Tenho horário amanhã às 10h. Posso reservar para você?')).toEqual(
      [],
    );
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

  it('jornada 3 (não aceito): módulo desligado, sem schema ou sem operadora ativa = a clínica não atende convênio', () => {
    for (const o of [null, { enabled: false, insurers: [] }, { enabled: true, insurers: [] }]) {
      expect(agentInsuranceOptions(o)).toEqual({
        kind: 'not_available',
        reply: AGENT_INSURANCE_TEXT.notAccepted,
      });
    }
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
    expect(matchInsurerFromPatientText(twin, 'tenho ab')).toBeNull();
  });
});

describe('guarda de saída (findUnsafeAgentClaims)', () => {
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
});
