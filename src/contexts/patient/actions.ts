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
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireFreshPermission, requireUser } from '@/lib/auth/tenant-context';
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
import { MUTATION_IDEM_TTL_SECONDS } from '@/lib/idempotency/ttl';
import { isUniqueViolation } from '@/lib/outbox/errors';
import { publishEvent } from '@/lib/outbox/publish';

import {
  PatientConflictError,
  PatientNotFoundError,
  PatientValidationError,
  StaleWriteError,
} from './errors';
import { PATIENT_EVENTS } from './events';
import { getPatientSummaryById, hasLegalGuardian, toPatientSummary } from './queries';
import {
  lgpdRequests,
  patientAddresses,
  patientClinicalData,
  patientConsents,
  patientConsentDecisions,
  patientEmergencyContacts,
  patientMerges,
  patientRelationships,
  patients,
  suppressionList,
} from './schema';
import {
  ConsentInputSchema,
  ChannelSchema,
  ConsentTypeSchema,
  LinkPatientRelationshipSchema,
  MergePatientsSchema,
  RecordPatientDeathSchema,
  LgpdNotificationChannelSchema,
  LgpdOperationalReasonSchema,
  LgpdRequestIdSchema,
  UpdatePatientSchema,
  type Channel,
  type ConsentInput,
  type ConsentType,
  type CreatePatientInput,
  type LinkPatientRelationshipInput,
  type MergePatientsInput,
  type PatientSummary,
  type RecordPatientDeathInput,
  type UpdatePatientInput,
} from './types';
import { canNotifyLgpdRequester, canProcessLgpdRequest } from './lgpd-policy';
import { currentIsoDate, isMinorOnDate } from './minor-policy';
import { idemKey, jsonSafe, requestContext } from './internal/action-helpers';
import { createPatientCore } from './internal/patient-core';

// --- helpers ---------------------------------------------------------------

/** Compute the suppression contact hash for a channel from stored fields. */
async function contactHashFor(
  channel: Channel,
  telefoneHash: string | null,
  email: string | null,
): Promise<string> {
  if (channel === 'email') {
    // C12: paciente do agente pode não ter e-mail — não há o que suprimir.
    if (!email) throw new PatientValidationError('cannot suppress email: patient has no email');
    return hashForLookup(normalizeEmail(email));
  }
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
  email: string | null,
  reason: string,
): Promise<void> {
  const rows: {
    clinicId: string;
    contactHash: string;
    channel: Channel;
    purpose: 'all';
    reason: string;
  }[] = [];
  if (telefoneHash) {
    rows.push({ clinicId, contactHash: telefoneHash, channel: 'whatsapp', purpose: 'all', reason });
    rows.push({ clinicId, contactHash: telefoneHash, channel: 'sms', purpose: 'all', reason });
  }
  // C12: só suprime e-mail se houver e-mail (paciente do agente pode não ter).
  if (email) {
    rows.push({
      clinicId,
      contactHash: await hashForLookup(normalizeEmail(email)),
      channel: 'email',
      purpose: 'all',
      reason,
    });
  }
  for (const r of rows) {
    await tx.insert(suppressionList).values(r).onConflictDoNothing();
  }
}

const CONSENT_DECISIONS = [
  { purpose: 'dados_saude', field: 'dadosSaude', channel: null },
  { purpose: 'compartilhamento', field: 'compartilhamento', channel: null },
  { purpose: 'cobranca_whatsapp', field: 'cobrancaWhatsapp', channel: 'whatsapp' },
  { purpose: 'marketing', field: 'marketing', channel: 'whatsapp' },
  { purpose: 'pesquisa', field: 'pesquisa', channel: null },
] as const;

async function appendConsentDecision(
  tx: Tx,
  input: {
    clinicId: string;
    patientId: string;
    purpose: ConsentType;
    channel: Channel | null;
    granted: boolean;
    recordedBy: string;
  },
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.patientId}:${input.purpose}:${input.channel ?? 'none'}`}, 0))`,
  );
  const [current] = await tx
    .select({ maxVersion: sql<number>`coalesce(max(${patientConsentDecisions.version}), 0)` })
    .from(patientConsentDecisions)
    .where(
      and(
        eq(patientConsentDecisions.clinicId, input.clinicId),
        eq(patientConsentDecisions.patientId, input.patientId),
        eq(patientConsentDecisions.purpose, input.purpose),
        input.channel
          ? eq(patientConsentDecisions.channel, input.channel)
          : sql`${patientConsentDecisions.channel} IS NULL`,
      ),
    );
  await tx.insert(patientConsentDecisions).values({
    clinicId: input.clinicId,
    patientId: input.patientId,
    purpose: input.purpose,
    channel: input.channel,
    granted: input.granted,
    version: Number(current?.maxVersion ?? 0) + 1,
    recordedBy: input.recordedBy,
  });
}

