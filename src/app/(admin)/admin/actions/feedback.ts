'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';

import { feedbackHistory, feedbackSuggestions } from '@/contexts/feedback/schema';
import { buildRequestContext } from '@/lib/audit/request-context';
import { superAdminAction } from '@/lib/audit/super-admin';
import { requireSuperAdmin, requireUser } from '@/lib/auth/tenant-context';
import { dbAdmin } from '@/lib/db';

const Status = z.enum([
  'received',
  'under_review',
  'planned',
  'in_development',
  'completed',
  'rejected',
  'archived',
]);
const ManageFeedbackSchema = z.object({
  feedbackId: z.string().uuid(),
  operation: z.enum(['update', 'archive', 'delete']),
  status: Status.optional(),
  note: z.string().trim().max(4_000).optional().default(''),
});

export type ManageFeedbackState = { error: string | null; success?: boolean };

export async function manageFeedbackAction(
  _previous: ManageFeedbackState,
  formData: FormData,
): Promise<ManageFeedbackState> {
  const parsed = ManageFeedbackSchema.safeParse({
    feedbackId: formData.get('feedbackId'),
    operation: formData.get('operation'),
    status: formData.get('status') || undefined,
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) return { error: 'Dados de feedback inválidos.' };
  if (parsed.data.operation === 'update' && !parsed.data.status)
    return { error: 'Selecione um status.' };

  await requireSuperAdmin();
  const actor = await requireUser();
  const [feedback] = await dbAdmin
    .select({
      id: feedbackSuggestions.id,
      clinicId: feedbackSuggestions.clinicId,
      status: feedbackSuggestions.status,
      adminNotes: feedbackSuggestions.adminNotes,
      deletedAt: feedbackSuggestions.deletedAt,
    })
    .from(feedbackSuggestions)
    .where(eq(feedbackSuggestions.id, parsed.data.feedbackId))
    .limit(1);
  if (feedback?.deletedAt) return { error: null, success: true };
  if (!feedback) return { error: 'Feedback não encontrado.' };

  const requestContext = buildRequestContext(await headers());
  const { operation, status, note, feedbackId } = parsed.data;
  try {
    await superAdminAction(
      {
        action: `feedback.${operation}`,
        targetClinicId: feedback.clinicId,
        payload: { feedbackId, status: status ?? null, hasNote: Boolean(note) },
        requestContext,
      },
      async (tx) => {
        if (operation === 'delete') {
          await tx
            .update(feedbackSuggestions)
            .set({ deletedAt: sql`now()` })
            .where(eq(feedbackSuggestions.id, feedbackId));
          await tx.insert(feedbackHistory).values({
            clinicId: feedback.clinicId,
            feedbackId,
            action: 'deleted',
            fromStatus: feedback.status,
            toStatus: feedback.status,
            note: note || null,
            changedBy: actor.userId,
          });
          return;
        }

        const nextStatus = operation === 'archive' ? 'archived' : status!;
        const nextNotes = note || feedback.adminNotes;
        if (feedback.status === nextStatus && nextNotes === feedback.adminNotes) return;
        await tx
          .update(feedbackSuggestions)
          .set({
            status: nextStatus,
            adminNotes: nextNotes,
            closedAt: ['completed', 'rejected', 'archived'].includes(nextStatus)
              ? sql`now()`
              : null,
          })
          .where(eq(feedbackSuggestions.id, feedbackId));
        await tx.insert(feedbackHistory).values({
          clinicId: feedback.clinicId,
          feedbackId,
          action: operation === 'archive' ? 'archived' : 'status_changed',
          fromStatus: feedback.status,
          toStatus: nextStatus,
          note: note || null,
          changedBy: actor.userId,
        });
      },
    );
    revalidatePath('/admin/feedbacks');
    revalidatePath(`/admin/feedbacks/${feedbackId}`);
    return { error: null, success: true };
  } catch {
    return { error: 'Não foi possível atualizar o feedback agora.' };
  }
}
