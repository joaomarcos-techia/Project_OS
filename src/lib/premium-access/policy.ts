/**
 * Recursos premium do Qoro (D24 — decisão definitiva do fundador, 11/11/2026).
 *
 * O trial de 14 dias é para CONHECER o Qoro. Três recursos só funcionam para
 * clínica com assinatura paga e ativa, no plano que os inclui:
 *
 *   - `health_insurance` — Convênios TISS;
 *   - `patient_charges`  — cobrança de pacientes pelo Asaas;
 *   - `ai_agents`        — Agentes de Inteligência Artificial.
 *
 * A DECISÃO mora num lugar só: `public.qoro_premium_denial_for` (migration 0151),
 * que lê o estado de billing do backend (assinatura, status da clínica escrito
 * pelo dunning e a política de trial do PR #53). Este arquivo só tem tipos,
 * mensagens e a tradução do erro do banco — nenhuma regra comercial duplicada.
 *
 * Mostrar o recurso não é liberar o uso: a tela pode apresentar o módulo, mas a
 * operação real é negada no servidor e, de novo, no banco.
 */

export const PREMIUM_FEATURES = ['health_insurance', 'patient_charges', 'ai_agents'] as const;
export type PremiumFeature = (typeof PREMIUM_FEATURES)[number];

/** Motivos devolvidos pelo banco (texto fixo; nunca dado de paciente). */
export const PREMIUM_DENIALS = [
  'clinic_unknown',
  'no_subscription',
  'trial',
  'trial_expired',
  'payment_pending',
  'clinic_suspended',
  'subscription_cancelled',
  'subscription_inactive',
  'plan_excludes',
] as const;
export type PremiumDenial = (typeof PREMIUM_DENIALS)[number];

export const PREMIUM_FEATURE_LABELS: Record<PremiumFeature, string> = {
  health_insurance: 'Convênios',
  patient_charges: 'Cobrança de pacientes',
  ai_agents: 'Agentes de IA',
};

const PLANS_CTA = 'Conheça os planos do Qoro para habilitar esta funcionalidade.';

/** Mensagem para o usuário: restrição comercial esperada, não erro técnico. */
export function premiumDenialMessage(feature: PremiumFeature, reason: PremiumDenial): string {
  const label = PREMIUM_FEATURE_LABELS[feature];
  switch (reason) {
    case 'trial':
    case 'no_subscription':
    case 'clinic_unknown':
      return `${label}: este recurso está disponível para clínicas com assinatura ativa. ${PLANS_CTA}`;
    case 'trial_expired':
      return `${label}: o período de avaliação terminou. Este recurso está disponível para clínicas com assinatura ativa. ${PLANS_CTA}`;
    case 'payment_pending':
      return `${label}: o recurso será liberado depois da confirmação do pagamento da assinatura.`;
    case 'clinic_suspended':
    case 'subscription_cancelled':
    case 'subscription_inactive':
      return `${label}: a assinatura da clínica não está ativa. Regularize a assinatura para voltar a usar este recurso. Os registros já feitos continuam disponíveis para consulta.`;
    case 'plan_excludes':
      return `${label}: o plano atual da clínica não inclui este recurso. ${PLANS_CTA}`;
  }
}

export class PremiumAccessError extends Error {
  readonly code = 'premium_feature_required';
  constructor(
    readonly feature: PremiumFeature,
    readonly reason: PremiumDenial,
  ) {
    super(premiumDenialMessage(feature, reason));
    this.name = 'PremiumAccessError';
  }
}

export function isPremiumFeature(value: unknown): value is PremiumFeature {
  return typeof value === 'string' && (PREMIUM_FEATURES as readonly string[]).includes(value);
}

export function isPremiumDenial(value: unknown): value is PremiumDenial {
  return typeof value === 'string' && (PREMIUM_DENIALS as readonly string[]).includes(value);
}

/**
 * Traduz SÓ o erro conhecido do banco (`23514` + `qoro_premium_<feature>`, motivo
 * no DETAIL). Qualquer outro erro segue como está: texto SQL arbitrário nunca vira
 * mensagem de usuário.
 */
export function premiumAccessErrorFrom(error: unknown): PremiumAccessError | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current instanceof PremiumAccessError) return current;
    if (typeof current !== 'object' || current === null) return null;
    const rec = current as { code?: unknown; constraint_name?: unknown; detail?: unknown; cause?: unknown };
    if (rec.code === '23514' && typeof rec.constraint_name === 'string') {
      const feature = rec.constraint_name.startsWith('qoro_premium_')
        ? rec.constraint_name.slice('qoro_premium_'.length)
        : null;
      if (isPremiumFeature(feature)) {
        return new PremiumAccessError(feature, isPremiumDenial(rec.detail) ? rec.detail : 'subscription_inactive');
      }
    }
    current = rec.cause ?? null;
  }
  return null;
}
