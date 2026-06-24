/**
 * Onboarding context — `clinic_invites` (convite mágico para criar clínica).
 *
 * Categoria (ADR-007 §10): GLOBAL PROTECTED. Convite é entidade PRÉ-clínica — não
 * tem `clinic_id` de tenant; `provisioned_clinic_id` aponta para a clínica criada
 * ao concluir o onboarding. O token NUNCA é guardado em claro: só o HMAC
 * (`token_hash`). Acesso só via dbAdmin/service_role — super_admin lê no painel; a
 * rota pública `/join` valida server-side por `token_hash` (nunca via RLS do cliente).
 *
 * `version` = optimistic concurrency (impede duas abas concluírem o mesmo convite).
 * `plan_snapshot` = preço/plano pinados no checkout (mudança futura de preço não
 * altera o acordo). `step_state` = progresso do wizard (contrato Zod em
 * internal/step-state.ts); NUNCA guarda senha nem dado de cartão.
 */
import { sql } from 'drizzle-orm';
import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { uuidPk } from '@/lib/db/types';

export const clinicInvites = pgTable('clinic_invites', {
  id: uuidPk(),
  tokenHash: text('token_hash').notNull().unique(),
  status: text('status').notNull().default('pending'), // pending|started|completed|expired|cancelled
  version: integer('version').notNull().default(0),
  email: text('email'),
  createdBy: uuid('created_by'),
  planSnapshot: jsonb('plan_snapshot'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  provisionedClinicId: uuid('provisioned_clinic_id'),
  stepState: jsonb('step_state'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type ClinicInviteRow = typeof clinicInvites.$inferSelect;
export type ClinicInviteInsert = typeof clinicInvites.$inferInsert;
