/**
 * Solicitação SP/SADT persistida (P6.2, 0156).
 *
 * Fluxo: rascunho → conferida pela recepção (contrato vigente e TUSS de cada item,
 * número da solicitação) → aguardando a operadora (quando o contrato exige
 * autorização: nasce o pedido em `hi_authorizations`) ou pronta (quando não exige) →
 * autorizada / parcialmente autorizada / negada (resposta REAL da operadora, com
 * evidência) → concluída ou cancelada.
 *
 * Regras:
 *  - solicitação NÃO é execução: nada aqui gera guia de cobrança nem consome
 *    autorização; isso acontece quando um atendimento executa um item (P8.7);
 *  - indicação clínica: digitada pelo profissional solicitante (ou transcrita da
 *    solicitação de um solicitante externo), cifrada por clínica; nunca copiada do
 *    prontuário, nunca inventada, nunca exigida onde o padrão não exige (D17);
 *  - nenhuma autorização presumida: "autorizada" só com número da guia na operadora,
 *    senha ou protocolo, e a quantidade de cada item como a operadora concedeu;
 *  - concorrência otimista por `version` (o banco incrementa); histórico só de inclusão.
 *
 * Tudo roda na transação do chamador (`withTenant`), com RLS.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { decryptForTenant, encryptForTenant } from '@/lib/crypto/encryption';
import type { Tx } from '@/lib/db';
import { assertPremiumFeatureTx } from '@/lib/premium-access';

import { tissTerminologyVersions, tissTerms } from '../schema';
import {
  hiAuthorizationEvents,
  hiAuthorizationItems,
  hiAuthorizations,
  hiMemberships,
  hiProcedureContracts,
  hiSadtRequestEvents,
  hiSadtRequestItems,
  hiSadtRequests,
  type HiSadtRequestStatus,
} from '../schema-clinic';
import { selectEffectiveContract, type ContractLine } from '../tiss/assembly/contract-selection';
import type { GuideIssue } from '../tiss/validation/common';

import { allocateTissNumber } from './numbering';

export class SadtRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'SadtRequestError';
  }
}

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'data no formato AAAA-MM-DD');

const Requester = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('internal'), professionalId: uuid }),
  z.object({
    kind: z.literal('external'),
    name: z.string().trim().min(3).max(70),
    council: z.string().regex(/^\d{2}$/u),
    councilNumber: z.string().trim().min(1).max(15),
    councilUf: z.string().regex(/^\d{2}$/u),
    cbo: z.string().regex(/^\d{6}$/u).nullable(),
  }),
]);

export const CreateSadtRequestInput = z.object({
  clinicId: uuid,
  patientId: uuid,
  membershipId: uuid,
  planId: uuid.nullable().default(null),
  requester: Requester,
  sourceAppointmentId: uuid.nullable().default(null),
  requestedOn: isoDate,
  careCharacter: z.enum(['1', '2']).default('1'),
  careType: z.string().regex(/^\d{2}$/u).nullable().default(null),
  consultationType: z.string().regex(/^[1-4]$/u).nullable().default(null),
  items: z
    .array(
      z.object({
        tableCode: z.string().regex(/^\d{2}$/u),
        procedureCode: z.string().trim().min(1).max(10),
        quantity: z.number().int().min(1).max(999),
      }),
    )
    .min(1)
    .max(99),
  note: z.string().trim().max(500).nullable().default(null),
  actorUserId: uuid,
});

const ACCEPTS_SESSIONS: readonly HiSadtRequestStatus[] = [
  'awaiting_authorization',
  'authorized',
  'partially_authorized',
  'ready',
];
const CLOSED: readonly HiSadtRequestStatus[] = ['completed', 'cancelled', 'expired'];

async function event(
  tx: Tx,
  args: { clinicId: string; requestId: string; from: HiSadtRequestStatus | null; to: HiSadtRequestStatus; note?: string | null; actorUserId: string | null },
) {
  await tx.insert(hiSadtRequestEvents).values({
    clinicId: args.clinicId,
    requestId: args.requestId,
    fromStatus: args.from,
    toStatus: args.to,
    note: args.note ?? null,
    createdVia: args.actorUserId ? 'user' : 'automation',
    actorUserId: args.actorUserId,
  });
}

async function loadRequest(tx: Tx, clinicId: string, requestId: string) {
  const [r] = await tx
    .select()
    .from(hiSadtRequests)
    .where(and(eq(hiSadtRequests.clinicId, clinicId), eq(hiSadtRequests.id, requestId)))
    .limit(1);
  if (!r) throw new SadtRequestError('solicitação inexistente nesta clínica', 'not_found');
  return r;
}

/** UPDATE com a versão esperada; versão diferente = alguém mudou antes (recarregar). */
async function updateRequest(
  tx: Tx,
  clinicId: string,
  requestId: string,
  version: number,
  set: Partial<typeof hiSadtRequests.$inferInsert>,
) {
  const [row] = await tx
    .update(hiSadtRequests)
    .set(set)
    .where(
      and(
        eq(hiSadtRequests.clinicId, clinicId),
        eq(hiSadtRequests.id, requestId),
        eq(hiSadtRequests.version, version),
      ),
    )
    .returning({ version: hiSadtRequests.version });
  if (!row) {
    throw new SadtRequestError('a solicitação mudou enquanto você editava; recarregue', 'stale');
  }
  return row.version;
}

