/**
 * Clinical read-side (C7). Tudo tenant-scoped via withTenant (RLS resolve por
 * `app.current_clinic`). REGRA: sem JOIN cross-context — só referencia ids.
 *
 * Server-only.
 */
import 'server-only';

import { and, asc, desc, eq, ilike, sql, type SQL } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';

import { ProntuarioNotFoundError } from './errors';
import { decryptJson } from './internal/content-crypto';
import {
  medicalDocuments,
  prescriptions,
  prescriptionTemplates,
  prontuarios,
  type MedicalDocumentRow,
  type PrescriptionRow,
  type PrescriptionTemplateRow,
  type ProntuarioRow,
} from './schema';
import type {
  Medicamento,
  MedicalDocumentContent,
  MedicalDocumentSummary,
  PrescriptionSummary,
  PrescriptionTemplateSummary,
  ProntuarioContent,
  ProntuarioDetail,
  ProntuarioStatus,
  ProntuarioSummary,
} from './types';

const toIso = (v: Date | string | null | undefined): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : v;

// --- projeções -------------------------------------------------------------

export function toProntuarioSummary(row: ProntuarioRow): ProntuarioSummary {
  return {
    id: row.id,
    clinicId: row.clinicId,
    patientId: row.patientId,
    doctorId: row.doctorId,
    appointmentId: row.appointmentId ?? null,
    status: row.status as ProntuarioStatus,
    version: row.version,
    rowVersion: row.rowVersion,
    needsReturn: row.needsReturn,
    returnDays: row.returnDays ?? null,
    signedAt: toIso(row.signedAt),
    signedBy: row.signedBy ?? null,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
  };
}

// A1/ADR-044: as 3 projeções que expõem conteúdo clínico DECIFRAM (async +
// clinicId). São o PONTO ÚNICO de decrypt clínico — espelha patient/queries.ts.
// `toProntuarioSummary` fica SÍNCRONA e sem decrypt: é ela que alimenta listagem
// e o audit/idempotência (contrato ADR-012 §6: listagens não decifram).
export async function toProntuarioDetail(
  clinicId: string,
  row: ProntuarioRow,
): Promise<ProntuarioDetail> {
  return {
    ...toProntuarioSummary(row),
    content: await decryptJson<ProntuarioContent>(clinicId, row.clinicId, row.contentEncrypted),
    signedDoctorNome: row.signedDoctorNome ?? null,
    signedDoctorCrm: row.signedDoctorCrm ?? null,
    signedDoctorCrmUf: row.signedDoctorCrmUf ?? null,
    signedDoctorEspecialidade: row.signedDoctorEspecialidade ?? null,
  };
}

export async function toPrescriptionSummary(
  clinicId: string,
  row: PrescriptionRow,
): Promise<PrescriptionSummary> {
  return {
    id: row.id,
    clinicId: row.clinicId,
    prontuarioId: row.prontuarioId ?? null,
    patientId: row.patientId,
    doctorId: row.doctorId,
    kind: row.kind,
    medicamentos: await decryptJson<Medicamento[]>(
      clinicId,
      row.clinicId,
      row.medicamentosEncrypted,
    ),
    observacoes: row.observacoesEncrypted
      ? await decryptJson<string>(clinicId, row.clinicId, row.observacoesEncrypted)
      : null,
    pdfStoragePath: row.pdfStoragePath ?? null,
    snapshotPatientNome: row.snapshotPatientNome,
    snapshotDoctorNome: row.snapshotDoctorNome,
    snapshotDoctorCrm: row.snapshotDoctorCrm,
    snapshotDoctorCrmUf: row.snapshotDoctorCrmUf ?? null,
    snapshotDoctorEspecialidade: row.snapshotDoctorEspecialidade ?? null,
    createdAt: toIso(row.createdAt)!,
  };
}

