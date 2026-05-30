/**
 * CRITICAL_ACTIONS — lista canônica de Server Actions que DEVEM revalidar
 * permissions no banco (não no JWT cache).
 *
 * Pattern (D20):
 *   - Server Actions normais: requireCachedPermission(perm) — lê JWT (rápido).
 *   - Actions críticas: requireFreshPermission(perm) — query banco em runtime.
 *
 * Vitest arch test (em F8) grep'a por cada nome aqui em src/ e exige que a
 * action use `requireFreshPermission(`. Falha quebra CI (D29).
 *
 * Em C3 a lista é stub mínima — cresce em C4+ conforme actions destrutivas
 * forem implementadas. Manter ORDEM ALFABÉTICA para facilitar review.
 */
export const CRITICAL_ACTIONS: readonly string[] = Object.freeze([
  // C3 stub — exemplos placeholders documentam o pattern. Adicionar nomes
  // reais de Server Actions conforme aparecerem em C5+ (delete hard patient,
  // billing refund, audit export, etc.).
  'deleteProfileHard',
]);
