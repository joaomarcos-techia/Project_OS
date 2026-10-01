/**
 * Homologacao opt-in de pagamento e estorno no Asaas Sandbox.
 *
 * Executa dois ciclos independentes (PIX e cartao), confere o estado por
 * readback, prova que repetir o estorno nao cria uma segunda devolucao e tenta
 * remover o customer sintetico. Nunca aceita producao e nunca imprime chave,
 * PAN, CVV, PII ou IDs integrais.
 *
 * Uso:
 *   ASAAS_REFUND_E2E=ALLOW_SANDBOX_REFUND pnpm payments:refund-e2e
 */
import './_env';

import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  BillingProviderError,
  BillingProviderUnreachableError,
  createAsaasClient,
  type AsaasClient,
  type ProviderPayment,
  type ProviderRefund,
} from '@/lib/payments/asaas';
import {
  assertAsaasFixtureAccount,
  fingerprintAsaasAccount,
} from '@/lib/test/asaas-account-provenance';
import { classifyCheckoutCleanup } from '@/lib/test/asaas-checkout-cleanup';

const OPT_IN = 'ALLOW_SANDBOX_REFUND';
const API_BASE_URL = 'https://api-sandbox.asaas.com/v3';
const MANIFEST_PATH = path.resolve(process.cwd(), '.playwright', 'asaas-refund-e2e-fixture.json');
const PAYMENT_VALUE = 10;
const BOOTSTRAP_VALUE = 50;
const MINIMUM_BALANCE = 25;
const POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 2_000;
const SETTLED_PAYMENT_STATUSES = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH']);
const TERMINAL_REFUND_STATUSES = new Set(['DONE', 'REFUNDED', 'CONFIRMED', 'COMPLETED']);

const SYNTHETIC_CARD = {
  holderName: 'Paciente E2E Sandbox',
  number: '4444444444444444',
  expiryMonth: '12',
  expiryYear: '2030',
  ccv: '123',
} as const;

type JsonObject = Record<string, unknown>;
type Method = 'PIX' | 'CREDIT_CARD';
type MethodResult = 'pass' | 'blocked';
type Manifest = {
  version: 1;
  accountFingerprint: string;
  runId: string;
  customerId: string;
  payments: Array<{ method: Method; paymentId: string; externalReference: string }>;
  updatedAt: string;
};

function assertConfiguration(): { apiKey: string; baseUrl: URL } {
  if (process.env.ASAAS_REFUND_E2E !== OPT_IN) {
    throw new Error(`[asaas-refund-e2e] opt-in ausente. Defina ASAAS_REFUND_E2E=${OPT_IN}.`);
  }
  const apiKey = process.env.ASAAS_REFUND_E2E_API_KEY ?? process.env.ASAAS_API_KEY;
  if (!apiKey) {
    throw new Error(
      '[asaas-refund-e2e] exige ASAAS_REFUND_E2E_API_KEY ou ASAAS_API_KEY de Sandbox.',
    );
  }
  const baseUrl = new URL(API_BASE_URL);
  if (
    baseUrl.protocol !== 'https:' ||
    baseUrl.hostname !== 'api-sandbox.asaas.com' ||
    baseUrl.pathname.replace(/\/$/u, '') !== '/v3' ||
    baseUrl.port ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new Error('[asaas-refund-e2e] alvo recusado: somente o Sandbox oficial e permitido.');
  }
  return { apiKey, baseUrl };
}

function endpoint(baseUrl: URL, requestPath: string): URL {
  return new URL(`${baseUrl.toString().replace(/\/$/u, '')}/${requestPath.replace(/^\//u, '')}`);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function safeProviderCodes(body: unknown): string[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  const errors = (body as JsonObject).errors;
  if (!Array.isArray(errors)) return [];
  return errors.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const code = (entry as JsonObject).code;
    return typeof code === 'string' && /^[A-Za-z][A-Za-z_-]{0,63}$/u.test(code) ? [code] : [];
  });
}

