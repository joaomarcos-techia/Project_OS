import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const seams = vi.hoisted(() => ({
  createUser: vi.fn(),
  findUserByEmail: vi.fn(),
  generateLink: vi.fn(),
  getUserById: vi.fn(),
  sendEmail: vi.fn(),
  fetch: vi.fn(),
  loggerWarn: vi.fn(),
  metricsEmit: vi.fn(),
  readAttemptState: vi.fn(),
  readReferenceLiveness: vi.fn(),
  validateLegacyCandidate: vi.fn(),
}));

vi.mock('@/lib/auth/supabase-admin', () => ({
  findAdminUserByEmail: seams.findUserByEmail,
  createAdminClient: () => ({
    auth: {
      admin: {
        createUser: seams.createUser,
        generateLink: seams.generateLink,
        getUserById: seams.getUserById,
      },
    },
  }),
}));
vi.mock('./signup-session', () => ({
  readSignupDeliveryAttemptState: seams.readAttemptState,
  readSignupReferenceLiveness: seams.readReferenceLiveness,
}));
vi.mock('./signup-auth-admin', () => ({
  validateLegacySignupDeliveryCandidate: seams.validateLegacyCandidate,
}));
vi.mock('@/lib/email/resend', () => ({ sendTransactionalEmail: seams.sendEmail }));
vi.mock('@/lib/env', () => ({
  env: {
    APP_BASE_URL: 'https://app.qoro.test',
    NODE_ENV: 'test',
    MAGIC_TOKEN_SECRET: 'segredo-dedicado-de-teste',
  },
  assertEmailRuntimeReady: () => undefined,
}));
vi.mock('@/lib/observability/logger', () => ({
  logger: { warn: seams.loggerWarn, error: vi.fn() },
}));
vi.mock('@/lib/observability/metrics', () => ({
  metrics: { emit: seams.metricsEmit },
}));

import { resendSignupConfirmation, sendSignupConfirmation } from './signup-confirmation-email';

const email = 'ana@example.test';
const password = 'Abcdef1!';
const tokenHash = 'hash-novo';
const signupRef = 'a'.repeat(64);
const attemptEpoch = Date.parse('2026-09-23T12:00:00.000Z');
const pendingAppMetadata = {
  qoro_self_service_signup: {
    version: 1,
    kind: 'self_service',
    signup_ref: signupRef,
    password_state: 'pending',
  },
};

const publicOrigin = 'https://app.qoro.test';
const sendInitial = () =>
  sendSignupConfirmation({ email, password, signupRef, attemptEpoch, publicOrigin });
const resend = () => resendSignupConfirmation({ email, signupRef, attemptEpoch, publicOrigin });

function hibpSafe(): Response {
  return new Response(`${'0'.repeat(35)}:0\n`, { status: 200 });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', seams.fetch);
  seams.fetch.mockResolvedValue(hibpSafe());
  seams.createUser.mockResolvedValue({
    data: { user: { id: 'u1', email, email_confirmed_at: null, app_metadata: pendingAppMetadata } },
    error: null,
  });
  seams.generateLink.mockResolvedValue({
    data: {
      user: { id: 'u1', email, email_confirmed_at: null, app_metadata: pendingAppMetadata },
      properties: { hashed_token: tokenHash },
    },
    error: null,
  });
  seams.getUserById.mockResolvedValue({
    data: { user: { id: 'u1', email, email_confirmed_at: null, app_metadata: pendingAppMetadata } },
    error: null,
  });
  seams.readAttemptState.mockResolvedValue('pending');
  seams.readReferenceLiveness.mockResolvedValue('gone');
  seams.validateLegacyCandidate.mockResolvedValue({ ok: false, reason: 'obfuscated' });
  seams.findUserByEmail.mockResolvedValue({
    kind: 'found',
    user: { id: 'u1', email, email_confirmed_at: null, app_metadata: pendingAppMetadata },
  });
  seams.sendEmail.mockResolvedValue({ providerMessageId: 'msg_1' });
});

