/**
 * Contrato de resultado das Server Actions de configuração de agenda (OBS-002).
 *
 * Client-safe de propósito: o tipo e o `unwrap` atravessam a fronteira e são
 * usados pelos managers. A tradução server-side vive em
 * `internal/action-result.ts`.
 *
 * Por que um resultado e não uma exceção: exceção em Server Action vira HTTP
 * 500 com a mensagem MASCARADA pelo runtime de produção — foi assim que
 * "código duplicado" chegou à tela como um alert vazio, e ao Sentry como erro.
 */
export type SchedulingActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

/**
 * Converte a negativa controlada de volta em `throw` NO CLIENTE, para os
 * managers manterem o `try/catch` que já tinham.
 *
 * A diferença em relação a deixar a action lançar: aqui o erro nasce no
 * browser, com a mensagem real de negócio, depois de um HTTP 200. Nada de 5xx,
 * nada de Sentry, nada de alert vazio.
 */
export async function unwrapAction<T>(promise: Promise<SchedulingActionResult<T>>): Promise<T> {
  const result = await promise;
  if (result.ok) return result.data;
  throw new Error(result.message);
}
