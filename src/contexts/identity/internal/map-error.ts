/**
 * Mapeia os erros de domínio do Identity para a mensagem que a UI mostra.
 *
 * O TODO em equipe/actions.ts pedia isto "quando a lista passar de ~5 tipos"
 * (review #6) — com o ciclo de vida (I-2) passamos de 5. Fica no CONTEXTO, não em
 * `@/lib` (ADR-036: @/lib nunca importa de contexts/*; a hierarquia de erros vive
 * aqui). Cada erro carrega o próprio `message` legível; o default nunca vaza
 * detalhe interno.
 *
 * Server-only por transitividade (só importado por Server Actions).
 */
import {
  CrmConflictError,
  EmailAlreadyMemberError,
  InviteAlreadyAcceptedError,
  MemberHasActiveCommitmentsError,
  MemberNotFoundError,
  ProtectedRoleError,
  RoleAssignmentError,
  SelfMutationError,
} from '../errors';

/** Todos os erros de domínio "esperados" — os que têm mensagem própria para o usuário. */
const KNOWN_ERRORS = [
  RoleAssignmentError,
  EmailAlreadyMemberError,
  CrmConflictError,
  MemberNotFoundError,
  InviteAlreadyAcceptedError,
  SelfMutationError,
  ProtectedRoleError,
  MemberHasActiveCommitmentsError,
] as const;

export function mapIdentityError(err: unknown): string {
  if (KNOWN_ERRORS.some((E) => err instanceof E)) {
    return (err as Error).message;
  }
  return 'Não foi possível concluir a ação. Tente novamente.';
}