// --- createPatient ---------------------------------------------------------

export async function createPatient(
  input: CreatePatientInput,
  idempotencyKey: string,
): Promise<PatientSummary> {
  // HTTP-authz stays in the Server Action wrapper; the shared core does the
  // domain work (validation/crypto/idempotency/audit/event) for BOTH this path
  // and the AI agent (C12 — R5, single core, identical validation).
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.CREATE_PATIENT);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  return createPatientCore({ clinicId, userId: user.userId }, ctx, input, idempotencyKey);
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

  if (
    data.dataNascimento &&
    isMinorOnDate(data.dataNascimento, currentIsoDate()) &&
    !(await hasLegalGuardian(clinicId, id))
  ) {
    throw new PatientValidationError(
      'Paciente menor de idade exige um responsável legal antes de salvar.',
    );
  }

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

  // C7: endereço (upsert do principal). Cifra logradouro/cep FORA da TX.
  let addrEnc: {
    logradouroEncrypted: string;
    cepEncrypted: string;
    cidade: string;
    estado: string;
    complemento: string | null;
  } | null = null;
  if (data.endereco !== undefined) {
    addrEnc = {
      logradouroEncrypted: await encryptForTenant(clinicId, data.endereco.logradouro),
      cepEncrypted: await encryptForTenant(clinicId, data.endereco.cep),
      cidade: data.endereco.cidade,
      estado: data.endereco.estado,
      complemento: data.endereco.complemento ?? null,
    };
    changed.push('endereco');
  }

  if (changed.length === 0) return before;

  try {
    return await idempotentMutation(
      {
        idempotency: {
          key: idemKey('update', idempotencyKey),
          payload: jsonSafe({ id, data }),
          ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
        },
        audit: {
          action: PATIENT_EVENTS.UPDATED,
          resourceType: 'patient',
          resourceId: id,
          before,
          requestContext: ctx,
        },
      },
      async (tx) => {
        let summary = before;
        // Colunas do paciente só são atualizadas se houver mudança nelas (set
        // vazio = só o endereço mudou → não chamar update com SET vazio).
        if (Object.keys(set).length > 0) {
          const [row] = await tx
            .update(patients)
            .set(set)
            .where(
              and(
                eq(patients.id, id),
                eq(patients.clinicId, clinicId),
                isNull(patients.deletedAt),
                // DATA-002 — compare-and-swap. Sem isto o UPDATE casava por
                // `id + clinic_id` e o último commit vencia em silêncio: duas
                // edições simultâneas eram ambas aceitas, ambas auditadas, e o
                // perdedor recebia sucesso. Com a versão no WHERE, quem partiu
                // de um estado velho casa ZERO linhas.
                ...(data.expectedUpdatedAt
                  ? [eq(patients.updatedAt, new Date(data.expectedUpdatedAt))]
                  : []),
              ),
            )
            .returning();
          // Zero linhas com versão esperada = perdeu a corrida, não "sumiu".
          // Distinguir importa: a UI precisa mandar recarregar, não dizer que o
          // paciente não existe. O throw reverte a tx — sem audit/outbox de
          // sucesso para o perdedor.
          if (!row && data.expectedUpdatedAt) throw new StaleWriteError();
          if (!row) throw new PatientNotFoundError(id);
          summary = toPatientSummary(row);
        }
        // Upsert do endereço principal (atualiza o existente; senão insere).
        if (addrEnc) {
          const upd = await tx
            .update(patientAddresses)
            .set({ ...addrEnc, updatedAt: sql`now()` })
            .where(
              and(
                eq(patientAddresses.patientId, id),
                eq(patientAddresses.clinicId, clinicId),
                eq(patientAddresses.principal, true),
              ),
            )
            .returning({ id: patientAddresses.id });
          if (upd.length === 0) {
            await tx
              .insert(patientAddresses)
              .values({ patientId: id, clinicId, ...addrEnc, principal: true });
          }
        }
        await publishEvent(tx, {
          clinicId,
          eventType: PATIENT_EVENTS.UPDATED,
          payload: { patientId: id, clinicId, changed },
          idempotencyKey: `${idempotencyKey}:updated`,
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
      idempotency: {
        key: idemKey('delete', idempotencyKey),
        payload: { id },
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
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
        .where(
          and(eq(patients.id, id), eq(patients.clinicId, clinicId), isNull(patients.deletedAt)),
        )
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

// --- patient relationships ------------------------------------------------

export async function linkPatientRelationship(
  input: LinkPatientRelationshipInput,
  idempotencyKey: string,
): Promise<{ relationshipId: string }> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.EDIT_PATIENT);
  const data = LinkPatientRelationshipSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('relationship_link', idempotencyKey),
        payload: data,
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: PATIENT_EVENTS.RELATIONSHIP_LINKED,
        resourceType: 'patient_relationship',
        resourceId: data.dependentPatientId,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const linkedPatients = await tx
        .select({ id: patients.id })
        .from(patients)
        .where(
          and(
            eq(patients.clinicId, clinicId),
            inArray(patients.id, [data.responsiblePatientId, data.dependentPatientId]),
            isNull(patients.deletedAt),
          ),
        )
        .for('update');
      if (linkedPatients.length !== 2) {
        throw new PatientValidationError('Responsável e dependente devem estar ativos na clínica.');
      }

      const [relationship] = await tx
        .insert(patientRelationships)
        .values({ clinicId, ...data, createdBy: user.userId })
        .onConflictDoUpdate({
          target: [
            patientRelationships.responsiblePatientId,
            patientRelationships.dependentPatientId,
          ],
          set: {
            relationshipType: data.relationshipType,
            legalGuardian: data.legalGuardian,
            financialResponsible: data.financialResponsible,
            canManageAppointments: data.canManageAppointments,
          },
        })
        .returning({ id: patientRelationships.id });
      await publishEvent(tx, {
        clinicId,
        eventType: PATIENT_EVENTS.RELATIONSHIP_LINKED,
        payload: {
          clinicId,
          relationshipId: relationship!.id,
          responsiblePatientId: data.responsiblePatientId,
          dependentPatientId: data.dependentPatientId,
        },
        idempotencyKey: `${idempotencyKey}:relationship_linked`,
      });
      return { relationshipId: relationship!.id };
    },
  );
}

export async function unlinkPatientRelationship(
  relationshipId: string,
  idempotencyKey: string,
): Promise<{ relationshipId: string; removed: true }> {
  await requireUser();
  await requireFreshPermission(PERMISSIONS.EDIT_PATIENT);
  const parsedId = LgpdRequestIdSchema.parse(relationshipId);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('relationship_unlink', idempotencyKey),
        payload: { relationshipId: parsedId },
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: PATIENT_EVENTS.RELATIONSHIP_UNLINKED,
        resourceType: 'patient_relationship',
        resourceId: parsedId,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const [removed] = await tx
        .delete(patientRelationships)
        .where(
          and(eq(patientRelationships.id, parsedId), eq(patientRelationships.clinicId, clinicId)),
        )
        .returning({
          responsiblePatientId: patientRelationships.responsiblePatientId,
          dependentPatientId: patientRelationships.dependentPatientId,
        });
      if (!removed) throw new PatientNotFoundError(parsedId);
      await publishEvent(tx, {
        clinicId,
        eventType: PATIENT_EVENTS.RELATIONSHIP_UNLINKED,
        payload: { clinicId, relationshipId: parsedId, ...removed },
        idempotencyKey: `${idempotencyKey}:relationship_unlinked`,
      });
      return { relationshipId: parsedId, removed: true as const };
    },
  );
}

