/**
 * Pipeline de PDF dos documentos clínicos (C7) — fase 2/3 do split-TX (R3).
 *
 * Render (puro) + upload acontecem FORA de qualquer transação (I/O lento não
 * segura TX). Em seguida, TX2 grava o path e publica o evento APENAS na transição
 * pdf_storage_path NULL→preenchido (R10 — exatamente-uma-vez), com key
 * determinística. Regeneração (`force`) sobrescreve o mesmo objeto (upsert) sem
 * republicar evento (Ponto 3). Usa o snapshot persistido (R8/R11): médico do row,
 * branding atual da clínica.
 */
import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';
import {
  renderAtestadoPDF,
  renderDeclaracaoPDF,
  renderEncaminhamentoPDF,
  renderExamePDF,
  renderPrescriptionPDF,
  renderReceituarioControleEspecialPDF,
  type PdfBranding,
  type PdfDoctor,
} from '@/lib/pdf';
import { publishEvent } from '@/lib/outbox/publish';
import { CLINICAL_PDF_BUCKET, uploadStorageFile } from '@/lib/storage/clinical';

import { CLINICAL_EVENTS } from '../events';
import { MedicalDocumentNotFoundError, PrescriptionNotFoundError } from '../errors';
import {
  medicalDocuments,
  prescriptions,
  type MedicalDocumentRow,
} from '../schema';
import type {
  AtestadoContent,
  DeclaracaoContent,
  EncaminhamentoContent,
  ExameContent,
} from '../types';
import { loadClinicBranding } from './whitelabel';

function rowDoctor(row: {
  snapshotDoctorNome: string;
  snapshotDoctorCrm: string;
  snapshotDoctorCrmUf: string | null;
  snapshotDoctorEspecialidade: string | null;
}): PdfDoctor {
  return {
    nome: row.snapshotDoctorNome,
    crm: row.snapshotDoctorCrm,
    crmUf: row.snapshotDoctorCrmUf,
    especialidade: row.snapshotDoctorEspecialidade,
  };
}

// --- prescription ----------------------------------------------------------

export async function ensurePrescriptionPdf(
  clinicId: string,
  id: string,
  correlationId: string | null,
  force = false,
): Promise<void> {
  const loaded = await withTenant(clinicId, async (tx) => {
    const [row] = await tx.select().from(prescriptions).where(eq(prescriptions.id, id)).limit(1);
    if (!row) throw new PrescriptionNotFoundError(id);
    const branding: PdfBranding = await loadClinicBranding(tx, clinicId);
    return { row, branding };
  });
  if (loaded.row.pdfStoragePath && !force) return; // idempotente: já gerado

  // Branch por kind. Controle especial usa template de 2 vias + identificação do
  // emitente/endereço do paciente do SNAPSHOT (G1 — validade documental imutável).
  // Demais campos do pipeline (path/bucket/upload/evento/idempotência) são idênticos.
  const issuedAt = loaded.row.createdAt.toISOString();
  const pdf =
    loaded.row.kind === 'controle_especial'
      ? await renderReceituarioControleEspecialPDF(
          {
            patientNome: loaded.row.snapshotPatientNome,
            patientEndereco: loaded.row.snapshotPatientEndereco,
            emitenteNome: loaded.row.snapshotEmitenteNome ?? loaded.branding.nome,
            emitenteEndereco: loaded.row.snapshotEmitenteEndereco,
            emitenteTelefone: loaded.row.snapshotEmitenteTelefone,
            medicamentos: loaded.row.medicamentos ?? [],
            observacoes: loaded.row.observacoes,
            issuedAt,
          },
          loaded.branding,
          rowDoctor(loaded.row),
        )
      : await renderPrescriptionPDF(
          {
            patientNome: loaded.row.snapshotPatientNome,
            medicamentos: loaded.row.medicamentos ?? [],
            observacoes: loaded.row.observacoes,
            issuedAt,
          },
          loaded.branding,
          rowDoctor(loaded.row),
        );
  const path = `${clinicId}/prescriptions/${id}.pdf`;
  await uploadStorageFile(CLINICAL_PDF_BUCKET, path, pdf);

  await withTenant(clinicId, async (tx) => {
    const updated = await tx
      .update(prescriptions)
      .set({ pdfStoragePath: path, updatedAt: sql`now()` })
      .where(and(eq(prescriptions.id, id), isNull(prescriptions.pdfStoragePath)))
      .returning({ id: prescriptions.id });
    if (updated.length > 0) {
      await publishEvent(tx, {
        clinicId,
        eventType: CLINICAL_EVENTS.PRESCRIPTION_CREATED,
        payload: {
          prescriptionId: id,
          clinicId,
          prontuarioId: loaded.row.prontuarioId ?? null,
          patientId: loaded.row.patientId,
          doctorId: loaded.row.doctorId,
          kind: loaded.row.kind,
          createdAt: loaded.row.createdAt.toISOString(),
        },
        idempotencyKey: `prescription-created:${id}`,
        correlationId,
      });
    }
  });
}

