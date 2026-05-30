'use server';

/**
 * Patient Server Actions (C5). Every mutation follows the frozen pipeline:
 *
 *   requireUser → requireFreshPermission → Zod-validate
 *   → idempotentMutation({ idempotency, audit }, async (tx) => {
 *       ...writes via tx...
 *       await publishEvent(tx, ...)   // SAME transaction
 *       return <non-sensitive result> // becomes audit.after + idempotency cache
 *     })
 *
 * idempotentMutation (C4) bundles the audit write and runs everything inside one
 * withTenant transaction — there is NO separate withIdempotency/auditedMutation
 * (spec §5.2 predates the merged C4 API; see ADR-012 deviation note).
 *
 * Encryption/hashing happen BEFORE the tx (pure compute). `*_encrypted` and
 * `*_hash` NEVER appear in audit before/after or event payloads — the fn
 * returns a PatientSummary projection only.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { headers } from 'next/headers';

import { buildRequestContext } from '@/lib/audit/request-context';
import { PERMISSIONS } from '@/lib/auth/permissions';
import {
  requireClinicId,
  requireFreshPermission,
  requireUser,
} from '@/lib/auth/tenant-context';
import {
  encryptForTenant,
  hashForLookup,
  normalizeCpf,
  normalizeEmail,
  normalizePhone,
  validateCpf,
} from '@/lib/crypto';
import type { Tx } from '@/lib/db';
import { idempotentMutation } from '@/lib/idempotency/mutation';
import { isUniqueViolation } from '@/lib/outbox/errors';
import { publishEvent } from '@/lib/outbox/publish';

import { PatientConflictError, PatientNotFoundError, PatientValidationError } from './errors';
import { PATIENT_EVENTS } from './events';
import { getPatientSummaryById, toPatientSummary } from './queries';
import {
  lgpdRequests,
  patientConsents,
  patients,
  suppressionList,
} from './schema';
import {
  ConsentInputSchema,
  ChannelSchema,
  ConsentTypeSchema,
  CreatePatientSchema,
  UpdatePatientSchema,
  type Channel,
  type ConsentInput,
  type ConsentType,
  type CreatePatientInput,
  type PatientSummary,
  type UpdatePatientInput,
} from './types';

// --- helpers ---------------------------------------------------------------

/**
 * Torna o payload JSON-safe para a idempotência: remove chaves `undefined`
 * (que o Zod mantém para campos opcionais em branco). assertJsonSafe (C4)
 * rejeita `undefined` — só aceita null/ausência. Determinístico: mesmo input
 * lógico → mesmo hash (dedup/409 continuam corretos).
 */
function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Build a CHECK-valid idempotency key: `patient:<action>:<hex>`. */
function idemKey(action: string, clientKey: string): string {
  const hex = clientKey.replace(/-/g, '').toLowerCase();
  if (!/^[a-f0-9]{8,}$/.test(hex)) {
    throw new PatientValidationError('idempotencyKey must be a UUID');
  }
  return `patient:${action}:${hex}`;
}

async function requestContext() {
  return buildRequestContext(await headers());
}

/** Compute the suppression contact hash for a channel from stored fields. */
async function contactHashFor(
  channel: Channel,
  telefoneHash: string | null,
  email: string,
): Promise<string> {
  if (channel === 'email') return hashForLookup(normalizeEmail(email));
  if (!telefoneHash) {
    throw new PatientValidationError(`cannot suppress ${channel}: patient has no phone`);
  }
  return telefoneHash;
}

/** Insert suppression rows for every channel reachable for this patient. */
async function suppressAllChannels(
  tx: Tx,
  clinicId: string,
  telefoneHash: string | null,
  email: string,
  reason: string,
): Promise<void> {
  const rows: { clinicId: string; contactHash: string; channel: Channel; reason: string }[] = [];
  if (telefoneHash) {
    rows.push({ clinicId, contactHash: telefoneHash, channel: 'whatsapp', reason });
    rows.push({ clinicId, contactHash: telefoneHash, channel: 'sms', reason });
  }
  rows.push({
    clinicId,
    contactHash: await hashForLookup(normalizeEmail(email)),
    channel: 'email',
    reason,
  });
  for (const r of rows) {
    await tx.insert(suppressionList).values(r).onConflictDoNothing();
  }
}

// --- createPatient ---------------------------------------------------------

