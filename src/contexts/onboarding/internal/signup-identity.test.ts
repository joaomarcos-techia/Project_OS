import { beforeEach, describe, expect, it, vi } from 'vitest';

const { update, env } = vi.hoisted(() => ({
  update: vi.fn(),
  env: { SIGNUP_IDENTITY_ENABLED: true },
}));
vi.mock('@/lib/env', () => ({ env }));
vi.mock('@/lib/db', () => ({ dbAdmin: { update } }));

import { recordSignupIdentity, signupIdentitySchema } from './signup-session';

const valid = {
  rowVersion: 2,
  ownerName: 'Nome Sintético',
  clinicName: 'Clínica Sintética',
  email: 'sintetico@example.invalid',
  accepted: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  env.SIGNUP_IDENTITY_ENABLED = true;
});

describe('identidade e aceite do staging', () => {
  it('normaliza bordas e aceita nome único e 120 caracteres Unicode', () => {
    const parsed = signupIdentitySchema.parse({
      ...valid,
      ownerName: '  Ana  ',
      clinicName: '😀'.repeat(120),
    });
    expect(parsed.ownerName).toBe('Ana');
    expect(Array.from(parsed.clinicName)).toHaveLength(120);
  });

  it.each([
    { accepted: false },
    { accepted: undefined },
    { ownerName: ' ' },
    { ownerName: 'a'.repeat(121) },
    { clinicName: 'x\n' },
    { ownerName: '\u0085x' },
    { email: 'inválido' },
    { email: `${'a'.repeat(161)}@example.invalid` },
    { rowVersion: 0 },
    { rowVersion: 1.5 },
    { authUserId: 'adulterado' },
    { password: 'não entra no staging' },
  ])('recusa contrato inválido sem tocar no DB: %j', async (overrides) => {
    expect(signupIdentitySchema.safeParse({ ...valid, ...overrides }).success).toBe(false);
    // Mesmo um caller interno que bypassasse o parser HTTP não grava PII.
    await expect(recordSignupIdentity('a'.repeat(43), { ...valid, ...overrides })).rejects.toThrow(
      '[signup] invalid_identity',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('writer desligado e token malformado nunca acessam o DB', async () => {
    env.SIGNUP_IDENTITY_ENABLED = false;
    expect(await recordSignupIdentity('a'.repeat(43), valid)).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    env.SIGNUP_IDENTITY_ENABLED = true;
    expect(await recordSignupIdentity('inválido', valid)).toEqual({ ok: false, reason: 'gone' });
    expect(update).not.toHaveBeenCalled();
  });
});
