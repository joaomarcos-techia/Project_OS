/**
 * SP/SADT automática (P8.7): o atendimento concluído que EXECUTA um item de uma
 * solicitação (0156) vira sessão faturável na guia SP/SADT.
 *
 * Solicitação → (autorização da operadora, quando o contrato exige) → execução (este
 * serviço, na conclusão do atendimento) → guia pronta para conferência → aprovação
 * (snapshot cifrado) → PDF → XML → lote. Regras:
 *  - nada é faturado só por ter sido pedido: só a sessão realizada entra;
 *  - autorização nunca presumida: aguardando, negada, vencida ou esgotada vira
 *    pendência com responsável, sem guia;
 *  - a quantidade autorizada é consumida UMA vez por sessão (chave de idempotência do
 *    atendimento + gatilho da 0146 com a linha travada); reentrega não consome de novo;
 *  - valor do contrato vigente NA DATA DA SESSÃO (o contrato pode mudar no meio);
 *  - agrupamento pela regra da operadora (`hi_insurers.sadt_grouping`): uma guia por
 *    sessão, ou as sessões da mesma solicitação e do mesmo executante juntas numa guia
 *    aberta até a conferência; sessões de outro profissional vão para outra guia;
 *  - a guia nasce na clínica do atendimento (RLS) e a mesma sessão não entra em duas
 *    guias vivas (índice único da 0147).
 */
