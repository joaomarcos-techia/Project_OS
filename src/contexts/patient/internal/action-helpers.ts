/**
 * Shared helpers for the patient Server Actions AND the patient internal cores
 * (C12). Lives outside the `'use server'` file because those may only export
 * async functions — and because the cores (createPatientCore, LGPD intake) are
 * called from the AI-agent worker, which has no request context.
 *
 * `requestContext()` reads `next/headers` and is therefore request-only — the
 * Server Actions use it; the agent path builds a synthetic RequestContext via
 * buildAgentRequestContext (src/lib/audit/request-context).
 *
 * jsonSafe, requestContext e a lógica de idemKey são centralizados em @/lib/
 * (S1) — aqui ficam só o re-export e o binding do prefixo/erro deste contexto.
 */
import { makeIdemKey } from '@/lib/idempotency/idem-key';

import { PatientValidationError } from '../errors';

export { jsonSafe } from '@/lib/idempotency/json-safe';
export { requestContext } from '@/lib/audit/request-context-from-headers';

/** CHECK-valid idempotency key: `patient:<action>:<hex>`. */
export const idemKey = makeIdemKey('patient', (m) => new PatientValidationError(m));
