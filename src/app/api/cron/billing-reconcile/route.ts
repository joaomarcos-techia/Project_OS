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
import { and, desc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';

import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { dbAdmin } from '@/lib/db';
import { withCron } from '@/lib/http/cron';
import { metrics } from '@/lib/observability/metrics';

import { asaasProvider, BillingProviderError } from '@/contexts/billing/internal/providers/asaas';
import { applyScheduledPlanChange } from '@/contexts/billing/internal/plan-changes';
import { providerStatusToInvoiceStatus } from '@/contexts/billing/internal/provider-sync';
import {
  ensureInvoiceForPayment,
  markInvoiceOverdue,
  markInvoicePaid,
  markInvoiceRefunded,
  syncInvoiceFromProviderPayment,
} from '@/contexts/billing/internal/subscriptions';
import {
  billingReconciliationRuns,
  invoices,
  prices,
  subscriptionChangeRequests,
  subscriptions,
  type InvoiceRow,
} from '@/contexts/billing/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PAID_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);
const RECONCILE_SUBSCRIPTION_LIMIT = 50;
const SCHEDULED_PLAN_CHANGE_LIMIT = 50;
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
    let scheduledChangesApplied = 0;
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
              const materialized = await ensureInvoiceForPayment(tx, payment);
              if (!materialized) return { materialized: false, action: null };

              // BILLING-002 — reconcilia data/valor com o estado autoritativo
              // ANTES de transicionar. `ensureInvoiceForPayment` devolve a
              // invoice existente sem olhar nada disso, então uma edição no
              // painel do Asaas ficava divergente indefinidamente. Este caminho
              // é o que cobre a divergência SEM depender de habilitar eventos
              // novos no provedor.
              const synced = await syncInvoiceFromProviderPayment(
                tx,
                subscription.clinicId,
                materialized,
                {
                  exists: true,
                  dueDate: payment.dueDate,
                  totalCents: payment.value === null ? null : Math.round(payment.value * 100),
                  status: providerStatusToInvoiceStatus(payment.status),
                },
                { idemSuffix: `reconcile:subscription:${payment.paymentId}` },
              );
              const invoice = synced.invoice;

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

      // Downgrades e cancelamentos só são efetivados no fim do ciclo. O estado
      // remoto é alterado ANTES do local: se o Asaas falhar, o pedido continua
      // agendado e o próximo cron pode retentá-lo sem cancelar só no app.
      const dueChanges = await dbAdmin
        .select({
          id: subscriptionChangeRequests.id,
          clinicId: subscriptionChangeRequests.clinicId,
          kind: subscriptionChangeRequests.kind,
          asaasSubscriptionId: subscriptions.asaasSubscriptionId,
          targetAmount: prices.amount,
        })
        .from(subscriptionChangeRequests)
        .innerJoin(subscriptions, eq(subscriptions.id, subscriptionChangeRequests.subscriptionId))
        .leftJoin(prices, eq(prices.id, subscriptionChangeRequests.toPriceId))
        .where(
          and(
            inArray(subscriptionChangeRequests.kind, ['downgrade', 'cancellation']),
            eq(subscriptionChangeRequests.status, 'scheduled'),
            lte(subscriptionChangeRequests.effectiveAt, sql`now()`),
          ),
        )
        .orderBy(subscriptionChangeRequests.effectiveAt)
        .limit(SCHEDULED_PLAN_CHANGE_LIMIT);

      for (const change of dueChanges) {
        try {
          if (!change.asaasSubscriptionId) {
            throw new Error('scheduled subscription change has no Asaas subscription id');
          }
          if (change.kind === 'downgrade') {
            const [active] = await dbAdmin.execute<{ active_users: number }>(sql`
              SELECT count(*)::int AS active_users
                FROM public.profiles
               WHERE clinic_id = ${change.clinicId}::uuid
                 AND ativo = true
                 AND deleted_at IS NULL
            `);
            if (Number(active?.active_users ?? 0) !== 1) {
              metrics.emit('billing.plan_change.blocked_active_users', { changeId: change.id });
              continue;
            }
            if (change.targetAmount === null) {
              throw new Error('scheduled downgrade has no target amount');
            }
            await asaasProvider.updateSubscription(change.asaasSubscriptionId, {
              value: Number(change.targetAmount),
              updatePendingPayments: false,
            });
          } else {
            // Preserva a recorrência no Asaas como INACTIVE; a reativação
            // posterior restaura ACTIVE sem recolher PAN/CVV novamente.
            await asaasProvider.updateSubscription(change.asaasSubscriptionId, {
              status: 'INACTIVE',
              updatePendingPayments: false,
            });
          }
          const result = await dbAdmin.transaction((tx) => applyScheduledPlanChange(tx, change.id));
          if (result.applied) scheduledChangesApplied++;
        } catch (err) {
          metrics.emit('billing.plan_change.apply_error', { changeId: change.id, error: err });
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
        let payment: Awaited<ReturnType<typeof asaasProvider.getPayment>> | null = null;
        try {
          payment = await asaasProvider.getPayment(inv.asaasPaymentId!);
        } catch (err) {
          // BILLING-002 — 404 aqui é o backstop diário para uma cobrança
          // EXCLUÍDA no painel: sem ele a invoice ficava `open` para sempre e o
          // dunning perseguia algo que não existe mais. Qualquer outro erro
          // continua sendo indisponibilidade — a próxima run tenta de novo.
          const deleted = err instanceof BillingProviderError && err.httpStatus === 404;
          if (!deleted) {
            metrics.emit('billing.reconcile.provider_error', { invoiceId: inv.id, error: err });
            continue; // não trava a run por um pagamento inacessível
          }
          found++;
          const outcome = await dbAdmin.transaction((tx) =>
            syncInvoiceFromProviderPayment(
              tx,
              inv.clinicId,
              inv,
              { exists: false },
              { idemSuffix: `reconcile:${inv.id}`, providerConfirmedMissing: true },
            ),
          );
          if (outcome.action.kind !== 'noop') fixed++;
          continue;
        }

        // Reconcilia data/valor mesmo quando não há transição a fazer.
        const synced = await dbAdmin.transaction((tx) =>
          syncInvoiceFromProviderPayment(
            tx,
            inv.clinicId,
            inv,
            {
              exists: true,
              dueDate: payment!.dueDate,
              totalCents: payment!.value === null ? null : Math.round(payment!.value * 100),
              status: providerStatusToInvoiceStatus(payment!.status),
            },
            { idemSuffix: `reconcile:${inv.id}` },
          ),
        );
        if (synced.action.kind === 'update') {
          found++;
          fixed++;
        }

        if (!PAID_STATUSES.has(payment.status)) continue;
        found++;
        // dbAdmin (service_role): markInvoicePaid → setClinicAccess escreve
        // clinics.status (write privilegiado — D31). withTenant seria bloqueado.
        await dbAdmin.transaction(async (tx) => {
          await markInvoicePaid(tx, inv.clinicId, synced.invoice, {
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
        scheduledChangesApplied,
        found,
        fixed,
      });
      await recordHeartbeat('billing-reconcile', 'success', {
        subscriptionsScanned,
        paymentsChecked,
        scheduledChangesApplied,
        found,
        fixed,
      });
      return Response.json({ ok: true, found, fixed, scheduledChangesApplied }, { status: 200 });
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
