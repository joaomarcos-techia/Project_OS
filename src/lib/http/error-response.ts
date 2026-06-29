import { randomUUID } from 'node:crypto';

/**
 * Standard C16 error envelope. One shape for API routes / server actions so the
 * frontend treats failures uniformly and a `trace_id` correlates the response to
 * logs ([logger.ts]), audit rows ([request-context.ts]) and Sentry.
 *
 *   { error: true, code, message, trace_id, timestamp }
 *
 * Domain errors (those exposing `code: string` + `httpStatus: number`, e.g.
 * `src/contexts/*\/errors.ts`) carry a UI-safe message and map 1:1. Anything else
 * is an unexpected failure → generic 500 with NO message leak (the real error
 * goes to logs/Sentry, never to the client).
 */
export type ErrorEnvelope = {
  error: true;
  code: string;
  message: string;
  trace_id: string;
  timestamp: string;
};

type DomainError = { code: string; httpStatus: number; message: string };

function isDomainError(err: unknown): err is DomainError {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { code?: unknown }).code === 'string' &&
    typeof (err as { httpStatus?: unknown }).httpStatus === 'number'
  );
}

/** Build the envelope + the HTTP status to return. `traceId` should be the request id. */
export function toErrorEnvelope(
  err: unknown,
  traceId?: string,
): { envelope: ErrorEnvelope; status: number } {
  const trace_id = traceId ?? randomUUID();
  const timestamp = new Date().toISOString();

  if (isDomainError(err)) {
    return {
      status: err.httpStatus,
      envelope: { error: true, code: err.code, message: err.message, trace_id, timestamp },
    };
  }

  return {
    status: 500,
    envelope: { error: true, code: 'internal', message: 'Erro interno.', trace_id, timestamp },
  };
}

/** Convenience for route handlers: a `Response` carrying the envelope JSON. */
export function toErrorResponse(err: unknown, traceId?: string): Response {
  const { envelope, status } = toErrorEnvelope(err, traceId);
  return Response.json(envelope, { status });
}
