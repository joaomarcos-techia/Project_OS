/** Prova transacional da trava de catalogo; nenhuma fixture permanece no DEV. */
import './_env';

import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';

import { assertDevContext } from './_env';

class ExpectedRollback extends Error {}

function databaseError(error: unknown): {
  code: string | null;
  constraint: string | null;
  message: string | null;
} {
  let current = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!current || typeof current !== 'object') break;
    const code = 'code' in current && typeof current.code === 'string' ? current.code : null;
    const constraint =
      'constraint_name' in current && typeof current.constraint_name === 'string'
        ? current.constraint_name
        : null;
    if (code) {
      const message =
        'message' in current && typeof current.message === 'string' ? current.message : null;
      return { code, constraint, message };
    }
    current = 'cause' in current ? current.cause : null;
  }
  return { code: null, constraint: null, message: null };
}

async function main(): Promise<void> {
  const { databaseUrl } = assertDevContext();
  const target = new URL(databaseUrl);
  if (![target.hostname, target.username].join(' ').includes('pqhkirrszzpwezdaqrai')) {
    throw new Error('DEV project ref does not match the expected fixture project');
  }

  const [before] = await dbAdmin.execute<{ id: string; amount: string; ativo: boolean }>(sql`
    SELECT p.id, price.amount, p.ativo
    FROM public.plans p
    JOIN public.prices price ON price.plan_id = p.id
      AND price.billing_cycle = 'monthly' AND price.active_until IS NULL
      AND price.campaign_code IS NULL
    WHERE p.code = 'consultorio_2026'
  `);
  if (!before || before.ativo) throw new Error('Inactive DEV offer fixture not found');
  const tokenHash = `probe-offer-catalog-${randomUUID()}`;

  try {
    await dbAdmin.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO public.signup_sessions
          (token_hash, status, idle_expires_at, absolute_expires_at,
           selected_plan_id, billing_attempt_state, billing_attempted_at)
        VALUES (${tokenHash}, 'expired', now() + interval '1 hour',
          now() + interval '1 hour', ${before.id}::uuid, 'reserved', now())
      `);

      for (const [savepoint, statement] of [
        [
          'price_change',
          sql`UPDATE public.prices SET amount = amount + 0.01
            WHERE plan_id = ${before.id}::uuid AND billing_cycle = 'monthly'
              AND active_until IS NULL AND campaign_code IS NULL`,
        ],
        [
          'plan_activation',
          sql`UPDATE public.plans SET ativo = true WHERE id = ${before.id}::uuid`,
        ],
        [
          'price_deletion',
          sql`DELETE FROM public.prices WHERE plan_id = ${before.id}::uuid
            AND billing_cycle = 'monthly' AND active_until IS NULL AND campaign_code IS NULL`,
        ],
        ['plan_deletion', sql`DELETE FROM public.plans WHERE id = ${before.id}::uuid`],
      ] as const) {
        await tx.execute(sql.raw(`SAVEPOINT ${savepoint}`));
        try {
          await tx.execute(statement);
          throw new Error(`${savepoint} was accepted with a reserved Checkout`);
        } catch (error) {
          const { code, constraint } = databaseError(error);
          if (code !== '23514' || constraint !== 'offer_2026_pending_checkout_catalog') {
            throw error;
          }
        } finally {
          await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${savepoint}`));
        }
      }

      await tx.execute(sql`DELETE FROM public.signup_sessions WHERE token_hash = ${tokenHash}`);
      await tx.execute(sql`
        UPDATE public.prices SET amount = amount + 0.01
        WHERE plan_id = ${before.id}::uuid AND billing_cycle = 'monthly'
          AND active_until IS NULL AND campaign_code IS NULL
      `);
      await tx.execute(sql`UPDATE public.plans SET ativo = true WHERE id = ${before.id}::uuid`);
      await tx.execute(sql`
        DELETE FROM public.prices WHERE plan_id = ${before.id}::uuid
          AND billing_cycle = 'monthly' AND active_until IS NULL AND campaign_code IS NULL
      `);
      throw new ExpectedRollback();
    });
  } catch (error) {
    if (!(error instanceof ExpectedRollback)) throw error;
  }

  const [after] = await dbAdmin.execute<{ amount: string; ativo: boolean; residue: number }>(sql`
    SELECT price.amount, p.ativo,
      (SELECT count(*)::int FROM public.signup_sessions WHERE token_hash = ${tokenHash}) AS residue
    FROM public.plans p
    JOIN public.prices price ON price.plan_id = p.id
      AND price.billing_cycle = 'monthly' AND price.active_until IS NULL
      AND price.campaign_code IS NULL
    WHERE p.id = ${before.id}::uuid
  `);
  if (!after || after.amount !== before.amount || after.ativo !== before.ativo || after.residue) {
    throw new Error('Catalog probe left a DEV change');
  }
  console.log(
    'PASS: pending offer blocks price/plan changes and deletion; after removal changes work; rollback clean',
  );
}

void main().catch((error: unknown) => {
  const { code, constraint, message } = databaseError(error);
  console.error(
    `Catalog guard probe failed: ${error instanceof Error ? error.name : 'unknown'} (${code ?? 'no-code'}, ${constraint ?? 'no-constraint'}, ${code === '42703' ? message?.slice(0, 120) : 'details omitted'})`,
  );
  process.exitCode = 1;
});
