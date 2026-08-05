import 'server-only';

import { and, desc, eq, isNull } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';

import { feedbackHistory, feedbackSuggestions } from '../schema';

export type CreateFeedbackSuggestionInput = {
  clinicId: string;
  userId: string;
  title: string;
  description: string;
  category: 'feature' | 'improvement' | 'bug' | 'other';
  priority: 'low' | 'medium' | 'high';
  browser: string | null;
  platform: string | null;
  appVersion: string | null;
};

export async function createFeedbackSuggestion(
  tx: Tx,
  input: CreateFeedbackSuggestionInput,
): Promise<{ id: string; status: 'received' }> {
  const [created] = await tx
    .insert(feedbackSuggestions)
    .values({
      clinicId: input.clinicId,
      userId: input.userId,
      title: input.title,
      description: input.description,
      category: input.category,
      priority: input.priority,
      browser: input.browser,
      platform: input.platform,
      appVersion: input.appVersion,
      attachments: [],
    })
    .returning({ id: feedbackSuggestions.id, status: feedbackSuggestions.status });
  if (!created) throw new Error('feedback suggestion was not created');
  await tx.insert(feedbackHistory).values({
    clinicId: input.clinicId,
    feedbackId: created.id,
    action: 'created',
    toStatus: 'received',
    changedBy: input.userId,
  });
  return { id: created.id, status: 'received' };
}

export type OwnFeedbackSuggestion = {
  id: string;
  title: string;
  category: 'feature' | 'improvement' | 'bug' | 'other';
  priority: 'low' | 'medium' | 'high';
  status:
    | 'received'
    | 'under_review'
    | 'planned'
    | 'in_development'
    | 'completed'
    | 'rejected'
    | 'archived';
  createdAt: string;
  updatedAt: string;
};

/** A leitura do cliente é limitada ao próprio autor, além do isolamento tenant. */
export async function listOwnFeedbackSuggestions(
  clinicId: string,
  userId: string,
): Promise<OwnFeedbackSuggestion[]> {
  return withTenant(
    clinicId,
    async (tx) => {
      const rows = await tx
        .select({
          id: feedbackSuggestions.id,
          title: feedbackSuggestions.title,
          category: feedbackSuggestions.category,
          priority: feedbackSuggestions.priority,
          status: feedbackSuggestions.status,
          createdAt: feedbackSuggestions.createdAt,
          updatedAt: feedbackSuggestions.updatedAt,
        })
        .from(feedbackSuggestions)
        .where(
          and(
            eq(feedbackSuggestions.clinicId, clinicId),
            eq(feedbackSuggestions.userId, userId),
            isNull(feedbackSuggestions.deletedAt),
          ),
        )
        .orderBy(desc(feedbackSuggestions.createdAt));
      return rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }));
    },
    userId,
  );
}
