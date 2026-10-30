/** Read-only preflight/readback for the signup billing-cycle migration in DEV. */
import { readFile } from 'node:fs/promises';

import { config as loadDotenv } from 'dotenv';
import { sql } from 'drizzle-orm';

const DEV_PROJECT_REF = 'pqhkirrszzpwezdaqrai';
const envFile = process.env.QORO_DEV_ENV_FILE;
if (!envFile || process.env.SUPABASE_PROJECT_ENV !== 'dev') {
  throw new Error('exige QORO_DEV_ENV_FILE e SUPABASE_PROJECT_ENV=dev');
}
loadDotenv({ path: envFile });

const databaseUrl = process.env.DATABASE_URL_DEV;
if (!databaseUrl) throw new Error('DATABASE_URL_DEV ausente');
const target = new URL(databaseUrl);
if (
  !target.username.endsWith(`.${DEV_PROJECT_REF}`) ||
  !databaseUrl.includes('sslmode=require') ||
  databaseUrl === process.env.DATABASE_URL_PROD
) {
  throw new Error('a conexão não aponta exclusivamente para o banco DEV esperado');
}

const journal = JSON.parse(await readFile('drizzle/migrations/meta/_journal.json', 'utf8')) as {
  entries: { tag: string }[];
};
if (journal.entries.at(-1)?.tag !== '0128_signup_billing_cycle') {
  throw new Error('0128 não é a última migration do journal local');
}

process.env.DATABASE_URL = databaseUrl;
process.env.DATABASE_URL_RUNTIME = databaseUrl;
const { dbAdmin } = await import('@/lib/db');

{
  const [version] = await dbAdmin.execute<{ version: string }>(sql`
    SELECT version FROM public._schema_version
    WHERE version IN ('0127-offer-2026-seat-catalog-read', '0128-signup-billing-cycle')
    ORDER BY version DESC LIMIT 1
  `);
  const [ledger] = await dbAdmin.execute<{ total: number }>(sql`
    SELECT count(*)::int AS total FROM drizzle.__drizzle_migrations
  `);
  const [column] = await dbAdmin.execute<{ column_default: string }>(sql`
    SELECT column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'signup_sessions'
      AND column_name = 'selected_billing_cycle'
  `);
  const [constraint] = await dbAdmin.execute<{ valid: boolean }>(sql`
    SELECT convalidated AS valid FROM pg_constraint
    WHERE conrelid = 'public.signup_sessions'::regclass
      AND conname = 'signup_sessions_selected_billing_cycle_check'
  `);

  const migrationState = version?.version ?? 'ausente';
  const columnState = column?.column_default === "'monthly'::text" && constraint?.valid === true;
  const ledgerCount = ledger?.total ?? 0;
  console.log(
    JSON.stringify({
      project: 'DEV esperado',
      latestVersion: migrationState,
      ledgerCount,
      journalCount: journal.entries.length,
      billingCycleColumnValid: columnState,
    }),
  );
  if (
    !['0127-offer-2026-seat-catalog-read', '0128-signup-billing-cycle'].includes(migrationState) ||
    ![journal.entries.length - 1, journal.entries.length].includes(ledgerCount) ||
    (migrationState === '0128-signup-billing-cycle') !== columnState
  ) {
    throw new Error('estado de migrations DEV inesperado; nenhuma escrita deve ser feita');
  }
}
