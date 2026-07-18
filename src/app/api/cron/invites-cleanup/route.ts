/**
 * GET /api/cron/invites-cleanup — LGPD (ADR-027 · GAP 10).
 *
 * Convites de clínica coletam PII (e-mail do gestor; CNPJ/telefone/endereço no
 * step_state). Convites NÃO concluídos (pending/started/expired/cancelled) com
 * `created_at` > 30 dias são ANONIMIZADOS: zera email/metadata/step_state e marca
 * pending/started como `expired`. A linha PERMANECE (status + timestamps alimentam
 * o funil), mas sem PII — minimização de dados.
 *
 * Convites `completed` NÃO são tocados: viraram clínica (o dado vive no tenant +
 * auditoria). Idempotente: o filtro exige PII presente, então re-runs não reprocessam.
 *
 * Auth + heartbeat iguais aos demais crons — [cron-auth.ts], single-factor: o Bearer
 * `CRON_SECRET` é o gate; o header Vercel NÃO é (só anomalia observável).
 */
import { sql } from 'drizzle-orm';

import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { dbAdmin } from '@/lib/db';
import { withCron } from '@/lib/http/cron';
import { metrics } from '@/lib/observability/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const INVITE_RETENTION_DAYS = 30;
const BATCH = 1000;
const MAX_BATCHES = 10; // teto: 10k convites/run; o resto sai no próximo run.

export const GET = withCron(
  { job: 'invites-cleanup', route: 'invites-cleanup', errorEvent: 'invites_cleanup.error' },
  async () => {
    let anonymized = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const rows = (await dbAdmin.execute(
        sql`WITH del AS (
              SELECT id FROM clinic_invites
               WHERE status <> 'completed'
                 AND created_at < now() - make_interval(days => ${INVITE_RETENTION_DAYS})
                 AND (email IS NOT NULL OR metadata IS NOT NULL OR step_state IS NOT NULL)
               LIMIT ${BATCH}
            )
            UPDATE clinic_invites c
               SET email = NULL,
                   metadata = NULL,
                   step_state = NULL,
                   status = CASE WHEN c.status IN ('pending', 'started') THEN 'expired' ELSE c.status END
              FROM del
             WHERE c.id = del.id
            RETURNING c.id`,
      )) as unknown as Array<{ id: string }>;
      anonymized += rows.length;
      if (rows.length < BATCH) break;
    }

    metrics.emit('invites_cleanup.run', { anonymized });
    await recordHeartbeat('invites-cleanup', 'success', { anonymized });
    return Response.json({ ok: true, anonymized }, { status: 200 });
  },
);
