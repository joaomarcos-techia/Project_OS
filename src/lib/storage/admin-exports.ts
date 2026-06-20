/**
 * Supabase Storage helper para exports do Platform Admin (C15).
 *
 * Bucket `admin-exports` é PRIVADO (download só via signed URL). Criado
 * manualmente no Supabase — ver runbook C15. Mesmo pattern de
 * src/lib/storage/exports.ts (LGPD). TTL padrão 7 dias (brief).
 *
 * Server-only.
 */
import 'server-only';

import { createAdminClient } from '@/lib/auth/supabase-admin';

export const ADMIN_EXPORT_BUCKET = 'admin-exports';
export const ADMIN_EXPORT_TTL_SECONDS = 7 * 86_400; // 7 dias

export async function uploadAdminExport(
  path: string,
  bytes: Uint8Array | Buffer,
  contentType = 'application/pdf',
): Promise<void> {
  const sb = createAdminClient();
  const { error } = await sb.storage
    .from(ADMIN_EXPORT_BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (error) {
    throw new Error(`[storage] admin export upload falhou (${path}): ${error.message}`);
  }
}

export async function createSignedAdminExportUrl(
  path: string,
  ttlSeconds: number = ADMIN_EXPORT_TTL_SECONDS,
): Promise<string> {
  const sb = createAdminClient();
  const { data, error } = await sb.storage
    .from(ADMIN_EXPORT_BUCKET)
    .createSignedUrl(path, ttlSeconds);
  if (error || !data) {
    throw new Error(`[storage] admin export signed url falhou (${path}): ${error?.message ?? 'sem data'}`);
  }
  return data.signedUrl;
}
