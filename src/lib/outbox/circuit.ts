import { and, eq, inArray, lt, sql } from 'drizzle-orm';

import { dbWorker } from '@/lib/db';
import { outbox } from '@/lib/db/schema/infra/outbox';
import { metrics } from '@/lib/observability/metrics';

/**
 * Circuit breaker — stateless via SQL.
 *
 * Problema: deploy bugado em um handler crítico → milhares de eventos do mesmo
 * event_type explodem em flood; cada um consome um worker slot; retentativas
 * pressionam Postgres; sistema entra em cascading failure. Cap de 5 attempts
 * protege a ROW, NÃO o sistema.
 *
 * Mitigação: no INÍCIO de cada worker tick (antes da reserva), olhamos quais
 * event_types tiveram ≥10 failures nos últimos 5 minutos. Para cada um,
 * empurramos o `next_attempt_at` de TODOS os pending desse tipo em +5 minutos
 * (cooldown). Eventos pendentes desse tipo simplesmente não aparecem no
 * SELECT do worker durante o cooldown.
 *
 * Por que stateless via SQL:
 *   - In-memory perde estado entre cron ticks (cada tick é uma invocação
 *     serverless distinta).
 *   - Tabela auxiliar adiciona surface (mais um schema, mais um lugar para
 *     bug). DB tem a verdade — `last_failed_at` é o sinal.
 *   - Operador depura com SQL puro:
 *       SELECT event_type, count(*) FROM outbox
 *        WHERE last_failed_at > now() - interval '5 min'
 *        GROUP BY event_type ORDER BY 2 DESC;
 *
 * Tuning frozen para MVP:
 *   FAILURE_THRESHOLD = 10
 *   OBSERVATION_WINDOW = 5min
 *   COOLDOWN = 5min
 *
 * Reset manual: ver runbook (`UPDATE outbox SET next_attempt_at=now() ...`).
 */
const FAILURE_THRESHOLD = 10;
const OBSERVATION_WINDOW = sql`interval '5 minutes'`;
const COOLDOWN = sql`interval '5 minutes'`;

export type CircuitResult = {
  openedEventTypes: string[];
  pausedCount: number;
};

export async function applyCircuitBreaker(): Promise<CircuitResult> {
  // 1. Identify toxic event_types.
  const toxic = await dbWorker.execute<{ event_type: string; recent_failures: number }>(sql`
    SELECT event_type, count(*)::int AS recent_failures
      FROM outbox
     WHERE last_failed_at IS NOT NULL
       AND last_failed_at > now() - ${OBSERVATION_WINDOW}
     GROUP BY event_type
    HAVING count(*) >= ${FAILURE_THRESHOLD}
  `);
  if (toxic.length === 0) {
    return { openedEventTypes: [], pausedCount: 0 };
  }

  const types = toxic.map((t) => t.event_type);

  // 2. Push pending events of those types forward by COOLDOWN.
  //    Uses Drizzle's `inArray` helper instead of raw `event_type = ANY($1::text[])`
  //    — embedded JS arrays in template `sql` don't serialize as PG array
  //    literals; the result is "malformed array literal" at runtime (caught by
  //    smoke 4.6.14 in C4 dev). inArray expands to `IN ($1, $2, ...)` with one
  //    bound param per element.
  //    Condition `next_attempt_at < now() + cooldown` evita duplo-push em ticks
  //    consecutivos (idempotente sob re-execução).
  const paused = await dbWorker
    .update(outbox)
    .set({
      nextAttemptAt: sql`greatest(${outbox.nextAttemptAt}, now() + ${COOLDOWN})`,
      lastError: sql`coalesce(${outbox.lastError}, '') || ' [circuit-paused]'`,
    })
    .where(
      and(
        eq(outbox.status, 'pending'),
        inArray(outbox.eventType, types),
        lt(outbox.nextAttemptAt, sql`now() + ${COOLDOWN}`),
      ),
    )
    .returning({ id: outbox.id });

  metrics.emit('outbox.circuit.opened', {
    eventTypes: types,
    pausedCount: paused.length,
    observationWindow: '5min',
    cooldown: '5min',
  });

  return { openedEventTypes: types, pausedCount: paused.length };
}
