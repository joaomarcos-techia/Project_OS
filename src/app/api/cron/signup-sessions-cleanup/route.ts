/**
 * GET /api/cron/signup-sessions-cleanup — janitor da fatia O-2a (ADR-060).
 *
 * Apaga sessões anônimas vencidas. Duas razões, e a segunda é a que importa:
 *
 *   1. higiene — a tabela é de alta rotatividade e ninguém precisa de rascunho
 *      de cadastro de ontem;
 *   2. é o que mantém o TETO honesto. `SIGNUP_SESSION_CEILING` conta sessões
 *      VIVAS; se as vencidas nunca saíssem, a contagem inflaria e o teto passaria
 *      a recusar cadastro legítimo por causa de lixo. O janitor não é acessório
 *      do teto — os dois só funcionam juntos.
 *
 * Frequência alta de propósito: o TTL absoluto é de 60 min, então uma passada a
 * cada 10 min mantém a defasagem entre "venceu" e "sumiu" pequena.
 *
 * Auth e heartbeat iguais aos demais crons ([cron-auth.ts]): Bearer CRON_SECRET.
 */
import { purgeExpiredSignupSessions } from '@/contexts/onboarding';
import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { withCron } from '@/lib/http/cron';
import { metrics } from '@/lib/observability/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Tetos por execução: o resto sai na próxima passada, sem segurar lock. */
const BATCH = 500;
const MAX_BATCHES = 10;

export const GET = withCron(
  {
    job: 'signup-sessions-cleanup',
    route: 'signup-sessions-cleanup',
    errorEvent: 'signup_sessions_cleanup.error',
  },
  async () => {
    let deleted = 0;
    let live = 0;

    for (let i = 0; i < MAX_BATCHES; i += 1) {
      const result = await purgeExpiredSignupSessions(BATCH);
      deleted += result.deleted;
      live = result.live;
      // Lote incompleto significa que acabou o que havia a apagar.
      if (result.deleted < BATCH) break;
    }

    metrics.emit('signup_sessions_cleanup.done', { deleted, live });
    await recordHeartbeat('signup-sessions-cleanup', 'success', { deleted, live });
    return Response.json({ ok: true, deleted, live }, { status: 200 });
  },
);
