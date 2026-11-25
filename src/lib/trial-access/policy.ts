/** Temporary evaluation quotas; permanent seat limits remain owned by Billing. */
export const TRIAL_RESOURCE_LIMITS = {
  patients: { limit: 10, label: 'Pacientes' },
  appointments: { limit: 15, label: 'Agendamentos' },
  documents: { limit: 15, label: 'Documentos e receitas' },
  payments: { limit: 15, label: 'Registros de pagamento' },
  receivables: { limit: 15, label: 'Contas a receber' },
  expenses: { limit: 15, label: 'Despesas' },
  procedures: { limit: 15, label: 'Procedimentos' },
  resources: { limit: 15, label: 'Recursos de agenda' },
  document_templates: { limit: 15, label: 'Modelos de documento' },
} as const;

export type TrialResource = keyof typeof TRIAL_RESOURCE_LIMITS;
export type TrialPaidFeature = 'whatsapp' | 'asaas' | 'team_invites';
export const TRIAL_PAID_FEATURE_MESSAGES: Record<TrialPaidFeature, string> = {
  whatsapp:
    'A conexão com o WhatsApp fica disponível após a confirmação do pagamento da assinatura.',
  asaas: 'A conexão com o Asaas fica disponível após a confirmação do pagamento da assinatura.',
  team_invites:
    'Convites de equipe ficam disponíveis após a confirmação do pagamento da assinatura.',
};

export class TrialAccessError extends Error {
  readonly code = 'trial_access_restricted';
  constructor(readonly restriction: TrialResource | TrialPaidFeature | 'expired') {
    super(trialRestrictionMessage(restriction));
    this.name = 'TrialAccessError';
  }
}

function trialRestrictionMessage(
  restriction: TrialResource | TrialPaidFeature | 'expired',
): string {
  if (restriction === 'expired') {
    return 'Sua avaliação terminou. Confirme o pagamento da assinatura para continuar criando registros.';
  }
  if (isTrialResource(restriction)) return describeTrialResourceLimit(restriction);
  return TRIAL_PAID_FEATURE_MESSAGES[restriction];
}

export function describeTrialResourceLimit(resource: TrialResource): string {
  const { limit, label } = TRIAL_RESOURCE_LIMITS[resource];
  return `Limite da avaliação atingido: ${limit} ${label.toLocaleLowerCase('pt-BR')}. A cota temporária será removida após a confirmação do pagamento da assinatura.`;
}

/** Only known PostgreSQL constraints are translated; arbitrary SQL text stays private. */
export function trialAccessErrorFrom(error: unknown): TrialAccessError | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current instanceof TrialAccessError) return current;
    if (typeof current !== 'object' || current === null) return null;
    if ('code' in current && current.code === '23514' && 'constraint_name' in current) {
      const constraint = current.constraint_name;
      for (const resource of Object.keys(TRIAL_RESOURCE_LIMITS)) {
        if (constraint === `qoro_trial_limit_${resource}` && isTrialResource(resource)) {
          return new TrialAccessError(resource);
        }
      }
      for (const feature of ['whatsapp', 'asaas', 'team_invites', 'expired'] as const) {
        if (constraint === `qoro_trial_limit_${feature}`) return new TrialAccessError(feature);
      }
    }
    current = 'cause' in current ? current.cause : null;
  }
  return null;
}

export function isTrialResource(value: string): value is TrialResource {
  return Object.hasOwn(TRIAL_RESOURCE_LIMITS, value);
}
