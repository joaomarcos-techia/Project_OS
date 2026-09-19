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
const ASAAS_WEBHOOK_API_VERSION = 3;
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
  /**
   * Opcional desde o ADR-050: o customer de PACIENTE viaja com o mínimo (nome +
   * CPF) e não leva e-mail. O Asaas exige `name`; o resto é complemento. Billing
   * (assinatura da clínica) continua enviando normalmente.
   */
  email?: string | null;
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

/** Checkout hospedado e avulso: o Asaas coleta o meio, nunca o Qoro. */
export interface CreateCheckoutInput {
  value: number;
  description: string;
  externalReference: string;
  /** Contrato do Asaas: entre 10 minutos e 24 horas. */
  minutesToExpire: number;
  callback: {
    successUrl: string;
    cancelUrl: string;
    expiredUrl: string;
  };
}

export interface ProviderCheckout {
  checkoutId: string;
  status: string;
  link: string | null;
  externalReference: string | null;
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
  /** Checkout hospedado que originou a cobrança, quando houver. */
  checkoutSessionId: string | null;
  /** Estado autoritativo do objeto `chargeback`, quando a cobrança está em disputa. */
  chargebackStatus?: string | null;
  chargebackReason?: string | null;
  /**
   * A cobranca foi REMOVIDA da conta (ADR-049 1.5). Verificado ao vivo em
   * 2026-08-24, e nada intuitivo: `DELETE /payments/{id}` responde 200, mas o
   * `GET` seguinte **tambem responde 200** — com o `status` ORIGINAL (`PENDING`)
   * e este campo em `true`. Nao existe 404 aqui.
   *
   * Sem expor isto, cobranca apagada e indistinguivel de cobranca viva, e o
   * sistema entregaria ao paciente um link que ele nao consegue pagar.
   */
  deleted: boolean;
}

/**
 * Resultado de um estorno. O Asaas devolve o objeto do REFUND (não o do
 * pagamento), por isso `status` aqui é o status do estorno — não confundir com
 * `ProviderPayment.status`, que é o da cobrança.
 */
export interface ProviderRefund {
  /**
   * O item de `refunds` pode não expor id. Nunca reutilize o id do pagamento
   * retornado por `POST /refund` como se fosse o id do estorno.
   */
  refundId: string | null;
  status: string;
  value: number;
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
  /** Identidade segura para consulta autoritativa de cobranças do Checkout. */
  checkoutId: string | null;
}

export interface CreateWebhookInput {
  /** Rótulo que aparece no painel do Asaas da clínica. */
  name: string;
  url: string;
  /**
   * OBRIGATÓRIO pelo Asaas (verificado ao vivo: sem ele, `invalid_email`). É para
   * onde o Asaas avisa quando o webhook começa a falhar. Usamos o e-mail da
   * PRÓPRIA conta da clínica — quem é dono da conta é quem precisa saber.
   */
  email: string;
  /** Token que o Asaas passará a enviar no header `asaas-access-token`. */
  authToken: string;
  /** Eventos assinados. Só os de pagamento — nada de assinatura/transferência. */
  events: readonly string[];
}

