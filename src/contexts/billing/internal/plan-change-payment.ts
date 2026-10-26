/**
 * Efeito externo do upgrade. A solicitação é persistida antes da chamada ao
 * Asaas. Contratos legados usam cobrança avulsa; a oferta 2026 usa Checkout
 * hospedado, cujo resultado incerto nunca dispara outro POST automaticamente.
 */
import 'server-only';

import { withTenant } from '@/lib/db/tenant';
import { env } from '@/lib/env';
import { buildApplicationUrl, resolvePreviewCallbackOrigin } from '@/lib/http/application-url';
import { metrics } from '@/lib/observability/metrics';
import { asaasProvider, BillingProviderError } from '@/lib/payments/asaas';

import { isOffer2026PlanCode } from '../proposed-offer';
import {
  claimUpgradeCheckout,
  finishUpgradeCheckoutCreation,
  getUpgradePaymentContext,
  linkUpgradePayment,
  planChangeExternalReference,
  PlanChangeError,
} from './plan-changes';

const UPGRADE_CHECKOUT_MINUTES = 60;
const UPGRADE_CHECKOUT_LEASE_MS = 2 * 60_000;

function upgradeCheckoutCallbacks(): {
  successUrl: string;
  cancelUrl: string;
  expiredUrl: string;
} {
  const base = env.VERCEL_ENV === 'preview' ? resolvePreviewCallbackOrigin() : env.APP_BASE_URL;
  if (!base)
    throw new PlanChangeError(
      'URL de retorno do Checkout não configurada.',
      'checkout_callback_missing',
    );
  const root = buildApplicationUrl(base, '/', {
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

export type UpgradePaymentResult = {
  changeId: string;
  paymentId: string;
  paymentUrl: string | null;
  status: string;
};

async function ensureOfferUpgradeCheckout(
  clinicId: string,
  changeId: string,
  context: Awaited<ReturnType<typeof getUpgradePaymentContext>>,
): Promise<UpgradePaymentResult> {
  if (context.checkoutCreationState === 'ready' && context.providerPaymentUrl) {
    if (!context.providerCheckoutExpiresAt || context.providerCheckoutExpiresAt <= new Date()) {
      throw new PlanChangeError(
        'Checkout expirou. Não repita o pagamento; contate o suporte para conciliar a tentativa.',
        'upgrade_checkout_expired',
      );
    }
    return {
      changeId,
      paymentId: context.providerCheckoutId ?? '',
      paymentUrl: context.providerPaymentUrl,
      status: 'PENDING',
    };
  }
  if (context.checkoutCreationState) {
    throw new PlanChangeError(
      context.checkoutCreationState === 'creation_unknown'
        ? 'O Asaas pode ter criado um Checkout, mas a resposta se perdeu. Contate o suporte; uma segunda cobrança não será criada automaticamente.'
        : 'O Checkout ainda está sendo criado. Atualize a assinatura em instantes.',
      'upgrade_checkout_pending',
    );
  }

  const callback = upgradeCheckoutCallbacks();
  const claimed = await withTenant(clinicId, (tx) =>
    claimUpgradeCheckout(tx, clinicId, changeId, new Date(Date.now() + UPGRADE_CHECKOUT_LEASE_MS)),
  );
  if (!claimed)
    throw new PlanChangeError('Checkout já está sendo criado.', 'upgrade_checkout_pending');

  let checkout;
  try {
    checkout = await asaasProvider.createCheckout({
      kind: 'detached',
      customerId: context.customerId,
      value: context.amountCents / 100,
      itemName: 'Médico adicional Qoro',
      description: `Ajuste proporcional para ${context.targetPlanName}`,
      externalReference: planChangeExternalReference(changeId),
      minutesToExpire: UPGRADE_CHECKOUT_MINUTES,
      callback,
    });
  } catch (error) {
    const definitive =
      error instanceof BillingProviderError &&
      error.httpStatus !== null &&
      error.httpStatus >= 400 &&
      error.httpStatus < 500 &&
      error.httpStatus !== 408 &&
      error.httpStatus !== 429;
    await withTenant(clinicId, (tx) =>
      finishUpgradeCheckoutCreation(tx, clinicId, changeId, {
        state: definitive ? 'failed' : 'creation_unknown',
      }),
    );
    throw error;
  }

  if (checkout.status !== 'ACTIVE' || !checkout.link || !checkout.checkoutId) {
    if (checkout.checkoutId) {
      await asaasProvider.cancelCheckout(checkout.checkoutId);
      await withTenant(clinicId, (tx) =>
        finishUpgradeCheckoutCreation(tx, clinicId, changeId, { state: 'failed' }),
      );
    } else {
      await withTenant(clinicId, (tx) =>
        finishUpgradeCheckoutCreation(tx, clinicId, changeId, { state: 'creation_unknown' }),
      );
    }
    throw new PlanChangeError('Asaas não devolveu Checkout pagável.', 'upgrade_checkout_invalid');
  }

  const checkoutId = checkout.checkoutId;
  const checkoutUrl = checkout.link;
  try {
    await withTenant(clinicId, (tx) =>
      finishUpgradeCheckoutCreation(tx, clinicId, changeId, {
        state: 'ready',
        checkoutId,
        checkoutUrl,
        expiresAt: new Date(Date.now() + UPGRADE_CHECKOUT_MINUTES * 60_000),
      }),
    );
  } catch (error) {
    try {
      await asaasProvider.cancelCheckout(checkoutId);
      await withTenant(clinicId, (tx) =>
        finishUpgradeCheckoutCreation(tx, clinicId, changeId, { state: 'failed' }),
      );
    } catch (cleanupError) {
      metrics.emit('billing.upgrade.checkout_compensation_error', {
        changeId,
        error: cleanupError,
      });
    }
    throw error;
  }
  return { changeId, paymentId: checkoutId, paymentUrl: checkoutUrl, status: 'PENDING' };
}

export async function ensureUpgradePayment(
  clinicId: string,
  changeId: string,
): Promise<UpgradePaymentResult> {
  const context = await withTenant(clinicId, (tx) =>
    getUpgradePaymentContext(tx, clinicId, changeId),
  );
  if (context.providerPaymentId) {
    return {
      changeId,
      paymentId: context.providerPaymentId,
      paymentUrl: context.providerPaymentUrl,
      status: 'PENDING',
    };
  }

  if (isOffer2026PlanCode(context.targetPlanCode)) {
    return ensureOfferUpgradeCheckout(clinicId, changeId, context);
  }

  const externalReference = planChangeExternalReference(changeId);
  let payment = await asaasProvider.findPaymentByExternalReference(externalReference, {
    attempts: 1,
  });
  if (!payment) {
    payment = await asaasProvider.generateInvoice({
      customerId: context.customerId,
      value: context.amountCents / 100,
      dueDate: context.dueDate,
      billingType: 'UNDEFINED',
      description: `Upgrade proporcional para o plano ${context.targetPlanName}`,
      externalReference,
    });
  }

  await withTenant(clinicId, (tx) => linkUpgradePayment(tx, clinicId, changeId, payment));
  return {
    changeId,
    paymentId: payment.paymentId,
    paymentUrl: payment.invoiceUrl,
    status: payment.status,
  };
}
