/** Messaging context domain errors (C10). `code` + `httpStatus` para o caller mapear. */

export class MessagingValidationError extends Error {
  readonly code = 'messaging_validation';
  readonly httpStatus = 422;
  constructor(message: string) {
    super(message);
    this.name = 'MessagingValidationError';
  }
}

/** A clínica não tem número WhatsApp ativo conectado (não há como enviar). */
export class NumberNotConnectedError extends Error {
  readonly code = 'number_not_connected';
  readonly httpStatus = 409;
  constructor(clinicId: string) {
    super(`Clínica ${clinicId} não tem número WhatsApp ativo conectado.`);
    this.name = 'NumberNotConnectedError';
  }
}

/**
 * Falha no fluxo de Embedded Signup (troca de code, escopos, resolução de WABA,
 * assinatura de webhook). `code` ESTÁVEL p/ a UI exibir sem vazar internals
 * ("Não foi possível conectar / Código: META_AUTH_FAILED"). A mensagem NUNCA
 * deve conter o access token nem corpos crus do Meta.
 */
export const META_CONNECT_FAILURE_STAGES = [
  'authorization',
  'permissions',
  // D78 — o Embedded Signup terminou sem entregar a `waba_id` do evento oficial.
  // Não é falha de autorização nem de conta: é evento incompleto do lado do
  // cliente, e sem ele NÃO existe caminho de menor privilégio para descobrir a
  // WABA (o antigo fallback por portfólio exigia `business_management`).
  'signup_incomplete',
  'account',
  // D78 — a WABA autorizada tem MAIS DE UM número e o evento não disse qual.
  // Separado de `account` porque a ação do usuário é outra: não é "confirme a
  // conta", é "escolha o número". Escolher por posição registraria, assinaria e
  // persistiria um número que o cliente não selecionou.
  'phone_ambiguous',
  // D78 — a Meta não respondeu de forma conclusiva a uma LEITURA (timeout,
  // rede, HTTP 5xx, 4xx sem código documentado). NÃO é negativa do provedor:
  // tratar indeterminação como "conta não encontrada" foi a mesma classe de
  // diagnóstico enganoso que o incidente expôs. Como só cobre GET, é seguro
  // afirmar que nada foi alterado.
  'provider_unavailable',
  // D78 — a Meta recusou por excesso de chamadas (HTTP 429 ou código de
  // throttling documentado). A requisição NÃO foi processada, então nada mudou;
  // a orientação é aguardar, não revisar a conta. Vale para qualquer etapa.
  'provider_rate_limited',
  // D78 — indeterminação numa MUTAÇÃO (`POST /register`, `POST` ou `DELETE`
  // /subscribed_apps). Timeout ou 5xx depois de um POST não diz se a operação
  // foi aplicada do outro lado. Sem read-back não se pode afirmar "nada foi
  // alterado" nem repetir o POST às cegas — é o mesmo princípio já adotado em
  // pagamentos para POST indeterminado.
  'provider_outcome_unknown',
  'phone_registration',
  'webhook_subscription',
  // Provisionamento de template no connect. Nunca aborta a conexao: so aparece
  // em log/metrica, porque o canal serve conversa de servico sem template.
  'template_provisioning',
  'persistence',
  'unknown',
] as const;

export type MetaConnectFailureStage = (typeof META_CONNECT_FAILURE_STAGES)[number];

export class MetaConnectError extends Error {
  readonly code = 'META_AUTH_FAILED';
  readonly httpStatus = 502;
  readonly stage: MetaConnectFailureStage;
  /**
   * Status HTTP devolvido pelo Graph, ou `null` quando o Graph sequer respondeu
   * (timeout/DNS/reset).
   *
   * D78 — o status SOZINHO não decide nada. A regra antiga "todo 4xx é negativa
   * autoritativa" classificava `429 Too Many Requests` — rate limit temporário
   * pelo [RFC 6585 §4](https://www.rfc-editor.org/rfc/rfc6585#section-4) — como
   * canal quebrado. A decisão passou para `classifyGraphFailure()`, que combina
   * status, `graphCode` e `graphSubcode`.
   */
  readonly graphStatus: number | null;
  /** `error.code` do corpo Graph. Numérico e não sensível. */
  readonly graphCode: number | null;
  /** `error.error_subcode` do corpo Graph, quando presente. */
  readonly graphSubcode: number | null;
  constructor(
    message: string,
    options?: {
      cause?: unknown;
      stage?: MetaConnectFailureStage;
      graphStatus?: number | null;
      graphCode?: number | null;
      graphSubcode?: number | null;
    },
  ) {
    super(message, options);
    this.name = 'MetaConnectError';
    this.stage = options?.stage ?? 'unknown';
    this.graphStatus = options?.graphStatus ?? null;
    this.graphCode = options?.graphCode ?? null;
    this.graphSubcode = options?.graphSubcode ?? null;
  }
}

/** Destinatário está na suppression_list do Patient — envio bloqueado (opt-out). */
export class SuppressedRecipientError extends Error {
  readonly code = 'suppressed_recipient';
  readonly httpStatus = 409;
  constructor(toNumber: string) {
    super(`Destinatário ${toNumber} optou por não receber mensagens (suppression_list).`);
    this.name = 'SuppressedRecipientError';
  }
}
