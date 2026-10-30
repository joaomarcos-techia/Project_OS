/** Read-only DEV proof that the subscription page sees its own offer catalog. */
import './_env';

import { sql } from 'drizzle-orm';

import { getPlanChangeOverview } from '@/contexts/billing/internal/plan-changes';
import { dbAdmin } from '@/lib/db';

import { assertDevContext } from './_env';

const DEV_PROJECT_REF = 'pqhkirrszzpwezdaqrai';
const OFFER_CODES = [
  'consultorio_2026',
  'clinica_2026_2',
  'clinica_2026_3',
  'clinica_2026_4',
  'clinica_2026_5',
];

async function main(): Promise<void> {
  const { databaseUrl } = assertDevContext();
  const target = new URL(databaseUrl);
  if (
    !target.username.endsWith(`.${DEV_PROJECT_REF}`) ||
    databaseUrl === process.env.DATABASE_URL_PROD
  ) {
    throw new Error('a conexão não aponta exclusivamente para o banco DEV esperado');
  }

  const subscriptions = await dbAdmin.execute<{ clinic_id: string }>(sql`
    SELECT s.clinic_id
      FROM public.subscriptions s
      JOIN public.plans p ON p.id = s.plan_id
     WHERE p.code IN ('consultorio_2026', 'clinica_2026_2')
     ORDER BY s.created_at DESC
     LIMIT 2
  `);
  if (subscriptions.length === 0) throw new Error('nenhuma assinatura da oferta no DEV');
  const activePlans = await dbAdmin.execute<{ code: string }>(sql`
    SELECT code FROM public.plans WHERE ativo = true AND code IN (
      'consultorio_2026', 'clinica_2026_2', 'clinica_2026_3',
      'clinica_2026_4', 'clinica_2026_5'
    )
  `);
  const activeCodes = activePlans.map((plan) => plan.code).sort();
  if (
    ![2, 5].includes(activeCodes.length) ||
    activeCodes.some((code) => !OFFER_CODES.includes(code)) ||
    !activeCodes.includes('consultorio_2026') ||
    !activeCodes.includes('clinica_2026_2')
  ) {
    throw new Error('ativação parcial ou desconhecida do catálogo DEV');
  }

  let paidActive = 0;
  for (const subscription of subscriptions) {
    const overview = await getPlanChangeOverview(subscription.clinic_id);
    if (
      JSON.stringify(overview.plans.map((plan) => plan.code).sort()) !==
        JSON.stringify(activeCodes) ||
      overview.plans.some((plan) => !plan.seats) ||
      overview.activeDoctors < 0 ||
      overview.activeStaff < 0
    ) {
      throw new Error('a página de assinatura não recebeu catálogo, cotas e contagens coerentes');
    }
    if (overview.current.billingStatus === 'active') paidActive += 1;
  }
  console.log(
    `PASS: ${subscriptions.length} assinatura(s) DEV com ${activeCodes.length} planos próprios e cotas legíveis; ${paidActive} ativa(s) para troca`,
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'falha desconhecida no probe DEV');
  process.exitCode = 1;
});
