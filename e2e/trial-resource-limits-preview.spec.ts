import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';
import { PgDialect } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { z } from 'zod';

import { assertPreviewRuntimeIsDev, DEV_PROJECT_REF } from './preview-dev-runtime';
import { installVercelBypassForOrigin } from './vercel-bypass';

test.use({
  storageState: { cookies: [], origins: [] },
  trace: 'off',
  video: 'off',
  screenshot: 'off',
});

/** Valid-format synthetic CPF, never sent to a provider. */
function fixtureCpf(index: number): string {
  const digits = Array.from(`9876500${String(index).padStart(2, '0')}`, Number);
  for (const weight of [10, 11]) {
    const remainder =
      digits.reduce((sum, digit, offset) => sum + digit * (weight - offset), 0) % 11;
    digits.push(remainder < 2 ? 0 : 11 - remainder);
  }
  return digits.join('');
}

async function createPatient(page: Page, index: number): Promise<void> {
  await page.goto('/pacientes?novo=1');
  await page.locator('#patient-name').fill(`Paciente sintético ${index}`);
  await page.locator('#patient-cpf').fill(fixtureCpf(index));
  await page.locator('#patient-email').fill(`patient-${index}@example.invalid`);
  await page.getByRole('button', { name: 'Criar paciente', exact: true }).click();
}

