/**
 * Asaas adapter (C13 — ADR-025). Asaas é INFRAESTRUTURA atrás de uma porta fina
 * `PaymentProvider`; o domínio chama "criar cobrança", o adapter sabe "como
 * falar com Asaas". NÃO é abstração multi-gateway (proibido — §13.15): uma única
 * implementação. Trocar gateway = reescrever este arquivo.
 *
 * Resiliência:
 *   - timeout via AbortSignal.timeout(env.ASAAS_HTTP_TIMEOUT_MS);
 *   - classificação de erro 4xx (definitivo) vs 5xx/timeout/rede (retryável),
 *     espelhando src/lib/ai/provider.ts;
 *   - circuit breaker em memória (3 falhas → abre 60s → half-open);
 *   - retry com backoff SÓ em GET (idempotente). POST (createCustomer/Subscription/
 *     Payment) NÃO faz auto-retry — Asaas não tem idempotency-key nativo; duplicar
 *     cobrança é pior que falhar. Caller registra payment_attempt e o reconcile
 *     (ADR-025) corrige divergência;
 *   - métricas estruturadas via metrics.emit.
 */
import { assertBillingRuntimeReady, env } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';

// --- erros -----------------------------------------------------------------

/** Falha DEFINITIVA — HTTP 4xx (credencial/payload). Não re-chamar com o mesmo input. */
export class BillingProviderError extends Error {
  readonly code: string;
  readonly httpStatus: number | null;
  constructor(message: string, code = 'billing_provider_error', httpStatus: number | null = null) {
    super(message);
    this.name = 'BillingProviderError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** Falha INDETERMINADA — timeout/abort/reset/5xx. Não sabemos se o Asaas processou. */
export class BillingProviderUnreachableError extends Error {
  readonly code = 'billing_provider_unreachable';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BillingProviderUnreachableError';
  }
}

export class BillingCircuitOpenError extends Error {
  readonly code = 'billing_circuit_open';
  constructor() {
    super('[billing] circuit breaker aberto — Asaas não será chamado agora');
    this.name = 'BillingCircuitOpenError';
  }
}

// --- circuit breaker (compacto, em memória por instância) ------------------

class CircuitBreaker {
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private probeInFlight = false;
  constructor(
    private readonly failureThreshold = 3,
    private readonly openMs = 60_000,
    private readonly clock: () => number = Date.now,
  ) {}

  private state(): 'closed' | 'open' | 'half_open' {
    if (this.openedAt === null) return 'closed';
    return this.clock() - this.openedAt >= this.openMs ? 'half_open' : 'open';
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.state();
    if (state === 'open') throw new BillingCircuitOpenError();
    if (state === 'half_open') {
      if (this.probeInFlight) throw new BillingCircuitOpenError();
      this.probeInFlight = true;
    }
    try {
      const result = await fn();
      this.consecutiveFailures = 0;
      this.openedAt = null;
      return result;
    } catch (err) {
      // 4xx definitivo NÃO conta como falha de disponibilidade do gateway.
      if (!(err instanceof BillingProviderError)) {
        if (this.openedAt !== null) this.openedAt = this.clock();
        else if (++this.consecutiveFailures >= this.failureThreshold) this.openedAt = this.clock();
      }
      throw err;
    } finally {
      this.probeInFlight = false;
    }
  }

  /** test-only */
  reset(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.probeInFlight = false;
  }
}

const circuit = new CircuitBreaker();

// --- HTTP base -------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rawRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  assertBillingRuntimeReady();
  const url = `${env.ASAAS_BASE_URL}${path}`;
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      access_token: env.ASAAS_API_KEY!,
    },
    signal: AbortSignal.timeout(env.ASAAS_HTTP_TIMEOUT_MS),
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    // timeout/abort/connection reset → indeterminado.
    metrics.emit('billing.asaas.unreachable', { method, path, error: err });
    throw new BillingProviderUnreachableError(`asaas ${method} ${path} unreachable`, {
      cause: err,
    });
  }

  if (res.status >= 500) {
    metrics.emit('billing.asaas.http_5xx', { method, path, status: res.status });
    throw new BillingProviderUnreachableError(`asaas ${method} ${path} → HTTP ${res.status}`);
  }
  if (res.status >= 400) {
    const text = await res.text().catch(() => '');
    metrics.emit('billing.asaas.http_4xx', { method, path, status: res.status });
    throw new BillingProviderError(
      `asaas ${method} ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`,
      'billing_provider_error',
      res.status,
    );
  }
  return res.status === 204 ? null : await res.json();
}

/** GET com retry/backoff (idempotente). POST sem retry (anti-duplicação). */
async function request(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<unknown> {
  const maxAttempts = method === 'GET' ? 3 : 1;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await circuit.exec(() => rawRequest(method, path, body));
    } catch (err) {
      lastErr = err;
      // Só re-tenta erro indeterminado de GET; 4xx e circuito aberto sobem na hora.
      const retryable = err instanceof BillingProviderUnreachableError && method === 'GET';
      if (!retryable || attempt === maxAttempts) throw err;
      await sleep(200 * 2 ** (attempt - 1)); // 200ms, 400ms
    }
  }
  throw lastErr;
}

// --- DTOs + porta ----------------------------------------------------------

export type AsaasBillingType = 'PIX' | 'BOLETO' | 'CREDIT_CARD' | 'UNDEFINED';

export interface CreateCustomerInput {
  name: string;
  email: string;
  cpfCnpj?: string | null;
  phone?: string | null;
}

