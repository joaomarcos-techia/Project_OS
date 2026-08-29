/**
 * E2E real e opt-in do Checkout hospedado do Asaas Sandbox.
 *
 * O script cria um Checkout descartavel, preenche o cartao ficticio oficial no
 * formulario hospedado e limpa o recurso no fim. Ele nunca aceita um host de
 * producao e nao persiste nem imprime PAN, CVV, PII ou credenciais.
 *
 * Uso:
 *   ASAAS_CHECKOUT_E2E=ALLOW_SANDBOX_PAYMENT pnpm payments:checkout-e2e
 *   ASAAS_CHECKOUT_E2E=ALLOW_SANDBOX_PAYMENT ASAAS_CHECKOUT_E2E_INTERACTIVE=1 pnpm payments:checkout-e2e
 */
import './_env';

import { chromium, type Page } from '@playwright/test';

const OPT_IN_VALUE = 'ALLOW_SANDBOX_PAYMENT';
const ALLOWED_API_HOSTS = new Set(['api-sandbox.asaas.com', 'sandbox.asaas.com']);
const CHECKOUT_VALUE = 10;
const CHECKOUT_EXPIRATION_MINUTES = 10;
const PAYMENT_POLL_ATTEMPTS = 30;
const INTERACTIVE_PAYMENT_POLL_ATTEMPTS = 270;
const PAYMENT_POLL_INTERVAL_MS = 2_000;
const SETTLED_STATUSES = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH']);
const REFUNDED_STATUSES = new Set(['REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS']);

const SYNTHETIC_CUSTOMER = {
  name: 'Paciente E2E Checkout',
  email: 'checkout-e2e@qoro.dev',
  cpfCnpj: '24971563792',
  phone: '11999990000',
  postalCode: '89223005',
  address: 'Rua Blumenau',
  addressNumber: '277',
  province: 'America',
} as const;

const SANDBOX_CARD = {
  number: '4444444444444444',
  holderName: 'Paciente E2E Checkout',
  expiryDate: '12/30',
  ccv: '123',
} as const;

type JsonObject = Record<string, unknown>;
type CheckoutMethod = 'CREDIT_CARD' | 'PIX';

type CheckoutResponse = {
  id: string;
  link: string;
  status: string;
};

type PaymentSummary = {
  id: string;
  status: string;
  billingType: string;
  deleted?: boolean;
  checkoutSession?: string | null;
};

function assertSandboxConfiguration(): { apiBaseUrl: URL; apiKey: string } {
  if (process.env.ASAAS_CHECKOUT_E2E !== OPT_IN_VALUE) {
    throw new Error(
      `[asaas-checkout-e2e] opt-in ausente. Defina ASAAS_CHECKOUT_E2E=${OPT_IN_VALUE}.`,
    );
  }

  const configuredBaseUrl = process.env.ASAAS_BASE_URL;
  const apiKey = process.env.ASAAS_API_KEY;
  if (!configuredBaseUrl || !apiKey) {
    throw new Error('[asaas-checkout-e2e] ASAAS_BASE_URL e ASAAS_API_KEY sao obrigatorias.');
  }

  const apiBaseUrl = new URL(configuredBaseUrl);
  if (
    apiBaseUrl.protocol !== 'https:' ||
    !ALLOWED_API_HOSTS.has(apiBaseUrl.hostname) ||
    apiBaseUrl.port !== '' ||
    apiBaseUrl.username !== '' ||
    apiBaseUrl.password !== '' ||
    apiBaseUrl.search !== '' ||
    apiBaseUrl.hash !== ''
  ) {
    throw new Error(
      '[asaas-checkout-e2e] somente hosts HTTPS oficiais do Asaas Sandbox sao aceitos.',
    );
  }

  const normalizedPath = apiBaseUrl.pathname.replace(/\/$/, '');
  const expectedPath = apiBaseUrl.hostname === 'api-sandbox.asaas.com' ? '/v3' : '/api/v3';
  if (normalizedPath !== expectedPath) {
    throw new Error(`[asaas-checkout-e2e] caminho da API Sandbox deve ser ${expectedPath}.`);
  }

  return { apiBaseUrl, apiKey };
}