async function carryForwardMergedConsentDecisions(
  tx: Tx,
  clinicId: string,
  sourcePatientId: string,
  targetPatientId: string,
  recordedBy: string,
): Promise<number> {
  const decisions = await tx
    .select()
    .from(patientConsentDecisions)
    .where(
      and(
        eq(patientConsentDecisions.clinicId, clinicId),
        inArray(patientConsentDecisions.patientId, [sourcePatientId, targetPatientId]),
      ),
    )
    .orderBy(desc(patientConsentDecisions.recordedAt), desc(patientConsentDecisions.version));
  const latest = new Map<string, (typeof decisions)[number]>();
  for (const decision of decisions) {
    const key = `${decision.patientId}:${decision.purpose}:${decision.channel ?? 'none'}`;
    if (!latest.has(key)) latest.set(key, decision);
  }
  const byPurpose = new Map<
    string,
    { purpose: ConsentType; channel: Channel | null; grants: boolean[] }
  >();
  for (const decision of latest.values()) {
    const key = `${decision.purpose}:${decision.channel ?? 'none'}`;
    const aggregate = byPurpose.get(key) ?? {
      purpose: decision.purpose,
      channel: decision.channel,
      grants: [],
    };
    aggregate.grants.push(decision.granted);
    byPurpose.set(key, aggregate);
  }
  for (const decision of byPurpose.values()) {
    await appendConsentDecision(tx, {
      clinicId,
      patientId: targetPatientId,
      purpose: decision.purpose,
      channel: decision.channel,
      granted: decision.grants.every(Boolean),
      recordedBy,
    });
  }
  return byPurpose.size;
}

