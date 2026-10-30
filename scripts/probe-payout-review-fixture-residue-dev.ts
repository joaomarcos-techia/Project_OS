/** Confere se um run interrompido deixou a fixture sintética do E2E de repasses no DEV. */
import './_env';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';

import { assertDevContext } from './_env';

const DEV_PROJECT_REF = 'pqhkirrszzpwezdaqrai';

async function main(): Promise<void> {
  const { databaseUrl } = assertDevContext();
  if (
    !new URL(databaseUrl).username.endsWith(`.${DEV_PROJECT_REF}`) ||
    databaseUrl === process.env.DATABASE_URL_PROD
  ) {
    throw new Error('a conexão não aponta exclusivamente para o banco DEV esperado');
  }
  const [residue] = await dbAdmin.execute<{ clinics: number; users: number }>(sql`
    select
      (select count(*)::int from public.clinics where slug like 'e2e-payout-review-%') as clinics,
      (select count(*)::int from auth.users where email like 'e2e-payout-review-%') as users
  `);
  if (!residue || residue.clinics !== 0 || residue.users !== 0) {
    throw new Error(
      `resíduo de fixture no DEV: clinics=${residue?.clinics}, users=${residue?.users}`,
    );
  }
  console.log('PASS: zero clínicas e usuários Auth da fixture e2e-payout-review no DEV');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'falha desconhecida no probe DEV');
  process.exitCode = 1;
});
