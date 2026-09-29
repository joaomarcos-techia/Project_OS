import 'server-only';

/**
 * E-mail de redefinição de senha — renderizado AQUI, não no painel do Supabase.
 *
 * Até 29/09/2026 este e-mail era o template "Reset Password" do painel, e o do
 * repositório (`design_system/email-reset-senha.html`) usava
 * `{{ .ConfirmationURL }}`. Esse link passa pelo `/auth/v1/verify` do GoTrue:
 * ele consome o token e devolve a sessão na própria URL. Desde a AUTH-006,
 * `/reset-password` só aceita a prova de recovery que `/auth/confirm` emite
 * depois de `verifyOtp` — então TODO pedido feito em "Esqueci a senha" terminava
 * em "Link inválido ou expirado". Reproduzido em 29/09: o link no formato do
 * painel cai no erro; o link no formato abaixo abre o formulário.
 *
 * Mesmo desenho do e-mail de confirmação de cadastro: o link é montado pelo
 * código, validado aqui antes de sair, e enviado pelo Resend.
 */

export const PASSWORD_RESET_EMAIL_TEMPLATE_VERSION = 'password-reset.v1';

const QORO_LOGO_URL =
  'https://shlcbxawrxuaebazuiue.supabase.co/storage/v1/object/public/logo_qoro/logo_master_blaster_powerrr.png';

const LOCALHOST_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export type PasswordResetEmail = {
  subject: string;
  text: string;
  html: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case "'":
        return '&#39;';
      case '"':
        return '&quot;';
      default:
        return character;
    }
  });
}

/**
 * Recusa o link antes de ele virar e-mail. Um e-mail enviado não se corrige: um
 * `type` errado, um token faltando ou o token na query (onde ele iria ao log e
 * ao Referer) viram uma mensagem que já sai quebrada ou vazando credencial.
 */
function assertResetUrl(raw: string, expectedOrigin: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('[email] password reset URL is not absolute');
  }
  const insecureLocal = url.protocol === 'http:' && LOCALHOST_NAMES.has(url.hostname);
  if (url.protocol !== 'https:' && !insecureLocal) {
    throw new Error('[email] password reset URL must use HTTPS');
  }
  if (url.username || url.password) {
    throw new Error('[email] password reset URL must not carry credentials');
  }
  let origin: string;
  try {
    origin = new URL(expectedOrigin).origin;
  } catch {
    throw new Error('[email] password reset origin is invalid');
  }
  if (url.origin !== origin) {
    throw new Error('[email] password reset URL must use the application origin');
  }
  if (url.pathname !== '/auth/confirm') {
    throw new Error('[email] password reset URL must point to /auth/confirm');
  }
  if (url.search) {
    throw new Error('[email] password reset URL must keep the token out of the query');
  }
  const fragment = new URLSearchParams(url.hash.slice(1));
  const allowed = new Set(['token_hash', 'type', 'next']);
  for (const key of fragment.keys()) {
    if (!allowed.has(key) || fragment.getAll(key).length !== 1) {
      throw new Error('[email] password reset URL has invalid fragment fields');
    }
  }
  const tokenHash = fragment.get('token_hash');
  if (!tokenHash || !/^[A-Za-z0-9_-]{1,2048}$/u.test(tokenHash)) {
    throw new Error('[email] password reset URL must carry token_hash');
  }
  if (fragment.get('type') !== 'recovery' || fragment.get('next') !== '/reset-password') {
    throw new Error('[email] password reset URL must be a recovery link to /reset-password');
  }
  return url;
}

