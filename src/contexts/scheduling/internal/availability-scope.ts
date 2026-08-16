import 'server-only';

import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireFreshPermission } from '@/lib/auth/tenant-context';

/**
 * Escopo de administração de agenda (AUTHZ-007).
 *
 * ===================================================================
 * O problema
 * ===================================================================
 * `manage:availability` foi concedida ao médico para ele "gerir a própria
 * agenda" (migration 0016). Só que a MESMA permissão protegia três coisas
 * bem diferentes:
 *
 *   1. a disponibilidade DELE          → intenção original
 *   2. salas/equipamentos da clínica   → recurso compartilhado
 *   3. feriados e ausências de QUALQUER profissional → agenda dos outros
 *
 * O pentest exerceu (2) e (3): um médico desativou um recurso compartilhado e
 * registrou uma ausência do OWNER. `createDoctorAbsence()` só validava que o
 * `doctorId` pertencia à clínica — nunca que era o do ator. Em janela ocupada,
 * o mesmo fluxo cancelaria ou transferiria atomicamente todas as consultas
 * agendadas do alvo.
 *
 * ===================================================================
 * A separação, sem migration
 * ===================================================================
 * A recomendação do relatório é separar `manage:own_availability` de
 * `manage:team_availability`. Um code novo exigiria migration (seed + bundles
 * + backfill de overrides) e, principalmente, não mudaria a decisão: quem
 * administra a clínica são as mesmas roles que já têm `manage:settings`
 * (owner e gestor recebem TODAS as permissões; doctor/attendant/financial não
 * recebem esta). Então o eixo administrativo já existe e é observável.
 *
 * Contrato resultante:
 *   - `manage:availability`                   → a MINHA disponibilidade e a MINHA ausência.
 *   - `manage:availability` + `manage:settings` → a de qualquer profissional,
 *      além de recursos globais e feriados da clínica.
 *
 * O check é FRESH de propósito: é elevação para operar a agenda alheia, e o
 * relatório pede permissão administrativa fresh. Vínculo com o tenant continua
 * sendo validado dentro da transação — defesa adicional, nunca substituta de
 * ownership.
 */

/** Ator vindo do gate; só o necessário para a decisão. */
export interface AvailabilityActor {
  userId: string;
  isSuperAdmin: boolean;
  aal: 'aal1' | 'aal2' | null;
  permissions: readonly string[];
}

/**
 * Regra PURA (testável sem banco): este ator administra a agenda da equipe?
 *
 * Serve à UI (filtrar seletor de profissional, esconder feriados/recursos) e
 * é o mesmo predicado que o assert usa. Uma regra só, dois consumidores — se
 * divergirem, a tela promete o que o servidor nega, que é metade do achado.
 */
export function administersTeamSchedule(actor: AvailabilityActor): boolean {
  if (actor.isSuperAdmin) return actor.aal === 'aal2';
  return actor.permissions.includes(PERMISSIONS.MANAGE_SETTINGS);
}

/**
 * Mexer na agenda de `doctorId`. Passa direto quando é a própria; caso
 * contrário exige a capacidade administrativa revalidada no banco.
 *
 * Lança `AuthError` (403). Quem chama de Server Action deve converter para
 * resultado controlado — negativa esperada não é 500 (OBS-002).
 */
export async function assertCanManageDoctorSchedule(
  actor: AvailabilityActor,
  doctorId: string,
): Promise<void> {
  if (doctorId === actor.userId) return;
  await requireFreshPermission(PERMISSIONS.MANAGE_SETTINGS);
}

/**
 * Mexer em recurso compartilhado (sala/equipamento) ou feriado da clínica —
 * nunca "a própria agenda" de ninguém, sempre configuração do tenant.
 */
export async function assertCanManageClinicSchedule(): Promise<void> {
  await requireFreshPermission(PERMISSIONS.MANAGE_SETTINGS);
}
