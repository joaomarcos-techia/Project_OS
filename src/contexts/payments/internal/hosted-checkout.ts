/**
 * Orquestração comum do Checkout hospedado de sinal/restante (D24/D57/D58).
 *
 * A dívida/lease nasce no banco antes do POST. O Asaas não oferece
 * idempotency-key nem consulta pública de Checkout por referência; portanto uma
 * falha indeterminada vira `creation_unknown` e nunca retry cego.
 */
import { env } from '@/lib/env';
import { buildApplicationUrl } from '@/lib/http/application-url';
import { metrics } from '@/lib/observability/metrics';
import {
  BillingProviderError,
  type AsaasClient,
  type ProviderCheckout,
} from '@/lib/payments/asaas';

import {
  activateCheckoutGeneration,
  claimInitialCheckoutCharge,
  claimRemainderCheckoutRenewal,
  markCheckoutCreationIssue,
  type RemainderCheckoutRenewalCandidate,
} from './charge-store';

const CHECKOUT_MINUTES_MIN = 10;
const CHECKOUT_MINUTES_MAX = 1_440;
const CHECKOUT_LEASE_MS = 2 * 60 * 1000;

export interface CheckoutWindow {
  expiresAt: Date;
  minutesToExpire: number;
}

/** Nunca promete ao Asaas mais tempo do que a janela local permite. */
export function resolveCheckoutWindow(now: Date, collectionExpiresAt: Date): CheckoutWindow | null {
  const availableMinutes = Math.floor(
    (collectionExpiresAt.getTime() - now.getTime()) / (60 * 1000),
  );
  const minutesToExpire = Math.min(CHECKOUT_MINUTES_MAX, availableMinutes);
  if (minutesToExpire < CHECKOUT_MINUTES_MIN) return null;
  return {
    minutesToExpire,
    expiresAt: new Date(now.getTime() + minutesToExpire * 60 * 1000),
  };
}

function checkoutCallbacks(): {
  successUrl: string;
  cancelUrl: string;
  expiredUrl: string;
} {
  if (!env.APP_BASE_URL) {
    throw new Error('[payments] APP_BASE_URL é obrigatória para callback do Checkout');
  }
  const root = buildApplicationUrl(env.APP_BASE_URL, '/', {
    allowInsecureLocalhost: env.NODE_ENV !== 'production',
  });
  const callback = (result: 'success' | 'cancelled' | 'expired') => {
    const url = new URL(root);
    url.searchParams.set('payment', result);
    return url.toString();
  };
  return {
    successUrl: callback('success'),
    cancelUrl: callback('cancelled'),
    expiredUrl: callback('expired'),
  };
}

export type CreateHostedCheckoutOutcome =
  | 'created'
  | 'existing'
  | 'account_paused'
  | 'window_too_short'
  | 'unsupported_condition';

function supportsHostedCheckoutCondition(
  paymentMethod: 'pix' | 'credit_card' | null,
  installmentCount: number | null,
): boolean {
  if (paymentMethod === null) return installmentCount === null;
  if (paymentMethod === 'pix') return installmentCount === null;
  // O Checkout hospedado aceita um MAXIMO de parcelas, nao uma quantidade exata.
  return installmentCount === 1;
}

interface CheckoutClaim {
  chargeId: string;
  generationId: string;
  generation: number;
  externalReference: string;
}

async function provisionClaimedCheckout(input: {
  client: AsaasClient;
  clinicId: string;
  amount: number;
  description: string;
  claim: CheckoutClaim;
  window: CheckoutWindow;
  paymentMethod: 'pix' | 'credit_card' | null;
  installmentCount: number | null;
}): Promise<'created' | 'existing'> {
  let checkout: ProviderCheckout;
  try {
    checkout = await input.client.createCheckout({
      value: input.amount,
      description: input.description,
      externalReference: input.claim.externalReference,
      minutesToExpire: input.window.minutesToExpire,
      callback: checkoutCallbacks(),
      ...(input.paymentMethod
        ? { billingTypes: [input.paymentMethod === 'pix' ? 'PIX' : 'CREDIT_CARD'] as const }
        : {}),
    });
  } catch (error) {
    const definitive = error instanceof BillingProviderError;
    await markCheckoutCreationIssue({
      clinicId: input.clinicId,
      chargeId: input.claim.chargeId,
      generationId: input.claim.generationId,
      outcome: definitive ? 'failed' : 'creation_unknown',
      failureCode: definitive
        ? (error.providerErrorCodes[0] ?? error.code)
        : 'checkout_creation_unknown',
      resolvedAt: new Date(),
    });
    throw error;
  }

  if (checkout.status !== 'ACTIVE' || !checkout.link) {
    await markCheckoutCreationIssue({
      clinicId: input.clinicId,
      chargeId: input.claim.chargeId,
      generationId: input.claim.generationId,
      outcome: 'failed',
      failureCode: 'checkout_response_invalid',
      resolvedAt: new Date(),
    });
    if (checkout.checkoutId) {
      try {
        await input.client.cancelCheckout(checkout.checkoutId);
      } catch (error) {
        metrics.emit('payments.checkout.cleanup_failed', {
          clinicId: input.clinicId,
          chargeId: input.claim.chargeId,
          error,
        });
      }
    }
    throw new BillingProviderError(
      'Asaas devolveu Checkout sem estado/link pagável.',
      'checkout_response_invalid',
    );
  }

  const activated = await activateCheckoutGeneration({
    clinicId: input.clinicId,
    chargeId: input.claim.chargeId,
    generationId: input.claim.generationId,
    generation: input.claim.generation,
    providerCheckoutId: checkout.checkoutId,
    checkoutUrl: checkout.link,
    expiresAt: input.window.expiresAt,
    activatedAt: new Date(),
  });
  if (!activated) {
    try {
      await input.client.cancelCheckout(checkout.checkoutId);
    } catch (error) {
      metrics.emit('payments.checkout.cleanup_failed', {
        clinicId: input.clinicId,
        chargeId: input.claim.chargeId,
        error,
      });
    }
    return 'existing';
  }
  return 'created';
}

