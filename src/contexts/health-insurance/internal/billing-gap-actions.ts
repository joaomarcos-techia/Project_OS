/**
 * Ações humanas sobre a pendência "convênio sem guia" (P7.4).
 *
 *  - corrigir a cobertura de um atendimento já concluído (só com pendência aberta;
 *    o banco exige nota e autor) e reprocessar NA MESMA transação: se os dados
 *    fecham, a guia nasce pronta para conferência e a pendência fecha com prova;
 *  - tentar de novo agora (idempotente);
 *  - encerrar sem faturar, com motivo (decisão humana; o automático nunca desfaz);
 *  - reabrir uma decisão humana.
 *
 * As funções `*InTx` rodam na transação de quem chama (testes e harness); as
 * exportadas sem sufixo são a fronteira do usuário: permissão no servidor e
 * `withTenant`. Corrigir e tentar de novo pedem `EDIT_AGENDA` (a guia resultante
 * ainda passa por conferência e aprovação com `MANAGE_FINANCIAL`); encerrar e
 * reabrir mexem no faturamento e pedem `MANAGE_FINANCIAL` com sessão recente.
 */
import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireFreshPermission, requireUser } from '@/lib/auth/tenant-context';
import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { assertPremiumFeatureTx } from '@/lib/premium-access';

import { hiBillingGaps, type HiGuideType } from '../schema-clinic';

import {
  dateInTimezone,
  lockAppointmentBilling,
  processInsuranceBilling,
  type BillingProcessOutcome,
} from './billing-recovery';
import { recordAppointmentCoverage } from './coverage-service';

export class BillingGapActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingGapActionError';
  }
}

export interface CoverageCorrectionInput {
  clinicId: string;
  appointmentId: string;
  guideType: HiGuideType;
  insurerId: string;
  planId: string | null;
  membershipId: string | null;
  authorizationId: string | null;
  note: string;
}

async function openGapFor(tx: Tx, clinicId: string, appointmentId: string) {
  const [gap] = await tx
    .select()
    .from(hiBillingGaps)
    .where(and(eq(hiBillingGaps.clinicId, clinicId), eq(hiBillingGaps.appointmentId, appointmentId)))
    .for('update')
    .limit(1);
  return gap ?? null;
}

export async function correctCoverageInTx(
  tx: Tx,
  input: CoverageCorrectionInput,
  userId: string,
): Promise<BillingProcessOutcome> {
  // D24: operação nova de Convênios só com assinatura paga e ativa (o banco confere de novo).
  await assertPremiumFeatureTx(tx, input.clinicId, 'health_insurance');
  await lockAppointmentBilling(tx, input.appointmentId, 'wait');
  const gap = await openGapFor(tx, input.clinicId, input.appointmentId);
  if (!gap || gap.status !== 'open') {
    throw new BillingGapActionError('o atendimento não tem pendência de faturamento aberta');
  }
  const rows = await tx.execute<{
    patient_id: string | null;
    procedure_id: string | null;
    scheduled_at: string | Date;
    timezone: string | null;
  }>(
    sql`SELECT a.patient_id, a.procedure_id, a.scheduled_at, c.timezone
          FROM appointments a JOIN clinics c ON c.id = a.clinic_id
         WHERE a.clinic_id = ${input.clinicId} AND a.id = ${input.appointmentId} LIMIT 1`,
  );
  const appt = rows[0];
  if (!appt?.patient_id || !appt.procedure_id) {
    throw new BillingGapActionError('atendimento sem paciente ou sem procedimento');
  }
  await recordAppointmentCoverage(tx, {
    clinicId: input.clinicId,
    appointmentId: input.appointmentId,
    patientId: appt.patient_id,
    procedureId: appt.procedure_id,
    appointmentDate: dateInTimezone(appt.scheduled_at, appt.timezone ?? 'America/Sao_Paulo'),
    guideType: input.guideType,
    insurerId: input.insurerId,
    planId: input.planId,
    membershipId: input.membershipId,
    authorizationId: input.authorizationId,
    actor: { kind: 'user', userId },
    correction: { note: input.note },
  });
  return processInsuranceBilling(tx, {
    clinicId: input.clinicId,
    appointmentId: input.appointmentId,
    detectedBy: 'correction',
    eventState: 'not_checked',
    lock: 'held',
  });
}

