/**
 * Processor de jobs proativos (C14) — roda nos crons. Para cada job reservado
 * (claimDue já aplicou janela 8-20h local + bump de attempts):
 *   1. valida payload (Zod) — inválido = falha NÃO-retryável.
 *   2. guard de send-time: primeiro a validade do tipo (ADR-065 — vencido =
 *      cancelled `expired_<tipo>`, nunca enviado atrasado); depois re-lê estado
 *      (consulta ainda ativa / lançamento ainda pendente) — evita corrida e
 *      cobre o teste "pagou → não envia".
 *   3. resolve contato (patient) + política (suppression/consent) — bloqueio =
 *      job cancelled com reason.
 *   4. monta template Meta + envia via messagingApiV1.sendText com a chave da
 *      GERAÇÃO (ADR-064: `send_key`, ou o job.id na geração 0). Retry de rede ou
 *      de lease reusa a chave, e o dedup do sender segura o at-most-once.
 *   5. finaliza (ADR-064):
 *      - a Meta aceitou (tem wamid) → sent; recusa posterior é do handler EC-32;
 *      - recusa síncrona com código retentável → pending com chave NOVA +
 *        backoff (reusa o do outbox): reenvio de verdade;
 *      - recusa definitiva, fora das tentativas ou do prazo → failed na hora,
 *        com `meta_<código>`;
 *      - timeout (`unknown`) → failed na hora, `meta_unknown`: pode ter chegado,
 *        então nunca há chave nova;
 *      - dedup `pending` ou exceção → backoff com a MESMA chave;
 *      - erro de config → failed.
 *
 * NÃO segura tx durante o envio (sendText gere as próprias 3 fases). NUNCA chama
 * Meta direto — só via messagingApiV1.
 */
import { randomUUID } from 'node:crypto';

/* eslint-disable boundaries/element-types -- APIs internas PÚBLICAS (M14) dos contextos-fonte: C14 é transporte e lê estado via os seams versionados (mesma exceção das tools do AI Agent). */
import { financialApiV1 } from '@/contexts/financial';
import { clinicalApiV1 } from '@/contexts/clinical';
import {
  NumberNotConnectedError,
  SuppressedRecipientError,
  messagingApiV1,
  type OutboundBody,
  type OutboundResult,
} from '@/contexts/messaging';
import { patientApiV1 } from '@/contexts/patient';
import { schedulingApiV1 } from '@/contexts/scheduling';
import { paymentsApiV1 } from '@/contexts/payments';
/* eslint-enable boundaries/element-types */
import { metrics } from '@/lib/observability/metrics';
import { getOperationalModuleAccess } from '@/lib/entitlements';
import { BACKOFF_FAIL, backoffDelayMs } from '@/lib/outbox/backoff';

