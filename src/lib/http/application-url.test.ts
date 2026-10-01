import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    APP_BASE_URL: 'https://app.qoro.test',
    NODE_ENV: 'test',
    VERCEL_ENV: undefined as 'preview' | undefined,
    VERCEL_URL: undefined as string | undefined,
    VERCEL_BRANCH_URL: undefined as string | undefined,
    VERCEL_AUTOMATION_BYPASS_SECRET: undefined as string | undefined,
  },
}));

vi.mock('@/lib/env', () => ({ env: mockEnv }));

import {
  buildApplicationUrl,
  createAuthConfirmationUrl,
  createMetaWebhookUrl,
  createPasswordResetConfirmationUrl,
  createSignupConfirmationUrl,
  createOnboardingInviteUrl,
  createPasswordResetRedirectUrl,
  resolveTrustedApplicationOrigin,
} from './application-url';

describe('buildApplicationUrl', () => {
  beforeEach(() => {
    mockEnv.APP_BASE_URL = 'https://app.qoro.test';
    mockEnv.NODE_ENV = 'test';
    mockEnv.VERCEL_ENV = undefined;
    mockEnv.VERCEL_URL = undefined;
    mockEnv.VERCEL_BRANCH_URL = undefined;
    mockEnv.VERCEL_AUTOMATION_BYPASS_SECRET = undefined;
  });

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

  it('aceita a origem canonica configurada', () => {
    const request = new Request('https://app.qoro.test/api/signup/draft', {
      headers: { origin: 'https://app.qoro.test', 'sec-fetch-site': 'same-origin' },
    });
    expect(resolveTrustedApplicationOrigin(request)).toBe('https://app.qoro.test');
  });

  it.each(['VERCEL_URL', 'VERCEL_BRANCH_URL'] as const)(
    'aceita somente o hostname auto-injetado no Preview: %s',
    (key) => {
      mockEnv.VERCEL_ENV = 'preview';
      mockEnv[key] = `${key.toLowerCase()}.vercel.app`;
      const origin = `https://${mockEnv[key]}`;
      const request = new Request(`${origin}/api/signup/draft`, {
        headers: { origin, 'sec-fetch-site': 'same-origin' },
      });
      expect(resolveTrustedApplicationOrigin(request)).toBe(origin);
    },
  );

  it.each([
    ['host Vercel nao allowlisted', 'preview-atacante.vercel.app', 'same-origin'],
    ['origem diferente da URL', 'preview-outro.vercel.app', 'same-origin'],
    ['requisicao cross-site', 'preview-branch.vercel.app', 'cross-site'],
  ])('recusa %s', (_label, hostname, fetchSite) => {
    mockEnv.VERCEL_ENV = 'preview';
    mockEnv.VERCEL_BRANCH_URL = 'preview-branch.vercel.app';
    const requestOrigin = `https://${hostname}`;
    const headerOrigin =
      _label === 'origem diferente da URL' ? 'https://preview-branch.vercel.app' : requestOrigin;
    const request = new Request(`${requestOrigin}/api/signup/draft`, {
      headers: { origin: headerOrigin, 'sec-fetch-site': fetchSite },
    });
    expect(resolveTrustedApplicationOrigin(request)).toBeNull();
  });

  it('nao amplia a allowlist Vercel fora de Preview', () => {
    mockEnv.VERCEL_BRANCH_URL = 'preview-branch.vercel.app';
    const origin = 'https://preview-branch.vercel.app';
    expect(
      resolveTrustedApplicationOrigin(
        new Request(`${origin}/api/signup/draft`, { headers: { origin } }),
      ),
    ).toBeNull();
  });

  it('mantém o token de confirmação fora do GET inicial', () => {
    expect(createAuthConfirmationUrl('token-hash-de-teste', 'recovery')).toBe(
      'https://app.qoro.test/auth/confirm#token_hash=token-hash-de-teste&type=recovery&next=%2Fconvite',
    );
    expect(new URL(createAuthConfirmationUrl('token-hash-de-teste', 'recovery')).search).toBe('');
  });

  it.each(['signup', 'magiclink', 'recovery'] as const)(
    'monta a confirmação do cadastro com destino próprio: %s',
    (type) => {
      // `next` é `/cadastro/confirmado`, não `/convite`: o link do cadastro
      // termina numa tela que só diz que o e-mail foi confirmado.
      expect(createSignupConfirmationUrl('hash', type, 'a'.repeat(64))).toBe(
        `https://app.qoro.test/auth/confirm#token_hash=hash&type=${type}&next=%2Fcadastro%2Fconfirmado&signup_ref=${'a'.repeat(64)}`,
      );
      expect(new URL(createSignupConfirmationUrl('hash', type, 'a'.repeat(64))).search).toBe('');
    },
  );

  it('usa a origem Preview ja validada no link de confirmacao', () => {
    expect(
      createSignupConfirmationUrl(
        'hash',
        'recovery',
        'a'.repeat(64),
        'https://preview-branch.vercel.app',
      ),
    ).toContain('https://preview-branch.vercel.app/auth/confirm#');
  });

  it('recusa token vazio em vez de montar um link que não confirma nada', () => {
    expect(() => createSignupConfirmationUrl('   ', 'signup', 'a'.repeat(64))).toThrow('[app-url]');
  });

  it('recusa referência que não seja o HMAC do draft', () => {
    expect(() => createSignupConfirmationUrl('hash', 'recovery', 'draft-em-claro')).toThrow(
      '[app-url]',
    );
  });

  it('monta o link de redefinição de senha com o token no fragmento e destino fixo', () => {
    const url = new URL(createPasswordResetConfirmationUrl('hash-de-teste'));
    expect(url.origin + url.pathname).toBe('https://app.qoro.test/auth/confirm');
    expect(url.search).toBe('');
    expect(Object.fromEntries(new URLSearchParams(url.hash.slice(1)))).toEqual({
      token_hash: 'hash-de-teste',
      type: 'recovery',
      next: '/reset-password',
    });
  });

  it('recusa token vazio no link de redefinição', () => {
    expect(() => createPasswordResetConfirmationUrl('  ')).toThrow('[app-url]');
  });

  it('constrói o destino allowlisted da recuperação de senha', () => {
    expect(createPasswordResetRedirectUrl()).toBe('https://app.qoro.test/reset-password');
  });

  it('gera callback Meta no ambiente atual sem parâmetro controlado pelo usuário', () => {
    expect(createMetaWebhookUrl()).toBe('https://app.qoro.test/api/webhooks/meta');
  });

  it('inclui o bypass server-to-server somente no callback de Preview protegido', () => {
    mockEnv.VERCEL_ENV = 'preview';
    mockEnv.VERCEL_AUTOMATION_BYPASS_SECRET = 'preview-bypass-secret';

    expect(createMetaWebhookUrl()).toBe(
      'https://app.qoro.test/api/webhooks/meta?x-vercel-protection-bypass=preview-bypass-secret',
    );
  });

  it('mantém o token pré-clínica no fragmento, fora da requisição inicial', () => {
    expect(createOnboardingInviteUrl('a'.repeat(43))).toBe(
      `https://app.qoro.test/join#invite=${'a'.repeat(43)}`,
    );
  });

  it('rejeita hash de token vazio', () => {
    expect(() => createAuthConfirmationUrl('  ', 'recovery')).toThrow('[app-url]');
  });
});
