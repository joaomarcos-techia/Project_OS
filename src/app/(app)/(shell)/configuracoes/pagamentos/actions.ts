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
  DepositPolicyDTO,
  PaymentAccountStatusDTO,
  SaveDepositPolicyInput,
} from '@/contexts/payments';

import { fail, ok, type ActionResult } from './pagamentos-types';

export async function connectPaymentAccountAction(
  apiKey: string,
): Promise<ActionResult<PaymentAccountStatusDTO>> {
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