export async function toMedicalDocumentSummary(
  clinicId: string,
  row: MedicalDocumentRow,
): Promise<MedicalDocumentSummary> {
  return {
    id: row.id,
    clinicId: row.clinicId,
    patientId: row.patientId,
    doctorId: row.doctorId,
    type: row.type,
    content: await decryptJson<MedicalDocumentContent>(
      clinicId,
      row.clinicId,
      row.contentEncrypted,
    ),
    pdfStoragePath: row.pdfStoragePath ?? null,
    snapshotPatientNome: row.snapshotPatientNome,
    snapshotDoctorNome: row.snapshotDoctorNome,
    snapshotDoctorCrm: row.snapshotDoctorCrm,
    snapshotDoctorCrmUf: row.snapshotDoctorCrmUf ?? null,
    snapshotDoctorEspecialidade: row.snapshotDoctorEspecialidade ?? null,
    createdAt: toIso(row.createdAt)!,
  };
}

export function toPrescriptionTemplateSummary(
  row: PrescriptionTemplateRow,
): PrescriptionTemplateSummary {
  return {
    id: row.id,
    clinicId: row.clinicId,
    doctorId: row.doctorId,
    nome: row.nome,
    categoria: row.categoria ?? null,
    kind: row.kind,
    medicamentos: row.medicamentos ?? [],
    observacoes: row.observacoes ?? null,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
  };
}

// --- reads -----------------------------------------------------------------

export async function listProntuariosByPatient(
  clinicId: string,
  patientId: string,
): Promise<ProntuarioSummary[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(prontuarios)
      .where(and(eq(prontuarios.clinicId, clinicId), eq(prontuarios.patientId, patientId)))
      .orderBy(desc(prontuarios.createdAt));
    return rows.map(toProntuarioSummary);
  });
}

const RECENT_PATIENT_PRONTUARIOS_LIMIT = 8;

/**
 * Recorte pequeno para a atividade do perfil do paciente. A aba completa
 * continua usando `listProntuariosByPatient`, sem limite.
 */
export async function listRecentProntuariosByPatient(
  clinicId: string,
  patientId: string,
): Promise<ProntuarioSummary[]> {
  return withTenant(clinicId, async (tx) => {
    const activityAt = sql<Date>`CASE
      WHEN ${prontuarios.status} = 'assinado'
        THEN COALESCE(${prontuarios.signedAt}, ${prontuarios.updatedAt})
      ELSE ${prontuarios.updatedAt}
    END`;
    const rows = await tx
      .select()
      .from(prontuarios)
      .where(and(eq(prontuarios.clinicId, clinicId), eq(prontuarios.patientId, patientId)))
      .orderBy(desc(activityAt), desc(prontuarios.id))
      .limit(RECENT_PATIENT_PRONTUARIOS_LIMIT);
    return rows.map(toProntuarioSummary);
  });
}

export async function getProntuarioById(
  clinicId: string,
  id: string,
): Promise<ProntuarioDetail | null> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx.select().from(prontuarios).where(eq(prontuarios.id, id)).limit(1);
    return row ? toProntuarioDetail(clinicId, row) : null;
  });
}

export async function getProntuarioOrThrow(
  clinicId: string,
  id: string,
): Promise<ProntuarioDetail> {
  const row = await getProntuarioById(clinicId, id);
  if (!row) throw new ProntuarioNotFoundError(id);
  return row;
}

export async function getPrescriptionById(
  clinicId: string,
  id: string,
): Promise<PrescriptionSummary | null> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx.select().from(prescriptions).where(eq(prescriptions.id, id)).limit(1);
    return row ? toPrescriptionSummary(clinicId, row) : null;
  });
}

export async function getMedicalDocumentById(
  clinicId: string,
  id: string,
): Promise<MedicalDocumentSummary | null> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select()
      .from(medicalDocuments)
      .where(eq(medicalDocuments.id, id))
      .limit(1);
    return row ? toMedicalDocumentSummary(clinicId, row) : null;
  });
}

