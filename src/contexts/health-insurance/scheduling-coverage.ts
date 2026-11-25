/**
 * Forma de atendimento "Convênio" na agenda (P4.1/P4.4; R44).
 *
 * A agenda (camada de app) cria o atendimento JÁ como convênio (o `scheduling` é dono
 * da modalidade e o banco recusa convênio sem o módulo habilitado ou sem assinatura
 * ativa) e logo depois chama este módulo para registrar a cobertura de cada
 * atendimento criado. Assim nunca existe a janela "particular" em que um sinal ou um
 * link do saldo cheio poderiam ser pedidos.
 *
 * Se a cobertura não puder ser registrada (carteirinha de outra operadora, operadora
 * suspensa no meio do caminho…), o atendimento continua como convênio SEM cobertura:
 * o paciente não é cobrado (o banco só aceita recebível de convênio pela coparticipação
 * confirmada), a pendência aparece em Convênios e a recepção registra a cobertura lá.
 *
 * A conferência ANTES de criar (`checkSchedulingChoice`) evita o caso comum: escolha
 * inválida não cria atendimento nenhum.
 */
import 'server-only';

import { and, eq } from 'drizzle-orm';

import { logAudit } from '@/lib/audit/log';
import type { RequestContext } from '@/lib/audit/types';
import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import {
  premiumAccessErrorFrom,
  premiumDenialMessage,
  getPremiumDenialTx,
} from '@/lib/premium-access';

import { CoverageInputError, recordAppointmentCoverage } from './internal/coverage-service';
import { ConveniosModuleDisabledError } from './internal/module-guard';
import { hiClinicSettings, hiInsurers, hiMemberships, hiPlans } from './schema';

export interface SchedulingInsuranceChoice {
  insurerId: string;
  planId: string | null;
  /** `null` = carteirinha ainda não informada (vira pendência da recepção, nunca cobrança). */
  membershipId: string | null;
  guideType: 'consulta' | 'sp_sadt';
}

/** Mensagem para a recepção quando a escolha não serve; `null` = pode criar. */
export async function checkSchedulingChoice(
  clinicId: string,
  patientId: string,
  choice: SchedulingInsuranceChoice,
): Promise<string | null> {
  return withTenant(clinicId, (tx) => checkSchedulingChoiceTx(tx, clinicId, patientId, choice));
}

/** A mesma conferência dentro de uma transação já aberta (troca de modalidade, P4.3). */
export async function checkSchedulingChoiceTx(
  tx: Tx,
  clinicId: string,
  patientId: string,
  choice: SchedulingInsuranceChoice,
): Promise<string | null> {
  const [st] = await tx
    .select({ enabled: hiClinicSettings.enabled })
    .from(hiClinicSettings)
    .where(eq(hiClinicSettings.clinicId, clinicId))
    .limit(1);
  if (!st?.enabled)
    return 'Convênios não está habilitado para esta clínica. Agende como particular ou fale com o suporte do Qoro.';
  const denial = await getPremiumDenialTx(tx, clinicId, 'health_insurance');
  if (denial) return premiumDenialMessage('health_insurance', denial);
  const [ins] = await tx
    .select({ status: hiInsurers.status })
    .from(hiInsurers)
    .where(and(eq(hiInsurers.clinicId, clinicId), eq(hiInsurers.id, choice.insurerId)))
    .limit(1);
  if (!ins) return 'Operadora não encontrada nesta clínica.';
  if (ins.status !== 'active') return 'A operadora não está ativa no cadastro da clínica.';
  if (choice.planId) {
    const [p] = await tx
      .select({ insurerId: hiPlans.insurerId, status: hiPlans.status })
      .from(hiPlans)
      .where(and(eq(hiPlans.clinicId, clinicId), eq(hiPlans.id, choice.planId)))
      .limit(1);
    if (!p || p.insurerId !== choice.insurerId || p.status !== 'active')
      return 'O plano escolhido não é desta operadora.';
  }
  if (choice.membershipId) {
    const [m] = await tx
      .select({
        patientId: hiMemberships.patientId,
        insurerId: hiMemberships.insurerId,
        status: hiMemberships.status,
      })
      .from(hiMemberships)
      .where(and(eq(hiMemberships.clinicId, clinicId), eq(hiMemberships.id, choice.membershipId)))
      .limit(1);
    if (!m || m.patientId !== patientId || m.insurerId !== choice.insurerId)
      return 'A carteirinha escolhida não é deste paciente nesta operadora.';
    if (m.status !== 'active') return 'A carteirinha escolhida não está ativa.';
  }
  return null;
}

export interface SchedulingCoverageOutcome {
  /** Coberturas gravadas. */
  recorded: number;
  /** Situação da primeira cobertura (pronta, com pendência, aguardando autorização…). */
  status: string | null;
  /** Pendências da primeira cobertura, para a recepção ver na hora. */
  issues: string[];
  /** Falha ao registrar: o atendimento ficou como convênio sem cobertura (pendência). */
  error: string | null;
}

/**
 * Registra a cobertura dos atendimentos recém-criados (um ou a série inteira) numa
 * transação, com a pessoa da sessão e auditoria. Nunca lança: o resultado diz o que
 * aconteceu, porque o atendimento já existe.
 */
export async function recordSchedulingCoverage(args: {
  clinicId: string;
  userId: string;
  patientId: string;
  procedureId: string;
  appointments: ReadonlyArray<{ id: string; date: string }>;
  choice: SchedulingInsuranceChoice;
  requestContext: RequestContext;
}): Promise<SchedulingCoverageOutcome> {
  try {
    return await withTenant(
      args.clinicId,
      async (tx) => {
        let first: { status: string; issues: string[] } | null = null;
        for (const ap of args.appointments) {
          const out = await recordAppointmentCoverage(tx, {
            clinicId: args.clinicId,
            appointmentId: ap.id,
            patientId: args.patientId,
            procedureId: args.procedureId,
            appointmentDate: ap.date,
            guideType: args.choice.guideType,
            insurerId: args.choice.insurerId,
            planId: args.choice.planId,
            membershipId: args.choice.membershipId,
            authorizationId: null,
            actor: { kind: 'user', userId: args.userId },
          });
          await logAudit(tx, {
            clinicId: args.clinicId,
            userId: args.userId,
            action: 'health_insurance.coverage.recorded_at_scheduling',
            resourceType: 'hi_appointment_coverage',
            resourceId: out.coverageId,
            before: null,
            after: {
              appointmentId: ap.id,
              insurerId: args.choice.insurerId,
              status: out.status,
              issues: out.issues.map((i) => i.code),
              copayEstimated: out.copay !== null,
            },
            requestContext: args.requestContext,
          });
          first ??= { status: out.status, issues: out.issues.map((i) => i.message) };
        }
        return {
          recorded: args.appointments.length,
          status: first?.status ?? null,
          issues: first?.issues ?? [],
          error: null,
        };
      },
      args.userId,
    );
  } catch (e) {
    const premium = premiumAccessErrorFrom(e);
    const error = premium
      ? premiumDenialMessage(premium.feature, premium.reason)
      : e instanceof ConveniosModuleDisabledError
        ? e.message
        : e instanceof CoverageInputError
          ? e.message.charAt(0).toUpperCase() + e.message.slice(1)
          : 'A cobertura não foi registrada agora.';
    return { recorded: 0, status: null, issues: [], error };
  }
}
