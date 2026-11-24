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
import { assertPremiumFeatureTx } from '@/lib/premium-access';

import {
  hiAuthorizationConsumptions,
  hiAuthorizationItems,
  hiAuthorizations,
  hiClinicSettings,
  hiGuideEvents,
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

import { credentialingIssuesTx } from './credentialing';
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
    /** Chave da guia nova depois de uma CANCELADA antes do envio (guide-reissue). Padrão: a do atendimento. */
    idempotencyKey?: string;
  },
): Promise<ConsultaGuideOutcome> {
  const { clinicId, appointment: ap } = args;
  if (ap.billingMode !== 'convenio') return { kind: 'not_insurance' };
  // D24: operação nova de Convênios só com assinatura paga e ativa (o banco confere de novo).
  await assertPremiumFeatureTx(tx, clinicId, 'health_insurance');

  const [settings] = await tx
    .select()
    .from(hiClinicSettings)
    .where(eq(hiClinicSettings.clinicId, clinicId))
    .limit(1);
  if (!settings?.enabled) return { kind: 'module_disabled' };

  const key = args.idempotencyKey ?? consultaGuideKey(ap.id);
  const existing = await findByKey(tx, clinicId, key);
  if (existing) return { kind: 'existing', guideId: existing.id, number: existing.number };
  if (!args.coverage) return { kind: 'needs_coverage' };

  const derived = await deriveConsultaGuide(tx, {
    clinicId,
    appointment: ap,
    coverage: args.coverage,
    settings,
  });
  if (derived.kind !== 'derived') return derived;
  const { insurerId, membershipId, line, authorizationId, authorizationItemId, issues, status } = derived;
  const coverage = args.coverage;
  try {
    return await tx.transaction(async (sp) => {
      if (authorizationItemId) {
        await consumeAuthorizationTx(sp, clinicId, ap.id, authorizationItemId, args.actor.kind === 'user' ? args.actor.userId : ap.professionalId);
      }
      const number = await allocateTissNumber(sp, { clinicId, kind: 'guide' });
      const [guide] = await sp
        .insert(hiGuides)
        .values({
          clinicId,
          guideType: 'consulta',
          number,
          insurerId,
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
        await sp.insert(hiGuideItems).values(itemValues(clinicId, guide!.id, ap, line));
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

type ClinicSettings = typeof hiClinicSettings.$inferSelect;

type Derivation =
  | { kind: 'needs_coverage' }
  | { kind: 'skipped_return'; reason: string }
  | {
      kind: 'derived';
      insurerId: string;
      membershipId: string | null;
      line: ContractLine | null;
      authorizationId: string | null;
      /** Item da autorização que esta guia consome (P4.7): uma unidade por atendimento. */
      authorizationItemId: string | null;
      issues: GuideIssue[];
      status: 'pending_data' | 'ready_for_review';
    };

/** Chave do consumo da autorização por atendimento: a guia refeita do mesmo atendimento não consome de novo. */
const consumptionKey = (appointmentId: string, itemId: string) => `consulta:${appointmentId}:${itemId}`;

/**
 * P4.7: consome UMA unidade do item da autorização para este atendimento (idempotente pela chave). O
 * gatilho da 0146 trava o item e recusa consumo acima do autorizado, inclusive em corrida.
 */
async function consumeAuthorizationTx(tx: Tx, clinicId: string, appointmentId: string, itemId: string, actorId: string): Promise<void> {
  const key = consumptionKey(appointmentId, itemId);
  const [done] = await tx
    .select({ id: hiAuthorizationConsumptions.id })
    .from(hiAuthorizationConsumptions)
    .where(and(eq(hiAuthorizationConsumptions.clinicId, clinicId), eq(hiAuthorizationConsumptions.idempotencyKey, key)))
    .limit(1);
  if (!done) {
    await tx.insert(hiAuthorizationConsumptions).values({ clinicId, itemId, quantity: 1, idempotencyKey: key, createdBy: actorId });
  }
}

function itemValues(clinicId: string, guideId: string, ap: CompletedAppointment, line: ContractLine) {
  return {
    clinicId,
    guideId,
    guideType: 'consulta' as const,
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
  };
}

/**
 * As regras da Guia de Consulta, sem gravar nada: operadora, carteirinha, contrato
 * do procedimento, janela de retorno, autorização concedida e pendências. A criação
 * e a reavaliação de uma guia em edição usam exatamente esta derivação.
 */
async function deriveConsultaGuide(
  tx: Tx,
  args: {
    clinicId: string;
    appointment: CompletedAppointment;
    coverage: AppointmentCoverage;
    settings: ClinicSettings;
  },
): Promise<Derivation> {
  const { clinicId, appointment: ap, coverage, settings } = args;
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

  // Credenciamento vigente na DATA do atendimento (P2.2): suspenso ou encerrado depois do
  // agendamento também segura a guia antes da emissão.
  extra.push(
    ...(await credentialingIssuesTx(tx, {
      clinicId,
      insurerId: insurer.id,
      planId: coverage.planId,
      professionalId: ap.professionalId,
      date: ap.date,
    })),
  );

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
  let authorizationItemId: string | null = null;
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
    // P4.7: só serve a autorização com SALDO no item do procedimento (ou que este mesmo atendimento já
    // consumiu). Numa série de consultas, a autorização de 1 unidade não cobre a segunda.
    const items = valid.length
      ? await tx
          .select({
            id: hiAuthorizationItems.id,
            authorizationId: hiAuthorizationItems.authorizationId,
            authorized: hiAuthorizationItems.quantityAuthorized,
            consumed: hiAuthorizationItems.quantityConsumed,
          })
          .from(hiAuthorizationItems)
          .where(
            and(
              eq(hiAuthorizationItems.clinicId, clinicId),
              inArray(
                hiAuthorizationItems.authorizationId,
                valid.map((a) => a.id),
              ),
              eq(hiAuthorizationItems.tableCode, line.tableCode),
              eq(hiAuthorizationItems.procedureCode, line.procedureCode),
            ),
          )
      : [];
    const mine = items.length
      ? await tx
          .select({ key: hiAuthorizationConsumptions.idempotencyKey })
          .from(hiAuthorizationConsumptions)
          .where(
            and(
              eq(hiAuthorizationConsumptions.clinicId, clinicId),
              inArray(
                hiAuthorizationConsumptions.idempotencyKey,
                items.map((i) => consumptionKey(ap.id, i.id)),
              ),
            ),
          )
      : [];
    const withBalance = items.filter(
      (i) => mine.some((m) => m.key === consumptionKey(ap.id, i.id)) || (i.consumed ?? 0) < (i.authorized ?? 0),
    );
    if (withBalance.length === 1) {
      authorizationId = withBalance[0]!.authorizationId;
      authorizationItemId = withBalance[0]!.id;
    } else if (valid.length > 0 && items.length === 0) {
      issues.push(
        issue(
          'AUTHORIZATION_PROCEDURE_MISSING',
          'autorizacao',
          'A autorização concedida para esta carteirinha não inclui este procedimento. Confira a autorização ou peça uma nova à operadora.',
          'recepcao',
        ),
      );
    } else if (withBalance.length === 0 && valid.length > 0) {
      issues.push(
        issue(
          'AUTHORIZATION_EXHAUSTED',
          'autorizacao',
          'A autorização concedida para esta carteirinha já foi usada por outros atendimentos (saldo esgotado). Peça uma nova autorização à operadora.',
          'recepcao',
        ),
      );
    } else {
      issues.push(
        withBalance.length === 0
          ? issue(
              'AUTHORIZATION_MISSING',
              'autorizacao',
              'O contrato exige autorização da operadora e não há autorização concedida válida na data do atendimento.',
              'recepcao',
            )
          : issue(
              'AUTHORIZATION_AMBIGUOUS',
              'autorizacao',
              `Há ${withBalance.length} autorizações válidas com saldo para esta carteirinha na data; escolha a correta.`,
              'recepcao',
            ),
      );
    }
  }

  const status = issues.length > 0 ? 'pending_data' : 'ready_for_review';
  return {
    kind: 'derived',
    insurerId: insurer.id,
    membershipId,
    line: line ?? null,
    authorizationId,
    authorizationItemId,
    issues,
    status,
  };
}

export type ConsultaRefreshOutcome =
  | { kind: 'refreshed'; guideId: string; status: 'pending_data' | 'ready_for_review'; issues: GuideIssue[] }
  | { kind: 'unchanged'; guideId: string; issues: GuideIssue[] }
  | { kind: 'not_refreshable'; reason: 'not_pending' | 'not_automatic' | 'edited_by_user' | 'insurer_changed' | 'module_disabled' | 'version_conflict' }
  | { kind: 'return_detected'; reason: string }
  | { kind: 'needs_coverage' };

/**
 * Reavalia uma Guia de Consulta que nasceu automaticamente com pendências (P7.4),
 * depois que a cobertura, o contrato ou a autorização foram corrigidos.
 *
 * Só toca a guia que é do automático e ainda está intocada: `pending_data`, chave de
 * origem do atendimento e nenhum evento de usuário no histórico. Se um humano já
 * mexeu, a guia é dele (a pendência aponta o responsável). Mesmas regras da criação
 * (`deriveConsultaGuide`); número e operadora não mudam; concorrência otimista pela
 * versão da guia. Nada é presumido: sem autorização concedida, continua pendente.
 */
export async function refreshConsultaGuide(
  tx: Tx,
  args: {
    clinicId: string;
    guideId: string;
    appointment: CompletedAppointment;
    coverage: AppointmentCoverage | null;
    terminologyVersion: string | null;
  },
): Promise<ConsultaRefreshOutcome> {
  const { clinicId, appointment: ap } = args;
  // D24: operação nova de Convênios só com assinatura paga e ativa (o banco confere de novo).
  await assertPremiumFeatureTx(tx, clinicId, 'health_insurance');
  const [guide] = await tx
    .select({
      id: hiGuides.id,
      status: hiGuides.status,
      version: hiGuides.version,
      insurerId: hiGuides.insurerId,
      idempotencyKey: hiGuides.idempotencyKey,
      issues: hiGuides.issues,
    })
    .from(hiGuides)
    .where(and(eq(hiGuides.clinicId, clinicId), eq(hiGuides.id, args.guideId)))
    .limit(1);
  if (!guide || guide.status !== 'pending_data') return { kind: 'not_refreshable', reason: 'not_pending' };
  if (guide.idempotencyKey !== consultaGuideKey(ap.id)) {
    return { kind: 'not_refreshable', reason: 'not_automatic' };
  }
  const [userEvent] = await tx
    .select({ id: hiGuideEvents.id })
    .from(hiGuideEvents)
    .where(
      and(
        eq(hiGuideEvents.clinicId, clinicId),
        eq(hiGuideEvents.guideId, guide.id),
        eq(hiGuideEvents.actorKind, 'user'),
      ),
    )
    .limit(1);
  if (userEvent) return { kind: 'not_refreshable', reason: 'edited_by_user' };

  const [settings] = await tx
    .select()
    .from(hiClinicSettings)
    .where(eq(hiClinicSettings.clinicId, clinicId))
    .limit(1);
  if (!settings?.enabled) return { kind: 'not_refreshable', reason: 'module_disabled' };
  if (!args.coverage) return { kind: 'needs_coverage' };
  if (args.coverage.insurerId !== guide.insurerId) {
    return { kind: 'not_refreshable', reason: 'insurer_changed' };
  }

  const derived = await deriveConsultaGuide(tx, {
    clinicId,
    appointment: ap,
    coverage: args.coverage,
    settings,
  });
  if (derived.kind === 'needs_coverage') return derived;
  if (derived.kind === 'skipped_return') return { kind: 'return_detected', reason: derived.reason };
  const { line, membershipId, authorizationId, authorizationItemId, issues, status } = derived;

  return tx.transaction(async (sp) => {
    if (authorizationItemId) {
      // Reavaliação é do automático: o consumo fica com o profissional do atendimento (a chave aponta o atendimento).
      await consumeAuthorizationTx(sp, clinicId, ap.id, authorizationItemId, ap.professionalId);
    }
    const items = await sp
      .select({
        id: hiGuideItems.id,
        contractLineId: hiGuideItems.contractLineId,
        unitValueCents: hiGuideItems.unitValueCents,
        executedOn: hiGuideItems.executedOn,
      })
      .from(hiGuideItems)
      .where(and(eq(hiGuideItems.clinicId, clinicId), eq(hiGuideItems.guideId, guide.id)));
    const keep =
      line !== null &&
      items.length === 1 &&
      items[0]!.contractLineId === line.id &&
      items[0]!.unitValueCents === line.unitValueCents &&
      items[0]!.executedOn === ap.date;
    const updated = await sp
      .update(hiGuides)
      .set({
        planId: args.coverage!.planId,
        membershipId,
        authorizationId,
        issues,
        terminologyVersion: args.terminologyVersion,
        expectedValueCents: line ? line.unitValueCents : null,
        totalValueCents: line ? line.unitValueCents : 0,
      })
      .where(
        and(
          eq(hiGuides.clinicId, clinicId),
          eq(hiGuides.id, guide.id),
          eq(hiGuides.version, guide.version),
          eq(hiGuides.status, 'pending_data'),
        ),
      )
      .returning({ id: hiGuides.id });
    if (updated.length === 0) return { kind: 'not_refreshable' as const, reason: 'version_conflict' as const };
    if (!keep) {
      if (items.length > 0) {
        await sp.delete(hiGuideItems).where(
          and(
            eq(hiGuideItems.clinicId, clinicId),
            inArray(
              hiGuideItems.id,
              items.map((i) => i.id),
            ),
          ),
        );
      }
      if (line) await sp.insert(hiGuideItems).values(itemValues(clinicId, guide.id, ap, line));
    }
    if (status === 'ready_for_review') {
      await sp
        .update(hiGuides)
        .set({ status: 'ready_for_review' })
        .where(and(eq(hiGuides.clinicId, clinicId), eq(hiGuides.id, guide.id)));
      return { kind: 'refreshed' as const, guideId: guide.id, status, issues };
    }
    const sameIssues = JSON.stringify(guide.issues) === JSON.stringify(issues) && keep;
    return sameIssues
      ? { kind: 'unchanged' as const, guideId: guide.id, issues }
      : { kind: 'refreshed' as const, guideId: guide.id, status, issues };
  });
}
