/**
 * Saga de provisionamento (F1 · ADR-027). Cria a clínica `trial` + owner + config
 * a partir de um convite concluído. SERVER-ONLY.
 *
 * Por que saga, não mega-tx: o Asaas (HTTP) roda FORA de qualquer transação DB. A
 * action faz, NESTA ordem (idempotência + compensação):
 *   1. Asaas: createCustomer + createSubscriptionWithCard  (ids gravados ANTES do tenant)
 *   2. Supabase admin: cria o usuário owner                 (externo, antes da tx)
 *   3. dbAdmin.transaction → provisionTenantFromInviteTx     (tudo atômico aqui)
 * Se (3) falha tendo (1) criado a assinatura, a action chama o cancelamento Asaas
 * (compensação) — nunca fica cobrança órfã. Trial mora no BILLING (datas na
 * subscription); a clínica só carrega `trial` de ACESSO (billing ≠ tenant).
 *
 * Boundaries: o onboarding orquestra tenancy+identity+billing+ai. Importa os schemas
 * vizinhos só para escrever de forma type-safe (ADR-027 autoriza explicitamente).
 */
import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import { dbAdmin, type Tx } from '@/lib/db';
import { createAdminClient } from '@/lib/auth/supabase-admin';
import { encryptForTenant, hashForLookup } from '@/lib/crypto';
import { publishEvent } from '@/lib/outbox/publish';

/* eslint-disable boundaries/element-types -- saga de provisionamento: onboarding
   orquestra tenancy+identity+billing+ai (ADR-027). Escrita type-safe via schema. */
import { clinics } from '@/contexts/tenancy/schema';
import { profiles } from '@/contexts/identity/schema';
import { aiClinicConfig } from '@/contexts/ai-agent/schema';
import { billingCustomers, subscriptions } from '@/contexts/billing/schema';
import { BILLING_EVENTS } from '@/contexts/billing/events';
import {
  asaasProvider,
  BillingCircuitOpenError,
  BillingProviderError,
  BillingProviderUnreachableError,
} from '@/contexts/billing/internal/providers/asaas';
/* eslint-enable boundaries/element-types */

import { clinicInvites } from '../schema';

/** Cria o usuário owner no Supabase Auth (externo à tx; senha nunca persistida). */
export async function createOwnerUser(args: {
  email: string;
  password: string;
  nome: string;
}): Promise<{ userId: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: args.email,
    password: args.password,
    email_confirm: true,
    user_metadata: { nome: args.nome },
  });
  if (error || !data.user) {
    throw new OnboardingProvisionError(
      `falha ao criar usuário owner: ${error?.message ?? 'sem usuário'}`,
      'owner_create_failed',
    );
  }
  return { userId: data.user.id };
}

export class OnboardingProvisionError extends Error {
  readonly code: string;
  constructor(message: string, code = 'onboarding_provision_failed') {
    super(message);
    this.name = 'OnboardingProvisionError';
    this.code = code;
  }
}

export interface ProvisionArgs {
  inviteId: string;
  inviteVersion: number;
  clinic: {
    nome: string;
    slug: string;
    cnpj?: string | null;
    telefone?: string | null;
    endereco?: string | null;
  };
  owner: { userId: string; nome: string };
  customer: { name: string; email: string; document?: string | null; phone?: string | null };
  planId: string;
  planCode: string;
  priceId: string;
  priceAmount: number;
  billingCycle: 'monthly' | 'annual';
  trialDays: number;
  asaasCustomerId: string | null;
  asaasSubscriptionId: string | null;
}

/**
 * Escreve TUDO atômico: clínica trial + owner profile + ai_config + billing customer
 * + subscription trial + convite `completed` (guarded por version). Publica os eventos
 * de billing (downstream: quota/dunning/access-resolver). Recebe a `tx` da action.
 */