describe('sendSignupConfirmation', () => {
  it('cria a conta pendente uma vez e envia um recovery do /auth/confirm', async () => {
    await expect(sendInitial()).resolves.toEqual({ kind: 'sent' });

    expect(seams.createUser).toHaveBeenCalledWith({
      email,
      email_confirm: false,
      app_metadata: pendingAppMetadata,
    });
    expect(JSON.stringify(seams.createUser.mock.calls)).not.toContain(password);
    expect(seams.generateLink).toHaveBeenCalledWith({ type: 'recovery', email });
    expect(JSON.stringify(seams.generateLink.mock.calls)).not.toContain(password);

    const sent = seams.sendEmail.mock.calls[0]?.[0] as {
      to: string;
      html: string;
      text: string;
      idempotencyKey: string;
    };
    expect(sent.to).toBe(email);
    const link = `https://app.qoro.test/auth/confirm#token_hash=hash-novo&type=recovery&next=%2Fcadastro%2Fconfirmado&signup_ref=${signupRef}`;
    expect(sent.text).toContain(link);
    expect(sent.html).toContain(link.replaceAll('&', '&amp;'));
    expect(sent.html).not.toContain('/auth/v1/verify');
    expect(sent.idempotencyKey).toMatch(/^signup-confirmation:initial:[a-f0-9]{64}$/u);
    expect(sent.idempotencyKey).not.toContain(tokenHash);
  });

  it('rejeita senha vazada antes de tocar no Supabase ou no Resend', async () => {
    const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    seams.fetch.mockResolvedValue(new Response(`${sha1.slice(5)}:42\n`, { status: 200 }));

    await expect(sendInitial()).resolves.toEqual({
      kind: 'weak_password',
    });
    expect(seams.createUser).not.toHaveBeenCalled();
    expect(seams.generateLink).not.toHaveBeenCalled();
    expect(seams.sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    ['rede', () => seams.fetch.mockRejectedValue(new TypeError('network'))],
    ['HTTP', () => seams.fetch.mockResolvedValue(new Response('boom', { status: 503 }))],
    ['corpo inválido', () => seams.fetch.mockResolvedValue(new Response('invalido'))],
  ])('HIBP indisponível (%s) é retryable e não cria efeito', async (_case, arrange) => {
    arrange();

    await expect(sendInitial()).resolves.toEqual({
      kind: 'retryable',
    });
    expect(seams.createUser).not.toHaveBeenCalled();
    expect(seams.generateLink).not.toHaveBeenCalled();
    expect(seams.sendEmail).not.toHaveBeenCalled();
  });

  it('mantém a recusa de senha do próprio provedor como weak_password', async () => {
    seams.createUser.mockResolvedValue({ data: { user: null }, error: { code: 'weak_password' } });

    await expect(sendInitial()).resolves.toEqual({
      kind: 'weak_password',
    });
    expect(seams.generateLink).not.toHaveBeenCalled();
  });

  it('ofusca conta banida e não envia', async () => {
    seams.createUser.mockResolvedValue({ data: { user: null }, error: { code: 'user_banned' } });
    await expect(sendInitial()).resolves.toEqual({ kind: 'obfuscated' });
    expect(seams.generateLink).not.toHaveBeenCalled();
    expect(seams.sendEmail).not.toHaveBeenCalled();
  });

  it.each(['email_exists', 'user_already_exists'])(
    'emite para um draft novo quando a conta Qoro pendente ficou órfã: %s',
    async (code) => {
      const oldMetadata = {
        qoro_self_service_signup: {
          version: 1,
          kind: 'self_service',
          signup_ref: 'b'.repeat(64),
          password_state: 'pending',
        },
      };
      seams.createUser.mockResolvedValue({ data: { user: null }, error: { code } });
      seams.findUserByEmail.mockResolvedValue({
        kind: 'found',
        user: { id: 'u1', email, email_confirmed_at: null, app_metadata: oldMetadata },
      });
      seams.generateLink.mockResolvedValue({
        data: {
          user: { id: 'u1', email, email_confirmed_at: null, app_metadata: oldMetadata },
          properties: { hashed_token: tokenHash },
        },
        error: null,
      });

      await expect(sendInitial()).resolves.toEqual({ kind: 'sent' });
      expect(seams.generateLink).toHaveBeenCalledOnce();
      expect(seams.sendEmail).toHaveBeenCalledOnce();
    },
  );

  it('não rotaciona o link de outro draft enquanto a referência pendente está viva', async () => {
    const oldRef = 'b'.repeat(64);
    const oldMetadata = {
      qoro_self_service_signup: {
        version: 1,
        kind: 'self_service',
        signup_ref: oldRef,
        password_state: 'pending',
      },
    };
    seams.createUser.mockResolvedValue({ data: { user: null }, error: { code: 'email_exists' } });
    seams.findUserByEmail.mockResolvedValue({
      kind: 'found',
      user: { id: 'u1', email, email_confirmed_at: null, app_metadata: oldMetadata },
    });
    seams.readReferenceLiveness.mockResolvedValue('live');

    await expect(sendInitial()).resolves.toEqual({ kind: 'obfuscated' });

    expect(seams.readReferenceLiveness).toHaveBeenCalledWith({
      userId: 'u1',
      email,
      signupRef: oldRef,
    });
    expect(seams.generateLink).not.toHaveBeenCalled();
    expect(seams.sendEmail).not.toHaveBeenCalled();
  });

  it('envia para conta legada não confirmada sem escrever metadata antes do OTP', async () => {
    const legacy = { id: 'u1', email, email_confirmed_at: null, app_metadata: {} };
    seams.createUser.mockResolvedValue({
      data: { user: null },
      error: { code: 'email_exists' },
    });
    seams.findUserByEmail.mockResolvedValue({ kind: 'found', user: legacy });
    seams.validateLegacyCandidate.mockResolvedValue({ ok: true, user: legacy });
    seams.generateLink.mockResolvedValue({
      data: { user: legacy, properties: { hashed_token: tokenHash } },
      error: null,
    });
    seams.getUserById.mockResolvedValue({ data: { user: legacy }, error: null });

    await expect(sendInitial()).resolves.toEqual({ kind: 'sent' });
    expect(seams.validateLegacyCandidate).toHaveBeenCalledTimes(2);
    expect(seams.sendEmail).toHaveBeenCalledOnce();
  });

  it('mantém conta confirmada ofuscada ao detectar e-mail existente', async () => {
    seams.createUser.mockResolvedValue({
      data: { user: null },
      error: { code: 'email_exists' },
    });
    seams.findUserByEmail.mockResolvedValue({
      kind: 'found',
      user: { id: 'u1', email, email_confirmed_at: '2026-09-23T12:00:00Z' },
    });
    await expect(sendInitial()).resolves.toEqual({ kind: 'obfuscated' });
    expect(seams.generateLink).not.toHaveBeenCalled();
  });

  it.each([
    ['erro ao criar', { data: { user: null }, error: { code: 'internal_error' } }],
    ['criação sem usuário', { data: { user: null }, error: null }],
  ])('%s vira incerteza', async (_case, result) => {
    seams.createUser.mockResolvedValue(result);
    await expect(sendInitial()).resolves.toEqual({
      kind: 'uncertain',
    });
    expect(seams.generateLink).not.toHaveBeenCalled();
  });

  it.each([
    ['erro', { data: null, error: { code: 'internal_error' } }],
    ['sem token', { data: { user: { id: 'u1', email }, properties: {} }, error: null }],
    [
      'usuário divergente',
      {
        data: {
          user: { id: 'u2', email },
          properties: { hashed_token: tokenHash },
        },
        error: null,
      },
    ],
  ])('falha do link (%s) não envia', async (_case, result) => {
    seams.generateLink.mockResolvedValue(result);
    await expect(sendInitial()).resolves.toEqual({
      kind: 'uncertain',
    });
    expect(seams.sendEmail).not.toHaveBeenCalled();
  });

  it('falha de entrega é incerta porque a conta e o token já existem', async () => {
    seams.sendEmail.mockRejectedValue(new Error('provider rejected'));
    await expect(sendInitial()).resolves.toEqual({
      kind: 'uncertain',
    });
  });

  it('não deixa senha, e-mail ou token atravessarem para logs', async () => {
    seams.generateLink.mockResolvedValue({ data: null, error: { code: 'internal_error' } });
    await sendInitial();
    const logs = JSON.stringify(seams.loggerWarn.mock.calls);
    expect(logs).not.toContain(password);
    expect(logs).not.toContain(email);
    expect(logs).not.toContain(tokenHash);
  });
});

describe('resendSignupConfirmation', () => {
  it('usa recovery sem repassar a senha e entrega o link vinculado ao draft', async () => {
    await expect(resend()).resolves.toEqual({ kind: 'sent' });

    expect(seams.generateLink).toHaveBeenCalledWith({ type: 'recovery', email });
    expect(JSON.stringify(seams.generateLink.mock.calls)).not.toContain('password');
    const sent = seams.sendEmail.mock.calls[0]?.[0] as { subject: string; html: string };
    expect(sent.subject).toBe('Seu novo link de confirmação — Qoro');
    expect(sent.html).toContain('type=recovery');
    expect(sent.html).toContain(`signup_ref=${signupRef}`);
  });

  it('entrega o codigo novo se o callback antigo confirmou o mesmo draft durante o reenvio', async () => {
    seams.readAttemptState.mockResolvedValue('verified');
    seams.getUserById.mockResolvedValue({
      data: {
        user: {
          id: 'u1',
          email,
          email_confirmed_at: '2026-09-23T12:02:00Z',
          app_metadata: pendingAppMetadata,
        },
      },
      error: null,
    });

    await expect(resend()).resolves.toEqual({ kind: 'sent' });
    expect(seams.sendEmail).toHaveBeenCalledOnce();
  });

  it('revalida depois do generateLink e não envia tentativa substituída', async () => {
    const state = 'stale';
    const confirmedAt = null;
    seams.readAttemptState.mockResolvedValue(state);
    seams.getUserById.mockResolvedValue({
      data: {
        user: {
          id: 'u1',
          email,
          email_confirmed_at: confirmedAt,
          app_metadata: pendingAppMetadata,
        },
      },
      error: null,
    });

    await expect(resend()).resolves.toEqual({ kind: 'uncertain' });
    expect(seams.generateLink).toHaveBeenCalledOnce();
    expect(seams.sendEmail).not.toHaveBeenCalled();
  });

  it('retoma conta Qoro pending já confirmada sem reatar o marker antes do callback', async () => {
    const oldMetadata = {
      qoro_self_service_signup: {
        version: 1,
        kind: 'self_service',
        signup_ref: 'b'.repeat(64),
        password_state: 'pending',
      },
    };
    seams.findUserByEmail.mockResolvedValue({
      kind: 'found',
      user: {
        id: 'u1',
        email,
        email_confirmed_at: '2026-09-23T12:02:00Z',
        app_metadata: oldMetadata,
      },
    });
    seams.generateLink.mockResolvedValue({
      data: {
        user: {
          id: 'u1',
          email,
          email_confirmed_at: '2026-09-23T12:02:00Z',
          app_metadata: oldMetadata,
        },
        properties: { hashed_token: tokenHash },
      },
      error: null,
    });

    await expect(resend()).resolves.toEqual({ kind: 'sent' });
    expect(seams.generateLink).toHaveBeenCalledOnce();
    expect(seams.sendEmail).toHaveBeenCalledOnce();
  });

  it('não adota conta pendente sem marker Qoro', async () => {
    seams.findUserByEmail.mockResolvedValue({
      kind: 'found',
      user: { id: 'u1', email, email_confirmed_at: null, app_metadata: {} },
    });

    await expect(resend()).resolves.toEqual({ kind: 'obfuscated' });
    expect(seams.createUser).not.toHaveBeenCalled();
    expect(seams.generateLink).not.toHaveBeenCalled();
    expect(seams.sendEmail).not.toHaveBeenCalled();
  });

  it('reenvia para conta legada não confirmada validada sem mutação pré-OTP', async () => {
    const legacy = { id: 'u1', email, email_confirmed_at: null, app_metadata: {} };
    seams.findUserByEmail.mockResolvedValue({ kind: 'found', user: legacy });
    seams.validateLegacyCandidate.mockResolvedValue({ ok: true, user: legacy });
    seams.generateLink.mockResolvedValue({
      data: { user: legacy, properties: { hashed_token: tokenHash } },
      error: null,
    });
    seams.getUserById.mockResolvedValue({ data: { user: legacy }, error: null });

    await expect(resend()).resolves.toEqual({ kind: 'sent' });
    expect(seams.validateLegacyCandidate).toHaveBeenCalledTimes(2);
    expect(seams.sendEmail).toHaveBeenCalledOnce();
  });

  it('pode emitir link para novo draft sem trocar o marker antes do OTP', async () => {
    const oldMetadata = {
      qoro_self_service_signup: {
        version: 1,
        kind: 'self_service',
        signup_ref: 'b'.repeat(64),
        password_state: 'pending',
      },
    };
    seams.findUserByEmail.mockResolvedValue({
      kind: 'found',
      user: { id: 'u1', email, email_confirmed_at: null, app_metadata: oldMetadata },
    });
    seams.generateLink.mockResolvedValue({
      data: {
        user: { id: 'u1', email, email_confirmed_at: null, app_metadata: oldMetadata },
        properties: { hashed_token: tokenHash },
      },
      error: null,
    });

    await expect(resend()).resolves.toEqual({ kind: 'sent' });
    expect(seams.createUser).not.toHaveBeenCalled();
    expect(seams.generateLink).toHaveBeenCalledOnce();
    expect(seams.sendEmail).toHaveBeenCalledOnce();
  });

  it('reenvio não rotaciona link de outro draft ainda vivo', async () => {
    const oldRef = 'b'.repeat(64);
    const oldMetadata = {
      qoro_self_service_signup: {
        version: 1,
        kind: 'self_service',
        signup_ref: oldRef,
        password_state: 'pending',
      },
    };
    seams.findUserByEmail.mockResolvedValue({
      kind: 'found',
      user: { id: 'u1', email, email_confirmed_at: null, app_metadata: oldMetadata },
    });
    seams.readReferenceLiveness.mockResolvedValue('live');

    await expect(resend()).resolves.toEqual({ kind: 'obfuscated' });
    expect(seams.generateLink).not.toHaveBeenCalled();
    expect(seams.sendEmail).not.toHaveBeenCalled();
  });

  it('não entrega se a referência anterior volta a ficar autoritativa durante a emissão', async () => {
    const oldRef = 'b'.repeat(64);
    const oldMetadata = {
      qoro_self_service_signup: {
        version: 1,
        kind: 'self_service',
        signup_ref: oldRef,
        password_state: 'pending',
      },
    };
    seams.findUserByEmail.mockResolvedValue({
      kind: 'found',
      user: { id: 'u1', email, email_confirmed_at: null, app_metadata: oldMetadata },
    });
    seams.generateLink.mockResolvedValue({
      data: {
        user: { id: 'u1', email, email_confirmed_at: null, app_metadata: oldMetadata },
        properties: { hashed_token: tokenHash },
      },
      error: null,
    });
    seams.getUserById.mockResolvedValue({
      data: {
        user: { id: 'u1', email, email_confirmed_at: null, app_metadata: oldMetadata },
      },
      error: null,
    });
    seams.readReferenceLiveness.mockResolvedValueOnce('gone').mockResolvedValueOnce('live');

    await expect(resend()).resolves.toEqual({ kind: 'uncertain' });
    expect(seams.generateLink).toHaveBeenCalledOnce();
    expect(seams.sendEmail).not.toHaveBeenCalled();
  });

  it('reconcilia a tentativa incerta criando a conta que ainda não existe', async () => {
    seams.findUserByEmail.mockResolvedValue({ kind: 'missing' });

    await expect(resend()).resolves.toEqual({ kind: 'sent' });
    expect(seams.createUser).toHaveBeenCalledWith({
      email,
      email_confirm: false,
      app_metadata: pendingAppMetadata,
    });
    expect(seams.generateLink).toHaveBeenCalledWith({ type: 'recovery', email });
  });

  it('reenvio não recebe senha nem depende do HIBP', async () => {
    seams.fetch.mockRejectedValue(new TypeError('HIBP indisponível'));
    seams.findUserByEmail.mockResolvedValue({ kind: 'missing' });

    await expect(resend()).resolves.toEqual({ kind: 'sent' });
    expect(seams.fetch).not.toHaveBeenCalled();
    expect(seams.createUser).toHaveBeenCalledOnce();
  });

  it('reconcilia corrida de criação relendo a conta pendente antes de emitir o token', async () => {
    seams.findUserByEmail.mockResolvedValueOnce({ kind: 'missing' }).mockResolvedValueOnce({
      kind: 'found',
      user: { id: 'u1', email, email_confirmed_at: null, app_metadata: pendingAppMetadata },
    });
    seams.createUser.mockResolvedValue({
      data: { user: null },
      error: { code: 'email_exists' },
    });

    await expect(resend()).resolves.toEqual({ kind: 'sent' });
    expect(seams.findUserByEmail).toHaveBeenCalledTimes(2);
    expect(seams.createUser).toHaveBeenCalledTimes(1);
    expect(seams.generateLink).toHaveBeenCalledWith({ type: 'recovery', email });
  });

  it('ofusca corrida que encontra a conta já confirmada sem invalidar recovery', async () => {
    seams.findUserByEmail.mockResolvedValueOnce({ kind: 'missing' }).mockResolvedValueOnce({
      kind: 'found',
      user: { id: 'u1', email, email_confirmed_at: '2026-09-22T10:00:00Z' },
    });
    seams.createUser.mockResolvedValue({
      data: { user: null },
      error: { code: 'email_exists' },
    });

    await expect(resend()).resolves.toEqual({ kind: 'obfuscated' });
    expect(seams.generateLink).not.toHaveBeenCalled();
    expect(seams.sendEmail).not.toHaveBeenCalled();
  });

  it('não invalida um recovery legítimo de conta já confirmada', async () => {
    seams.findUserByEmail.mockResolvedValue({
      kind: 'found',
      user: { id: 'u1', email, email_confirmed_at: '2026-09-22T10:00:00Z' },
    });

    await expect(resend()).resolves.toEqual({ kind: 'obfuscated' });
    expect(seams.generateLink).not.toHaveBeenCalled();
    expect(seams.sendEmail).not.toHaveBeenCalled();
  });

  it('faz um único lookup indexado antes de decidir que a conta confirmada existe', async () => {
    seams.findUserByEmail.mockResolvedValue({
      kind: 'found',
      user: { id: 'u1', email, email_confirmed_at: '2026-09-22T10:00:00Z' },
    });
    await expect(resend()).resolves.toEqual({ kind: 'obfuscated' });
    expect(seams.findUserByEmail).toHaveBeenCalledOnce();
    expect(seams.findUserByEmail).toHaveBeenCalledWith(email);
    expect(seams.generateLink).not.toHaveBeenCalled();
  });

  it('falha de lookup é incerta e não emite token', async () => {
    seams.findUserByEmail.mockResolvedValue({ kind: 'unavailable' });
    await expect(resend()).resolves.toEqual({ kind: 'uncertain' });
    expect(seams.createUser).not.toHaveBeenCalled();
    expect(seams.generateLink).not.toHaveBeenCalled();
  });

  it.each([
    [
      'e-mail divergente',
      {
        data: {
          user: { id: 'u1', email: 'outra@example.test', email_confirmed_at: null },
          properties: { hashed_token: tokenHash },
        },
        error: null,
      },
    ],
    ['sem token', { data: { user: { id: 'u1', email }, properties: {} }, error: null }],
    ['erro operacional', { data: null, error: { code: 'internal_error' } }],
  ])('%s é incerteza e não envia', async (_case, result) => {
    seams.generateLink.mockResolvedValue(result);
    await expect(resend()).resolves.toEqual({ kind: 'uncertain' });
    expect(seams.sendEmail).not.toHaveBeenCalled();
  });
});
