/**
 * Leituras da interface de Convênios (P7.7/P9.9): painel, guias, lotes e conciliação.
 *
 * Tudo pela RLS da clínica da sessão (`withTenant`). Nada aqui decifra snapshot ou
 * carteirinha: o conteúdo emitido da guia só sai pela leitura auditada (`guide-access`,
 * PDF) e o XML pelo download auditado (`tiss-file-access`). O nome do paciente aparece
 * como no Caixa (quem vê o financeiro já vê quem deve).
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';
import { getPremiumDenialTx, type PremiumDenial } from '@/lib/premium-access';

import { authorizationAlerts, type AuthorizationAlert } from './internal/authorization-alerts';
import { authorizationDisplayState, remainingQuantity, type AuthorizationDisplayState } from './internal/authorization-rules';
import { listCopayChargesTx } from './internal/copay-charge-service';
import { insurerRules } from './internal/insurer-rules';
import { listInsurancePayoutPositionsTx, type InsurancePayoutPosition } from './internal/insurance-payout-service';
import { listPayoutReviewsTx, type PayoutReviewRow } from './internal/payout-review-service';
import { listGuideCancellationsTx, type GuideCancellationRow } from './internal/guide-cancellation-service';
import { extraItemsAvailableTx, listExtraItemsTx, type ExtraItemView } from './internal/extra-executed-items';
import { reissueBlockTx, reissuedFromTx } from './internal/guide-reissue';
import { GUIDE_STATUS_LABELS } from './guide-status-labels';
import {
  CONSULTA_CODE_FIELD_KEYS,
  CONSULTA_CODE_FIELDS,
  type ConsultaCodeField,
  type ConsultaOverrides,
} from './tiss/assembly/consulta-overrides';

import type { GuideIssue } from './tiss/validation/common';
import type { GuideScope } from './rights';

type Row = Record<string, unknown>;
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

/**
 * Visão da guia (matriz I.2, P1.12-b): o ESCOPO (clínica inteira ou só as próprias, por executante ou
 * solicitante) e se os VALORES saem. Obrigatória nas consultas de guia: sem visão de faturamento, os
 * valores nem saem do servidor (D-4: ocultos por padrão), e guia de outra pessoa sem visão ampla é
 * "não encontrada".
 */
export interface GuideView {
  scope: GuideScope;
  values: boolean;
}

function guideScopeSql(scope: GuideScope) {
  return scope.kind === 'own'
    ? sql`AND (g.executant_professional_id = ${scope.professionalId}::uuid OR g.requester_professional_id = ${scope.professionalId}::uuid)`
    : sql``;
}

/**
 * A guia existe nesta clínica E está no escopo da pessoa (clínica inteira ou posse por executante/
 * solicitante)? Usado pelas rotas de documento antes da leitura auditada (D-4, D-5): fora do escopo
 * é "não encontrado", igual a guia inexistente.
 */
