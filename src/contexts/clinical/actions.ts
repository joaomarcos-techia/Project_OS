'use server';

/**
 * Clinical Server Actions (C7). Pipeline congelado:
 *   requireUser → require*Permission → Zod → idempotentMutation({idempotency,audit}, tx => …)
 *
 * Imutabilidade pós-assinatura em DUAS camadas (Regra 4):
 *   - aplicação: updateProntuario bloqueia status='assinado'.
 *   - banco: trigger block_signed_prontuario_update (migration 0017).
 *
 * Auto-save (updateProntuario) usa withTenant direto, SEM idempotentMutation/audit
 * (R1: alta frequência; só ações críticas auditam). Concorrência via rowVersion.
 *
 * Prescrição/documento: split-TX síncrono (R3) — insert+audit (TX1), render+upload
 * fora de TX, grava path + publica evento (TX2 via pdf-pipeline). Retorna só {id} (R4).
 */
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { PERMISSIONS } from '@/lib/auth/permissions';
import {
  requireCachedPermission,
  requireClinicId,
  requireFreshPermission,
  requireUser,
} from '@/lib/auth/tenant-context';
import { withTenant } from '@/lib/db/tenant';
import { idempotentMutation } from '@/lib/idempotency/mutation';
import { publishEvent } from '@/lib/outbox/publish';

import { CLINICAL_EVENTS } from './events';
import {
  ClinicalValidationError,
  ProntuarioConflitoError,
  ProntuarioImutavelError,
  ProntuarioNotFoundError,
} from './errors';
import { idemKey, IDEM_TTL, jsonSafe, requestContext } from './internal/action-helpers';
import { assertDoctorHasCrm, resolveDoctorSnapshot } from './internal/doctor';
import { resolvePatientNome } from './internal/patient-ref';
import { ensureMedicalDocumentPdf, ensurePrescriptionPdf } from './internal/pdf-pipeline';
import { getProntuarioOrThrow, toProntuarioDetail } from './queries';
import { medicalDocuments, prescriptions, prontuarioVersions, prontuarios } from './schema';
import {
  CreateMedicalDocumentSchema,
  CreatePrescriptionSchema,
  CreateProntuarioSchema,
  EditSignedProntuarioSchema,
  ProntuarioContentSchema,
  SignProntuarioSchema,
  type CreateMedicalDocumentInput,
  type CreatePrescriptionInput,
  type CreateProntuarioInput,
  type ProntuarioContent,
  type ProntuarioDetail,
  type SignProntuarioInput,
} from './types';

const uuid = z.string().uuid();

/** Audit action da correção pós-assinatura (NÃO é um evento publicado). */
const EDIT_SIGNED_ACTION = 'clinical.prontuario.edited_signed';

function isContentEmpty(c: ProntuarioContent | null | undefined): boolean {
  if (!c) return true;
  return Object.values(c).every(
    (v) => v == null || (typeof v === 'string' && v.trim() === ''),
  );
}

// --- createProntuario ------------------------------------------------------

export async function createProntuario(
  input: CreateProntuarioInput,
  idempotencyKey: string,
): Promise<ProntuarioDetail> {
  const user = await requireUser();
  await requireCachedPermission(PERMISSIONS.CREATE_PRONTUARIO);
  const data = CreateProntuarioSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('create_prontuario', idempotencyKey),
        payload: jsonSafe(data),
        ttlSeconds: IDEM_TTL,
      },
      audit: {
        action: CLINICAL_EVENTS.PRONTUARIO_CREATED,
        resourceType: 'prontuario',
        resourceId: null,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      // Ponto 2 / R9: 1 consulta = 1 prontuário. Se já existe para o appointment,
      // retorna o existente (abre, não duplica) — elimina corrida handler×manual.
      if (data.appointmentId) {
        const [existing] = await tx
          .select()
          .from(prontuarios)
          .where(
            and(
              eq(prontuarios.clinicId, clinicId),
              eq(prontuarios.appointmentId, data.appointmentId),
            ),
          )
          .limit(1);
        if (existing) return toProntuarioDetail(existing);
      }

      const [row] = await tx
        .insert(prontuarios)
        .values({
          clinicId,
          patientId: data.patientId,
          doctorId: user.userId,
          appointmentId: data.appointmentId ?? null,
          status: 'rascunho',
          content: data.content ?? {},
          createdBy: user.userId,
        })
        .returning();

      await publishEvent(tx, {
        clinicId,
        eventType: CLINICAL_EVENTS.PRONTUARIO_CREATED,
        payload: {
          prontuarioId: row!.id,
          clinicId,
          patientId: data.patientId,
          doctorId: user.userId,
          appointmentId: data.appointmentId ?? null,
          createdBy: user.userId,
        },
        idempotencyKey: `prontuario-created:${row!.id}`,
        correlationId: ctx.correlationId ?? null,
      });

      return toProntuarioDetail(row!);
    },
  );
}

// --- updateProntuario (auto-save) ------------------------------------------

