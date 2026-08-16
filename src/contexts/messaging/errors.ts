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
  'account',
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
   * META-001 — status HTTP devolvido pelo Graph, ou `null` quando o Graph sequer
   * respondeu (timeout/DNS/reset). O health precisa dessa distinção: 4xx é uma
   * NEGATIVA do provedor (o canal está mesmo quebrado), enquanto 5xx/timeout é
   * INDETERMINAÇÃO nossa. Tratar as duas igual degradaria a conexão de toda
   * clínica sempre que a Meta tivesse instabilidade. Não é usado no connect —
   * lá qualquer falha aborta do mesmo jeito.
   */
  readonly graphStatus: number | null;
  constructor(
    message: string,
    options?: { cause?: unknown; stage?: MetaConnectFailureStage; graphStatus?: number | null },
  ) {
    super(message, options);
    this.name = 'MetaConnectError';
    this.stage = options?.stage ?? 'unknown';
    this.graphStatus = options?.graphStatus ?? null;
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
