/**
 * Shared helpers for the scheduling Server Action modules. Lives outside the
 * `'use server'` files because those may only export async functions.
 *
 * jsonSafe, requestContext e a lógica de idemKey são centralizados em @/lib/
 * (S1); aqui ficam o binding do prefixo/erro e o `asConflict` — específico do
 * domínio (erro + predicado próprios, com EXCLUDE), por isso NÃO centralizado
 * (ADR-036).
 */
import { makeIdemKey } from '@/lib/idempotency/idem-key';
import { isExclusionViolation, isUniqueViolation } from '@/lib/outbox/errors';

import { SchedulingConflictError, SchedulingValidationError } from '../errors';

export { jsonSafe } from '@/lib/idempotency/json-safe';
export { requestContext } from '@/lib/audit/request-context-from-headers';

/** CHECK-valid idempotency key: `scheduling:<action>:<hex>`. */
export const idemKey = makeIdemKey('scheduling', (m) => new SchedulingValidationError(m));

/** Map UNIQUE (23505) / EXCLUDE (23P01) violations to a clean conflict error. */
export function asConflict(err: unknown): never {
  if (isUniqueViolation(err) || isExclusionViolation(err)) {
    // Distingue o conflito do PACIENTE (mesma pessoa em 2 lugares) do conflito do
    // MÉDICO (agenda cheia) pelo nome da constraint (0053 vs doctor_slot_uniq).
    const constraint = (err as { constraint?: string }).constraint ?? '';
    if (constraint.includes('patient_slot')) {
      throw new SchedulingConflictError('este paciente já tem um atendimento neste horário');
    }
    throw new SchedulingConflictError('horário ocupado para este médico');
  }
  throw err;
}
