import { describe, expect, it, vi } from 'vitest';

import { tissPasswordPolicyError } from './password-policy';

const ON = { TISS_SECURITY_PROFILE_ENFORCE: 'true' };
const inTiss = vi.fn(async () => ({ moduleEnabled: true, hasTissData: true }));
const outTiss = vi.fn(async () => ({ moduleEnabled: false, hasTissData: false }));

describe('S3 — política de senha do perfil TISS (requisito 67)', () => {
  it('desligada por padrão: nada muda e o rastro nem é lido', async () => {
    const reader = vi.fn(inTiss);
    expect(await tissPasswordPolicyError('fraca', 'c1', reader, {})).toBeNull();
    expect(reader).not.toHaveBeenCalled();
  });

  it('ligada, clínica com dado TISS: exige maiúscula, minúscula, número e símbolo', async () => {
    expect(await tissPasswordPolicyError('SenhaForte7', 'c1', inTiss, ON)).toMatch(/um símbolo/u);
    expect(await tissPasswordPolicyError('senhaforte7!', 'c1', inTiss, ON)).toMatch(
      /uma letra maiúscula/u,
    );
    expect(await tissPasswordPolicyError('SenhaForte7!', 'c1', inTiss, ON)).toBeNull();
    expect(await tissPasswordPolicyError('SenhaFórte7#', 'c1', inTiss, ON)).toBeNull();
  });

  it('ligada, clínica sem dado TISS: a regra do fluxo continua a mesma', async () => {
    expect(await tissPasswordPolicyError('SenhaForte7', 'c2', outTiss, ON)).toBeNull();
  });

  it('desligar o módulo não tira do alcance enquanto houver dado TISS', async () => {
    const retained = vi.fn(async () => ({ moduleEnabled: false, hasTissData: true }));
    expect(await tissPasswordPolicyError('SenhaForte7', 'c3', retained, ON)).toMatch(/símbolo/u);
  });

  it('sem clínica (cadastro): só no modo plataforma', async () => {
    expect(await tissPasswordPolicyError('SenhaForte7', null, inTiss, ON)).toBeNull();
    expect(
      await tissPasswordPolicyError('SenhaForte7', null, inTiss, {
        ...ON,
        TISS_SECURITY_PROFILE_SCOPE: 'platform',
      }),
    ).toMatch(/símbolo/u);
  });

  it('rastro ilegível com o perfil ligado: aplica a regra MAIS forte, nunca a mais fraca', async () => {
    const broken = vi.fn(async () => {
      throw new Error('banco fora');
    });
    expect(await tissPasswordPolicyError('SenhaForte7', 'c4', broken, ON)).toMatch(/símbolo/u);
    expect(await tissPasswordPolicyError('SenhaForte7!', 'c4', broken, ON)).toBeNull();
  });
});
