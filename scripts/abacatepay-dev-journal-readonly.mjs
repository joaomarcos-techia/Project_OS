/** Catalog-only DEV probe. Never applies SQL or reads application records. */
import { readFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import postgres from 'postgres';

const ref = 'pqhkirrszzpwezdaqrai';
const settings = parse(
  await readFile(process.env.QORO_LOCAL_ENV_FILE ?? 'C:/dev/ClinicaOS_V2/.env.local'),
);
const value = settings.DATABASE_URL_DEV;
if (!value || process.env.SUPABASE_PROJECT_ENV === 'prod')
  throw new Error('DEV database configuration required');
const url = new URL(value);
if (
  decodeURIComponent(url.username) !== `postgres.${ref}` ||
  !/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname)
)
  throw new Error('Unexpected database target');
if (url.port === '6543') url.port = '5432';
const sql = postgres(url.toString(), {
  max: 1,
  prepare: false,
  ssl: 'require',
  connect_timeout: 15,
});
try {
  const result = await sql.begin(async (tx) => {
    await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    await tx`SET LOCAL statement_timeout='10s'`;
    const [identity] =
      await tx`SELECT current_setting('transaction_read_only') read_only, current_database() database`;
    if (identity?.read_only !== 'on') throw new Error('Read-only mode missing');
    const history =
      await tx`SELECT id,hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY id`;
    const [schema] =
      await tx`SELECT to_regclass('billing_gateway.pix_replacement_intents') IS NOT NULL pix_intents`;
    return {
      projectRef: ref,
      database: identity.database,
      journalEntries: history.length,
      tail: history.slice(-10),
      pixIntentsPresent: schema?.pix_intents === true,
      readOnly: true,
    };
  });
  process.stdout.write(JSON.stringify(result) + '\n');
} catch {
  process.stderr.write('DEV journal readback failed; database details suppressed\n');
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
