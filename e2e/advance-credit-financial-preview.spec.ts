import { expect, test } from '@playwright/test';

import { authenticate, hasE2ECredentials } from './auth';

/**
 * Leitura real da UI financeira no Preview/DEV. A fixture paga é preparada e
 * conferida pelo runner operacional; este spec nunca cria nem altera cobrança.
 */
test('pagamento antecipado aparece como crédito separado dos recebíveis', async ({ page }) => {
  const baseUrl = process.env.E2E_BASE_URL;
  const minimum = Number(process.env.E2E_ADVANCE_CREDIT_MIN);
  test.skip(
    !baseUrl ||
      !new URL(baseUrl).hostname.endsWith('.vercel.app') ||
      !hasE2ECredentials() ||
      !Number.isFinite(minimum) ||
      minimum <= 0,
    'Exige Preview, conta de teste DEV e crédito Sandbox confirmado.',
  );
  test.setTimeout(120_000);

  await authenticate(page);
  await page.goto('/financeiro');

  const credits = page.getByRole('region', { name: 'Créditos antecipados e excedentes' });
  await expect(credits).toBeVisible();
  await expect(credits).toContainText('Este saldo não entra em “A receber”');
  const displayed = (await credits.locator('p.font-mono').first().innerText()).trim();
  const amount = Number(displayed.replace(/[^\d,]/gu, '').replace(',', '.'));
  expect(
    amount,
    'o saldo não aplicado deve conter o crédito da fixture paga',
  ).toBeGreaterThanOrEqual(minimum);
});
