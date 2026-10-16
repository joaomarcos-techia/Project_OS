/** Hipótese comercial de outubro/2026. Não participa do catálogo nem do checkout ativo. */
export const PROPOSED_OFFER = {
  consultorioMonthly: 197,
  clinicaMonthlyForTwo: 397,
  additionalProfessionalMonthly: 147,
  additionalStaffMonthly: 79,
  consultorioIncludedStaffLogins: 1,
  clinicaIncludedStaffLogins: 2,
  maxSelfServiceStaffLogins: 10,
  annualMonthsCharged: 10,
  maxSelfServiceProfessionals: 10,
  conversationsPerProfessional: 500,
  proposedTrialDays: 14,
} as const;

export interface ProposedQuote {
  plan: 'consultorio' | 'clinica';
  professionals: number;
  staffLogins: number;
  includedStaffLogins: number;
  additionalStaffLogins: number;
  monthly: number;
  annual: number;
  conversationsIncluded: number;
}

export function quoteProposedOffer(professionals: number, staffLogins = 0): ProposedQuote | null {
  if (
    !Number.isInteger(professionals) ||
    professionals < 1 ||
    professionals > PROPOSED_OFFER.maxSelfServiceProfessionals ||
    !Number.isInteger(staffLogins) ||
    staffLogins < 0 ||
    staffLogins > PROPOSED_OFFER.maxSelfServiceStaffLogins
  )
    return null;
  const plan = professionals === 1 ? 'consultorio' : 'clinica';
  const includedStaffLogins =
    plan === 'consultorio'
      ? PROPOSED_OFFER.consultorioIncludedStaffLogins
      : PROPOSED_OFFER.clinicaIncludedStaffLogins;
  const additionalStaffLogins = Math.max(0, staffLogins - includedStaffLogins);
  const professionalMonthly =
    plan === 'consultorio'
      ? PROPOSED_OFFER.consultorioMonthly
      : PROPOSED_OFFER.clinicaMonthlyForTwo +
        (professionals - 2) * PROPOSED_OFFER.additionalProfessionalMonthly;
  const monthly =
    professionalMonthly + additionalStaffLogins * PROPOSED_OFFER.additionalStaffMonthly;
  return {
    plan,
    professionals,
    staffLogins,
    includedStaffLogins,
    additionalStaffLogins,
    monthly,
    annual: monthly * PROPOSED_OFFER.annualMonthsCharged,
    conversationsIncluded: professionals * PROPOSED_OFFER.conversationsPerProfessional,
  };
}
