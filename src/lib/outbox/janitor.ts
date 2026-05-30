import { sql } from 'drizzle-orm';

import { dbWorker } from '@/lib/db';
import { metrics } from '@/lib/observability/metrics';

/**
 * Janitor — reclama rows presas em `processing` por mais de 5 minutos.
 *
 * Cenário: worker matou (Vercel timeout, OOM, deploy) entre TX1 (reserve) e
 * TX3 (finalize). Row ficou em `processing` indefinidamente. Janitor é o
 * mecanismo de recuperação — invocado no INÍCIO de cada tick (antes da reserva
 * de novos eventos) para que rows abandonadas voltem a `pending` e sejam
 * processadas novamente.
 *
 * 5 minutos é gente — mais que suficiente para qualquer handler legítimo +
 * tolerância para clock skew. Aumentar significa retentativa mais lenta para
 * crash recovery; diminuir aumenta risco de double-reclaim em handler lento.
 *
 * Anotação no last_error preserva contexto: operador vê em `SELECT last_error
 * FROM outbox WHERE id=...` que esta row foi recuperada de stuck.
 */
const STUCK_THRESHOLD = sql`interval '5 minutes'`;

export async function reclaimStuckProcessing(): Promise<number> {
  const result = await dbWorker.execute<{ id: string }>(sql`
    UPDATE outbox
       SET status = 'pending',
           processing_started_at = null,
           next_attempt_at = now(),
           last_error = coalesce(last_error, '') || ' [reclaimed: stuck > 5min]'
     WHERE status = 'processing'
       AND processing_started_at < now() - ${STUCK_THRESHOLD}
   RETURNING id
  `);
  const count = result.length;
  if (count > 0) {
    metrics.emit('outbox.stuck.reclaimed', { count });
  }
  return count;
}
