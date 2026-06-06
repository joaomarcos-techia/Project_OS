/**
 * Helpers das Server Actions do contexto financial. Fora dos arquivos
 * `'use server'` (que só podem exportar funções async). Espelha
 * clinical/internal/action-helpers.ts.
 */
import { headers } from 'next/headers';

import { buildRequestContext } from '@/lib/audit/request-context';
import type { RequestContext } from '@/lib/audit/types';

import { FinancialValidationError } from '../errors';

/** 7 dias — janela de dedup das mutações financeiras (retry tardio de cliente offline). */
export const IDEM_TTL = 604_800;

/** Remove `undefined` (assertJsonSafe rejeita) mantendo determinismo do hash. */
export function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** CHECK-valid idempotency key: `financial:<action>:<hex>`. */
export function idemKey(action: string, clientKey: string): string {
  const hex = clientKey.replace(/-/g, '').toLowerCase();
  if (!/^[a-f0-9]{8,}$/.test(hex)) {
    throw new FinancialValidationError('idempotencyKey deve ser um UUID');
  }
  return `financial:${action}:${hex}`;
}

export async function requestContext(): Promise<RequestContext> {
  return buildRequestContext(await headers());
}
