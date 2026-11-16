/**
 * Manutenção de Convênios (P6.6 + P12.6), chamada no FIM do `financial-reconcile` (cron a cada 15
 * min, já agendado no vercel.json), com prazo próprio e sem nunca derrubar a obrigação primária do
 * cron (recebíveis do particular). Responsabilidade só do TISS:
 *
 *   1. a cada execução, por clínica com Convênios instalado: vence as autorizações cuja senha venceu
 *      (data da clínica; `expireAuthorizationsTx` é idempotente — a segunda execução não acha nada,
 *      então a mesma ocorrência nunca é reprocessada);
 *   2. uma vez por dia (janela das 09:00–09:14 UTC = 06:00 de Brasília; com o cron de 15 min, cai
 *      exatamente uma execução nela): o RESUMO de alertas, só contagens agregadas, sem paciente,
 *      clínica, guia ou carteirinha: senhas vencendo (P6.6), sessões acabando (P6.6), pedidos
 *      aguardando a operadora há mais de 3 dias, revisões de repasse abertas (0163) e cancelamentos
 *      aguardando o recibo da operadora (0165). A entrega é pela observabilidade que já existe
 *      (métricas → buscas salvas do runbook de logs); nenhum destinatário externo recebe nada.
 *
 * Cada clínica roda isolada (`withTenant`): a falha de uma não para as outras nem o cron. Sem
 * escrita financeira: não toca recebível, livro, cobrança Asaas/AbacatePay nem Caixa.
 */
import { sql } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';
import { metrics } from '@/lib/observability/metrics';

import { listInsuranceMaintenanceClinics } from './billing-gap-candidates';
import { authorizationAlerts, type AuthorizationAlertInput } from './internal/authorization-alerts';
import type { AuthorizationStatus } from './internal/authorization-rules';
import { expireAuthorizationsTx } from './internal/authorizations';

/** Pedido de autorização aguardando a operadora há mais que isto vira alerta no resumo. */
export const AWAITING_OPERATOR_ALERT_DAYS = 3;

export interface InsuranceDailySummary {
  passwordExpiring: number;
  sessionsEnding: number;
  awaitingOperatorOverdue: number;
  openPayoutReviews: number;
  awaitingCancellationReceipts: number;
  clinicsWithAlerts: number;
}

export interface InsuranceMaintenanceSummary {
  clinics: number;
  processed: number;
  expired: number;
  failed: number;
  deferred: number;
  daily: InsuranceDailySummary | null;
}

/** Uma execução por dia: a do cron que cai entre 09:00 e 09:14 UTC. */
export function isDailySummaryWindow(now: Date): boolean {
  return now.getUTCHours() === 9 && now.getUTCMinutes() < 15;
}

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];
type Row = Record<string, unknown>;

