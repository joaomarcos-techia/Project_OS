/**
 * Processor de jobs proativos (C14) — roda nos crons. Para cada job reservado
 * (claimDue já aplicou janela 8-20h local + bump de attempts):
 *   1. valida payload (Zod) — inválido = falha NÃO-retryável.
 *   2. guard de send-time (re-lê estado: consulta ainda ativa / lançamento ainda
 *      pendente) — evita corrida e cobre o teste "pagou → não envia".
 *   3. resolve contato (patient) + política (suppression/consent) — bloqueio =
 *      job cancelled com reason.
 *   4. monta template Meta + envia via messagingApiV1.sendText com
 *      idempotencyKey = job.id (ESTÁVEL — at-most-once no Meta mesmo com retry).
 *   5. finaliza: accepted→sent; falha transitória→backoff (reusa o do outbox);
 *      estourou MAX_ATTEMPTS / erro de config → failed.
 *
 * NÃO segura tx durante o envio (sendText gere as próprias 3 fases). NUNCA chama
 * Meta direto — só via messagingApiV1.
 */
/* eslint-disable boundaries/element-types -- APIs internas PÚBLICAS (M14) dos contextos-fonte: C14 é transporte e lê estado via os seams versionados (mesma exceção das tools do AI Agent). */
import { financialApiV1 } from '@/contexts/financial';
import { clinicalApiV1 } from '@/contexts/clinical';
import {
  NumberNotConnectedError,
  SuppressedRecipientError,
  messagingApiV1,
  type OutboundBody,
} from '@/contexts/messaging';
import { patientApiV1 } from '@/contexts/patient';
import { schedulingApiV1 } from '@/contexts/scheduling';
import { paymentsApiV1 } from '@/contexts/payments';
/* eslint-enable boundaries/element-types */
import { metrics } from '@/lib/observability/metrics';
import { BACKOFF_FAIL, backoffDelayMs } from '@/lib/outbox/backoff';

import {
  PROACTIVE_PAYLOAD_SCHEMAS,
  type DepositLinkPayload,
  type DunningPayload,
  type FollowupPayload,
  type ReminderPayload,
  type RemainderLinkPayload,
  type WaitlistOfferPayload,
} from '../domain/types';
import * as repo from '../infra/repository';
import type { ClaimedJob } from '../infra/repository';
import { TemplateNotConfiguredError, buildProactiveTemplate } from '../infra/templates';
import type { ProactiveJobType } from '../schema';
import { evaluateProactivePolicy, suppressionPurposeFor } from './policy';

export interface BatchSummary {
  type: ProactiveJobType;
  scanned: number;
  sent: number;
  cancelled: number;
  retried: number;
  failed: number;
}

type Outcome = 'sent' | 'cancelled' | 'retried' | 'failed';

/** Reasons de cancelamento/falha — entram em failed_reason + métrica. */
const ACTIVE_APPT = new Set(['agendado', 'confirmado']);

