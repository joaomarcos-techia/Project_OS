import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({
  env: { SUPABASE_SECRET_KEY: 'test-secret-key-with-enough-entropy-000000' },
}));

import { readRecoveryGrant, signRecoveryGrant } from './recovery-grant';

const profile = {
  kind: 'profile' as const,
  userId: 'u-1',
  epoch: 7,
  expiresAt: 2_000_000,
};
const pretenant = {
  kind: 'pretenant' as const,
  userId: 'u-2',
  epoch: 11,
  signupRef: 'a'.repeat(64),
  expiresAt: 2_000_000,
};
const orphanPretenant = {
  ...pretenant,
  kind: 'pretenant_orphan' as const,
  epoch: 1_795_000_000_000,
};

describe('recovery grant v2 (AUTH-006)', () => {
  it.each([profile, pretenant, orphanPretenant])('faz round-trip do grant $kind', (value) => {
    expect(readRecoveryGrant(signRecoveryGrant(value), 1_000_000)).toEqual(value);
  });

  it('rejeita cookie ausente', () => {
    expect(readRecoveryGrant(undefined)).toBeNull();
    expect(readRecoveryGrant('')).toBeNull();
  });

  it('rejeita adulteracao de usuario, epoch, kind ou signup ref', () => {
    const signedProfile = signRecoveryGrant(profile);
    expect(readRecoveryGrant(signedProfile.replace('u-1', 'u-9'), 1_000_000)).toBeNull();
    expect(readRecoveryGrant(signedProfile.replace('.7.', '.8.'), 1_000_000)).toBeNull();
    expect(
      readRecoveryGrant(signedProfile.replace('.profile.', '.pretenant.'), 1_000_000),
    ).toBeNull();

    const signedPretenant = signRecoveryGrant(pretenant);
    expect(
      readRecoveryGrant(signedPretenant.replace(pretenant.signupRef, 'b'.repeat(64)), 1_000_000),
    ).toBeNull();
  });

  it('rejeita grant expirado', () => {
    const signed = signRecoveryGrant(profile);
    expect(readRecoveryGrant(signed, profile.expiresAt)).toBeNull();
    expect(readRecoveryGrant(signed, profile.expiresAt + 1)).toBeNull();
  });

  it('rejeita v1 e valores malformados', () => {
    expect(readRecoveryGrant('v1.u-1.7.2000000.deadbeef', 1_000_000)).toBeNull();
    expect(readRecoveryGrant('v2.profile.u-1.abc.2000000.deadbeef', 1_000_000)).toBeNull();
    expect(() => signRecoveryGrant({ ...pretenant, signupRef: 'curta' })).toThrow(
      'invalid signup reference',
    );
  });
});