/** Contagens do resumo diário de UMA clínica (na transação dela; só números). */
export async function insuranceDailyCountsTx(tx: Tx, clinicId: string): Promise<Omit<InsuranceDailySummary, 'clinicsWithAlerts'>> {
  const [today] = (await tx.execute(sql`
    SELECT (now() AT TIME ZONE coalesce(c.timezone, 'America/Sao_Paulo'))::date::text AS d
      FROM public.clinics c WHERE c.id = ${clinicId}::uuid`)) as unknown as Array<{ d: string }>;
  if (!today) return { passwordExpiring: 0, sessionsEnding: 0, awaitingOperatorOverdue: 0, openPayoutReviews: 0, awaitingCancellationReceipts: 0 };
  const auths = (await tx.execute(sql`
    SELECT a.id::text AS id, a.status::text AS status, a.password_valid_until::text AS valid_until,
           coalesce((SELECT json_agg(json_build_object('quantityAuthorized', coalesce(i.quantity_authorized, 0),
                                                      'quantityConsumed', coalesce(i.quantity_consumed, 0)))
                       FROM public.hi_authorization_items i
                      WHERE i.clinic_id = a.clinic_id AND i.authorization_id = a.id), '[]'::json) AS items
      FROM public.hi_authorizations a
     WHERE a.clinic_id = ${clinicId}::uuid AND a.status IN ('authorized', 'partially_authorized')`)) as unknown as Row[];
  const input: AuthorizationAlertInput[] = auths.map((r) => ({
    id: String(r.id),
    status: r.status as AuthorizationStatus,
    passwordValidUntil: r.valid_until ? String(r.valid_until) : null,
    // O driver pode devolver o json_agg como texto.
    items: (typeof r.items === 'string' ? JSON.parse(r.items) : r.items ?? []) as Array<{ quantityAuthorized: number; quantityConsumed: number }>,
  }));
  const alerts = authorizationAlerts(input, today.d);
  const [counts] = (await tx.execute(sql`SELECT
      (SELECT count(*)::int FROM public.hi_authorizations a
        WHERE a.clinic_id = ${clinicId}::uuid AND a.status IN ('requested', 'pending_operator')
          AND a.requested_on < ${today.d}::date - ${AWAITING_OPERATOR_ALERT_DAYS}::int) AS awaiting,
      (SELECT count(*)::int FROM public.hi_payout_reviews r WHERE r.clinic_id = ${clinicId}::uuid AND r.status = 'open') AS reviews,
      (SELECT count(*)::int FROM public.hi_guide_cancellations c WHERE c.clinic_id = ${clinicId}::uuid AND c.status = 'awaiting_receipt') AS cancellations`)) as unknown as Row[];
  return {
    passwordExpiring: alerts.filter((a) => a.kind === 'password_expiring').length,
    sessionsEnding: alerts.filter((a) => a.kind === 'sessions_ending').length,
    awaitingOperatorOverdue: Number(counts?.awaiting ?? 0),
    openPayoutReviews: Number(counts?.reviews ?? 0),
    awaitingCancellationReceipts: Number(counts?.cancellations ?? 0),
  };
}

export async function runInsuranceMaintenance(opts: {
  deadlineAt: number;
  now?: Date;
  clinics?: readonly string[];
  /** Força o resumo fora da janela (teste e reexecução manual pelo suporte). */
  forceDaily?: boolean;
}): Promise<InsuranceMaintenanceSummary> {
  const now = opts.now ?? new Date();
  const daily = opts.forceDaily === true || isDailySummaryWindow(now);
  const clinics = opts.clinics ?? (await listInsuranceMaintenanceClinics());
  const summary: InsuranceMaintenanceSummary = { clinics: clinics.length, processed: 0, expired: 0, failed: 0, deferred: 0, daily: null };
  const totals: InsuranceDailySummary = {
    passwordExpiring: 0,
    sessionsEnding: 0,
    awaitingOperatorOverdue: 0,
    openPayoutReviews: 0,
    awaitingCancellationReceipts: 0,
    clinicsWithAlerts: 0,
  };
  for (const clinicId of clinics) {
    if (Date.now() >= opts.deadlineAt) {
      summary.deferred += 1;
      continue;
    }
    try {
      const result = await withTenant(clinicId, async (tx) => {
        const expired = await expireAuthorizationsTx(tx, clinicId);
        const counts = daily ? await insuranceDailyCountsTx(tx, clinicId) : null;
        return { expired: expired.length, counts };
      });
      summary.processed += 1;
      summary.expired += result.expired;
      if (result.counts) {
        const c = result.counts;
        totals.passwordExpiring += c.passwordExpiring;
        totals.sessionsEnding += c.sessionsEnding;
        totals.awaitingOperatorOverdue += c.awaitingOperatorOverdue;
        totals.openPayoutReviews += c.openPayoutReviews;
        totals.awaitingCancellationReceipts += c.awaitingCancellationReceipts;
        if (Object.values(c).some((n) => n > 0)) totals.clinicsWithAlerts += 1;
      }
    } catch (error) {
      summary.failed += 1;
      // Só o tipo do erro: nem clínica, nem mensagem do banco (pode citar dado).
      metrics.emit('insurance.maintenance.clinic_failed', { error: error instanceof Error ? error.name : 'unknown' });
    }
  }
  if (daily) {
    summary.daily = totals;
    metrics.emit('insurance.maintenance.daily_summary', { ...totals, clinics: summary.processed });
  }
  metrics.emit('insurance.maintenance.run', {
    clinics: summary.clinics,
    processed: summary.processed,
    expired: summary.expired,
    failed: summary.failed,
    deferred: summary.deferred,
    daily,
  });
  return summary;
}
