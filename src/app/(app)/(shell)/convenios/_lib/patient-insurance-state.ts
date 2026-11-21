/**
 * Estado da aba Convênios na ficha do paciente (P1.3, ciclo de 14/11). Função pura: a tela
 * decide o que mostrar a partir da MESMA decisão que o banco usa para barrar as ações (D24,
 * `qoro_premium_denial`) e do módulo habilitado pelo Qoro na clínica. A aba nunca opera:
 * os links levam às telas de Convênios, que repetem todas as validações no servidor.
 */
import type { PremiumDenial } from '@/lib/premium-access';

/** Avaliação ou sem plano: recurso contratável; nada é operado. */
export const CONTRACTABLE_DENIALS: readonly PremiumDenial[] = [
  'trial',
  'trial_expired',
  'no_subscription',
  'clinic_unknown',
  'plan_excludes',
];

export type PatientInsuranceState =
  /** Tabelas de Convênios não aplicadas neste banco. */
  | 'not_installed'
  /** Avaliação/sem plano: recurso contratável, sem registros para mostrar. */
  | 'contractable'
  /** Assinatura parada ou clínica suspensa: registros em consulta, nada novo. */
  | 'read_only'
  /** Assinatura ok, mas o Qoro não habilitou o módulo nesta clínica. */
  | 'module_disabled'
  /** Tudo liberado e o paciente ainda não tem nada de convênio. */
  | 'empty'
  /** Tudo liberado e há registros. */
  | 'ready';

export interface PatientInsuranceStateInput {
  installed: boolean;
  commercial: PremiumDenial | null;
  enabled: boolean;
  /** Carteirinhas + coberturas + guias + autorizações do paciente. */
  records: number;
}

export function patientInsuranceState(input: PatientInsuranceStateInput): PatientInsuranceState {
  if (!input.installed) return 'not_installed';
  if (input.commercial) {
    // Registros existentes nunca somem: com eles, a negativa vira consulta.
    if (CONTRACTABLE_DENIALS.includes(input.commercial) && input.records === 0)
      return 'contractable';
    return 'read_only';
  }
  if (!input.enabled) return 'module_disabled';
  return input.records === 0 ? 'empty' : 'ready';
}

/** Só com tudo liberado a aba oferece o atalho para cadastrar/alterar carteirinha. */
export function canOfferCardManagement(
  state: PatientInsuranceState,
  canEditPatients: boolean,
): boolean {
  return canEditPatients && (state === 'empty' || state === 'ready');
}

/** Carteirinha vencida: validade (dia civil) antes de hoje no fuso da clínica. */
export function isCardExpired(validUntil: string | null, todayYmd: string): boolean {
  return validUntil !== null && validUntil < todayYmd;
}
