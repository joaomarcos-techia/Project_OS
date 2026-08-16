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

/**
 * LGPD-003 — remove TODOS os artefatos de exportação de um paciente.
 *
 * O hard-delete tratava banco, auditoria e idempotência e parava ali. O PDF e o
 * JSON continuavam no bucket, e a signed URL emitida antes seguia baixando o
 * arquivo com HTTP 200 depois de o pedido de eliminação ser declarado
 * `completed`. A cópia MAIS COMPLETA dos dados do titular era a que sobrevivia.
 *
 * Escopo: prefixo exato `${clinicId}/${patientId}/`. Nunca um prefixo mais
 * largo — apagar por clínica levaria junto o export de outro titular.
 *
 * Idempotente: objeto ausente não é erro (o job re-roda). Devolve quantos
 * objetos removeu para o caller registrar o resultado em vez de supor.
 *
 * @throws quando o Storage falha de verdade. O caller NÃO pode declarar a
 *         eliminação concluída nesse caso — é o ponto do achado.
 */
export async function deletePatientExports(
  clinicId: string,
  patientId: string,
): Promise<{ removed: number }> {
  const sb = createAdminClient();
  const prefix = `${clinicId}/${patientId}`;

  const { data: entries, error: listError } = await sb.storage
    .from(LGPD_EXPORT_BUCKET)
    .list(prefix, { limit: 1000 });
  if (listError) {
    throw new Error(`[storage] lgpd export list failed (${prefix}): ${listError.message}`);
  }
  if (!entries || entries.length === 0) return { removed: 0 };

  const paths = entries.map((entry) => `${prefix}/${entry.name}`);
  const { error: removeError } = await sb.storage.from(LGPD_EXPORT_BUCKET).remove(paths);
  if (removeError) {
    throw new Error(`[storage] lgpd export remove failed (${prefix}): ${removeError.message}`);
  }
  return { removed: paths.length };
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