export async function isGuideWithinScope(clinicId: string, guideId: string, scope: GuideScope): Promise<boolean> {
  return withTenant(clinicId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT 1 AS ok FROM public.hi_guides g WHERE g.clinic_id = ${clinicId}::uuid AND g.id = ${guideId}::uuid ${guideScopeSql(scope)}`,
    )) as unknown as unknown[];
    return rows.length > 0;
  });
}

export { GUIDE_STATUS_LABELS };
export { guideEventLabel } from './guide-event-label';

export const BATCH_STATUS_LABELS: Record<string, string> = {
  prepared: 'Preparado',
  exported: 'XML gerado',
  sent: 'Enviado',
  received: 'Protocolado',
  under_review: 'Em análise',
  processed: 'Processado',
  cancelled: 'Cancelado',
};

export const GLOSS_STATUS_LABELS: Record<string, string> = {
  informed: 'Informada',
  under_analysis: 'Em análise',
  contested: 'Contestada',
  appeal_filed: 'Em recurso',
  reversed: 'Revertida',
  definitive: 'Definitiva',
};

export const ISSUE_OWNER_LABELS: Record<string, string> = {
  recepcao: 'Recepção',
  gestor: 'Gestor',
  financeiro: 'Financeiro',
  medico: 'Médico',
  suporte: 'Suporte',
};

/**
 * O schema de Convênios (0144–0154) está instalado neste banco? Em ambiente sem as migrations
 * (ex.: DEV/Preview antes da aplicação autorizada) a interface explica em vez de quebrar.
 */
export async function isInsuranceSchemaInstalled(clinicId: string): Promise<boolean> {
  return withTenant(clinicId, async (tx) => {
    const [r] = (await tx.execute(
      sql`SELECT to_regclass('public.hi_ledger_entries') IS NOT NULL AND to_regclass('public.hi_guide_accounts') IS NOT NULL AS ok`,
    )) as unknown as Row[];
    return r?.ok === true;
  });
}

/**
 * Estado comercial de Convênios para a TELA (D24): a mesma decisão do banco
 * (`qoro_premium_denial`) que barra as ações. `null` = liberado. Ver não é operar: a tela
 * mostra o aviso; as ações e o banco continuam recusando sozinhos.
 */
export async function getConveniosCommercialDenial(clinicId: string): Promise<PremiumDenial | null> {
  return withTenant(clinicId, (tx) => getPremiumDenialTx(tx, clinicId, 'health_insurance'));
}

// ── Painel ────────────────────────────────────────────────────────────────

export interface InsurerSummary {
  insurerId: string;
  name: string;
  guides: number;
  billedCents: number;
  paidCents: number;
  glossOpenCents: number;
  glossDefinitiveCents: number;
  pendingCents: number;
  unreconciledCents: number;
}

export interface InsuranceOverview {
  enabled: boolean;
  /** Vazio sem visão de faturamento. */
  insurers: InsurerSummary[];
  /** Nulo sem visão de faturamento (nenhum valor sai do servidor). */
  totals: (Omit<InsurerSummary, 'insurerId' | 'name' | 'guides'> & { guides: number }) | null;
  guidesByStatus: Record<string, number>;
  /** Pendências de faturamento abertas (atendimento sem guia pronta), por responsável. */
  openGapsByOwner: Record<string, number>;
  /** Guias com pendência de dado, por responsável. */
  guideIssuesByOwner: Record<string, number>;
  /** Divergência entre a conta da guia e o livro financeiro (deve ser zero). */
  ledgerDrift: number;
}

export async function getInsuranceOverview(clinicId: string, view: GuideView): Promise<InsuranceOverview> {
  const own = view.scope.kind === 'own';
  return withTenant(clinicId, async (tx) => {
    const [settings] = (await tx.execute(
      sql`SELECT enabled FROM public.hi_clinic_settings WHERE clinic_id = ${clinicId}::uuid`,
    )) as unknown as Row[];
    const receivables = !view.values ? [] : (await tx.execute(
      sql`SELECT r.*, i.name FROM public.hi_insurer_receivables r
            JOIN public.hi_insurers i ON i.clinic_id = r.clinic_id AND i.id = r.insurer_id
           WHERE r.clinic_id = ${clinicId}::uuid ORDER BY i.name`,
    )) as unknown as Row[];
    const byStatus = (await tx.execute(
      sql`SELECT status, count(*)::int AS n FROM public.hi_guides g WHERE g.clinic_id = ${clinicId}::uuid ${guideScopeSql(view.scope)} GROUP BY status`,
    )) as unknown as Row[];
    // Pendência de faturamento é da clínica (sem guia ainda): só para quem tem visão ampla.
    const gaps = own ? [] : (await tx.execute(
      sql`SELECT owner, count(*)::int AS n FROM public.hi_billing_gaps
           WHERE clinic_id = ${clinicId}::uuid AND status = 'open' GROUP BY owner`,
    )) as unknown as Row[];
    const issues = (await tx.execute(
      sql`SELECT x->>'owner' AS owner, count(*)::int AS n
            FROM public.hi_guides g CROSS JOIN LATERAL jsonb_array_elements(g.issues) x
           WHERE g.clinic_id = ${clinicId}::uuid AND g.status IN ('pending_data', 'ready_for_review') AND g.live ${guideScopeSql(view.scope)}
           GROUP BY 1`,
    )) as unknown as Row[];
    const [drift] = !view.values ? [] : (await tx.execute(
      sql`SELECT count(*)::int AS n FROM public.hi_ledger_drift WHERE clinic_id = ${clinicId}::uuid`,
    )) as unknown as Row[];

    const insurers: InsurerSummary[] = receivables.map((r) => ({
      insurerId: String(r.insurer_id),
      name: String(r.name),
      guides: n(r.guides),
      billedCents: n(r.billed_cents),
      paidCents: n(r.paid_cents),
      glossOpenCents: n(r.gloss_open_cents),
      glossDefinitiveCents: n(r.gloss_definitive_cents),
      pendingCents: n(r.pending_cents),
      unreconciledCents: n(r.unreconciled_cents),
    }));
    const sum = (k: keyof InsurerSummary) => insurers.reduce((acc, i) => acc + (i[k] as number), 0);
    return {
      enabled: settings?.enabled === true,
      insurers,
      totals: !view.values ? null : {
        guides: sum('guides'),
        billedCents: sum('billedCents'),
        paidCents: sum('paidCents'),
        glossOpenCents: sum('glossOpenCents'),
        glossDefinitiveCents: sum('glossDefinitiveCents'),
        pendingCents: sum('pendingCents'),
        unreconciledCents: sum('unreconciledCents'),
      },
      guidesByStatus: Object.fromEntries(byStatus.map((r) => [String(r.status), n(r.n)])),
      openGapsByOwner: Object.fromEntries(gaps.map((r) => [String(r.owner), n(r.n)])),
      guideIssuesByOwner: Object.fromEntries(issues.map((r) => [String(r.owner), n(r.n)])),
      ledgerDrift: n(drift?.n),
    };
  });
}

// ── Guias ─────────────────────────────────────────────────────────────────

export interface GuideListRow {
  id: string;
  number: string;
  guideType: 'consulta' | 'sp_sadt';
  status: string;
  version: number;
  revision: number;
  insurerId: string;
  insurerName: string;
  patientName: string | null;
  /** Nulo sem visão de faturamento (os valores não saem do servidor). */
  totalValueCents: number | null;
  issues: GuideIssue[];
  batchNumber: string | null;
  updatedAt: string | null;
}

export interface GuideFilters {
  status?: string | undefined;
  insurerId?: string | undefined;
  owner?: string | undefined;
  q?: string | undefined;
  page?: number | undefined;
}

export const GUIDE_PAGE_SIZE = 50;

/** Grupos de estado que a recepção e o gestor usam para filtrar. */
export const GUIDE_STATUS_GROUPS: Record<string, string[]> = {
  pendentes: ['pending_data', 'ready_for_review'],
  conferidas: ['reviewed'],
  prontas: ['approved'],
  faturadas: ['in_batch', 'exported', 'sent', 'under_review'],
  desfecho: ['paid', 'partially_paid', 'partially_glossed', 'fully_glossed'],
  encerradas: ['closed', 'cancelled', 'replaced'],
};

export async function listGuides(
  clinicId: string,
  f: GuideFilters,
  view: GuideView,
): Promise<{ rows: GuideListRow[]; total: number }> {
  // Só estados conhecidos (lista fechada) entram no literal de array; qualquer outro valor = sem filtro.
  const chosen = f.status ? (GUIDE_STATUS_GROUPS[f.status] ?? (GUIDE_STATUS_LABELS[f.status] ? [f.status] : null)) : null;
  // drizzle expande array JS em lista de parâmetros; o filtro precisa de UM text[] (literal seguro: [a-z_]).
  const statuses = chosen ? `{${chosen.join(',')}}` : null;
  const q = f.q?.trim() ? `%${f.q.trim().replace(/[%_\\]/gu, '')}%` : null;
  const page = Math.max(1, Math.floor(f.page ?? 1));
  return withTenant(clinicId, async (tx) => {
    const where = sql`g.clinic_id = ${clinicId}::uuid
      AND (${statuses}::text[] IS NULL OR g.status = ANY(${statuses}::text[]))
      AND (${f.insurerId ?? null}::uuid IS NULL OR g.insurer_id = ${f.insurerId ?? null}::uuid)
      AND (${f.owner ?? null}::text IS NULL OR EXISTS (SELECT 1 FROM jsonb_array_elements(g.issues) x WHERE x->>'owner' = ${f.owner ?? null}::text))
      AND (${q}::text IS NULL OR g.number ILIKE ${q} OR p.nome ILIKE ${q})
      ${guideScopeSql(view.scope)}`;
    const rows = (await tx.execute(
      sql`SELECT g.id, g.number, g.guide_type, g.status, g.version, g.revision, g.insurer_id, i.name AS insurer_name,
                 p.nome AS patient_name, g.total_value_cents, g.issues, g.updated_at,
                 (SELECT b.number FROM public.hi_batch_guides bg JOIN public.hi_batches b ON b.clinic_id = bg.clinic_id AND b.id = bg.batch_id
                   WHERE bg.clinic_id = g.clinic_id AND bg.guide_id = g.id AND bg.active LIMIT 1) AS batch_number
            FROM public.hi_guides g
            JOIN public.hi_insurers i ON i.clinic_id = g.clinic_id AND i.id = g.insurer_id
            LEFT JOIN public.patients p ON p.clinic_id = g.clinic_id AND p.id = g.patient_id
           WHERE ${where}
           ORDER BY g.updated_at DESC NULLS LAST, g.number DESC
           LIMIT ${GUIDE_PAGE_SIZE} OFFSET ${(page - 1) * GUIDE_PAGE_SIZE}`,
    )) as unknown as Row[];
    const [count] = (await tx.execute(
      sql`SELECT count(*)::int AS n FROM public.hi_guides g
            LEFT JOIN public.patients p ON p.clinic_id = g.clinic_id AND p.id = g.patient_id WHERE ${where}`,
    )) as unknown as Row[];
    return {
      rows: rows.map((r) => ({
        id: String(r.id),
        number: String(r.number),
        guideType: r.guide_type as GuideListRow['guideType'],
        status: String(r.status),
        version: n(r.version),
        revision: n(r.revision),
        insurerId: String(r.insurer_id),
        insurerName: String(r.insurer_name),
        patientName: s(r.patient_name),
        totalValueCents: view.values ? n(r.total_value_cents) : null,
        issues: (Array.isArray(r.issues) ? r.issues : []) as GuideIssue[],
        batchNumber: s(r.batch_number),
        updatedAt: iso(r.updated_at),
      })),
      total: n(count?.n),
    };
  });
}

export interface GuideItemRow {
  id: string;
  sequence: number;
  executedOn: string | null;
  tableCode: string;
  procedureCode: string;
  description: string;
  quantity: number;
  /** Nulo sem visão de faturamento. */
  totalValueCents: number | null;
}

export interface GuideEventRow {
  fromStatus: string | null;
  toStatus: string | null;
  /** Nomes das colunas alteradas (o histórico do banco não grava valores). */
  changedFields: string[];
  actorName: string | null;
  actorKind: string;
  note: string | null;
  createdAt: string | null;
}

export interface GlossRow {
  id: string;
  batchId: string;
  itemId: string | null;
  code: string;
  amountCents: number;
  status: string;
  version: number;
  reversedCents: number;
  definitiveCents: number;
  source: string;
  createdAt: string | null;
}

export interface AllocationRow {
  id: string;
  paymentId: string;
  kind: 'allocation' | 'reversal';
  amountCents: number;
  paidOn: string | null;
  reason: string | null;
  reversed: boolean;
  createdAt: string | null;
}

export interface AppealRow {
  id: string;
  status: string;
  version: number;
  protocol: string | null;
  filedOn: string | null;
  answeredOn: string | null;
  glossIds: string[];
  /** XML oficial do recurso já gerado (P9.7), para download auditado. */
  xmlFileId: string | null;
  createdAt: string | null;
}

export interface GuideDetail extends GuideListRow {
  cancelReason: string | null;
  approvedAt: string | null;
  reviewedAt: string | null;
  terminologyVersion: string | null;
  /** Ajustes da Consulta antes da aprovação (D11); nulo = só os padrões. */
  consultaOverrides: ConsultaOverrides | null;
  items: GuideItemRow[];
  events: GuideEventRow[];
  batchId: string | null;
  batchStatus: string | null;
  account: {
    billedCents: number;
    paidCents: number;
    glossOpenCents: number;
    glossDefinitiveCents: number;
    pendingCents: number;
    version: number;
  } | null;
  glosses: GlossRow[];
  allocations: AllocationRow[];
  appeals: AppealRow[];
  receivable: { status: string; valorPagoCents: number; valorGlosadoCents: number } | null;
}

export interface ConsultaFieldOption {
  code: string;
  term: string;
}

/**
 * Opções dos dados da Consulta (D11) na terminologia DA GUIA: tabelas 36, 52, 75, 76 e 77, só os
 * termos vigentes na data do atendimento (sem data: todos). Nada é inventado na tela: a lista é
 * a da ANS carregada no banco.
 */
export async function listConsultaFieldOptions(
  clinicId: string,
  terminologyVersion: string,
  date: string | null,
): Promise<Record<ConsultaCodeField, ConsultaFieldOption[]>> {
  const tableOf = Object.fromEntries(
    CONSULTA_CODE_FIELD_KEYS.map((k) => [CONSULTA_CODE_FIELDS[k].table, k]),
  ) as Record<string, ConsultaCodeField>;
  const rows = await withTenant(clinicId, async (tx) =>
    (await tx.execute(
      sql`SELECT t.table_code, t.code, t.term, t.starts_on::text AS starts_on, t.ends_on::text AS ends_on
            FROM public.tiss_terms t
            JOIN public.tiss_terminology_versions v ON v.id = t.version_id
           WHERE v.version = ${terminologyVersion}
             AND t.table_code IN ('36', '52', '75', '76', '77')
           ORDER BY t.table_code, t.code`,
    )) as unknown as Row[],
  );
  const out = Object.fromEntries(CONSULTA_CODE_FIELD_KEYS.map((k) => [k, []])) as unknown as Record<
    ConsultaCodeField,
    ConsultaFieldOption[]
  >;
  for (const r of rows) {
    const field = tableOf[String(r.table_code)];
    if (!field) continue;
    const startsOn = s(r.starts_on);
    const endsOn = s(r.ends_on);
    if (date && ((startsOn && date < startsOn) || (endsOn && date > endsOn))) continue;
    out[field].push({ code: String(r.code), term: String(r.term) });
  }
  return out;
}

export async function getGuideDetail(clinicId: string, guideId: string, view: GuideView): Promise<GuideDetail | null> {
  const detail = await withTenant(clinicId, async (tx) => {
    const [g] = (await tx.execute(
      sql`SELECT g.*, i.name AS insurer_name, p.nome AS patient_name
            FROM public.hi_guides g
            JOIN public.hi_insurers i ON i.clinic_id = g.clinic_id AND i.id = g.insurer_id
            LEFT JOIN public.patients p ON p.clinic_id = g.clinic_id AND p.id = g.patient_id
           WHERE g.clinic_id = ${clinicId}::uuid AND g.id = ${guideId}::uuid ${guideScopeSql(view.scope)}`,
    )) as unknown as Row[];
    if (!g) return null;
    const items = (await tx.execute(
      sql`SELECT id, sequence, executed_on, table_code, procedure_code, description, quantity, total_value_cents
            FROM public.hi_guide_items WHERE clinic_id = ${clinicId}::uuid AND guide_id = ${guideId}::uuid ORDER BY sequence`,
    )) as unknown as Row[];
    const events = (await tx.execute(
      sql`SELECT e.from_status, e.to_status, e.changed_fields, e.actor_kind, e.note, e.created_at, pr.nome AS actor_name
            FROM public.hi_guide_events e
            LEFT JOIN public.profiles pr ON pr.id = e.actor_id AND pr.clinic_id = e.clinic_id
           WHERE e.clinic_id = ${clinicId}::uuid AND e.guide_id = ${guideId}::uuid ORDER BY e.created_at DESC LIMIT 100`,
    )) as unknown as Row[];
    const [batch] = (await tx.execute(
      sql`SELECT b.id, b.number, b.status FROM public.hi_batch_guides bg
            JOIN public.hi_batches b ON b.clinic_id = bg.clinic_id AND b.id = bg.batch_id
           WHERE bg.clinic_id = ${clinicId}::uuid AND bg.guide_id = ${guideId}::uuid AND bg.active LIMIT 1`,
    )) as unknown as Row[];
    const [account] = (await tx.execute(
      sql`SELECT * FROM public.hi_guide_accounts WHERE clinic_id = ${clinicId}::uuid AND guide_id = ${guideId}::uuid`,
    )) as unknown as Row[];
    const glosses = (await tx.execute(
      sql`SELECT id, batch_id, guide_item_id, gloss_code AS code, amount_cents, status, version, reversed_cents, definitive_cents, source, created_at
            FROM public.hi_glosses WHERE clinic_id = ${clinicId}::uuid AND guide_id = ${guideId}::uuid ORDER BY created_at`,
    )) as unknown as Row[];
    const allocations = (await tx.execute(
      sql`SELECT a.id, a.payment_id, a.kind, a.amount_cents, a.reason, a.created_at, p.paid_on,
                 EXISTS (SELECT 1 FROM public.hi_payment_allocations r WHERE r.clinic_id = a.clinic_id AND r.reverses_id = a.id) AS reversed
            FROM public.hi_payment_allocations a
            JOIN public.hi_payments p ON p.clinic_id = a.clinic_id AND p.id = a.payment_id
           WHERE a.clinic_id = ${clinicId}::uuid AND a.guide_id = ${guideId}::uuid ORDER BY a.created_at`,
    )) as unknown as Row[];
    const appeals = (await tx.execute(
      sql`SELECT ap.id, ap.status, ap.version, ap.protocol_number, ap.filed_on, ap.answered_on, ap.created_at,
                 (SELECT f.id FROM public.hi_files f WHERE f.clinic_id = ap.clinic_id AND f.appeal_id = ap.id
                   AND f.kind = 'gloss_appeal_xml' ORDER BY f.created_at DESC LIMIT 1) AS xml_file_id,
                 coalesce(array_agg(it.gloss_id::text) FILTER (WHERE it.gloss_id IS NOT NULL), '{}') AS gloss_ids
            FROM public.hi_gloss_appeals ap
            LEFT JOIN public.hi_gloss_appeal_items it ON it.clinic_id = ap.clinic_id AND it.appeal_id = ap.id
           WHERE ap.clinic_id = ${clinicId}::uuid AND ap.guide_id = ${guideId}::uuid
           GROUP BY ap.id ORDER BY ap.created_at`,
    )) as unknown as Row[];
    const [lanc] = (await tx.execute(
      sql`SELECT status, valor_pago, valor_glosado FROM public.lancamentos
           WHERE clinic_id = ${clinicId}::uuid AND source_hi_guide_id = ${guideId}::uuid`,
    )) as unknown as Row[];
    return {
      id: String(g.id),
      number: String(g.number),
      guideType: g.guide_type as GuideListRow['guideType'],
      status: String(g.status),
      version: n(g.version),
      revision: n(g.revision),
      insurerId: String(g.insurer_id),
      insurerName: String(g.insurer_name),
      patientName: s(g.patient_name),
      totalValueCents: n(g.total_value_cents),
      issues: (Array.isArray(g.issues) ? g.issues : []) as GuideIssue[],
      batchNumber: batch ? String(batch.number) : null,
      updatedAt: iso(g.updated_at),
      cancelReason: s(g.cancel_reason),
      approvedAt: iso(g.approved_at),
      reviewedAt: iso(g.reviewed_at),
      terminologyVersion: s(g.terminology_version),
      consultaOverrides:
        g.consulta_overrides && typeof g.consulta_overrides === 'object' && !Array.isArray(g.consulta_overrides)
          ? (g.consulta_overrides as ConsultaOverrides)
          : null,
      batchId: batch ? String(batch.id) : null,
      batchStatus: batch ? String(batch.status) : null,
      items: items.map((r) => ({
        id: String(r.id),
        sequence: n(r.sequence),
        executedOn: s(r.executed_on),
        tableCode: String(r.table_code),
        procedureCode: String(r.procedure_code),
        description: String(r.description),
        quantity: n(r.quantity),
        totalValueCents: n(r.total_value_cents),
      })),
      events: events.map((r) => ({
        fromStatus: s(r.from_status),
        toStatus: s(r.to_status),
        changedFields: Array.isArray(r.changed_fields)
          ? r.changed_fields.map(String)
          : typeof r.changed_fields === 'string' // literal de array ('{a,b}') se o driver não tipar
            ? r.changed_fields.replace(/^\{|\}$/gu, '').split(',').filter(Boolean)
            : [],
        actorName: s(r.actor_name),
        actorKind: String(r.actor_kind),
        note: s(r.note),
        createdAt: iso(r.created_at),
      })),
      account: account
        ? {
            billedCents: n(account.billed_cents),
            paidCents: n(account.paid_cents),
            glossOpenCents: n(account.gloss_open_cents),
            glossDefinitiveCents: n(account.gloss_definitive_cents),
            pendingCents: n(account.pending_cents),
            version: n(account.version),
          }
        : null,
      glosses: glosses.map((r) => ({
        id: String(r.id),
        batchId: String(r.batch_id),
        itemId: s(r.guide_item_id),
        code: String(r.code),
        amountCents: n(r.amount_cents),
        status: String(r.status),
        version: n(r.version),
        reversedCents: n(r.reversed_cents),
        definitiveCents: n(r.definitive_cents),
        source: String(r.source),
        createdAt: iso(r.created_at),
      })),
      allocations: allocations.map((r) => ({
        id: String(r.id),
        paymentId: String(r.payment_id),
        kind: r.kind as AllocationRow['kind'],
        amountCents: n(r.amount_cents),
        paidOn: s(r.paid_on),
        reason: s(r.reason),
        reversed: r.reversed === true,
        createdAt: iso(r.created_at),
      })),
      appeals: appeals.map((r) => ({
        id: String(r.id),
        status: String(r.status),
        version: n(r.version),
        protocol: s(r.protocol_number),
        filedOn: s(r.filed_on),
        answeredOn: s(r.answered_on),
        glossIds: (r.gloss_ids as string[]) ?? [],
        xmlFileId: s(r.xml_file_id),
        createdAt: iso(r.created_at),
      })),
      receivable: lanc
        ? {
            status: String(lanc.status),
            valorPagoCents: Math.round(Number(lanc.valor_pago) * 100),
            valorGlosadoCents: Math.round(Number(lanc.valor_glosado) * 100),
          }
        : null,
    };
  });
  return detail && !view.values ? withoutValues(detail) : detail;
}

/** Sem visão de faturamento: nenhum valor, conta, glosa, pagamento, recurso ou recebível sai do servidor. */
function withoutValues(d: GuideDetail): GuideDetail {
  return {
    ...d,
    totalValueCents: null,
    items: d.items.map((it) => ({ ...it, totalValueCents: null })),
    account: null,
    glosses: [],
    allocations: [],
    appeals: [],
    receivable: null,
  };
}

// ── Lotes ─────────────────────────────────────────────────────────────────

export interface BatchListRow {
  id: string;
  number: string;
  insurerId: string;
  insurerName: string;
  guideType: string;
  status: string;
  version: number;
  guideCount: number;
  totalValueCents: number;
  protocolNumber: string | null;
  sentOn: string | null;
  createdAt: string | null;
}

export async function listBatches(clinicId: string, f: { status?: string; insurerId?: string } = {}): Promise<BatchListRow[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT b.id, b.number, b.insurer_id, i.name AS insurer_name, b.guide_type, b.status, b.version, b.guide_count,
                 b.total_value_cents, b.protocol_number, b.sent_on, b.created_at
            FROM public.hi_batches b JOIN public.hi_insurers i ON i.clinic_id = b.clinic_id AND i.id = b.insurer_id
           WHERE b.clinic_id = ${clinicId}::uuid
             AND (${f.status ?? null}::text IS NULL OR b.status = ${f.status ?? null}::text)
             AND (${f.insurerId ?? null}::uuid IS NULL OR b.insurer_id = ${f.insurerId ?? null}::uuid)
           ORDER BY b.created_at DESC LIMIT 200`,
    )) as unknown as Row[];
    return rows.map(toBatchRow);
  });
}

