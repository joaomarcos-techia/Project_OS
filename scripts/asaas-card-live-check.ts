/**
 * Homologação externa do checkout transparente contra o Asaas Sandbox.
 *
 * Cria um customer e uma assinatura com o cartão fictício aprovado, confere a
 * assinatura e a cancela ao final. Não toca o banco local e não movimenta
 * valores reais. O vencimento replica o trial de 14 dias do onboarding.
 *
 * Uso: pnpm billing:card-live-check
 */
import './_env';

import { asaasProvider } from '@/lib/payments/asaas';
import { redactOpaqueId } from '@/lib/sanitize/redact';

const SANDBOX_CARD = {
  holderName: 'Checkout Sandbox',
  number: '4444444444444444',
  expiryMonth: '12',
  expiryYear: '2030',
  ccv: '123',
} as const;

function trialDueDate(): string {
  return new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
}

function assertSandboxBaseUrl(): void {
  const baseUrl = process.env.ASAAS_BASE_URL;
  if (!baseUrl || !new URL(baseUrl).hostname.includes('sandbox')) {
    throw new Error(
      '[asaas-card-live] ASAAS_BASE_URL precisa apontar explicitamente para o Sandbox.',
    );
  }
}

async function main(): Promise<void> {
  assertSandboxBaseUrl();
  const stamp = Date.now();
  const customer = await asaasProvider.createCustomer({
    name: `Checkout sandbox ${stamp}`,
    email: `checkout-sandbox+${stamp}@qoro.dev`,
    cpfCnpj: '24971563792',
    phone: '11999990000',
  });

  let subscriptionId: string | null = null;
  try {
    const subscription = await asaasProvider.createSubscriptionWithCard({
      customerId: customer.customerId,
      value: 149,
      cycle: 'MONTHLY',
      nextDueDate: trialDueDate(),
      description: 'ClinicaOS checkout transparente - sandbox',
      creditCard: SANDBOX_CARD,
      holderInfo: {
        name: SANDBOX_CARD.holderName,
        email: `checkout-sandbox+${stamp}@qoro.dev`,
        cpfCnpj: '24971563792',
        postalCode: '89223005',
        addressNumber: '277',
        phone: '11999990000',
      },
      remoteIp: '127.0.0.1',
    });
    subscriptionId = subscription.subscriptionId;
    const fetched = await asaasProvider.getSubscription(subscriptionId);

    console.log('[asaas-card-live] customer:', redactOpaqueId(customer.customerId));
    console.log('[asaas-card-live] subscription:', redactOpaqueId(fetched.subscriptionId));
    console.log('[asaas-card-live] subscription status:', fetched.status);
    console.log('[asaas-card-live] token returned:', subscription.creditCardToken !== null);
  } finally {
    if (subscriptionId) {
      await asaasProvider.cancelSubscription(subscriptionId);
      console.log('[asaas-card-live] cleanup: subscription cancelled');
    }
  }
}

void main().catch((error: unknown) => {
  console.error(
    '[asaas-card-live] failed:',
    error instanceof Error ? error.message : 'unknown error',
  );
  process.exitCode = 1;
});
