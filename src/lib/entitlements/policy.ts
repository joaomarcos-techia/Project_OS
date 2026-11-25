/** Commercial permission is necessary; identity, permissions and module flags still apply. */
export type OperationalModule = 'patient_payments' | 'ai_agents' | 'health_insurance';
export type ModuleDenial =
  | 'subscription_required'
  | 'payment_required'
  | 'subscription_inactive'
  | 'period_expired'
  | 'plan_not_included'
  | 'module_unavailable';
export type ModuleAccess = { allowed: true } | { allowed: false; reason: ModuleDenial };

export interface CommercialSubscription {
  clinic_status: string;
  billing_status: string | null;
  plan_code: string | null;
  period_start: Date | null;
  period_end: Date | null;
  grace_until: Date | null;
  cancel_at_period_end: boolean;
  enrolled: boolean;
  verified_release: boolean;
}

const INCLUDED_PLANS = new Set([
  'solo',
  'clinica',
  'pro',
  'consultorio_2026',
  'clinica_2026_2',
  'clinica_2026_3',
  'clinica_2026_4',
  'clinica_2026_5',
]);

export function evaluateModuleAccess(
  subscription: CommercialSubscription | null,
  module: OperationalModule,
  now: Date,
): ModuleAccess {
  if (!subscription || subscription.billing_status === null)
    return { allowed: false, reason: 'subscription_required' };
  if (
    subscription.billing_status === 'trial' ||
    (subscription.enrolled && !subscription.verified_release)
  )
    return { allowed: false, reason: 'payment_required' };
  if (
    !['active', 'past_due'].includes(subscription.billing_status) ||
    subscription.clinic_status !== 'active'
  )
    return { allowed: false, reason: 'subscription_inactive' };
  if (
    !Number.isFinite(now.getTime()) ||
    (subscription.period_start !== null && subscription.period_start > now) ||
    (subscription.period_end !== null &&
      subscription.period_end <= now &&
      (subscription.cancel_at_period_end ||
        !subscription.grace_until ||
        subscription.grace_until <= now)) ||
    (subscription.enrolled && (!subscription.period_start || !subscription.period_end))
  )
    return { allowed: false, reason: 'period_expired' };
  if (!subscription.plan_code || !INCLUDED_PLANS.has(subscription.plan_code))
    return { allowed: false, reason: 'plan_not_included' };
  // TISS is not released or commercially assigned yet. Payment must not enable it.
  return module === 'patient_payments' || module === 'ai_agents'
    ? { allowed: true }
    : { allowed: false, reason: 'module_unavailable' };
}

export class OperationalAccessError extends Error {
  readonly code = 'paid_module_restricted';
  constructor(
    readonly module: OperationalModule,
    readonly reason: ModuleDenial,
  ) {
    super(
      reason === 'module_unavailable'
        ? 'Este módulo ainda não está disponível para operação.'
        : 'Este recurso exige uma assinatura paga e ativa, incluída no seu plano.',
    );
    this.name = 'OperationalAccessError';
  }
}
