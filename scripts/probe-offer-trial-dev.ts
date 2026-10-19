/** Read-only check after migration 0124. Never prints connection details. */
import './_env';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';

import { assertDevContext } from './_env';

async function main(): Promise<void> {
  const { databaseUrl } = assertDevContext();
  const target = new URL(databaseUrl);
  if (![target.hostname, target.username].join(' ').includes('pqhkirrszzpwezdaqrai')) {
    throw new Error('DEV project guard failed');
  }

  const [column] = await dbAdmin.execute<{
    column_default: string | null;
    is_nullable: string;
  }>(sql`
    SELECT column_default, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscriptions'
      AND column_name = 'enforce_trial_deadline'
  `);
  const [counts] = await dbAdmin.execute<{ total: number; strict: number }>(sql`
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE enforce_trial_deadline)::int AS strict
    FROM public.subscriptions
  `);
  const [marker] = await dbAdmin.execute<{ version: string }>(sql`
    SELECT version FROM _schema_version WHERE version = '0124-offer-2026-trial-deadline'
  `);
  if (
    !column ||
    column.is_nullable !== 'NO' ||
    !column.column_default?.includes('false') ||
    !counts ||
    counts.strict !== 0 ||
    !marker
  ) {
    throw new Error('Offer trial column readback mismatch');
  }
  console.log(
    `PASS: DEV trial flag defaults false; ${counts.total} existing subscriptions unchanged`,
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unknown trial probe error');
  process.exitCode = 1;
});
