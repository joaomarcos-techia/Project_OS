import { describe, expect, it } from 'vitest';

import {
  formatCnpj,
  isAlphanumericCnpj,
  isValidCnpj,
  normalizeCnpj,
  parseOptionalCnpj,
} from './cnpj';

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

  it('rejeita letra nos dígitos verificadores (só as 12 primeiras posições aceitam letra)', () => {
    expect(isValidCnpj('11222333000ABC')).toBe(false);
    expect(isValidCnpj('abcdefghijklmn')).toBe(false);
    expect(isValidCnpj('12ABC34501DEA5')).toBe(false);
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

// Exemplo oficial da Receita Federal para o CNPJ alfanumérico (IN RFB 2.229/2024).
const ALNUM = '12ABC34501DE35';
const ALNUM_MASKED = '12.ABC.345/01DE-35';

describe('CNPJ alfanumérico (R16)', () => {
  it('aceita o exemplo oficial, com ou sem máscara e em minúsculas', () => {
    expect(isValidCnpj(ALNUM)).toBe(true);
    expect(isValidCnpj(ALNUM_MASKED)).toBe(true);
    expect(isValidCnpj('12.abc.345/01de-35')).toBe(true);
  });

  it('recusa DV errado e tamanho errado', () => {
    expect(isValidCnpj('12ABC34501DE36')).toBe(false);
    expect(isValidCnpj('12ABC34501DE3')).toBe(false);
  });

  it('normaliza sem apagar letras: um CNPJ com letras nunca vira outro número', () => {
    expect(normalizeCnpj(' 12.abc.345/01de-35 ')).toBe(ALNUM);
    // Antes: "12.ABC.345/01DE-35" virava "123450135". Agora a letra fica.
    expect(normalizeCnpj(ALNUM_MASKED)).not.toMatch(/^\d+$/u);
  });

  it('forma canônica, apresentação e detecção do formato novo', () => {
    expect(parseOptionalCnpj(ALNUM_MASKED)).toEqual({ ok: true, value: ALNUM });
    expect(formatCnpj(ALNUM)).toBe(ALNUM_MASKED);
    expect(isAlphanumericCnpj(ALNUM_MASKED)).toBe(true);
    expect(isAlphanumericCnpj(VALID_MASKED)).toBe(false);
  });
});

describe('compatibilidade com CNPJs numéricos já gravados', () => {
  // Implementação ANTERIOR (só dígitos), copiada aqui como oráculo: a forma
  // canônica e a validade de qualquer CNPJ numérico não podem mudar, senão o
  // `hashForLookup` dos registros existentes deixaria de bater.
  const legacyNormalize = (v: string): string | null => {
    const d = v.replace(/\D/gu, '');
    return d.length === 0 ? null : d;
  };
  const legacyValid = (v: string): boolean => {
    const d = legacyNormalize(v);
    if (d === null || d.length !== 14 || /^(\d)\1{13}$/u.test(d)) return false;
    const dv = (slice: string): number => {
      let w = 2;
      let sum = 0;
      for (let i = slice.length - 1; i >= 0; i--) {
        sum += Number(slice[i]) * w;
        w = w === 9 ? 2 : w + 1;
      }
      const r = sum % 11;
      return r < 2 ? 0 : 11 - r;
    };
    const first = dv(d.slice(0, 12));
    return first === Number(d[12]) && dv(d.slice(0, 12) + String(first)) === Number(d[13]);
  };

  it('mesma forma canônica e mesma validade em 5.000 CNPJs numéricos com máscaras variadas', () => {
    let seed = 20261110;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed;
    };
    const masks = [
      (d: string) => d,
      (d: string) => formatCnpj(d),
      (d: string) => `  ${d.slice(0, 8)} ${d.slice(8)}  `,
      (d: string) => d.replace(/(\d{4})/gu, '$1,'),
    ];
    for (let i = 0; i < 5000; i++) {
      let digits = '';
      for (let k = 0; k < 14; k++) digits += String(next() % 10);
      // metade com DV corrigido para exercitar o caminho válido
      if (i % 2 === 0) {
        const fix = (base: string): string => {
          for (let a = 0; a < 10; a++)
            for (let b = 0; b < 10; b++)
              if (legacyValid(`${base}${a}${b}`)) return `${base}${a}${b}`;
          return `${base}00`;
        };
        digits = fix(digits.slice(0, 12));
      }
      const input = masks[i % masks.length]!(digits);
      expect(normalizeCnpj(input), input).toBe(legacyNormalize(input));
      expect(isValidCnpj(input), input).toBe(legacyValid(input));
    }
  });
});
