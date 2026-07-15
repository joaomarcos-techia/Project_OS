'use server';

/**
 * Modelos de receita (Fase 2) — Server Actions. Pipeline congelado do C7:
 *   requireUser → requireCachedPermission(create:prescription) → Zod
 *   → idempotentMutation({idempotency, audit}, tx => …)
 *
 * Invariantes:
 *   - PESSOAL por médico: todo WHERE inclui doctor_id = user.userId (G4). RLS
 *     isola por clínica; o doctor_id isola por prescritor dentro da clínica.
 *   - Reusa a permissão create:prescription (quem prescreve gerencia os modelos).
 *   - NUNCA emite: nenhuma action aqui toca `prescriptions` nem publica evento.
 *   - Hard delete (modelo é gabarito, não documento legal); a exclusão é auditada.
 *   - Audit actions são strings planas (sem evento no outbox — sem consumidor).
 */
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { PERMISSIONS } from '@/lib/auth/permissions';
import {
  requireCachedPermission,
  requireClinicId,
  requireUser,
} from '@/lib/auth/tenant-context';
import type { Tx } from '@/lib/db';
import { idempotentMutation } from '@/lib/idempotency/mutation';
import { MUTATION_IDEM_TTL_SECONDS } from '@/lib/idempotency/ttl';
import { isUniqueViolation } from '@/lib/outbox/errors';

import {
  PrescriptionTemplateConflictError,
  PrescriptionTemplateLimitError,
  PrescriptionTemplateNotFoundError,
} from './errors';
import { idemKey, jsonSafe, requestContext } from './internal/action-helpers';
import {
  getPrescriptionTemplateById,
  listPrescriptionTemplates,
  toPrescriptionTemplateSummary,
} from './queries';
import { prescriptionTemplates } from './schema';
import {
  PrescriptionTemplateSchema,
  UpdatePrescriptionTemplateSchema,
  type PrescriptionTemplateInput,
  type PrescriptionTemplateSummary,
  type UpdatePrescriptionTemplateInput,
} from './types';

const uuid = z.string().uuid();

/** Higiene anti-abuso: teto de modelos por médico. */
const MAX_TEMPLATES_PER_DOCTOR = 200;
const NOME_MAX = 120;

const TEMPLATE_CREATED = 'clinical.prescription_template.created';
const TEMPLATE_UPDATED = 'clinical.prescription_template.updated';
const TEMPLATE_DELETED = 'clinical.prescription_template.deleted';

// --- listMyPrescriptionTemplates (read action p/ clientes — ex.: consultório) ---

/** Modelos do médico logado. Read action para client components (consultório). */
export async function listMyPrescriptionTemplates(): Promise<PrescriptionTemplateSummary[]> {
  const user = await requireUser();
  await requireCachedPermission(PERMISSIONS.CREATE_PRESCRIPTION);
  const clinicId = await requireClinicId();
  return listPrescriptionTemplates(clinicId, user.userId);
}

// --- createPrescriptionTemplate --------------------------------------------

export async function createPrescriptionTemplate(
  input: PrescriptionTemplateInput,
  idempotencyKey: string,
): Promise<PrescriptionTemplateSummary> {
  const user = await requireUser();
  await requireCachedPermission(PERMISSIONS.CREATE_PRESCRIPTION);
  const data = PrescriptionTemplateSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  try {
    return await idempotentMutation(
      {
        idempotency: {
          key: idemKey('create_prescription_template', idempotencyKey),
          payload: jsonSafe(data),
          ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
        },
        audit: {
          action: TEMPLATE_CREATED,
          resourceType: 'prescription_template',
          resourceId: null,
          before: null,
          requestContext: ctx,
        },
      },
      async (tx) => {
        await assertUnderLimit(tx, clinicId, user.userId);
        const [row] = await tx
          .insert(prescriptionTemplates)
          .values({
            clinicId,
            doctorId: user.userId,
            nome: data.nome,
            categoria: data.categoria ?? null,
            medicamentos: data.medicamentos,
            observacoes: data.observacoes ?? null,
            kind: data.kind,
            createdBy: user.userId,
          })
          .returning();
        return toPrescriptionTemplateSummary(row!);
      },
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw new PrescriptionTemplateConflictError();
    throw err;
  }
}

// --- updatePrescriptionTemplate --------------------------------------------

export async function updatePrescriptionTemplate(
  id: string,
  input: UpdatePrescriptionTemplateInput,
  idempotencyKey: string,
): Promise<PrescriptionTemplateSummary> {
  const user = await requireUser();
  await requireCachedPermission(PERMISSIONS.CREATE_PRESCRIPTION);
  const tid = uuid.parse(id);
  const data = UpdatePrescriptionTemplateSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  const before = await getPrescriptionTemplateById(clinicId, user.userId, tid);
  if (!before) throw new PrescriptionTemplateNotFoundError(tid);

  try {
    return await idempotentMutation(
      {
        idempotency: {
          key: idemKey('update_prescription_template', idempotencyKey),
          payload: jsonSafe({ id: tid, ...data }),
          ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
        },
        audit: {
          action: TEMPLATE_UPDATED,
          resourceType: 'prescription_template',
          resourceId: tid,
          before,
          requestContext: ctx,
        },
      },
      async (tx) => {
        const [row] = await tx
          .update(prescriptionTemplates)
          .set({
            nome: data.nome,
            categoria: data.categoria ?? null,
            medicamentos: data.medicamentos,
            observacoes: data.observacoes ?? null,
            kind: data.kind,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(prescriptionTemplates.id, tid),
              eq(prescriptionTemplates.clinicId, clinicId),
              eq(prescriptionTemplates.doctorId, user.userId),
            ),
          )
          .returning();
        if (!row) throw new PrescriptionTemplateNotFoundError(tid);
        return toPrescriptionTemplateSummary(row);
      },
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw new PrescriptionTemplateConflictError();
    throw err;
  }
}

// --- deletePrescriptionTemplate (hard delete + audit) ----------------------

export async function deletePrescriptionTemplate(
  id: string,
  idempotencyKey: string,
): Promise<{ id: string }> {
  const user = await requireUser();
  await requireCachedPermission(PERMISSIONS.CREATE_PRESCRIPTION);
  const tid = uuid.parse(id);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  const before = await getPrescriptionTemplateById(clinicId, user.userId, tid);
  if (!before) throw new PrescriptionTemplateNotFoundError(tid);

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('delete_prescription_template', idempotencyKey),
        payload: jsonSafe({ id: tid }),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: TEMPLATE_DELETED,
        resourceType: 'prescription_template',
        resourceId: tid,
        before,
        requestContext: ctx,
      },
    },
    async (tx) => {
      await tx
        .delete(prescriptionTemplates)
        .where(
          and(
            eq(prescriptionTemplates.id, tid),
            eq(prescriptionTemplates.clinicId, clinicId),
            eq(prescriptionTemplates.doctorId, user.userId),
          ),
        );
      return { id: tid };
    },
  );
}

