import { beforeEach, describe, expect, it, vi } from 'vitest';

const seams = vi.hoisted(() => ({
  send: vi.fn(),
  readProfile: vi.fn(),
  loggerWarn: vi.fn(),
  metricsEmit: vi.fn(),
  record: vi.fn(),
}));

vi.mock('@/lib/email/retry', () => ({ sendTransactionalEmailRetried: seams.send }));
vi.mock('@/lib/auth/tenant-context', () => ({ readAuthoritativeProfile: seams.readProfile }));
vi.mock('@/lib/env', () => ({
  env: { NODE_ENV: 'test', MAGIC_TOKEN_SECRET: 'segredo-dedicado-de-teste' },
}));
vi.mock('@/lib/observability/logger', () => ({ logger: { warn: seams.loggerWarn } }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: seams.metricsEmit } }));
vi.mock('./signup-email-code-repository', () => ({ recordSignupCodeDelivery: seams.record }));

import type { User } from '@supabase/supabase-js';

import { notifyExistingSignupAccount } from './signup-existing-account-notice';

const email = 'ana@example.test';
const signupRef = 'a'.repeat(64);
const attemptEpoch = Date.parse('2026-11-09T12:00:00.000Z');
const publicOrigin = 'https://app.qoro.test';

function user(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    email,
    email_confirmed_at: '2026-11-05T03:41:03Z',
    app_metadata: {
      qoro_self_service_signup: {
        version: 1,
        kind: 'self_service',
        signup_ref: 'b'.repeat(64),
        password_state: 'set',
      },
    },
    ...overrides,
  } as User;
}

const notify = (u: User, stage: 'initial' | 'resend' = 'initial', epoch = attemptEpoch) =>
  notifyExistingSignupAccount({
    user: u,
    email,
    signupRef,
    attemptEpoch: epoch,
    stage,
    publicOrigin,
  });

const activeProfile = { deletedAt: null, ativo: true, inviteAcceptedAt: new Date() };

beforeEach(() => {
  vi.clearAllMocks();
  seams.send.mockResolvedValue({ providerMessageId: '11111111-1111-4111-8111-111111111111' });
  seams.record.mockResolvedValue(undefined);
  seams.readProfile.mockResolvedValue(null);
});

describe('notifyExistingSignupAccount', () => {
  it('registra o recibo na sessão, para o status de entrega sair igual ao de um código', async () => {
    await notify(user());
    expect(seams.record).toHaveBeenCalledWith({
      signupRef,
      attemptEpoch,
      messageId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('sem aviso (conta que não entra), não registra recibo', async () => {
    await notify(user({ email_confirmed_at: '' }));
    expect(seams.record).not.toHaveBeenCalled();
  });

  it('falha ao registrar o recibo não muda o desfecho', async () => {
    seams.record.mockRejectedValue(new Error('[signup] stale email receipt'));
    await expect(notify(user())).resolves.toBeUndefined();
    expect(seams.loggerWarn).toHaveBeenCalledWith('signup.existing_account_notice.failed', {
      stage: 'initial',
      reason: 'Error',
    });
  });

  it('avisa quem já tem senha definida, só com o link de entrada', async () => {
    await notify(user());

    expect(seams.send).toHaveBeenCalledOnce();
    const sent = seams.send.mock.calls[0]?.[0];
    expect(sent.to).toBe(email);
    expect(sent.subject).toBe('Você já tem uma conta na Qoro');
    expect(sent.text).toContain(`${publicOrigin}/login`);
    expect(sent.idempotencyKey).toMatch(/^signup-existing-account:initial:[a-f0-9]{64}$/u);
    expect(sent.idempotencyKey).not.toContain(signupRef);
    expect(seams.metricsEmit).toHaveBeenCalledWith('signup.existing_account_notice.sent', {
      stage: 'initial',
    });
  });

  it('avisa membro com perfil ativo e convite aceito', async () => {
    seams.readProfile.mockResolvedValue(activeProfile);
    await notify(user({ app_metadata: {} }));
    expect(seams.send).toHaveBeenCalledOnce();
  });

  const pendente = {
    qoro_self_service_signup: {
      version: 1,
      kind: 'self_service',
      signup_ref: 'b'.repeat(64),
      password_state: 'pending',
    },
  };

  // P-29 (20/11/2026): cadastro confirmado que não concluiu a senha. O "Esqueci a senha" do
  // aviso instala a primeira senha; sem o aviso o novo cadastro ficava mudo e o status
  // "pendente" para sempre denunciava a conta.
  it('avisa cadastro confirmado que ainda não concluiu a senha, e registra o recibo', async () => {
    await notify(user({ app_metadata: pendente }));
    expect(seams.send).toHaveBeenCalledOnce();
    expect(seams.record).toHaveBeenCalledOnce();
  });

  it.each([
    ['e-mail não confirmado', user({ email_confirmed_at: '' })],
    ['conta bloqueada', user({ banned_until: '2999-01-01T00:00:00Z' } as Partial<User>)],
    ['e-mail divergente', user({ email: 'outra@example.test' })],
    ['cadastro pendente não confirmado', user({ app_metadata: pendente, email_confirmed_at: '' })],
    [
      'cadastro pendente de conta convidada',
      user({ app_metadata: pendente, invited_at: '2026-11-05T03:41:03Z' } as Partial<User>),
    ],
    [
      'cadastro pendente bloqueado',
      user({
        app_metadata: pendente,
        banned_until: '2999-01-01T00:00:00Z',
      } as Partial<User>),
    ],
  ])('não avisa: %s', async (_case, u) => {
    await notify(u);
    expect(seams.send).not.toHaveBeenCalled();
  });

  it.each([
    ['perfil removido', { ...activeProfile, deletedAt: new Date() }],
    ['perfil inativo', { ...activeProfile, ativo: false }],
    ['convite não aceito', { ...activeProfile, inviteAcceptedAt: null }],
  ])('não avisa membro com %s', async (_case, profile) => {
    seams.readProfile.mockResolvedValue(profile);
    await notify(user({ app_metadata: {} }));
    expect(seams.send).not.toHaveBeenCalled();
  });

  it('nunca rejeita e não registra o e-mail quando o envio falha', async () => {
    seams.send.mockRejectedValue(new Error(`provider rejected ${email}`));
    await expect(notify(user())).resolves.toBeUndefined();
    expect(seams.loggerWarn).toHaveBeenCalledWith('signup.existing_account_notice.failed', {
      stage: 'initial',
      reason: 'Error',
    });
    expect(JSON.stringify(seams.loggerWarn.mock.calls)).not.toContain(email);
  });

  it('nunca rejeita quando a leitura do perfil falha', async () => {
    seams.readProfile.mockRejectedValue(new Error('db down'));
    await expect(notify(user({ app_metadata: {} }))).resolves.toBeUndefined();
    expect(seams.send).not.toHaveBeenCalled();
  });

  it('repete a chave na mesma tentativa e muda entre tentativas e etapas', async () => {
    await notify(user());
    await notify(user());
    await notify(user(), 'initial', attemptEpoch + 1);
    await notify(user(), 'resend');
    const keys = seams.send.mock.calls.map((call) => call[0].idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(new Set(keys).size).toBe(3);
  });
});
