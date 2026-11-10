import { describe, expect, it } from 'vitest';

import { isValidCnpj } from './cnpj';
import { isValidCnpjAlphanumeric, normalizeCnpjAlphanumeric } from './cnpj-alfanumerico';

describe('CNPJ alfanumérico (IN RFB 2.229/2024)', () => {
  it('aceita o exemplo oficial da Receita: 12.ABC.345/01DE-35', () => {
    expect(isValidCnpjAlphanumeric('12.ABC.345/01DE-35')).toBe(true);
    expect(isValidCnpjAlphanumeric('12ABC34501DE35')).toBe(true);
    expect(isValidCnpjAlphanumeric('12abc34501de35')).toBe(true);
  });

  it('recusa DV errado, tamanho errado, letra no DV e repetidos', () => {
    expect(isValidCnpjAlphanumeric('12ABC34501DE36')).toBe(false);
    expect(isValidCnpjAlphanumeric('12ABC34501DE3')).toBe(false);
    expect(isValidCnpjAlphanumeric('12ABC34501DEA5')).toBe(false);
    expect(isValidCnpjAlphanumeric('00000000000000')).toBe(false);
    expect(isValidCnpjAlphanumeric('')).toBe(false);
    expect(isValidCnpjAlphanumeric(null)).toBe(false);
  });

  it('para CNPJ só com dígitos, concorda com o validador numérico existente', () => {
    for (const cnpj of ['11222333000181', '11444777000161', '11222333000182', '11444777000160']) {
      expect(isValidCnpjAlphanumeric(cnpj), cnpj).toBe(isValidCnpj(cnpj));
    }
  });

  it('normaliza sem apagar letras', () => {
    expect(normalizeCnpjAlphanumeric(' 12.abc.345/01de-35 ')).toBe('12ABC34501DE35');
    expect(normalizeCnpjAlphanumeric('   ')).toBeNull();
  });
});
