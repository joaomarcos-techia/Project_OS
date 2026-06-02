/**
 * Supabase Storage helper para PDFs clínicos (C7) — prescrições + documentos.
 *
 * Bucket `clinical-pdfs` é PRIVADO (download só via signed URL curta). Deve ser
 * criado manualmente no Supabase — ver docs/runbooks/c7-validation.md. Usa o
 * service-role client porque a emissão roda em Server Action server-side e o
 * objeto não é público.
 *
 * Server-only.
 */
import 'server-only';

import { createAdminClient } from '@/lib/auth/supabase-admin';

export const CLINICAL_PDF_BUCKET = 'clinical-pdfs';

/** TTL padrão da signed URL de PDF clínico (24h — §7.18). */
export const CLINICAL_SIGNED_URL_TTL_SECONDS = 86_400;

/**
 * Upload reutilizável (§7.7). `upsert:true` ⇒ regeneração sobrescreve o MESMO
 * path (Ponto 3): o histórico jurídico vem dos snapshots persistidos + audit,
 * não de múltiplas versões físicas do PDF.
 */
export async function uploadStorageFile(
  bucket: string,
  path: string,
  bytes: Uint8Array | Buffer,
  contentType = 'application/pdf',
): Promise<void> {
  const sb = createAdminClient();
  const { error } = await sb.storage.from(bucket).upload(path, bytes, {
    contentType,
    upsert: true,
  });
  if (error) {
    throw new Error(`[storage] upload falhou (${bucket}/${path}): ${error.message}`);
  }
}

/** Signed URL de download (default 24h). */
export async function createClinicalSignedUrl(
  path: string,
  ttlSeconds = CLINICAL_SIGNED_URL_TTL_SECONDS,
): Promise<string> {
  const sb = createAdminClient();
  const { data, error } = await sb.storage
    .from(CLINICAL_PDF_BUCKET)
    .createSignedUrl(path, ttlSeconds);
  if (error || !data) {
    throw new Error(`[storage] signed url falhou (${path}): ${error?.message ?? 'sem data'}`);
  }
  return data.signedUrl;
}
