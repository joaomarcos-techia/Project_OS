/**
 * captureBackgroundError — leva exceções de BACKGROUND ao Sentry, com stack (C3).
 *
 * POR QUE existe: o Sentry server-side só captura o que é LANÇADO
 * (`onRequestError`, instrumentation.ts). Mas webhooks, os 13 crons e o worker
 * seguem `catch → metrics.emit → 500` sem rethrow, então nunca chegam lá. E o
 * stream de métricas descarta o stack (`sanitize-fields.ts` reduz Error a
 * `{name, message}`). Resultado hoje: falha de background = uma linha de stdout
 * sem stack. Este helper é o caminho do stack.
 *
 * NÃO conflita com o ADR-029: aquele ADR mantém *LOGS* fora do Sentry. Exceção
 * não é log — é exatamente para isso que o Sentry existe. Eventos de controle
 * de fluxo esperado (401 de cron, trip de rate-limit) seguem só como métrica,
 * e sinais deliberadamente stdout-only (ADR-043 §4: `cron.audit_partitions.
 * degraded`) NÃO devem passar por aqui — criariam 2ª fonte da verdade.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * INVARIANTE 1 — NUNCA FAZ THROW
 * ────────────────────────────────────────────────────────────────────────────
 * Retorna `void` e engole qualquer falha do próprio Sentry. Telemetria não pode
 * alterar o fluxo de quem a chama: um Sentry fora do ar derrubando um webhook
 * seria o oposto do objetivo. Congelado em teste — não "melhore" isto.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * INVARIANTE 2 — TAGS SÓ COM IDENTIFICADOR ESCALAR (N6)
 * ────────────────────────────────────────────────────────────────────────────
 * `scrubEvent` (beforeSend) sanitiza `request`/`extra`/`contexts` mas **NÃO**
 * toca `tags` — tag é o sink MENOS protegido do sistema. Por isso o `ctx` é um
 * tipo FECHADO (sem `& Record<string, unknown>`, que era o rascunho da
 * auditoria): texto livre — em especial conteúdo clínico — não compila. O
 * `Error` cru vai inteiro para o Sentry (é dele que vem o stack); nada de
 * payload de domínio viaja junto.
 */
import 'server-only';

import * as Sentry from '@sentry/nextjs';

import { getContext } from './context';

export interface CaptureContext {
  /** Fronteira lógica: `cron.outbox`, `billing.webhook`, … */
  flow: string;
  clinicId?: string;
  requestId?: string;
  userId?: string;
}

export function captureBackgroundError(err: unknown, ctx: CaptureContext): void {
  try {
    const ambient = getContext();
    const requestId = ctx.requestId ?? ambient?.requestId;
    const clinicId = ctx.clinicId ?? ambient?.clinicId;
    const userId = ctx.userId ?? ambient?.userId;

    Sentry.captureException(err, {
      tags: {
        flow: ctx.flow,
        ...(requestId ? { request_id: requestId } : {}),
        ...(clinicId ? { clinicId } : {}),
        ...(userId ? { userId } : {}),
      },
    });
  } catch {
    // Invariante 1: telemetria nunca derruba o caller. Sem re-emitir aqui —
    // um logger neste catch poderia recursar se a causa for o próprio pipeline.
  }
}
