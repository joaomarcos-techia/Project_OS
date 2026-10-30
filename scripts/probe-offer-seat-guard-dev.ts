/** Exercita a trava real com dados DEV existentes e reverte a transação inteira. */
import './_env';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';

import { assertDevContext } from './_env';

class ExpectedRollback extends Error {}

function errorCode(error: unknown): { code: string | null; constraint: string | null } {
  const cause = error instanceof Error ? (error.cause ?? error) : error;
  if (cause == null || typeof cause !== 'object') return { code: null, constraint: null };
  return {
    code: 'code' in cause && typeof cause.code === 'string' ? cause.code : null,
    constraint:
      'constraint_name' in cause && typeof cause.constraint_name === 'string'
        ? cause.constraint_name
        : null,
  };
}

type ClinicIdRow = { clinic_id: string };
type ProfileRow = { plan_id: string; id: string; role: string; crm: string | null };
type UserIdRow = { id: string };

async function main(): Promise<void> {
  const { databaseUrl } = assertDevContext();
  const target = new URL(databaseUrl);
  if (![target.hostname, target.username].join(' ').includes('pqhkirrszzpwezdaqrai')) {
    throw new Error('DEV project ref does not match the expected fixture project');
  }
  const [candidate] = await dbAdmin.execute<ClinicIdRow>(sql`
    SELECT p.clinic_id
    FROM public.profiles p
    JOIN public.subscriptions s ON s.clinic_id = p.clinic_id
    WHERE p.ativo IS TRUE AND p.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.subscription_change_requests change
        WHERE change.subscription_id = s.id AND change.status IN ('scheduled', 'pending_payment'))
    GROUP BY p.clinic_id HAVING count(*) BETWEEN 2 AND 3
    LIMIT 1
  `);
  if (!candidate) throw new Error('No DEV clinic with 2–3 profiles exists');
  const clinicId = candidate.clinic_id;
  const readSnapshot = () =>
    dbAdmin.execute<ProfileRow>(sql`
    SELECT s.plan_id, p.id, p.role, p.crm
    FROM public.subscriptions s
    JOIN public.profiles p ON p.clinic_id = s.clinic_id
    WHERE s.clinic_id = ${clinicId}::uuid AND p.ativo IS TRUE AND p.deleted_at IS NULL
    ORDER BY p.id
  `);
  const before = await readSnapshot();
  try {
    await dbAdmin.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${clinicId}))`);
      const users = await tx.execute<UserIdRow>(sql`
        SELECT id FROM public.profiles
        WHERE clinic_id = ${clinicId}::uuid AND ativo IS TRUE AND deleted_at IS NULL
        ORDER BY id FOR UPDATE
      `);
      const first = users[0];
      const second = users[1];
      if (!first || !second || users.length > 3) throw new Error('Fixture changed before lock');
      await tx.execute(sql`
        UPDATE public.subscriptions SET plan_id =
          (SELECT id FROM public.plans WHERE code = 'clinica_2026_5')
        WHERE clinic_id = ${clinicId}::uuid
      `);
      await tx.execute(sql`
        UPDATE public.profiles SET role = 'attendant'
        WHERE clinic_id = ${clinicId}::uuid AND ativo IS TRUE AND deleted_at IS NULL
      `);
      await tx.execute(sql`
        INSERT INTO public.subscription_change_requests
          (clinic_id, subscription_id, kind, status, from_plan_id, from_price_id,
           to_plan_id, to_price_id, effective_at, idempotency_key)
        SELECT s.clinic_id, s.id, 'downgrade', 'scheduled', s.plan_id, s.price_id,
          p.id, price.id, now() + interval '1 day', 'probe-offer-scheduled-seats'
        FROM public.subscriptions s
        JOIN public.plans p ON p.code = 'consultorio_2026'
        JOIN public.prices price ON price.plan_id = p.id AND price.billing_cycle = 'monthly'
          AND price.active_until IS NULL AND price.campaign_code IS NULL
        WHERE s.clinic_id = ${clinicId}::uuid
      `);
      await tx.execute(
        sql`UPDATE public.profiles SET role = 'doctor' WHERE id = ${first.id}::uuid`,
      );
      try {
        await tx.execute(
          sql`UPDATE public.profiles SET role = 'doctor' WHERE id = ${second.id}::uuid`,
        );
      } catch (error) {
        const { code, constraint } = errorCode(error);
        if (code === '23514' && constraint === 'offer_2026_seat_limit') {
          throw new ExpectedRollback();
        }
        throw error;
      }
      throw new Error('Second doctor was accepted without a paid seat');
    });
  } catch (error) {
    if (!(error instanceof ExpectedRollback)) throw error;
  }
  const after = await readSnapshot();
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error('DEV fixture did not return to its original state');
  }
  console.log(
    'PASS: scheduled downgrade reserves one doctor, second denied, transaction fully rolled back',
  );
}

void main().catch((error: unknown) => {
  const { code, constraint } = errorCode(error);
  console.error(
    `Seat guard probe failed: ${error instanceof Error ? error.name : 'unknown'} (${code ?? 'no-code'}, ${constraint ?? 'no-constraint'})`,
  );
  process.exitCode = 1;
});
