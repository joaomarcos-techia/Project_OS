/** Read-only proof that tenant runtime can read only the global seat catalog. */
import './_env';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';

import { assertDevContext } from './_env';

const DEV_PROJECT_REF = 'pqhkirrszzpwezdaqrai';

async function main(): Promise<void> {
  const { databaseUrl } = assertDevContext();
  const target = new URL(databaseUrl);
  if (
    !target.username.endsWith(`.${DEV_PROJECT_REF}`) ||
    databaseUrl === process.env.DATABASE_URL_PROD
  ) {
    throw new Error('a conexão não aponta exclusivamente para o banco DEV esperado');
  }

  const [access] = await dbAdmin.execute<{
    anon_read: boolean;
    authenticated_read: boolean;
    force_rls: boolean;
    read_policies: number;
  }>(sql`
    SELECT has_table_privilege('anon', 'public.plan_seat_limits', 'SELECT') AS anon_read,
      has_table_privilege('authenticated', 'public.plan_seat_limits', 'SELECT') AS authenticated_read,
      c.relforcerowsecurity AS force_rls,
      (SELECT count(*)::int FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'plan_seat_limits'
          AND cmd = 'SELECT' AND 'authenticated' = ANY(roles)) AS read_policies
    FROM pg_class c WHERE c.oid = 'public.plan_seat_limits'::regclass
  `);
  if (
    !access ||
    access.anon_read ||
    !access.authenticated_read ||
    !access.force_rls ||
    access.read_policies !== 1
  ) {
    throw new Error('ACL ou RLS do catálogo de vagas não corresponde ao contrato');
  }

  const [writeGateAccess] = await dbAdmin.execute<{
    clinics_read: boolean;
    subscriptions_read: boolean;
    profiles_read: boolean;
  }>(sql`
    SELECT has_table_privilege('authenticated', 'public.clinics', 'SELECT') AS clinics_read,
      has_table_privilege('authenticated', 'public.subscriptions', 'SELECT') AS subscriptions_read,
      has_table_privilege('authenticated', 'public.profiles', 'SELECT') AS profiles_read
  `);
  if (!writeGateAccess?.clinics_read || !writeGateAccess.subscriptions_read) {
    throw new Error('a role authenticated não consegue ler as tabelas do gate de escrita');
  }

  const rows = await withTenant('00000000-0000-4000-8000-000000000001', (tx) =>
    tx.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM public.plan_seat_limits`),
  );
  if (Number(rows[0]?.count) !== 5) throw new Error('o runtime tenant não leu os cinco tetos');
  console.log(
    `PASS: catálogo de vagas e gate legíveis; profiles SELECT=${writeGateAccess.profiles_read}`,
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'falha desconhecida no probe DEV');
  process.exitCode = 1;
});