export async function mergePatients(
  input: MergePatientsInput,
  idempotencyKey: string,
): Promise<{ mergeId: string; sourcePatientId: string; targetPatientId: string }> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.DELETE_PATIENT);
  const data = MergePatientsSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  const before = await getPatientSummaryById(clinicId, data.sourcePatientId);
  if (!before) throw new PatientNotFoundError(data.sourcePatientId);

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('merge', idempotencyKey),
        payload: data,
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: PATIENT_EVENTS.MERGED,
        resourceType: 'patient',
        resourceId: data.sourcePatientId,
        before,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const lockedPatients = await tx
        .select()
        .from(patients)
        .where(
          and(
            eq(patients.clinicId, clinicId),
            inArray(patients.id, [data.sourcePatientId, data.targetPatientId]),
            isNull(patients.deletedAt),
          ),
        )
        .for('update');
      if (lockedPatients.length !== 2) {
        throw new PatientValidationError('Origem e destino devem estar ativos na mesma clínica.');
      }

      const appointmentConflicts = await tx.execute<{ id: string }>(sql`
        SELECT source.id
          FROM appointments source
          JOIN appointments target
            ON target.clinic_id = source.clinic_id
           AND target.patient_id = ${data.targetPatientId}
           AND target.scheduled_at = source.scheduled_at
           AND target.slot_occupies_instant = true
         WHERE source.clinic_id = ${clinicId}
           AND source.patient_id = ${data.sourcePatientId}
           AND source.slot_occupies_instant = true
         LIMIT 1
      `);
      if (appointmentConflicts.length > 0) {
        throw new PatientConflictError(
          'Os dois cadastros possuem consultas ativas no mesmo horário. Resolva a agenda antes do merge.',
        );
      }

      const clinicalDataRows = await tx
        .select({ patientId: patientClinicalData.patientId })
        .from(patientClinicalData)
        .where(
          and(
            eq(patientClinicalData.clinicId, clinicId),
            inArray(patientClinicalData.patientId, [data.sourcePatientId, data.targetPatientId]),
          ),
        );
      if (clinicalDataRows.length > 1) {
        throw new PatientConflictError(
          'Os dois cadastros possuem dados atuais de alergias/medicações. Consolide-os manualmente antes do merge.',
        );
      }

      const transferCounts: Record<string, number> = {};
      const count = (rows: ArrayLike<unknown>): number => rows.length;

      if (clinicalDataRows[0]?.patientId === data.sourcePatientId) {
        const rows = await tx
          .update(patientClinicalData)
          .set({ patientId: data.targetPatientId })
          .where(
            and(
              eq(patientClinicalData.clinicId, clinicId),
              eq(patientClinicalData.patientId, data.sourcePatientId),
            ),
          )
          .returning({ id: patientClinicalData.id });
        transferCounts.clinicalData = count(rows);
      }

      const [targetPrincipal] = await tx
        .select({ id: patientAddresses.id })
        .from(patientAddresses)
        .where(
          and(
            eq(patientAddresses.clinicId, clinicId),
            eq(patientAddresses.patientId, data.targetPatientId),
            eq(patientAddresses.principal, true),
          ),
        )
        .limit(1);
      if (targetPrincipal) {
        await tx
          .update(patientAddresses)
          .set({ principal: false })
          .where(
            and(
              eq(patientAddresses.clinicId, clinicId),
              eq(patientAddresses.patientId, data.sourcePatientId),
              eq(patientAddresses.principal, true),
            ),
          );
      }
      transferCounts.addresses = count(
        await tx
          .update(patientAddresses)
          .set({ patientId: data.targetPatientId })
          .where(
            and(
              eq(patientAddresses.clinicId, clinicId),
              eq(patientAddresses.patientId, data.sourcePatientId),
            ),
          )
          .returning({ id: patientAddresses.id }),
      );
      transferCounts.emergencyContacts = count(
        await tx
          .update(patientEmergencyContacts)
          .set({ patientId: data.targetPatientId })
          .where(
            and(
              eq(patientEmergencyContacts.clinicId, clinicId),
              eq(patientEmergencyContacts.patientId, data.sourcePatientId),
            ),
          )
          .returning({ id: patientEmergencyContacts.id }),
      );

      const relationshipRows = await tx.execute<{ id: string }>(sql`
        INSERT INTO patient_relationships (
          clinic_id, responsible_patient_id, dependent_patient_id, relationship_type,
          legal_guardian, financial_responsible, can_manage_appointments, created_by
        )
        SELECT clinic_id,
               CASE WHEN responsible_patient_id = ${data.sourcePatientId}
                    THEN ${data.targetPatientId} ELSE responsible_patient_id END,
               CASE WHEN dependent_patient_id = ${data.sourcePatientId}
                    THEN ${data.targetPatientId} ELSE dependent_patient_id END,
               relationship_type, legal_guardian, financial_responsible,
               can_manage_appointments, created_by
          FROM patient_relationships
         WHERE clinic_id = ${clinicId}
           AND (responsible_patient_id = ${data.sourcePatientId}
                OR dependent_patient_id = ${data.sourcePatientId})
           AND (CASE WHEN responsible_patient_id = ${data.sourcePatientId}
                     THEN ${data.targetPatientId} ELSE responsible_patient_id END)
               <> (CASE WHEN dependent_patient_id = ${data.sourcePatientId}
                        THEN ${data.targetPatientId} ELSE dependent_patient_id END)
        ON CONFLICT (responsible_patient_id, dependent_patient_id) DO UPDATE SET
          legal_guardian = patient_relationships.legal_guardian OR excluded.legal_guardian,
          financial_responsible = patient_relationships.financial_responsible OR excluded.financial_responsible,
          can_manage_appointments = patient_relationships.can_manage_appointments OR excluded.can_manage_appointments
        RETURNING id
      `);
      transferCounts.relationships = count(relationshipRows);
      await tx
        .delete(patientRelationships)
        .where(
          and(
            eq(patientRelationships.clinicId, clinicId),
            sql`(${patientRelationships.responsiblePatientId} = ${data.sourcePatientId} OR ${patientRelationships.dependentPatientId} = ${data.sourcePatientId})`,
          ),
        );

      transferCounts.consentDecisions = await carryForwardMergedConsentDecisions(
        tx,
        clinicId,
        data.sourcePatientId,
        data.targetPatientId,
        user.userId,
      );

      const transfer = async (statement: ReturnType<typeof sql>): Promise<number> =>
        count(await tx.execute<{ id: string }>(statement));
      transferCounts.appointments = await transfer(sql`
        UPDATE appointments SET patient_id = ${data.targetPatientId}
         WHERE clinic_id = ${clinicId} AND patient_id = ${data.sourcePatientId} RETURNING id
      `);
      transferCounts.recurrenceSeries = await transfer(sql`
        UPDATE recurrence_series SET patient_id = ${data.targetPatientId}
         WHERE clinic_id = ${clinicId} AND patient_id = ${data.sourcePatientId} RETURNING id
      `);
      transferCounts.waitlist = await transfer(sql`
        UPDATE waitlist_entries SET patient_id = ${data.targetPatientId}
         WHERE clinic_id = ${clinicId} AND patient_id = ${data.sourcePatientId} RETURNING id
      `);
      transferCounts.financialEntries = await transfer(sql`
        UPDATE lancamentos SET patient_id = ${data.targetPatientId}
         WHERE clinic_id = ${clinicId} AND patient_id = ${data.sourcePatientId} RETURNING id
      `);
      transferCounts.conversations = await transfer(sql`
        UPDATE ai_conversations SET patient_id = ${data.targetPatientId}
         WHERE clinic_id = ${clinicId} AND patient_id = ${data.sourcePatientId} RETURNING id
      `);
      transferCounts.lgpdRequests = await transfer(sql`
        UPDATE lgpd_requests SET patient_id = ${data.targetPatientId}
         WHERE clinic_id = ${clinicId} AND patient_id = ${data.sourcePatientId} RETURNING id
      `);
      transferCounts.proactiveJobs = await transfer(sql`
        UPDATE ai_proactive_jobs
           SET payload = jsonb_set(payload, '{patientId}', to_jsonb(${data.targetPatientId}::text))
         WHERE clinic_id = ${clinicId}
           AND status IN ('pending', 'processing', 'failed')
           AND payload->>'patientId' = ${data.sourcePatientId}
        RETURNING id
      `);

      await tx.execute(sql`SELECT set_config('app.allow_patient_merge', 'on', true)`);
      transferCounts.medicalRecords = await transfer(sql`
        UPDATE prontuarios SET patient_id = ${data.targetPatientId}
         WHERE clinic_id = ${clinicId} AND patient_id = ${data.sourcePatientId} RETURNING id
      `);
      await tx.execute(sql`SELECT set_config('app.allow_patient_merge', 'off', true)`);
      transferCounts.prescriptions = await transfer(sql`
        UPDATE prescriptions SET patient_id = ${data.targetPatientId}
         WHERE clinic_id = ${clinicId} AND patient_id = ${data.sourcePatientId} RETURNING id
      `);
      transferCounts.medicalDocuments = await transfer(sql`
        UPDATE medical_documents SET patient_id = ${data.targetPatientId}
         WHERE clinic_id = ${clinicId} AND patient_id = ${data.sourcePatientId} RETURNING id
      `);

      const [merge] = await tx
        .insert(patientMerges)
        .values({
          clinicId,
          sourcePatientId: data.sourcePatientId,
          targetPatientId: data.targetPatientId,
          reason: data.reason,
          mergedBy: user.userId,
          transferCounts,
        })
        .returning({ id: patientMerges.id });
      await tx
        .update(patients)
        .set({
          mergedIntoPatientId: data.targetPatientId,
          mergedAt: sql`now()`,
          mergedBy: user.userId,
          deletedAt: sql`now()`,
        })
        .where(and(eq(patients.id, data.sourcePatientId), eq(patients.clinicId, clinicId)));

      await publishEvent(tx, {
        clinicId,
        eventType: PATIENT_EVENTS.MERGED,
        payload: {
          clinicId,
          sourcePatientId: data.sourcePatientId,
          targetPatientId: data.targetPatientId,
          mergeId: merge!.id,
        },
        idempotencyKey: `${idempotencyKey}:merged`,
      });
      return { mergeId: merge!.id, ...data };
    },
  );
}

