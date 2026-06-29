/**
 * Clinical read-side (C7). Tudo tenant-scoped via withTenant (RLS resolve por
 * `app.current_clinic`). REGRA: sem JOIN cross-context — só referencia ids.
 *
 * Server-only.
 */
import 'server-only';

import { and, asc, desc, eq, ilike, type SQL } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';

import { ProntuarioNotFoundError } from './errors';
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
  MedicalDocumentSummary,
  PrescriptionSummary,
  PrescriptionTemplateSummary,
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

export function toProntuarioDetail(row: ProntuarioRow): ProntuarioDetail {
  return {
    ...toProntuarioSummary(row),
    content: row.content ?? {},
    signedDoctorNome: row.signedDoctorNome ?? null,
    signedDoctorCrm: row.signedDoctorCrm ?? null,
    signedDoctorCrmUf: row.signedDoctorCrmUf ?? null,
    signedDoctorEspecialidade: row.signedDoctorEspecialidade ?? null,
  };
}

export function toPrescriptionSummary(row: PrescriptionRow): PrescriptionSummary {
  return {
    id: row.id,
    clinicId: row.clinicId,
    prontuarioId: row.prontuarioId ?? null,
    patientId: row.patientId,
    doctorId: row.doctorId,
    kind: row.kind,
    medicamentos: row.medicamentos ?? [],
    observacoes: row.observacoes ?? null,
    pdfStoragePath: row.pdfStoragePath ?? null,
    snapshotPatientNome: row.snapshotPatientNome,
    snapshotDoctorNome: row.snapshotDoctorNome,
    snapshotDoctorCrm: row.snapshotDoctorCrm,
    snapshotDoctorCrmUf: row.snapshotDoctorCrmUf ?? null,
    snapshotDoctorEspecialidade: row.snapshotDoctorEspecialidade ?? null,
    createdAt: toIso(row.createdAt)!,
  };
}

export function toMedicalDocumentSummary(row: MedicalDocumentRow): MedicalDocumentSummary {
  return {
    id: row.id,
    clinicId: row.clinicId,
    patientId: row.patientId,
    doctorId: row.doctorId,
    type: row.type,
    content: row.content,
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

export async function getProntuarioById(
  clinicId: string,
  id: string,
): Promise<ProntuarioDetail | null> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx.select().from(prontuarios).where(eq(prontuarios.id, id)).limit(1);
    return row ? toProntuarioDetail(row) : null;
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
    return row ? toPrescriptionSummary(row) : null;
  });
}

export async function getMedicalDocumentById(
  clinicId: string,
  id: string,
): Promise<MedicalDocumentSummary | null> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx.select().from(medicalDocuments).where(eq(medicalDocuments.id, id)).limit(1);
    return row ? toMedicalDocumentSummary(row) : null;
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

const MEDICAL_DOCUMENT_LABEL: Record<string, string> = {
  atestado: 'Atestado',
  declaracao: 'Declaração',
  exame: 'Solicitação de exames',
  encaminhamento: 'Encaminhamento',
};

const prescriptionLabel = (kind: PrescriptionRow['kind']): string =>
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
    return row ? toProntuarioDetail(row) : null;
  });
}
