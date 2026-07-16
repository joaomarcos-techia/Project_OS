/**
 * Matriz de quem-convida-quem (spec convite §"Quem convida quem"). Função PURA,
 * server-side — a UI filtra as opções, mas a autoridade é aqui (não confiar no cliente).
 *
 * MVP: só o caminho do `owner` roda (gestor é DORMENTE — não semeado/oferecido). A
 * regra completa fica pronta para o dia que `gestor` acordar: custo zero, e protege
 * contra escalonamento. Invariante: **ninguém cria `owner`** (owner é único — ADR-032).
 */
import type { Role } from '@/lib/auth/roles';

import { RoleAssignmentError } from '../errors';

/** Papéis que cada convidante pode atribuir. Owner/super_admin nunca são alvo. */
const ASSIGNABLE: Partial<Record<Role, readonly Role[]>> = {
  owner: ['gestor', 'doctor', 'attendant', 'financial'],
  gestor: ['doctor', 'attendant', 'financial'],
};

export function assertCanAssignRole(inviter: Role, target: Role): void {
  // Anti-escalonamento explícito: ninguém cria owner (único) nem super_admin (plataforma).
  if (target === 'owner' || target === 'super_admin') {
    throw new RoleAssignmentError(`A função '${target}' não pode ser atribuída por convite.`);
  }
  const allowed = ASSIGNABLE[inviter] ?? [];
  if (!allowed.includes(target)) {
    throw new RoleAssignmentError(`A função '${inviter}' não pode convidar '${target}'.`);
  }
}

/**
 * Funções que `actor` pode atribuir — a MESMA fonte de `assertCanAssignRole`, para a
 * UI oferecer só o que o servidor aceitaria (a autoridade continua no assert). Nunca
 * inclui owner/super_admin.
 */
export function assignableRolesFor(actor: Role): readonly Role[] {
  return ASSIGNABLE[actor] ?? [];
}