// --- recordPatientDeath ---------------------------------------------------

export async function recordPatientDeath(
  patientId: string,
  input: RecordPatientDeathInput,
  idempotencyKey: string,
): Promise<{ patientId: string; deceasedAt: string; reason: string }> {
  await requireUser();
  await requireFreshPermission(PERMISSIONS.EDIT_PATIENT);
  const data = RecordPatientDeathSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  const before = await getPatientSummaryById(clinicId, patientId);
  if (!before) throw new PatientNotFoundError(patientId);

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('record_death', idempotencyKey),
        payload: { patientId, data },
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: PATIENT_EVENTS.DECEASED,
        resourceType: 'patient',
        resourceId: patientId,
        before,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const todayRows = await tx.execute<{ today: string }>(
        sql`SELECT (now() AT TIME ZONE timezone)::date::text AS today
              FROM clinics
             WHERE id = ${clinicId}
             LIMIT 1`,
      );
      if (!todayRows[0] || data.deceasedAt > todayRows[0].today) {
        throw new PatientValidationError('a data do falecimento nao pode estar no futuro');
      }
      const [row] = await tx
        .update(patients)
        .set({ obitoEm: data.deceasedAt, updatedAt: sql`now()` })
        .where(
          and(
            eq(patients.id, patientId),
            eq(patients.clinicId, clinicId),
            isNull(patients.deletedAt),
            isNull(patients.obitoEm),
          ),
        )
        .returning({ telefoneHash: patients.telefoneHash, email: patients.email });
      if (!row) {
        throw new PatientConflictError('falecimento ja registrado para este paciente');
      }

      await suppressAllChannels(tx, clinicId, row.telefoneHash, row.email, 'patient_deceased');
      await publishEvent(tx, {
        clinicId,
        eventType: PATIENT_EVENTS.DECEASED,
        payload: { patientId, clinicId, deceasedAt: data.deceasedAt },
        idempotencyKey: `${idempotencyKey}:patient_deceased`,
      });
      return {
        patientId,
        deceasedAt: data.deceasedAt,
        reason: data.reason,
      };
    },
  );
}

