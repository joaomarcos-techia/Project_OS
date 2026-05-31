/**
 * GET /api/cron/audit-partitions
 *
 * Vercel Cron mensal (vercel.json). Provisiona as partições mensais de
 * `audit_events` à frente (mês atual + próximos N), idempotente, para que
 * nenhuma linha caia na `audit_events_default` quando as partições estáticas de
 * 0009 (até 2027-04) acabarem (gap 4.6). NÃO faz retenção/DETACH (isso é
 * operador-run via `pnpm audit:partitions --retain N` — dado forense não é
 * apagado por cron).
 *
 * Auth: Bearer CRON_SECRET (mesma defesa do /api/cron/outbox — HIGH-08).
 */
import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { env, assertCronRuntimeReady } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PARENT = 'audit_events';
const MONTHS_AHEAD = 3;

function isAuthorized(req: Request): boolean {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${env.CRON_SECRET}`) return false;
  const hasOriginHeader =
    req.headers.get('x-vercel-cron') !== null ||
    req.headers.get('x-vercel-cron-schedule') !== null;
  const allowNonVercel =
    process.env.OUTBOX_CRON_ALLOW_NON_VERCEL === 'true' || env.NODE_ENV !== 'production';
  if (!hasOriginHeader && !allowNonVercel) {
    metrics.emit('cron.origin_header_missing', { route: 'audit-partitions' });
  }
  return true;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function GET(req: Request): Promise<Response> {
  assertCronRuntimeReady();
  if (!isAuthorized(req)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const now = new Date();
    let ensured = 0;
    const needsRemediation: string[] = [];
    for (let i = 0; i <= MONTHS_AHEAD; i++) {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i + 1, 1));
      const name = `${PARENT}_${start.getUTCFullYear()}_${pad2(start.getUTCMonth() + 1)}`;
      try {
        await dbAdmin.execute(
          sql.raw(
            `CREATE TABLE IF NOT EXISTS "${name}" PARTITION OF "${PARENT}" ` +
              `FOR VALUES FROM ('${iso(start)}') TO ('${iso(end)}')`,
          ),
        );
        ensured++;
      } catch (e) {
        // 23514: partição falta E a default já tem linhas do mês → remediação
        // manual (runbook). Não fatal — não derruba o cron por causa de 1 mês.
        if ((e as { code?: string })?.code === '23514') {
          needsRemediation.push(name);
        } else {
          throw e;
        }
      }
    }
    metrics.emit('cron.audit_partitions.ensured', { ensured, needs_remediation: needsRemediation.length });
    return Response.json({ ok: true, ensured, needs_remediation: needsRemediation }, { status: 200 });
  } catch (err) {
    metrics.emit('cron.audit_partitions.error', { error: err });
    return Response.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
