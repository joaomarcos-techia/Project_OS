import { expect, test } from '@playwright/test';

import { authenticate, hasE2ECredentials } from './auth';

test.describe('leitura da configuração dos convênios', () => {
  test('exibe o campo e a semântica da lista única da clínica', async ({ page }) => {
    test.skip(!hasE2ECredentials(), 'Exige credenciais E2E de uma conta descartável.');

    await authenticate(page);
    await page.goto('/configuracoes/agente');

    await expect(page.getByRole('heading', { name: 'Agente de IA' })).toBeVisible();
    await expect(page.getByLabel('Convênios aceitos')).toBeVisible();
    await expect(page.getByText(/O agente informa somente os convênios desta lista/)).toBeVisible();
  });
});

test.describe('configuração dos convênios informados pelo agente', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    test.skip(
      process.env.E2E_MUTATION !== '1' ||
        !process.env.E2E_USER_EMAIL ||
        !process.env.E2E_USER_PASSWORD,
      'Exige E2E_MUTATION=1, localhost e conta descartável com manage:agent.',
    );
    await authenticate(page);
  });

  test('salva, relê e restaura a lista única da clínica', async ({ page }) => {
    await page.goto('/configuracoes/agente');
    await expect(page.getByRole('heading', { name: 'Agente de IA' })).toBeVisible();

    const input = page.getByLabel('Convênios aceitos');
    await expect(input).toBeVisible();
    const original = await input.inputValue();
    const controlledValue = 'Unimed E2E, Bradesco Saúde E2E';

    try {
      await input.fill(controlledValue);
      await page.getByRole('button', { name: 'Salvar' }).click();
      await expect(page.getByText('Configuração do agente salva.')).toBeVisible();

      await page.reload();
      await expect(page.getByLabel('Convênios aceitos')).toHaveValue(controlledValue);
      await expect(
        page.getByText(/O agente informa somente os convênios desta lista/),
      ).toBeVisible();
    } finally {
      await page.goto('/configuracoes/agente');
      const restoreInput = page.getByLabel('Convênios aceitos');
      await restoreInput.fill(original);
      await page.getByRole('button', { name: 'Salvar' }).click();
      await expect(page.getByText('Configuração do agente salva.')).toBeVisible();
    }
  });
});
