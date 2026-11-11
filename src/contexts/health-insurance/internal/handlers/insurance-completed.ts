/**
 * `scheduling.appointment.insurance_completed` → Guia de Consulta automática (P7.4).
 *
 * O Scheduling publica este evento JUNTO com `completed` quando o atendimento é
 * de convênio (mesma transação). O Financeiro ouve o `completed` e NÃO cria
 * recebível cheio para convênio; aqui nasce a guia:
 *  1. lê a cobertura do atendimento (registrada na recepção, validada no servidor);
 *  2. sem cobertura: nada é inventado — métrica e o reconcile retoma depois;
 *  3. SP/SADT automática ainda não (P8.7): métrica, sem guia;
 *  4. Consulta: `createConsultaGuideForAppointment` (idempotente pela chave de
 *     origem, número na mesma transação, pendências com responsável);
 *  5. com guia criada, a coparticipação passa de estimada a CALCULADA pelo total da
 *     guia. Cobrar continua dependendo de conferência e confirmação.
 *
 * Reentrega do evento: o serviço devolve a guia existente; o cálculo da
 * coparticipação é idempotente. Falha no meio: a transação do worker desfaz tudo
 * (inclusive o número) e o outbox retenta.
 */
import { and, desc, eq, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { metrics } from '@/lib/observability/metrics';
import { PoisonPillError } from '@/lib/outbox/errors';
import { registerHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- evento + tipo são o contrato PÚBLICO do Scheduling (mesma exceção do Financeiro). */
import {
  SCHEDULING_EVENTS,
  type AppointmentInsuranceCompletedPayload,
} from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { tissTerminologyVersions } from '../../schema';
import { hiAppointmentCoverages } from '../../schema-clinic';
import { createConsultaGuideForAppointment } from '../consulta-guide-service';
import { calculateCopayForAppointment } from '../copay-service';

const DEFAULT_TZ = 'America/Sao_Paulo';

/** `AAAA-MM-DD` do instante no fuso da clínica. */
export function dateInTimezone(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

export async function handleInsuranceCompleted(ctx: {
  tx: Tx;
  clinicId: string;
  payload: AppointmentInsuranceCompletedPayload;
  eventId: string;
}): Promise<void> {
  const { tx, clinicId, payload } = ctx;
  if (payload.clinicId !== clinicId) {
    throw new PoisonPillError(
      `clinicId divergente: payload=${payload.clinicId} ctx=${clinicId}`,
      'clinic_mismatch',
    );
  }

  const [coverage] = await tx
    .select()
    .from(hiAppointmentCoverages)
    .where(
      and(
        eq(hiAppointmentCoverages.clinicId, clinicId),
        eq(hiAppointmentCoverages.appointmentId, payload.appointmentId),
      ),
    )
    .limit(1);
  if (!coverage || coverage.status === 'cancelled') {
    metrics.emit('insurance.guide.needs_coverage', { clinicId });
    return;
  }
  if (coverage.guideType !== 'consulta') {
    metrics.emit('insurance.guide.sp_sadt_manual', { clinicId });
    return;
  }

  const tzRows = await tx.execute<{ timezone: string | null }>(
    sql`SELECT timezone FROM clinics WHERE id = ${clinicId} LIMIT 1`,
  );
  const date = dateInTimezone(payload.scheduledAt, tzRows[0]?.timezone ?? DEFAULT_TZ);
  const [terminology] = await tx
    .select({ version: tissTerminologyVersions.version })
    .from(tissTerminologyVersions)
    .orderBy(desc(tissTerminologyVersions.version))
    .limit(1);

  const outcome = await createConsultaGuideForAppointment(tx, {
    clinicId,
    appointment: {
      id: payload.appointmentId,
      patientId: payload.patientId,
      professionalId: payload.doctorId,
      procedureId: payload.procedureId,
      date,
      billingMode: 'convenio',
    },
    coverage: {
      insurerId: coverage.insurerId,
      planId: coverage.planId,
      membershipId: coverage.membershipId,
      authorizationId: coverage.authorizationId,
    },
    terminologyVersion: terminology?.version ?? null,
    actor: { kind: 'automation' },
  });
  metrics.emit('insurance.guide.automation', { clinicId, outcome: outcome.kind });

  if (outcome.kind === 'created' || outcome.kind === 'existing') {
    const [guide] = await tx.execute<{ total: string | number }>(
      sql`SELECT total_value_cents AS total FROM hi_guides
           WHERE clinic_id = ${clinicId} AND id = ${outcome.guideId} LIMIT 1`,
    );
    const total = Number(guide?.total ?? 0);
    if (total > 0) {
      await calculateCopayForAppointment(tx, {
        clinicId,
        appointmentId: payload.appointmentId,
        guideTotalCents: total,
      });
    }
  }
}

registerHandler<AppointmentInsuranceCompletedPayload>(
  SCHEDULING_EVENTS.INSURANCE_COMPLETED,
  handleInsuranceCompleted,
);
