import { describe, expect, it } from 'vitest';

import { integerToWords, quantityToWords } from './quantity-to-words';

describe('integerToWords (pt-BR)', () => {
  it('cobre unidades, dezenas e centenas', () => {
    expect(integerToWords(0)).toBe('zero');
    expect(integerToWords(1)).toBe('um');
    expect(integerToWords(10)).toBe('dez');
    expect(integerToWords(21)).toBe('vinte e um');
    expect(integerToWords(30)).toBe('trinta');
    expect(integerToWords(100)).toBe('cem');
    expect(integerToWords(101)).toBe('cento e um');
    expect(integerToWords(256)).toBe('duzentos e cinquenta e seis');
  });

  it('cobre milhares', () => {
    expect(integerToWords(1000)).toBe('mil');
    expect(integerToWords(2000)).toBe('dois mil');
    expect(integerToWords(1500)).toBe('mil e quinhentos');
  });
});

describe('quantityToWords (helper de render do receituário)', () => {
  it('anexa o extenso a um inteiro puro', () => {
    expect(quantityToWords('1')).toBe('1 (um)');
    expect(quantityToWords('10')).toBe('10 (dez)');
    expect(quantityToWords('30')).toBe('30 (trinta)');
    expect(quantityToWords('100')).toBe('100 (cem)');
  });

  it('NÃO altera valores não-numéricos (não inventa interpretação)', () => {
    expect(quantityToWords('2 caixas')).toBe('2 caixas');
    expect(quantityToWords('1/2')).toBe('1/2');
    expect(quantityToWords('10ml')).toBe('10ml');
  });

  it('trata vazio/nulo como string vazia', () => {
    expect(quantityToWords('')).toBe('');
    expect(quantityToWords(undefined)).toBe('');
    expect(quantityToWords(null)).toBe('');
  });
});
