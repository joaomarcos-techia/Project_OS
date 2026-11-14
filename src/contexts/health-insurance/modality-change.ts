/**
 * P4.3 — trocar particular ↔ convênio de um atendimento JÁ criado, pela agenda.
 *
 * Não é troca de etiqueta: numa transação só, (1) as pré-condições que tornariam a troca
 * inconsistente são conferidas, (2) o Scheduling troca a modalidade (até a chegada) e publica
 * `billing_mode_changed`, (3) a cobertura é registrada (→ convênio) ou cancelada sem ser apagada
 * (→ particular). Depois do commit, o Payments anula a cobrança particular ainda aberta.
 *
 * Recusas (o backend recusa mesmo chamado direto; o banco recusa de novo o que é dele):
 *   - depois da chegada: só pelo fluxo de correção (gatilho 0148 também recusa);
 *   - guia viva para o atendimento: cancelar/substituir a guia em Convênios antes;
 *   - coparticipação além da estimativa (só existe depois da conclusão);
 *   - → convênio com pagamento do paciente já recebido (sinal/saldo): decidir o dinheiro antes
 *     (devolução pela clínica ou crédito), nunca "virar convênio" com cobrança cheia paga;
 *   - → convênio com recebível do paciente já criado;
 *   - → convênio sem módulo, sem assinatura paga ativa, com operadora/plano/carteirinha que
 *     não servem (a mesma conferência da criação; carteirinha de outro paciente é recusada).
 *
 * → particular: a cobertura vira `cancelled` (operadora, carteirinha e autorização ficam no
 * histórico; a autorização não é consumida nem apagada). A estimativa de coparticipação fica
 * como está (nunca cobra e é reaproveitada se o atendimento voltar a convênio). Nenhuma
 * cobrança é criada pela troca: o recebível particular nasce na conclusão.
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import { logAudit } from '@/lib/audit/log';
import type { Tx } from '@/lib/db';
import { premiumAccessErrorFrom } from '@/lib/premium-access';

/* eslint-disable boundaries/element-types -- API versionada do Scheduling (dono da modalidade). */
import { schedulingApiV1 } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { CoverageInputError, recordAppointmentCoverage } from './internal/coverage-service';
import { checkSchedulingChoiceTx, type SchedulingInsuranceChoice } from './scheduling-coverage';

export type ModalityChangeCode =
  | 'REASON_REQUIRED'
  | 'APPOINTMENT_NOT_FOUND'
  | 'APPOINTMENT_STARTED'
  | 'SAME_MODE'
  | 'CHOICE_REQUIRED'
  | 'CHOICE_INVALID'
  | 'GUIDE_EXISTS'
  | 'COPAY_IN_PROGRESS'
  | 'PATIENT_PAYMENT_RECEIVED'
  | 'RECEIVABLE_EXISTS'
  | 'NO_PATIENT';

export class ModalityChangeError extends Error {
  constructor(
    message: string,
    readonly code: ModalityChangeCode,
  ) {
    super(message);
    this.name = 'ModalityChangeError';
  }
}

export interface ModalityChangeInput {
  clinicId: string;
  userId: string;
  appointmentId: string;
  to: 'particular' | 'convenio';
  /** Obrigatória para → convênio (operadora, plano, carteirinha, tipo de guia). */
  choice?: SchedulingInsuranceChoice | null;
  /** Por que mudou (10 a 500 caracteres): vai para a auditoria. */
  reason: string;
  idempotencyKey: string;
}

export interface ModalityChangeResult {
  from: 'particular' | 'convenio';
  to: 'particular' | 'convenio';
  coverageId: string | null;
  coverageStatus: string | null;
  issues: string[];
  /** Chave do `billing_mode_changed` (para processar logo depois da resposta). */
  eventKey: string;
}

type Row = Record<string, unknown>;