export async function createPatient(
  input: CreatePatientInput,
  idempotencyKey: string,
): Promise<PatientSummary> {
  await requireUser();
  await requireFreshPermission(PERMISSIONS.CREATE_PATIENT);
  const data = CreatePatientSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  const cpfNorm = normalizeCpf(data.cpf);
  if (!validateCpf(cpfNorm)) throw new PatientValidationError('CPF inválido');
  const cpfHash = await hashForLookup(cpfNorm);
  const cpfEncrypted = await encryptForTenant(clinicId, cpfNorm);

  let telefoneHash: string | null = null;
  let telefoneEncrypted: string | null = null;
  if (data.telefone) {
    const phoneNorm = normalizePhone(data.telefone);
    telefoneHash = await hashForLookup(phoneNorm);
    telefoneEncrypted = await encryptForTenant(clinicId, phoneNorm);
  }
  const email = normalizeEmail(data.email);

  try {
    return await idempotentMutation(
      {
        idempotency: { key: idemKey('create', idempotencyKey), payload: jsonSafe(data), ttlSeconds: 604_800 },
        audit: {
          action: PATIENT_EVENTS.CREATED,
          resourceType: 'patient',
          resourceId: null,
          before: null,
          requestContext: ctx,
        },
      },
      async (tx) => {
        const [row] = await tx
          .insert(patients)
          .values({
            clinicId,
            nome: data.nome,
            cpfEncrypted,
            cpfHash,
            telefoneEncrypted,
            telefoneHash,
            email,
            dataNascimento: data.dataNascimento ?? null,
            sexo: data.sexo ?? null,
          })
          .returning();
        const summary = toPatientSummary(row!);
        await publishEvent(tx, {
          clinicId,
          eventType: PATIENT_EVENTS.CREATED,
          payload: { patientId: row!.id, clinicId, nome: row!.nome, cpfHash, telefoneHash, email },
          idempotencyKey: `${idempotencyKey}:created`,
        });
        return summary;
      },
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new PatientConflictError('CPF ou e-mail já cadastrado nesta clínica');
    }
    throw err;
  }
}

// --- updatePatient ---------------------------------------------------------

export async function updatePatient(
  id: string,
  input: UpdatePatientInput,
  idempotencyKey: string,
): Promise<PatientSummary> {
  await requireUser();
  await requireFreshPermission(PERMISSIONS.EDIT_PATIENT);
  const data = UpdatePatientSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  const before = await getPatientSummaryById(clinicId, id);
  if (!before) throw new PatientNotFoundError(id);

  // Precompute sensitive transformations outside the tx.
  const set: Record<string, unknown> = {};
  const changed: string[] = [];
  if (data.nome !== undefined) {
    set.nome = data.nome;
    changed.push('nome');
  }
  if (data.email !== undefined) {
    set.email = normalizeEmail(data.email);
    changed.push('email');
  }
  if (data.dataNascimento !== undefined) {
    set.dataNascimento = data.dataNascimento;
    changed.push('dataNascimento');
  }
  if (data.sexo !== undefined) {
    set.sexo = data.sexo;
    changed.push('sexo');
  }
  if (data.cpf !== undefined) {
    const cpfNorm = normalizeCpf(data.cpf);
    if (!validateCpf(cpfNorm)) throw new PatientValidationError('CPF inválido');
    set.cpfHash = await hashForLookup(cpfNorm);
    set.cpfEncrypted = await encryptForTenant(clinicId, cpfNorm);
    changed.push('cpf');
  }
  if (data.telefone !== undefined) {
    if (data.telefone === null) {
      set.telefoneHash = null;
      set.telefoneEncrypted = null;
    } else {
      const phoneNorm = normalizePhone(data.telefone);
      set.telefoneHash = await hashForLookup(phoneNorm);
      set.telefoneEncrypted = await encryptForTenant(clinicId, phoneNorm);
    }
    changed.push('telefone');
  }

  if (changed.length === 0) return before;

  try {
    return await idempotentMutation(
      {
        idempotency: { key: idemKey('update', idempotencyKey), payload: jsonSafe({ id, data }), ttlSeconds: 604_800 },
        audit: {
          action: PATIENT_EVENTS.UPDATED,
          resourceType: 'patient',
          resourceId: id,
          before,
          requestContext: ctx,
        },
      },
      async (tx) => {
        const [row] = await tx
          .update(patients)
          .set(set)
          .where(and(eq(patients.id, id), isNull(patients.deletedAt)))
          .returning();
        if (!row) throw new PatientNotFoundError(id);
        await publishEvent(tx, {
          clinicId,
          eventType: PATIENT_EVENTS.UPDATED,
          payload: { patientId: id, clinicId, changed },
          idempotencyKey: `${idempotencyKey}:updated`,
        });
        return toPatientSummary(row);
      },
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new PatientConflictError('CPF ou e-mail já cadastrado nesta clínica');
    }
    throw err;
  }
}

// --- deletePatient (soft) --------------------------------------------------

