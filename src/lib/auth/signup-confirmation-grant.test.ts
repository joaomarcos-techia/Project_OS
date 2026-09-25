import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  env: { SUPABASE_SECRET_KEY: 'test-secret-that-is-long-enough' },
}));

import {
  readSignupConfirmationGrant,
  signSignupConfirmationGrant,
} from './signup-confirmation-grant';

const grant = {
  userId: '11111111-1111-4111-8111-111111111111',
  signupRef: 'a'.repeat(64),
  expiresAt: 1_900_000,
};

describe('signup confirmation repair grant', () => {
  beforeEach(() => vi.clearAllMocks());

  it('assina e le somente antes do prazo', () => {
    const signed = signSignupConfirmationGrant(grant);
    expect(readSignupConfirmationGrant(signed, 1_000_000)).toEqual(grant);
    expect(readSignupConfirmationGrant(signed, grant.expiresAt)).toBeNull();
  });

  it('recusa adulteracao, usuario e referencia invalidos', () => {
    const signed = signSignupConfirmationGrant(grant);
    expect(readSignupConfirmationGrant(`${signed}x`, 1_000_000)).toBeNull();
    expect(() => signSignupConfirmationGrant({ ...grant, userId: 'nao-uuid' })).toThrow(
      'invalid grant',
    );
    expect(() => signSignupConfirmationGrant({ ...grant, signupRef: 'curta' })).toThrow(
      'invalid grant',
    );
  });
});
