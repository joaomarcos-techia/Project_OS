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

import { and, desc, eq, ilike, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import {
  decryptForTenant,
  hashForLookup,
  normalizeCpf,
  phoneLookupHashes,
  validateCpf,
} from '@/lib/crypto';
import { redactCpf } from '@/lib/format';
import { maskPhoneBR } from '@/lib/masks';

import {
  patientAddresses,
  patientClinicalData,
  patientConsents,
  patientConsentDecisions,
  patientEmergencyContacts,
  patientRelationships,
  patients,
  lgpdRequestHistory,
  lgpdRequests,
  suppressionList,
  type PatientRow,
} from './schema';
import type {
  DecryptedPatient,
  PatientListItem,
  PatientListResult,
  PatientRelationshipDTO,
  PatientSummary,
  ProactiveContact,
} from './types';
import { isLgpdRequestOverdue } from './lgpd-policy';

/**
 * The single soft-delete guard. Every active-patient read composes this into
 * its WHERE. Centralizing it means "did we filter deleted_at?" has one answer.
 */
export function patientsActiveFilter(): SQL {
  return isNull(patients.deletedAt) as SQL;
}

const toIso = (v: Date | string | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : v;

type PatientSummaryRow = Pick<
  PatientRow,
  | 'id'
  | 'clinicId'
  | 'nome'
  | 'email'
  | 'dataNascimento'
  | 'sexo'
  | 'obitoEm'
  | 'mergedIntoPatientId'
  | 'createdAt'
  | 'updatedAt'
  | 'deletedAt'
>;

const patientSummaryColumns = {
  id: patients.id,
  clinicId: patients.clinicId,
  nome: patients.nome,
  email: patients.email,
  dataNascimento: patients.dataNascimento,
  sexo: patients.sexo,
  obitoEm: patients.obitoEm,
  mergedIntoPatientId: patients.mergedIntoPatientId,
  createdAt: patients.createdAt,
  updatedAt: patients.updatedAt,
  deletedAt: patients.deletedAt,
};

const patientListItemColumns = {
  id: patients.id,
  nome: patients.nome,
  email: patients.email,
  dataNascimento: patients.dataNascimento,
  cpfEncrypted: patients.cpfEncrypted,
  telefoneEncrypted: patients.telefoneEncrypted,
  deletedAt: patients.deletedAt,
};

/**
 * Decifra o CPF e devolve **só a máscara**. Falha de decifragem vira `null`, não
 * exceção: uma linha com ciphertext de chave antiga não pode derrubar a lista
 * inteira da clínica.
 */
async function maskedCpf(clinicId: string, ciphertext: string | null): Promise<string | null> {
  if (!ciphertext) return null;
  try {
    return redactCpf(await decryptForTenant(clinicId, ciphertext)) || null;
  } catch {
    return null;
  }
}

/**
 * Decifra e FORMATA o telefone. Diferente do CPF, não é redigido: a coluna
 * Contato existe para ser discada, e meio número não disca. Falha de decifragem
 * vira `null` pela mesma razão do CPF — uma linha ruim não derruba a lista.
 */
async function telefoneFormatado(
  clinicId: string,
  ciphertext: string | null,
): Promise<string | null> {
  if (!ciphertext) return null;
  try {
    return maskPhoneBR(await decryptForTenant(clinicId, ciphertext)) || null;
  } catch {
    return null;
  }
}

function toPatientListItem(
  row: {
    id: string;
    nome: string;
    email: string | null;
    dataNascimento: string | Date | null;
    deletedAt: Date | string | null;
  },
  cpfMascarado: string | null,
  telefone: string | null,
): PatientListItem {
  return {
    id: row.id,
    nome: row.nome,
    email: row.email,
    telefone,
    dataNascimento:
      row.dataNascimento instanceof Date
        ? row.dataNascimento.toISOString().slice(0, 10)
        : row.dataNascimento,
    cpfMascarado,
    deletedAt: toIso(row.deletedAt),
  };
}

/** Non-sensitive projection — safe for lists, events and audit. */
export function toPatientSummary(row: PatientSummaryRow): PatientSummary {
  return {
    id: row.id,
    clinicId: row.clinicId,
    nome: row.nome,
    email: row.email,
    dataNascimento: row.dataNascimento ?? null,
    sexo: row.sexo ?? null,
    obitoEm: row.obitoEm ?? null,
    mergedIntoPatientId: row.mergedIntoPatientId ?? null,
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
  /**
   * PAT-001 — SOMENTE os removidos (lixeira). `includeDeleted` traz ativos e
   * removidos juntos, o que não serve para a tela de recuperação: quem foi
   * desfazer um clique errado precisa ver exatamente o que sumiu.
   */
  onlyDeleted?: boolean;
  /**
   * UX-001 — remove pacientes com óbito registrado. Usado pelas buscas que
   * alimentam AGENDAMENTO (Agenda, lista de espera), onde o core recusa o
   * submit de qualquer forma. Não é default: o cadastro e a busca geral
   * precisam continuar mostrando o falecido.
   */
  excludeDeceased?: boolean;
  limit?: number;
  offset?: number;
}

export type ListPatientsPageOpts = Omit<ListPatientsOpts, 'limit' | 'offset'> & {
  page?: number;
};

const PATIENTS_PAGE_SIZE = 30;

function patientListConditions(clinicId: string, opts: ListPatientsOpts): SQL[] {
  // Defesa em profundidade: o predicado explícito acompanha o RLS configurado
  // por `withTenant`, evitando que a segurança dependa de uma única barreira.
  const conds: SQL[] = [eq(patients.clinicId, clinicId)];
  if (opts.onlyDeleted) {
    conds.push(sql`${patients.deletedAt} IS NOT NULL` as SQL);
    // Anonimizado é irrecuperável: mostrá-lo na lixeira ofereceria um botão
    // que sempre falha.
    conds.push(isNull(patients.anonymizedAt) as SQL);
  } else if (!opts.includeDeleted) {
    conds.push(patientsActiveFilter());
  }
  // UX-001 — candidatos de AGENDAMENTO não incluem falecidos. O core já recusa
  // no submit; isto evita oferecer um candidato inválido, sem substituir a guarda.
  if (opts.excludeDeceased) conds.push(isNull(patients.obitoEm) as SQL);

  // F-12: valor parametrizado, normalizado e limitado antes do ILIKE.
  const term = opts.search?.trim().slice(0, 64) ?? '';
  if (term) conds.push(ilike(patients.nome, `%${term}%`) as SQL);
  return conds;
}

/** Paginated list. No decryption — name/email only (5.13: lists never decrypt). */
export async function listPatients(
  clinicId: string,
  opts: ListPatientsOpts = {},
): Promise<PatientSummary[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const conds = patientListConditions(clinicId, opts);

  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select(patientSummaryColumns)
      .from(patients)
      .where(and(...conds))
      .orderBy(desc(patients.updatedAt), desc(patients.id))
      .limit(limit)
      .offset(offset);
    return rows.map(toPatientSummary);
  });
}

/**
 * Lista paginada para `/pacientes`. Itens e total usam exatamente os mesmos
 * filtros dentro do mesmo contexto de tenant.
 *
 * O CPF é a ÚNICA coluna cifrada lida aqui, por decisão do founder (2026-09-10):
 * a referência mostra o CPF mascarado sob o nome, e é como a recepção confere
 * identidade. A decifragem acontece neste servidor e o que sai é a máscara —
 * uma página tem no máximo `PATIENTS_PAGE_SIZE` linhas, então o custo é limitado
 * pela paginação, não pelo tamanho da base.
 */
export async function listPatientsPage(
  clinicId: string,
  opts: ListPatientsPageOpts = {},
): Promise<PatientListResult> {
  return withTenant(clinicId, (tx) => listPatientsPageTx(tx, clinicId, opts));
}

/**
 * A mesma leitura, recebendo a transação de fora.
 *
 * Existe porque abrir um `withTenant` NÃO é de graça: são BEGIN, SET LOCAL ROLE,
 * set_config e COMMIT antes de qualquer SELECT. Medido (2026-09-12, pooler
 * Supabase): um `withTenant` vazio custa 820 ms no link daqui, contra 162 ms de
 * um round trip adicional dentro dele. A página lia lista e vínculos em DOIS
 * wrappers em série e pagava esse preço duas vezes — daí a versão `Tx`.
 */
async function listPatientsPageTx(
  tx: Tx,
  clinicId: string,
  opts: ListPatientsPageOpts,
): Promise<PatientListResult> {
  const page =
    opts.page != null && Number.isSafeInteger(opts.page) && opts.page > 0 ? opts.page : 1;
  const offset = (page - 1) * PATIENTS_PAGE_SIZE;
  const where = and(...patientListConditions(clinicId, opts));

  // `Promise.all` aqui não sobrepõe execução — uma transação é UMA conexão, e o
  // Postgres atende um statement por vez. O que ele economiza é o round trip de
  // pipeline (medido: ~160 ms), então continua valendo; o que NÃO vale é supor
  // que duas queries na mesma transação custam o tempo de uma.
  const [rows, [countRow]] = await Promise.all([
    tx
      .select(patientListItemColumns)
      .from(patients)
      .where(where)
      .orderBy(desc(patients.updatedAt), desc(patients.id))
      .limit(PATIENTS_PAGE_SIZE)
      .offset(offset),
    tx
      .select({ total: sql<number>`count(*)::int` })
      .from(patients)
      .where(where),
  ]);

  const items = await Promise.all(
    rows.map(async (row) =>
      toPatientListItem(
        row,
        await maskedCpf(clinicId, row.cpfEncrypted),
        await telefoneFormatado(clinicId, row.telefoneEncrypted),
      ),
    ),
  );

  return {
    items,
    total: countRow?.total ?? 0,
    page,
    pageSize: PATIENTS_PAGE_SIZE,
  };
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

export async function listPatientCards(clinicId: string, ids: string[]): Promise<PatientCard[]> {
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

/** Lookup by phone via the HMAC hash, in every spelling of the same line. */
export async function findPatientByPhone(
  clinicId: string,
  phone: string,
): Promise<PatientSummary | null> {
  const telefoneHashes = await phoneLookupHashes(phone);
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(patients)
      .where(and(inArray(patients.telefoneHash, telefoneHashes), patientsActiveFilter()))
      .limit(2);
    // Telefone compartilhado não identifica uma pessoa de forma inequívoca.
    return rows.length === 1 ? toPatientSummary(rows[0]!) : null;
  });
}

export async function hasLegalGuardian(clinicId: string, patientId: string): Promise<boolean> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select({ id: patientRelationships.id })
      .from(patientRelationships)
      .where(
        and(
          eq(patientRelationships.clinicId, clinicId),
          eq(patientRelationships.dependentPatientId, patientId),
          eq(patientRelationships.legalGuardian, true),
        ),
      )
      .limit(1);
    return row != null;
  });
}

