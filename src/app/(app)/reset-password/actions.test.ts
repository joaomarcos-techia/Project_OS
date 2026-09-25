import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  advanceEpoch: vi.fn(),
  finishEpoch: vi.fn(),
  checkExposure: vi.fn(),
  allow: vi.fn(),
  bumpEpochIfCurrent: vi.fn(),
  clearSelector: vi.fn(),
  cookieDelete: vi.fn(),
  cookieGet: vi.fn(),
  cookies: vi.fn(),
  createServerClient: vi.fn(),
  getClientIp: vi.fn(),
  getAdminUser: vi.fn(),
  getUser: vi.fn(),
  hashEmail: vi.fn(),
  headers: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  markPasswordSet: vi.fn(),
  markOrphanConsumed: vi.fn(),
  isOrphanConsumed: vi.fn(),
  orphanLock: vi.fn(),
  readGrant: vi.fn(),
  readPasswordState: vi.fn(),
  readProfile: vi.fn(),
  redirect: vi.fn(),
  signOut: vi.fn(),
  updateAdminUser: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: mocks.cookies, headers: mocks.headers }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/contexts/onboarding', () => ({
  advanceSignupCredentialEpoch: mocks.advanceEpoch,
  checkSignupPasswordExposure: mocks.checkExposure,
  finishSignupCredentialEpoch: mocks.finishEpoch,
  markSignupPasswordSet: mocks.markPasswordSet,
  readSignupPasswordState: mocks.readPasswordState,
}));
vi.mock('@/lib/auth/email-hash', () => ({ hashEmail: mocks.hashEmail }));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertPasswordResetCompletionAllowed: mocks.allow,
  getClientIp: mocks.getClientIp,
}));
vi.mock('@/lib/auth/recovery-grant', () => ({
  RECOVERY_GRANT_COOKIE: 'qoro_rcv',
  readRecoveryGrant: mocks.readGrant,
}));
vi.mock('@/lib/auth/recovery-consumption', () => ({
  isOrphanRecoveryEpochConsumed: mocks.isOrphanConsumed,
  markOrphanRecoveryEpochConsumed: mocks.markOrphanConsumed,
}));
vi.mock('@/lib/auth/session-epoch', () => ({
  bumpSessionEpochIfCurrent: mocks.bumpEpochIfCurrent,
  withOrphanRecoveryLock: mocks.orphanLock,
}));
vi.mock('@/lib/auth/supabase-admin', () => ({
  createAdminClient: () => ({
    auth: {
      admin: { getUserById: mocks.getAdminUser, updateUserById: mocks.updateAdminUser },
    },
  }),
}));
vi.mock('@/lib/auth/supabase-server', () => ({
  clearSupabaseSessionSelector: mocks.clearSelector,
  createServerClient: mocks.createServerClient,
}));
vi.mock('@/lib/auth/tenant-context', () => ({
  readAuthoritativeProfile: mocks.readProfile,
}));
vi.mock('@/lib/observability/logger', () => ({
  logger: { warn: mocks.loggerWarn, error: mocks.loggerError },
}));

import { resetPasswordAction } from './actions';

const userId = '11111111-1111-4111-8111-111111111111';
const email = 'ana@example.test';
const signupRef = 'a'.repeat(64);
const authUpdatedAt = '2026-09-23T12:00:00.000Z';
const authUser = {
  id: userId,
  email,
  email_confirmed_at: '2026-09-23T11:00:00.000Z',
  updated_at: authUpdatedAt,
  app_metadata: { marker: 'pending' },
};
const supabase = {
  auth: {
    getUser: mocks.getUser,
    updateUser: mocks.updateUser,
    signOut: mocks.signOut,
  },
};