async function contractLines(tx: Tx, clinicId: string, insurerId: string): Promise<ContractLine[]> {
  const rows = await tx
    .select()
    .from(hiProcedureContracts)
    .where(
      and(
        eq(hiProcedureContracts.clinicId, clinicId),
        eq(hiProcedureContracts.insurerId, insurerId),
        eq(hiProcedureContracts.guideType, 'sp_sadt'),
      ),
    );
  return rows as unknown as ContractLine[];
}

/** Executado (guias vivas) por item da solicitação: o que já virou sessão faturável. */
export async function executedByItemTx(tx: Tx, clinicId: string, itemIds: string[]) {
  if (itemIds.length === 0) return new Map<string, number>();
  const rows = (await tx.execute(sql`
    SELECT c.sadt_request_item_id AS item_id, count(*)::int AS n
      FROM public.hi_appointment_coverages c
      JOIN public.hi_guide_items gi ON gi.clinic_id = c.clinic_id AND gi.appointment_id = c.appointment_id AND gi.live
     WHERE c.clinic_id = ${clinicId}::uuid
       AND c.sadt_request_item_id IN (${sql.join(itemIds.map((id) => sql`${id}::uuid`), sql`, `)})
     GROUP BY 1`)) as unknown as Array<{ item_id: string; n: number }>;
  return new Map(rows.map((r) => [r.item_id, Number(r.n)]));
}

