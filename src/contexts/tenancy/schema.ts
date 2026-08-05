/**
 * Tenancy schema — the root of the multi-tenant model. Owns:
 *   - clinics          : the tenant entity itself
 *   - clinic_units     : optional sub-units (multi-unit plan)
 *   - _reserved_slugs  : platform-reserved subdomains (global protected)
 *
 * RLS policies, triggers, and seed live in the migration that creates these
 * tables (`drizzle/migrations/0001_tenancy_foundation.sql`). See ADR-007 for
 * the implementation patterns (FORCE-principal, dual-context, single helper).
 *
 * Public surface (re-exported by ./index.ts):
 *   - clinics, clinicUnits, reservedSlugs, clinicStatus
 *   - tenantIdRef()    : FK helper used by every tenant-scoped table in C3+
 *
 * D31: clinics mutations are super_admin only in C2. Tenant-facing edits come
 * in C3 via Server Actions that route through dbAdmin + audit (C4).
 *
 * D35: tenantIdRef() lives HERE (not in src/lib/db/types.ts) because the
 * boundaries config forbids src/lib/* from importing src/contexts/*. The
 * structural fix (a lib/db/primitives layer with lazy FK refs) is C3+ debt.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, index, pgEnum, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { deletedAt, timestampsPattern, uuidPk } from '@/lib/db/types';

export const clinicStatus = pgEnum('clinic_status', [
  'trial',
  'active',
  'suspended_readonly',
  'suspended',
  'cancelled',
  // C13/ADR-016 Amendment: clínica provisionada no checkout, antes do 1º pagamento.
  // Login bloqueado (exceto owner p/ pagar); expira se o checkout for abandonado.
  'pending_payment',
]);

export const clinics = pgTable(
  'clinics',
  {
    id: uuidPk(),
    slug: text('slug').notNull(),
    nome: text('nome').notNull(),
    // A8/ADR-044: CNPJ (PII fiscal do dono) cifrado per-tenant — salt HKDF = o
    // próprio id da clínica. Padrão de `patients.cpf_encrypted` (text puro; o
    // modo de falha de um decrypt esquecido é CNPJ visível-errado no PDF/admin,
    // não silencioso).
    //
    // ⚠️ O CNPJ **NÃO é validado nem normalizado** em lugar nenhum. O comentário
    // antigo aqui dizia "validation only in C13" — ponteiro MORTO: o C13 fechou
    // em 2026-06-17 sem entregar isso (mesmo modo de falha que o ADR-011/cron e o
    // "ADR-008 D6" já produziram). Não repita a promessa por camada.
    //
    // `cnpj_hash` é populada (hashForLookup) e fica pronta para o UNIQUE do A11.
    // O UNIQUE está ADIADO porque, SEM normalizar, "12.345.678/0001-99" e
    // "12345678000199" geram hashes diferentes → a constraint não dedupe nada e
    // dá falsa sensação de proteção. Gatilho real: **antes do 1º cliente pagante
    // via onboarding self-serve** (é quando duplicata de cadastro passa a ser
    // possível) — e o pré-requisito é normalizar na escrita. Ver ADR-044 §A11.
    cnpjEncrypted: text('cnpj_encrypted'), // nullable
    cnpjHash: text('cnpj_hash'), // populada; UNIQUE(A11) pendente de normalização
    cnes: text('cnes'), // nullable: not all clinic types have CNES
    // C7 (white-label leve nos PDFs): cabeçalho de prescrições/documentos médicos.
    // Aditivo/nullable — clínica sem branding cai num default no render (não quebra).
    endereco: text('endereco'),
    // Receituário de Controle Especial (R8): telefone do consultório integra a
    // identificação legal do emitente. Aditivo/nullable — backward-compatible.
    telefone: text('telefone'),
    logoUrl: text('logo_url'),
    primaryColor: text('primary_color'),
    status: clinicStatus('status').notNull().default('trial'),
    // C6 (R10/M7): timezone IANA da clínica — base do slot resolver. CONGELADO:
    // 1 clínica = 1 timezone até existir override por unidade (ADR-014).
    timezone: text('timezone').notNull().default('America/Sao_Paulo'),
    ...timestampsPattern(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    slugUnique: unique('clinics_slug_unique').on(t.slug),
    slugFormat: check('clinics_slug_format', sql`${t.slug} ~ '^[a-z0-9-]{3,30}$'`),
  }),
);

export const clinicUnits = pgTable(
  'clinic_units',
  {
    id: uuidPk(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    endereco: text('endereco'),
    ativo: boolean('ativo').notNull().default(true),
    ...timestampsPattern(),
  },
  (t) => ({
    // D9: Postgres does NOT create an index for FK columns automatically.
    // Without this idx, RLS policies comparing clinic_id force seq scan.
    clinicIdx: index('clinic_units_clinic_id_idx').on(t.clinicId),
  }),
);

/**
 * _reserved_slugs — D29 category #2 (global protected).
 * Read-only for authenticated users (need to validate against during signup).
 * Mutations exclusively via dbAdmin (no write policy — FORCE RLS blocks
 * by default for every non-bypass role). See migration 0001 for the seed list.
 */
export const reservedSlugs = pgTable('_reserved_slugs', {
  slug: text('slug').primaryKey(),
  reason: text('reason'),
});

/**
 * tenantIdRef — canonical FK + cascade helper for tenant-scoped tables.
 * Use in C3+ context schemas:
 *
 *     clinicId: tenantIdRef(),
 *
 * Produces: `uuid('clinic_id') NOT NULL REFERENCES clinics(id) ON DELETE CASCADE`.
 *
 * Always pair with `index('<table>_clinic_id_idx').on(t.clinicId)` (D9). The
 * checklist in docs/CONVENTIONS.md enforces this in PR review.
 */
export const tenantIdRef = () =>
  uuid('clinic_id')
    .notNull()
    .references(() => clinics.id, { onDelete: 'cascade' });