// --- feed unificado de documentos clínicos (/documentos) -------------------
//
// Adapter ÚNICO para a tela de Documentos: une prescrições + medical_documents
// num feed homogêneo. A tela NUNCA conhece as tabelas — só consome
// ClinicalDocumentFeedItem (kind/label/pdfHref já resolvidos). Sem JOIN
// cross-context: o nome do paciente vem do snapshot (R8) gravado em cada linha.
// Duas leituras tenant-scoped + merge em memória (listas por clínica são
// pequenas; debugável por solo founder — preferido a UNION de shapes distintos).

export type ClinicalDocumentKind = 'prescription' | 'document';

export interface ClinicalDocumentFeedItem {
  kind: ClinicalDocumentKind;
  id: string;
  patientId: string;
  patientNome: string;
  /** Rótulo humano já resolvido ("Receita", "Atestado", …). */
  label: string;
  createdAt: string;
  /** Página de PDF existente (signed URL fresca é gerada lá — R4). */
  pdfHref: string;
  hasPdf: boolean;
}

export interface ClinicalDocumentFeedOpts {
  /** Busca por nome do paciente (snapshot). Cap 64 chars (padrão listPatients). */
  search?: string;
  /** Restringe a um tipo (prescrição ou documento). */
  kind?: ClinicalDocumentKind;
  /** Restringe a um paciente específico. */
  patientId?: string;
  limit?: number;
}

export interface ClinicalDocumentFeedPageOpts extends Omit<ClinicalDocumentFeedOpts, 'limit'> {
  page?: number;
  pageSize?: number;
}

export interface ClinicalDocumentFeedPageResult {
  items: ClinicalDocumentFeedItem[];
  total: number;
  page: number;
  pageSize: number;
}

const MEDICAL_DOCUMENT_LABEL: Record<string, string> = {
  atestado: 'Atestado',
  declaracao: 'Declaração',
  exame: 'Solicitação de exames',
  encaminhamento: 'Encaminhamento',
};

const prescriptionLabel = (kind: string): string =>
  kind === 'controle_especial' ? 'Receituário de controle especial' : 'Receita';

export async function listClinicalDocumentFeed(
  clinicId: string,
  opts: ClinicalDocumentFeedOpts = {},
): Promise<ClinicalDocumentFeedItem[]> {
  const limit = Math.min(opts.limit ?? 100, 200);
  const search = opts.search?.trim().slice(0, 64);
  return withTenant(clinicId, async (tx) => {
    const items: ClinicalDocumentFeedItem[] = [];

    if (opts.kind !== 'document') {
      const conds: SQL[] = [eq(prescriptions.clinicId, clinicId)];
      if (opts.patientId) conds.push(eq(prescriptions.patientId, opts.patientId));
      if (search) conds.push(ilike(prescriptions.snapshotPatientNome, `%${search}%`) as SQL);
      const rows = await tx
        .select()
        .from(prescriptions)
        .where(and(...conds))
        .orderBy(desc(prescriptions.createdAt))
        .limit(limit);
      for (const r of rows) {
        items.push({
          kind: 'prescription',
          id: r.id,
          patientId: r.patientId,
          patientNome: r.snapshotPatientNome,
          label: prescriptionLabel(r.kind),
          createdAt: toIso(r.createdAt)!,
          pdfHref: `/prescricoes/${r.id}/pdf`,
          hasPdf: r.pdfStoragePath != null,
        });
      }
    }

    if (opts.kind !== 'prescription') {
      const conds: SQL[] = [eq(medicalDocuments.clinicId, clinicId)];
      if (opts.patientId) conds.push(eq(medicalDocuments.patientId, opts.patientId));
      if (search) conds.push(ilike(medicalDocuments.snapshotPatientNome, `%${search}%`) as SQL);
      const rows = await tx
        .select()
        .from(medicalDocuments)
        .where(and(...conds))
        .orderBy(desc(medicalDocuments.createdAt))
        .limit(limit);
      for (const r of rows) {
        items.push({
          kind: 'document',
          id: r.id,
          patientId: r.patientId,
          patientNome: r.snapshotPatientNome,
          label: MEDICAL_DOCUMENT_LABEL[r.type] ?? 'Documento',
          createdAt: toIso(r.createdAt)!,
          pdfHref: `/documentos/${r.id}/pdf`,
          hasPdf: r.pdfStoragePath != null,
        });
      }
    }

    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return items.slice(0, limit);
  });
}

