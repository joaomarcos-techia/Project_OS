import type { ClinicPricingPolicyMode, ProcedurePaymentMethod } from './schema';

export interface ProcedurePaymentPrice {
  method: ProcedurePaymentMethod;
  installmentCount: number | null;
  grossAmount: number;
}

export type ResolvedProcedurePrice =
  | { available: true; grossAmount: number; source: 'standard' | 'explicit_method_price' }
  | { available: false; reason: 'method_price_not_configured' };

/**
 * Resolve preço COMERCIAL. Não conhece tarifa do Asaas e não calcula líquido.
 * Em modo explícito, método sem preço não é oferecido/cobrado por fallback
 * silencioso.
 */
export function resolveProcedurePaymentPrice(input: {
  mode: ClinicPricingPolicyMode;
  standardGrossAmount: number;
  method: ProcedurePaymentMethod;
  installmentCount?: number | null;
  prices: readonly ProcedurePaymentPrice[];
}): ResolvedProcedurePrice {
  if (input.mode === 'absorb_fees') {
    return { available: true, grossAmount: input.standardGrossAmount, source: 'standard' };
  }

  const installments = input.method === 'credit_card' ? (input.installmentCount ?? 1) : null;
  const price = input.prices.find(
    (item) => item.method === input.method && item.installmentCount === installments,
  );
  if (!price) return { available: false, reason: 'method_price_not_configured' };
  return { available: true, grossAmount: price.grossAmount, source: 'explicit_method_price' };
}
