import { expect, test, type BrowserContext } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_REPORT_MATRIX === 'ALLOW_READ_ONLY_PRODUCTION';
const baseUrl = process.env.E2E_BASE_URL;
const sharedPassword = process.env.E2E_TENANT_PASSWORD;

const accounts = [
  { role: 'owner', email: process.env.E2E_OWNER_EMAIL },
  { role: 'doctor', email: process.env.E2E_DOCTOR_EMAIL },
  { role: 'attendant', email: process.env.E2E_ATTENDANT_EMAIL },
  { role: 'financial', email: process.env.E2E_FINANCIAL_EMAIL },
] as const;
const ownerBEmail = process.env.E2E_TENANT_B_EMAIL;
const periods = [
  { key: '7d', days: 7, label: 'Últimos 7 dias' },
  { key: '30d', days: 30, label: 'Últimos 30 dias' },
  { key: '90d', days: 90, label: 'Últimos 90 dias' },
] as const;

test.use({
  storageState: { cookies: [], origins: [] },
  trace: 'retain-on-failure',
  video: 'off',
  screenshot: 'only-on-failure',
  actionTimeout: 30_000,
  navigationTimeout: 60_000,
});

function productionConfig(): { url: string; key: string; databaseUrl: string } {
  const databaseUrl = process.env.DATABASE_URL_PROD;
  const adminSecret = process.env.SUPABASE_SECRET_KEY_PROD;
  if (!databaseUrl || !adminSecret) throw new Error('Credenciais operacionais PROD ausentes.');
  const projectRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
  if (!projectRef || !/^[a-z]{20}$/u.test(projectRef)) {
    throw new Error('Project ref de produção inválido.');
  }
  return { url: `https://${projectRef}.supabase.co`, key: adminSecret, databaseUrl };
}

