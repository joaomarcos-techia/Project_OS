import { afterEach, describe, expect, it, vi } from 'vitest';

describe('formatDatePt', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('mostra o mesmo dia brasileiro no servidor UTC e no browser de São Paulo', async () => {
    const instant = '2026-10-10T00:15:00.000Z';

    vi.stubEnv('TZ', 'UTC');
    vi.resetModules();
    const server = await import('./format');
    expect(server.formatDatePt(instant)).toBe('09/10/2026');

    vi.stubEnv('TZ', 'America/Sao_Paulo');
    vi.resetModules();
    const browser = await import('./format');
    expect(browser.formatDatePt(instant)).toBe('09/10/2026');
  });
});

describe('todayYmdIn (R51)', () => {
  it('devolve o dia do fuso pedido, não o do processo: às 22h30 de Brasília ainda é o mesmo dia', async () => {
    const { todayYmdIn } = await import('./format');
    const lateEvening = new Date('2026-11-14T01:30:00Z');
    expect(todayYmdIn('America/Sao_Paulo', lateEvening)).toBe('2026-11-13');
    expect(todayYmdIn('UTC', lateEvening)).toBe('2026-11-14');
    expect(todayYmdIn(undefined, lateEvening)).toBe('2026-11-13');
  });
});
