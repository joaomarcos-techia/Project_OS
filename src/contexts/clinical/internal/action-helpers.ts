/**
 * Shared helpers das Server Actions do contexto clinical. Fora dos arquivos
 * `'use server'` (que só podem exportar funções async).
 */
import { headers } from 'next/headers';

import { buildRequestContext } from '@/lib/audit/request-context';
import type { RequestContext } from '@/lib/audit/types';
import { isUniqueViolation } from '@/lib/outbox/errors';

import { ClinicalValidationError, ProntuarioConflitoError } from '../errors';

/** 7 dias — janela de dedup das mutations clínicas (retry tardio de cliente offline). */
export const IDEM_TTL = 604_800;

/** Remove `undefined` (assertJsonSafe rejeita) mantendo determinismo do hash. */
export function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** CHECK-valid idempotency key: `clinical:<action>:<hex>`. */
export function idemKey(action: string, clientKey: string): string {
  const hex = clientKey.replace(/-/g, '').toLowerCase();
  if (!/^[a-f0-9]{8,}$/.test(hex)) {
    throw new ClinicalValidationError('idempotencyKey deve ser um UUID');
  }
  return `clinical:${action}:${hex}`;
}

export async function requestContext(): Promise<RequestContext> {
  return buildRequestContext(await headers());
}

/** Map UNIQUE (23505) para conflito limpo (ex.: corrida de prontuário por appointment). */
export function asConflict(err: unknown): never {
  if (isUniqueViolation(err)) {
    throw new ProntuarioConflitoError('Conflito ao gravar prontuário (já existe registro para esta consulta).');
  }
  throw err;
}