export async function createSadtRequestInTx(
  tx: Tx,
  raw: z.input<typeof CreateSadtRequestInput>,
): Promise<{ requestId: string }> {
  const input = CreateSadtRequestInput.parse(raw);
  const { clinicId } = input;
  // D24: solicitação é operação nova de Convênios (o banco confere de novo).
  await assertPremiumFeatureTx(tx, clinicId, 'health_insurance');

  const [card] = await tx
    .select({ patientId: hiMemberships.patientId, insurerId: hiMemberships.insurerId, status: hiMemberships.status })
    .from(hiMemberships)
    .where(and(eq(hiMemberships.clinicId, clinicId), eq(hiMemberships.id, input.membershipId)))
    .limit(1);
  if (!card || card.patientId !== input.patientId) {
    throw new SadtRequestError('a carteirinha não é deste paciente', 'membership_mismatch');
  }
  if (card.status !== 'active') {
    throw new SadtRequestError('a carteirinha não está ativa', 'membership_inactive');
  }
  const codes = input.items.map((i) => `${i.tableCode}:${i.procedureCode}`);
  if (new Set(codes).size !== codes.length) {
    throw new SadtRequestError('o mesmo procedimento aparece duas vezes; some as quantidades', 'duplicate_item');
  }
  if (input.sourceAppointmentId) {
    const rows = (await tx.execute(sql`
      SELECT patient_id FROM public.appointments
       WHERE clinic_id = ${clinicId}::uuid AND id = ${input.sourceAppointmentId}::uuid`)) as unknown as Array<{ patient_id: string | null }>;
    if (rows[0]?.patient_id !== input.patientId) {
      throw new SadtRequestError('o atendimento de origem não é deste paciente', 'appointment_mismatch');
    }
  }

  // Descrição de cada item: a do contrato da operadora; sem contrato, o termo TUSS.
  const lines = await contractLines(tx, clinicId, card.insurerId);
  const [tv] = await tx
    .select({ id: tissTerminologyVersions.id })
    .from(tissTerminologyVersions)
    .orderBy(desc(tissTerminologyVersions.version))
    .limit(1);
  const descriptions: string[] = [];
  for (const it of input.items) {
    const fromContract = lines.find((l) => l.tableCode === it.tableCode && l.procedureCode === it.procedureCode);
    let description = fromContract?.description ?? null;
    if (!description && tv) {
      const [term] = await tx
        .select({ term: tissTerms.term })
        .from(tissTerms)
        .where(and(eq(tissTerms.versionId, tv.id), eq(tissTerms.tableCode, it.tableCode), eq(tissTerms.code, it.procedureCode)))
        .limit(1);
      description = term?.term ?? null;
    }
    if (!description) {
      throw new SadtRequestError(
        `o procedimento ${it.tableCode}/${it.procedureCode} não está no contrato nem na terminologia TUSS carregada`,
        'unknown_procedure',
      );
    }
    descriptions.push(description.slice(0, 150));
  }

  const r = input.requester;
  const [req] = await tx
    .insert(hiSadtRequests)
    .values({
      clinicId,
      patientId: input.patientId,
      insurerId: card.insurerId,
      planId: input.planId,
      membershipId: input.membershipId,
      requesterKind: r.kind,
      requesterProfessionalId: r.kind === 'internal' ? r.professionalId : null,
      requesterExternal:
        r.kind === 'external'
          ? { name: r.name, council: r.council, councilNumber: r.councilNumber, councilUf: r.councilUf, cbo: r.cbo }
          : null,
      sourceAppointmentId: input.sourceAppointmentId,
      requestedOn: input.requestedOn,
      careCharacter: input.careCharacter,
      careType: input.careType,
      consultationType: input.consultationType,
      authorizationRequirement: 'unknown',
      status: 'draft',
      issues: [],
      note: input.note,
      createdBy: input.actorUserId,
    })
    .returning({ id: hiSadtRequests.id });
  await tx.insert(hiSadtRequestItems).values(
    input.items.map((it, i) => ({
      clinicId,
      requestId: req!.id,
      sequence: i + 1,
      tableCode: it.tableCode,
      procedureCode: it.procedureCode,
      description: descriptions[i]!,
      quantityRequested: it.quantity,
      status: 'active' as const,
    })),
  );
  await event(tx, { clinicId, requestId: req!.id, from: null, to: 'draft', actorUserId: input.actorUserId });
  return { requestId: req!.id };
}

/**
 * Indicação clínica: SÓ o profissional solicitante da clínica a informa; para
 * solicitante externo, a recepção transcreve o que está no pedido dele (fica
 * registrado quem digitou). O texto é cifrado; o histórico não guarda o conteúdo.
 */
