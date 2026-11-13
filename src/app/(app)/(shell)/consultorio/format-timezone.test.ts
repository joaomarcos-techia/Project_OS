/**
 * R51 — a hora do consultório sai no fuso explícito: o servidor (UTC na Vercel) e o
 * navegador (Brasília) escrevem o mesmo texto, e a hidratação não diverge.
 */
import { describe, expect, it } from 'vitest';

import { formatHora } from './format';

describe('formatHora (R51)', () => {
  it('escreve a hora de Brasília em qualquer fuso do processo', () => {
    expect(formatHora('2026-11-13T16:05:00Z')).toBe('13:05');
    expect(formatHora('2026-11-14T01:30:00Z')).toBe('22:30');
  });

  it('aceita o fuso da clínica quando a tela o tiver', () => {
    expect(formatHora('2026-11-14T01:30:00Z', 'Asia/Tokyo')).toBe('10:30');
  });
});
