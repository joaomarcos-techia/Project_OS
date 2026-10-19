/**
 * Checkout recorrente hospedado do cadastro autônomo. SERVER-ONLY.
 *
 * A criação apenas entrega uma URL do Asaas. O retorno do navegador nunca
 * confirma nada: a conclusão consulta customer e assinatura no provider,
 * confere o contrato resolvido no servidor e só então provisiona o tenant.
 */
import 'server-only';

import {
  asaasProvider,
  BillingCircuitOpenError,
  BillingProviderError,
  BillingProviderUnreachableError,
  type PaymentProvider,
  type ProviderPayment,
  type ProviderSubscription,
} from '@/lib/payments/asaas';
import { env } from '@/lib/env';
import { buildApplicationUrl } from '@/lib/http/application-url';
import { metrics } from '@/lib/observability/metrics';
import { parseDocument } from '@/lib/validation/document';

import {
  activateSignupHostedCheckout,
  centsToReais,
  markSignupBillingIssue,
  readSignupHostedCheckoutTarget,
  recordSignupHostedCheckout,
  reserveSignupBillingAttempt,
  resetSignupHostedCheckout,
  type SignupBillingIntent,
  type SignupHostedCheckoutTarget,
} from './signup-billing';
import { provisionTenantFromSignup } from './signup-provision';

const CHECKOUT_EXPIRATION_MINUTES = 60;

export type StartSignupHostedCheckoutOutcome =
  | { ok: true; state: 'checkout_pending'; checkoutUrl: string }
  | {
      ok: false;
      reason:
        | 'gone'
        | 'no_plan'
        | 'invalid_plan'
        | 'conflict'
        | 'already_active'
        | 'reconcile_required'
        | 'declined'
        | 'provider_unreachable'
        | 'unavailable';
    };

export type CompleteSignupHostedCheckoutOutcome =
  | { ok: true; state: 'pending' | 'provisioned' }
  | {
      ok: false;
      reason: 'gone' | 'conflict' | 'provider_unreachable' | 'unavailable';
    };

export type AbandonSignupHostedCheckoutOutcome =
  | { ok: true; state: 'reset' | 'already_completed' }
  | {
      ok: false;
      reason: 'gone' | 'conflict' | 'provider_unreachable' | 'unavailable';
    };

function failureCodeOf(error: BillingProviderError): string {
  const raw = error.providerErrorCodes[0] ?? error.code ?? 'provider_rejected';
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/gu, '_')
    .slice(0, 64);
  return normalized.length > 0 ? normalized : 'provider_rejected';
}

function describe(intent: SignupBillingIntent): string {
  return `Qoro · plano ${intent.planCode} — ${intent.clinicName}`;
}

function checkoutCallbacks(publicOrigin: string): {
  successUrl: string;
  cancelUrl: string;
  expiredUrl: string;
} {
  const callback = (result: 'success' | 'cancelled' | 'expired') => {
    const url = new URL(
      buildApplicationUrl(publicOrigin, '/cadastro/pagamento', {
        allowInsecureLocalhost: env.NODE_ENV !== 'production',
      }),
    );
    url.searchParams.set('resultado', result);
    return url.toString();
  };
  return {
    successUrl: callback('success'),
    cancelUrl: callback('cancelled'),
    expiredUrl: callback('expired'),
  };
}

function trustedCheckoutUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const trustedHost = url.hostname === 'asaas.com' || url.hostname === 'sandbox.asaas.com';
    return url.protocol === 'https:' && trustedHost ? url.toString() : null;
  } catch {
    return null;
  }
}

async function compensateCheckout(client: PaymentProvider, checkoutId: string): Promise<void> {
  try {
    await client.cancelCheckout(checkoutId);
  } catch (error) {
    metrics.emit('signup.checkout.compensation_failed', { error });
  }
}

