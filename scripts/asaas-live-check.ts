/**
 * Asaas LIVE check (C13 — 13.6.1). Chamadas REAIS ao Sandbox provando o
 * adapter de assinatura: createCustomer → createSubscription → getSubscription.
 *
 * Não toca o banco. Host, path e chave precisam ser de homologação. Assinatura
 * e customer são sempre limpos com readback; falha de cleanup reprova a execução.
 *
 * Uso: `pnpm billing:live-check`
 */
import './_env';

import { asaasProvider } from '@/lib/payments/asaas';
import { redactOpaqueId } from '@/lib/sanitize/redact';

const ALLOWED_HOSTS = new Set(['sandbox.asaas.com', 'api-sandbox.asaas.com']);

function tomorrowISO(): string {
  const d = new Date(Date.now() + 86_400_000);
  return d.toISOString().slice(0, 10);
}

function sandboxConfig(): { apiKey: string; baseUrl: URL } {
  const apiKey = process.env.ASAAS_API_KEY;
  const rawBaseUrl = process.env.ASAAS_BASE_URL ?? 'https://sandbox.asaas.com/api/v3';
  if (!apiKey) throw new Error('[asaas-live] ASAAS_API_KEY ausente.');
  if (!apiKey.includes('hmlg')) {
    throw new Error('[asaas-live] a chave não possui o marcador de homologação.');
  }

  const baseUrl = new URL(rawBaseUrl);
  const expectedPath = baseUrl.hostname === 'api-sandbox.asaas.com' ? '/v3' : '/api/v3';
  if (
    baseUrl.protocol !== 'https:' ||
    !ALLOWED_HOSTS.has(baseUrl.hostname) ||
    baseUrl.pathname.replace(/\/$/u, '') !== expectedPath
  ) {
    throw new Error(
      '[asaas-live] ASAAS_BASE_URL deve apontar para a API HTTPS oficial do Sandbox.',
    );
  }
  return { apiKey, baseUrl };
}

async function customerReadback(baseUrl: URL, apiKey: string, customerId: string): Promise<void> {
  const response = await fetch(new URL(`customers/${customerId}`, `${baseUrl.toString()}/`), {
    headers: { access_token: apiKey },
  });
  if (response.status === 404) return;
  const body = (await response.json().catch(() => ({}))) as { deleted?: unknown };
  if (response.ok && body.deleted === true) return;
  throw new Error(`customer permaneceu acessível após cleanup (HTTP ${response.status}).`);
}

async function main(): Promise<void> {
  const { apiKey, baseUrl } = sandboxConfig();
  let customerId = '';
  let subscriptionId = '';
  let primaryError: unknown;

  try {
    const stamp = Date.now();
    const customer = await asaasProvider.createCustomer({
      name: `Live Check ${stamp}`,
      email: `livecheck+${stamp}@qoro.dev`,
      cpfCnpj: '24971563792',
      phone: '11999990000',
    });
    customerId = customer.customerId;
    console.log('[asaas-live] customer:', redactOpaqueId(customerId));

    const subscription = await asaasProvider.createSubscription({
      customerId,
      value: 149,
      cycle: 'MONTHLY',
      nextDueDate: tomorrowISO(),
      description: 'ClinicaOS — Solo (live check)',
      billingType: 'BOLETO',
    });
    subscriptionId = subscription.subscriptionId;
    console.log('[asaas-live] subscription:', redactOpaqueId(subscriptionId));

    const fetched = await asaasProvider.getSubscription(subscriptionId);
    if (fetched.status !== 'ACTIVE') {
      throw new Error(`[asaas-live] assinatura nasceu em estado ${fetched.status}, não ACTIVE.`);
    }
    console.log('[asaas-live] create/readback PASS: ACTIVE.');
  } catch (error) {
    primaryError = error;
  }

  const cleanupErrors: unknown[] = [];
  if (subscriptionId) {
    try {
      await asaasProvider.cancelSubscription(subscriptionId);
      const cancelled = await asaasProvider.getSubscription(subscriptionId);
      if (cancelled.status !== 'INACTIVE') {
        throw new Error(`assinatura permaneceu ${cancelled.status} após cancelamento.`);
      }
      console.log('[asaas-live] cleanup subscription PASS: INACTIVE.');
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (customerId) {
    try {
      await asaasProvider.deleteCustomer(customerId);
      await customerReadback(baseUrl, apiKey, customerId);
      console.log('[asaas-live] cleanup customer PASS: ausente no readback.');
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (primaryError && cleanupErrors.length > 0) {
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      '[asaas-live] a prova falhou e o cleanup também falhou.',
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, '[asaas-live] cleanup incompleto.');
  }
  console.log('[asaas-live] PASS — adapter e cleanup validados no Sandbox.');
}

void main().catch((error: unknown) => {
  console.error('[asaas-live] FAIL:', error instanceof Error ? error.message : 'erro desconhecido');
  process.exitCode = 1;
});
