import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  captureBackgroundError: vi.fn(),
  createServerClient: vi.fn(),
  markMfaEnrolledForUser: vi.fn(),
  revalidatePath: vi.fn(),
  requireUser: vi.fn(),
  assertMfaAllowed: vi.fn(),
  enrollTotp: vi.fn(),
  listFactors: vi.fn(),
  unenrollTotp: vi.fn(),
  verifyTotpEnroll: vi.fn(),
  signOut: vi.fn(),
}));

class RedirectSignal extends Error {
  constructor(readonly target: string) {
    super(`redirect:${target}`);
  }
}

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (target: string) => {
    throw new RedirectSignal(target);
  },
}));
vi.mock('@/lib/auth/supabase-server', () => ({
  createServerClient: mocks.createServerClient,
}));
vi.mock('@/lib/auth/mfa', () => ({
  enrollTotp: mocks.enrollTotp,
  listFactors: mocks.listFactors,
  unenrollTotp: mocks.unenrollTotp,
  verifyTotpEnroll: mocks.verifyTotpEnroll,
}));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertMfaAllowed: mocks.assertMfaAllowed,
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/auth/tenant-context', () => ({
  markMfaEnrolledForUser: mocks.markMfaEnrolledForUser,
  requireUser: mocks.requireUser,
}));
vi.mock('@/lib/observability/capture', () => ({
  captureBackgroundError: mocks.captureBackgroundError,
}));

import { unenrollAction, verifyEnrollAction } from './actions';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const FACTOR_ID = 'factor-test';
const SUPABASE = { auth: { signOut: mocks.signOut } };
const PREVIOUS = {
  step: 'verifying' as const,
  factorId: FACTOR_ID,
  qrSvg: '<svg />',
  secret: 'test-secret',
  error: null,
};

function form(entries: Record<string, string>): FormData {
  const value = new FormData();
  for (const [key, entry] of Object.entries(entries)) value.set(key, entry);
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createServerClient.mockResolvedValue(SUPABASE);
  mocks.requireUser.mockResolvedValue({ userId: USER_ID, aal: 'aal2' });
  mocks.assertMfaAllowed.mockResolvedValue({ ok: true });
  mocks.verifyTotpEnroll.mockResolvedValue(undefined);
  mocks.unenrollTotp.mockResolvedValue(undefined);
  mocks.listFactors.mockResolvedValue([]);
  mocks.markMfaEnrolledForUser.mockResolvedValue(undefined);
  mocks.signOut.mockResolvedValue(undefined);
});

describe('verifyEnrollAction', () => {
  it('persiste pela função server-side e conclui o enrollment', async () => {
    const result = await verifyEnrollAction(
      PREVIOUS,
      form({ factorId: FACTOR_ID, code: '123456' }),
    );

    expect(mocks.markMfaEnrolledForUser).toHaveBeenCalledWith(USER_ID, true);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'others' });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/account/security');
    expect(result).toMatchObject({ step: 'done', factorId: null, error: null });
  });

  it('compensa o fator verificado quando a persistência falha', async () => {
    const persistError = new Error('database unavailable');
    mocks.markMfaEnrolledForUser.mockRejectedValue(persistError);

    const result = await verifyEnrollAction(
      PREVIOUS,
      form({ factorId: FACTOR_ID, code: '123456' }),
    );

    expect(mocks.unenrollTotp).toHaveBeenCalledWith(SUPABASE, FACTOR_ID);
    expect(mocks.captureBackgroundError).toHaveBeenCalledWith(persistError, {
      flow: 'auth.mfa.enroll_persist',
    });
    expect(result.error).toBe('Não foi possível concluir o MFA. Tente novamente.');
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('observa também a falha da compensação sem esconder a falha primária', async () => {
    const persistError = new Error('database unavailable');
    const compensationError = new Error('auth unavailable');
    mocks.markMfaEnrolledForUser.mockRejectedValue(persistError);
    mocks.unenrollTotp.mockRejectedValue(compensationError);

    const result = await verifyEnrollAction(
      PREVIOUS,
      form({ factorId: FACTOR_ID, code: '123456' }),
    );

    expect(mocks.captureBackgroundError).toHaveBeenCalledWith(compensationError, {
      flow: 'auth.mfa.enroll_compensation',
    });
    expect(mocks.captureBackgroundError).toHaveBeenCalledWith(persistError, {
      flow: 'auth.mfa.enroll_persist',
    });
    expect(result.error).toBe('Não foi possível concluir o MFA. Tente novamente.');
  });
});

describe('unenrollAction', () => {
  it('fica fail-closed e observa falha ao limpar o estado persistido', async () => {
    const persistError = new Error('database unavailable');
    mocks.markMfaEnrolledForUser.mockRejectedValue(persistError);

    await expect(unenrollAction(form({ factorId: FACTOR_ID }))).rejects.toMatchObject({
      target: '/account/security?unenroll_error=1',
    });

    expect(mocks.unenrollTotp).toHaveBeenCalledWith(SUPABASE, FACTOR_ID);
    expect(mocks.markMfaEnrolledForUser).toHaveBeenCalledWith(USER_ID, false);
    expect(mocks.captureBackgroundError).toHaveBeenCalledWith(persistError, {
      flow: 'auth.mfa.unenroll_persist',
    });
  });
});
