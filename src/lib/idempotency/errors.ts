/**
 * Domain errors for idempotency. Callers handle these explicitly to translate
 * into HTTP responses (409 / 425) or to backoff-and-retry on the client side.
 */

export class IdempotencyConflictError extends Error {
  constructor(public readonly key: string) {
    // Same key, different payload hash → caller used the same idempotency key
    // for a semantically different request. This is a CLIENT bug; we surface
    // it as 409 Conflict.
    super(`Idempotency key ${key} reused with a different payload`);
    this.name = 'IdempotencyConflictError';
  }
}

/**
 * LGPD-004 — a operação TERMINOU, mas a resposta cacheada foi expurgada pela
 * eliminação do titular.
 *
 * Erro próprio, e não um dos dois acima, porque a semântica é a terceira:
 *   - `InFlight` (425) diria "tente de novo em instantes" → o cliente ficaria
 *     em loop esperando algo que nunca vai voltar;
 *   - `Conflict` (409) diria "você reusou a chave com outro payload" → falso.
 *
 * O contrato que importa: NÃO reexecutar a mutação (ela aconteceu) e NÃO
 * devolver um DTO inventado no lugar do conteúdo apagado.
 */
export class IdempotencyPurgedError extends Error {
  readonly httpStatus = 410;
  constructor(public readonly key: string) {
    super(`Idempotency key ${key} completed, but its response was erased (LGPD)`);
    this.name = 'IdempotencyPurgedError';
  }
}

export class IdempotencyInFlightError extends Error {
  constructor(public readonly key: string) {
    // Either:
    //   (a) Another transaction is currently holding the lock on this key.
    //       Our SET LOCAL lock_timeout = '3s' fired → translated to this error.
    //   (b) The previous transaction reserved the row but has not yet
    //       committed its response (visible NULL in `response`).
    // Both cases: caller should backoff and retry shortly. 425 Too Early.
    super(`Idempotency key ${key} is currently being processed; retry shortly`);
    this.name = 'IdempotencyInFlightError';
  }
}
