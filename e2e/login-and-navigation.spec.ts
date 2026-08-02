import { expect, test } from '@playwright/test';

const testEmail = process.env.E2E_USER_EMAIL;
const testPassword = process.env.E2E_USER_PASSWORD;

test.describe('acesso público', () => {
  test('a tela de login expõe os controles e alterna a visibilidade da senha', async ({ page }) => {
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
    test.setTimeout(120_000);
    test.skip(
      !testEmail || !testPassword,
      'Defina E2E_USER_EMAIL e E2E_USER_PASSWORD de uma clínica descartável.',
    );

    await page.goto('/login');
    await page.getByLabel('Email').fill(testEmail!);
    await page.locator('input[name="password"]').fill(testPassword!);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 30_000 });

    const destinations = [
      { label: 'Agenda', heading: 'Agenda' },
      { label: 'Caixa', heading: 'Caixa' },
      { label: 'Financeiro', heading: 'Financeiro' },
      { label: 'Configurações', heading: 'Configurações' },
    ];

    for (const destination of destinations) {
      await page.getByRole('link', { name: destination.label, exact: true }).click();
      await expect(
        page.getByRole('heading', { name: destination.heading, exact: true }),
      ).toBeVisible({ timeout: 30_000 });
    }
  });
});
