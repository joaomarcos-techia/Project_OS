/**
 * Patient read-side (C5). All reads are tenant-scoped via withTenant (sets the
 * `app.current_clinic` GUC so RLS resolves) and pass through the central
 * `patientsActiveFilter()` so the soft-delete guard is never forgotten.
 *
 * Decryption lives ONLY here (5.7 checklist): getPatientWithDecryptedFields and
 * getPatientExportBundle are the sole call sites of decryptForTenant. Lists and
 * lookups NEVER decrypt — they return non-sensitive projections.
 *
 * Server-only.
 */
import 'server-only';

import { and, desc, eq, ilike, inArray, isNull, type SQL } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { decryptForTenant, hashForLookup, normalizeCpf, normalizePhone } from '@/lib/crypto';

import {
  patientAddresses,
  patientClinicalData,
  patientConsents,
  patientEmergencyContacts,
  patients,
  type PatientRow,
} from './schema';
import type { DecryptedPatient, PatientSummary } from './types';

/**
 * The single soft-delete guard. Every active-patient read composes this into
 * its WHERE. Centralizing it means "did we filter deleted_at?" has one answer.
 */
export function patientsActiveFilter(): SQL {
  return isNull(patients.deletedAt) as SQL;
}

const toIso = (v: Date | string | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : v;

/** Non-sensitive projection — safe for lists, events and audit. */
export function toPatientSummary(row: PatientRow): PatientSummary {
  return {
    id: row.id,
    clinicId: row.clinicId,
    nome: row.nome,
    email: row.email,
    dataNascimento: row.dataNascimento ?? null,
    sexo: row.sexo ?? null,
    obitoEm: row.obitoEm ?? null,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
    deletedAt: toIso(row.deletedAt),
  };
}

/** Non-decrypting fetch by id (audit `before`, existence checks). */
export async function getPatientSummaryById(
  clinicId: string,
  id: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<PatientSummary | null> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx.select().from(patients).where(eq(patients.id, id)).limit(1);
    if (!row) return null;
    if (!opts.includeDeleted && row.deletedAt) return null;
    return toPatientSummary(row);
  });
}

export interface ListPatientsOpts {
  search?: string;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

/** Paginated list. No decryption — name/email only (5.13: lists never decrypt). */
export async function listPatients(
  clinicId: string,
  opts: ListPatientsOpts = {},
): Promise<PatientSummary[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const conds: SQL[] = [];
  if (!opts.includeDeleted) conds.push(patientsActiveFilter());
  // F-12: bound the search term (trim + cap 64 chars). The value is parameterized
  // by Drizzle (no SQL injection) and the GIN trigram index serves `%term%`, but
  // an unbounded string is needless DoS surface. Empty-after-trim → no filter.
  if (opts.search) {
    const term = opts.search.trim().slice(0, 64);
    if (term) conds.push(ilike(patients.nome, `%${term}%`) as SQL);
  }

  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(patients)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(patients.updatedAt))
      .limit(limit)
      .offset(offset);
    return rows.map(toPatientSummary);
  });
}

/**
 * Card data (C8 Consultório): nome + alergias para um lote de pacientes. NÃO
 * decripta — `nome` é plaintext e `alergias` (jsonb) não é PII criptografado.
 * Mesmo contexto (patient), então o leftJoin com patient_clinical_data é legítimo.
 */
export interface PatientCard {
  id: string;
  nome: string;
  alergias: string[];
}

export async function listPatientCards(
  clinicId: string,
  ids: string[],
): Promise<PatientCard[]> {
  if (ids.length === 0) return [];
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select({
        id: patients.id,
        nome: patients.nome,
        alergias: patientClinicalData.alergias,
      })
      .from(patients)
      .leftJoin(patientClinicalData, eq(patientClinicalData.patientId, patients.id))
      .where(and(inArray(patients.id, ids), patientsActiveFilter()));
    return rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      alergias: Array.isArray(r.alergias) ? (r.alergias as string[]) : [],
    }));
  });
}

/** Lookup by CPF via the HMAC hash (never LIKE on ciphertext). */
export async function findPatientByCpf(
  clinicId: string,
  cpf: string,
): Promise<PatientSummary | null> {
  const cpfHash = await hashForLookup(normalizeCpf(cpf));
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select()
      .from(patients)
      .where(and(eq(patients.cpfHash, cpfHash), patientsActiveFilter()))
      .limit(1);
    return row ? toPatientSummary(row) : null;
  });
}

