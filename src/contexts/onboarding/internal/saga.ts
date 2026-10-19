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
import { metrics } from '@/lib/observability/metrics';
import { publishEvent } from '@/lib/outbox/publish';
import {
  asaasProvider,
  BillingCircuitOpenError,
  BillingProviderError,
  BillingProviderUnreachableError,
} from '@/lib/payments/asaas';

/* eslint-disable boundaries/element-types -- saga de provisionamento: onboarding
   orquestra tenancy+identity+billing+ai (ADR-027). Escrita type-safe via schema. */
import { clinics } from '@/contexts/tenancy/schema';
import { profiles } from '@/contexts/identity/schema';
import { aiClinicConfig } from '@/contexts/ai-agent/schema';
import { billingCustomers, subscriptions } from '@/contexts/billing/schema';
import { BILLING_EVENTS } from '@/contexts/billing/events';
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

/** O que qualquer origem precisa fornecer para um tenant nascer. */
export type TenantSeed = Omit<ProvisionArgs, 'inviteId' | 'inviteVersion'> & {
  /** Cadastro versionado: prazo absoluto ancorado na criação do usuário Auth. */
  trialEndsAt?: Date;
  enforceTrialDeadline?: boolean;
  /** Cadastro depois do trial só chega aqui após readback de pagamento no Asaas. */
  initialBillingStatus?: 'trial' | 'active';
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
};

/**
 * Passo que marca a ORIGEM como consumida, dentro da mesma transação.
 *
 * É aqui que mora a garantia de "tenant nasce uma única vez": cada origem traz
 * seu próprio predicado de vencedor único (convite guardado por `version`,
 * sessão de cadastro removida por `DELETE ... RETURNING`). Se o claim não
 * encontra o que esperava, ele lança e a transação inteira desaparece —
 * incluindo a clínica recém-inserida.
 */
export type ProvisionClaim = (tx: Tx, clinicId: string) => Promise<void>;

/**
 * Escreve TUDO atômico: clínica trial + owner profile + ai_config + billing customer
 * + subscription trial + o claim da origem. Publica os eventos de billing
 * (downstream: quota/dunning/access-resolver). Recebe a `tx` de quem chamou.
 *
 * O claim entra entre a subscription e os eventos, exatamente onde o convite
 * entrava antes da extração: quem perde a disputa não chega a publicar evento.
 */
export async function provisionTenantCoreTx(
  tx: Tx,
  args: TenantSeed,
  claim: ProvisionClaim,
): Promise<{ clinicId: string }> {
  const initialBillingStatus = args.initialBillingStatus ?? 'trial';
  if (initialBillingStatus === 'active' && (!args.currentPeriodStart || !args.currentPeriodEnd)) {
    throw new OnboardingProvisionError('período pago ausente', 'paid_period_missing');
  }
  // 1. Clínica — nasce com o estado de acesso já comprovado pela origem.
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
    status: initialBillingStatus,
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

  // 5. Subscription — billing controla pagamento; trial_ends_at permanece auditável.
  const trialEnds = args.trialEndsAt ?? new Date(Date.now() + args.trialDays * 86_400_000);
  const [sub] = await tx
    .insert(subscriptions)
    .values({
      clinicId,
      planId: args.planId,
      priceId: args.priceId,
      billingStatus: initialBillingStatus,
      trialEndsAt: trialEnds,
      enforceTrialDeadline: args.enforceTrialDeadline ?? false,
      currentPeriodStart: args.currentPeriodStart ?? new Date(),
      currentPeriodEnd: args.currentPeriodEnd ?? trialEnds,
      asaasSubscriptionId: args.asaasSubscriptionId,
    })
    .onConflictDoNothing({ target: subscriptions.clinicId })
    .returning({ id: subscriptions.id });

  // 6. Claim da origem (convite por version, cadastro por DELETE).
  await claim(tx, clinicId);

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
    if (initialBillingStatus === 'trial') {
      await publishEvent(tx, {
        clinicId,
        eventType: BILLING_EVENTS.TRIAL_STARTED,
        payload: { clinicId, subscriptionId: sub.id, trialEndsAt: trialEnds.toISOString() },
        idempotencyKey: `trial-started:${clinicId}`,
      });
    } else {
      await publishEvent(tx, {
        clinicId,
        eventType: BILLING_EVENTS.SUBSCRIPTION_ACTIVATED,
        payload: { clinicId, subscriptionId: sub.id, planCode: args.planCode },
        idempotencyKey: `subscription-activated:${clinicId}`,
      });
    }
  }

  return { clinicId };
}

