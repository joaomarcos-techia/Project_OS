/**
 * Recuperação de faturamento de convênio (P7.4): um atendimento de convênio
 * concluído SEMPRE termina com guia pronta para conferência ou com uma pendência
 * persistente que diz por que, quem resolve e se o sistema tenta de novo sozinho.
 *
 * Um único caminho para os três gatilhos — o evento de conclusão (handler), o
 * reconcile periódico e a correção administrativa —, então reentrega, evento fora
 * de ordem, worker interrompido e duas reconciliações simultâneas convergem:
 *  - trava consultiva por atendimento (na transação): dois processadores do mesmo
 *    atendimento não correm juntos; o reconcile pula o que está ocupado;
 *  - a guia é idempotente pela chave de origem e pelo UNIQUE de guia viva (0147);
 *  - a pendência é uma linha por atendimento; fechar exige prova no banco (0149).
 *
 * Nunca inventa dado: sem cobertura, contrato ou autorização concedida, a resposta
 * é pendência com responsável, não uma guia faturável. Nunca cria cobrança.
 */
import 'server-only';

import { and, desc, eq, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { metrics } from '@/lib/observability/metrics';
import { getPremiumDenialTx } from '@/lib/premium-access';

import { tissTerminologyVersions } from '../schema';
import {
  hiAppointmentCoverages,
  hiBillingGaps,
  hiClinicSettings,
  type HiBillingGapEventState,
  type HiBillingGapRow,
  type HiGuideStatus,
} from '../schema-clinic';
import type { GuideIssue } from '../tiss/validation/common';

import {
  decideBilling,
  errorCode as toErrorCode,
  nextAttemptDelayMs,
  type BillingFacts,
  type GapSpec,
  type GuideFact,
} from './billing-gap-policy';
import {
  consultaGuideKey,
  createConsultaGuideForAppointment,
  refreshConsultaGuide,
  type CompletedAppointment,
} from './consulta-guide-service';
import { calculateCopayForAppointment } from './copay-service';
import { ensureInsurancePayoutTx } from './insurance-payout-service';
import { recordSadtExecutionForAppointment } from './sadt-guide-service';

const DEFAULT_TZ = 'America/Sao_Paulo';

/** `AAAA-MM-DD` do instante no fuso da clínica. */
export function dateInTimezone(iso: string | Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

export type BillingProcessOutcome =
  | { kind: 'busy' }
  | { kind: 'not_found' }
  | { kind: 'ignored' }
  | { kind: 'dismissed' }
  | { kind: 'guide_ready'; guideId: string; created: boolean; gapClosed: boolean }
  | { kind: 'gap_open'; reason: GapSpec['reason']; owner: GapSpec['owner']; recovery: GapSpec['recovery']; guideId: string | null }
  | { kind: 'not_applicable'; gapClosed: boolean }
  | { kind: 'return_not_billable' };

export interface BillingProcessArgs {
  clinicId: string;
  appointmentId: string;
  detectedBy: 'event' | 'reconcile' | 'correction';
  /** Estado do evento de conclusão no outbox, quando quem chama sabe. */
  eventState: HiBillingGapEventState;
  /** `wait`: espera outro processador (handler); `skip`: pula se ocupado (reconcile); `held`: já travado. */
  lock: 'wait' | 'skip' | 'held';
}

const lockKey = (appointmentId: string) => `hi_billing:${appointmentId}`;

/** Trava consultiva do atendimento, na transação (some no COMMIT/ROLLBACK). */
export async function lockAppointmentBilling(
  tx: Tx,
  appointmentId: string,
  mode: 'wait' | 'skip',
): Promise<boolean> {
  if (mode === 'wait') {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(appointmentId)}, 0))`);
    return true;
  }
  const rows = await tx.execute<{ ok: boolean }>(
    sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey(appointmentId)}, 0)) AS ok`,
  );
  return rows[0]?.ok === true;
}

type AppointmentRow = {
  status: string;
  billing_mode: 'particular' | 'convenio';
  patient_id: string | null;
  doctor_id: string;
  procedure_id: string | null;
  scheduled_at: string | Date;
  timezone: string | null;
};

async function loadAppointment(tx: Tx, clinicId: string, appointmentId: string) {
  const rows = await tx.execute<AppointmentRow>(
    sql`SELECT a.status::text AS status, a.billing_mode, a.patient_id, a.doctor_id, a.procedure_id,
               a.scheduled_at, c.timezone
          FROM appointments a JOIN clinics c ON c.id = a.clinic_id
         WHERE a.clinic_id = ${clinicId} AND a.id = ${appointmentId}
         LIMIT 1`,
  );
  return rows[0] ?? null;
}

