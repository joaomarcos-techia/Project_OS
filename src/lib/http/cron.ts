/**
 * withCron — fronteira ÚNICA de execução dos crons (ADR-045).
 *
 * POR QUE existe: as 13 rotas de `/api/cron/**` repetiam à mão o mesmo
 * esqueleto — `assertCronRuntimeReady` → `assertCronAuth` → `try { … } catch
 * { metrics.emit('<x>.error'); return 500 }`. Treze cópias significam treze
 * lugares para esquecer algo, e todas esqueciam a mesma coisa: a exceção nunca
 * chegava ao Sentry (achado C3 — o Sentry server-side só captura o que é
 * LANÇADO, e estes catches devolvem 500 sem rethrow). Um cron novo herdava o
 * buraco por imitação. Agora herda a correção.
 *
 * O QUE O WRAPPER ASSUME: auth, escopo de correlação, captura no Sentry,
 * heartbeat de erro e o 500 uniforme.
 * O QUE FICA NO HANDLER: todo o caminho de sucesso — inclusive o heartbeat de
 * `success`/`skipped` com o `detail` que cada cron tem de próprio, e o corpo da
 * resposta. Isto é deliberado: os 3 `proactive-*` fazem early-return `skipped`
 * e cada cron tem um payload distinto; centralizar isso obrigaria a uniformizar
 * 13 respostas sem ganho.
 *
 * ⚠️ `errorEvent` é passado VERBATIM de propósito. Os nomes atuais são
 * inconsistentes (`worker.error`, `invites_cleanup.error` com underscore,
 * `cron.audit_partitions.error` com prefixo), mas a saved search
 * `event:"*.error"` do Better Stack pega todos hoje. Uniformizar seria uma
 * mudança visível em dashboard sem valor operacional — o nome é contrato.
 */
import 'server-only';

import { buildRequestContext } from '@/lib/audit/request-context';
import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { assertCronRuntimeReady } from '@/lib/env';
import { assertCronAuth, type CronAuthOptions } from '@/lib/http/cron-auth';
import { captureBackgroundError } from '@/lib/observability/capture';
import { runWithContext } from '@/lib/observability/context';
import { metrics } from '@/lib/observability/metrics';

export interface WithCronOptions extends CronAuthOptions {
  /** Nome do job em `cron_heartbeats` (= path no vercel.json). */
  job: string;
  /** Evento de erro JÁ EXISTENTE desta rota. Preservado verbatim. */
  errorEvent: string;
}

type CronHandler = (req: Request) => Promise<Response>;

export function withCron(opts: WithCronOptions, handler: CronHandler): CronHandler {
  const flow = `cron.${opts.route}`;

  return async function run(req: Request): Promise<Response> {
    // O escopo abre ANTES da auth para que `cron.unauthorized` (emitido dentro
    // de assertCronAuth) também carregue o request_id — um 401 sem correlação
    // é justamente o que se quer investigar.
    const { requestId } = buildRequestContext(req.headers);

    return runWithContext({ requestId, flow }, async () => {
      try {
        assertCronRuntimeReady();
        // `opts` (não um literal novo) porque WithCronOptions ESTENDE
        // CronAuthOptions — sob `exactOptionalPropertyTypes` recopiar
        // `destructive` injetaria um `undefined` explícito, que o tipo recusa.
        const denied = assertCronAuth(req, opts);
        if (denied) return denied;

        return await handler(req);
      } catch (err) {
        // Ordem importa: o Sentry primeiro (é o único caminho do stack; o
        // stream de métricas reduz Error a {name,message}). `capture` nunca
        // lança, então não engole o resto.
        captureBackgroundError(err, { flow });
        metrics.emit(opts.errorEvent, { error: err });
        await recordHeartbeat(opts.job, 'error', {
          error: err instanceof Error ? err.message : String(err),
        });
        return Response.json({ ok: false, error: 'internal' }, { status: 500 });
      }
    });
  };
}