/** Vínculo resumido de um paciente na LISTA — nunca o grafo inteiro. */
export interface PatientBondSummary {
  /** Nome de quem responde por este paciente, quando ele é dependente. */
  responsavelNome: string | null;
  /** Quantos dependentes este paciente responde. */
  dependentes: number;
}

/**
 * Vínculos de um LOTE de pacientes, para a coluna "Vínculo" da lista.
 *
 * Existe separada de `listPatientRelationships` (que é por paciente e devolve o
 * DTO completo) porque a lista mostra até 20 linhas: chamar a versão unitária
 * por linha seriam 20 idas ao banco por render. Agora é UMA ida — o nome do
 * responsável vem no mesmo SELECT.
 */
export async function listPatientBonds(
  clinicId: string,
  patientIds: string[],
): Promise<Map<string, PatientBondSummary>> {
  if (patientIds.length === 0) return new Map();
  return withTenant(clinicId, (tx) => listPatientBondsTx(tx, clinicId, patientIds));
}

async function listPatientBondsTx(
  tx: Tx,
  clinicId: string,
  patientIds: string[],
): Promise<Map<string, PatientBondSummary>> {
  const out = new Map<string, PatientBondSummary>();
  if (patientIds.length === 0) return out;

  // Auto-join em `patients`: o nome do responsável saía de um SEGUNDO select que
  // só podia partir depois do primeiro voltar — um round trip inteiro para ler
  // uma coluna de uma tabela do próprio contexto. O alias é o que permite
  // referenciar `patients` como "o responsável desta linha".
  const responsavel = alias(patients, 'responsavel');
  const rows = await tx
    .select({
      responsiblePatientId: patientRelationships.responsiblePatientId,
      dependentPatientId: patientRelationships.dependentPatientId,
      responsavelNome: responsavel.nome,
    })
    .from(patientRelationships)
    // LEFT, não INNER: um vínculo cujo responsável sumiu ainda precisa contar
    // como dependente do outro lado. INNER apagaria a linha inteira.
    .leftJoin(
      responsavel,
      and(
        eq(responsavel.id, patientRelationships.responsiblePatientId),
        eq(responsavel.clinicId, clinicId),
      ),
    )
    .where(
      and(
        eq(patientRelationships.clinicId, clinicId),
        // `inArray`, não `= ANY(...)`: o drizzle interpola um array JS como
        // lista de parâmetros `($1,$2,$3)`, e o Postgres recusa isso à direita
        // de ANY ("requires array on right side").
        or(
          inArray(patientRelationships.responsiblePatientId, patientIds),
          inArray(patientRelationships.dependentPatientId, patientIds),
        ),
      ),
    );
  if (rows.length === 0) return out;

  const wanted = new Set(patientIds);
  for (const row of rows) {
    if (wanted.has(row.dependentPatientId)) {
      const bond = out.get(row.dependentPatientId) ?? { responsavelNome: null, dependentes: 0 };
      bond.responsavelNome ??= row.responsavelNome ?? null;
      out.set(row.dependentPatientId, bond);
    }
    if (wanted.has(row.responsiblePatientId)) {
      const bond = out.get(row.responsiblePatientId) ?? { responsavelNome: null, dependentes: 0 };
      bond.dependentes += 1;
      out.set(row.responsiblePatientId, bond);
    }
  }
  return out;
}