// --- recordConsent ---------------------------------------------------------

export async function recordConsent(
  patientId: string,
  consent: ConsentInput,
  idempotencyKey: string,
): Promise<{ patientId: string; versao: number }> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.EDIT_PATIENT);
  const data = ConsentInputSchema.parse(consent);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  const before = await getPatientSummaryById(clinicId, patientId);
  if (!before) throw new PatientNotFoundError(patientId);

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('consent_grant', idempotencyKey),
        payload: { patientId, data },
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
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
        .where(
          and(eq(patientConsents.patientId, patientId), eq(patientConsents.clinicId, clinicId)),
        );
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
      const [patient] = await tx
        .select({ telefoneHash: patients.telefoneHash })
        .from(patients)
        .where(and(eq(patients.id, patientId), eq(patients.clinicId, clinicId)))
        .limit(1);
      for (const decision of CONSENT_DECISIONS) {
        await appendConsentDecision(tx, {
          clinicId,
          patientId,
          purpose: decision.purpose,
          channel: decision.channel,
          granted: data[decision.field],
          recordedBy: user.userId,
        });
        if (
          patient?.telefoneHash &&
          data[decision.field] &&
          (decision.purpose === 'cobranca_whatsapp' || decision.purpose === 'marketing')
        ) {
          const purpose = decision.purpose === 'cobranca_whatsapp' ? 'billing' : 'marketing';
          await tx
            .delete(suppressionList)
            .where(
              and(
                eq(suppressionList.clinicId, clinicId),
                eq(suppressionList.contactHash, patient.telefoneHash),
                eq(suppressionList.channel, 'whatsapp'),
                eq(suppressionList.purpose, purpose),
                eq(suppressionList.reason, `consent_revoked:${decision.purpose}`),
              ),
            );
        }
      }
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
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.EDIT_PATIENT);
  const consentType = ConsentTypeSchema.parse(type);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('consent_revoke', idempotencyKey),
        payload: { patientId, consentType },
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: PATIENT_EVENTS.CONSENT_REVOKED,
        resourceType: 'patient',
        resourceId: patientId,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const definition = CONSENT_DECISIONS.find((decision) => decision.purpose === consentType)!;
      await appendConsentDecision(tx, {
        clinicId,
        patientId,
        purpose: consentType,
        channel: definition.channel,
        granted: false,
        recordedBy: user.userId,
      });

      if (consentType === 'cobranca_whatsapp' || consentType === 'marketing') {
        const [patient] = await tx
          .select({ telefoneHash: patients.telefoneHash })
          .from(patients)
          .where(and(eq(patients.id, patientId), eq(patients.clinicId, clinicId)))
          .limit(1);
        if (!patient) throw new PatientNotFoundError(patientId);
        if (patient.telefoneHash) {
          const purpose = consentType === 'cobranca_whatsapp' ? 'billing' : 'marketing';
          await tx
            .insert(suppressionList)
            .values({
              clinicId,
              contactHash: patient.telefoneHash,
              channel: 'whatsapp',
              purpose,
              reason: `consent_revoked:${consentType}`,
            })
            .onConflictDoNothing();
        }
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
      idempotency: {
        key: idemKey('suppress', idempotencyKey),
        payload: { patientId, ch, reason },
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
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
        .where(and(eq(patients.id, patientId), eq(patients.clinicId, clinicId)))
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
  // F-07: export de PII completo exige permissão DEDICADA (least-privilege),
  // não mais o view:patient mínimo. Bundles owner/gestor (migration 0013).
  await requireFreshPermission(PERMISSIONS.EXPORT_PATIENT);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  const before = await getPatientSummaryById(clinicId, patientId, { includeDeleted: true });
  if (!before) throw new PatientNotFoundError(patientId);

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('lgpd_export', idempotencyKey),
        payload: { patientId },
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
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
      idempotency: {
        key: idemKey('lgpd_delete', idempotencyKey),
        payload: { patientId },
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
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
        .where(
          and(
            eq(patients.id, patientId),
            eq(patients.clinicId, clinicId),
            isNull(patients.deletedAt),
          ),
        )
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
      // Canonical "patient removed" signal: LGPD delete IS a deletion, so it
      // emits patient.core.deleted too (same event as deletePatient). Lets
      // downstream consumers (C6 Scheduling cancels future appointments — the
      // outbox registry is one-handler-per-event, so they react to THIS, not to
      // the LGPD-specific event which patient's own safety-net handler owns).
      await publishEvent(tx, {
        clinicId,
        eventType: PATIENT_EVENTS.DELETED,
        payload: { patientId, clinicId, soft: true },
        idempotencyKey: `${idempotencyKey}:deleted`,
      });
      return { requestId: req!.id };
    },
  );
}

