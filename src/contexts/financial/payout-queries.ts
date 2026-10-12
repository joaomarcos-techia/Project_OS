import 'server-only';

import { and, desc, eq, isNull } from 'drizzle-orm';

// eslint-disable-next-line boundaries/element-types -- billingApiV1 é a API versionada de entitlement; o contexto não lê o schema de billing.
import { billingApiV1 } from '@/contexts/billing/api';
import { withTenant } from '@/lib/db/tenant';

import { clinicFinancialPolicies, professionalPayoutRules, professionalPayouts } from './schema';
import type {
  ProfessionalPayoutDTO,
  ProfessionalPayoutPolicyDTO,
  ProfessionalPayoutRuleDTO,
} from './payout-types';

const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : value);

export async function getProfessionalPayoutPolicy(
  clinicId: string,
): Promise<ProfessionalPayoutPolicyDTO> {
  if (!(await billingApiV1.hasAdvancedFinancialPolicies(clinicId))) {
    return { basis: 'gross', updatedAt: null };
  }
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select()
      .from(clinicFinancialPolicies)
      .where(eq(clinicFinancialPolicies.clinicId, clinicId))
      .limit(1);
    return row
      ? { basis: row.professionalPayoutBasis, updatedAt: iso(row.updatedAt) }
      : { basis: 'gross', updatedAt: null };
  });
}

export async function listActiveProfessionalPayoutRules(
  clinicId: string,
): Promise<ProfessionalPayoutRuleDTO[]> {
  if (!(await billingApiV1.hasAdvancedFinancialPolicies(clinicId))) return [];
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(professionalPayoutRules)
      .where(
        and(
          eq(professionalPayoutRules.clinicId, clinicId),
          isNull(professionalPayoutRules.effectiveTo),
        ),
      )
      .orderBy(desc(professionalPayoutRules.effectiveFrom));
    return rows.map((row) => ({
      id: row.id,
      professionalId: row.professionalId,
      procedureId: row.procedureId,
      kind: row.kind,
      percentage: row.percentage === null ? null : Number(row.percentage),
      fixedAmount: row.fixedAmount === null ? null : Number(row.fixedAmount),
      effectiveFrom: iso(row.effectiveFrom),
      updatedAt: iso(row.updatedAt),
    }));
  });
}

export async function getProfessionalPayoutByAppointment(
  clinicId: string,
  appointmentId: string,
): Promise<ProfessionalPayoutDTO | null> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select()
      .from(professionalPayouts)
      .where(
        and(
          eq(professionalPayouts.clinicId, clinicId),
          eq(professionalPayouts.appointmentId, appointmentId),
        ),
      )
      .limit(1);
    if (!row) return null;
    const numberOrNull = (value: string | null): number | null =>
      value === null ? null : Number(value);
    return {
      id: row.id,
      appointmentId: row.appointmentId,
      professionalId: row.professionalId,
      procedureId: row.procedureId,
      calculationBasis: row.calculationBasis,
      grossAmount: Number(row.grossAmount),
      providerFeeAmount: numberOrNull(row.providerFeeAmount),
      earlySettlementFeeAmount: numberOrNull(row.earlySettlementFeeAmount),
      netAmount: numberOrNull(row.netAmount),
      basisAmount: numberOrNull(row.basisAmount),
      payoutAmount: numberOrNull(row.payoutAmount),
      status: row.status,
    };
  });
}
