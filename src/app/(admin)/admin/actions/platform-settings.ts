'use server';

/**
 * Server Actions de Platform Settings (kill-switches globais) — C15 · Platform Settings.
 *
 * Escrita de ESTADO GLOBAL da plataforma (não-tenant). Padrão de
 * actions/impersonation.ts: guardAdminAccess (404 se não super_admin AAL2) →
 * validação → superAdminAction (auditado em super_admin_actions; o fn recebe a
 * tx dbAdmin/BYPASSRLS e faz o UPSERT da flag na MESMA tx do log).
 *
 * NÃO importa withTenant / idempotentMutation / dbAdmin direto — compatível com
 * admin-read-only.test.ts. A escrita vai dentro do fn do superAdminAction.
 */
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { buildRequestContext } from '@/lib/audit/request-context';
import { superAdminAction } from '@/lib/audit/super-admin';
import { requireUser } from '@/lib/auth/tenant-context';
import { platformAnnouncements } from '@/lib/db/schema/infra/platform-announcements';
import { platformSettings } from '@/lib/db/schema/infra/platform-settings';
import { PLATFORM_FLAG_KEYS } from '@/lib/platform-settings';

import { guardAdminAccess } from '../_lib/guard';

export type PlatformFlagState = { error: string | null; ok?: boolean };

/** Schema de valor POR chave — a action só aceita estas flags + formatos. */
const FLAG_SCHEMAS = {
  [PLATFORM_FLAG_KEYS.proactiveEnabled]: z.boolean(),
  [PLATFORM_FLAG_KEYS.aiAgentMode]: z.enum(['normal', 'fallback_only']),
} as const;

export async function setPlatformFlagAction(
  _prev: PlatformFlagState,
  formData: FormData,
): Promise<PlatformFlagState> {
  await guardAdminAccess();

  const key = String(formData.get('key') ?? '');
  const schema = FLAG_SCHEMAS[key as keyof typeof FLAG_SCHEMAS];
  if (!schema) return { error: 'Flag desconhecida.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(String(formData.get('value') ?? ''));
  } catch {
    return { error: 'Valor inválido.' };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) return { error: 'Valor inválido para esta flag.' };
  const value = result.data;

  const user = await requireUser();
  const rc = buildRequestContext(await headers());

  await superAdminAction(
    {
      action: 'platform_flag_set',
      targetClinicId: null,
      payload: { key, value },
      requestContext: rc,
    },
    (tx) =>
      tx
        .insert(platformSettings)
        .values({ key, value, updatedBy: user.userId })
        .onConflictDoUpdate({
          target: platformSettings.key,
          set: { value, updatedBy: user.userId, updatedAt: sql`now()` },
        }),
  );

  // O painel lê fresh (getPlatformSettingsMeta sem cache); revalida a RSC para
  // refletir na hora. O hot path (cron/IA) só pega após o TTL de 30s — aceito.
  revalidatePath('/admin/config');
  return { error: null, ok: true };
}

// ---- Broadcast (platform_announcements) ---------------------------------

export type AnnouncementState = { error: string | null; ok?: boolean };

const AnnouncementInput = z.object({
  title: z.string().trim().max(120).optional(),
  message: z.string().trim().min(1).max(280),
  level: z.enum(['info', 'warning']),
  endsAt: z.string().trim().optional(),
});

const stripHtml = (s: string): string => s.replace(/[<>]/g, '');

/** Publica um aviso global (pop-up único exibido a cada usuário das clínicas). */
export async function publishAnnouncementAction(
  _prev: AnnouncementState,
  formData: FormData,
): Promise<AnnouncementState> {
  await guardAdminAccess();
  const parsed = AnnouncementInput.safeParse({
    title: formData.get('title') ?? '',
    message: formData.get('message') ?? '',
    level: formData.get('level') ?? 'info',
    endsAt: formData.get('endsAt') ?? '',
  });
  if (!parsed.success) return { error: 'Mensagem inválida (1–280 caracteres).' };

  // Sem HTML: remove < e > (defesa extra; o pop-up renderiza como TEXTO e o React
  // já escapa). Conteúdo é exibido a TODAS as clínicas — texto puro.
  const message = stripHtml(parsed.data.message);
  const title = parsed.data.title ? stripHtml(parsed.data.title) : null;
  let endsAt: Date | null = null;
  if (parsed.data.endsAt) {
    const d = new Date(parsed.data.endsAt);
    if (Number.isNaN(d.getTime())) return { error: 'Data de expiração inválida.' };
    endsAt = d;
  }

  const user = await requireUser();
  const rc = buildRequestContext(await headers());
  await superAdminAction(
    {
      action: 'announcement_publish',
      targetClinicId: null,
      payload: { title, message, level: parsed.data.level, endsAt: endsAt?.toISOString() ?? null },
      requestContext: rc,
    },
    (tx) =>
      tx.insert(platformAnnouncements).values({
        title,
        message,
        level: parsed.data.level,
        createdBy: user.userId,
        endsAt,
      }),
  );
  revalidatePath('/admin/config');
  return { error: null, ok: true };
}

/** Desativa um aviso (active=false → some do shell tenant no próximo render). */
export async function deactivateAnnouncementAction(
  _prev: AnnouncementState,
  formData: FormData,
): Promise<AnnouncementState> {
  await guardAdminAccess();
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'ID inválido.' };
  const rc = buildRequestContext(await headers());
  await superAdminAction(
    {
      action: 'announcement_deactivate',
      targetClinicId: null,
      payload: { id: id.data },
      requestContext: rc,
    },
    (tx) =>
      tx.update(platformAnnouncements).set({ active: false }).where(eq(platformAnnouncements.id, id.data)),
  );
  revalidatePath('/admin/config');
  return { error: null, ok: true };
}