export async function setClinicalIndicationInTx(
  tx: Tx,
  args: { clinicId: string; requestId: string; version: number; text: string; actorUserId: string },
): Promise<number> {
  const r = await loadRequest(tx, args.clinicId, args.requestId);
  // Depois da resposta da operadora, o que foi enviado não muda ("pronta" = nada foi enviado).
  if (!['draft', 'checked', 'awaiting_authorization', 'ready'].includes(r.status)) {
    throw new SadtRequestError(`a indicação não muda depois da resposta da operadora (estado: ${r.status})`, 'state');
  }
  if (r.requesterKind === 'internal' && r.requesterProfessionalId !== args.actorUserId) {
    throw new SadtRequestError('a indicação clínica é informada pelo profissional solicitante', 'only_requester');
  }
  const text = args.text.trim();
  if (text.length < 3 || text.length > 500) {
    throw new SadtRequestError('a indicação clínica tem de 3 a 500 caracteres (limite do padrão TISS)', 'invalid');
  }
  const version = await updateRequest(tx, args.clinicId, args.requestId, args.version, {
    clinicalIndicationEncrypted: await encryptForTenant(args.clinicId, text),
    clinicalIndicationBy: args.actorUserId,
    clinicalIndicationAt: new Date(),
  });
  await event(tx, {
    clinicId: args.clinicId,
    requestId: args.requestId,
    from: r.status,
    to: r.status,
    note: 'indicação clínica informada',
    actorUserId: args.actorUserId,
  });
  return version;
}

/** Senha da autorização, decifrada só para montar a guia na emissão (nunca exibida nem logada). */
export async function readAuthorizationPasswordTx(tx: Tx, clinicId: string, authorizationId: string): Promise<string | null> {
  const [a] = await tx
    .select({ enc: hiAuthorizations.passwordEncrypted })
    .from(hiAuthorizations)
    .where(and(eq(hiAuthorizations.clinicId, clinicId), eq(hiAuthorizations.id, authorizationId)))
    .limit(1);
  return a?.enc ? decryptForTenant(clinicId, a.enc) : null;
}

export async function readClinicalIndicationTx(tx: Tx, clinicId: string, requestId: string): Promise<string | null> {
  const r = await loadRequest(tx, clinicId, requestId);
  return r.clinicalIndicationEncrypted ? decryptForTenant(clinicId, r.clinicalIndicationEncrypted) : null;
}

export type CheckOutcome =
  | { kind: 'pending'; issues: GuideIssue[]; version: number }
  | { kind: 'awaiting_authorization'; authorizationId: string; requestNumber: string; version: number }
  | { kind: 'ready'; requestNumber: string; version: number };

