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
