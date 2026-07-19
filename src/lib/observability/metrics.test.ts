/**
 * metrics.emit — forma do evento + herança de correlação (A2/A3).
 *
 * O requisito mais importante aqui é BACKWARD COMPATIBILITY: fora de um escopo
 * de contexto a linha emitida tem de ser exatamente a de hoje. Toda saved
 * search do Better Stack e todo dashboard dependem dessa forma; a correlação é
 * ADITIVA, nunca substitutiva.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runWithContext } from './context';
import { metrics } from './metrics';

function captureStdout() {
  const lines: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  return {
    records: () => lines.map((l) => JSON.parse(l.trim()) as Record<string, unknown>),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('metrics.emit', () => {
  it('SEM contexto: a linha é exatamente a de hoje (kind/event/campos)', () => {
    const out = captureStdout();
    metrics.emit('outbox.enqueued', { clinicId: 'c1', eventType: 'x' });

    const rec = out.records()[0]!;
    expect(rec).toMatchObject({ kind: 'metric', event: 'outbox.enqueued', clinicId: 'c1' });
    expect(typeof rec.ts).toBe('string');
    // Nada de correlação inventada quando não há escopo.
    expect(rec.request_id).toBeUndefined();
    expect(Object.keys(rec).sort()).toEqual(['clinicId', 'event', 'eventType', 'kind', 'ts']);
  });

  it('DENTRO de escopo: herda a correlação sem que o call-site mude', () => {
    const out = captureStdout();
    runWithContext({ requestId: 'r1', clinicId: 'c1', flow: 'cron.outbox' }, () => {
      metrics.emit('worker.tick', { processed: 3 });
    });

    expect(out.records()[0]).toMatchObject({
      kind: 'metric',
      event: 'worker.tick',
      processed: 3,
      request_id: 'r1',
      clinicId: 'c1',
      flow: 'cron.outbox',
    });
  });

  it('campo explícito VENCE o contexto ambiente', () => {
    const out = captureStdout();
    runWithContext({ clinicId: 'c-ambiente' }, () => {
      metrics.emit('outbox.processed', { clinicId: 'c-explicito' });
    });

    expect(out.records()[0]!.clinicId).toBe('c-explicito');
  });

  it('a correlação também é sanitizada (não escapa do pipeline)', () => {
    const out = captureStdout();
    runWithContext({ requestId: 'Bearer abcdefghijklmnop1234567890' }, () => {
      metrics.emit('x', {});
    });

    expect(JSON.stringify(out.records()[0])).not.toContain('abcdefghijklmnop1234567890');
  });
});
