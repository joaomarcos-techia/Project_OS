/**
 * ObsContext — correlação AMBIENTE para métricas/logs (A2/A3).
 *
 * Resolve a correlação sem tocar os ~150 call-sites de `metrics.emit`/`logger`:
 * a fronteira (withCron, webhook, idempotentMutation) abre um escopo e todo
 * emit dentro dele herda `requestId`/`clinicId`/`userId`/`flow`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * INVARIANTE 1 — ALLOWLIST FECHADA (segurança, N6 / pós-A1)
 * ────────────────────────────────────────────────────────────────────────────
 * Este contexto é AMBIENTE: tudo que entra é injetado em TODA métrica e TODO
 * log do escopo e, via `capture`, chega ao Sentry (um TERCEIRO). A sanitização
 * do repo (`sanitizePayload`) é DENYLIST de nomes credenciais e NÃO cobre prosa
 * clínica — `content` nunca esteve em SENSITIVE_KEYS, e foi exatamente por isso
 * que 32 `audit_events` guardaram SOAP em claro (ADR-044 / A1).
 *
 * Portanto a defesa aqui NÃO é "redigir o que se reconhece", é "só passa o que
 * está na lista": o tipo é fechado (o compilador barra o literal) E `pick()`
 * copia campo a campo em runtime (barra o objeto largo que driblou o tipo).
 * Mesmo contrato de `sanitizeAiFailurePayload` (ADR-022).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * INVARIANTE 2 — SÓ RUNTIME NODE
 * ────────────────────────────────────────────────────────────────────────────
 * `AsyncLocalStorage` só garante propagação no runtime **Node**; o Edge runtime
 * não oferece equivalente. Por isso quem ABRE escopo é sempre um handler
 * `runtime='nodejs'` (crons/webhooks/worker/actions já são). O middleware roda
 * no Edge e NÃO abre contexto — ele só carimba `x-request-id` no header, que a
 * fronteira Node lê. `server-only` faz um import de client falhar com mensagem
 * clara em vez de um erro críptico de `node:async_hooks`.
 */
import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';

export interface ObsContext {
  requestId?: string;
  clinicId?: string;
  userId?: string;
  flow?: string;
}

/** Teto anti-payload: estes campos são identificadores, nunca texto. */
const MAX_STR = 200;

const ALLOWED = ['requestId', 'clinicId', 'userId', 'flow'] as const;

function safeStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, MAX_STR) : undefined;
}

/** Copia campo a campo: o que não está na lista não existe. */
function pick(raw: ObsContext): ObsContext {
  const src = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of ALLOWED) {
    const v = safeStr(src[k]);
    if (v !== undefined) out[k] = v;
  }
  return out as ObsContext;
}

const storage = new AsyncLocalStorage<ObsContext>();

/** Contexto do escopo atual, ou `undefined` fora de qualquer escopo. */
export function getContext(): ObsContext | undefined {
  return storage.getStore();
}

/**
 * Executa `fn` sob um escopo de correlação. Escopos aninhados MESCLAM sobre o
 * pai (o filho vence) — é como o webhook acrescenta `clinicId` depois de
 * resolvê-lo, sem perder o `requestId` que a fronteira já tinha.
 */
export function runWithContext<T>(ctx: ObsContext, fn: () => T): T {
  const parent = storage.getStore();
  return storage.run({ ...parent, ...pick(ctx) }, fn);
}

/**
 * Contexto ambiente já no formato de campo emitido — fonte ÚNICA do mapeamento
 * usada por `metrics.emit` e `logger` (sem contexto: `{}`, e a linha sai
 * idêntica à de hoje).
 *
 * `requestId` vira `request_id` porque é esse o handle que o ADR-029 promete
 * como ponte resposta↔log↔audit↔Sentry, e é o mesmo nome de tag usado em
 * [capture.ts]. Os demais mantêm o camelCase que os ~150 call-sites já usam.
 */
export function contextFields(): Record<string, string> {
  const ctx = storage.getStore();
  if (!ctx) return {};
  return {
    ...(ctx.requestId ? { request_id: ctx.requestId } : {}),
    ...(ctx.clinicId ? { clinicId: ctx.clinicId } : {}),
    ...(ctx.userId ? { userId: ctx.userId } : {}),
    ...(ctx.flow ? { flow: ctx.flow } : {}),
  };
}