export async function updateProntuario(
  id: string,
  contentInput: unknown,
  expectedRowVersion: number,
): Promise<{ rowVersion: number }> {
  await requireUser();
  await requireCachedPermission(PERMISSIONS.CREATE_PRONTUARIO);
  const pid = uuid.parse(id);
  const content = ProntuarioContentSchema.parse(contentInput);
  const clinicId = await requireClinicId();

  return withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select()
      .from(prontuarios)
      .where(eq(prontuarios.id, pid))
      .for('update')
      .limit(1);
    if (!row) throw new ProntuarioNotFoundError(pid);
    // Regra 3/4 — camada aplicação (a trigger SQL é a segunda camada).
    if (row.status === 'assinado') throw new ProntuarioImutavelError();
    if (row.rowVersion !== expectedRowVersion) throw new ProntuarioConflitoError();

    const [updated] = await tx
      .update(prontuarios)
      .set({ content, rowVersion: row.rowVersion + 1, updatedAt: sql`now()` })
      .where(eq(prontuarios.id, pid))
      .returning({ rowVersion: prontuarios.rowVersion });
    return { rowVersion: updated!.rowVersion };
  });
}

// --- signProntuario --------------------------------------------------------

export async function signProntuario(
  id: string,
  input: SignProntuarioInput,
  idempotencyKey: string,
): Promise<ProntuarioDetail> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.SIGN_PRONTUARIO);
  const pid = uuid.parse(id);
  const data = SignProntuarioSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  const before = await getProntuarioOrThrow(clinicId, pid);

  const returnDays = data.needsReturn ? (data.returnDays ?? null) : null;

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('sign_prontuario', idempotencyKey),
        payload: jsonSafe({ id: pid, ...data }),
        ttlSeconds: IDEM_TTL,
      },
      audit: {
        action: CLINICAL_EVENTS.PRONTUARIO_SIGNED,
        resourceType: 'prontuario',
        resourceId: pid,
        before,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const [row] = await tx
        .select()
        .from(prontuarios)
        .where(eq(prontuarios.id, pid))
        .for('update')
        .limit(1);
      if (!row) throw new ProntuarioNotFoundError(pid);
      if (row.status === 'assinado') {
        throw new ClinicalValidationError('Prontuário já está assinado.');
      }
      if (isContentEmpty(row.content)) {
        throw new ClinicalValidationError('Não é possível assinar um prontuário vazio.');
      }

      // R6: assinatura NÃO exige CRM. resolveDoctorSnapshot SEM assertDoctorHasCrm.
      const snap = await resolveDoctorSnapshot(tx, user.userId);
      const signedAt = new Date();

      // OLD.signed_at IS NULL aqui ⇒ trigger de imutabilidade não dispara.
      const [updated] = await tx
        .update(prontuarios)
        .set({
          status: 'assinado',
          signedAt,
          signedBy: user.userId,
          signedDoctorNome: snap.nome,
          signedDoctorCrm: snap.crm,
          signedDoctorCrmUf: snap.crmUf,
          signedDoctorEspecialidade: snap.especialidade,
          needsReturn: data.needsReturn,
          returnDays,
          rowVersion: row.rowVersion + 1,
          updatedAt: sql`now()`,
        })
        .where(eq(prontuarios.id, pid))
        .returning();

      await publishEvent(tx, {
        clinicId,
        eventType: CLINICAL_EVENTS.PRONTUARIO_SIGNED,
        payload: {
          prontuarioId: pid,
          clinicId,
          patientId: row.patientId,
          signedBy: user.userId,
          signedAt: signedAt.toISOString(),
          needsReturn: data.needsReturn,
          returnDays,
        },
        idempotencyKey: `prontuario-signed:${pid}`,
        correlationId: ctx.correlationId ?? null,
      });

      return toProntuarioDetail(updated!);
    },
  );
}

// --- editSignedProntuario (correção pós-assinatura) ------------------------

export async function editSignedProntuario(
  id: string,
  contentInput: unknown,
  reason: string,
  idempotencyKey: string,
): Promise<ProntuarioDetail> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.SIGN_PRONTUARIO);
  const pid = uuid.parse(id);
  const data = EditSignedProntuarioSchema.parse({ content: contentInput, reason });
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  const before = await getProntuarioOrThrow(clinicId, pid);

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('edit_signed_prontuario', idempotencyKey),
        payload: jsonSafe({ id: pid, ...data }),
        ttlSeconds: IDEM_TTL,
      },
      audit: {
        action: EDIT_SIGNED_ACTION,
        resourceType: 'prontuario',
        resourceId: pid,
        before,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const [row] = await tx
        .select()
        .from(prontuarios)
        .where(eq(prontuarios.id, pid))
        .for('update')
        .limit(1);
      if (!row) throw new ProntuarioNotFoundError(pid);
      if (row.status !== 'assinado') {
        throw new ClinicalValidationError(
          'editSignedProntuario só se aplica a prontuário assinado.',
        );
      }

      // Regra 5: arquiva a revisão jurídica ATUAL antes de sobrescrever.
      await tx.insert(prontuarioVersions).values({
        clinicId,
        prontuarioId: pid,
        version: row.version,
        content: row.content,
        editedBy: user.userId,
        reason: data.reason,
      });

      // Ponto 1: bypass transação-local, janela mínima (liga → único UPDATE → desliga).
      await tx.execute(sql`SELECT set_config('app.allow_signed_edit', 'on', true)`);
      const [updated] = await tx
        .update(prontuarios)
        .set({
          content: data.content,
          version: row.version + 1,
          rowVersion: row.rowVersion + 1,
          updatedAt: sql`now()`,
        })
        .where(eq(prontuarios.id, pid))
        .returning();
      await tx.execute(sql`SELECT set_config('app.allow_signed_edit', 'off', true)`);

      return toProntuarioDetail(updated!);
    },
  );
}