async function request(
  baseUrl: URL,
  apiKey: string,
  method: 'GET' | 'POST' | 'DELETE',
  requestPath: string,
  body?: unknown,
): Promise<unknown> {
  const init: RequestInit = {
    method,
    headers: {
      accept: 'application/json',
      access_token: apiKey,
      'content-type': 'application/json',
      'user-agent': 'ClinicaOS/1.0 (sandbox-refund-e2e)',
    },
    signal: AbortSignal.timeout(65_000),
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  let response: Response;
  try {
    response = await fetch(endpoint(baseUrl, requestPath), init);
  } catch (error) {
    throw new BillingProviderUnreachableError(
      `[asaas-refund-e2e] ${method} ${requestPath} sem resposta conclusiva`,
      { cause: error },
    );
  }
  const responseBody = await response.json().catch(() => null);
  if (!response.ok) {
    throw new BillingProviderError(
      `[asaas-refund-e2e] ${method} ${requestPath} recusado (HTTP ${response.status})`,
      'billing_provider_error',
      response.status,
      safeProviderCodes(responseBody),
    );
  }
  return responseBody;
}

function paymentFromRaw(raw: unknown): ProviderPayment {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('[asaas-refund-e2e] resposta de cobranca invalida');
  }
  const value = raw as JsonObject;
  const id = asString(value.id);
  const status = asString(value.status);
  const amount = asNumber(value.value);
  if (!id || !status || amount === null) {
    throw new Error('[asaas-refund-e2e] cobranca sem identidade, status ou valor');
  }
  return {
    paymentId: id,
    status,
    value: amount,
    dueDate: asString(value.dueDate) ?? '',
    invoiceUrl: asString(value.invoiceUrl),
    subscriptionId: asString(value.subscription),
    billingType: asString(value.billingType),
    externalReference: asString(value.externalReference),
    checkoutSessionId: asString(value.checkoutSession),
    deleted: value.deleted === true,
  };
}

function paymentFingerprint(paymentId: string): string {
  return createHash('sha256').update(paymentId, 'utf8').digest('hex').slice(0, 12);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function selectedMethods(): Method[] {
  const configured = process.env.ASAAS_REFUND_E2E_METHOD ?? 'ALL';
  if (configured === 'ALL') return ['PIX', 'CREDIT_CARD'];
  if (configured === 'PIX' || configured === 'CREDIT_CARD') return [configured];
  throw new Error('[asaas-refund-e2e] ASAAS_REFUND_E2E_METHOD aceita ALL, PIX ou CREDIT_CARD.');
}

function validManifest(value: unknown): value is Manifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const manifest = value as JsonObject;
  if (
    manifest.version !== 1 ||
    typeof manifest.accountFingerprint !== 'string' ||
    typeof manifest.runId !== 'string' ||
    typeof manifest.customerId !== 'string' ||
    !Array.isArray(manifest.payments) ||
    typeof manifest.updatedAt !== 'string'
  ) {
    return false;
  }
  return manifest.payments.every(
    (payment) =>
      payment !== null &&
      typeof payment === 'object' &&
      !Array.isArray(payment) &&
      ((payment as JsonObject).method === 'PIX' ||
        (payment as JsonObject).method === 'CREDIT_CARD') &&
      typeof (payment as JsonObject).paymentId === 'string' &&
      typeof (payment as JsonObject).externalReference === 'string',
  );
}

async function loadManifest(account: { email: string | null }): Promise<Manifest | null> {
  let raw: string;
  try {
    raw = await readFile(MANIFEST_PATH, 'utf8');
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return null;
    }
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!validManifest(parsed)) {
    throw new Error('[asaas-refund-e2e] manifesto existente e invalido; limpeza manual necessaria');
  }
  assertAsaasFixtureAccount(parsed.accountFingerprint, account);
  return parsed;
}

