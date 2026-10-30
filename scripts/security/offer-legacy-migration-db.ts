/** Contrato legado antes/depois das migrations da oferta 2026, em Postgres descartável. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { startScratchSchema } from './scratch-schema';

const clinicId = randomUUID();
const userId = randomUUID();
const snapshots: Array<{
  planId: string;
  priceId: string;
  amount: string;
  userLimit: number;
  trialEndsAt: Date;
}> = [];

const cluster = await startScratchSchema({
  port: 55482,
  beforeMigration: {
    file: '0122_offer_2026_seats.sql',
    async run(sql) {
      const [schema] = await sql<{ seats_present: boolean; strict_present: boolean }[]>`
        select to_regclass('public.plan_seat_limits') is not null as seats_present,
          exists (
            select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'subscriptions'
               and column_name = 'enforce_trial_deadline'
          ) as strict_present`;
      assert.deepEqual(schema, { seats_present: false, strict_present: false });

      const [legacy] = await sql<
        { plan_id: string; price_id: string; amount: string; user_limit: number }[]
      >`
        select p.id as plan_id, pr.id as price_id, pr.amount::text as amount,
               l.limit_value as user_limit
          from plans p
          join prices pr on pr.plan_id = p.id
          join plan_limits l on l.plan_id = p.id and l.metric = 'users'
         where p.code = 'clinica' and pr.billing_cycle = 'monthly'
           and pr.campaign_code = 'fundador' and pr.active_until is null`;
      assert.ok(legacy, 'catálogo legado com preço de campanha ausente');

      const trialEndsAt = new Date('2026-09-01T12:00:00.000Z');
      snapshots.push({
        planId: legacy.plan_id,
        priceId: legacy.price_id,
        amount: legacy.amount,
        userLimit: legacy.user_limit,
        trialEndsAt,
      });
      await sql`insert into auth.users (id, email, email_confirmed_at)
        values (${userId}::uuid, 'legacy-migration@example.invalid', now())`;
      await sql`insert into clinics (id, slug, nome, status)
        values (${clinicId}::uuid, 'legacy-migration-test', 'Legacy Migration Test', 'active')`;
      await sql`insert into profiles (id, clinic_id, nome, role, ativo)
        values (${userId}::uuid, ${clinicId}::uuid, 'Synthetic Owner', 'owner', true)`;
      await sql`insert into ai_clinic_config (clinic_id) values (${clinicId}::uuid)`;
      await sql`insert into subscriptions (
          clinic_id, plan_id, price_id, billing_status, trial_ends_at,
          asaas_subscription_id
        ) values (
          ${clinicId}::uuid, ${legacy.plan_id}::uuid, ${legacy.price_id}::uuid,
          'active', ${trialEndsAt}, 'sub_synthetic_legacy'
        )`;
    },
  },
});

try {
  const original = snapshots[0];
  assert.ok(original, 'snapshot anterior à oferta ausente');
  const [current] = await cluster.sql<
    {
      plan_id: string;
      plan_code: string;
      price_id: string;
      amount: string;
      campaign_code: string | null;
      billing_cycle: string;
      user_limit: number;
      trial_ends_at: Date;
      strict: boolean;
      seats: number;
      owners: number;
      configs: number;
    }[]
  >`
    select s.plan_id, p.code as plan_code, s.price_id,
           pr.amount::text as amount, pr.campaign_code,
           pr.billing_cycle::text,
           l.limit_value as user_limit, s.trial_ends_at,
           s.enforce_trial_deadline as strict,
           (select count(*)::int from plan_seat_limits sl
             where sl.plan_id = s.plan_id) as seats,
           (select count(*)::int from profiles x
             where x.clinic_id = s.clinic_id and x.role = 'owner') as owners,
           (select count(*)::int from ai_clinic_config x
             where x.clinic_id = s.clinic_id) as configs
      from subscriptions s
      join plans p on p.id = s.plan_id
      join prices pr on pr.id = s.price_id
      join plan_limits l on l.plan_id = s.plan_id and l.metric = 'users'
     where s.clinic_id = ${clinicId}::uuid`;
  assert.ok(current, 'assinatura histórica desapareceu');
  assert.equal(current.plan_id, original.planId);
  assert.equal(current.plan_code, 'clinica');
  assert.equal(current.price_id, original.priceId);
  assert.equal(current.amount, original.amount);
  assert.equal(current.campaign_code, 'fundador');
  assert.equal(current.billing_cycle, 'monthly');
  assert.equal(current.user_limit, original.userLimit);
  assert.equal(current.trial_ends_at.toISOString(), original.trialEndsAt.toISOString());
  assert.equal(current.strict, false);
  assert.equal(current.seats, 0);
  assert.equal(current.owners, 1);
  assert.equal(current.configs, 1);
  assert.ok(original.userLimit >= 5, 'teste exige a cota histórica de cinco usuários');
  for (let index = 0; index < 4; index += 1) {
    const doctorId = randomUUID();
    await cluster.sql`insert into auth.users (id, email, email_confirmed_at)
      values (${doctorId}::uuid, ${`legacy-doctor-${index}@example.invalid`}, now())`;
    await cluster.sql`insert into profiles (id, clinic_id, nome, role, ativo)
      values (${doctorId}::uuid, ${clinicId}::uuid, 'Synthetic Doctor', 'doctor', true)`;
  }
  const [legacySeats] = await cluster.sql<{ users: number; doctors: number }[]>`
    select count(*)::int as users,
      count(*) filter (where role = 'doctor')::int as doctors
      from profiles where clinic_id = ${clinicId}::uuid`;
  assert.deepEqual(legacySeats, { users: 5, doctors: 4 });

  const [offer] = await cluster.sql<{ plans: number; priced: number; seat_limits: number }[]>`
    select count(*)::int as plans,
      count(*) filter (where pr.amount is not null)::int as priced,
      count(*) filter (where sl.plan_id is not null)::int as seat_limits
      from plans p
      left join prices pr on pr.plan_id = p.id and pr.billing_cycle = 'monthly'
        and pr.campaign_code is null and pr.active_until is null
      left join plan_seat_limits sl on sl.plan_id = p.id
     where p.code in (
       'consultorio_2026', 'clinica_2026_2', 'clinica_2026_3',
       'clinica_2026_4', 'clinica_2026_5'
     )`;
  assert.deepEqual(offer, { plans: 5, priced: 5, seat_limits: 5 });
  console.log('PASS: contrato legado, preço de campanha, trial e configuração preservados');
  console.log('PASS: teto médico de 2026 não foi aplicado à conta legada de cinco usuários');
  console.log('PASS: catálogo e limites 2026 criados separadamente');
} finally {
  await cluster.stop();
}
