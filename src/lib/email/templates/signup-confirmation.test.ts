import { describe, expect, it } from 'vitest';

import {
  renderSignupConfirmationEmail,
  SIGNUP_CONFIRMATION_EMAIL_TEMPLATE_VERSION,
} from './signup-confirmation';

const signupRef = 'a'.repeat(64);
const confirmUrl = `https://app.qoro.test/auth/confirm#token_hash=abc123&type=signup&next=%2Fcadastro%2Fconfirmado&signup_ref=${signupRef}`;
const expectedOrigin = 'https://app.qoro.test';
const verificationCode = '12345678';

describe('renderSignupConfirmationEmail', () => {
  it('monta o primeiro envio com o link completo em HTML e em texto', () => {
    const email = renderSignupConfirmationEmail({ confirmUrl, expectedOrigin, verificationCode });

    expect(SIGNUP_CONFIRMATION_EMAIL_TEMPLATE_VERSION).toBe('signup-confirmation.v3');
    expect(email.subject).toBe('Confirme seu e-mail — Qoro');
    // O texto é o que sobra quando o cliente de e-mail bloqueia HTML. Sem o link
    // ali, a mensagem chega inútil exatamente para quem tem menos recurso.
    expect(email.text).toContain(confirmUrl);
    expect(email.html).toContain('<!DOCTYPE html PUBLIC');
    expect(email.html).toContain('lang="pt-BR"');
    // No HTML o `&` vira `&amp;` — é o escape correto, e é o que faz o link
    // sobreviver a clientes de e-mail que reparseiam o corpo.
    expect(email.html).toContain(`href="${confirmUrl.replaceAll('&', '&amp;')}"`);
    expect(email.html).not.toContain(`href="${confirmUrl}"`);
    expect(email.html).toContain('Confirmar meu e-mail');
    expect(email.html).toContain('logo_master_blaster_powerrr.png');
    // Outlook desktop ignora vários estilos de âncora. O fallback VML fazia
    // parte do template aprovado e não pode sumir ao mover o HTML para código.
    expect(email.html).toContain('<v:roundrect');
    expect(email.html).toContain('<w:anchorlock/>');
    expect(email.text).toContain(verificationCode);
    expect(email.html).toContain(verificationCode);
    expect(new URL(confirmUrl).search).toBe('');
    expect(new URL(confirmUrl).hash).not.toContain(verificationCode);
  });

  it('o reenvio se apresenta como o link NOVO, não como uma cópia do anterior', () => {
    const reenvio = renderSignupConfirmationEmail({
      confirmUrl: confirmUrl.replace('type=signup', 'type=recovery'),
      expectedOrigin,
      verificationCode,
      first: false,
    });

    expect(reenvio.subject).toBe('Seu novo link de confirmação — Qoro');
    // Duas mensagens idênticas na caixa fazem a pessoa clicar na de cima, que é a
    // antiga — e o GoTrue invalidou a antiga ao emitir esta.
    expect(reenvio.text).toContain('substitui o anterior');
    expect(reenvio.html).toContain('Seu novo link de confirmação');
  });

  it('NÃO sobrou variável de template do painel no corpo', () => {
    const { html, text } = renderSignupConfirmationEmail({
      confirmUrl,
      expectedOrigin,
      verificationCode,
    });
    // Era exatamente isto que quebrava: o corpo dependia do Supabase substituir
    // `{{ .TokenHash }}`. Se um `{{` reaparecer aqui, o e-mail volta a sair com
    // um link literal, e ninguém percebe até alguém clicar.
    for (const corpo of [html, text]) {
      expect(corpo).not.toContain('{{');
      expect(corpo).not.toContain('ConfirmationURL');
    }
  });

  it.each([
    [
      'sem token_hash',
      `https://app.qoro.test/auth/confirm#type=signup&next=%2Fcadastro%2Fconfirmado&signup_ref=${signupRef}`,
    ],
    [
      'tipo que o confirm não usa aqui',
      `https://app.qoro.test/auth/confirm#token_hash=a&type=invite&next=%2Fcadastro%2Fconfirmado&signup_ref=${signupRef}`,
    ],
    [
      'fora do /auth/confirm',
      `https://app.qoro.test/dashboard#token_hash=a&type=signup&next=%2Fcadastro%2Fconfirmado&signup_ref=${signupRef}`,
    ],
    [
      'HTTP em host remoto',
      `http://app.qoro.test/auth/confirm#token_hash=a&type=signup&next=%2Fcadastro%2Fconfirmado&signup_ref=${signupRef}`,
    ],
    [
      'origem diferente',
      `https://evil.example/auth/confirm#token_hash=a&type=signup&next=%2Fcadastro%2Fconfirmado&signup_ref=${signupRef}`,
    ],
    [
      'com credenciais embutidas',
      `https://u:p@app.qoro.test/auth/confirm#token_hash=a&type=signup&next=%2Fcadastro%2Fconfirmado&signup_ref=${signupRef}`,
    ],
    [
      'credencial na query',
      `https://app.qoro.test/auth/confirm?token_hash=a#token_hash=a&type=signup&next=%2Fcadastro%2Fconfirmado&signup_ref=${signupRef}`,
    ],
    ['fragmento incompleto', 'https://app.qoro.test/auth/confirm#token_hash=a&type=signup'],
    [
      'relativa',
      `/auth/confirm#token_hash=a&type=signup&next=%2Fcadastro%2Fconfirmado&signup_ref=${signupRef}`,
    ],
  ])('recusa URL que já sairia quebrada: %s', (_caso, url) => {
    // Lançar aqui deixa a falha no servidor. Enviar deixaria a falha na caixa de
    // entrada de alguém, onde não há conserto possível.
    expect(() =>
      renderSignupConfirmationEmail({
        confirmUrl: url,
        expectedOrigin,
        verificationCode,
      }),
    ).toThrow('[email]');
  });

  it('aceita localhost em HTTP, que é como o fluxo roda na máquina de quem desenvolve', () => {
    expect(() =>
      renderSignupConfirmationEmail({
        confirmUrl: `http://localhost:3000/auth/confirm#token_hash=a&type=signup&next=%2Fcadastro%2Fconfirmado&signup_ref=${signupRef}`,
        expectedOrigin: 'http://localhost:3000',
        verificationCode,
      }),
    ).not.toThrow();
  });

  it('recusa qualquer campo extra antes que texto hostil alcance o href', () => {
    expect(() =>
      renderSignupConfirmationEmail({
        confirmUrl: `${confirmUrl}&x="><script>alert(1)</script>`,
        expectedOrigin,
        verificationCode,
      }),
    ).toThrow('[email]');
  });

  it.each(['1234567', '123456789', 'abcd5678', ' 12345678'])(
    'recusa código de handoff fora do contrato: %s',
    (invalidCode) => {
      expect(() =>
        renderSignupConfirmationEmail({
          confirmUrl,
          expectedOrigin,
          verificationCode: invalidCode,
        }),
      ).toThrow('[email]');
    },
  );
});
