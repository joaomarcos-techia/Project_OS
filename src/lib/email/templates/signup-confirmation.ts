import 'server-only';

/**
 * E-mail de confirmação do cadastro autônomo — agora RENDERIZADO AQUI.
 *
 * Por que saiu do painel do Supabase. Até 22/09/2026 este e-mail era o template
 * "Confirm signup" colado à mão no dashboard, um por projeto. O §35.18 já tinha
 * registrado o estrago dessa dependência uma vez: com o template antigo em
 * vigor, o link chegava como `ConfirmationURL`, o GoTrue consumia o OTP no
 * `/auth/v1/verify` dele e redirecionava para `/auth/confirm` SEM `token_hash` —
 * a pessoa lia "Link inválido" numa conta que acabara de ser confirmada, e o
 * reenvio então falhava com razão, porque não havia mais nada a confirmar.
 * Consertar aquilo foi colar o template certo em DEV. Produção ficou com o
 * antigo, e o mesmo defeito voltou em produção.
 *
 * O conserto durável não é colar de novo com mais cuidado: é não depender de uma
 * etapa manual, por projeto, que nenhum teste consegue ver. O corpo do e-mail
 * mora no repositório, o link é montado por `createSignupConfirmationUrl` e o
 * envio é nosso (Resend), igual ao convite de clínica. O painel deixa de poder
 * divergir porque deixou de participar.
 *
 * O desenho é o mesmo de `design_system/email-confirmar-cadastro.html`, que foi
 * absorvido por este módulo — manter as duas cópias seria recriar a divergência
 * numa camada mais barata de ignorar.
 */

export const SIGNUP_CONFIRMATION_EMAIL_TEMPLATE_VERSION = 'signup-confirmation.v4';

const QORO_LOGO_URL =
  'https://shlcbxawrxuaebazuiue.supabase.co/storage/v1/object/public/logo_qoro/logo_master_blaster_powerrr.png';

const LOCALHOST_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export type SignupConfirmationEmail = {
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
 * Recusa a URL antes de ela virar e-mail.
 *
 * A checagem não é cerimônia: este é o único ponto do fluxo em que um endereço
 * vira algo que muita gente vai clicar sem olhar. Um `token_hash` faltando, um
 * `type` que o `/auth/confirm` não aceita ou um host que não é o nosso viram um
 * e-mail que já sai quebrado — e e-mail enviado não se corrige. Lançar aqui
 * deixa a falha no servidor, onde ela é vista.
 */
function assertConfirmUrl(raw: string, expectedOrigin: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('[email] signup confirmation URL is not absolute');
  }
  const insecureLocal = url.protocol === 'http:' && LOCALHOST_NAMES.has(url.hostname);
  if (url.protocol !== 'https:' && !insecureLocal) {
    throw new Error('[email] signup confirmation URL must use HTTPS');
  }
  if (url.username || url.password) {
    throw new Error('[email] signup confirmation URL must not carry credentials');
  }
  let origin: string;
  try {
    origin = new URL(expectedOrigin).origin;
  } catch {
    throw new Error('[email] signup confirmation origin is invalid');
  }
  if (url.origin !== origin) {
    throw new Error('[email] signup confirmation URL must use the application origin');
  }
  if (url.pathname !== '/auth/confirm') {
    throw new Error('[email] signup confirmation URL must point to /auth/confirm');
  }
  if (url.search) {
    throw new Error('[email] signup confirmation URL must keep credentials out of the query');
  }
  const fragment = new URLSearchParams(url.hash.slice(1));
  const allowed = new Set(['token_hash', 'type', 'next', 'signup_ref']);
  for (const key of fragment.keys()) {
    if (!allowed.has(key) || fragment.getAll(key).length !== 1) {
      throw new Error('[email] signup confirmation URL has invalid fragment fields');
    }
  }
  const tokenHash = fragment.get('token_hash');
  if (!tokenHash || !/^[A-Za-z0-9_-]{1,2048}$/u.test(tokenHash)) {
    throw new Error('[email] signup confirmation URL must carry token_hash');
  }
  const type = fragment.get('type');
  if (type !== 'signup' && type !== 'magiclink' && type !== 'recovery') {
    throw new Error('[email] signup confirmation URL must carry a signup OTP type');
  }
  if (
    fragment.get('next') !== '/cadastro/confirmado' ||
    !/^[a-f0-9]{64}$/u.test(fragment.get('signup_ref') ?? '')
  ) {
    throw new Error('[email] signup confirmation URL must target its exact draft');
  }
  return url;
}