export async function changeAppointmentModalityTx(
  tx: Tx,
  input: ModalityChangeInput,
): Promise<ModalityChangeResult> {
  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 500) {
    throw new ModalityChangeError(
      'Diga o motivo da troca (10 a 500 caracteres).',
      'REASON_REQUIRED',
    );
  }
  const { clinicId, appointmentId } = input;

  // Trava o atendimento antes de conferir: duas trocas concorrentes não se cruzam.
  const [ap] = (await tx.execute(sql`
    SELECT a.status::text AS status, a.billing_mode, a.patient_id::text AS patient_id,
           a.procedure_id::text AS procedure_id,
           to_char(a.scheduled_at AT TIME ZONE coalesce(c.timezone, 'America/Sao_Paulo'), 'YYYY-MM-DD') AS day
      FROM public.appointments a JOIN public.clinics c ON c.id = a.clinic_id
     WHERE a.clinic_id = ${clinicId}::uuid AND a.id = ${appointmentId}::uuid
     FOR UPDATE OF a`)) as unknown as Row[];
  if (!ap)
    throw new ModalityChangeError(
      'Atendimento não encontrado nesta clínica.',
      'APPOINTMENT_NOT_FOUND',
    );
  const from = String(ap.billing_mode) === 'convenio' ? 'convenio' : 'particular';
  if (!['agendado', 'confirmado', 'chegou'].includes(String(ap.status))) {
    throw new ModalityChangeError(
      'A forma de atendimento só muda até a chegada do paciente. Depois disso, use a correção do atendimento (guia e financeiro).',
      'APPOINTMENT_STARTED',
    );
  }
  if (from === input.to) {
    throw new ModalityChangeError(
      input.to === 'convenio'
        ? 'O atendimento já é de convênio. Para trocar operadora, plano ou carteirinha, corrija a cobertura.'
        : 'O atendimento já é particular.',
      'SAME_MODE',
    );
  }
  const patientId = ap.patient_id ? String(ap.patient_id) : null;

  const [facts] = (await tx.execute(sql`
    SELECT EXISTS (SELECT 1 FROM public.hi_guide_items gi
                    WHERE gi.clinic_id = ${clinicId}::uuid AND gi.appointment_id = ${appointmentId}::uuid AND gi.live) AS guide,
           (SELECT cp.status FROM public.hi_copayments cp
             WHERE cp.clinic_id = ${clinicId}::uuid AND cp.appointment_id = ${appointmentId}::uuid) AS copay,
           EXISTS (SELECT 1 FROM public.patient_charges pc
                    WHERE pc.clinic_id = ${clinicId}::uuid AND pc.appointment_id = ${appointmentId}::uuid
                      AND pc.status = 'paid') AS paid,
           EXISTS (SELECT 1 FROM public.lancamentos l
                    WHERE l.clinic_id = ${clinicId}::uuid AND l.appointment_id = ${appointmentId}::uuid
                      AND l.tipo = 'receber') AS receivable`)) as unknown as Row[];
  if (facts?.guide === true) {
    throw new ModalityChangeError(
      'Já existe guia para este atendimento. Cancele ou substitua a guia em Convênios antes de mudar a forma de atendimento.',
      'GUIDE_EXISTS',
    );
  }
  if (facts?.copay && !['estimated', 'cancelled'].includes(String(facts.copay))) {
    throw new ModalityChangeError(
      'A coparticipação deste atendimento já foi calculada ou cobrada; resolva em Convênios › Coparticipação.',
      'COPAY_IN_PROGRESS',
    );
  }

  let choice: SchedulingInsuranceChoice | null = null;
  if (input.to === 'convenio') {
    if (!patientId)
      throw new ModalityChangeError('Convênio exige paciente no atendimento.', 'NO_PATIENT');
    if (facts?.paid === true) {
      throw new ModalityChangeError(
        'O paciente já pagou este atendimento (sinal ou saldo). Antes de mudar para convênio, decida o dinheiro no Caixa: devolução pela clínica ou crédito. Nada é cobrado nem devolvido sozinho.',
        'PATIENT_PAYMENT_RECEIVED',
      );
    }
    if (facts?.receivable === true) {
      throw new ModalityChangeError(
        'Já existe recebível particular deste atendimento; cancele-o no Caixa antes de mudar para convênio.',
        'RECEIVABLE_EXISTS',
      );
    }
    if (!input.choice) {
      throw new ModalityChangeError(
        'Escolha a operadora (e, se houver, o plano e a carteirinha).',
        'CHOICE_REQUIRED',
      );
    }
    const problem = await checkSchedulingChoiceTx(tx, clinicId, patientId, input.choice);
    if (problem) throw new ModalityChangeError(problem, 'CHOICE_INVALID');
    choice = input.choice;
  }

  const changed = await schedulingApiV1.changeBillingModeTx(tx, {
    clinicId,
    appointmentId,
    to: input.to,
    idempotencyKey: input.idempotencyKey,
  });
  const eventKey = changed.eventKey;

  if (input.to === 'convenio' && choice && patientId) {
    const out = await recordAppointmentCoverage(tx, {
      clinicId,
      appointmentId,
      patientId,
      procedureId: changed.procedureId,
      appointmentDate: String(ap.day),
      guideType: choice.guideType,
      insurerId: choice.insurerId,
      planId: choice.planId,
      membershipId: choice.membershipId,
      authorizationId: null,
      actor: { kind: 'user', userId: input.userId },
    });
    return {
      from,
      to: input.to,
      coverageId: out.coverageId,
      coverageStatus: out.status,
      issues: out.issues.map((i) => i.message),
      eventKey,
    };
  }

  // → particular: a cobertura sai de cena SEM ser apagada (histórico, autorização intacta).
  const [cancelled] = (await tx.execute(sql`
    UPDATE public.hi_appointment_coverages SET status = 'cancelled'
     WHERE clinic_id = ${clinicId}::uuid AND appointment_id = ${appointmentId}::uuid AND status <> 'cancelled'
     RETURNING id::text AS id`)) as unknown as Row[];
  return {
    from,
    to: input.to,
    coverageId: cancelled ? String(cancelled.id) : null,
    coverageStatus: cancelled ? 'cancelled' : null,
    issues: [],
    eventKey,
  };
}