export interface CreateSubscriptionInput {
  customerId: string;
  value: number; // reais
  cycle: 'MONTHLY' | 'YEARLY';
  nextDueDate: string; // YYYY-MM-DD
  description: string;
  billingType?: AsaasBillingType;
}

export interface GenerateInvoiceInput {
  customerId: string;
  value: number;
  dueDate: string; // YYYY-MM-DD
  description: string;
  billingType?: AsaasBillingType;
}

export interface ProviderPayment {
  paymentId: string;
  status: string; // PENDING|RECEIVED|OVERDUE|REFUNDED|CONFIRMED...
  value: number;
  dueDate: string;
  invoiceUrl: string | null;
}

export interface ProviderSubscription {
  subscriptionId: string;
  status: string; // ACTIVE|INACTIVE|EXPIRED
  value: number;
}

/** Evento de webhook Asaas normalizado (sem wire format cru). */
export interface ParsedWebhook {
  eventId: string; // chave de dedup
  event: string; // PAYMENT_RECEIVED|PAYMENT_OVERDUE|PAYMENT_REFUNDED|...
  paymentId: string | null;
  subscriptionId: string | null;
  value: number | null;
  status: string | null;
  dueDate: string | null;
  paymentDate: string | null;
  billingType: string | null;
  invoiceUrl: string | null;
}

export interface PaymentProvider {
  createCustomer(input: CreateCustomerInput): Promise<{ customerId: string }>;
  createSubscription(input: CreateSubscriptionInput): Promise<{ subscriptionId: string }>;
  generateInvoice(input: GenerateInvoiceInput): Promise<ProviderPayment>;
  getSubscription(asaasSubscriptionId: string): Promise<ProviderSubscription>;
  getPayment(asaasPaymentId: string): Promise<ProviderPayment>;
  parseWebhook(raw: string): ParsedWebhook;
  /** Valida o header `asaas-access-token` em constant-time. */
  validateWebhookToken(token: string | null): boolean;
}

function asNum(v: unknown): number {
  return typeof v === 'number' ? v : Number(v ?? 0);
}
function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const asaasProvider: PaymentProvider = {
  async createCustomer(input) {
    const body = {
      name: input.name,
      email: input.email,
      cpfCnpj: input.cpfCnpj ?? undefined,
      mobilePhone: input.phone ?? undefined,
    };
    const res = (await request('POST', '/customers', body)) as { id: string };
    metrics.emit('billing.asaas.customer_created', { customerId: res.id });
    return { customerId: res.id };
  },

  async createSubscription(input) {
    const body = {
      customer: input.customerId,
      billingType: input.billingType ?? 'UNDEFINED',
      value: input.value,
      cycle: input.cycle,
      nextDueDate: input.nextDueDate,
      description: input.description,
    };
    const res = (await request('POST', '/subscriptions', body)) as { id: string };
    metrics.emit('billing.asaas.subscription_created', { subscriptionId: res.id });
    return { subscriptionId: res.id };
  },

  async generateInvoice(input) {
    const body = {
      customer: input.customerId,
      billingType: input.billingType ?? 'UNDEFINED',
      value: input.value,
      dueDate: input.dueDate,
      description: input.description,
    };
    const r = (await request('POST', '/payments', body)) as Record<string, unknown>;
    return {
      paymentId: String(r.id),
      status: asStr(r.status) ?? 'PENDING',
      value: asNum(r.value),
      dueDate: asStr(r.dueDate) ?? input.dueDate,
      invoiceUrl: asStr(r.invoiceUrl),
    };
  },

  async getSubscription(id) {
    const r = (await request('GET', `/subscriptions/${id}`)) as Record<string, unknown>;
    return {
      subscriptionId: String(r.id),
      status: asStr(r.status) ?? 'UNKNOWN',
      value: asNum(r.value),
    };
  },

  async getPayment(id) {
    const r = (await request('GET', `/payments/${id}`)) as Record<string, unknown>;
    return {
      paymentId: String(r.id),
      status: asStr(r.status) ?? 'UNKNOWN',
      value: asNum(r.value),
      dueDate: asStr(r.dueDate) ?? '',
      invoiceUrl: asStr(r.invoiceUrl),
    };
  },

  parseWebhook(raw) {
    const body = JSON.parse(raw) as Record<string, unknown>;
    const payment = (body.payment ?? {}) as Record<string, unknown>;
    const event = String(body.event ?? '');
    const paymentId = asStr(payment.id);
    // Asaas nem sempre manda um event id; compõe uma chave estável de dedup.
    const eventId =
      asStr(body.id) ?? `${event}:${paymentId ?? 'na'}:${asStr(payment.status) ?? 'na'}`;
    return {
      eventId,
      event,
      paymentId,
      subscriptionId: asStr(payment.subscription),
      value: payment.value === undefined ? null : asNum(payment.value),
      status: asStr(payment.status),
      dueDate: asStr(payment.dueDate),
      paymentDate: asStr(payment.paymentDate) ?? asStr(payment.clientPaymentDate),
      billingType: asStr(payment.billingType),
      invoiceUrl: asStr(payment.invoiceUrl),
    };
  },

  validateWebhookToken(token) {
    if (!token || !env.ASAAS_WEBHOOK_TOKEN) return false;
    return constantTimeEqual(token, env.ASAAS_WEBHOOK_TOKEN);
  },
};

/** test-only — reseta o circuit breaker entre testes. */
export const __testing__ = { resetCircuit: () => circuit.reset() };