// --- LGPD operational workflow -------------------------------------------

export async function processLgpdRequest(
  requestIdInput: string,
  reasonInput: string,
  idempotencyKey: string,
): Promise<{ requestId: string; status: 'processing' }> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.EXPORT_PATIENT);
  const requestId = LgpdRequestIdSchema.parse(requestIdInput);
  const reason = LgpdOperationalReasonSchema.parse(reasonInput);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('lgpd_process', idempotencyKey),
        payload: { requestId, reason },
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: 'patient.lgpd.processing_started',
        resourceType: 'lgpd_request',
        resourceId: requestId,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const [request] = await tx
        .select()
        .from(lgpdRequests)
        .where(and(eq(lgpdRequests.id, requestId), eq(lgpdRequests.clinicId, clinicId)))
        .for('update')
        .limit(1);
      if (!request) throw new PatientNotFoundError(requestId);
      if (!canProcessLgpdRequest(request.status)) {
        throw new PatientConflictError('pedido LGPD ja esta em processamento ou concluido');
      }

      await tx
        .update(lgpdRequests)
        .set({
          status: 'processing',
          startedAt: request.startedAt ?? sql`now()`,
          statusReason: reason,
          lastUpdatedByUserId: user.userId,
        })
        .where(and(eq(lgpdRequests.id, requestId), eq(lgpdRequests.clinicId, clinicId)));

      await publishEvent(tx, {
        clinicId,
        eventType:
          request.type === 'export'
            ? PATIENT_EVENTS.LGPD_EXPORT_REQUESTED
            : PATIENT_EVENTS.LGPD_DELETE_REQUESTED,
        payload: { requestId, patientId: request.patientId, clinicId },
        idempotencyKey: `${idempotencyKey}:lgpd_process`,
      });
      return { requestId, status: 'processing' as const };
    },
  );
}

