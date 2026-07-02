/**
 * TEMPORÁRIO — verificação/diagnóstico do Sentry em produção (C16).
 *
 * Sob /api/health porque esse prefixo é EXCLUÍDO do middleware de sessão.
 *
 * Em vez de só dar `throw` (que depende do onRequestError dar flush a tempo no
 * serverless), captura EXPLICITAMENTE + `flush` e RETORNA o diagnóstico:
 *   - dsnConfigured: o SDK do Sentry inicializou no server? (instrumentation ok?)
 *   - sentryEventId: o evento foi capturado?
 *   - flushed:       o evento foi ENVIADO antes de retornar? (chave no serverless)
 *
 * REMOVER assim que a verificação terminar.
 */
import * as Sentry from '@sentry/nextjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const eventId = Sentry.captureException(
    new Error(`SENTRY_TEST_ERROR ${new Date().toISOString()} (temporario)`),
  );
  const flushed = await Sentry.flush(3000);
  return Response.json(
    {
      ok: false,
      note: 'erro de teste enviado ao Sentry',
      dsnConfigured: Boolean(Sentry.getClient()),
      sentryEventId: eventId ?? null,
      flushed,
    },
    { status: 500 },
  );
}
