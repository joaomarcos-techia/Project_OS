import 'server-only';

import { safeEqual } from '@/lib/auth/secret-compare';
import { env } from '@/lib/env';
import { logger } from '@/lib/observability/logger';
import { metrics } from '@/lib/observability/metrics';

/**
 * Auth das rotas `/api/cron/**` — ponto único (M2 — auditoria de APIs).
 *
 * SINGLE-FACTOR, e a doc agora diz isso. O `Authorization: Bearer <CRON_SECRET>`
 * (que a Vercel envia automaticamente) é o ÚNICO gate. Os docblocks antigos
 * afirmavam rejeitar quem não trouxesse o header `x-vercel-cron`, mas o código
 * apenas logava e sempre autorizava — a doc superestimava a defesa, que é pior que
 * não tê-la: dá falsa sensação de profundidade.
 *
 * F-09 — por que NÃO exigimos o header de origem: a Vercel documenta hoje
 * `x-vercel-cron-schedule`, não `x-vercel-cron`. Depender de um header não
 * documentado para um 401 duro arrisca parar TODOS os crons em silêncio se a
 * plataforma renomeá-lo — e o outbox parado é falha de integridade de eventos.
 * A ausência do header vira ANOMALIA OBSERVÁVEL (`cron.origin_header_missing`),
 * não um gate.
 *
 * Blast radius: as rotas destrutivas (`destructive: true`) preferem
 * `CRON_SECRET_DESTRUCTIVE` quando definido (V5), então vazar o segredo de
 * monitoring não dá acesso a apagar PII.
 *
 * Recebe `Request` puro de propósito — nada de `NextRequest`. Assim o gate é
 * testável com `new Request(url, { headers })`, sem subir runtime do Next.
 */
export type CronAuthOptions = {
  /** Nome da rota para métrica/log (ex.: 'outbox'). */
  route: string;
  /** Rotas que apagam dado ou mudam acesso: preferem CRON_SECRET_DESTRUCTIVE. */
  destructive?: boolean;
};

/**
 * `null` = autorizado. `Response` = 401 pronto para o handler devolver.
 *
 * Uso: `const denied = assertCronAuth(req, { route: 'outbox' }); if (denied) return denied;`
 */
export function assertCronAuth(req: Request, opts: CronAuthOptions): Response | null {
  const secret = opts.destructive ? (env.CRON_SECRET_DESTRUCTIVE ?? env.CRON_SECRET) : env.CRON_SECRET;
  const authorization = req.headers.get('authorization');

  // `secret &&`: CRON_SECRET é optional() no schema. Sem este guard,
  // `Bearer ${undefined}` vira a string "Bearer undefined" e quem enviasse esse
  // header autenticaria. Fail-close aqui, não na memória de quem chama.
  if (!secret || !safeEqual(authorization, `Bearer ${secret}`)) {
    const fields = {
      route: opts.route,
      destructive: opts.destructive === true,
      hasBearer: authorization !== null,
      hasVercelHeader: hasOriginHeader(req),
      secretConfigured: Boolean(secret),
    };
    // Métrica (SLI agregável) + linha `warn` para a saved-search do Better Stack —
    // mesmo pipeline stdout, sem 2ª fonte da verdade. NÃO usa captureException: o
    // ADR-029 mantém logs fora do Sentry, e um 401 é evento de autorização, não
    // exceção. Mesmo padrão de `auth.ratelimit.degraded` ([rate-limit.ts]).
    metrics.emit('cron.unauthorized', fields);
    logger.warn('cron.unauthorized', fields);
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!hasOriginHeader(req) && !env.OUTBOX_CRON_ALLOW_NON_VERCEL && env.NODE_ENV === 'production') {
    metrics.emit('cron.origin_header_missing', { route: opts.route });
  }
  return null;
}

function hasOriginHeader(req: Request): boolean {
  return (
    req.headers.get('x-vercel-cron') !== null || req.headers.get('x-vercel-cron-schedule') !== null
  );
}