import { decideAfterRefusal, refusalReason } from '../domain/resend';
import {
  PROACTIVE_PAYLOAD_SCHEMAS,
  type DepositLinkPayload,
  type DunningPayload,
  type FollowupPayload,
  type NoShowFollowupPayload,
  type ProactivePayload,
  type ReminderPayload,
  type RemainderLinkPayload,
  type WaitlistOfferPayload,
} from '../domain/types';
import * as repo from '../infra/repository';
import type { ClaimedJob } from '../infra/repository';
import { nextSendWindowStart } from '../infra/send-window';
import { TemplateNotConfiguredError, buildProactiveTemplate } from '../infra/templates';
import type { ProactiveJobType } from '../schema';
import { evaluateProactivePolicy, suppressionPurposeFor } from './policy';
import { expiredReason, isPastDeadline, sendDeadline } from './validity';

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
  const access = await getOperationalModuleAccess(
    clinicId,
    type === 'deposit_link' || type === 'remainder_link' || type === 'dunning'
      ? 'patient_payments'
      : 'ai_agents',
  );
  if (!access.allowed) {
    await repo.cancel(clinicId, id, leaseToken, access.reason);
    metrics.emit('proactive.job.cancelled', { ...log, reason: access.reason });
    return 'cancelled';
  }
  const patientId = (payload as { patientId: string }).patientId;
  // O fuso da clínica serve ao prazo (dias-calendário locais) e ao template.
  const tz = await resolveTz(clinicId, tzCache);
  // ADR-065 — um prazo só por job: o do primeiro envio é o mesmo do reenvio.
  const deadline = sendDeadline(type, payload, { timezone: tz, createdAt: job.createdAt });
  const now = new Date();

  // 1b. ADR-064 — reenvio só vale até o prazo do tipo. O prazo foi conferido ao
  // agendar, mas a janela 8–20 h pode empurrar o envio para depois dele. Vem
  // antes do guard: passado o prazo, o motivo verdadeiro é a recusa da Meta, e
  // não o prazo vencido (`expired_<tipo>`) nem o hold ou a consulta que passou.
  if (job.resend && isPastDeadline(now, deadline)) {
    const reason = job.failedReason ?? 'meta_failed';
    await repo.finalizeFailed(clinicId, id, leaseToken, reason);
    metrics.emit('proactive.job.failed', { ...log, reason, why: 'past_deadline' });
    return 'failed';
  }

  // 2. guard de send-time (validade do tipo + estado fresco).
  const guard = await sendTimeGuard(type, clinicId, payload, { now, deadline });
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

  // 4. template + envio (chave da GERAÇÃO = job.sendKey).
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

  // O claim pode ocorrer às 19:59 e a resolução do contato/link terminar depois
  // das 20h. Reconfere imediatamente antes do sender; não consome tentativa Meta.
  const nextWindow = nextSendWindowStart(tz, new Date());
  if (nextWindow) {
    await repo.deferUntilSendWindow(clinicId, id, leaseToken, nextWindow);
    metrics.emit('proactive.job.deferred', { ...log, reason: 'send_window_closed' });
    return 'retried';
  }

  try {
    const res = await messagingApiV1.sendText({
      clinicId,
      toNumber: phone!,
      idempotencyKey: job.sendKey,
      body,
      // MESMA função da política de supressão, e não uma cópia: bloquear por um
      // propósito e registrar outro faria o opt-out do paciente nunca casar.
      purpose: suppressionPurposeFor(type),
    });
    if (acceptedByMeta(res)) {
      await repo.finalizeSent(clinicId, id, leaseToken);
      metrics.emit('proactive.job.sent', log);
      return 'sent';
    }
    if (res.status === 'failed') {
      return refuse(job, deadline, res.errorCode ?? null, log);
    }
    if (res.status === 'unknown') {
      // Timeout: a Meta pode ter recebido. Chave nova poderia duplicar a
      // mensagem, e a mesma só devolveria este `unknown` no dedup do sender.
      await repo.finalizeFailed(clinicId, id, leaseToken, 'meta_unknown');
      metrics.emit('proactive.job.failed', { ...log, reason: 'meta_unknown', stage: 'send' });
      return 'failed';
    }
    // `pending` no dedup: outra tentativa desta geração ainda não finalizou o
    // envio. É o único resultado que esperar pode mudar.
    return finalizeBackoff(job, 'meta_pending', log);
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

/**
 * Retorna um reason de cancelamento se o job venceu ou o estado mudou; null se
 * segue válido.
 */
async function sendTimeGuard(
  type: ProactiveJobType,
  clinicId: string,
  payload: ProactivePayload,
  timing: { now: Date; deadline: Date },
): Promise<string | null> {
  // ADR-065 — a validade vem antes de qualquer leitura: passada a janela útil, a
  // mensagem não sai atrasada, nem com a consulta ativa ou a cobrança pagável.
  if (isPastDeadline(timing.now, timing.deadline)) return expiredReason(type);

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
    // A janela de resposta é do Scheduling. O cron devolve a oferta vencida à
    // fila antes de despachar; se ainda não devolveu, o convite também não sai.
    if (state.offerExpiresAt && isPastDeadline(timing.now, state.offerExpiresAt)) {
      return expiredReason('waitlist_offer');
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
  if (type === 'no_show_followup') {
    const recovery = payload as NoShowFollowupPayload;
    const appointment = await schedulingApiV1.lookupAppointment(clinicId, recovery.appointmentId);
    if (!appointment || appointment.status !== 'faltou') return 'no_show_reversed';
    if (appointment.patientId !== recovery.patientId) return 'no_show_patient_mismatch';

    const alreadyRescheduled = await schedulingApiV1.hasFutureEquivalentAppointment(clinicId, {
      patientId: recovery.patientId,
      procedureId: appointment.procedureId,
      // A consulta equivalente pode ter sido marcada para antes das 10h e
      // ainda assim provar que a recuperacao ja aconteceu. O marco correto e
      // a falta que originou o job, nao o relogio do worker.
      after: new Date(recovery.noShowAt),
      excludeAppointmentId: recovery.appointmentId,
    });
    return alreadyRescheduled ? 'no_show_already_rescheduled' : null;
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

/**
 * A Meta aceitou ESTA geração. Um `failed` deduplicado com wamid foi aceito e
 * recusado depois: o callback já publicou o `status_updated`, e quem decide o
 * reenvio é o handler do EC-32, com o código do callback.
 */
function acceptedByMeta(res: OutboundResult): boolean {
  return (
    res.status === 'accepted' ||
    res.status === 'sent' ||
    res.status === 'delivered' ||
    res.status === 'read' ||
    (res.status === 'failed' && res.providerMessageId !== null)
  );
}

/**
 * ADR-064 — a Meta recusou esta geração na resposta síncrona. Código retentável,
 * dentro das tentativas e do prazo → reenvio com chave NOVA; o resto falha já,
 * com o código, em vez de queimar o backoff no dedup da mesma chave.
 */
async function refuse(
  job: ClaimedJob,
  deadline: Date,
  code: string | null,
  log: Record<string, unknown>,
): Promise<Outcome> {
  const reason = refusalReason(code);
  const decision = decideAfterRefusal({ attempts: job.attempts, code, deadline, now: new Date() });
  if (decision.kind === 'resend') {
    await repo.finalizeResend(
      job.clinicId,
      job.id,
      job.leaseToken,
      decision.nextAt,
      reason,
      randomUUID(),
    );
    metrics.emit('proactive.job.retried', {
      ...log,
      reason,
      delayMs: decision.delayMs,
      stage: 'send',
      resend: true,
    });
    return 'retried';
  }
  await repo.finalizeFailed(job.clinicId, job.id, job.leaseToken, reason);
  metrics.emit('proactive.job.failed', { ...log, reason, stage: 'send', why: decision.why });
  return 'failed';
}

/** Sem resposta definitiva (dedup `pending`, exceção): backoff com a MESMA chave. */
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