import { and, eq, inArray, like, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { assertPremiumFeatureTx } from '@/lib/premium-access';

import {
  hiAppointmentCoverages,
  hiAuthorizationConsumptions,
  hiAuthorizationItems,
  hiAuthorizations,
  hiClinicSettings,
  hiGuideItems,
  hiGuides,
  hiInsurers,
  hiProcedureContracts,
  hiSadtRequestItems,
  hiSadtRequests,
} from '../schema-clinic';
import { selectEffectiveContract, type ContractLine } from '../tiss/assembly/contract-selection';
import type { GuideIssue } from '../tiss/validation/common';

import { credentialingIssuesTx } from './credentialing';

import type { CompletedAppointment } from './consulta-guide-service';
import { allocateTissNumber } from './numbering';
import { executedByItemTx } from './sadt-request-service';

export const sadtSessionGuideKey = (appointmentId: string): string => `sadt:appointment:${appointmentId}`;
const requestGuidePrefix = (requestId: string): string => `sadt:request:${requestId}:`;

export type SadtBlockReason =
  | 'coverage_incomplete'
  | 'authorization_pending'
  | 'authorization_denied'
  | 'contract_missing';

export type SadtExecutionOutcome =
  | { kind: 'created' | 'attached'; guideId: string; number: string; itemTotalCents: number }
  | { kind: 'existing'; guideId: string }
  | { kind: 'module_disabled' }
  | {
      kind: 'blocked';
      reason: SadtBlockReason;
      owner: 'recepcao' | 'gestor' | 'financeiro';
      recovery: 'automatic' | 'human';
      issues: GuideIssue[];
    };

const blocked = (
  reason: SadtBlockReason,
  owner: 'recepcao' | 'gestor' | 'financeiro',
  recovery: 'automatic' | 'human',
  code: string,
  field: string,
  message: string,
): SadtExecutionOutcome => ({
  kind: 'blocked',
  reason,
  owner,
  recovery,
  issues: [{ code, field, message, owner }],
});

export async function recordSadtExecutionForAppointment(
  tx: Tx,
  args: {
    clinicId: string;
    appointment: CompletedAppointment;
    terminologyVersion: string | null;
    actor: { kind: 'automation' } | { kind: 'user'; userId: string };
  },
): Promise<SadtExecutionOutcome> {
  const { clinicId, appointment: ap } = args;
  await assertPremiumFeatureTx(tx, clinicId, 'health_insurance');
  const [settings] = await tx
    .select({ enabled: hiClinicSettings.enabled })
    .from(hiClinicSettings)
    .where(eq(hiClinicSettings.clinicId, clinicId))
    .limit(1);
  if (!settings?.enabled) return { kind: 'module_disabled' };

  // Idempotência: a sessão já está numa guia viva.
  const [already] = await tx
    .select({ guideId: hiGuideItems.guideId })
    .from(hiGuideItems)
    .where(and(eq(hiGuideItems.clinicId, clinicId), eq(hiGuideItems.appointmentId, ap.id), eq(hiGuideItems.live, true)))
    .limit(1);
  if (already) return { kind: 'existing', guideId: already.guideId };

  const [coverage] = await tx
    .select()
    .from(hiAppointmentCoverages)
    .where(and(eq(hiAppointmentCoverages.clinicId, clinicId), eq(hiAppointmentCoverages.appointmentId, ap.id)))
    .limit(1);
  if (!coverage || coverage.guideType !== 'sp_sadt' || !coverage.sadtRequestItemId) {
    return blocked(
      'coverage_incomplete',
      'recepcao',
      'human',
      'SADT_REQUEST_MISSING',
      'solicitacao',
      'Sessão de SP/SADT sem solicitação vinculada. Ligue o atendimento ao procedimento da solicitação (o faturamento nunca presume o pedido).',
    );
  }

  // Serializa as sessões do MESMO item (saldo e guia aberta) sem precisar de UPDATE.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`hi:sadt-item:${coverage.sadtRequestItemId}`}))`);

  const [row] = await tx
    .select({ item: hiSadtRequestItems, request: hiSadtRequests })
    .from(hiSadtRequestItems)
    .innerJoin(
      hiSadtRequests,
      and(eq(hiSadtRequests.clinicId, hiSadtRequestItems.clinicId), eq(hiSadtRequests.id, hiSadtRequestItems.requestId)),
    )
    .where(and(eq(hiSadtRequestItems.clinicId, clinicId), eq(hiSadtRequestItems.id, coverage.sadtRequestItemId)))
    .limit(1);
  if (!row) {
    return blocked('coverage_incomplete', 'recepcao', 'human', 'SADT_REQUEST_MISSING', 'solicitacao', 'O item de solicitação ligado ao atendimento não existe nesta clínica.');
  }
  const { item, request } = row;
  if (request.patientId !== ap.patientId) {
    return blocked('coverage_incomplete', 'recepcao', 'human', 'SADT_REQUEST_OTHER_PATIENT', 'solicitacao', 'A solicitação ligada é de outro paciente.');
  }
  if (request.status === 'awaiting_authorization') {
    return blocked(
      'authorization_pending',
      'recepcao',
      'automatic',
      'SADT_AWAITING_AUTHORIZATION',
      'autorizacao',
      `A operadora ainda não respondeu a solicitação ${request.requestNumber}. Registre a resposta; a guia sai sozinha depois.`,
    );
  }
  if (request.status === 'denied') {
    return blocked('authorization_denied', 'gestor', 'human', 'SADT_AUTHORIZATION_DENIED', 'autorizacao', `A operadora negou a solicitação ${request.requestNumber}. Nenhuma guia é gerada; decida com o paciente.`);
  }
  if (!['authorized', 'partially_authorized', 'ready'].includes(request.status) || item.status !== 'active') {
    return blocked(
      'coverage_incomplete',
      'recepcao',
      'human',
      'SADT_REQUEST_CLOSED',
      'solicitacao',
      `A solicitação ${request.requestNumber ?? ''} não aceita sessões (estado: ${request.status}; procedimento: ${item.status}).`,
    );
  }

  // Credenciamento (P2.2) na data da sessão: a clínica no plano e o profissional executante
  // (quando a operadora exige). Sem ele a sessão não vira guia — nunca se fatura presumindo.
  const credential = await credentialingIssuesTx(tx, {
    clinicId,
    insurerId: request.insurerId,
    planId: request.planId,
    professionalId: ap.professionalId,
    date: ap.date,
  });
  if (credential.length > 0) {
    return { kind: 'blocked', reason: 'coverage_incomplete', owner: 'gestor', recovery: 'human', issues: credential };
  }

  // Saldo: o autorizado pela operadora (quando exige) ou o pedido (quando não exige).
  let authItem: { id: string; quantityAuthorized: number; quantityConsumed: number } | null = null;
  let auth: { status: string; passwordValidUntil: string | null } | null = null;
  if (request.authorizationRequirement === 'required') {
    if (!item.authorizationItemId || !request.authorizationId) {
      return blocked('authorization_pending', 'recepcao', 'automatic', 'SADT_AUTHORIZATION_MISSING', 'autorizacao', 'O contrato exige autorização e o item não está na autorização registrada.');
    }
    const [ai] = await tx
      .select({
        id: hiAuthorizationItems.id,
        quantityAuthorized: hiAuthorizationItems.quantityAuthorized,
        quantityConsumed: hiAuthorizationItems.quantityConsumed,
      })
      .from(hiAuthorizationItems)
      .where(and(eq(hiAuthorizationItems.clinicId, clinicId), eq(hiAuthorizationItems.id, item.authorizationItemId)))
      .limit(1);
    const [a] = await tx
      .select({ status: hiAuthorizations.status, passwordValidUntil: hiAuthorizations.passwordValidUntil })
      .from(hiAuthorizations)
      .where(and(eq(hiAuthorizations.clinicId, clinicId), eq(hiAuthorizations.id, request.authorizationId)))
      .limit(1);
    authItem = ai ?? null;
    auth = a ?? null;
    if (!authItem || !auth || !['authorized', 'partially_authorized'].includes(auth.status)) {
      return blocked('authorization_pending', 'recepcao', 'automatic', 'SADT_AUTHORIZATION_MISSING', 'autorizacao', 'A autorização da operadora não está registrada como concedida.');
    }
    if (auth.passwordValidUntil && ap.date > auth.passwordValidUntil) {
      return blocked(
        'authorization_pending',
        'recepcao',
        'human',
        'SADT_PASSWORD_EXPIRED',
        'autorizacao.dataValidadeSenha',
        `A sessão de ${ap.date} é depois da validade da senha (${auth.passwordValidUntil}). Peça nova autorização à operadora.`,
      );
    }
  }
  const allowed = authItem ? authItem.quantityAuthorized : item.quantityRequested;
  const executed = (await executedByItemTx(tx, clinicId, [item.id])).get(item.id) ?? 0;
  if (executed >= allowed) {
    return blocked(
      'authorization_pending',
      'recepcao',
      'human',
      'SADT_QUANTITY_EXHAUSTED',
      'autorizacao',
      `As ${allowed} sessões ${authItem ? 'autorizadas' : 'solicitadas'} de ${item.procedureCode} já foram executadas. Peça nova solicitação ou autorização.`,
    );
  }

  // Contrato vigente na DATA DA SESSÃO.
  const lines = (await tx
    .select()
    .from(hiProcedureContracts)
    .where(
      and(
        eq(hiProcedureContracts.clinicId, clinicId),
        eq(hiProcedureContracts.insurerId, request.insurerId),
        eq(hiProcedureContracts.guideType, 'sp_sadt'),
      ),
    )) as unknown as ContractLine[];
  const sel = selectEffectiveContract(lines, {
    insurerId: request.insurerId,
    planId: request.planId,
    guideType: 'sp_sadt',
    tableCode: item.tableCode,
    procedureCode: item.procedureCode,
    date: ap.date,
  });
  if (sel.kind !== 'found') {
    return blocked(
      'contract_missing',
      'gestor',
      'human',
      sel.kind === 'ambiguous' ? 'CONTRACT_AMBIGUOUS' : 'CONTRACT_NOT_FOUND',
      'procedimentos',
      sel.kind === 'ambiguous'
        ? `Há mais de um valor de contrato vigente em ${ap.date} para ${item.tableCode}/${item.procedureCode}.`
        : `Não há contrato SP/SADT vigente em ${ap.date} para ${item.tableCode}/${item.procedureCode}.`,
    );
  }
  const line = sel.line;

  // Consumo da autorização: uma vez por sessão (o gatilho da 0146 trava a linha e confere o saldo).
  if (authItem) {
    const key = `sadt:${ap.id}:${authItem.id}`;
    const [done] = await tx
      .select({ id: hiAuthorizationConsumptions.id })
      .from(hiAuthorizationConsumptions)
      .where(and(eq(hiAuthorizationConsumptions.clinicId, clinicId), eq(hiAuthorizationConsumptions.idempotencyKey, key)))
      .limit(1);
    if (!done && authItem.quantityAuthorized - authItem.quantityConsumed < 1) {
      // O saldo real (que um item executado adicional incluído também consome, P8.4-r) acabou:
      // pendência com responsável, em vez de o gatilho da 0146 derrubar a conclusão.
      return blocked(
        'authorization_pending',
        'recepcao',
        'human',
        'SADT_QUANTITY_EXHAUSTED',
        'autorizacao',
        `O saldo autorizado de ${item.procedureCode} acabou (${authItem.quantityConsumed} de ${authItem.quantityAuthorized} consumidos). Peça nova autorização.`,
      );
    }
    if (!done) {
      await tx.insert(hiAuthorizationConsumptions).values({
        clinicId,
        itemId: authItem.id,
        quantity: 1,
        idempotencyKey: key,
        // Quem concluiu a sessão: foi essa conclusão que consumiu (a chave aponta o atendimento).
        createdBy: args.actor.kind === 'user' ? args.actor.userId : ap.professionalId,
      });
    }
  }

  const [insurer] = await tx
    .select({ sadtGrouping: hiInsurers.sadtGrouping })
    .from(hiInsurers)
    .where(and(eq(hiInsurers.clinicId, clinicId), eq(hiInsurers.id, request.insurerId)))
    .limit(1);
  const grouped = insurer?.sadtGrouping === 'per_request';

  let guide: { id: string; number: string } | null = null;
  let kind: 'created' | 'attached' = 'created';
  if (grouped) {
    const [open] = await tx
      .select({ id: hiGuides.id, number: hiGuides.number })
      .from(hiGuides)
      .where(
        and(
          eq(hiGuides.clinicId, clinicId),
          like(hiGuides.idempotencyKey, `${requestGuidePrefix(request.id)}%`),
          eq(hiGuides.live, true),
          inArray(hiGuides.status, ['pending_data', 'ready_for_review']),
          eq(hiGuides.executantProfessionalId, ap.professionalId),
        ),
      )
      .limit(1);
    if (open) {
      guide = open;
      kind = 'attached';
    }
  }
  if (!guide) {
    let key = sadtSessionGuideKey(ap.id);
    if (grouped) {
      const [{ n }] = (await tx.execute(sql`
        SELECT count(*)::int AS n FROM public.hi_guides
         WHERE clinic_id = ${clinicId}::uuid AND idempotency_key LIKE ${`${requestGuidePrefix(request.id)}%`}`)) as unknown as [{ n: number }];
      key = `${requestGuidePrefix(request.id)}${Number(n) + 1}`;
    }
    const number = await allocateTissNumber(tx, { clinicId, kind: 'guide' });
    const [g] = await tx
      .insert(hiGuides)
      .values({
        clinicId,
        guideType: 'sp_sadt',
        number,
        insurerId: request.insurerId,
        planId: request.planId,
        patientId: request.patientId,
        membershipId: request.membershipId,
        authorizationId: request.authorizationId,
        executantProfessionalId: ap.professionalId,
        requesterProfessionalId: request.requesterProfessionalId,
        status: 'ready_for_review',
        live: true,
        revision: 1,
        version: 1,
        tissVersion: '4.03.00',
        terminologyVersion: args.terminologyVersion,
        issues: [],
        expectedValueCents: 0,
        totalValueCents: 0,
        idempotencyKey: key,
        createdVia: args.actor.kind === 'user' ? 'user' : 'automation',
        createdBy: args.actor.kind === 'user' ? args.actor.userId : null,
      })
      .returning({ id: hiGuides.id, number: hiGuides.number });
    guide = g!;
  }

  const [{ next }] = (await tx.execute(sql`
    SELECT coalesce(max(sequence), 0) + 1 AS next FROM public.hi_guide_items
     WHERE clinic_id = ${clinicId}::uuid AND guide_id = ${guide.id}::uuid`)) as unknown as [{ next: number }];
  await tx.insert(hiGuideItems).values({
    clinicId,
    guideId: guide.id,
    guideType: 'sp_sadt',
    live: true,
    sequence: Number(next),
    appointmentId: ap.id,
    contractLineId: line.id,
    authorizationItemId: authItem?.id ?? null,
    executedOn: ap.date,
    tableCode: line.tableCode,
    procedureCode: line.procedureCode,
    description: line.description.slice(0, 150),
    quantity: 1,
    factorHundredths: 100,
    unitValueCents: line.unitValueCents,
    totalValueCents: line.unitValueCents,
  });
  await tx.execute(sql`
    UPDATE public.hi_guides g
       SET total_value_cents = s.total, expected_value_cents = s.total
      FROM (SELECT coalesce(sum(total_value_cents), 0) AS total FROM public.hi_guide_items
             WHERE clinic_id = ${clinicId}::uuid AND guide_id = ${guide.id}::uuid) s
     WHERE g.clinic_id = ${clinicId}::uuid AND g.id = ${guide.id}::uuid`);
  return { kind, guideId: guide.id, number: guide.number, itemTotalCents: line.unitValueCents };
}
