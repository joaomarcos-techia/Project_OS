/**
 * TEMPORÁRIO — verificação do Sentry em produção (C16).
 *
 * GET /api/sentry-test → lança um erro NÃO tratado de propósito, que o Next
 * reporta ao Sentry via `onRequestError` (instrumentation.ts). Serve para:
 *   1. registrar o environment `production` no Sentry (aparece no dropdown de Alerts);
 *   2. checar se o stack trace vem legível (source maps) ou minificado.
 *
 * REMOVER assim que a verificação terminar. Sem PII, sem I/O — só um throw.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Response {
  throw new Error(`SENTRY_TEST_ERROR ${new Date().toISOString()} (temporario — pode remover)`);
}
