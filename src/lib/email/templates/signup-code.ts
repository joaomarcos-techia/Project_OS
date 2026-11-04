import 'server-only';

import type { SignupConfirmationEmail } from './signup-confirmation';

/** No executable content, bearer link, password or tracking pixel in this message. */
export function renderSignupCodeEmail(code: string): SignupConfirmationEmail {
  if (!/^\d{8}$/u.test(code)) throw new Error('[email] invalid signup code');
  const subject = 'Seu código de confirmação — Qoro';
  const text = `${code}\n\nConfirme seu e-mail na Qoro\n\nVolte à tela de cadastro e cole este código no campo “Código de confirmação”. Ele vale por 10 minutos e só pode ser usado uma vez.\n\nVocê continuará de onde parou. Só pediremos informações que ainda faltam para concluir seu cadastro. Se não iniciou este cadastro, ignore esta mensagem.\n\nQoro — gestão de clínicas.`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f7f8;color:#202b2d;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" style="max-width:520px;background:#fff;border:1px solid #d9dfe2;border-top:5px solid #00737e;border-radius:14px"><tr><td style="padding:28px 24px"><p style="margin:0 0 20px;color:#00737e;font-family:Georgia,serif;font-size:26px">Qoro</p><h1 style="margin:0;font-family:Georgia,serif;font-size:26px;font-weight:normal">Confirme seu e-mail</h1><p style="line-height:1.6;color:#4b5457">Volte à tela de cadastro e cole este código:</p><p style="margin:24px 0;padding:18px 12px;background:#f0f9fa;border:1px solid #d9f0f3;border-radius:9px;text-align:center;font-family:monospace;font-size:32px;font-weight:bold;letter-spacing:4px;user-select:all">${code}</p><p style="line-height:1.6;color:#4b5457">Válido por <strong>10 minutos</strong>, para uso único. Você continuará de onde parou. Só pediremos informações que ainda faltam para concluir seu cadastro.</p><hr style="border:0;border-top:1px solid #e6ebec;margin:24px 0"><p style="font-size:13px;line-height:1.6;color:#7a8284">Se você não iniciou este cadastro, ignore esta mensagem. Nenhuma clínica ou cobrança será criada por este e-mail.</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}
