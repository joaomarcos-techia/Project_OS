import { describe, expect, it } from 'vitest';

import { PASSWORD_RESET_EMAIL_TEMPLATE_VERSION, renderPasswordResetEmail } from './password-reset';

const origin = 'https://app.qoro.test';
const resetUrl = `${origin}/auth/confirm#token_hash=abc123&type=recovery&next=%2Freset-password`;

describe('renderPasswordResetEmail', () => {
  it('leva o link no formato que /auth/confirm verifica, em HTML e texto', () => {
    const email = renderPasswordResetEmail({ resetUrl, expectedOrigin: origin });

    expect(PASSWORD_RESET_EMAIL_TEMPLATE_VERSION).toBe('password-reset.v1');
    expect(email.subject).toBe('Redefinir senha — Qoro');
    expect(email.text).toContain(resetUrl);
    expect(email.html).toContain(`href="${resetUrl.replaceAll('&', '&amp;')}"`);
    expect(email.html).toContain('Redefinir minha senha');
    expect(email.html).toContain('<v:roundrect');
  });

  it('NÃO usa o link do GoTrue nem variável de template do painel', () => {
    // Era isto que quebrava: `{{ .ConfirmationURL }}` passava pelo /auth/v1/verify,
    // que consome o token e devolve a sessão na URL — e /reset-password recusa.
    const { html, text } = renderPasswordResetEmail({ resetUrl, expectedOrigin: origin });
    for (const corpo of [html, text]) {
      expect(corpo).not.toContain('{{');
      expect(corpo).not.toContain('/auth/v1/verify');
    }
  });

  it.each([
    [
      'tipo que não é recovery',
      `${origin}/auth/confirm#token_hash=a&type=magiclink&next=%2Freset-password`,
    ],
    [
      'destino que não é /reset-password',
      `${origin}/auth/confirm#token_hash=a&type=recovery&next=%2Fdashboard`,
    ],
    [
      'token na query (iria ao log e ao Referer)',
      `${origin}/auth/confirm?token_hash=a#token_hash=a&type=recovery&next=%2Freset-password`,
    ],
    ['sem token_hash', `${origin}/auth/confirm#type=recovery&next=%2Freset-password`],
    [
      'fora do /auth/confirm',
      `${origin}/reset-password#token_hash=a&type=recovery&next=%2Freset-password`,
    ],
    [
      'outra origem',
      'https://evil.example/auth/confirm#token_hash=a&type=recovery&next=%2Freset-password',
    ],
    [
      'HTTP remoto',
      'http://app.qoro.test/auth/confirm#token_hash=a&type=recovery&next=%2Freset-password',
    ],
    ['campo extra no fragmento', `${resetUrl}&x=1`],
    [
      'link do GoTrue',
      'https://x.supabase.co/auth/v1/verify?token=a&type=recovery&redirect_to=https://app.qoro.test/reset-password',
    ],
  ])('recusa link que sairia quebrado: %s', (_caso, url) => {
    expect(() => renderPasswordResetEmail({ resetUrl: url, expectedOrigin: origin })).toThrow(
      '[email]',
    );
  });
});
