import { beforeEach, describe, expect, it, vi } from 'vitest';

const { revalidateTag, unstableCache, withTenant } = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  unstableCache: vi.fn((fn: () => Promise<unknown>) => fn),
  withTenant: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidateTag,
  unstable_cache: unstableCache,
}));
vi.mock('@/lib/crypto', () => ({ decryptForTenant: vi.fn() }));
vi.mock('@/lib/db/tenant', () => ({ withTenant }));

import { getClinicSettings, revalidateClinicSettings } from './queries';

function query<T>(rows: T[]) {
  const result = Promise.resolve(rows);
  const chain = Object.assign(result, {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
  });
  return chain;
}

describe('clinic settings cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('separa a chave por clínica e invalida somente a tag correspondente', async () => {
    const tx = {
      select: vi.fn(() => query([{ nome: 'Clínica Aurora', timezone: 'America/Recife' }])),
    };
    withTenant.mockImplementation(
      async (_clinicId: string, fn: (transaction: typeof tx) => unknown) => fn(tx),
    );

    await expect(getClinicSettings('clinic-1')).resolves.toEqual({
      name: 'Clínica Aurora',
      timezone: 'America/Recife',
    });
    expect(unstableCache).toHaveBeenCalledWith(
      expect.any(Function),
      ['clinic-settings', 'clinic-1'],
      { revalidate: false, tags: ['clinic-settings:clinic-1'] },
    );

    revalidateClinicSettings('clinic-1');
    expect(revalidateTag).toHaveBeenCalledWith('clinic-settings:clinic-1');
  });
});
