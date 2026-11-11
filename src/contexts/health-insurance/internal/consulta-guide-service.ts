/**
 * Atendimento concluído por convênio → Guia de Consulta (P7.4, persistência da P1.8).
 *
 * Roda DENTRO da transação de quem chama (o handler de `appointment.completed`
 * abre `withTenant`). Regras:
 *  - particular ou sem modalidade: nada no convênio; módulo desligado na
 *    clínica: nada;
 *  - idempotente pela chave de origem `appointment:<id>:consulta`: reentrega do
 *    evento devolve a guia existente, sem consumir número; corrida entre duas
 *    entregas termina com uma guia só (UNIQUE no banco, recuperado aqui);
 *  - o código TUSS e o valor vêm SÓ do contrato vigente ligado ao procedimento
 *    do Qoro (`hi_procedure_contracts.procedure_id`); nada é digitado;
 *  - nenhuma informação clínica: não recebe prontuário, não exige CID;
 *  - a carteirinha NÃO é decifrada aqui (o plano só precisa saber se existe);
 *    ela só é lida, com auditoria, na emissão;
 *  - autorização: se o contrato exige, liga a autorização CONCEDIDA pela
 *    operadora quando há exatamente uma válida na data; senão, pendência. Nunca
 *    presume autorização;
 *  - dado faltando vira pendência com responsável, e a guia nasce em
 *    `pending_data`; sem pendência, `ready_for_review`. Retorno não faturável
 *    não vira guia;
 *  - o número (P7.1) é alocado na MESMA transação, só quando a guia vai mesmo
 *    ser gravada; se a gravação falhar, o número volta.
 */
import 'server-only';

import { and, eq, inArray, lt, max, notInArray } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

import {
  hiAuthorizations,
  hiClinicSettings,
  hiGuideItems,
  hiGuides,
  hiInsurers,
  hiMemberships,
  hiProcedureContracts,
  hiProfessionalProfiles,
} from '../schema-clinic';
import { planConsultaGuide } from '../tiss/assembly/consulta-assembler';
import type { ContractLine } from '../tiss/assembly/contract-selection';
import type { GuideIssue } from '../tiss/validation/common';

import { allocateTissNumber } from './numbering';

export interface CompletedAppointment {
  id: string;
  patientId: string;
  /** `profiles.id` do profissional que atendeu. */
  professionalId: string;
  /** `procedures.id` do Qoro. */
  procedureId: string;
  /** `AAAA-MM-DD`, no fuso da clínica. */
  date: string;
  billingMode: 'particular' | 'convenio' | null;
}

/** Cobertura do atendimento (P1.6): operadora, plano e carteirinha escolhidos na recepção. */
export interface AppointmentCoverage {
  insurerId: string;
  planId: string | null;
  membershipId: string | null;
  /** Autorização escolhida na cobertura; sem ela, a única concedida válida na data. */
  authorizationId?: string | null;
}

export type ConsultaGuideOutcome =
  | { kind: 'not_insurance' }
  | { kind: 'module_disabled' }
  | { kind: 'needs_coverage' }
  | { kind: 'existing'; guideId: string; number: string }
  | { kind: 'skipped_return'; reason: string }
  | { kind: 'live_guide_exists' }
  | {
      kind: 'created';
      guideId: string;
      number: string;
      status: 'pending_data' | 'ready_for_review';
      issues: GuideIssue[];
    };

export const consultaGuideKey = (appointmentId: string): string =>
  `appointment:${appointmentId}:consulta`;

function pgError(e: unknown): { code: string | undefined; constraint: string | undefined } {
  const err = e as { code?: string; constraint_name?: string; cause?: unknown };
  if (err?.code) return { code: err.code, constraint: err.constraint_name };
  const cause = err?.cause as { code?: string; constraint_name?: string } | undefined;
  return { code: cause?.code, constraint: cause?.constraint_name };
}

