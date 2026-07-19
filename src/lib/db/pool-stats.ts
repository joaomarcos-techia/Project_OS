/**
 * Saturação de conexões do Postgres (A4/E4).
 *
 * POR QUE existe: das quatro golden signals, *saturation* era a ausente — e é o
 * gargalo nº1 provável em escala, ligado ao problema já conhecido de "infinite
 * loading = Supabase saturado". Sem esta métrica, a degradação chega como
 * TRAVAMENTO para o usuário, nunca como sinal para o operador.
 *
 * POR QUE `pg_stat_activity` e não as internas do postgres.js: (a) o driver não
 * expõe um gauge de pool utilizável; (b) o recurso escasso de verdade é o limite
 * do SERVIDOR, compartilhado por todas as instâncias serverless + o pooler —
 * um gauge por processo mediria o galho, não a árvore.
 *
 * Roda por `dbAdmin` (role `postgres`) de propósito: como `qoro_runtime`
 * (NOBYPASSRLS, sem `pg_monitor`) o catálogo devolve `state`/`query` NULOS para
 * sessões de outros roles — justamente as que interessam. `pg_catalog` não foi
 * tocado pelos REVOKEs da 0045 (todos `IN SCHEMA public`).
 *
 * Nunca lança: um gauge não pode derrubar o health que o expõe.
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';

export interface ConnectionStats {
  total: number;
  active: number;
  idle: number;
  /** Sessões esperando LOCK — o sintoma que precede o stall. */
  waiting: number;
  max_connections: number;
  /** `total / max_connections`, inteiro. É sobre isto que o alerta dispara. */
  saturation_pct: number;
}

type Row = Omit<ConnectionStats, 'saturation_pct'>;

/** O health é pollado a cada ~3min por instância; sem cache viraria carga própria. */
const CACHE_TTL_MS = 30_000;

let cache: { at: number; value: ConnectionStats | null } | null = null;

export async function getConnectionStats(): Promise<ConnectionStats | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  let value: ConnectionStats | null = null;
  try {
    const rows = await dbAdmin.execute<Row>(sql`
      SELECT
        count(*)::int                                             AS total,
        count(*) FILTER (WHERE state = 'active')::int             AS active,
        count(*) FILTER (WHERE state = 'idle')::int               AS idle,
        count(*) FILTER (WHERE wait_event_type = 'Lock')::int     AS waiting,
        (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections
      FROM pg_stat_activity
      WHERE datname = current_database()
    `);
    const r = rows[0];
    if (r) {
      value = {
        ...r,
        // Guard de divisão por zero: `max_connections` vem do catálogo e não
        // deveria ser 0, mas um gauge que lança NaN no health é pior que um 0.
        saturation_pct: r.max_connections > 0 ? Math.round((r.total / r.max_connections) * 100) : 0,
      };
    }
  } catch {
    // Sem permissão / catálogo indisponível → o health segue respondendo.
    value = null;
  }

  cache = { at: Date.now(), value };
  return value;
}
