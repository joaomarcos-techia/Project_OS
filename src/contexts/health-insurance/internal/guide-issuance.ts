/**
 * Emissão da Guia de Consulta (P7.5): conferida → APROVADA, com o conteúdo TISS
 * congelado num snapshot CIFRADO por clínica e com SHA-256.
 *
 * Fluxo (`approveConsultaGuide`, chamado pela Server Action da tela P7.7):
 *  1. permissão fresca de faturamento;
 *  2. a carteirinha é lida pela via AUDITADA (`readMembershipCardNumberAudited`,
 *     finalidade `geracao_guia`); a leitura fica registrada mesmo se a emissão
 *     falhar depois, porque ela aconteceu;
 *  3. numa transação só (`issueConsultaGuide`): monta o dado TISS a partir do que
 *     foi CONFERIDO (item, contrato do item, número, autorização), valida com a
 *     terminologia da guia, serializa em JSON canônico, cifra, grava o snapshot da
 *     revisão atual e aprova a guia com concorrência otimista. Se qualquer passo
 *     falhar, nada fica: nem snapshot órfão, nem aprovação sem snapshot (o banco
 *     também exige o snapshot da revisão na aprovação, 0147).
 *
 * O conteúdo emitido não depende de mudanças posteriores no cadastro do paciente
 * ou no contrato: é o snapshot que vale para PDF, XML e conferência (lidos por
 * `guide-access.ts`, que confere o SHA-256 a cada leitura).
 */
import 'server-only';

import { and, eq, inArray, lt, max, ne, notInArray, sql } from 'drizzle-orm';

import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireFreshPermission, requireUser } from '@/lib/auth/tenant-context';
import { encryptForTenant } from '@/lib/crypto/encryption';
import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { assertPremiumFeatureTx } from '@/lib/premium-access';

import { tissTerminologyVersions, tissTerms } from '../schema';
import {
  hiAuthorizations,
  hiClinicSettings,
  hiGuideItems,
  hiGuideSnapshots,
  hiGuides,
  hiInsurers,
  hiProcedureContracts,
  hiProfessionalProfiles,
} from '../schema-clinic';
import { assembleConsultaGuide } from '../tiss/assembly/consulta-assembler';
import type { ContractLine } from '../tiss/assembly/contract-selection';
import { serializeGuideSnapshot, type GuideSnapshotContent } from '../tiss/guides/snapshot';
import { inMemoryLookup } from '../tiss/terminology/lookup';
import type { TerminologyTerm } from '../tiss/terminology/official-sheet';
import type { GuideIssue } from '../tiss/validation/common';
import { validateConsultaGuide } from '../tiss/validation/consulta-validator';

import { readMembershipCardNumberAudited, type CardNumberRead } from './membership-access';

export class GuideIssuanceError extends Error {
  constructor(
    message: string,
    readonly issues: GuideIssue[] = [],
  ) {
    super(message);
    this.name = 'GuideIssuanceError';
  }
}

/**
 * Tabelas de domínio pequenas que o validador da Consulta consulta inteiras
 * (conselho, indicação de acidente, tipo de consulta, UF, ausência de código de
 * validação, cobertura especial, regime, saúde ocupacional, tabela de referência).
 */
export const CONSULTA_DOMAIN_TABLES = [
  '26',
  '36',
  '52',
  '59',
  '74',
  '75',
  '76',
  '77',
  '87',
] as const;

/** Termos da guia na versão dela: as tabelas de domínio inteiras; da 22 (TUSS) e da 24 (CBO), só os códigos usados. */
async function loadTerms(
  tx: Tx,
  version: string,
  needs: ReadonlyArray<[table: string, code: string]>,
) {
  const [v] = await tx
    .select({ id: tissTerminologyVersions.id })
    .from(tissTerminologyVersions)
    .where(eq(tissTerminologyVersions.version, version))
    .limit(1);
  if (!v) throw new GuideIssuanceError(`terminologia ${version} não carregada`);
  const tables: Record<string, TerminologyTerm[]> = {};
  const domain = await tx
    .select({
      tableCode: tissTerms.tableCode,
      code: tissTerms.code,
      term: tissTerms.term,
      startsOn: tissTerms.startsOn,
      endsOn: tissTerms.endsOn,
      implantationEndsOn: tissTerms.implantationEndsOn,
    })
    .from(tissTerms)
    .where(
      and(eq(tissTerms.versionId, v.id), inArray(tissTerms.tableCode, [...CONSULTA_DOMAIN_TABLES])),
    );
  for (const { tableCode, ...term } of domain)
    tables[tableCode] = [...(tables[tableCode] ?? []), term];
  for (const [table, code] of needs) {
    const rows = await tx
      .select({
        code: tissTerms.code,
        term: tissTerms.term,
        startsOn: tissTerms.startsOn,
        endsOn: tissTerms.endsOn,
        implantationEndsOn: tissTerms.implantationEndsOn,
      })
      .from(tissTerms)
      .where(
        and(
          eq(tissTerms.versionId, v.id),
          eq(tissTerms.tableCode, table),
          inArray(tissTerms.code, [code]),
        ),
      );
    tables[table] = [...(tables[table] ?? []), ...rows];
  }
  return inMemoryLookup(version, tables);
}

