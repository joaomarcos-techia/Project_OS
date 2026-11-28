import { describe, expect, it } from 'vitest';

import {
  randomSyntheticPassword,
  requireSyntheticPassword,
} from '../../../scripts/security/synthetic-password';

describe('credenciais de teste', () => {
  it('exige senha definida com comprimento mínimo para o seed manual', () => {
    expect(() => requireSyntheticPassword(undefined, 'SEED_DEV_PASSWORD')).toThrow(
      'SEED_DEV_PASSWORD',
    );
    expect(() => requireSyntheticPassword('curta', 'SEED_DEV_PASSWORD')).toThrow(
      'SEED_DEV_PASSWORD',
    );
    expect(requireSyntheticPassword('senha-sintetica-longa', 'SEED_DEV_PASSWORD')).toBe(
      'senha-sintetica-longa',
    );
  });

  it('gera senhas imprevisíveis distintas para cada execução de smoke', () => {
    const first = randomSyntheticPassword();
    const second = randomSyntheticPassword();
    expect(first.length).toBeGreaterThanOrEqual(32);
    expect(second).not.toBe(first);
  });
});
