/** Read-only readback of the migrations needed by the integrated Preview. */
import { config as loadDotenv } from 'dotenv';
import { sql } from 'drizzle-orm';

const envFile = process.env.QORO_DEV_ENV_FILE;
const expectedRef = process.env.QORO_EXPECTED_DEV_PROJECT_REF;
if (!envFile || !expectedRef) {
  throw new Error('QORO_DEV_ENV_FILE e QORO_EXPECTED_DEV_PROJECT_REF são obrigatórios');
}
if (process.env.SUPABASE_PROJECT_ENV === 'prod') {
  throw new Error('probe DEV recusado: SUPABASE_PROJECT_ENV=prod');
}
loadDotenv({ path: envFile });

const { assertDevContext } = await import('./_env');
const { databaseUrl } = assertDevContext();
const database = new URL(databaseUrl);
const connectionIdentity = `${database.hostname} ${decodeURIComponent(database.username)}`;
if (!connectionIdentity.includes(expectedRef)) {
  throw new Error('probe DEV recusado: conexão não corresponde ao projeto esperado');
}

const { dbAdmin } = await import('../src/lib/db');
const versions = [
  '0115-payment-account-closure',
  '0116-whatsapp-messaging-health',
  '0117-inbound-message-type',
  '0118-proactive-job-send-key',
] as const;

await dbAdmin.transaction(async (tx) => {
  await tx.execute(sql`SET TRANSACTION READ ONLY`);
  const rows = await tx.execute<{ version: string }>(
    sql`SELECT version FROM _schema_version WHERE version IN (${sql.join(
      versions.map((version) => sql`${version}`),
      sql`, `,
    )})`,
  );
  const applied = new Set(rows.map((row) => row.version));
  for (const version of versions) {
    process.stdout.write(
      `[dev-migrations] ${version}: ${applied.has(version) ? 'aplicada' : 'pendente'}\n`,
    );
  }
});