/** Conferência da recepção: contrato vigente e TUSS de cada item; pede ou dispensa autorização. */
export async function checkSadtRequestInTx(
  tx: Tx,
  args: {
    clinicId: string;
    requestId: string;
    version: number;
    careType?: string | null;
    consultationType?: string | null;
    actorUserId: string;
  },
): Promise<CheckOutcome> {
  const { clinicId } = args;
  await assertPremiumFeatureTx(tx, clinicId, 'health_insurance');
  const r = await loadRequest(tx, clinicId, args.requestId);
  if (r.status !== 'draft') throw new SadtRequestError(`só se confere rascunho (estado: ${r.status})`, 'state');
  const careType = args.careType ?? r.careType;
  const consultationType = careType === '04' ? (args.consultationType ?? r.consultationType) : null;
  const items = await tx
    .select()
    .from(hiSadtRequestItems)
    .where(and(eq(hiSadtRequestItems.clinicId, clinicId), eq(hiSadtRequestItems.requestId, r.id), eq(hiSadtRequestItems.status, 'active')))
    .orderBy(hiSadtRequestItems.sequence);
  const issues: GuideIssue[] = [];
  const gi = (code: string, field: string, message: string, owner: GuideIssue['owner']) => issues.push({ code, field, message, owner });
  if (!careType || !/^\d{2}$/u.test(careType)) {
    gi('CARE_TYPE_MISSING', 'atendimento.tipoAtendimento', 'Escolha o tipo de atendimento (tabela 50).', 'recepcao');
  }
  if (careType === '04' && !consultationType) {
    gi('CONSULTATION_TYPE_MISSING', 'atendimento.tipoConsulta', 'Tipo de atendimento consulta exige o tipo de consulta (tabela 52).', 'recepcao');
  }
  if (items.length === 0) gi('NO_ITEMS', 'procedimentos', 'A solicitação não tem procedimento ativo.', 'recepcao');

  const lines = await contractLines(tx, clinicId, r.insurerId);
  const [tv] = await tx
    .select({ id: tissTerminologyVersions.id })
    .from(tissTerminologyVersions)
    .orderBy(desc(tissTerminologyVersions.version))
    .limit(1);
  const chosen = new Map<string, ContractLine>();
  for (const it of items) {
    const sel = selectEffectiveContract(lines, {
      insurerId: r.insurerId,
      planId: r.planId,
      guideType: 'sp_sadt',
      tableCode: it.tableCode,
      procedureCode: it.procedureCode,
      date: r.requestedOn,
    });
    if (sel.kind === 'found') chosen.set(it.id, sel.line);
    else
      gi(
        sel.kind === 'ambiguous' ? 'CONTRACT_AMBIGUOUS' : 'CONTRACT_NOT_FOUND',
        `procedimentos[${it.sequence}]`,
        sel.kind === 'ambiguous'
          ? `Há mais de um valor de contrato vigente em ${r.requestedOn} para ${it.tableCode}/${it.procedureCode}.`
          : `Não há contrato SP/SADT vigente em ${r.requestedOn} para ${it.tableCode}/${it.procedureCode} nesta operadora e plano.`,
        'gestor',
      );
    if (tv) {
      const [term] = await tx
        .select({ startsOn: tissTerms.startsOn, endsOn: tissTerms.endsOn })
        .from(tissTerms)
        .where(and(eq(tissTerms.versionId, tv.id), eq(tissTerms.tableCode, it.tableCode), eq(tissTerms.code, it.procedureCode)))
        .limit(1);
      const valid = term && (!term.startsOn || term.startsOn <= r.requestedOn) && (!term.endsOn || r.requestedOn <= term.endsOn);
      if (!valid) {
        gi('TUSS_INVALID', `procedimentos[${it.sequence}]`, `O código ${it.procedureCode} não está vigente na TUSS carregada em ${r.requestedOn}.`, 'gestor');
      }
    } else {
      gi('TERMINOLOGY_MISSING', 'terminologia', 'Nenhuma versão da terminologia TISS está carregada.', 'gestor');
    }
  }
  if (issues.length > 0) {
    const version = await updateRequest(tx, clinicId, r.id, args.version, { issues, careType, consultationType });
    return { kind: 'pending', issues, version };
  }

  const required = [...chosen.values()].some((l) => l.requiresAuthorization);
  const requestNumber = await allocateTissNumber(tx, { clinicId, kind: 'guide' });
  for (const it of items) {
    await tx
      .update(hiSadtRequestItems)
      .set({ contractLineId: chosen.get(it.id)!.id })
      .where(and(eq(hiSadtRequestItems.clinicId, clinicId), eq(hiSadtRequestItems.id, it.id)));
  }
  const common = {
    careType,
    consultationType,
    requestNumber,
    checkedAt: new Date(),
    checkedBy: args.actorUserId,
    issues: [],
  };
  if (!required) {
    const version = await updateRequest(tx, clinicId, r.id, args.version, {
      ...common,
      authorizationRequirement: 'not_required',
      status: 'ready',
    });
    await event(tx, { clinicId, requestId: r.id, from: 'draft', to: 'ready', note: 'contrato não exige autorização', actorUserId: args.actorUserId });
    return { kind: 'ready', requestNumber, version };
  }

  // Pedido à operadora: nasce "pedido" (a clínica envia pelo canal da operadora).
  const [auth] = await tx
    .insert(hiAuthorizations)
    .values({
      clinicId,
      insurerId: r.insurerId,
      planId: r.planId,
      membershipId: r.membershipId,
      guideType: 'sp_sadt',
      status: 'requested',
      origin: 'manual',
      requestedOn: r.requestedOn,
      createdBy: args.actorUserId,
    })
    .returning({ id: hiAuthorizations.id });
  for (const it of items) {
    const [ai] = await tx
      .insert(hiAuthorizationItems)
      .values({
        clinicId,
        authorizationId: auth!.id,
        tableCode: it.tableCode,
        procedureCode: it.procedureCode,
        quantityRequested: it.quantityRequested,
      })
      .returning({ id: hiAuthorizationItems.id });
    await tx
      .update(hiSadtRequestItems)
      .set({ authorizationItemId: ai!.id })
      .where(and(eq(hiSadtRequestItems.clinicId, clinicId), eq(hiSadtRequestItems.id, it.id)));
  }
  await tx.insert(hiAuthorizationEvents).values({
    clinicId,
    authorizationId: auth!.id,
    fromStatus: null,
    toStatus: 'requested',
    actorId: args.actorUserId,
    note: `solicitação SP/SADT ${requestNumber}`,
  });
  const version = await updateRequest(tx, clinicId, r.id, args.version, {
    ...common,
    authorizationRequirement: 'required',
    authorizationId: auth!.id,
    status: 'awaiting_authorization',
  });
  await event(tx, { clinicId, requestId: r.id, from: 'draft', to: 'awaiting_authorization', actorUserId: args.actorUserId });
  return { kind: 'awaiting_authorization', authorizationId: auth!.id, requestNumber, version };
}

