/**
 * Provisionamento de tenant (C13 — ADR-025 F1/F2). Saga: checkout_session (lead,
 * sem clínica) → provisiona clínica `pending_payment` (com expiração) → billing_customer
 * → subscription trial. NÃO cria usuário (F2): emite billing.subscription.activated;
 * Identity cria o owner (seam, ativado no onboarding).
 *
 * Recebe `tx` (boundaries: o contexto nunca importa dbAdmin). O entrypoint
 * allowlisted (script de onboarding interino / futura rota /checkout) abre
 * dbAdmin.transaction e chama aqui. As chamadas Asaas (HTTP) acontecem ANTES,
 * no entrypoint (idempotency_key salvo na sessão antes da chamada externa — G6);
 * os ids do Asaas chegam por parâmetro.
 */
import { eq, sql } from 'drizzle-orm';

import { encryptForTenant } from '@/lib/crypto';
import type { Tx } from '@/lib/db';
import { publishEvent } from '@/lib/outbox/publish';

import type { PlanCode } from '../api';
import { BILLING_EVENTS } from '../events';
import {
  billingCustomers,
  checkoutSessions,
  prices,
  subscriptions,
  tenantProvisioning,
} from '../schema';
import { recordBillingEvent } from './subscriptions';

export interface ProvisionInput {
  checkoutSessionId: string;
  slug: string;
  clinicName: string;
  planId: string;
  planCode: PlanCode;
  priceId: string;
  billingCycle: 'monthly' | 'annual';
  customerName: string;
  email: string;
  document?: string | null;
  phone?: string | null;
  asaasCustomerId?: string | null;
  asaasSubscriptionId?: string | null;
  trialDays: number;
}

/** Provisiona a clínica (pending_payment) + customer + subscription trial. Idempotente. */
export async function provisionTenant(
  tx: Tx,
  input: ProvisionInput,
): Promise<{ clinicId: string }> {
  await tx
    .insert(tenantProvisioning)
    .values({ checkoutSessionId: input.checkoutSessionId, status: 'provisioning', step: 'clinic' })
    .onConflictDoNothing();

  // 1. Clínica em pending_payment (login bloqueado até o 1º pagamento — ADR-016).
  const clinicRows = (await tx.execute(
    sql`INSERT INTO clinics (slug, nome, status)
        VALUES (${input.slug}, ${input.clinicName}, 'pending_payment'::clinic_status)
        ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome
        RETURNING id::text AS id`,
  )) as unknown as Array<{ id: string }>;
  const clinicId = clinicRows[0]!.id;

  await tx
    .update(tenantProvisioning)
    .set({ clinicId, step: 'customer', updatedAt: sql`now()` })
    .where(eq(tenantProvisioning.checkoutSessionId, input.checkoutSessionId));
  await tx
    .update(checkoutSessions)
    .set({ clinicId, status: 'completed' })
    .where(eq(checkoutSessions.id, input.checkoutSessionId));

  // 2. Billing customer (1 por clínica).
  const [cust] = await tx
    .insert(billingCustomers)
    .values({
      clinicId,
      name: input.customerName,
      email: input.email,
      // A8: document cifrado per-tenant (mesmo padrão da saga).
      documentEncrypted: input.document ? await encryptForTenant(clinicId, input.document) : null,
      phone: input.phone ?? null,
      asaasCustomerId: input.asaasCustomerId ?? null,
    })
    .onConflictDoNothing({ target: billingCustomers.clinicId })
    .returning({ id: billingCustomers.id });
  if (cust) {
    await publishEvent(tx, {
      clinicId,
      eventType: BILLING_EVENTS.CUSTOMER_CREATED,
      payload: {
        clinicId,
        billingCustomerId: cust.id,
        asaasCustomerId: input.asaasCustomerId ?? null,
      },
      idempotencyKey: `customer-created:${clinicId}`,
    });
  }

  // 3. Subscription trial (preço resolvido no backend — nunca do frontend).
  const [price] = await tx
    .select({ amount: prices.amount })
    .from(prices)
    .where(eq(prices.id, input.priceId))
    .limit(1);
  const trialEnds = new Date(Date.now() + input.trialDays * 86_400_000);
  const [sub] = await tx
    .insert(subscriptions)
    .values({
      clinicId,
      planId: input.planId,
      priceId: input.priceId,
      billingStatus: 'trial',
      trialEndsAt: trialEnds,
      currentPeriodStart: new Date(),
      currentPeriodEnd: trialEnds,
      asaasSubscriptionId: input.asaasSubscriptionId ?? null,
    })
    .onConflictDoNothing({ target: subscriptions.clinicId })
    .returning({ id: subscriptions.id });

  if (sub) {
    await publishEvent(tx, {
      clinicId,
      eventType: BILLING_EVENTS.SUBSCRIPTION_CREATED,
      payload: {
        clinicId,
        subscriptionId: sub.id,
        planCode: input.planCode,
        priceAmount: Number(price?.amount ?? 0),
        billingCycle: input.billingCycle,
      },
      idempotencyKey: `subscription-created:${clinicId}`,
    });
    await publishEvent(tx, {
      clinicId,
      eventType: BILLING_EVENTS.TRIAL_STARTED,
      payload: { clinicId, subscriptionId: sub.id, trialEndsAt: trialEnds.toISOString() },
      idempotencyKey: `trial-started:${clinicId}`,
    });
    await recordBillingEvent(tx, clinicId, 'subscription.created', {
      subscriptionId: sub.id,
      planCode: input.planCode,
    });
  }

  await tx
    .update(tenantProvisioning)
    .set({ status: 'ready', step: 'subscription', updatedAt: sql`now()` })
    .where(eq(tenantProvisioning.checkoutSessionId, input.checkoutSessionId));

  return { clinicId };
}