export async function deletePatient(
  id: string,
  idempotencyKey: string,
): Promise<{ patientId: string; soft: true }> {
  await requireUser();
  await requireFreshPermission(PERMISSIONS.DELETE_PATIENT);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  const before = await getPatientSummaryById(clinicId, id);
  if (!before) throw new PatientNotFoundError(id);

  return idempotentMutation(
    {
      idempotency: { key: idemKey('delete', idempotencyKey), payload: { id }, ttlSeconds: 604_800 },
      audit: {
        action: PATIENT_EVENTS.DELETED,
        resourceType: 'patient',
        resourceId: id,
        before,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const [row] = await tx
        .update(patients)
        .set({ deletedAt: sql`now()` })
        .where(and(eq(patients.id, id), isNull(patients.deletedAt)))
        .returning({ telefoneHash: patients.telefoneHash, email: patients.email });
      // Suppress contacts so a deleted patient can never be messaged (5.6.5).
      if (row) {
        await suppressAllChannels(tx, clinicId, row.telefoneHash, row.email, 'patient_deleted');
      }
      await publishEvent(tx, {
        clinicId,
        eventType: PATIENT_EVENTS.DELETED,
        payload: { patientId: id, clinicId, soft: true },
        idempotencyKey: `${idempotencyKey}:deleted`,
      });
      return { patientId: id, soft: true as const };
    },
  );
}

// --- recordConsent ---------------------------------------------------------

export async function recordConsent(
  patientId: string,
  consent: ConsentInput,
  idempotencyKey: string,
): Promise<{ patientId: string; versao: number }> {
  await requireUser();
  await requireFreshPermission(PERMISSIONS.EDIT_PATIENT);
  const data = ConsentInputSchema.parse(consent);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  const before = await getPatientSummaryById(clinicId, patientId);
  if (!before) throw new PatientNotFoundError(patientId);

  return idempotentMutation(
    {
      idempotency: { key: idemKey('consent_grant', idempotencyKey), payload: { patientId, data }, ttlSeconds: 604_800 },
      audit: {
        action: PATIENT_EVENTS.CONSENT_GRANTED,
        resourceType: 'patient',
        resourceId: patientId,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const aggRows = await tx
        .select({ maxVersao: sql<number>`coalesce(max(${patientConsents.versao}), 0)` })
        .from(patientConsents)
        .where(eq(patientConsents.patientId, patientId));
      const versao = Number(aggRows[0]?.maxVersao ?? 0) + 1;
      await tx.insert(patientConsents).values({
        patientId,
        clinicId,
        dadosSaude: data.dadosSaude,
        compartilhamento: data.compartilhamento,
        cobrancaWhatsapp: data.cobrancaWhatsapp,
        marketing: data.marketing,
        pesquisa: data.pesquisa,
        versao,
      });
      await publishEvent(tx, {
        clinicId,
        eventType: PATIENT_EVENTS.CONSENT_GRANTED,
        payload: {
          patientId,
          clinicId,
          versao,
          dadosSaude: data.dadosSaude,
          compartilhamento: data.compartilhamento,
          cobrancaWhatsapp: data.cobrancaWhatsapp,
          marketing: data.marketing,
          pesquisa: data.pesquisa,
        },
        idempotencyKey: `${idempotencyKey}:consent_granted`,
      });
      return { patientId, versao };
    },
  );
}

// --- revokeConsent ---------------------------------------------------------

export async function revokeConsent(
  patientId: string,
  type: ConsentType,
  idempotencyKey: string,
): Promise<{ patientId: string; consentType: ConsentType }> {
  await requireUser();
  await requireFreshPermission(PERMISSIONS.EDIT_PATIENT);
  const consentType = ConsentTypeSchema.parse(type);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  return idempotentMutation(
    {
      idempotency: { key: idemKey('consent_revoke', idempotencyKey), payload: { patientId, consentType }, ttlSeconds: 604_800 },
      audit: {
        action: PATIENT_EVENTS.CONSENT_REVOKED,
        resourceType: 'patient',
        resourceId: patientId,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      // Mark the latest still-active consent record as revoked.
      const [latest] = await tx
        .select({ id: patientConsents.id })
        .from(patientConsents)
        .where(and(eq(patientConsents.patientId, patientId), isNull(patientConsents.revokedAt)))
        .orderBy(sql`${patientConsents.versao} desc`)
        .limit(1);
      if (latest) {
        await tx
          .update(patientConsents)
          .set({ revokedAt: sql`now()` })
          .where(eq(patientConsents.id, latest.id));
      }
      await publishEvent(tx, {
        clinicId,
        eventType: PATIENT_EVENTS.CONSENT_REVOKED,
        payload: { patientId, clinicId, consentType },
        idempotencyKey: `${idempotencyKey}:consent_revoked`,
      });
      return { patientId, consentType };
    },
  );
}

// --- addToSuppressionList --------------------------------------------------

export async function addToSuppressionList(
  patientId: string,
  channel: Channel,
  reason: string,
  idempotencyKey: string,
): Promise<{ contactHash: string; channel: Channel }> {
  await requireUser();
  await requireFreshPermission(PERMISSIONS.EDIT_PATIENT);
  const ch = ChannelSchema.parse(channel);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  return idempotentMutation(
    {
      idempotency: { key: idemKey('suppress', idempotencyKey), payload: { patientId, ch, reason }, ttlSeconds: 604_800 },
      audit: {
        action: PATIENT_EVENTS.SUPPRESSION_ADDED,
        resourceType: 'patient',
        resourceId: patientId,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const [p] = await tx
        .select({ telefoneHash: patients.telefoneHash, email: patients.email })
        .from(patients)
        .where(eq(patients.id, patientId))
        .limit(1);
      if (!p) throw new PatientNotFoundError(patientId);
      const contactHash = await contactHashFor(ch, p.telefoneHash, p.email);
      await tx
        .insert(suppressionList)
        .values({ clinicId, contactHash, channel: ch, reason })
        .onConflictDoNothing();
      await publishEvent(tx, {
        clinicId,
        eventType: PATIENT_EVENTS.SUPPRESSION_ADDED,
        payload: { clinicId, contactHash, channel: ch, reason },
        idempotencyKey: `${idempotencyKey}:suppression_added`,
      });
      return { contactHash, channel: ch };
    },
  );
}

// --- requestLgpdExport -----------------------------------------------------

export async function requestLgpdExport(
  patientId: string,
  idempotencyKey: string,
): Promise<{ requestId: string }> {
  await requireUser();
  await requireFreshPermission(PERMISSIONS.VIEW_PATIENT);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  const before = await getPatientSummaryById(clinicId, patientId, { includeDeleted: true });
  if (!before) throw new PatientNotFoundError(patientId);

  return idempotentMutation(
    {
      idempotency: { key: idemKey('lgpd_export', idempotencyKey), payload: { patientId }, ttlSeconds: 604_800 },
      audit: {
        action: PATIENT_EVENTS.LGPD_EXPORT_REQUESTED,
        resourceType: 'lgpd_request',
        resourceId: patientId,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const [req] = await tx
        .insert(lgpdRequests)
        .values({ clinicId, patientId, type: 'export', status: 'pending' })
        .returning({ id: lgpdRequests.id });
      await publishEvent(tx, {
        clinicId,
        eventType: PATIENT_EVENTS.LGPD_EXPORT_REQUESTED,
        payload: { requestId: req!.id, patientId, clinicId },
        idempotencyKey: `${idempotencyKey}:lgpd_export`,
      });
      return { requestId: req!.id };
    },
  );
}

// --- requestLgpdDelete -----------------------------------------------------

export async function requestLgpdDelete(
  patientId: string,
  idempotencyKey: string,
): Promise<{ requestId: string }> {
  await requireUser();
  await requireFreshPermission(PERMISSIONS.DELETE_PATIENT);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  const before = await getPatientSummaryById(clinicId, patientId);
  if (!before) throw new PatientNotFoundError(patientId);

  return idempotentMutation(
    {
      idempotency: { key: idemKey('lgpd_delete', idempotencyKey), payload: { patientId }, ttlSeconds: 604_800 },
      audit: {
        action: PATIENT_EVENTS.LGPD_DELETE_REQUESTED,
        resourceType: 'lgpd_request',
        resourceId: patientId,
        before,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const [row] = await tx
        .update(patients)
        .set({ deletedAt: sql`now()` })
        .where(and(eq(patients.id, patientId), isNull(patients.deletedAt)))
        .returning({ telefoneHash: patients.telefoneHash, email: patients.email });
      if (row) {
        await suppressAllChannels(tx, clinicId, row.telefoneHash, row.email, 'lgpd_delete');
      }
      const [req] = await tx
        .insert(lgpdRequests)
        .values({ clinicId, patientId, type: 'delete', status: 'pending' })
        .returning({ id: lgpdRequests.id });
      await publishEvent(tx, {
        clinicId,
        eventType: PATIENT_EVENTS.LGPD_DELETE_REQUESTED,
        payload: { requestId: req!.id, patientId, clinicId },
        idempotencyKey: `${idempotencyKey}:lgpd_delete`,
      });
      return { requestId: req!.id };
    },
  );
}
