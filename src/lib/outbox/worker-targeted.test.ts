/**
 * runOutboxEventsNow — o ingress processa SÓ os eventos que publicou (08/10/2026).
 *
 * O SQL de reserva é renderizado pelo dialeto real do Postgres do Drizzle, então
 * o teste confere o filtro que de fato chega ao banco (texto + parâmetros), não
 * uma string montada à mão.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { z } from 'zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  available: [] as Array<Record<string, unknown>>,
  reserveQueries: [] as Array<{ sql: string; params: unknown[] }>,
  handler: vi.fn(),
  janitor: vi.fn(),
  circuit: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('@/lib/db', () => {
  const dialect = new PgDialect();
  const tx = {
    execute: async (query: SQL) => {
      const rendered = dialect.sqlToQuery(query);
      if (rendered.sql.includes('FOR UPDATE SKIP LOCKED')) {
        state.reserveQueries.push({ sql: rendered.sql, params: rendered.params });
        const next = state.available.shift();
        return next ? [next] : [];
      }
      return [{ acquired: true }];
    },
    update: () => ({
      set: () => ({
        where: () => ({ returning: async () => [{ processing_started_at: new Date() }] }),
      }),
    }),
  };
  return {
    DB_WORKER_POOL_SIZE: 2,
    dbWorker: {
      transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
      update: () => ({
        set: () => ({ where: () => ({ returning: async () => [{ id: 'row' }] }) }),
      }),
    },
  };
});
vi.mock('@/lib/db/tenant', () => ({ withTenant: vi.fn() }));
vi.mock('@/lib/env', () => ({ env: { OUTBOX_BATCH_SIZE: 5, OUTBOX_PARALLELISM: 1 } }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: state.emit } }));
vi.mock('./janitor', () => ({ reclaimStuckProcessing: state.janitor }));
vi.mock('./circuit', () => ({ applyCircuitBreaker: state.circuit }));
vi.mock('./catalog', () => ({ getEventSchema: () => z.object({}).passthrough() }));
vi.mock('./registry', () => ({
  getHandler: () => ({ execution: 'detached', handler: state.handler }),
}));

import { OUTBOX_HANDLER_SLOW_MS, runOutboxEventsNow, runOutboxOnce } from './worker';

function pendingRow(id: string) {
  return {
    id,
    clinic_id: '11111111-1111-1111-1111-111111111111',
    event_type: 'messaging.inbound.received',
    payload: {},
    attempts: 0,
    clinic_exists: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.available = [];
  state.reserveQueries = [];
  state.janitor.mockResolvedValue(0);
  state.circuit.mockResolvedValue({ openedEventTypes: [], pausedCount: 0 });
});

describe('runOutboxEventsNow', () => {
  it('reserva somente pelo tipo e pelas chaves do request — nunca o mais antigo da fila', async () => {
    state.available = [pendingRow('evt-1')];

    const summary = await runOutboxEventsNow([
      { eventType: 'messaging.inbound.received', idempotencyKeys: ['inbound:meta:wamid-A'] },
    ]);

    expect(summary).toMatchObject({ processed: 1, failed: 0, empty: 0 });
    expect(state.handler).toHaveBeenCalledTimes(1);
    const [reserve] = state.reserveQueries;
    expect(reserve!.sql).toMatch(/o\.event_type = \$\d+/);
    expect(reserve!.sql).toMatch(/o\.idempotency_key IN \(\$\d+\)/);
    expect(reserve!.sql).toContain("o.status = 'pending' AND o.next_attempt_at <= now()");
    expect(reserve!.params).toEqual(['messaging.inbound.received', 'inbound:meta:wamid-A']);
  });

  it('não roda janitor nem circuit (UPDATEs amplos pertencem ao cron)', async () => {
    state.available = [pendingRow('evt-1')];

    await runOutboxEventsNow([
      { eventType: 'messaging.inbound.received', idempotencyKeys: ['inbound:meta:wamid-A'] },
    ]);

    expect(state.janitor).not.toHaveBeenCalled();
    expect(state.circuit).not.toHaveBeenCalled();
  });

  it('para quando não há mais linha pendente das chaves (já processada ou em backoff)', async () => {
    state.available = [pendingRow('evt-1')];

    const summary = await runOutboxEventsNow([
      {
        eventType: 'messaging.inbound.received',
        idempotencyKeys: ['inbound:meta:A', 'inbound:meta:B', 'inbound:meta:C'],
      },
    ]);

    expect(summary).toMatchObject({ processed: 1, empty: 1 });
    expect(state.reserveQueries).toHaveLength(2);
    expect(state.reserveQueries[0]!.params).toEqual([
      'messaging.inbound.received',
      'inbound:meta:A',
      'inbound:meta:B',
      'inbound:meta:C',
    ]);
  });

  it('seleção vazia não toca o banco', async () => {
    const summary = await runOutboxEventsNow([
      { eventType: 'messaging.business_app_echo.received', idempotencyKeys: [] },
    ]);

    expect(summary).toMatchObject({ processed: 0, empty: 0 });
    expect(state.reserveQueries).toHaveLength(0);
    expect(state.handler).not.toHaveBeenCalled();
  });

  it('processa as seleções na ordem dada (ecos antes das mensagens)', async () => {
    state.available = [pendingRow('echo'), pendingRow('msg')];

    await runOutboxEventsNow([
      { eventType: 'messaging.business_app_echo.received', idempotencyKeys: ['echo:1'] },
      { eventType: 'messaging.inbound.received', idempotencyKeys: ['inbound:1'] },
    ]);

    expect(state.reserveQueries.map((q) => q.params[0])).toEqual([
      'messaging.business_app_echo.received',
      'messaging.inbound.received',
    ]);
  });
});

describe('handler lento (R61)', () => {
  it('aponta o tipo de evento que passou da folga da janela, sem interromper o handler', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      state.available = [pendingRow('slow')];
      state.handler.mockImplementationOnce(async () => {
        vi.setSystemTime(Date.now() + OUTBOX_HANDLER_SLOW_MS + 1_000);
      });

      const summary = await runOutboxOnce({ batchSize: 1, parallelism: 1 });

      expect(summary).toMatchObject({ processed: 1, failed: 0 });
      expect(state.emit).toHaveBeenCalledWith('outbox.handler_slow', {
        eventType: 'messaging.inbound.received',
        handlerMs: OUTBOX_HANDLER_SLOW_MS + 1_000,
        ok: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('marca o desfecho de um handler lento que falhou', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      state.available = [pendingRow('slow-fail')];
      state.handler.mockImplementationOnce(async () => {
        vi.setSystemTime(Date.now() + OUTBOX_HANDLER_SLOW_MS + 5);
        throw new Error('Synthetic slow failure');
      });

      await runOutboxOnce({ batchSize: 1, parallelism: 1 });

      expect(state.emit).toHaveBeenCalledWith(
        'outbox.handler_slow',
        expect.objectContaining({ ok: false, handlerMs: OUTBOX_HANDLER_SLOW_MS + 5 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('handler dentro da folga não gera o aviso', async () => {
    state.available = [pendingRow('fast')];

    await runOutboxOnce({ batchSize: 1, parallelism: 1 });

    expect(state.emit).not.toHaveBeenCalledWith('outbox.handler_slow', expect.anything());
  });
});

describe('runOutboxOnce (cron) continua global', () => {
  it('reserva sem filtro de chave', async () => {
    state.available = [pendingRow('evt-1')];

    await runOutboxOnce({ batchSize: 1, parallelism: 1 });

    expect(state.reserveQueries[0]!.sql).not.toContain('idempotency_key');
    expect(state.reserveQueries[0]!.params).toEqual([]);
    expect(state.janitor).toHaveBeenCalledTimes(1);
    expect(state.circuit).toHaveBeenCalledTimes(1);
  });
});
