/**
 * GET /api/cron/data-retention — F-09 (auditoria forense 2026-06-10).
 *
 * Purge mensal (vercel.json crons[]: `0 5 1 * *`) das duas tabelas que cresciam
 * SEM teto:
 *   - `outbox` em estado TERMINAL benigno (`processed`/`skipped`) há > 30 dias.
 *     Estados `pending`/`processing`/`failed` NUNCA são tocados (failed é DLQ —
 *     replay manual via runbook c4-validation). Dedup de publishEvent
 *     (UNIQUE(event_type, idempotency_key)) perde linhas com >30d, o que é
 *     seguro: handlers são idempotentes por contrato (ADR-011) e as chaves de
 *     produtor derivam de mutações cujas idempotency_keys expiram antes.
 *   - `login_attempts` com > 90 dias (rate-limit usa janela de 15 min; o resto
 *     é forense de curto prazo — agregados ficam nos logs estruturados).
 *
 * Projeção da auditoria: 1.000 clínicas × ~50 eventos/dia ≈ 18M rows/ano sem
 * retenção — degradava backups, vacuum e o count(*) do healthcheck.
 *
 * DELETEs em lotes (id IN subquery LIMIT) com teto de iterações para caber no
 * maxDuration; o que sobrar sai no próximo run. Mesma auth das demais rotas
 * cron (Bearer CRON_SECRET + header Vercel não-fatal).
 */
import { sql } from 'drizzle-orm';

import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { dbAdmin } from '@/lib/db';
import { assertCronRuntimeReady } from '@/lib/env';
import { assertCronAuth } from '@/lib/http/cron-auth';
import { metrics } from '@/lib/observability/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const OUTBOX_RETENTION_DAYS = 30;
const LOGIN_ATTEMPTS_RETENTION_DAYS = 90;
const BATCH = 5000;
const MAX_BATCHES_PER_TABLE = 10; // teto: 50k rows/tabela/run

async function purgeBatched(makeDelete: () => Promise<number>): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES_PER_TABLE; i++) {
    const n = await makeDelete();
    total += n;
    if (n < BATCH) break;
  }
  return total;
}

export async function GET(req: Request): Promise<Response> {
  assertCronRuntimeReady();
  const denied = assertCronAuth(req, { route: 'data-retention', destructive: true });
  if (denied) return denied;

  try {
    const outboxPurged = await purgeBatched(async () => {
      const rows = (await dbAdmin.execute(
        sql`WITH del AS (
              SELECT id FROM outbox
               WHERE status IN ('processed', 'skipped')
                 AND coalesce(processed_at, created_at)
                     < now() - make_interval(days => ${OUTBOX_RETENTION_DAYS})
               LIMIT ${BATCH}
            )
            DELETE FROM outbox o USING del WHERE o.id = del.id
            RETURNING o.id`,
      )) as unknown as Array<{ id: string }>;
      return rows.length;
    });

    const loginAttemptsPurged = await purgeBatched(async () => {
      const rows = (await dbAdmin.execute(
        sql`WITH del AS (
              SELECT id FROM login_attempts
               WHERE attempted_at
                     < now() - make_interval(days => ${LOGIN_ATTEMPTS_RETENTION_DAYS})
               LIMIT ${BATCH}
            )
            DELETE FROM login_attempts l USING del WHERE l.id = del.id
            RETURNING l.id`,
      )) as unknown as Array<{ id: string }>;
      return rows.length;
    });

    // C16: idempotency_keys EXPIRADAS (expires_at < now). O healthcheck conta
    // `expired`/`in_flight_orphans_1h` mas nada apagava — a tabela crescia sem
    // teto. TTL já passou (default 24h, min 60s) → seguro deletar mesmo orphans.
    const idempotencyPurged = await purgeBatched(async () => {
      const rows = (await dbAdmin.execute(
        sql`WITH del AS (
              SELECT key FROM idempotency_keys
               WHERE expires_at < now()
               LIMIT ${BATCH}
            )
            DELETE FROM idempotency_keys k USING del WHERE k.key = del.key
            RETURNING k.key`,
      )) as unknown as Array<{ key: string }>;
      return rows.length;
    });

    metrics.emit('retention.run', {
      outboxPurged,
      loginAttemptsPurged,
      idempotencyPurged,
    });
    await recordHeartbeat('data-retention', 'success', {
      outboxPurged,
      loginAttemptsPurged,
      idempotencyPurged,
    });
    return Response.json(
      { ok: true, outboxPurged, loginAttemptsPurged, idempotencyPurged },
      { status: 200 },
    );
  } catch (err) {
    metrics.emit('retention.error', { error: err });
    return Response.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