/** Identificação mínima da conta. Sem CPF/CNPJ: PII de terceiro não entra no Qoro. */
export interface AsaasAccountInfo {
  name: string | null;
  email: string | null;
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
  /** Cria uma página hospedada limitada, por contrato, a PIX e cartão. */
  createCheckout(input: CreateCheckoutInput): Promise<ProviderCheckout>;
  /** Cancela uma geração de Checkout que ainda não deve aceitar pagamento. */
  cancelCheckout(asaasCheckoutId: string): Promise<void>;
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
  /** Resolve a cobrança criada por uma sessão de Checkout sem confiar no webhook. */
  findPaymentByCheckoutSession(
    asaasCheckoutId: string,
    opts?: { attempts?: number },
  ): Promise<ProviderPayment | null>;
  /**
   * `POST /payments/{id}/refund` — devolve o dinheiro ao paciente (ADR-049 1.5,
   * ramo C: cancelamento dentro da janela).
   *
   * **Sem retry**, como todo POST aqui: o Asaas não tem idempotency-key nativa e
   * um segundo POST às cegas é um segundo estorno. Quem chama verifica o estado
   * com `getPayment` ANTES (mesma doutrina do `findPaymentByExternalReference`).
   *
   * `value` omitido = estorno total. Estorno parcial existe na API, mas nenhum
   * caminho do Qoro o usa hoje — o sinal é devolvido inteiro ou não é devolvido.
   */
  refundPayment(
    asaasPaymentId: string,
    opts?: { value?: number; description?: string },
  ): Promise<ProviderRefund>;
  /**
   * Read-back autoritativo dos estornos de uma cobranca.
   *
   * D50 usa esta consulta depois do POST (ou de um timeout) para nunca repetir
   * cegamente uma devolucao que o Asaas pode ja ter aceitado.
   */
  listPaymentRefunds(
    asaasPaymentId: string,
    opts?: { attempts?: number },
  ): Promise<ProviderRefund[]>;
  /**
   * `DELETE /payments/{id}` — remove uma cobrança **ainda não paga**.
   *
   * É o que impede o pior desfecho do ramo A/C: agendamento cancelado ou marcado
   * como falta com o link do sinal ainda vivo, e o paciente pagando por uma vaga
   * que não existe mais. O Asaas recusa remover cobrança já recebida — por isso o
   * chamador confere o status antes, e trata 404 como "já não existe".
   */
  cancelPayment(asaasPaymentId: string): Promise<{ deleted: boolean }>;
  /**
   * `GET /myAccount` — prova que a credencial existe, é válida e é da conta que o
   * operador pensa que é. É o único jeito barato de reprovar uma chave errada ANTES
   * de ela virar cobrança falhando em produção.
   *
   * Tolerante por desenho: qualquer 2xx significa credencial boa. Os campos são
   * opcionais porque o formato do payload é do Asaas, não nosso — se ele mudar de
   * nome amanhã, a validação continua funcionando e só o rótulo da tela fica nulo.
   */
  getMyAccount(opts?: { attempts?: number }): Promise<AsaasAccountInfo>;
  /**
   * Configura o webhook na conta. Se a mesma rota já existir, atualiza o recurso
   * em vez de repetir o POST que o Asaas rejeita como `invalid_object`.
   *
   * Regras do provedor confirmadas na documentação e AO VIVO (2026-08-26):
   * `apiVersion`, `sendType` e `email` são obrigatórios · o `authToken` precisa de
   * **≥32 caracteres** e **não pode ter mais de 4 iguais consecutivos**.
   *
   * O `authToken` é enviado e **nunca devolvido** pela API — o painel do Asaas
   * expõe apenas um indicador de que existe. Por isso o token é guardado do nosso
   * lado (cifrado): não há de onde relê-lo depois.
   */
  createWebhook(input: CreateWebhookInput): Promise<{ webhookId: string }>;
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

function chargebackFields(
  value: Record<string, unknown>,
): Pick<ProviderPayment, 'chargebackStatus' | 'chargebackReason'> {
  if (!value.chargeback || typeof value.chargeback !== 'object') return {};
  const chargeback = value.chargeback as Record<string, unknown>;
  return {
    chargebackStatus: asStr(chargeback.status),
    chargebackReason: asStr(chargeback.reason),
  };
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

  function webhookTarget(url: string): string | null {
    try {
      const parsed = new URL(url);
      // O bypass de Preview pode ser rotacionado. A identidade operacional do
      // webhook é origem + rota; a query será substituída pelo valor atual no PUT.
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return null;
    }
  }

  async function findExistingWebhook(input: CreateWebhookInput): Promise<string | null> {
    const desiredTarget = webhookTarget(input.url);
    if (!desiredTarget) return null;

    // O Asaas permite no máximo 10 webhooks por conta. O limite 100 mantém a
    // busca em uma chamada e segue o máximo documentado do endpoint.
    const response = (await request('GET', '/webhooks?offset=0&limit=100', undefined, {
      attempts: 1,
    })) as { data?: unknown };
    const webhooks = Array.isArray(response.data) ? response.data : [];
    for (const raw of webhooks) {
      if (!raw || typeof raw !== 'object') continue;
      const webhook = raw as Record<string, unknown>;
      if (asStr(webhook.name) !== input.name) continue;
      const existingUrl = asStr(webhook.url);
      const id = asStr(webhook.id);
      if (existingUrl && id && webhookTarget(existingUrl) === desiredTarget) return id;
    }
    return null;
  }

  async function updateWebhook(id: string, input: CreateWebhookInput): Promise<void> {
    await request('PUT', `/webhooks/${encodeURIComponent(id)}`, {
      name: input.name,
      url: input.url,
      enabled: true,
      interrupted: false,
      authToken: input.authToken,
      sendType: 'SEQUENTIALLY',
      events: input.events,
    });
  }

  const client: AsaasClient = {
    async createCustomer(input) {
      const body = {
        name: input.name,
        email: input.email ?? undefined,
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
        checkoutSessionId: asStr(r.checkoutSession),
        ...chargebackFields(r),
        deleted: r.deleted === true,
      };
    },

    async createCheckout(input) {
      if (
        !Number.isInteger(input.minutesToExpire) ||
        input.minutesToExpire < 10 ||
        input.minutesToExpire > 1_440
      ) {
        throw new BillingProviderError(
          'Checkout exige expiração entre 10 e 1440 minutos.',
          'checkout_expiration_invalid',
        );
      }

      const r = (await request('POST', '/checkouts', {
        billingTypes: ['PIX', 'CREDIT_CARD'],
        chargeTypes: ['DETACHED'],
        minutesToExpire: input.minutesToExpire,
        externalReference: input.externalReference,
        callback: input.callback,
        items: [
          {
            name: input.description,
            description: input.description,
            quantity: 1,
            value: input.value,
          },
        ],
      })) as Record<string, unknown>;

      return {
        checkoutId: String(r.id),
        status: asStr(r.status) ?? 'UNKNOWN',
        link: asStr(r.link),
        externalReference: asStr(r.externalReference),
      };
    },

    async cancelCheckout(id) {
      await request('POST', `/checkouts/${encodeURIComponent(id)}/cancel`);
      metrics.emit('billing.asaas.checkout_cancelled', { checkoutId: id });
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
          checkoutSessionId: asStr(p.checkoutSession),
          deleted: p.deleted === true,
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
        checkoutSessionId: asStr(r.checkoutSession),
        ...chargebackFields(r),
        deleted: r.deleted === true,
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
        checkoutSessionId: asStr(p.checkoutSession),
        deleted: p.deleted === true,
      };
    },

    async findPaymentByCheckoutSession(checkoutId, opts) {
      const query = new URLSearchParams({ checkoutSession: checkoutId, limit: '10', offset: '0' });
      const r = (await request('GET', `/payments?${query.toString()}`, undefined, opts)) as {
        data?: unknown;
      };
      const payments = Array.isArray(r.data) ? r.data : [];
      const exact = payments.find(
        (payment) =>
          payment &&
          typeof payment === 'object' &&
          asStr((payment as Record<string, unknown>).checkoutSession) === checkoutId,
      );
      if (!exact || typeof exact !== 'object') return null;
      const p = exact as Record<string, unknown>;
      return {
        paymentId: String(p.id),
        status: asStr(p.status) ?? 'UNKNOWN',
        value: asNum(p.value),
        dueDate: asStr(p.dueDate) ?? '',
        invoiceUrl: asStr(p.invoiceUrl),
        subscriptionId: asStr(p.subscription),
        billingType: asStr(p.billingType),
        externalReference: asStr(p.externalReference),
        checkoutSessionId: asStr(p.checkoutSession),
        deleted: p.deleted === true,
      };
    },

    async refundPayment(id, opts) {
      const body: Record<string, unknown> = {};
      if (opts?.value !== undefined) body.value = opts.value;
      if (opts?.description !== undefined) body.description = opts.description;
      const r = (await request(
        'POST',
        `/payments/${encodeURIComponent(id)}/refund`,
        body,
      )) as Record<string, unknown>;
      metrics.emit('billing.asaas.payment_refunded', { paymentId: id });
      return {
        // A resposta é o pagamento atualizado; `r.id` pertence à cobrança.
        // O endpoint não fornece um identificador autoritativo do refund. A
        // correlação forte vem do baseline persistido antes do POST + readback.
        refundId: null,
        status: 'PENDING',
        value: opts?.value ?? asNum(r.value),
      };
    },

    async listPaymentRefunds(id, opts) {
      const r = (await request(
        'GET',
        `/payments/${encodeURIComponent(id)}/refunds?offset=0&limit=100`,
        undefined,
        opts,
      )) as { data?: unknown };
      const refunds = Array.isArray(r.data) ? r.data : [];
      return refunds.flatMap((raw) => {
        if (!raw || typeof raw !== 'object') return [];
        const refund = raw as Record<string, unknown>;
        return [
          {
            refundId: asStr(refund.id),
            status: asStr(refund.status) ?? 'UNKNOWN',
            value: asNum(refund.value),
          },
        ];
      });
    },

    async cancelPayment(id) {
      const r = (await request('DELETE', `/payments/${encodeURIComponent(id)}`)) as Record<
        string,
        unknown
      > | null;
      metrics.emit('billing.asaas.payment_cancelled', { paymentId: id });
      // O Asaas devolve `{ deleted: true, id }`. Um 204 (corpo vazio) também é
      // sucesso — a cobrança deixou de existir, que é a única coisa que importa.
      return { deleted: r === null ? true : r.deleted !== false };
    },

    async createWebhook(input) {
      const existingId = await findExistingWebhook(input);
      if (existingId) {
        await updateWebhook(existingId, input);
        return { webhookId: existingId };
      }

      const body = {
        name: input.name,
        url: input.url,
        email: input.email,
        enabled: true,
        interrupted: false,
        apiVersion: ASAAS_WEBHOOK_API_VERSION,
        authToken: input.authToken,
        sendType: 'SEQUENTIALLY',
        events: input.events,
      };
      try {
        const r = (await request('POST', '/webhooks', body)) as Record<string, unknown>;
        return { webhookId: String(r.id ?? '') };
      } catch (error) {
        // Duas conexões concorrentes podem listar "nenhum", e uma delas criar o
        // recurso antes do POST da outra. Nesse conflito específico, relê e
        // converge por PUT; outros 400 continuam subindo sem serem mascarados.
        if (
          error instanceof BillingProviderError &&
          error.httpStatus === 400 &&
          error.providerErrorCodes.includes('invalid_object')
        ) {
          const racedId = await findExistingWebhook(input);
          if (racedId) {
            await updateWebhook(racedId, input);
            return { webhookId: racedId };
          }
        }
        throw error;
      }
    },

    async getMyAccount(opts) {
      const res = (await request('GET', '/myAccount', undefined, opts)) as Record<string, unknown>;
      return { name: asStr(res.name), email: asStr(res.email) };
    },

    parseWebhook(raw) {
      const body = JSON.parse(raw) as Record<string, unknown>;
      const payment = (body.payment ?? {}) as Record<string, unknown>;
      const checkout = (body.checkout ?? {}) as Record<string, unknown>;
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
      return {
        eventId,
        event,
        paymentId: asStr(payment.id),
        checkoutId: asStr(checkout.id) ?? asStr(payment.checkoutSession),
      };
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
