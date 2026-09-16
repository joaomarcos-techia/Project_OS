import { describe, expect, it } from 'vitest';

import {
  SIGNUP_PASSWORD_MAX_BYTES,
  SUPABASE_PASSWORD_SPECIAL_CHARACTERS,
  signupPasswordSchema,
} from './signup-password';

describe('signupPasswordSchema', () => {
  it('aceita o contrato forte alinhado ao Supabase', () => {
    expect(signupPasswordSchema.safeParse('Senha123!').success).toBe(true);
    expect(SUPABASE_PASSWORD_SPECIAL_CHARACTERS).toContain('!');
  });

  it.each([
    'Aa1!aaa',
    'senha123!',
    'SENHA123!',
    'Senhaabc!',
    'Senha1234',
    'Senha123🙂',
    'Senha 123!',
    'Senha123!\n',
  ])('recusa senha fora das classes do provedor: %j', (password) => {
    expect(signupPasswordSchema.safeParse(password).success).toBe(false);
  });

  it('aplica o limite de 72 bytes do Auth sem normalizar a senha', () => {
    const exactLimit = `Aa1!${'a'.repeat(SIGNUP_PASSWORD_MAX_BYTES - 4)}`;
    const overLimit = `${exactLimit}a`;

    expect(new TextEncoder().encode(exactLimit)).toHaveLength(SIGNUP_PASSWORD_MAX_BYTES);
    expect(signupPasswordSchema.safeParse(exactLimit).success).toBe(true);
    expect(signupPasswordSchema.safeParse(overLimit).success).toBe(false);
    expect(signupPasswordSchema.safeParse('Aa1!áááá').success).toBe(true);
  });
});