function form(password = 'SenhaForte7'): FormData {
  const data = new FormData();
  data.set('password', password);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  });
  mocks.cookies.mockResolvedValue({ get: mocks.cookieGet, delete: mocks.cookieDelete });
  mocks.cookieGet.mockReturnValue({ value: 'signed-grant' });
  mocks.headers.mockResolvedValue(new Headers());
  mocks.createServerClient.mockResolvedValue(supabase);
  mocks.getUser.mockResolvedValue({ data: { user: authUser } });
  mocks.hashEmail.mockReturnValue('email-hash');
  mocks.getClientIp.mockReturnValue('203.0.113.1');
  mocks.allow.mockResolvedValue({ ok: true });
  mocks.readProfile.mockResolvedValue(null);
  mocks.readPasswordState.mockImplementation((candidate: { app_metadata?: { marker?: string } }) =>
    candidate.app_metadata?.marker === 'set' ? 'set' : 'pending',
  );
  mocks.markPasswordSet.mockReturnValue({ marker: 'set' });
  mocks.markOrphanConsumed.mockImplementation(
    (metadata: Record<string, unknown>, epoch: number) => ({
      ...metadata,
      qoro_password_recovery_epoch: epoch,
    }),
  );
  mocks.isOrphanConsumed.mockImplementation(
    (metadata: Record<string, unknown> | undefined, epoch: number) =>
      metadata?.qoro_password_recovery_epoch === epoch,
  );
  mocks.orphanLock.mockImplementation(async (_userId: string, work: () => Promise<unknown>) =>
    work(),
  );
  mocks.advanceEpoch.mockResolvedValue({ ok: true, rowVersion: 8 });
  mocks.finishEpoch.mockResolvedValue({ ok: true, rowVersion: 9 });
  mocks.checkExposure.mockResolvedValue('safe');
  mocks.getAdminUser.mockResolvedValue({
    data: { user: { ...authUser, app_metadata: { marker: 'set' } } },
    error: null,
  });
  mocks.updateAdminUser.mockImplementation(
    async (_id: string, update: { app_metadata?: Record<string, unknown> }) => ({
      data: { user: { ...authUser, app_metadata: update.app_metadata } },
      error: null,
    }),
  );
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.clearSelector.mockResolvedValue(undefined);
  mocks.updateUser.mockResolvedValue({ error: null });
  mocks.bumpEpochIfCurrent.mockResolvedValue(true);
});

