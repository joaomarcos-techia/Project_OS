import 'server-only';

export function renderSignupRecoveryEmail(input: {
  url: string;
  publicOrigin: string;
  name?: string;
  kind: 'verify_email' | 'resume_signup';
  retainedDetails: boolean;
}): { subject: string; html: string; text: string } {
  const link = new URL(input.url);
  const token = new URLSearchParams(link.hash.slice(1)).get('token');
  if (
    link.origin !== input.publicOrigin ||
    link.username ||
    link.password ||
    link.search ||
    link.pathname !== '/cadastro/retomar' ||
    !token ||
    !/^[A-Za-z0-9_-]{43}$/u.test(token) ||
    (link.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(link.hostname))
  ) {
    throw new Error('[email] invalid signup recovery URL');
  }
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/gu,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
    );
  const subject =
    input.kind === 'verify_email'
      ? 'Problemas para confirmar seu e-mail? Vamos resolver!'
      : 'Seu cadastro está quase pronto!';
  const greeting = input.name?.trim() ? `Olá, ${input.name.trim().slice(0, 120)}!` : 'Olá!';
  const introduction =
    input.kind === 'verify_email'
      ? 'Você começou a criar sua conta na Qoro, mas a confirmação do e-mail ainda está pendente. Preparamos uma forma simples de continuar.'
      : 'Sua conta na Qoro está quase pronta. Continue para concluir a escolha do plano ou o checkout que estiver pendente.';
  const retention = input.retainedDetails
    ? 'Os dados salvos do seu cadastro serão preservados. Não criaremos outra conta nem outra cobrança por este link.'
    : 'Sua conta continua reservada. Se algum dado anterior não estiver mais disponível, pediremos apenas o que faltar para concluir, sem criar outra conta.';
  const cta = input.kind === 'verify_email' ? 'Continuar meu cadastro' : 'Finalizar meu cadastro';
  const text = `${greeting}\n\n${introduction}\n\n${retention}\n\n${cta}: ${link.href}\n\nO link é individual, vale por 24 horas e só pode ser usado uma vez. Ao abrir, clique em continuar para verificar seu e-mail com segurança. Se você já concluiu ou não iniciou este cadastro, ignore esta mensagem.\n\nQoro — gestão de clínicas.`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f7f8;color:#202b2d;font-family:system-ui,-apple-system,'Segoe UI',sans-serif"><table role="presentation" width="100%"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" style="max-width:520px;background:white;border:1px solid #d9dfe2;border-top:5px solid #00737e;border-radius:14px"><tr><td style="padding:28px 24px"><p style="color:#00737e;font:26px Georgia,serif">Qoro</p><h1 style="font:normal 26px Georgia,serif">${escape(greeting)}</h1><p style="line-height:1.6">${escape(introduction)}</p><p style="line-height:1.6">${escape(retention)}</p><p style="margin:28px 0"><a href="${escape(link.href)}" style="display:inline-block;padding:16px 20px;background:#00737e;color:white;border-radius:8px;text-decoration:none;font-weight:600">${cta}</a></p><p style="font-size:13px;line-height:1.6;color:#4b5457">Este link individual vale por 24 horas e só pode ser usado uma vez. Ao abrir, clique em continuar para verificar seu e-mail. Se você já concluiu ou não iniciou este cadastro, ignore esta mensagem.</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, html, text };
}
