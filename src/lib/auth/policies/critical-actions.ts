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
// Invariante de super_admin: ATUALIZADO pelo I-1 (ADR-037, 2026-07-16). O
// short-circuit `if (user.isSuperAdmin) return` em requireRole/requireCached*/
// requireFreshPermission AGORA chama assertPlatformStepUp → exige aal2 (era um
// invariante implícito e não testado). Um super_admin em aal1 é BARRADO nos quatro
// helpers, não só em requireSuperAdmin. Coberto por tenant-context.test.ts.
//
// B4 (auditoria de APIs): as 6 transitions de agendamento entraram aqui. Elas já
// chamavam requireFreshPermission(EDIT_AGENDA), mas eram invisíveis ao gate de CI —
// o arch-test só varria 4 arquivos fixos (scheduling não estava) e só reconhecia
// `function` declarada (elas vêm de uma factory). Estavam certas por acidente:
// nada impedia alguém de remover o check sem quebrar o CI.
export const CRITICAL_ACTIONS: readonly string[] = Object.freeze([
  'cancelAppointment',
  'cancelInviteAction',
  'checkInAppointment',
  'completeAppointment',
  'confirmAppointment',
  'connectMyClinicWhatsapp',
  'deletePatient',
  'disconnectMyClinicWhatsapp',
  'editSignedProntuario',
  'inviteMemberAction',
  'markNoShow',
  'requestLgpdDelete',
  'requestLgpdExport',
  'requestPlanChangeAction',
  'resendInviteAction',
  'setMemberActiveAction',
  'setMemberOverrideAction',
  'setMemberRoleAction',
  'signProntuario',
  'startAppointment',
]);
