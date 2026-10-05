'use server';

/**
 * Server Actions de ORQUESTRAÇÃO da tela /configuracoes/pagamentos. Delegam para
 * o contexto `payments` (auth, validação no Asaas, cripto, persistência e audit
 * acontecem lá) e devolvem `ActionResult` — a tela atualiza via router.refresh().
 *
 * A chave da clínica entra por aqui uma única vez, vinda do formulário, e não
 * retorna: o DTO de resposta carrega apenas o indicador `hasApiKey`.
 */
import {
  connectPaymentAccount,
  disconnectPaymentAccount,
  saveDepositPolicy,
} from '@/contexts/payments/actions';
import type {
  ConnectPaymentAccountResult,
  DepositPolicyDTO,
  PaymentAccountStatusDTO,
  SaveDepositPolicyInput,
} from '@/contexts/payments';
import {
  removeProcedurePaymentPrice,
  savePaymentPricingPolicy,
  saveProcedurePaymentPrice,
} from '@/contexts/payments/pricing-actions';
import type {
  PaymentPricingPolicyDTO,
  ProcedurePaymentPriceDTO,
  SavePaymentPricingPolicyInput,
  SaveProcedurePaymentPriceInput,
} from '@/contexts/payments';
import {
  removeProfessionalPayoutRule,
  saveProfessionalPayoutPolicy,
  saveProfessionalPayoutRule,
} from '@/contexts/financial/payout-actions';
import type {
  ProfessionalPayoutPolicyDTO,
  ProfessionalPayoutRuleDTO,
  SaveProfessionalPayoutPolicyInput,
  SaveProfessionalPayoutRuleInput,
} from '@/contexts/financial';

import { fail, ok, type ActionResult } from './pagamentos-types';

export async function connectPaymentAccountAction(
  apiKey: string,
): Promise<ActionResult<ConnectPaymentAccountResult>> {
  try {
    return ok(await connectPaymentAccount({ apiKey }));
  } catch (err) {
    return fail(err);
  }
}

export async function disconnectPaymentAccountAction(): Promise<
  ActionResult<PaymentAccountStatusDTO>
> {
  try {
    return ok(await disconnectPaymentAccount());
  } catch (err) {
    return fail(err);
  }
}

export async function saveDepositPolicyAction(
  input: SaveDepositPolicyInput,
): Promise<ActionResult<DepositPolicyDTO>> {
  try {
    return ok(await saveDepositPolicy(input));
  } catch (err) {
    return fail(err);
  }
}

export async function saveProfessionalPayoutPolicyAction(
  input: SaveProfessionalPayoutPolicyInput,
  idempotencyKey: string,
): Promise<ActionResult<ProfessionalPayoutPolicyDTO>> {
  try {
    return ok(await saveProfessionalPayoutPolicy(input, idempotencyKey));
  } catch (err) {
    return fail(err);
  }
}

export async function saveProfessionalPayoutRuleAction(
  input: SaveProfessionalPayoutRuleInput,
  idempotencyKey: string,
): Promise<ActionResult<ProfessionalPayoutRuleDTO>> {
  try {
    return ok(await saveProfessionalPayoutRule(input, idempotencyKey));
  } catch (err) {
    return fail(err);
  }
}

export async function removeProfessionalPayoutRuleAction(
  ruleId: string,
  idempotencyKey: string,
): Promise<ActionResult<{ removed: boolean }>> {
  try {
    return ok(await removeProfessionalPayoutRule({ ruleId }, idempotencyKey));
  } catch (err) {
    return fail(err);
  }
}

export async function savePaymentPricingPolicyAction(
  input: SavePaymentPricingPolicyInput,
  idempotencyKey: string,
): Promise<ActionResult<PaymentPricingPolicyDTO>> {
  try {
    return ok(await savePaymentPricingPolicy(input, idempotencyKey));
  } catch (err) {
    return fail(err);
  }
}

export async function saveProcedurePaymentPriceAction(
  input: SaveProcedurePaymentPriceInput,
  idempotencyKey: string,
): Promise<ActionResult<ProcedurePaymentPriceDTO>> {
  try {
    return ok(await saveProcedurePaymentPrice(input, idempotencyKey));
  } catch (err) {
    return fail(err);
  }
}

export async function removeProcedurePaymentPriceAction(
  priceId: string,
  idempotencyKey: string,
): Promise<ActionResult<{ removed: boolean }>> {
  try {
    return ok(await removeProcedurePaymentPrice({ priceId }, idempotencyKey));
  } catch (err) {
    return fail(err);
  }
}
