import { describe, expect, it } from 'vitest';

import { META_WINDOW_MS, isWindowOpen, windowClosesAt } from './meta-window';

const NOW = new Date('2026-07-20T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('isWindowOpen (ADR-047 — janela de 24h da Meta)', () => {
  it('inbound recente → aberta', () => {
    expect(isWindowOpen(ago(60_000), NOW)).toBe(true);
    expect(isWindowOpen(ago(23 * 60 * 60 * 1000), NOW)).toBe(true);
  });

  it('1ms antes do limite → aberta', () => {
    expect(isWindowOpen(ago(META_WINDOW_MS - 1), NOW)).toBe(true);
  });

  // A fronteira é a regra que mais custa errar: um "aberta" indevido vira
  // mensagem rejeitada pela Meta DEPOIS de o operador achar que respondeu.
  it('EXATAMENTE 24h → FECHADA (comparação estrita, sem empate)', () => {
    expect(isWindowOpen(ago(META_WINDOW_MS), NOW)).toBe(false);
  });

  it('1ms depois do limite → fechada', () => {
    expect(isWindowOpen(ago(META_WINDOW_MS + 1), NOW)).toBe(false);
  });

  it('fora da janela → fechada', () => {
    expect(isWindowOpen(ago(3 * 24 * 60 * 60 * 1000), NOW)).toBe(false);
  });

  // Conversa em que o paciente nunca escreveu não abriu janela nenhuma.
  it('sem inbound algum → FECHADA (default seguro)', () => {
    expect(isWindowOpen(null, NOW)).toBe(false);
  });

  // Relógio adiantado / inbound "no futuro": não é motivo para bloquear.
  it('inbound no futuro (clock skew) → aberta', () => {
    expect(isWindowOpen(new Date(NOW.getTime() + 5_000), NOW)).toBe(true);
  });
});

describe('windowClosesAt', () => {
  it('devolve o instante de fechamento quando aberta', () => {
    const last = ago(60_000);
    expect(windowClosesAt(last, NOW)).toEqual(new Date(last.getTime() + META_WINDOW_MS));
  });

  it('null quando fechada ou sem inbound', () => {
    expect(windowClosesAt(ago(META_WINDOW_MS), NOW)).toBeNull();
    expect(windowClosesAt(null, NOW)).toBeNull();
  });
});
