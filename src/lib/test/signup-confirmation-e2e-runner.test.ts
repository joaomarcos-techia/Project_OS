import { describe, expect, it } from 'vitest';

import {
  SIGNUP_E2E_DEV_PROJECT_REF,
  SIGNUP_E2E_ENV_ALIASES,
  signupConfirmationE2EGuardErrors,
} from '../../../scripts/run-signup-confirmation-e2e';

const localEnvironment = {
  E2E_SIGNUP_WRITE: '1',
  E2E_BASE_URL: 'http://127.0.0.1:3100',
  NEXT_PUBLIC_SUPABASE_URL_DEV: `https://${SIGNUP_E2E_DEV_PROJECT_REF}.supabase.co`,
  SUPABASE_SECRET_KEY_DEV: 'configured-secret',
  RESEND_API_KEY_DEV: 'configured-resend-key',
  EMAIL_FROM_DEV: 'Qoro <no-reply@example.test>',
  DATABASE_URL_DEV: `postgresql://postgres.${SIGNUP_E2E_DEV_PROJECT_REF}:configured@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`,
  ASAAS_BASE_URL_DEV: 'https://sandbox.asaas.com/api/v3',
  ASAAS_API_KEY_DEV: 'configured-asaas-key',
  MAGIC_TOKEN_SECRET_DEV: 'configured-magic-secret',
  LOGIN_HASH_PEPPER_DEV: 'configured-login-pepper',
  SUPABASE_PROJECT_ENV: 'dev',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_DEV: 'configured-publishable-key',
  APP_BASE_URL: 'http://127.0.0.1:3100',
  SIGNUP_ENABLED: 'true',
  SIGNUP_IDENTITY_ENABLED: 'true',
  SIGNUP_AUTH_ENABLED: 'true',
} as const;

const aliasCases: ReadonlyArray<
  readonly [label: string, names: readonly string[], selected: string, value: string]
> = [
  ...SIGNUP_E2E_ENV_ALIASES.supabaseUrl.map(
    (selected) =>
      [
        'URL do Supabase',
        SIGNUP_E2E_ENV_ALIASES.supabaseUrl,
        selected,
        localEnvironment.NEXT_PUBLIC_SUPABASE_URL_DEV,
      ] as const,
  ),
  ...SIGNUP_E2E_ENV_ALIASES.supabaseAdminKey.map(
    (selected) =>
      [
        'chave administrativa',
        SIGNUP_E2E_ENV_ALIASES.supabaseAdminKey,
        selected,
        localEnvironment.SUPABASE_SECRET_KEY_DEV,
      ] as const,
  ),
  ...SIGNUP_E2E_ENV_ALIASES.supabasePublicKey.map(
    (selected) =>
      [
        'chave pública',
        SIGNUP_E2E_ENV_ALIASES.supabasePublicKey,
        selected,
        localEnvironment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_DEV,
      ] as const,
  ),
  ...SIGNUP_E2E_ENV_ALIASES.magicTokenSecret.map(
    (selected) =>
      [
        'MAGIC_TOKEN_SECRET',
        SIGNUP_E2E_ENV_ALIASES.magicTokenSecret,
        selected,
        localEnvironment.MAGIC_TOKEN_SECRET_DEV,
      ] as const,
  ),
  ...SIGNUP_E2E_ENV_ALIASES.loginHashPepper.map(
    (selected) =>
      [
        'LOGIN_HASH_PEPPER',
        SIGNUP_E2E_ENV_ALIASES.loginHashPepper,
        selected,
        localEnvironment.LOGIN_HASH_PEPPER_DEV,
      ] as const,
  ),
];

describe('signupConfirmationE2EGuardErrors', () => {
  it('accepts a fully configured and explicitly authorized local target', () => {
    expect(signupConfirmationE2EGuardErrors(localEnvironment)).toEqual([]);
  });

  it('fails closed without opt-in and external integrations', () => {
    const errors = signupConfirmationE2EGuardErrors({});

    expect(errors.some((error) => error.includes('E2E_SIGNUP_WRITE=1'))).toBe(true);
    expect(errors.some((error) => error.includes('URL do Supabase DEV'))).toBe(true);
    expect(errors.some((error) => error.includes('chave administrativa do Supabase DEV'))).toBe(
      true,
    );
    expect(errors.some((error) => error.includes('chave pública do Supabase DEV'))).toBe(true);
    expect(errors.some((error) => error.includes('RESEND_API_KEY_DEV'))).toBe(true);
    expect(errors.some((error) => error.includes('DATABASE_URL_DEV'))).toBe(true);
    expect(errors.some((error) => error.includes('ASAAS_BASE_URL'))).toBe(true);
    expect(errors.some((error) => error.includes('ASAAS_API_KEY'))).toBe(true);
  });

  it.each(aliasCases)(
    'accepts the %s alias %s used by the spec',
    (_label, names, selected, value) => {
      const environment: Record<string, string | undefined> = { ...localEnvironment };
      for (const name of names) environment[name] = undefined;
      environment[selected] = value;

      expect(signupConfirmationE2EGuardErrors(environment)).toEqual([]);
    },
  );

  it('refuses production even when every variable is present', () => {
    const errors = signupConfirmationE2EGuardErrors({
      ...localEnvironment,
      E2E_BASE_URL: 'https://app.qoro.dev',
      SUPABASE_PROJECT_ENV: 'prod',
    });

    expect(errors.some((error) => error.includes('qoro.dev'))).toBe(true);
  });

  it('refuses a production hostname with a trailing DNS dot', () => {
    const errors = signupConfirmationE2EGuardErrors({
      ...localEnvironment,
      E2E_BASE_URL: 'https://app.qoro.dev.',
      APP_BASE_URL: 'https://app.qoro.dev.',
    });

    expect(errors.some((error) => error.includes('qoro.dev'))).toBe(true);
  });

  it('refuses an operator-supplied project mislabeled as DEV', () => {
    const errors = signupConfirmationE2EGuardErrors({
      ...localEnvironment,
      NEXT_PUBLIC_SUPABASE_URL_DEV: 'https://outroprojeto.supabase.co',
      DATABASE_URL_DEV:
        'postgresql://postgres.outroprojeto:configured@aws-0-sa-east-1.pooler.supabase.com:6543/postgres',
    });

    expect(errors.filter((error) => error.includes('projeto DEV fixado'))).toHaveLength(2);
  });

  it('refuses an Asaas host outside the Sandbox', () => {
    const errors = signupConfirmationE2EGuardErrors({
      ...localEnvironment,
      ASAAS_BASE_URL_DEV: 'https://api.asaas.com/v3',
    });

    expect(errors.some((error) => error.includes('Sandbox esperado'))).toBe(true);
  });

  it('requires explicit opt-in and an exact Preview origin', () => {
    const errors = signupConfirmationE2EGuardErrors({
      ...localEnvironment,
      E2E_BASE_URL: 'https://qoro-preview.example.test',
      E2E_SIGNUP_ALLOWED_ORIGIN: 'https://outro-preview.example.test',
    });

    expect(errors.some((error) => error.includes('E2E_SIGNUP_ALLOW_PREVIEW=1'))).toBe(true);
    expect(errors.some((error) => error.includes('origem exata de E2E_BASE_URL'))).toBe(true);
  });
});
