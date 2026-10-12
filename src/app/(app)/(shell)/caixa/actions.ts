'use server';

/**
 * Server Actions de ORQUESTRAÇÃO do Caixa (C9). Delegam para os contratos do
 * contexto financial (auth/idempotência/audit/outbox lá dentro) e devolvem
 * `ActionResult` (sem redirect) — a tela atualiza in-place via router.refresh().
 */
import { cancelLancamento, confirmPayment, createEstorno } from '@/contexts/financial/actions';
import { reviewProfessionalPayout } from '@/contexts/financial/payout-actions';
import type {
  ProfessionalPayoutReviewDTO,
  ReviewProfessionalPayoutInput,
} from '@/contexts/financial/payout-types';
import type {
  CancelLancamentoInput,
  ConfirmPaymentInput,
  CreateEstornoInput,
  LancamentoSummary,
} from '@/contexts/financial/types';
import { logger } from '@/lib/observability/logger';

import { actionErrorLogFields, fail, ok, type ActionResult } from './caixa-types';

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

export async function reviewProfessionalPayoutAction(
  input: ReviewProfessionalPayoutInput,
  idempotencyKey: string,
): Promise<ActionResult<ProfessionalPayoutReviewDTO>> {
  try {
    return ok(await reviewProfessionalPayout(input, idempotencyKey));
  } catch (err) {
    logger.error('financial.caixa.payout_review_failed', actionErrorLogFields(err));
    return fail(err);
  }
}

export async function createEstornoAction(
  input: CreateEstornoInput,
  idempotencyKey: string,
): Promise<ActionResult<{ originalId: string; estornoId: string }>> {
  try {
    const r = await createEstorno(input, idempotencyKey);
    return ok({ originalId: r.original.id, estornoId: r.estorno.id });
  } catch (err) {
    logger.error('financial.caixa.refund_failed', actionErrorLogFields(err));
    return fail(err);
  }
}
