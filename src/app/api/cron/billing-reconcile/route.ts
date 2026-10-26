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
import { and, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';

import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { withCron } from '@/lib/http/cron';
import { metrics } from '@/lib/observability/metrics';

import { asaasProvider, BillingProviderError } from '@/lib/payments/asaas';
import { removeSubscriptionCharges } from '@/contexts/billing/internal/cancellation-charges';
import { reopenReactivatedClinics } from '@/contexts/billing/internal/clinic-status';
import {
  applyPaidUpgradeForPayment,
  applyScheduledPlanChange,
  confirmCycleChangeProviderSync,
  expireStaleUpgradeCheckoutLeases,
  fitsPlanUserLimit,
  getCycleChangeSyncContext,
  getPaidUpgradeSyncContext,
  planChangeExternalReference,
  prepareScheduledCycleForPaidInvoice,
} from '@/contexts/billing/internal/plan-changes';
import { syncProviderBillingCycle } from '@/contexts/billing/internal/billing-cycle-provider-sync';
import { syncProviderPlanChange } from '@/contexts/billing/internal/plan-change-provider-sync';
import { providerStatusToInvoiceStatus } from '@/contexts/billing/internal/provider-sync';
import {
  ensureInvoiceForPayment,
  advancePaidCycleChangeInvoicePeriod,
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
const PENDING_UPGRADE_LIMIT = 50;
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
      const uncertainCheckouts = await dbAdmin.transaction((tx) =>
        expireStaleUpgradeCheckoutLeases(tx, new Date()),
      );
      if (uncertainCheckouts > 0) {
        metrics.emit('billing.upgrade.checkout_creation_unknown', { count: uncertainCheckouts });
      }

      // Retoma uma falha/timeout entre a intenção local e o readback remoto.
      // Roda antes de materializar pagamentos para que o webhook perdido de uma
      // parcela anual não seja contabilizado como renovação mensal.
      const pendingCycleSync = await dbAdmin
        .select({
          id: subscriptionChangeRequests.id,
          clinicId: subscriptionChangeRequests.clinicId,
        })
        .from(subscriptionChangeRequests)
        .where(
          and(
            eq(subscriptionChangeRequests.kind, 'cycle_change'),
            eq(subscriptionChangeRequests.status, 'scheduled'),
            isNull(subscriptionChangeRequests.providerSyncedAt),
          ),
        )
        .limit(SCHEDULED_PLAN_CHANGE_LIMIT);
      for (const change of pendingCycleSync) {
        try {
          const context = await getCycleChangeSyncContext(change.clinicId, change.id);
          await syncProviderBillingCycle(asaasProvider, context);
          await withTenant(change.clinicId, (tx) =>
            confirmCycleChangeProviderSync(tx, change.clinicId, change.id),
          );
        } catch (error) {
          metrics.emit('billing.cycle_change.provider_sync_error', { changeId: change.id, error });
        }
      }

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
                    const cycle = invoice.subscriptionId
                      ? await prepareScheduledCycleForPaidInvoice(
                          tx,
                          subscription.clinicId,
                          {
                            subscriptionId: invoice.subscriptionId,
                            dueDate: invoice.dueDate,
                            totalAmount: invoice.totalAmount,
                          },
                          payment.billingType,
                        )
                      : { deferPeriodAdvance: false };
                    await markInvoicePaid(tx, subscription.clinicId, invoice, {
                      paymentMethod: payment.billingType,
                      providerPaymentId: payment.paymentId,
                      idemSuffix: `reconcile:subscription:${payment.paymentId}`,
                      deferPeriodAdvance: cycle.deferPeriodAdvance,
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
          subscriptionId: subscriptions.id,
          kind: subscriptionChangeRequests.kind,
          toPlanId: subscriptionChangeRequests.toPlanId,
          effectiveAt: subscriptionChangeRequests.effectiveAt,
          asaasSubscriptionId: subscriptions.asaasSubscriptionId,
          targetAmount: prices.amount,
          targetBillingCycle: prices.billingCycle,
          previousAmount: sql<string>`(SELECT amount FROM public.prices WHERE id = ${subscriptions.priceId})`,
          previousBillingCycle: sql<
            'monthly' | 'annual'
          >`(SELECT billing_cycle FROM public.prices WHERE id = ${subscriptions.priceId})`,
        })
        .from(subscriptionChangeRequests)
        .innerJoin(subscriptions, eq(subscriptions.id, subscriptionChangeRequests.subscriptionId))
        .leftJoin(prices, eq(prices.id, subscriptionChangeRequests.toPriceId))
        .where(
          and(
            inArray(subscriptionChangeRequests.kind, ['downgrade', 'cancellation', 'cycle_change']),
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
            const [capacity] = await dbAdmin.execute<{
              active_users: number;
              user_limit: number | null;
              active_doctors: number;
              active_staff: number;
              doctor_limit: number | null;
              staff_limit: number | null;
            }>(sql`
              SELECT (SELECT count(*)::int FROM public.profiles
                       WHERE clinic_id = ${change.clinicId}::uuid
                         AND ativo = true AND deleted_at IS NULL
                         AND role <> 'super_admin') AS active_users,
                     (SELECT limit_value FROM public.plan_limits
                       WHERE plan_id = ${change.toPlanId}::uuid AND metric = 'users') AS user_limit,
                     (SELECT count(*)::int FROM public.profiles
                       WHERE clinic_id = ${change.clinicId}::uuid AND ativo = true
                         AND deleted_at IS NULL AND role <> 'super_admin'
                         AND (role = 'doctor' OR (role IN ('owner', 'gestor')
                           AND nullif(btrim(crm), '') IS NOT NULL))) AS active_doctors,
                     (SELECT count(*)::int FROM public.profiles
                       WHERE clinic_id = ${change.clinicId}::uuid AND ativo = true
                         AND deleted_at IS NULL AND role <> 'super_admin'
                         AND role <> 'doctor' AND NOT (role IN ('owner', 'gestor')
                           AND nullif(btrim(crm), '') IS NOT NULL)) AS active_staff,
                     (SELECT doctors FROM public.plan_seat_limits
                       WHERE plan_id = ${change.toPlanId}::uuid) AS doctor_limit,
                     (SELECT staff FROM public.plan_seat_limits
                       WHERE plan_id = ${change.toPlanId}::uuid) AS staff_limit
            `);
            if (
              !fitsPlanUserLimit(
                Number(capacity?.active_users ?? 0),
                capacity?.user_limit ?? null,
              ) ||
              (capacity?.doctor_limit != null &&
                Number(capacity.active_doctors) > capacity.doctor_limit) ||
              (capacity?.staff_limit != null &&
                Number(capacity.active_staff) > capacity.staff_limit)
            ) {
              metrics.emit('billing.plan_change.blocked_active_users', { changeId: change.id });
              continue;
            }
            if (change.targetAmount === null || !change.previousAmount || !change.toPlanId) {
              throw new Error('scheduled downgrade has no target amount');
            }
            await syncProviderPlanChange(asaasProvider, {
              subscriptionId: change.asaasSubscriptionId,
              previousAmount: change.previousAmount,
              amount: change.targetAmount,
              firstDueDate: change.effectiveAt.toISOString().slice(0, 10),
              expectedCycle: change.targetBillingCycle === 'annual' ? 'YEARLY' : 'MONTHLY',
            });
          } else if (change.kind === 'cycle_change') {
            if (
              change.targetAmount === null ||
              !change.previousAmount ||
              !change.targetBillingCycle
            ) {
              throw new Error('scheduled cycle change has no target price');
            }
            await syncProviderBillingCycle(asaasProvider, {
              subscriptionId: change.asaasSubscriptionId,
              previousAmount: change.previousAmount,
              amount: change.targetAmount,
              firstDueDate: change.effectiveAt.toISOString().slice(0, 10),
              fromCycle: change.previousBillingCycle === 'annual' ? 'YEARLY' : 'MONTHLY',
              toCycle: change.targetBillingCycle === 'annual' ? 'YEARLY' : 'MONTHLY',
            });
            await withTenant(change.clinicId, (tx) =>
              confirmCycleChangeProviderSync(tx, change.clinicId, change.id),
            );
          } else {
            // O pedido já pausou a recorrência e apagou as cobranças no Asaas.
            // Aqui é o backstop: repete os dois (idempotentes) e só aplica o
            // cancelamento local se a releitura provar que não sobrou cobrança.
            // Antes, este ponto só pausava — e a parcela que vencia HOJE, criada
            // 40 dias antes, continuava viva e era cobrada.
            const removal = await removeSubscriptionCharges(asaasProvider, {
              asaasSubscriptionId: change.asaasSubscriptionId,
              extraPaymentIds: [],
            });
            if (!removal.ok) {
              metrics.emit('billing.plan_change.cancellation_charges_pending', {
                changeId: change.id,
                reason: removal.reason,
              });
              continue;
            }
          }
          const result = await dbAdmin.transaction(async (tx) => {
            const applied = await applyScheduledPlanChange(tx, change.id);
            if (applied.applied && applied.kind === 'cycle_change' && change.targetAmount) {
              await advancePaidCycleChangeInvoicePeriod(
                tx,
                change.clinicId,
                change.subscriptionId,
                change.effectiveAt.toISOString().slice(0, 10),
                change.targetAmount,
              );
            }
            return applied;
          });
          if (result.applied) scheduledChangesApplied++;
        } catch (err) {
          metrics.emit('billing.plan_change.apply_error', { changeId: change.id, error: err });
        }
      }

      // Backstop de upgrade pago cujo webhook não foi entregue. Sem isto, o
      // rateio fica pago mas a clínica nunca recebe o novo plano.
      const pendingUpgrades = await dbAdmin
        .select({
          id: subscriptionChangeRequests.id,
          providerPaymentId: subscriptionChangeRequests.providerPaymentId,
          providerCheckoutId: subscriptionChangeRequests.providerCheckoutId,
        })
        .from(subscriptionChangeRequests)
        .where(
          and(
            eq(subscriptionChangeRequests.kind, 'upgrade'),
            eq(subscriptionChangeRequests.status, 'pending_payment'),
            or(
              isNotNull(subscriptionChangeRequests.providerPaymentId),
              isNotNull(subscriptionChangeRequests.providerCheckoutId),
            ),
          ),
        )
        .orderBy(subscriptionChangeRequests.createdAt)
        .limit(PENDING_UPGRADE_LIMIT);
      for (const upgrade of pendingUpgrades) {
        try {
          const foundPayment = upgrade.providerPaymentId
            ? await asaasProvider.getPayment(upgrade.providerPaymentId, { attempts: 1 })
            : upgrade.providerCheckoutId
              ? await asaasProvider.findPaymentByCheckoutSession(upgrade.providerCheckoutId, {
                  attempts: 1,
                })
              : null;
          if (!foundPayment) continue;
          const payment = upgrade.providerPaymentId
            ? foundPayment
            : await asaasProvider.getPayment(foundPayment.paymentId, { attempts: 1 });
          if (!PAID_STATUSES.has(payment.status)) continue;
          if (
            payment.externalReference !== planChangeExternalReference(upgrade.id) &&
            payment.checkoutSessionId !== upgrade.providerCheckoutId
          ) {
            throw new Error('paid upgrade payment reference mismatch');
          }
          const syncContext = await dbAdmin.transaction((tx) =>
            getPaidUpgradeSyncContext(tx, payment),
          );
          if (!syncContext) continue;
          await syncProviderPlanChange(asaasProvider, syncContext);
          const applied = await dbAdmin.transaction((tx) =>
            applyPaidUpgradeForPayment(tx, payment, `reconcile:${upgrade.id}`),
          );
          if (applied) {
            found++;
            fixed++;
          }
        } catch (err) {
          metrics.emit('billing.plan_change.upgrade_reconcile_error', {
            changeId: upgrade.id,
            error: err,
          });
        }
      }

      // Clínicas que ficaram fechadas depois de uma reativação (a reabertura
      // imediata roda após o commit e pode falhar). Pagas e bloqueadas não.
      try {
        const reopened = await reopenReactivatedClinics();
        if (reopened > 0) metrics.emit('billing.reactivation.reopened_by_cron', { reopened });
      } catch (err) {
        metrics.emit('billing.reactivation.reopen_cron_error', { error: err });
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
