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

import type { GuideIssue } from './tiss/validation/common';

type Row = Record<string, unknown>;
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

export const GUIDE_STATUS_LABELS: Record<string, string> = {
  pending_data: 'Falta dado',
  ready_for_review: 'Para conferir',
  reviewed: 'Conferida',
  approved: 'Aprovada',
  in_batch: 'Em lote',
  exported: 'XML gerado',
  sent: 'Enviada',
  under_review: 'Em análise',
  paid: 'Paga',
  partially_paid: 'Paga em parte',
  partially_glossed: 'Glosada em parte',
  fully_glossed: 'Glosada',
  closed: 'Conciliada',
  cancelled: 'Cancelada',
  replaced: 'Substituída',
};

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
  insurers: InsurerSummary[];
  totals: Omit<InsurerSummary, 'insurerId' | 'name' | 'guides'> & { guides: number };
  guidesByStatus: Record<string, number>;
  /** Pendências de faturamento abertas (atendimento sem guia pronta), por responsável. */
  openGapsByOwner: Record<string, number>;
  /** Guias com pendência de dado, por responsável. */
  guideIssuesByOwner: Record<string, number>;
  /** Divergência entre a conta da guia e o livro financeiro (deve ser zero). */
  ledgerDrift: number;
}

export async function getInsuranceOverview(clinicId: string): Promise<InsuranceOverview> {
  return withTenant(clinicId, async (tx) => {
    const [settings] = (await tx.execute(
      sql`SELECT enabled FROM public.hi_clinic_settings WHERE clinic_id = ${clinicId}::uuid`,
    )) as unknown as Row[];
    const receivables = (await tx.execute(
      sql`SELECT r.*, i.name FROM public.hi_insurer_receivables r
            JOIN public.hi_insurers i ON i.clinic_id = r.clinic_id AND i.id = r.insurer_id
           WHERE r.clinic_id = ${clinicId}::uuid ORDER BY i.name`,
    )) as unknown as Row[];
    const byStatus = (await tx.execute(
      sql`SELECT status, count(*)::int AS n FROM public.hi_guides WHERE clinic_id = ${clinicId}::uuid GROUP BY status`,
    )) as unknown as Row[];
    const gaps = (await tx.execute(
      sql`SELECT owner, count(*)::int AS n FROM public.hi_billing_gaps
           WHERE clinic_id = ${clinicId}::uuid AND status = 'open' GROUP BY owner`,
    )) as unknown as Row[];
    const issues = (await tx.execute(
      sql`SELECT x->>'owner' AS owner, count(*)::int AS n
            FROM public.hi_guides g CROSS JOIN LATERAL jsonb_array_elements(g.issues) x
           WHERE g.clinic_id = ${clinicId}::uuid AND g.status IN ('pending_data', 'ready_for_review') AND g.live
           GROUP BY 1`,
    )) as unknown as Row[];
    const [drift] = (await tx.execute(
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
      totals: {
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
  totalValueCents: number;
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

export async function listGuides(clinicId: string, f: GuideFilters = {}): Promise<{ rows: GuideListRow[]; total: number }> {
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
      AND (${q}::text IS NULL OR g.number ILIKE ${q} OR p.nome ILIKE ${q})`;
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
        totalValueCents: n(r.total_value_cents),
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
  totalValueCents: number;
}

export interface GuideEventRow {
  fromStatus: string | null;
  toStatus: string | null;
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
  createdAt: string | null;
}

export interface GuideDetail extends GuideListRow {
  cancelReason: string | null;
  approvedAt: string | null;
  reviewedAt: string | null;
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

export async function getGuideDetail(clinicId: string, guideId: string): Promise<GuideDetail | null> {
  return withTenant(clinicId, async (tx) => {
    const [g] = (await tx.execute(
      sql`SELECT g.*, i.name AS insurer_name, p.nome AS patient_name
            FROM public.hi_guides g
            JOIN public.hi_insurers i ON i.clinic_id = g.clinic_id AND i.id = g.insurer_id
            LEFT JOIN public.patients p ON p.clinic_id = g.clinic_id AND p.id = g.patient_id
           WHERE g.clinic_id = ${clinicId}::uuid AND g.id = ${guideId}::uuid`,
    )) as unknown as Row[];
    if (!g) return null;
    const items = (await tx.execute(
      sql`SELECT id, sequence, executed_on, table_code, procedure_code, description, quantity, total_value_cents
            FROM public.hi_guide_items WHERE clinic_id = ${clinicId}::uuid AND guide_id = ${guideId}::uuid ORDER BY sequence`,
    )) as unknown as Row[];
    const events = (await tx.execute(
      sql`SELECT e.from_status, e.to_status, e.actor_kind, e.note, e.created_at, pr.nome AS actor_name
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

/** Operadoras ativas da clínica e as guias aprovadas prontas para lote, por operadora. */
export async function listBatchCandidates(
  clinicId: string,
): Promise<Array<{ insurerId: string; name: string; guides: Array<{ id: string; number: string; guideType: string; patientName: string | null; totalValueCents: number }> }>> {
  return withTenant(clinicId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT i.id AS insurer_id, i.name, g.id, g.number, g.guide_type, g.total_value_cents, p.nome AS patient_name
            FROM public.hi_insurers i
            LEFT JOIN public.hi_guides g ON g.clinic_id = i.clinic_id AND g.insurer_id = i.id AND g.status = 'approved' AND g.live
            LEFT JOIN public.patients p ON p.clinic_id = g.clinic_id AND p.id = g.patient_id
           WHERE i.clinic_id = ${clinicId}::uuid AND i.status = 'active'
           ORDER BY i.name, g.number`,
    )) as unknown as Row[];
    const out = new Map<string, { insurerId: string; name: string; guides: Array<{ id: string; number: string; guideType: string; patientName: string | null; totalValueCents: number }> }>();
    for (const r of rows) {
      const k = String(r.insurer_id);
      if (!out.has(k)) out.set(k, { insurerId: k, name: String(r.name), guides: [] });
      if (r.id) {
        out.get(k)!.guides.push({ id: String(r.id), number: String(r.number), guideType: String(r.guide_type), patientName: s(r.patient_name), totalValueCents: n(r.total_value_cents) });
      }
    }
    return [...out.values()];
  });
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
): Promise<Array<{ id: string; number: string; pendingCents: number; insurerId: string; batchId: string }>> {
  return withTenant(clinicId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT a.guide_id, a.number, a.pending_cents, a.insurer_id, bg.batch_id
            FROM public.hi_guide_accounts a
            JOIN public.hi_batch_guides bg ON bg.clinic_id = a.clinic_id AND bg.guide_id = a.guide_id AND bg.active
           WHERE a.clinic_id = ${clinicId}::uuid AND a.pending_cents > 0 AND a.status <> 'closed'
           ORDER BY a.number LIMIT 500`,
    )) as unknown as Row[];
    return rows.map((r) => ({
      id: String(r.guide_id),
      number: String(r.number),
      pendingCents: n(r.pending_cents),
      insurerId: String(r.insurer_id),
      batchId: String(r.batch_id),
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
