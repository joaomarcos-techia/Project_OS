import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks: requireSuperAdmin (porta de auth) e notFound (next).
const requireSuperAdmin = vi.fn();
const notFound = vi.fn();

vi.mock('@/lib/auth/tenant-context', () => ({ requireSuperAdmin: () => requireSuperAdmin() }));
vi.mock('next/navigation', () => ({ notFound: () => notFound() }));

import { guardAdminAccess } from './guard';

describe('guardAdminAccess (C15, OR-A1/A2) — 404 absoluto', () => {
  beforeEach(() => {
    requireSuperAdmin.mockReset();
    notFound.mockReset();
  });

  it('não-super_admin (requireSuperAdmin lança) → notFound()', async () => {
    requireSuperAdmin.mockRejectedValueOnce(new Error('forbidden'));
    await guardAdminAccess();
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('aal1 / sem MFA (lança) → notFound()', async () => {
    requireSuperAdmin.mockRejectedValueOnce(new Error('needs aal2'));
    await guardAdminAccess();
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('super_admin AAL2 (resolve) → NÃO chama notFound', async () => {
    requireSuperAdmin.mockResolvedValueOnce(undefined);
    await guardAdminAccess();
    expect(notFound).not.toHaveBeenCalled();
  });
});