// --- createPrescription ----------------------------------------------------

export async function createPrescription(
  input: CreatePrescriptionInput,
  idempotencyKey: string,
): Promise<{ id: string }> {
  const user = await requireUser();
  await requireCachedPermission(PERMISSIONS.CREATE_PRESCRIPTION);
  const data = CreatePrescriptionSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  // TX1: insert + audit. Snapshots resolvidos dentro do tx (RLS aplica).
  const created = await idempotentMutation(
    {
      idempotency: {
        key: idemKey('create_prescription', idempotencyKey),
        payload: jsonSafe(data),
        ttlSeconds: IDEM_TTL,
      },
      audit: {
        action: CLINICAL_EVENTS.PRESCRIPTION_CREATED,
        resourceType: 'prescription',
        resourceId: null,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const doctor = await resolveDoctorSnapshot(tx, user.userId);
      assertDoctorHasCrm(doctor); // R6: documento exige CRM
      const patientNome = await resolvePatientNome(tx, data.patientId);

      const [row] = await tx
        .insert(prescriptions)
        .values({
          clinicId,
          prontuarioId: data.prontuarioId ?? null,
          patientId: data.patientId,
          doctorId: user.userId,
          medicamentos: data.medicamentos,
          observacoes: data.observacoes ?? null,
          snapshotPatientNome: patientNome,
          snapshotDoctorNome: doctor.nome,
          snapshotDoctorCrm: doctor.crm,
          snapshotDoctorCrmUf: doctor.crmUf,
          snapshotDoctorEspecialidade: doctor.especialidade,
          createdBy: user.userId,
        })
        .returning({ id: prescriptions.id });
      return { id: row!.id };
    },
  );

  // Fase 2/3 fora da TX1: render + upload + (TX2) grava path + publica evento.
  await ensurePrescriptionPdf(clinicId, created.id, ctx.correlationId ?? null);
  return { id: created.id };
}

export async function regeneratePrescriptionPdf(id: string): Promise<{ id: string }> {
  await requireUser();
  await requireCachedPermission(PERMISSIONS.CREATE_PRESCRIPTION);
  const pid = uuid.parse(id);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  // Usa o snapshot persistido (R8/R11) — NÃO re-resolve médico nem checa CRM (P3).
  await ensurePrescriptionPdf(clinicId, pid, ctx.correlationId ?? null, true);
  return { id: pid };
}

// --- createMedicalDocument -------------------------------------------------

export async function createMedicalDocument(
  input: CreateMedicalDocumentInput,
  idempotencyKey: string,
): Promise<{ id: string }> {
  const user = await requireUser();
  await requireCachedPermission(PERMISSIONS.CREATE_PRESCRIPTION); // reuso documentado
  const data = CreateMedicalDocumentSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  const created = await idempotentMutation(
    {
      idempotency: {
        key: idemKey('create_medical_document', idempotencyKey),
        payload: jsonSafe(data),
        ttlSeconds: IDEM_TTL,
      },
      audit: {
        action: CLINICAL_EVENTS.DOCUMENT_GENERATED,
        resourceType: 'medical_document',
        resourceId: null,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const doctor = await resolveDoctorSnapshot(tx, user.userId);
      assertDoctorHasCrm(doctor);
      const patientNome = await resolvePatientNome(tx, data.patientId);

      const [row] = await tx
        .insert(medicalDocuments)
        .values({
          clinicId,
          patientId: data.patientId,
          doctorId: user.userId,
          type: data.type,
          content: data.content,
          snapshotPatientNome: patientNome,
          snapshotDoctorNome: doctor.nome,
          snapshotDoctorCrm: doctor.crm,
          snapshotDoctorCrmUf: doctor.crmUf,
          snapshotDoctorEspecialidade: doctor.especialidade,
          createdBy: user.userId,
        })
        .returning({ id: medicalDocuments.id });
      return { id: row!.id };
    },
  );

  await ensureMedicalDocumentPdf(clinicId, created.id, ctx.correlationId ?? null);
  return { id: created.id };
}

export async function regenerateDocumentPdf(id: string): Promise<{ id: string }> {
  await requireUser();
  await requireCachedPermission(PERMISSIONS.CREATE_PRESCRIPTION);
  const did = uuid.parse(id);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  await ensureMedicalDocumentPdf(clinicId, did, ctx.correlationId ?? null, true);
  return { id: did };
}
