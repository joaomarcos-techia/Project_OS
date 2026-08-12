import 'server-only';

export const CLINIC_INVITE_EMAIL_TEMPLATE_VERSION = 'clinic-invite.v1';

const EXPIRATION_HOURS = 24;

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
    url.hash ||
    !/^\/join\/[A-Za-z0-9_-]{32,512}$/.test(url.pathname)
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
    html: `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;background:#f6f7fb;font-family:Arial,sans-serif;color:#182230">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding:32px 16px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px">
          <tr><td style="padding:32px">
            <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">Ative sua clínica no Qoro</h1>
            <p style="margin:0 0 24px;line-height:1.5">Você recebeu um convite para concluir o cadastro da sua clínica.</p>
            <p style="margin:0 0 24px"><a href="${escapedInviteUrl}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700">Abrir convite</a></p>
            <p style="margin:0;line-height:1.5;color:#526071">Por segurança, este link expira em ${expiration}. Se você não reconhece este convite, ignore este e-mail.</p>
          </td></tr>
        </table>
      </tr>
    </table>
  </body>
</html>`,
  };
}
