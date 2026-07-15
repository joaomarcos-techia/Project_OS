/**
 * Shared helpers das Server Actions do contexto clinical. Fora dos arquivos
 * `'use server'` (que só podem exportar funções async).
 *
 * jsonSafe, requestContext e a lógica de idemKey são centralizados em @/lib/
 * (S1); aqui ficam o binding do prefixo/erro e o `asConflict` — específico do
 * domínio (erro + predicado próprios), por isso NÃO centralizado (ADR-036).
 */
import { makeIdemKey } from '@/lib/idempotency/idem-key';
import { isUniqueViolation } from '@/lib/outbox/errors';

import { ClinicalValidationError, ProntuarioConflitoError } from '../errors';

export { jsonSafe } from '@/lib/idempotency/json-safe';
export { requestContext } from '@/lib/audit/request-context-from-headers';

/** CHECK-valid idempotency key: `clinical:<action>:<hex>`. */
export const idemKey = makeIdemKey('clinical', (m) => new ClinicalValidationError(m));

/** Map UNIQUE (23505) para conflito limpo (ex.: corrida de prontuário por appointment). */
export function asConflict(err: unknown): never {
  if (isUniqueViolation(err)) {
    throw new ProntuarioConflitoError('Conflito ao gravar prontuário (já existe registro para esta consulta).');
  }
  throw err;
}
