/**
 * Supabase Storage helper para PDFs clínicos (C7) — prescrições + documentos.
 *
 * Bucket `clinical-pdfs` é PRIVADO. Upload e download são feitos somente no
 * servidor com service role; o navegador recebe o PDF por uma rota same-origin
 * que revalida sessão, permissão e tenant a cada request. Nenhuma credencial
 * bearer do Storage deve chegar ao DOM.
 *
 * Server-only.
 */
import 'server-only';

import { createAdminClient } from '@/lib/auth/supabase-admin';

export const CLINICAL_PDF_BUCKET = 'clinical-pdfs';

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

/** Download server-side. O path deve vir de uma consulta tenant-scoped autorizada. */
export async function downloadClinicalPdf(path: string): Promise<Blob> {
  const sb = createAdminClient();
  const { data, error } = await sb.storage.from(CLINICAL_PDF_BUCKET).download(path);
  if (error || !data) {
    throw new Error(`[storage] download clínico falhou: ${error?.message ?? 'sem data'}`);
  }
  return data;
}
