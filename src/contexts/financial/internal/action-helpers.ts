/**
 * Helpers das Server Actions do contexto financial. Fora dos arquivos
 * `'use server'` (que só podem exportar funções async).
 *
 * jsonSafe, requestContext e a lógica de idemKey são centralizados em @/lib/
 * (S1); aqui fica só o re-export e o binding do prefixo/erro deste contexto.
 */
import { makeIdemKey } from '@/lib/idempotency/idem-key';

import { FinancialValidationError } from '../errors';

export { jsonSafe } from '@/lib/idempotency/json-safe';
export { requestContext } from '@/lib/audit/request-context-from-headers';

/** CHECK-valid idempotency key: `financial:<action>:<hex>`. */
export const idemKey = makeIdemKey('financial', (m) => new FinancialValidationError(m));
