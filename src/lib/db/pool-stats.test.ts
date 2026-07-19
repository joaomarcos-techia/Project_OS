/**
 * A4/E4 — saturação de conexões.
 *
 * POR QUE: este é o gargalo nº1 provável em escala e está ligado ao problema já
 * conhecido de "infinite loading = Supabase stall". Sem observar saturação, o
 * sintoma chega como TRAVAMENTO para o usuário, não como métrica — que é
 * exatamente o oposto de "identificar degradação antes do usuário perceber".
 *
 * Lê de `pg_stat_activity` (pg_catalog), não das internas do postgres.js: o
 * driver não expõe gauge de pool, e o catálogo dá a verdade do SERVIDOR, que é
 * o recurso realmente escasso (o limite é do Supabase, não do processo).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/lib/db', () => ({ dbAdmin: { execute } }));

async function freshModule() {
  vi.resetModules();
  return import('./pool-stats');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getConnectionStats', () => {
  it('calcula a saturação em % sobre o limite do servidor', async () => {
    execute.mockResolvedValue([
      { total: 30, active: 12, idle: 18, waiting: 0, max_connections: 60 },
    ]);
    const { getConnectionStats } = await freshModule();

    expect(await getConnectionStats()).toEqual({
      total: 30,
      active: 12,
      idle: 18,
      waiting: 0,
      max_connections: 60,
      saturation_pct: 50,
    });
  });

  it('arredonda a saturação (evita ruído de casas decimais no alerta)', async () => {
    execute.mockResolvedValue([
      { total: 7, active: 7, idle: 0, waiting: 0, max_connections: 60 },
    ]);
    const { getConnectionStats } = await freshModule();

    expect((await getConnectionStats())!.saturation_pct).toBe(12);
  });

  it('faz cache: o health é pollado a cada 3min e não pode martelar o catálogo', async () => {
    execute.mockResolvedValue([
      { total: 1, active: 1, idle: 0, waiting: 0, max_connections: 60 },
    ]);
    const { getConnectionStats } = await freshModule();

    await getConnectionStats();
    await getConnectionStats();

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('NUNCA lança — o health não pode quebrar por causa de um gauge', async () => {
    execute.mockRejectedValue(new Error('permission denied'));
    const { getConnectionStats } = await freshModule();

    await expect(getConnectionStats()).resolves.toBeNull();
  });

  it('max_connections ausente/zero não vira divisão por zero', async () => {
    execute.mockResolvedValue([
      { total: 5, active: 5, idle: 0, waiting: 0, max_connections: 0 },
    ]);
    const { getConnectionStats } = await freshModule();

    expect((await getConnectionStats())!.saturation_pct).toBe(0);
  });
});