export function renderPasswordResetEmail(input: {
  resetUrl: string;
  expectedOrigin: string;
}): PasswordResetEmail {
  const link = assertResetUrl(input.resetUrl, input.expectedOrigin).toString();
  const safeLink = escapeHtml(link);
  const subject = 'Redefinir senha — Qoro';
  const abertura =
    'Recebemos um pedido para redefinir a senha da sua conta no Qoro. Clique no botão abaixo para criar uma nova senha.';
  const aviso =
    'Por segurança, este link tem validade limitada e só pode ser usado uma vez. Se você não pediu para redefinir a senha, ignore este e-mail: sua senha atual continua válida e nada muda.';

  const text = [
    'Redefinir sua senha',
    '',
    abertura,
    '',
    link,
    '',
    aviso,
    '',
    'Qoro — gestão de clínicas. Este é um e-mail automático; não responda.',
  ].join('\n');

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "https://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(subject)}</title>
  <style>
    body,table,td,a{ -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table,td{ mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img{ -ms-interpolation-mode:bicubic; border:0; line-height:100%; outline:none; text-decoration:none; }
    body{ margin:0; padding:0; width:100%!important; }
    a{ color:#00737e; }
    @media only screen and (max-width:620px){
      .wrap{ width:100%!important; }
      .px{ padding-left:24px!important; padding-right:24px!important; }
      .h1{ font-size:26px!important; line-height:1.22!important; }
      .cta a{ display:block!important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background:#eef3f4;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#eef3f4;">
    Link para redefinir sua senha do Qoro.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef3f4;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:600px; max-width:600px;">
          <tr>
            <td style="font-size:0; line-height:0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="72%" height="5" style="height:5px; background:#00737e; border-radius:14px 0 0 0; font-size:0; line-height:0;">&nbsp;</td>
                  <td width="28%" height="5" style="height:5px; background:#d27c55; border-radius:0 14px 0 0; font-size:0; line-height:0;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff; border:1px solid #d9dfe2; border-top:0; border-radius:0 0 14px 14px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="px" style="padding:30px 44px 0 44px;">
                    <img src="${QORO_LOGO_URL}" width="116" height="42" alt="Qoro" style="display:block; border:0; outline:none; text-decoration:none; height:42px; width:116px;" />
                  </td>
                </tr>
                <tr>
                  <td class="px" style="padding:28px 44px 0 44px;">
                    <span style="display:inline-block; width:7px; height:7px; background:#d27c55; border-radius:9px; vertical-align:middle;">&nbsp;</span>
                    <span style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; font-weight:700; letter-spacing:1.6px; text-transform:uppercase; color:#00737e; vertical-align:middle; padding-left:8px;">Segurança da conta</span>
                  </td>
                </tr>
                <tr>
                  <td class="px h1" style="padding:12px 44px 0 44px; font-family:Georgia,'Times New Roman',serif; font-size:30px; line-height:1.2; color:#202b2d; font-weight:normal;">
                    Redefinir sua senha
                  </td>
                </tr>
                <tr>
                  <td class="px" style="padding:18px 44px 0 44px; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.65; color:#4b5457;">
                    ${escapeHtml(abertura)}
                  </td>
                </tr>
                <tr>
                  <td class="px cta" style="padding:28px 44px 4px 44px;">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeLink}" style="height:52px;v-text-anchor:middle;width:250px;" arcsize="20%" stroke="f" fillcolor="#00737e">
                      <w:anchorlock/>
                      <center style="color:#ffffff;font-family:sans-serif;font-size:16px;font-weight:bold;">Redefinir minha senha</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-- -->
                    <a href="${safeLink}" style="background:#00737e; color:#f9fdfd; display:inline-block; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; font-weight:700; line-height:52px; text-align:center; text-decoration:none; border-radius:11px; padding:0 30px; min-width:200px;">Redefinir minha senha</a>
                    <!--<![endif]-->
                  </td>
                </tr>
                <tr>
                  <td class="px" style="padding:22px 44px 0 44px; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; line-height:1.55; color:#7a8284;">
                    Se o botão não funcionar, copie e cole este endereço no navegador:
                  </td>
                </tr>
                <tr>
                  <td class="px" style="padding:8px 44px 0 44px;">
                    <div style="background:#f0f9fa; border:1px solid #d9f0f3; border-radius:9px; padding:12px 14px; font-family:'Courier New',Courier,monospace; font-size:12.5px; line-height:1.5; color:#005e68; word-break:break-all;">${safeLink}</div>
                  </td>
                </tr>
                <tr>
                  <td class="px" style="padding:26px 44px 0 44px;">
                    <hr style="border:0; border-top:1px solid #e6ebec; margin:0;" />
                  </td>
                </tr>
                <tr>
                  <td class="px" style="padding:18px 44px 34px 44px; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; line-height:1.6; color:#7a8284;">
                    ${escapeHtml(aviso)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:24px 44px 8px 44px; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <div style="font-size:13px; color:#7a8284; line-height:1.6;">
                <span style="font-family:Georgia,'Times New Roman',serif; color:#4b5457;">Qoro</span> — gestão de clínicas.
              </div>
              <div style="font-size:12px; color:#9aa6a8; line-height:1.6; padding-top:4px;">
                Este é um e-mail automático — não responda.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}
