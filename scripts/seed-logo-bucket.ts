/**
 * `pnpm seed:logo-bucket`
 *
 * Cria o bucket PÚBLICO `clinic-logos` no Supabase Storage (idempotente). É onde
 * o logo do white-label (cabeçalho dos PDFs) é hospedado; URL pública estável
 * consumida pelo @react-pdf no render. SÓ dev (assertDevContext). Em prod, criar
 * via Dashboard (público, MIME png/jpeg/webp, limite 512 KB).
 */
import { assertDevContext } from './_env';

import { createAdminClient } from '@/lib/auth/supabase-admin';
import { CLINIC_LOGO_BUCKET, CLINIC_LOGO_MAX_BYTES } from '@/lib/storage/clinic-assets';

assertDevContext();

const sb = createAdminClient();

const { data: buckets, error: listErr } = await sb.storage.listBuckets();
if (listErr) throw listErr;

const opts = {
  public: true,
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
  fileSizeLimit: CLINIC_LOGO_MAX_BYTES,
};

if (buckets.some((b) => b.name === CLINIC_LOGO_BUCKET)) {
  // Idempotente-UPDATE: aplica público/MIME/limite atuais a um bucket já criado
  // (ex.: criado antes com limite menor). createBucket pula buckets existentes.
  const { error } = await sb.storage.updateBucket(CLINIC_LOGO_BUCKET, opts);
  if (error) throw error;
  console.log(
    `[seed-logo-bucket] '${CLINIC_LOGO_BUCKET}' atualizado (público, limite ${CLINIC_LOGO_MAX_BYTES} bytes).`,
  );
} else {
  const { error } = await sb.storage.createBucket(CLINIC_LOGO_BUCKET, opts);
  if (error) throw error;
  console.log(`[seed-logo-bucket] '${CLINIC_LOGO_BUCKET}' criado (público).`);
}

process.exit(0);
