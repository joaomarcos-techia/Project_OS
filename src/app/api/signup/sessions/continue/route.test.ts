import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  allow: vi.fn(),
  adopt: vi.fn(),
  advanceEpoch: vi.fn(),
  finishEpoch: vi.fn(),
  checkExposure: vi.fn(),
  clearSelector: vi.fn(),
  createServerClient: vi.fn(),
  getClientIp: vi.fn(),
  hashEmail: vi.fn(),
  hashToken: vi.fn(),
  getUserById: vi.fn(),
  updateUserById: vi.fn(),
  markPasswordSet: vi.fn(),
  readPasswordState: vi.fn(),
  readIdentity: vi.fn(),
  rebindPending: vi.fn(),
  resolvePreTenant: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  verifyCode: vi.fn(),
}));

vi.mock('@/contexts/onboarding', async () => {
  const { z } = await import('zod');
  return {
    adoptVerifiedSignupForContinuation: mocks.adopt,
    advanceSignupCredentialEpoch: mocks.advanceEpoch,
    finishSignupCredentialEpoch: mocks.finishEpoch,
    checkSignupPasswordExposure: mocks.checkExposure,
    hashSignupToken: mocks.hashToken,
    markSignupPasswordSet: mocks.markPasswordSet,
    readSignupContinuationIdentity: mocks.readIdentity,
    readSignupPasswordState: mocks.readPasswordState,
    rebindPendingSignupAppMetadata: mocks.rebindPending,
    signupContinuationSchema: z
      .object({
        rowVersion: z.number().int().min(1).max(2_147_483_646),
        email: z.string().trim().max(160).email(),
        password: z
          .string()
          .min(8)
          .max(72)
          .regex(/[A-Z]/u)
          .regex(/[a-z]/u)
          .regex(/[0-9]/u)
          .regex(/^\S+$/u),
        verificationCode: z.string().regex(/^\d{8}$/u),
      })
      .strict(),
    verifySignupHandoffCode: mocks.verifyCode,
  };
});
vi.mock('@/lib/auth/email-hash', () => ({ hashEmail: mocks.hashEmail }));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertSignupContinuationAllowed: mocks.allow,
  getClientIp: mocks.getClientIp,
}));
vi.mock('@/lib/auth/pretenant-onboarding', () => ({
  resolvePreTenantOnboarding: mocks.resolvePreTenant,
}));
vi.mock('@/lib/auth/supabase-server', () => ({
  clearSupabaseSessionSelector: mocks.clearSelector,
  createServerClient: mocks.createServerClient,
}));
vi.mock('@/lib/auth/supabase-admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: mocks.getUserById, updateUserById: mocks.updateUserById } },
  }),
}));
vi.mock('@/lib/env', () => ({
  env: {
    APP_BASE_URL: 'https://app.qoro.test',
    NODE_ENV: 'test',
    SIGNUP_AUTH_ENABLED: true,
    SIGNUP_IDENTITY_ENABLED: true,
  },
}));

import { POST } from './route';

const token = 'a'.repeat(43);
const userId = '11111111-1111-4111-8111-111111111111';
const input = {
  rowVersion: 7,
  email: 'ana@example.test',
  password: 'SenhaForte7',
  verificationCode: '12345678',
};
const client = {
  auth: { signInWithPassword: mocks.signIn, signOut: mocks.signOut },
};

