/**
 * super_admin_actions — forensic log de ações cross-tenant do super_admin (C4).
 *
 * Categoria (ADR-007 §10): global protected (sem clinic_id próprio; possui
 * target_clinic_id apontando para a clínica afetada quando aplicável).
 *
 * Frozen contracts (ADR-011):
 *   - RLS especial: somente is_super_admin() pode SELECT/INSERT (sem
 *     defaultTenantPolicy; é exatamente o cenário cross-tenant que o pattern
 *     padrão recusa).
 *   - Append-only: INSERT via wrapper superAdminAction; sem UPDATE/DELETE policy.
 *   - payload sanitizado via sanitizePayload antes do INSERT — proteção contra
 *     vazamento de secrets em logs forensic que o super_admin lê.
 *   - super_admin_id é o user que executou; target_clinic_id é a clínica afetada
 *     (NULL quando ação é de plataforma — ex.: rebuild de catálogo).
 *   - ip_address declarado como text e ALTERed para inet em 0008 (mesmo pattern
 *     de login_attempts.ip).
 */
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { uuidPk } from '@/lib/db/types';

export const superAdminActions = pgTable(
  'super_admin_actions',
  {
    id: uuidPk(),
    superAdminId: uuid('super_admin_id').notNull(),
    action: text('action').notNull(),
    targetClinicId: uuid('target_clinic_id'),
    payload: jsonb('payload'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    superAdminIdIdx: index('super_admin_actions_super_admin_id_idx').on(t.superAdminId),
    createdIdx: index('super_admin_actions_created_idx').on(t.createdAt),
    targetClinicIdx: index('super_admin_actions_target_clinic_idx').on(t.targetClinicId),
    // HIGH-07: defense in depth against payload explosion
    payloadSizeChk: check(
      'super_admin_actions_payload_size_chk',
      sql`${t.payload} IS NULL OR pg_column_size(${t.payload}) <= 65536`,
    ),
  }),
);

export type SuperAdminActionRow = typeof superAdminActions.$inferSelect;
export type SuperAdminActionInsert = typeof superAdminActions.$inferInsert;