export async function assignLgpdRequest(
  requestIdInput: string,
  assignedToUserIdInput: string,
  idempotencyKey: string,
): Promise<{ requestId: string; assignedToUserId: string }> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.EXPORT_PATIENT);
  const requestId = LgpdRequestIdSchema.parse(requestIdInput);
  const assignedToUserId = LgpdRequestIdSchema.parse(assignedToUserIdInput);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('lgpd_assign', idempotencyKey),
        payload: { requestId, assignedToUserId },
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: 'patient.lgpd.assigned',
        resourceType: 'lgpd_request',
        resourceId: requestId,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const [updated] = await tx
        .update(lgpdRequests)
        .set({ assignedToUserId, lastUpdatedByUserId: user.userId })
        .where(and(eq(lgpdRequests.id, requestId), eq(lgpdRequests.clinicId, clinicId)))
        .returning({ id: lgpdRequests.id });
      if (!updated) throw new PatientNotFoundError(requestId);
      return { requestId, assignedToUserId };
    },
  );
}

export async function markLgpdRequesterNotified(
  requestIdInput: string,
  channelInput: string,
  noteInput: string,
  idempotencyKey: string,
): Promise<{ requestId: string; notified: true }> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.EXPORT_PATIENT);
  const requestId = LgpdRequestIdSchema.parse(requestIdInput);
  const channel = LgpdNotificationChannelSchema.parse(channelInput);
  const note = LgpdOperationalReasonSchema.parse(noteInput);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('lgpd_notify', idempotencyKey),
        payload: { requestId, channel, note },
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: 'patient.lgpd.requester_notified',
        resourceType: 'lgpd_request',
        resourceId: requestId,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const [request] = await tx
        .select({ status: lgpdRequests.status })
        .from(lgpdRequests)
        .where(and(eq(lgpdRequests.id, requestId), eq(lgpdRequests.clinicId, clinicId)))
        .for('update')
        .limit(1);
      if (!request) throw new PatientNotFoundError(requestId);
      if (!canNotifyLgpdRequester(request.status)) {
        throw new PatientConflictError('inicie o tratamento antes de notificar o titular');
      }
      await tx
        .update(lgpdRequests)
        .set({
          requesterNotifiedAt: sql`now()`,
          requesterNotificationChannel: channel,
          statusReason: note,
          lastUpdatedByUserId: user.userId,
        })
        .where(and(eq(lgpdRequests.id, requestId), eq(lgpdRequests.clinicId, clinicId)));
      return { requestId, notified: true as const };
    },
  );
}
