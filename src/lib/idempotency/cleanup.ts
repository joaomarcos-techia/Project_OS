import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { metrics } from '@/lib/observability/metrics';

/**
 * Cleanup seguro de `idempotency_keys` — CRITICAL-02.
 *
 * Política frozen:
 *   - SÓ deleta rows COMPLETADAS (response IS NOT NULL) cujo expires_at venceu.
 *   - NUNCA deleta rows in-flight (response IS NULL), mesmo expiradas. In-flight
 *     órfãs (response NULL + created_at antigo) são sinais de bug; precisam
 *     diagnóstico, não delete cego. Trigger no DB (migration 0010) impede
 *     DELETE de rows in-flight criadas há < 1 hora, como defesa em profundidade.
 *
 * Por que não automatizar para já?
 *   MVP — cleanup roda manualmente (semanal via runbook). C16 plugará Vercel Cron
 *   dedicado OU pg_cron. Esta função existe para ser invocada por scripts CLI e
 *   pelos handlers de cron quando chegarem.
 *
 * Diagnóstico: separado em `diagnoseInFlightOrphans()` — retorna rows in-flight
 * antigas (>= 1h) para investigação. Operador decide o que fazer (geralmente:
 * checar se TX original commitou pelo audit_events, e fazer cleanup manual).
 */
export async function cleanupExpiredIdempotencyKeys(): Promise<number> {
  const result = await dbAdmin.execute<{ key: string }>(sql`
    DELETE FROM idempotency_keys
     WHERE expires_at < now()
       AND response IS NOT NULL
   RETURNING key
  `);
  const count = result.length;
  if (count > 0) {
    metrics.emit('idempotency.cleanup', { deleted: count });
  }
  return count;
}

export type InFlightOrphan = {
  key: string;
  clinic_id: string;
  user_id: string | null;
  created_at: Date;
  expires_at: Date;
  age_minutes: number;
};

/**
 * Diagnóstico de in-flight órfãos: rows com response IS NULL criadas há >= 1
 * hora. Em condição normal, idempotentMutation finaliza em <1 minuto. Órfãs
 * indicam:
 *   - crash de Server Action antes do UPDATE response
 *   - bug grave em mutation.ts
 *   - lambda matada mid-TX
 *
 * NÃO deleta. Retorna para operador decidir.
 */
export async function diagnoseInFlightOrphans(): Promise<InFlightOrphan[]> {
  const rows = await dbAdmin.execute<InFlightOrphan>(sql`
    SELECT
      key,
      clinic_id,
      user_id,
      created_at,
      expires_at,
      extract(epoch FROM (now() - created_at)) / 60 AS age_minutes
    FROM idempotency_keys
   WHERE response IS NULL
     AND created_at < now() - interval '1 hour'
   ORDER BY created_at
   LIMIT 100
  `);
  if (rows.length > 0) {
    metrics.emit('idempotency.in_flight_orphans', { count: rows.length });
  }
  return [...rows];
}