function interactiveMode(): boolean {
  const value = process.env.ASAAS_CHECKOUT_E2E_INTERACTIVE;
  if (value === undefined || value === '0') return false;
  if (value === '1') return true;
  throw new Error('[asaas-checkout-e2e] ASAAS_CHECKOUT_E2E_INTERACTIVE aceita somente 0 ou 1.');
}

function checkoutMethod(): CheckoutMethod {
  const value = process.env.ASAAS_CHECKOUT_E2E_METHOD ?? 'CREDIT_CARD';
  if (value !== 'CREDIT_CARD' && value !== 'PIX') {
    throw new Error('[asaas-checkout-e2e] ASAAS_CHECKOUT_E2E_METHOD deve ser CREDIT_CARD ou PIX.');
  }
  return value;
}

function endpoint(baseUrl: URL, path: string): URL {
  const normalizedBase = baseUrl.toString().replace(/\/$/, '');
  return new URL(`${normalizedBase}/${path.replace(/^\//, '')}`);
}

async function asaasRequest<T>(
  apiBaseUrl: URL,
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(endpoint(apiBaseUrl, path), {
    ...init,
    headers: {
      accept: 'application/json',
      access_token: apiKey,
      'content-type': 'application/json',
      ...init?.headers,
    },
  });

  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(
      `[asaas-checkout-e2e] API Asaas recusou ${path} (HTTP ${response.status}): ${JSON.stringify(summarizeProviderError(body))}`,
    );
  }
  return body as T;
}

async function createCheckout(
  apiBaseUrl: URL,
  apiKey: string,
  externalReference: string,
): Promise<CheckoutResponse> {
  return asaasRequest<CheckoutResponse>(apiBaseUrl, apiKey, '/checkouts', {
    method: 'POST',
    body: JSON.stringify({
      billingTypes: ['PIX', 'CREDIT_CARD'],
      chargeTypes: ['DETACHED'],
      minutesToExpire: CHECKOUT_EXPIRATION_MINUTES,
      externalReference,
      callback: {
        successUrl: 'https://qoro.dev/',
        cancelUrl: 'https://qoro.dev/',
        expiredUrl: 'https://qoro.dev/',
      },
      items: [
        {
          name: 'Consulta E2E',
          description: 'Fixture descartavel do Checkout Sandbox',
          quantity: 1,
          value: CHECKOUT_VALUE,
        },
      ],
      customerData: SYNTHETIC_CUSTOMER,
    }),
  });
}

async function cancelCheckout(apiBaseUrl: URL, apiKey: string, checkoutId: string): Promise<void> {
  await asaasRequest(apiBaseUrl, apiKey, `/checkouts/${checkoutId}/cancel`, { method: 'POST' });
}

async function getPayment(
  apiBaseUrl: URL,
  apiKey: string,
  paymentId: string,
): Promise<PaymentSummary> {
  return asaasRequest<PaymentSummary>(apiBaseUrl, apiKey, `/payments/${paymentId}`);
}

async function deletePayment(apiBaseUrl: URL, apiKey: string, paymentId: string): Promise<void> {
  await asaasRequest(apiBaseUrl, apiKey, `/payments/${paymentId}`, { method: 'DELETE' });
}

async function refundPayment(apiBaseUrl: URL, apiKey: string, paymentId: string): Promise<void> {
  await asaasRequest(apiBaseUrl, apiKey, `/payments/${paymentId}/refund`, {
    method: 'POST',
    body: JSON.stringify({ description: 'Cleanup automatico do E2E Checkout Sandbox' }),
  });
}

async function confirmSandboxPayment(
  apiBaseUrl: URL,
  apiKey: string,
  paymentId: string,
): Promise<void> {
  await asaasRequest(apiBaseUrl, apiKey, `/sandbox/payment/${paymentId}/confirm`, {
    method: 'POST',
  });
}

async function findCheckoutPayment(
  apiBaseUrl: URL,
  apiKey: string,
  checkoutId: string,
): Promise<PaymentSummary | null> {
  const query = new URLSearchParams({
    checkoutSession: checkoutId,
    limit: '10',
    offset: '0',
  });
  const result = await asaasRequest<{ data?: PaymentSummary[] }>(
    apiBaseUrl,
    apiKey,
    `/payments?${query.toString()}`,
  );

  return result.data?.find((payment) => payment.checkoutSession === checkoutId) ?? null;
}

