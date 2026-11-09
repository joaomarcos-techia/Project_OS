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

  it('fuso inválido cai no UTC em vez de derrubar o PDF', () => {
    expect(formatDate('2026-06-02T01:30:00Z', 'Fuso/Inexistente')).toBe('02/06/2026');
  });

  it('valor que não é data volta como veio', () => {
    expect(formatDate('não é data', 'America/Sao_Paulo')).toBe('não é data');
  });
});
