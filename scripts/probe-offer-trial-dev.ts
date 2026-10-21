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
  const [counts] = await dbAdmin.execute<{
    total: number;
    offer: number;
    offer_strict: number;
    legacy_strict: number;
  }>(sql`
    WITH cohorts AS (
      SELECT s.enforce_trial_deadline AS strict,
        p.code IN (
          'consultorio_2026', 'clinica_2026_2', 'clinica_2026_3',
          'clinica_2026_4', 'clinica_2026_5'
        ) AS offer_2026
      FROM public.subscriptions s
      JOIN public.plans p ON p.id = s.plan_id
    )
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE offer_2026)::int AS offer,
      count(*) FILTER (WHERE offer_2026 AND strict)::int AS offer_strict,
      count(*) FILTER (WHERE NOT offer_2026 AND strict)::int AS legacy_strict
    FROM cohorts
  `);
  const [marker] = await dbAdmin.execute<{ version: string }>(sql`
    SELECT version FROM _schema_version WHERE version = '0124-offer-2026-trial-deadline'
  `);
  if (
    !column ||
    column.is_nullable !== 'NO' ||
    !column.column_default?.includes('false') ||
    !counts ||
    counts.offer !== counts.offer_strict ||
    counts.legacy_strict !== 0 ||
    !marker
  ) {
    throw new Error('Offer trial column readback mismatch');
  }
  console.log(
    `PASS: DEV trial flag defaults false; ${counts.offer_strict}/${counts.offer} offer subscriptions strict; ${counts.total - counts.offer} legacy subscriptions without strict deadline`,
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unknown trial probe error');
  process.exitCode = 1;
});
