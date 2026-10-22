import { createHash } from 'node:crypto';

import { BILLING_EVENTS, type AiUsageNoticeRequestedPayload } from '@/contexts/billing';
import { listActiveOwnerEmails } from '@/contexts/identity/queries';
import { sendTransactionalEmail } from '@/lib/email/resend';
import { registerDetachedHandler } from '@/lib/outbox/registry';

export function aiUsageNoticeContent(payload: AiUsageNoticeRequestedPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `Qoro: ${payload.threshold}% da referência mensal de IA`;
  const text =
    `Sua clínica utilizou ${payload.count} de ${payload.limit} conversas de referência ` +
    `em ${payload.period}. A IA continua atendendo; não há cobrança automática de excedente. ` +
    'Veja o acompanhamento em Configurações > Assinatura no Qoro.';
  return {
    subject,
    text,
    html: `<p>Sua clínica utilizou <strong>${payload.count} de ${payload.limit}</strong> conversas de referência em ${payload.period}.</p><p>A IA continua atendendo; não há cobrança automática de excedente.</p><p>Veja o acompanhamento em Configurações &gt; Assinatura no Qoro.</p>`,
  };
}

registerDetachedHandler<AiUsageNoticeRequestedPayload>(
  BILLING_EVENTS.AI_USAGE_NOTICE_REQUESTED,
  async ({ clinicId, payload }) => {
    const owners = await listActiveOwnerEmails(clinicId);
    if (owners.length === 0) throw new Error('Nenhum titular ativo para o aviso de uso de IA.');
    const content = aiUsageNoticeContent(payload);
    for (const email of owners) {
      const recipientKey = createHash('sha256')
        .update(email.toLowerCase())
        .digest('hex')
        .slice(0, 24);
      await sendTransactionalEmail({
        to: email,
        ...content,
        idempotencyKey: `ai-usage/${clinicId}/${payload.period}/${payload.threshold}/${recipientKey}`,
      });
    }
  },
);
