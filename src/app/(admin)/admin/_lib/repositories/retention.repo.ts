/**
 * AdminRetentionRepository (C15 · Platform Settings) — status de retenção/partições (read-only).
 *
 * Expõe a dívida operacional manual do C4/C16 ANTES de virar incidente:
 *   - cobertura de partições de audit_events / ai_messages (+ default > 0 = alerta)
 *   - idempotency_keys vencidas a limpar
 *   - ai_proactive_jobs por status
 *
 * Tudo via dbAdmin (catálogo do Postgres + counts globais; sem dado tenant).
 * Server-only.
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';

const PARTITIONED = ['audit_events', 'ai_messages'] as const;

export interface PartitionInfoDTO {
  parent: string;
  count: number;
  latest: string | null; // 'YYYY-MM' da última partição mensal
  monthsAhead: number; // meses de cobertura à frente do mês atual
  defaultCount: number; // linhas na partição default (>0 = alerta)
}

export interface RetentionDTO {
  partitions: PartitionInfoDTO[];
  idempotencyExpired: number;
  proactiveByStatus: { status: string; n: number }[];
}

function monthsAhead(latestYm: string | null): number {
  if (!latestYm) return 0;
  const m = /^(\d{4})-(\d{2})$/.exec(latestYm);
  if (!m) return 0;
  const latest = Number(m[1]) * 12 + (Number(m[2]) - 1);
  const now = new Date();
  const cur = now.getUTCFullYear() * 12 + now.getUTCMonth();
  return Math.max(0, latest - cur);
}

export class AdminRetentionRepository {
  async get(): Promise<RetentionDTO> {
    const partitions: PartitionInfoDTO[] = [];
    for (const parent of PARTITIONED) {
      const children = (await dbAdmin.execute(
        sql`SELECT c.relname AS name
              FROM pg_inherits i
              JOIN pg_class c ON c.oid = i.inhrelid
             WHERE i.inhparent = ${parent}::regclass
             ORDER BY c.relname`,
      )) as unknown as Array<{ name: string }>;

      // Partições mensais = <parent>_YYYY_MM (exclui a _default).
      const months = children
        .map((c) => /_(\d{4})_(\d{2})$/.exec(c.name))
        .filter((mm): mm is RegExpExecArray => mm !== null)
        .map((mm) => `${mm[1]}-${mm[2]}`)
        .sort();
      const latest = months.length > 0 ? months[months.length - 1]! : null;

      const defaultRows = (await dbAdmin.execute(
        sql.raw(`SELECT count(*)::int AS n FROM ${parent}_default`),
      )) as unknown as Array<{ n: number }>;

      partitions.push({
        parent,
        count: months.length,
        latest,
        monthsAhead: monthsAhead(latest),
        defaultCount: Number(defaultRows[0]?.n ?? 0),
      });
    }

    const idem = (await dbAdmin.execute(
      sql`SELECT count(*)::int AS n FROM idempotency_keys WHERE expires_at < now()`,
    )) as unknown as Array<{ n: number }>;

    const proactive = (await dbAdmin.execute(
      sql`SELECT status::text AS status, count(*)::int AS n FROM ai_proactive_jobs GROUP BY status ORDER BY status`,
    )) as unknown as Array<{ status: string; n: number }>;

    return {
      partitions,
      idempotencyExpired: Number(idem[0]?.n ?? 0),
      proactiveByStatus: proactive.map((p) => ({ status: p.status, n: Number(p.n) })),
    };
  }
}

export const retentionRepository = new AdminRetentionRepository();