function toBatchRow(r: Row): BatchListRow {
  return {
    id: String(r.id),
    number: String(r.number),
    insurerId: String(r.insurer_id),
    insurerName: String(r.insurer_name),
    guideType: String(r.guide_type),
    status: String(r.status),
    version: n(r.version),
    guideCount: n(r.guide_count),
    totalValueCents: n(r.total_value_cents),
    protocolNumber: s(r.protocol_number),
    sentOn: s(r.sent_on),
    createdAt: iso(r.created_at),
  };
}

export interface BatchDetail extends BatchListRow {
  fileId: string | null;
  sendChannel: string | null;
  sendEvidence: string | null;
  receivedOn: string | null;
  cancelReason: string | null;
  validation: Record<string, unknown> | null;
  guides: Array<{ id: string; number: string; status: string; patientName: string | null; totalValueCents: number; paidCents: number; glossOpenCents: number; glossDefinitiveCents: number; pendingCents: number }>;
  returns: Array<{ id: string; kind: string; receivedOn: string | null; createdAt: string | null }>;
  payments: Array<{ id: string; paidOn: string | null; amountCents: number; allocatedCents: number; unreconciledCents: number; statementRef: string | null; source: string }>;
}

export async function getBatchDetail(clinicId: string, batchId: string): Promise<BatchDetail | null> {
  return withTenant(clinicId, async (tx) => {
    const [b] = (await tx.execute(
      sql`SELECT b.*, i.name AS insurer_name FROM public.hi_batches b
            JOIN public.hi_insurers i ON i.clinic_id = b.clinic_id AND i.id = b.insurer_id
           WHERE b.clinic_id = ${clinicId}::uuid AND b.id = ${batchId}::uuid`,
    )) as unknown as Row[];
    if (!b) return null;
    const guides = (await tx.execute(
      sql`SELECT g.id, g.number, g.status, g.total_value_cents, p.nome AS patient_name,
                 coalesce(a.paid_cents, 0) AS paid_cents, coalesce(a.gloss_open_cents, 0) AS gloss_open_cents,
                 coalesce(a.gloss_definitive_cents, 0) AS gloss_definitive_cents, coalesce(a.pending_cents, g.total_value_cents) AS pending_cents
            FROM public.hi_batch_guides bg
            JOIN public.hi_guides g ON g.clinic_id = bg.clinic_id AND g.id = bg.guide_id
            LEFT JOIN public.patients p ON p.clinic_id = g.clinic_id AND p.id = g.patient_id
            LEFT JOIN public.hi_guide_accounts a ON a.clinic_id = g.clinic_id AND a.guide_id = g.id
           WHERE bg.clinic_id = ${clinicId}::uuid AND bg.batch_id = ${batchId}::uuid AND bg.active
           ORDER BY g.number`,
    )) as unknown as Row[];
    const returns = (await tx.execute(
      sql`SELECT id, kind, received_on, created_at FROM public.hi_batch_returns
           WHERE clinic_id = ${clinicId}::uuid AND batch_id = ${batchId}::uuid ORDER BY created_at`,
    )) as unknown as Row[];
    const payments = (await tx.execute(
      sql`SELECT payment_id, paid_on, amount_cents, allocated_cents, unreconciled_cents, statement_ref, source
            FROM public.hi_payment_balances WHERE clinic_id = ${clinicId}::uuid AND batch_id = ${batchId}::uuid ORDER BY paid_on`,
    )) as unknown as Row[];
    return {
      ...toBatchRow(b),
      fileId: s(b.file_id),
      sendChannel: s(b.send_channel),
      sendEvidence: s(b.send_evidence),
      receivedOn: s(b.received_on),
      cancelReason: s(b.cancel_reason),
      validation: (b.validation as Record<string, unknown> | null) ?? null,
      guides: guides.map((r) => ({
        id: String(r.id),
        number: String(r.number),
        status: String(r.status),
        patientName: s(r.patient_name),
        totalValueCents: n(r.total_value_cents),
        paidCents: n(r.paid_cents),
        glossOpenCents: n(r.gloss_open_cents),
        glossDefinitiveCents: n(r.gloss_definitive_cents),
        pendingCents: n(r.pending_cents),
      })),
      returns: returns.map((r) => ({ id: String(r.id), kind: String(r.kind), receivedOn: s(r.received_on), createdAt: iso(r.created_at) })),
      payments: payments.map((r) => ({
        id: String(r.payment_id),
        paidOn: s(r.paid_on),
        amountCents: n(r.amount_cents),
        allocatedCents: n(r.allocated_cents),
        unreconciledCents: n(r.unreconciled_cents),
        statementRef: s(r.statement_ref),
        source: String(r.source),
      })),
    };
  });
}

