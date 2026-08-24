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
import { safeEqual } from '@/lib/auth/secret-compare';
import { assertBillingRuntimeReady, env } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';

// --- erros -----------------------------------------------------------------

/** Falha DEFINITIVA — HTTP 4xx (credencial/payload). Não re-chamar com o mesmo input. */
export class BillingProviderError extends Error {
  readonly code: string;
  readonly httpStatus: number | null;
  /**
   * Códigos estáveis da API do Asaas, filtrados antes de entrar em métricas.
   * A descrição é deliberadamente descartada: pode refletir dados enviados no
   * checkout transparente e não é segura para logs, Sentry ou UI.
   */
  readonly providerErrorCodes: readonly string[];
  constructor(
    message: string,
    code = 'billing_provider_error',
    httpStatus: number | null = null,
    providerErrorCodes: readonly string[] = [],
  ) {
    super(message);
    this.name = 'BillingProviderError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.providerErrorCodes = providerErrorCodes;
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

// --- HTTP base -------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ASAAS_USER_AGENT = 'ClinicaOS/1.0 (billing-integration)';
// O Asaas usa códigos como `invalid_creditCard`. Aceita somente letras,
// `_` e `-`: preserva o identificador diagnóstico sem permitir CPF, PAN ou
// qualquer outro valor numérico refletido pelo provedor.
const SAFE_PROVIDER_ERROR_CODE = /^[A-Za-z][A-Za-z_-]{0,63}$/;

/**
 * Extrai SOMENTE códigos alfanuméricos estáveis do formato de erro do Asaas.
 * Nunca preserva `description` ou o corpo bruto: a API pode refletir PAN, CVV
 * ou PII recebidos no checkout transparente.
 */
async function getSafeProviderErrorCodes(response: Response): Promise<string[]> {
  try {
    const body: unknown = JSON.parse(await response.text());
    if (
      !body ||
      typeof body !== 'object' ||
      !Array.isArray((body as { errors?: unknown }).errors)
    ) {
      return [];
    }

    const codes = (body as { errors: unknown[] }).errors.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const code = (entry as { code?: unknown }).code;
      return typeof code === 'string' && SAFE_PROVIDER_ERROR_CODE.test(code) ? [code] : [];
    });
    return [...new Set(codes)].slice(0, 4);
  } catch {
    return [];
  }
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
  /** Chave estável de reconciliação para POST que pode ter timeout após criar. */
  externalReference?: string;
}

/** Dados do cartão — transitam em memória na request, NUNCA persistidos/logados. */
export interface CreditCardInput {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
}

export interface CreditCardHolderInfo {
  name: string;
  email: string;
  cpfCnpj: string;
  postalCode: string;
  addressNumber: string;
  phone?: string | null;
}

export interface CreateSubscriptionWithCardInput extends CreateSubscriptionInput {
  creditCard: CreditCardInput;
  holderInfo: CreditCardHolderInfo;
  remoteIp: string;
}

export interface GenerateInvoiceInput {
  customerId: string;
  value: number;
  dueDate: string; // YYYY-MM-DD
  description: string;
  billingType?: AsaasBillingType;
  /** Chave de conciliação com uma operação local idempotente. */
  externalReference?: string;
}

export interface ProviderPayment {
  paymentId: string;
  status: string; // PENDING|RECEIVED|OVERDUE|REFUNDED|CONFIRMED...
  value: number;
  dueDate: string;
  invoiceUrl: string | null;
  /**
   * A2: origem CONFIÁVEL do vínculo pagamento→subscription. É o que resolve a
   * clínica (`ensureInvoiceForPayment` casa por `asaas_subscription_id`), então
   * não pode vir do corpo do webhook: com o token, um atacante parearia um
   * `paymentId` real com a subscription de OUTRA clínica.
   */
  subscriptionId: string | null;
  billingType: string | null;
  externalReference: string | null;
}

export interface ProviderSubscription {
  subscriptionId: string;
  status: string; // ACTIVE|INACTIVE|EXPIRED
  value: number;
  customerId: string | null;
  externalReference: string | null;
}

