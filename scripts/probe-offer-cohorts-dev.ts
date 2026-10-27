/** Leitura agregada de contratos legados e da oferta 2026 no projeto DEV fixado. */
import assert from 'node:assert/strict';

import './_env';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';

import { assertDevContext } from './_env';

const { databaseUrl } = assertDevContext();
const target = new URL(databaseUrl);
if (![target.hostname, target.username].join(' ').includes('pqhkirrszzpwezdaqrai')) {
  throw new Error('DEV project guard failed');
}

const [counts] = await dbAdmin.execute<{
  total: number;
  legacy: number;
  offer: number;
  legacy_strict: number;
  offer_without_strict: number;
  price_plan_mismatch: number;
  legacy_with_offer_seats: number;
  offer_without_seats: number;
  legacy_without_user_limit: number;
  legacy_without_ai_config: number;
  offer_without_ai_config: number;
  legacy_without_owner: number;
  offer_without_owner: number;
  legacy_without_customer: number;
  offer_without_customer: number;
  campaign_contracts: number;
}>(sql`
  with cohorts as (
    select s.clinic_id, s.enforce_trial_deadline as strict,
      p.code, pr.plan_id as price_plan_id, s.plan_id,
      pr.campaign_code, seats.plan_id as seats_plan_id,
      limits.plan_id as users_plan_id,
      config.clinic_id as config_clinic_id,
      customer.clinic_id as customer_clinic_id,
      exists (select 1 from public.profiles owner
        where owner.clinic_id = s.clinic_id and owner.role = 'owner'
          and owner.ativo is true and owner.deleted_at is null) as has_owner,
      p.code in (
        'consultorio_2026', 'clinica_2026_2', 'clinica_2026_3',
        'clinica_2026_4', 'clinica_2026_5'
      ) as is_offer
    from public.subscriptions s
    join public.plans p on p.id = s.plan_id
    join public.prices pr on pr.id = s.price_id
    left join public.plan_seat_limits seats on seats.plan_id = s.plan_id
    left join public.plan_limits limits on limits.plan_id = s.plan_id
      and limits.metric = 'users'
    left join public.ai_clinic_config config on config.clinic_id = s.clinic_id
    left join public.billing_customers customer on customer.clinic_id = s.clinic_id
  )
  select count(*)::int as total,
    count(*) filter (where not is_offer)::int as legacy,
    count(*) filter (where is_offer)::int as offer,
    count(*) filter (where not is_offer and strict)::int as legacy_strict,
    count(*) filter (where is_offer and not strict)::int as offer_without_strict,
    count(*) filter (where price_plan_id <> plan_id)::int as price_plan_mismatch,
    count(*) filter (where not is_offer and seats_plan_id is not null)::int
      as legacy_with_offer_seats,
    count(*) filter (where is_offer and seats_plan_id is null)::int as offer_without_seats,
    count(*) filter (where not is_offer and users_plan_id is null)::int
      as legacy_without_user_limit,
    count(*) filter (where not is_offer and config_clinic_id is null)::int
      as legacy_without_ai_config,
    count(*) filter (where is_offer and config_clinic_id is null)::int
      as offer_without_ai_config,
    count(*) filter (where not is_offer and not has_owner)::int
      as legacy_without_owner,
    count(*) filter (where is_offer and not has_owner)::int
      as offer_without_owner,
    count(*) filter (where not is_offer and customer_clinic_id is null)::int
      as legacy_without_customer,
    count(*) filter (where is_offer and customer_clinic_id is null)::int
      as offer_without_customer,
    count(*) filter (where not is_offer and campaign_code is not null)::int
      as campaign_contracts
  from cohorts
`);

assert.ok(counts, 'contagens do DEV ausentes');
console.log(
  `DEV: ${counts.total} assinaturas; ${counts.legacy} legadas, ${counts.offer} da oferta; ` +
    `${counts.campaign_contracts} contratos de campanha legados`,
);
console.log(
  `DEV: configs de IA ausentes: ${counts.legacy_without_ai_config} legadas, ` +
    `${counts.offer_without_ai_config} da oferta`,
);
console.log(
  `DEV: owner ausente: ${counts.legacy_without_owner} legadas, ` +
    `${counts.offer_without_owner} da oferta; billing customer ausente: ` +
    `${counts.legacy_without_customer} legadas, ${counts.offer_without_customer} da oferta`,
);
assert.equal(counts.legacy_strict, 0, 'contrato legado recebeu deadline da oferta 2026');
assert.equal(counts.offer_without_strict, 0, 'oferta 2026 sem deadline obrigatório');
assert.equal(counts.price_plan_mismatch, 0, 'assinatura usa preço de outro plano');
assert.equal(counts.legacy_with_offer_seats, 0, 'contrato legado recebeu teto categórico novo');
assert.equal(counts.offer_without_seats, 0, 'plano 2026 sem teto categórico');
assert.equal(counts.legacy_without_user_limit, 0, 'contrato legado sem cota de usuários');
console.log('PASS: planos, preços e limites permanecem separados por coorte no DEV');

const ownerStates = await dbAdmin.execute<{
  clinic_status: string;
  billing_status: string;
  clinics: number;
  any_owner: number;
  any_profile: number;
  sandbox_subscription: number;
  test_named: number;
  synthetic_email: number;
}>(sql`
  select c.status as clinic_status, s.billing_status,
    count(*)::int as clinics,
    count(*) filter (where exists (select 1 from public.profiles p
      where p.clinic_id = s.clinic_id and p.role = 'owner'))::int as any_owner,
    count(*) filter (where exists (select 1 from public.profiles p
      where p.clinic_id = s.clinic_id))::int as any_profile,
    count(*) filter (where s.asaas_subscription_id is not null)::int as sandbox_subscription,
    count(*) filter (where lower(c.nome) like '%teste%' or c.slug like '%test%')::int
      as test_named,
    count(*) filter (where customer.email ~* '(@resend[.]dev|@example[.]invalid)$')::int
      as synthetic_email
  from public.subscriptions s
  join public.clinics c on c.id = s.clinic_id
  join public.plans plan on plan.id = s.plan_id
  left join public.billing_customers customer on customer.clinic_id = s.clinic_id
  where plan.code in ('solo', 'clinica', 'pro')
    and not exists (select 1 from public.profiles active_owner
      where active_owner.clinic_id = s.clinic_id and active_owner.role = 'owner'
        and active_owner.ativo is true and active_owner.deleted_at is null)
  group by c.status, s.billing_status
  order by c.status, s.billing_status
`);
for (const state of ownerStates) {
  console.log(
    `DEV legado sem owner ativo: clínica=${state.clinic_status}, ` +
      `assinatura=${state.billing_status}, quantidade=${state.clinics}, ` +
      `com owner histórico=${state.any_owner}, com algum perfil=${state.any_profile}, ` +
      `com assinatura provider=${state.sandbox_subscription}, ` +
      `identificadas como teste=${state.test_named}, ` +
      `e-mail sintético=${state.synthetic_email}`,
  );
}
