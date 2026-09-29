import 'server-only';

export const TEAM_INVITE_EMAIL_TEMPLATE_VERSION = 'team-invite.v1';

const QORO_LOGO_URL =
  'https://shlcbxawrxuaebazuiue.supabase.co/storage/v1/object/public/logo_qoro/logo_master_blaster_powerrr.png';
const LOCALHOST_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export type TeamInviteEmail = { subject: string; text: string; html: string };

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const replacements: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };
    return replacements[character] ?? character;
  });
}

function displayText(value: string, fallback: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim().slice(0, 160);
  return normalized || fallback;
}

function assertInviteUrl(raw: string, expectedOrigin: string): URL {
  let url: URL;
  let origin: string;
  try {
    url = new URL(raw);
    origin = new URL(expectedOrigin).origin;
  } catch {
    throw new Error('[email] team invite URL or origin is invalid');
  }
  const insecureLocal = url.protocol === 'http:' && LOCALHOST_NAMES.has(url.hostname);
  if ((url.protocol !== 'https:' && !insecureLocal) || url.origin !== origin) {
    throw new Error('[email] team invite URL must use the application origin');
  }
  if (url.username || url.password || url.pathname !== '/auth/confirm' || url.search) {
    throw new Error('[email] team invite URL has an invalid target');
  }
  const fragment = new URLSearchParams(url.hash.slice(1));
  const allowed = new Set(['token_hash', 'type', 'next']);
  for (const key of fragment.keys()) {
    if (!allowed.has(key) || fragment.getAll(key).length !== 1) {
      throw new Error('[email] team invite URL has invalid fragment fields');
    }
  }
  const tokenHash = fragment.get('token_hash');
  if (!tokenHash || !/^[A-Za-z0-9_-]{1,2048}$/u.test(tokenHash)) {
    throw new Error('[email] team invite URL must carry token_hash');
  }
  if (fragment.get('type') !== 'recovery' || fragment.get('next') !== '/convite') {
    throw new Error('[email] team invite URL must be a recovery link to /convite');
  }
  return url;
}

export function renderTeamInviteEmail(input: {
  inviteUrl: string;
  expectedOrigin: string;
  inviteeName: string;
  clinicName: string;
  roleLabel: string;
  inviterName: string;
}): TeamInviteEmail {
  const inviteUrl = assertInviteUrl(input.inviteUrl, input.expectedOrigin).toString();
  const safeUrl = escapeHtml(inviteUrl);
  const inviteeName = displayText(input.inviteeName, 'você');
  const clinicName = displayText(input.clinicName, 'sua clínica');
  const roleLabel = displayText(input.roleLabel, 'membro da equipe');
  const inviterName = displayText(input.inviterName, 'A equipe da clínica');
  const subject = `Convite para a equipe de ${clinicName} — Qoro`;
  const greeting = inviteeName === 'você' ? 'Olá.' : `Olá, ${inviteeName}.`;
  const introduction = `${inviterName} convidou você para atuar como ${roleLabel} na equipe de ${clinicName}.`;
  const notice =
    'Crie sua senha para aceitar o convite. Por segurança, o link tem validade limitada e só pode ser usado uma vez.';
  const text = [
    greeting,
    '',
    introduction,
    '',
    inviteUrl,
    '',
    notice,
    '',
    'Se você não esperava este convite, ignore esta mensagem.',
    '',
    'Qoro — gestão de clínicas. Este é um e-mail automático; não responda.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#eef3f4;">
  <div style="display:none;max-height:0;overflow:hidden;color:#eef3f4;">Você recebeu um convite para a equipe no Qoro.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#eef3f4;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;">
        <tr><td style="height:5px;background:linear-gradient(90deg,#00737e 72%,#d27c55 72%);border-radius:14px 14px 0 0;font-size:0;">&nbsp;</td></tr>
        <tr><td style="background:#fff;border:1px solid #d9dfe2;border-top:0;border-radius:0 0 14px 14px;padding:30px 44px 36px;">
          <img src="${QORO_LOGO_URL}" width="116" height="42" alt="Qoro" style="display:block;border:0;width:116px;height:42px;">
          <p style="margin:28px 0 0;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#00737e;">Convite para a equipe</p>
          <h1 style="margin:12px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.2;font-weight:normal;color:#202b2d;">${escapeHtml(greeting)}</h1>
          <p style="margin:18px 0 0;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:16px;line-height:1.65;color:#4b5457;">${escapeHtml(introduction)}</p>
          <p style="margin:28px 0 4px;"><a href="${safeUrl}" style="display:inline-block;background:#00737e;color:#fff;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:16px;font-weight:700;line-height:52px;text-decoration:none;border-radius:11px;padding:0 30px;">Aceitar convite</a></p>
          <p style="margin:22px 0 0;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:13px;line-height:1.55;color:#7a8284;">Se o botão não funcionar, copie este endereço:</p>
          <div style="margin-top:8px;background:#f0f9fa;border:1px solid #d9f0f3;border-radius:9px;padding:12px 14px;font-family:'Courier New',monospace;font-size:12.5px;line-height:1.5;color:#005e68;word-break:break-all;">${safeUrl}</div>
          <hr style="border:0;border-top:1px solid #e6ebec;margin:26px 0 18px;">
          <p style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:13px;line-height:1.6;color:#7a8284;">${escapeHtml(notice)} Se você não esperava este convite, ignore esta mensagem.</p>
        </td></tr>
        <tr><td style="padding:24px 44px 8px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;line-height:1.6;color:#7a8284;">Qoro — gestão de clínicas. Este é um e-mail automático; não responda.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, text, html };
}