/** Resultado da lista com a coluna "Vínculo" já resolvida na mesma transação. */
export interface PatientListPageWithBonds extends PatientListResult {
  bonds: Map<string, PatientBondSummary>;
}

/**
 * Lista + vínculos numa transação só.
 *
 * Os vínculos DEPENDEM dos ids da página, então não há como sobrepor as duas
 * leituras — mas não há motivo para pagar DOIS `withTenant`. Medido daqui
 * (2026-09-12): a rota gastava 1.481 ms na lista e mais 1.491 ms nos vínculos,
 * dos quais ~820 ms eram só a abertura do segundo wrapper.
 */
export async function listPatientsPageWithBonds(
  clinicId: string,
  opts: ListPatientsPageOpts & { withBonds: boolean },
): Promise<PatientListPageWithBonds> {
  return withTenant(clinicId, async (tx) => {
    const result = await listPatientsPageTx(tx, clinicId, opts);
    const bonds = opts.withBonds
      ? await listPatientBondsTx(
          tx,
          clinicId,
          result.items.map((item) => item.id),
        )
      : new Map<string, PatientBondSummary>();
    return { ...result, bonds };
  });
}

export async function listPatientRelationships(
  clinicId: string,
  patientId: string,
): Promise<PatientRelationshipDTO[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(patientRelationships)
      .where(
        and(
          eq(patientRelationships.clinicId, clinicId),
          sql`(${patientRelationships.responsiblePatientId} = ${patientId} OR ${patientRelationships.dependentPatientId} = ${patientId})`,
        ),
      );
    const patientIds = [
      ...new Set(rows.flatMap((row) => [row.responsiblePatientId, row.dependentPatientId])),
    ];
    if (patientIds.length === 0) return [];
    const names = await tx
      .select({ id: patients.id, nome: patients.nome })
      .from(patients)
      .where(and(eq(patients.clinicId, clinicId), inArray(patients.id, patientIds)));
    const nameById = new Map(names.map((row) => [row.id, row.nome]));
    return rows.map((row) => ({
      id: row.id,
      responsiblePatientId: row.responsiblePatientId,
      responsibleName: nameById.get(row.responsiblePatientId) ?? 'Cadastro indisponível',
      dependentPatientId: row.dependentPatientId,
      dependentName: nameById.get(row.dependentPatientId) ?? 'Cadastro indisponível',
      relationshipType: row.relationshipType,
      legalGuardian: row.legalGuardian,
      financialResponsible: row.financialResponsible,
      canManageAppointments: row.canManageAppointments,
    }));
  });
}

