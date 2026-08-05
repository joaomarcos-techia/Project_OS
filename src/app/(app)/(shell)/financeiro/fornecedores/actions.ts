'use server';

import { createSupplier, setSupplierAtivo, updateSupplier } from '@/contexts/financial/actions';
import type { CreateSupplierInput, SupplierSummary } from '@/contexts/financial/types';

import { fail, ok, type ActionResult } from '../action-result';

export async function createSupplierAction(
  input: CreateSupplierInput,
  idempotencyKey: string,
): Promise<ActionResult<SupplierSummary>> {
  try {
    return ok(await createSupplier(input, idempotencyKey));
  } catch (err) {
    return fail(err);
  }
}

export async function updateSupplierAction(
  id: string,
  input: CreateSupplierInput,
  idempotencyKey: string,
): Promise<ActionResult<SupplierSummary>> {
  try {
    return ok(await updateSupplier(id, input, idempotencyKey));
  } catch (err) {
    return fail(err);
  }
}

export async function setSupplierAtivoAction(
  id: string,
  ativo: boolean,
  idempotencyKey: string,
): Promise<ActionResult<SupplierSummary>> {
  try {
    return ok(await setSupplierAtivo(id, ativo, idempotencyKey));
  } catch (err) {
    return fail(err);
  }
}
