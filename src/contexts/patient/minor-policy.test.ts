import { describe, expect, it } from 'vitest';

import { isMinorOnDate } from './minor-policy';

describe('minor patient policy', () => {
  it('considera menor até a véspera do 18º aniversário', () => {
    expect(isMinorOnDate('2008-07-25', '2026-07-24')).toBe(true);
  });

  it('considera maior a partir do 18º aniversário', () => {
    expect(isMinorOnDate('2008-07-24', '2026-07-24')).toBe(false);
  });

  it('trata corretamente aniversários ainda não ocorridos no ano', () => {
    expect(isMinorOnDate('2000-12-01', '2026-07-24')).toBe(false);
    expect(isMinorOnDate('2010-01-01', '2026-07-24')).toBe(true);
  });
});
