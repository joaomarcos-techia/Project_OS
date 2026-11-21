import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { dayBefore, normalizeCardNumber, normalizeProviderId, InsuranceConfigError } = await import('./config-service');

describe('config-service — regras puras do cadastro', () => {
  it('carteirinha: normaliza pontuação e espaços, maiúsculas, até 20 caracteres', () => {
    expect(normalizeCardNumber(' 0081.2345-0001 2345 ')).toBe('0081234500012345');
    expect(normalizeCardNumber('abc/123')).toBe('ABC123');
    expect(() => normalizeCardNumber('')).toThrow(InsuranceConfigError);
    expect(() => normalizeCardNumber('1'.repeat(21))).toThrow(/até 20/u);
    expect(() => normalizeCardNumber('12#34')).toThrow(InsuranceConfigError);
  });

  it('prestador: CNPJ (inclusive alfanumérico) com DV, CPF com DV, código de 1 a 14', () => {
    expect(normalizeProviderId('cnpjContratado', '12.ABC.345/01DE-35')).toBe('12ABC34501DE35');
    expect(() => normalizeProviderId('cnpjContratado', '11.222.333/0001-00')).toThrow(/CNPJ/u);
    expect(normalizeProviderId('cpfContratado', '529.982.247-25')).toBe('52998224725');
    expect(() => normalizeProviderId('cpfContratado', '111.111.111-11')).toThrow(/CPF/u);
    expect(normalizeProviderId('codigoPrestadorNaOperadora', '  PREST001 ')).toBe('PREST001');
    expect(() => normalizeProviderId('codigoPrestadorNaOperadora', 'X'.repeat(15))).toThrow(/1 a 14/u);
  });

  it('véspera de calendário (reajuste encerra a versão anterior no dia anterior)', () => {
    expect(dayBefore('2026-12-01')).toBe('2026-11-30');
    expect(dayBefore('2026-03-01')).toBe('2026-02-28');
    expect(dayBefore('2028-03-01')).toBe('2028-02-29');
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
  });
});
