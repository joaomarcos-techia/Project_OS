import { describe, expect, it } from 'vitest';

import {
  CardNumberError,
  cardLast4,
  cardLookupInput,
  normalizeCardNumber,
} from './membership-card';

describe('carteirinha (P1.5, D21)', () => {
  it('normaliza tirando espaço, ponto, hífen e barra; letras em maiúscula', () => {
    expect(normalizeCardNumber(' 0001.2345-6789/0 ')).toBe('0001234567890');
    expect(normalizeCardNumber('ab12 cd34')).toBe('AB12CD34');
  });

  it('símbolo torna o número inválido, em vez de virar outro número', () => {
    expect(() => normalizeCardNumber('1234#5678')).toThrow(CardNumberError);
    expect(() => normalizeCardNumber('12345ç')).toThrow(CardNumberError);
  });

  it('vazio e acima de 20 caracteres (st_texto20) são recusados', () => {
    expect(() => normalizeCardNumber(' - ')).toThrow(/Informe/u);
    expect(() => normalizeCardNumber('1'.repeat(21))).toThrow(/no máximo 20/u);
    expect(normalizeCardNumber('1'.repeat(20))).toHaveLength(20);
  });

  it('a entrada do HMAC inclui clínica e operadora: a mesma carteirinha difere entre clínicas', () => {
    const n = normalizeCardNumber('0000000000000001');
    const a = cardLookupInput('11111111-1111-1111-1111-111111111111', '123456', n);
    const b = cardLookupInput('22222222-2222-2222-2222-222222222222', '123456', n);
    expect(a).not.toBe(b);
    expect(a).toBe('11111111-1111-1111-1111-111111111111:123456:0000000000000001');
    expect(() => cardLookupInput('x', '12345', n)).toThrow(CardNumberError);
  });

  it('últimos 4 para a tela', () => {
    expect(cardLast4('0000000000000001')).toBe('0001');
    expect(cardLast4('AB1')).toBe('AB1');
  });
});