export async function retryBillingGapInTx(
  tx: Tx,
  args: { clinicId: string; gapId: string },
): Promise<BillingProcessOutcome> {
  const [gap] = await tx
    .select({ appointmentId: hiBillingGaps.appointmentId, status: hiBillingGaps.status })
    .from(hiBillingGaps)
    .where(and(eq(hiBillingGaps.clinicId, args.clinicId), eq(hiBillingGaps.id, args.gapId)))
    .limit(1);
  if (!gap || gap.status !== 'open') throw new BillingGapActionError('pendência inexistente ou não aberta');
  return processInsuranceBilling(tx, {
    clinicId: args.clinicId,
    appointmentId: gap.appointmentId,
    detectedBy: 'correction',
    eventState: 'not_checked',
    lock: 'wait',
  });
}

export async function dismissBillingGapInTx(
  tx: Tx,
  args: { clinicId: string; gapId: string; note: string; expectedVersion: number },
): Promise<void> {
  const note = args.note.trim();
  if (note.length < 10 || note.length > 500) {
    throw new BillingGapActionError('encerrar sem faturar exige o motivo (10 a 500 caracteres)');
  }
  const updated = await tx
    .update(hiBillingGaps)
    .set({ status: 'dismissed', resolution: 'dismissed', resolutionNote: note })
    .where(
      and(
        eq(hiBillingGaps.clinicId, args.clinicId),
        eq(hiBillingGaps.id, args.gapId),
        eq(hiBillingGaps.status, 'open'),
        eq(hiBillingGaps.version, args.expectedVersion),
      ),
    )
    .returning({ id: hiBillingGaps.id });
  if (updated.length === 0) {
    throw new BillingGapActionError('a pendência mudou ou já foi fechada; recarregue');
  }
}

export async function reopenBillingGapInTx(
  tx: Tx,
  args: { clinicId: string; gapId: string; expectedVersion: number },
): Promise<void> {
  const updated = await tx
    .update(hiBillingGaps)
    .set({ status: 'open', nextAttemptAt: sql`now()` as unknown as Date })
    .where(
      and(
        eq(hiBillingGaps.clinicId, args.clinicId),
        eq(hiBillingGaps.id, args.gapId),
        eq(hiBillingGaps.status, 'dismissed'),
        eq(hiBillingGaps.version, args.expectedVersion),
      ),
    )
    .returning({ id: hiBillingGaps.id });
  if (updated.length === 0) {
    throw new BillingGapActionError('só se reabre pendência encerrada sem faturar, na versão atual');
  }
}

// ── Fronteira do usuário ─────────────────────────────────────────────────
// O autor vai para `withTenant` (GUC `app.current_user`): é ele que o banco grava no
// histórico da pendência e da cobertura, e é por ele que o automático reconhece uma
// guia mexida por gente (e não a sobrescreve).

export async function correctCoverageForBillingGap(input: CoverageCorrectionInput) {
  await requireFreshPermission(PERMISSIONS.EDIT_AGENDA);
  const user = await requireUser();
  return withTenant(input.clinicId, (tx) => correctCoverageInTx(tx, input, user.userId), user.userId);
}

export async function retryBillingGap(clinicId: string, gapId: string) {
  await requireFreshPermission(PERMISSIONS.EDIT_AGENDA);
  const user = await requireUser();
  return withTenant(clinicId, (tx) => retryBillingGapInTx(tx, { clinicId, gapId }), user.userId);
}

export async function dismissBillingGap(
  clinicId: string,
  gapId: string,
  note: string,
  expectedVersion: number,
) {
  await requireFreshPermission(PERMISSIONS.MANAGE_FINANCIAL);
  const user = await requireUser();
  return withTenant(
    clinicId,
    (tx) => dismissBillingGapInTx(tx, { clinicId, gapId, note, expectedVersion }),
    user.userId,
  );
}

export async function reopenBillingGap(clinicId: string, gapId: string, expectedVersion: number) {
  await requireFreshPermission(PERMISSIONS.MANAGE_FINANCIAL);
  const user = await requireUser();
  return withTenant(
    clinicId,
    (tx) => reopenBillingGapInTx(tx, { clinicId, gapId, expectedVersion }),
    user.userId,
  );
}
