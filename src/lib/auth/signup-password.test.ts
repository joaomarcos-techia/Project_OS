import { describe, expect, it } from 'vitest';

import { SIGNUP_PASSWORD_MAX_BYTES, signupPasswordSchema } from './signup-password';

describe('signupPasswordSchema', () => {
  it('aceita o contrato com maiúscula, minúscula e número sem exigir símbolo', () => {
    expect(signupPasswordSchema.safeParse('Senha123!').success).toBe(true);
    expect(signupPasswordSchema.safeParse('Senha1234').success).toBe(true);
    expect(signupPasswordSchema.safeParse('Senha123🙂').success).toBe(true);
  });

  it.each(['Aa1!aaa', 'senha123!', 'SENHA123!', 'Senhaabc!', 'Senha 123!', 'Senha123!\n'])(
    'recusa senha fora das classes do provedor: %j',
    (password) => {
      expect(signupPasswordSchema.safeParse(password).success).toBe(false);
    },
  );

  it('aplica o limite de 72 bytes do Auth sem normalizar a senha', () => {
    const exactLimit = `Aa1${'a'.repeat(SIGNUP_PASSWORD_MAX_BYTES - 3)}`;
    const overLimit = `${exactLimit}a`;

    expect(new TextEncoder().encode(exactLimit)).toHaveLength(SIGNUP_PASSWORD_MAX_BYTES);
    expect(signupPasswordSchema.safeParse(exactLimit).success).toBe(true);
    expect(signupPasswordSchema.safeParse(overLimit).success).toBe(false);
    expect(signupPasswordSchema.safeParse('Aa1ááááá').success).toBe(true);
  });
});
