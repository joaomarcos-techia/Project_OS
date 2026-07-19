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

import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { dbAdmin } from '@/lib/db';
import { withCron } from '@/lib/http/cron';
import { metrics } from '@/lib/observability/metrics';

import { asaasProvider } from '@/contexts/billing/internal/providers/asaas';
import { markInvoicePaid } from '@/contexts/billing/internal/subscriptions';
import { billingReconciliationRuns, invoices, type InvoiceRow } from '@/contexts/billing/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PAID_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);

export const GET = withCron(
  { job: 'billing-reconcile', route: 'billing-reconcile', errorEvent: 'billing.reconcile.error' },
  async () => {
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
        .where(
          and(isNotNull(invoices.asaasPaymentId), inArray(invoices.status, ['open', 'overdue'])),
        )
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

      if (found > 0) {
        // V3 (auditoria de segurança): o webhook do Asaas é sinal rápido NÃO-
        // autoritativo (sem HMAC de corpo — só token estático). Divergência aqui =
        // o Asaas confirma um pagamento que o webhook NÃO refletiu → evento
        // perdido OU forjado/adulterado. Alarme dedicado para o monitoramento
        // (C16) reagir; a reconciliação diária permanece a fonte da verdade.
        metrics.emit('billing.reconcile.divergence', { found, fixed, runId: run!.id });
      }
      metrics.emit('billing.reconcile.run', { scanned: 0, found, fixed });
      await recordHeartbeat('billing-reconcile', 'success', { found, fixed });
      return Response.json({ ok: true, found, fixed }, { status: 200 });
    } catch (err) {
      // Este catch existe para FECHAR a linha da run (trabalho real, não
      // telemetria) — sem ele a reconciliação ficaria eternamente "em aberto".
      // O `throw` devolve o erro ao withCron, que faz captureBackgroundError +
      // `billing.reconcile.error` + heartbeat + 500. Não emitir aqui: duplicaria
      // o evento.
      await dbAdmin
        .update(billingReconciliationRuns)
        .set({ finishedAt: sql`now()`, foundDivergences: found, fixedCount: fixed })
        .where(sql`id = ${run!.id}`);
      throw err;
    }
  },
);
