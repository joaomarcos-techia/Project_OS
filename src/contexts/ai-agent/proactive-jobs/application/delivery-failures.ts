/**
 * Leitura do painel: mensagens proativas (C14) que não chegaram ao paciente.
 *
 * Desde o EC-32 a recusa da Meta depois do aceite leva o job a `failed`, mas
 * nenhuma tela da clínica lia a fila. No sinal isso custa a vaga: o hold vence,
 * a consulta é cancelada sozinha e a clínica nunca soube que o paciente não
 * recebeu o link.
 *
 * O que sai daqui são ids, datas e a causa, nunca o payload cru. A página
 * resolve o nome pelo Patient, a consulta pela Agenda e a cobrança pelo
 * Payments, sem JOIN entre contextos. O link de pagamento também não passa por
 * aqui: `getFailedJobChargeRef` devolve só o id da cobrança, e quem diz se ela
 * ainda é pagável é o seam do Payments.
 */
import 'server-only';

import {
  DELIVERY_FAILURE_LIST_LIMIT,
  failureCauseOf,
  type ProactiveFailureCause,
} from '../domain/delivery-failure';
import {
  DepositLinkPayloadSchema,
  DunningPayloadSchema,
  FollowupPayloadSchema,
  NoShowFollowupPayloadSchema,
  ReminderPayloadSchema,
  RemainderLinkPayloadSchema,
  WaitlistOfferPayloadSchema,
} from '../domain/types';
import * as repo from '../infra/repository';
import type { ProactiveJobType } from '../schema';

export interface ProactiveDeliveryFailureDTO {
  jobId: string;
  type: ProactiveJobType;
  /** Null só quando o payload não valida (job que falhou por `invalid_payload`). */
  patientId: string | null;
  /** Consulta da mensagem (sinal, saldo, lembrete, pós-falta) ou a vaga liberada (oferta). */
  appointmentId: string | null;
  /** Cobrança do sinal ou do saldo. Serve só para o servidor decidir o "Copiar link". */
  chargeId: string | null;
  /** Instante da consulta gravado no payload (lembrete e oferta de vaga). */
  scheduledAt: string | null;
  /** Data do retorno pedido pelo médico (followup), 'YYYY-MM-DD'. */
  returnDate: string | null;
  /** Última tentativa de envio (ISO). */
  attemptedAt: string | null;
  cause: ProactiveFailureCause;
}

type PayloadRefs = Pick<
  ProactiveDeliveryFailureDTO,
  'patientId' | 'appointmentId' | 'chargeId' | 'scheduledAt' | 'returnDate'
>;

const NO_REFS: PayloadRefs = {
  patientId: null,
  appointmentId: null,
  chargeId: null,
  scheduledAt: null,
  returnDate: null,
};

/**
 * O que o painel precisa de cada payload, pelo schema do PRÓPRIO tipo. Payload
 * que não valida não derruba a lista: o item sai sem referências, com a causa.
 */
function payloadRefs(type: ProactiveJobType, payload: unknown): PayloadRefs {
  switch (type) {
    case 'reminder': {
      const r = ReminderPayloadSchema.safeParse(payload);
      return r.success
        ? {
            ...NO_REFS,
            patientId: r.data.patientId,
            appointmentId: r.data.appointmentId,
            scheduledAt: r.data.scheduledAt,
          }
        : NO_REFS;
    }
    case 'deposit_link': {
      const r = DepositLinkPayloadSchema.safeParse(payload);
      return r.success
        ? {
            ...NO_REFS,
            patientId: r.data.patientId,
            appointmentId: r.data.appointmentId,
            chargeId: r.data.chargeId,
          }
        : NO_REFS;
    }
    case 'remainder_link': {
      const r = RemainderLinkPayloadSchema.safeParse(payload);
      return r.success
        ? {
            ...NO_REFS,
            patientId: r.data.patientId,
            appointmentId: r.data.appointmentId,
            chargeId: r.data.chargeId,
          }
        : NO_REFS;
    }
    case 'no_show_followup': {
      const r = NoShowFollowupPayloadSchema.safeParse(payload);
      return r.success
        ? { ...NO_REFS, patientId: r.data.patientId, appointmentId: r.data.appointmentId }
        : NO_REFS;
    }
    case 'waitlist_offer': {
      const r = WaitlistOfferPayloadSchema.safeParse(payload);
      return r.success
        ? {
            ...NO_REFS,
            patientId: r.data.patientId,
            appointmentId: r.data.releasedAppointmentId,
            scheduledAt: r.data.scheduledAt,
          }
        : NO_REFS;
    }
    case 'followup': {
      const r = FollowupPayloadSchema.safeParse(payload);
      return r.success
        ? { ...NO_REFS, patientId: r.data.patientId, returnDate: r.data.returnDate }
        : NO_REFS;
    }
    case 'dunning': {
      const r = DunningPayloadSchema.safeParse(payload);
      return r.success ? { ...NO_REFS, patientId: r.data.patientId } : NO_REFS;
    }
  }
}

export function toDeliveryFailureDTO(job: repo.FailedJob): ProactiveDeliveryFailureDTO {
  return {
    jobId: job.id,
    type: job.type,
    ...payloadRefs(job.type, job.payload),
    attemptedAt: job.lastAttemptAt ? job.lastAttemptAt.toISOString() : null,
    cause: failureCauseOf(job.failedReason),
  };
}

/** Mensagens que não chegaram desde `since`, da mais recente à mais antiga. */
export async function listRecentProactiveFailures(
  clinicId: string,
  opts: { since: Date; limit?: number },
): Promise<ProactiveDeliveryFailureDTO[]> {
  const jobs = await repo.listFailedSince(
    clinicId,
    opts.since,
    opts.limit ?? DELIVERY_FAILURE_LIST_LIMIT,
  );
  return jobs.map(toDeliveryFailureDTO);
}

/** Quantas mensagens não chegaram desde `since`. Mesmo critério da lista. */
export function countRecentProactiveFailures(clinicId: string, since: Date): Promise<number> {
  return repo.countFailedSince(clinicId, since);
}

export interface FailedJobChargeRef {
  jobId: string;
  type: 'deposit_link' | 'remainder_link';
  chargeId: string;
}

/**
 * A cobrança por trás de um link de sinal ou de saldo que não chegou. Null
 * quando o job não é da clínica, não falhou ou não é de link de cobrança.
 */
export async function getFailedJobChargeRef(
  clinicId: string,
  jobId: string,
): Promise<FailedJobChargeRef | null> {
  const job = await repo.findFailedJob(clinicId, jobId);
  if (!job || (job.type !== 'deposit_link' && job.type !== 'remainder_link')) return null;
  const { chargeId } = payloadRefs(job.type, job.payload);
  return chargeId ? { jobId: job.id, type: job.type, chargeId } : null;
}
