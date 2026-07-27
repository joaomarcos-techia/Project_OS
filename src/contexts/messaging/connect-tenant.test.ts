/**
 * F2 — Conexão self-service do WhatsApp pelo owner (connectMyClinicWhatsapp /
 * disconnectMyClinicWhatsapp). I/O mockado (auth + graph + cripto + seam de
 * persistência). Cobre os Casos 1–3 do brief; o Caso 4 (ordem do upsert) vive em
 * src/lib/messaging/connection-store.test.ts (SQL com tx mockada).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as EnvModule from '@/lib/env';

const mocks = vi.hoisted(() => ({ after: vi.fn() }));

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('@/lib/audit/request-context', () => ({
  buildRequestContext: vi.fn(() => ({
    ip: null,
    userAgent: null,
    requestId: 'r',
    correlationId: 'r',
  })),
}));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireUser: vi.fn(async () => ({ userId: 'user-1' })),
  requireFreshPermission: vi.fn(async () => {}),
  requireClinicId: vi.fn(async () => 'clinic-1'),
  requireSuperAdmin: vi.fn(async () => {}),
}));
vi.mock('@/lib/env', async (importActual) => {
  const actual = await importActual<typeof EnvModule>();
  return { ...actual, assertWhatsappOnboardingReady: vi.fn() };
});
// Ciphertext fixo que NÃO embute o plaintext (o token real é 'SECRET_TOKEN_VALUE').
vi.mock('@/lib/crypto', () => ({
  encryptForTenant: vi.fn(async () => 'CIPHERTEXT_BLOB'),
  decryptForTenant: vi.fn(async () => 'plain-token'),
}));
vi.mock('./internal/meta-onboarding', () => ({
  exchangeCodeForToken: vi.fn(async () => 'SECRET_TOKEN_VALUE'),
  validateTokenScopes: vi.fn(async () => {}),
  resolveWabaAndPhone: vi.fn(async () => ({
    wabaId: 'waba-1',
    phoneNumberId: 'phone-1',
    phoneNumber: '+5511999991234',
  })),
  registerPhoneNumber: vi.fn(async () => {}),
  subscribeAppToWaba: vi.fn(async () => {}),
  unsubscribeAppFromWaba: vi.fn(async () => {}),
}));
vi.mock('@/lib/messaging', () => ({
  upsertTenantConnection: vi.fn(async () => ({ id: 'num-1' })),
  deactivateTenantConnection: vi.fn(async () => ({
    disconnected: true,
    metaBusinessId: null,
    tokenCiphertext: null,
  })),
  recordConnectionFailure: vi.fn(async () => {}),
  loadActiveNumberForSend: vi.fn(async () => null),
}));

import { requireClinicId } from '@/lib/auth/tenant-context';
import { encryptForTenant } from '@/lib/crypto';
import {
  deactivateTenantConnection,
  recordConnectionFailure,
  upsertTenantConnection,
} from '@/lib/messaging';

import { connectMyClinicWhatsapp, disconnectMyClinicWhatsapp } from './actions';
import * as onboarding from './internal/meta-onboarding';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireClinicId).mockResolvedValue('clinic-1');
  vi.mocked(upsertTenantConnection).mockResolvedValue({ id: 'num-1' });
  vi.mocked(deactivateTenantConnection).mockResolvedValue({
    disconnected: true,
    metaBusinessId: null,
    tokenCiphertext: null,
  });
  vi.mocked(onboarding.exchangeCodeForToken).mockResolvedValue('SECRET_TOKEN_VALUE');
  vi.mocked(onboarding.resolveWabaAndPhone).mockResolvedValue({
    wabaId: 'waba-1',
    phoneNumberId: 'phone-1',
    phoneNumber: '+5511999991234',
  });
});

describe('connectMyClinicWhatsapp', () => {
  it('Caso 1: conecta válido → persiste cifrado + retorna número mascarado', async () => {
    const res = await connectMyClinicWhatsapp({
      code: 'CODE',
      registrationPin: '123456',
      wabaHint: 'waba-1',
      phoneHint: 'phone-1',
    });

    // token em CLARO só vai para encryptForTenant
    expect(encryptForTenant).toHaveBeenCalledWith('clinic-1', 'SECRET_TOKEN_VALUE');
    expect(onboarding.registerPhoneNumber).toHaveBeenCalledWith(
      'phone-1',
      'SECRET_TOKEN_VALUE',
      '123456',
    );
    // webhook assinado
    expect(onboarding.subscribeAppToWaba).toHaveBeenCalledWith('waba-1', 'SECRET_TOKEN_VALUE');

    expect(upsertTenantConnection).toHaveBeenCalledTimes(1);
    expect(vi.mocked(onboarding.registerPhoneNumber).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(onboarding.subscribeAppToWaba).mock.invocationCallOrder[0]!,
    );
    expect(vi.mocked(onboarding.registerPhoneNumber).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(upsertTenantConnection).mock.invocationCallOrder[0]!,
    );
    const arg = vi.mocked(upsertTenantConnection).mock.calls[0]![0];
    expect(arg).toMatchObject({
      clinicId: 'clinic-1',
      userId: 'user-1',
      provider: 'meta',
      metaPhoneId: 'phone-1',
      metaBusinessId: 'waba-1',
      tokenEncrypted: 'CIPHERTEXT_BLOB',
    });
    // NUNCA o token em claro na persistência
    expect(JSON.stringify(arg)).not.toContain('SECRET_TOKEN_VALUE');
    expect(arg.tokenEncrypted).toBe('CIPHERTEXT_BLOB');

    // retorno mascarado, sem número completo
    expect(res.phoneNumberMasked).toMatch(/\*/);
    expect(res.phoneNumberMasked).not.toBe('+5511999991234');
    expect(res.id).toBe('num-1');
  });

  it('Caso 2: clinicId vem de requireClinicId() (sem param) — bloqueado não escreve', async () => {
    // a action NÃO aceita clinicId; isolamento = requireClinicId(). Se rejeitar
    // (usuário sem clínica / cross-tenant), nada é persistido.
    vi.mocked(requireClinicId).mockRejectedValueOnce(
      Object.assign(new Error('forbidden'), { name: 'AuthError' }),
    );

    await expect(
      connectMyClinicWhatsapp({ code: 'CODE', registrationPin: '123456' }),
    ).rejects.toThrow();
    expect(upsertTenantConnection).not.toHaveBeenCalled();
    expect(onboarding.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('Caso 3: Meta falha → MetaConnectError, audita falha, NENHUMA escrita', async () => {
    vi.mocked(onboarding.exchangeCodeForToken).mockRejectedValueOnce(new Error('meta down'));

    await expect(
      connectMyClinicWhatsapp({ code: 'CODE', registrationPin: '123456' }),
    ).rejects.toMatchObject({
      name: 'MetaConnectError',
      code: 'META_AUTH_FAILED',
    });
    expect(upsertTenantConnection).not.toHaveBeenCalled();
    expect(recordConnectionFailure).toHaveBeenCalledTimes(1);
  });

  it('registro do número falha → não assina webhook nem persiste conexão', async () => {
    vi.mocked(onboarding.registerPhoneNumber).mockRejectedValueOnce(new Error('register rejected'));

    await expect(
      connectMyClinicWhatsapp({ code: 'CODE', registrationPin: '123456' }),
    ).rejects.toMatchObject({ name: 'MetaConnectError', code: 'META_AUTH_FAILED' });

    expect(onboarding.subscribeAppToWaba).not.toHaveBeenCalled();
    expect(upsertTenantConnection).not.toHaveBeenCalled();
    expect(recordConnectionFailure).toHaveBeenCalledTimes(1);
  });

  it('número já ativo em outra clínica (unique 23505) → MetaConnectError amigável', async () => {
    vi.mocked(upsertTenantConnection).mockRejectedValueOnce(
      Object.assign(new Error('dup'), { code: '23505' }),
    );
    await expect(
      connectMyClinicWhatsapp({ code: 'CODE', registrationPin: '123456' }),
    ).rejects.toMatchObject({
      name: 'MetaConnectError',
    });
  });

  it('PIN inválido não chama a Meta nem persiste conexão', async () => {
    await expect(connectMyClinicWhatsapp({ code: 'CODE', registrationPin: '123' })).rejects.toThrow(
      'PIN do WhatsApp',
    );
    expect(onboarding.exchangeCodeForToken).not.toHaveBeenCalled();
    expect(upsertTenantConnection).not.toHaveBeenCalled();
  });
});

describe('disconnectMyClinicWhatsapp', () => {
  it('sem número ativo: pula unsubscribe e desativa', async () => {
    const res = await disconnectMyClinicWhatsapp();
    expect(onboarding.unsubscribeAppFromWaba).not.toHaveBeenCalled();
    expect(deactivateTenantConnection).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 'clinic-1', userId: 'user-1' }),
    );
    expect(res.disconnected).toBe(true);
  });

  it('com número ativo: desativa antes e agenda unsubscribe sem bloquear a resposta', async () => {
    vi.mocked(deactivateTenantConnection).mockResolvedValueOnce({
      disconnected: true,
      metaBusinessId: 'waba-1',
      tokenCiphertext: 'enc',
    });

    const res = await disconnectMyClinicWhatsapp();

    expect(res).toEqual({ disconnected: true });
    expect(deactivateTenantConnection).toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(onboarding.unsubscribeAppFromWaba).not.toHaveBeenCalled();

    const cleanup = mocks.after.mock.calls[0]![0] as () => Promise<void>;
    await cleanup();
    expect(onboarding.unsubscribeAppFromWaba).toHaveBeenCalledWith('waba-1', 'plain-token');
  });
});