export const RecordSadtAuthorizationInput = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('authorized'),
    clinicId: uuid,
    requestId: uuid,
    version: z.number().int().min(1),
    authorizedOn: isoDate,
    operatorGuideNumber: z.string().trim().min(1).max(20).nullable().default(null),
    operatorProtocol: z.string().trim().min(1).max(40).nullable().default(null),
    password: z.string().trim().min(1).max(20).nullable().default(null),
    passwordValidUntil: isoDate.nullable().default(null),
    items: z.array(z.object({ requestItemId: uuid, quantityAuthorized: z.number().int().min(0).max(999) })).min(1),
    actorUserId: uuid,
  }),
  z.object({
    decision: z.literal('denied'),
    clinicId: uuid,
    requestId: uuid,
    version: z.number().int().min(1),
    denialReason: z.string().trim().min(3).max(500),
    actorUserId: uuid,
  }),
]);

/** Resposta REAL da operadora, registrada por uma pessoa (o conector, quando houver, usa o recibo). */
export async function recordSadtAuthorizationInTx(
  tx: Tx,
  raw: z.input<typeof RecordSadtAuthorizationInput>,
): Promise<{ status: HiSadtRequestStatus; version: number }> {
  const input = RecordSadtAuthorizationInput.parse(raw);
  const { clinicId } = input;
  const r = await loadRequest(tx, clinicId, input.requestId);
  if (r.status !== 'awaiting_authorization' || !r.authorizationId) {
    throw new SadtRequestError(`a solicitação não aguarda a operadora (estado: ${r.status})`, 'state');
  }
  const [auth] = await tx
    .select({ status: hiAuthorizations.status })
    .from(hiAuthorizations)
    .where(and(eq(hiAuthorizations.clinicId, clinicId), eq(hiAuthorizations.id, r.authorizationId)))
    .limit(1);
  if (!auth || !['requested', 'pending_operator'].includes(auth.status)) {
    throw new SadtRequestError(`a autorização não está aguardando resposta (estado: ${auth?.status})`, 'state');
  }

  if (input.decision === 'denied') {
    await tx
      .update(hiAuthorizations)
      .set({ status: 'denied', denialReason: input.denialReason, recordedBy: input.actorUserId })
      .where(and(eq(hiAuthorizations.clinicId, clinicId), eq(hiAuthorizations.id, r.authorizationId)));
    await tx.insert(hiAuthorizationEvents).values({ clinicId, authorizationId: r.authorizationId, fromStatus: auth.status, toStatus: 'denied', actorId: input.actorUserId });
    const version = await updateRequest(tx, clinicId, r.id, input.version, { status: 'denied' });
    await event(tx, { clinicId, requestId: r.id, from: r.status, to: 'denied', actorUserId: input.actorUserId });
    return { status: 'denied', version };
  }

  if (!input.operatorGuideNumber && !input.password && !input.operatorProtocol) {
    throw new SadtRequestError(
      'autorização só com evidência da operadora: número da guia na operadora, senha ou protocolo',
      'evidence_required',
    );
  }
  if (input.operatorGuideNumber) {
    const [dup] = await tx
      .select({ id: hiAuthorizations.id })
      .from(hiAuthorizations)
      .where(
        and(
          eq(hiAuthorizations.clinicId, clinicId),
          eq(hiAuthorizations.insurerId, r.insurerId),
          eq(hiAuthorizations.operatorGuideNumber, input.operatorGuideNumber),
        ),
      )
      .limit(1);
    if (dup && dup.id !== r.authorizationId) {
      throw new SadtRequestError('este número da guia na operadora já está registrado em outra autorização', 'duplicate_operator_number');
    }
  }
  if (input.authorizedOn < r.requestedOn) {
    throw new SadtRequestError('a autorização não pode ser anterior à solicitação', 'invalid');
  }
  const items = await tx
    .select()
    .from(hiSadtRequestItems)
    .where(and(eq(hiSadtRequestItems.clinicId, clinicId), eq(hiSadtRequestItems.requestId, r.id), eq(hiSadtRequestItems.status, 'active')));
  const given = new Map(input.items.map((i) => [i.requestItemId, i.quantityAuthorized]));
  for (const id of given.keys()) {
    if (!items.some((it) => it.id === id)) throw new SadtRequestError('item de outra solicitação', 'invalid');
  }
  let total = 0;
  let full = true;
  for (const it of items) {
    const q = given.get(it.id) ?? 0;
    total += q;
    if (q < it.quantityRequested) full = false;
    await tx
      .update(hiAuthorizationItems)
      .set({ quantityAuthorized: q })
      .where(and(eq(hiAuthorizationItems.clinicId, clinicId), eq(hiAuthorizationItems.id, it.authorizationItemId!)));
  }
  if (total === 0) {
    throw new SadtRequestError('nenhuma quantidade autorizada: registre como negada, com o motivo', 'invalid');
  }
  const status: HiSadtRequestStatus = full ? 'authorized' : 'partially_authorized';
  await tx
    .update(hiAuthorizations)
    .set({
      status,
      authorizedOn: input.authorizedOn,
      operatorGuideNumber: input.operatorGuideNumber,
      operatorProtocol: input.operatorProtocol,
      passwordEncrypted: input.password ? await encryptForTenant(clinicId, input.password) : null,
      passwordValidUntil: input.passwordValidUntil,
      recordedBy: input.actorUserId,
    })
    .where(and(eq(hiAuthorizations.clinicId, clinicId), eq(hiAuthorizations.id, r.authorizationId)));
  await tx.insert(hiAuthorizationEvents).values({ clinicId, authorizationId: r.authorizationId, fromStatus: auth.status, toStatus: status, actorId: input.actorUserId });
  const version = await updateRequest(tx, clinicId, r.id, input.version, { status });
  await event(tx, { clinicId, requestId: r.id, from: r.status, to: status, actorUserId: input.actorUserId });
  return { status, version };
}

