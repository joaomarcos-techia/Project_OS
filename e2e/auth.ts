import { expect, type Page } from '@playwright/test';

const testEmail = process.env.E2E_USER_EMAIL;
const testPassword = process.env.E2E_USER_PASSWORD;

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

  await page.goto('/dashboard');
  if (!/\/login(?:\?|$)/.test(page.url())) {
    await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 30_000 });
    return;
  }

  await page.getByLabel('Email').fill(testEmail);
  await page.locator('input[name="password"]').fill(testPassword);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 30_000 });
}