async function signInContext(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<void> {
  if (!baseUrl) throw new Error('E2E_BASE_URL ausente.');
  await context.clearCookies();
  let nextCookies: Array<{ name: string; value: string }> = [];
  const { url, key } = productionConfig();
  const client = createSsrClient(url, key, {
    cookies: {
      getAll: () => [],
      setAll: (items) => {
        nextCookies = items.map(({ name, value }) => ({ name, value }));
      },
    },
    auth: { autoRefreshToken: false, persistSession: true },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || nextCookies.length === 0) {
    throw new Error(error?.message ?? 'Login não produziu sessão.');
  }
  await context.addCookies(
    nextCookies
      .filter(({ value }) => value !== '')
      .map(({ name, value }) => ({ name, value, url: baseUrl })),
  );
}

function money(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

async function extractPdf(buffer: Buffer): Promise<{ pages: number; text: string }> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
  const document = await task.promise;
  let text = '';
  for (let index = 1; index <= document.numPages; index += 1) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    text += ` ${content.items.map((item) => ('str' in item ? item.str : '')).join(' ')}`;
  }
  const pages = document.numPages;
  await task.destroy();
  return { pages, text: normalize(text) };
}

async function integerMetric(
  page: import('@playwright/test').Page,
  label: string,
): Promise<number> {
  const group = page.getByText(label, { exact: true }).locator('..');
  const raw = await group.locator('span').last().textContent();
  const value = Number(raw?.trim());
  if (!Number.isInteger(value)) throw new Error(`Métrica inválida para ${label}.`);
  return value;
}

type ExpectedReport = {
  total: number;
  atendido: number;
  faltou: number;
  cancelado: number;
  recebido: number;
  pago: number;
  saldo: number;
};

type ExpectedDoctorGroup = {
  nome: string;
  total: number;
  atendidos: number;
  faltas: number;
};

test.describe('produção: matriz de Relatórios', () => {
  test.describe.configure({ retries: 0 });

  test('valida períodos, totais, PDFs, permissões financeiras e tenant binding', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(900_000);
    test.skip(!authorized, 'Exige E2E_PRODUCTION_REPORT_MATRIX=ALLOW_READ_ONLY_PRODUCTION.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('A matriz de relatórios só pode apontar para app.qoro.dev.');
    }
    if (!sharedPassword || !ownerBEmail || accounts.some(({ email }) => !email)) {
      throw new Error('Credenciais da matriz de relatórios ausentes.');
    }

    const { databaseUrl } = productionConfig();
    const sql = postgres(databaseUrl, { max: 2, ssl: 'require', prepare: false });
    const contexts: BrowserContext[] = [];

    try {
      const inventory = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<
          {
            email: string;
            role: string;
            clinic_id: string;
            clinic_name: string;
            has_financial: boolean;
          }[]
        >`
          select lower(u.email) email, ep.role::text, ep.clinic_id::text,
                 c.nome clinic_name,
                 'view:financial' = any(ep.permissions) has_financial
            from auth.users u
            join effective_permissions_v ep on ep.user_id = u.id
            join clinics c on c.id = ep.clinic_id
           where lower(u.email) = any(${[
             ...accounts.map(({ email }) => email!.toLowerCase()),
             ownerBEmail.toLowerCase(),
           ]}::text[])
             and ep.ativo = true
        `;
      });
      const ownerA = inventory.find(({ email }) => email === accounts[0].email!.toLowerCase());
      const ownerB = inventory.find(({ email }) => email === ownerBEmail.toLowerCase());
      if (!ownerA || !ownerB || ownerA.clinic_id === ownerB.clinic_id) {
        throw new Error('Tenants A/B distintos não foram confirmados.');
      }
      if (normalize(ownerA.clinic_name) === normalize(ownerB.clinic_name)) {
        throw new Error('Os nomes dos tenants não distinguem a prova de PDF A/B.');
      }
      for (const account of accounts) {
        const row = inventory.find(({ email }) => email === account.email!.toLowerCase());
        if (!row || row.clinic_id !== ownerA.clinic_id || row.role !== account.role) {
          throw new Error(`Identidade da role ${account.role} não coincide com a Clínica A.`);
        }
      }

      async function expected(clinicId: string, days: number): Promise<ExpectedReport> {
        const [row] = await sql<
          {
            total: number;
            atendido: number;
            faltou: number;
            cancelado: number;
            recebido: string;
            pago: string;
          }[]
        >`
          with bounds as (
            select
              (date_trunc('day', timezone(c.timezone, now())) - make_interval(days => ${days - 1}))
                at time zone c.timezone as from_at,
              (date_trunc('day', timezone(c.timezone, now())) + interval '1 day')
                at time zone c.timezone as to_at
              from clinics c where c.id = ${clinicId}::uuid
          ), appt as (
            select count(*)::int total,
                   count(*) filter (where status = 'atendido')::int atendido,
                   count(*) filter (where status = 'faltou')::int faltou,
                   count(*) filter (where status = 'cancelado')::int cancelado
              from appointments, bounds
             where clinic_id = ${clinicId}::uuid
               and scheduled_at >= bounds.from_at and scheduled_at < bounds.to_at
          ), financial as (
            select coalesce(sum(case
                     when (l.tipo = 'receber' and pt.kind = 'payment')
                       or (l.tipo = 'pagar' and pt.kind = 'refund')
                     then pt.amount else 0 end), 0)::text recebido,
                   coalesce(sum(case
                     when (l.tipo = 'pagar' and pt.kind = 'payment')
                       or (l.tipo = 'receber' and pt.kind = 'refund')
                     then pt.amount else 0 end), 0)::text pago
              from payment_transactions pt
              join lancamentos l on l.id = pt.lancamento_id
              cross join bounds
             where pt.clinic_id = ${clinicId}::uuid
               and pt.occurred_at >= bounds.from_at and pt.occurred_at < bounds.to_at
          )
          select appt.*, financial.* from appt, financial
        `;
        if (!row) throw new Error('Agregado autoritativo ausente.');
        const recebido = Number(row.recebido);
        const pago = Number(row.pago);
        return {
          total: row.total,
          atendido: row.atendido,
          faltou: row.faltou,
          cancelado: row.cancelado,
          recebido,
          pago,
          saldo: Math.round((recebido - pago) * 100) / 100,
        };
      }

      const expectedA = new Map<string, ExpectedReport>();
      const doctorGroupsA = new Map<string, ExpectedDoctorGroup[]>();
      for (const period of periods) {
        expectedA.set(period.key, await expected(ownerA.clinic_id, period.days));
        const groups = await sql<ExpectedDoctorGroup[]>`
          with bounds as (
            select
              (date_trunc('day', timezone(c.timezone, now())) - make_interval(days => ${period.days - 1}))
                at time zone c.timezone as from_at,
              (date_trunc('day', timezone(c.timezone, now())) + interval '1 day')
                at time zone c.timezone as to_at
              from clinics c where c.id = ${ownerA.clinic_id}::uuid
          )
          select (array_agg(a.snapshot_doctor_nome order by a.scheduled_at desc))[1] nome,
                 count(*)::int total,
                 count(*) filter (where a.status = 'atendido')::int atendidos,
                 count(*) filter (where a.status = 'faltou')::int faltas
            from appointments a, bounds
           where a.clinic_id = ${ownerA.clinic_id}::uuid
             and a.scheduled_at >= bounds.from_at and a.scheduled_at < bounds.to_at
           group by a.doctor_id
           order by count(*) desc
        `;
        doctorGroupsA.set(period.key, groups);
      }
      const expectedB = await expected(ownerB.clinic_id, 30);
      let pagesMatched = 0;
      let pdfsMatched = 0;
      let doctorGroupsMatched = 0;
      const occupationByPeriod = new Map<string, string>();
      const roleEvidence: Array<{
        role: string;
        financialExpected: boolean;
        periodsMatched: number;
        pdfsMatched: number;
      }> = [];

      for (const account of accounts) {
        const identity = inventory.find(({ email }) => email === account.email!.toLowerCase());
        if (!identity) throw new Error(`Identidade ausente: ${account.role}.`);
        const context = await browser.newContext({ baseURL: baseUrl });
        contexts.push(context);
        await signInContext(context, account.email!, sharedPassword);
        const page = await context.newPage();
        let rolePages = 0;
        let rolePdfs = 0;

        for (const period of periods) {
          const expectedPeriod = expectedA.get(period.key);
          if (!expectedPeriod) throw new Error(`Período autoritativo ausente: ${period.key}.`);
          await page.goto(`/relatorios?periodo=${period.key}`);
          await expect(
            page.getByRole('heading', { name: 'Relatórios', exact: true }),
          ).toBeVisible();
          await expect(page.getByRole('link', { name: period.label })).toHaveAttribute(
            'aria-current',
            'page',
          );
          expect(await integerMetric(page, 'Total no período')).toBe(expectedPeriod.total);
          expect(await integerMetric(page, 'Atendidos')).toBe(expectedPeriod.atendido);
          expect(await integerMetric(page, 'Faltas')).toBe(expectedPeriod.faltou);
          expect(await integerMetric(page, 'Cancelados')).toBe(expectedPeriod.cancelado);
          const noShowExpected =
            expectedPeriod.atendido + expectedPeriod.faltou === 0
              ? '—'
              : `${Math.round(
                  (expectedPeriod.faltou / (expectedPeriod.atendido + expectedPeriod.faltou)) * 100,
                )}%`;
          const noShowCard = page.getByText('No-show', { exact: true }).locator('../..');
          await expect(noShowCard).toContainText(noShowExpected);
          const occupation = page.getByText('Ocupação', { exact: true }).locator('../..');
          await expect(occupation).not.toContainText(/NaN|Infinity/u);
          const occupationValue = (
            await occupation.locator('span.font-display').textContent()
          )?.trim();
          if (!occupationValue || !/^(?:—|\d+%)$/u.test(occupationValue)) {
            throw new Error(`Ocupação inválida para ${period.key}.`);
          }
          const previousOccupation = occupationByPeriod.get(period.key);
          if (previousOccupation) expect(occupationValue).toBe(previousOccupation);
          else occupationByPeriod.set(period.key, occupationValue);

          const financialCard = page.getByText('Faturamento (recebido)', { exact: true });
          if (identity.has_financial) {
            await expect(financialCard).toBeVisible();
            const card = financialCard.locator('../..');
            await expect(card).toContainText(money(expectedPeriod.recebido));
            await expect(card).toContainText(money(expectedPeriod.pago));
            await expect(card).toContainText(money(expectedPeriod.saldo));
          } else {
            await expect(financialCard).toHaveCount(0);
          }

          const response = await context.request.get(`/relatorios/pdf?periodo=${period.key}`);
          expect(response.status()).toBe(200);
          expect(response.headers()['content-type']).toContain('application/pdf');
          expect(response.headers()['cache-control']).toBe('no-store');
          const body = await response.body();
          expect(body.subarray(0, 4).toString('ascii')).toBe('%PDF');
          const pdf = await extractPdf(body);
          expect(pdf.pages).toBeGreaterThanOrEqual(1);
          expect(pdf.text).toContain('relatorios');
          expect(pdf.text).toContain('consolidado por profissional');
          expect(pdf.text).toContain('no-show');
          expect(pdf.text).toContain('ocupacao');
          expect(pdf.text).toContain(`${expectedPeriod.total} no periodo`);
          expect(pdf.text).toContain(normalize(noShowExpected));
          expect(pdf.text).toContain(normalize(occupationValue));
          for (const group of doctorGroupsA.get(period.key) ?? []) {
            expect(pdf.text).toContain(
              `${normalize(group.nome)} ${group.total} ${group.atendidos} ${group.faltas}`,
            );
            doctorGroupsMatched += 1;
          }
          if (identity.has_financial) {
            expect(pdf.text).toContain('faturamento (recebido)');
          } else {
            expect(pdf.text).not.toContain('faturamento (recebido)');
            expect(pdf.text).not.toContain(' recebido ');
          }
          await response.dispose();
          rolePages += 1;
          rolePdfs += 1;
          pagesMatched += 1;
          pdfsMatched += 1;
        }

        if (account.role === 'attendant') {
          await page.goto('/relatorios?periodo=invalido');
          await expect(page.getByRole('link', { name: 'Últimos 30 dias' })).toHaveAttribute(
            'aria-current',
            'page',
          );
          expect(await integerMetric(page, 'Total no período')).toBe(expectedA.get('30d')?.total);
        }
        roleEvidence.push({
          role: account.role,
          financialExpected: identity.has_financial,
          periodsMatched: rolePages,
          pdfsMatched: rolePdfs,
        });
      }

      const contextB = await browser.newContext({ baseURL: baseUrl });
      contexts.push(contextB);
      await signInContext(contextB, ownerBEmail, sharedPassword);
      const pageB = await contextB.newPage();
      await pageB.goto(`/relatorios?periodo=30d&clinicId=${ownerA.clinic_id}`);
      expect(await integerMetric(pageB, 'Total no período')).toBe(expectedB.total);
      expect(await integerMetric(pageB, 'Atendidos')).toBe(expectedB.atendido);
      expect(await integerMetric(pageB, 'Faltas')).toBe(expectedB.faltou);
      expect(await integerMetric(pageB, 'Cancelados')).toBe(expectedB.cancelado);
      const poisonedPdf = await contextB.request.get(
        `/relatorios/pdf?periodo=30d&clinicId=${ownerA.clinic_id}`,
      );
      expect(poisonedPdf.status()).toBe(200);
      const parsedPoisonedPdf = await extractPdf(await poisonedPdf.body());
      expect(parsedPoisonedPdf.text).toContain(normalize(ownerB.clinic_name));
      expect(parsedPoisonedPdf.text).not.toContain(normalize(ownerA.clinic_name));
      expect(parsedPoisonedPdf.text).toContain(`${expectedB.total} no periodo`);
      await poisonedPdf.dispose();
      pdfsMatched += 1;

      const result = {
        reportModulesDiscovered: 1,
        rolesTested: roleEvidence,
        periodsPerRole: periods.length,
        pagesMatched,
        pdfsMatched,
        invalidPeriodFallsBackTo30Days: true,
        appointmentTotalsMatchedDatabase: true,
        noShowRateMatchedDatabase: true,
        occupationMatchedAcrossRolesAndPdf: true,
        doctorGroupingsMatchedDatabaseAndPdf: doctorGroupsMatched,
        financialTotalsMatchedDatabaseWhenAuthorized: true,
        financialDataAbsentWithoutPermission: true,
        pdfTextExtracted: true,
        tenantQueryPoisoningIgnoredForPageAndPdf: true,
        externalMutation: false,
        result: 'pass',
      };
      console.log(`[report-matrix] ${JSON.stringify(result)}`);
      await testInfo.attach('report-matrix-result.json', {
        body: JSON.stringify(result, null, 2),
        contentType: 'application/json',
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
      await sql.end();
    }
  });
});