export async function startSignupHostedCheckout(input: {
  userId: string;
  publicOrigin?: string;
  client?: PaymentProvider;
}): Promise<StartSignupHostedCheckoutOutcome> {
  const client = input.client ?? asaasProvider;
  // Valida a configuração antes de reservar a linha.
  const callbacks = checkoutCallbacks(input.publicOrigin ?? env.APP_BASE_URL ?? '');
  const reserved = await reserveSignupBillingAttempt(input.userId);
  if (!reserved.ok) {
    if (reserved.reason === 'checkout_pending') {
      const checkoutUrl = trustedCheckoutUrl(reserved.checkoutUrl);
      return checkoutUrl
        ? { ok: true, state: 'checkout_pending', checkoutUrl }
        : { ok: false, reason: 'conflict' };
    }
    return { ok: false, reason: reserved.reason };
  }

  const { intent, rowVersion } = reserved;
  let checkoutId: string | null = null;
  try {
    const checkout = await client.createCheckout({
      kind: 'recurrent',
      value: centsToReais(intent.priceCents),
      itemName: `Qoro · ${intent.planCode}`,
      description: describe(intent),
      externalReference: intent.externalReference,
      minutesToExpire: CHECKOUT_EXPIRATION_MINUTES,
      callback: callbacks,
      subscription: {
        cycle: 'MONTHLY',
        nextDueDate: intent.nextDueDate,
      },
    });
    checkoutId = checkout.checkoutId;
    const checkoutUrl = trustedCheckoutUrl(checkout.link);
    if (
      !checkoutId ||
      !checkoutUrl ||
      (checkout.status !== 'ACTIVE' && checkout.status !== 'UNKNOWN')
    ) {
      if (checkoutId) await compensateCheckout(client, checkoutId);
      await markSignupBillingIssue({
        userId: input.userId,
        reservedVersion: rowVersion,
        outcome: 'failed',
        failureCode: 'checkout_response_invalid',
      });
      return { ok: false, reason: 'declined' };
    }

    const recorded = await recordSignupHostedCheckout({
      userId: input.userId,
      reservedVersion: rowVersion,
      asaasCheckoutId: checkoutId,
      checkoutUrl,
    });
    if (!recorded.ok) {
      await compensateCheckout(client, checkoutId);
      return { ok: false, reason: 'conflict' };
    }

    metrics.emit('signup.checkout.created', { planCode: intent.planCode });
    return { ok: true, state: 'checkout_pending', checkoutUrl };
  } catch (error) {
    if (error instanceof BillingProviderError) {
      if (checkoutId) await compensateCheckout(client, checkoutId);
      await markSignupBillingIssue({
        userId: input.userId,
        reservedVersion: rowVersion,
        outcome: 'failed',
        failureCode: failureCodeOf(error),
      });
      return { ok: false, reason: 'declined' };
    }
    if (
      error instanceof BillingProviderUnreachableError ||
      error instanceof BillingCircuitOpenError
    ) {
      await markSignupBillingIssue({
        userId: input.userId,
        reservedVersion: rowVersion,
        outcome: 'creation_unknown',
        failureCode: checkoutId ? 'checkout_persistence_unknown' : 'checkout_creation_unknown',
      });
      return { ok: false, reason: 'provider_unreachable' };
    }
    throw error;
  }
}

function subscriptionMatchesTarget(
  subscription: ProviderSubscription,
  target: SignupHostedCheckoutTarget,
): boolean {
  const externalReferenceMatches =
    subscription.externalReference === null ||
    subscription.externalReference === target.externalReference;
  const customerMatches = target.asaasCustomerId
    ? subscription.customerId === target.asaasCustomerId
    : Boolean(subscription.customerId);
  const firstDueDate = parseIsoDate(target.nextDueDate);
  const nextCycleDueDate = firstDueDate ? addCalendarMonth(firstDueDate) : null;
  const dueDateMatches =
    subscription.nextDueDate === target.nextDueDate ||
    (nextCycleDueDate !== null && subscription.nextDueDate === nextCycleDueDate);
  return (
    subscription.status === 'ACTIVE' &&
    customerMatches &&
    subscription.cycle === 'MONTHLY' &&
    subscription.billingType === 'CREDIT_CARD' &&
    dueDateMatches &&
    Math.round(subscription.value * 100) === target.priceCents &&
    externalReferenceMatches
  );
}

