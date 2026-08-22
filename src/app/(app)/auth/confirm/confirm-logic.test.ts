import { describe, expect, it } from 'vitest';

import { isValidOtpType, safeNext, verifyErrorReason } from './confirm-logic';

describe('safeNext — anti open-redirect (invariante de segurança)', () => {
  it('aceita path relativo interno', () => {
    expect(safeNext('/convite')).toBe('/convite');
    expect(safeNext('/reset-password')).toBe('/reset-password');
    expect(safeNext('/dashboard?x=1')).toBe('/dashboard?x=1');
  });

  it('bloqueia URL absoluta', () => {
    expect(safeNext('https://evil.com')).toBe('/dashboard');
    expect(safeNext('http://evil.com/x')).toBe('/dashboard');
  });

  it('bloqueia protocol-relative //evil.com', () => {
    expect(safeNext('//evil.com')).toBe('/dashboard');
  });

  it('bloqueia backslash escape /\\evil.com', () => {
    expect(safeNext('/\\evil.com')).toBe('/dashboard');
    expect(safeNext('/foo\\bar')).toBe('/dashboard');
  });

  it('bloqueia esquema embutido (/javascript:...)', () => {
    expect(safeNext('/javascript:alert(1)')).toBe('/dashboard');
  });

  it('bloqueia controles ASCII que o parser poderia normalizar para outro host', () => {
    expect(safeNext('/\t/evil.com')).toBe('/dashboard');
    expect(safeNext('/\n/evil.com')).toBe('/dashboard');
    expect(safeNext('/\r/evil.com')).toBe('/dashboard');
    expect(safeNext('/%09/evil.com')).toBe('/dashboard');
  });

  it('rejeita destinos internos fora da allowlist do fluxo de OTP', () => {
    expect(safeNext('/admin')).toBe('/dashboard');
    expect(safeNext('/dashboard#fragment')).toBe('/dashboard');
  });

  it('vazio / null / undefined → fallback', () => {
    expect(safeNext('')).toBe('/dashboard');
    expect(safeNext(null)).toBe('/dashboard');
    expect(safeNext(undefined)).toBe('/dashboard');
  });

  it('não-path (relativo sem barra) → fallback', () => {
    expect(safeNext('convite')).toBe('/dashboard');
  });
});

describe('isValidOtpType', () => {
  it('aceita os types dos nossos fluxos', () => {
    expect(isValidOtpType('invite')).toBe(true);
    expect(isValidOtpType('recovery')).toBe(true);
    expect(isValidOtpType('email')).toBe(true);
  });
  it('rejeita inválido/null', () => {
    expect(isValidOtpType('bogus')).toBe(false);
    expect(isValidOtpType(null)).toBe(false);
    expect(isValidOtpType('')).toBe(false);
  });
});

describe('verifyErrorReason', () => {
  it('mensagem com expired → expired', () => {
    expect(verifyErrorReason('Token has expired')).toBe('expired');
    expect(verifyErrorReason('otp_expired')).toBe('expired');
  });
  it('resto → invalid_token', () => {
    expect(verifyErrorReason('invalid token')).toBe('invalid_token');
    expect(verifyErrorReason(undefined)).toBe('invalid_token');
  });
});