/**
 * C14 — contato p/ mensagem proativa. Decifra o telefone (mesmo ponto central
 * de decrypt) e agrega consent de cobrança + suppression numa leitura. NÃO é
 * usado em listas; é 1 read por job no send-time. Retorna null se o paciente
 * não existe / foi soft-deleted (RLS via withTenant garante o tenant).
 */
/**
 * ADR-050 — identidade MÍNIMA para criar o customer de pagamento na conta Asaas
 * da clínica: nome + CPF, e nada mais.
 *
 * Por que este seam existe e não uma leitura direta do Payments: decifrar PII é
 * responsabilidade de quem é dono do dado. O Payments pede o que precisa por um
 * contrato nomeado — e o nome do método diz para QUE serve, então fica auditável
 * quem chamou e por quê. Não é um `getDecryptedPatient` genérico.
 *
 * Devolve `null` quando o paciente não existe, está inativo, ou o CPF guardado não
 * passa em `validateCpf`. **`null` significa NÃO COBRAR** — nunca "cobrar sem
 * identificar o pagador" (ADR-050 D6).
 */
export async function getPaymentIdentity(
  clinicId: string,
  patientId: string,
): Promise<{ nome: string; cpf: string } | null> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select({ nome: patients.nome, cpfEncrypted: patients.cpfEncrypted })
      .from(patients)
      .where(and(eq(patients.id, patientId), patientsActiveFilter()))
      .limit(1);
    if (!row?.cpfEncrypted) return null;

    const cpf = normalizeCpf(await decryptForTenant(clinicId, row.cpfEncrypted));
    // CPF inválido no cadastro (legado, importação) reprova AQUI, sem gastar uma
    // chamada ao gateway para tomar 400 — e sem cobrar às cegas.
    if (!validateCpf(cpf)) return null;

    return { nome: row.nome, cpf };
  });
}

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

    // Decisão append-only mais recente por finalidade/canal decide o opt-in.
    const [billingDecision] = await tx
      .select({ granted: patientConsentDecisions.granted })
      .from(patientConsentDecisions)
      .where(
        and(
          eq(patientConsentDecisions.patientId, patientId),
          eq(patientConsentDecisions.clinicId, clinicId),
          eq(patientConsentDecisions.purpose, 'cobranca_whatsapp'),
          eq(patientConsentDecisions.channel, 'whatsapp'),
        ),
      )
      .orderBy(desc(patientConsentDecisions.version))
      .limit(1);

    // Fallback somente para registros anteriores à migration granular.
    const [consent] = await tx
      .select({
        cobrancaWhatsapp: patientConsents.cobrancaWhatsapp,
        revokedAt: patientConsents.revokedAt,
      })
      .from(patientConsents)
      .where(eq(patientConsents.patientId, patientId))
      .orderBy(desc(patientConsents.versao))
      .limit(1);

    // suppression_list.contact_hash é o MESMO HMAC de patients.telefone_hash —
    // na grafia em que o número estava quando a supressão foi gravada. Regravar
    // o telefone em outra grafia (com 55, sem o nono dígito) não pode desfazer
    // um opt-out, então a busca cobre todas as grafias da mesma linha.
    let suppressedWhatsapp = false;
    let suppressedWhatsappPurposes: ProactiveContact['suppressedWhatsappPurposes'] = [];
    if (row.telefoneHash) {
      const contactHashes = phone ? await phoneLookupHashes(phone) : [];
      const supp = await tx
        .select({ id: suppressionList.id, purpose: suppressionList.purpose })
        .from(suppressionList)
        .where(
          and(
            eq(suppressionList.clinicId, clinicId),
            inArray(suppressionList.contactHash, [
              ...new Set([row.telefoneHash, ...contactHashes]),
            ]),
            eq(suppressionList.channel, 'whatsapp'),
          ),
        );
      suppressedWhatsappPurposes = supp.map((item) => item.purpose);
      suppressedWhatsapp = suppressedWhatsappPurposes.includes('all');
    }

    return {
      nome: row.nome,
      phone,
      deceased: row.obitoEm != null,
      cobrancaWhatsapp: billingDecision?.granted ?? consent?.cobrancaWhatsapp ?? false,
      consentRevoked: billingDecision ? !billingDecision.granted : consent?.revokedAt != null,
      suppressedWhatsapp,
      suppressedWhatsappPurposes,
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

export interface LgpdRequestDTO {
  id: string;
  patientId: string;
  patientName: string | null;
  type: 'export' | 'delete';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  requestedAt: string;
  dueAt: string;
  assignedToUserId: string | null;
  statusReason: string | null;
  requesterNotifiedAt: string | null;
  requesterNotificationChannel: 'email' | 'whatsapp' | 'phone' | 'in_person' | null;
  exportSignedUrl: string | null;
  exportSignedUrlExpiresAt: string | null;
  overdue: boolean;
}

export async function listLgpdRequests(clinicId: string): Promise<LgpdRequestDTO[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select({ request: lgpdRequests, patientName: patients.nome })
      .from(lgpdRequests)
      .leftJoin(
        patients,
        and(eq(patients.id, lgpdRequests.patientId), eq(patients.clinicId, clinicId)),
      )
      .where(eq(lgpdRequests.clinicId, clinicId))
      .orderBy(desc(lgpdRequests.requestedAt));

    return rows.map(({ request, patientName }) => ({
      id: request.id,
      patientId: request.patientId,
      patientName,
      type: request.type,
      status: request.status,
      requestedAt: request.requestedAt.toISOString(),
      dueAt: request.dueAt.toISOString(),
      assignedToUserId: request.assignedToUserId ?? null,
      statusReason: request.statusReason ?? null,
      requesterNotifiedAt: request.requesterNotifiedAt?.toISOString() ?? null,
      requesterNotificationChannel: request.requesterNotificationChannel ?? null,
      exportSignedUrl: request.exportSignedUrl ?? null,
      exportSignedUrlExpiresAt: request.exportSignedUrlExpiresAt?.toISOString() ?? null,
      overdue: isLgpdRequestOverdue({
        status: request.status,
        dueAt: request.dueAt,
        requesterNotifiedAt: request.requesterNotifiedAt ?? null,
      }),
    }));
  });
}

