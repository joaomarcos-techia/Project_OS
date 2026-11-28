import type { AuthError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { AUTH_UNAVAILABLE_MESSAGE, isAuthServiceUnavailable } from './auth-availability';

const authError = (fields: Partial<AuthError>): AuthError => fields as AuthError;

describe('isAuthServiceUnavailable', () => {
  it('reconhece falha de rede e de gateway do auth-js', () => {
    expect(
      isAuthServiceUnavailable(authError({ name: 'AuthRetryableFetchError', status: 0 })),
    ).toBe(true);
    expect(
      isAuthServiceUnavailable(authError({ name: 'AuthRetryableFetchError', status: 504 })),
    ).toBe(true);
  });

  it('reconhece 5xx e ausência de resposta', () => {
    expect(isAuthServiceUnavailable(authError({ name: 'AuthApiError', status: 500 }))).toBe(true);
    expect(isAuthServiceUnavailable(authError({ name: 'AuthUnknownError', status: 0 }))).toBe(true);
  });

  it('não confunde credencial errada, captcha ou limite com indisponibilidade', () => {
    expect(isAuthServiceUnavailable(authError({ name: 'AuthApiError', status: 400 }))).toBe(false);
    expect(isAuthServiceUnavailable(authError({ name: 'AuthApiError', status: 422 }))).toBe(false);
    expect(isAuthServiceUnavailable(authError({ name: 'AuthApiError', status: 429 }))).toBe(false);
    expect(isAuthServiceUnavailable(null)).toBe(false);
    expect(isAuthServiceUnavailable(undefined)).toBe(false);
  });

  it('a mensagem não fala de credencial errada e diz que a senha não foi conferida', () => {
    expect(AUTH_UNAVAILABLE_MESSAGE).not.toMatch(/inválid|incorret/i);
    expect(AUTH_UNAVAILABLE_MESSAGE).toMatch(/não foi verificada/);
  });
});
