import 'server-only';

import { and, asc, eq, lte, sql } from 'drizzle-orm';

// eslint-disable-next-line boundaries/element-types -- billingApiV1 é a API versionada de entitlement; o contexto não lê o schema de billing.
import { billingApiV1 } from '@/contexts/billing/api';
import { withTenant } from '@/lib/db/tenant';
import type { Tx } from '@/lib/db';

import { clinicPaymentPricingPolicies, procedurePaymentPrices } from './schema';
import type { PaymentPricingPolicyDTO, ProcedurePaymentPriceDTO } from './pricing-types';

const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : value);

export async function getPaymentPricingPolicy(clinicId: string): Promise<PaymentPricingPolicyDTO> {
  if (!(await billingApiV1.hasAdvancedFinancialPolicies(clinicId))) {
    return { mode: 'absorb_fees', updatedAt: null };
  }
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select()
      .from(clinicPaymentPricingPolicies)
      .where(eq(clinicPaymentPricingPolicies.clinicId, clinicId))
      .limit(1);
    return row
      ? { mode: row.mode, updatedAt: iso(row.updatedAt) }
      : { mode: 'absorb_fees', updatedAt: null };
  });
}

export async function listProcedurePaymentPrices(
  clinicId: string,
): Promise<ProcedurePaymentPriceDTO[]> {
  if (!(await billingApiV1.hasAdvancedFinancialPolicies(clinicId))) return [];
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(procedurePaymentPrices)
      .where(
        and(
          eq(procedurePaymentPrices.clinicId, clinicId),
          eq(procedurePaymentPrices.active, true),
          lte(procedurePaymentPrices.effectiveFrom, sql`now()`),
        ),
      )
      .orderBy(
        asc(procedurePaymentPrices.procedureId),
        asc(procedurePaymentPrices.paymentMethod),
        asc(procedurePaymentPrices.installmentCount),
      );
    return rows.map((row) => ({
      id: row.id,
      procedureId: row.procedureId,
      paymentMethod: row.paymentMethod,
      installmentCount: row.installmentCount,
      grossAmount: Number(row.grossAmount),
      updatedAt: iso(row.updatedAt),
    }));
  });
}

export interface ConfiguredProcedurePriceResolution {
  mode: 'absorb_fees' | 'payment_method_pricing';
  grossAmount: number;
  paymentMethod: 'pix' | 'cash' | 'credit_card' | null;
  installmentCount: number | null;
  priceId: string | null;
  source: 'standard' | 'explicit_method_price';
}

/** Política comercial efetiva dentro da transação do atendimento. */
export async function getEffectivePaymentPricingMode(
  tx: Tx,
  clinicId: string,
): Promise<'absorb_fees' | 'payment_method_pricing'> {
  if (!(await billingApiV1.hasAdvancedFinancialPolicies(clinicId, tx))) return 'absorb_fees';
  const [policy] = await tx
    .select({ mode: clinicPaymentPricingPolicies.mode })
    .from(clinicPaymentPricingPolicies)
    .where(eq(clinicPaymentPricingPolicies.clinicId, clinicId))
    .limit(1);
  return policy?.mode ?? 'absorb_fees';
}

/** Confere novamente a versão comercial dentro da transação que cria o atendimento. */
export async function matchesConfiguredProcedurePriceSnapshot(
  tx: Tx,
  input: {
    clinicId: string;
    procedureId: string;
    priceId: string;
    paymentMethod: 'pix' | 'cash' | 'credit_card';
    installmentCount: number | null;
    grossAmount: number;
  },
): Promise<boolean> {
  const [policy] = await tx
    .select({ mode: clinicPaymentPricingPolicies.mode })
    .from(clinicPaymentPricingPolicies)
    .where(eq(clinicPaymentPricingPolicies.clinicId, input.clinicId))
    .limit(1);
  if (policy?.mode !== 'payment_method_pricing') return false;

  const [price] = await tx
    .select({
      paymentMethod: procedurePaymentPrices.paymentMethod,
      installmentCount: procedurePaymentPrices.installmentCount,
      grossAmount: procedurePaymentPrices.grossAmount,
    })
    .from(procedurePaymentPrices)
    .where(
      and(
        eq(procedurePaymentPrices.id, input.priceId),
        eq(procedurePaymentPrices.clinicId, input.clinicId),
        eq(procedurePaymentPrices.procedureId, input.procedureId),
        eq(procedurePaymentPrices.active, true),
        lte(procedurePaymentPrices.effectiveFrom, sql`now()`),
      ),
    )
    .limit(1);

  return (
    price?.paymentMethod === input.paymentMethod &&
    price.installmentCount === input.installmentCount &&
    Number(price.grossAmount) === input.grossAmount
  );
}

/**
 * Resolve no servidor a condição comercial escolhida. O browser envia apenas
 * método/parcelas; o valor e o ID da versão sempre vêm do tenant autenticado.
 */
export async function resolveConfiguredProcedurePaymentPrice(input: {
  clinicId: string;
  procedureId: string;
  standardGrossAmount: number;
  paymentMethod?: 'pix' | 'cash' | 'credit_card' | null;
  installmentCount?: number | null;
}): Promise<ConfiguredProcedurePriceResolution | null> {
  const policy = await getPaymentPricingPolicy(input.clinicId);
  if (policy.mode === 'absorb_fees') {
    return {
      mode: policy.mode,
      grossAmount: input.standardGrossAmount,
      paymentMethod: null,
      installmentCount: null,
      priceId: null,
      source: 'standard',
    };
  }
  const paymentMethod = input.paymentMethod;
  if (!paymentMethod) return null;
  const installments = paymentMethod === 'credit_card' ? (input.installmentCount ?? 1) : null;
  const rows = await withTenant(input.clinicId, (tx) =>
    tx
      .select()
      .from(procedurePaymentPrices)
      .where(
        and(
          eq(procedurePaymentPrices.clinicId, input.clinicId),
          eq(procedurePaymentPrices.procedureId, input.procedureId),
          eq(procedurePaymentPrices.paymentMethod, paymentMethod),
          eq(procedurePaymentPrices.active, true),
          lte(procedurePaymentPrices.effectiveFrom, sql`now()`),
        ),
      ),
  );
  const row = rows.find((price) => price.installmentCount === installments);
  if (!row) return null;
  return {
    mode: policy.mode,
    grossAmount: Number(row.grossAmount),
    paymentMethod: row.paymentMethod,
    installmentCount: row.installmentCount,
    priceId: row.id,
    source: 'explicit_method_price',
  };
}