/** Claim do convite: guardado por `version`, a 2ª aba/dupla-submissão perde. */
function inviteClaim(inviteId: string, inviteVersion: number): ProvisionClaim {
  return async (tx, clinicId) => {
    const [doneInvite] = await tx
      .update(clinicInvites)
      .set({
        status: 'completed',
        completedAt: sql`now()`,
        provisionedClinicId: clinicId,
        version: inviteVersion + 1,
      })
      .where(and(eq(clinicInvites.id, inviteId), eq(clinicInvites.version, inviteVersion)))
      .returning({ id: clinicInvites.id });
    if (!doneInvite) {
      throw new OnboardingProvisionError(
        'convite já concluído/alterado (race)',
        'invite_version_conflict',
      );
    }
  };
}

/** Provisionamento a partir de convite (F1 · ADR-027). Contrato inalterado. */
export async function provisionTenantFromInviteTx(
  tx: Tx,
  args: ProvisionArgs,
): Promise<{ clinicId: string }> {
  return provisionTenantCoreTx(tx, args, inviteClaim(args.inviteId, args.inviteVersion));
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
  /** Pessoa ou empresa efetivamente responsável pela cobrança no Asaas. */
  billingContact: {
    name: string;
    email: string;
    phone: string;
    cpfCnpj: string;
    postalCode: string;
    addressNumber: string;
  };
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
  // O Asaas não aceita Idempotency-Key em POST. A referência estável permite
  // localizar uma assinatura que foi criada antes de um timeout de resposta.
  const externalReference = `onboarding:${a.invite.id}`;

  let customerId: string;
  let subscriptionId: string;
  // Set only for a customer that this attempt created. A subscription recovered
  // through externalReference may be the result of an earlier timed-out request
  // and must remain available for reconciliation.
  let customerCreatedInThisAttempt: string | null = null;
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
        name: a.billingContact.name,
        email: a.billingContact.email,
        cpfCnpj: a.billingContact.cpfCnpj,
        phone: a.billingContact.phone,
      });
      customerId = c.customerId;
      customerCreatedInThisAttempt = c.customerId;
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
          name: a.billingContact.name,
          email: a.billingContact.email,
          cpfCnpj: a.billingContact.cpfCnpj,
          postalCode: a.billingContact.postalCode,
          addressNumber: a.billingContact.addressNumber,
          phone: a.billingContact.phone,
        },
        remoteIp: a.remoteIp,
      });
      subscriptionId = sub.subscriptionId;
    }
  } catch (e) {
    // 4xx (cartão/CPF/payload inválido) é definitivo → vira card_declined com a
    // motivo genérico seguro; o corpo do provedor não é confiável para exibição.
    if (e instanceof BillingProviderError) {
      // A known 4xx means the subscription was rejected. Compensate only the
      // customer created by this attempt; a timeout or 5xx remains indeterminate
      // and is reconciled by externalReference instead of risking a live charge.
      if (customerCreatedInThisAttempt) {
        try {
          await asaasProvider.deleteCustomer(customerCreatedInThisAttempt);
          metrics.emit('onboarding.checkout.customer_compensated', { outcome: 'deleted' });
        } catch (cleanupError) {
          // Preserve the safe checkout error. The operational metric is sanitized
          // and lets support reconcile the provider-side orphan without card data.
          metrics.emit('onboarding.checkout.customer_compensation_failed', {
            error: cleanupError,
          });
        }
      }
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
      customer: {
        name: a.billingContact.name,
        email: a.billingContact.email,
        document: a.billingContact.cpfCnpj,
        phone: a.billingContact.phone,
      },
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