export interface BatchCandidateGuide {
  id: string;
  number: string;
  guideType: string;
  patientName: string | null;
  totalValueCents: number;
  /** Primeira data de atendimento da guia (`AAAA-MM-DD`). */
  serviceDate: string | null;
  /** P2.5: passou do prazo de envio do contrato (só quando a operadora tem prazo registrado). */
  overdue: boolean;
}

export interface BatchCandidate {
  insurerId: string;
  name: string;
  /** P2.5: máximo de guias por lote do contrato (padrão TISS: 100). */
  maxGuidesPerBatch: number;
  submissionDeadlineDays: number | null;
  guides: BatchCandidateGuide[];
}

/** Operadoras ativas da clínica e as guias aprovadas prontas para lote, por operadora. */
export async function listBatchCandidates(clinicId: string): Promise<BatchCandidate[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT i.id AS insurer_id, i.name, i.settings, g.id, g.number, g.guide_type, g.total_value_cents, p.nome AS patient_name,
                 (SELECT min(it.executed_on) FROM public.hi_guide_items it WHERE it.clinic_id = g.clinic_id AND it.guide_id = g.id)::text AS service_date,
                 (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS today
            FROM public.hi_insurers i
            LEFT JOIN public.hi_guides g ON g.clinic_id = i.clinic_id AND g.insurer_id = i.id AND g.status = 'approved' AND g.live
            LEFT JOIN public.patients p ON p.clinic_id = g.clinic_id AND p.id = g.patient_id
           WHERE i.clinic_id = ${clinicId}::uuid AND i.status = 'active'
           ORDER BY i.name, g.number`,
    )) as unknown as Row[];
    const out = new Map<string, BatchCandidate>();
    for (const r of rows) {
      const k = String(r.insurer_id);
      if (!out.has(k)) {
        const rules = insurerRules(r.settings);
        out.set(k, {
          insurerId: k,
          name: String(r.name),
          maxGuidesPerBatch: rules.maxGuidesPerBatch,
          submissionDeadlineDays: rules.submissionDeadlineDays,
          guides: [],
        });
      }
      const c = out.get(k)!;
      if (r.id) {
        const serviceDate = s(r.service_date);
        const overdue =
          c.submissionDeadlineDays !== null && serviceDate !== null && addDays(serviceDate, c.submissionDeadlineDays) < String(r.today);
        c.guides.push({
          id: String(r.id),
          number: String(r.number),
          guideType: String(r.guide_type),
          patientName: s(r.patient_name),
          totalValueCents: n(r.total_value_cents),
          serviceDate,
          overdue,
        });
      }
    }
    return [...out.values()];
  });
}

/** `AAAA-MM-DD` + dias (calendário em UTC, sem fuso). */
function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Conciliação ───────────────────────────────────────────────────────────

export interface PaymentListRow {
  id: string;
  insurerId: string;
  insurerName: string;
  batchNumber: string | null;
  paidOn: string | null;
  amountCents: number;
  allocatedCents: number;
  unreconciledCents: number;
  statementRef: string | null;
  source: string;
}

export async function listInsurerPayments(clinicId: string, onlyUnreconciled = false): Promise<PaymentListRow[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT pb.payment_id, pb.insurer_id, i.name AS insurer_name, b.number AS batch_number, pb.paid_on, pb.amount_cents,
                 pb.allocated_cents, pb.unreconciled_cents, pb.statement_ref, pb.source
            FROM public.hi_payment_balances pb
            JOIN public.hi_insurers i ON i.clinic_id = pb.clinic_id AND i.id = pb.insurer_id
            LEFT JOIN public.hi_batches b ON b.clinic_id = pb.clinic_id AND b.id = pb.batch_id
           WHERE pb.clinic_id = ${clinicId}::uuid AND (${onlyUnreconciled} = false OR pb.unreconciled_cents > 0)
           ORDER BY pb.paid_on DESC LIMIT 200`,
    )) as unknown as Row[];
    return rows.map((r) => ({
      id: String(r.payment_id),
      insurerId: String(r.insurer_id),
      insurerName: String(r.insurer_name),
      batchNumber: s(r.batch_number),
      paidOn: s(r.paid_on),
      amountCents: n(r.amount_cents),
      allocatedCents: n(r.allocated_cents),
      unreconciledCents: n(r.unreconciled_cents),
      statementRef: s(r.statement_ref),
      source: String(r.source),
    }));
  });
}

