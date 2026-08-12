/**
 * Asaas LIVE check (C13 — 13.6.1). Chamadas REAIS ao sandbox Asaas provando o
 * adapter de ponta a ponta: createCustomer → createSubscription → getSubscription.
 * Mesmo espírito do gate REAL do Gemini (C11). NÃO toca o banco.
 *
 * Requer ASAAS_API_KEY (sandbox) no .env.local + ASAAS_BASE_URL sandbox.
 * Uso: `pnpm billing:live-check`
 */
import './_env';

import { asaasProvider } from '@/contexts/billing/internal/providers/asaas';
import { redactOpaqueId } from '@/lib/sanitize/redact';

function tomorrowISO(): string {
  const d = new Date(Date.now() + 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  if (!process.env.ASAAS_API_KEY) {
    console.error('[asaas-live] ASAAS_API_KEY ausente no .env.local — abortando.');
    process.exit(1);
  }
  console.log('[asaas-live] base:', process.env.ASAAS_BASE_URL ?? '(default sandbox)');

  const customer = await asaasProvider.createCustomer({
    name: `Live Check ${Date.now()}`,
    email: `livecheck+${Date.now()}@qoro.dev`,
    cpfCnpj: '24971563792', // CPF de teste (sandbox)
    phone: '11999990000',
  });
  console.log('[asaas-live] customer:', redactOpaqueId(customer.customerId));

  const sub = await asaasProvider.createSubscription({
    customerId: customer.customerId,
    value: 149,
    cycle: 'MONTHLY',
    nextDueDate: tomorrowISO(),
    description: 'ClinicaOS — Solo (live check)',
    billingType: 'BOLETO',
  });
  console.log('[asaas-live] subscription:', redactOpaqueId(sub.subscriptionId));

  const fetched = await asaasProvider.getSubscription(sub.subscriptionId);
  console.log('[asaas-live] subscription status:', fetched.status);

  console.log('[asaas-live] OK — adapter Asaas validado contra o sandbox.');
  process.exit(0);
}

void main();
