/**
 * Clinical read-side (C7). Tudo tenant-scoped via withTenant (RLS resolve por
 * `app.current_clinic`). REGRA: sem JOIN cross-context — só referencia ids.
 *
 * Server-only.
 */
import 'server-only';

import { and, desc, eq } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';

import { ProntuarioNotFoundError } from './errors';
import {
  medicalDocuments,
  prescriptions,
  prontuarios,
  type MedicalDocumentRow,
  type PrescriptionRow,
  type ProntuarioRow,
} from './schema';
import type {
  MedicalDocumentSummary,
  PrescriptionSummary,
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
