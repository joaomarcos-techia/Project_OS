/**
 * Prova descartável do payload de Checkout do médico extra na conta Sandbox
 * local. Não paga: cria Checkout hospedado e cancela a sessão.
 */
import { randomUUID } from 'node:crypto';

import { config } from 'dotenv';

config({ path: process.env.QORO_ENV_PATH ?? '.env.local' });

const { assertDevContext } = await import('./_env');
const { BillingProviderError, createAsaasClient } = await import('@/lib/payments/asaas');

if (process.env.ASAAS_UPGRADE_CHECKOUT_PROBE !== 'DEV_SANDBOX_ONLY') {
  throw new Error('Exige ASAAS_UPGRADE_CHECKOUT_PROBE=DEV_SANDBOX_ONLY');
}
assertDevContext();

const baseUrl = process.env.ASAAS_BASE_URL_DEV;
const apiKey = process.env.ASAAS_API_KEY_DEV;
if (!baseUrl || !apiKey) throw new Error('Asaas DEV não configurado');
const target = new URL(baseUrl);
if (
  target.protocol !== 'https:' ||
  !(
    (target.hostname === 'api-sandbox.asaas.com' && target.pathname === '/v3') ||
    (target.hostname === 'sandbox.asaas.com' && target.pathname === '/api/v3')
  )
) {
  throw new Error('Asaas precisa apontar ao Sandbox oficial');
}

const provider = createAsaasClient({ apiKey, baseUrl });
const id = randomUUID();
let checkoutId: string | null = null;
const cleanupErrors: string[] = [];
let validationDetail: string | null = null;
try {
  const callbackBase =
    'https://project-os-git-integration-prici-c5e6c6-clinic-os-v2-s-projects.vercel.app/';
  const response = await fetch(`${baseUrl}/checkouts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'ClinicaOS/1.0 (billing-integration)',
      access_token: apiKey,
    },
    body: JSON.stringify({
      billingTypes: ['PIX', 'CREDIT_CARD'],
      chargeTypes: ['DETACHED'],
      minutesToExpire: 60,
      externalReference: `subscription-change:${id}`,
      callback: {
        successUrl: `${callbackBase}?payment=success`,
        cancelUrl: `${callbackBase}?payment=cancelled`,
        expiredUrl: `${callbackBase}?payment=expired`,
      },
      items: [
        {
          name: 'Médico adicional Qoro',
          description: 'Ajuste proporcional para Clínica · 3 médicos',
          quantity: 1,
          value: 98,
        },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    if (body && typeof body === 'object' && 'errors' in body && Array.isArray(body.errors)) {
      validationDetail = body.errors
        .filter((error): error is { description: string } =>
          Boolean(
            error &&
            typeof error === 'object' &&
            'description' in error &&
            typeof error.description === 'string',
          ),
        )
        .map((error) => error.description.slice(0, 300))
        .join('; ');
    }
    throw new BillingProviderError('Checkout recusado', 'billing_provider_error', response.status);
  }
  if (!body || typeof body !== 'object' || !('id' in body) || typeof body.id !== 'string') {
    throw new Error('Asaas não devolveu ID de Checkout');
  }
  checkoutId = body.id;
  if (!('status' in body) || body.status !== 'ACTIVE') {
    throw new Error('Asaas não devolveu Checkout ativo');
  }
  console.log('PASS payload: Checkout hospedado sem customer pré-fixado aceito no Sandbox');
} catch (error) {
  if (error instanceof BillingProviderError) {
    console.error(
      `FAIL Checkout Sandbox local: HTTP ${error.httpStatus ?? 'local'}, códigos ${error.providerErrorCodes.join(',') || error.code}; validação: ${validationDetail ?? 'indisponível'}`,
    );
  } else {
    console.error(
      `FAIL Checkout Sandbox local: ${error instanceof Error ? error.name : 'unknown'}`,
    );
  }
  process.exitCode = 1;
} finally {
  if (checkoutId) {
    try {
      await provider.cancelCheckout(checkoutId);
    } catch {
      cleanupErrors.push('Checkout Sandbox');
    }
  }
  if (cleanupErrors.length > 0) {
    console.error(`FAIL cleanup: ${cleanupErrors.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('PASS cleanup: Checkout descartável encerrado');
  }
}
