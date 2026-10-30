/** Ativa só os dois planos de entrada no DEV para a prova de Checkout do Preview. */
import './_env';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';

import { assertDevContext } from './_env';

const DEV_PROJECT_REF = 'pqhkirrszzpwezdaqrai';
const ENTRY_PLANS = [
  { code: 'consultorio_2026', amount: '197.00', doctors: 1, staff: 3 },
  { code: 'clinica_2026_2', amount: '397.00', doctors: 2, staff: 3 },
] as const;
const RESERVED_PLANS = ['clinica_2026_3', 'clinica_2026_4', 'clinica_2026_5'] as const;

async function main(): Promise<void> {
  if (process.env.E2E_OFFER_DEV_ACTIVATION !== '1' || process.env.SUPABASE_PROJECT_ENV !== 'dev') {
    throw new Error('ativação exige E2E_OFFER_DEV_ACTIVATION=1 e SUPABASE_PROJECT_ENV=dev');
  }
  const { databaseUrl } = assertDevContext();
  const target = new URL(databaseUrl);
  if (
    !target.username.endsWith(`.${DEV_PROJECT_REF}`) ||
    databaseUrl === process.env.DATABASE_URL_PROD
  ) {
    throw new Error('a conexão não aponta exclusivamente para o banco DEV esperado');
  }

  const changedCount = await dbAdmin.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('qoro-offer-2026-preview-activation'))`,
    );
    const versions = await tx.execute<{ version: string }>(sql`
        select version from public._schema_version
        where version in (
          '0122-offer-2026-seats',
          '0123-offer-2026-scheduled-seats',
          '0124-offer-2026-trial-deadline',
          '0125-offer-2026-pending-catalog',
          '0126-offer-2026-catalog-trigger-fields'
        )
      `);
    if (versions.length !== 5) throw new Error('migrations da oferta incompletas no DEV');

    const plans = await tx.execute<{
      code: string;
      ativo: boolean;
      amount: string;
      doctors: number;
      staff: number;
    }>(sql`
        select p.code, p.ativo, pr.amount::text as amount, limits.doctors, limits.staff
        from public.plans p
        join public.plan_seat_limits limits on limits.plan_id = p.id
        join public.prices pr on pr.plan_id = p.id
          and pr.billing_cycle = 'monthly' and pr.active_until is null
          and pr.campaign_code is null
        where p.code in (
          'consultorio_2026', 'clinica_2026_2', 'clinica_2026_3',
          'clinica_2026_4', 'clinica_2026_5'
        )
        order by p.code
        for update of p
      `);
    if (plans.length !== ENTRY_PLANS.length + RESERVED_PLANS.length) {
      throw new Error('catálogo versionado incompleto ou duplicado');
    }
    for (const expected of ENTRY_PLANS) {
      const actual = plans.find((plan) => plan.code === expected.code);
      if (
        !actual ||
        actual.amount !== expected.amount ||
        actual.doctors !== expected.doctors ||
        actual.staff !== expected.staff
      ) {
        throw new Error(`preço ou cota divergente para ${expected.code}`);
      }
    }
    if (
      RESERVED_PLANS.some((code) => {
        const plan = plans.find((candidate) => candidate.code === code);
        return !plan || plan.ativo;
      })
    ) {
      throw new Error('planos de médico adicional precisam permanecer inativos');
    }

    const changed = await tx.execute<{ code: string }>(sql`
        update public.plans set ativo = true
        where code in ('consultorio_2026', 'clinica_2026_2') and ativo = false
        returning code
      `);
    const readback = await tx.execute<{ code: string; ativo: boolean }>(sql`
        select code, ativo from public.plans
        where code in (
          'consultorio_2026', 'clinica_2026_2', 'clinica_2026_3',
          'clinica_2026_4', 'clinica_2026_5'
        )
        order by code
      `);
    if (
      readback.length !== 5 ||
      readback.some((row) =>
        ENTRY_PLANS.some((plan) => plan.code === row.code) ? !row.ativo : row.ativo,
      )
    ) {
      throw new Error('readback da ativação não corresponde aos dois planos de entrada');
    }
    return changed.length;
  });
  console.log(`PASS: dois planos de entrada ativos somente no DEV; alterados=${changedCount}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'falha desconhecida na ativação DEV');
  process.exitCode = 1;
});