/** Cancela a solicitação inteira: só sem sessão executada (com sessão, encerre). */
export async function cancelSadtRequestInTx(
  tx: Tx,
  args: { clinicId: string; requestId: string; version: number; reason: string; actorUserId: string },
): Promise<number> {
  const r = await loadRequest(tx, args.clinicId, args.requestId);
  if (CLOSED.includes(r.status)) throw new SadtRequestError(`solicitação já encerrada (${r.status})`, 'state');
  const reason = args.reason.trim();
  if (reason.length < 10 || reason.length > 500) throw new SadtRequestError('motivo de 10 a 500 caracteres', 'invalid');
  const items = await tx
    .select({ id: hiSadtRequestItems.id })
    .from(hiSadtRequestItems)
    .where(and(eq(hiSadtRequestItems.clinicId, args.clinicId), eq(hiSadtRequestItems.requestId, r.id)));
  const executed = await executedByItemTx(tx, args.clinicId, items.map((i) => i.id));
  if ([...executed.values()].some((n) => n > 0)) {
    throw new SadtRequestError('há sessões executadas nesta solicitação: encerre-a em vez de cancelar', 'has_executions');
  }
  if (r.authorizationId) {
    await tx
      .update(hiAuthorizations)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(hiAuthorizations.clinicId, args.clinicId),
          eq(hiAuthorizations.id, r.authorizationId),
          inArray(hiAuthorizations.status, ['draft', 'requested', 'pending_operator']),
        ),
      );
  }
  const version = await updateRequest(tx, args.clinicId, r.id, args.version, {
    status: 'cancelled',
    cancelledAt: new Date(),
    cancelledBy: args.actorUserId,
    cancelReason: reason,
  });
  await event(tx, { clinicId: args.clinicId, requestId: r.id, from: r.status, to: 'cancelled', note: reason, actorUserId: args.actorUserId });
  return version;
}