type GuideFactRow = {
  id: string;
  status: HiGuideStatus;
  live: boolean;
  issues: GuideIssue[];
  idempotency_key: string;
  items: number | string;
  user_edited: boolean;
  total: number | string;
  appointment_total: number | string;
};

/** Guias do atendimento: pela chave de origem do automático ou por item (manual, SP/SADT). */
async function loadGuides(tx: Tx, clinicId: string, appointmentId: string) {
  const rows = await tx.execute<GuideFactRow>(
    sql`SELECT g.id, g.status, g.live, g.issues, g.idempotency_key, g.total_value_cents AS total,
               (SELECT coalesce(sum(i.total_value_cents), 0) FROM hi_guide_items i
                 WHERE i.clinic_id = g.clinic_id AND i.guide_id = g.id AND i.appointment_id = ${appointmentId}) AS appointment_total,
               (SELECT count(*) FROM hi_guide_items i WHERE i.clinic_id = g.clinic_id AND i.guide_id = g.id) AS items,
               EXISTS (SELECT 1 FROM hi_guide_events e
                        WHERE e.clinic_id = g.clinic_id AND e.guide_id = g.id AND e.actor_kind = 'user') AS user_edited
          FROM hi_guides g
         WHERE g.clinic_id = ${clinicId}
           AND (g.idempotency_key = ${consultaGuideKey(appointmentId)}
                OR EXISTS (SELECT 1 FROM hi_guide_items i
                            WHERE i.clinic_id = g.clinic_id AND i.guide_id = g.id
                              AND i.appointment_id = ${appointmentId}))
         ORDER BY g.created_at DESC`,
  );
  return rows.map((r) => ({
    fact: {
      id: r.id,
      status: r.status,
      live: r.live,
      items: Number(r.items),
      issues: r.issues ?? [],
      automatic: r.idempotency_key === consultaGuideKey(appointmentId),
      editedByUser: r.user_edited,
    } satisfies GuideFact,
    total: Number(r.total),
    /** Valor DESTE atendimento na guia (na SP/SADT agrupada, a sessão; na Consulta, a guia). */
    appointmentTotal: Number(r.appointment_total),
  }));
}

async function lockGap(tx: Tx, clinicId: string, appointmentId: string) {
  const [gap] = await tx
    .select()
    .from(hiBillingGaps)
    .where(and(eq(hiBillingGaps.clinicId, clinicId), eq(hiBillingGaps.appointmentId, appointmentId)))
    .for('update')
    .limit(1);
  return gap ?? null;
}

const inMs = (ms: number | null) =>
  ms === null ? null : sql`now() + make_interval(secs => ${Math.round(ms / 1000)})`;

/** Abre (ou reabre/atualiza) a pendência com o motivo atual. Decisão humana (`dismissed`) não é tocada. */
async function openGap(
  tx: Tx,
  existing: HiBillingGapRow | null,
  args: BillingProcessArgs & { coverageId: string | null },
  spec: GapSpec,
  kind: 'data' | 'failure',
  errorCode: string | null,
): Promise<'opened' | 'updated' | 'dismissed'> {
  if (existing?.status === 'dismissed') return 'dismissed';
  const attempts = (existing?.attempts ?? 0) + 1;
  const delay = nextAttemptDelayMs(kind, attempts);
  const recovery = kind === 'failure' && delay === null ? 'human' : spec.recovery;
  const values = {
    coverageId: args.coverageId,
    guideId: spec.guideId,
    reason: spec.reason,
    owner: spec.owner,
    recovery,
    issues: spec.issues,
    lastErrorCode: errorCode,
    nextAttemptAt: inMs(delay) as unknown as Date | null,
    ...(args.eventState !== 'not_checked' ? { eventState: args.eventState } : {}),
  };
  if (!existing) {
    await tx.insert(hiBillingGaps).values({
      clinicId: args.clinicId,
      appointmentId: args.appointmentId,
      status: 'open',
      detectedBy: args.detectedBy,
      attempts: 1,
      eventState: args.eventState,
      ...values,
    } as typeof hiBillingGaps.$inferInsert);
    metrics.emit('insurance.billing_gap.opened', { reason: spec.reason, owner: spec.owner });
    return 'opened';
  }
  await tx
    .update(hiBillingGaps)
    .set({ ...values, status: 'open', attempts } as Partial<typeof hiBillingGaps.$inferInsert>)
    .where(and(eq(hiBillingGaps.clinicId, args.clinicId), eq(hiBillingGaps.id, existing.id)));
  if (existing.status !== 'open') {
    metrics.emit('insurance.billing_gap.opened', { reason: spec.reason, owner: spec.owner });
    return 'opened';
  }
  return 'updated';
}

