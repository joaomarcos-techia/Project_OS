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
