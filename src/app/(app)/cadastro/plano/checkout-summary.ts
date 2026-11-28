/**
 * Resumo do checkout do cadastro (etapa 3), no desenho aprovado no Claude Design: família do plano
 * (Consultório ou Clínica), quantidade de médicos e linhas que compõem o total.
 *
 * Tudo sai da lista de planos que o servidor devolve. O total é sempre o `priceCents` do plano
 * escolhido; as linhas só explicam esse valor e nunca inventam preço. Se o servidor oferecer só os
 * planos de entrada, o seletor de médicos fica limitado ao que existe.
 */
import {
  isOffer2026PlanCode,
  OFFER_2026_PLAN_CODES,
  PROPOSED_OFFER,
} from '@/contexts/billing/proposed-offer';
import type { SignupPlan } from '@/contexts/onboarding';

export type PlanFamily = 'consultorio' | 'clinica';
export type BillingCycle = 'monthly' | 'annual';

export interface OfferCatalog {
  consultorio: SignupPlan | null;
  /** Planos Clínica do ciclo, em ordem crescente de médicos. */
  clinica: { doctors: number; plan: SignupPlan }[];
}

export interface SummaryLine {
  label: string;
  value: string;
}

export function doctorsOf(plan: SignupPlan): number | null {
  return isOffer2026PlanCode(plan.code) ? OFFER_2026_PLAN_CODES.indexOf(plan.code) + 1 : null;
}

export function familyOf(plan: SignupPlan): PlanFamily | null {
  const doctors = doctorsOf(plan);
  if (doctors === null) return null;
  return doctors === 1 ? 'consultorio' : 'clinica';
}

/**
 * Catálogo da oferta 2026 no ciclo, ou `null` quando há plano fora da oferta (legado): nesse caso
 * a tela mantém a lista de planos, porque o resumo por família não descreveria o legado.
 */
export function offerCatalog(plans: SignupPlan[], cycle: BillingCycle): OfferCatalog | null {
  const doCiclo = plans.filter((plan) => plan.cycle === cycle);
  if (doCiclo.length === 0 || doCiclo.some((plan) => !isOffer2026PlanCode(plan.code))) return null;
  const clinica = doCiclo
    .map((plan) => ({ doctors: doctorsOf(plan) ?? 0, plan }))
    .filter((item) => item.doctors >= 2)
    .sort((a, b) => a.doctors - b.doctors);
  return { consultorio: doCiclo.find((plan) => familyOf(plan) === 'consultorio') ?? null, clinica };
}

export function formatPrice(priceCents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(priceCents / 100);
}

export function familyName(family: PlanFamily): string {
  return family === 'consultorio' ? 'Consultório' : 'Clínica';
}

export function familyDescription(family: PlanFamily): string {
  return family === 'consultorio'
    ? 'Para quem atende sozinho. Inclui assistente de IA no WhatsApp, confirmações e lembretes, prontuário, financeiro e painéis.'
    : 'Para clínicas de 2 a 5 médicos. Inclui tudo do Consultório, mais permissões por pessoa, relatório por médico e repasse por procedimento.';
}

export function includedStaffLogins(family: PlanFamily): number {
  return family === 'consultorio'
    ? PROPOSED_OFFER.consultorioIncludedStaffLogins
    : PROPOSED_OFFER.clinicaIncludedStaffLogins;
}

/**
 * Linhas do resumo. A base da Clínica é o plano de 2 médicos do mesmo ciclo; os médicos extras são
 * a diferença até o plano escolhido. Sem a base no catálogo, uma linha só, com o preço do servidor.
 */
export function summaryLines(plan: SignupPlan, catalog: OfferCatalog): SummaryLine[] {
  const family = familyOf(plan);
  const doctors = doctorsOf(plan);
  if (!family || !doctors) return [];
  const staff = includedStaffLogins(family);
  const seats: SummaryLine[] = [
    { label: `Até ${staff} acessos administrativos`, value: 'Incluído' },
    { label: 'Pessoas no total', value: `Até ${doctors + staff}` },
  ];
  if (family === 'consultorio') {
    return [
      { label: 'Plano Consultório com 1 médico', value: formatPrice(plan.priceCents) },
      ...seats,
    ];
  }
  const base = catalog.clinica.find((item) => item.doctors === 2)?.plan;
  const extras = doctors - 2;
  const diff = base ? plan.priceCents - base.priceCents : 0;
  if (!base || extras === 0 || diff <= 0) {
    return [
      { label: `Plano Clínica com ${doctors} médicos`, value: formatPrice(plan.priceCents) },
      ...seats,
    ];
  }
  const unit = diff / extras;
  const unitLabel = Number.isInteger(unit) ? ` × ${formatPrice(unit)}` : '';
  return [
    { label: 'Plano Clínica com 2 médicos', value: formatPrice(base.priceCents) },
    {
      label: `${extras} ${extras === 1 ? 'médico extra' : 'médicos extras'}${unitLabel}`,
      value: formatPrice(diff),
    },
    ...seats,
  ];
}

/** Plano Clínica com a quantidade pedida, ou o mais próximo disponível. */
export function clinicaPlanFor(catalog: OfferCatalog, doctors: number): SignupPlan | null {
  if (catalog.clinica.length === 0) return null;
  const exato = catalog.clinica.find((item) => item.doctors === doctors);
  if (exato) return exato.plan;
  return [...catalog.clinica].sort(
    (a, b) => Math.abs(a.doctors - doctors) - Math.abs(b.doctors - doctors),
  )[0]!.plan;
}

export interface FirstCharge {
  /** A avaliação já terminou: a primeira mensalidade vence hoje. */
  expired: boolean;
  /** Dias de avaliação que ainda restam (arredondado para cima). */
  remainingDays: number;
  /** Vencimento da primeira mensalidade, AAAA-MM-DD (UTC), como o servidor envia ao provedor. */
  dueDate: string;
}

/**
 * Mesma regra do servidor (`resolveSignupTrialTerms`, oferta 2026): a primeira mensalidade vence no
 * dia UTC seguinte ao fim da avaliação; se o checkout acontece depois do fim, vence hoje. Serve só
 * para a tela dizer o que vai acontecer; quem decide a cobrança é o servidor.
 */
export function firstChargeFor(offerTrialEndsAt: string, now: Date): FirstCharge | null {
  const endsAt = Date.parse(offerTrialEndsAt);
  if (!Number.isFinite(endsAt) || !Number.isFinite(now.getTime())) return null;
  const expired = now.getTime() >= endsAt;
  return {
    expired,
    remainingDays: expired ? 0 : Math.ceil((endsAt - now.getTime()) / 86_400_000),
    dueDate: expired
      ? now.toISOString().slice(0, 10)
      : new Date(endsAt + 86_400_000).toISOString().slice(0, 10),
  };
}

/** AAAA-MM-DD → DD/MM/AAAA, sem passar por fuso. */
export function formatIsoDate(isoDate: string): string {
  const [ano, mes, dia] = isoDate.split('-');
  return `${dia}/${mes}/${ano}`;
}
