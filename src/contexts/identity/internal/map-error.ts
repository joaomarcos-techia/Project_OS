/**
 * Mapeia os erros de domínio do Identity para a mensagem que a UI mostra.
 *
 * A solicitação histórica em equipe/actions.ts pedia isto "quando a lista passar de ~5 tipos"
 * (review #6) — com o ciclo de vida (I-2) passamos de 5. Fica no CONTEXTO, não em
 * `@/lib` (ADR-036: @/lib nunca importa de contexts/*; a hierarquia de erros vive
 * aqui). Cada erro carrega o próprio `message` legível; o default nunca vaza
 * detalhe interno.
 *
 * Server-only por transitividade (só importado por Server Actions).
 */
import { trialAccessErrorFrom } from '@/lib/trial-access/policy';
import {
  CrmConflictError,
  EmailAlreadyMemberError,
  InviteAlreadyAcceptedError,
  InviteHasLinkedRecordsError,
  MemberHasActiveCommitmentsError,
  MemberNotFoundError,
  ProtectedRoleError,
  ProfessionalCredentialError,
  RoleAssignmentError,
  SelfMutationError,
} from '../errors';

/** Todos os erros de domínio "esperados" — os que têm mensagem própria para o usuário. */
const KNOWN_ERRORS = [
  RoleAssignmentError,
  EmailAlreadyMemberError,
  CrmConflictError,
  ProfessionalCredentialError,
  MemberNotFoundError,
  InviteAlreadyAcceptedError,
  SelfMutationError,
  ProtectedRoleError,
  MemberHasActiveCommitmentsError,
  InviteHasLinkedRecordsError,
] as const;

export function mapIdentityError(err: unknown): string {
  const trialError = trialAccessErrorFrom(err);
  if (trialError) return trialError.message;
  const dbError = err instanceof Error ? (err.cause ?? err) : err;
  if (
    dbError != null &&
    typeof dbError === 'object' &&
    'code' in dbError &&
    dbError.code === '23514' &&
    'constraint_name' in dbError &&
    dbError.constraint_name === 'offer_2026_seat_limit'
  ) {
    return 'As vagas de médicos ou equipe deste plano foram preenchidas. Revise o plano antes de continuar.';
  }
  if (KNOWN_ERRORS.some((E) => err instanceof E)) {
    return (err as Error).message;
  }
  return 'Não foi possível concluir a ação. Tente novamente.';
}