export type CoverageCarryOutcome =
  | 'carried'
  | 'no_coverage'
  | 'not_insurance'
  | 'already_covered'
  | 'left_pending';

/**
 * R50/P4.3 — remarcar um atendimento de convênio leva a cobertura junto. A remarcação cria um
 * atendimento NOVO (o antigo é cancelado) e a modalidade já é mantida pelo Scheduling; aqui a
 * MESMA escolha (operadora, plano, carteirinha, tipo de guia) é registrada de novo no novo,
 * com contrato/autorização/coparticipação rederivados para a nova data, e a cobertura do
 * antigo vira `cancelled` (histórico preservado). Se a escolha não servir mais (carteirinha
 * inativa, assinatura suspensa…), o novo fica como convênio sem cobertura: pendência em
 * Convênios, nunca cobrança. Idempotente: cobertura já existente no novo não é tocada.
 */
export async function carryCoverageOnRescheduleTx(
  tx: Tx,
  input: { clinicId: string; oldAppointmentId: string; newAppointmentId: string },
): Promise<{ outcome: CoverageCarryOutcome; coverageId: string | null }> {
  const { clinicId } = input;
  const [old] = (await tx.execute(sql`
    SELECT id::text AS id, insurer_id::text AS insurer_id, plan_id::text AS plan_id,
           membership_id::text AS membership_id, guide_type
      FROM public.hi_appointment_coverages
     WHERE clinic_id = ${clinicId}::uuid AND appointment_id = ${input.oldAppointmentId}::uuid
       AND status <> 'cancelled'`)) as unknown as Row[];
  if (!old) return { outcome: 'no_coverage', coverageId: null };
  const [ap] = (await tx.execute(sql`
    SELECT a.status::text AS status, a.billing_mode, a.patient_id::text AS patient_id,
           a.procedure_id::text AS procedure_id,
           to_char(a.scheduled_at AT TIME ZONE coalesce(c.timezone, 'America/Sao_Paulo'), 'YYYY-MM-DD') AS day,
           EXISTS (SELECT 1 FROM public.hi_appointment_coverages x
                    WHERE x.clinic_id = a.clinic_id AND x.appointment_id = a.id) AS covered
      FROM public.appointments a JOIN public.clinics c ON c.id = a.clinic_id
     WHERE a.clinic_id = ${clinicId}::uuid AND a.id = ${input.newAppointmentId}::uuid`)) as unknown as Row[];
  if (!ap || String(ap.billing_mode) !== 'convenio' || !ap.patient_id) {
    return { outcome: 'not_insurance', coverageId: null };
  }
  if (ap.covered === true) return { outcome: 'already_covered', coverageId: null };

  let coverageId: string | null = null;
  let outcome: CoverageCarryOutcome = 'carried';
  try {
    // Ponto de salvamento: se a escolha não servir mais, só a cobertura nova cai.
    const out = await tx.transaction((sp) =>
      recordAppointmentCoverage(sp, {
        clinicId,
        appointmentId: input.newAppointmentId,
        patientId: String(ap.patient_id),
        procedureId: String(ap.procedure_id),
        appointmentDate: String(ap.day),
        guideType: String(old.guide_type) === 'sp_sadt' ? 'sp_sadt' : 'consulta',
        insurerId: String(old.insurer_id),
        planId: old.plan_id ? String(old.plan_id) : null,
        membershipId: old.membership_id ? String(old.membership_id) : null,
        authorizationId: null,
        actor: { kind: 'automation' },
      }),
    );
    coverageId = out.coverageId;
  } catch (error) {
    if (!(error instanceof CoverageInputError) && !premiumAccessErrorFrom(error)) throw error;
    outcome = 'left_pending';
  }
  // O antigo está cancelado: a cobertura dele muda só de situação (o gatilho 0148 permite).
  await tx.execute(sql`
    UPDATE public.hi_appointment_coverages SET status = 'cancelled'
     WHERE clinic_id = ${clinicId}::uuid AND id = ${String(old.id)}::uuid AND status <> 'cancelled'`);
  await logAudit(tx, {
    clinicId,
    userId: null,
    action: 'health_insurance.coverage.carried_on_reschedule',
    resourceType: 'hi_appointment_coverage',
    resourceId: coverageId,
    before: { appointmentId: input.oldAppointmentId, coverageId: String(old.id) },
    after: { appointmentId: input.newAppointmentId, outcome },
    requestContext: {
      ip: null,
      userAgent: 'clinicaos-health-insurance-worker',
      requestId: `health-insurance.coverage-carry.${input.newAppointmentId}`,
    },
  });
  return { outcome, coverageId };
}