async function persistManifest(manifest: Manifest): Promise<void> {
  await mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await writeFile(
    MANIFEST_PATH,
    `${JSON.stringify({ ...manifest, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );
}

async function accountIdentity(baseUrl: URL, apiKey: string): Promise<{ email: string | null }> {
  const raw = await request(baseUrl, apiKey, 'GET', '/myAccount');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('[asaas-refund-e2e] identidade da conta Sandbox invalida');
  }
  return { email: asString((raw as JsonObject).email) };
}

async function accountBalance(baseUrl: URL, apiKey: string): Promise<number> {
  const raw = await request(baseUrl, apiKey, 'GET', '/finance/balance');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('[asaas-refund-e2e] saldo Sandbox invalido');
  }
  const balance = asNumber((raw as JsonObject).balance);
  if (balance === null) throw new Error('[asaas-refund-e2e] saldo Sandbox ausente');
  return balance;
}

async function waitForSettled(client: AsaasClient, paymentId: string): Promise<ProviderPayment> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const payment = await client.getPayment(paymentId, { attempts: 1 });
    if (SETTLED_PAYMENT_STATUSES.has(payment.status)) return payment;
    if (attempt < POLL_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
  throw new Error('[asaas-refund-e2e] cobranca nao atingiu estado pago no prazo');
}

function completedRefundValue(refunds: readonly ProviderRefund[]): number {
  return Number(
    refunds
      .filter((refund) => TERMINAL_REFUND_STATUSES.has(refund.status))
      .reduce((total, refund) => total + refund.value, 0)
      .toFixed(2),
  );
}

async function waitForRefund(
  client: AsaasClient,
  paymentId: string,
  expectedValue: number,
): Promise<
  | { state: 'complete'; payment: ProviderPayment; refunds: ProviderRefund[] }
  | { state: 'pending-critical-action'; payment: ProviderPayment; refunds: ProviderRefund[] }
> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const [payment, refunds] = await Promise.all([
      client.getPayment(paymentId, { attempts: 1 }),
      client.listPaymentRefunds(paymentId, { attempts: 1 }),
    ]);
    const state = classifyCheckoutCleanup({
      paymentStatus: payment.status,
      paymentDeleted: payment.deleted,
      expectedRefundValue: expectedValue,
      refunds,
    });
    if (state.state === 'complete') return { state: 'complete', payment, refunds };
    if (state.state === 'pending-critical-action') {
      return { state: 'pending-critical-action', payment, refunds };
    }
    if (attempt < POLL_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
  throw new Error('[asaas-refund-e2e] estorno nao atingiu DONE/REFUNDED no prazo');
}

async function assertDuplicateRefundRejected(
  client: AsaasClient,
  paymentId: string,
  expectedValue: number,
  baseline: readonly ProviderRefund[],
): Promise<void> {
  try {
    await client.refundPayment(paymentId, {
      description: 'Repeticao deliberada do E2E de idempotencia Sandbox',
    });
  } catch (error) {
    if (!(error instanceof BillingProviderError) || error.httpStatus !== 400) throw error;
  }
  const after = await client.listPaymentRefunds(paymentId, { attempts: 1 });
  if (completedRefundValue(after) !== expectedValue || after.length !== baseline.length) {
    throw new Error('[asaas-refund-e2e] repeticao alterou o conjunto de estornos');
  }
}

async function ensureSandboxBalance(
  baseUrl: URL,
  apiKey: string,
  client: AsaasClient,
  accountFingerprint: string,
): Promise<void> {
  const current = await accountBalance(baseUrl, apiKey);
  if (current >= MINIMUM_BALANCE) return;

  const externalReference = `qoro-refund-bootstrap-${accountFingerprint.slice(-16)}`;
  let payment = await client.findPaymentByExternalReference(externalReference, { attempts: 1 });
  if (!payment) {
    const customer = await client.createCustomer({
      name: 'Qoro E2E saldo Sandbox',
      cpfCnpj: '24971563792',
    });
    payment = await client.generateInvoice({
      customerId: customer.customerId,
      value: BOOTSTRAP_VALUE,
      dueDate: today(),
      description: 'Saldo reutilizavel para homologacao de estorno Sandbox',
      billingType: 'PIX',
      externalReference,
    });
  }
  if (!SETTLED_PAYMENT_STATUSES.has(payment.status)) {
    await request(
      baseUrl,
      apiKey,
      'POST',
      `/sandbox/payment/${encodeURIComponent(payment.paymentId)}/confirm`,
    );
    await waitForSettled(client, payment.paymentId);
  }
  const after = await accountBalance(baseUrl, apiKey);
  if (after < MINIMUM_BALANCE) {
    throw new Error('[asaas-refund-e2e] saldo Sandbox continua insuficiente apos bootstrap');
  }
  console.log('[asaas-refund-e2e] saldo sintetico reutilizavel confirmado no Sandbox.');
}

async function createCardPayment(
  baseUrl: URL,
  apiKey: string,
  customerId: string,
  externalReference: string,
): Promise<ProviderPayment> {
  const raw = await request(baseUrl, apiKey, 'POST', '/payments', {
    customer: customerId,
    billingType: 'CREDIT_CARD',
    value: PAYMENT_VALUE,
    dueDate: today(),
    description: 'Qoro E2E refund cartao Sandbox',
    externalReference,
    creditCard: SYNTHETIC_CARD,
    creditCardHolderInfo: {
      name: SYNTHETIC_CARD.holderName,
      email: 'checkout-e2e@qoro.dev',
      cpfCnpj: '24971563792',
      postalCode: '89223005',
      addressNumber: '277',
      phone: '11999990000',
    },
    remoteIp: '127.0.0.1',
  });
  return paymentFromRaw(raw);
}

async function runMethod(input: {
  method: Method;
  client: AsaasClient;
  baseUrl: URL;
  apiKey: string;
  customerId: string;
  externalReference: string;
  manifest: Manifest;
}): Promise<MethodResult> {
  const { method, client, baseUrl, apiKey, customerId, externalReference, manifest } = input;
  let payment = await client.findPaymentByExternalReference(externalReference, { attempts: 1 });
  if (!payment) {
    payment =
      method === 'PIX'
        ? await client.generateInvoice({
            customerId,
            value: PAYMENT_VALUE,
            dueDate: today(),
            description: 'Qoro E2E refund PIX Sandbox',
            billingType: 'PIX',
            externalReference,
          })
        : await createCardPayment(baseUrl, apiKey, customerId, externalReference);
    manifest.payments.push({ method, paymentId: payment.paymentId, externalReference });
    await persistManifest(manifest);
  }

  if (method === 'PIX' && !SETTLED_PAYMENT_STATUSES.has(payment.status)) {
    await request(
      baseUrl,
      apiKey,
      'POST',
      `/sandbox/payment/${encodeURIComponent(payment.paymentId)}/confirm`,
    );
  }
  payment = await waitForSettled(client, payment.paymentId);
  if (payment.billingType !== method || payment.value !== PAYMENT_VALUE) {
    throw new Error(`[asaas-refund-e2e] readback divergente para ${method}`);
  }

  const before = await client.listPaymentRefunds(payment.paymentId, { attempts: 1 });
  if (before.length > 0) {
    const existing = classifyCheckoutCleanup({
      paymentStatus: payment.status,
      paymentDeleted: payment.deleted,
      expectedRefundValue: PAYMENT_VALUE,
      refunds: before,
    });
    if (existing.state !== 'complete') {
      if (existing.state === 'pending-critical-action') {
        console.log(
          `[asaas-refund-e2e] BLOCKED ${method}: estorno aguarda autorizacao de acao critica; id=${paymentFingerprint(payment.paymentId)}.`,
        );
        return 'blocked';
      }
      throw new Error(`[asaas-refund-e2e] ${method} ja possui estorno nao terminal`);
    }
  } else {
    try {
      await client.refundPayment(payment.paymentId, {
        description: `Homologacao Qoro ${method} no Sandbox`,
      });
    } catch (error) {
      if (
        error instanceof BillingProviderError &&
        error.httpStatus === 400 &&
        error.providerErrorCodes.includes('invalid_action')
      ) {
        const afterRefusal = await client.listPaymentRefunds(payment.paymentId, { attempts: 1 });
        if (afterRefusal.length !== 0) {
          throw new Error(`[asaas-refund-e2e] ${method} retornou invalid_action mas criou estorno`);
        }
        console.log(
          `[asaas-refund-e2e] BLOCKED ${method}: provider recusou o refund com invalid_action; pagamento=${payment.status}; id=${paymentFingerprint(payment.paymentId)}.`,
        );
        return 'blocked';
      }
      throw error;
    }
  }

  const completed = await waitForRefund(client, payment.paymentId, PAYMENT_VALUE);
  if (completed.state === 'pending-critical-action') {
    console.log(
      `[asaas-refund-e2e] BLOCKED ${method}: estorno aguarda autorizacao de acao critica; id=${paymentFingerprint(payment.paymentId)}.`,
    );
    return 'blocked';
  }
  await assertDuplicateRefundRejected(client, payment.paymentId, PAYMENT_VALUE, completed.refunds);
  console.log(
    `[asaas-refund-e2e] PASS ${method}: pagamento e estorno terminal; id=${paymentFingerprint(payment.paymentId)}; refunds=${completed.refunds.length}.`,
  );
  return 'pass';
}

async function main(): Promise<void> {
  const { apiKey, baseUrl } = assertConfiguration();
  const account = await accountIdentity(baseUrl, apiKey);
  const accountFingerprint = fingerprintAsaasAccount(account);
  const client = createAsaasClient({ apiKey, baseUrl: API_BASE_URL });
  await ensureSandboxBalance(baseUrl, apiKey, client, accountFingerprint);

  let manifest = await loadManifest(account);
  if (!manifest) {
    const customer = await client.createCustomer({
      name: 'Paciente E2E Refund Sandbox',
      cpfCnpj: '24971563792',
    });
    manifest = {
      version: 1,
      accountFingerprint,
      runId: randomUUID(),
      customerId: customer.customerId,
      payments: [],
      updatedAt: new Date().toISOString(),
    };
    await persistManifest(manifest);
  } else {
    console.log('[asaas-refund-e2e] retomando fixture existente da mesma conta Sandbox.');
  }

  const results: MethodResult[] = [];
  for (const method of selectedMethods()) {
    results.push(
      await runMethod({
        method,
        client,
        baseUrl,
        apiKey,
        customerId: manifest.customerId,
        externalReference: `qoro-refund-${method === 'PIX' ? 'pix' : 'card'}-${manifest.runId}`,
        manifest,
      }),
    );
  }

  const allMethodsPresent = new Set(manifest.payments.map((payment) => payment.method)).size === 2;
  const allRefundsComplete =
    allMethodsPresent &&
    (
      await Promise.all(
        manifest.payments.map(async ({ paymentId }) => {
          const [payment, refunds] = await Promise.all([
            client.getPayment(paymentId, { attempts: 1 }),
            client.listPaymentRefunds(paymentId, { attempts: 1 }),
          ]);
          return (
            classifyCheckoutCleanup({
              paymentStatus: payment.status,
              paymentDeleted: payment.deleted,
              expectedRefundValue: PAYMENT_VALUE,
              refunds,
            }).state === 'complete'
          );
        }),
      )
    ).every(Boolean);

  if (allRefundsComplete) {
    try {
      await client.deleteCustomer(manifest.customerId);
      console.log('[asaas-refund-e2e] cleanup: customer sintetico removido.');
    } catch (error) {
      if (!(error instanceof BillingProviderError)) throw error;
      console.log(
        `[asaas-refund-e2e] cleanup parcial: provider reteve customer vinculado (HTTP ${error.httpStatus ?? 'n/a'}).`,
      );
    }
    await rm(MANIFEST_PATH, { force: true });
  }
  if (results.includes('blocked')) {
    process.exitCode = 2;
  }
}

void main().catch(async (error: unknown) => {
  const safe =
    error instanceof BillingProviderError
      ? `${error.message}; codes=${error.providerErrorCodes.join(',') || 'none'}`
      : error instanceof Error
        ? error.message
        : 'erro desconhecido';
  console.error('[asaas-refund-e2e] FAIL:', safe);
  try {
    await access(MANIFEST_PATH);
    console.error(`[asaas-refund-e2e] fixture preservada em ${MANIFEST_PATH}.`);
  } catch {
    // Nenhum recurso mutável chegou a ser criado.
  }
  process.exitCode = 1;
});
