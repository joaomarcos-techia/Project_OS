/** Read-only catalog and guard probe. Requires an explicitly verified DEV URL. */
import './_env';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';

import { assertDevContext } from './_env';

async function main(): Promise<void> {
  const { databaseUrl } = assertDevContext();
  const target = new URL(databaseUrl);
  if (![target.hostname, target.username].join(' ').includes('pqhkirrszzpwezdaqrai')) {
    throw new Error('DEV project ref does not match the expected fixture project');
  }
  const plans = await dbAdmin.execute<{
    code: string;
    ativo: boolean;
    doctors: number;
    staff: number;
    monthly: string;
    annual: string;
  }>(sql`
      SELECT p.code, p.ativo, l.doctors, l.staff,
        monthly.amount AS monthly, annual.amount AS annual
      FROM public.plans p
      JOIN public.plan_seat_limits l ON l.plan_id = p.id
      JOIN public.prices monthly ON monthly.plan_id = p.id
        AND monthly.billing_cycle = 'monthly' AND monthly.active_until IS NULL
      JOIN public.prices annual ON annual.plan_id = p.id
        AND annual.billing_cycle = 'annual' AND annual.active_until IS NULL
      ORDER BY l.doctors
    `);
  const [guard] = await dbAdmin.execute<{
    rls: boolean;
    force_rls: boolean;
    policies: number;
    triggers: number;
  }>(sql`
      SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls,
        (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public'
          AND tablename = 'plan_seat_limits') AS policies,
        (SELECT count(*)::int FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass
          AND tgname = 'profiles_offer_2026_seats' AND NOT tgisinternal) AS triggers
      FROM pg_class c WHERE c.oid = 'public.plan_seat_limits'::regclass
    `);
  const [versions] = await dbAdmin.execute<{ applied: number }>(sql`
    SELECT count(*)::int AS applied FROM public._schema_version
    WHERE version IN ('0122-offer-2026-seats', '0123-offer-2026-scheduled-seats')
  `);
  const expected = [
    ['consultorio_2026', 1, 3, '197.00', '1970.00'],
    ['clinica_2026_2', 2, 3, '397.00', '3970.00'],
    ['clinica_2026_3', 3, 3, '544.00', '5440.00'],
    ['clinica_2026_4', 4, 3, '691.00', '6910.00'],
    ['clinica_2026_5', 5, 3, '838.00', '8380.00'],
  ];
  const actual = plans.map((row) => [row.code, row.doctors, row.staff, row.monthly, row.annual]);
  const inactive = plans.every((row) => !row.ativo);
  const previewActive = plans.every((row) =>
    ['consultorio_2026', 'clinica_2026_2'].includes(row.code) ? row.ativo : !row.ativo,
  );
  const extrasActive = plans.every((row) => row.ativo);
  if (
    JSON.stringify(actual) !== JSON.stringify(expected) ||
    (!inactive && !previewActive && !extrasActive)
  ) {
    throw new Error('Offer catalog does not match either allowed DEV activation state');
  }
  if (
    !guard?.rls ||
    !guard.force_rls ||
    guard.policies !== 1 ||
    guard.triggers !== 1 ||
    versions?.applied !== 2
  ) {
    throw new Error('Seat guard or deny-by-default RLS is missing');
  }
  console.log(
    `PASS: five plans (${extrasActive ? 'five Preview plans active' : previewActive ? 'two Preview entries active' : 'inactive'}), exact prices, migrations 0122–0123, guard and forced RLS with authenticated catalog read`,
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unknown catalog probe error');
  process.exitCode = 1;
});
