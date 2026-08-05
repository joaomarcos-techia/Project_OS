'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { buildRequestContext } from '@/lib/audit/request-context';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { idempotentMutation } from '@/lib/idempotency/mutation';
import { createFeedbackSuggestion } from '@/contexts/feedback/internal/suggestions';

const SubmitFeedbackSchema = z.object({
  title: z.string().trim().min(4, 'Informe um título com ao menos 4 caracteres.').max(160),
  description: z
    .string()
    .trim()
    .min(10, 'Descreva a sugestão com ao menos 10 caracteres.')
    .max(8_000),
  category: z.enum(['feature', 'improvement', 'bug', 'other']),
  priority: z.enum(['low', 'medium', 'high']),
  browser: z.string().trim().max(512).optional().nullable(),
  platform: z.string().trim().max(256).optional().nullable(),
  appVersion: z.string().trim().max(128).optional().nullable(),
  idempotencyKey: z.string().uuid('Solicitação inválida. Recarregue a página e tente novamente.'),
});

export type SubmitFeedbackState = { error: string | null; success?: boolean };

function optionalField(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export async function submitFeedbackAction(
  _previous: SubmitFeedbackState,
  formData: FormData,
): Promise<SubmitFeedbackState> {
  const parsed = SubmitFeedbackSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description'),
    category: formData.get('category'),
    priority: formData.get('priority'),
    browser: optionalField(formData.get('browser')),
    platform: optionalField(formData.get('platform')),
    appVersion: optionalField(formData.get('appVersion')),
    idempotencyKey: formData.get('idempotencyKey'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };

  const user = await requireUser();
  const clinicId = await requireClinicId();
  const requestContext = buildRequestContext(await headers());
  try {
    await idempotentMutation(
      {
        idempotency: {
          key: `feedback:submit:${parsed.data.idempotencyKey.replace(/-/g, '')}`,
          payload: {
            title: parsed.data.title,
            description: parsed.data.description,
            category: parsed.data.category,
            priority: parsed.data.priority,
          },
        },
        audit: {
          action: 'feedback.submitted',
          resourceType: 'feedback_suggestion',
          resourceId: null,
          before: null,
          requestContext,
        },
      },
      (tx) =>
        createFeedbackSuggestion(tx, {
          clinicId,
          userId: user.userId,
          title: parsed.data.title,
          description: parsed.data.description,
          category: parsed.data.category,
          priority: parsed.data.priority,
          browser: parsed.data.browser ?? null,
          platform: parsed.data.platform ?? null,
          appVersion: parsed.data.appVersion ?? null,
        }),
    );
    revalidatePath('/configuracoes/sugestoes');
    return { error: null, success: true };
  } catch {
    return { error: 'Não foi possível enviar sua sugestão agora. Tente novamente.' };
  }
}
