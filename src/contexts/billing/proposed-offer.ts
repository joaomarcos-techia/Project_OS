/** Hipótese comercial de outubro/2026. Não participa do catálogo nem do checkout ativo. */
export const PROPOSED_OFFER = {
  consultorioMonthly: 197,
  clinicaMonthlyForTwo: 397,
  additionalProfessionalMonthly: 147,
  annualMonthsCharged: 10,
  maxSelfServiceProfessionals: 10,
  conversationsPerProfessional: 500,
  proposedTrialDays: 14,
} as const;

export interface ProposedQuote {
  plan: 'consultorio' | 'clinica';
  professionals: number;
  monthly: number;
  annual: number;
  conversationsIncluded: number;
}

export function quoteProposedOffer(professionals: number): ProposedQuote | null {
  if (
    !Number.isInteger(professionals) ||
    professionals < 1 ||
    professionals > PROPOSED_OFFER.maxSelfServiceProfessionals
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
    monthly,
    annual: monthly * PROPOSED_OFFER.annualMonthsCharged,
    conversationsIncluded: professionals * PROPOSED_OFFER.conversationsPerProfessional,
  };
}