/** Lookup by phone via the HMAC hash. */
export async function findPatientByPhone(
  clinicId: string,
  phone: string,
): Promise<PatientSummary | null> {
  const telefoneHash = await hashForLookup(normalizePhone(phone));
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select()
      .from(patients)
      .where(and(eq(patients.telefoneHash, telefoneHash), patientsActiveFilter()))
      .limit(1);
    return row ? toPatientSummary(row) : null;
  });
}

/**
 * THE decryption point for patient detail. Decrypts cpf + telefone only.
 * RLS (via withTenant) guarantees the row belongs to `clinicId`; the AES-GCM
 * key is derived from the same clinicId, so a cross-tenant attempt can neither
 * read the row (RLS) nor decrypt it (auth tag). Returns null if not found.
 */
export async function getPatientWithDecryptedFields(
  clinicId: string,
  id: string,
): Promise<DecryptedPatient | null> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx.select().from(patients).where(eq(patients.id, id)).limit(1);
    if (!row) return null;
    const cpf = await decryptForTenant(clinicId, row.cpfEncrypted);
    const telefone = row.telefoneEncrypted
      ? await decryptForTenant(clinicId, row.telefoneEncrypted)
      : null;
    return { ...toPatientSummary(row), cpf, telefone };
  });
}

/** Decrypted, denormalized bundle for the LGPD export worker (also central). */
export interface PatientExportBundle {
  patient: DecryptedPatient;
  consents: Array<Record<string, unknown>>;
  clinicalData: Record<string, unknown> | null;
  addresses: Array<Record<string, unknown>>;
  emergencyContacts: Array<Record<string, unknown>>;
}

export async function getPatientExportBundle(
  clinicId: string,
  patientId: string,
): Promise<PatientExportBundle | null> {
  return withTenant(clinicId, (tx) => collectExportBundle(tx, clinicId, patientId));
}

/**
 * Same as getPatientExportBundle but uses a caller-provided tx. Used by the
 * LGPD export handler, which already runs inside the worker's withTenant tx
 * (nested withTenant is unsupported). Still the central decrypt point.
 */
export async function collectExportBundle(
  tx: Tx,
  clinicId: string,
  patientId: string,
): Promise<PatientExportBundle | null> {
  {
    const [row] = await tx.select().from(patients).where(eq(patients.id, patientId)).limit(1);
    if (!row) return null;

    const cpf = await decryptForTenant(clinicId, row.cpfEncrypted);
    const telefone = row.telefoneEncrypted
      ? await decryptForTenant(clinicId, row.telefoneEncrypted)
      : null;

    const consents = await tx
      .select()
      .from(patientConsents)
      .where(eq(patientConsents.patientId, patientId));

    const [clinical] = await tx
      .select()
      .from(patientClinicalData)
      .where(eq(patientClinicalData.patientId, patientId))
      .limit(1);

    const addrRows = await tx
      .select()
      .from(patientAddresses)
      .where(eq(patientAddresses.patientId, patientId));
    const addresses = await Promise.all(
      addrRows.map(async (a) => ({
        tipo: a.tipo,
        logradouro: await decryptForTenant(clinicId, a.logradouroEncrypted),
        cidade: a.cidade,
        estado: a.estado,
        cep: await decryptForTenant(clinicId, a.cepEncrypted),
        complemento: a.complemento,
        principal: a.principal,
      })),
    );

    const contactRows = await tx
      .select()
      .from(patientEmergencyContacts)
      .where(eq(patientEmergencyContacts.patientId, patientId));
    const emergencyContacts = await Promise.all(
      contactRows.map(async (c) => ({
        nome: c.nome,
        telefone: await decryptForTenant(clinicId, c.telefoneEncrypted),
        relacao: c.relacao,
      })),
    );

    return {
      patient: { ...toPatientSummary(row), cpf, telefone },
      consents: consents.map((c) => ({
        dadosSaude: c.dadosSaude,
        compartilhamento: c.compartilhamento,
        cobrancaWhatsapp: c.cobrancaWhatsapp,
        marketing: c.marketing,
        pesquisa: c.pesquisa,
        versao: c.versao,
        dataAceite: toIso(c.dataAceite),
        revokedAt: toIso(c.revokedAt),
      })),
      clinicalData: clinical
        ? {
            alergias: clinical.alergias,
            medicamentosEmUso: clinical.medicamentosEmUso,
            doencasCronicas: clinical.doencasCronicas,
            tipoSanguineo: clinical.tipoSanguineo,
            observacoes: clinical.observacoes,
          }
        : null,
      addresses,
      emergencyContacts,
    };
  }
}
