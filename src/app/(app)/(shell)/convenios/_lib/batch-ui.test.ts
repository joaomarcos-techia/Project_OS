import { describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/health-insurance/actions', () => ({}));

import { toCents } from './batch-ui';

describe('valores digitados em reais', () => {
  it('formato brasileiro: vírgula decimal e ponto de milhar', () => {
    expect(toCents('150,50')).toBe(15050);
    expect(toCents('1.500,00')).toBe(150000);
    expect(toCents('0,01')).toBe(1);
  });

  it('sem vírgula, o ponto é decimal (nunca vira milhar em silêncio)', () => {
    expect(toCents('150.50')).toBe(15050);
    expect(toCents('150')).toBe(15000);
  });

  it('texto que não é número não vira valor', () => {
    expect(Number.isNaN(toCents('abc'))).toBe(true);
  });
});
