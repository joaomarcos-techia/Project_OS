/**
 * AdminMetricsRepository (C15) — agregações globais do dashboard e métricas.
 *
 * ÚNICO ponto que toca dbAdmin para esta área (review #5/#13). As queries são
 * agregadas e isoladas aqui: quando virarem materialized view / read replica,
 * troca-se ESTA classe e nenhuma tela muda.
 *
 * MRR (OR-D2): SUM(invoices.total_amount) das faturas `paid` no mês corrente,
 * em tempo real, SEM cache manual.
 *
 * Server-only.
 */
import 'server-only';

import { isNull, sql } from 'drizzle-orm';

import { aiConversations, aiMessages } from '@/contexts/ai-agent/schema';
import { invoices, subscriptions } from '@/contexts/billing/schema';
import { clinics } from '@/contexts/tenancy/schema';
import { dbAdmin } from '@/lib/db';
import { auditEvents } from '@/lib/db/schema/infra/audit';

import type { DashboardMetricsDTO, PlatformUsageDTO } from '../dto';
import { toCents } from '../format';

const int = (raw: unknown): number => {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
};

export class AdminMetricsRepository {
  /** Dashboard global. MRR = SUM(paid) do mês; ARR = MRR×12. */
  async getDashboard(): Promise<DashboardMetricsDTO> {
    const [mrrRow] = await dbAdmin
      .select({
        mrr: sql<string>`COALESCE(SUM(${invoices.totalAmount}), 0)`,
      })
      .from(invoices)
      .where(
        sql`${invoices.status} = 'paid'
          AND ${invoices.paidAt} >= date_trunc('month', now())
          AND ${invoices.paidAt} <  date_trunc('month', now()) + interval '1 month'`,
      );

    const [clinicRow] = await dbAdmin
      .select({
        active: sql<number>`(COUNT(*) FILTER (WHERE ${clinics.status} = 'active'))::int`,
        cancelled: sql<number>`(COUNT(*) FILTER (WHERE ${clinics.status} = 'cancelled'))::int`,
        atRisk: sql<number>`(COUNT(*) FILTER (WHERE ${clinics.status} IN ('suspended_readonly','suspended','pending_payment')))::int`,
        newThis: sql<number>`(COUNT(*) FILTER (WHERE ${clinics.createdAt} >= date_trunc('month', now())))::int`,
        newLast: sql<number>`(COUNT(*) FILTER (WHERE ${clinics.createdAt} >= date_trunc('month', now()) - interval '1 month' AND ${clinics.createdAt} < date_trunc('month', now())))::int`,
      })
      .from(clinics)
      .where(isNull(clinics.deletedAt));

    const [subRow] = await dbAdmin
      .select({
        activeSubs: sql<number>`(COUNT(*) FILTER (WHERE ${subscriptions.billingStatus} = 'active'))::int`,
        cancelledThis: sql<number>`(COUNT(*) FILTER (WHERE ${subscriptions.cancelledAt} >= date_trunc('month', now()) AND ${subscriptions.cancelledAt} < date_trunc('month', now()) + interval '1 month'))::int`,
      })
      .from(subscriptions);

    const mrrCents = toCents(mrrRow?.mrr ?? '0');
    const activeSubs = int(subRow?.activeSubs);
    const cancelledThis = int(subRow?.cancelledThis);
    const newThis = int(clinicRow?.newThis);
    const newLast = int(clinicRow?.newLast);

    const churnDenom = activeSubs + cancelledThis;
    const churnRatePct = churnDenom > 0 ? (cancelledThis / churnDenom) * 100 : 0;
    const monthlyGrowthPct = newLast > 0 ? ((newThis - newLast) / newLast) * 100 : newThis > 0 ? 100 : 0;

    return {
      mrrCents,
      arrCents: mrrCents * 12,
      churnRatePct,
      monthlyGrowthPct,
      clinics: {
        active: int(clinicRow?.active),
        atRisk: int(clinicRow?.atRisk),
        new: newThis,
        cancelled: int(clinicRow?.cancelled),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  /** Uso da plataforma no período [from, to] (ISO). DAU/WAU usam janela própria. */
  async getUsage(period: { from: string; to: string }): Promise<PlatformUsageDTO> {
    const { from, to } = period;

    const [activity] = await dbAdmin
      .select({
        dau: sql<number>`(COUNT(DISTINCT ${auditEvents.userId}) FILTER (WHERE ${auditEvents.createdAt} >= date_trunc('day', now())))::int`,
        wau: sql<number>`(COUNT(DISTINCT ${auditEvents.userId}) FILTER (WHERE ${auditEvents.createdAt} >= now() - interval '7 days'))::int`,
        activeClinics: sql<number>`(COUNT(DISTINCT ${auditEvents.clinicId}) FILTER (WHERE ${auditEvents.createdAt} >= ${from}::timestamptz AND ${auditEvents.createdAt} <= ${to}::timestamptz))::int`,
      })
      .from(auditEvents);

    const [conv] = await dbAdmin
      .select({ n: sql<number>`(COUNT(*))::int` })
      .from(aiConversations)
      .where(
        sql`${aiConversations.startedAt} >= ${from}::timestamptz AND ${aiConversations.startedAt} <= ${to}::timestamptz`,
      );

    const [msg] = await dbAdmin
      .select({
        n: sql<number>`(COUNT(*))::int`,
        tokens: sql<number>`(COALESCE(SUM(COALESCE(${aiMessages.tokensInput},0) + COALESCE(${aiMessages.tokensOutput},0)), 0))::int`,
        cost: sql<string>`COALESCE(SUM(${aiMessages.costUsd}), 0)`,
      })
      .from(aiMessages)
      .where(
        sql`${aiMessages.createdAt} >= ${from}::timestamptz AND ${aiMessages.createdAt} <= ${to}::timestamptz`,
      );

    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    const days = Math.max(1, Math.round((toMs - fromMs) / 86_400_000));
    const aiMessagesCount = int(msg?.n);

    return {
      dau: int(activity?.dau),
      wau: int(activity?.wau),
      activeClinics: int(activity?.activeClinics),
      aiConversations: int(conv?.n),
      aiMessages: aiMessagesCount,
      aiTokens: int(msg?.tokens),
      geminiCostUsd: Number(msg?.cost ?? 0),
      dailyAvgMessages: Math.round((aiMessagesCount / days) * 10) / 10,
      periodFrom: from,
      periodTo: to,
    };
  }
}

export const adminMetricsRepository = new AdminMetricsRepository();
