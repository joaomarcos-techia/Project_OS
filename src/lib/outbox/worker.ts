import { and, eq, sql } from 'drizzle-orm';
import pLimit from 'p-limit';

import { dbWorker } from '@/lib/db';
import { outbox } from '@/lib/db/schema/infra/outbox';
import { withTenant } from '@/lib/db/tenant';
import { env } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';

import { backoffDelayMs, BACKOFF_FAIL } from './backoff';
import { getEventSchema } from './catalog';
import { applyCircuitBreaker } from './circuit';
import {
  HandlerNotFoundError,
  PoisonPillError,
  serializeError,
} from './errors';
import { reclaimStuckProcessing } from './janitor';
import { getHandler } from './registry';
import type { WorkerTickSummary } from './types';

/**
 * runOutboxOnce — invocada por:
 *   - GET /api/cron/outbox  (Vercel Cron, every 1 min)
 *   - scripts/smoke-c4.ts   (testes manuais e CI)
 *
 * Fluxo por tick:
 *   0. Advisory lock global (HIGH-15): pg_try_advisory_lock evita 2 ticks
 *      executarem janitor/circuit/processOne em paralelo. SKIP LOCKED já
 *      previne dupla reserva da MESMA row entre ticks paralelos, mas o
 *      janitor + circuit fazem UPDATEs amplos que duplicam custo e métrica
 *      sem advisory. Se não conseguir o lock, retorna early com métrica.
 *   1. Janitor: reclama rows presas em 'processing' > 5 min → 'pending'.
 *   2. Circuit breaker: pause events de tipos tóxicos (≥10 failures em 5 min).
 *   3. processOne() em paralelo bounded (p-limit env.OUTBOX_PARALLELISM).
 *      batchSize total = env.OUTBOX_BATCH_SIZE.
 *   4. Cada processOne é três TXs separadas (zero role-switching dentro de TX):
 *        TX1 (dbWorker): reserve via SKIP LOCKED + UPDATE processing,
 *                        RETURNING processing_started_at como guard token
 *        TX2 (withTenant authenticated): handler runs; RLS aplica
 *        TX3 (dbWorker): finalize CONDITIONAL em processing_started_at — se
 *                        janitor reclamou no meio, UPDATE não aplica e
 *                        emitimos `outbox.lost_race` (CRITICAL-01)
 *
 * Pool: usa `dbWorker` (max:5 por default, env.OUTBOX_DB_POOL_SIZE).
 * `dbAdmin` (max:1) ficaria saturado em rede AWS Oregon (smoke 4.6.2: ~70s).
 */