async function closeGap(
  tx: Tx,
  clinicId: string,
  gap: HiBillingGapRow,
  resolution: 'guide_ready' | 'not_applicable' | 'return_not_billable',
  extra: { guideId?: string; note?: string } = {},
) {
  await tx
    .update(hiBillingGaps)
    .set({
      status: 'resolved',
      resolution,
      ...(extra.guideId ? { guideId: extra.guideId } : {}),
      ...(extra.note ? { resolutionNote: extra.note } : {}),
    })
    .where(and(eq(hiBillingGaps.clinicId, clinicId), eq(hiBillingGaps.id, gap.id)));
  metrics.emit('insurance.billing_gap.resolved', { resolution });
}

const RETURN_NOTE = 'Retorno dentro do prazo contratual: o contrato não fatura esta consulta.';

/**
 * Processa um atendimento: cria ou reavalia a guia, fecha a pendência com prova ou
 * abre a pendência com motivo e responsável. Roda na transação de quem chama.
 */
export async function processInsuranceBilling(
  tx: Tx,
  args: BillingProcessArgs,
): Promise<BillingProcessOutcome> {
  const { clinicId, appointmentId } = args;
  if (args.lock !== 'held') {
    const ok = await lockAppointmentBilling(tx, appointmentId, args.lock);
    if (!ok) return { kind: 'busy' };
  }

  const appt = await loadAppointment(tx, clinicId, appointmentId);
  if (!appt) return { kind: 'not_found' };
  if (appt.billing_mode !== 'convenio') return { kind: 'ignored' };

  let gap = await lockGap(tx, clinicId, appointmentId);
  if (gap?.status === 'dismissed') return { kind: 'dismissed' };
  if (gap?.status === 'resolved' && gap.resolution === 'return_not_billable') {
    return { kind: 'return_not_billable' };
  }

  // Decisão comercial (D24) na MESMA transação: sem assinatura paga e ativa, nada de guia nova.
  const premiumDenial = await getPremiumDenialTx(tx, clinicId, 'health_insurance');
  const [settings] = await tx
    .select({ enabled: hiClinicSettings.enabled })
    .from(hiClinicSettings)
    .where(eq(hiClinicSettings.clinicId, clinicId))
    .limit(1);
  const [coverage] = await tx
    .select()
    .from(hiAppointmentCoverages)
    .where(
      and(
        eq(hiAppointmentCoverages.clinicId, clinicId),
        eq(hiAppointmentCoverages.appointmentId, appointmentId),
      ),
    )
    .limit(1);
  const [terminology] = await tx
    .select({ version: tissTerminologyVersions.version })
    .from(tissTerminologyVersions)
    .orderBy(desc(tissTerminologyVersions.version))
    .limit(1);

  const completed: CompletedAppointment | null =
    appt.patient_id && appt.procedure_id
      ? {
          id: appointmentId,
          patientId: appt.patient_id,
          professionalId: appt.doctor_id,
          procedureId: appt.procedure_id,
          date: dateInTimezone(appt.scheduled_at, appt.timezone ?? DEFAULT_TZ),
          billingMode: 'convenio',
        }
      : null;
  const coverageInput = coverage
    ? {
        insurerId: coverage.insurerId,
        planId: coverage.planId,
        membershipId: coverage.membershipId,
        authorizationId: coverage.authorizationId,
      }
    : null;
  const ctx = { ...args, coverageId: coverage?.id ?? null };

  let created = false;
  let createTried = false;
  let refreshTried = false;
  let pendingNote: GuideIssue | null = null;
  // No máximo: criar → reavaliar → decidir. Três passadas fecham qualquer caminho.
  for (let pass = 0; pass < 3; pass += 1) {
    const guides = await loadGuides(tx, clinicId, appointmentId);
    const facts: BillingFacts = {
      appointmentStatus: appt.status,
      billingMode: appt.billing_mode,
      hasPatient: appt.patient_id !== null,
      hasProcedure: appt.procedure_id !== null,
      moduleEnabled: settings?.enabled === true,
      premiumDenial,
      coverage: coverage
        ? { id: coverage.id, status: coverage.status, guideType: coverage.guideType }
        : null,
      guides: guides.map((g) => g.fact),
    };
    const decision = decideBilling(facts, { refreshTried, createTried });

    // O reconcile vai fazer o que o evento de conclusão deveria ter feito: fica
    // registrado (com o estado do evento) e fecha com a prova da guia pronta.
    if (
      args.detectedBy === 'reconcile' &&
      !gap &&
      (decision.action === 'create_guide' || decision.action === 'refresh_guide')
    ) {
      await openGap(
        tx,
        null,
        ctx,
        {
          reason: 'event_not_processed',
          owner: 'suporte',
          recovery: 'automatic',
          issues: [
            {
              code: 'EVENT_NOT_PROCESSED',
              field: 'atendimento',
              message: `A conclusão não gerou a guia pelo caminho normal (evento: ${args.eventState}). O reconcile retomou o atendimento automaticamente.`,
              owner: 'gestor',
            },
          ],
          guideId: null,
        },
        'data',
        null,
      );
      gap = await lockGap(tx, clinicId, appointmentId);
    }

    switch (decision.action) {
      case 'ignore':
        return { kind: 'ignored' };
      case 'close_not_applicable':
        if (gap?.status === 'open') {
          await closeGap(tx, clinicId, gap, 'not_applicable');
          return { kind: 'not_applicable', gapClosed: true };
        }
        return { kind: 'not_applicable', gapClosed: false };
      case 'close_guide_ready': {
        // Base da coparticipação: o valor deste atendimento (na SP/SADT agrupada, a sessão).
        const total = guides.find((g) => g.fact.id === decision.guideId)?.appointmentTotal ?? 0;
        if (total > 0) {
          await calculateCopayForAppointment(tx, { clinicId, appointmentId, guideTotalCents: total });
        }
        // Repasse do profissional (P10.4): nasce com a guia pronta; o valor segue a conta da guia.
        // Num ponto de salvamento: falha no repasse NUNCA desfaz a guia nem a pendência; fica a
        // métrica e o repasse é criado depois ("Criar repasses que faltam").
        try {
          await tx.transaction((sp) => ensureInsurancePayoutTx(sp, { clinicId, appointmentId }));
        } catch {
          metrics.emit('insurance.payout.ensure_failed', { clinicId });
        }
        let gapClosed = false;
        if (gap && gap.status === 'open') {
          await closeGap(tx, clinicId, gap, 'guide_ready', { guideId: decision.guideId });
          gapClosed = true;
        }
        return { kind: 'guide_ready', guideId: decision.guideId, created, gapClosed };
      }
      case 'create_guide': {
        createTried = true;
        if (!completed) continue;
        if (coverage?.guideType === 'sp_sadt') {
          // P8.7: a sessão executada entra na guia SP/SADT (ou vira pendência específica).
          const sadt = await recordSadtExecutionForAppointment(tx, {
            clinicId,
            appointment: completed,
            terminologyVersion: terminology?.version ?? null,
            actor: { kind: 'automation' },
          });
          metrics.emit('insurance.guide.sp_sadt', { clinicId, outcome: sadt.kind });
          if (sadt.kind === 'created' || sadt.kind === 'attached') {
            created = true;
            refreshTried = true;
          }
          if (sadt.kind === 'blocked') {
            const spec: GapSpec = {
              reason: sadt.reason,
              owner: sadt.owner,
              recovery: sadt.recovery,
              issues: sadt.issues,
              guideId: null,
            };
            const result = await openGap(tx, gap, ctx, spec, 'data', null);
            if (result === 'dismissed') return { kind: 'dismissed' };
            return { kind: 'gap_open', reason: spec.reason, owner: spec.owner, recovery: spec.recovery, guideId: null };
          }
          continue;
        }
        const outcome = await createConsultaGuideForAppointment(tx, {
          clinicId,
          appointment: completed,
          coverage: coverageInput,
          terminologyVersion: terminology?.version ?? null,
          actor: { kind: 'automation' },
        });
        metrics.emit('insurance.guide.automation', { clinicId, outcome: outcome.kind });
        if (outcome.kind === 'created') {
          created = true;
          refreshTried = true; // acabou de nascer com a mesma derivação: não há o que reavaliar
        }
        if (outcome.kind === 'skipped_return') {
          const spec: GapSpec = {
            reason: 'return_within_window',
            owner: 'financeiro',
            recovery: 'automatic',
            issues: [],
            guideId: null,
          };
          await openGap(tx, gap, ctx, spec, 'data', null);
          gap = await lockGap(tx, clinicId, appointmentId);
          await closeGap(tx, clinicId, gap!, 'return_not_billable', { note: RETURN_NOTE });
          return { kind: 'return_not_billable' };
        }
        continue;
      }
      case 'refresh_guide': {
        refreshTried = true;
        if (!completed) continue;
        const outcome = await refreshConsultaGuide(tx, {
          clinicId,
          guideId: decision.guideId,
          appointment: completed,
          coverage: coverageInput,
          terminologyVersion: terminology?.version ?? null,
        });
        metrics.emit('insurance.guide.refresh', { clinicId, outcome: outcome.kind });
        if (outcome.kind === 'return_detected') {
          pendingNote = {
            code: 'RETURN_WITHIN_WINDOW',
            field: 'guia',
            message:
              'Pelas regras do contrato, este atendimento é retorno não faturável. Cancele a guia com o motivo ou corrija o contrato.',
            owner: 'financeiro',
          };
        } else if (outcome.kind === 'not_refreshable' && outcome.reason === 'insurer_changed') {
          pendingNote = {
            code: 'INSURER_CHANGED',
            field: 'operadora',
            message:
              'A operadora corrigida difere da guia em edição. Cancele esta guia e gere outra para a operadora certa.',
            owner: 'financeiro',
          };
        }
        continue;
      }
      case 'open_gap': {
        const spec: GapSpec = pendingNote
          ? {
              ...decision.gap,
              reason: 'guide_pending_data',
              owner: 'financeiro',
              issues: [pendingNote, ...decision.gap.issues],
            }
          : decision.gap;
        if (spec.reason === 'coverage_missing' || spec.reason === 'coverage_cancelled') {
          metrics.emit('insurance.guide.needs_coverage', { clinicId });
        } else if (spec.reason === 'sp_sadt_manual') {
          metrics.emit('insurance.guide.sp_sadt_manual', { clinicId });
        }
        const result = await openGap(tx, gap, ctx, spec, 'data', null);
        if (result === 'dismissed') return { kind: 'dismissed' };
        return {
          kind: 'gap_open',
          reason: spec.reason,
          owner: spec.owner,
          recovery: spec.recovery,
          guideId: spec.guideId,
        };
      }
    }
  }
  // Não deveria chegar aqui: três passadas sem decisão final viram pendência técnica.
  throw new BillingRecoveryError('processamento sem decisão final');
}

