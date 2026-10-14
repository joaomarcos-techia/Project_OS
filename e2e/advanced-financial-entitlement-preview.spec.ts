import { expect, test } from '@playwright/test';

import { authenticate, hasE2ECredentials } from './auth';
import { assertPreviewRuntimeIsDev } from './preview-dev-runtime';

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
  await expect(page.getByText('Preço por meio de pagamento', { exact: true })).toBeVisible();
  await expect(page.getByText('Base do repasse', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Preços por meio de pagamento e regras de repasse estão disponíveis nos planos'),
  ).toHaveCount(0);
});

test('sem preço cadastrado, ativar preço por meio é recusado e não persiste', async ({ page }) => {
  const baseUrl = process.env.E2E_BASE_URL;
  test.skip(
    !baseUrl ||
      !new URL(baseUrl).hostname.endsWith('.vercel.app') ||
      !hasE2ECredentials() ||
      process.env.E2E_EXPECT_NO_METHOD_PRICES !== '1',
    'Exige Preview DEV, conta Pro/Clínica sem procedimentos e opt-in explícito.',
  );
  test.setTimeout(120_000);
  if (!baseUrl) throw new Error('E2E_BASE_URL ausente para a prova assinada do Preview.');
  await assertPreviewRuntimeIsDev(baseUrl);

  await authenticate(page);
  await page.goto('/configuracoes/pagamentos');
  await expect(page.getByText('Política financeira', { exact: true })).toBeVisible();
  test.skip(
    (await page.locator('#price-procedure option').count()) !== 0,
    'A clínica já tem procedimentos; use uma fixture vazia para este cenário.',
  );

  await page.getByText('Preço por meio de pagamento', { exact: true }).click();
  await page.getByRole('button', { name: 'Salvar política de preço' }).click();
  await expect(
    page.getByText('Cadastre ao menos um preço por método', { exact: false }),
  ).toBeVisible();

  await page.reload();
  await expect(page.locator('input[name="pricing-policy"][value="absorb_fees"]')).toBeChecked();
});
