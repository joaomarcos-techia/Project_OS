import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  guardAdminAccess,
  assertOnboardingRuntimeReady,
  requireUser,
  createInviteTx,
  generateInviteToken,
  superAdminAction,
  sendTransactionalEmail,
  captureBackgroundError,
  emit,
  headersMock,
} = vi.hoisted(() => ({
  guardAdminAccess: vi.fn(),
  assertOnboardingRuntimeReady: vi.fn(),
  requireUser: vi.fn(),
  createInviteTx: vi.fn(),
  generateInviteToken: vi.fn(),
  superAdminAction: vi.fn(),
  sendTransactionalEmail: vi.fn(),
  captureBackgroundError: vi.fn(),
  emit: vi.fn(),
  headersMock: vi.fn(),
}));

vi.mock('next/headers', () => ({ headers: headersMock }));
vi.mock('../_lib/guard', () => ({ guardAdminAccess }));
vi.mock('@/lib/env', () => ({
  assertOnboardingRuntimeReady,
  env: { APP_BASE_URL: 'https://app.qoro.test', NODE_ENV: 'test' },
}));
vi.mock('@/lib/auth/tenant-context', () => ({ requireUser }));
vi.mock('@/lib/audit/request-context', () => ({
  buildRequestContext: () => ({ requestId: 'request-1', ip: null, userAgent: null }),
}));
vi.mock('@/lib/audit/super-admin', () => ({ superAdminAction }));
vi.mock('@/contexts/onboarding', () => ({
  cancelInviteTx: vi.fn(),
  createInviteTx,
  generateInviteToken,
}));
vi.mock('@/lib/email/resend', () => ({ sendTransactionalEmail }));
vi.mock('@/lib/observability/capture', () => ({ captureBackgroundError }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit } }));

import { createClinicInviteAction } from './onboarding-invites';

const RAW_TOKEN = 'a'.repeat(43);

function form(email: string): FormData {
  const data = new FormData();
  data.set('email', email);
  return data;
}

describe('createClinicInviteAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guardAdminAccess.mockResolvedValue(undefined);
    assertOnboardingRuntimeReady.mockReturnValue(undefined);
    requireUser.mockResolvedValue({ userId: '5d7da268-292b-4035-9fc0-972232dd7234' });
    generateInviteToken.mockReturnValue({ rawToken: RAW_TOKEN });
    createInviteTx.mockResolvedValue('invite-1');
    superAdminAction.mockImplementation(
      async (_options: unknown, action: (tx: unknown) => unknown) => action({}),
    );
    headersMock.mockResolvedValue(new Headers());
    sendTransactionalEmail.mockResolvedValue({ providerMessageId: 'email-1' });
  });

  it('envia o convite para o e-mail informado e mantém o link como contingência', async () => {
    await expect(
      createClinicInviteAction({ error: null }, form('gestor@example.com')),
    ).resolves.toEqual({
      error: null,
      link: `/join/${RAW_TOKEN}`,
      emailDelivery: 'sent',
    });

    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'gestor@example.com',
        idempotencyKey: 'onboarding-invite:invite-1',
        text: expect.stringContaining(`https://app.qoro.test/join/${RAW_TOKEN}`),
        html: expect.stringContaining(`https://app.qoro.test/join/${RAW_TOKEN}`),
      }),
    );
    expect(emit).toHaveBeenCalledWith('onboarding.invite_email.sent', {});
  });

  it('não cria outro convite se o Resend falhar e devolve o link manual corretamente', async () => {
    const providerError = new Error('Resend unavailable');
    sendTransactionalEmail.mockRejectedValue(providerError);

    await expect(
      createClinicInviteAction({ error: null }, form('gestor@example.com')),
    ).resolves.toEqual({
      error: null,
      link: `/join/${RAW_TOKEN}`,
      emailDelivery: 'failed',
    });

    expect(createInviteTx).toHaveBeenCalledTimes(1);
    expect(captureBackgroundError).toHaveBeenCalledWith(providerError, {
      flow: 'onboarding.invite_email',
    });
    expect(emit).toHaveBeenCalledWith('onboarding.invite_email.failed', {
      error: providerError,
    });
  });

  it('não chama o provedor de e-mail quando o super-admin deixa o e-mail vazio', async () => {
    await expect(createClinicInviteAction({ error: null }, form(''))).resolves.toEqual({
      error: null,
      link: `/join/${RAW_TOKEN}`,
    });

    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });
});
