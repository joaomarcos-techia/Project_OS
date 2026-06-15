/**
 * Shared helpers for the patient Server Actions AND the patient internal cores
 * (C12). Lives outside the `'use server'` file because those may only export
 * async functions — and because the cores (createPatientCore, LGPD intake) are
 * called from the AI-agent worker, which has no request context.
 *
 * `requestContext()` reads `next/headers` and is therefore request-only — it
 * stays here for the Server Actions; the agent path builds a synthetic
 * RequestContext via buildAgentRequestContext (src/lib/audit/request-context).
 */
import { headers } from 'next/headers';

import { buildRequestContext } from '@/lib/audit/request-context';
import type { RequestContext } from '@/lib/audit/types';

import { PatientValidationError } from '../errors';

/** 7 dias — janela de dedup das mutations de paciente (igual ao histórico). */
export const PATIENT_IDEM_TTL = 604_800;

/**
 * Torna o payload JSON-safe para a idempotência: remove chaves `undefined`
 * (que o Zod mantém para campos opcionais em branco). assertJsonSafe (C4)
 * rejeita `undefined`. Determinístico: mesmo input lógico → mesmo hash.
 */
export function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Build a CHECK-valid idempotency key: `patient:<action>:<hex>`. */
export function idemKey(action: string, clientKey: string): string {
  const hex = clientKey.replace(/-/g, '').toLowerCase();
  if (!/^[a-f0-9]{8,}$/.test(hex)) {
    throw new PatientValidationError('idempotencyKey must be a UUID');
  }
  return `patient:${action}:${hex}`;
}

/** Request-only: builds the audit RequestContext from incoming headers. */
export async function requestContext(): Promise<RequestContext> {
  return buildRequestContext(await headers());
}