export interface LgpdRequestHistoryDTO {
  id: string;
  requestId: string;
  action: 'created' | 'assigned' | 'status_changed' | 'notified';
  fromStatus: 'pending' | 'processing' | 'completed' | 'failed' | null;
  toStatus: 'pending' | 'processing' | 'completed' | 'failed' | null;
  note: string | null;
  changedByUserId: string | null;
  changedAt: string;
}

export async function listLgpdRequestHistory(
  clinicId: string,
  requestId: string,
): Promise<LgpdRequestHistoryDTO[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(lgpdRequestHistory)
      .where(
        and(eq(lgpdRequestHistory.clinicId, clinicId), eq(lgpdRequestHistory.requestId, requestId)),
      )
      .orderBy(desc(lgpdRequestHistory.changedAt));
    return rows.map((row) => ({
      id: row.id,
      requestId: row.requestId,
      action: row.action,
      fromStatus: row.fromStatus ?? null,
      toStatus: row.toStatus ?? null,
      note: row.note ?? null,
      changedByUserId: row.changedByUserId ?? null,
      changedAt: row.changedAt.toISOString(),
    }));
  });
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

/**
 * LGPD-005 — decisão ATUAL de consentimento por finalidade.
 *
 * `patient_consent_decisions` é append-only: cada concessão/revogação vira uma
 * linha nova com `version` incrementada. "O estado atual" é a linha de maior
 * versão de cada (purpose, channel) — nunca um UPDATE.
 *
 * O domínio (`recordConsent`/`revokeConsent`) já existia, íntegro e auditado, e
 * NADA no produto o invocava: nem página, nem Server Action, nem rota, nem
 * ferramenta do agente. A clínica não conseguia operar conceder → consultar →
 * revogar. Esta query é a metade que faltava para a leitura.
 */
