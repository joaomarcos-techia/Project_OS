/**
 * Guia nova depois de uma guia CANCELADA antes do envio (defeito achado em 24/11: a pendência
 * "guia cancelada" pedia "gere uma nova guia", mas a chave de idempotência da sessão pertencia à
 * cancelada e nenhum caminho gerava outra).
 *
 * Regras:
 *  - ato explícito de quem fatura (a action confere a permissão fresca e audita);
 *  - só de guia `cancelled` (cancelada antes de chegar à operadora). Guia enviada ou na operadora
 *    se corrige pela substituição da P7.5 (cancelamento na operadora com recibo), nunca por aqui;
 *  - a guia nova tem identidade própria: número TISS novo e a chave `<chave da sessão>:reissue:<id
 *    da cancelada>`. Por isso UMA guia nova por cancelamento: repetir, clicar duas vezes ou abrir em
 *    duas abas cai na mesma chave e na mesma trava (a cancelada, FOR UPDATE) e devolve a mesma guia;
 *  - a cancelada continua no histórico, como está (nada é reativado nem apagado);
 *  - a sessão que já está em outra guia viva não ganha outra (os índices "sem cobrança dupla" da 0147
 *    também impedem);
 *  - o consumo da autorização da sessão não se repete (chave por sessão, como na conclusão).
 */
import { sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

import { processInsuranceBilling } from './billing-recovery';
import { consultaGuideKey, createConsultaGuideForAppointment, type CompletedAppointment } from './consulta-guide-service';
import { assertConveniosOperableTx } from './module-guard';
import { recordSadtExecutionForAppointment, sadtSessionGuideKey } from './sadt-guide-service';

export class GuideReissueError extends Error {
  constructor(
    message: string,
    readonly kind: 'not_found' | 'state',
  ) {
    super(message);
    this.name = 'GuideReissueError';
  }
}

export const reissueKey = (sessionKey: string, cancelledGuideId: string): string => `${sessionKey}:reissue:${cancelledGuideId}`;

interface CancelledGuide {
  id: string;
  status: string;
  guide_type: 'consulta' | 'sp_sadt';
  operator_cancellations: number;
}

/** A guia nova que já nasceu desta cancelada (pela chave), ou null. */
export async function reissuedFromTx(tx: Tx, clinicId: string, cancelledGuideId: string): Promise<{ id: string; number: string } | null> {
  const rows = (await tx.execute(sql`
    SELECT g.id::text AS id, g.number FROM public.hi_guides g
     WHERE g.clinic_id = ${clinicId}::uuid AND g.idempotency_key LIKE ${`%:reissue:${cancelledGuideId}`}
     ORDER BY g.created_at LIMIT 1`)) as unknown as Array<{ id: string; number: string }>;
  return rows[0] ?? null;
}

/** Por que esta guia não pode ganhar guia nova agora (null: pode). Só leitura. */
export async function reissueBlockTx(tx: Tx, clinicId: string, guideId: string): Promise<string | null> {
  const [g] = (await tx.execute(sql`
    SELECT g.id::text AS id, g.status::text AS status, g.guide_type,
           (SELECT count(*)::int FROM public.hi_guide_cancellations k WHERE k.clinic_id = g.clinic_id AND k.guide_id = g.id) AS operator_cancellations
      FROM public.hi_guides g WHERE g.clinic_id = ${clinicId}::uuid AND g.id = ${guideId}::uuid`)) as unknown as CancelledGuide[];
  if (!g) return 'Guia inexistente nesta clínica.';
  return blockOf(tx, clinicId, g);
}

async function blockOf(tx: Tx, clinicId: string, g: CancelledGuide): Promise<string | null> {
  if (g.status !== 'cancelled' || g.operator_cancellations > 0) {
    return g.operator_cancellations > 0 || ['exported', 'sent', 'under_review', 'replaced'].includes(g.status)
      ? 'Guia que já chegou à operadora se corrige pela substituição (cancelamento na operadora com recibo).'
      : 'Só se gera guia nova de uma guia cancelada antes do envio.';
  }
  const [live] = (await tx.execute(sql`
    SELECT count(*)::int AS n FROM public.hi_guide_items x
     WHERE x.clinic_id = ${clinicId}::uuid AND x.live
       AND x.appointment_id IN (SELECT i.appointment_id FROM public.hi_guide_items i
                                 WHERE i.clinic_id = ${clinicId}::uuid AND i.guide_id = ${g.id}::uuid AND i.appointment_id IS NOT NULL)`)) as unknown as Array<{ n: number }>;
  if (Number(live?.n ?? 0) > 0) return 'A sessão desta guia já está em outra guia em vigor.';
  return null;
}

export async function reissueGuideAfterCancellationTx(
  tx: Tx,
  args: { clinicId: string; cancelledGuideId: string; actorUserId: string },
): Promise<{ guideId: string; number: string; existing: boolean }> {
  const { clinicId } = args;
  await assertConveniosOperableTx(tx, clinicId);
  // A trava da cancelada serializa as reemissões dela (duas abas, clique duplo).
  const [g] = (await tx.execute(sql`
    SELECT g.id::text AS id, g.status::text AS status, g.guide_type,
           (SELECT count(*)::int FROM public.hi_guide_cancellations k WHERE k.clinic_id = g.clinic_id AND k.guide_id = g.id) AS operator_cancellations
      FROM public.hi_guides g WHERE g.clinic_id = ${clinicId}::uuid AND g.id = ${args.cancelledGuideId}::uuid
       FOR UPDATE OF g`)) as unknown as CancelledGuide[];
  if (!g) throw new GuideReissueError('Guia inexistente nesta clínica.', 'not_found');
  const already = await reissuedFromTx(tx, clinicId, g.id);
  if (already) return { guideId: already.id, number: already.number, existing: true };
  const block = await blockOf(tx, clinicId, g);
  if (block) throw new GuideReissueError(block, 'state');

  const sessions = (await tx.execute(sql`
    SELECT DISTINCT a.id::text AS id, a.patient_id::text AS patient_id, a.doctor_id::text AS doctor_id,
           a.procedure_id::text AS procedure_id, a.billing_mode::text AS billing_mode,
           (a.scheduled_at AT TIME ZONE coalesce(c.timezone, 'America/Sao_Paulo'))::date::text AS date, a.scheduled_at
      FROM public.hi_guide_items i
      JOIN public.appointments a ON a.clinic_id = i.clinic_id AND a.id = i.appointment_id
      JOIN public.clinics c ON c.id = a.clinic_id
     WHERE i.clinic_id = ${clinicId}::uuid AND i.guide_id = ${g.id}::uuid
     ORDER BY a.scheduled_at, 1`)) as unknown as Array<{
    id: string;
    patient_id: string | null;
    doctor_id: string;
    procedure_id: string | null;
    billing_mode: string | null;
    date: string;
  }>;
  if (sessions.length === 0) throw new GuideReissueError('A guia cancelada não tem sessão de origem.', 'state');
  const [tv] = (await tx.execute(sql`
    SELECT version FROM public.tiss_terminology_versions ORDER BY version DESC LIMIT 1`)) as unknown as Array<{ version: string }>;
  const actor = { kind: 'user' as const, userId: args.actorUserId };
  let result: { guideId: string; number: string } | null = null;
  for (const s of sessions) {
    if (!s.patient_id || !s.procedure_id) throw new GuideReissueError('A sessão da guia cancelada está sem paciente ou procedimento.', 'state');
    const appointment: CompletedAppointment = {
      id: s.id,
      patientId: s.patient_id,
      professionalId: s.doctor_id,
      procedureId: s.procedure_id,
      date: s.date,
      billingMode: s.billing_mode === 'convenio' ? 'convenio' : s.billing_mode === 'particular' ? 'particular' : null,
    };
    if (g.guide_type === 'consulta') {
      const [cov] = (await tx.execute(sql`
        SELECT insurer_id::text AS insurer_id, plan_id::text AS plan_id, membership_id::text AS membership_id,
               authorization_id::text AS authorization_id, status::text AS status
          FROM public.hi_appointment_coverages WHERE clinic_id = ${clinicId}::uuid AND appointment_id = ${s.id}::uuid`)) as unknown as Array<{
        insurer_id: string;
        plan_id: string | null;
        membership_id: string | null;
        authorization_id: string | null;
        status: string;
      }>;
      const out = await createConsultaGuideForAppointment(tx, {
        clinicId,
        appointment,
        coverage: cov && cov.status !== 'cancelled'
          ? { insurerId: cov.insurer_id, planId: cov.plan_id, membershipId: cov.membership_id, authorizationId: cov.authorization_id }
          : null,
        terminologyVersion: tv?.version ?? null,
        actor,
        idempotencyKey: reissueKey(consultaGuideKey(s.id), g.id),
      });
      if (out.kind === 'created' || out.kind === 'existing') result ??= { guideId: out.guideId, number: out.number };
      else throw new GuideReissueError(`A guia nova não pôde ser gerada (${out.kind}). Confira a cobertura do atendimento.`, 'state');
    } else {
      const out = await recordSadtExecutionForAppointment(tx, {
        clinicId,
        appointment,
        terminologyVersion: tv?.version ?? null,
        actor,
        idempotencyKey: reissueKey(sadtSessionGuideKey(s.id), g.id),
      });
      if (out.kind === 'created' || out.kind === 'attached') result ??= { guideId: out.guideId, number: out.number };
      else if (out.kind === 'existing') result ??= { guideId: out.guideId, number: '' };
      else if (out.kind === 'blocked') throw new GuideReissueError(out.issues[0]?.message ?? 'A sessão não pode ser faturada agora.', 'state');
      else throw new GuideReissueError('O módulo de Convênios está desligado nesta clínica.', 'state');
    }
    // A pendência "guia cancelada" da sessão se resolve com a guia nova (mesma transação).
    await processInsuranceBilling(tx, { clinicId, appointmentId: s.id, detectedBy: 'correction', eventState: 'not_checked', lock: 'wait' });
  }
  if (!result!.number) {
    const [n] = (await tx.execute(sql`SELECT number FROM public.hi_guides WHERE id = ${result!.guideId}::uuid`)) as unknown as Array<{ number: string }>;
    result = { guideId: result!.guideId, number: n?.number ?? '' };
  }
  return { ...result!, existing: false };
}
