import { env } from '@/lib/env';

const MAX_ERROR_LEN = 4000;

/**
 * Domain error a handler can throw to categorize a failure for the DLQ.
 * `code` ends up in outbox.error_code (snake_case, ≤64 chars enforced by CHECK).
 */
export class HandlerError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'unknown',
  ) {
    super(message);
    this.name = 'HandlerError';
  }
}

export class HandlerNotFoundError extends HandlerError {
  constructor(eventType: string) {
    super(`handler missing for eventType: ${eventType}`, 'handler_not_found');
  }
}

/**
 * Sinaliza ao worker que este evento NÃO deve ser retentado — falha é
 * permanente e semântica (payload inválido por regra de negócio, recurso
 * destino deletado para sempre, etc.). Worker marca `status='failed'`
 * imediatamente, sem backoff, sem queimar attempts.
 *
 * Uso:
 *   if (!patient) throw new PoisonPillError('patient deleted', 'patient_gone');
 *
 * vs HandlerError (retentar) ou throw genérico (retentar).
 */
export class PoisonPillError extends HandlerError {
  constructor(message: string, code: string = 'poison_pill') {
    super(message, code);
    this.name = 'PoisonPillError';
  }
}

/**
 * Sinal explícito: external side-effect já foi tentado por um attempt anterior
 * mas não foi confirmado como concluído. Caller (handler) deve consultar o
 * provider (via providerIdempotencyKey) para descobrir o estado real antes de
 * decidir retry ou abort. Worker trata como retry normal (não consome attempt
 * extra).
 */
export class SideEffectInFlightError extends HandlerError {
  constructor(eventId: string, sideEffectKey: string) {
    super(
      `side-effect ${sideEffectKey} for event ${eventId} is in-flight; check provider status`,
      'side_effect_in_flight',
    );
    this.name = 'SideEffectInFlightError';
  }
}

export class OutboxError extends Error {
  constructor(message: string) {
    super(`[outbox] ${message}`);
    this.name = 'OutboxError';
  }
}

/**
 * Capped + production-safe error serialization.
 *
 * - In production, NEVER persist the stack — it can pull in HTML, request
 *   bodies, SQL dumps, or other forensic noise that bloats the row.
 * - In development, include the stack for debuggability.
 * - Always truncate to MAX_ERROR_LEN (4000 chars). The DB CHECK constraint
 *   (octet_length <= 8192) is a defense-in-depth catch — this is the contract.
 * - error_code MUST be snake_case ≤64 chars (enforced by SQL CHECK). For
 *   non-HandlerError sources we default to `unknown`.
 */
export function serializeError(err: unknown): { message: string; code: string } {
  if (err instanceof HandlerError) {
    return { message: truncate(err.message, MAX_ERROR_LEN), code: err.code };
  }
  if (err instanceof Error) {
    const base = env.NODE_ENV === 'production'
      ? err.message || err.name
      : `${err.name}: ${err.message}\n${err.stack ?? ''}`;
    return { message: truncate(base, MAX_ERROR_LEN), code: 'unknown' };
  }
  return { message: truncate(String(err), MAX_ERROR_LEN), code: 'unknown' };
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 14) + '...[truncated]';
}

/**
 * Predicate for Postgres `unique_violation` (SQLSTATE 23505). Used by
 * publishEvent to silently swallow duplicate enqueues of the same event_type
 * + idempotency_key — exactly the semantics we want for retried Server Actions.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (matchesPgCode(err, '23505')) return true;
  // libpq's error message format is canonical and stable across Postgres
  // versions, drivers, and locales: literally "duplicate key value violates
  // unique constraint" (see src/backend/access/index/genam.c). Drizzle wraps
  // PostgresError into a DrizzleQueryError in some paths and the .code
  // disappears from the chain — but the message survives. Smoke 4.6.4 caught
  // this in C4 dev when the chain walk alone returned false.
  return /duplicate key value violates unique constraint/i.test(extractMessage(err));
}

/**
 * Predicate for Postgres `lock_not_available` (SQLSTATE 55P03), raised when
 * `SET LOCAL lock_timeout = '3s'` fires. idempotentMutation translates this
 * into `IdempotencyInFlightError` so callers do not need PG-error literacy.
 */
export function isLockTimeout(err: unknown): boolean {
  if (matchesPgCode(err, '55P03')) return true;
  // Same rationale as isUniqueViolation: canonical libpq message.
  return /canceling statement due to lock timeout/i.test(extractMessage(err));
}

/**
 * Walks `.cause` chain up to 5 levels looking for a PG SQLSTATE code.
 *
 * Why a chain walk: Drizzle (and some Node runtimes) wrap PostgresError in a
 * DrizzleQueryError when the failure happens inside a transaction. The
 * original `.code` lives at `err.cause.code`. Comparing only `err.code === ...`
 * silently fails — the catch falls through to `throw err` instead of swallowing
 * the duplicate / translating the lock timeout.
 */
function matchesPgCode(err: unknown, code: string): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current !== 'object' || current === null) return false;
    if ((current as { code?: string }).code === code) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Best-effort message extraction. Combined with the .cause chain in
 * `matchesPgCode`, this is enough to recognize libpq-format errors no matter
 * how many layers wrap them.
 */
function extractMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}
