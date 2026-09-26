/**
 * O-5 — intenção de assinatura recorrente do cadastro autônomo. SERVER-ONLY.
 *
 * Três invariantes governam este arquivo, e todas existem porque o Asaas **não
 * aceita Idempotency-Key em POST**:
 *
 *   1. a intenção nasce no banco ANTES da chamada externa (reserva por CAS), de
 *      modo que um timeout nunca deixa o sistema sem saber que tentou;
 *   2. `creation_unknown` é estado terminal-para-retry: dali NÃO se tenta de novo
 *      automaticamente, porque a assinatura pode existir do outro lado. Sai-se
 *      por reconciliação (`externalReference`), nunca por nova criação;
 *   3. plano e preço são resolvidos aqui, no servidor, a partir do catálogo. O
 *      browser escolhe o `plan_id` no passo anterior e nada mais — nem valor, nem
 *      ciclo, nem trial, nem status.
 *
 * Ninguém aqui recebe identificador do cliente: tudo é chaveado pelo `userId`
 * verificado que veio de `getUser()`, o mesmo seam de `claimSignupDraftByVerifiedEmail`.
 *
 * Nenhum dado de cartão passa por este módulo. O meio de pagamento é coletado
 * pelo Asaas, na página dele.
 */
import 'server-only';

