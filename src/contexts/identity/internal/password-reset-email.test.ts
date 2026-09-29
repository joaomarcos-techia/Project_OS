import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateLink, sendEmail } = vi.hoisted(() => ({
  generateLink: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock('@/lib/auth/supabase-admin', () => ({
  createAdminClient: () => ({ auth: { admin: { generateLink } } }),
}));
vi.mock('@/lib/email/resend', () => ({ sendTransactionalEmail: sendEmail }));
vi.mock('@/lib/env', () => ({
  env: {
    APP_BASE_URL: 'https://app.qoro.test',
    NODE_ENV: 'test',
    MAGIC_TOKEN_SECRET: 'segredo-de-teste-com-tamanho-suficiente',
  },
}));
vi.mock('@/lib/observability/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));

import { sendPasswordResetEmail } from './password-reset-email';

const email = 'pessoa@example.test';

beforeEach(() => {
  vi.clearAllMocks();
  generateLink.mockResolvedValue({
    data: { properties: { hashed_token: 'hash-recovery' } },
    error: null,
  });
  sendEmail.mockResolvedValue({ providerMessageId: 'msg_1' });
});

describe('sendPasswordResetEmail', () => {
  it('pede SÓ o token ao GoTrue e entrega o link de /auth/confirm pelo Resend', async () => {
    expect(await sendPasswordResetEmail(email)).toBe('sent');

    // Sem `redirectTo`: o link não passa pelo /auth/v1/verify, então a allowlist
    // de "Redirect URLs" do painel não participa.
    expect(generateLink).toHaveBeenCalledWith({ type: 'recovery', email });
    const enviado = sendEmail.mock.calls[0]?.[0] as {
      to: string;
      html: string;
      text: string;
      idempotencyKey: string;
    };
    expect(enviado.to).toBe(email);
    expect(enviado.text).toContain(
      'https://app.qoro.test/auth/confirm#token_hash=hash-recovery&type=recovery&next=%2Freset-password',
    );
    expect(enviado.html).not.toContain('/auth/v1/verify');
    // A chave de idempotência vai ao Resend: o token não pode estar nela.
    expect(enviado.idempotencyKey).toMatch(/^password-reset:[a-f0-9]{64}$/u);
    expect(enviado.idempotencyKey).not.toContain('hash-recovery');
  });

  it('conta inexistente: não envia nada', async () => {
    generateLink.mockResolvedValue({
      data: null,
      error: { code: 'user_not_found', status: 404 },
    });

    expect(await sendPasswordResetEmail(email)).toBe('no_account');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    ['erro do provedor', { data: null, error: { code: 'unexpected_failure', status: 500 } }],
    ['resposta sem token', { data: { properties: {} }, error: null }],
  ])('%s: falha sem enviar', async (_caso, resposta) => {
    generateLink.mockResolvedValue(resposta);

    expect(await sendPasswordResetEmail(email)).toBe('failed');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('exceção do GoTrue ou do Resend vira falha, nunca escapa', async () => {
    generateLink.mockRejectedValueOnce(new Error('timeout'));
    expect(await sendPasswordResetEmail(email)).toBe('failed');

    sendEmail.mockRejectedValueOnce(new Error('resend fora'));
    expect(await sendPasswordResetEmail(email)).toBe('failed');
  });
});
