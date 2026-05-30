/**
 * `pnpm tsx scripts/seed-lgpd-bucket.ts`
 *
 * Cria o bucket PRIVADO `lgpd-exports` no Supabase Storage (idempotente).
 * É onde o handler patient.lgpd.export_requested grava JSON+PDF; download só
 * via signed URL (TTL 7d). SÓ dev (assertDevContext).
 */
import { assertDevContext } from './_env';

import { createAdminClient } from '@/lib/auth/supabase-admin';
import { LGPD_EXPORT_BUCKET } from '@/lib/storage/exports';

assertDevContext();

const sb = createAdminClient();

const { data: buckets, error: listErr } = await sb.storage.listBuckets();
if (listErr) throw listErr;

if (buckets.some((b) => b.name === LGPD_EXPORT_BUCKET)) {
  console.log(`[seed-lgpd-bucket] '${LGPD_EXPORT_BUCKET}' já existe — no-op.`);
} else {
  const { error } = await sb.storage.createBucket(LGPD_EXPORT_BUCKET, { public: false });
  if (error) throw error;
  console.log(`[seed-lgpd-bucket] '${LGPD_EXPORT_BUCKET}' criado (privado).`);
}

process.exit(0);
