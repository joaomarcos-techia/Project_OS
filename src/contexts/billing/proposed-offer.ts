/** Hipótese comercial do PDF de outubro/2026. Não participa do catálogo nem do checkout ativo. */
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
