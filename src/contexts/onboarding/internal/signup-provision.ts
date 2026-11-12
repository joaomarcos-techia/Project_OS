/**
 * O-6 — provisionamento do tenant a partir do cadastro autônomo. SERVER-ONLY.
 *
 * O que garante "tenant nasce uma única vez" aqui não é uma flag: é o
 * `DELETE ... RETURNING` da própria `signup_sessions`, dentro da mesma transação
 * que cria a clínica. Duas abas disputando serializam no `FOR UPDATE`; a
 * perdedora encontra a linha já removida e não chega nem a inserir. Não há
 * estado "provisionando" para ficar preso, e não há migration nova: a sessão de
 * cadastro é efêmera por construção e seu fim natural é desaparecer.
 *
 * Efeito colateral bem-vindo: apagar a linha apaga também `owner_name`,
 * `clinic_name` e `email_hash`. A PII do funil não sobrevive ao provisionamento.
 *
 * Nada aqui vem do browser. `clinic_id`, papel, plano, preço e slug são
 * decididos no servidor; a única entrada é o `userId` verificado de `getUser()`.
 */
import 'server-only';

import { randomBytes } from 'node:crypto';

import { and, eq, gt, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';

/* eslint-disable boundaries/element-types -- O-6 orquestra tenancy+billing a
   partir do cadastro pré-tenant, como a saga de convite (ADR-027 autoriza). */
import { plans, prices, subscriptions } from '@/contexts/billing/schema';
import { isOffer2026PlanCode } from '@/contexts/billing/proposed-offer';
import {
  ensureInvoiceForPayment,
  markInvoicePaid,
} from '@/contexts/billing/internal/subscriptions';
import { clinics, reservedSlugs } from '@/contexts/tenancy/schema';
import { profiles } from '@/contexts/identity/schema';
/* eslint-enable boundaries/element-types */
import { signupSessions } from '@/contexts/onboarding/schema';
import { dbAdmin, type Tx } from '@/lib/db';
import { env } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';
import type { ProviderPayment } from '@/lib/payments/asaas';

import { QORO_SELF_SERVICE_TRIAL_DAYS } from '../trial';
import { OnboardingProvisionError, provisionTenantCoreTx } from './saga';
import { readSignupAuthCreatedAt, resolveSignupTrialTerms } from './signup-trial';
import { recoverableHostedCheckoutCondition } from './signup-checkout-recovery';

const userIdSchema = z.string().uuid();

/** Contrato do banco: `^[a-z0-9-]{3,30}$` (clinics_slug_format, migration 0001). */
const SLUG_MIN = 3;
const SLUG_MAX = 30;
const SLUG_ATTEMPTS = 12;

export type ProvisionSignupOutcome =
  | { ok: true; clinicId: string }
  | {
      ok: false;
      reason: 'gone' | 'not_paid' | 'no_plan' | 'invalid_plan' | 'slug_unavailable' | 'unavailable';
    };

/** Candidato a partir do nome; a unicidade e os reservados são resolvidos depois. */
export function slugifyClinicName(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/gu, '');
}

/**
 * Resolve um slug livre dentro da transação.
 *
 * Três coisas dão errado com nome escolhido por quem se cadastra, e todas são
 * tratadas aqui em vez de virarem violação de constraint:
 *   - nome que vira slug curto demais ("Dr. A") ou vazio ("+++");
 *   - nome que colide com clínica existente;
 *   - nome que bate num subdomínio reservado da plataforma ("admin", "api").
 *
 * Serializa a escolha do mesmo candidato entre cadastros. A leitura é feita
 * depois do lock, para observar o commit concorrente; UNIQUE continua sendo
 * a última proteção. Não bloqueia cadastros com candidatos diferentes.
 */
