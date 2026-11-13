/**
 * Configuração do convênio pela clínica (P2.1–P2.5, P3.1; R44): identificação do
 * prestador, operadoras, planos, itens de contrato, perfil TISS do profissional e
 * carteirinhas. Tudo validado AQUI, no servidor; o banco confere de novo (CHECKs,
 * FKs compostas, gatilhos de mesma clínica, contrato imutável, carteirinha imutável
 * e o bloqueio comercial D24 na carteirinha).
 *
 * Regras que esta camada garante (e que os testes provam):
 *  - nada é inventado: registro ANS, códigos TUSS, conselho, UF e CBO vêm do que a
 *    clínica informa e só entram se existirem nas tabelas oficiais carregadas;
 *  - contrato é append-only: corrigir, reajustar a partir de uma data ou encerrar
 *    criam versões novas (`supersedes_id`). O reajuste NUNCA apaga o passado: a
 *    versão anterior é encerrada na véspera e a nova vigência é outra linha, para um
 *    atendimento antigo ainda sem guia continuar achando o preço da data dele. A guia
 *    emitida não muda nunca (snapshot congelado);
 *  - carteirinha: número só cifrado por clínica + HMAC de busca sobre
 *    `clínica:registro ANS:número normalizado` (D21) + últimos 4. Trocar o número é
 *    substituição (a antiga fica `replaced`, apontando para a nova);
 *  - desativar nunca apaga: operadora arquivada, plano arquivado e carteirinha
 *    inativa continuam no histórico e nas guias já feitas.
 *
 * Roda dentro da transação do chamador (Server Action em `withTenant`, com a pessoa
 * da sessão); a auditoria é gravada pelo chamador na mesma transação.
 */
import 'server-only';

import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

import { encryptForTenant, hashForLookup } from '@/lib/crypto/encryption';
import type { Tx } from '@/lib/db';
import { isValidCpf } from '@/lib/validation/document';

import {
  hiClinicSettings,
  hiInsurers,
  hiMemberships,
  hiPlans,
  hiProcedureContracts,
  hiProfessionalProfiles,
  tissTerminologyVersions,
  tissTerms,
  type HiCopayKind,
  type HiProviderIdKind,
} from '../schema';
import { isTermEffectiveOn } from '../tiss/terminology/lookup';
import { isTissCnpj } from '../tiss/validation/common';

/** Erro de regra de cadastro: a mensagem já é para o usuário e não leva dado pessoal. */
export class InsuranceConfigError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'InsuranceConfigError';
  }
}

const fail = (code: string, message: string): never => {
  throw new InsuranceConfigError(message, code);
};