/** Encerra: o saldo não executado deixa de valer (fica no histórico). */
export async function completeSadtRequestInTx(
  tx: Tx,
  args: { clinicId: string; requestId: string; version: number; note: string; actorUserId: string },
): Promise<number> {
  const r = await loadRequest(tx, args.clinicId, args.requestId);
  if (!['authorized', 'partially_authorized', 'ready', 'denied'].includes(r.status)) {
    throw new SadtRequestError(`só se encerra solicitação respondida ou pronta (estado: ${r.status})`, 'state');
  }
  const note = args.note.trim();
  if (note.length < 10 || note.length > 500) throw new SadtRequestError('motivo de 10 a 500 caracteres', 'invalid');
  const version = await updateRequest(tx, args.clinicId, r.id, args.version, { status: 'completed', note });
  await event(tx, { clinicId: args.clinicId, requestId: r.id, from: r.status, to: 'completed', note, actorUserId: args.actorUserId });
  return version;
}

/** Cancela um procedimento da solicitação (sem sessão executada dele). */
export async function cancelSadtRequestItemInTx(
  tx: Tx,
  args: { clinicId: string; requestId: string; itemId: string; reason: string; actorUserId: string },
): Promise<void> {
  const r = await loadRequest(tx, args.clinicId, args.requestId);
  if (CLOSED.includes(r.status)) throw new SadtRequestError(`solicitação encerrada (${r.status})`, 'state');
  const reason = args.reason.trim();
  if (reason.length < 10 || reason.length > 500) throw new SadtRequestError('motivo de 10 a 500 caracteres', 'invalid');
  const executed = await executedByItemTx(tx, args.clinicId, [args.itemId]);
  if ((executed.get(args.itemId) ?? 0) > 0) {
    throw new SadtRequestError('o procedimento já tem sessão executada', 'has_executions');
  }
  const [row] = await tx
    .update(hiSadtRequestItems)
    .set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy: args.actorUserId, cancelReason: reason })
    .where(
      and(
        eq(hiSadtRequestItems.clinicId, args.clinicId),
        eq(hiSadtRequestItems.requestId, args.requestId),
        eq(hiSadtRequestItems.id, args.itemId),
        eq(hiSadtRequestItems.status, 'active'),
      ),
    )
    .returning({ id: hiSadtRequestItems.id });
  if (!row) throw new SadtRequestError('procedimento inexistente ou já cancelado', 'not_found');
  await event(tx, { clinicId: args.clinicId, requestId: r.id, from: r.status, to: r.status, note: `procedimento cancelado: ${reason}`, actorUserId: args.actorUserId });
}

export { ACCEPTS_SESSIONS as SADT_REQUEST_ACCEPTS_SESSIONS };
