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

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { aiConversations, aiMessages } from '@/contexts/ai-agent/schema';
import { invoices, prices, subscriptions } from '@/contexts/billing/schema';
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
  /**
   * Dashboard global. MRR = receita recorrente NORMALIZADA das assinaturas
   * comprometidas (billing_status active + past_due; trial ainda não paga,
   * cancelled já saiu); anual normaliza p/ mensal (amount/12). ARR = MRR×12.
   *
   * Por que NÃO "SUM(faturas pagas no mês)": aquilo é caixa recebido (inclui
   * setup fee, anual à vista e avulsos) e oscila por timing de pagamento — não
   * é receita recorrente. A série histórica (getMrrTrend) continua sendo caixa
   * por mês, rotulada como "Receita paga" na UI.
   */
  async getDashboard(): Promise<DashboardMetricsDTO> {
    const [mrrRow] = await dbAdmin
      .select({
        mrr: sql<string>`COALESCE(SUM(CASE WHEN ${prices.billingCycle} = 'annual' THEN ${prices.amount} / 12.0 ELSE ${prices.amount} END), 0)`,
      })
      .from(subscriptions)
      .innerJoin(prices, eq(prices.id, subscriptions.priceId))
      .where(sql`${subscriptions.billingStatus} IN ('active','past_due')`);

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

  /**
   * Receita PAGA por mês (caixa) — últimos `months` meses, com gaps preenchidos.
   * NÃO é MRR normalizado (ver getDashboard); a UI rotula como "Receita paga".
   */
  async getMrrTrend(months = 6): Promise<{ label: string; cents: number }[]> {
    const rows = await dbAdmin
      .select({
        ym: sql<string>`to_char(date_trunc('month', ${invoices.paidAt}), 'YYYY-MM')`,
        cents: sql<string>`COALESCE(SUM(${invoices.totalAmount}), 0)`,
      })
      .from(invoices)
      .where(
        sql`${invoices.status} = 'paid' AND ${invoices.paidAt} >= date_trunc('month', now()) - make_interval(months => ${months - 1})`,
      )
      .groupBy(sql`date_trunc('month', ${invoices.paidAt})`);

    const byYm = new Map(rows.map((r) => [r.ym, toCents(r.cents)]));
    const MON = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const now = new Date();
    const out: { label: string; cents: number }[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      out.push({ label: MON[d.getMonth()]!, cents: byYm.get(ym) ?? 0 });
    }
    return out;
  }

  /** Distribuição de clínicas por bucket de status (para o donut). */
  async getStatusBreakdown(): Promise<{
    active: number;
    trial: number;
    atRisk: number;
    cancelled: number;
  }> {
    const [r] = await dbAdmin
      .select({
        active: sql<number>`(COUNT(*) FILTER (WHERE ${clinics.status} = 'active'))::int`,
        trial: sql<number>`(COUNT(*) FILTER (WHERE ${clinics.status} = 'trial'))::int`,
        atRisk: sql<number>`(COUNT(*) FILTER (WHERE ${clinics.status} IN ('suspended_readonly','suspended','pending_payment')))::int`,
        cancelled: sql<number>`(COUNT(*) FILTER (WHERE ${clinics.status} = 'cancelled'))::int`,
      })
      .from(clinics)
      .where(isNull(clinics.deletedAt));
    return {
      active: int(r?.active),
      trial: int(r?.trial),
      atRisk: int(r?.atRisk),
      cancelled: int(r?.cancelled),
    };
  }

  /** Série diária (N dias): usuários ativos (audit) + custo Gemini (ai_messages). */
  async getDailyTrends(days = 14): Promise<{ users: number; costUsd: number }[]> {
    const act = await dbAdmin
      .select({
        d: sql<string>`to_char(date_trunc('day', ${auditEvents.createdAt}), 'YYYY-MM-DD')`,
        n: sql<number>`(COUNT(DISTINCT ${auditEvents.userId}))::int`,
      })
      .from(auditEvents)
      .where(sql`${auditEvents.createdAt} >= now() - make_interval(days => ${days})`)
      .groupBy(sql`date_trunc('day', ${auditEvents.createdAt})`);
    const cost = await dbAdmin
      .select({
        d: sql<string>`to_char(date_trunc('day', ${aiMessages.createdAt}), 'YYYY-MM-DD')`,
        c: sql<string>`COALESCE(SUM(${aiMessages.costUsd}), 0)`,
      })
      .from(aiMessages)
      .where(sql`${aiMessages.createdAt} >= now() - make_interval(days => ${days})`)
      .groupBy(sql`date_trunc('day', ${aiMessages.createdAt})`);

    const usersBy = new Map(act.map((r) => [r.d, int(r.n)]));
    const costBy = new Map(cost.map((r) => [r.d, Number(r.c ?? 0)]));
    const now = new Date();
    const out: { users: number; costUsd: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const dt = new Date(now.getTime() - i * 86_400_000);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      out.push({ users: usersBy.get(key) ?? 0, costUsd: costBy.get(key) ?? 0 });
    }
    return out;
  }

  /** Top clínicas por custo de IA (30 dias) — tabela de Métricas. */
  async getTopAiConsumers(
    limit = 5,
  ): Promise<{ nome: string; conversations: number; messages: number; costUsd: number }[]> {
    const msgRows = await dbAdmin
      .select({
        clinicId: aiMessages.clinicId,
        messages: sql<number>`(COUNT(*))::int`,
        cost: sql<string>`COALESCE(SUM(${aiMessages.costUsd}), 0)`,
      })
      .from(aiMessages)
      .where(sql`${aiMessages.createdAt} >= now() - interval '30 days'`)
      .groupBy(aiMessages.clinicId)
      .orderBy(sql`COALESCE(SUM(${aiMessages.costUsd}), 0) DESC`)
      .limit(limit);

    const ids = msgRows.map((r) => r.clinicId).filter((x): x is string => !!x);
    if (ids.length === 0) return [];

    const convRows = await dbAdmin
      .select({ clinicId: aiConversations.clinicId, n: sql<number>`(COUNT(*))::int` })
      .from(aiConversations)
      .where(
        and(
          inArray(aiConversations.clinicId, ids),
          sql`${aiConversations.startedAt} >= now() - interval '30 days'`,
        ),
      )
      .groupBy(aiConversations.clinicId);
    const nameRows = await dbAdmin
      .select({ id: clinics.id, nome: clinics.nome })
      .from(clinics)
      .where(inArray(clinics.id, ids));

    const convBy = new Map(convRows.map((r) => [r.clinicId, int(r.n)]));
    const nameBy = new Map(nameRows.map((r) => [r.id, r.nome]));
    return msgRows.map((r) => ({
      nome: nameBy.get(r.clinicId!) ?? '—',
      conversations: convBy.get(r.clinicId!) ?? 0,
      messages: int(r.messages),
      costUsd: Number(r.cost ?? 0),
    }));
  }
}

export const adminMetricsRepository = new AdminMetricsRepository();
