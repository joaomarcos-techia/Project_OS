import { expect, test, type BrowserContext } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const baseUrl = process.env.E2E_BASE_URL;
const doctorEmail = process.env.E2E_DOCTOR_EMAIL;
const sharedPassword = process.env.E2E_TENANT_PASSWORD;

test.use({
  storageState: { cookies: [], origins: [] },
  trace: 'off',
  video: 'off',
  screenshot: 'off',
  actionTimeout: 30_000,
  navigationTimeout: 60_000,
});

function productionSupabaseConfig(): { url: string; key: string } {
  const databaseUrl = process.env.DATABASE_URL_PROD;
  const adminSecret = process.env.SUPABASE_SECRET_KEY_PROD;
  if (!databaseUrl || !adminSecret) throw new Error('Credenciais operacionais PROD ausentes.');
  const projectRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
  if (!projectRef || !/^[a-z]{20}$/u.test(projectRef)) {
    throw new Error('Project ref de produção inválido.');
  }
  return { url: `https://${projectRef}.supabase.co`, key: adminSecret };
}

async function signInContext(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<void> {
  if (!baseUrl) throw new Error('E2E_BASE_URL ausente.');
  let nextCookies: Array<{ name: string; value: string }> = [];
  const { url, key } = productionSupabaseConfig();
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

test.describe('produção: RBAC financeiro do Dashboard', () => {
  test.describe.configure({ retries: 0 });

  test('não deve expor KPIs financeiros sem view:financial', async ({ browser }) => {
    test.setTimeout(180_000);
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste read-only só pode apontar para app.qoro.dev.');
    }
    if (!doctorEmail || !sharedPassword) throw new Error('Credencial do médico A ausente.');
    const databaseUrl = process.env.DATABASE_URL_PROD;
    if (!databaseUrl) throw new Error('DATABASE_URL_PROD ausente.');

    const sql = postgres(databaseUrl, { max: 1, ssl: 'require', prepare: false });
    const context = await browser.newContext({ baseURL: baseUrl });
    const page = await context.newPage();

    try {
      const [precondition] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<
          {
            role: string;
            has_view_financial: boolean;
            open_receivables: string;
            seven_day_rollup: string;
          }[]
        >`
          select ep.role::text,
                 'view:financial' = any(ep.permissions) as has_view_financial,
                 (
                   select coalesce(sum(
                     case when l.tipo = 'receber' then l.valor - l.valor_pago else 0 end
                   ), 0)::text
                     from lancamentos l
                    where l.clinic_id = ep.clinic_id
                      and l.status in ('pendente', 'parcial')
                 ) as open_receivables,
                 (
                   select coalesce(sum(d.total_recebido), 0)::text
                     from cash_flow_daily d
                    where d.clinic_id = ep.clinic_id
                      and d.date >= current_date - 6
                      and d.date <= current_date
                 ) as seven_day_rollup
            from auth.users u
            join effective_permissions_v ep on ep.user_id = u.id
           where lower(u.email) = ${doctorEmail.toLowerCase()}
             and ep.ativo = true
             and ep.deleted_at is null
        `;
      });
      if (!precondition) throw new Error('Médico A não encontrado.');
      expect(precondition.role).toBe('doctor');
      expect(precondition.has_view_financial).toBe(false);
      expect(Number(precondition.open_receivables)).toBeGreaterThan(0);
      expect(Number(precondition.seven_day_rollup)).toBeGreaterThan(0);

      await signInContext(context, doctorEmail, sharedPassword);
      await page.goto('/dashboard');
      await expect(page).toHaveURL(/\/dashboard(?:\?|$)/u);

      const receivablesCard = page.getByText('A receber', { exact: true }).locator('../..');
      await expect(receivablesCard).toBeVisible();
      const expectedReceivables = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(Number(precondition.open_receivables));
      await expect(receivablesCard).toContainText(expectedReceivables);
      await expect(page.getByText('Faturado hoje', { exact: true })).toBeVisible();
      await expect(page.getByText('Faturamento · últimos 7 dias', { exact: true })).toBeVisible();
      await expect(page.getByText('Sem recebimentos registrados no período.')).toHaveCount(0);

      await page.goto('/financeiro');
      await expect(page.getByText('Sem acesso', { exact: true })).toBeVisible();

      await page.goto('/relatorios?periodo=30d');
      await expect(page.getByRole('heading', { name: 'Relatórios', exact: true })).toBeVisible();
      await expect(page.getByText('Faturamento (recebido)', { exact: true })).toHaveCount(0);
      const pdfResponse = await context.request.get('/relatorios/pdf?periodo=30d');
      expect(pdfResponse.status()).toBe(200);
      expect(pdfResponse.headers()['content-type']).toContain('application/pdf');
      expect((await pdfResponse.body()).subarray(0, 4).toString('ascii')).toBe('%PDF');
      await pdfResponse.dispose();

      console.log(
        `[dashboard-financial-rbac] ${JSON.stringify({
          role: 'doctor',
          hasViewFinancial: false,
          authoritativeReceivablesNonZero: true,
          authoritativeSevenDayRollupNonZero: true,
          dashboardReceivablesMatched: true,
          dashboardFinancialChartVisible: true,
          financialRouteDenied: true,
          reportsFinancialCardHidden: true,
          reportPdfReadable: true,
          result: 'dashboard-financial-data-exposed-without-permission',
        })}`,
      );
    } finally {
      await context.close();
      await sql.end();
    }
  });
});