export async function provisionTenantFromInviteTx(
  tx: Tx,
  args: ProvisionArgs,
): Promise<{ clinicId: string }> {
  // 1. Clínica — nasce `trial` de ACESSO (datas de trial vivem na subscription).
  // A8: id gerado na app para poder cifrar o CNPJ com ele (salt HKDF = id) ANTES
  // do insert — a alternativa (insert→returning→update) faria 2 idas ao banco.
  const clinicId = randomUUID();
  const cnpjRaw = args.clinic.cnpj?.trim() || null;
  await tx.insert(clinics).values({
    id: clinicId,
    slug: args.clinic.slug,
    nome: args.clinic.nome,
    cnpjEncrypted: cnpjRaw ? await encryptForTenant(clinicId, cnpjRaw) : null,
    cnpjHash: cnpjRaw ? await hashForLookup(cnpjRaw) : null,
    endereco: args.clinic.endereco ?? null,
    status: 'trial',
  });

  // 2. Owner profile (id = auth.users.id criado antes da tx). Idempotente em retry.
  await tx
    .insert(profiles)
    .values({
      id: args.owner.userId,
      clinicId,
      nome: args.owner.nome,
      telefone: args.clinic.telefone ?? null,
      role: 'owner',
      ativo: true,
      // Owner nasce ACEITO (não é convite pendente — ADR-032 Fase 2, review #1).
      inviteAcceptedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: profiles.id,
      set: {
        clinicId,
        role: 'owner',
        nome: args.owner.nome,
        ativo: true,
        inviteAcceptedAt: new Date(),
      },
    });

  // 3. Config de IA da clínica (defaults). 1:1 com a clínica.
  await tx
    .insert(aiClinicConfig)
    .values({ clinicId })
    .onConflictDoNothing({ target: aiClinicConfig.clinicId });

  // 4. Billing customer (1 por clínica).
  await tx
    .insert(billingCustomers)
    .values({
      clinicId,
      name: args.customer.name,
      email: args.customer.email,
      // A8: CPF/CNPJ do cliente cifrado per-tenant (write-only — sem read-site).
      documentEncrypted: args.customer.document
        ? await encryptForTenant(clinicId, args.customer.document)
        : null,
      phone: args.customer.phone ?? null,
      asaasCustomerId: args.asaasCustomerId,
    })
    .onConflictDoNothing({ target: billingCustomers.clinicId });

  // 5. Subscription trial — billing controla pagamento; trial_ends_at na subscription.
  const trialEnds = new Date(Date.now() + args.trialDays * 86_400_000);
  const [sub] = await tx
    .insert(subscriptions)
    .values({
      clinicId,
      planId: args.planId,
      priceId: args.priceId,
      billingStatus: 'trial',
      trialEndsAt: trialEnds,
      currentPeriodStart: new Date(),
      currentPeriodEnd: trialEnds,
      asaasSubscriptionId: args.asaasSubscriptionId,
    })
    .onConflictDoNothing({ target: subscriptions.clinicId })
    .returning({ id: subscriptions.id });

  // 6. Convite → completed (guarded por version: a 2ª aba/dupla-submissão perde).
  const [doneInvite] = await tx
    .update(clinicInvites)
    .set({
      status: 'completed',
      completedAt: sql`now()`,
      provisionedClinicId: clinicId,
      version: args.inviteVersion + 1,
    })
    .where(and(eq(clinicInvites.id, args.inviteId), eq(clinicInvites.version, args.inviteVersion)))
    .returning({ id: clinicInvites.id });
  if (!doneInvite) {
    throw new OnboardingProvisionError(
      'convite já concluído/alterado (race)',
      'invite_version_conflict',
    );
  }

  // 7. Eventos de billing (downstream reage: quota, dunning, access-resolver).
  if (sub) {
    await publishEvent(tx, {
      clinicId,
      eventType: BILLING_EVENTS.SUBSCRIPTION_CREATED,
      payload: {
        clinicId,
        subscriptionId: sub.id,
        planCode: args.planCode,
        priceAmount: args.priceAmount,
        billingCycle: args.billingCycle,
      },
      idempotencyKey: `subscription-created:${clinicId}`,
    });
    await publishEvent(tx, {
      clinicId,
      eventType: BILLING_EVENTS.TRIAL_STARTED,
      payload: { clinicId, subscriptionId: sub.id, trialEndsAt: trialEnds.toISOString() },
      idempotencyKey: `trial-started:${clinicId}`,
    });
  }

  return { clinicId };
}

/** Abre a tx dbAdmin e roda o provisionamento (entrypoint da action). */
export async function provisionTenantFromInvite(
  args: ProvisionArgs,
): Promise<{ clinicId: string }> {
  return dbAdmin.transaction((tx) => provisionTenantFromInviteTx(tx, args));
}

/**
 * O gateway pode incluir o request no corpo de um 4xx. A interface recebe uma
 * explicação genérica para que PAN/CVV jamais sejam refletidos em UI, logs ou Sentry.
 */
function asaasReason(): string {
  return 'Não conseguimos validar o cartão. Confira número, validade, CVV e o CPF/CNPJ do titular.';
}

export interface CheckoutArgs {
  invite: { id: string; version: number };
  clinic: {
    nome: string;
    slug: string;
    cnpj?: string | null;
    telefone?: string | null;
    endereco?: string | null;
  };
  owner: { nome: string; email: string };
  /** Senha do gestor — transita só aqui, criar o auth user; nunca persistida. */
  password: string;
  card: {
    number: string;
    holderName: string;
    expiryMonth: string;
    expiryYear: string;
    ccv: string;
  };
  holder: { cpfCnpj: string; postalCode: string; addressNumber: string };
  plan: { planId: string; code: string; priceId: string; amountReais: number; cycle: string };
  trialDays: number;
  remoteIp: string;
}