export async function createInitialHostedCheckout(input: {
  client: AsaasClient;
  clinicId: string;
  appointmentId: string;
  patientId: string;
  kind: 'deposit' | 'remainder';
  amount: number;
  description: string;
  holdExpiresAt: Date | null;
  collectionExpiresAt: Date;
  now?: Date;
  paymentMethod?: 'pix' | 'credit_card' | null;
  installmentCount?: number | null;
}): Promise<CreateHostedCheckoutOutcome> {
  if (
    !supportsHostedCheckoutCondition(input.paymentMethod ?? null, input.installmentCount ?? null)
  ) {
    metrics.emit('payments.checkout.unsupported_commercial_condition', {
      clinicId: input.clinicId,
      appointmentId: input.appointmentId,
      paymentMethod: input.paymentMethod,
      installmentCount: input.installmentCount,
    });
    return 'unsupported_condition';
  }
  const now = input.now ?? new Date();
  const window = resolveCheckoutWindow(now, input.collectionExpiresAt);
  if (!window) return 'window_too_short';
  // Valida a configuração antes de gravar a intenção local.
  checkoutCallbacks();

  const claim = await claimInitialCheckoutCharge({
    clinicId: input.clinicId,
    appointmentId: input.appointmentId,
    patientId: input.patientId,
    kind: input.kind,
    amount: input.amount,
    holdExpiresAt: input.holdExpiresAt,
    collectionExpiresAt: input.collectionExpiresAt,
    checkoutExpiresAt: window.expiresAt,
    leaseUntil: new Date(now.getTime() + CHECKOUT_LEASE_MS),
    requestedPaymentMethod: input.paymentMethod ?? null,
    requestedInstallmentCount: input.installmentCount ?? null,
  });
  if (claim.state === 'account_paused') return 'account_paused';
  if (claim.state === 'existing') return 'existing';
  return provisionClaimedCheckout({
    client: input.client,
    clinicId: input.clinicId,
    amount: input.amount,
    description: input.description,
    claim,
    window,
    paymentMethod: input.paymentMethod ?? null,
    installmentCount: input.installmentCount ?? null,
  });
}

export type RenewHostedCheckoutOutcome =
  | 'created'
  | 'lost'
  | 'account_paused'
  | 'payment_exists'
  | 'window_ended'
  | 'unsupported_condition';

/** Renova somente se a geração anterior não produziu cobrança no Asaas. */
export async function renewRemainderHostedCheckout(input: {
  client: AsaasClient;
  clinicId: string;
  candidate: RemainderCheckoutRenewalCandidate;
  now?: Date;
}): Promise<RenewHostedCheckoutOutcome> {
  if (
    !supportsHostedCheckoutCondition(
      input.candidate.requestedPaymentMethod,
      input.candidate.requestedInstallmentCount,
    )
  ) {
    metrics.emit('payments.checkout.unsupported_commercial_condition', {
      clinicId: input.clinicId,
      appointmentId: input.candidate.appointmentId,
      paymentMethod: input.candidate.requestedPaymentMethod,
      installmentCount: input.candidate.requestedInstallmentCount,
    });
    return 'unsupported_condition';
  }
  const now = input.now ?? new Date();
  const window = resolveCheckoutWindow(now, input.candidate.collectionExpiresAt);
  if (!window) return 'window_ended';
  checkoutCallbacks();

  const payment = await input.client.findPaymentByCheckoutSession(
    input.candidate.providerCheckoutId,
    { attempts: 1 },
  );
  if (payment && !payment.deleted) return 'payment_exists';

  const claim = await claimRemainderCheckoutRenewal({
    clinicId: input.clinicId,
    candidate: input.candidate,
    checkoutExpiresAt: window.expiresAt,
    leaseUntil: new Date(now.getTime() + CHECKOUT_LEASE_MS),
    now,
  });
  if (claim.state === 'account_paused') return 'account_paused';
  if (claim.state === 'lost') return 'lost';

  const outcome = await provisionClaimedCheckout({
    client: input.client,
    clinicId: input.clinicId,
    amount: input.candidate.amount,
    description: 'Restante do atendimento',
    claim,
    window,
    paymentMethod: input.candidate.requestedPaymentMethod,
    installmentCount: input.candidate.requestedInstallmentCount,
  });
  return outcome === 'created' ? 'created' : 'lost';
}
