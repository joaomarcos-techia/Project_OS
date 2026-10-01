import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ send: vi.fn(), metric: vi.fn() }));

vi.mock('@/lib/email/resend', () => ({ sendTransactionalEmail: mocks.send }));
vi.mock('@/lib/env', () => ({
  env: {
    APP_BASE_URL: 'https://app.qoro.test',
    MAGIC_TOKEN_SECRET: 'test-secret-32-bytes-minimum-value',
  },
}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.metric } }));

import { deliverTeamInviteEmail } from './team-invite-email';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockResolvedValue({ providerMessageId: 'email_1' });
});

describe('deliverTeamInviteEmail', () => {
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
