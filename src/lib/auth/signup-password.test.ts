import { describe, expect, it } from 'vitest';

import {
  SIGNUP_PASSWORD_MAX_BYTES,
  signupPasswordMessage,
  signupPasswordSchema,
} from './signup-password';

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

describe('signupPasswordMessage', () => {
  it('diz exatamente o que falta, em vez de sempre "8 caracteres"', () => {
    expect(signupPasswordMessage('senhalonga')).toBe(
      'A senha precisa ter uma letra maiúscula e um número.',
    );
    expect(signupPasswordMessage('SENHALONGA1')).toBe('A senha precisa ter uma letra minúscula.');
    expect(signupPasswordMessage('Senhalonga')).toBe('A senha precisa ter um número.');
    expect(signupPasswordMessage('Ab1')).toBe('A senha precisa ter pelo menos 8 caracteres.');
    expect(signupPasswordMessage('abc')).toBe(
      'A senha precisa ter pelo menos 8 caracteres, uma letra maiúscula e um número.',
    );
  });

  it('explica o que não pode, além do que falta', () => {
    expect(signupPasswordMessage('Senha 123')).toBe('A senha não pode ter espaços.');
    expect(signupPasswordMessage(`Aa1${'a'.repeat(SIGNUP_PASSWORD_MAX_BYTES)}`)).toBe(
      'A senha pode ter no máximo 72 caracteres.',
    );
    expect(signupPasswordMessage('senha 12')).toBe(
      'A senha precisa ter uma letra maiúscula. A senha não pode ter espaços.',
    );
  });

  it('é nula exatamente quando o schema aceita', () => {
    for (const password of ['Senha123!', 'Senha1234', 'Aa1ááááá', 'senha123!', 'Senha 123!', '']) {
      expect(signupPasswordMessage(password) === null).toBe(
        signupPasswordSchema.safeParse(password).success,
      );
    }
  });
});