test('new trial enforces quotas and integration/invite gates; synthetic verified-invoice seam releases them', async ({
  browser,
}) => {
  test.setTimeout(600_000);
  const baseUrl = process.env.E2E_BASE_URL;
  const databaseUrl = process.env.DATABASE_URL_DEV;
  const authSecret = process.env.SUPABASE_SECRET_KEY_DEV ?? process.env.SECRET_KEY_DEV;
  if (
    process.env.E2E_TRIAL_FIXTURE !== 'ALLOW_DEV_ONLY' ||
    !baseUrl ||
    !databaseUrl ||
    !authSecret
  ) {
    throw new Error('Explicit DEV/Preview fixture preconditions missing; no writes performed');
  }
  const origin = new URL(baseUrl);
  if (
    origin.protocol !== 'https:' ||
    !/^project-[a-z0-9-]+-clinic-os-v2-s-projects\.vercel\.app$/u.test(origin.hostname)
  ) {
    throw new Error('Only the authorized project Preview is allowed');
  }
  const database = new URL(databaseUrl);
  const databaseUser = decodeURIComponent(database.username);
  if (
    !(
      (database.hostname === `db.${DEV_PROJECT_REF}.supabase.co` && databaseUser === 'postgres') ||
      (/^[a-z0-9-]+\.pooler\.supabase\.com$/u.test(database.hostname) &&
        databaseUser === `postgres.${DEV_PROJECT_REF}`)
    )
  ) {
    throw new Error('Only the known DEV database is allowed');
  }
  await assertPreviewRuntimeIsDev(baseUrl);
  const sql = postgres(databaseUrl, { max: 1, prepare: false, ssl: 'require' });
  const runId = randomUUID();
  const clinicId = randomUUID();
  const slug = `trial-ui-${runId.slice(0, 8)}`;
  const email = `trial-${runId}@example.invalid`;
  const password = `Qoro!${randomBytes(24).toString('base64url')}`;
  let userId: string | null = null;
  let clinicCreated = false;
  const stages: string[] = [];
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    storageState: { cookies: [], origins: [] },
  });
  await installVercelBypassForOrigin(context, origin.origin);
  const authAdmin = (suffix: string, method: 'POST' | 'DELETE', body?: unknown) =>
    fetch(`https://${DEV_PROJECT_REF}.supabase.co/auth/v1/admin${suffix}`, {
      method,
      headers: {
        apikey: authSecret,
        authorization: `Bearer ${authSecret}`,
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
  const evidence: {
    runId: string;
    stages: string[];
    status: string;
    cleanup: string;
    paymentScope: string;
  } = {
    runId,
    stages,
    status: 'RUNNING',
    cleanup: 'NOT RUN',
    paymentScope: 'Synthetic invoice seam only; no provider, checkout, payment or message',
  };
  await mkdir('dist', { recursive: true });
  // IDs only: cleanup is prepared before the first Auth write. No credentials.
  await writeFile(
    'dist/trial-preview-fixture.json',
    JSON.stringify({
      runId,
      clinicId,
      slug,
      userId: null,
      cleanup: 'delete only this clinic then its synthetic Auth user',
    }),
  );
  try {
    const auth = await authAdmin('/users', 'POST', { email, password, email_confirm: true });
    if (!auth.ok)
      throw new Error(`Auth DEV refused fixture (${auth.status}); sensitive details suppressed`);
    userId = z.object({ id: z.uuid() }).parse(await auth.json()).id;
    await writeFile(
      'dist/trial-preview-fixture.json',
      JSON.stringify({
        runId,
        clinicId,
        slug,
        userId,
        cleanup: 'delete only this clinic then its synthetic Auth user',
      }),
    );
    await sql.begin(async (tx) => {
      const [catalog] = await tx<
        { plan_id: string; price_id: string }[]
      >`SELECT p.id AS plan_id,pr.id AS price_id FROM public.plans p JOIN public.prices pr ON pr.plan_id=p.id WHERE p.code='clinica_2026_2' AND pr.billing_cycle='monthly' AND pr.active_until IS NULL AND pr.campaign_code IS NULL`;
      if (!catalog) throw new Error('Expected catalog missing');
      await tx`INSERT INTO public.clinics(id,slug,nome,status) VALUES(${clinicId}::uuid,${slug},'Clínica sintética trial UI','trial')`;
      await tx`INSERT INTO public.profiles(id,clinic_id,nome,role,ativo,invite_accepted_at,crm,crm_uf) VALUES(${userId}::uuid,${clinicId}::uuid,'Titular sintético','owner',true,now(),${runId.slice(0, 8)},'CE')`;
      await tx`INSERT INTO public.subscriptions(clinic_id,plan_id,price_id,billing_status,enforce_trial_deadline,trial_ends_at) VALUES(${clinicId}::uuid,${catalog.plan_id}::uuid,${catalog.price_id}::uuid,'trial',true,now()+interval '14 days')`;
    });
    clinicCreated = true;
    const [enrolled] = await sql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM public.trial_access_policies WHERE clinic_id=${clinicId}::uuid AND owner_user_id=${userId}::uuid AND released_at IS NULL`;
    expect(enrolled?.n).toBe(1);
    stages.push('new_subscription_auto_enrolled');
    const page = await context.newPage();
    await page.goto('/login');
    try {
      await page.locator('#email').fill(email);
      await page.locator('input[name="password"]').fill(password);
    } catch {
      throw new Error('Login fixture fields unavailable; credential diagnostics suppressed');
    }
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard(?:\?|$)/u, { timeout: 90_000 });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const counters = page.getByRole('list', { name: 'Uso da avaliação' });
      await expect(counters.getByRole('listitem')).toHaveCount(9);
      await expect(counters).toContainText('Pacientes: 0/10');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
    stages.push('desktop_mobile_trial_counters');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/configuracoes/whatsapp');
    await expect(
      page.getByText('WhatsApp disponível após o pagamento', { exact: true }),
    ).toBeVisible();
    await page.goto('/configuracoes/pagamentos');
    await expect(
      page.getByText('Asaas disponível após o pagamento', { exact: true }),
    ).toBeVisible();
    await page.goto('/equipe');
    await expect(page.getByText(/Convites.*após.*pagamento/u).last()).toBeVisible();
    await expect(page.getByRole('button', { name: /Convidar/u })).toHaveCount(0);
    stages.push('whatsapp_asaas_invites_blocked');
    for (let index = 1; index <= 10; index++) {
      await createPatient(page, index);
      await expect(page).toHaveURL(/\/pacientes\/[a-f0-9-]+(?:\?|$)/u, { timeout: 60_000 });
    }
    await createPatient(page, 11);
    await expect(page.getByText(/Limite da avaliação atingido: 10 pacientes/u)).toBeVisible();
    const [patients] = await sql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM public.patients WHERE clinic_id=${clinicId}::uuid`;
    expect(patients?.n).toBe(10);
    stages.push('ten_patients_via_ui_eleventh_denied_and_persisted');
    for (let index = 1; index <= 14; index++) {
      await sql`INSERT INTO public.procedures(clinic_id,codigo,descricao,valor_padrao,duracao_padrao_min) VALUES(${clinicId}::uuid,${`SEED${index}`},'Procedimento sintético',10,30)`;
    }
    const newProcedure = async (code: string) => {
      await page.goto('/configuracoes/procedimentos');
      await page.getByRole('button', { name: 'Novo procedimento', exact: true }).click();
      await page.locator('#proc-codigo').fill(code);
      await page.locator('#proc-descricao').fill('Procedimento sintético UI');
      await page.locator('#proc-duracao').fill('30');
      await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    };
    await newProcedure('UI15');
    await expect(page.locator('#proc-codigo')).toHaveCount(0);
    await newProcedure('UI16');
    await expect(page.getByText(/Limite da avaliação atingido: 15 procedimentos/u)).toBeVisible();
    const [procedures] = await sql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM public.procedures WHERE clinic_id=${clinicId}::uuid`;
    expect(procedures?.n).toBe(15);
    stages.push('fifteenth_procedure_via_ui_sixteenth_denied');
    // Deliberately not a provider-payment E2E. Invoke the privileged seam with
    // one paid invoice belonging solely to this synthetic fixture.
    const { releaseTrialAfterVerifiedPaymentTx } = await import('../src/lib/trial-access');
    const dialect = new PgDialect();
    await sql.begin(async (tx) => {
      const [invoice] = await tx<
        { id: string }[]
      >`INSERT INTO public.invoices(clinic_id,subscription_id,total_amount,status,due_date,paid_at) SELECT clinic_id,id,397,'paid',current_date,now() FROM public.subscriptions WHERE clinic_id=${clinicId}::uuid RETURNING id`;
      if (!invoice) throw new Error('Synthetic invoice missing');
      await releaseTrialAfterVerifiedPaymentTx(
        {
          execute(statement) {
            const query = dialect.sqlToQuery(statement);
            const parameters = z.array(z.uuid()).parse(query.params);
            return tx.unsafe(query.sql, parameters);
          },
        },
        clinicId,
        invoice.id,
      );
    });
    await page.goto('/dashboard');
    await expect(page.getByRole('list', { name: 'Uso da avaliação' })).toHaveCount(0);
    await page.goto('/equipe');
    await expect(page.getByRole('button', { name: /Convidar/u })).toBeVisible();
    await createPatient(page, 11);
    await expect(page).toHaveURL(/\/pacientes\/[a-f0-9-]+(?:\?|$)/u, { timeout: 60_000 });
    const [after] = await sql<
      { n: number; consumed: number }[]
    >`SELECT (SELECT count(*)::int FROM public.patients WHERE clinic_id=${clinicId}::uuid) AS n,consumed FROM public.trial_resource_usage WHERE clinic_id=${clinicId}::uuid AND metric='patients'`;
    expect(after).toEqual({ n: 11, consumed: 10 });
    stages.push('synthetic_paid_seam_removes_quota_and_restores_invite_ui');
    evidence.status = 'PASS';
  } catch (error) {
    evidence.status = 'FAIL';
    throw error;
  } finally {
    await context.close();
    try {
      if (clinicCreated) {
        const removed = await sql<
          { id: string }[]
        >`DELETE FROM public.clinics WHERE id=${clinicId}::uuid AND slug=${slug} RETURNING id`;
        expect(removed).toHaveLength(1);
      }
      if (userId) {
        const removed = await authAdmin(`/users/${encodeURIComponent(userId)}`, 'DELETE');
        if (!removed.ok) throw new Error(`Synthetic Auth cleanup refused (${removed.status})`);
      }
      const [remaining] = await sql<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM public.clinics WHERE id=${clinicId}::uuid`;
      expect(remaining?.n).toBe(0);
      if (userId) {
        const [remainingUser] = await sql<
          { n: number }[]
        >`SELECT count(*)::int AS n FROM auth.users WHERE id=${userId}::uuid`;
        expect(remainingUser?.n).toBe(0);
      }
      evidence.cleanup = 'PASS';
    } catch (error) {
      evidence.status = 'FAIL';
      evidence.cleanup = 'FAIL';
      throw error;
    } finally {
      await sql.end({ timeout: 5 });
      await writeFile('dist/trial-preview-e2e.json', JSON.stringify(evidence, null, 2));
      await writeFile(`dist/trial-preview-e2e-${runId}.json`, JSON.stringify(evidence, null, 2));
    }
  }
});
