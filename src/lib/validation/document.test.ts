import { describe, expect, it } from 'vitest';

import {
  isValidCpf,
  isValidDocument,
  maskDocument,
  normalizeDocument,
  parseDocument,
} from './document';

/** CPF de teste do sandbox Asaas, já usado por `asaas-live-check.ts`. */
const SANDBOX_CPF = '24971563792';
/** CNPJ sintético com dígitos verificadores corretos. */
const VALID_CNPJ = '11222333000181';

describe('normalizeDocument', () => {
  it.each([
    ['249.715.637-92', '24971563792'],
    ['11.222.333/0001-81', '11222333000181'],
    ['  249 715 637 92 ', '24971563792'],
  ])('tira máscara e espaço: %s', (input, expected) => {
    expect(normalizeDocument(input)).toBe(expected);
  });

  it.each([[''], ['   '], ['.-/'], [null], [undefined]])(
    'ausência devolve null, não string vazia: %s',
    (input) => {
      expect(normalizeDocument(input as string | null | undefined)).toBeNull();
    },
  );

  it('texto não é ausência: as letras ficam e o documento é inválido (R16)', () => {
    expect(normalizeDocument('abc')).toBe('ABC');
    expect(parseDocument('abc')).toBeNull();
  });
});

describe('isValidCpf', () => {
  it('aceita CPF com dígitos verificadores corretos', () => {
    expect(isValidCpf(SANDBOX_CPF)).toBe(true);
    expect(isValidCpf('529.982.247-25')).toBe(true);
  });

  it('REJEITA repetidos, que passam no módulo 11 e são o que se digita para preencher', () => {
    for (let d = 0; d <= 9; d += 1) {
      expect(isValidCpf(String(d).repeat(11))).toBe(false);
    }
  });

  it.each([
    ['dígito verificador errado', '24971563793'],
    ['curto', '2497156379'],
    ['longo', '249715637920'],
    ['vazio', ''],
  ])('rejeita %s', (_label, input) => {
    expect(isValidCpf(input)).toBe(false);
  });
});

describe('isValidDocument', () => {
  it('aceita CPF e CNPJ válidos', () => {
    expect(isValidDocument(SANDBOX_CPF)).toBe(true);
    expect(isValidDocument(VALID_CNPJ)).toBe(true);
  });

  it.each([
    ['12 dígitos não é nem um nem outro', '249715637921'],
    ['13 dígitos', '1122233300018'],
    ['CNPJ com DV errado', '11222333000182'],
    ['texto', 'não tenho'],
  ])('rejeita %s', (_label, input) => {
    expect(isValidDocument(input)).toBe(false);
  });
});

describe('parseDocument', () => {
  it('classifica o tipo junto com os dígitos', () => {
    expect(parseDocument('249.715.637-92')).toEqual({ digits: SANDBOX_CPF, kind: 'cpf' });
    expect(parseDocument(VALID_CNPJ)).toEqual({ digits: VALID_CNPJ, kind: 'cnpj' });
  });

  it('devolve null em vez de lançar — a borda responde 400, não 500', () => {
    expect(parseDocument('11111111111')).toBeNull();
    expect(parseDocument(null)).toBeNull();
  });
});

describe('maskDocument', () => {
  it('nunca devolve o documento inteiro', () => {
    const masked = maskDocument(SANDBOX_CPF);

    expect(masked).not.toContain(SANDBOX_CPF);
    expect(masked.endsWith('92')).toBe(true);
    // Só os dois últimos dígitos sobrevivem: o resto não permite reconstruir.
    expect(masked.replace(/•/gu, '')).toHaveLength(2);
  });

  it('ausência vira string vazia, não máscara falsa', () => {
    expect(maskDocument(null)).toBe('');
  });
});

describe('letras no documento do titular (R16)', () => {
  it('não descarta letras: o que sobra não pode virar o CPF de outra pessoa', () => {
    // Antes: as letras sumiam, sobravam os 11 dígitos do CPF de teste e o
    // documento seguia para o gateway como se fosse esse CPF.
    expect(isValidDocument('ABC24971563792')).toBe(false);
    expect(parseDocument('AB.C24.971.563-792')).toBeNull();
    expect(normalizeDocument('12.abc.345/01de-35')).toBe('12ABC34501DE35');
  });

  it('CNPJ alfanumérico válido ainda não é aceito para cobrança (gateway sem suporte documentado)', () => {
    expect(isValidDocument('12ABC34501DE35')).toBe(false);
    expect(parseDocument('12.ABC.345/01DE-35')).toBeNull();
  });

  it('CPF e CNPJ numéricos continuam iguais, com ou sem máscara', () => {
    expect(parseDocument('249.715.637-92')).toEqual({ digits: SANDBOX_CPF, kind: 'cpf' });
    expect(parseDocument('11.222.333/0001-81')).toEqual({ digits: VALID_CNPJ, kind: 'cnpj' });
  });
});
