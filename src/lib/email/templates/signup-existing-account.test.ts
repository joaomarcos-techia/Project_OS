import { describe, expect, it } from 'vitest';

import { renderSignupExistingAccountEmail } from './signup-existing-account';

const input = { loginUrl: 'https://app.qoro.test/login', publicOrigin: 'https://app.qoro.test' };

describe('existing-account email', () => {
  it('points only to the login screen and promises nothing new', () => {
    const result = renderSignupExistingAccountEmail(input);
    expect(result.subject).toBe('Você já tem uma conta na Qoro');
    expect(result.text).toContain('nenhuma conta nova foi criada e nada foi alterado');
    expect(result.text).toContain('Esqueci a senha');
    expect(result.text).toContain('https://app.qoro.test/login');
    expect(result.html).toContain('href="https://app.qoro.test/login"');
    expect(result.html).not.toContain('<script');
    expect(result.text).not.toMatch(/\b\d{8}\b/u);
    expect(result.html).not.toMatch(/token|signup_ref|type=recovery/u);
  });

  it.each([
    'https://evil.example/login',
    'javascript:alert(1)',
    'http://app.qoro.test/login',
    'https://app.qoro.test/login?next=/x',
    'https://app.qoro.test/login#token=abc',
    'https://app.qoro.test/cadastro',
    'https://user:pass@app.qoro.test/login',
  ])('rejects an unsafe destination: %s', (loginUrl) => {
    expect(() => renderSignupExistingAccountEmail({ ...input, loginUrl })).toThrow();
  });

  it('accepts the local development origin', () => {
    expect(() =>
      renderSignupExistingAccountEmail({
        loginUrl: 'http://localhost:3000/login',
        publicOrigin: 'http://localhost:3000',
      }),
    ).not.toThrow();
  });
});