/** Guias com saldo a receber (para alocar dinheiro ainda não conciliado), com o lote ativo de cada uma. */
export async function listOpenGuidesForAllocation(
  clinicId: string,
): Promise<Array<{ id: string; number: string; pendingCents: number; insurerId: string; batchId: string; guideType: string }>> {
  return withTenant(clinicId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT a.guide_id, a.number, a.pending_cents, a.insurer_id, bg.batch_id, b.guide_type
            FROM public.hi_guide_accounts a
            JOIN public.hi_batch_guides bg ON bg.clinic_id = a.clinic_id AND bg.guide_id = a.guide_id AND bg.active
            JOIN public.hi_batches b ON b.clinic_id = bg.clinic_id AND b.id = bg.batch_id
           WHERE a.clinic_id = ${clinicId}::uuid AND a.pending_cents > 0 AND a.status <> 'closed'
           ORDER BY a.number LIMIT 500`,
    )) as unknown as Row[];
    return rows.map((r) => ({
      id: String(r.guide_id),
      number: String(r.number),
      pendingCents: n(r.pending_cents),
      insurerId: String(r.insurer_id),
      batchId: String(r.batch_id),
      guideType: String(r.guide_type),
    }));
  });
}

export async function listInsurers(clinicId: string): Promise<Array<{ id: string; name: string }>> {
  return withTenant(clinicId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT id, name FROM public.hi_insurers WHERE clinic_id = ${clinicId}::uuid ORDER BY name`,
    )) as unknown as Row[];
    return rows.map((r) => ({ id: String(r.id), name: String(r.name) }));
  });
}

// ── Solicitações SP/SADT (0156) ─────────────────────────────────────────

export interface SadtRequestListRow {
  id: string;
  requestNumber: string | null;
  status: string;
  version: number;
  patientName: string;
  insurerName: string;
  requestedOn: string;
  requesterName: string;
  authorizationRequirement: string;
  items: number;
  requested: number;
  executed: number;
  createdAt: string | null;
}

/** Sem visão ampla (matriz 4.4): só as solicitações em que a pessoa é a solicitante. */
function requestScopeSql(scope: GuideScope) {
  return scope.kind === 'own' ? sql`AND r.requester_professional_id = ${scope.professionalId}::uuid` : sql``;
}

