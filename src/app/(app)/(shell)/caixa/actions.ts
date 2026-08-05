'use server';

/**
 * Server Actions de ORQUESTRAÇÃO do Caixa (C9). Delegam para os contratos do
 * contexto financial (auth/idempotência/audit/outbox lá dentro) e devolvem
 * `ActionResult` (sem redirect) — a tela atualiza in-place via router.refresh().
 */
import { cancelLancamento, confirmPayment, createEstorno } from '@/contexts/financial/actions';
import type {
  CancelLancamentoInput,
  ConfirmPaymentInput,
  CreateEstornoInput,
  LancamentoSummary,
} from '@/contexts/financial/types';

import { fail, ok, type ActionResult } from './caixa-types';

export async function confirmPaymentAction(
  input: ConfirmPaymentInput,
  idempotencyKey: string,
): Promise<ActionResult<LancamentoSummary>> {
  try {
    return ok(await confirmPayment(input, idempotencyKey));
  } catch (err) {
    return fail(err);
  }
}

export async function cancelLancamentoAction(
  input: CancelLancamentoInput,
  idempotencyKey: string,
): Promise<ActionResult<LancamentoSummary>> {
  try {
    return ok(await cancelLancamento(input, idempotencyKey));
  } catch (err) {
    return fail(err);
  }
}

export async function createEstornoAction(
  input: CreateEstornoInput,
  idempotencyKey: string,
): Promise<ActionResult<{ originalId: string; estornoId: string }>> {
  try {
    const r = await createEstorno(input, idempotencyKey);
    return ok({ originalId: r.original.id, estornoId: r.refund.id });
  } catch (err) {
    return fail(err);
  }
}
