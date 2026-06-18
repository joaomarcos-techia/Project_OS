/**
 * GET /api/cron/billing-reconcile (C13 — ADR-025). Diário. Webhook é rápido mas
 * pode falhar/perder; o reconcile é a VERDADE do pagamento: busca o estado no
 * Asaas e corrige divergências locais. Grava billing_reconciliation_runs (F8).
 *
 * Foco MVP: invoices com asaas_payment_id ainda 'open'/'overdue' cujo pagamento
 * no Asaas já está RECEIVED/CONFIRMED → marca paga (mesma transição idempotente
 * do webhook). Sem dados Asaas (dev), o scan é no-op (0 divergências).
 */
import { and, inArray, isNotNull, sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { assertCronRuntimeReady, env } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';

import { asaasProvider } from '@/contexts/billing/internal/providers/asaas';
import { markInvoicePaid } from '@/contexts/billing/internal/subscriptions';
import { billingReconciliationRuns, invoices, type InvoiceRow } from '@/contexts/billing/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PAID_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);

function isAuthorized(req: Request): boolean {
  if (req.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) return false;
  const hasOriginHeader =
    req.headers.get('x-vercel-cron') !== null ||
    req.headers.get('x-vercel-cron-schedule') !== null;
  const allowNonVercel =
    process.env.OUTBOX_CRON_ALLOW_NON_VERCEL === 'true' || env.NODE_ENV !== 'production';
  if (!hasOriginHeader && !allowNonVercel) {
    metrics.emit('cron.origin_header_missing', { route: 'billing-reconcile' });
  }
  return true;
}

export async function GET(req: Request): Promise<Response> {
  assertCronRuntimeReady();
  if (!isAuthorized(req)) {
    metrics.emit('cron.unauthorized', { route: 'billing-reconcile' });
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const [run] = await dbAdmin
    .insert(billingReconciliationRuns)
    .values({})
    .returning({ id: billingReconciliationRuns.id });

  let found = 0;
  let fixed = 0;
  try {
    const rows = (await dbAdmin
      .select()
      .from(invoices)
      .where(and(isNotNull(invoices.asaasPaymentId), inArray(invoices.status, ['open', 'overdue'])))
      .limit(200)) as InvoiceRow[];

    for (const inv of rows) {
      let providerStatus: string;
      try {
        const p = await asaasProvider.getPayment(inv.asaasPaymentId!);
        providerStatus = p.status;
      } catch (err) {
        metrics.emit('billing.reconcile.provider_error', { invoiceId: inv.id, error: err });
        continue; // não trava a run por um pagamento inacessível
      }
      if (!PAID_STATUSES.has(providerStatus)) continue;
      found++;
      // dbAdmin (service_role): markInvoicePaid → setClinicAccess escreve
      // clinics.status (write privilegiado — D31). withTenant seria bloqueado.
      await dbAdmin.transaction(async (tx) => {
        await markInvoicePaid(tx, inv.clinicId, inv, {
          paymentMethod: inv.paymentMethod ?? null,
          providerPaymentId: inv.asaasPaymentId,
          idemSuffix: `reconcile:${inv.id}`,
        });
      });
      fixed++;
    }

    await dbAdmin
      .update(billingReconciliationRuns)
      .set({ finishedAt: sql`now()`, foundDivergences: found, fixedCount: fixed })
      .where(sql`id = ${run!.id}`);

    metrics.emit('billing.reconcile.run', { scanned: 0, found, fixed });
    return Response.json({ ok: true, found, fixed }, { status: 200 });
  } catch (err) {
    await dbAdmin
      .update(billingReconciliationRuns)
      .set({ finishedAt: sql`now()`, foundDivergences: found, fixedCount: fixed })
      .where(sql`id = ${run!.id}`);
    metrics.emit('billing.reconcile.error', { error: err });
    return Response.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