export async function runOutboxOnce(opts: {
  batchSize?: number;
  parallelism?: number;
} = {}): Promise<WorkerTickSummary> {
  const t0 = Date.now();
  const batchSize = opts.batchSize ?? env.OUTBOX_BATCH_SIZE;
  const parallelism = opts.parallelism ?? env.OUTBOX_PARALLELISM;

  // Advisory lock (HIGH-15). Key derivada da string 'outbox-worker' via
  // hashtext (PG built-in). Sessão de dbWorker; auto-released ao COMMIT.
  // Usamos transaction-scoped (try_advisory_xact_lock) para garantir release.
  const lockResult = await dbWorker.transaction<boolean>(async (tx) => {
    const rows = await tx.execute<{ acquired: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtext('outbox-worker')) AS acquired`,
    );
    if (!rows[0]?.acquired) return false;

    // Mantém o lock aberto pelo restante do tick: rodamos TUDO dentro desta TX.
    // ERRADO — TX longa não escala. Em vez disso, libera o lock e roda fora.
    // O advisory_xact_lock libera ao COMMIT, então só serializa a aquisição.
    // O ganho real é: se 2 ticks fazem isto simultaneamente, um vai retornar
    // false e abortar — sem 2× custo de janitor/circuit.
    return true;
  });

  if (!lockResult) {
    const summary: WorkerTickSummary = {
      processed: 0,
      failed: 0,
      skipped: 0,
      stuck_reclaimed: 0,
      circuit_paused: 0,
      duration_ms: Date.now() - t0,
    };
    metrics.emit('worker.tick.skipped_overlap', summary);
    return summary;
  }

  const stuck = await reclaimStuckProcessing();
  const circuit = await applyCircuitBreaker();

  const limit = pLimit(parallelism);
  const results = await Promise.all(
    Array.from({ length: batchSize }, () => limit(() => processOne())),
  );

  const summary: WorkerTickSummary = {
    processed: results.filter((r) => r === 'processed').length,
    failed: results.filter((r) => r === 'failed').length,
    skipped: results.filter((r) => r === 'empty').length,
    stuck_reclaimed: stuck,
    circuit_paused: circuit.pausedCount,
    duration_ms: Date.now() - t0,
  };
  metrics.emit('worker.tick', summary);
  return summary;
}

type ReservedRow = {
  id: string;
  clinic_id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
  processing_started_at: Date;
};

async function processOne(): Promise<'empty' | 'processed' | 'failed'> {
  // === TX1 (dbWorker) — reserve com RETURNING processing_started_at ===
  // CRITICAL-01: TX3 precisa do processing_started_at exato setado aqui para
  // detectar reclaim do janitor. SELECT FOR UPDATE SKIP LOCKED + UPDATE numa
  // mesma TX retorna o `now()` autoritativo via RETURNING.
  const reserved = await dbWorker.transaction<ReservedRow | null>(async (tx) => {
    const rows = await tx.execute<Omit<ReservedRow, 'processing_started_at'>>(sql`
      SELECT id, clinic_id, event_type, payload, attempts
        FROM outbox
       WHERE status = 'pending' AND next_attempt_at <= now()
       ORDER BY next_attempt_at, created_at
       LIMIT 1
       FOR UPDATE SKIP LOCKED
    `);
    const row = rows[0];
    if (!row) return null;
    const nextAttempts = row.attempts + 1;
    const updated = await tx.execute<{ processing_started_at: string | Date }>(sql`
      UPDATE outbox
         SET status = 'processing',
             attempts = ${nextAttempts},
             processing_started_at = now()
       WHERE id = ${row.id}
         AND status = 'pending'
       RETURNING processing_started_at
    `);
    if (updated.length === 0) {
      // Outro worker passou na frente — não deveria com SKIP LOCKED, mas é
      // defesa em profundidade.
      return null;
    }
    // postgres-js + raw .execute() pode retornar string ISO em vez de Date para
    // timestamptz (sem schema info). Drizzle query builder downstream (TX3 com
    // eq(outbox.processingStartedAt, ...)) faz .toISOString() — quebra em string.
    // Garantimos Date aqui.
    const rawValue = updated[0]!.processing_started_at;
    const processingStartedAt =
      rawValue instanceof Date ? rawValue : new Date(String(rawValue));
    return {
      ...row,
      attempts: nextAttempts,
      processing_started_at: processingStartedAt,
    };
  });
  if (!reserved) return 'empty';

  // === TX2 (withTenant authenticated) — handler ===
  // CRITICAL-03: HandlerCtx ganha eventId (= outbox.id) e attempt. Handlers
  // DEVEM usar eventId como dedup key em INSERTs (ON CONFLICT) e como
  // idempotency-key em chamadas a APIs externas (ADR-011 §26).
  let handlerError: unknown | null = null;
  try {
    await withTenant(reserved.clinic_id, async (tx) => {
      const schema = getEventSchema(reserved.event_type);
      if (!schema) throw new HandlerNotFoundError(reserved.event_type);
      const handler = getHandler(reserved.event_type);
      if (!handler) throw new HandlerNotFoundError(reserved.event_type);
      const payload = schema.parse(reserved.payload);
      await handler({
        tx,
        clinicId: reserved.clinic_id,
        payload,
        eventId: reserved.id,
        attempt: reserved.attempts,
      });
    });
  } catch (err) {
    handlerError = err;
  }

  // === TX3 (dbWorker) — finalize CONDITIONAL em processing_started_at ===
  // CRITICAL-01: WHERE id AND status='processing' AND processing_started_at = $X
  // detecta caso em que janitor reclamou a row no meio do nosso handler.
  // Se WHERE não bate (UPDATE retorna 0 rows), emitimos `outbox.lost_race` e
  // NÃO sobrescrevemos o estado. O worker que pegou após a reclamação vai
  // re-executar o handler (at-least-once). Handler MUST be idempotent via
  // eventId (ADR-011 §26).
  if (handlerError === null) {
    return finalizeProcessed(reserved);
  }

  // HIGH-14: PoisonPillError pula backoff e vai direto para 'failed'.
  if (handlerError instanceof PoisonPillError) {
    return finalizeFailed(reserved, handlerError, /*isPoison*/ true);
  }

  return finalizeRetryOrFailed(reserved, handlerError);
}

async function finalizeProcessed(reserved: ReservedRow): Promise<'processed' | 'failed'> {
  // Guard: (status='processing' AND attempts=N). Usar `attempts` em vez de
  // `processing_started_at` evita PG-vs-JS Date precision mismatch
  // (PG timestamptz tem μs, JS Date tem só ms — toISOString() perde precisão,
  // comparação `=` falha mesmo sem race real). Smoke iteration showed 100%
  // dos finalize emitindo lost_race falso quando usávamos processing_started_at.
  //
  // Semântica equivalente: TX1 incrementou attempts de N-1 para N e setou
  // status='processing'. Se janitor reclamou, status volta a 'pending' mas
  // attempts permanece N. Outro worker B faz TX1 setando attempts=N+1. Quando
  // A volta com TX3 (status='processing' AND attempts=N), não bate — alguém
  // mexeu desde nossa reserva. lost_race correto.
  const updated = await dbWorker
    .update(outbox)
    .set({
      status: 'processed',
      processedAt: sql`now()`,
      processingStartedAt: null,
    })
    .where(
      and(
        eq(outbox.id, reserved.id),
        eq(outbox.status, 'processing'),
        eq(outbox.attempts, reserved.attempts),
      ),
    )
    .returning({ id: outbox.id });
  if (updated.length === 0) {
    metrics.emit('outbox.lost_race', {
      eventType: reserved.event_type,
      clinicId: reserved.clinic_id,
      reason: 'reclaimed_during_handler',
      phase: 'finalize_processed',
    });
    // Handler rodou; outro worker vai rodar de novo via at-least-once.
    // Handler MUST be idempotent. Não conta como 'processed' para o tick.
    return 'failed';
  }
  metrics.emit('outbox.processed', {
    clinicId: reserved.clinic_id,
    eventType: reserved.event_type,
    attempts: reserved.attempts,
  });
  return 'processed';
}

async function finalizeFailed(
  reserved: ReservedRow,
  err: unknown,
  isPoison: boolean,
): Promise<'failed'> {
  const { message, code } = serializeError(err);
  // Guard via (status, attempts) — ver comentário em finalizeProcessed.
  const updated = await dbWorker
    .update(outbox)
    .set({
      status: 'failed',
      lastError: message,
      errorCode: code,
      firstFailedAt: sql`coalesce(${outbox.firstFailedAt}, now())`,
      lastFailedAt: sql`now()`,
      processingStartedAt: null,
    })
    .where(
      and(
        eq(outbox.id, reserved.id),
        eq(outbox.status, 'processing'),
        eq(outbox.attempts, reserved.attempts),
      ),
    )
    .returning({ id: outbox.id });
  if (updated.length === 0) {
    metrics.emit('outbox.lost_race', {
      eventType: reserved.event_type,
      clinicId: reserved.clinic_id,
      reason: 'reclaimed_during_handler',
      phase: isPoison ? 'finalize_poison' : 'finalize_failed',
    });
    return 'failed';
  }
  metrics.emit(isPoison ? 'outbox.poisoned' : 'outbox.failed', {
    clinicId: reserved.clinic_id,
    eventType: reserved.event_type,
    attempts: reserved.attempts,
    errorCode: code,
    errorMessage: message.slice(0, 200),
  });
  return 'failed';
}

async function finalizeRetryOrFailed(
  reserved: ReservedRow,
  err: unknown,
): Promise<'failed'> {
  const { message, code } = serializeError(err);
  const delay = backoffDelayMs(reserved.attempts);
  const isFail = delay === BACKOFF_FAIL;

  if (isFail) return finalizeFailed(reserved, err, /*isPoison*/ false);

  const nextAttemptAt = new Date(Date.now() + (delay as number));
  // Guard via (status, attempts) — ver comentário em finalizeProcessed.
  const updated = await dbWorker
    .update(outbox)
    .set({
      status: 'pending',
      nextAttemptAt,
      lastError: message,
      errorCode: code,
      firstFailedAt: sql`coalesce(${outbox.firstFailedAt}, now())`,
      lastFailedAt: sql`now()`,
      processingStartedAt: null,
    })
    .where(
      and(
        eq(outbox.id, reserved.id),
        eq(outbox.status, 'processing'),
        eq(outbox.attempts, reserved.attempts),
      ),
    )
    .returning({ id: outbox.id });
  if (updated.length === 0) {
    metrics.emit('outbox.lost_race', {
      eventType: reserved.event_type,
      clinicId: reserved.clinic_id,
      reason: 'reclaimed_during_handler',
      phase: 'finalize_retry',
    });
    return 'failed';
  }
  metrics.emit('outbox.retry', {
    clinicId: reserved.clinic_id,
    eventType: reserved.event_type,
    attempts: reserved.attempts,
    errorCode: code,
    errorMessage: message.slice(0, 200),
  });
  return 'failed';
}

