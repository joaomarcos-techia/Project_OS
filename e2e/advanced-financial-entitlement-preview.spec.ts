import { expect, test } from '@playwright/test';

import { authenticate, hasE2ECredentials } from './auth';

/** Lê o entitlement da conta Pro/Clínica de teste pelo caminho real do usuário. */
test('plano com políticas financeiras avançadas exibe os controles no Preview', async ({
  page,
}) => {
  const baseUrl = process.env.E2E_BASE_URL;
  test.skip(
    !baseUrl ||
      !new URL(baseUrl).hostname.endsWith('.vercel.app') ||
      !hasE2ECredentials() ||
      process.env.E2E_EXPECT_ADVANCED_FINANCIAL !== '1',
    'Exige Preview, conta DEV Pro/Clínica e E2E_EXPECT_ADVANCED_FINANCIAL=1.',
  );
  test.setTimeout(120_000);

  await authenticate(page);
  const response = await page.goto('/configuracoes/pagamentos');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Pagamentos' })).toBeVisible();
  await expect(page.getByText('Política financeira', { exact: true })).toBeVisible();
  await expect(page.getByText('Preço por meio de pagamento', { exact: true })).toHaveCount(0);
  await expect(page.getByText('1. Defina o preço ao paciente')).toBeVisible();
  await expect(page.getByText('Base do repasse', { exact: true })).toBeVisible();
  await expect(page.getByText('Regras de repasse estão disponíveis nos planos')).toHaveCount(0);
  await expect(page.locator('#price-procedure')).toHaveCount(0);
  await expect(page.locator('input[name="pricing-policy"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Salvar política de preço' })).toHaveCount(0);
});
