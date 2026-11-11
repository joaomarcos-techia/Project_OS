/**
 * Cobertura do atendimento (P1.6/P5.1): registra operadora, plano, carteirinha e
 * autorização de um atendimento de convênio, VALIDANDO TUDO NO SERVIDOR.
 *
 * O chamador informa só a escolha (ids). Este serviço rederiva do banco:
 *  - a carteirinha é do paciente e da operadora, ativa e válida na data;
 *  - o contrato vigente do procedimento do Qoro (código TUSS, valor, exigência de
 *    autorização, coparticipação);
 *  - a situação da autorização (só a concedida pela operadora conta; negada vira
 *    situação própria; nenhuma é presumida);
 * e grava pendências com responsável. O banco confere de novo (FKs compostas e o
 * gatilho `hi_guard_coverage`), e a cobertura congela quando o atendimento começa.
 *
 * Coparticipação: quando o contrato prevê, nasce ESTIMADA (valor previsto). Nada
 * é cobrado aqui; o recebível do paciente só existe depois da confirmação.
 *
 * Roda dentro da transação do chamador (Server Action em `withTenant`).
 */
import 'server-only';

import { and, eq } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

import {
  hiAppointmentCoverages,
  hiAuthorizations,
  hiCopayments,
  hiInsurers,
  hiMemberships,
  hiProcedureContracts,
  type HiCoverageStatus,
  type HiGuideType,
} from '../schema-clinic';
import { selectEffectiveContract, type ContractLine } from '../tiss/assembly/contract-selection';
import type { GuideIssue } from '../tiss/validation/common';

export interface RecordCoverageInput {
  clinicId: string;
  appointmentId: string;
  patientId: string;
  /** `procedures.id` do Qoro (o contrato liga o TUSS a ele). */
  procedureId: string;
  /** `AAAA-MM-DD` do atendimento, no fuso da clínica. */
  appointmentDate: string;
  guideType: HiGuideType;
  insurerId: string;
  planId: string | null;
  membershipId: string | null;
  authorizationId: string | null;
  actor: { kind: 'automation' } | { kind: 'user'; userId: string };
  /**
   * Correção administrativa depois do atendimento (0149): só com pendência de
   * faturamento aberta, por um usuário, com nota. O banco confere tudo de novo.
   */
  correction?: { note: string };
}

export interface CoverageResult {
  coverageId: string;
  status: HiCoverageStatus;
  issues: GuideIssue[];
  contractLineId: string | null;
  copay: { copaymentId: string; expectedCents: number } | null;
}

const issue = (
  code: string,
  field: string,
  message: string,
  owner: GuideIssue['owner'],
): GuideIssue => ({ code, field, message, owner });

/** Coparticipação prevista pelo contrato sobre o valor do procedimento (arredonda meio para cima). */
export function expectedCopayCents(
  line: Pick<ContractLine, 'copayKind' | 'copayFixedCents' | 'copayPercentage'>,
  baseCents: number,
): number | null {
  if (line.copayKind === 'none') return null;
  if (line.copayKind === 'fixed') return Math.min(line.copayFixedCents ?? 0, baseCents);
  const pct = Number(line.copayPercentage ?? 0);
  if (!(pct > 0)) return null;
  // centavos × (pct com 2 casas) / 100, sem ponto flutuante na multiplicação.
  const pctHundredths = Math.round(pct * 100);
  return Math.floor((baseCents * pctHundredths + 5_000) / 10_000);
}

