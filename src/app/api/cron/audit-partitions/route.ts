/**
 * GET /api/cron/audit-partitions
 *
 * Vercel Cron mensal (vercel.json). Provisiona as partições mensais à frente
 * (mês atual + próximos N), idempotente, para que nenhuma linha caia na
 * `<parent>_default` quando as partições estáticas acabarem (gap 4.6). NÃO faz
 * retenção/DETACH (isso é operador-run via `pnpm audit:partitions --retain N` —
 * dado forense não é apagado por cron).
 *
 * ALERTA ATIVO (A7, 2026-07-17): o provisionamento é 100% dependente deste cron
 * — `pg_cron`/`pg_partman` não estão instalados. Se ele falhar em silêncio, as
 * escritas caem na `_default` e o benefício da partição some sem ninguém notar.
 * A auditoria de banco encontrou o cenário JÁ CONSUMADO em dev: 9 linhas presas
 * na `audit_events_default` de um mês cuja partição foi dropada. Antes existia
 * só o painel admin, que dependia de alguém olhar. Agora cada run emite o estado
 * e, quando ele é ruim, uma linha `error` estruturada.
 *
 * O sinal vai por `metrics.emit` + `logger` no stdout — MESMO pipeline do resto
 * (ADR-029 mantém log fora do Sentry; um cron degradado não é exceção). O alerta
 * é uma saved-search no Better Stack; ver runbooks/audit-retention.md.
 *
 * Auth: Bearer CRON_SECRET (mesma defesa do /api/cron/outbox — HIGH-08).
 */
import { sql } from 'drizzle-orm';

import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { dbAdmin } from '@/lib/db';
import { contiguousMonthsAhead, PARTITIONED_PARENTS } from '@/lib/db/retention-policy';
import { assertCronRuntimeReady } from '@/lib/env';
import { assertCronAuth } from '@/lib/http/cron-auth';
import { logger } from '@/lib/observability/logger';
import { metrics } from '@/lib/observability/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MONTHS_AHEAD = 3;
/** Abaixo disto, o mês seguinte corre risco de cair na default. */
const MIN_CONTIGUOUS_MONTHS = 1;

const pad2 = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function GET(req: Request): Promise<Response> {
  assertCronRuntimeReady();
  const denied = assertCronAuth(req, { route: 'audit-partitions' });
  if (denied) return denied;
  try {
    const now = new Date();
    let ensured = 0;
    const needsRemediation: string[] = [];
    for (const parent of PARTITIONED_PARENTS) {
      for (let i = 0; i <= MONTHS_AHEAD; i++) {
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
        const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i + 1, 1));
        const name = `${parent}_${start.getUTCFullYear()}_${pad2(start.getUTCMonth() + 1)}`;
        try {
          await dbAdmin.execute(
            sql.raw(
              `CREATE TABLE IF NOT EXISTS "${name}" PARTITION OF "${parent}" ` +
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
    }
    // A7 — o cron não pode só CRIAR e ir embora: ele é o único provisionador, e
    // "falhou em silêncio" era o cenário sem detecção. Cada run reporta a saúde
    // real de cada pai; se estiver ruim, sai uma linha `error` para a
    // saved-search do Better Stack alertar.
    const health = [];
    for (const parent of PARTITIONED_PARENTS) {
      const months = (await dbAdmin.execute(
        sql`SELECT c.relname AS name FROM pg_inherits i
              JOIN pg_class c ON c.oid = i.inhrelid
             WHERE i.inhparent = ${parent}::regclass`,
      )) as unknown as Array<{ name: string }>;
      const ym = months
        .map((m) => /_(\d{4})_(\d{2})$/.exec(m.name))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => `${m[1]}-${m[2]}`);

      const defaultRows = (await dbAdmin.execute(
        sql.raw(`SELECT count(*)::int AS n FROM ${parent}_default`),
      )) as unknown as Array<{ n: number }>;

      // Contíguo a partir do mês atual — NÃO max(partição). Uma partição solta
      // lá na frente não cobre a lacuna antes dela (achado N2: o dev reportava
      // "22 meses saudáveis" com o próximo buraco a 11).
      const monthsAhead = contiguousMonthsAhead(ym, now);
      const defaultCount = Number(defaultRows[0]?.n ?? 0);
      health.push({ parent, monthsAhead, defaultCount });

      if (defaultCount > 0 || monthsAhead < MIN_CONTIGUOUS_MONTHS) {
        const fields = {
          parent,
          monthsAhead,
          defaultCount,
          reason: defaultCount > 0 ? 'default_partition_not_empty' : 'coverage_gap_ahead',
        };
        metrics.emit('cron.audit_partitions.degraded', fields);
        logger.error('cron.audit_partitions.degraded', fields);
      }
    }

    metrics.emit('cron.audit_partitions.ensured', {
      ensured,
      needs_remediation: needsRemediation.length,
      health,
    });
    await recordHeartbeat('audit-partitions', 'success', {
      ensured,
      needsRemediation: needsRemediation.length,
      health,
    });
    return Response.json(
      { ok: true, ensured, needs_remediation: needsRemediation, health },
      { status: 200 },
    );
  } catch (err) {
    metrics.emit('cron.audit_partitions.error', { error: err });
    return Response.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
