import { expect, test } from '@playwright/test';

import { authenticate, hasE2ECredentials } from './auth';

test.describe('acesso público', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('a tela de login expõe os controles e alterna a visibilidade da senha', async ({ page }) => {
    // The first /login visit in next dev compiles the page on demand. Keep this
    // explicit so a cold local server is not mistaken for a login regression.
    test.setTimeout(150_000);
    await page.goto('/login');

    const password = page.locator('input[name="password"]');
    await expect(page.getByRole('heading', { name: 'Bem-vindo de volta' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(password).toHaveAttribute('type', 'password');
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeEnabled();

    await page.getByRole('button', { name: 'Mostrar senha' }).click();
    await expect(password).toHaveAttribute('type', 'text');

    await page.getByRole('button', { name: 'Ocultar senha' }).click();
    await expect(password).toHaveAttribute('type', 'password');
  });

  for (const path of ['/agenda', '/caixa', '/financeiro', '/configuracoes']) {
    test(`${path} não fica exposta sem autenticação`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login(?:\?|$)/);
    });
  }
});

test.describe('navegação autenticada', () => {
  test('links principais levam aos módulos sem erro de renderização', async ({ page }) => {
    // Em `next dev`, a primeira visita compila login + dashboard sob demanda.
    // O timeout maior cobre essa compilação local; em Preview/produção tende a
    // terminar bem antes.
    test.setTimeout(300_000);
    test.skip(
      !hasE2ECredentials(),
      'Defina E2E_USER_EMAIL e E2E_USER_PASSWORD de uma clínica descartável.',
    );

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await authenticate(page);

    const settingsLink = page.getByRole('link', { name: 'Configurações', exact: true });
    expect(await settingsLink.getAttribute('href')).not.toBe('/configuracoes');

    const destinations = [
      { label: 'Agenda', heading: 'Agenda' },
      { label: 'Caixa', heading: 'Caixa' },
      { label: 'Financeiro', heading: 'Financeiro' },
      // `/configuracoes` é apenas um redirect para a primeira categoria
      // acessível; para este usuário, a categoria inicial é Agenda.
      { label: 'Configurações', heading: 'Agenda' },
    ];

    for (const destination of destinations) {
      await page.getByRole('link', { name: destination.label, exact: true }).click();
      await expect(
        page.getByRole('heading', { name: destination.heading, exact: true }),
      ).toBeVisible({ timeout: 90_000 });
    }

    await page.getByRole('link', { name: 'Produto', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Produto', exact: true })).toBeVisible({
      timeout: 90_000,
    });
    await page.getByRole('link', { name: 'Sugestões', exact: true }).click();
    await expect(page).toHaveURL(/\/configuracoes\/sugestoes(?:\?|$)/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Sugestões', exact: true })).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByRole('heading', { name: 'Seus envios', exact: true })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
