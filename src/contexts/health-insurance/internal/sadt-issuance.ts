/**
 * Emissão da Guia SP/SADT conferida (P8.7): monta a guia com o montador puro (P8.2) a
 * partir do que foi EXECUTADO (itens da guia, um por sessão), da solicitação (0156:
 * solicitante, data, caráter, tipo de atendimento, indicação clínica digitada pelo
 * profissional) e da autorização da operadora (número, senha, validade, quantidades),
 * valida pelas regras TISS (P8.3) e congela o snapshot cifrado + dados do impresso.
 *
 * O consumo da autorização já aconteceu na execução de cada sessão; aqui o saldo é
 * conferido descontando as sessões DESTA guia (nada é consumido de novo).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';

import { encryptForTenant } from '@/lib/crypto/encryption';
import type { Tx } from '@/lib/db';
import { assertPremiumFeatureTx } from '@/lib/premium-access';

import {
  hiAuthorizationItems,
  hiAuthorizations,
  hiClinicSettings,
  hiGuideItems,
  hiGuideSnapshots,
  hiGuides,
  hiInsurers,
  hiProcedureContracts,
  hiProfessionalProfiles,
  hiSadtRequests,
} from '../schema-clinic';
import type { ContractLine } from '../tiss/assembly/contract-selection';
import { assembleSpSadtGuide, type SadtProfessionalProfile } from '../tiss/assembly/sp-sadt-assembler';
import { serializeGuideSnapshot, type GuideSnapshotContent } from '../tiss/guides/snapshot';
import { validateSpSadtGuide } from '../tiss/validation/sp-sadt-validator';

import { freezePrintData, GuideIssuanceError, loadTerms, notReviewedError, SP_SADT_DOMAIN_TABLES, type IssueArgs } from './issuance-common';
import { readAuthorizationPasswordTx, readClinicalIndicationTx } from './sadt-request-service';

async function professional(tx: Tx, clinicId: string, userId: string | null): Promise<SadtProfessionalProfile | null> {
  if (!userId) return null;
  const [p] = await tx
    .select()
    .from(hiProfessionalProfiles)
    .where(and(eq(hiProfessionalProfiles.clinicId, clinicId), eq(hiProfessionalProfiles.professionalId, userId)))
    .limit(1);
  if (!p) return null;
  const rows = (await tx.execute(sql`
    SELECT nome FROM public.profiles WHERE clinic_id = ${clinicId}::uuid AND id = ${userId}::uuid LIMIT 1`)) as unknown as Array<{ nome: string | null }>;
  return { name: rows[0]?.nome ?? '', council: p.council, councilNumber: p.councilNumber, councilUf: p.councilUf, cbo: p.cbo };
}

export async function issueSpSadtGuide(
  tx: Tx,
  args: IssueArgs,
): Promise<{ snapshotId: string; revision: number; sha256: string }> {
  const { clinicId } = args;
  await assertPremiumFeatureTx(tx, clinicId, 'health_insurance');
  // P14.2 (G.7): mesma trava da Guia de Consulta; aprovações simultâneas se enfileiram.
  const [g] = await tx
    .select()
    .from(hiGuides)
    .where(and(eq(hiGuides.clinicId, clinicId), eq(hiGuides.id, args.guideId)))
    .limit(1)
    .for('update');
  if (!g) throw new GuideIssuanceError('guia inexistente nesta clínica');
  if (g.guideType !== 'sp_sadt') throw new GuideIssuanceError('esta emissão é da Guia SP/SADT');
  if (g.status !== 'reviewed') throw notReviewedError(g.status);
  if (!g.membershipId || g.membershipId !== args.card.membershipId) {
    throw new GuideIssuanceError('a carteirinha lida não é a da guia');
  }
  if (!g.terminologyVersion) throw new GuideIssuanceError('a guia não tem versão de terminologia');

  const items = await tx
    .select()
    .from(hiGuideItems)
    .where(and(eq(hiGuideItems.clinicId, clinicId), eq(hiGuideItems.guideId, g.id)))
    .orderBy(hiGuideItems.sequence);
  if (items.length === 0) throw new GuideIssuanceError('a guia não tem sessão');
  if (items.some((i) => !i.appointmentId)) throw new GuideIssuanceError('sessão sem atendimento de origem');

  // A solicitação de TODAS as sessões (a mesma; o agrupamento nunca mistura solicitações).
  const reqRows = (await tx.execute(sql`
    SELECT DISTINCT ri.request_id
      FROM public.hi_appointment_coverages c
      JOIN public.hi_sadt_request_items ri ON ri.clinic_id = c.clinic_id AND ri.id = c.sadt_request_item_id
     WHERE c.clinic_id = ${clinicId}::uuid
       AND c.appointment_id IN (${sql.join(items.map((i) => sql`${i.appointmentId}::uuid`), sql`, `)})`)) as unknown as Array<{ request_id: string }>;
  if (reqRows.length !== 1) {
    throw new GuideIssuanceError(
      reqRows.length === 0 ? 'as sessões não estão ligadas a uma solicitação' : 'a guia mistura sessões de solicitações diferentes',
    );
  }
  const [request] = await tx
    .select()
    .from(hiSadtRequests)
    .where(and(eq(hiSadtRequests.clinicId, clinicId), eq(hiSadtRequests.id, reqRows[0]!.request_id)))
    .limit(1);
  if (!request) throw new GuideIssuanceError('solicitação inexistente');
  if (!request.careType) throw new GuideIssuanceError('a solicitação não tem o tipo de atendimento');

  const [settings] = await tx.select().from(hiClinicSettings).where(eq(hiClinicSettings.clinicId, clinicId)).limit(1);
  const [insurer] = await tx
    .select()
    .from(hiInsurers)
    .where(and(eq(hiInsurers.clinicId, clinicId), eq(hiInsurers.id, g.insurerId)))
    .limit(1);
  if (!settings || !insurer) throw new GuideIssuanceError('cadastro da guia incompleto');
  const lineIds = [...new Set(items.map((i) => i.contractLineId))];
  const lines = (await tx
    .select()
    .from(hiProcedureContracts)
    .where(and(eq(hiProcedureContracts.clinicId, clinicId), inArray(hiProcedureContracts.id, lineIds)))) as unknown as ContractLine[];

  // Autorização: o consumo das sessões desta guia já foi lançado na execução; o saldo
  // conferido aqui é o das OUTRAS guias (sem contar duas vezes).
  let authorization: Parameters<typeof assembleSpSadtGuide>[0]['authorization'] = null;
  if (g.authorizationId) {
    const [a] = await tx
      .select()
      .from(hiAuthorizations)
      .where(and(eq(hiAuthorizations.clinicId, clinicId), eq(hiAuthorizations.id, g.authorizationId)))
      .limit(1);
    if (!a || !a.authorizedOn) throw new GuideIssuanceError('a autorização da guia não está concedida');
    const authItems = await tx
      .select()
      .from(hiAuthorizationItems)
      .where(and(eq(hiAuthorizationItems.clinicId, clinicId), eq(hiAuthorizationItems.authorizationId, a.id)));
    authorization = {
      operatorGuideNumber: a.operatorGuideNumber,
      authorizedOn: a.authorizedOn,
      password: await readAuthorizationPasswordTx(tx, clinicId, a.id),
      passwordValidUntil: a.passwordValidUntil,
      items: authItems.map((ai) => ({
        tableCode: ai.tableCode,
        procedureCode: ai.procedureCode,
        authorized: ai.quantityAuthorized,
        consumed: ai.quantityConsumed - items.filter((i) => i.authorizationItemId === ai.id).length,
      })),
    };
  }

  const executant = await professional(tx, clinicId, g.executantProfessionalId);
  const requester =
    request.requesterKind === 'internal'
      ? ({ kind: 'internal', professional: await professional(tx, clinicId, request.requesterProfessionalId) } as const)
      : ({ kind: 'external', ...request.requesterExternal! } as const);
  const clinicalIndication = await readClinicalIndicationTx(tx, clinicId, request.id);
  const teamPerItem = (insurer.settings as Record<string, unknown> | null)?.sadtTeamPerItem === true;
  // Impresso congelado agora; o nome do contratado cai no da clínica quando não há razão social própria.
  const print = await freezePrintData(tx, {
    clinicId,
    patientId: g.patientId,
    contractorName: settings.contractorName,
    insurerName: insurer.name,
  });

  const assembly = assembleSpSadtGuide({
    clinic: {
      cnesStatus: settings.cnesStatus,
      cnes: settings.cnes,
      contractorName: print.contratadoNome,
    },
    insurer: {
      id: insurer.id,
      registroAns: insurer.registroAns,
      providerIdKind: insurer.providerIdKind,
      providerIdValue: insurer.providerIdValue,
    },
    planId: g.planId,
    membership: { cardNumber: args.card.cardNumber, newborn: args.newborn },
    requester,
    executant: { professional: executant, teamCode: null },
    teamPerItem,
    careType: request.careType,
    consultationType: request.consultationType,
    requestDate: request.requestedOn,
    clinicalIndication,
    authorization,
    sessions: items.map((i) => ({
      appointmentId: i.appointmentId!,
      date: i.executedOn,
      tableCode: i.tableCode,
      procedureCode: i.procedureCode,
    })),
    contracts: lines.map((l) => ({ ...l, supersedesId: null })),
    guideNumber: g.number,
    overrides: { caraterAtendimento: request.careCharacter },
  });
  if (assembly.decision === 'blocked') {
    throw new GuideIssuanceError('a guia conferida tem pendências', assembly.issues);
  }
  // O valor de cada sessão é o que foi conferido (contrato da data da sessão).
  if (assembly.contractLineIds.some((id, i) => id !== items[i]!.contractLineId)) {
    throw new GuideIssuanceError('o contrato de uma sessão mudou desde a conferência; reconfira a guia');
  }

  const needs: Array<[string, string]> = [
    ...new Set(items.map((i) => `${i.tableCode}:${i.procedureCode}`)),
  ].map((k) => k.split(':') as [string, string]);
  for (const p of [executant, requester.kind === 'internal' ? requester.professional : null]) {
    if (p) needs.push(['24', p.cbo]);
  }
  if (requester.kind === 'external' && requester.cbo) needs.push(['24', requester.cbo]);
  const terminology = await loadTerms(tx, g.terminologyVersion, needs, SP_SADT_DOMAIN_TABLES);
  const errors = validateSpSadtGuide(assembly.guide, {
    terminology,
    requesterPerson: settings.providerKind ?? 'PJ',
    today: args.today,
    authorizationRequired: request.authorizationRequirement === 'required',
    ...(authorization
      ? { authorizedQuantities: new Map(authorization.items.map((i) => [`${i.tableCode}:${i.procedureCode}`, i.authorized])) }
      : {}),
  });
  if (errors.length > 0) throw new GuideIssuanceError('a guia não passa na validação TISS', errors);

  const content: GuideSnapshotContent = {
    schema: 'qoro.hi.guide-snapshot/1',
    guideType: 'sp_sadt',
    tissVersion: '4.03.00',
    terminologyVersion: g.terminologyVersion,
    data: assembly.guide,
    print,
  };
  const { json, sha256 } = serializeGuideSnapshot(content);
  const [snap] = await tx
    .insert(hiGuideSnapshots)
    .values({
      clinicId,
      guideId: g.id,
      revision: g.revision,
      contentEncrypted: await encryptForTenant(clinicId, json),
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
  if (!approved) throw new GuideIssuanceError('a guia mudou enquanto era emitida; recarregue e tente de novo');
  return { snapshotId: snap!.id, revision: g.revision, sha256 };
}
