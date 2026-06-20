/**
 * impersonation_sessions — sessões de impersonate do super_admin (C15).
 *
 * Categoria (ADR-007 §10): global protected (sem clinic_id próprio como tenant;
 * possui clinic_id apontando para a clínica impersonada). É a fonte AUTORITATIVA
 * do impersonate — o cookie `qoro_imp` carrega apenas o `id` assinado (HMAC);
 * clínica, expiração e revogação vivem AQUI.
 *
 * Contratos (plano C15 §2):
 *   - RLS especial: somente is_super_admin() pode SELECT (mesmo cenário
 *     cross-tenant de super_admin_actions). Escrita SEMPRE via dbAdmin
 *     (service_role / BYPASSRLS) — não há policy de INSERT/UPDATE.
 *   - TTL: expires_at = started_at + 1h (OR-I4). Sem renovação automática.
 *   - Kill switch: revoked_at != NULL encerra a sessão no próximo request (OR-I5).
 *   - No máximo UMA sessão ativa por super_admin (OR-I3): startImpersonation
 *     revoga as ativas anteriores antes de inserir.
 *   - ip_address declarado como text e ALTERed para inet na migração (mesmo
 *     pattern de super_admin_actions.ip_address / login_attempts.ip).
 */
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { uuidPk } from '@/lib/db/types';

export const impersonationSessions = pgTable(
  'impersonation_sessions',
  {
    id: uuidPk(),
    superAdminId: uuid('super_admin_id').notNull(),
    clinicId: uuid('clinic_id').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
  },
  (t) => ({
    // Lookup do "há sessão ativa deste super_admin?" (revoga-anterior + resolve).
    superAdminActiveIdx: index('impersonation_sessions_super_admin_idx')
      .on(t.superAdminId)
      .where(sql`${t.revokedAt} IS NULL`),
    clinicIdx: index('impersonation_sessions_clinic_idx').on(t.clinicId),
  }),
);

export type ImpersonationSessionRow = typeof impersonationSessions.$inferSelect;
export type ImpersonationSessionInsert = typeof impersonationSessions.$inferInsert;
