/**
 * P6.6 — ENTREGA dos avisos de autorização de convênio à clínica (handler destacado do outbox).
 *
 * Canal: o e-mail transacional que o Qoro já usa (Resend), para quem OPERA Convênios na clínica
 * (dona, gestão e recepção ativas; a negativa individual tira a pessoa, a concessão a inclui).
 * O aviso também fica na tela de Convênios até ser visto; o e-mail é o que o faz chegar sem ninguém
 * abrir a tela.
 *
 * Conteúdo: só CONTAGENS por tipo ("2 autorizações com a senha vencendo"). Nenhum nome de paciente,
 * número de carteirinha, senha, número de guia ou dado clínico sai do Qoro.
 *
 * Garantias:
 *   - o lote é lido na hora: aviso encerrado (o fato deixou de valer) ou já visto não é enviado;
 *     lote vazio = pedido obsoleto, sem e-mail;
 *   - clínica que não opera (módulo desligado, avaliação, assinatura parada) não recebe e-mail;
 *   - chave de idempotência por clínica, lote e destinatário: nova tentativa não duplica o e-mail;
 *   - falha de TODOS os destinatários registra a tentativa (só o tipo do erro) e relança: o outbox
 *     tenta de novo com espera crescente. Com pelo menos um entregue, o lote fica entregue;
 *   - o payload de outra clínica é recusado sem nova tentativa.
 */
import { createHash } from 'node:crypto';

import {
  HEALTH_INSURANCE_EVENTS,
  OPERATE_CONVENIOS_ROLES,
  readAlertDeliveryBatch,
  recordAlertDeliveryOutcome,
  type AlertCounts,
  type AuthorizationAlertsDeliveryPayload,
} from '@/contexts/health-insurance/alerts';
import { listActiveMemberEmails } from '@/contexts/identity/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { sendTransactionalEmail } from '@/lib/email/resend';
import { metrics } from '@/lib/observability/metrics';
import { PoisonPillError } from '@/lib/outbox/errors';
import { registerDetachedHandler } from '@/lib/outbox/registry';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Linhas do aviso, só com contagens (ordem: do mais urgente para o menos). */
export function insuranceAlertLines(counts: AlertCounts): string[] {
  const lines: string[] = [];
  if (counts.password_expired > 0) lines.push(plural(counts.password_expired, 'autorização com a senha vencida', 'autorizações com a senha vencida'));
  if (counts.password_expiring > 0) lines.push(plural(counts.password_expiring, 'autorização com a senha vencendo', 'autorizações com a senha vencendo'));
  if (counts.sessions_ending > 0) lines.push(plural(counts.sessions_ending, 'autorização com as sessões acabando', 'autorizações com as sessões acabando'));
  if (counts.operator_overdue > 0) lines.push(plural(counts.operator_overdue, 'pedido parado na operadora há mais de 3 dias', 'pedidos parados na operadora há mais de 3 dias'));
  return lines;
}

export function insuranceAlertContent(counts: AlertCounts): { subject: string; html: string; text: string } {
  const lines = insuranceAlertLines(counts);
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const subject = `Qoro: ${plural(total, 'aviso de autorização de convênio', 'avisos de autorização de convênio')}`;
  const closing = 'Abra Convênios > Autorizações no Qoro para ver e resolver. Este e-mail não traz dados de pacientes.';
  return {
    subject,
    text: `Sua clínica tem avisos de autorização de convênio:\n${lines.map((l) => `- ${l}`).join('\n')}\n\n${closing}`,
    html: `<p>Sua clínica tem avisos de autorização de convênio:</p><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul><p>${closing.replace('>', '&gt;')}</p>`,
  };
}

export type InsuranceAlertDeliveryOutcome = 'delivered' | 'obsolete' | 'not_operable' | 'no_recipient';

export async function deliverInsuranceAlerts(ctx: {
  clinicId: string;
  payload: AuthorizationAlertsDeliveryPayload;
}): Promise<InsuranceAlertDeliveryOutcome> {
  const { clinicId, payload } = ctx;
  if (payload.clinicId !== clinicId) throw new PoisonPillError('aviso de outra clínica', 'clinic_mismatch');
  const batch = await readAlertDeliveryBatch(clinicId, payload.batch);
  if (batch.total === 0) {
    metrics.emit('insurance.alerts.delivery_skipped', { reason: 'obsolete' });
    return 'obsolete';
  }
  if (!batch.operable) {
    await recordAlertDeliveryOutcome(clinicId, payload.batch, { delivered: false, error: 'not_operable' });
    metrics.emit('insurance.alerts.delivery_skipped', { reason: 'not_operable' });
    return 'not_operable';
  }
  const recipients = await listActiveMemberEmails(clinicId, {
    roles: OPERATE_CONVENIOS_ROLES,
    permission: PERMISSIONS.OPERATE_CONVENIOS,
  });
  if (recipients.length === 0) {
    await recordAlertDeliveryOutcome(clinicId, payload.batch, { delivered: false, error: 'no_recipient' });
    metrics.emit('insurance.alerts.delivery_skipped', { reason: 'no_recipient' });
    return 'no_recipient';
  }
  const content = insuranceAlertContent(batch.counts);
  let sent = 0;
  let lastError: unknown = null;
  for (const email of recipients) {
    const recipientKey = createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 24);
    try {
      await sendTransactionalEmail({ to: email, ...content, idempotencyKey: `hi-alerts/${clinicId}/${payload.batch}/${recipientKey}` });
      sent += 1;
    } catch (error) {
      lastError = error;
    }
  }
  if (sent === 0) {
    const name = lastError instanceof Error ? lastError.name : 'unknown';
    await recordAlertDeliveryOutcome(clinicId, payload.batch, { delivered: false, error: name });
    metrics.emit('insurance.alerts.delivery_failed', { error: name, recipients: recipients.length });
    throw lastError instanceof Error ? lastError : new Error('entrega dos avisos de convênio falhou');
  }
  const delivered = await recordAlertDeliveryOutcome(clinicId, payload.batch, { delivered: true });
  metrics.emit('insurance.alerts.delivered', { alerts: delivered, recipients: sent, failedRecipients: recipients.length - sent });
  return 'delivered';
}

registerDetachedHandler<AuthorizationAlertsDeliveryPayload>(
  HEALTH_INSURANCE_EVENTS.AUTHORIZATION_ALERTS_DELIVERY_REQUESTED,
  async ({ clinicId, payload }) => {
    await deliverInsuranceAlerts({ clinicId, payload });
  },
);
