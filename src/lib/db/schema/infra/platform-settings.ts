/**
 * platform_settings — flags/kill-switches GLOBAIS da plataforma (não-tenant).
 *
 * Categoria (ADR-007 §10): global protected. Sem clinic_id. Key-value: a chave
 * é o identificador da flag (ex.: 'proactive_jobs.enabled', 'ai_agent.mode',
 * 'platform.maintenance') e `value` é jsonb (boolean/string/objeto por chave).
 *
 * Contratos:
 *   - RLS ENABLE+FORCE; SELECT liberado a `authenticated` (workers/app leem a
 *     flag); escrita SOMENTE via dbAdmin/service_role (sem policy de write).
 *   - Leitura quente cacheada por instância (TTL curto) em src/lib/platform-settings/.
 *   - Escrita exclusivamente via superAdminAction (auditada em super_admin_actions).
 */
import { sql } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type PlatformSettingRow = typeof platformSettings.$inferSelect;
export type PlatformSettingInsert = typeof platformSettings.$inferInsert;