/**
 * Evento de webhook Asaas normalizado (sem wire format cru).
 *
 * A2 — este tipo carrega SÓ o que é seguro usar vindo do corpo: identificadores
 * para dedup e para consultar o provider. O Asaas não assina o corpo (só um token
 * estático compartilhado), então quem tiver o token forja qualquer campo. Status,
 * valor, vencimento e o vínculo com a subscription vêm de `getPayment()` — não
 * daqui. Os campos ausentes são ausentes DE PROPÓSITO: se o tipo os expusesse,
 * alguém acabaria persistindo dado forjável sem perceber.
 */
export interface ParsedWebhook {
  eventId: string; // chave de dedup — sempre do provider (`body.id`)
  event: string; // rótulo da notificação; NÃO decide transição (o status real decide)
  paymentId: string | null;
}

export interface PaymentProvider {
  createCustomer(input: CreateCustomerInput): Promise<{ customerId: string }>;
  /** Remove cliente criado nesta tentativa que falhou antes de gerar assinatura. */
  deleteCustomer(asaasCustomerId: string): Promise<void>;
  createSubscription(input: CreateSubscriptionInput): Promise<{ subscriptionId: string }>;
  /** Assinatura com cartão de crédito (tokeniza no Asaas; devolve o token p/ futuras cobranças). */
  createSubscriptionWithCard(
    input: CreateSubscriptionWithCardInput,
  ): Promise<{ subscriptionId: string; creditCardToken: string | null }>;
  /** Cancela a assinatura no Asaas (compensação da saga — mata cobrança órfã). */
  cancelSubscription(asaasSubscriptionId: string): Promise<void>;
  /** Atualiza somente cobranças futuras da recorrência. */
  updateSubscription(
    asaasSubscriptionId: string,
    input: {
      value?: number;
      status?: 'ACTIVE' | 'INACTIVE';
      nextDueDate?: string;
      updatePendingPayments?: boolean;
    },
  ): Promise<void>;
  generateInvoice(input: GenerateInvoiceInput): Promise<ProviderPayment>;
  getSubscription(asaasSubscriptionId: string): Promise<ProviderSubscription>;
  /** Recupera uma assinatura criada por tentativa anterior após timeout de POST. */
  findSubscriptionByExternalReference(
    externalReference: string,
    opts?: { attempts?: number },
  ): Promise<ProviderSubscription | null>;
  /** Cobranças já geradas pela assinatura (backstop para webhooks perdidos). */
  listSubscriptionPayments(
    asaasSubscriptionId: string,
    opts?: { attempts?: number },
  ): Promise<ProviderPayment[]>;
  /** `attempts` aperta o orçamento de retry (webhook usa 1 — ver [asaas/route.ts]). */
  getPayment(asaasPaymentId: string, opts?: { attempts?: number }): Promise<ProviderPayment>;
  /** Recupera uma cobrança de operação local após timeout de POST. */
  findPaymentByExternalReference(
    externalReference: string,
    opts?: { attempts?: number },
  ): Promise<ProviderPayment | null>;
  /** Lança se o corpo não trouxer `body.id` (chave de dedup do provider). */
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

// --- credencial ------------------------------------------------------------

/**
 * Valor OU função que devolve o valor. A forma de função existe por um motivo
 * concreto: o client do Qoro lê `env.ASAAS_API_KEY` **a cada request** (era assim
 * antes deste arquivo virar fábrica) e capturar o valor no import mudaria o
 * comportamento — inclusive nos testes, que trocam o mock de `@/lib/env` entre casos.
 */
type Resolvable<T> = T | (() => T);

function resolveValue<T>(value: Resolvable<T>): T;
function resolveValue<T>(value: Resolvable<T> | undefined): T | undefined;
function resolveValue<T>(value: Resolvable<T> | undefined): T | undefined {
  return typeof value === 'function' ? (value as () => T)() : value;
}

export interface AsaasCredential {
  /** Chave da conta Asaas usada no header `access_token`. */
  apiKey: Resolvable<string>;
  /**
   * Base URL. Omitido = `env.ASAAS_BASE_URL`. Sandbox vs produção é decisão do
   * AMBIENTE do Qoro, não da conta: uma clínica no modelo B usa a mesma base.
   */
  baseUrl?: Resolvable<string>;
  /**
   * Token que o Asaas envia no header `asaas-access-token` desta conta. Omitido =
   * `validateWebhookToken` retorna sempre `false` (nunca "passa por omissão").
   */
  webhookToken?: Resolvable<string | undefined>;
}

/** `PaymentProvider` + o controle do circuit breaker desta instância. */
export interface AsaasClient extends PaymentProvider {
  /** test-only — zera o breaker DESTA instância. */
  resetCircuit(): void;
}

/**
 * Cria um client Asaas ligado a UMA credencial.
 *
 * O circuit breaker é **por instância**: a indisponibilidade da conta A não pode
 * abrir o circuito da conta B. Corolário: crie a instância UMA vez por credencial
 * e reutilize — instanciar por request zeraria o breaker a cada chamada e o
 * anularia na prática (é por isso que `asaasProvider`, abaixo, é singleton).
 *
 * O timeout continua vindo de `env.ASAAS_HTTP_TIMEOUT_MS`: é política operacional
 * do Qoro, não atributo da conta do cliente.
 */
export function createAsaasClient(credential: AsaasCredential): AsaasClient {
  const circuit = new CircuitBreaker();

  async function rawRequest(method: string, path: string, body?: unknown): Promise<unknown> {
    const apiKey = resolveValue(credential.apiKey);
    const url = `${resolveValue(credential.baseUrl) ?? env.ASAAS_BASE_URL}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        // Obrigatório para contas-raiz recentes do Asaas; explícito para que o
        // comportamento não dependa do User-Agent padrão do runtime Node.
        'User-Agent': ASAAS_USER_AGENT,
        access_token: apiKey,
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
      const providerErrorCodes = await getSafeProviderErrorCodes(res);
      metrics.emit('billing.asaas.http_4xx', {
        method,
        path,
        status: res.status,
        providerErrorCodes,
      });
      // Nunca propague o corpo do provedor: em checkout transparente ele pode
      // refletir campos sensíveis da requisição e acabar em logs/Sentry.
      throw new BillingProviderError(
        `asaas ${method} ${path} → HTTP ${res.status}`,
        'billing_provider_error',
        res.status,
        providerErrorCodes,
      );
    }
    return res.status === 204 ? null : await res.json();
  }

  /** GET com retry/backoff (idempotente). POST sem retry (anti-duplicação). */
  async function request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    opts?: { attempts?: number },
  ): Promise<unknown> {
    // GET re-tenta por default (idempotente). `opts.attempts` permite ao caller
    // apertar o orçamento: o webhook verifica o pagamento DENTRO da janela de 30s
    // da invocação, e 3 × ASAAS_HTTP_TIMEOUT_MS (10s) + backoff estoura o limite.
    // PUT escreve o estado desejado de uma assinatura e é idempotente; portanto
    // pode usar o mesmo retry seguro de GET. POST continua sem retry porque o
    // Asaas não oferece uma idempotency-key nativa.
    const maxAttempts = opts?.attempts ?? (method === 'GET' || method === 'PUT' ? 3 : 1);
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await circuit.exec(() => rawRequest(method, path, body));
      } catch (err) {
        lastErr = err;
        // Só re-tenta erro indeterminado de GET; 4xx e circuito aberto sobem na hora.
        const retryable =
          err instanceof BillingProviderUnreachableError && (method === 'GET' || method === 'PUT');
        if (!retryable || attempt === maxAttempts) throw err;
        await sleep(200 * 2 ** (attempt - 1)); // 200ms, 400ms
      }
    }
    throw lastErr;
  }

  const client: AsaasClient = {
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

    async deleteCustomer(id) {
      await request('DELETE', `/customers/${encodeURIComponent(id)}`);
      metrics.emit('billing.asaas.customer_deleted', { customerId: id });
    },

    async createSubscription(input) {
      const body = {
        customer: input.customerId,
        billingType: input.billingType ?? 'UNDEFINED',
        value: input.value,
        cycle: input.cycle,
        nextDueDate: input.nextDueDate,
        description: input.description,
        externalReference: input.externalReference,
      };
      const res = (await request('POST', '/subscriptions', body)) as { id: string };
      metrics.emit('billing.asaas.subscription_created', { subscriptionId: res.id });
      return { subscriptionId: res.id };
    },

    async createSubscriptionWithCard(input) {
      const body = {
        customer: input.customerId,
        billingType: 'CREDIT_CARD' as const,
        value: input.value,
        cycle: input.cycle,
        nextDueDate: input.nextDueDate,
        description: input.description,
        externalReference: input.externalReference,
        creditCard: {
          holderName: input.creditCard.holderName,
          number: input.creditCard.number,
          expiryMonth: input.creditCard.expiryMonth,
          expiryYear: input.creditCard.expiryYear,
          ccv: input.creditCard.ccv,
        },
        creditCardHolderInfo: {
          name: input.holderInfo.name,
          email: input.holderInfo.email,
          cpfCnpj: input.holderInfo.cpfCnpj,
          postalCode: input.holderInfo.postalCode,
          addressNumber: input.holderInfo.addressNumber,
          phone: input.holderInfo.phone ?? undefined,
        },
        remoteIp: input.remoteIp,
      };
      const res = (await request('POST', '/subscriptions', body)) as {
        id: string;
        creditCard?: { creditCardToken?: string };
      };
      metrics.emit('billing.asaas.subscription_created', {
        subscriptionId: res.id,
        withCard: true,
      });
      return { subscriptionId: res.id, creditCardToken: res.creditCard?.creditCardToken ?? null };
    },

    async cancelSubscription(id) {
      await request('DELETE', `/subscriptions/${id}`);
      metrics.emit('billing.asaas.subscription_cancelled', { subscriptionId: id });
    },

    async updateSubscription(id, input) {
      if (input.status === 'ACTIVE' && !input.nextDueDate) {
        throw new BillingProviderError(
          'Asaas exige nextDueDate ao reativar uma assinatura.',
          'subscription_reactivation_due_date_required',
        );
      }
      await request('PUT', `/subscriptions/${encodeURIComponent(id)}`, {
        value: input.value,
        status: input.status,
        nextDueDate: input.nextDueDate,
        updatePendingPayments: input.updatePendingPayments ?? false,
      });
      metrics.emit('billing.asaas.subscription_updated', { subscriptionId: id });
    },

    async generateInvoice(input) {
      const body = {
        customer: input.customerId,
        billingType: input.billingType ?? 'UNDEFINED',
        value: input.value,
        dueDate: input.dueDate,
        description: input.description,
        externalReference: input.externalReference,
      };
      const r = (await request('POST', '/payments', body)) as Record<string, unknown>;
      return {
        paymentId: String(r.id),
        status: asStr(r.status) ?? 'PENDING',
        value: asNum(r.value),
        dueDate: asStr(r.dueDate) ?? input.dueDate,
        invoiceUrl: asStr(r.invoiceUrl),
        subscriptionId: asStr(r.subscription),
        billingType: asStr(r.billingType),
        externalReference: asStr(r.externalReference),
      };
    },

    async getSubscription(id) {
      const r = (await request('GET', `/subscriptions/${id}`)) as Record<string, unknown>;
      return {
        subscriptionId: String(r.id),
        status: asStr(r.status) ?? 'UNKNOWN',
        value: asNum(r.value),
        customerId: asStr(r.customer),
        externalReference: asStr(r.externalReference),
      };
    },

    async findSubscriptionByExternalReference(externalReference, opts) {
      const query = new URLSearchParams({ externalReference, limit: '1' });
      const r = (await request('GET', `/subscriptions?${query.toString()}`, undefined, opts)) as {
        data?: unknown;
      };
      const first = Array.isArray(r.data) ? r.data[0] : null;
      if (!first || typeof first !== 'object') return null;
      const subscription = first as Record<string, unknown>;
      return {
        subscriptionId: String(subscription.id),
        status: asStr(subscription.status) ?? 'UNKNOWN',
        value: asNum(subscription.value),
        customerId: asStr(subscription.customer),
        externalReference: asStr(subscription.externalReference),
      };
    },

    async listSubscriptionPayments(id, opts) {
      const r = (await request(
        'GET',
        `/subscriptions/${encodeURIComponent(id)}/payments`,
        undefined,
        opts,
      )) as { data?: unknown };
      const payments = Array.isArray(r.data) ? r.data : [];
      return payments.map((payment) => {
        const p = payment as Record<string, unknown>;
        return {
          paymentId: String(p.id),
          status: asStr(p.status) ?? 'UNKNOWN',
          value: asNum(p.value),
          dueDate: asStr(p.dueDate) ?? '',
          invoiceUrl: asStr(p.invoiceUrl),
          // A resposta pertence à assinatura consultada. O fallback mantém a
          // correlação mesmo se a API omitir o campo `subscription` na listagem.
          subscriptionId: asStr(p.subscription) ?? id,
          billingType: asStr(p.billingType),
          externalReference: asStr(p.externalReference),
        };
      });
    },

    async getPayment(id, opts) {
      const r = (await request('GET', `/payments/${id}`, undefined, opts)) as Record<
        string,
        unknown
      >;
      return {
        paymentId: String(r.id),
        status: asStr(r.status) ?? 'UNKNOWN',
        value: asNum(r.value),
        dueDate: asStr(r.dueDate) ?? '',
        invoiceUrl: asStr(r.invoiceUrl),
        subscriptionId: asStr(r.subscription),
        billingType: asStr(r.billingType),
        externalReference: asStr(r.externalReference),
      };
    },

    async findPaymentByExternalReference(externalReference, opts) {
      const query = new URLSearchParams({ externalReference, limit: '1' });
      const r = (await request('GET', `/payments?${query.toString()}`, undefined, opts)) as {
        data?: unknown;
      };
      const first = Array.isArray(r.data) ? r.data[0] : null;
      if (!first || typeof first !== 'object') return null;
      const p = first as Record<string, unknown>;
      return {
        paymentId: String(p.id),
        status: asStr(p.status) ?? 'UNKNOWN',
        value: asNum(p.value),
        dueDate: asStr(p.dueDate) ?? '',
        invoiceUrl: asStr(p.invoiceUrl),
        subscriptionId: asStr(p.subscription),
        billingType: asStr(p.billingType),
        externalReference: asStr(p.externalReference),
      };
    },

    parseWebhook(raw) {
      const body = JSON.parse(raw) as Record<string, unknown>;
      const payment = (body.payment ?? {}) as Record<string, unknown>;
      const event = String(body.event ?? '');
      // A2: `body.id` (evt_...) é OBRIGATÓRIO. Antes, na ausência dele, a chave de
      // dedup era sintetizada como `${event}:${paymentId}:${status}` — o que (a) é
      // escolhível por quem tem o token, permitindo pré-ocupar um slot de dedup, e
      // (b) colapsava eventos legítimos DISTINTOS que compartilhassem a tripla (um
      // 2º PAYMENT_OVERDUE do mesmo pagamento sumia como "duplicate"). Sem id, é
      // melhor falhar alto: o Asaas re-tenta e o billing-reconcile é o backstop.
      const eventId = asStr(body.id);
      if (!eventId) {
        throw new BillingProviderError(
          '[billing] webhook sem body.id (chave de dedup)',
          'webhook_missing_event_id',
          400,
        );
      }
      return { eventId, event, paymentId: asStr(payment.id) };
    },

    validateWebhookToken(token) {
      // `safeEqual` já trata null/undefined e tamanhos diferentes sem lançar.
      return safeEqual(token, resolveValue(credential.webhookToken));
    },

    resetCircuit() {
      circuit.reset();
    },
  };

  return client;
}

/**
 * Client do Qoro — a conta que cobra as ASSINATURAS das clínicas (C13/ADR-025).
 * Singleton de módulo: preserva exatamente o comportamento anterior do breaker,
 * que era um único circuito compartilhado por todos os call-sites do billing.
 *
 * As credenciais são lidas por função (não no import) para manter a leitura tardia
 * de env que existia antes — `assertBillingRuntimeReady()` continua rodando a cada
 * request, e não no boot do módulo.
 */
const envClient = createAsaasClient({
  apiKey: () => {
    assertBillingRuntimeReady();
    return env.ASAAS_API_KEY!;
  },
  baseUrl: () => env.ASAAS_BASE_URL,
  webhookToken: () => env.ASAAS_WEBHOOK_TOKEN,
});

export const asaasProvider: PaymentProvider = envClient;

/** test-only — reseta o circuit breaker do client do Qoro entre testes. */
export const __testing__ = { resetCircuit: () => envClient.resetCircuit() };