/**
 * Orquestra o checkout (ordem importa p/ compensação): Asaas customer + assinatura
 * com cartão (cartão só em memória) → owner (Supabase) → provisiona o tenant. Se o
 * provisionamento falha DEPOIS da assinatura criada, cancela a assinatura Asaas
 * (compensação — zero cobrança órfã). Erro 4xx do Asaas (cartão recusado) vira
 * `card_declined` para a UI mostrar o estado de cartão.
 */
export async function runCheckout(a: CheckoutArgs): Promise<{ clinicId: string }> {
  const cycle = a.plan.cycle === 'annual' ? ('YEARLY' as const) : ('MONTHLY' as const);
  const nextDueDate = new Date(Date.now() + a.trialDays * 86_400_000).toISOString().slice(0, 10);
  const description = `Qoro · plano ${a.plan.code} — ${a.clinic.nome}`;
  const phone = a.clinic.telefone ?? null;
  // O Asaas não aceita Idempotency-Key em POST. A referência estável permite
  // localizar uma assinatura que foi criada antes de um timeout de resposta.
  const externalReference = `onboarding:${a.invite.id}`;

  let customerId: string;
  let subscriptionId: string;
  try {
    const existing = await asaasProvider.findSubscriptionByExternalReference(externalReference);
    if (existing) {
      if (!existing.customerId) {
        throw new OnboardingProvisionError(
          'A assinatura anterior do Asaas não trouxe o cliente necessário para reconciliação.',
          'provider_unreachable',
        );
      }
      customerId = existing.customerId;
      subscriptionId = existing.subscriptionId;
    } else {
      const c = await asaasProvider.createCustomer({
        name: a.owner.nome,
        email: a.owner.email,
        cpfCnpj: a.holder.cpfCnpj,
        phone,
      });
      customerId = c.customerId;
      const sub = await asaasProvider.createSubscriptionWithCard({
        customerId,
        value: a.plan.amountReais,
        cycle,
        nextDueDate,
        description,
        externalReference,
        creditCard: {
          holderName: a.card.holderName,
          number: a.card.number,
          expiryMonth: a.card.expiryMonth,
          expiryYear: a.card.expiryYear,
          ccv: a.card.ccv,
        },
        holderInfo: {
          name: a.card.holderName,
          email: a.owner.email,
          cpfCnpj: a.holder.cpfCnpj,
          postalCode: a.holder.postalCode,
          addressNumber: a.holder.addressNumber,
          phone,
        },
        remoteIp: a.remoteIp,
      });
      subscriptionId = sub.subscriptionId;
    }
  } catch (e) {
    // 4xx (cartão/CPF/payload inválido) é definitivo → vira card_declined com a
    // motivo genérico seguro; o corpo do provedor não é confiável para exibição.
    if (e instanceof BillingProviderError) {
      throw new OnboardingProvisionError(asaasReason(), 'card_declined');
    }
    // Timeout/5xx/rede/circuito aberto → indeterminado (não sabemos se o Asaas
    // processou). Nenhuma cobrança garantida; o usuário re-tenta.
    if (e instanceof BillingProviderUnreachableError || e instanceof BillingCircuitOpenError) {
      throw new OnboardingProvisionError(e.message, 'provider_unreachable');
    }
    throw e;
  }

  try {
    const { userId } = await createOwnerUser({
      email: a.owner.email,
      password: a.password,
      nome: a.owner.nome,
    });
    return await provisionTenantFromInvite({
      inviteId: a.invite.id,
      inviteVersion: a.invite.version,
      clinic: a.clinic,
      owner: { userId, nome: a.owner.nome },
      customer: { name: a.owner.nome, email: a.owner.email, document: a.holder.cpfCnpj, phone },
      planId: a.plan.planId,
      planCode: a.plan.code,
      priceId: a.plan.priceId,
      priceAmount: a.plan.amountReais,
      billingCycle: a.plan.cycle === 'annual' ? 'annual' : 'monthly',
      trialDays: a.trialDays,
      asaasCustomerId: customerId,
      asaasSubscriptionId: subscriptionId,
    });
  } catch (e) {
    // Compensação: assinatura criada mas tenant falhou → cancela no Asaas.
    try {
      await asaasProvider.cancelSubscription(subscriptionId);
    } catch {
      /* best-effort; o cron onboarding-reconcile cobre o que falhar aqui. */
    }
    throw e;
  }
}