/**
 * Registra uma falha TÉCNICA do processamento (o savepoint já desfez o trabalho):
 * pendência `processing_failed` com tentativas, código sem dado pessoal e próxima
 * tentativa com espera crescente; depois do teto, a recuperação vira humana (suporte).
 */
export async function recordBillingFailure(
  tx: Tx,
  args: { clinicId: string; appointmentId: string; eventState: HiBillingGapEventState; error: unknown },
): Promise<'recorded' | 'dismissed' | 'not_insurance'> {
  const appt = await loadAppointment(tx, args.clinicId, args.appointmentId);
  if (!appt || appt.billing_mode !== 'convenio') return 'not_insurance';
  const gap = await lockGap(tx, args.clinicId, args.appointmentId);
  const [coverage] = await tx
    .select({ id: hiAppointmentCoverages.id })
    .from(hiAppointmentCoverages)
    .where(
      and(
        eq(hiAppointmentCoverages.clinicId, args.clinicId),
        eq(hiAppointmentCoverages.appointmentId, args.appointmentId),
      ),
    )
    .limit(1);
  const code = toErrorCode(args.error);
  const result = await openGap(
    tx,
    gap,
    {
      clinicId: args.clinicId,
      appointmentId: args.appointmentId,
      detectedBy: 'reconcile',
      eventState: args.eventState,
      lock: 'held',
      coverageId: coverage?.id ?? null,
    },
    {
      reason: 'processing_failed',
      owner: 'suporte',
      recovery: 'automatic',
      issues: [
        {
          code: 'PROCESSING_FAILED',
          field: 'guia',
          message: `Falha técnica ao gerar a guia (${code}). O sistema tenta de novo sozinho; depois do limite, o suporte assume.`,
          owner: 'gestor',
        },
      ],
      guideId: gap?.guideId ?? null,
    },
    'failure',
    code,
  );
  metrics.emit('insurance.billing_gap.processing_failed', { code });
  return result === 'dismissed' ? 'dismissed' : 'recorded';
}

export class BillingRecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingRecoveryError';
  }
}