const DEFAULT_CLINICAL_DOCUMENT_PAGE_SIZE = 50;
const MAX_CLINICAL_DOCUMENT_PAGE_SIZE = 200;

interface ClinicalDocumentFeedDbRow extends Record<string, unknown> {
  kind: ClinicalDocumentKind;
  id: string;
  patient_id: string;
  patient_nome: string;
  source_type: string;
  created_at: Date | string;
  has_pdf: boolean;
}

/**
 * Feed global paginado para `/documentos`.
 *
 * A paginação acontece DEPOIS do `UNION ALL`: aplicar `limit/offset` em cada
 * tabela antes do merge produziria páginas incorretas quando prescrições e
 * documentos se intercalam. O RLS continua autoritativo via `withTenant`, e os
 * dois ramos também carregam `clinic_id` explícito como defesa em profundidade.
 */
export async function listClinicalDocumentFeedPage(
  clinicId: string,
  opts: ClinicalDocumentFeedPageOpts = {},
): Promise<ClinicalDocumentFeedPageResult> {
  const page =
    typeof opts.page === 'number' && Number.isSafeInteger(opts.page) && opts.page > 0
      ? opts.page
      : 1;
  const pageSize =
    typeof opts.pageSize === 'number' && Number.isSafeInteger(opts.pageSize) && opts.pageSize > 0
      ? Math.min(opts.pageSize, MAX_CLINICAL_DOCUMENT_PAGE_SIZE)
      : DEFAULT_CLINICAL_DOCUMENT_PAGE_SIZE;
  const offset = (page - 1) * pageSize;
  const search = opts.search?.trim().slice(0, 64);

  return withTenant(clinicId, async (tx) => {
    const sources: SQL[] = [];

    if (opts.kind !== 'document') {
      const conditions: SQL[] = [eq(prescriptions.clinicId, clinicId)];
      if (opts.patientId) conditions.push(eq(prescriptions.patientId, opts.patientId));
      if (search) {
        conditions.push(ilike(prescriptions.snapshotPatientNome, `%${search}%`) as SQL);
      }
      sources.push(sql`
        SELECT
          'prescription'::text AS kind,
          ${prescriptions.id} AS id,
          ${prescriptions.patientId} AS patient_id,
          ${prescriptions.snapshotPatientNome} AS patient_nome,
          ${prescriptions.kind}::text AS source_type,
          ${prescriptions.createdAt} AS created_at,
          (${prescriptions.pdfStoragePath} IS NOT NULL) AS has_pdf
        FROM ${prescriptions}
        WHERE ${and(...conditions)}
      `);
    }

    if (opts.kind !== 'prescription') {
      const conditions: SQL[] = [eq(medicalDocuments.clinicId, clinicId)];
      if (opts.patientId) conditions.push(eq(medicalDocuments.patientId, opts.patientId));
      if (search) {
        conditions.push(ilike(medicalDocuments.snapshotPatientNome, `%${search}%`) as SQL);
      }
      sources.push(sql`
        SELECT
          'document'::text AS kind,
          ${medicalDocuments.id} AS id,
          ${medicalDocuments.patientId} AS patient_id,
          ${medicalDocuments.snapshotPatientNome} AS patient_nome,
          ${medicalDocuments.type}::text AS source_type,
          ${medicalDocuments.createdAt} AS created_at,
          (${medicalDocuments.pdfStoragePath} IS NOT NULL) AS has_pdf
        FROM ${medicalDocuments}
        WHERE ${and(...conditions)}
      `);
    }

    // `kind` é um union fechado, portanto sempre existe ao menos uma fonte.
    const source =
      sources.length === 1 ? sources[0]! : sql`${sources[0]!} UNION ALL ${sources[1]!}`;
    const [rows, countRows] = await Promise.all([
      tx.execute<ClinicalDocumentFeedDbRow>(sql`
        WITH unified AS (${source})
        SELECT kind, id, patient_id, patient_nome, source_type, created_at, has_pdf
        FROM unified
        ORDER BY created_at DESC, kind DESC, id DESC
        LIMIT ${pageSize}
        OFFSET ${offset}
      `),
      tx.execute<{ total: number }>(sql`
        WITH unified AS (${source})
        SELECT count(*)::int AS total
        FROM unified
      `),
    ]);

    return {
      items: rows.map((row) => ({
        kind: row.kind,
        id: row.id,
        patientId: row.patient_id,
        patientNome: row.patient_nome,
        label:
          row.kind === 'prescription'
            ? prescriptionLabel(row.source_type)
            : (MEDICAL_DOCUMENT_LABEL[row.source_type] ?? 'Documento'),
        createdAt: toIso(row.created_at)!,
        pdfHref:
          row.kind === 'prescription' ? `/prescricoes/${row.id}/pdf` : `/documentos/${row.id}/pdf`,
        hasPdf: row.has_pdf,
      })),
      total: Number(countRows[0]?.total ?? 0),
      page,
      pageSize,
    };
  });
}

