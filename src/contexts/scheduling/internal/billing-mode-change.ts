/**
 * P4.3 — troca da forma de atendimento (particular ↔ convênio) de um atendimento já criado.
 *
 * O Scheduling é dono da modalidade. Esta função só troca o campo, até a chegada do paciente,
 * e publica `billing_mode_changed` na MESMA transação de quem chama — o Convênios orquestra a
 * troca junto com a cobertura (ou o cancelamento dela) e as pré-condições financeiras, para
 * nunca existir um atendimento "convênio sem decisão" ou "particular com cobertura viva".
 *
 * Defesa em profundidade: o gatilho `hi_guard_appointment_billing_mode` (0148) recusa convênio
 * sem o módulo e qualquer troca depois da chegada; o `a0_hi_premium_appointment` (0151) recusa
 * convênio sem assinatura paga ativa. Aqui a recusa vem antes, com mensagem para a recepção.
 */
import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { publishEvent } from '@/lib/outbox/publish';

import { SCHEDULING_EVENTS, type AppointmentBillingModeChangedPayload } from '../events';
import { appointments } from '../schema';

export type BillingMode = 'particular' | 'convenio';

/** Estados em que a modalidade ainda pode mudar (o mesmo critério do gatilho 0148). */
export const BILLING_MODE_MUTABLE_STATES = ['agendado', 'confirmado', 'chegou'] as const;

export class BillingModeChangeError extends Error {
  constructor(
    message: string,
    readonly code: 'APPOINTMENT_NOT_FOUND' | 'APPOINTMENT_STARTED' | 'NO_PATIENT',
  ) {
    super(message);
    this.name = 'BillingModeChangeError';
  }
}

export interface BillingModeChangeResult {
  changed: boolean;
  /** Chave idempotente do `billing_mode_changed` desta troca. */
  eventKey: string;
  from: BillingMode;
  to: BillingMode;
  status: string;
  patientId: string | null;
  procedureId: string;
  doctorId: string;
  scheduledAt: Date;
}

export async function changeBillingModeTx(
  tx: Tx,
  input: {
    clinicId: string;
    appointmentId: string;
    to: BillingMode;
    idempotencyKey: string;
    correlationId?: string | null;
  },
): Promise<BillingModeChangeResult> {
  const [appt] = await tx
    .select({
      id: appointments.id,
      status: appointments.status,
      billingMode: appointments.billingMode,
      patientId: appointments.patientId,
      procedureId: appointments.procedureId,
      doctorId: appointments.doctorId,
      scheduledAt: appointments.scheduledAt,
    })
    .from(appointments)
    .where(and(eq(appointments.clinicId, input.clinicId), eq(appointments.id, input.appointmentId)))
    .for('update')
    .limit(1);
  if (!appt) {
    throw new BillingModeChangeError(
      'Atendimento não encontrado nesta clínica.',
      'APPOINTMENT_NOT_FOUND',
    );
  }
  const from = (appt.billingMode ?? 'particular') as BillingMode;
  const base = {
    eventKey: billingModeEventKey(input.idempotencyKey, input.to),
    from,
    to: input.to,
    status: appt.status,
    patientId: appt.patientId,
    procedureId: appt.procedureId,
    doctorId: appt.doctorId,
    scheduledAt: appt.scheduledAt as Date,
  };
  if (!(BILLING_MODE_MUTABLE_STATES as readonly string[]).includes(appt.status)) {
    throw new BillingModeChangeError(
      'A forma de atendimento só muda até a chegada do paciente. Depois disso, use a correção do atendimento (guia e financeiro).',
      'APPOINTMENT_STARTED',
    );
  }
  if (input.to === 'convenio' && !appt.patientId) {
    throw new BillingModeChangeError(
      'O atendimento não tem paciente; convênio exige paciente.',
      'NO_PATIENT',
    );
  }
  if (from === input.to) return { ...base, changed: false };

  await tx
    .update(appointments)
    .set({ billingMode: input.to, updatedAt: sql`now()` })
    .where(
      and(eq(appointments.clinicId, input.clinicId), eq(appointments.id, input.appointmentId)),
    );

  const payload: AppointmentBillingModeChangedPayload = {
    appointmentId: appt.id,
    clinicId: input.clinicId,
    patientId: appt.patientId,
    from,
    to: input.to,
    changedAt: new Date().toISOString(),
  };
  await publishEvent(tx, {
    clinicId: input.clinicId,
    eventType: SCHEDULING_EVENTS.BILLING_MODE_CHANGED,
    payload,
    idempotencyKey: base.eventKey,
    correlationId: input.correlationId ?? null,
  });
  return { ...base, changed: true };
}

export const billingModeEventKey = (idempotencyKey: string, to: BillingMode): string =>
  `${idempotencyKey}:billing-mode:${to}`;