async function processOne(job: ClaimedJob, tzCache: Map<string, string>): Promise<Outcome> {
  const { id, clinicId, type, leaseToken } = job;
  const log = { clinicId, jobId: id, type };
  metrics.emit('proactive.job.processing', log);

  // 1. payload válido?
  const parsed = PROACTIVE_PAYLOAD_SCHEMAS[type].safeParse(job.payload);
  if (!parsed.success) {
    await repo.finalizeFailed(clinicId, id, leaseToken, 'invalid_payload');
    metrics.emit('proactive.job.failed', { ...log, reason: 'invalid_payload' });
    return 'failed';
  }
  const payload = parsed.data;
  const patientId = (payload as { patientId: string }).patientId;

  // 2. guard de send-time (estado fresco).
  const guard = await sendTimeGuard(type, clinicId, payload);
  if (guard) {
    await repo.cancel(clinicId, id, leaseToken, guard);
    metrics.emit('proactive.job.cancelled', { ...log, reason: guard });
    return 'cancelled';
  }

  // 3. contato + política.
  const contact = await patientApiV1.getProactiveContact(clinicId, patientId);
  const policy = evaluateProactivePolicy(type, contact);
  if (!policy.allowed) {
    await repo.cancel(clinicId, id, leaseToken, policy.reason ?? 'blocked');
    metrics.emit('proactive.job.cancelled', { ...log, reason: policy.reason });
    return 'cancelled';
  }
  // contact + phone garantidos por evaluateProactivePolicy.
  const { phone, nome } = contact!;

  // 4. template + envio (chave ESTÁVEL = job.id).
  //
  // O link de pagamento é resolvido AQUI, no send-time, e não veio no payload:
  // de pagamento não fica em repouso numa fila que operador e worker leem — e o
  // que estava certo no enfileiramento pode não estar mais agora. O seam devolve
  // `null` se a cobrança já foi paga, estornada, cancelada ou expirou, e mandar
  // link de cobrança já paga é o pior desfecho desta fase.
  let extra: { invoiceUrl?: string } | undefined;
  if (type === 'deposit_link' || type === 'remainder_link') {
    const charge = await paymentsApiV1.getPayableCharge(
      clinicId,
      (payload as DepositLinkPayload | RemainderLinkPayload).chargeId,
    );
    if (!charge) {
      await repo.cancel(clinicId, id, leaseToken, 'charge_not_payable');
      metrics.emit('proactive.job.cancelled', { ...log, reason: 'charge_not_payable' });
      return 'cancelled';
    }
    extra = { invoiceUrl: charge.invoiceUrl };
  }

  let body: OutboundBody;
  try {
    const tz = await resolveTz(clinicId, tzCache);
    const t = buildProactiveTemplate(type, payload, nome, tz, extra);
    body = {
      kind: 'template',
      templateName: t.templateName,
      languageCode: t.languageCode,
      variables: t.variables,
    };
  } catch (err) {
    if (err instanceof TemplateNotConfiguredError) {
      await repo.finalizeFailed(clinicId, id, leaseToken, 'template_not_configured');
      metrics.emit('proactive.job.failed', { ...log, reason: 'template_not_configured' });
      return 'failed';
    }
    throw err;
  }

  try {
    const res = await messagingApiV1.sendText({
      clinicId,
      toNumber: phone!,
      idempotencyKey: id,
      body,
      // MESMA função da política de supressão, e não uma cópia: bloquear por um
      // propósito e registrar outro faria o opt-out do paciente nunca casar.
      purpose: suppressionPurposeFor(type),
    });
    if (
      res.status === 'accepted' ||
      res.status === 'sent' ||
      res.status === 'delivered' ||
      res.status === 'read'
    ) {
      await repo.finalizeSent(clinicId, id, leaseToken);
      metrics.emit('proactive.job.sent', log);
      return 'sent';
    }
    // failed/unknown/pending → backoff (chave estável dedup no Meta).
    return finalizeBackoff(job, `meta_${res.status}`, log);
  } catch (err) {
    if (err instanceof SuppressedRecipientError) {
      await repo.cancel(clinicId, id, leaseToken, 'suppressed');
      metrics.emit('proactive.job.cancelled', { ...log, reason: 'suppressed' });
      return 'cancelled';
    }
    if (err instanceof NumberNotConnectedError) {
      await repo.finalizeFailed(clinicId, id, leaseToken, 'number_not_connected');
      metrics.emit('proactive.job.failed', { ...log, reason: 'number_not_connected' });
      return 'failed';
    }
    return finalizeBackoff(job, 'meta_error', log);
  }
}

