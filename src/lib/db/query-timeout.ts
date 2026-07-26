/**
 * Deadline para leituras server-side — a rede de segurança contra "loading
 * infinito".
 *
 * POR QUE EXISTE (2026-07-25): páginas que fazem fan-out (`Promise.all` de várias
 * leituras) contra um pool pequeno podem FAMINTAR por conexão — a query fica na fila
 * do pool, que NÃO tem timeout, e nem o `statement_timeout` do Postgres pega (ele só
 * corta query EXECUTANDO, não query esperando conexão). O sintoma foi o dashboard do
 * admin pendurando 300s. O conserto estrutural é dimensionar o pool ao fan-out
 * (ver `db/index.ts`); ISTO é a defesa em profundidade: nenhuma leitura pendura além
 * do deadline, haja o que houver com pool/pooler/rede.
 *
 * DOIS MODOS, escolha por SEGURANÇA DO DADO:
 *   - `withQueryDeadline` → LANÇA no timeout. Use onde dado incompleto ENGANA
 *     (financeiro/caixa): a página cai no error boundary ("tente de novo"), nunca
 *     mostra vazio-por-timeout como se fosse a verdade.
 *   - `withQueryFallback` → devolve `fallback` no timeout/erro. Use só em VISÃO GERAL
 *     onde zero/vazio é aceitável e melhor que pendurar (ex.: dashboard).
 *
 * Server-only.
 */
import 'server-only';

import { metrics } from '@/lib/observability/metrics';

const TIMED_OUT = Symbol('query-timeout');

/** Deadline padrão. Folga enorme p/ OLTP saudável; além disso é anomalia. */
export const DEFAULT_QUERY_DEADLINE_MS = 8_000;

/**
 * Corre `p` contra um deadline. Se estourar, emite `query.timeout` e LANÇA.
 * O timer é sempre limpo (não segura o event loop quando `p` ganha).
 */
export async function withQueryDeadline<T>(
  name: string,
  p: Promise<T>,
  ms: number = DEFAULT_QUERY_DEADLINE_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    const result = await Promise.race([p, deadline]);
    if (result === TIMED_OUT) {
      metrics.emit('query.timeout', { name, ms, mode: 'deadline' });
      throw new Error(`[query-timeout] leitura "${name}" excedeu ${ms}ms`);
    }
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Como `withQueryDeadline`, mas devolve `fallback` no timeout OU em qualquer erro da
 * leitura. Só para visão geral (zero/vazio aceitável). NUNCA em tela onde vazio
 * engana o operador.
 */
export async function withQueryFallback<T>(
  name: string,
  p: Promise<T>,
  fallback: T,
  ms: number = DEFAULT_QUERY_DEADLINE_MS,
): Promise<T> {
  try {
    return await withQueryDeadline(name, p, ms);
  } catch {
    // timeout (já contabilizado) ou erro da própria query — o overview segue com
    // fallback em vez de derrubar a página inteira por uma leitura.
    metrics.emit('query.fallback', { name });
    return fallback;
  }
}
