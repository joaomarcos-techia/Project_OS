/** Valores da oferta de outubro/2026. Os planos legados conservam seus price_id. */
export const PROPOSED_OFFER = {
  consultorioMonthly: 197,
  clinicaMonthlyForTwo: 397,
  additionalProfessionalMonthly: 147,
  consultorioIncludedStaffLogins: 3,
  clinicaIncludedStaffLogins: 3,
  annualMonthsCharged: 10,
  maxSelfServiceProfessionals: 5,
  conversationsPerProfessional: 500,
  proposedTrialDays: 14,
} as const;

/** Códigos versionados impedem que a tabela nova reprecifique contratos antigos. */
export const OFFER_2026_PLAN_CODES = [
  'consultorio_2026',
  'clinica_2026_2',
  'clinica_2026_3',
  'clinica_2026_4',
  'clinica_2026_5',
] as const;

/** Aquisição Asaas publicada: conservada. A candidata AbacatePay usa o catálogo completo acima. */
export const OFFER_2026_ENTRY_PLAN_CODES = ['consultorio_2026', 'clinica_2026_2'] as const;

export type Offer2026PlanCode = (typeof OFFER_2026_PLAN_CODES)[number];

export function isOffer2026PlanCode(code: string): code is Offer2026PlanCode {
  return OFFER_2026_PLAN_CODES.some((candidate) => candidate === code);
}

export function offer2026PlanCodeForDoctors(doctors: number): Offer2026PlanCode | null {
  if (!Number.isInteger(doctors) || doctors < 1 || doctors > 5) return null;
  return OFFER_2026_PLAN_CODES[doctors - 1] ?? null;
}

export interface ProposedQuote {
  plan: 'consultorio' | 'clinica';
  professionals: number;
  staffLogins: number;
  monthly: number;
  annual: number;
  conversationsIncluded: number;
}

export function quoteProposedOffer(professionals: number, staffLogins = 0): ProposedQuote | null {
  if (
    !Number.isInteger(professionals) ||
    professionals < 1 ||
    professionals > PROPOSED_OFFER.maxSelfServiceProfessionals ||
    !Number.isSafeInteger(staffLogins) ||
    staffLogins < 0 ||
    (professionals === 1 && staffLogins > PROPOSED_OFFER.consultorioIncludedStaffLogins) ||
    (professionals > 1 && staffLogins > PROPOSED_OFFER.clinicaIncludedStaffLogins)
  )
    return null;

  const plan = professionals === 1 ? 'consultorio' : 'clinica';
  const monthly =
    plan === 'consultorio'
      ? PROPOSED_OFFER.consultorioMonthly
      : PROPOSED_OFFER.clinicaMonthlyForTwo +
        (professionals - 2) * PROPOSED_OFFER.additionalProfessionalMonthly;
  return {
    plan,
    professionals,
    staffLogins,
    monthly,
    annual: monthly * PROPOSED_OFFER.annualMonthsCharged,
    conversationsIncluded: professionals * PROPOSED_OFFER.conversationsPerProfessional,
  };
}
