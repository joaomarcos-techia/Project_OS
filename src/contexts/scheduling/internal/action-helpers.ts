/**
 * Shared helpers for the scheduling Server Action modules. Lives outside the
 * `'use server'` files because those may only export async functions.
 */
import { headers } from 'next/headers';

import { buildRequestContext } from '@/lib/audit/request-context';
import type { RequestContext } from '@/lib/audit/types';
import { isExclusionViolation, isUniqueViolation } from '@/lib/outbox/errors';

import { SchedulingConflictError, SchedulingValidationError } from '../errors';

/** 7 dias — janela de dedup das mutations de agenda. */
export const IDEM_TTL = 604_800;

/** Remove `undefined` (assertJsonSafe rejeita) mantendo determinismo do hash. */
export function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** CHECK-valid idempotency key: `scheduling:<action>:<hex>`. */
export function idemKey(action: string, clientKey: string): string {
  const hex = clientKey.replace(/-/g, '').toLowerCase();
  if (!/^[a-f0-9]{8,}$/.test(hex)) {
    throw new SchedulingValidationError('idempotencyKey deve ser um UUID');
  }
  return `scheduling:${action}:${hex}`;
}

export async function requestContext(): Promise<RequestContext> {
  return buildRequestContext(await headers());
}

/** Map UNIQUE (23505) / EXCLUDE (23P01) violations to a clean conflict error. */
export function asConflict(err: unknown): never {
  if (isUniqueViolation(err) || isExclusionViolation(err)) {
    throw new SchedulingConflictError('horário ocupado para este médico');
  }
  throw err;
}
