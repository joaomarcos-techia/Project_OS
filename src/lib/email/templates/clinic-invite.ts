import 'server-only';

import { readOnboardingInviteToken } from '@/lib/auth/onboarding-invite-fragment';

export const CLINIC_INVITE_EMAIL_TEMPLATE_VERSION = 'clinic-invite.v2';

const EXPIRATION_HOURS = 24;
const QORO_LOGO_URL =
  'https://shlcbxawrxuaebazuiue.supabase.co/storage/v1/object/public/logo_qoro/logo_master_blaster_powerrr.png';

export type ClinicInviteEmail = {
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

function assertInviteUrl(inviteUrl: string): URL {
  let url: URL;
  try {
    url = new URL(inviteUrl);
  } catch {
    throw new Error('[email] clinic invite URL must be absolute');
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.pathname !== '/join' ||
    !readOnboardingInviteToken(url.hash)
  ) {
    throw new Error('[email] clinic invite URL is invalid');
  }
  return url;
}

export function renderClinicInviteEmail(input: { inviteUrl: string }): ClinicInviteEmail {
  const inviteUrl = assertInviteUrl(input.inviteUrl).toString();
  const escapedInviteUrl = escapeHtml(inviteUrl);
  const subject = 'Ative sua clínica no Qoro';
  const expiration = `${EXPIRATION_HOURS} horas`;

  return {
    subject,
    text: [
      'Você recebeu um convite para concluir o cadastro da sua clínica no Qoro.',
      '',
      `Abra o convite: ${inviteUrl}`,
      '',
      `Por segurança, este link expira em ${expiration}. Se você não reconhece este convite, ignore este e-mail.`,
    ].join('\n'),
    html: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "https://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>Ative sua clínica — Qoro</title>
  <style>
    body,table,td,a{ -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    img{ border:0; outline:none; text-decoration:none; }
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
                    <img src="${QORO_LOGO_URL}" width="116" height="42" alt="Qoro" style="display:block; height:42px; width:116px;" />
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="px" style="padding:28px 44px 0 44px;">
                    <span style="display:inline-block; width:7px; height:7px; background:#d27c55; border-radius:9px; vertical-align:middle;">&nbsp;</span>
                    <span style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; font-weight:700; letter-spacing:1.6px; text-transform:uppercase; color:#00737e; vertical-align:middle; padding-left:8px;">Convite para sua clínica</span>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="px h1" style="padding:12px 44px 0 44px; font-family:Georgia,'Times New Roman',serif; font-size:30px; line-height:1.2; color:#202b2d;">
                    Ative sua clínica no Qoro
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="px" style="padding:18px 44px 0 44px; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.65; color:#4b5457;">
                    Você recebeu um convite para concluir o cadastro da sua clínica e criar seu acesso de gestor no Qoro.
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="px cta" style="padding:28px 44px 4px 44px;">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapedInviteUrl}" style="height:52px;v-text-anchor:middle;width:250px;" arcsize="20%" stroke="f" fillcolor="#00737e">
                      <w:anchorlock/>
                      <center style="color:#ffffff;font-family:sans-serif;font-size:16px;font-weight:bold;">Ativar minha clínica</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-- -->
                    <a href="${escapedInviteUrl}" style="background:#00737e; color:#f9fdfd; display:inline-block; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; font-weight:700; line-height:52px; text-align:center; text-decoration:none; border-radius:11px; padding:0 30px; min-width:200px;">Ativar minha clínica</a>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="px" style="padding:22px 44px 0 44px; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; line-height:1.55; color:#7a8284;">
                    Se o botão não funcionar, copie e cole este endereço no navegador:
                  </td>
                </tr>
                <tr>
                  <td class="px" style="padding:8px 44px 0 44px;">
                    <div style="background:#f0f9fa; border:1px solid #d9f0f3; border-radius:9px; padding:12px 14px; font-family:'Courier New',Courier,monospace; font-size:12.5px; line-height:1.5; color:#005e68; word-break:break-all;">${escapedInviteUrl}</div>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="px" style="padding:26px 44px 0 44px;">
                    <hr style="border:0; border-top:1px solid #e6ebec; margin:0;" />
                  </td>
                </tr>
                <tr>
                  <td class="px" style="padding:18px 44px 34px 44px; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; line-height:1.6; color:#7a8284;">
                    Este link expira em ${expiration} e só pode ser usado uma vez. Se você não esperava este convite, pode ignorar este e-mail.
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
</html>`,
  };
}
