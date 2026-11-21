import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  metric: vi.fn(),
  env: {
    APP_BASE_URL: 'https://app.qoro.test',
    MAGIC_TOKEN_SECRET: 'test-secret-32-bytes-minimum-value',
    VERCEL_ENV: undefined as 'preview' | undefined,
    VERCEL_BRANCH_URL: undefined as string | undefined,
  },
}));

vi.mock('@/lib/email/resend', () => ({ sendTransactionalEmail: mocks.send }));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.metric } }));

import { deliverTeamInviteEmail } from './team-invite-email';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.VERCEL_ENV = undefined;
  mocks.env.VERCEL_BRANCH_URL = undefined;
  mocks.send.mockResolvedValue({ providerMessageId: 'email_1' });
});

describe('deliverTeamInviteEmail', () => {
  it('no Preview, o convite sai no alias da branch e passa pela trava de origem do template', async () => {
    mocks.env.VERCEL_ENV = 'preview';
    mocks.env.VERCEL_BRANCH_URL = 'branch-atual.vercel.app';
    const { link } = await deliverTeamInviteEmail({
      email: 'ana@example.test',
      tokenHash: 'token-secreto',
      stage: 'initial',
      inviteeName: 'Ana',
      clinicName: 'Clínica Vida',
      roleLabel: 'Atendente',
      inviterName: 'Bruno',
    });
    expect(new URL(link).origin).toBe('https://branch-atual.vercel.app');
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it('envia pelo Resend sem expor o token na chave de idempotência', async () => {
    const tokenHash = 'token-secreto';
    const result = await deliverTeamInviteEmail({
      email: 'ana@example.test',
      tokenHash,
      stage: 'initial',
      inviteeName: 'Ana',
      clinicName: 'Clínica Vida',
      roleLabel: 'Atendente',
      inviterName: 'João',
    });

    expect(result.link).toBe(
      'https://app.qoro.test/auth/confirm#token_hash=token-secreto&type=recovery&next=%2Fconvite',
    );
    const sent = mocks.send.mock.calls[0]?.[0] as { idempotencyKey: string; html: string };
    expect(sent.idempotencyKey).toMatch(/^team-invite:initial:[a-f0-9]{64}$/u);
    expect(sent.idempotencyKey).not.toContain(tokenHash);
    expect(sent.html).toContain('Aceitar convite');
    expect(mocks.metric).toHaveBeenCalledWith('auth.team_invite.sent', { stage: 'initial' });
  });
});
