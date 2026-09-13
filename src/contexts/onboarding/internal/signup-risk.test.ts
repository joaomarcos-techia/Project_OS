import { describe, expect, it } from 'vitest';

vi.mock('server-only', () => ({}));

import { vi } from 'vitest';

import { RISK_HIGH, RISK_LOW, RISK_MODERATE, classifySignupRisk } from './signup-risk';

const HOST = 'app.qoro.dev';

/** Requisição limpa: origem coerente, balde vazio, limiter são, corpo válido. */
function sinais(over: Partial<Parameters<typeof classifySignupRisk>[0]> = {}) {
  return {
    origin: `https://${HOST}`,
    expectedHost: HOST,
    ipBudgetUsed: 0,
    schemaFailure: false,
    limiterDegraded: false,
    ...over,
  };
}

describe('classificador de risco do cadastro', () => {
  it('requisição normal é risco BAIXO', () => {
    expect(classifySignupRisk(sinais())).toEqual({ level: RISK_LOW, reason: 'clean' });
  });

  it('compara HOST, não a string inteira — porta e esquema não podem reprovar', () => {
    // `Origin` traz esquema (e às vezes porta). Comparar texto cru faria
    // `https://app.qoro.dev` divergir de `app.qoro.dev` e recusaria todo mundo.
    expect(classifySignupRisk(sinais({ origin: 'https://APP.QORO.DEV' })).level).toBe(RISK_LOW);
  });

  it('origem de outro host é risco ALTO', () => {
    const r = classifySignupRisk(sinais({ origin: 'https://evil.example' }));
    expect(r).toEqual({ level: RISK_HIGH, reason: 'cross_site_origin' });
  });

  it('origem que nem é URL válida conta como divergente, não como ausente', () => {
    // Entrada forjada não pode cair na faixa mais branda por ser malformada.
    expect(classifySignupRisk(sinais({ origin: 'nao-e-url' })).level).toBe(RISK_HIGH);
  });

  it('origem ausente é MODERADO, não alto', () => {
    // Cliente não-browser pode ser legítimo (ferramenta, teste). Desafia em vez
    // de recusar: "não é o fluxo normal" ainda não é "é abuso".
    const r = classifySignupRisk(sinais({ origin: null }));
    expect(r).toEqual({ level: RISK_MODERATE, reason: 'missing_origin' });
  });

  it('corpo malformado é MODERADO', () => {
    const r = classifySignupRisk(sinais({ schemaFailure: true }));
    expect(r).toEqual({ level: RISK_MODERATE, reason: 'schema_failure' });
  });

  it('balde do IP na metade já pede prova — antes de o limite estourar', () => {
    expect(classifySignupRisk(sinais({ ipBudgetUsed: 0.49 })).level).toBe(RISK_LOW);
    expect(classifySignupRisk(sinais({ ipBudgetUsed: 0.5 })).reason).toBe('ip_budget');
  });

  it('limiter degradado vira MODERADO — o desafio substitui a defesa que caiu', () => {
    const r = classifySignupRisk(sinais({ limiterDegraded: true }));
    expect(r).toEqual({ level: RISK_MODERATE, reason: 'limiter_degraded' });
  });

  it('cross-site vence os outros sinais: recusa em vez de desafiar', () => {
    const r = classifySignupRisk(
      sinais({ origin: 'https://evil.example', limiterDegraded: true, schemaFailure: true }),
    );
    expect(r.level).toBe(RISK_HIGH);
  });

  it('os motivos são rótulos fixos, seguros para log e métrica', () => {
    // Baixa cardinalidade e zero PII: é o que permite usá-los em dashboard sem
    // vazar nada de quem tentou se cadastrar.
    const motivos = [
      classifySignupRisk(sinais()).reason,
      classifySignupRisk(sinais({ origin: null })).reason,
      classifySignupRisk(sinais({ origin: 'https://evil.example' })).reason,
    ];
    for (const m of motivos) expect(m).toMatch(/^[a-z_]+$/u);
  });
});
