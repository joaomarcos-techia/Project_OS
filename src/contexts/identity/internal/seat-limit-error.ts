/**
 * Traduz a recusa da trigger `profiles_plan_seat_limits` (migration 0119,
 * ADR-067) para o erro de domínio do convite.
 *
 * A trigger levanta `check_violation` (23514) com o nome da restrição. O
 * postgres.js expõe `code` e `constraint_name`; o Drizzle pode embrulhar o erro
 * em `cause`. Qualquer outro erro passa adiante sem mudança.
 */
import { UserQuotaExceededError } from '../errors';

const CONSTRAINT_DIMENSION = {
  plan_professional_seat_limit: 'professionals',
  plan_staff_seat_limit: 'staff',
} as const;

function constraintOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
  if (candidate.code !== '23514') return null;
  const name = candidate.constraint_name ?? candidate.constraint;
  return typeof name === 'string' ? name : null;
}

export function seatLimitErrorFrom(err: unknown): UserQuotaExceededError | null {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current != null; depth += 1) {
    const name = constraintOf(current);
    if (name && name in CONSTRAINT_DIMENSION) {
      return new UserQuotaExceededError(
        null,
        CONSTRAINT_DIMENSION[name as keyof typeof CONSTRAINT_DIMENSION],
      );
    }
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : null;
  }
  return null;
}

/** Relança a recusa de vaga como erro de domínio; o resto, como veio. */
export function rethrowSeatLimit(err: unknown): never {
  throw seatLimitErrorFrom(err) ?? err;
}