// --- modelos de receita (Fase 2) — sempre filtrados por doctor_id (G4) ------

export interface ListTemplatesOpts {
  search?: string;
  categoria?: string;
}

/**
 * Modelos do MÉDICO logado na clínica atual. RLS isola por clínica; o filtro
 * `doctor_id` (obrigatório) garante o isolamento por prescritor (G4). Busca por
 * nome (cap 64 chars, padrão listPatients) + filtro opcional por categoria.
 */
export async function listPrescriptionTemplates(
  clinicId: string,
  doctorId: string,
  opts: ListTemplatesOpts = {},
): Promise<PrescriptionTemplateSummary[]> {
  const conds: SQL[] = [
    eq(prescriptionTemplates.clinicId, clinicId),
    eq(prescriptionTemplates.doctorId, doctorId),
  ];
  if (opts.search) {
    const term = opts.search.trim().slice(0, 64);
    if (term) conds.push(ilike(prescriptionTemplates.nome, `%${term}%`) as SQL);
  }
  if (opts.categoria) {
    conds.push(eq(prescriptionTemplates.categoria, opts.categoria.trim()));
  }
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(prescriptionTemplates)
      .where(and(...conds))
      .orderBy(asc(prescriptionTemplates.nome));
    return rows.map(toPrescriptionTemplateSummary);
  });
}

/** Modelo por id, restrito ao médico logado (G4). null se não for dele. */
export async function getPrescriptionTemplateById(
  clinicId: string,
  doctorId: string,
  id: string,
): Promise<PrescriptionTemplateSummary | null> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select()
      .from(prescriptionTemplates)
      .where(
        and(
          eq(prescriptionTemplates.id, id),
          eq(prescriptionTemplates.clinicId, clinicId),
          eq(prescriptionTemplates.doctorId, doctorId),
        ),
      )
      .limit(1);
    return row ? toPrescriptionTemplateSummary(row) : null;
  });
}

// --- C8: prontuário por consulta -------------------------------------------

/** Carrega o prontuário vinculado a um appointment (centro do Consultório). */
export async function getProntuarioByAppointment(
  clinicId: string,
  appointmentId: string,
): Promise<ProntuarioDetail | null> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select()
      .from(prontuarios)
      .where(and(eq(prontuarios.clinicId, clinicId), eq(prontuarios.appointmentId, appointmentId)))
      .limit(1);
    return row ? toProntuarioDetail(clinicId, row) : null;
  });
}