function parseIsoDate(raw: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function addCalendarMonth(date: { year: number; month: number; day: number }): string {
  const nextMonthIndex = date.month;
  const year = date.year + Math.floor(nextMonthIndex / 12);
  const monthIndex = nextMonthIndex % 12;
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const day = Math.min(date.day, lastDay);
  return `${year.toString().padStart(4, '0')}-${(monthIndex + 1)
    .toString()
    .padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

async function authoritativeSubscription(
  client: PaymentProvider,
  target: SignupHostedCheckoutTarget,
): Promise<ProviderSubscription | null | 'conflict'> {
  if (target.state === 'active' && target.asaasSubscriptionId) {
    const subscription = await client.getSubscription(target.asaasSubscriptionId);
    return subscriptionMatchesTarget(subscription, target) ? subscription : 'conflict';
  }

  const payment = await client.findPaymentByCheckoutSession(target.asaasCheckoutId, {
    attempts: 1,
    createdSince: target.attemptedOn,
  });
  if (!payment) return null;
  if (
    payment.checkoutSessionId !== target.asaasCheckoutId ||
    payment.billingType !== 'CREDIT_CARD' ||
    !payment.subscriptionId ||
    Math.round(payment.value * 100) !== target.priceCents ||
    payment.dueDate !== target.nextDueDate
  ) {
    return 'conflict';
  }
  const readback = await client.getSubscription(payment.subscriptionId);
  return subscriptionMatchesTarget(readback, target) ? readback : 'conflict';
}

async function paidPeriodAfterTrial(
  client: PaymentProvider,
  target: SignupHostedCheckoutTarget,
  subscription: ProviderSubscription,
): Promise<{ payment: ProviderPayment; through: Date } | null> {
  const payment = await client.findPaymentByCheckoutSession(target.asaasCheckoutId, {
    attempts: 1,
    createdSince: target.attemptedOn,
  });
  if (
    !payment ||
    payment.deleted ||
    (payment.status !== 'CONFIRMED' && payment.status !== 'RECEIVED') ||
    payment.checkoutSessionId !== target.asaasCheckoutId ||
    payment.subscriptionId !== subscription.subscriptionId ||
    payment.billingType !== 'CREDIT_CARD' ||
    Math.round(payment.value * 100) !== target.priceCents ||
    payment.dueDate !== target.nextDueDate
  ) {
    return null;
  }
  const periodEnd = new Date(`${subscription.nextDueDate}T00:00:00.000Z`);
  return Number.isFinite(periodEnd.getTime()) && periodEnd.getTime() > Date.now()
    ? { payment, through: periodEnd }
    : null;
}

/**
 * Cancela um Checkout pendente e só então libera uma nova tentativa.
 *
 * `cancelUrl` e `expiredUrl` são navegação, não prova financeira. Por isso a
 * função relê pagamentos antes da mutação e também depois de uma resposta 4xx
 * do cancelamento: um Checkout já pago nunca pode ser limpo por uma URL forjada
 * ou por duas abas disputando o retorno.
 */
export async function abandonSignupHostedCheckout(input: {
  userId: string;
  reason: 'cancelled' | 'expired';
  client?: PaymentProvider;
}): Promise<AbandonSignupHostedCheckoutOutcome> {
  const client = input.client ?? asaasProvider;
  const target = await readSignupHostedCheckoutTarget(input.userId);
  if (!target) return { ok: false, reason: 'gone' };
  if (target.state === 'active') return { ok: true, state: 'already_completed' };

  try {
    const beforeCancel = await authoritativeSubscription(client, target);
    if (beforeCancel === 'conflict') return { ok: false, reason: 'conflict' };
    if (beforeCancel) return { ok: true, state: 'already_completed' };

    try {
      await client.cancelCheckout(target.asaasCheckoutId);
    } catch (error) {
      if (
        !(error instanceof BillingProviderError) ||
        (error.httpStatus !== 400 && error.httpStatus !== 404)
      ) {
        throw error;
      }

      // 400/404 pode significar que o Asaas já fechou o Checkout. Releia antes
      // de liberar retry para não perder uma assinatura criada nessa janela.
      const afterRejectedCancel = await authoritativeSubscription(client, target);
      if (afterRejectedCancel === 'conflict') return { ok: false, reason: 'conflict' };
      if (afterRejectedCancel) return { ok: true, state: 'already_completed' };
    }

    const reset = await resetSignupHostedCheckout({
      userId: input.userId,
      expectedVersion: target.rowVersion,
      asaasCheckoutId: target.asaasCheckoutId,
      reason: input.reason,
    });
    if (!reset.ok) return { ok: false, reason: 'conflict' };

    metrics.emit('signup.checkout.abandoned', { reason: input.reason });
    return { ok: true, state: 'reset' };
  } catch (error) {
    if (
      error instanceof BillingProviderUnreachableError ||
      error instanceof BillingCircuitOpenError
    ) {
      return { ok: false, reason: 'provider_unreachable' };
    }
    if (error instanceof BillingProviderError) return { ok: false, reason: 'unavailable' };
    throw error;
  }
}

export async function completeSignupHostedCheckout(input: {
  userId: string;
  verifiedEmail: string;
  client?: PaymentProvider;
}): Promise<CompleteSignupHostedCheckoutOutcome> {
  const client = input.client ?? asaasProvider;
  let target = await readSignupHostedCheckoutTarget(input.userId);
  if (!target) return { ok: false, reason: 'gone' };

  try {
    const subscription = await authoritativeSubscription(client, target);
    if (subscription === null) return { ok: true, state: 'pending' };
    if (subscription === 'conflict') {
      metrics.emit('signup.checkout.subscription_mismatch', {});
      return { ok: false, reason: 'conflict' };
    }

    const expiredTrial = target.strictTrialDeadline && Date.now() >= Date.parse(target.trialEndsAt);
    const paidCheckout = expiredTrial
      ? await paidPeriodAfterTrial(client, target, subscription)
      : undefined;
    if (expiredTrial && !paidCheckout) return { ok: true, state: 'pending' };

    if (target.state === 'checkout_pending') {
      if (!subscription.customerId) return { ok: false, reason: 'conflict' };
      const activated = await activateSignupHostedCheckout({
        userId: input.userId,
        expectedVersion: target.rowVersion,
        asaasCheckoutId: target.asaasCheckoutId,
        asaasCustomerId: subscription.customerId,
        asaasSubscriptionId: subscription.subscriptionId,
      });
      if (!activated.ok) {
        const current = await readSignupHostedCheckoutTarget(input.userId);
        if (
          !current ||
          current.state !== 'active' ||
          current.asaasSubscriptionId !== subscription.subscriptionId
        ) {
          return { ok: false, reason: 'conflict' };
        }
        target = current;
      }
    }

    const customerId = subscription.customerId;
    if (!customerId) return { ok: false, reason: 'conflict' };
    const customer = await client.getCustomer(customerId, { attempts: 1 });
    const document =
      customer.customerId === customerId ? parseDocument(customer.cpfCnpj ?? '') : null;
    if (!document) {
      metrics.emit('signup.checkout.customer_mismatch', {});
      return { ok: false, reason: 'conflict' };
    }

    const provisioned = await provisionTenantFromSignup({
      userId: input.userId,
      verifiedEmail: input.verifiedEmail,
      cpfCnpj: document.digits,
      expectedAsaasSubscriptionId: subscription.subscriptionId,
      ...(paidCheckout && { paidCheckout }),
    });
    if (provisioned.ok) {
      return { ok: true, state: 'provisioned' };
    }
    if (provisioned.reason === 'gone') return { ok: false, reason: 'gone' };
    if (provisioned.reason === 'unavailable') return { ok: false, reason: 'unavailable' };
    return { ok: false, reason: 'conflict' };
  } catch (error) {
    if (
      error instanceof BillingProviderUnreachableError ||
      error instanceof BillingCircuitOpenError
    ) {
      return { ok: false, reason: 'provider_unreachable' };
    }
    if (error instanceof BillingProviderError) return { ok: false, reason: 'unavailable' };
    throw error;
  }
}