async function pollCheckoutPayment(
  apiBaseUrl: URL,
  apiKey: string,
  checkoutId: string,
  attempts = PAYMENT_POLL_ATTEMPTS,
): Promise<PaymentSummary | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const payment = await findCheckoutPayment(apiBaseUrl, apiKey, checkoutId);
    if (payment) return payment;
    await new Promise((resolve) => setTimeout(resolve, PAYMENT_POLL_INTERVAL_MS));
  }
  return null;
}

async function prepareCheckout(
  page: Page,
  checkoutLink: string,
  method: CheckoutMethod,
): Promise<void> {
  await page.goto(checkoutLink, { waitUntil: 'networkidle' });
  if (method === 'CREDIT_CARD') {
    await page.getByRole('button', { name: /Cart[aã]o de Cr[eé]dito/i }).click();
    await page.locator('input[name="number"]').fill(SANDBOX_CARD.number);
    await page.locator('input[name="holderName"]').fill(SANDBOX_CARD.holderName);
    await page.locator('input[name="expiryDate"]').fill(SANDBOX_CARD.expiryDate);
    await page.locator('input[name="ccv"]').fill(SANDBOX_CARD.ccv);
  } else {
    await page.getByRole('button', { name: /^Pix$/i }).click();
  }
}

function checkoutSubmitButton(page: Page, method: CheckoutMethod) {
  return method === 'CREDIT_CARD'
    ? page.getByRole('button', { name: /^Pagar R\$/i })
    : page.getByRole('button', { name: /Pagar com pix/i });
}

async function submitCheckoutHeadless(
  page: Page,
  checkoutLink: string,
  method: CheckoutMethod,
): Promise<JsonObject> {
  await prepareCheckout(page, checkoutLink, method);

  let resolvePaymentResponse!: (value: { body: unknown; status: number }) => void;
  let rejectPaymentResponse!: (reason: unknown) => void;
  const paymentResponsePromise = new Promise<{ body: unknown; status: number }>(
    (resolve, reject) => {
      resolvePaymentResponse = resolve;
      rejectPaymentResponse = reject;
    },
  );
  await page.route('**/checkoutSession/pay', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }

    try {
      const response = await route.fetch();
      const responseText = await response.text();
      const body = JSON.parse(responseText) as unknown;
      await route.fulfill({ response, body: responseText });
      resolvePaymentResponse({ body, status: response.status() });
    } catch (error) {
      await route.abort();
      rejectPaymentResponse(error);
    }
  });
  await checkoutSubmitButton(page, method).click({ noWaitAfter: true });
  const paymentResponse = await paymentResponsePromise;
  const { body } = paymentResponse;

  if (
    paymentResponse.status < 200 ||
    paymentResponse.status >= 300 ||
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body)
  ) {
    throw new Error(
      `[asaas-checkout-e2e] formulario recusado ou resposta invalida (HTTP ${paymentResponse.status}).`,
    );
  }

  return body as JsonObject;
}

async function cleanupFixture(
  apiBaseUrl: URL,
  apiKey: string,
  checkoutId: string,
  payment: PaymentSummary | null,
): Promise<void> {
  if (!payment) {
    await cancelCheckout(apiBaseUrl, apiKey, checkoutId);
    console.log('[asaas-checkout-e2e] cleanup: Checkout cancelado.');
    return;
  }

  const current = await getPayment(apiBaseUrl, apiKey, payment.id);
  if (current.deleted || REFUNDED_STATUSES.has(current.status)) {
    console.log('[asaas-checkout-e2e] cleanup: cobranca ja estava encerrada.');
    return;
  }
  if (SETTLED_STATUSES.has(current.status)) {
    await refundPayment(apiBaseUrl, apiKey, current.id);
    console.log('[asaas-checkout-e2e] cleanup: cobranca estornada.');
    return;
  }

  await deletePayment(apiBaseUrl, apiKey, current.id);
  console.log('[asaas-checkout-e2e] cleanup: cobranca pendente removida.');
}

function safeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value
    .replace(/[\w.+-]+@[\w.-]+/g, '[email]')
    .replace(/\d{3,}/g, '[digits]')
    .slice(0, 300);
}