/** Retorna um reason de cancelamento se o estado mudou; null se segue válido. */
async function sendTimeGuard(
  type: ProactiveJobType,
  clinicId: string,
  payload:
    | ReminderPayload
    | DunningPayload
    | WaitlistOfferPayload
    | DepositLinkPayload
    | RemainderLinkPayload
    | { patientId: string },
): Promise<string | null> {
  if (type === 'reminder') {
    const appt = await schedulingApiV1.lookupAppointment(
      clinicId,
      (payload as ReminderPayload).appointmentId,
    );
    if (!appt || !ACTIVE_APPT.has(appt.status)) return 'appointment_inactive';
    return null;
  }
  if (type === 'dunning') {
    const lanc = await financialApiV1.getLancamento(
      clinicId,
      (payload as DunningPayload).lancamentoId,
    );
    if (!lanc) return 'lancamento_missing';
    if (lanc.status !== 'pendente' && lanc.status !== 'parcial') {
      return lanc.status === 'pago' ? 'already_paid' : 'lancamento_not_pending';
    }
    return null;
  }
  if (type === 'waitlist_offer') {
    // WAIT-001 — a vaga é perecível e disputada. Entre o enfileiramento e o
    // envio a oferta pode ter sido aceita, recusada, expirada ou a entrada
    // cancelada; e o horário liberado pode ter sido reaberto ou preenchido por
    // outro caminho. Convidar alguém para um horário que não existe mais é pior
    // do que não convidar.
    const offer = payload as WaitlistOfferPayload;
    const state = await schedulingApiV1.lookupWaitlistOffer(clinicId, offer.waitlistEntryId);
    if (!state || state.status !== 'offered') return 'waitlist_offer_closed';
    if (state.patientId !== offer.patientId) return 'waitlist_patient_mismatch';
    if (state.offeredAppointmentId !== offer.releasedAppointmentId) {
      return 'waitlist_offer_superseded';
    }
    const released = await schedulingApiV1.lookupAppointment(clinicId, offer.releasedAppointmentId);
    if (!released || released.status !== 'cancelado') return 'waitlist_slot_unavailable';
    return null;
  }
  if (type === 'deposit_link') {
    // A pergunta AQUI é sobre a agenda: o paciente já confirmou por outro
    // caminho, ou já cancelou? Mandar link de sinal para quem cancelou é pedir
    // dinheiro por uma consulta que não vai acontecer.
    //
    // Se a COBRANÇA ainda é pagável é outra pergunta, e ela é respondida no
    // passo do template — onde o link precisa ser resolvido de qualquer forma.
    const appt = await schedulingApiV1.lookupAppointment(
      clinicId,
      (payload as DepositLinkPayload).appointmentId,
    );
    if (!appt || appt.status !== 'agendado') return 'appointment_inactive';
    return null;
  }
  if (type === 'remainder_link') {
    // A consulta já ocorreu; a elegibilidade é exclusivamente da cobrança e é
    // revalidada por `getPayableCharge` imediatamente antes de montar o template.
    return null;
  }
  if (type === 'followup') {
    const followup = payload as FollowupPayload;
    const state = await clinicalApiV1.getFollowupState(clinicId, followup.prontuarioId);
    if (!state || state.status !== 'assinado' || !state.signedAt) return 'followup_context_missing';
    if (!state.needsReturn) return 'return_no_longer_needed';
    if (state.patientId !== followup.patientId) return 'followup_patient_mismatch';

    const original = state.appointmentId
      ? await schedulingApiV1.lookupAppointment(clinicId, state.appointmentId)
      : null;
    const alreadyReturned = await schedulingApiV1.hasSubsequentCompletedAppointment(clinicId, {
      patientId: state.patientId,
      after: state.signedAt,
      excludeAppointmentId: state.appointmentId,
      procedureId: original?.procedureId ?? null,
      doctorId: state.doctorId,
    });
    return alreadyReturned ? 'return_already_completed' : null;
  }
  return null;
}

async function finalizeBackoff(
  job: ClaimedJob,
  reason: string,
  log: Record<string, unknown>,
): Promise<Outcome> {
  // job.attempts já é a tentativa em curso; a PRÓXIMA é attempts+1.
  const delay = backoffDelayMs(job.attempts + 1);
  if (delay === BACKOFF_FAIL) {
    await repo.finalizeFailed(job.clinicId, job.id, job.leaseToken, reason);
    metrics.emit('proactive.job.failed', { ...log, reason });
    return 'failed';
  }
  await repo.finalizeRetry(
    job.clinicId,
    job.id,
    job.leaseToken,
    new Date(Date.now() + delay),
    reason,
  );
  metrics.emit('proactive.job.retried', { ...log, reason, delayMs: delay });
  return 'retried';
}

async function resolveTz(clinicId: string, cache: Map<string, string>): Promise<string> {
  let tz = cache.get(clinicId);
  if (!tz) {
    tz = await repo.getClinicTimezone(clinicId);
    cache.set(clinicId, tz);
  }
  return tz;
}

/**
 * Processa um lote de jobs vencidos de um tipo. Sequencial (rate-limit Meta ~80
 * msg/s não é gargalo no MVP — §14.13); paraleliza por p-limit se virar.
 */
export async function processProactiveBatch(
  type: ProactiveJobType,
  opts: { batchSize?: number } = {},
): Promise<BatchSummary> {
  const batchSize = opts.batchSize ?? 50;
  const jobs = await repo.claimDue(type, batchSize);
  const summary: BatchSummary = {
    type,
    scanned: jobs.length,
    sent: 0,
    cancelled: 0,
    retried: 0,
    failed: 0,
  };
  const tzCache = new Map<string, string>();

  for (const job of jobs) {
    const outcome = await processOne(job, tzCache);
    summary[outcome] += 1;
  }

  metrics.emit('proactive.batch.run', { ...summary });
  return summary;
}
