import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  headersMock,
  revalidatePath,
  requireClinicId,
  requireFreshPermission,
  requireUser,
  updateOwnProfessionalCredential,
} = vi.hoisted(() => ({
  headersMock: vi.fn(async () => new Headers({ origin: 'https://app.qoro.dev' })),
  revalidatePath: vi.fn(),
  requireClinicId: vi.fn(async () => '11111111-1111-1111-1111-111111111111'),
  requireFreshPermission: vi.fn(async () => undefined),
  requireUser: vi.fn(async () => ({ userId: '22222222-2222-2222-2222-222222222222' })),
  updateOwnProfessionalCredential: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/headers', () => ({ headers: headersMock }));
vi.mock('@/contexts/identity/internal/professional-credential', () => ({
  updateOwnProfessionalCredential,
}));
vi.mock('@/contexts/identity/internal/map-error', () => ({
  mapIdentityError: () => 'Erro mapeado.',
}));
vi.mock('@/lib/audit/request-context', () => ({
  buildRequestContext: () => ({ requestId: 'req-1' }),
}));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireClinicId,
  requireFreshPermission,
  requireUser,
}));

import { updateProfessionalCredentialAction } from './actions';

beforeEach(() => {
  vi.clearAllMocks();
  updateOwnProfessionalCredential.mockResolvedValue({
    crm: '12345A',
    crmUf: 'SP',
    especialidade: 'Cardiologia',
  });
});

describe('updateProfessionalCredentialAction', () => {
  it('retorna a credencial persistida e revalida a página de perfil', async () => {
    await expect(
      updateProfessionalCredentialAction({
        crm: ' 12 345 a ',
        crmUf: 'sp',
        especialidade: 'Cardiologia',
      }),
    ).resolves.toEqual({
      ok: true,
      credential: { crm: '12345A', crmUf: 'SP', especialidade: 'Cardiologia' },
    });

    expect(updateOwnProfessionalCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: '11111111-1111-1111-1111-111111111111',
        userId: '22222222-2222-2222-2222-222222222222',
        crm: '12 345 a',
        crmUf: 'sp',
        especialidade: 'Cardiologia',
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith('/configuracoes/perfil');
  });

  it('não revalida quando a gravação falha', async () => {
    updateOwnProfessionalCredential.mockRejectedValue(new Error('database unavailable'));

    await expect(
      updateProfessionalCredentialAction({ crm: '12345', crmUf: 'SP', especialidade: '' }),
    ).resolves.toEqual({ ok: false, message: 'Erro mapeado.' });

    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
