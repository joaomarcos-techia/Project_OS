/**
 * Financial consumer: `health_insurance.copay.confirmed` → recebível do paciente
 * pela COPARTICIPAÇÃO CONFIRMADA (convênios P10.5, parte do recebível).
 *
 * No atendimento de convênio o handler de `appointment.completed` não cria
 * recebível; o paciente só deve a coparticipação, e só depois de confirmada.
 * Este handler cria esse recebível:
 *  - valor = cobrável confirmado (nunca o valor cheio do atendimento);
 *  - mesmo atendimento (`appointment_id`), então o UNIQUE parcial do lançamento por
 *    atendimento + `onConflictDoNothing` tornam a reentrega idempotente;
 *  - sem snapshot de repasse (o repasse de convênio segue a D16, P10.4);
 *  - sem link Asaas, sem régua: a cobrança automática de coparticipação é da P10.5
 *    e depende da política da clínica. Até lá, a recepção recebe no Caixa.
 *
 * O banco confere de novo: o gatilho `lancamentos_convenio_patient_guard` (0148)
 * recusa recebível de atendimento de convênio acima do cobrável confirmado.
 */
import { sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { metrics } from '@/lib/observability/metrics';
import { PoisonPillError } from '@/lib/outbox/errors';
import { publishEvent } from '@/lib/outbox/publish';
import { registerHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- evento + tipo são o contrato PÚBLICO do health-insurance. */
import { HEALTH_INSURANCE_EVENTS, type CopayConfirmedPayload } from '@/contexts/health-insurance';
/* eslint-enable boundaries/element-types */

import { FINANCIAL_EVENTS } from '../../events';
import { lancamentos } from '../../schema';

const DEFAULT_TZ = 'America/Sao_Paulo';

function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function handleCopayConfirmed(ctx: {
  tx: Tx;
  clinicId: string;
  payload: CopayConfirmedPayload;
  eventId: string;
}): Promise<void> {
  const { tx, clinicId, payload, eventId } = ctx;
  if (payload.clinicId !== clinicId) {
    throw new PoisonPillError(
      `clinicId divergente: payload=${payload.clinicId} ctx=${clinicId}`,
      'clinic_mismatch',
    );
  }
  const tzRows = await tx.execute<{ timezone: string | null }>(
    sql`SELECT timezone FROM clinics WHERE id = ${clinicId} LIMIT 1`,
  );
  const tz = tzRows[0]?.timezone ?? DEFAULT_TZ;
  const valor = (payload.chargeableCents / 100).toFixed(2);

  const [row] = await tx
    .insert(lancamentos)
    .values({
      clinicId,
      tipo: 'receber',
      descricao: `Coparticipação - ${payload.procedureName}`,
      valor,
      valorPago: '0.00',
      status: 'pendente',
      dueDate: todayInTz(tz),
      patientId: payload.patientId,
      appointmentId: payload.appointmentId,
      createdVia: 'auto',
      snapshotProcedureName: payload.procedureName,
    })
    .onConflictDoNothing({
      target: lancamentos.appointmentId,
      where: sql`appointment_id IS NOT NULL`,
    })
    .returning({ id: lancamentos.id });
  if (!row) return; // reentrega: o recebível já existe

  metrics.emit('insurance.copay.receivable_created', { clinicId });
  await publishEvent(tx, {
    clinicId,
    eventType: FINANCIAL_EVENTS.LANCAMENTO_CREATED,
    payload: {
      lancamentoId: row.id,
      clinicId,
      tipo: 'receber' as const,
      valor: payload.chargeableCents / 100,
      appointmentId: payload.appointmentId,
      patientId: payload.patientId,
      createdVia: 'auto' as const,
    },
    idempotencyKey: `copay-confirmed:${eventId}`,
    correlationId: eventId,
  });
}

registerHandler<CopayConfirmedPayload>(
  HEALTH_INSURANCE_EVENTS.COPAY_CONFIRMED,
  handleCopayConfirmed,
);
