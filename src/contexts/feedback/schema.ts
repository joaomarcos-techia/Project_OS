/**
 * Feedback context: sugestões enviadas por usuários e a trilha operacional do
 * super-admin. O conteúdo é tenant-scoped; anexos permanecem vazios até que
 * exista um bucket específico e privado para esse propósito.
 */
import { sql } from 'drizzle-orm';
import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// eslint-disable-next-line boundaries/element-types -- tenantIdRef é o contrato sancionado de FK para clinics.
import { tenantIdRef } from '@/contexts/tenancy';
import { deletedAt, timestampsPattern, uuidPk } from '@/lib/db/types';

export const feedbackCategory = pgEnum('feedback_category', [
  'feature',
  'improvement',
  'bug',
  'other',
]);

export const feedbackPriority = pgEnum('feedback_priority', ['low', 'medium', 'high']);

export const feedbackStatus = pgEnum('feedback_status', [
  'received',
  'under_review',
  'planned',
  'in_development',
  'completed',
  'rejected',
  'archived',
]);

export const feedbackHistoryAction = pgEnum('feedback_history_action', [
  'created',
  'status_changed',
  'note_added',
  'archived',
  'deleted',
]);

export const feedbackSuggestions = pgTable(
  'feedback_suggestions',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    // FK para auth.users é declarada na migration; ON DELETE SET NULL preserva o histórico.
    userId: uuid('user_id'),
    title: text('title').notNull(),
    description: text('description').notNull(),
    category: feedbackCategory('category').notNull(),
    priority: feedbackPriority('priority').notNull(),
    status: feedbackStatus('status').notNull().default('received'),
    adminNotes: text('admin_notes'),
    attachments: jsonb('attachments')
      .notNull()
      .default(sql`'[]'::jsonb`),
    browser: text('browser'),
    platform: text('platform'),
    appVersion: text('app_version'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    ...timestampsPattern(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    clinicCreatedIdx: index('feedback_suggestions_clinic_created_idx').on(t.clinicId, t.createdAt),
    clinicStatusIdx: index('feedback_suggestions_clinic_status_idx').on(t.clinicId, t.status),
    userCreatedIdx: index('feedback_suggestions_user_created_idx').on(t.userId, t.createdAt),
  }),
);
export type FeedbackSuggestionRow = typeof feedbackSuggestions.$inferSelect;

export const feedbackHistory = pgTable(
  'feedback_history',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    feedbackId: uuid('feedback_id')
      .notNull()
      .references(() => feedbackSuggestions.id, { onDelete: 'cascade' }),
    action: feedbackHistoryAction('action').notNull(),
    fromStatus: feedbackStatus('from_status'),
    toStatus: feedbackStatus('to_status'),
    note: text('note'),
    changedBy: uuid('changed_by'), // FK auth.users via migration.
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    feedbackCreatedIdx: index('feedback_history_feedback_created_idx').on(
      t.feedbackId,
      t.createdAt,
    ),
    clinicCreatedIdx: index('feedback_history_clinic_created_idx').on(t.clinicId, t.createdAt),
  }),
);
export type FeedbackHistoryRow = typeof feedbackHistory.$inferSelect;