describe('resetPasswordAction', () => {
  it('aplica a politica compartilhada antes de abrir sessao', async () => {
    const result = await resetPasswordAction({ error: null }, form('abcdefgh'));
    expect(result.error).not.toBeNull();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it('preserva recovery de profile por claims_version e bump de sessao', async () => {
    mocks.readGrant.mockReturnValue({
      kind: 'profile',
      userId,
      epoch: 4,
      expiresAt: Date.now() + 60_000,
    });
    mocks.readProfile.mockResolvedValue({ claimsVersion: 4 });

    await expect(resetPasswordAction({ error: null }, form())).rejects.toThrow(
      'REDIRECT:/login?reason=password_updated',
    );

    expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'SenhaForte7' });
    expect(mocks.bumpEpochIfCurrent).toHaveBeenCalledWith(userId, 4, 'password_reset');
    expect(mocks.bumpEpochIfCurrent.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateUser.mock.invocationCallOrder[0]!,
    );
    expect(mocks.updateAdminUser).not.toHaveBeenCalled();
    expect(mocks.cookieDelete).toHaveBeenCalledWith('qoro_rcv');
  });

  it('consome row_version antes de instalar senha e marker no pretenant', async () => {
    mocks.readGrant.mockReturnValue({
      kind: 'pretenant',
      userId,
      epoch: 7,
      signupRef,
      expiresAt: Date.now() + 60_000,
    });

    await expect(resetPasswordAction({ error: null }, form())).rejects.toThrow(
      'REDIRECT:/login?reason=password_updated',
    );

    expect(mocks.advanceEpoch).toHaveBeenCalledWith({
      userId,
      signupRef,
      expectedRowVersion: 7,
      source: 'recovery',
    });
    expect(mocks.advanceEpoch.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateAdminUser.mock.invocationCallOrder[0]!,
    );
    expect(mocks.updateAdminUser).toHaveBeenCalledWith(userId, {
      password: 'SenhaForte7',
      app_metadata: { marker: 'set' },
    });
    expect(mocks.finishEpoch).toHaveBeenCalledWith({
      userId,
      signupRef,
      expectedRowVersion: 8,
      outcome: 'completed',
    });
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.bumpEpochIfCurrent).not.toHaveBeenCalled();
    expect(mocks.cookieDelete).toHaveBeenCalledWith('qoro_rcv');
  });

  it('replay/conflito consome o cookie e nunca toca a Admin API', async () => {
    mocks.readGrant.mockReturnValue({
      kind: 'pretenant',
      userId,
      epoch: 7,
      signupRef,
      expiresAt: Date.now() + 60_000,
    });
    mocks.advanceEpoch.mockResolvedValue({ ok: false, reason: 'conflict' });

    const result = await resetPasswordAction({ error: null }, form());
    expect(result.error).toContain('inválido');
    expect(mocks.cookieDelete).toHaveBeenCalledWith('qoro_rcv');
    expect(mocks.updateAdminUser).not.toHaveBeenCalled();
  });

  it('marker divergente falha antes do CAS', async () => {
    mocks.readGrant.mockReturnValue({
      kind: 'pretenant',
      userId,
      epoch: 7,
      signupRef,
      expiresAt: Date.now() + 60_000,
    });
    mocks.readPasswordState.mockReturnValue(null);

    const result = await resetPasswordAction({ error: null }, form());
    expect(result.error).toContain('inválido');
    expect(mocks.advanceEpoch).not.toHaveBeenCalled();
    expect(mocks.updateAdminUser).not.toHaveBeenCalled();
  });

  it.each(['pwned', 'unavailable'] as const)(
    'HIBP %s falha fechado antes de consumir o grant pending',
    async (exposure) => {
      mocks.readGrant.mockReturnValue({
        kind: 'pretenant',
        userId,
        epoch: 7,
        signupRef,
        expiresAt: Date.now() + 60_000,
      });
      mocks.checkExposure.mockResolvedValue(exposure);

      const result = await resetPasswordAction({ error: null }, form());
      expect(result.error).not.toBeNull();
      expect(mocks.advanceEpoch).not.toHaveBeenCalled();
      expect(mocks.updateAdminUser).not.toHaveBeenCalled();
    },
  );

  it('recovery consulta HIBP também quando o marker já está set', async () => {
    mocks.readGrant.mockReturnValue({
      kind: 'pretenant',
      userId,
      epoch: 7,
      signupRef,
      expiresAt: Date.now() + 60_000,
    });
    mocks.readPasswordState.mockReturnValue('set');
    mocks.checkExposure.mockResolvedValue('pwned');

    await expect(resetPasswordAction({ error: null }, form())).resolves.toEqual(
      expect.objectContaining({ error: expect.stringContaining('vazamentos') }),
    );
    expect(mocks.checkExposure).toHaveBeenCalledWith('SenhaForte7');
    expect(mocks.advanceEpoch).not.toHaveBeenCalled();
    expect(mocks.updateAdminUser).not.toHaveBeenCalled();
  });

  it('redefine senha de pretenant pronto mesmo depois que o draft expirou', async () => {
    mocks.readGrant.mockReturnValue({
      kind: 'pretenant_orphan',
      userId,
      epoch: Date.parse(authUpdatedAt),
      signupRef,
      expiresAt: Date.now() + 60_000,
    });
    mocks.readPasswordState.mockReturnValue('set');

    await expect(resetPasswordAction({ error: null }, form())).rejects.toThrow(
      'REDIRECT:/login?reason=password_updated',
    );

    expect(mocks.getAdminUser).toHaveBeenCalledWith(userId);
    expect(mocks.advanceEpoch).not.toHaveBeenCalled();
    expect(mocks.updateAdminUser).toHaveBeenCalledWith(userId, {
      password: 'SenhaForte7',
      app_metadata: {
        marker: 'set',
        qoro_password_recovery_epoch: Date.parse(authUpdatedAt),
      },
    });
    expect(mocks.orphanLock).toHaveBeenCalledWith(userId, expect.any(Function));
    expect(mocks.cookieDelete).toHaveBeenCalledWith('qoro_rcv');
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'global' });
  });

  it('recusa grant de orphan quando Auth mudou depois da emissão', async () => {
    mocks.readGrant.mockReturnValue({
      kind: 'pretenant_orphan',
      userId,
      epoch: Date.parse(authUpdatedAt) - 1,
      signupRef,
      expiresAt: Date.now() + 60_000,
    });
    mocks.readPasswordState.mockReturnValue('set');

    const result = await resetPasswordAction({ error: null }, form());

    expect(result.error).toContain('inválido');
    expect(mocks.updateAdminUser).not.toHaveBeenCalled();
    expect(mocks.cookieDelete).toHaveBeenCalledWith('qoro_rcv');
  });

  it('duas requisições profile com o mesmo grant deixam uma única senha tocar o Auth', async () => {
    mocks.readGrant.mockReturnValue({
      kind: 'profile',
      userId,
      epoch: 4,
      expiresAt: Date.now() + 60_000,
    });
    mocks.readProfile.mockResolvedValue({ claimsVersion: 4 });
    mocks.bumpEpochIfCurrent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const results = await Promise.allSettled([
      resetPasswordAction({ error: null }, form('SenhaForte7')),
      resetPasswordAction({ error: null }, form('OutraSenha8')),
    ]);

    expect(mocks.bumpEpochIfCurrent).toHaveBeenCalledTimes(2);
    expect(mocks.updateUser).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });

  it('falha Auth depois do CAS profile consome o grant e exige um link novo', async () => {
    mocks.readGrant.mockReturnValue({
      kind: 'profile',
      userId,
      epoch: 4,
      expiresAt: Date.now() + 60_000,
    });
    mocks.readProfile.mockResolvedValue({ claimsVersion: 4 });
    mocks.updateUser.mockResolvedValue({ error: { message: 'provider unavailable' } });

    const result = await resetPasswordAction({ error: null }, form());

    expect(result.error).toContain('novo link');
    expect(mocks.bumpEpochIfCurrent).toHaveBeenCalledTimes(1);
    expect(mocks.cookieDelete).toHaveBeenCalledWith('qoro_rcv');
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'global' });
  });

  it('serializa orphan e o marker impede duas senhas no mesmo epoch Auth', async () => {
    mocks.readGrant.mockReturnValue({
      kind: 'pretenant_orphan',
      userId,
      epoch: Date.parse(authUpdatedAt),
      signupRef,
      expiresAt: Date.now() + 60_000,
    });
    mocks.readPasswordState.mockReturnValue('set');

    let metadata: Record<string, unknown> = { marker: 'set' };
    let tail = Promise.resolve();
    mocks.orphanLock.mockImplementation(
      <T>(_lockedUserId: string, work: () => Promise<T>): Promise<T> => {
        const result = tail.then(work, work);
        tail = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
    );
    mocks.getAdminUser.mockImplementation(async () => ({
      data: { user: { ...authUser, app_metadata: metadata } },
      error: null,
    }));
    mocks.updateAdminUser.mockImplementation(
      async (_id: string, update: { app_metadata?: Record<string, unknown> }) => {
        metadata = update.app_metadata ?? {};
        return { data: { user: { ...authUser, app_metadata: metadata } }, error: null };
      },
    );

    const results = await Promise.allSettled([
      resetPasswordAction({ error: null }, form('SenhaForte7')),
      resetPasswordAction({ error: null }, form('OutraSenha8')),
    ]);

    expect(mocks.updateAdminUser).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });

  it('repara a reserva confirmada no Auth antes de uma nova mutação de recovery', async () => {
    mocks.readGrant.mockReturnValue({
      kind: 'pretenant',
      userId,
      epoch: 7,
      signupRef,
      expiresAt: Date.now() + 60_000,
    });
    mocks.readPasswordState.mockReturnValue('set');
    mocks.finishEpoch
      .mockResolvedValueOnce({ ok: true, rowVersion: 8 })
      .mockResolvedValueOnce({ ok: true, rowVersion: 10 });
    mocks.advanceEpoch.mockResolvedValue({ ok: true, rowVersion: 9 });

    await expect(resetPasswordAction({ error: null }, form())).rejects.toThrow(
      'REDIRECT:/login?reason=password_updated',
    );

    expect(mocks.finishEpoch).toHaveBeenNthCalledWith(1, {
      userId,
      signupRef,
      expectedRowVersion: 7,
      outcome: 'completed',
    });
    expect(mocks.advanceEpoch).toHaveBeenCalledWith({
      userId,
      signupRef,
      expectedRowVersion: 8,
      source: 'recovery',
    });
    expect(mocks.finishEpoch).toHaveBeenNthCalledWith(2, {
      userId,
      signupRef,
      expectedRowVersion: 9,
      outcome: 'completed',
    });
  });

  it('falha da Admin API ocorre depois do consumo e exige novo link', async () => {
    mocks.readGrant.mockReturnValue({
      kind: 'pretenant',
      userId,
      epoch: 7,
      signupRef,
      expiresAt: Date.now() + 60_000,
    });
    mocks.updateAdminUser.mockResolvedValue({ data: { user: authUser }, error: { message: 'x' } });

    const result = await resetPasswordAction({ error: null }, form());
    expect(result.error).toContain('novo link');
    expect(mocks.advanceEpoch).toHaveBeenCalledTimes(1);
    expect(mocks.cookieDelete).toHaveBeenCalledWith('qoro_rcv');
  });

  it('duas requisicoes concorrentes deixam somente o vencedor tocar a Admin API', async () => {
    mocks.readGrant.mockReturnValue({
      kind: 'pretenant',
      userId,
      epoch: 7,
      signupRef,
      expiresAt: Date.now() + 60_000,
    });
    mocks.advanceEpoch
      .mockResolvedValueOnce({ ok: true, rowVersion: 8 })
      .mockResolvedValueOnce({ ok: false, reason: 'conflict' });

    const results = await Promise.allSettled([
      resetPasswordAction({ error: null }, form('SenhaForte7')),
      resetPasswordAction({ error: null }, form('OutraSenha8')),
    ]);

    expect(mocks.updateAdminUser).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });

  it('nao mistura grant profile e conta pretenant nem grant pretenant e profile', async () => {
    mocks.readGrant.mockReturnValueOnce({
      kind: 'profile',
      userId,
      epoch: 4,
      expiresAt: Date.now() + 60_000,
    });
    await expect(resetPasswordAction({ error: null }, form())).resolves.toEqual(
      expect.objectContaining({ error: expect.stringContaining('inválido') }),
    );

    mocks.readGrant.mockReturnValueOnce({
      kind: 'pretenant',
      userId,
      epoch: 7,
      signupRef,
      expiresAt: Date.now() + 60_000,
    });
    mocks.readProfile.mockResolvedValueOnce({ claimsVersion: 9 });
    await expect(resetPasswordAction({ error: null }, form())).resolves.toEqual(
      expect.objectContaining({ error: expect.stringContaining('inválido') }),
    );
    expect(mocks.advanceEpoch).not.toHaveBeenCalled();
  });
});
