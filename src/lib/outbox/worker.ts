import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import pLimit from 'p-limit';

import { DB_WORKER_POOL_SIZE, dbWorker } from '@/lib/db';
import { outbox } from '@/lib/db/schema/infra/outbox';
import { withTenant } from '@/lib/db/tenant';
import { env } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';

import { backoffDelayMs, BACKOFF_FAIL } from './backoff';
import { getEventSchema, listEventTypes } from './catalog';
import { applyCircuitBreaker } from './circuit';
import { HandlerNotFoundError, PoisonPillError, serializeError } from './errors';
import { reclaimStuckProcessing } from './janitor';
import { getHandler } from './registry';
import type { ProcessOneResult, WorkerTickSummary } from './types';

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
 * Pool: usa `dbWorker` com duas conexões: uma segura o advisory lock e a outra
 * executa TX1/TX3. O limite real e a decisão do lock compartilham a constante
 * DB_WORKER_POOL_SIZE para impedir auto-bloqueio por configuração divergente.
 */
export async function runOutboxOnce(
  opts: {
    batchSize?: number;
    parallelism?: number;
    /**
     * R61 — prazo (epoch ms) para PARAR DE RESERVAR eventos nesta invocação. Conferido em cada
     * vaga ANTES da reserva: depois do prazo, a vaga não reserva nada ('deferred') e o evento
     * fica `pending` para o próximo tick. Handler já iniciado NUNCA é abandonado nem
     * "cancelado de mentira": ele termina (ou falha) pelo próprio caminho e pelos próprios
     * timeouts. Sem o parâmetro, o comportamento é o de sempre.
     */
    reserveUntil?: number;
    /**
     * R61 — finaliza como `skipped`, em bloco e no início do tick, os eventos devidos cujo tipo
     * está no catálogo e NÃO tem handler registrado neste processo (os "producer ahead" do gate
     * F-14, como `scheduling.appointment.checked_in`). É exatamente o desfecho que o
     * `processOne` daria a cada um deles — só que sem ocupar vaga do lote. Desligado por padrão.
     */
    skipUnhandledInBulk?: boolean;
  } = {},
): Promise<WorkerTickSummary> {
  const t0 = Date.now();
  const batchSize = opts.batchSize ?? env.OUTBOX_BATCH_SIZE;
  const parallelism = opts.parallelism ?? env.OUTBOX_PARALLELISM;

  // Advisory lock (HIGH-15, corrigido em F-08 — auditoria 2026-06-10).
  // A versão anterior adquiria pg_try_advisory_xact_lock numa TX que COMMITava
  // imediatamente: o lock era liberado na hora e dois ticks com 1s de diferença
  // rodavam janitor/circuit em dobro — o controle era fictício.
  //
  // Agora a TX do lock fica ABERTA pela duração do tick, como LOCK-HOLDER puro:
  // nenhum trabalho roda nela (janitor/circuit/processOne usam as próprias
  // conexões de dbWorker e o withTenant usa o pool `db`), então não há TX longa
  // fazendo trabalho — só uma conexão idle-in-transaction segurando o advisory
  // lock, liberado no COMMIT/ROLLBACK ao fim do tick (release garantido).
  //
  // Pré-condição: o pool dbWorker precisa de ≥2 conexões (1 lock-holder + 1 de
  // trabalho). A decisão consulta o limite REAL usado na criação do pool.
  const skippedSummary = (): WorkerTickSummary => ({
    processed: 0,
    failed: 0,
    skipped: 0,
    empty: 0,
    stuck_reclaimed: 0,
    circuit_paused: 0,
    duration_ms: Date.now() - t0,
  });

  if (DB_WORKER_POOL_SIZE < 2) {
    metrics.emit('worker.tick.lock_skipped_pool_too_small', {
      poolSize: DB_WORKER_POOL_SIZE,
    });
    return runTickBody(t0, batchSize, parallelism, opts);
  }

  return dbWorker.transaction<WorkerTickSummary>(async (lockTx) => {
    const rows = await lockTx.execute<{ acquired: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtext('outbox-worker')) AS acquired`,
    );
    if (!rows[0]?.acquired) {
      const summary = skippedSummary();
      metrics.emit('worker.tick.skipped_overlap', summary);
      return summary;
    }
    return runTickBody(t0, batchSize, parallelism, opts);
  });
}

async function runTickBody(
  t0: number,
  batchSize: number,
  parallelism: number,
  opts: { reserveUntil?: number; skipUnhandledInBulk?: boolean } = {},
): Promise<WorkerTickSummary> {
  const stuck = await reclaimStuckProcessing();
  const circuit = await applyCircuitBreaker();
  const bulkSkipped = opts.skipUnhandledInBulk ? await skipUnhandledPendingInBulk() : undefined;

  const limit = pLimit(parallelism);
  const deadline = opts.reserveUntil;
  const results = await Promise.all(
    Array.from({ length: batchSize }, () =>
      limit(() =>
        // O prazo é conferido na hora em que a vaga ia RESERVAR: o que já está rodando segue.
        deadline !== undefined && Date.now() >= deadline
          ? Promise.resolve<ProcessOneResult>('deferred')
          : processOne(),
      ),
    ),
  );

  const summary: WorkerTickSummary = {
    processed: 0,
    failed: 0,
    skipped: 0,
    empty: 0,
    stuck_reclaimed: stuck,
    circuit_paused: circuit.pausedCount,
    duration_ms: Date.now() - t0,
    ...(bulkSkipped !== undefined ? { skipped_bulk: bulkSkipped } : {}),
  };
  for (const r of results) tally(summary, r);
  metrics.emit('worker.tick', summary);
  return summary;
}

/**
 * R61 — eventos devidos de tipos do catálogo SEM handler neste processo viram `skipped` num
 * UPDATE só, com os mesmos campos do `finalizeSkipped` (status, `processed_at`, tentativa
 * contada). Só linhas `pending` e já devidas: o que estiver em processamento ou agendado para
 * depois não muda. Cada tipo fica na métrica `outbox.skipped_no_handler` (bulk), como antes.
 */
async function skipUnhandledPendingInBulk(): Promise<number> {
  const unhandled = listEventTypes().filter((t) => !getHandler(t));
  if (unhandled.length === 0) return 0;
  const rows = await dbWorker
    .update(outbox)
    .set({
      status: 'skipped',
      processedAt: sql`now()`,
      processingStartedAt: null,
      attempts: sql`${outbox.attempts} + 1`,
    })
    .where(
      and(
        eq(outbox.status, 'pending'),
        lte(outbox.nextAttemptAt, sql`now()`),
        inArray(outbox.eventType, unhandled),
      ),
    )
    .returning({ eventType: outbox.eventType });
  if (rows.length > 0) {
    const byType: Record<string, number> = {};
    for (const r of rows) byType[r.eventType] = (byType[r.eventType] ?? 0) + 1;
    metrics.emit('outbox.skipped_no_handler', { bulk: true, count: rows.length, byType });
  }
  return rows.length;
}

// F-03: exhaustive tally over ProcessOneResult. `empty` = no row reserved;
// `skipped` = terminally skipped (no handler). The `default: never` makes the
// compiler reject any future result variant that isn't counted here.
function tally(summary: WorkerTickSummary, r: ProcessOneResult): void {
  switch (r) {
    case 'processed':
      summary.processed++;
      break;
    case 'failed':
      summary.failed++;
      break;
    case 'skipped':
      summary.skipped++;
      break;
    case 'empty':
      summary.empty++;
      break;
    case 'deferred':
      summary.deferred = (summary.deferred ?? 0) + 1;
      break;
    default: {
      const _exhaustive: never = r;
      throw new Error(`unknown processOne result: ${String(_exhaustive)}`);
    }
  }
}

/** Eventos que um request acabou de publicar, pela chave de idempotência. */
export interface OutboxSelection {
  eventType: string;
  idempotencyKeys: readonly string[];
}

/**
 * Processa AGORA os eventos que o próprio request publicou (ingress da Meta).
 *
 * O tick de ingress antigo era `runOutboxOnce({ batchSize: 1 })`: pegava o
 * evento devido MAIS ANTIGO da fila global, que só por acaso era o turno da
 * mensagem recém-chegada. Com fila não vazia — outra clínica, um retry, um
 * backlog — o paciente esperava o cron; no Preview, que não tem cron, nunca era
 * respondido (visto em 07-08/10/2026 com 57 eventos antigos à frente).
 *
 * Mesmo caminho TX1/TX2/TX3 do tick (reserva com SKIP LOCKED, finalize com
 * guarda), sem janitor, circuit nem advisory lock: esses fazem UPDATEs amplos e
 * pertencem ao cron. Respeita `next_attempt_at` (backoff e pausa do circuito) e
 * só toca linhas `pending` das chaves pedidas — um tick global concorrente
 * nunca processa a mesma linha. O cron continua sendo o backstop.
 */
export async function runOutboxEventsNow(
  selections: readonly OutboxSelection[],
): Promise<WorkerTickSummary> {
  const t0 = Date.now();
  const summary: WorkerTickSummary = {
    processed: 0,
    failed: 0,
    skipped: 0,
    empty: 0,
    stuck_reclaimed: 0,
    circuit_paused: 0,
    duration_ms: 0,
  };
  for (const selection of selections) {
    for (let i = 0; i < selection.idempotencyKeys.length; i++) {
      const result = await processOne(selection);
      tally(summary, result);
      if (result === 'empty') break;
    }
  }
  summary.duration_ms = Date.now() - t0;
  metrics.emit('worker.targeted', summary);
  return summary;
}

type ReservedRow = {
  id: string;
  clinic_id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
  processing_started_at: Date;
  clinic_exists: boolean;
};

async function processOne(selection?: OutboxSelection): Promise<ProcessOneResult> {
  if (selection && selection.idempotencyKeys.length === 0) return 'empty';
  const only = selection
    ? sql`AND o.event_type = ${selection.eventType}
           AND o.idempotency_key IN (${sql.join(
             selection.idempotencyKeys.map((key) => sql`${key}`),
             sql`, `,
           )})`
    : sql``;
  // === TX1 (dbWorker) — reserve com RETURNING processing_started_at ===
  // CRITICAL-01: TX3 precisa do processing_started_at exato setado aqui para
  // detectar reclaim do janitor. SELECT FOR UPDATE SKIP LOCKED + UPDATE numa
  // mesma TX retorna o `now()` autoritativo via RETURNING.
  const reserved = await dbWorker.transaction<ReservedRow | null>(async (tx) => {
    const rows = await tx.execute<Omit<ReservedRow, 'processing_started_at'>>(sql`
      SELECT o.id, o.clinic_id, o.event_type, o.payload, o.attempts,
             EXISTS (SELECT 1 FROM clinics c WHERE c.id = o.clinic_id) AS clinic_exists
        FROM outbox o
       WHERE o.status = 'pending' AND o.next_attempt_at <= now() ${only}
       ORDER BY o.next_attempt_at, o.created_at
       LIMIT 1
       FOR UPDATE SKIP LOCKED
    `);
    const row = rows[0];
    if (!row) return null;
    const nextAttempts = row.attempts + 1;
    // CWE-89: usamos o query builder do drizzle (bind params $1, $2…) em vez de
    // raw sql`` com interpolação. row.id (uuid PK) e nextAttempts (integer) são
    // SEMPRE passados como parâmetros — nunca concatenados na string SQL — então
    // não há caminho de SQL injection. Mesmo pattern parametrizado dos finalize*.
    const updated = await tx
      .update(outbox)
      .set({
        status: 'processing',
        attempts: nextAttempts,
        processingStartedAt: sql`now()`,
      })
      .where(and(eq(outbox.id, row.id), eq(outbox.status, 'pending')))
      .returning({ processing_started_at: outbox.processingStartedAt });
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
    const processingStartedAt = rawValue instanceof Date ? rawValue : new Date(String(rawValue));
    return {
      ...row,
      attempts: nextAttempts,
      processing_started_at: processingStartedAt,
    };
  });
  if (!reserved) return 'empty';

  // `outbox` deliberately has no FK to clinics so the event remains as audit
  // evidence after tenant deletion. Downstream tenant tables do have FKs; an
  // event from a deleted clinic would otherwise burn every retry trying to
  // insert work that can never become valid. Preserve the row and terminate it
  // observably instead of converting expected lifecycle cleanup into an error.
  if (!reserved.clinic_exists) {
    return finalizeSkipped(reserved, 'missing_clinic');
  }

  // F-03: an event that IS in the catalog (valid schema) but has NO registered
  // handler is a legitimate "producer ahead of consumer" event — NOT a failure.
  // Mark it terminally `skipped` (no retry, no circuit). A MISSING schema, by
  // contrast, means the catalog wasn't loaded (deploy/config bug) and stays a
  // retryable HandlerNotFoundError below.
  const schema = getEventSchema(reserved.event_type);
  const handler = getHandler(reserved.event_type);
  if (schema && !handler) {
    return finalizeSkipped(reserved, 'no_handler');
  }

  // === TX2 (withTenant authenticated) — handler ===
  // CRITICAL-03: HandlerCtx ganha eventId (= outbox.id) e attempt. Handlers
  // DEVEM usar eventId como dedup key em INSERTs (ON CONFLICT) e como
  // idempotency-key em chamadas a APIs externas (ADR-011 §26).
  let handlerError: unknown | null = null;
  const handlerStartedAt = Date.now();
  try {
    if (!schema) throw new HandlerNotFoundError(reserved.event_type);
    if (!handler) throw new HandlerNotFoundError(reserved.event_type);
    const payload = schema.parse(reserved.payload);

    if (handler.execution === 'detached') {
      await handler.handler({
        clinicId: reserved.clinic_id,
        payload,
        eventId: reserved.id,
        attempt: reserved.attempts,
      });
    } else {
      await withTenant(reserved.clinic_id, async (tx) => {
        await handler.handler({
          tx,
          clinicId: reserved.clinic_id,
          payload,
          eventId: reserved.id,
          attempt: reserved.attempts,
        });
      });
    }
  } catch (err) {
    handlerError = err;
  }
  reportSlowHandler(reserved.event_type, Date.now() - handlerStartedAt, handlerError === null);

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

/**
 * R61: o prazo de reserva (`reserveUntil`) só impede eventos NOVOS; handler já iniciado
 * termina pelo próprio caminho. A janela do cron compartilhado supõe que ele acabe em até
 * este tempo depois de iniciado. Acima disso, a métrica aponta qual tipo de evento ameaça
 * a invocação — sem interromper nada.
 */
export const OUTBOX_HANDLER_SLOW_MS = 25_000;

function reportSlowHandler(eventType: string, handlerMs: number, ok: boolean): void {
  if (handlerMs > OUTBOX_HANDLER_SLOW_MS) {
    metrics.emit('outbox.handler_slow', { eventType, handlerMs, ok });
  }
}

async function finalizeSkipped(
  reserved: ReservedRow,
  reason: 'missing_clinic' | 'no_handler',
): Promise<'skipped' | 'failed'> {
  // Terminal no-op for an event that cannot/should not be delivered. Same race
  // guard as the other finalizers — (status='processing' AND attempts=N) — so a
  // janitor reclaim mid-flight does NOT double-write (it would flip
  // status→pending or bump attempts, making this UPDATE match 0 rows →
  // lost_race, no corruption).
  const updated = await dbWorker
    .update(outbox)
    .set({
      status: 'skipped',
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
      phase: 'finalize_skipped',
    });
    return 'failed';
  }
  // F-03 deploy-regression detector: a HANDLER that was expected but vanished in
  // a deploy surfaces as `skipped_no_handler`. A removed tenant is classified
  // separately because its historical event is expected to remain. Neither is
  // counted as a worker failure.
  metrics.emit(
    reason === 'missing_clinic' ? 'outbox.skipped_missing_clinic' : 'outbox.skipped_no_handler',
    {
      clinicId: reserved.clinic_id,
      eventType: reserved.event_type,
      attempts: reserved.attempts,
    },
  );
  return 'skipped';
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

async function finalizeRetryOrFailed(reserved: ReservedRow, err: unknown): Promise<'failed'> {
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
