import { describe, expect, it } from 'vitest';
import type { AuthError } from '@supabase/supabase-js';

import { CAPTCHA_TOKEN_FIELD, captchaOptions, isCaptchaError, readCaptchaToken } from './captcha';

function form(value?: unknown): FormData {
  const data = new FormData();
  if (value !== undefined) data.set(CAPTCHA_TOKEN_FIELD, value as string);
  return data;
}

function authError(over: Partial<AuthError>): AuthError {
  return { name: 'AuthApiError', message: '', status: 400, ...over } as AuthError;
}

describe('leitura do token do formulário', () => {
  it('devolve o token quando presente', () => {
    expect(readCaptchaToken(form('0.abc-token'))).toBe('0.abc-token');
  });

  it('campo ausente vira undefined, não string vazia', () => {
    // A distinção importa no call site: `{ captchaToken: '' }` é token
    // INVÁLIDO para o GoTrue, enquanto a ausência da chave é token ausente.
    expect(readCaptchaToken(form())).toBeUndefined();
  });

  it('campo vazio e só-espaços também viram undefined', () => {
    expect(readCaptchaToken(form(''))).toBeUndefined();
    expect(readCaptchaToken(form('   '))).toBeUndefined();
  });

  it('token absurdamente grande é descartado', () => {
    // Teto defensivo: o campo é público e não validamos formato aqui.
    expect(readCaptchaToken(form('x'.repeat(2049)))).toBeUndefined();
    expect(readCaptchaToken(form('x'.repeat(2048)))).toHaveLength(2048);
  });

  it('valor que não é string (arquivo) é ignorado', () => {
    const data = new FormData();
    data.set(CAPTCHA_TOKEN_FIELD, new File(['x'], 'x.txt'));
    expect(readCaptchaToken(data)).toBeUndefined();
  });
});

describe('montagem do options do Supabase', () => {
  it('com token, devolve o objeto que o SDK espera', () => {
    expect(captchaOptions('tok')).toEqual({ captchaToken: 'tok' });
  });

  it('sem token, devolve undefined para o call site OMITIR a chave', () => {
    expect(captchaOptions(undefined)).toBeUndefined();
  });
});

describe('distinção entre captcha reprovado e credencial errada', () => {
  it('reconhece o código canônico do GoTrue', () => {
    expect(isCaptchaError(authError({ code: 'captcha_failed' }))).toBe(true);
  });

  it('reconhece pela mensagem quando o projeto não manda code', () => {
    expect(isCaptchaError(authError({ message: 'captcha protection: request disallowed' }))).toBe(
      true,
    );
  });

  it('NÃO confunde credencial inválida com captcha', () => {
    // Este é o ponto do módulo: se confundisse, o usuário veria "verificação de
    // segurança" ao errar a senha, e trocaria a senha para resolver o que não
    // era senha.
    expect(isCaptchaError(authError({ code: 'invalid_credentials' }))).toBe(false);
  });

  it('erro ausente não é erro de captcha', () => {
    expect(isCaptchaError(null)).toBe(false);
    expect(isCaptchaError(undefined)).toBe(false);
  });
});
