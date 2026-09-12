import { expect, type Page } from '@playwright/test';

const testEmail = process.env.E2E_USER_EMAIL;
const testPassword = process.env.E2E_USER_PASSWORD;
const AUTH_NAVIGATION_TIMEOUT_MS = 90_000;

export function hasE2ECredentials(): boolean {
  return Boolean(testEmail && testPassword);
}

/**
 * Reuses Playwright storage state when configured, falling back to the real
 * login flow only when the page is unauthenticated. This keeps a broad
 * production audit from tripping the application's login rate limit.
 */
export async function authenticate(page: Page): Promise<void> {
  if (!testEmail || !testPassword) {
    throw new Error('E2E credentials are required to authenticate.');
  }

  // O mesmo teto do assert abaixo: a constante existe para dizer que a
  // navegação de autenticação PODE ser lenta, e o `goto` ficava no padrão de
  // 30 s — curto para um `next dev` compilando a rota pela primeira vez e para
  // um deploy serverless frio.
  await page.goto('/dashboard', { timeout: AUTH_NAVIGATION_TIMEOUT_MS });
  if (!/\/login(?:\?|$)/.test(page.url())) {
    await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, {
      timeout: AUTH_NAVIGATION_TIMEOUT_MS,
    });
    return;
  }

  // #email, nao getByLabel: o form de recuperacao inline usa o mesmo
  // rotulo "E-mail" e o mesmo name, entao so o id desambigua.
  await page.locator('#email').fill(testEmail);
  await page.locator('input[name="password"]').fill(testPassword);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, {
    timeout: AUTH_NAVIGATION_TIMEOUT_MS,
  });
}
