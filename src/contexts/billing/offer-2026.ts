/**
 * Oferta de outubro/2026 — cobrança por profissional de saúde (ADR-067).
 *
 * Consultório: 1 profissional e até 3 usuários de equipe. Clínica: 2 a 10
 * profissionais, com 2 incluídos no preço base e equipe administrativa
 * ilimitada. Só mensal; o teste continua sendo o do cadastro autônomo.
 *
 * Cada quantidade de profissionais é um plano próprio (`clinica_2026_<n>`), com
 * uma linha de preço comum. É de propósito: a assinatura fixa `price_id`, então
 * o valor recorrente, o rateio, a reativação e a sincronização com o Asaas
 * continuam lendo um único valor por plano. Incluir ou remover profissional é
 * uma troca de plano, com o rateio e a releitura do Asaas que ela já tem.
 *
 * Este módulo é a fonte da regra comercial; a migration 0119 grava o catálogo
 * com a mesma fórmula e um teste compara os dois.
 */

export const OFFER_2026 = {
  consultorioMonthly: 197,
  clinicaMonthly: 397,
  clinicaIncludedProfessionals: 2,
  additionalProfessionalMonthly: 147,
  maxProfessionals: 10,
  consultorioStaffUsers: 3,
} as const;

export const OFFER_2026_PLAN_CODES = [
  'consultorio_2026',
  'clinica_2026_2',
  'clinica_2026_3',
  'clinica_2026_4',
  'clinica_2026_5',
  'clinica_2026_6',
  'clinica_2026_7',
  'clinica_2026_8',
  'clinica_2026_9',
  'clinica_2026_10',
] as const;

export type Offer2026PlanCode = (typeof OFFER_2026_PLAN_CODES)[number];

export function isOffer2026PlanCode(code: string | null | undefined): code is Offer2026PlanCode {
  return OFFER_2026_PLAN_CODES.some((candidate) => candidate === code);
}

function isProfessionalCount(professionals: number): boolean {
  return (
    Number.isInteger(professionals) &&
    professionals >= 1 &&
    professionals <= OFFER_2026.maxProfessionals
  );
}

/** Plano que vende exatamente esta quantidade de profissionais. */
export function offer2026PlanCodeFor(professionals: number): Offer2026PlanCode | null {
  if (!isProfessionalCount(professionals)) return null;
  return OFFER_2026_PLAN_CODES[professionals - 1] ?? null;
}

/** Profissionais contratados num plano da oferta; `null` fora dela. */
export function offer2026Professionals(code: string | null | undefined): number | null {
  if (!isOffer2026PlanCode(code)) return null;
  return OFFER_2026_PLAN_CODES.indexOf(code) + 1;
}

/** Mensalidade em centavos: R$ 197, ou R$ 397 + R$ 147 × (profissionais − 2). */
export function offer2026MonthlyCents(professionals: number): number | null {
  if (!isProfessionalCount(professionals)) return null;
  const reais =
    professionals === 1
      ? OFFER_2026.consultorioMonthly
      : OFFER_2026.clinicaMonthly +
        (professionals - OFFER_2026.clinicaIncludedProfessionals) *
          OFFER_2026.additionalProfessionalMonthly;
  return reais * 100;
}

/** Teto de equipe administrativa; `null` = ilimitada (Clínica). */
export function offer2026StaffLimit(professionals: number): number | null {
  if (!isProfessionalCount(professionals)) return null;
  return professionals === 1 ? OFFER_2026.consultorioStaffUsers : null;
}

/**
 * Tabela a que o plano pertence. A troca de plano só acontece dentro da mesma
 * tabela: levar um cliente atual para a oferta nova é decisão comercial ainda
 * aberta, e um botão não pode tomá-la sozinho.
 */
export type PlanCatalog = 'legacy' | 'offer_2026';

export function planCatalogOf(code: string): PlanCatalog {
  return isOffer2026PlanCode(code) ? 'offer_2026' : 'legacy';
}

/** Ajuste por pessoa, repasse e preço por meio de pagamento: Clínica (e Pro antigo). */
export function planHasTeamFeatures(code: string | null | undefined): boolean {
  if (code === 'clinica' || code === 'pro') return true;
  const professionals = offer2026Professionals(code);
  return professionals !== null && professionals >= OFFER_2026.clinicaIncludedProfessionals;
}
