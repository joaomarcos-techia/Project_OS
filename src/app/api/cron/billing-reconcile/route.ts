/**
 * GET /api/cron/billing-reconcile (C13 — ADR-025). Diário. Webhook é rápido mas
 * pode falhar/perder; o reconcile é a VERDADE do pagamento: busca o estado no
 * Asaas e corrige divergências locais. Grava billing_reconciliation_runs (F8).
 *
 * Primeiro materializa cobranças que o Asaas gerou para assinaturas locais. Isso
 * cobre a perda de `PAYMENT_CREATED`: sem invoice local, o reconcile antigo não
 * tinha um id para consultar e uma cobrança pós-trial nunca era observada.
 * Depois revisita invoices abertas/vencidas cujo pagamento já está
 * RECEIVED/CONFIRMED. Sem dados Asaas (dev), os scans são no-op.
 */
import { and, desc, inArray, isNotNull, sql } from 'drizzle-orm';

import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { dbAdmin } from '@/lib/db';
import { withCron } from '@/lib/http/cron';
import { metrics } from '@/lib/observability/metrics';

import { asaasProvider } from '@/contexts/billing/internal/providers/asaas';
import {
  ensureInvoiceForPayment,
  markInvoiceOverdue,
  markInvoicePaid,
  markInvoiceRefunded,
} from '@/contexts/billing/internal/subscriptions';
import {
  billingReconciliationRuns,
  invoices,
  subscriptions,
  type InvoiceRow,
} from '@/contexts/billing/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PAID_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);
const RECONCILE_SUBSCRIPTION_LIMIT = 50;
type ReconciliationAction = 'paid' | 'overdue' | 'refunded';
type MaterializationResult = {
  materialized: boolean;
  action: ReconciliationAction | null;
};

function actionFor(status: string): ReconciliationAction | null {
  if (PAID_STATUSES.has(status)) return 'paid';
  if (status === 'OVERDUE') return 'overdue';
  if (status === 'REFUNDED') return 'refunded';
  return null;
}

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
      // O Asaas cria as cobranças de uma assinatura autonomamente. Se o webhook
      // `PAYMENT_CREATED` falhar, não existe invoice local e o loop abaixo não
      // consegue sequer descobrir o paymentId. Consulta-se a origem autorizada
      // por subscription e materializa-se a cobrança antes de reconciliar status.
      const providerSubscriptions = await dbAdmin
        .select({
          clinicId: subscriptions.clinicId,
          asaasSubscriptionId: subscriptions.asaasSubscriptionId,
        })
        .from(subscriptions)
        .where(
          and(
            isNotNull(subscriptions.asaasSubscriptionId),
            inArray(subscriptions.billingStatus, ['trial', 'active', 'past_due']),
          ),
        )
        .orderBy(desc(subscriptions.updatedAt))
        .limit(RECONCILE_SUBSCRIPTION_LIMIT);

      let subscriptionsScanned = 0;
      let paymentsChecked = 0;
      for (const subscription of providerSubscriptions) {
        const asaasSubscriptionId = subscription.asaasSubscriptionId;
        if (!asaasSubscriptionId) continue;

        let payments;
        try {
          // Uma tentativa preserva o orçamento do cron. A próxima execução
          // diária continua sendo o backstop para indisponibilidade do Asaas.
          payments = await asaasProvider.listSubscriptionPayments(asaasSubscriptionId, {
            attempts: 1,
          });
          subscriptionsScanned++;
        } catch (err) {
          metrics.emit('billing.reconcile.subscription_provider_error', {
            asaasSubscriptionId,
            error: err,
          });
          continue;
        }

        for (const payment of payments) {
          try {
            const result = await dbAdmin.transaction(async (tx): Promise<MaterializationResult> => {
              const invoice = await ensureInvoiceForPayment(tx, payment);
              if (!invoice) return { materialized: false, action: null };

              switch (actionFor(payment.status)) {
                case 'paid':
                  if (invoice.status !== 'paid') {
                    await markInvoicePaid(tx, subscription.clinicId, invoice, {
                      paymentMethod: payment.billingType,
                      providerPaymentId: payment.paymentId,
                      idemSuffix: `reconcile:subscription:${payment.paymentId}`,
                    });
                    return { materialized: true, action: 'paid' as const };
                  }
                  break;
                case 'overdue':
                  if (invoice.status === 'open') {
                    await markInvoiceOverdue(tx, subscription.clinicId, invoice, {
                      providerPaymentId: payment.paymentId,
                      idemSuffix: `reconcile:subscription:${payment.paymentId}`,
                      daysOverdue: 0,
                    });
                  }
                  break;
                case 'refunded':
                  if (invoice.status === 'paid') {
                    await markInvoiceRefunded(tx, subscription.clinicId, invoice, {
                      providerPaymentId: payment.paymentId,
                      idemSuffix: `reconcile:subscription:${payment.paymentId}`,
                    });
                  }
                  break;
                default:
                  break;
              }
              return { materialized: true, action: null };
            });
            if (!result.materialized) continue;
            paymentsChecked++;
            if (result.action === 'paid') {
              found++;
              fixed++;
            }
          } catch (err) {
            metrics.emit('billing.reconcile.materialize_error', {
              asaasSubscriptionId,
              paymentId: payment.paymentId,
              error: err,
            });
          }
        }
      }

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
      metrics.emit('billing.reconcile.run', {
        scanned: rows.length,
        subscriptionsScanned,
        paymentsChecked,
        found,
        fixed,
      });
      await recordHeartbeat('billing-reconcile', 'success', {
        subscriptionsScanned,
        paymentsChecked,
        found,
        fixed,
      });
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
