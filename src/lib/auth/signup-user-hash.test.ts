import { beforeEach, describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({
  LOGIN_HASH_PEPPER: 'synthetic-signup-owner-pepper' as string | undefined,
}));
vi.mock('@/lib/env', () => ({ env: config }));

import { hashSignupUserId } from './signup-user-hash';

beforeEach(() => {
  config.LOGIN_HASH_PEPPER = 'synthetic-signup-owner-pepper';
});

describe('hashSignupUserId', () => {
  it('é determinístico, opaco e separado por usuário', () => {
    const first = hashSignupUserId('11111111-1111-4111-8111-111111111111');
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
    expect(first).toBe(hashSignupUserId('11111111-1111-4111-8111-111111111111'));
    expect(first).not.toBe(hashSignupUserId('22222222-2222-4222-8222-222222222222'));
    expect(first).not.toContain('11111111');
  });

  it('falha fechado sem pepper', () => {
    config.LOGIN_HASH_PEPPER = undefined;
    expect(() => hashSignupUserId('11111111-1111-4111-8111-111111111111')).toThrow(
      'LOGIN_HASH_PEPPER ausente',
    );
  });
});
