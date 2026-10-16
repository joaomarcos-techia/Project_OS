/**
 * Prova DEV da retirada de preço por meio (0121). As duas escritas adversariais
 * rodam em transações que o PostgreSQL reverte ao recusar as constraints.
 */
import { assertDevContext } from './_env';

import { sql } from 'drizzle-orm';

import { dbAdmin, type Tx } from '@/lib/db';

assertDevContext();

const EXPECTED_MIGRATION_TIME = '1792108800000';
const RETIRED_CONSTRAINTS = [
  'clinic_payment_pricing_policies_mode_chk',
  'procedure_payment_prices_retired_chk',
] as const;

function sqlState(error: unknown): string | null {
  let current: unknown = error;
  const visited = new Set<unknown>();
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = 'cause' in current ? current.cause : null;
  }
  return null;
}

async function expectCheckViolation(name: string, action: (tx: Tx) => Promise<unknown>) {
  let code: string | null = null;
  try {
    await dbAdmin.transaction(async (tx) => {
      await action(tx);
    });
  } catch (error) {
    code = sqlState(error);
  }
  if (code !== '23514')
    throw new Error(`${name}: esperado CHECK 23514, observado ${code ?? 'sem erro'}`);
}

async function main() {
  const [journal] = await dbAdmin.execute<{ applied: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM drizzle.__drizzle_migrations
       WHERE created_at = ${EXPECTED_MIGRATION_TIME}::bigint
    ) AS applied
  `);
  if (!journal?.applied) {
    throw new Error('Migration 0121 não está aplicada neste banco DEV.');
  }

  const constraints = await dbAdmin.execute<{ name: string; valid: boolean }>(sql`
    SELECT conname AS name, convalidated AS valid
      FROM pg_constraint
     WHERE conrelid IN (
       'public.clinic_payment_pricing_policies'::regclass,
       'public.procedure_payment_prices'::regclass
     )
  `);
  for (const name of RETIRED_CONSTRAINTS) {
    if (!constraints.some((constraint) => constraint.name === name && constraint.valid)) {
      throw new Error(`Constraint ${name} ausente ou não validada.`);
    }
  }

  const [state] = await dbAdmin.execute<{ explicitPolicies: number; activePrices: number }>(sql`
    SELECT
      (SELECT count(*)::int FROM public.clinic_payment_pricing_policies
        WHERE mode <> 'absorb_fees') AS "explicitPolicies",
      (SELECT count(*)::int FROM public.procedure_payment_prices
        WHERE active = true) AS "activePrices"
  `);
  if (state?.explicitPolicies !== 0 || state.activePrices !== 0) {
    throw new Error('Ainda há política explícita ou preço por meio ativo no DEV.');
  }

  const [procedure] = await dbAdmin.execute<{ id: string; clinicId: string }>(sql`
    SELECT id::text AS id, clinic_id::text AS "clinicId"
      FROM public.procedures ORDER BY id LIMIT 1
  `);
  if (!procedure) throw new Error('DEV sem procedimento para provar os guardas de INSERT.');

  await expectCheckViolation('política explícita', (tx) =>
    tx.execute(sql`
      INSERT INTO public.clinic_payment_pricing_policies (clinic_id, mode)
      VALUES (${procedure.clinicId}::uuid, 'payment_method_pricing')
    `),
  );
  await expectCheckViolation('preço ativo', (tx) =>
    tx.execute(sql`
      INSERT INTO public.procedure_payment_prices
        (clinic_id, procedure_id, payment_method, gross_amount, active)
      VALUES (${procedure.clinicId}::uuid, ${procedure.id}::uuid, 'pix', 1, true)
    `),
  );

  const [after] = await dbAdmin.execute<{ explicitPolicies: number; activePrices: number }>(sql`
    SELECT
      (SELECT count(*)::int FROM public.clinic_payment_pricing_policies
        WHERE mode <> 'absorb_fees') AS "explicitPolicies",
      (SELECT count(*)::int FROM public.procedure_payment_prices
        WHERE active = true) AS "activePrices"
  `);
  if (after?.explicitPolicies !== 0 || after.activePrices !== 0) {
    throw new Error('O probe deixou dados comerciais ativos.');
  }
  console.log(
    '[pricing-guard-db] PASS DEV: 0121 aplicada, constraints válidas, duas escritas recusadas (23514), sem resíduo ativo.',
  );
}

main().catch((error) => {
  console.error(
    `[pricing-guard-db] FAIL: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
  );
  process.exitCode = 1;
});