async function findByKey(tx: Tx, clinicId: string, key: string) {
  const [row] = await tx
    .select({ id: hiGuides.id, number: hiGuides.number })
    .from(hiGuides)
    .where(and(eq(hiGuides.clinicId, clinicId), eq(hiGuides.idempotencyKey, key)))
    .limit(1);
  return row ?? null;
}

const issue = (
  code: string,
  field: string,
  message: string,
  owner: GuideIssue['owner'],
): GuideIssue => ({ code, field, message, owner });

export async function createConsultaGuideForAppointment(
  tx: Tx,
  args: {
    clinicId: string;
    appointment: CompletedAppointment;
    coverage: AppointmentCoverage | null;
    /** Versão de terminologia em uso (`tiss_terminology_versions.version`). */
    terminologyVersion: string | null;
    actor: { kind: 'automation' } | { kind: 'user'; userId: string };
  },
): Promise<ConsultaGuideOutcome> {
  const { clinicId, appointment: ap } = args;
  if (ap.billingMode !== 'convenio') return { kind: 'not_insurance' };

  const [settings] = await tx
    .select()
    .from(hiClinicSettings)
    .where(eq(hiClinicSettings.clinicId, clinicId))
    .limit(1);
  if (!settings?.enabled) return { kind: 'module_disabled' };

  const key = consultaGuideKey(ap.id);
  const existing = await findByKey(tx, clinicId, key);
  if (existing) return { kind: 'existing', guideId: existing.id, number: existing.number };
  if (!args.coverage) return { kind: 'needs_coverage' };
  const coverage = args.coverage;

  const [insurer] = await tx
    .select()
    .from(hiInsurers)
    .where(and(eq(hiInsurers.clinicId, clinicId), eq(hiInsurers.id, coverage.insurerId)))
    .limit(1);
  if (!insurer) return { kind: 'needs_coverage' };

  const extra: GuideIssue[] = [];
  if (insurer.status !== 'active') {
    extra.push(
      issue(
        'INSURER_NOT_ACTIVE',
        'operadora',
        'A operadora do atendimento não está ativa no cadastro da clínica.',
        'gestor',
      ),
    );
  }

  // Carteirinha: só liga a do mesmo paciente e da mesma operadora (o banco confere de novo).
  let membershipId: string | null = null;
  if (coverage.membershipId) {
    const [card] = await tx
      .select({
        id: hiMemberships.id,
        patientId: hiMemberships.patientId,
        insurerId: hiMemberships.insurerId,
        status: hiMemberships.status,
        validUntil: hiMemberships.validUntil,
      })
      .from(hiMemberships)
      .where(and(eq(hiMemberships.clinicId, clinicId), eq(hiMemberships.id, coverage.membershipId)))
      .limit(1);
    if (card && card.patientId === ap.patientId && card.insurerId === insurer.id) {
      membershipId = card.id;
      if (card.status !== 'active') {
        extra.push(
          issue(
            'MEMBERSHIP_NOT_ACTIVE',
            'beneficiario.numeroCarteira',
            'A carteirinha escolhida não está ativa. Escolha a carteirinha vigente do paciente.',
            'recepcao',
          ),
        );
      } else if (card.validUntil && card.validUntil < ap.date) {
        extra.push(
          issue(
            'MEMBERSHIP_EXPIRED',
            'beneficiario.numeroCarteira',
            `A carteirinha venceu em ${card.validUntil}, antes do atendimento.`,
            'recepcao',
          ),
        );
      }
    }
  }

  const [profile] = await tx
    .select()
    .from(hiProfessionalProfiles)
    .where(
      and(
        eq(hiProfessionalProfiles.clinicId, clinicId),
        eq(hiProfessionalProfiles.professionalId, ap.professionalId),
      ),
    )
    .limit(1);

  // Contratos de Consulta da operadora; o TUSS sai da linha ligada ao procedimento do Qoro.
  const lines = await tx
    .select()
    .from(hiProcedureContracts)
    .where(
      and(
        eq(hiProcedureContracts.clinicId, clinicId),
        eq(hiProcedureContracts.insurerId, insurer.id),
        eq(hiProcedureContracts.guideType, 'consulta'),
      ),
    );
  const contracts: ContractLine[] = lines.map((l) => ({
    ...l,
    guideType: l.guideType,
    copayPercentage: l.copayPercentage,
  }));
  const codes = [
    ...new Set(
      lines
        .filter((l) => l.procedureId === ap.procedureId)
        .map((l) => `${l.tableCode}:${l.procedureCode}`),
    ),
  ];
  let procedure = { tableCode: '', procedureCode: '' };
  let mappingIssue: GuideIssue | null = null;
  if (codes.length === 1) {
    const [tableCode, procedureCode] = codes[0]!.split(':') as [string, string];
    procedure = { tableCode, procedureCode };
  } else {
    mappingIssue =
      codes.length === 0
        ? issue(
            'PROCEDURE_NOT_CONTRACTED',
            'atendimento.procedimento',
            'O procedimento do atendimento não tem código TUSS no contrato desta operadora.',
            'gestor',
          )
        : issue(
            'PROCEDURE_CODE_AMBIGUOUS',
            'atendimento.procedimento',
            `O procedimento do atendimento está ligado a ${codes.length} códigos TUSS diferentes no contrato desta operadora.`,
            'gestor',
          );
  }

  // Última Consulta viva do mesmo paciente, profissional e operadora (janela de retorno).
  const [prev] = await tx
    .select({ last: max(hiGuideItems.executedOn) })
    .from(hiGuideItems)
    .innerJoin(
      hiGuides,
      and(eq(hiGuides.clinicId, hiGuideItems.clinicId), eq(hiGuides.id, hiGuideItems.guideId)),
    )
    .where(
      and(
        eq(hiGuides.clinicId, clinicId),
        eq(hiGuides.guideType, 'consulta'),
        eq(hiGuides.patientId, ap.patientId),
        eq(hiGuides.insurerId, insurer.id),
        eq(hiGuides.executantProfessionalId, ap.professionalId),
        notInArray(hiGuides.status, ['cancelled', 'replaced']),
        lt(hiGuideItems.executedOn, ap.date),
      ),
    );

  const plan = planConsultaGuide({
    clinic: {
      providerKind: settings.providerKind ?? 'PJ',
      cnesStatus: settings.cnesStatus,
      cnes: settings.cnes,
    },
    insurer: {
      id: insurer.id,
      registroAns: insurer.registroAns,
      providerIdKind: insurer.providerIdKind,
      providerIdValue: insurer.providerIdValue,
    },
    planId: coverage.planId,
    hasMembership: membershipId !== null,
    professional: profile
      ? {
          name: null,
          council: profile.council,
          councilNumber: profile.councilNumber,
          councilUf: profile.councilUf,
          cbo: profile.cbo,
        }
      : null,
    procedure,
    contracts,
    appointment: { date: ap.date, previousConsultationDate: prev?.last ?? null },
  });
  if (plan.decision === 'skip_return') return { kind: 'skipped_return', reason: plan.reason };

  const planIssues = plan.decision === 'blocked' ? plan.issues : [];
  const issues = [
    ...(mappingIssue ? [mappingIssue] : []),
    // Sem mapeamento, o "contrato não encontrado" do plano é consequência, não outra pendência.
    ...planIssues.filter((i) => !(mappingIssue && i.code === 'CONTRACT_NOT_FOUND')),
    ...extra,
  ];
  if (!settings.providerKind) {
    issues.push(
      issue(
        'PROVIDER_KIND_UNKNOWN',
        'contratado',
        'Informe se a clínica fatura como pessoa jurídica ou física.',
        'gestor',
      ),
    );
  }
  const line = plan.decision === 'bill' ? plan.line : plan.line;

  // Autorização concedida pela operadora, quando o contrato exige. Nunca presumida.
  let authorizationId: string | null = null;
  if (line?.requiresAuthorization) {
    const candidates = membershipId
      ? await tx
          .select({
            id: hiAuthorizations.id,
            authorizedOn: hiAuthorizations.authorizedOn,
            validUntil: hiAuthorizations.passwordValidUntil,
          })
          .from(hiAuthorizations)
          .where(
            and(
              eq(hiAuthorizations.clinicId, clinicId),
              eq(hiAuthorizations.insurerId, insurer.id),
              eq(hiAuthorizations.membershipId, membershipId),
              eq(hiAuthorizations.guideType, 'consulta'),
              inArray(hiAuthorizations.status, ['authorized', 'partially_authorized']),
            ),
          )
      : [];
    const valid = candidates.filter(
      (a) =>
        (!coverage.authorizationId || a.id === coverage.authorizationId) &&
        a.authorizedOn !== null &&
        a.authorizedOn <= ap.date &&
        (a.validUntil === null || a.validUntil >= ap.date),
    );
    if (valid.length === 1) authorizationId = valid[0]!.id;
    else {
      issues.push(
        valid.length === 0
          ? issue(
              'AUTHORIZATION_MISSING',
              'autorizacao',
              'O contrato exige autorização da operadora e não há autorização concedida válida na data do atendimento.',
              'recepcao',
            )
          : issue(
              'AUTHORIZATION_AMBIGUOUS',
              'autorizacao',
              `Há ${valid.length} autorizações válidas para esta carteirinha na data; escolha a correta.`,
              'recepcao',
            ),
      );
    }
  }

  const status = issues.length > 0 ? 'pending_data' : 'ready_for_review';
  try {
    return await tx.transaction(async (sp) => {
      const number = await allocateTissNumber(sp, { clinicId, kind: 'guide' });
      const [guide] = await sp
        .insert(hiGuides)
        .values({
          clinicId,
          guideType: 'consulta',
          number,
          insurerId: insurer.id,
          planId: coverage.planId,
          patientId: ap.patientId,
          membershipId,
          authorizationId,
          executantProfessionalId: ap.professionalId,
          status,
          live: true,
          revision: 1,
          version: 1,
          tissVersion: '4.03.00',
          terminologyVersion: args.terminologyVersion,
          issues,
          expectedValueCents: line ? line.unitValueCents : null,
          totalValueCents: line ? line.unitValueCents : 0,
          idempotencyKey: key,
          createdVia: args.actor.kind === 'user' ? 'user' : 'automation',
          createdBy: args.actor.kind === 'user' ? args.actor.userId : null,
        })
        .returning({ id: hiGuides.id, number: hiGuides.number });
      if (line) {
        await sp.insert(hiGuideItems).values({
          clinicId,
          guideId: guide!.id,
          guideType: 'consulta',
          live: true,
          sequence: 1,
          appointmentId: ap.id,
          contractLineId: line.id,
          executedOn: ap.date,
          tableCode: line.tableCode,
          procedureCode: line.procedureCode,
          description: line.description,
          quantity: 1,
          factorHundredths: 100,
          unitValueCents: line.unitValueCents,
          totalValueCents: line.unitValueCents,
        });
      }
      return {
        kind: 'created' as const,
        guideId: guide!.id,
        number: guide!.number,
        status,
        issues,
      };
    });
  } catch (e) {
    const { code, constraint } = pgError(e);
    if (code === '23505' && constraint === 'hi_guides_idem_uniq') {
      const winner = await findByKey(tx, clinicId, key);
      if (winner) return { kind: 'existing', guideId: winner.id, number: winner.number };
    }
    if (code === '23505' && constraint === 'hi_guide_items_live_consulta_uniq') {
      return { kind: 'live_guide_exists' };
    }
    throw e;
  }
}