function summarizeProviderError(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { body: 'unexpected' };
  const errors = (value as JsonObject).errors;
  if (!Array.isArray(errors)) return { body: 'unexpected' };
  return {
    errors: errors.slice(0, 5).map((error) => {
      if (!error || typeof error !== 'object' || Array.isArray(error)) return { code: null };
      const item = error as JsonObject;
      return { code: safeText(item.code), description: safeText(item.description) };
    }),
  };
}

function summarizeSubmitResponse(value: JsonObject): unknown {
  const message = value.message;
  const safeMessage =
    message && typeof message === 'object' && !Array.isArray(message)
      ? {
          type: safeText((message as JsonObject).type),
          text: safeText((message as JsonObject).text),
        }
      : null;
  return {
    success: typeof value.success === 'boolean' ? value.success : null,
    recaptchaV2Enabled:
      typeof value.recaptchaV2Enabled === 'boolean' ? value.recaptchaV2Enabled : null,
    message: safeMessage,
  };
}

async function main(): Promise<void> {
  const { apiBaseUrl, apiKey } = assertSandboxConfiguration();
  const method = checkoutMethod();
  const interactive = interactiveMode();
  const externalReference = `qoro-checkout-e2e-${Date.now()}`;
  const checkout = await createCheckout(apiBaseUrl, apiKey, externalReference);
  if (checkout.status !== 'ACTIVE' || !checkout.id || !checkout.link) {
    throw new Error('[asaas-checkout-e2e] Checkout nao nasceu ACTIVE com link.');
  }

  let payment: PaymentSummary | null = null;
  const browser = await chromium.launch({ headless: !interactive });
  try {
    const page = await browser.newPage();
    if (interactive) {
      await prepareCheckout(page, checkout.link, method);
      console.log(
        '[asaas-checkout-e2e] ACAO MANUAL: na janela aberta, clique em pagar e conclua somente o reCAPTCHA. O restante ja foi preenchido.',
      );
      payment = await pollCheckoutPayment(
        apiBaseUrl,
        apiKey,
        checkout.id,
        INTERACTIVE_PAYMENT_POLL_ATTEMPTS,
      );
    } else {
      const submitResponse = await submitCheckoutHeadless(page, checkout.link, method);
      console.log(
        '[asaas-checkout-e2e] resposta sanitizada do formulario:',
        JSON.stringify(summarizeSubmitResponse(submitResponse)),
      );
      if (submitResponse.success !== true) {
        const reason =
          submitResponse.recaptchaV2Enabled === true
            ? 'o Asaas exigiu reCAPTCHA; use ASAAS_CHECKOUT_E2E_INTERACTIVE=1 para concluir somente o desafio humano.'
            : 'o formulario hospedado nao confirmou o pagamento.';
        throw new Error(`[asaas-checkout-e2e] ${reason}`);
      }
      payment = await pollCheckoutPayment(apiBaseUrl, apiKey, checkout.id);
    }

    if (!payment) {
      throw new Error(
        '[asaas-checkout-e2e] o formulario respondeu, mas nenhuma cobranca foi correlacionada.',
      );
    }

    if (payment.billingType !== method || payment.checkoutSession !== checkout.id) {
      throw new Error(
        '[asaas-checkout-e2e] cobranca correlacionada com metodo ou Checkout incorreto.',
      );
    }

    if (method === 'PIX') {
      await confirmSandboxPayment(apiBaseUrl, apiKey, payment.id);
      payment = await getPayment(apiBaseUrl, apiKey, payment.id);
      if (!SETTLED_STATUSES.has(payment.status)) {
        throw new Error('[asaas-checkout-e2e] confirmacao sandbox nao liquidou a cobranca PIX.');
      }
    } else {
      payment = await getPayment(apiBaseUrl, apiKey, payment.id);
      if (!SETTLED_STATUSES.has(payment.status)) {
        throw new Error(
          '[asaas-checkout-e2e] o cartao nao terminou em estado liquidado no Sandbox.',
        );
      }
    }

    console.log(`[asaas-checkout-e2e] PASS: Checkout hospedado criou ${method} correlacionado.`);
  } finally {
    await browser.close();
    await cleanupFixture(apiBaseUrl, apiKey, checkout.id, payment);
  }
}

void main().catch((error: unknown) => {
  console.error(
    '[asaas-checkout-e2e] FAIL:',
    error instanceof Error ? error.message : 'erro desconhecido',
  );
  process.exitCode = 1;
});
