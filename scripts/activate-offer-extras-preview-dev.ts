/** Habilita upgrades de 3–5 médicos somente no banco DEV, após deploy da guarda do cadastro. */
import './_env';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';

import { assertDevContext } from './_env';

const DEV_PROJECT_REF = 'pqhkirrszzpwezdaqrai';
const EXPECTED = [
  { code: 'consultorio_2026', monthly: '197.00', annual: '1970.00', doctors: 1 },
  { code: 'clinica_2026_2', monthly: '397.00', annual: '3970.00', doctors: 2 },
  { code: 'clinica_2026_3', monthly: '544.00', annual: '5440.00', doctors: 3 },
  { code: 'clinica_2026_4', monthly: '691.00', annual: '6910.00', doctors: 4 },
  { code: 'clinica_2026_5', monthly: '838.00', annual: '8380.00', doctors: 5 },
] as const;

async function main(): Promise<void> {
  if (process.env.E2E_OFFER_DEV_ACTIVATION !== '1' || process.env.SUPABASE_PROJECT_ENV !== 'dev') {
    throw new Error('exige E2E_OFFER_DEV_ACTIVATION=1 e SUPABASE_PROJECT_ENV=dev');
  }
  const { databaseUrl } = assertDevContext();
  if (
    !new URL(databaseUrl).username.endsWith(`.${DEV_PROJECT_REF}`) ||
    databaseUrl === process.env.DATABASE_URL_PROD
  ) {
    throw new Error('a conexão não aponta exclusivamente para o banco DEV esperado');
  }

  const changed = await dbAdmin.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('qoro-offer-2026-preview-activation'))`,
    );
    const versions = await tx.execute<{ version: string }>(sql`
      select version from public._schema_version where version in (
        '0122-offer-2026-seats', '0123-offer-2026-scheduled-seats',
        '0124-offer-2026-trial-deadline', '0125-offer-2026-pending-catalog',
        '0126-offer-2026-catalog-trigger-fields', '0127-offer-2026-seat-catalog-read'
      )
    `);
    if (versions.length !== 6) throw new Error('migrations da oferta incompletas no DEV');

    const plans = await tx.execute<{
      code: string;
      ativo: boolean;
      monthly: string;
      annual: string;
      doctors: number;
      staff: number;
    }>(sql`
      select p.code, p.ativo, monthly.amount::text as monthly,
        annual.amount::text as annual, limits.doctors, limits.staff
      from public.plans p
      join public.plan_seat_limits limits on limits.plan_id = p.id
      join public.prices monthly on monthly.plan_id = p.id
        and monthly.billing_cycle = 'monthly' and monthly.active_until is null
        and monthly.campaign_code is null
      join public.prices annual on annual.plan_id = p.id
        and annual.billing_cycle = 'annual' and annual.active_until is null
        and annual.campaign_code is null
      where p.code in (
        'consultorio_2026', 'clinica_2026_2', 'clinica_2026_3',
        'clinica_2026_4', 'clinica_2026_5'
      )
      order by p.code for update of p
    `);
    if (plans.length !== EXPECTED.length) throw new Error('catálogo incompleto ou duplicado');
    for (const expected of EXPECTED) {
      const actual = plans.find((plan) => plan.code === expected.code);
      if (
        !actual ||
        actual.monthly !== expected.monthly ||
        actual.annual !== expected.annual ||
        actual.doctors !== expected.doctors ||
        actual.staff !== 3
      ) {
        throw new Error(`preço ou cota divergente para ${expected.code}`);
      }
    }
    if (plans.some((plan) => plan.doctors <= 2 && !plan.ativo)) {
      throw new Error('os dois planos de entrada DEV precisam estar ativos');
    }
    const pending = await tx.execute<{ total: number }>(sql`
      select count(*)::int as total
      from public.signup_sessions s join public.plans p on p.id = s.selected_plan_id
      where p.code in ('clinica_2026_3', 'clinica_2026_4', 'clinica_2026_5')
        and s.billing_attempt_state in ('reserved', 'creation_unknown', 'active')
    `);
    if ((pending[0]?.total ?? 0) !== 0)
      throw new Error('há reserva de cadastro para plano adicional');

    const updated = await tx.execute<{ code: string }>(sql`
      update public.plans set ativo = true
      where code in ('clinica_2026_3', 'clinica_2026_4', 'clinica_2026_5')
        and ativo = false
      returning code
    `);
    const readback = await tx.execute<{ code: string; ativo: boolean }>(sql`
      select code, ativo from public.plans where code in (
        'consultorio_2026', 'clinica_2026_2', 'clinica_2026_3',
        'clinica_2026_4', 'clinica_2026_5'
      )
    `);
    if (readback.length !== EXPECTED.length || readback.some((row) => !row.ativo)) {
      throw new Error('readback da ativação incompleto');
    }
    return updated.length;
  });
  console.log(`PASS: cinco planos ativos somente no DEV; adicionais alterados=${changed}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'falha desconhecida na ativação DEV');
  process.exitCode = 1;
});
