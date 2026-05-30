/**
 * audit_events — forensic log de toda mutação relevante (C4).
 *
 * Categoria (ADR-007 §10): tenant-scoped (clinic_id).
 * Frozen contracts (ADR-011):
 *   - PARENT particionada por RANGE (created_at) — particionamento mensal feito
 *     em SQL puro na migration 0009 (Drizzle não modela partitions).
 *   - RLS na parent table propaga para todas as child partitions (PG 11+).
 *   - Append-only para tenant: INSERT + SELECT policies; sem UPDATE/DELETE.
 *   - PRIMARY KEY composto (id, created_at) — partition key OBRIGA estar na PK
 *     em PG range partitioning.
 *   - inet + jsonb (before/after) já sanitizados em TS via sanitizePayload antes
 *     do INSERT.
 *   - request_id é gerado pelo middleware ou fallback no buildRequestContext.
 *
 * Esta declaração Drizzle cobre só a parent — o particionamento e os 12 children
 * mensais (+ default partition catch-all) vivem em drizzle/migrations/0009_*.sql.
 *
 * Retention (operacional, documentado em ADR-011 + runbook): 90d hot, 1y warm,
 * archive-or-delete. DETACH PARTITION manual no MVP, automation em C16.
 */
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').notNull().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    userId: uuid('user_id'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    // ip_address é declared as text aqui e ALTERed para inet em 0009 (mesmo
    // pattern de login_attempts.ip em 0003 — Drizzle não expõe primitivo inet).
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.id, t.createdAt] }),
    clinicCreatedIdx: index('audit_events_clinic_created_idx').on(t.clinicId, t.createdAt),
    resourceIdx: index('audit_events_resource_idx').on(t.resourceType, t.resourceId),
    // HIGH-07: defense in depth against payload explosion
    beforeSizeChk: check(
      'audit_events_before_size_chk',
      sql`${t.before} IS NULL OR pg_column_size(${t.before}) <= 65536`,
    ),
    afterSizeChk: check(
      'audit_events_after_size_chk',
      sql`${t.after} IS NULL OR pg_column_size(${t.after}) <= 65536`,
    ),
  }),
);

export type AuditEventRow = typeof auditEvents.$inferSelect;
export type AuditEventInsert = typeof auditEvents.$inferInsert;
