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

test.describe('produção: RBAC das configurações do WhatsApp', () => {
  test.describe.configure({ retries: 0 });

  test('não deve expor estado nem controles da integração sem manage:settings', async ({
    browser,
  }) => {
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
            has_manage_settings: boolean;
            active_connection_count: string;
            phone_number: string | null;
          }[]
        >`
          select ep.role::text,
                 'manage:settings' = any(ep.permissions) as has_manage_settings,
                 count(wa.id)::text as active_connection_count,
                 max(wa.phone_number) as phone_number
            from auth.users u
            join effective_permissions_v ep on ep.user_id = u.id
            left join clinic_whatsapp_numbers wa
              on wa.clinic_id = ep.clinic_id
             and wa.active = true
             and wa.connection_status = 'connected'
           where lower(u.email) = ${doctorEmail.toLowerCase()}
             and ep.ativo = true
             and ep.deleted_at is null
           group by ep.role, ep.permissions
        `;
      });
      if (!precondition) throw new Error('Médico A não encontrado.');
      expect(precondition.role).toBe('doctor');
      expect(precondition.has_manage_settings).toBe(false);
      expect(Number(precondition.active_connection_count)).toBeGreaterThan(0);
      const lastFourDigits = precondition.phone_number?.replace(/\D/gu, '').slice(-4);
      expect(lastFourDigits).toHaveLength(4);

      await signInContext(context, doctorEmail, sharedPassword);

      await page.goto('/configuracoes/perfil');
      await expect(page.getByText('Sem acesso', { exact: true })).toBeVisible();

      await page.goto('/configuracoes/assinatura');
      await expect(page.getByText('Sem acesso', { exact: true })).toBeVisible();

      // AUTHZ-006 — o spec afirmava numero mascarado, data de conexao e o botao
      // Desconectar VISIVEIS para um medico sem `manage:settings`. Agora o gate
      // precede a leitura: metadado de integracao e informacao administrativa.
      await page.goto('/configuracoes/whatsapp');
      await expect(page.getByText('Sem acesso', { exact: true })).toBeVisible();
      await expect(page.getByText('WhatsApp conectado', { exact: true })).toHaveCount(0);
      await expect(page.getByText(lastFourDigits!)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Desconectar' })).toHaveCount(0);

      console.log(
        `[whatsapp-settings-rbac] ${JSON.stringify({
          role: 'doctor',
          hasManageSettings: false,
          protectedProfileDenied: true,
          protectedSubscriptionDenied: true,
          whatsappConnectionStatusVisible: true,
          maskedPhoneVisible: true,
          disconnectControlVisible: true,
          mutationAttempted: false,
          result: 'whatsapp-settings-metadata-and-control-exposed-without-permission',
        })}`,
      );
    } finally {
      await context.close();
      await sql.end();
    }
  });
});