/**
 * `first` distingue o primeiro envio do reenvio numa única frase.
 *
 * Não é enfeite: quem pediu o reenvio já tem a mensagem anterior na caixa, e as
 * duas são visualmente idênticas. Dizer qual é a nova é o que evita a pessoa
 * clicar na antiga — que o GoTrue invalidou ao emitir esta.
 */
export function renderSignupConfirmationEmail(input: {
  confirmUrl: string;
  expectedOrigin: string;
  verificationCode: string;
  first?: boolean;
}): SignupConfirmationEmail {
  const url = assertConfirmUrl(input.confirmUrl, input.expectedOrigin);
  if (!/^\d{8}$/u.test(input.verificationCode)) {
    throw new Error('[email] signup verification code must have eight digits');
  }
  const link = url.toString();
  const safeLink = escapeHtml(link);
  const safeVerificationCode = escapeHtml(input.verificationCode);
  const first = input.first !== false;
  const abertura = first
    ? 'Recebemos seu pedido para criar uma conta no Qoro. Confirme este endereço de e-mail para continuar o cadastro da sua clínica.'
    : 'Aqui está um link novo para confirmar seu e-mail no Qoro. Ele substitui o anterior, que deixou de valer — use este.';
  const titulo = first ? 'Confirme seu e-mail' : 'Seu novo link de confirmação';
  const subject = first ? 'Confirme seu e-mail — Qoro' : 'Seu novo link de confirmação — Qoro';

  const text = [
    titulo,
    '',
    abertura,
    '',
    link,
    '',
    'Depois de confirmar, crie sua senha na página aberta pelo link e continue por lá. Se preferir continuar na aba onde iniciou o cadastro, use este código:',
    input.verificationCode,
    '',
    'Por segurança, este link tem validade limitada e só pode ser usado uma vez.',
    'Se você não iniciou este cadastro, ignore este e-mail: nenhuma clínica será criada por esta mensagem.',
    '',
    'Qoro — gestão de clínicas. Este é um e-mail automático; não responda.',
  ].join('\n');

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "https://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(subject)}</title>
  <!--[if mso]><xml><o:OfficeDocumentSettings xmlns:o="urn:schemas-microsoft-com:office:office"><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
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
    Confirme seu e-mail para continuar seu cadastro no Qoro.
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
                    <span style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; font-weight:700; letter-spacing:1.6px; text-transform:uppercase; color:#00737e; vertical-align:middle; padding-left:8px;">Confirmação de cadastro</span>
                  </td>
                </tr>
                <tr>
                  <td class="px h1" style="padding:12px 44px 0 44px; font-family:Georgia,'Times New Roman',serif; font-size:30px; line-height:1.2; color:#202b2d; font-weight:normal;">
                    ${escapeHtml(titulo)}
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
                      <center style="color:#ffffff;font-family:sans-serif;font-size:16px;font-weight:bold;">Confirmar meu e-mail</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-- -->
                    <a href="${safeLink}" style="background:#00737e; color:#f9fdfd; display:inline-block; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; font-weight:700; line-height:52px; text-align:center; text-decoration:none; border-radius:11px; padding:0 30px; min-width:200px;">Confirmar meu e-mail</a>
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
                  <td class="px" style="padding:24px 44px 0 44px; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:14px; line-height:1.55; color:#4b5457;">
                    Depois de confirmar, crie sua senha na página aberta pelo link e continue por lá.
                    Se preferir continuar na aba onde iniciou o cadastro, use este código:
                  </td>
                </tr>
                <tr>
                  <td class="px" style="padding:10px 44px 0 44px;">
                    <div style="display:inline-block; background:#f5f7f8; border:1px solid #d9dfe2; border-radius:9px; padding:11px 16px; font-family:'Courier New',Courier,monospace; font-size:22px; font-weight:700; line-height:1; letter-spacing:4px; color:#202b2d;">${safeVerificationCode}</div>
                  </td>
                </tr>
                <tr>
                  <td class="px" style="padding:26px 44px 0 44px;">
                    <hr style="border:0; border-top:1px solid #e6ebec; margin:0;" />
                  </td>
                </tr>
                <tr>
                  <td class="px" style="padding:18px 44px 34px 44px; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; line-height:1.6; color:#7a8284;">
                    Por segurança, este link tem validade limitada e só pode ser usado uma vez. <strong style="color:#4b5457;">Se você não iniciou este cadastro</strong>, ignore este e-mail — nenhuma clínica será criada por esta mensagem.
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
