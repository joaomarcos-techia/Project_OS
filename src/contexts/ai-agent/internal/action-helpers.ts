/**
 * Helpers das Server Actions do ai-agent. Fora do arquivo `'use server'` (que só
 * pode exportar funções async).
 */
import { makeIdemKey } from '@/lib/idempotency/idem-key';

import { ConversationValidationError } from '../errors';

export { jsonSafe } from '@/lib/idempotency/json-safe';
export { requestContext } from '@/lib/audit/request-context-from-headers';

/** CHECK-valid idempotency key: `ai_agent:<action>:<hex>`. */
export const idemKey = makeIdemKey('ai_agent', (m) => new ConversationValidationError(m));
