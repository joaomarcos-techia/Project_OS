import { describe, expect, it } from 'vitest';

import { formatDate } from './components';

describe('formatDate', () => {
  it('sem fuso mantém o UTC de antes (uso do admin)', () => {
    expect(formatDate('2026-06-02T01:30:00Z')).toBe('02/06/2026');
  });

  it('com o fuso da clínica, a emissão das 22h30 de Brasília fica no próprio dia', () => {
    expect(formatDate('2026-06-02T01:30:00Z', 'America/Sao_Paulo')).toBe('01/06/2026');
    expect(formatDate('2026-06-01T15:00:00Z', 'Asia/Tokyo')).toBe('02/06/2026');
  });

  it.each([
    ['antes das 21h', '2026-08-16T23:59:00Z', '16/08/2026'],
    ['às 21h', '2026-08-17T00:00:00Z', '16/08/2026'],
    ['depois das 21h', '2026-08-17T02:59:59Z', '16/08/2026'],
    ['meia-noite em Brasília', '2026-08-17T03:00:00Z', '17/08/2026'],
    ['virada de mês', '2026-09-01T01:00:00Z', '31/08/2026'],
    ['virada de ano', '2027-01-01T02:30:00Z', '31/12/2026'],
    ['29/02 de ano bissexto às 23h', '2028-03-01T02:00:00Z', '29/02/2028'],
  ])('Brasília, %s', (_case, iso, expected) => {
    expect(formatDate(iso, 'America/Sao_Paulo')).toBe(expected);
    expect(formatDate(iso, 'America/Fortaleza')).toBe(expected);
  });

  it('fuso inválido cai no UTC em vez de derrubar o PDF', () => {
    expect(formatDate('2026-06-02T01:30:00Z', 'Fuso/Inexistente')).toBe('02/06/2026');
  });

  it('valor que não é data volta como veio', () => {
    expect(formatDate('não é data', 'America/Sao_Paulo')).toBe('não é data');
  });
});
