import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    APP_BASE_URL: 'https://app.qoro.test',
    NODE_ENV: 'test',
    VERCEL_ENV: undefined as 'preview' | undefined,
    VERCEL_BRANCH_URL: undefined as string | undefined,
    VERCEL_URL: undefined as string | undefined,
  },
}));

vi.mock('@/lib/env', () => ({ env: mockEnv }));

import {
  buildApplicationUrl,
  createAuthConfirmationUrl,
  createSignupConfirmationUrl,
  createOnboardingInviteUrl,
  createPasswordResetRedirectUrl,
} from './application-url';

describe('buildApplicationUrl', () => {
  beforeEach(() => {
    mockEnv.APP_BASE_URL = 'https://app.qoro.test';
    mockEnv.NODE_ENV = 'test';
    mockEnv.VERCEL_ENV = undefined;
    mockEnv.VERCEL_BRANCH_URL = undefined;
    mockEnv.VERCEL_URL = undefined;
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

  it('recusa token vazio em vez de montar um link que não confirma nada', () => {
    expect(() => createSignupConfirmationUrl('   ', 'signup', 'a'.repeat(64))).toThrow('[app-url]');
  });

  it('recusa referência que não seja o HMAC do draft', () => {
    expect(() => createSignupConfirmationUrl('hash', 'recovery', 'draft-em-claro')).toThrow(
      '[app-url]',
    );
  });

  it('constrói o destino allowlisted da recuperação de senha', () => {
    expect(createPasswordResetRedirectUrl()).toBe('https://app.qoro.test/reset-password');
  });

  it('mantém links transacionais no hostname confiável da branch de Preview', () => {
    mockEnv.VERCEL_ENV = 'preview';
    mockEnv.VERCEL_BRANCH_URL = 'project-os-git-preview.example.vercel.app';

    expect(createPasswordResetRedirectUrl()).toBe(
      'https://project-os-git-preview.example.vercel.app/reset-password',
    );
  });

  it('usa a URL única do deployment quando a URL estável da branch não existe', () => {
    mockEnv.VERCEL_ENV = 'preview';
    mockEnv.VERCEL_URL = 'project-os-random.example.vercel.app';

    expect(createPasswordResetRedirectUrl()).toBe(
      'https://project-os-random.example.vercel.app/reset-password',
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