function request(
  body: unknown = input,
  options: { origin?: string; cookie?: string; secFetchSite?: string } = {},
): Request {
  return new Request('https://app.qoro.test/api/signup/sessions/continue', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: options.origin ?? 'https://app.qoro.test',
      cookie: options.cookie ?? `__Host-qoro_signup=${token}`,
      ...(options.secFetchSite ? { 'sec-fetch-site': options.secFetchSite } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClientIp.mockReturnValue('203.0.113.7');
  mocks.hashToken.mockReturnValue('token-hash');
  mocks.hashEmail.mockReturnValue('email-hash');
  mocks.allow.mockResolvedValue({ ok: true });
  mocks.advanceEpoch.mockResolvedValue({ ok: true, rowVersion: 8 });
  mocks.finishEpoch.mockResolvedValue({ ok: true, rowVersion: 9 });
  mocks.readIdentity.mockResolvedValue({
    ok: true,
    userId,
    attemptEpoch: 1_795_000_060_000,
    codeSignupRef: 'token-hash',
    credentialRowVersion: input.rowVersion,
    credentialState: 'completed',
    adoption: null,
  });
  mocks.checkExposure.mockResolvedValue('safe');
  mocks.verifyCode.mockReturnValue(true);
  mocks.getUserById.mockResolvedValue({
    data: {
      user: {
        id: userId,
        email: input.email,
        email_confirmed_at: '2026-09-23T12:00:00Z',
        app_metadata: { state: 'pending' },
      },
    },
    error: null,
  });
  mocks.readPasswordState.mockImplementation(
    (user: { app_metadata?: { state?: string } }) => user.app_metadata?.state ?? null,
  );
  mocks.markPasswordSet.mockReturnValue({ state: 'set' });
  mocks.rebindPending.mockReturnValue({ state: 'pending' });
  mocks.adopt.mockResolvedValue({ ok: true, rowVersion: 8 });
  mocks.updateUserById.mockResolvedValue({
    data: { user: { app_metadata: { state: 'set' } } },
    error: null,
  });
  mocks.createServerClient.mockResolvedValue(client);
  mocks.signIn.mockResolvedValue({
    data: { user: { id: userId }, session: { access_token: 'redacted' } },
    error: null,
  });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.resolvePreTenant.mockResolvedValue({
    ok: true,
    kind: 'pretenant',
    userId,
    email: input.email,
  });
});

describe('POST /api/signup/sessions/continue', () => {
  it('instala a sessão somente para a identidade vinculada e limpa o cookie anônimo', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.allow).toHaveBeenCalledWith('203.0.113.7', 'token-hash', 'email-hash');
    expect(mocks.readIdentity).toHaveBeenCalledWith(token, input);
    expect(mocks.verifyCode).toHaveBeenCalledWith(
      'token-hash',
      1_795_000_060_000,
      input.verificationCode,
    );
    expect(mocks.getUserById).toHaveBeenCalledWith(userId);
    expect(mocks.updateUserById).toHaveBeenCalledWith(userId, {
      password: input.password,
      app_metadata: { state: 'set' },
    });
    expect(mocks.advanceEpoch).toHaveBeenCalledWith({
      userId,
      signupRef: 'token-hash',
      expectedRowVersion: input.rowVersion,
      source: 'continuation',
    });
    expect(mocks.advanceEpoch.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateUserById.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.updateUserById.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.finishEpoch.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.finishEpoch).toHaveBeenCalledWith({
      userId,
      signupRef: 'token-hash',
      expectedRowVersion: 8,
      outcome: 'completed',
    });
    expect(mocks.finishEpoch.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signIn.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.createServerClient).toHaveBeenCalledWith({
      cookieWrites: 'required',
      newSession: true,
    });
    expect(mocks.signIn).toHaveBeenCalledWith({ email: input.email, password: input.password });
    expect(mocks.resolvePreTenant).toHaveBeenCalledWith(client);
    expect(response.headers.get('set-cookie')).toContain('__Host-qoro_signup=');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('não repete escrita Auth quando a tentativa normal está uncertain e o marker segue pending', async () => {
    mocks.readIdentity.mockResolvedValue({
      ok: true,
      userId,
      attemptEpoch: 1_795_000_060_000,
      codeSignupRef: 'token-hash',
      credentialRowVersion: input.rowVersion,
      credentialState: 'uncertain',
      adoption: null,
    });
    mocks.advanceEpoch.mockResolvedValue({ ok: false, reason: 'conflict' });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it('reconcilia marker set com DB uncertain sem escrever a senha outra vez', async () => {
    mocks.readIdentity.mockResolvedValue({
      ok: true,
      userId,
      attemptEpoch: 1_795_000_060_000,
      codeSignupRef: 'token-hash',
      credentialRowVersion: input.rowVersion,
      credentialState: 'uncertain',
      adoption: null,
    });
    mocks.getUserById.mockResolvedValue({
      data: {
        user: {
          id: userId,
          email: input.email,
          email_confirmed_at: '2026-09-23T12:00:00Z',
          app_metadata: { state: 'set' },
        },
      },
      error: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.advanceEpoch).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.finishEpoch).toHaveBeenCalledWith({
      userId,
      signupRef: 'token-hash',
      expectedRowVersion: input.rowVersion,
      outcome: 'completed',
    });
  });

  it('o dono do e-mail adota a segunda sessão com o código sem rotacionar o link vivo', async () => {
    const sourceSignupRef = 'd'.repeat(64);
    mocks.readIdentity.mockResolvedValue({
      ok: true,
      userId,
      attemptEpoch: 1_795_000_060_000,
      codeSignupRef: sourceSignupRef,
      credentialRowVersion: 9,
      credentialState: 'completed',
      adoption: { targetRowVersion: input.rowVersion },
    });
    mocks.getUserById.mockResolvedValue({
      data: {
        user: {
          id: userId,
          email: input.email,
          email_confirmed_at: '2026-09-23T12:00:00Z',
          app_metadata: { ref: sourceSignupRef, state: 'pending' },
        },
      },
      error: null,
    });
    mocks.readPasswordState.mockImplementation(
      (user: { app_metadata?: { ref?: string; state?: string } }, ref: string) =>
        user.app_metadata?.ref === ref ? (user.app_metadata.state ?? null) : null,
    );
    mocks.rebindPending.mockReturnValue({ ref: 'token-hash', state: 'pending' });
    mocks.markPasswordSet.mockReturnValue({ ref: 'token-hash', state: 'set' });
    mocks.updateUserById.mockResolvedValue({
      data: { user: { app_metadata: { ref: 'token-hash', state: 'set' } } },
      error: null,
    });
    mocks.advanceEpoch.mockResolvedValue({ ok: true, rowVersion: 10 });
    mocks.adopt.mockResolvedValue({ ok: true, rowVersion: 8 });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.verifyCode).toHaveBeenCalledWith(
      sourceSignupRef,
      1_795_000_060_000,
      input.verificationCode,
    );
    expect(mocks.advanceEpoch).toHaveBeenCalledWith({
      userId,
      signupRef: sourceSignupRef,
      expectedRowVersion: 9,
      source: 'adoption',
    });
    expect(mocks.updateUserById).toHaveBeenCalledWith(userId, {
      password: input.password,
      app_metadata: { ref: 'token-hash', state: 'set' },
    });
    expect(mocks.adopt).toHaveBeenCalledWith({
      rawToken: token,
      email: input.email,
      targetRowVersion: input.rowVersion,
      userId,
      sourceSignupRef,
      sourceRowVersion: 10,
      attemptEpoch: 1_795_000_060_000,
    });
    expect(mocks.finishEpoch).not.toHaveBeenCalled();
  });

  it('retoma a adoção depois de resposta Auth perdida sem sobrescrever a senha', async () => {
    const sourceSignupRef = 'd'.repeat(64);
    mocks.readIdentity.mockResolvedValue({
      ok: true,
      userId,
      attemptEpoch: 1_795_000_060_000,
      codeSignupRef: sourceSignupRef,
      credentialRowVersion: 10,
      credentialState: 'uncertain',
      adoption: { targetRowVersion: input.rowVersion },
    });
    mocks.getUserById.mockResolvedValue({
      data: {
        user: {
          id: userId,
          email: input.email,
          email_confirmed_at: '2026-09-23T12:00:00Z',
          app_metadata: { ref: 'token-hash', state: 'set' },
        },
      },
      error: null,
    });
    mocks.readPasswordState.mockImplementation(
      (user: { app_metadata?: { ref?: string; state?: string } }, ref: string) =>
        user.app_metadata?.ref === ref ? (user.app_metadata.state ?? null) : null,
    );

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.advanceEpoch).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.adopt).toHaveBeenCalledWith(
      expect.objectContaining({ sourceSignupRef, sourceRowVersion: 10 }),
    );
  });

  it('falha fechado se o Auth mudou para o alvo, mas a adoção SQL não confirmou', async () => {
    const sourceSignupRef = 'd'.repeat(64);
    mocks.readIdentity.mockResolvedValue({
      ok: true,
      userId,
      attemptEpoch: 1_795_000_060_000,
      codeSignupRef: sourceSignupRef,
      credentialRowVersion: 9,
      credentialState: 'completed',
      adoption: { targetRowVersion: input.rowVersion },
    });
    mocks.getUserById.mockResolvedValue({
      data: {
        user: {
          id: userId,
          email: input.email,
          email_confirmed_at: '2026-09-23T12:00:00Z',
          app_metadata: { ref: sourceSignupRef, state: 'pending' },
        },
      },
      error: null,
    });
    mocks.readPasswordState.mockImplementation(
      (user: { app_metadata?: { ref?: string; state?: string } }, ref: string) =>
        user.app_metadata?.ref === ref ? (user.app_metadata.state ?? null) : null,
    );
    mocks.rebindPending.mockReturnValue({ ref: 'token-hash', state: 'pending' });
    mocks.markPasswordSet.mockReturnValue({ ref: 'token-hash', state: 'set' });
    mocks.updateUserById.mockResolvedValue({
      data: { user: { app_metadata: { ref: 'token-hash', state: 'set' } } },
      error: null,
    });
    mocks.advanceEpoch.mockResolvedValue({ ok: true, rowVersion: 10 });
    mocks.adopt.mockResolvedValue({ ok: false, reason: 'unavailable' });

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(mocks.updateUserById).toHaveBeenCalledOnce();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it.each([
    ['origem divergente', request(input, { origin: 'https://evil.example' })],
    ['fetch cross-site', request(input, { secFetchSite: 'cross-site' })],
  ])('bloqueia %s antes do limite e do Auth', async (_case, req) => {
    const response = await POST(req);
    expect(response.status).toBe(403);
    expect(mocks.allow).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it('rejeita corpo com id escolhido pelo browser', async () => {
    const response = await POST(request({ ...input, userId }));
    expect(response.status).toBe(400);
    expect(mocks.allow).not.toHaveBeenCalled();
  });

  it.each([
    { ...input, verificationCode: '1234567' },
    { ...input, verificationCode: 'abcdefgh' },
    { rowVersion: input.rowVersion, email: input.email, password: input.password },
  ])('exige código de handoff estrito no corpo: %#', async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(mocks.readIdentity).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('cookie ausente é 410 e é apagado', async () => {
    const response = await POST(request(input, { cookie: 'outra=1' }));
    expect(response.status).toBe(410);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(mocks.allow).not.toHaveBeenCalled();
  });

  it('propaga o rate limit sem tentar senha', async () => {
    mocks.allow.mockResolvedValue({ ok: false, reason: 'rate_limited', retryAfter: 37 });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('37');
    expect(mocks.readIdentity).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it.each([
    ['gone', 410],
    ['conflict', 409],
    ['unavailable', 503],
  ] as const)('mapeia identidade %s sem tocar no Auth', async (reason, status) => {
    mocks.readIdentity.mockResolvedValue({ ok: false, reason });
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it('nega código incorreto antes de ler ou alterar a conta Auth', async () => {
    mocks.verifyCode.mockReturnValue(false);
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.getUserById).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it.each([
    ['referência divergente', null, '2026-09-23T12:00:00Z'],
    ['e-mail não verificado', 'pending', null],
  ])('não instala senha quando o vínculo Auth falha: %s', async (_case, state, confirmedAt) => {
    mocks.readPasswordState.mockReturnValue(state);
    mocks.getUserById.mockResolvedValue({
      data: {
        user: {
          id: userId,
          email: input.email,
          email_confirmed_at: confirmedAt,
          app_metadata: {},
        },
      },
      error: null,
    });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it('retry após a senha já gravada só autentica; nunca sobrescreve a credencial', async () => {
    mocks.getUserById.mockResolvedValue({
      data: {
        user: {
          id: userId,
          email: input.email,
          email_confirmed_at: '2026-09-23T12:00:00Z',
          app_metadata: { state: 'set' },
        },
      },
      error: null,
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.advanceEpoch).not.toHaveBeenCalled();
    expect(mocks.checkExposure).not.toHaveBeenCalled();
    expect(mocks.finishEpoch).toHaveBeenCalledWith({
      userId,
      signupRef: 'token-hash',
      expectedRowVersion: input.rowVersion,
      outcome: 'completed',
    });
    expect(mocks.signIn).toHaveBeenCalledOnce();
  });

  it.each([
    ['pwned', 422, 'weak_password'],
    ['unavailable', 503, 'unavailable'],
  ] as const)('HIBP %s falha antes do CAS e da Admin API', async (exposure, status, error) => {
    mocks.checkExposure.mockResolvedValue(exposure);
    const response = await POST(request());
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error });
    expect(mocks.advanceEpoch).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it.each([
    ['gone', 410],
    ['conflict', 409],
    ['unavailable', 503],
  ] as const)('CAS do epoch %s bloqueia Admin API e login', async (reason, status) => {
    mocks.advanceEpoch.mockResolvedValue({ ok: false, reason });
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it('mantém uma única escrita Admin mesmo se /me já expôs o epoch reservado', async () => {
    let releaseUpdate!: () => void;
    const updatePending = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });
    mocks.advanceEpoch
      .mockResolvedValueOnce({ ok: true, rowVersion: 8 })
      .mockResolvedValueOnce({ ok: false, reason: 'conflict' });
    mocks.updateUserById.mockImplementationOnce(async () => {
      await updatePending;
      return {
        data: { user: { app_metadata: { state: 'set' } } },
        error: null,
      };
    });

    const first = POST(request());
    await vi.waitFor(() => expect(mocks.updateUserById).toHaveBeenCalledOnce());

    const second = await POST(request({ ...input, rowVersion: 8, password: 'OutraSenha8' }));
    expect(second.status).toBe(409);
    expect(mocks.updateUserById).toHaveBeenCalledOnce();

    releaseUpdate();
    await expect(first).resolves.toMatchObject({ status: 200 });
    expect(mocks.updateUserById).toHaveBeenCalledOnce();
  });

  it.each(['lookup', 'update'] as const)(
    'falha operacional de %s é 503 sem login',
    async (stage) => {
      if (stage === 'lookup') {
        mocks.getUserById.mockResolvedValue({ data: { user: null }, error: { code: 'internal' } });
      } else {
        mocks.updateUserById.mockResolvedValue({
          data: { user: { app_metadata: { state: 'pending' } } },
          error: { code: 'internal' },
        });
      }
      const response = await POST(request());
      expect(response.status).toBe(503);
      expect(mocks.signIn).not.toHaveBeenCalled();
      if (stage === 'update') {
        expect(mocks.finishEpoch).toHaveBeenCalledWith({
          userId,
          signupRef: 'token-hash',
          expectedRowVersion: 8,
          outcome: 'uncertain',
        });
      }
    },
  );

  it('senha aplicada com finish indisponível volta 503 sem repetir a Admin API', async () => {
    mocks.finishEpoch.mockResolvedValue({ ok: false, reason: 'unavailable' });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(mocks.updateUserById).toHaveBeenCalledOnce();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it('credencial inválida não apaga a prova anônima e limpa qualquer sessão parcial', async () => {
    mocks.signIn.mockResolvedValue({ data: { user: null, session: null }, error: { code: 'bad' } });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.clearSelector).toHaveBeenCalledTimes(1);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('usuário divergente é removido antes da resposta', async () => {
    mocks.signIn.mockResolvedValue({
      data: { user: { id: '22222222-2222-4222-8222-222222222222' }, session: {} },
      error: null,
    });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.resolvePreTenant).not.toHaveBeenCalled();
  });

  it('pós-condição com profile ou outra identidade falha fechado', async () => {
    mocks.resolvePreTenant.mockResolvedValue({ ok: true, kind: 'redirect', route: '/dashboard' });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
