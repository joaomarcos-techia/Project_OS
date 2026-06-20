/**
 * `pnpm seed:admin-bucket`
 *
 * Cria o bucket PRIVADO `admin-exports` no Supabase Storage (idempotente).
 * É onde o AuditExportService (C15) grava o PDF de auditoria; download só via
 * signed URL (TTL 7d). SÓ dev (assertDevContext). Em prod, criar via Dashboard.
 */
import { assertDevContext } from './_env';

import { createAdminClient } from '@/lib/auth/supabase-admin';
import { ADMIN_EXPORT_BUCKET } from '@/lib/storage/admin-exports';

assertDevContext();

const sb = createAdminClient();

const { data: buckets, error: listErr } = await sb.storage.listBuckets();
if (listErr) throw listErr;

if (buckets.some((b) => b.name === ADMIN_EXPORT_BUCKET)) {
  console.log(`[seed-admin-bucket] '${ADMIN_EXPORT_BUCKET}' já existe — no-op.`);
} else {
  const { error } = await sb.storage.createBucket(ADMIN_EXPORT_BUCKET, { public: false });
  if (error) throw error;
  console.log(`[seed-admin-bucket] '${ADMIN_EXPORT_BUCKET}' criado (privado).`);
}

process.exit(0);