// --- duplicatePrescriptionTemplate -----------------------------------------

export async function duplicatePrescriptionTemplate(
  id: string,
  idempotencyKey: string,
): Promise<PrescriptionTemplateSummary> {
  const user = await requireUser();
  await requireCachedPermission(PERMISSIONS.CREATE_PRESCRIPTION);
  const tid = uuid.parse(id);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  const src = await getPrescriptionTemplateById(clinicId, user.userId, tid);
  if (!src) throw new PrescriptionTemplateNotFoundError(tid);

  try {
    return await idempotentMutation(
      {
        idempotency: {
          key: idemKey('duplicate_prescription_template', idempotencyKey),
          payload: jsonSafe({ sourceId: tid }),
          ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
        },
        audit: {
          action: TEMPLATE_CREATED,
          resourceType: 'prescription_template',
          resourceId: null,
          before: null,
          requestContext: ctx,
        },
      },
      async (tx) => {
        await assertUnderLimit(tx, clinicId, user.userId);
        const nome = await resolveCopyName(tx, clinicId, user.userId, src.nome);
        const [row] = await tx
          .insert(prescriptionTemplates)
          .values({
            clinicId,
            doctorId: user.userId,
            nome,
            categoria: src.categoria,
            medicamentos: src.medicamentos,
            observacoes: src.observacoes,
            kind: src.kind,
            createdBy: user.userId,
          })
          .returning();
        return toPrescriptionTemplateSummary(row!);
      },
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw new PrescriptionTemplateConflictError();
    throw err;
  }
}

// --- helpers ---------------------------------------------------------------

async function assertUnderLimit(tx: Tx, clinicId: string, doctorId: string): Promise<void> {
  const [agg] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(prescriptionTemplates)
    .where(
      and(eq(prescriptionTemplates.clinicId, clinicId), eq(prescriptionTemplates.doctorId, doctorId)),
    );
  if ((agg?.n ?? 0) >= MAX_TEMPLATES_PER_DOCTOR) {
    throw new PrescriptionTemplateLimitError(MAX_TEMPLATES_PER_DOCTOR);
  }
}

/** Primeiro nome livre na forma "<base> (cópia)", "(cópia 2)", … (cap 120). */
async function resolveCopyName(
  tx: Tx,
  clinicId: string,
  doctorId: string,
  base: string,
): Promise<string> {
  const rows = await tx
    .select({ nome: prescriptionTemplates.nome })
    .from(prescriptionTemplates)
    .where(
      and(eq(prescriptionTemplates.clinicId, clinicId), eq(prescriptionTemplates.doctorId, doctorId)),
    );
  const taken = new Set(rows.map((r) => r.nome.trim().toLowerCase()));
  const cap = (s: string) => (s.length > NOME_MAX ? s.slice(0, NOME_MAX) : s);
  let candidate = cap(`${base} (cópia)`);
  if (!taken.has(candidate.toLowerCase())) return candidate;
  for (let i = 2; i < 100; i++) {
    candidate = cap(`${base} (cópia ${i})`);
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return cap(`${base} (cópia ${Date.now()})`);
}
