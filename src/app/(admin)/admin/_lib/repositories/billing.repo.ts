/**
 * BillingOverviewRepository (C15) — visão read-only de cobrança da plataforma.
 * Único ponto que toca dbAdmin para esta área (review #5/#13).
 *
 * Server-only.
 */
import 'server-only';

import { asc, desc, eq, gt, sql } from 'drizzle-orm';

import { invoices, paymentAttempts, prices, subscriptions } from '@/contexts/billing/schema';
import { clinics } from '@/contexts/tenancy/schema';
import { dbAdmin } from '@/lib/db';

import type { BillingOverviewDTO, InvoiceRowDTO } from '../dto';
import { toCents } from '../format';

const iso = (v: Date | string | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();

export class BillingOverviewRepository {
  async getOverview(): Promise<BillingOverviewDTO> {
    // MRR = receita recorrente normalizada das assinaturas comprometidas
    // (active + past_due; anual → /12). Mesma definição do metrics.repo
    // (getDashboard) — NÃO é soma de faturas pagas no mês (= caixa recebido).
    const [mrrRow] = await dbAdmin
      .select({
        mrr: sql<string>`COALESCE(SUM(CASE WHEN ${prices.billingCycle} = 'annual' THEN ${prices.amount} / 12.0 ELSE ${prices.amount} END), 0)`,
      })
      .from(subscriptions)
      .innerJoin(prices, eq(prices.id, subscriptions.priceId))
      .where(sql`${subscriptions.billingStatus} IN ('active','past_due')`);
    const mrrCents = toCents(mrrRow?.mrr ?? '0');

    const invoiceRows = async (status: 'open' | 'overdue'): Promise<InvoiceRowDTO[]> => {
      const rows = await dbAdmin
        .select({
          id: invoices.id,
          clinicId: invoices.clinicId,
          clinicNome: clinics.nome,
          amount: invoices.totalAmount,
          status: invoices.status,
          dueDate: invoices.dueDate,
          paidAt: invoices.paidAt,
        })
        .from(invoices)
        .innerJoin(clinics, eq(clinics.id, invoices.clinicId))
        .where(eq(invoices.status, status))
        .orderBy(asc(invoices.dueDate))
        .limit(100);
      return rows.map((r) => ({
        id: r.id,
        clinicId: r.clinicId,
        clinicNome: r.clinicNome,
        amountCents: toCents(r.amount),
        status: r.status,
        dueDate: String(r.dueDate),
        paidAt: iso(r.paidAt),
      }));
    };

    const [open, overdue] = await Promise.all([invoiceRows('open'), invoiceRows('overdue')]);

    const dunningRows = await dbAdmin
      .select({
        clinicId: subscriptions.clinicId,
        nome: clinics.nome,
        stage: subscriptions.dunningStage,
      })
      .from(subscriptions)
      .innerJoin(clinics, eq(clinics.id, subscriptions.clinicId))
      .where(gt(subscriptions.dunningStage, 0))
      .orderBy(desc(subscriptions.dunningStage))
      .limit(100);

    const refundRows = await dbAdmin
      .select({
        clinicId: paymentAttempts.clinicId,
        nome: clinics.nome,
        amount: invoices.totalAmount,
        at: paymentAttempts.createdAt,
      })
      .from(paymentAttempts)
      .innerJoin(clinics, eq(clinics.id, paymentAttempts.clinicId))
      .innerJoin(invoices, eq(invoices.id, paymentAttempts.invoiceId))
      .where(eq(paymentAttempts.status, 'refunded'))
      .orderBy(desc(paymentAttempts.createdAt))
      .limit(50);

    return {
      mrrCents,
      arrCents: mrrCents * 12,
      open,
      overdue,
      dunning: dunningRows.map((r) => ({ clinicId: r.clinicId, nome: r.nome, stage: r.stage })),
      refunds: refundRows.map((r) => ({
        clinicId: r.clinicId,
        nome: r.nome,
        amountCents: toCents(r.amount),
        at: iso(r.at)!,
      })),
    };
  }
}

export const billingOverviewRepository = new BillingOverviewRepository();
