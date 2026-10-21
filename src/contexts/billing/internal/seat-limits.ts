/**
 * Tetos de equipe por plano (ADR-067). Puro: o mesmo cálculo que a trigger
 * `enforce_plan_seat_limits` (migration 0119) faz no banco, para que a tela e a
 * checagem barata do convite digam o que o banco vai decidir.
 *
 *   - Tabela antiga: um teto TOTAL de usuários ativos (`plan_limits.users`).
 *   - Oferta por profissional: um teto de profissionais e outro de equipe
 *     administrativa (`plan_seat_limits`); equipe `null` = ilimitada.
 *
 * A autoridade é a trigger. Isto aqui existe para não mandar e-mail de convite
 * que o banco recusaria e para mostrar quantas vagas restam.
 */

export type SeatCategory = 'professionals' | 'staff';
export type SeatDimension = 'users' | SeatCategory;

/** `null` em uma dimensão = sem teto nela. */
export interface SeatLimits {
  users: number | null;
  professionals: number | null;
  staff: number | null;
}

export interface SeatUsage {
  users: number;
  professionals: number;
  staff: number;
}

export interface SeatQuotaDecision {
  allowed: boolean;
  /** Dimensão que barrou; `null` quando cabe. */
  dimension: SeatDimension | null;
  limit: number | null;
}

export interface PlanSeatCaps {
  professionals: number;
  staff: number | null;
}

function minCap(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/**
 * Teto efetivo de uma assinatura. Um downgrade agendado reserva a capacidade do
 * destino desde o pedido, como na trigger.
 */
export function effectiveSeatLimits(input: {
  current: PlanSeatCaps | null;
  scheduledDowngrade: PlanSeatCaps | null;
  legacyUsers: number | null;
}): SeatLimits {
  if (!input.current) return { users: input.legacyUsers, professionals: null, staff: null };
  const target = input.scheduledDowngrade;
  return {
    users: null,
    professionals: target
      ? Math.min(input.current.professionals, target.professionals)
      : input.current.professionals,
    staff: target ? minCap(input.current.staff, target.staff) : input.current.staff,
  };
}

/** Cabe mais uma pessoa desta categoria? */
export function decideSeatQuota(
  limits: SeatLimits | null,
  usage: SeatUsage,
  category: SeatCategory,
): SeatQuotaDecision {
  if (!limits) return { allowed: true, dimension: null, limit: null };
  if (limits.users !== null && usage.users >= limits.users) {
    return { allowed: false, dimension: 'users', limit: limits.users };
  }
  const cap = limits[category];
  if (cap !== null && usage[category] >= cap) {
    return { allowed: false, dimension: category, limit: cap };
  }
  return { allowed: true, dimension: null, limit: null };
}

/** A equipe atual cabe nos tetos de um plano? Usado antes de agendar downgrade. */
export function teamFitsSeatCaps(usage: SeatUsage, caps: PlanSeatCaps): boolean {
  return (
    usage.professionals <= caps.professionals && (caps.staff === null || usage.staff <= caps.staff)
  );
}
