import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '@/lib/auth/permissions';

const mocks = vi.hoisted(() => ({
  authorizeAction: vi.fn(),
  requireActiveClinic: vi.fn(),
  hasGranularPermissions: vi.fn(),
  setMemberOverride: vi.fn(),
  setMemberOverrides: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/auth/action-guard', () => ({ authorizeAction: mocks.authorizeAction }));
vi.mock('@/contexts/billing/internal/require-active-clinic', () => ({
  requireActiveClinic: mocks.requireActiveClinic,
}));
vi.mock('@/contexts/billing/api', () => ({
  billingApiV1: { hasGranularPermissions: mocks.hasGranularPermissions },
}));
vi.mock('@/contexts/identity/internal/lifecycle', () => ({
  setMemberOverride: mocks.setMemberOverride,
  setMemberOverrides: mocks.setMemberOverrides,
  setMemberActive: vi.fn(),
  setMemberRole: vi.fn(),
}));

import { setMemberOverrideAction, setMemberOverridesAction } from './actions';
const userId = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorizeAction.mockResolvedValue({
    ok: true,
    user: { userId: 'owner-a' },
    clinicId: 'clinic-a',
  });
  mocks.requireActiveClinic.mockResolvedValue(undefined);
  mocks.hasGranularPermissions.mockResolvedValue(false);
});
describe('gate de plano nas permissões individuais', () => {
  it.each([
    [
      'individual',
      () =>
        setMemberOverrideAction({ userId, permission: PERMISSIONS.MANAGE_SETTINGS, granted: true }),
    ],
    [
      'lote',
      () =>
        setMemberOverridesAction({
          userId,
          changes: [{ permission: PERMISSIONS.MANAGE_SETTINGS, granted: true }],
        }),
    ],
  ])('Consultório recusa chamada direta %s sem gravar', async (_name, action) => {
    expect(await action()).toEqual({
      error: 'Permissões granulares estão disponíveis nos planos Clínica e Pro.',
    });
    expect(mocks.authorizeAction).toHaveBeenCalledWith(PERMISSIONS.MANAGE_PERMISSIONS);
    expect(mocks.hasGranularPermissions).toHaveBeenCalledWith('clinic-a');
    expect(mocks.setMemberOverride).not.toHaveBeenCalled();
    expect(mocks.setMemberOverrides).not.toHaveBeenCalled();
  });
  it('Clínica autorizada usa a clínica da sessão para aplicar ajuste individual', async () => {
    mocks.hasGranularPermissions.mockResolvedValue(true);
    expect(
      await setMemberOverrideAction({
        userId,
        permission: PERMISSIONS.MANAGE_SETTINGS,
        granted: true,
      }),
    ).toEqual({ ok: true });
    expect(mocks.setMemberOverride).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: 'clinic-a',
        actorUserId: 'owner-a',
        targetUserId: userId,
        permissionCode: PERMISSIONS.MANAGE_SETTINGS,
        granted: true,
      }),
    );
  });
  it('não revela o plano nem altera permissões antes da autorização', async () => {
    mocks.authorizeAction.mockResolvedValue({ ok: false, message: 'Sem acesso' });
    expect(await setMemberOverridesAction({ userId, changes: [] })).toEqual({
      error: 'Sem acesso',
    });
    expect(mocks.hasGranularPermissions).not.toHaveBeenCalled();
    expect(mocks.setMemberOverrides).not.toHaveBeenCalled();
  });
});