export async function recordAppointmentCoverage(
  tx: Tx,
  input: RecordCoverageInput,
): Promise<CoverageResult> {
  const { clinicId } = input;
  const issues: GuideIssue[] = [];
  if (input.correction && input.actor.kind !== 'user') {
    throw new CoverageInputError('a correção da cobertura é de um usuário');
  }
  const note = input.correction?.note.trim();
  if (input.correction && (!note || note.length < 10 || note.length > 500)) {
    throw new CoverageInputError('a correção exige o motivo (10 a 500 caracteres)');
  }
  const correction =
    input.correction && input.actor.kind === 'user'
      ? { correctionNote: note!, correctedBy: input.actor.userId }
      : {};

  const [insurer] = await tx
    .select({ id: hiInsurers.id, status: hiInsurers.status })
    .from(hiInsurers)
    .where(and(eq(hiInsurers.clinicId, clinicId), eq(hiInsurers.id, input.insurerId)))
    .limit(1);
  if (!insurer) throw new CoverageInputError('operadora inexistente nesta clínica');
  if (insurer.status !== 'active') {
    issues.push(
      issue(
        'INSURER_NOT_ACTIVE',
        'operadora',
        'A operadora não está ativa no cadastro da clínica.',
        'gestor',
      ),
    );
  }

  // Carteirinha: só a do paciente e da operadora; inválida vira pendência, nunca é aceita em silêncio.
  let membershipId: string | null = null;
  if (input.membershipId) {
    const [card] = await tx
      .select({
        id: hiMemberships.id,
        patientId: hiMemberships.patientId,
        insurerId: hiMemberships.insurerId,
        status: hiMemberships.status,
        validUntil: hiMemberships.validUntil,
      })
      .from(hiMemberships)
      .where(and(eq(hiMemberships.clinicId, clinicId), eq(hiMemberships.id, input.membershipId)))
      .limit(1);
    if (!card || card.patientId !== input.patientId || card.insurerId !== insurer.id) {
      throw new CoverageInputError('a carteirinha não é deste paciente nesta operadora');
    }
    membershipId = card.id;
    if (card.status !== 'active') {
      issues.push(
        issue(
          'MEMBERSHIP_NOT_ACTIVE',
          'beneficiario.numeroCarteira',
          'A carteirinha não está ativa.',
          'recepcao',
        ),
      );
    } else if (card.validUntil && card.validUntil < input.appointmentDate) {
      issues.push(
        issue(
          'MEMBERSHIP_EXPIRED',
          'beneficiario.numeroCarteira',
          `A carteirinha vence em ${card.validUntil}, antes do atendimento.`,
          'recepcao',
        ),
      );
    }
  } else {
    issues.push(
      issue(
        'MEMBERSHIP_MISSING',
        'beneficiario.numeroCarteira',
        'Informe a carteirinha do paciente para esta operadora.',
        'recepcao',
      ),
    );
  }

  // Contrato vigente do procedimento do Qoro.
  const lines = await tx
    .select()
    .from(hiProcedureContracts)
    .where(
      and(
        eq(hiProcedureContracts.clinicId, clinicId),
        eq(hiProcedureContracts.insurerId, insurer.id),
        eq(hiProcedureContracts.guideType, input.guideType),
      ),
    );
  const codes = [
    ...new Set(
      lines
        .filter((l) => l.procedureId === input.procedureId)
        .map((l) => `${l.tableCode}:${l.procedureCode}`),
    ),
  ];
  let line: ContractLine | null = null;
  if (codes.length === 1) {
    const [tableCode, procedureCode] = codes[0]!.split(':') as [string, string];
    const selection = selectEffectiveContract(lines as ContractLine[], {
      insurerId: insurer.id,
      planId: input.planId,
      guideType: input.guideType,
      tableCode,
      procedureCode,
      date: input.appointmentDate,
    });
    if (selection.kind === 'found') line = selection.line;
    else {
      issues.push(
        selection.kind === 'not_found'
          ? issue(
              'CONTRACT_NOT_FOUND',
              'atendimento.procedimento',
              `Não há valor de contrato vigente em ${input.appointmentDate} para este procedimento nesta operadora e plano.`,
              'gestor',
            )
          : issue(
              'CONTRACT_AMBIGUOUS',
              'atendimento.procedimento',
              'Há mais de um valor de contrato vigente para este procedimento e plano.',
              'gestor',
            ),
      );
    }
  } else {
    issues.push(
      codes.length === 0
        ? issue(
            'PROCEDURE_NOT_CONTRACTED',
            'atendimento.procedimento',
            'O procedimento não tem código TUSS no contrato desta operadora.',
            'gestor',
          )
        : issue(
            'PROCEDURE_CODE_AMBIGUOUS',
            'atendimento.procedimento',
            `O procedimento está ligado a ${codes.length} códigos TUSS no contrato desta operadora.`,
            'gestor',
          ),
    );
  }

  // Autorização: só a concedida pela operadora vale; nenhuma é presumida.
  const requirement: 'unknown' | 'not_required' | 'required' = line
    ? line.requiresAuthorization
      ? 'required'
      : 'not_required'
    : 'unknown';
  let authorizationStatus: string | null = null;
  if (input.authorizationId) {
    const [auth] = await tx
      .select({
        status: hiAuthorizations.status,
        membershipId: hiAuthorizations.membershipId,
        authorizedOn: hiAuthorizations.authorizedOn,
        validUntil: hiAuthorizations.passwordValidUntil,
      })
      .from(hiAuthorizations)
      .where(
        and(
          eq(hiAuthorizations.clinicId, clinicId),
          eq(hiAuthorizations.id, input.authorizationId),
        ),
      )
      .limit(1);
    if (!auth || auth.membershipId !== membershipId) {
      throw new CoverageInputError('a autorização não é desta carteirinha');
    }
    authorizationStatus = auth.status;
    const granted = auth.status === 'authorized' || auth.status === 'partially_authorized';
    if (granted && auth.validUntil && auth.validUntil < input.appointmentDate) {
      issues.push(
        issue(
          'AUTHORIZATION_EXPIRED',
          'autorizacao',
          `A senha venceu em ${auth.validUntil}.`,
          'recepcao',
        ),
      );
    }
  }

  let status: HiCoverageStatus;
  if (authorizationStatus === 'denied') status = 'authorization_denied';
  else if (issues.length > 0) status = 'incomplete';
  else if (
    requirement === 'required' &&
    authorizationStatus !== 'authorized' &&
    authorizationStatus !== 'partially_authorized'
  )
    status = 'pending_authorization';
  else status = 'ready';

  const values = {
    guideType: input.guideType,
    insurerId: insurer.id,
    planId: input.planId,
    membershipId,
    contractLineId: line?.id ?? null,
    authorizationRequirement: requirement,
    authorizationId: input.authorizationId,
    status,
    issues,
    expectedValueCents: line?.unitValueCents ?? null,
    ...correction,
  };
  const [existing] = await tx
    .select({ id: hiAppointmentCoverages.id })
    .from(hiAppointmentCoverages)
    .where(
      and(
        eq(hiAppointmentCoverages.clinicId, clinicId),
        eq(hiAppointmentCoverages.appointmentId, input.appointmentId),
      ),
    )
    .limit(1);
  let coverageId: string;
  if (existing) {
    await tx
      .update(hiAppointmentCoverages)
      .set(values)
      .where(
        and(
          eq(hiAppointmentCoverages.clinicId, clinicId),
          eq(hiAppointmentCoverages.id, existing.id),
        ),
      );
    coverageId = existing.id;
  } else {
    const [row] = await tx
      .insert(hiAppointmentCoverages)
      .values({
        clinicId,
        appointmentId: input.appointmentId,
        patientId: input.patientId,
        ...values,
        version: 1,
        createdVia: input.actor.kind === 'user' ? 'user' : 'automation',
        createdBy: input.actor.kind === 'user' ? input.actor.userId : null,
      })
      .returning({ id: hiAppointmentCoverages.id });
    coverageId = row!.id;
  }

  // Coparticipação prevista (estimada). Nunca cobra.
  const expected = line ? expectedCopayCents(line, line.unitValueCents) : null;
  const [copayRow] = await tx
    .select({ id: hiCopayments.id, status: hiCopayments.status })
    .from(hiCopayments)
    .where(and(eq(hiCopayments.clinicId, clinicId), eq(hiCopayments.coverageId, coverageId)))
    .limit(1);
  let copay: CoverageResult['copay'] = null;
  if (expected !== null && line) {
    const copayValues = {
      kind: line.copayKind === 'fixed' ? ('fixed' as const) : ('percentage' as const),
      percentage: line.copayKind === 'percentage' ? String(line.copayPercentage) : null,
      expectedCents: expected,
    };
    if (!copayRow) {
      const [c] = await tx
        .insert(hiCopayments)
        .values({
          clinicId,
          coverageId,
          appointmentId: input.appointmentId,
          patientId: input.patientId,
          ...copayValues,
          status: 'estimated',
          receivedCents: 0,
          version: 1,
        })
        .returning({ id: hiCopayments.id });
      copay = { copaymentId: c!.id, expectedCents: expected };
    } else if (copayRow.status === 'estimated') {
      await tx
        .update(hiCopayments)
        .set(copayValues)
        .where(and(eq(hiCopayments.clinicId, clinicId), eq(hiCopayments.id, copayRow.id)));
      copay = { copaymentId: copayRow.id, expectedCents: expected };
    } else {
      throw new CoverageInputError(
        'a coparticipação já passou da estimativa; não muda pela cobertura',
      );
    }
  } else if (copayRow && copayRow.status === 'estimated') {
    // O contrato deixou de prever coparticipação: a estimativa é cancelada (não apagada).
    await tx
      .update(hiCopayments)
      .set({ status: 'cancelled' })
      .where(and(eq(hiCopayments.clinicId, clinicId), eq(hiCopayments.id, copayRow.id)));
  }

  return { coverageId, status, issues, contractLineId: line?.id ?? null, copay };
}

export class CoverageInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoverageInputError';
  }
}