export interface ConsentDecisionDTO {
  purpose: string;
  channel: string | null;
  granted: boolean;
  version: number;
  recordedAt: string;
  recordedBy: string | null;
}

export async function listCurrentConsentDecisions(
  clinicId: string,
  patientId: string,
): Promise<ConsentDecisionDTO[]> {
  return withTenant(clinicId, async (tx) => {
    // DISTINCT ON (purpose, channel) + ORDER BY version DESC devolve exatamente
    // a decisão vigente de cada finalidade numa única varredura do índice
    // (patient_id, purpose, channel, version).
    const rows = (await tx.execute(sql`
      SELECT DISTINCT ON (purpose, channel)
             purpose::text        AS purpose,
             channel::text        AS channel,
             granted,
             version,
             recorded_at          AS recorded_at,
             recorded_by::text    AS recorded_by
        FROM patient_consent_decisions
       WHERE clinic_id = ${clinicId}::uuid AND patient_id = ${patientId}::uuid
       ORDER BY purpose, channel, version DESC
    `)) as unknown as Array<{
      purpose: string;
      channel: string | null;
      granted: boolean;
      version: number;
      recorded_at: Date | string;
      recorded_by: string | null;
    }>;

    return rows.map((r) => ({
      purpose: r.purpose,
      channel: r.channel,
      granted: r.granted,
      version: Number(r.version),
      recordedAt: toIso(r.recorded_at as Date)!,
      recordedBy: r.recorded_by,
    }));
  });
}