export interface IssueArgs {
  clinicId: string;
  guideId: string;
  /** Leitura auditada da carteirinha DA GUIA (conferida contra `membership_id`). */
  card: CardNumberRead;
  newborn: boolean;
  professionalName: string | null;
  actorUserId: string;
  /** `AAAA-MM-DD` de hoje no fuso da clínica (regra de "atendimento no futuro"). */
  today: string;
}

/** Núcleo transacional da emissão. Roda na transação do chamador. */
export async function issueConsultaGuide(
  tx: Tx,
  args: IssueArgs,
): Promise<{ snapshotId: string; revision: number; sha256: string }> {
  const { clinicId } = args;
  // D24: operação nova de Convênios só com assinatura paga e ativa (o banco confere de novo).
  await assertPremiumFeatureTx(tx, clinicId, 'health_insurance');
  const [g] = await tx
    .select()
    .from(hiGuides)
    .where(and(eq(hiGuides.clinicId, clinicId), eq(hiGuides.id, args.guideId)))
    .limit(1);
  if (!g) throw new GuideIssuanceError('guia inexistente nesta clínica');
  if (g.guideType !== 'consulta')
    throw new GuideIssuanceError('esta emissão é da Guia de Consulta');
  if (g.status !== 'reviewed') {
    throw new GuideIssuanceError(`só se emite guia conferida (estado: ${g.status})`);
  }
  if (!g.membershipId || g.membershipId !== args.card.membershipId) {
    throw new GuideIssuanceError('a carteirinha lida não é a da guia');
  }
  if (!g.terminologyVersion) throw new GuideIssuanceError('a guia não tem versão de terminologia');

  const [item] = await tx
    .select()
    .from(hiGuideItems)
    .where(and(eq(hiGuideItems.clinicId, clinicId), eq(hiGuideItems.guideId, g.id)))
    .limit(1);
  if (!item) throw new GuideIssuanceError('a guia não tem procedimento');
  const [settings] = await tx
    .select()
    .from(hiClinicSettings)
    .where(eq(hiClinicSettings.clinicId, clinicId))
    .limit(1);
  const [insurer] = await tx
    .select()
    .from(hiInsurers)
    .where(and(eq(hiInsurers.clinicId, clinicId), eq(hiInsurers.id, g.insurerId)))
    .limit(1);
  const [line] = await tx
    .select()
    .from(hiProcedureContracts)
    .where(
      and(
        eq(hiProcedureContracts.clinicId, clinicId),
        eq(hiProcedureContracts.id, item.contractLineId),
      ),
    )
    .limit(1);
  const [profile] = g.executantProfessionalId
    ? await tx
        .select()
        .from(hiProfessionalProfiles)
        .where(
          and(
            eq(hiProfessionalProfiles.clinicId, clinicId),
            eq(hiProfessionalProfiles.professionalId, g.executantProfessionalId),
          ),
        )
        .limit(1)
    : [];
  const [auth] = g.authorizationId
    ? await tx
        .select({ operatorGuideNumber: hiAuthorizations.operatorGuideNumber })
        .from(hiAuthorizations)
        .where(
          and(eq(hiAuthorizations.clinicId, clinicId), eq(hiAuthorizations.id, g.authorizationId)),
        )
        .limit(1)
    : [];
  if (!settings || !insurer || !line) throw new GuideIssuanceError('cadastro da guia incompleto');

  // Retorno: a Consulta anterior viva do mesmo paciente, profissional e operadora (sem esta guia).
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
        ne(hiGuides.id, g.id),
        eq(hiGuides.guideType, 'consulta'),
        eq(hiGuides.patientId, g.patientId),
        eq(hiGuides.insurerId, g.insurerId),
        eq(hiGuides.executantProfessionalId, g.executantProfessionalId ?? sql`NULL`),
        notInArray(hiGuides.status, ['cancelled', 'replaced']),
        lt(hiGuideItems.executedOn, item.executedOn),
      ),
    );

  const assembly = assembleConsultaGuide({
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
    planId: g.planId,
    membership: { cardNumber: args.card.cardNumber, newborn: args.newborn },
    professional: profile
      ? {
          name: args.professionalName,
          council: profile.council,
          councilNumber: profile.councilNumber,
          councilUf: profile.councilUf,
          cbo: profile.cbo,
        }
      : null,
    procedure: { tableCode: item.tableCode, procedureCode: item.procedureCode },
    // O contrato DO ITEM conferido (não uma nova escolha): a emissão reproduz o que foi conferido.
    contracts: [{ ...(line as unknown as ContractLine), supersedesId: null }],
    appointment: { date: item.executedOn, previousConsultationDate: prev?.last ?? null },
    guideNumber: g.number,
    authorization: { operatorGuideNumber: auth?.operatorGuideNumber ?? null },
  });
  if (assembly.decision === 'blocked') {
    throw new GuideIssuanceError('a guia conferida tem pendências', assembly.issues);
  }
  if (assembly.decision === 'skip_return') {
    throw new GuideIssuanceError(`retorno não faturável: ${assembly.reason}`);
  }

  const terminology = await loadTerms(tx, g.terminologyVersion, [
    ['22', item.procedureCode],
    ['24', profile!.cbo],
  ]);
  const errors = validateConsultaGuide(assembly.guide, {
    terminology,
    contractorPerson: settings.providerKind ?? 'PJ',
    today: args.today,
  });
  if (errors.length > 0) throw new GuideIssuanceError('a guia não passa na validação TISS', errors);

  const content: GuideSnapshotContent = {
    schema: 'qoro.hi.guide-snapshot/1',
    guideType: 'consulta',
    tissVersion: '4.03.00',
    terminologyVersion: g.terminologyVersion,
    data: assembly.guide,
  };
  const { json, sha256 } = serializeGuideSnapshot(content);
  const contentEncrypted = await encryptForTenant(clinicId, json);

  const [snap] = await tx
    .insert(hiGuideSnapshots)
    .values({
      clinicId,
      guideId: g.id,
      revision: g.revision,
      contentEncrypted,
      contentSha256: sha256,
      tissVersion: '4.03.00',
      terminologyVersion: g.terminologyVersion,
      createdVia: 'user',
      createdBy: args.actorUserId,
    })
    .returning({ id: hiGuideSnapshots.id });
  const [approved] = await tx
    .update(hiGuides)
    .set({ status: 'approved', approvedSnapshotId: snap!.id, approvedBy: args.actorUserId })
    .where(
      and(
        eq(hiGuides.clinicId, clinicId),
        eq(hiGuides.id, g.id),
        eq(hiGuides.status, 'reviewed'),
        eq(hiGuides.version, g.version),
      ),
    )
    .returning({ id: hiGuides.id });
  if (!approved) {
    // A transação inteira é desfeita: o snapshot não fica órfão.
    throw new GuideIssuanceError('a guia mudou enquanto era emitida; recarregue e tente de novo');
  }
  return { snapshotId: snap!.id, revision: g.revision, sha256 };
}

