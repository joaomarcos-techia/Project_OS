/**
 * cron_heartbeats — última execução de cada cron (observabilidade operacional).
 *
 * Categoria (ADR-007 §10): global protected. Sem clinic_id. A chave é o nome do
 * job (= path do cron no vercel.json, ex.: 'billing-dunning'). Cada cron faz um
 * UPSERT no fim do tick bem-sucedido via dbAdmin.
 *
 * Contratos:
 *   - RLS ENABLE+FORCE; SEM policy de SELECT para authenticated (ops-only — o
 *     painel admin lê via dbAdmin/BYPASSRLS). Escrita só via service_role.
 */
import { sql } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const cronHeartbeats = pgTable('cron_heartbeats', {
  job: text('job').primaryKey(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastStatus: text('last_status'),
  detail: jsonb('detail'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type CronHeartbeatRow = typeof cronHeartbeats.$inferSelect;
export type CronHeartbeatInsert = typeof cronHeartbeats.$inferInsert;
