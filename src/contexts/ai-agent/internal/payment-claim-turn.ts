/**
 * Turno do "já paguei" (08/10/2026, EC-22): lê o status real da cobrança e
 * decide a resposta. Só leituras — o handler aplica a decisão (resposta fixa e,
 * quando for o caso, a conversa para a equipe).
 */
import { sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
/* eslint-disable boundaries/element-types -- APIs internas públicas (M14) do Payments e do Scheduling, mesma exceção das tools. */
import { paymentsApiV1 } from '@/contexts/payments';
import { schedulingApiV1 } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { getRecentMessages } from './conversation';
import {
  decidePaymentClaimReply,
  PAYMENT_PENDING_PREFIX,
  relevantCharge,
  type PaymentClaimDecision,
} from './payment-claim';
import { appointmentTimeForPatient } from './relative-datetime';

const DEFAULT_TZ = 'America/Sao_Paulo';

export async function paymentClaimTurn(args: {
  clinicId: string;
  conversationId: string;
  patientId: string;
  cash: boolean;
  /** O turno corrente fica fora do histórico: a mensagem dele já foi gravada. */
  eventId: string;
  /** Leitura curta em transação de tenant (o `phase` do handler). */
  read: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
}): Promise<PaymentClaimDecision> {
  const { clinicId, conversationId, patientId } = args;
  const [charges, context] = await Promise.all([
    paymentsApiV1.listPatientChargeStatuses(clinicId, patientId),
    args.read(async (tx) => {
      const clinic = await tx.execute<{ timezone: string | null }>(
        sql`SELECT timezone FROM clinics WHERE id = ${clinicId} LIMIT 1`,
      );
      const history = await getRecentMessages(tx, clinicId, conversationId, 4, args.eventId);
      return { timeZone: clinic[0]?.timezone ?? DEFAULT_TZ, history };
    }),
  ]);

  // Insistência: a resposta anterior do agente já foi o aviso de pendente.
  const lastOut = [...context.history].reverse().find((entry) => entry.direction === 'out');
  const charge = relevantCharge(charges);
  const appointment = charge
    ? await schedulingApiV1.lookupAppointment(clinicId, charge.appointmentId)
    : null;

  return decidePaymentClaimReply({
    charges,
    cash: args.cash,
    insisting: lastOut?.text.startsWith(PAYMENT_PENDING_PREFIX) ?? false,
    appointmentWhen: appointment
      ? appointmentTimeForPatient(appointment.scheduledAt, context.timeZone)
      : null,
    holdUntil: charge?.holdExpiresAt
      ? appointmentTimeForPatient(charge.holdExpiresAt.toISOString(), context.timeZone)
      : null,
  });
}
