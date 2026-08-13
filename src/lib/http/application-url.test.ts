import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  env: { APP_BASE_URL: 'https://app.qoro.test', NODE_ENV: 'test' },
}));

import { buildApplicationUrl, createAuthConfirmationUrl } from './application-url';

describe('buildApplicationUrl', () => {
  it('constrói um link HTTPS canônico sem aceitar caminhos do valor configurado', () => {
    expect(buildApplicationUrl('https://app.qoro.test/', '/join/token-seguro')).toBe(
      'https://app.qoro.test/join/token-seguro',
    );
  });

  it.each([
    ['http://app.qoro.test', '/convite'],
    ['https://user:pass@app.qoro.test', '/convite'],
    ['https://app.qoro.test/base', '/convite'],
    ['https://app.qoro.test/?next=https://evil.test', '/convite'],
    ['https://app.qoro.test', '//evil.test'],
  ])('rejeita base ou destino inseguro: %s', (baseUrl, pathname) => {
    expect(() => buildApplicationUrl(baseUrl, pathname)).toThrow('[app-url]');
  });

  it('permite HTTP somente em localhost quando explicitamente habilitado para desenvolvimento', () => {
    expect(
      buildApplicationUrl('http://localhost:3000', '/convite', { allowInsecureLocalhost: true }),
    ).toBe('http://localhost:3000/convite');
  });

  it('constrói a confirmação SSR de um token de uso único sem aceitar redirect externo', () => {
    expect(createAuthConfirmationUrl('token-hash-de-teste', 'recovery')).toBe(
      'https://app.qoro.test/auth/confirm?token_hash=token-hash-de-teste&type=recovery&next=%2Fconvite',
    );
  });

  it('rejeita hash de token vazio', () => {
    expect(() => createAuthConfirmationUrl('  ', 'recovery')).toThrow('[app-url]');
  });
});
