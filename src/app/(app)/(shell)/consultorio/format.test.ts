import { describe, expect, it } from 'vitest';

import { formatHora } from './format';

describe('formatHora', () => {
  it('usa o fuso da clínica, não o do processo', () => {
    expect(formatHora('2026-09-14T12:15:00Z', 'America/Sao_Paulo')).toBe('09:15');
    expect(formatHora('2026-09-14T12:15:00Z', 'Asia/Tokyo')).toBe('21:15');
  });
});
