/**
 * GET /api/cron/data-retention — F-09 (auditoria forense 2026-06-10).
 *
 * Purge mensal (vercel.json crons[]: `0 5 1 * *`) de TODA tabela declarada em
 * `RETENTION_POLICIES` (src/lib/db/retention-policy.ts) — que é a fonte única.
 *
 * Mudou em 2026-07-17 (auditoria de banco, A2/A5): antes esta rota tinha as
 * janelas hardcoded e cobria 3 tabelas. A retenção da IA existia só como
 * comentário no schema ("purge por retention job") e nada a aplicava; as 3
 * tabelas raw de mensageria — as de maior taxa de inserção do sistema — não
 * tinham retenção nenhuma. Agora a lista mora no registro e esta rota só a
 * executa: acrescentar tabela é uma linha lá, não código aqui.
 *
 * Projeção da auditoria: 1.000 clínicas × ~50 eventos/dia ≈ 18M rows/ano sem
 * retenção — degradava backups, vacuum e o count(*) do healthcheck.
 *
 * DELETEs em lotes (id IN subquery LIMIT) com teto de iterações para caber no
 * maxDuration; o que sobrar sai no próximo run. Mesma auth das demais rotas
 * cron (Bearer CRON_SECRET + header Vercel não-fatal).
 */
import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { dbAdmin } from '@/lib/db';
import { buildPurgeStatement, RETENTION_POLICIES } from '@/lib/db/retention-policy';
import { assertCronRuntimeReady } from '@/lib/env';
import { assertCronAuth } from '@/lib/http/cron-auth';
import { metrics } from '@/lib/observability/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
    const purged: Record<string, number> = {};

    // A ordem do registro é significativa: ai_conversations vem antes de
    // ai_messages porque a FK é CASCADE — apagar a conversa já leva as mensagens,
    // e o purge seguinte só cata as vencidas de conversa ainda ativa.
    for (const policy of RETENTION_POLICIES) {
      purged[policy.table] = await purgeBatched(async () => {
        const rows = (await dbAdmin.execute(
          buildPurgeStatement(policy, BATCH),
        )) as unknown as unknown[];
        return rows.length;
      });
    }

    metrics.emit('retention.run', purged);
    await recordHeartbeat('data-retention', 'success', purged);
    return Response.json({ ok: true, purged }, { status: 200 });
  } catch (err) {
    metrics.emit('retention.error', { error: err });
    return Response.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
