/**
 * B3 (auditoria de APIs) — ordem e validação nas actions super_admin de messaging.
 *
 * Estas três são cross-tenant por design: recebem `clinicId` de INPUT, ao contrário
 * do caminho tenant, onde ele vem de `requireClinicId()`. O gate morava só dentro de
 * `superAdminAction`, então Zod e `encryptForTenant` (HKDF por tenant) rodavam antes
 * dele. Não era bypass — mas era CPU de derivação de chave gasta a mando de quem não
 * provou nada, e um ZodError voltando antes do 403 revelava o formato do input.
 *
 * A propriedade sob teste: para um não-autorizado, NADA acontece além do 403.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireSuperAdmin, encryptForTenant, superAdminAction, requestContext } = vi.hoisted(() => ({
  requireSuperAdmin: vi.fn(async () => {}),
  encryptForTenant: vi.fn(async () => 'CIPHERTEXT'),
  superAdminAction: vi.fn(async (_opts: unknown, fn: (tx: unknown) => unknown) => fn({})),
  requestContext: vi.fn(async () => ({ ip: null, userAgent: null, requestId: 'r', correlationId: 'r' })),
}));

vi.mock('@/lib/auth/tenant-context', () => ({
  requireSuperAdmin,
  requireUser: vi.fn(async () => ({ userId: 'u1' })),
  requireClinicId: vi.fn(async () => 'c1'),
  requireFreshPermission: vi.fn(async () => {}),
}));
vi.mock('@/lib/crypto', () => ({ encryptForTenant, decryptForTenant: vi.fn(async () => 'tok') }));
vi.mock('@/lib/audit/super-admin', () => ({ superAdminAction }));
vi.mock('@/lib/audit/request-context-from-headers', () => ({ requestContext }));
vi.mock('@/lib/messaging', () => ({
  deactivateTenantConnection: vi.fn(),
  loadActiveNumberForSend: vi.fn(),
  recordConnectionFailure: vi.fn(),
  upsertTenantConnection: vi.fn(),
}));
vi.mock('@/lib/env', () => ({
  assertWhatsappOnboardingReady: () => {},
  env: { LOG_LEVEL: 'error' },
}));

import {
  connectWhatsappNumber,
  disconnectWhatsappNumber,
  rotateWhatsappToken,
} from './actions';

const CLINIC = '33333333-3333-3333-3333-333333333333';
const connectInput = {
  clinicId: CLINIC,
  provider: 'meta' as const,
  phoneNumber: '+5511999990000',
  metaPhoneId: 'phone-1',
  token: 'SECRET_TOKEN',
};
const denied = () => {
  const e = new Error('forbidden');
  e.name = 'AuthError';
  requireSuperAdmin.mockRejectedValue(e);
};

beforeEach(() => {
  // `clearAllMocks` limpa CHAMADAS, não IMPLEMENTAÇÕES: um `mockImplementation` de um
  // teste vazaria para os seguintes e mataria o passthrough do `vi.hoisted`, deixando
  // a suíte dependente de ordem. Restaurar as implementações à mão é o que isola.
  vi.clearAllMocks();
  requireSuperAdmin.mockResolvedValue(undefined);
  encryptForTenant.mockResolvedValue('CIPHERTEXT');
  superAdminAction.mockImplementation(async (_opts: unknown, fn: (tx: unknown) => unknown) => fn({}));
});

describe('gate antes de parse/cripto', () => {
  it('connect: não-autorizado → nem cifra, nem toca no banco', async () => {
    denied();
    await expect(connectWhatsappNumber(connectInput)).rejects.toMatchObject({ name: 'AuthError' });
    expect(encryptForTenant).not.toHaveBeenCalled();
    expect(superAdminAction).not.toHaveBeenCalled();
  });

  it('rotate: não-autorizado → nem cifra, nem toca no banco', async () => {
    denied();
    await expect(rotateWhatsappToken(CLINIC, 'novo')).rejects.toMatchObject({ name: 'AuthError' });
    expect(encryptForTenant).not.toHaveBeenCalled();
    expect(superAdminAction).not.toHaveBeenCalled();
  });

  it('disconnect: não-autorizado → não toca no banco', async () => {
    denied();
    await expect(disconnectWhatsappNumber(CLINIC)).rejects.toMatchObject({ name: 'AuthError' });
    expect(superAdminAction).not.toHaveBeenCalled();
  });

  it('input inválido de não-autorizado → 403, NÃO ZodError (sem oráculo de schema)', async () => {
    denied();
    // Input malformado E chamador sem permissão: o 403 tem de vir primeiro, senão o
    // erro de validação conta ao anônimo como é o formato esperado.
    await expect(
      connectWhatsappNumber({ ...connectInput, clinicId: 'nao-uuid' }),
    ).rejects.toMatchObject({ name: 'AuthError' });
    await expect(disconnectWhatsappNumber('nao-uuid')).rejects.toMatchObject({ name: 'AuthError' });
    await expect(rotateWhatsappToken('nao-uuid', 'x')).rejects.toMatchObject({ name: 'AuthError' });
  });
});

describe('validação de clinicId (vem de input, não da sessão)', () => {
  it('disconnect: clinicId não-UUID → ZodError, sem tocar no banco', async () => {
    await expect(disconnectWhatsappNumber('../../etc/passwd')).rejects.toThrow();
    expect(superAdminAction).not.toHaveBeenCalled();
  });

  it('rotate: clinicId não-UUID → ZodError, sem cifrar', async () => {
    await expect(rotateWhatsappToken('nao-uuid', 'novo')).rejects.toThrow();
    expect(encryptForTenant).not.toHaveBeenCalled();
  });

  it('disconnect: UUID válido → segue', async () => {
    superAdminAction.mockImplementation(async () => ({ disconnected: true }));
    await expect(disconnectWhatsappNumber(CLINIC)).resolves.toEqual({ disconnected: true });
  });
});

describe('caminho autorizado preservado', () => {
  it('connect: cifra com o clinicId do input e delega ao superAdminAction', async () => {
    superAdminAction.mockImplementation(async () => ({ id: 'num-1' }));
    await expect(connectWhatsappNumber(connectInput)).resolves.toEqual({ id: 'num-1' });

    expect(requireSuperAdmin).toHaveBeenCalled();
    expect(encryptForTenant).toHaveBeenCalledWith(CLINIC, 'SECRET_TOKEN');
    // O token em claro nunca entra no payload forense.
    const opts = superAdminAction.mock.calls[0]![0] as { payload: unknown };
    expect(JSON.stringify(opts.payload)).not.toContain('SECRET_TOKEN');
  });

  it('rotate: cifra o token novo com o clinicId validado', async () => {
    superAdminAction.mockImplementation(async () => ({ tokenVersion: 2 }));
    await rotateWhatsappToken(CLINIC, 'TOKEN_NOVO');
    expect(encryptForTenant).toHaveBeenCalledWith(CLINIC, 'TOKEN_NOVO');
  });
});
