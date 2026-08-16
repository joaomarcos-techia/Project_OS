import { describe, expect, it } from 'vitest';

import { formatCnpj, isValidCnpj, normalizeCnpj, parseOptionalCnpj } from './cnpj';

// CNPJs válidos (checksum real).
const VALID = '11222333000181';
const VALID_MASKED = '11.222.333/0001-81';

describe('normalizeCnpj', () => {
  it('reduz a dígitos e trata vazio como ausente (campo opcional)', () => {
    expect(normalizeCnpj(VALID_MASKED)).toBe(VALID);
    expect(normalizeCnpj('')).toBeNull();
    expect(normalizeCnpj('   ')).toBeNull();
    expect(normalizeCnpj(null)).toBeNull();
    expect(normalizeCnpj(undefined)).toBeNull();
  });
});

describe('isValidCnpj (VAL-001 / VAL-002)', () => {
  it('aceita o documento válido, com ou sem máscara', () => {
    expect(isValidCnpj(VALID)).toBe(true);
    expect(isValidCnpj(VALID_MASKED)).toBe(true);
  });

  it('rejeita o valor exato que produção aceitou e persistiu', () => {
    // O pentest enviou `1` no fornecedor e no perfil da clínica; os dois
    // gravaram. Este é o caso de regressão literal.
    expect(isValidCnpj('1')).toBe(false);
  });

  it('rejeita curto, longo e parcial', () => {
    expect(isValidCnpj('1122233300018')).toBe(false); // 13
    expect(isValidCnpj('112223330001811')).toBe(false); // 15
    expect(isValidCnpj('11222333')).toBe(false);
  });

  it('rejeita alfanumérico — as letras somem e o resto não fecha 14 dígitos', () => {
    expect(isValidCnpj('11222333000ABC')).toBe(false);
    expect(isValidCnpj('abcdefghijklmn')).toBe(false);
  });

  it('rejeita checksum inválido (um dígito verificador trocado)', () => {
    expect(isValidCnpj('11222333000182')).toBe(false);
    expect(isValidCnpj('11222333000191')).toBe(false);
  });

  it('rejeita os 14 dígitos repetidos — passam no módulo 11 por acidente', () => {
    for (const d of '0123456789') expect(isValidCnpj(d.repeat(14))).toBe(false);
  });

  it('vazio NÃO é "válido" — quem trata opcional é parseOptionalCnpj', () => {
    expect(isValidCnpj('')).toBe(false);
    expect(isValidCnpj(null)).toBe(false);
  });
});

describe('parseOptionalCnpj — contrato do campo opcional', () => {
  it('vazio é aceito e vira null', () => {
    expect(parseOptionalCnpj('')).toEqual({ ok: true, value: null });
    expect(parseOptionalCnpj(undefined)).toEqual({ ok: true, value: null });
  });

  it('preenchido válido devolve a forma CANÔNICA, não a digitada', () => {
    // É o que vai para encryptForTenant/hashForLookup: o hash precisa
    // representar o documento, não a grafia.
    expect(parseOptionalCnpj(VALID_MASKED)).toEqual({ ok: true, value: VALID });
  });

  it('preenchido inválido é recusado', () => {
    expect(parseOptionalCnpj('1').ok).toBe(false);
    expect(parseOptionalCnpj('11222333000182').ok).toBe(false);
  });
});

describe('formatCnpj — apresentação, nunca persistência', () => {
  it('formata o canônico', () => {
    expect(formatCnpj(VALID)).toBe(VALID_MASKED);
  });

  it('devolve a entrada quando não há 14 dígitos, sem inventar máscara', () => {
    expect(formatCnpj('1')).toBe('1');
    expect(formatCnpj('')).toBe('');
  });
});
