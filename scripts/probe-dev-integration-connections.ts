/** Read-only inventory of tenant integrations in the shared DEV/Preview database. */
import { config as loadDotenv } from 'dotenv';
import { sql } from 'drizzle-orm';

const envFile = process.env.QORO_DEV_ENV_FILE;
const expectedRef = process.env.QORO_EXPECTED_DEV_PROJECT_REF;
if (!envFile || !expectedRef) {
  throw new Error('QORO_DEV_ENV_FILE e QORO_EXPECTED_DEV_PROJECT_REF são obrigatórios');
}
if (process.env.SUPABASE_PROJECT_ENV === 'prod') {
  throw new Error('Inventário DEV recusado: ambiente de produção');
}
loadDotenv({ path: envFile });

const { assertDevContext } = await import('./_env');
const { databaseUrl } = assertDevContext();
const database = new URL(databaseUrl);
if (!`${database.hostname} ${decodeURIComponent(database.username)}`.includes(expectedRef)) {
  throw new Error('Inventário DEV recusado: projeto Supabase inesperado');
}

const { dbAdmin } = await import('../src/lib/db');
const integrationVariables = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'META_APP_ID',
  'META_CONFIG_ID',
  'META_APP_SECRET',
  'META_WEBHOOK_VERIFY_TOKEN',
  'GEMINI_API_KEY',
  'ASAAS_API_KEY',
  'ASAAS_WEBHOOK_TOKEN',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
  'TURNSTILE_SECRET_KEY',
] as const;
for (const name of integrationVariables) {
  console.log(`${name}=${process.env[name]?.trim() ? 'present' : 'absent'}`);
}
const asaasHost = process.env.ASAAS_BASE_URL && new URL(process.env.ASAAS_BASE_URL).hostname;
const asaasMode = !asaasHost
  ? 'unset-runtime-default-sandbox'
  : ['sandbox.asaas.com', 'api-sandbox.asaas.com'].includes(asaasHost)
    ? 'sandbox'
    : asaasHost === 'api.asaas.com'
      ? 'production'
      : 'other';
console.log(`ASAAS_BASE_URL_MODE=${asaasMode}`);
await dbAdmin.transaction(async (tx) => {
  await tx.execute(sql`SET TRANSACTION READ ONLY`);
  const [connections] = await tx.execute<{
    whatsapp_total: number;
    whatsapp_active: number;
    whatsapp_clinics: number;
    asaas_total: number;
    asaas_active: number;
    asaas_key_present: number;
    asaas_accepting_charges: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM public.clinic_whatsapp_numbers) AS whatsapp_total,
      (SELECT count(*)::int FROM public.clinic_whatsapp_numbers WHERE active) AS whatsapp_active,
      (SELECT count(DISTINCT clinic_id)::int FROM public.clinic_whatsapp_numbers WHERE active)
        AS whatsapp_clinics,
      (SELECT count(*)::int FROM public.clinic_payment_accounts) AS asaas_total,
      (SELECT count(*)::int FROM public.clinic_payment_accounts WHERE active) AS asaas_active,
      (SELECT count(*)::int FROM public.clinic_payment_accounts WHERE api_key_encrypted IS NOT NULL)
        AS asaas_key_present,
      (SELECT count(*)::int FROM public.clinic_payment_accounts WHERE accept_new_charges)
        AS asaas_accepting_charges
  `);
  if (!connections) throw new Error('Inventário DEV sem resultado');
  for (const [name, count] of Object.entries(connections)) {
    console.log(`${name}=${count}`);
  }
});