const DAY = /^\d{4}-\d{2}-\d{2}$/u;
function assertDay(value: string, label: string): void {
  if (!DAY.test(value) || Number.isNaN(Date.parse(`${value}T12:00:00Z`))) fail('INVALID_DATE', `${label}: data inválida.`);
}
/** Véspera de `AAAA-MM-DD` (aritmética de calendário em UTC, sem fuso). */
export function dayBefore(value: string): string {
  const d = new Date(`${value}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function pgCode(e: unknown): { code: string | undefined; constraint: string | undefined } {
  const x = e as { code?: string; constraint_name?: string; constraint?: string; cause?: { code?: string; constraint_name?: string; constraint?: string } };
  return {
    code: x.code ?? x.cause?.code,
    constraint: x.constraint_name ?? x.constraint ?? x.cause?.constraint_name ?? x.cause?.constraint,
  };
}

async function lock(tx: Tx, key: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

// ── Terminologia oficial (TUSS) ──────────────────────────────────────────

export interface OfficialTerm {
  version: string;
  code: string;
  term: string;
  startsOn: string | null;
  endsOn: string | null;
}

/** O termo na competência MAIS RECENTE carregada que tem o código (nunca uma lista inventada). */
export async function latestOfficialTerm(tx: Tx, table: string, code: string): Promise<OfficialTerm | null> {
  const [row] = await tx
    .select({
      version: tissTerminologyVersions.version,
      code: tissTerms.code,
      term: tissTerms.term,
      startsOn: tissTerms.startsOn,
      endsOn: tissTerms.endsOn,
    })
    .from(tissTerms)
    .innerJoin(tissTerminologyVersions, eq(tissTerminologyVersions.id, tissTerms.versionId))
    .where(and(eq(tissTerms.tableCode, table), eq(tissTerms.code, code)))
    .orderBy(desc(tissTerminologyVersions.version))
    .limit(1);
  return row ?? null;
}

async function requireTerm(tx: Tx, table: string, code: string, label: string, on: string | null): Promise<OfficialTerm> {
  const t = await latestOfficialTerm(tx, table, code);
  if (!t) return fail('TERM_NOT_FOUND', `${label} ${code} não existe na tabela ${table} da terminologia TISS carregada.`);
  if (on && !isTermEffectiveOn({ code: t.code, term: t.term, startsOn: t.startsOn, endsOn: t.endsOn, implantationEndsOn: null }, on)) {
    fail('TERM_NOT_EFFECTIVE', `${label} ${code} não está vigente em ${on} na tabela ${table} (competência ${t.version}).`);
  }
  return t;
}

// ── Identificação do prestador (P2.4) ────────────────────────────────────

export interface ProviderIdentityInput {
  providerKind: 'PF' | 'PJ';
  /** Nome do contratado como vai na guia (1 a 70 caracteres). */
  contractorName: string;
  cnesStatus: 'has' | 'none_declared' | 'unknown';
  cnes: string | null;
}

/**
 * Grava a identificação do prestador da clínica. NUNCA liga o módulo (a habilitação é
 * operacional, do Qoro): cria a linha desligada quando ainda não existe.
 */
export async function saveProviderIdentityTx(tx: Tx, clinicId: string, input: ProviderIdentityInput) {
  const contractorName = input.contractorName.trim().replace(/\s+/gu, ' ');
  if (contractorName.length < 1 || contractorName.length > 70) fail('CONTRACTOR_NAME', 'Informe o nome do contratado (até 70 caracteres), como consta no contrato com a operadora.');
  let cnes: string | null = null;
  if (input.cnesStatus === 'has') {
    cnes = (input.cnes ?? '').replace(/\D/gu, '');
    if (!/^\d{7}$/u.test(cnes) || cnes === '9999999') fail('CNES', 'O CNES tem 7 dígitos. Se a clínica não tem CNES, marque a declaração de ausência.');
  }
  const [before] = await tx.select().from(hiClinicSettings).where(eq(hiClinicSettings.clinicId, clinicId)).limit(1);
  await tx
    .insert(hiClinicSettings)
    .values({ clinicId, providerKind: input.providerKind, contractorName, cnesStatus: input.cnesStatus, cnes })
    .onConflictDoUpdate({
      target: hiClinicSettings.clinicId,
      set: { providerKind: input.providerKind, contractorName, cnesStatus: input.cnesStatus, cnes },
    });
  return {
    before: before ? { providerKind: before.providerKind, contractorName: before.contractorName, cnesStatus: before.cnesStatus, cnes: before.cnes } : null,
    after: { providerKind: input.providerKind, contractorName, cnesStatus: input.cnesStatus, cnes },
  };
}

// ── Operadoras (P2.1/P2.5) ───────────────────────────────────────────────

export type InsurerStatus = 'draft' | 'active' | 'suspended' | 'archived';

export interface InsurerInput {
  name: string;
  registroAns: string;
  providerIdKind: HiProviderIdKind;
  providerIdValue: string;
  sadtGrouping: 'per_session' | 'per_request';
}

/** Identificação do prestador na operadora como vai no XML (normalizada e conferida). */
export function normalizeProviderId(kind: HiProviderIdKind, raw: string): string {
  const v = raw.trim();
  if (kind === 'cnpjContratado') {
    const cnpj = v.toUpperCase().replace(/[^A-Z0-9]/gu, '');
    if (!isTissCnpj(cnpj)) fail('PROVIDER_ID', 'CNPJ do contratado inválido (confira os dígitos verificadores).');
    return cnpj;
  }
  if (kind === 'cpfContratado') {
    const cpf = v.replace(/\D/gu, '');
    if (cpf.length !== 11 || !isValidCpf(cpf)) fail('PROVIDER_ID', 'CPF do contratado inválido.');
    return cpf;
  }
  if (v.length < 1 || v.length > 14) fail('PROVIDER_ID', 'O código do prestador na operadora tem de 1 a 14 caracteres (como a operadora informou).');
  return v;
}

function cleanInsurer(input: InsurerInput) {
  const name = input.name.trim().replace(/\s+/gu, ' ');
  if (name.length < 2 || name.length > 120) fail('INSURER_NAME', 'Informe o nome da operadora (2 a 120 caracteres).');
  const registroAns = input.registroAns.replace(/\D/gu, '');
  if (!/^\d{6}$/u.test(registroAns)) fail('REGISTRO_ANS', 'O registro ANS da operadora tem 6 dígitos (consulte o contrato ou o cadastro da ANS).');
  return {
    name,
    registroAns,
    providerIdKind: input.providerIdKind,
    providerIdValue: normalizeProviderId(input.providerIdKind, input.providerIdValue),
    sadtGrouping: input.sadtGrouping,
  };
}

export async function createInsurerTx(tx: Tx, clinicId: string, userId: string, input: InsurerInput) {
  const v = cleanInsurer(input);
  try {
    const [row] = await tx
      .insert(hiInsurers)
      .values({ clinicId, ...v, status: 'draft', tissVersion: '4.03.00', connectorKind: 'manual', settings: {}, createdBy: userId })
      .returning({ id: hiInsurers.id });
    return { insurerId: row!.id, after: { ...v, status: 'draft' } };
  } catch (e) {
    if (pgCode(e).code === '23505') fail('INSURER_DUPLICATE', 'Esta operadora (mesmo registro ANS) já está cadastrada na clínica.');
    throw e;
  }
}

async function insurerOf(tx: Tx, clinicId: string, insurerId: string) {
  const [row] = await tx.select().from(hiInsurers).where(and(eq(hiInsurers.clinicId, clinicId), eq(hiInsurers.id, insurerId))).limit(1);
  if (!row) return fail('INSURER_NOT_FOUND', 'Operadora não encontrada nesta clínica.');
  return row;
}

/** Edição: nome, identificação do prestador e agrupamento SP/SADT; o registro ANS só no rascunho. */
export async function updateInsurerTx(tx: Tx, clinicId: string, insurerId: string, input: InsurerInput) {
  await lock(tx, `hi:insurer:${insurerId}`);
  const cur = await insurerOf(tx, clinicId, insurerId);
  if (cur.status === 'archived') fail('INSURER_ARCHIVED', 'Operadora arquivada não é editada; reative-a primeiro.');
  const v = cleanInsurer(input);
  if (v.registroAns !== cur.registroAns && cur.status !== 'draft') {
    fail('REGISTRO_ANS_LOCKED', 'O registro ANS só muda enquanto a operadora está em rascunho. Para outra operadora, faça um cadastro novo.');
  }
  try {
    await tx.update(hiInsurers).set(v).where(and(eq(hiInsurers.clinicId, clinicId), eq(hiInsurers.id, insurerId)));
  } catch (e) {
    if (pgCode(e).code === '23505') fail('INSURER_DUPLICATE', 'Já existe outra operadora com este registro ANS na clínica.');
    throw e;
  }
  return {
    before: { name: cur.name, registroAns: cur.registroAns, providerIdKind: cur.providerIdKind, providerIdValue: cur.providerIdValue, sadtGrouping: cur.sadtGrouping },
    after: v,
  };
}

const INSURER_TRANSITIONS: Record<InsurerStatus, readonly InsurerStatus[]> = {
  draft: ['active', 'archived'],
  active: ['suspended', 'archived'],
  suspended: ['active', 'archived'],
  archived: ['active'],
};

/**
 * Situação operacional. Suspender ou arquivar não apaga nada: guias, contratos e
 * carteirinhas ficam; a operadora some das opções do agendamento e a cobertura nova
 * nasce com pendência.
 */
export async function setInsurerStatusTx(tx: Tx, clinicId: string, insurerId: string, to: InsurerStatus) {
  await lock(tx, `hi:insurer:${insurerId}`);
  const cur = await insurerOf(tx, clinicId, insurerId);
  if (cur.status === to) return { before: cur.status, after: to, changed: false };
  if (!INSURER_TRANSITIONS[cur.status].includes(to)) {
    fail('INSURER_TRANSITION', `A operadora não passa de "${cur.status}" para "${to}".`);
  }
  await tx.update(hiInsurers).set({ status: to }).where(and(eq(hiInsurers.clinicId, clinicId), eq(hiInsurers.id, insurerId)));
  return { before: cur.status, after: to, changed: true };
}

// ── Planos ───────────────────────────────────────────────────────────────

export interface PlanInput {
  name: string;
  operatorCode: string | null;
  category: 'ambulatorial' | 'hospitalar' | 'referencia' | 'outro' | null;
}

export async function createPlanTx(tx: Tx, clinicId: string, insurerId: string, input: PlanInput) {
  const ins = await insurerOf(tx, clinicId, insurerId);
  if (ins.status === 'archived') fail('INSURER_ARCHIVED', 'Operadora arquivada não recebe plano novo.');
  const name = input.name.trim().replace(/\s+/gu, ' ');
  if (name.length < 1 || name.length > 120) fail('PLAN_NAME', 'Informe o nome do plano (até 120 caracteres).');
  const operatorCode = input.operatorCode?.trim() || null;
  if (operatorCode && operatorCode.length > 40) fail('PLAN_CODE', 'O código do plano na operadora tem até 40 caracteres.');
  try {
    const [row] = await tx
      .insert(hiPlans)
      .values({ clinicId, insurerId, name, operatorCode, category: input.category, status: 'active' })
      .returning({ id: hiPlans.id });
    return { planId: row!.id, after: { insurerId, name, operatorCode, category: input.category } };
  } catch (e) {
    if (pgCode(e).code === '23505') fail('PLAN_DUPLICATE', 'Já existe um plano com este nome nesta operadora.');
    throw e;
  }
}

export async function setPlanStatusTx(tx: Tx, clinicId: string, planId: string, to: 'active' | 'archived') {
  const [cur] = await tx.select().from(hiPlans).where(and(eq(hiPlans.clinicId, clinicId), eq(hiPlans.id, planId))).limit(1);
  if (!cur) return fail('PLAN_NOT_FOUND', 'Plano não encontrado nesta clínica.');
  await tx.update(hiPlans).set({ status: to }).where(and(eq(hiPlans.clinicId, clinicId), eq(hiPlans.id, planId)));
  return { insurerId: cur.insurerId, before: cur.status, after: to };
}

async function assertPlanOf(tx: Tx, clinicId: string, insurerId: string, planId: string | null, requireActive: boolean) {
  if (!planId) return;
  const [p] = await tx
    .select({ insurerId: hiPlans.insurerId, status: hiPlans.status })
    .from(hiPlans)
    .where(and(eq(hiPlans.clinicId, clinicId), eq(hiPlans.id, planId)))
    .limit(1);
  if (!p || p.insurerId !== insurerId) fail('PLAN_MISMATCH', 'O plano não é desta operadora.');
  if (requireActive && p!.status !== 'active') fail('PLAN_ARCHIVED', 'O plano está arquivado.');
}

// ── Itens de contrato (P2.3) ─────────────────────────────────────────────

export interface ContractTermsInput {
  /** Valor contratado do procedimento, em centavos. */
  unitValueCents: number;
  requiresAuthorization: boolean;
  copayKind: HiCopayKind;
  copayFixedCents: number | null;
  /** Percentual com até 2 casas (ex.: 30 ou 12.5). */
  copayPercentage: number | null;
  returnDays: number | null;
  returnBillable: boolean;
}

export interface ContractLineInput extends ContractTermsInput {
  insurerId: string;
  planId: string | null;
  guideType: 'consulta' | 'sp_sadt';
  /** Só a tabela 22 (TUSS procedimentos): as tabelas 18, 19 e 20 estão fora desta versão (ADR-072). */
  tableCode: '22';
  procedureCode: string;
  /** Vazio = a descrição oficial da TUSS. */
  description: string | null;
  /** Procedimento do catálogo do Qoro que o agendamento usa. */
  procedureId: string;
  validFrom: string;
  validUntil: string | null;
}

function cleanTerms(t: ContractTermsInput) {
  if (!Number.isInteger(t.unitValueCents) || t.unitValueCents < 0 || t.unitValueCents > 9_999_999_999) fail('CONTRACT_VALUE', 'Valor contratado inválido.');
  let copayFixedCents: number | null = null;
  let copayPercentage: string | null = null;
  if (t.copayKind === 'fixed') {
    if (!Number.isInteger(t.copayFixedCents) || (t.copayFixedCents ?? -1) < 0) fail('COPAY', 'Informe o valor fixo da coparticipação.');
    if ((t.copayFixedCents ?? 0) > t.unitValueCents) fail('COPAY', 'A coparticipação não pode passar do valor contratado do procedimento.');
    copayFixedCents = t.copayFixedCents;
  } else if (t.copayKind === 'percentage') {
    const p = Number(t.copayPercentage);
    if (!(p > 0 && p <= 100) || Math.abs(Math.round(p * 100) - p * 100) > 1e-6) fail('COPAY', 'O percentual de coparticipação vai de 0,01 a 100, com até 2 casas.');
    copayPercentage = p.toFixed(2);
  }
  if (t.returnDays !== null && (!Number.isInteger(t.returnDays) || t.returnDays < 1 || t.returnDays > 365)) fail('RETURN_DAYS', 'O prazo de retorno vai de 1 a 365 dias.');
  if (t.returnBillable && t.returnDays === null) fail('RETURN_DAYS', 'Retorno faturável exige o prazo de retorno.');
  return {
    unitValueCents: t.unitValueCents,
    requiresAuthorization: t.requiresAuthorization,
    copayKind: t.copayKind,
    copayFixedCents,
    copayPercentage,
    returnDays: t.returnDays,
    returnBillable: t.returnDays === null ? false : t.returnBillable,
  };
}

type ContractRow = typeof hiProcedureContracts.$inferSelect;

/** Linhas VIVAS (não substituídas) do mesmo alvo: operadora, plano, tipo de guia e código. */
async function liveLinesOfTarget(
  tx: Tx,
  clinicId: string,
  t: { insurerId: string; planId: string | null; guideType: string; tableCode: string; procedureCode: string },
  exceptId?: string,
): Promise<ContractRow[]> {
  const rows = await tx
    .select()
    .from(hiProcedureContracts)
    .where(
      and(
        eq(hiProcedureContracts.clinicId, clinicId),
        eq(hiProcedureContracts.insurerId, t.insurerId),
        t.planId ? eq(hiProcedureContracts.planId, t.planId) : isNull(hiProcedureContracts.planId),
        eq(hiProcedureContracts.guideType, t.guideType as 'consulta'),
        eq(hiProcedureContracts.tableCode, t.tableCode),
        eq(hiProcedureContracts.procedureCode, t.procedureCode),
        sql`NOT EXISTS (SELECT 1 FROM public.hi_procedure_contracts s WHERE s.clinic_id = ${clinicId}::uuid AND s.supersedes_id = ${hiProcedureContracts.id})`,
        ...(exceptId ? [ne(hiProcedureContracts.id, exceptId)] : []),
      ),
    );
  return rows;
}

const overlaps = (aFrom: string, aUntil: string | null, bFrom: string, bUntil: string | null) =>
  aFrom <= (bUntil ?? '9999-12-31') && bFrom <= (aUntil ?? '9999-12-31');

async function assertProcedureOfClinic(tx: Tx, clinicId: string, procedureId: string) {
  const rows = (await tx.execute(sql`SELECT 1 AS ok FROM public.procedures WHERE id = ${procedureId}::uuid AND clinic_id = ${clinicId}::uuid LIMIT 1`)) as unknown as unknown[];
  if (rows.length === 0) fail('PROCEDURE_NOT_FOUND', 'Procedimento do catálogo não encontrado nesta clínica.');
}

/** Item novo de contrato (procedimento ainda sem item vivo no período). */
export async function createContractLineTx(tx: Tx, clinicId: string, userId: string, input: ContractLineInput) {
  if (input.tableCode !== '22') fail('TABLE_SCOPE', 'Só procedimentos da tabela 22 (TUSS) nesta versão; materiais, medicamentos e taxas estão fora do escopo declarado.');
  assertDay(input.validFrom, 'Início da vigência');
  if (input.validUntil) {
    assertDay(input.validUntil, 'Fim da vigência');
    if (input.validUntil < input.validFrom) fail('PERIOD', 'O fim da vigência é antes do início.');
  }
  const ins = await insurerOf(tx, clinicId, input.insurerId);
  if (ins.status === 'archived') fail('INSURER_ARCHIVED', 'Operadora arquivada não recebe contrato novo.');
  await assertPlanOf(tx, clinicId, input.insurerId, input.planId, true);
  await assertProcedureOfClinic(tx, clinicId, input.procedureId);
  const procedureCode = input.procedureCode.replace(/\D/gu, '');
  if (!/^\d{1,10}$/u.test(procedureCode)) fail('TUSS_CODE', 'Código TUSS inválido (só números, até 10 dígitos).');
  const term = await requireTerm(tx, '22', procedureCode, 'Código TUSS', input.validFrom);
  const terms = cleanTerms(input);
  const target = { insurerId: input.insurerId, planId: input.planId, guideType: input.guideType, tableCode: '22', procedureCode };
  // Serializa o mesmo alvo: duas pessoas não criam dois itens vivos sobrepostos.
  await lock(tx, `hi:contract:${clinicId}:${input.insurerId}:${input.planId ?? '-'}:${input.guideType}:22:${procedureCode}`);
  const live = await liveLinesOfTarget(tx, clinicId, target);
  if (live.some((l) => overlaps(l.validFrom, l.validUntil, input.validFrom, input.validUntil))) {
    fail('CONTRACT_OVERLAP', 'Já existe item vigente deste procedimento no período. Use "Reajustar a partir de", "Corrigir" ou "Encerrar" no item atual.');
  }
  const description = (input.description?.trim() || term.term).slice(0, 150);
  const [row] = await tx
    .insert(hiProcedureContracts)
    .values({
      clinicId,
      ...target,
      guideType: input.guideType,
      description,
      procedureId: input.procedureId,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      ...terms,
      createdBy: userId,
    })
    .returning({ id: hiProcedureContracts.id });
  return { lineId: row!.id, after: { insurerId: input.insurerId, planId: input.planId, guideType: input.guideType, procedureCode, validFrom: input.validFrom, validUntil: input.validUntil, ...terms, terminology: term.version } };
}

export type ContractRevision =
  /** Corrige o item (mesma vigência, valores certos): vale para quem ainda não tem guia emitida. */
  | { mode: 'correct'; terms: ContractTermsInput; description: string | null; procedureId: string; reason: string }
  /** Reajuste a partir de uma data: o item atual vale até a véspera; o novo começa na data. */
  | { mode: 'new_period'; from: string; terms: ContractTermsInput; reason: string }
  /** Encerra a vigência na data (inclusive). */
  | { mode: 'end'; until: string; reason: string };

/**
 * Revisão de um item vivo. Append-only: a linha antiga nunca muda (gatilho no banco);
 * uma linha nova a substitui (`supersedes_id`, único). Quem revisou primeiro ganha: a
 * segunda revisão concorrente do mesmo item recebe "já revisado" (UNIQUE).
 */
export async function reviseContractLineTx(tx: Tx, clinicId: string, userId: string, lineId: string, rev: ContractRevision) {
  const reason = rev.reason.trim();
  if (reason.length < 10 || reason.length > 500) fail('REASON', 'Informe o motivo da alteração do contrato (10 a 500 caracteres).');
  await lock(tx, `hi:contract-line:${lineId}`);
  const [cur] = await tx
    .select()
    .from(hiProcedureContracts)
    .where(and(eq(hiProcedureContracts.clinicId, clinicId), eq(hiProcedureContracts.id, lineId)))
    .limit(1);
  if (!cur) return fail('CONTRACT_NOT_FOUND', 'Item de contrato não encontrado nesta clínica.');
  const [successor] = await tx
    .select({ id: hiProcedureContracts.id })
    .from(hiProcedureContracts)
    .where(and(eq(hiProcedureContracts.clinicId, clinicId), eq(hiProcedureContracts.supersedesId, lineId)))
    .limit(1);
  if (successor) fail('CONTRACT_ALREADY_REVISED', 'Este item já foi revisado; recarregue a página para ver a versão atual.');
  const ins = await insurerOf(tx, clinicId, cur.insurerId);
  if (ins.status === 'archived') fail('INSURER_ARCHIVED', 'Operadora arquivada: reative-a antes de mexer no contrato.');

  const identity = {
    clinicId,
    insurerId: cur.insurerId,
    planId: cur.planId,
    guideType: cur.guideType,
    tableCode: cur.tableCode,
    procedureCode: cur.procedureCode,
    createdBy: userId,
  };
  const termsOf = (r: ContractRow) => ({
    unitValueCents: r.unitValueCents,
    requiresAuthorization: r.requiresAuthorization,
    copayKind: r.copayKind,
    copayFixedCents: r.copayFixedCents,
    copayPercentage: r.copayPercentage,
    returnDays: r.returnDays,
    returnBillable: r.returnBillable,
  });
  const insert = async (values: typeof hiProcedureContracts.$inferInsert) => {
    try {
      const [r] = await tx.insert(hiProcedureContracts).values(values).returning({ id: hiProcedureContracts.id });
      return r!.id;
    } catch (e) {
      const { code, constraint } = pgCode(e);
      if (code === '23505' && constraint === 'hi_procedure_contracts_supersedes_once') {
        fail('CONTRACT_ALREADY_REVISED', 'Este item já foi revisado por outra pessoa; recarregue a página.');
      }
      throw e;
    }
  };

  if (rev.mode === 'correct') {
    await assertProcedureOfClinic(tx, clinicId, rev.procedureId);
    const terms = cleanTerms(rev.terms);
    const id = await insert({
      ...identity,
      description: (rev.description?.trim() || cur.description).slice(0, 150),
      procedureId: rev.procedureId,
      validFrom: cur.validFrom,
      validUntil: cur.validUntil,
      ...terms,
      supersedesId: cur.id,
    });
    return { lineIds: [id], after: { mode: 'correct', supersedes: cur.id, ...terms, reason } };
  }

  if (rev.mode === 'end') {
    assertDay(rev.until, 'Fim da vigência');
    if (rev.until < cur.validFrom) fail('PERIOD', 'O fim da vigência é antes do início do item.');
    if (cur.validUntil && rev.until > cur.validUntil) fail('PERIOD', 'O item já termina antes desta data.');
    const id = await insert({ ...identity, description: cur.description, procedureId: cur.procedureId, validFrom: cur.validFrom, validUntil: rev.until, ...termsOf(cur), supersedesId: cur.id });
    return { lineIds: [id], after: { mode: 'end', supersedes: cur.id, until: rev.until, reason } };
  }

  // Reajuste a partir de `from`: o passado continua com o preço antigo.
  assertDay(rev.from, 'Início da nova vigência');
  if (rev.from <= cur.validFrom) fail('PERIOD', 'O reajuste começa depois do início do item atual; para mudar desde o início, use "Corrigir".');
  if (cur.validUntil && rev.from > cur.validUntil) fail('PERIOD', 'O item atual já terminou antes desta data; cadastre um item novo.');
  await requireTerm(tx, cur.tableCode, cur.procedureCode, 'Código TUSS', rev.from);
  const terms = cleanTerms(rev.terms);
  const closedId = await insert({
    ...identity,
    description: cur.description,
    procedureId: cur.procedureId,
    validFrom: cur.validFrom,
    validUntil: dayBefore(rev.from),
    ...termsOf(cur),
    supersedesId: cur.id,
  });
  const nextId = await insert({
    ...identity,
    description: cur.description,
    procedureId: cur.procedureId,
    validFrom: rev.from,
    validUntil: cur.validUntil,
    ...terms,
  });
  return { lineIds: [closedId, nextId], after: { mode: 'new_period', supersedes: cur.id, from: rev.from, ...terms, reason } };
}

// ── Perfil TISS do profissional (P2.2) ───────────────────────────────────

export interface ProfessionalProfileInput {
  professionalId: string;
  /** Tabela 26 (conselho profissional), 2 dígitos. */
  council: string;
  councilNumber: string;
  /** Tabela 59 (UF), código numérico de 2 dígitos. */
  councilUf: string;
  /** Tabela 24 (CBO), 6 dígitos; `999999` não serve para o executante. */
  cbo: string;
}

export async function saveProfessionalProfileTx(tx: Tx, clinicId: string, input: ProfessionalProfileInput) {
  const today = new Date().toISOString().slice(0, 10);
  const council = input.council.trim();
  const councilUf = input.councilUf.trim();
  const cbo = input.cbo.replace(/\D/gu, '');
  const councilNumber = input.councilNumber.trim().replace(/\s+/gu, '');
  if (!/^\d{2}$/u.test(council)) fail('COUNCIL', 'Escolha o conselho profissional.');
  if (!/^\d{2}$/u.test(councilUf)) fail('COUNCIL_UF', 'Escolha a UF do conselho.');
  if (!/^\d{6}$/u.test(cbo) || cbo === '999999') fail('CBO', 'Informe o CBO de 6 dígitos da especialidade do profissional (999999 não é aceito para quem executa).');
  if (councilNumber.length < 1 || councilNumber.length > 15) fail('COUNCIL_NUMBER', 'Informe o número no conselho (até 15 caracteres).');
  await requireTerm(tx, '26', council, 'Conselho', today);
  await requireTerm(tx, '59', councilUf, 'UF', today);
  await requireTerm(tx, '24', cbo, 'CBO', today);
  const [before] = await tx
    .select()
    .from(hiProfessionalProfiles)
    .where(and(eq(hiProfessionalProfiles.clinicId, clinicId), eq(hiProfessionalProfiles.professionalId, input.professionalId)))
    .limit(1);
  try {
    await tx
      .insert(hiProfessionalProfiles)
      .values({ clinicId, professionalId: input.professionalId, council, councilNumber, councilUf, cbo })
      .onConflictDoUpdate({
        target: [hiProfessionalProfiles.clinicId, hiProfessionalProfiles.professionalId],
        set: { council, councilNumber, councilUf, cbo },
      });
  } catch (e) {
    if (pgCode(e).code === '23503') fail('PROFESSIONAL_NOT_FOUND', 'Profissional não encontrado nesta clínica.');
    throw e;
  }
  return {
    before: before ? { council: before.council, councilNumber: before.councilNumber, councilUf: before.councilUf, cbo: before.cbo } : null,
    after: { council, councilNumber, councilUf, cbo },
  };
}

// ── Carteirinhas (P3.1) ──────────────────────────────────────────────────

/** Número normalizado como vai no XML (`st_texto20`): sem espaços, pontos e traços; maiúsculas. */
export function normalizeCardNumber(raw: string): string {
  const n = raw.toUpperCase().replace(/[\s.\-/]/gu, '');
  if (!/^[0-9A-Z]{1,20}$/u.test(n)) fail('CARD_NUMBER', 'O número da carteirinha tem até 20 letras ou números.');
  return n;
}

/** D21: HMAC de busca sobre `clínica:registro ANS:número normalizado`. */
export async function membershipLookupHash(clinicId: string, registroAns: string, normalized: string): Promise<string> {
  return hashForLookup(`${clinicId}:${registroAns}:${normalized}`);
}

export interface MembershipInput {
  patientId: string;
  insurerId: string;
  planId: string | null;
  cardNumber: string;
  holderKind: 'titular' | 'dependente';
  validUntil: string | null;
  preferred: boolean;
}

const DUPLICATE_CARD = 'Esta carteirinha já está ativa nesta operadora em outro cadastro da clínica. Confira o número.';

async function clearPreferred(tx: Tx, clinicId: string, patientId: string, exceptId?: string) {
  await tx
    .update(hiMemberships)
    .set({ isPreferred: false })
    .where(
      and(
        eq(hiMemberships.clinicId, clinicId),
        eq(hiMemberships.patientId, patientId),
        eq(hiMemberships.isPreferred, true),
        ...(exceptId ? [ne(hiMemberships.id, exceptId)] : []),
      ),
    );
}

async function insertMembership(tx: Tx, clinicId: string, userId: string, registroAns: string, input: MembershipInput) {
  const normalized = normalizeCardNumber(input.cardNumber);
  if (input.validUntil) assertDay(input.validUntil, 'Validade da carteirinha');
  const [cardNumberEncrypted, cardNumberHash] = await Promise.all([
    encryptForTenant(clinicId, normalized),
    membershipLookupHash(clinicId, registroAns, normalized),
  ]);
  if (input.preferred) await clearPreferred(tx, clinicId, input.patientId);
  try {
    const [row] = await tx
      .insert(hiMemberships)
      .values({
        clinicId,
        patientId: input.patientId,
        insurerId: input.insurerId,
        planId: input.planId,
        cardNumberEncrypted,
        cardNumberHash,
        cardLast4: normalized.slice(-4),
        holderKind: input.holderKind,
        validUntil: input.validUntil,
        isPreferred: input.preferred,
        status: 'active',
        createdBy: userId,
      })
      .returning({ id: hiMemberships.id });
    return { membershipId: row!.id, normalized };
  } catch (e) {
    const { code, constraint } = pgCode(e);
    if (code === '23505' && constraint === 'hi_memberships_active_card_uniq') fail('CARD_DUPLICATE', DUPLICATE_CARD);
    if (code === '23503') fail('PATIENT_NOT_FOUND', 'Paciente não encontrado nesta clínica.');
    throw e;
  }
}

export async function createMembershipTx(tx: Tx, clinicId: string, userId: string, input: MembershipInput) {
  const ins = await insurerOf(tx, clinicId, input.insurerId);
  if (ins.status === 'archived') fail('INSURER_ARCHIVED', 'A operadora está arquivada no cadastro da clínica.');
  await assertPlanOf(tx, clinicId, input.insurerId, input.planId, true);
  await lock(tx, `hi:patient-cards:${input.patientId}`);
  const { membershipId } = await insertMembership(tx, clinicId, userId, ins.registroAns, input);
  return { membershipId, after: { patientId: input.patientId, insurerId: input.insurerId, planId: input.planId, holderKind: input.holderKind, validUntil: input.validUntil, preferred: input.preferred } };
}

async function membershipOf(tx: Tx, clinicId: string, membershipId: string) {
  const [row] = await tx.select().from(hiMemberships).where(and(eq(hiMemberships.clinicId, clinicId), eq(hiMemberships.id, membershipId))).limit(1);
  if (!row) return fail('MEMBERSHIP_NOT_FOUND', 'Carteirinha não encontrada nesta clínica.');
  return row;
}

/** Número novo (cartão reemitido, troca de plano com número novo): a antiga vira `replaced`. */
export async function replaceMembershipTx(
  tx: Tx,
  clinicId: string,
  userId: string,
  membershipId: string,
  input: { cardNumber: string; planId: string | null; holderKind: 'titular' | 'dependente'; validUntil: string | null },
) {
  const cur0 = await membershipOf(tx, clinicId, membershipId);
  await lock(tx, `hi:patient-cards:${cur0.patientId}`);
  const cur = await membershipOf(tx, clinicId, membershipId);
  if (cur.status === 'replaced') fail('MEMBERSHIP_REPLACED', 'Esta carteirinha já foi substituída.');
  const ins = await insurerOf(tx, clinicId, cur.insurerId);
  await assertPlanOf(tx, clinicId, cur.insurerId, input.planId, true);
  const normalized = normalizeCardNumber(input.cardNumber);
  if ((await membershipLookupHash(clinicId, ins.registroAns, normalized)) === cur.cardNumberHash) {
    fail('CARD_SAME_NUMBER', 'É o mesmo número: para renovar, atualize a validade em vez de substituir.');
  }
  // 1) a antiga sai de ativa (libera o índice de preferencial); 2) a nova entra; 3) a antiga aponta para ela.
  await tx.update(hiMemberships).set({ status: 'replaced', isPreferred: false }).where(and(eq(hiMemberships.clinicId, clinicId), eq(hiMemberships.id, cur.id)));
  const { membershipId: newId } = await insertMembership(tx, clinicId, userId, ins.registroAns, {
    patientId: cur.patientId,
    insurerId: cur.insurerId,
    planId: input.planId,
    cardNumber: normalized,
    holderKind: input.holderKind,
    validUntil: input.validUntil,
    preferred: cur.isPreferred,
  });
  await tx.update(hiMemberships).set({ replacedById: newId }).where(and(eq(hiMemberships.clinicId, clinicId), eq(hiMemberships.id, cur.id)));
  return { membershipId: newId, after: { replaces: cur.id, insurerId: cur.insurerId, planId: input.planId, validUntil: input.validUntil } };
}

/** Campos que não identificam a carteirinha: plano, titularidade e validade. */
export async function updateMembershipTx(
  tx: Tx,
  clinicId: string,
  membershipId: string,
  input: { planId: string | null; holderKind: 'titular' | 'dependente'; validUntil: string | null },
) {
  const cur = await membershipOf(tx, clinicId, membershipId);
  if (cur.status === 'replaced') fail('MEMBERSHIP_REPLACED', 'Carteirinha substituída não é editada.');
  await assertPlanOf(tx, clinicId, cur.insurerId, input.planId, true);
  if (input.validUntil) assertDay(input.validUntil, 'Validade da carteirinha');
  await tx
    .update(hiMemberships)
    .set({ planId: input.planId, holderKind: input.holderKind, validUntil: input.validUntil })
    .where(and(eq(hiMemberships.clinicId, clinicId), eq(hiMemberships.id, membershipId)));
  return {
    before: { planId: cur.planId, holderKind: cur.holderKind, validUntil: cur.validUntil },
    after: input,
  };
}

export async function setMembershipActiveTx(tx: Tx, clinicId: string, membershipId: string, active: boolean) {
  const cur = await membershipOf(tx, clinicId, membershipId);
  if (cur.status === 'replaced') fail('MEMBERSHIP_REPLACED', 'Carteirinha substituída não volta a ficar ativa.');
  try {
    await tx
      .update(hiMemberships)
      .set(active ? { status: 'active' } : { status: 'inactive', isPreferred: false })
      .where(and(eq(hiMemberships.clinicId, clinicId), eq(hiMemberships.id, membershipId)));
  } catch (e) {
    const { code, constraint } = pgCode(e);
    if (code === '23505' && constraint === 'hi_memberships_active_card_uniq') fail('CARD_DUPLICATE', DUPLICATE_CARD);
    throw e;
  }
  return { patientId: cur.patientId, before: cur.status, after: active ? 'active' : 'inactive' };
}

export async function setPreferredMembershipTx(tx: Tx, clinicId: string, membershipId: string) {
  const cur = await membershipOf(tx, clinicId, membershipId);
  if (cur.status !== 'active') fail('MEMBERSHIP_NOT_ACTIVE', 'Só a carteirinha ativa pode ser a preferencial.');
  await lock(tx, `hi:patient-cards:${cur.patientId}`);
  await clearPreferred(tx, clinicId, cur.patientId, cur.id);
  await tx.update(hiMemberships).set({ isPreferred: true }).where(and(eq(hiMemberships.clinicId, clinicId), eq(hiMemberships.id, cur.id)));
  return { patientId: cur.patientId };
}

/** Para a agenda: operadoras que aceitam cobertura nova (ativas) com os planos ativos. */
export async function schedulableInsurersTx(tx: Tx, clinicId: string) {
  const ins = await tx
    .select({ id: hiInsurers.id, name: hiInsurers.name })
    .from(hiInsurers)
    .where(and(eq(hiInsurers.clinicId, clinicId), eq(hiInsurers.status, 'active')))
    .orderBy(hiInsurers.name);
  if (ins.length === 0) return [];
  const plans = await tx
    .select({ id: hiPlans.id, insurerId: hiPlans.insurerId, name: hiPlans.name })
    .from(hiPlans)
    .where(and(eq(hiPlans.clinicId, clinicId), eq(hiPlans.status, 'active'), inArray(hiPlans.insurerId, ins.map((i) => i.id))))
    .orderBy(hiPlans.name);
  return ins.map((i) => ({ ...i, plans: plans.filter((p) => p.insurerId === i.id).map(({ id, name }) => ({ id, name })) }));
}