function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Aprovação com emissão, como o usuário faz na tela (P7.7). Permissão fresca,
 * leitura auditada da carteirinha e emissão transacional.
 */
export async function approveConsultaGuide(clinicId: string, guideId: string) {
  await requireFreshPermission(PERMISSIONS.MANAGE_FINANCIAL);
  const user = await requireUser();
  const head = await withTenant(clinicId, async (tx) => {
    const [g] = await tx
      .select({
        membershipId: hiGuides.membershipId,
        executant: hiGuides.executantProfessionalId,
      })
      .from(hiGuides)
      .where(and(eq(hiGuides.clinicId, clinicId), eq(hiGuides.id, guideId)))
      .limit(1);
    if (!g?.membershipId) return null;
    const meta = await tx.execute<{ timezone: string | null; nome: string | null }>(
      sql`SELECT c.timezone, p.nome FROM clinics c
            LEFT JOIN profiles p ON p.id = ${g.executant} AND p.clinic_id = c.id
           WHERE c.id = ${clinicId} LIMIT 1`,
    );
    return {
      ...g,
      timezone: meta[0]?.timezone ?? 'America/Sao_Paulo',
      nome: meta[0]?.nome ?? null,
    };
  });
  if (!head?.membershipId) throw new GuideIssuanceError('guia sem carteirinha ou inexistente');
  const card = await readMembershipCardNumberAudited(
    clinicId,
    head.membershipId,
    'geracao_guia',
    'convenios/guias/aprovar',
  );
  if (!card) throw new GuideIssuanceError('carteirinha inexistente nesta clínica');
  return withTenant(
    clinicId,
    (tx) =>
      issueConsultaGuide(tx, {
        clinicId,
        guideId,
        card,
        newborn: false,
        professionalName: head.nome,
        actorUserId: user.userId,
        today: todayInTz(head.timezone),
      }),
    user.userId,
  );
}
