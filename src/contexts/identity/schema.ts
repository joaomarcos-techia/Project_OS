/**
 * Identity schema — 5 tabelas que sustentam autenticação, RBAC e rate limit.
 *
 * Categorias (ADR-007 §10):
 *   - tenant-scoped              : profiles, user_permission_overrides
 *   - global protected           : permissions, role_permissions, login_attempts
 *
 * Decisões frozen em ADR-008 + plano C3 v6:
 *   - profiles.id é FK para auth.users(id). Drizzle não conhece schema auth — a FK
 *     vive na migration SQL (append). Aqui declaramos apenas a coluna sem default.
 *   - profiles.clinic_id é NULLABLE só para super_admin. Não usar tenantIdRef()
 *     (que é NOT NULL). CHECK constraint garante consistência role↔clinic_id.
 *   - profiles tem policies MANUAIS (não defaultTenantPolicy) porque é multi-context
 *     (self lookup pré-JWT + tenant + super_admin). Veja migration 0003.
 *   - profiles SEM coluna email (D7 — vive em auth.users; denorm causa drift).
 *   - sessions foi CORTADA de C3 (D3 — auth.sessions do Supabase basta para MVP).
 *   - login_attempts.ip é inet (D35 — IPv4/IPv6 unificado, normalização nativa).
 *     Declarado como text aqui e ALTERado para inet em 0003 (Drizzle não tem
 *     primitivo inet exposto).
 *   - claims_version é incrementado por triggers PG (D5) e injetado no JWT pelo
 *     Hook (ADR-008/009) para drift detection no middleware throttled.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// eslint-disable-next-line boundaries/element-types -- D35: tenantIdRef + clinics FK ref live in tenancy schema by design (C2 contract); same exception that lets user_permission_overrides use tenantIdRef.
import { clinics, tenantIdRef } from '@/contexts/tenancy';
import { deletedAt, timestampsPattern, uuidPk } from '@/lib/db/types';

/**
 * Canonical platform roles. Frozen em PlanoAção §3.18.
 * ENUM Postgres é append-only — adicionar uma nova role no futuro exige
 * `ALTER TYPE role_enum ADD VALUE` em nova migration, nunca remoção.
 */
export const roleEnum = pgEnum('role_enum', [
  'gestor',
  'doctor',
  'attendant',
  'financial',
  'owner',
  'super_admin',
]);

/**
 * profiles — extensão do auth.users do Supabase com role + clinic + flags.
 *
 * - id: vem de auth.users.id (FK declarada em migration). SEM defaultRandom.
 * - clinic_id: NULLABLE só para super_admin (CHECK garante consistência).
 * - claims_version: bumpado por triggers em mudanças que afetam autorização
 *   (role, clinic_id, ativo, overrides). Lido pelo Hook e pelo middleware
 *   throttled para detectar drift (ADR-009).
 */
export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey(),
    clinicId: uuid('clinic_id').references(() => clinics.id, {
      onDelete: 'cascade',
    }),
    nome: text('nome').notNull(),
    telefone: text('telefone'),
    role: roleEnum('role').notNull(),
    ativo: boolean('ativo').notNull().default(true),
    mfaEnrolledAt: timestamp('mfa_enrolled_at', { withTimezone: true }),
    claimsVersion: integer('claims_version').notNull().default(1),
    ...timestampsPattern(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    clinicIdx: index('profiles_clinic_id_idx').on(t.clinicId),
    roleIdx: index('profiles_role_idx').on(t.role),
    roleClinicCheck: check(
      'profiles_role_clinic_check',
      sql`(${t.role} = 'super_admin' AND ${t.clinicId} IS NULL) OR (${t.role} <> 'super_admin' AND ${t.clinicId} IS NOT NULL)`,
    ),
  }),
);

/**
 * permissions — catálogo canônico de permissions. Global protected.
 * Read-only para authenticated (RLS); writes via seed/dbAdmin.
 * Lista canônica das 21 codes vem do seed em 0003.
 */
export const permissions = pgTable('permissions', {
  code: text('code').primaryKey(),
  description: text('description').notNull(),
});

/**
 * role_permissions — bundles padrão por role. Global protected.
 * Mudanças aqui afetam TODOS users da role e NÃO são detectadas por
 * claims_version (D27 — débito aceito: exige logout operacional ou
 * auth epoch global em C16).
 */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    role: roleEnum('role').notNull(),
    permissionCode: text('permission_code')
      .notNull()
      .references(() => permissions.code, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.role, t.permissionCode] }),
  }),
);

/**
 * user_permission_overrides — granular per-user grant/deny por clínica.
 * Tenant-scoped. clinic_id denormalizado para RLS sem JOIN; trigger
 * sincroniza com profiles.clinic_id em mudanças (evita drift).
 *
 * Bump de claims_version do user_id afetado é feito por trigger AFTER
 * INSERT/UPDATE/DELETE (D5).
 */
export const userPermissionOverrides = pgTable(
  'user_permission_overrides',
  {
    id: uuidPk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    clinicId: tenantIdRef(),
    permissionCode: text('permission_code')
      .notNull()
      .references(() => permissions.code, { onDelete: 'cascade' }),
    granted: boolean('granted').notNull(),
    grantedBy: uuid('granted_by').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    ...timestampsPattern(),
  },
  (t) => ({
    userPermUnique: unique('user_permission_overrides_user_perm_unique').on(
      t.userId,
      t.permissionCode,
    ),
    clinicIdx: index('user_permission_overrides_clinic_id_idx').on(t.clinicId),
    userIdx: index('user_permission_overrides_user_id_idx').on(t.userId),
  }),
);

/**
 * login_attempts — pre-auth audit + base para rate limit dual.
 * Global protected. INSERT via SECURITY DEFINER record_login_attempt()
 * (D9). SELECT só super_admin.
 *
 * ip é declared as text aqui mas ALTERed para inet em 0003 (D35 — tipo nativo
 * Postgres, normalização IPv4/IPv6). Drizzle não expõe primitivo inet.
 * email_hash é HMAC-SHA256 com pepper LOGIN_HASH_PEPPER (nunca plaintext).
 */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: uuidPk(),
    emailHash: text('email_hash').notNull(),
    ip: text('ip'),
    success: boolean('success').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    emailIdx: index('login_attempts_email_hash_attempted_at_idx').on(
      t.emailHash,
      sql`${t.attemptedAt} DESC`,
    ),
    ipIdx: index('login_attempts_ip_attempted_at_idx').on(
      t.ip,
      sql`${t.attemptedAt} DESC`,
    ),
  }),
);