export async function listSadtRequests(
  clinicId: string,
  f: { status?: string },
  scope: GuideScope,
): Promise<SadtRequestListRow[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT r.id, r.request_number, r.status, r.version, p.nome AS patient_name, i.name AS insurer_name, r.requested_on,
                 coalesce(pr.nome, r.requester_external->>'name') AS requester_name, r.authorization_requirement, r.created_at,
                 (SELECT count(*) FROM public.hi_sadt_request_items ri WHERE ri.clinic_id = r.clinic_id AND ri.request_id = r.id AND ri.status = 'active') AS items,
                 (SELECT coalesce(sum(ri.quantity_requested), 0) FROM public.hi_sadt_request_items ri WHERE ri.clinic_id = r.clinic_id AND ri.request_id = r.id AND ri.status = 'active') AS requested,
                 (SELECT count(*) FROM public.hi_sadt_request_items ri
                    JOIN public.hi_appointment_coverages c ON c.clinic_id = ri.clinic_id AND c.sadt_request_item_id = ri.id
                    JOIN public.hi_guide_items gi ON gi.clinic_id = c.clinic_id AND gi.appointment_id = c.appointment_id AND gi.live
                   WHERE ri.clinic_id = r.clinic_id AND ri.request_id = r.id) AS executed
            FROM public.hi_sadt_requests r
            JOIN public.patients p ON p.clinic_id = r.clinic_id AND p.id = r.patient_id
            JOIN public.hi_insurers i ON i.clinic_id = r.clinic_id AND i.id = r.insurer_id
            LEFT JOIN public.profiles pr ON pr.clinic_id = r.clinic_id AND pr.id = r.requester_professional_id
           WHERE r.clinic_id = ${clinicId}::uuid
             AND (${f.status ?? null}::text IS NULL OR r.status = ${f.status ?? null}::text)
             ${requestScopeSql(scope)}
           ORDER BY r.created_at DESC LIMIT 200`,
    )) as unknown as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      requestNumber: s(r.request_number),
      status: String(r.status),
      version: n(r.version),
      patientName: String(r.patient_name ?? ''),
      insurerName: String(r.insurer_name),
      requestedOn: String(r.requested_on),
      requesterName: String(r.requester_name ?? ''),
      authorizationRequirement: String(r.authorization_requirement),
      items: n(r.items),
      requested: n(r.requested),
      executed: n(r.executed),
      createdAt: iso(r.created_at),
    }));
  });
}

export interface SadtRequestItemRow {
  id: string;
  sequence: number;
  tableCode: string;
  procedureCode: string;
  description: string;
  quantityRequested: number;
  quantityAuthorized: number | null;
  executed: number;
  status: string;
  cancelReason: string | null;
}

export interface SadtRequestDetail extends SadtRequestListRow {
  patientId: string;
  membershipId: string;
  requesterKind: 'internal' | 'external';
  requesterProfessionalId: string | null;
  careCharacter: string;
  careType: string | null;
  consultationType: string | null;
  /** Só se há indicação; o texto não sai daqui. */
  hasClinicalIndication: boolean;
  issues: GuideIssue[];
  note: string | null;
  cancelReason: string | null;
  authorization: {
    status: string;
    operatorGuideNumber: string | null;
    operatorProtocol: string | null;
    authorizedOn: string | null;
    passwordValidUntil: string | null;
    hasPassword: boolean;
    denialReason: string | null;
  } | null;
  itemRows: SadtRequestItemRow[];
  events: Array<{ from: string | null; to: string; note: string | null; at: string | null; via: string }>;
  guides: Array<{ id: string; number: string; status: string; totalValueCents: number; sessions: number }>;
  /** Atendimentos de convênio do paciente ainda sem sessão SP/SADT ligada (para ligar ao item). */
  linkableAppointments: Array<{ id: string; scheduledAt: string | null; status: string }>;
  /** Documento oficial do pedido à operadora (P6.2): arquivos congelados vivos, se gerados. */
  document: { pdfFileId: string | null; xmlFileId: string | null; generatedAt: string | null } | null;
}

export async function getSadtRequestDetail(
  clinicId: string,
  requestId: string,
  scope: GuideScope,
): Promise<SadtRequestDetail | null> {
  const found = await withTenant(clinicId, async (tx) => {
    const [r] = (await tx.execute(
      sql`SELECT r.*, p.nome AS patient_name, i.name AS insurer_name, coalesce(pr.nome, r.requester_external->>'name') AS requester_name,
                 a.status AS auth_status, a.operator_guide_number, a.operator_protocol, a.authorized_on, a.password_valid_until,
                 a.password_encrypted IS NOT NULL AS has_password, a.denial_reason
            FROM public.hi_sadt_requests r
            JOIN public.patients p ON p.clinic_id = r.clinic_id AND p.id = r.patient_id
            JOIN public.hi_insurers i ON i.clinic_id = r.clinic_id AND i.id = r.insurer_id
            LEFT JOIN public.profiles pr ON pr.clinic_id = r.clinic_id AND pr.id = r.requester_professional_id
            LEFT JOIN public.hi_authorizations a ON a.clinic_id = r.clinic_id AND a.id = r.authorization_id
           WHERE r.clinic_id = ${clinicId}::uuid AND r.id = ${requestId}::uuid ${requestScopeSql(scope)}`,
    )) as unknown as Row[];
    if (!r) return null;
    const items = (await tx.execute(
      sql`SELECT ri.id, ri.sequence, ri.table_code, ri.procedure_code, ri.description, ri.quantity_requested, ri.status, ri.cancel_reason,
                 ai.quantity_authorized,
                 (SELECT count(*) FROM public.hi_appointment_coverages c
                    JOIN public.hi_guide_items gi ON gi.clinic_id = c.clinic_id AND gi.appointment_id = c.appointment_id AND gi.live
                   WHERE c.clinic_id = ri.clinic_id AND c.sadt_request_item_id = ri.id) AS executed
            FROM public.hi_sadt_request_items ri
            LEFT JOIN public.hi_authorization_items ai ON ai.clinic_id = ri.clinic_id AND ai.id = ri.authorization_item_id
           WHERE ri.clinic_id = ${clinicId}::uuid AND ri.request_id = ${requestId}::uuid
           ORDER BY ri.sequence`,
    )) as unknown as Row[];
    const events = (await tx.execute(
      sql`SELECT from_status, to_status, note, created_at, created_via FROM public.hi_sadt_request_events
           WHERE clinic_id = ${clinicId}::uuid AND request_id = ${requestId}::uuid ORDER BY created_at`,
    )) as unknown as Row[];
    const guides = (await tx.execute(
      sql`SELECT g.id, g.number, g.status, g.total_value_cents, count(gi.id) AS sessions
            FROM public.hi_guides g
            JOIN public.hi_guide_items gi ON gi.clinic_id = g.clinic_id AND gi.guide_id = g.id
            JOIN public.hi_appointment_coverages c ON c.clinic_id = gi.clinic_id AND c.appointment_id = gi.appointment_id
            JOIN public.hi_sadt_request_items ri ON ri.clinic_id = c.clinic_id AND ri.id = c.sadt_request_item_id
           WHERE g.clinic_id = ${clinicId}::uuid AND ri.request_id = ${requestId}::uuid
           GROUP BY g.id ORDER BY g.created_at`,
    )) as unknown as Row[];
    const linkable = (await tx.execute(
      sql`SELECT ap.id, ap.scheduled_at, ap.status::text AS status FROM public.appointments ap
           WHERE ap.clinic_id = ${clinicId}::uuid AND ap.patient_id = ${String(r.patient_id)}::uuid
             AND ap.billing_mode = 'convenio' AND ap.status::text IN ('agendado', 'confirmado', 'chegou')
             AND NOT EXISTS (SELECT 1 FROM public.hi_appointment_coverages c
                              WHERE c.clinic_id = ap.clinic_id AND c.appointment_id = ap.id AND c.sadt_request_item_id IS NOT NULL)
           ORDER BY ap.scheduled_at LIMIT 50`,
    )) as unknown as Row[];
    const docs = r.authorization_id
      ? ((await tx.execute(
          sql`SELECT f.id, f.kind, f.created_at FROM public.hi_files f
               WHERE f.clinic_id = ${clinicId}::uuid AND f.authorization_id = ${String(r.authorization_id)}::uuid
                 AND f.kind IN ('authorization_request_pdf', 'authorization_request_xml')
                 AND NOT EXISTS (SELECT 1 FROM public.hi_files n WHERE n.clinic_id = f.clinic_id AND n.supersedes_file_id = f.id)
               ORDER BY f.created_at DESC`,
        )) as unknown as Row[])
      : null;
    return { r, items, events, guides, linkable, docs };
  });
  if (!found) return null;
  const { r, items, events, guides, linkable, docs } = found;
  const pdf = docs?.find((f) => f.kind === 'authorization_request_pdf');
  const xml = docs?.find((f) => f.kind === 'authorization_request_xml');
  const itemRows: SadtRequestItemRow[] = items.map((i) => ({
    id: String(i.id),
    sequence: n(i.sequence),
    tableCode: String(i.table_code),
    procedureCode: String(i.procedure_code),
    description: String(i.description),
    quantityRequested: n(i.quantity_requested),
    quantityAuthorized: i.quantity_authorized === null || i.quantity_authorized === undefined ? null : n(i.quantity_authorized),
    executed: n(i.executed),
    status: String(i.status),
    cancelReason: s(i.cancel_reason),
  }));
  const active = itemRows.filter((i) => i.status === 'active');
  return {
    id: String(r.id),
    requestNumber: s(r.request_number),
    status: String(r.status),
    version: n(r.version),
    patientName: String(r.patient_name ?? ''),
    insurerName: String(r.insurer_name),
    requestedOn: String(r.requested_on),
    requesterName: String(r.requester_name ?? ''),
    authorizationRequirement: String(r.authorization_requirement),
    items: active.length,
    requested: active.reduce((a, i) => a + i.quantityRequested, 0),
    executed: itemRows.reduce((a, i) => a + i.executed, 0),
    createdAt: iso(r.created_at),
    patientId: String(r.patient_id),
    membershipId: String(r.membership_id),
    requesterKind: r.requester_kind === 'external' ? 'external' : 'internal',
    requesterProfessionalId: s(r.requester_professional_id),
    careCharacter: String(r.care_character),
    careType: s(r.care_type),
    consultationType: s(r.consultation_type),
    hasClinicalIndication: r.clinical_indication_encrypted !== null && r.clinical_indication_encrypted !== undefined,
    issues: (r.issues as GuideIssue[] | null) ?? [],
    note: s(r.note),
    cancelReason: s(r.cancel_reason),
    authorization: r.auth_status
      ? {
          status: String(r.auth_status),
          operatorGuideNumber: s(r.operator_guide_number),
          operatorProtocol: s(r.operator_protocol),
          authorizedOn: s(r.authorized_on),
          passwordValidUntil: s(r.password_valid_until),
          hasPassword: r.has_password === true,
          denialReason: s(r.denial_reason),
        }
      : null,
    itemRows,
    events: events.map((e) => ({ from: s(e.from_status), to: String(e.to_status), note: s(e.note), at: iso(e.created_at), via: String(e.created_via) })),
    guides: guides.map((g) => ({ id: String(g.id), number: String(g.number), status: String(g.status), totalValueCents: n(g.total_value_cents), sessions: n(g.sessions) })),
    linkableAppointments: linkable.map((a) => ({ id: String(a.id), scheduledAt: iso(a.scheduled_at), status: String(a.status) })),
    document: docs
      ? { pdfFileId: pdf ? String(pdf.id) : null, xmlFileId: xml ? String(xml.id) : null, generatedAt: pdf ? iso(pdf.created_at) : null }
      : null,
  };
}

/** Para formar uma solicitação: carteirinhas ativas, solicitantes da clínica e procedimentos SP/SADT do contrato. */
export async function getSadtRequestFormData(clinicId: string): Promise<{
  memberships: Array<{ membershipId: string; patientId: string; label: string }>;
  professionals: Array<{ id: string; name: string }>;
  procedures: Array<{ tableCode: string; procedureCode: string; description: string; insurerName: string }>;
}> {
  return withTenant(clinicId, async (tx) => {
    const memberships = (await tx.execute(
      sql`SELECT m.id, m.patient_id, p.nome, i.name AS insurer_name, m.card_last4 FROM public.hi_memberships m
            JOIN public.patients p ON p.clinic_id = m.clinic_id AND p.id = m.patient_id
            JOIN public.hi_insurers i ON i.clinic_id = m.clinic_id AND i.id = m.insurer_id
           WHERE m.clinic_id = ${clinicId}::uuid AND m.status = 'active' ORDER BY p.nome LIMIT 500`,
    )) as unknown as Row[];
    const professionals = (await tx.execute(
      sql`SELECT pp.professional_id AS id, pr.nome FROM public.hi_professional_profiles pp
            JOIN public.profiles pr ON pr.clinic_id = pp.clinic_id AND pr.id = pp.professional_id
           WHERE pp.clinic_id = ${clinicId}::uuid ORDER BY pr.nome`,
    )) as unknown as Row[];
    const procedures = (await tx.execute(
      sql`SELECT DISTINCT ON (c.insurer_id, c.table_code, c.procedure_code) c.table_code, c.procedure_code, c.description, i.name AS insurer_name
            FROM public.hi_procedure_contracts c JOIN public.hi_insurers i ON i.clinic_id = c.clinic_id AND i.id = c.insurer_id
           WHERE c.clinic_id = ${clinicId}::uuid AND c.guide_type = 'sp_sadt'
           ORDER BY c.insurer_id, c.table_code, c.procedure_code, c.valid_from DESC`,
    )) as unknown as Row[];
    return {
      memberships: memberships.map((m) => ({
        membershipId: String(m.id),
        patientId: String(m.patient_id),
        label: `${String(m.nome ?? '')} · ${String(m.insurer_name)} · final ${String(m.card_last4 ?? '')}`,
      })),
      professionals: professionals.map((p) => ({ id: String(p.id), name: String(p.nome ?? '') })),
      procedures: procedures.map((p) => ({
        tableCode: String(p.table_code),
        procedureCode: String(p.procedure_code),
        description: String(p.description),
        insurerName: String(p.insurer_name),
      })),
    };
  });
}

// ── Repasse profissional de convênio (0157) ─────────────────────────────

export interface InsurancePayoutRow extends InsurancePayoutPosition {
  professionalName: string;
  patientName: string;
  guideNumber: string | null;
  guideType: string | null;
  executedOn: string | null;
  /** Revisão humana aberta (0163): pagamento e autorização bloqueados até a decisão. */
  review: PayoutReviewRow | null;
}

/** Política de segregação da revisão do repasse (0163; D-2: administração). */
export interface PayoutReviewPolicy {
  segregation: boolean;
  independentAboveCents: number | null;
}

export async function listInsurancePayouts(
  clinicId: string,
): Promise<{ rows: InsurancePayoutRow[]; eligibility: string; reviewPolicy: PayoutReviewPolicy }> {
  return withTenant(clinicId, async (tx) => {
    const positions = await listInsurancePayoutPositionsTx(tx, clinicId);
    const meta = positions.length
      ? ((await tx.execute(sql`
          SELECT p.id AS payout_id, pr.nome AS professional_name, pt.nome AS patient_name, g.number AS guide_number, g.guide_type AS guide_type, gi.executed_on
            FROM public.hi_payouts p
            JOIN public.appointments a ON a.clinic_id = p.clinic_id AND a.id = p.appointment_id
            LEFT JOIN public.profiles pr ON pr.clinic_id = p.clinic_id AND pr.id = p.professional_id
            LEFT JOIN public.patients pt ON pt.clinic_id = a.clinic_id AND pt.id = a.patient_id
            LEFT JOIN public.hi_guide_items gi ON gi.clinic_id = p.clinic_id AND gi.appointment_id = p.appointment_id AND gi.live
            LEFT JOIN public.hi_guides g ON g.clinic_id = gi.clinic_id AND g.id = gi.guide_id
           WHERE p.clinic_id = ${clinicId}::uuid`)) as unknown as Row[])
      : [];
    const byId = new Map(meta.map((m) => [String(m.payout_id), m]));
    const [settings] = (await tx.execute(sql`SELECT payout_eligibility, payout_review_segregation, payout_review_independent_above_cents
      FROM public.hi_clinic_settings WHERE clinic_id = ${clinicId}::uuid`)) as unknown as Row[];
    // Revisões abertas (0163): o motivo de o pagamento estar bloqueado.
    const open = await listPayoutReviewsTx(tx, clinicId, { status: 'open' });
    const reviewByPayout = new Map(open.map((r) => [r.payoutId, r]));
    return {
      eligibility: String(settings?.payout_eligibility ?? 'on_receipt'),
      reviewPolicy: {
        segregation: settings?.payout_review_segregation === true,
        independentAboveCents:
          settings?.payout_review_independent_above_cents === null || settings?.payout_review_independent_above_cents === undefined
            ? null
            : Number(settings.payout_review_independent_above_cents),
      },
      rows: positions.map((p) => {
        const m = byId.get(p.payoutId);
        return {
          ...p,
          review: reviewByPayout.get(p.payoutId) ?? null,
          professionalName: String(m?.professional_name ?? ''),
          patientName: String(m?.patient_name ?? ''),
          guideNumber: s(m?.guide_number),
          guideType: s(m?.guide_type),
          executedOn: s(m?.executed_on),
        };
      }),
    };
  });
}

/** Coparticipações confirmadas e a situação da cobrança (P10.5). */
export async function listCopayCharges(clinicId: string) {
  return withTenant(clinicId, (tx) => listCopayChargesTx(tx, clinicId));
}

// ── Autorizações da operadora (P6.3) ────────────────────────────────────────────────────────

export interface AuthorizationItemRow {
  id: string;
  tableCode: string;
  procedureCode: string;
  quantityRequested: number;
  quantityAuthorized: number;
  quantityConsumed: number;
}

export interface AuthorizationRow {
  id: string;
  guideType: 'consulta' | 'sp_sadt';
  status: 'draft' | 'requested' | 'pending_operator' | 'authorized' | 'partially_authorized' | 'denied' | 'expired' | 'cancelled';
  origin: string;
  version: number;
  insurerName: string;
  patientName: string;
  requestedOn: string | null;
  authorizedOn: string | null;
  operatorGuideNumber: string | null;
  operatorProtocol: string | null;
  /** Só se há senha guardada (cifrada). A senha nunca sai daqui. */
  hasPassword: boolean;
  passwordValidUntil: string | null;
  denialReason: string | null;
  sadtRequestId: string | null;
  sadtRequestNumber: string | null;
  receipts: number;
  items: AuthorizationItemRow[];
}

const AUTHORIZATION_SELECT = sql`
  SELECT a.id, a.guide_type, a.status, a.origin, a.version, a.requested_on::text AS requested_on,
         a.authorized_on::text AS authorized_on, a.operator_guide_number, a.operator_protocol,
         (a.password_encrypted IS NOT NULL) AS has_password, a.password_valid_until::text AS password_valid_until,
         a.denial_reason, i.name AS insurer_name, p.nome AS patient_name, r.id AS sadt_request_id,
         r.request_number AS sadt_request_number,
         (SELECT count(*) FROM public.hi_authorization_attachments x
           WHERE x.clinic_id = a.clinic_id AND x.authorization_id = a.id) AS receipts,
         (SELECT coalesce(json_agg(json_build_object(
                   'id', ai.id, 'tableCode', ai.table_code, 'procedureCode', ai.procedure_code,
                   'quantityRequested', ai.quantity_requested, 'quantityAuthorized', ai.quantity_authorized,
                   'quantityConsumed', ai.quantity_consumed) ORDER BY ai.created_at, ai.id), '[]'::json)
            FROM public.hi_authorization_items ai
           WHERE ai.clinic_id = a.clinic_id AND ai.authorization_id = a.id) AS items
    FROM public.hi_authorizations a
    JOIN public.hi_insurers i ON i.clinic_id = a.clinic_id AND i.id = a.insurer_id
    LEFT JOIN public.hi_memberships m ON m.clinic_id = a.clinic_id AND m.id = a.membership_id
    LEFT JOIN public.patients p ON p.clinic_id = m.clinic_id AND p.id = m.patient_id
    LEFT JOIN public.hi_sadt_requests r ON r.clinic_id = a.clinic_id AND r.authorization_id = a.id`;

function authorizationRow(r: Row): AuthorizationRow {
  const raw = typeof r.items === 'string' ? (JSON.parse(r.items) as unknown) : r.items;
  const items = (Array.isArray(raw) ? raw : []) as Array<Record<string, unknown>>;
  return {
    id: String(r.id),
    guideType: r.guide_type === 'sp_sadt' ? 'sp_sadt' : 'consulta',
    status: String(r.status) as AuthorizationRow['status'],
    origin: String(r.origin),
    version: n(r.version),
    insurerName: String(r.insurer_name ?? ''),
    patientName: String(r.patient_name ?? ''),
    requestedOn: s(r.requested_on),
    authorizedOn: s(r.authorized_on),
    operatorGuideNumber: s(r.operator_guide_number),
    operatorProtocol: s(r.operator_protocol),
    hasPassword: r.has_password === true,
    passwordValidUntil: s(r.password_valid_until),
    denialReason: s(r.denial_reason),
    sadtRequestId: s(r.sadt_request_id),
    sadtRequestNumber: s(r.sadt_request_number),
    receipts: n(r.receipts),
    items: items.map((it) => ({
      id: String(it.id),
      tableCode: String(it.tableCode),
      procedureCode: String(it.procedureCode),
      quantityRequested: n(it.quantityRequested),
      quantityAuthorized: n(it.quantityAuthorized),
      quantityConsumed: n(it.quantityConsumed),
    })),
  };
}

/** Data de hoje no fuso da clínica (a mesma dos vencimentos e dos alertas da P6.6). */
async function clinicTodayTx(tx: Parameters<Parameters<typeof withTenant>[1]>[0], clinicId: string): Promise<string> {
  const [row] = (await tx.execute(
    sql`SELECT (now() AT TIME ZONE coalesce(c.timezone, 'America/Sao_Paulo'))::date::text AS d
          FROM public.clinics c WHERE c.id = ${clinicId}::uuid`,
  )) as unknown as Row[];
  return String(row?.d);
}

export interface AuthorizationListRow extends AuthorizationRow {
  /** Estado mostrado (C.8): inclui "consumida" e a vencida antes da rotina que grava o vencimento. */
  shownState: AuthorizationDisplayState;
  remaining: number;
  authorizedTotal: number;
}

function withBalance(r: AuthorizationRow, today: string): AuthorizationListRow {
  const granted = r.items.filter((i) => i.quantityAuthorized > 0);
  return {
    ...r,
    shownState: authorizationDisplayState(r, today),
    remaining: granted.reduce((acc, i) => acc + remainingQuantity(i), 0),
    authorizedTotal: granted.reduce((acc, i) => acc + i.quantityAuthorized, 0),
  };
}

/**
 * Autorizações da clínica (sem rascunho), as mais recentes primeiro, com a data da clínica, o
 * estado mostrado, o saldo e os alertas da P6.6 (senha vencendo, sessões acabando).
 */
export async function listAuthorizations(
  clinicId: string,
): Promise<{ today: string; rows: AuthorizationListRow[]; alerts: AuthorizationAlert[] }> {
  return withTenant(clinicId, async (tx) => {
    const today = await clinicTodayTx(tx, clinicId);
    const raw = (await tx.execute(
      sql`${AUTHORIZATION_SELECT}
           WHERE a.clinic_id = ${clinicId}::uuid AND a.status <> 'draft'
           ORDER BY a.created_at DESC LIMIT 300`,
    )) as unknown as Row[];
    const rows = raw.map(authorizationRow);
    return { today, rows: rows.map((r) => withBalance(r, today)), alerts: authorizationAlerts(rows, today) };
  });
}

export interface AuthorizationEventRow {
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  actorName: string | null;
  createdAt: string | null;
}

export interface AuthorizationReceiptRow {
  id: string;
  mediaType: string;
  sizeBytes: number;
  uploadedByName: string | null;
  createdAt: string | null;
}

/** Uma autorização com histórico e comprovantes (só metadados). `null` = não existe nesta clínica. */
export async function getAuthorization(
  clinicId: string,
  authorizationId: string,
): Promise<{ today: string; row: AuthorizationListRow; events: AuthorizationEventRow[]; receipts: AuthorizationReceiptRow[] } | null> {
  return withTenant(clinicId, async (tx) => {
    const [row] = (await tx.execute(
      sql`${AUTHORIZATION_SELECT}
           WHERE a.clinic_id = ${clinicId}::uuid AND a.id = ${authorizationId}::uuid`,
    )) as unknown as Row[];
    if (!row) return null;
    const today = await clinicTodayTx(tx, clinicId);
    const events = (await tx.execute(
      sql`SELECT e.from_status, e.to_status, e.note, e.created_at, pr.nome AS actor_name
            FROM public.hi_authorization_events e
            LEFT JOIN public.profiles pr ON pr.clinic_id = e.clinic_id AND pr.id = e.actor_id
           WHERE e.clinic_id = ${clinicId}::uuid AND e.authorization_id = ${authorizationId}::uuid
           ORDER BY e.created_at, e.id`,
    )) as unknown as Row[];
    const receipts = (await tx.execute(
      sql`SELECT x.id, x.media_type, x.size_bytes, x.created_at, pr.nome AS uploaded_by_name
            FROM public.hi_authorization_attachments x
            LEFT JOIN public.profiles pr ON pr.clinic_id = x.clinic_id AND pr.id = x.uploaded_by
           WHERE x.clinic_id = ${clinicId}::uuid AND x.authorization_id = ${authorizationId}::uuid
           ORDER BY x.created_at, x.id`,
    )) as unknown as Row[];
    return {
      today,
      row: withBalance(authorizationRow(row), today),
      events: events.map((e) => ({
        fromStatus: s(e.from_status),
        toStatus: String(e.to_status),
        note: s(e.note),
        actorName: s(e.actor_name),
        createdAt: iso(e.created_at),
      })),
      receipts: receipts.map((x) => ({
        id: String(x.id),
        mediaType: String(x.media_type),
        sizeBytes: n(x.size_bytes),
        uploadedByName: s(x.uploaded_by_name),
        createdAt: iso(x.created_at),
      })),
    };
  });
}

// ── Substituição de guia já enviada (P7.5; 0165) ─────────────────────────

export interface GuideSubstitutionView {
  cancellations: GuideCancellationRow[];
  /** A substituta desta guia (se houver), em qualquer estado. */
  substitute: { id: string; number: string; status: string } | null;
  /** A guia que esta substitui (se for uma substituta). */
  replaces: { id: string; number: string; status: string } | null;
}

export async function getGuideSubstitution(clinicId: string, guideId: string): Promise<GuideSubstitutionView> {
  return withTenant(clinicId, async (tx) => {
    const cancellations = await listGuideCancellationsTx(tx, clinicId, guideId);
    const [sub] = (await tx.execute(sql`SELECT id, number, status FROM public.hi_guides
        WHERE clinic_id = ${clinicId}::uuid AND replaces_guide_id = ${guideId}::uuid AND status <> 'cancelled'
        ORDER BY created_at DESC LIMIT 1`)) as unknown as Row[];
    const [orig] = (await tx.execute(sql`SELECT o.id, o.number, o.status FROM public.hi_guides g
        JOIN public.hi_guides o ON o.clinic_id = g.clinic_id AND o.id = g.replaces_guide_id
        WHERE g.clinic_id = ${clinicId}::uuid AND g.id = ${guideId}::uuid`)) as unknown as Row[];
    const pick = (r: Row | undefined) => (r ? { id: String(r.id), number: String(r.number), status: String(r.status) } : null);
    return { cancellations, substitute: pick(sub), replaces: pick(orig) };
  });
}

// ── P8.4: itens executados adicionais da guia SP/SADT (candidata 0167) ──────

export interface GuideExtraItemSession {
  appointmentId: string;
  executedOn: string;
  items: ExtraItemView[];
}
export interface GuideExtraItems {
  /** A tabela da candidata 0167 existe neste banco (no DEV e no Preview de hoje, não). */
  available: boolean;
  sessions: GuideExtraItemSession[];
  /** Linhas de contrato SP/SADT da operadora (e do plano) da guia: só item de contrato. */
  options: Array<{ id: string; label: string }>;
  /** P8.4-r (regra 5): itens pendentes das sessões da guia; com algum, a aprovação pede a decisão. */
  pendingCount: number;
}

/** Sessões da guia SP/SADT com os itens adicionais de cada uma e as linhas de contrato possíveis. */
export async function getGuideExtraItems(clinicId: string, guideId: string): Promise<GuideExtraItems> {
  return withTenant(clinicId, async (tx) => {
    if (!(await extraItemsAvailableTx(tx))) return { available: false, sessions: [], options: [], pendingCount: 0 };
    const sessions = (await tx.execute(sql`
      SELECT i.appointment_id::text AS appointment_id, min(i.executed_on)::text AS executed_on
        FROM public.hi_guide_items i
        JOIN public.hi_guides g ON g.clinic_id = i.clinic_id AND g.id = i.guide_id
       WHERE i.clinic_id = ${clinicId}::uuid AND i.guide_id = ${guideId}::uuid
         AND g.guide_type = 'sp_sadt' AND i.appointment_id IS NOT NULL
       GROUP BY i.appointment_id
       ORDER BY 2, 1`)) as unknown as Array<{ appointment_id: string; executed_on: string }>;
    if (sessions.length === 0) return { available: true, sessions: [], options: [], pendingCount: 0 };
    const out: GuideExtraItemSession[] = [];
    for (const s of sessions) {
      out.push({
        appointmentId: s.appointment_id,
        executedOn: s.executed_on,
        items: await listExtraItemsTx(tx, { clinicId, appointmentId: s.appointment_id }),
      });
    }
    const firstDay = sessions[0]!.executed_on;
    const lines = (await tx.execute(sql`
      SELECT l.id::text AS id, l.table_code, l.procedure_code, l.description, l.valid_until::text AS valid_until
        FROM public.hi_procedure_contracts l
        JOIN public.hi_guides g ON g.clinic_id = l.clinic_id AND g.insurer_id = l.insurer_id
       WHERE g.clinic_id = ${clinicId}::uuid AND g.id = ${guideId}::uuid AND l.guide_type = 'sp_sadt'
         AND (l.plan_id IS NULL OR l.plan_id IS NOT DISTINCT FROM g.plan_id)
         AND (l.valid_until IS NULL OR l.valid_until >= ${firstDay}::date)
       ORDER BY l.table_code, l.procedure_code, l.valid_from`)) as unknown as Array<{
      id: string;
      table_code: string;
      procedure_code: string;
      description: string;
      valid_until: string | null;
    }>;
    return {
      available: true,
      sessions: out,
      pendingCount: out.reduce((n, s) => n + s.items.filter((i) => i.decision.pending).length, 0),
      options: lines.map((l) => ({
        id: l.id,
        label: `${l.table_code} · ${l.procedure_code} — ${l.description}${l.valid_until ? ` (até ${l.valid_until})` : ''}`,
      })),
    };
  });
}

/** Guia cancelada antes do envio: a guia nova já gerada dela, ou por que ainda não pode ser gerada. */
export async function getGuideReissue(
  clinicId: string,
  guideId: string,
): Promise<{ reissued: { id: string; number: string } | null; block: string | null }> {
  return withTenant(clinicId, async (tx) => {
    const reissued = await reissuedFromTx(tx, clinicId, guideId);
    return { reissued, block: reissued ? null : await reissueBlockTx(tx, clinicId, guideId) };
  });
}

/** Sem valores nem decisão de faturamento: o que o consultório mostra (exceção do médico, P8.4-r). */
export interface SessionExtraItem {
  id: string;
  tableCode: string;
  procedureCode: string;
  description: string;
  quantity: number;
  status: ExtraItemView['status'];
  /** Só o que o profissional precisa saber do próprio registro. */
  stateLabel: string;
  recordedByMe: boolean;
}
export interface SessionExtraItems {
  available: boolean;
  items: SessionExtraItem[];
  /** Linhas SP/SADT da operadora do atendimento vigentes na data da sessão (sem valor). */
  options: Array<{ id: string; label: string }>;
}

const SESSION_STATE_LABEL: Record<ExtraItemView['status'], string> = {
  recorded: 'Registrado; a clínica decide o faturamento',
  regularized: 'Registrado; autorização ligada pela clínica',
  included: 'Registrado e incluído na guia',
  excluded: 'Registrado; não será faturado (decisão da clínica)',
  cancelled: 'Registro cancelado',
};

/**
 * Itens executados adicionais de UM atendimento, para o consultório (o atendimento ainda não tem
 * guia). Posse no servidor: sem visão ampla de Convênios, só o profissional da sessão lê; de outra
 * pessoa ou de outra clínica, `null` (como "não encontrado").
 */
export async function getAppointmentExtraItems(
  clinicId: string,
  appointmentId: string,
  viewer: { userId: string; broad: boolean },
): Promise<SessionExtraItems | null> {
  return withTenant(clinicId, async (tx) => {
    if (!(await extraItemsAvailableTx(tx))) return { available: false, items: [], options: [] };
    const ap = (await tx.execute(sql`
      SELECT a.doctor_id::text AS doctor_id, cov.insurer_id::text AS insurer_id, cov.plan_id::text AS plan_id,
             cov.guide_type, cov.status::text AS cov_status,
             (a.scheduled_at AT TIME ZONE coalesce(c.timezone, 'America/Sao_Paulo'))::date::text AS day
        FROM public.appointments a
        JOIN public.clinics c ON c.id = a.clinic_id
        LEFT JOIN public.hi_appointment_coverages cov ON cov.clinic_id = a.clinic_id AND cov.appointment_id = a.id
       WHERE a.clinic_id = ${clinicId}::uuid AND a.id = ${appointmentId}::uuid`)) as unknown as Array<{
      doctor_id: string;
      insurer_id: string | null;
      plan_id: string | null;
      guide_type: string | null;
      cov_status: string | null;
      day: string;
    }>;
    const a = ap[0];
    if (!a) return null;
    if (!viewer.broad && a.doctor_id !== viewer.userId) return null;
    if (a.guide_type !== 'sp_sadt' || a.cov_status === 'cancelled' || !a.insurer_id) {
      return { available: true, items: [], options: [] };
    }
    const items = await listExtraItemsTx(tx, { clinicId, appointmentId });
    const lines = (await tx.execute(sql`
      SELECT l.id::text AS id, l.table_code, l.procedure_code, l.description
        FROM public.hi_procedure_contracts l
       WHERE l.clinic_id = ${clinicId}::uuid AND l.insurer_id = ${a.insurer_id}::uuid AND l.guide_type = 'sp_sadt'
         AND (l.plan_id IS NULL OR l.plan_id IS NOT DISTINCT FROM ${a.plan_id}::uuid)
         AND l.valid_from <= ${a.day}::date AND (l.valid_until IS NULL OR l.valid_until >= ${a.day}::date)
         AND NOT EXISTS (SELECT 1 FROM public.hi_procedure_contracts s WHERE s.clinic_id = l.clinic_id AND s.supersedes_id = l.id)
       ORDER BY l.table_code, l.procedure_code`)) as unknown as Array<{
      id: string;
      table_code: string;
      procedure_code: string;
      description: string;
    }>;
    return {
      available: true,
      items: items.map((i) => ({
        id: i.id,
        tableCode: i.tableCode,
        procedureCode: i.procedureCode,
        description: i.description,
        quantity: i.quantity,
        status: i.status,
        stateLabel: SESSION_STATE_LABEL[i.status],
        recordedByMe: i.recordedBy === viewer.userId,
      })),
      options: lines.map((l) => ({ id: l.id, label: `${l.table_code} · ${l.procedure_code} — ${l.description}` })),
    };
  });
}
