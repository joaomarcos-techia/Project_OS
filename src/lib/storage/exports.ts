/**
 * Supabase Storage helper for LGPD export artifacts (C5).
 *
 * Lives in src/lib (not a context) so it may use the service-role client — the
 * LGPD export handler runs in the cron worker with no user session, and the
 * `lgpd-exports` bucket is private (downloads only via short-lived signed URL).
 *
 * The bucket `lgpd-exports` must be created manually in Supabase (private, no
 * public access) — see docs/runbooks/c5-validation.md.
 *
 * Server-only.
 */
import 'server-only';

import { createAdminClient } from '@/lib/auth/supabase-admin';

export const LGPD_EXPORT_BUCKET = 'lgpd-exports';

export async function uploadLgpdExport(
  path: string,
  bytes: Uint8Array | Buffer,
  contentType: string,
): Promise<void> {
  const sb = createAdminClient();
  const { error } = await sb.storage
    .from(LGPD_EXPORT_BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (error) {
    throw new Error(`[storage] lgpd export upload failed (${path}): ${error.message}`);
  }
}

/** Signed download URL valid for `ttlSeconds` (LGPD export = 7 days). */
export async function createSignedExportUrl(path: string, ttlSeconds: number): Promise<string> {
  const sb = createAdminClient();
  const { data, error } = await sb.storage
    .from(LGPD_EXPORT_BUCKET)
    .createSignedUrl(path, ttlSeconds);
  if (error || !data) {
    throw new Error(`[storage] signed url failed (${path}): ${error?.message ?? 'no data'}`);
  }
  return data.signedUrl;
}
