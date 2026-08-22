import { expect, test } from '@playwright/test';

import { authenticate } from '../auth';

const ROUTES = [
  { path: '/dashboard', slug: 'dashboard' },
  { path: '/agenda', slug: 'agenda' },
  { path: '/pacientes', slug: 'pacientes' },
  { path: '/conversas', slug: 'conversas' },
  { path: '/configuracoes', slug: 'configuracoes' },
] as const;

const THEMES = ['light', 'dark'] as const;

const hasReusableAuth =
  process.env.E2E_AUTH_REUSE === '1' &&
  Boolean(process.env.E2E_BASE_URL && process.env.E2E_USER_EMAIL && process.env.E2E_USER_PASSWORD);

test.describe('auditoria visual autenticada das rotas críticas', () => {
  for (const theme of THEMES) {
    test(`${theme}: captura as cinco rotas sem overflow horizontal`, async ({ page }, testInfo) => {
      test.skip(
        !hasReusableAuth,
        'Exige E2E_BASE_URL, credenciais descartáveis e E2E_AUTH_REUSE=1 para validar a sessão.',
      );

      await page.addInitScript((preference) => {
        localStorage.setItem('clinicaos-theme', preference);
      }, theme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await authenticate(page);

      for (const route of ROUTES) {
        const response = await page.goto(route.path);
        expect(response?.status(), `${route.path} não respondeu`).not.toBeNull();
        expect(response!.status(), `${route.path} retornou erro de servidor`).toBeLessThan(500);
        await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
        await expect(page.locator('main')).toBeVisible();
        await expect(page.getByText('Sem acesso', { exact: true })).toHaveCount(0);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.locator('html')).toHaveClass(
          theme === 'dark' ? /(?:^|\s)dark(?:\s|$)/u : /^(?!.*(?:^|\s)dark(?:\s|$)).*$/u,
        );

        const hasHorizontalOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        );
        expect(hasHorizontalOverflow, `${route.path} possui overflow horizontal`).toBe(false);

        await page.evaluate(async () => {
          await document.fonts.ready;
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        });
        await page.keyboard.press('Tab');
        const focusedTag = await page.evaluate(() => document.activeElement?.tagName ?? '');
        expect(['', 'BODY', 'HTML'], `${route.path} não expôs foco por teclado`).not.toContain(
          focusedTag,
        );

        const screenshotName = `${route.slug}-${testInfo.project.name}-${theme}.png`;
        const screenshotPath = testInfo.outputPath(screenshotName);
        await page.screenshot({
          path: screenshotPath,
          fullPage: false,
          animations: 'disabled',
        });
        await testInfo.attach(screenshotName, {
          path: screenshotPath,
          contentType: 'image/png',
        });
        await testInfo.attach(`${route.slug}-${theme}-metadata.json`, {
          body: JSON.stringify(
            {
              route: route.path,
              finalUrl: page.url(),
              viewport: page.viewportSize(),
              project: testInfo.project.name,
              theme,
            },
            null,
            2,
          ),
          contentType: 'application/json',
        });
      }
    });
  }
});
