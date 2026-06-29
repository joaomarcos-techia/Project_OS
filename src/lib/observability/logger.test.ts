import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from './logger';

function captureStdout() {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  return {
    spy,
    /** Parsed JSON objects, one per emitted line. */
    records: () => lines.map((l) => JSON.parse(l.trim()) as Record<string, unknown>),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createLogger', () => {
  it('emits a structured JSON line at the configured level', () => {
    const out = captureStdout();
    createLogger('info').info('patient_created', { clinicId: 'c1' });

    const recs = out.records();
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({
      kind: 'log',
      level: 'info',
      event: 'patient_created',
      clinicId: 'c1',
    });
    expect(typeof recs[0]!.ts).toBe('string');
  });

  it('suppresses messages below the configured level', () => {
    const out = captureStdout();
    const log = createLogger('warn');
    log.debug('noisy');
    log.info('noisy');

    expect(out.records()).toHaveLength(0);

    log.warn('real');
    log.error('worse');
    expect(out.records().map((r) => r.level)).toEqual(['warn', 'error']);
  });

  it('does not emit debug at the default info level', () => {
    const out = captureStdout();
    createLogger('info').debug('trace');
    expect(out.records()).toHaveLength(0);
  });

  it('redacts secrets in fields (value-level)', () => {
    const out = captureStdout();
    createLogger('info').error('auth_failed', {
      header: 'Bearer abcdefghijklmnop1234567890',
    });

    const rec = out.records()[0]!;
    expect(JSON.stringify(rec)).not.toContain('abcdefghijklmnop1234567890');
    expect(rec.header).toBe('Bearer [REDACTED]');
  });

  it('serializes Error fields without leaking a stack', () => {
    const out = captureStdout();
    createLogger('info').error('boom', { err: new Error('kaboom') });

    const rec = out.records()[0]!;
    expect(rec.err).toMatchObject({ name: 'Error', message: 'kaboom' });
    expect(JSON.stringify(rec.err)).not.toContain('at ');
  });
});
