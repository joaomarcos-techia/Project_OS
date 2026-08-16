/**
 * LGPD-004 — o TERCEIRO estado de uma resposta idempotente.
 *
 * O protocolo tinha dois significados para a coluna `response`:
 *   - `NULL`      → reserva em andamento (in-flight);
 *   - não-nula    → execução concluída, conteúdo cacheado.
 *
 * O scrub do hard-delete escrevia `NULL` para apagar PII e, com isso, uma chave
 * COMPLETA (`status_code=200`) passava a se parecer com uma operação em voo. As
 * consequências foram todas medidas: replay recebia conflito falso, o health
 * contava `in_flight` para algo que já tinha terminado, e o trigger recusava o
 * DELETE por achar que era recente demais.
 *
 * O sentinel resolve isso sem migration: continua sendo uma resposta NÃO-NULA
 * (portanto terminal para todo mundo que já lê a coluna) e é reconhecível para
 * quem precisa distinguir "concluído com conteúdo" de "concluído e expurgado".
 *
 * Fica em `@/lib` porque `mutation.ts` (lib) precisa reconhecê-lo e lib nunca
 * importa de contexts (ADR-036).
 */

/** Valor gravado no lugar da resposta original. Estável — o scrub é idempotente. */
export const PURGED_RESPONSE = { purged: 'lgpd_erasure' } as const;

export type PurgedResponse = typeof PURGED_RESPONSE;

export function isPurgedResponse(value: unknown): value is PurgedResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { purged?: unknown }).purged === PURGED_RESPONSE.purged
  );
}
