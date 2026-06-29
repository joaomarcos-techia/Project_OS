import { describe, expect, it } from 'vitest';

import { toErrorEnvelope, toErrorResponse } from './error-response';

/** Structural stand-in for a domain error (code + httpStatus), no cross-context import. */
function domainError(code: string, httpStatus: number, message: string): Error {
  return Object.assign(new Error(message), { code, httpStatus });
}

describe('toErrorEnvelope', () => {
  it('maps a domain error to its code, message and httpStatus', () => {
    const { envelope, status } = toErrorEnvelope(
      domainError('clinical_validation', 422, 'CRM inválido'),
      'trace-1',
    );

    expect(status).toBe(422);
    expect(envelope).toEqual({
      error: true,
      code: 'clinical_validation',
      message: 'CRM inválido',
      trace_id: 'trace-1',
      timestamp: expect.any(String),
    });
    expect(() => new Date(envelope.timestamp).toISOString()).not.toThrow();
  });

  it('falls back to a generic 500 without leaking the original message', () => {
    const { envelope, status } = toErrorEnvelope(new Error('SECRET db dsn leak'), 'trace-2');

    expect(status).toBe(500);
    expect(envelope.code).toBe('internal');
    expect(envelope.message).not.toContain('SECRET');
    expect(envelope.trace_id).toBe('trace-2');
  });

  it('uses the provided trace id', () => {
    const { envelope } = toErrorEnvelope(new Error('x'), 'abc-123');
    expect(envelope.trace_id).toBe('abc-123');
  });

  it('generates a trace id when none is provided', () => {
    const a = toErrorEnvelope(new Error('x')).envelope.trace_id;
    const b = toErrorEnvelope(new Error('x')).envelope.trace_id;
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

describe('toErrorResponse', () => {
  it('returns a Response with the mapped status and JSON envelope', async () => {
    const res = toErrorResponse(domainError('prontuario_conflito', 409, 'recarregue'), 't');
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      error: true,
      code: 'prontuario_conflito',
      message: 'recarregue',
      trace_id: 't',
    });
  });
});