export async function resolveAvailableSlug(tx: Tx, clinicName: string): Promise<string | null> {
  const base = slugifyClinicName(clinicName);
  // Base curta demais não é erro do usuário: é um nome legítimo que não vira
  // subdomínio. Cai direto para o sufixo aleatório, sem tentar o inválido.
  const seed = base.length >= SLUG_MIN ? base : `clinica-${base}`.slice(0, SLUG_MAX);

  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
    const candidate =
      attempt === 0 && seed.length >= SLUG_MIN
        ? seed
        : `${seed.slice(0, SLUG_MAX - 5)}-${randomBytes(2).toString('hex')}`.replace(/^-+/u, '');

    if (candidate.length < SLUG_MIN || candidate.length > SLUG_MAX) continue;

    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`qoro:signup-slug:${candidate}`},0))`,
    );

    const [reserved] = await tx
      .select({ slug: reservedSlugs.slug })
      .from(reservedSlugs)
      .where(eq(reservedSlugs.slug, candidate))
      .limit(1);
    if (reserved) continue;

    const [taken] = await tx
      .select({ id: clinics.id })
      .from(clinics)
      .where(eq(clinics.slug, candidate))
      .limit(1);
    if (!taken) return candidate;
  }
  return null;
}

/**
 * Provisiona o tenant do cadastro autônomo.
 *
 * Pré-condição inegociável: a assinatura já existe e foi confirmada por readback
 * (`billing_attempt_state = 'active'`). No catálogo legado, o trial começa após
 * confirmar a assinatura recorrente (§21.20). Nos planos versionados, o prazo
 * absoluto começa na criação do usuário Auth e pode já estar encerrado aqui.
 */
export async function provisionTenantFromSignup(input: {
  userId: string;
  /** Vem de `getUser()`, nunca do corpo da requisição. Vira contato de cobrança. */
  verifiedEmail: string;
  /**
   * CPF/CNPJ já validado, vindo da MESMA requisição que criou a assinatura.
   * É aqui — e só aqui — que ele é persistido, cifrado pela chave do tenant que
   * acabou de nascer. Antes disso não havia tenant para cifrar com.
   */
  cpfCnpj: string;
  /** Confere o vencedor da corrida quando o draft já foi consumido por outra aba. */
  expectedAsaasSubscriptionId?: string;
  /** Centavos já conferidos contra o Asaas, para detectar mudança de catálogo no provisionamento. */
  expectedPriceCents?: number;
  /** Readback do Checkout, nunca dados do browser ou apenas callback. */
  paidCheckout?: { payment: ProviderPayment; through: Date };
}): Promise<ProvisionSignupOutcome> {
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED)
    return { ok: false, reason: 'unavailable' };
  if (!userIdSchema.safeParse(input.userId).success)
    throw new Error('[signup] invalid_provision_owner');
  const authCreatedAt = await readSignupAuthCreatedAt(input.userId);

  return dbAdmin.transaction(async (tx) => {
    // Trava a sessão antes de ler: é o ponto onde duas abas viram uma.
    const [draft] = await tx
      .select({
        id: signupSessions.id,
        ownerName: signupSessions.ownerName,
        clinicName: signupSessions.clinicName,
        selectedPlanId: signupSessions.selectedPlanId,
        selectedBillingCycle: signupSessions.selectedBillingCycle,
        billingState: signupSessions.billingAttemptState,
        billingAttemptedAt: signupSessions.billingAttemptedAt,
        asaasCustomerId: signupSessions.asaasCustomerId,
        asaasCheckoutId: signupSessions.asaasCheckoutId,
        asaasSubscriptionId: signupSessions.asaasSubscriptionId,
      })
      .from(signupSessions)
      .where(
        and(
          eq(signupSessions.authUserId, input.userId),
          eq(signupSessions.status, 'email_verified'),
          isNotNull(signupSessions.consumedAt),
          or(
            gt(signupSessions.absoluteExpiresAt, sql`now()`),
            recoverableHostedCheckoutCondition(input.userId),
          ),
        ),
      )
      .for('update')
      .limit(1);

    if (!draft) {
      if (!input.expectedAsaasSubscriptionId) return { ok: false, reason: 'gone' };
      const [alreadyProvisioned] = await tx
        .select({ clinicId: profiles.clinicId })
        .from(profiles)
        .innerJoin(subscriptions, eq(subscriptions.clinicId, profiles.clinicId))
        .where(
          and(
            eq(profiles.id, input.userId),
            eq(profiles.role, 'owner'),
            eq(subscriptions.asaasSubscriptionId, input.expectedAsaasSubscriptionId),
          ),
        )
        .limit(1);
      return alreadyProvisioned?.clinicId
        ? { ok: true, clinicId: alreadyProvisioned.clinicId }
        : { ok: false, reason: 'gone' };
    }
    if (!draft.ownerName || !draft.clinicName) return { ok: false, reason: 'gone' };
    if (!draft.selectedPlanId) return { ok: false, reason: 'no_plan' };
    // Sem assinatura confirmada não nasce tenant. `creation_unknown` cai aqui de
    // propósito: provisionar sobre estado indeterminado é criar clínica que
    // talvez não esteja paga.
    if (draft.billingState !== 'active' || !draft.asaasSubscriptionId || !draft.asaasCustomerId) {
      return { ok: false, reason: 'not_paid' };
    }
    if (
      input.expectedAsaasSubscriptionId &&
      input.expectedAsaasSubscriptionId !== draft.asaasSubscriptionId
    ) {
      return { ok: false, reason: 'not_paid' };
    }

    const [priced] = await tx
      .select({
        planId: plans.id,
        planCode: plans.code,
        priceId: prices.id,
        amount: prices.amount,
      })
      .from(plans)
      .innerJoin(
        prices,
        and(
          eq(prices.planId, plans.id),
          eq(prices.billingCycle, draft.selectedBillingCycle),
          eq(prices.currency, 'BRL'),
          lte(prices.activeFrom, sql`now()`),
          isNull(prices.activeUntil),
          isNull(prices.campaignCode),
        ),
      )
      .where(and(eq(plans.id, draft.selectedPlanId), eq(plans.ativo, true)))
      .for('share')
      .limit(1);
    if (!priced) return { ok: false, reason: 'invalid_plan' };
    if (
      input.expectedPriceCents !== undefined &&
      Math.round(Number(priced.amount) * 100) !== input.expectedPriceCents
    ) {
      return { ok: false, reason: 'not_paid' };
    }

    const newOffer = isOffer2026PlanCode(priced.planCode);
    const trial =
      newOffer && draft.billingAttemptedAt
        ? resolveSignupTrialTerms({
            planCode: priced.planCode,
            attemptedAt: draft.billingAttemptedAt,
            authCreatedAt,
          })
        : null;
    if (newOffer && !trial) return { ok: false, reason: 'unavailable' };
    const now = Date.now();
    const trialExpired = trial !== null && trial.endsAt.getTime() <= now;
    const paid = input.paidCheckout;
    if (
      trialExpired &&
      (!paid ||
        !Number.isFinite(paid.through.getTime()) ||
        paid.through.getTime() <= now ||
        paid.payment.deleted ||
        (paid.payment.status !== 'CONFIRMED' && paid.payment.status !== 'RECEIVED') ||
        paid.payment.checkoutSessionId !== draft.asaasCheckoutId ||
        paid.payment.subscriptionId !== draft.asaasSubscriptionId ||
        paid.payment.billingType !== 'CREDIT_CARD' ||
        Math.round(paid.payment.value * 100) !== Math.round(Number(priced.amount) * 100) ||
        paid.payment.dueDate !== trial.firstDueDate)
    ) {
      return { ok: false, reason: 'not_paid' };
    }

    const slug = await resolveAvailableSlug(tx, draft.clinicName);
    if (!slug) return { ok: false, reason: 'slug_unavailable' };

    const provisioned = await provisionTenantCoreTx(
      tx,
      {
        clinic: { nome: draft.clinicName, slug },
        // O papel é `owner`, fixado pelo núcleo. O browser não escolhe papel, e
        // não existe caminho que aceite um vindo dele.
        owner: { userId: input.userId, nome: draft.ownerName },
        customer: {
          name: draft.ownerName,
          // O contato de cobrança do tenant é o e-mail JÁ VERIFICADO da conta.
          // Ele chega de `getUser()`; o corpo da requisição não participa.
          email: input.verifiedEmail,
          // `provisionTenantCoreTx` cifra com `encryptForTenant(clinicId, ...)`.
          document: input.cpfCnpj,
        },
        planId: priced.planId,
        planCode: priced.planCode,
        priceId: priced.priceId,
        priceAmount: Number(priced.amount),
        billingCycle: draft.selectedBillingCycle,
        trialDays: QORO_SELF_SERVICE_TRIAL_DAYS,
        ...(trial && {
          trialDays: trial.days,
          trialEndsAt: trial.endsAt,
          enforceTrialDeadline: true,
          initialBillingStatus: trialExpired ? 'active' : 'trial',
          ...(trialExpired &&
            paid && {
              currentPeriodStart: new Date(`${paid.payment.dueDate}T00:00:00.000Z`),
              currentPeriodEnd: paid.through,
            }),
        }),
        asaasCustomerId: draft.asaasCustomerId,
        asaasSubscriptionId: draft.asaasSubscriptionId,
      },
      async (innerTx) => {
        // O claim: a sessão some. Quem não encontrar linha para apagar perdeu a
        // corrida, e a transação inteira volta atrás — inclusive a clínica.
        const [consumed] = await innerTx
          .delete(signupSessions)
          .where(
            and(
              eq(signupSessions.id, draft.id),
              eq(signupSessions.authUserId, input.userId),
              eq(signupSessions.billingAttemptState, 'active'),
            ),
          )
          .returning({ id: signupSessions.id });
        if (!consumed) {
          throw new OnboardingProvisionError(
            'cadastro já provisionado ou alterado (race)',
            'signup_already_provisioned',
          );
        }
      },
    );

    if (trialExpired && paid) {
      // O webhook pode ter chegado antes de existir tenant. Materialize a primeira
      // parcela paga na mesma transação; uma falha faz rollback e permite retry.
      const invoice = await ensureInvoiceForPayment(tx, {
        paymentId: paid.payment.paymentId,
        subscriptionId: paid.payment.subscriptionId,
        value: paid.payment.value,
        dueDate: paid.payment.dueDate,
      });
      if (!invoice)
        throw new OnboardingProvisionError('parcela paga sem assinatura', 'paid_invoice_missing');
      await markInvoicePaid(tx, provisioned.clinicId, invoice, {
        paymentMethod: paid.payment.billingType,
        providerPaymentId: paid.payment.paymentId,
        idemSuffix: paid.payment.paymentId,
      });
    }

    metrics.emit('signup.provisioned', { planCode: priced.planCode });
    return { ok: true, clinicId: provisioned.clinicId };
  });
}
