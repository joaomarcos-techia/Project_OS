import { describe, expect, it, vi } from 'vitest';

// `vi.mock` é hoisted acima dos imports pelo Vitest — o módulo abaixo já vê o env falso.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({
  env: { SUPABASE_SECRET_KEY: 'test-secret-key-with-enough-entropy-000000' },
}));

import { readRecoveryGrant, signRecoveryGrant } from './recovery-grant';

const BASE = { userId: 'u-1', epoch: 7, expiresAt: 2_000_000 };

describe('recovery grant (AUTH-006)', () => {
  it('faz round-trip preservando usuário, epoch e expiração', () => {
    const grant = readRecoveryGrant(signRecoveryGrant(BASE), 1_000_000);
    expect(grant).toEqual(BASE);
  });

  it('rejeita cookie ausente', () => {
    expect(readRecoveryGrant(undefined)).toBeNull();
    expect(readRecoveryGrant('')).toBeNull();
  });

  it('rejeita assinatura adulterada — trocar o userId não passa', () => {
    const signed = signRecoveryGrant(BASE);
    expect(readRecoveryGrant(signed.replace('u-1', 'u-2'), 1_000_000)).toBeNull();
  });

  it('rejeita epoch adulterado — é o que garante o uso único', () => {
    // Sem a assinatura cobrir o epoch, bastaria reescrevê-lo para reusar o
    // grant depois do bump que o reset faz.
    const signed = signRecoveryGrant(BASE);
    expect(readRecoveryGrant(signed.replace(`.${BASE.epoch}.`, '.8.'), 1_000_000)).toBeNull();
  });

  it('rejeita grant expirado', () => {
    const signed = signRecoveryGrant(BASE);
    expect(readRecoveryGrant(signed, BASE.expiresAt)).toBeNull();
    expect(readRecoveryGrant(signed, BASE.expiresAt + 1)).toBeNull();
  });

  it('rejeita valor sem assinatura e versão desconhecida', () => {
    expect(readRecoveryGrant('v1.u-1.7.2000000', 1_000_000)).toBeNull();
    const signed = signRecoveryGrant(BASE);
    expect(readRecoveryGrant(signed.replace('v1.', 'v2.'), 1_000_000)).toBeNull();
  });

  it('rejeita campos não numéricos', () => {
    expect(readRecoveryGrant('v1.u-1.abc.2000000.deadbeef', 1_000_000)).toBeNull();
  });
});
