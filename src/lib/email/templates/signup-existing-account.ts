import 'server-only';

import type { SignupConfirmationEmail } from './signup-confirmation';

/**
 * Aviso para quem pediu cadastro com um e-mail que já entra na Qoro.
 *
 * A tela do cadastro responde igual para conta nova e existente (ADR-062 §6);
 * este e-mail, que só o dono do endereço lê, é o que diz o que fazer. Não leva
 * código, token nem link de uso único: só a tela de entrada.
 */
export function renderSignupExistingAccountEmail(input: {
  loginUrl: string;
  publicOrigin: string;
}): SignupConfirmationEmail {
  const link = new URL(input.loginUrl);
  if (
    link.origin !== input.publicOrigin ||
    link.username ||
    link.password ||
    link.search ||
    link.hash ||
    link.pathname !== '/login' ||
    (link.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(link.hostname))
  ) {
    throw new Error('[email] invalid existing-account login URL');
  }
  const href = link.href.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;');
  const subject = 'Você já tem uma conta na Qoro';
  const text = `Olá!\n\nRecebemos um pedido para criar uma conta na Qoro com este e-mail. Este endereço já tem uma conta, então nenhuma conta nova foi criada e nada foi alterado.\n\nPara continuar, entre com sua senha: ${link.href}\n\nEsqueceu a senha? Na tela de entrada, use “Esqueci a senha”.\n\nSe não foi você, ignore esta mensagem. Este pedido não dá acesso à sua conta.\n\nQoro — gestão de clínicas.`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f7f8;color:#202b2d;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" style="max-width:520px;background:#fff;border:1px solid #d9dfe2;border-top:5px solid #00737e;border-radius:14px"><tr><td style="padding:28px 24px"><p style="margin:0 0 20px;color:#00737e;font:26px Georgia,serif">Qoro</p><h1 style="margin:0;font-family:Georgia,serif;font-size:26px;font-weight:normal">Você já tem uma conta</h1><p style="line-height:1.6;color:#4b5457">Recebemos um pedido para criar uma conta na Qoro com este e-mail. Este endereço já tem uma conta, então nenhuma conta nova foi criada e nada foi alterado.</p><p style="margin:28px 0"><a href="${href}" style="display:inline-block;padding:16px 20px;background:#00737e;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Entrar na Qoro</a></p><p style="line-height:1.6;color:#4b5457">Esqueceu a senha? Na tela de entrada, use <strong>Esqueci a senha</strong>.</p><hr style="border:0;border-top:1px solid #e6ebec;margin:24px 0"><p style="font-size:13px;line-height:1.6;color:#7a8284">Se não foi você, ignore esta mensagem. Este pedido não dá acesso à sua conta.</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}
