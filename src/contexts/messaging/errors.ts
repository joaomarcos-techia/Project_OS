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
export class MetaConnectError extends Error {
  readonly code = 'META_AUTH_FAILED';
  readonly httpStatus = 502;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MetaConnectError';
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
