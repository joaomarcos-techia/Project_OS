import { expect, test } from '@playwright/test';
import postgres from 'postgres';

import { authenticate, hasE2ECredentials } from './auth';
import { assertPreviewRuntimeIsDev } from './preview-dev-runtime';
import { assertDevContext } from '../scripts/_env';

const baseUrl = process.env.E2E_BASE_URL;

test.describe('tarifas da conta Asaas conectada (Preview + DEV)', () => {
  test.skip(
    !baseUrl || !hasE2ECredentials() || !process.env.DATABASE_URL,
    'Exige Preview, banco DEV e E2E_USER_EMAIL/E2E_USER_PASSWORD da clínica de teste.',
  );

  test.beforeAll(async () => {
    if (!baseUrl) throw new Error('Preview ausente.');
    const target = new URL(baseUrl);
    if (target.protocol !== 'https:' || !target.hostname.endsWith('.vercel.app')) {
      throw new Error('Consulta real de tarifas permitida apenas em Preview Vercel.');
    }
    await assertPreviewRuntimeIsDev(baseUrl);
  });

  test('conta conectada exibe tarifas reais sem alterar preço ao paciente', async ({ page }) => {
    test.setTimeout(120_000);
    const email = process.env.E2E_USER_EMAIL;
    if (!email) throw new Error('E-mail da clínica de teste ausente.');
    const { databaseUrl } = assertDevContext();
    const sql = postgres(databaseUrl, { max: 1, ssl: 'require', prepare: false });
    try {
      const [profile] = await sql<{ clinic_id: string }[]>`
        select p.clinic_id::text
          from auth.users u join profiles p on p.id = u.id
         where lower(u.email) = lower(${email})
         limit 1
      `;
      if (!profile) throw new Error('A conta de teste precisa ter clínica no DEV.');
      const prices = () => sql<{ total: number; digest: string }[]>`
        select count(*)::int total,
               md5(coalesce(jsonb_agg(to_jsonb(pr) order by pr.id)::text, '[]')) digest
          from procedure_payment_prices pr
         where pr.clinic_id = ${profile.clinic_id}::uuid
      `;
      const [before] = await prices();
      expect(before?.total).toBeGreaterThan(0);

      await authenticate(page);
      await page.goto('/configuracoes/pagamentos');
      const panel = page.getByText('Tarifas da sua conta Asaas').locator('..').locator('..');
      await expect(panel).toBeVisible();
      await expect(panel.getByText(/Tarifa padrão: R\$\s*[\d.,]+ por recebimento/u)).toBeVisible();
      await expect(panel.getByText(/Percentual: [\d.,]+%; operação: R\$\s*[\d.,]+/u)).toBeVisible();
      await expect(
        panel.getByText('O preço ao paciente não muda automaticamente', { exact: false }),
      ).toBeVisible();
      await expect(
        panel.getByRole('link', { name: 'Definir preços ao paciente por meio de pagamento' }),
      ).toHaveAttribute('href', '#precos-por-meio');
      expect((await prices())[0]).toEqual(before);
    } finally {
      await sql.end();
    }
  });
});