import { and, eq, gt, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';

/* eslint-disable boundaries/element-types -- O-5 resolve o catálogo global de
   Billing no servidor; signup_sessions continua pré-tenant e não recebe preço do
   browser. Mesma autorização usada pelo O-4 em signup-draft.ts. */
import { SubscriptionCreatedSchema } from '@/contexts/billing/events';
import { plans, prices } from '@/contexts/billing/schema';
/* eslint-enable boundaries/element-types */
import { signupSessions } from '@/contexts/onboarding/schema';
import { dbAdmin } from '@/lib/db';
import { env } from '@/lib/env';

import { QORO_SELF_SERVICE_TRIAL_DAYS } from '../trial';

const userIdSchema = z.string().uuid();

/** Estados possíveis da tentativa, espelhando o CHECK da migration 0103. */
export type SignupBillingAttemptState =
  | 'reserved'
  | 'checkout_pending'
  | 'active'
  | 'creation_unknown'
  | 'failed';

export interface SignupBillingIntent {
  /** Chave estável de reconciliação. O Asaas devolve isto em consultas. */
  externalReference: string;
  planId: string;
  planCode: string;
  priceId: string;
  /** Centavos — a unidade interna. Converta na borda do provedor. */
  priceCents: number;
  clinicName: string;
  ownerName: string;
  trialDays: number;
  /** `YYYY-MM-DD`: primeira cobrança vence ao fim do trial, não hoje. */
  nextDueDate: string;
}

export interface SignupBillingSnapshot {
  state: SignupBillingAttemptState | null;
  asaasCustomerId: string | null;
  asaasCheckoutId: string | null;
  asaasCheckoutUrl: string | null;
  asaasSubscriptionId: string | null;
  failureCode: string | null;
  rowVersion: number;
}

type ReserveOutcome =
  | { ok: true; rowVersion: number; intent: SignupBillingIntent }
  | { ok: false; reason: 'checkout_pending'; checkoutUrl: string }
  | {
      ok: false;
      reason:
        | 'gone'
        | 'no_plan'
        | 'invalid_plan'
        | 'conflict'
        | 'already_active'
        | 'reconcile_required'
        | 'unavailable';
    };

type SettleOutcome = { ok: true; rowVersion: number } | { ok: false; reason: 'conflict' };

type ReadOutcome =
  | { ok: true; snapshot: SignupBillingSnapshot }
  | { ok: false; reason: 'gone' | 'unavailable' };

function enabled(): boolean {
  return env.SIGNUP_AUTH_ENABLED && env.SIGNUP_IDENTITY_ENABLED;
}

/**
 * O dono do draft verificado e vivo. Idêntico ao usado pelo O-4: identidade
 * confirmada, sessão consumida e dentro dos dois prazos.
 */
function ownerDraftCondition(userId: string) {
  return and(
    eq(signupSessions.authUserId, userId),
    eq(signupSessions.status, 'email_verified'),
    isNotNull(signupSessions.consumedAt),
    gt(signupSessions.idleExpiresAt, sql`now()`),
    gt(signupSessions.absoluteExpiresAt, sql`now()`),
  );
}

function priceToCents(value: string): number {
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/u.exec(value);
  if (!match) throw new Error('[signup] invalid_catalog_price');
  const major = Number(match[1]);
  const minor = Number((match[2] ?? '').padEnd(2, '0'));
  return major * 100 + minor;
}

/** Centavos → reais, a unidade que o provedor espera. Sem ponto flutuante no meio. */
export function centsToReais(cents: number): number {
  if (!Number.isInteger(cents) || cents < 0) throw new Error('[signup] invalid_amount');
  return Number((cents / 100).toFixed(2));
}

function dueDateAfterTrial(trialDays: number, now: Date): string {
  const due = new Date(now.getTime() + trialDays * 86_400_000);
  return due.toISOString().slice(0, 10);
}

/**
 * Reserva a tentativa por CAS e devolve a intenção resolvida no servidor.
 *
 * A transição aceita SÓ dois pontos de partida: nenhuma tentativa, ou uma que
 * falhou de forma definitiva (`failed` — 4xx do provedor, recusa conhecida).
 * `creation_unknown` fica de fora de propósito: é o estado em que a assinatura
 * pode existir sem que saibamos, e tentar de novo ali é o caminho direto para
 * cobrança duplicada. `active` também fica de fora — já existe assinatura.
 */
export async function reserveSignupBillingAttempt(userId: string): Promise<ReserveOutcome> {
  if (!enabled()) return { ok: false, reason: 'unavailable' };
  if (!userIdSchema.safeParse(userId).success) throw new Error('[signup] invalid_billing_owner');

  return dbAdmin.transaction(async (tx) => {
    // FOR UPDATE: duas abas pedindo checkout ao mesmo tempo serializam aqui, e a
    // perdedora enxerga o estado já reservado em vez de reservar de novo.
    const [draft] = await tx
      .select({
        id: signupSessions.id,
        rowVersion: signupSessions.rowVersion,
        ownerName: signupSessions.ownerName,
        clinicName: signupSessions.clinicName,
        selectedPlanId: signupSessions.selectedPlanId,
        attemptState: signupSessions.billingAttemptState,
        checkoutUrl: signupSessions.asaasCheckoutUrl,
      })
      .from(signupSessions)
      .where(ownerDraftCondition(userId))
      .for('update')
      .limit(1);

    if (!draft) return { ok: false, reason: 'gone' };
    if (draft.attemptState === 'active') return { ok: false, reason: 'already_active' };
    if (draft.attemptState === 'checkout_pending') {
      return draft.checkoutUrl
        ? { ok: false, reason: 'checkout_pending', checkoutUrl: draft.checkoutUrl }
        : { ok: false, reason: 'conflict' };
    }
    if (draft.attemptState === 'creation_unknown')
      return { ok: false, reason: 'reconcile_required' };
    if (draft.attemptState === 'reserved') return { ok: false, reason: 'conflict' };
    if (!draft.selectedPlanId) return { ok: false, reason: 'no_plan' };
    if (!draft.clinicName || !draft.ownerName) return { ok: false, reason: 'gone' };

    // Preço do catálogo, travado em `share` para não mudar sob os pés da
    // tentativa. O browser nunca mandou valor; ele nem sabe qual é.
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
          eq(prices.billingCycle, 'monthly'),
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

    /*
     * O código do plano precisa ser publicável ANTES de existir cobrança.
     *
     * `billing.subscription.created` aceita um enum fechado de códigos. Um plano
     * cadastrado fora dele passaria por aqui, viraria assinatura no Asaas e só
     * então explodiria no `publishEvent`, dentro da transação de
     * provisionamento — a pessoa pagando e sem clínica, num laço que o retry não
     * resolve. Encontrado ao rodar o provisionamento contra o catálogo real.
     *
     * A validação usa o PRÓPRIO schema do evento, e não uma cópia da lista, para
     * que os dois não possam divergir em silêncio.
     */
    if (!SubscriptionCreatedSchema.shape.planCode.safeParse(priced.planCode).success) {
      return { ok: false, reason: 'invalid_plan' };
    }

    const [reserved] = await tx
      .update(signupSessions)
      .set({
        billingAttemptState: 'reserved',
        billingAttemptedAt: sql`now()`,
        billingFailureCode: null,
        asaasCustomerId: null,
        asaasCheckoutId: null,
        asaasCheckoutUrl: null,
        asaasSubscriptionId: null,
        rowVersion: sql`${signupSessions.rowVersion} + 1`,
      })
      .where(
        and(
          eq(signupSessions.id, draft.id),
          eq(signupSessions.rowVersion, draft.rowVersion),
          or(
            isNull(signupSessions.billingAttemptState),
            eq(signupSessions.billingAttemptState, 'failed'),
          ),
        ),
      )
      .returning({
        rowVersion: signupSessions.rowVersion,
        billingAttemptedAt: signupSessions.billingAttemptedAt,
      });
    if (!reserved) return { ok: false, reason: 'conflict' };
    if (!reserved.billingAttemptedAt) throw new Error('[signup] missing_billing_clock');

    return {
      ok: true,
      rowVersion: reserved.rowVersion,
      intent: {
        externalReference: `signup:${draft.id}`,
        planId: priced.planId,
        planCode: priced.planCode,
        priceId: priced.priceId,
        priceCents: priceToCents(priced.amount),
        clinicName: draft.clinicName,
        ownerName: draft.ownerName,
        trialDays: QORO_SELF_SERVICE_TRIAL_DAYS,
        nextDueDate: dueDateAfterTrial(QORO_SELF_SERVICE_TRIAL_DAYS, reserved.billingAttemptedAt),
      },
    };
  });
}

/** Persiste o Checkout antes de entregar sua URL ao navegador. */
export async function recordSignupHostedCheckout(input: {
  userId: string;
  reservedVersion: number;
  asaasCheckoutId: string;
  checkoutUrl: string;
}): Promise<SettleOutcome> {
  if (!userIdSchema.safeParse(input.userId).success)
    throw new Error('[signup] invalid_billing_owner');
  if (!input.asaasCheckoutId.trim() || !URL.canParse(input.checkoutUrl)) {
    throw new Error('[signup] invalid_checkout_result');
  }

  const [recorded] = await dbAdmin
    .update(signupSessions)
    .set({
      billingAttemptState: 'checkout_pending',
      asaasCheckoutId: input.asaasCheckoutId,
      asaasCheckoutUrl: input.checkoutUrl,
      billingFailureCode: null,
      rowVersion: sql`${signupSessions.rowVersion} + 1`,
    })
    .where(
      and(
        eq(signupSessions.authUserId, input.userId),
        eq(signupSessions.status, 'email_verified'),
        eq(signupSessions.billingAttemptState, 'reserved'),
        eq(signupSessions.rowVersion, input.reservedVersion),
      ),
    )
    .returning({ rowVersion: signupSessions.rowVersion });

  return recorded
    ? { ok: true, rowVersion: recorded.rowVersion }
    : { ok: false, reason: 'conflict' };
}

/** Promove somente um Checkout pendente para assinatura confirmada. */
export async function activateSignupHostedCheckout(input: {
  userId: string;
  expectedVersion: number;
  asaasCheckoutId: string;
  asaasCustomerId: string;
  asaasSubscriptionId: string;
}): Promise<SettleOutcome> {
  if (!userIdSchema.safeParse(input.userId).success)
    throw new Error('[signup] invalid_billing_owner');

  const [activated] = await dbAdmin
    .update(signupSessions)
    .set({
      billingAttemptState: 'active',
      asaasCustomerId: input.asaasCustomerId,
      asaasSubscriptionId: input.asaasSubscriptionId,
      billingFailureCode: null,
      rowVersion: sql`${signupSessions.rowVersion} + 1`,
    })
    .where(
      and(
        ownerDraftCondition(input.userId),
        eq(signupSessions.billingAttemptState, 'checkout_pending'),
        eq(signupSessions.rowVersion, input.expectedVersion),
        eq(signupSessions.asaasCheckoutId, input.asaasCheckoutId),
        or(
          isNull(signupSessions.asaasCustomerId),
          eq(signupSessions.asaasCustomerId, input.asaasCustomerId),
        ),
      ),
    )
    .returning({ rowVersion: signupSessions.rowVersion });

  return activated
    ? { ok: true, rowVersion: activated.rowVersion }
    : { ok: false, reason: 'conflict' };
}

/**
 * Fecha a reserva como assinatura viva. CAS sobre a versão reservada: se outra
 * coisa mexeu na linha nesse meio-tempo, esta ativação perde e quem chamou
 * precisa cancelar a assinatura órfã do lado do provedor.
 */
export async function activateSignupBillingAttempt(input: {
  userId: string;
  reservedVersion: number;
  asaasCustomerId: string;
  asaasSubscriptionId: string;
}): Promise<SettleOutcome> {
  if (!userIdSchema.safeParse(input.userId).success)
    throw new Error('[signup] invalid_billing_owner');
  if (!input.asaasCustomerId.trim() || !input.asaasSubscriptionId.trim())
    throw new Error('[signup] invalid_billing_result');

  const [activated] = await dbAdmin
    .update(signupSessions)
    .set({
      billingAttemptState: 'active',
      asaasCustomerId: input.asaasCustomerId,
      asaasSubscriptionId: input.asaasSubscriptionId,
      billingFailureCode: null,
      rowVersion: sql`${signupSessions.rowVersion} + 1`,
    })
    .where(
      and(
        eq(signupSessions.authUserId, input.userId),
        eq(signupSessions.status, 'email_verified'),
        eq(signupSessions.billingAttemptState, 'reserved'),
        eq(signupSessions.rowVersion, input.reservedVersion),
      ),
    )
    .returning({ rowVersion: signupSessions.rowVersion });

  return activated
    ? { ok: true, rowVersion: activated.rowVersion }
    : { ok: false, reason: 'conflict' };
}

/**
 * Fecha a reserva sem assinatura.
 *
 * `failed` é recusa conhecida (4xx): nada foi criado, e a pessoa pode tentar de
 * novo. `creation_unknown` é timeout/5xx/circuito: pode ter sido criado, e daí
 * só se sai por reconciliação. A distinção é a diferença entre "tente de novo" e
 * "não toque nisso até conferir do outro lado".
 *
 * `failureCode` é código nosso, curto e sanitizado. O corpo de um 4xx do gateway
 * pode refletir o request — nunca entra em banco, log ou tela.
 */
export async function markSignupBillingIssue(input: {
  userId: string;
  reservedVersion: number;
  outcome: 'failed' | 'creation_unknown';
  failureCode: string;
  asaasCustomerId?: string | null;
}): Promise<SettleOutcome> {
  if (!userIdSchema.safeParse(input.userId).success)
    throw new Error('[signup] invalid_billing_owner');
  if (!/^[a-z0-9_]{1,64}$/u.test(input.failureCode))
    throw new Error('[signup] invalid_failure_code');

  const [marked] = await dbAdmin
    .update(signupSessions)
    .set({
      billingAttemptState: input.outcome,
      billingFailureCode: input.failureCode,
      // O customer pode ter nascido antes do erro; guardá-lo é o que permite
      // reconciliar sem criar um segundo.
      ...(input.asaasCustomerId ? { asaasCustomerId: input.asaasCustomerId } : {}),
      rowVersion: sql`${signupSessions.rowVersion} + 1`,
    })
    .where(
      and(
        eq(signupSessions.authUserId, input.userId),
        eq(signupSessions.status, 'email_verified'),
        eq(signupSessions.billingAttemptState, 'reserved'),
        eq(signupSessions.rowVersion, input.reservedVersion),
      ),
    )
    .returning({ rowVersion: signupSessions.rowVersion });

  return marked ? { ok: true, rowVersion: marked.rowVersion } : { ok: false, reason: 'conflict' };
}

export interface SignupHostedCheckoutTarget {
  state: 'checkout_pending' | 'active';
  rowVersion: number;
  externalReference: string;
  priceCents: number;
  trialDays: number;
  attemptedOn: string;
  nextDueDate: string;
  asaasCustomerId: string | null;
  asaasCheckoutId: string;
  asaasSubscriptionId: string | null;
}

/** Alvo fechado da conciliação do retorno do Checkout, sem PII. */
export async function readSignupHostedCheckoutTarget(
  userId: string,
): Promise<SignupHostedCheckoutTarget | null> {
  if (!enabled() || !userIdSchema.safeParse(userId).success) return null;

  const [row] = await dbAdmin
    .select({
      id: signupSessions.id,
      state: signupSessions.billingAttemptState,
      attemptedAt: signupSessions.billingAttemptedAt,
      rowVersion: signupSessions.rowVersion,
      asaasCustomerId: signupSessions.asaasCustomerId,
      asaasCheckoutId: signupSessions.asaasCheckoutId,
      asaasSubscriptionId: signupSessions.asaasSubscriptionId,
      amount: prices.amount,
    })
    .from(signupSessions)
    .innerJoin(plans, and(eq(plans.id, signupSessions.selectedPlanId), eq(plans.ativo, true)))
    .innerJoin(
      prices,
      and(
        eq(prices.planId, plans.id),
        eq(prices.billingCycle, 'monthly'),
        eq(prices.currency, 'BRL'),
        lte(prices.activeFrom, sql`now()`),
        isNull(prices.activeUntil),
        isNull(prices.campaignCode),
      ),
    )
    .where(
      and(
        ownerDraftCondition(userId),
        or(
          eq(signupSessions.billingAttemptState, 'checkout_pending'),
          eq(signupSessions.billingAttemptState, 'active'),
        ),
      ),
    )
    .limit(1);

  if (
    !row ||
    (row.state !== 'checkout_pending' && row.state !== 'active') ||
    !row.attemptedAt ||
    !row.asaasCheckoutId
  ) {
    return null;
  }

  return {
    state: row.state,
    rowVersion: row.rowVersion,
    externalReference: `signup:${row.id}`,
    priceCents: priceToCents(row.amount),
    trialDays: QORO_SELF_SERVICE_TRIAL_DAYS,
    attemptedOn: row.attemptedAt.toISOString().slice(0, 10),
    nextDueDate: dueDateAfterTrial(QORO_SELF_SERVICE_TRIAL_DAYS, row.attemptedAt),
    asaasCustomerId: row.asaasCustomerId,
    asaasCheckoutId: row.asaasCheckoutId,
    asaasSubscriptionId: row.asaasSubscriptionId,
  };
}

/**
 * Reconciliação: promove `creation_unknown` a `active` quando a consulta ao
 * provedor por `externalReference` encontrou a assinatura que o timeout escondeu.
 *
 * É a ÚNICA saída de `creation_unknown` para `active`, e ela não cria nada — só
 * registra o que já existe do outro lado.
 */
/**
 * Libera uma tentativa cujo Checkout foi cancelado ou expirou.
 *
 * O caller precisa cancelar (ou confirmar o cancelamento) no Asaas antes de
 * chegar aqui. O CAS impede que um retorno antigo apague uma assinatura que
 * outra aba acabou de confirmar.
 */
export async function resetSignupHostedCheckout(input: {
  userId: string;
  expectedVersion: number;
  asaasCheckoutId: string;
  reason: 'cancelled' | 'expired';
}): Promise<SettleOutcome> {
  if (!userIdSchema.safeParse(input.userId).success)
    throw new Error('[signup] invalid_billing_owner');

  const [reset] = await dbAdmin
    .update(signupSessions)
    .set({
      billingAttemptState: 'failed',
      billingFailureCode: input.reason === 'cancelled' ? 'checkout_cancelled' : 'checkout_expired',
      asaasCustomerId: null,
      asaasCheckoutId: null,
      asaasCheckoutUrl: null,
      asaasSubscriptionId: null,
      rowVersion: sql`${signupSessions.rowVersion} + 1`,
    })
    .where(
      and(
        ownerDraftCondition(input.userId),
        eq(signupSessions.billingAttemptState, 'checkout_pending'),
        eq(signupSessions.rowVersion, input.expectedVersion),
        eq(signupSessions.asaasCheckoutId, input.asaasCheckoutId),
      ),
    )
    .returning({ rowVersion: signupSessions.rowVersion });

  return reset ? { ok: true, rowVersion: reset.rowVersion } : { ok: false, reason: 'conflict' };
}

export async function reconcileSignupBillingAttempt(input: {
  userId: string;
  expectedVersion: number;
  asaasCustomerId: string;
  asaasSubscriptionId: string;
}): Promise<SettleOutcome> {
  if (!userIdSchema.safeParse(input.userId).success)
    throw new Error('[signup] invalid_billing_owner');

  const [reconciled] = await dbAdmin
    .update(signupSessions)
    .set({
      billingAttemptState: 'active',
      asaasCustomerId: input.asaasCustomerId,
      asaasSubscriptionId: input.asaasSubscriptionId,
      billingFailureCode: null,
      rowVersion: sql`${signupSessions.rowVersion} + 1`,
    })
    .where(
      and(
        ownerDraftCondition(input.userId),
        eq(signupSessions.billingAttemptState, 'creation_unknown'),
        eq(signupSessions.rowVersion, input.expectedVersion),
      ),
    )
    .returning({ rowVersion: signupSessions.rowVersion });

  return reconciled
    ? { ok: true, rowVersion: reconciled.rowVersion }
    : { ok: false, reason: 'conflict' };
}

/**
 * Alvo de reconciliação, SERVER-ONLY.
 *
 * Separado de `readSignupBilling` de propósito: o `externalReference` carrega o
 * id da sessão de cadastro, e id de sessão não vai para resposta de API. Quem
 * precisa disto é a orquestração, nunca a tela.
 */
export async function readSignupBillingReconcileTarget(userId: string): Promise<{
  externalReference: string;
  asaasCustomerId: string | null;
  priceCents: number;
  rowVersion: number;
} | null> {
  if (!enabled()) return null;
  if (!userIdSchema.safeParse(userId).success) return null;

  const [row] = await dbAdmin
    .select({
      id: signupSessions.id,
      asaasCustomerId: signupSessions.asaasCustomerId,
      rowVersion: signupSessions.rowVersion,
      amount: prices.amount,
    })
    .from(signupSessions)
    .innerJoin(plans, and(eq(plans.id, signupSessions.selectedPlanId), eq(plans.ativo, true)))
    .innerJoin(
      prices,
      and(
        eq(prices.planId, plans.id),
        eq(prices.billingCycle, 'monthly'),
        eq(prices.currency, 'BRL'),
        lte(prices.activeFrom, sql`now()`),
        isNull(prices.activeUntil),
        isNull(prices.campaignCode),
      ),
    )
    .where(
      and(ownerDraftCondition(userId), eq(signupSessions.billingAttemptState, 'creation_unknown')),
    )
    .limit(1);
  if (!row) return null;

  return {
    externalReference: `signup:${row.id}`,
    asaasCustomerId: row.asaasCustomerId,
    priceCents: priceToCents(row.amount),
    rowVersion: row.rowVersion,
  };
}

/** Leitura do estado, sem PII e sem segredo — o que a UI pode saber. */
export async function readSignupBilling(userId: string): Promise<ReadOutcome> {
  if (!enabled()) return { ok: false, reason: 'unavailable' };
  if (!userIdSchema.safeParse(userId).success) return { ok: false, reason: 'unavailable' };

  const [row] = await dbAdmin
    .select({
      state: signupSessions.billingAttemptState,
      asaasCustomerId: signupSessions.asaasCustomerId,
      asaasCheckoutId: signupSessions.asaasCheckoutId,
      asaasCheckoutUrl: signupSessions.asaasCheckoutUrl,
      asaasSubscriptionId: signupSessions.asaasSubscriptionId,
      failureCode: signupSessions.billingFailureCode,
      rowVersion: signupSessions.rowVersion,
    })
    .from(signupSessions)
    .where(ownerDraftCondition(userId))
    .limit(1);
  if (!row) return { ok: false, reason: 'gone' };

  return {
    ok: true,
    snapshot: {
      state: (row.state as SignupBillingAttemptState | null) ?? null,
      asaasCustomerId: row.asaasCustomerId,
      asaasCheckoutId: row.asaasCheckoutId,
      asaasCheckoutUrl: row.asaasCheckoutUrl,
      asaasSubscriptionId: row.asaasSubscriptionId,
      failureCode: row.failureCode,
      rowVersion: row.rowVersion,
    },
  };
}
