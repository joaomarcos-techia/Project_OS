import { expect, test } from '@playwright/test';

import { authenticate, hasE2ECredentials } from './auth';
import { assertPreviewRuntimeIsDev } from './preview-dev-runtime';

const baseUrl = process.env.E2E_BASE_URL;

test.describe('tarifas da conta Asaas conectada (Preview + DEV)', () => {
  test.skip(
    !baseUrl || !hasE2ECredentials(),
    'Exige E2E_BASE_URL e E2E_USER_EMAIL/E2E_USER_PASSWORD da clínica de teste.',
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
  });
});
