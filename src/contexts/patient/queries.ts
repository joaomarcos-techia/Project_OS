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
  suppressionList,
  type PatientRow,
} from './schema';
import type { DecryptedPatient, PatientSummary, ProactiveContact } from './types';

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
 * Card data (C8 Consultório): nome, alergias e demografia (idade/sexo) para um
 * lote de pacientes. NÃO decripta — `nome`, `data_nascimento` e `sexo` são
 * plaintext e `alergias` (jsonb) não é PII criptografado. Mesmo contexto
 * (patient), então o leftJoin com patient_clinical_data é legítimo.
 */
export interface PatientCard {
  id: string;
  nome: string;
  alergias: string[];
  /** data_nascimento (YYYY-MM-DD) — base da idade exibida no card (DS). */
  dataNascimento: string | null;
  /** sexo (M|F|O|N) — linha demográfica do card. */
  sexo: 'M' | 'F' | 'O' | 'N' | null;
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
        dataNascimento: patients.dataNascimento,
        sexo: patients.sexo,
        alergias: patientClinicalData.alergias,
      })
      .from(patients)
      .leftJoin(patientClinicalData, eq(patientClinicalData.patientId, patients.id))
      .where(and(inArray(patients.id, ids), patientsActiveFilter()));
    return rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      dataNascimento: r.dataNascimento ?? null,
      sexo: r.sexo ?? null,
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
 * C14 — contato p/ mensagem proativa. Decifra o telefone (mesmo ponto central
 * de decrypt) e agrega consent de cobrança + suppression numa leitura. NÃO é
 * usado em listas; é 1 read por job no send-time. Retorna null se o paciente
 * não existe / foi soft-deleted (RLS via withTenant garante o tenant).
 */
export async function getProactiveContact(
  clinicId: string,
  patientId: string,
): Promise<ProactiveContact | null> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select()
      .from(patients)
      .where(and(eq(patients.id, patientId), patientsActiveFilter()))
      .limit(1);
    if (!row) return null;

    const phone = row.telefoneEncrypted
      ? await decryptForTenant(clinicId, row.telefoneEncrypted)
      : null;

    // Consentimento mais recente (versao DESC) decide o opt-in vigente.
    const [consent] = await tx
      .select({
        cobrancaWhatsapp: patientConsents.cobrancaWhatsapp,
        revokedAt: patientConsents.revokedAt,
      })
      .from(patientConsents)
      .where(eq(patientConsents.patientId, patientId))
      .orderBy(desc(patientConsents.versao))
      .limit(1);

    // suppression_list.contact_hash é o MESMO HMAC de patients.telefone_hash.
    let suppressedWhatsapp = false;
    if (row.telefoneHash) {
      const [supp] = await tx
        .select({ id: suppressionList.id })
        .from(suppressionList)
        .where(
          and(
            eq(suppressionList.clinicId, clinicId),
            eq(suppressionList.contactHash, row.telefoneHash),
            eq(suppressionList.channel, 'whatsapp'),
          ),
        )
        .limit(1);
      suppressedWhatsapp = Boolean(supp);
    }

    return {
      nome: row.nome,
      phone,
      cobrancaWhatsapp: consent?.cobrancaWhatsapp ?? false,
      consentRevoked: consent?.revokedAt != null,
      suppressedWhatsapp,
    };
  });
}

/**
 * Escolhe o endereço a usar no documento: `principal` primeiro; senão o mais
 * recente (updatedAt desc). PURA (testável sem DB). Retorna null se vazio.
 */
export function pickPrincipalAddress<T extends { principal: boolean; updatedAt: Date | null }>(
  rows: T[],
): T | null {
  if (rows.length === 0) return null;
  return (
    rows.find((a) => a.principal) ??
    [...rows].sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0))[0]!
  );
}

/**
 * Formata o endereço (já decifrado) para o documento legal: PURA, testável.
 * `logradouro, complemento — cidade/UF — CEP` (omite partes vazias). null se tudo vazio.
 */
export function formatDocumentAddress(addr: {
  logradouro: string | null;
  complemento: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
}): string | null {
  const linha1 = [addr.logradouro?.trim() || null, addr.complemento?.trim() || null]
    .filter(Boolean)
    .join(', ');
  const cidadeUf = [addr.cidade?.trim() || null, addr.estado?.trim() || null]
    .filter(Boolean)
    .join('/');
  const cep = addr.cep?.trim();
  const parts = [linha1 || null, cidadeUf || null, cep ? `CEP ${cep}` : null].filter(Boolean);
  const formatted = parts.join(' — ').trim();
  return formatted.length > 0 ? formatted : null;
}

/**
 * Endereço formatado do paciente para documento legal (C7 — receituário de
 * controle especial). Ponto central de decrypt (espelha collectExportBundle):
 * escolhe o endereço `principal` (fallback: mais recente), decifra logradouro+cep
 * SERVER-SIDE (chave per-tenant, ADR-012) e devolve UMA string já formatada para
 * snapshot. NUNCA expõe ciphertext nem campos crus ao chamador. Retorna null
 * quando o paciente não tem endereço cadastrado (o PDF imprime linha em branco —
 * não bloqueia a emissão). RLS via withTenant garante o tenant.
 */
export async function getAddressForDocument(
  clinicId: string,
  patientId: string,
): Promise<string | null> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(patientAddresses)
      .where(eq(patientAddresses.patientId, patientId));
    const chosen = pickPrincipalAddress(rows);
    if (!chosen) return null;

    const logradouro = await decryptForTenant(clinicId, chosen.logradouroEncrypted);
    const cep = await decryptForTenant(clinicId, chosen.cepEncrypted);
    return formatDocumentAddress({
      logradouro,
      complemento: chosen.complemento,
      cidade: chosen.cidade,
      estado: chosen.estado,
      cep,
    });
  });
}

export interface PatientAddressFields {
  logradouro: string;
  complemento: string | null;
  cidade: string;
  estado: string;
  cep: string;
}

/**
 * Endereço principal DECIFRADO em campos estruturados — usado SÓ para pré-preencher
 * o form de edição (mesma postura de decrypt server-side de cpf/telefone no detalhe).
 * Diferente de getAddressForDocument (que devolve string formatada p/ snapshot).
 */
export async function getPrincipalAddress(
  clinicId: string,
  patientId: string,
): Promise<PatientAddressFields | null> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(patientAddresses)
      .where(eq(patientAddresses.patientId, patientId));
    const chosen = pickPrincipalAddress(rows);
    if (!chosen) return null;
    return {
      logradouro: await decryptForTenant(clinicId, chosen.logradouroEncrypted),
      complemento: chosen.complemento,
      cidade: chosen.cidade,
      estado: chosen.estado,
      cep: await decryptForTenant(clinicId, chosen.cepEncrypted),
    };
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
