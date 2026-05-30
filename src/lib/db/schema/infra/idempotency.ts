/**
 * idempotency_keys — exactly-once mutations via shared atomic TX (C4).
 *
 * Categoria (ADR-007 §10): tenant-scoped (clinic_id FK).
 *
 * Frozen contracts (ADR-011):
 *   - PK = key (string '<entity>:<action>:<hash>'). Client-side controlado;
 *     formato enforced via CHECK regex.
 *   - response = NULL durante a TX in-flight; UPDATE com response no final
 *     da MESMA TX da mutação + audit. Reserve-first atômico (ON CONFLICT DO
 *     NOTHING + lookup) — bug crítico de atomicidade da v1/v2 resolvido em v3.
 *   - payload_hash = sha256(canonicalize(payload)). Mesmo hash + mesma key =
 *     cache hit. Hash diferente + mesma key = IdempotencyConflictError 409.
 *   - response com CHECK pg_column_size <= 98304 (96KB) — defensa em
 *     profundidade contra o cap TS de 64KB feito por capJsonSize().
 *   - expires_at default now()+24h; cleanup manual no MVP, automation em C16.
 *   - SET LOCAL lock_timeout = '3s' em idempotentMutation translata PG 55P03
 *     em IdempotencyInFlightError — endpoint lento não trava concorrência.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenantId } from '@/lib/db/types';

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: text('key').primaryKey(),
    clinicId: tenantId(),
    userId: uuid('user_id'),
    payloadHash: text('payload_hash').notNull(),
    response: jsonb('response'),
    statusCode: integer('status_code'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '24 hours'`),
  },
  (t) => ({
    clinicIdx: index('idempotency_keys_clinic_id_idx').on(t.clinicId),
    expiresAtIdx: index('idempotency_keys_expires_at_idx').on(t.expiresAt),
    keyFormatChk: check(
      'idempotency_keys_key_format_chk',
      sql`${t.key} ~ '^[a-z_][a-z0-9_]*:[a-z_][a-z0-9_]*:[a-f0-9]{8,}$'`,
    ),
    responseSizeChk: check(
      'idempotency_keys_response_size_chk',
      sql`${t.response} IS NULL OR pg_column_size(${t.response}) <= 98304`,
    ),
  }),
);

export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect;
export type IdempotencyKeyInsert = typeof idempotencyKeys.$inferInsert;
