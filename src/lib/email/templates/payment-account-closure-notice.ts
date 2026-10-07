import 'server-only';

/**
 * Aviso de encerramento automático da conta Asaas pausada (decisão de
 * 07/10/2026). Sai 30 dias antes, para o dono resolver pendências ou retomar a
 * conta. Não carrega dado de paciente nem valor: só a clínica, a data e o link
 * da tela de Pagamentos.
 */

export const PAYMENT_ACCOUNT_CLOSURE_NOTICE_TEMPLATE_VERSION = 'payment-account-closure-notice.v1';

export type PaymentAccountClosureNoticeEmail = {
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

function dataBrasilia(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function renderPaymentAccountClosureNoticeEmail(input: {
  clinicName: string;
  closeAt: Date;
  settingsUrl: string;
}): PaymentAccountClosureNoticeEmail {
  const url = new URL(input.settingsUrl);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('[email] payment settings URL must use HTTPS');
  }
  const link = url.toString();
  const data = dataBrasilia(input.closeAt);
  const subject = `A conta Asaas pausada da ${input.clinicName} será encerrada em ${data}`;
  const paragrafos = [
    `A conta Asaas da ${input.clinicName} está pausada no Qoro e não tem movimentação há quase 6 meses. Se nada mudar, ela será encerrada automaticamente em ${data}.`,
    'Encerrar significa desativar o webhook no Asaas e apagar a chave guardada no Qoro. O dinheiro e a conta no Asaas não são afetados, mas pagamentos, estornos e contestações dessa conta deixam de ser conciliados aqui.',
    'Para manter a conta, retome as cobranças em Configurações › Pagamentos. Se ainda houver algo em aberto na data, o encerramento não acontece.',
  ];

  const text = [
    'Encerramento da conta Asaas pausada',
    '',
    ...paragrafos.flatMap((paragrafo) => [paragrafo, '']),
    link,
    '',
    'Qoro — gestão de clínicas. Este é um e-mail automático; não responda.',
  ].join('\n');

  const corpo = paragrafos
    .map(
      (paragrafo) =>
        `<p style="margin:0 0 16px 0; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.65; color:#4b5457;">${escapeHtml(paragrafo)}</p>`,
    )
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0; padding:0; background:#eef3f4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef3f4;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:100%; background:#ffffff; border:1px solid #d9dfe2; border-radius:14px;">
          <tr>
            <td style="padding:30px 40px;">
              <h1 style="margin:0 0 20px 0; font-family:Georgia,'Times New Roman',serif; font-size:26px; line-height:1.2; color:#202b2d; font-weight:normal;">Encerramento da conta Asaas pausada</h1>
              ${corpo}
              <p style="margin:24px 0 0 0;">
                <a href="${escapeHtml(link)}" style="background:#00737e; color:#f9fdfd; display:inline-block; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; font-weight:700; line-height:48px; text-decoration:none; border-radius:11px; padding:0 26px;">Abrir Pagamentos</a>
              </p>
              <p style="margin:28px 0 0 0; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:1.5; color:#7a8386;">Qoro — gestão de clínicas. Este é um e-mail automático; não responda.</p>
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