// --- medical document ------------------------------------------------------

function renderMedicalDocument(
  row: MedicalDocumentRow,
  branding: PdfBranding,
  doctor: PdfDoctor,
): Promise<Buffer> {
  const issuedAt = row.createdAt.toISOString();
  const patientNome = row.snapshotPatientNome;
  switch (row.type) {
    case 'atestado': {
      const c = row.content as AtestadoContent;
      return renderAtestadoPDF(
        { patientNome, descricao: c.descricao, cid: c.cid ?? null, dias: c.dias ?? null, issuedAt },
        branding,
        doctor,
      );
    }
    case 'declaracao': {
      const c = row.content as DeclaracaoContent;
      return renderDeclaracaoPDF(
        { patientNome, texto: c.texto, periodo: c.periodo ?? null, issuedAt },
        branding,
        doctor,
      );
    }
    case 'exame': {
      const c = row.content as ExameContent;
      return renderExamePDF(
        { patientNome, exames: c.exames, indicacaoClinica: c.indicacaoClinica ?? null, issuedAt },
        branding,
        doctor,
      );
    }
    case 'encaminhamento': {
      const c = row.content as EncaminhamentoContent;
      return renderEncaminhamentoPDF(
        { patientNome, especialidade: c.especialidade, motivo: c.motivo, issuedAt },
        branding,
        doctor,
      );
    }
    default: {
      const _exhaustive: never = row.type;
      throw new Error(`tipo de documento não suportado: ${String(_exhaustive)}`);
    }
  }
}

export async function ensureMedicalDocumentPdf(
  clinicId: string,
  id: string,
  correlationId: string | null,
  force = false,
): Promise<void> {
  const loaded = await withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select()
      .from(medicalDocuments)
      .where(eq(medicalDocuments.id, id))
      .limit(1);
    if (!row) throw new MedicalDocumentNotFoundError(id);
    const branding: PdfBranding = await loadClinicBranding(tx, clinicId);
    return { row, branding };
  });
  if (loaded.row.pdfStoragePath && !force) return;

  const pdf = await renderMedicalDocument(loaded.row, loaded.branding, rowDoctor(loaded.row));
  const path = `${clinicId}/documents/${loaded.row.type}/${id}.pdf`;
  await uploadStorageFile(CLINICAL_PDF_BUCKET, path, pdf);

  await withTenant(clinicId, async (tx) => {
    const updated = await tx
      .update(medicalDocuments)
      .set({ pdfStoragePath: path, updatedAt: sql`now()` })
      .where(and(eq(medicalDocuments.id, id), isNull(medicalDocuments.pdfStoragePath)))
      .returning({ id: medicalDocuments.id });
    if (updated.length > 0) {
      await publishEvent(tx, {
        clinicId,
        eventType: CLINICAL_EVENTS.DOCUMENT_GENERATED,
        payload: {
          documentId: id,
          clinicId,
          patientId: loaded.row.patientId,
          doctorId: loaded.row.doctorId,
          type: loaded.row.type,
          createdAt: loaded.row.createdAt.toISOString(),
        },
        idempotencyKey: `document-generated:${id}`,
        correlationId,
      });
    }
  });
}
