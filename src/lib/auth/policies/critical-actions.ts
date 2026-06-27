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
// F-14: lista REAL (não mais stub). Cada nome é uma Server Action exportada que
// DEVE chamar requireFreshPermission(...) no corpo de nível superior — enforçado
// pelo arch-test AST em src/lib/auth/policies/critical-actions.test.ts (pega
// código morto, ao contrário de grep textual). Ordem alfabética para review.
//
// Invariante de super_admin (F-14): o short-circuit `if (user.isSuperAdmin) return`
// em requireCachedPermission/requireFreshPermission NÃO checa aal2. Toda AÇÃO
// SENSÍVEL de super_admin DEVE passar por requireSuperAdmin (que exige aal2);
// ações tenant (como as de paciente) já passam por requireClinicId, que LANÇA
// para super_admin — logo um super_admin em aal1 não as alcança.
export const CRITICAL_ACTIONS: readonly string[] = Object.freeze([
  'connectMyClinicWhatsapp',
  'deletePatient',
  'disconnectMyClinicWhatsapp',
  'editSignedProntuario',
  'requestLgpdDelete',
  'requestLgpdExport',
  'signProntuario',
]);
