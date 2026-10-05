/** Regras puras e determinísticas de repasse profissional. */

import type { ProfessionalPayoutBasis, ProfessionalPayoutRuleKind } from './schema';

const MONEY_SCALE = 100;
const PERCENT_SCALE = 10_000;

function assertMoney(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 99_999_999.99) {
    throw new RangeError(`${field} inválido`);
  }
}

export function moneyToCents(value: number): number {
  assertMoney(value, 'valor monetário');
  return Math.round(value * MONEY_SCALE);
}

export function centsToMoney(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('centavos inválidos');
  return value / MONEY_SCALE;
}

export type ProfessionalPayoutRule =
  | { kind: 'percentage'; percentage: number; fixedAmount?: never }
  | { kind: 'fixed'; percentage?: never; fixedAmount: number };

export interface CalculateProfessionalPayoutInput {
  grossAmount: number;
  netAmount: number | null;
  payoutBasis: ProfessionalPayoutBasis;
  rule: ProfessionalPayoutRule;
}

export type ProfessionalPayoutCalculation =
  | {
      status: 'pending_economics';
      basis: 'net';
      basisAmount: null;
      payoutAmount: null;
    }
  | {
      status: 'calculated';
      basis: ProfessionalPayoutBasis;
      basisAmount: number;
      payoutAmount: number;
    };

/**
 * O cálculo nunca consulta configuração nem método de pagamento. Recebe o
 * snapshot já resolvido e opera em centavos; mudar a política atual não altera
 * registros históricos.
 */
export function calculateProfessionalPayout(
  input: CalculateProfessionalPayoutInput,
): ProfessionalPayoutCalculation {
  const grossCents = moneyToCents(input.grossAmount);
  if (input.payoutBasis === 'net' && input.netAmount === null) {
    return {
      status: 'pending_economics',
      basis: 'net',
      basisAmount: null,
      payoutAmount: null,
    };
  }

  const basisCents =
    input.payoutBasis === 'gross' ? grossCents : moneyToCents(input.netAmount as number);

  let payoutCents: number;
  if (input.rule.kind === 'fixed') {
    payoutCents = moneyToCents(input.rule.fixedAmount);
  } else {
    if (
      !Number.isFinite(input.rule.percentage) ||
      input.rule.percentage <= 0 ||
      input.rule.percentage > 100
    ) {
      throw new RangeError('percentual de repasse inválido');
    }
    const percentageUnits = Math.round(input.rule.percentage * PERCENT_SCALE);
    payoutCents = Math.round((basisCents * percentageUnits) / (100 * PERCENT_SCALE));
  }

  return {
    status: 'calculated',
    basis: input.payoutBasis,
    basisAmount: centsToMoney(basisCents),
    payoutAmount: centsToMoney(payoutCents),
  };
}

export function payoutRuleSnapshot(rule: ProfessionalPayoutRule): {
  ruleKind: ProfessionalPayoutRuleKind;
  rulePercentage: string | null;
  ruleFixedAmount: string | null;
} {
  return rule.kind === 'percentage'
    ? {
        ruleKind: 'percentage',
        rulePercentage: rule.percentage.toFixed(4),
        ruleFixedAmount: null,
      }
    : {
        ruleKind: 'fixed',
        rulePercentage: null,
        ruleFixedAmount: rule.fixedAmount.toFixed(2),
      };
}
