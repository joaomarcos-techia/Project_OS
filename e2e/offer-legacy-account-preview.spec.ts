import postgres from 'postgres';

import { expect, test } from '@playwright/test';

import { assertPreviewRuntimeIsDev } from './preview-dev-runtime';
import { installVercelBypassForOrigin } from './vercel-bypass';

test.use({
  storageState: { cookies: [], origins: [] },
  extraHTTPHeaders: {},
  screenshot: 'off',
  trace: 'off',
  video: 'off',
});

test('conta legada mantém seu contrato na assinatura do Preview', async ({ browser }) => {
  const baseUrl = process.env.E2E_BASE_URL;
  const email = process.env.E2E_LEGACY_EMAIL ?? process.env['2E2_UI_EMAIL'];
  const password = process.env.E2E_LEGACY_PASSWORD ?? process.env['2E2_UI_PASSWORD'];
  const databaseUrl = process.env.DATABASE_URL_DEV ?? process.env.DATABASE_URL;
  test.skip(!baseUrl || !email || !password || !databaseUrl, 'credenciais legadas/DEV ausentes');
  if (!baseUrl || !email || !password || !databaseUrl) return;

  const target = new URL(baseUrl);
  if (
    target.protocol !== 'https:' ||
    target.hostname === 'app.qoro.dev' ||
    !target.hostname.endsWith('.vercel.app')
  ) {
    throw new Error('esta prova aceita somente Preview Vercel');
  }
  const database = new URL(databaseUrl);
  if (![database.hostname, database.username].join(' ').includes('pqhkirrszzpwezdaqrai')) {
    throw new Error('esta prova aceita somente o banco DEV esperado');
  }
  await assertPreviewRuntimeIsDev(baseUrl);

  const sql = postgres(databaseUrl, { max: 1, ssl: 'require', prepare: false });
  let contract: {
    role: string;
    plan_code: string;
    plan_name: string;
    price_amount: string;
    billing_cycle: string;
    strict: boolean;
    seat_limits: number;
  };
  try {
    const rows = await sql<(typeof contract)[]>`
      select profile.role, plan.code as plan_code, plan.name as plan_name,
             price.amount::text as price_amount, price.billing_cycle::text,
             sub.enforce_trial_deadline as strict,
             (select count(*)::int from public.plan_seat_limits seats
               where seats.plan_id = sub.plan_id) as seat_limits
        from auth.users identity
        join public.profiles profile on profile.id = identity.id
        join public.subscriptions sub on sub.clinic_id = profile.clinic_id
        join public.plans plan on plan.id = sub.plan_id
        join public.prices price on price.id = sub.price_id
       where lower(identity.email) = lower(${email})
    `;
    if (rows.length !== 1 || !rows[0]) throw new Error('conta legada de teste não localizada');
    contract = rows[0];
  } finally {
    await sql.end({ timeout: 5 });
  }
  if (
    contract.role !== 'owner' ||
    !['solo', 'clinica', 'pro'].includes(contract.plan_code) ||
    contract.strict ||
    contract.seat_limits !== 0
  ) {
    throw new Error('conta de teste não representa um contrato legado preservado');
  }

  const context = await browser.newContext({
    baseURL: baseUrl,
    storageState: { cookies: [], origins: [] },
  });
  await installVercelBypassForOrigin(context, target.origin);
  try {
    const page = await context.newPage();
    await page.goto('/login');
    await page.locator('#email').fill(email);
    await page.getByLabel('Senha', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/u, { timeout: 60_000 });
    await page.goto('/configuracoes/assinatura');
    await expect(
      page.getByRole('heading', { level: 2, name: contract.plan_name, exact: true }),
    ).toBeVisible();
    const expectedPrice = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(Number(contract.price_amount));
    await expect(page.locator('body')).toContainText(expectedPrice);
    await expect(page.getByText('Mudar para anual')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Contratar \+\d+ médico/u })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
