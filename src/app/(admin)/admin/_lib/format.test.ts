import { describe, expect, it } from 'vitest';

import { formatBRLCents, toCents } from './format';

describe('format (C15) — money em centavos', () => {
  it('toCents converte numeric(x,2) string → centavos inteiros', () => {
    expect(toCents('149.50')).toBe(14950);
    expect(toCents('0.00')).toBe(0);
    expect(toCents('1000')).toBe(100000);
    expect(toCents(149.5)).toBe(14950);
  });

  it('toCents lida com null/undefined/NaN → 0', () => {
    expect(toCents(null)).toBe(0);
    expect(toCents(undefined)).toBe(0);
    expect(toCents('abc')).toBe(0);
  });

  it('formatBRLCents formata em BRL', () => {
    //   = no-break space usado pelo Intl pt-BR entre "R$" e o valor.
    expect(formatBRLCents(14950).replace(/ /g, ' ')).toBe('R$ 149,50');
  });
});
