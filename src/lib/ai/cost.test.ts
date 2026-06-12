/**
 * Cost tracking (11.6.5, parte unitária) — tokens × $/1M, arredondado a 6
 * casas (numeric(10,6)); modelo desconhecido → 0 (e métrica, não exceção).
 */
import { describe, expect, it } from 'vitest';

import { AI_PRICE_TABLE_USD_PER_1M, computeCostUsd } from './cost';

describe('computeCostUsd', () => {
  it('calcula USD para gemini-2.5-flash (input 0.30 / output 2.50 por 1M)', () => {
    // 1M input + 1M output = 0.30 + 2.50
    expect(
      computeCostUsd({ tokensInput: 1_000_000, tokensOutput: 1_000_000, model: 'gemini-2.5-flash' }),
    ).toBe(2.8);
    // Conversa típica: 1200 in / 150 out
    expect(
      computeCostUsd({ tokensInput: 1200, tokensOutput: 150, model: 'gemini-2.5-flash' }),
    ).toBe(0.000735);
  });

  it('zero tokens → custo 0', () => {
    expect(computeCostUsd({ tokensInput: 0, tokensOutput: 0, model: 'gemini-2.5-flash' })).toBe(0);
  });

  it('modelo fora da tabela → 0 (sem exceção)', () => {
    expect(computeCostUsd({ tokensInput: 1000, tokensOutput: 1000, model: 'gpt-99' })).toBe(0);
  });

  it('tabela de preços é congelada (contrato ADR-022)', () => {
    expect(Object.isFrozen(AI_PRICE_TABLE_USD_PER_1M)).toBe(true);
    expect(AI_PRICE_TABLE_USD_PER_1M['gemini-2.5-flash']).toEqual({ input: 0.3, output: 2.5 });
  });
});
