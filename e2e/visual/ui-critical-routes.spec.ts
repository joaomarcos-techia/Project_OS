import path from 'node:path';

import { expect, test } from '@playwright/test';

import { authenticate } from '../auth';

/**
 * As oito telas de referência do redesign mais /configuracoes, que não tem
 * referência mas é a tela mais densa em formulário do sistema.
 * Ordem = ordem de revisão no GATE 3.
 */
const ROUTES = [
  { path: '/dashboard', slug: 'dashboard', heading: 'Visão operacional' },
  { path: '/agenda', slug: 'agenda', heading: 'Agenda' },
  { path: '/consultorio', slug: 'consultorio', heading: 'Consultório' },
  { path: '/pacientes', slug: 'pacientes', heading: 'Pacientes' },
  { path: '/documentos', slug: 'documentos', heading: 'Documentos' },
  { path: '/financeiro', slug: 'financeiro', heading: 'Financeiro' },
  { path: '/caixa', slug: 'caixa', heading: 'Caixa' },
  { path: '/conversas', slug: 'conversas', heading: 'Conversas IA' },
  { path: '/configuracoes/agenda', slug: 'configuracoes', heading: 'Agenda' },
] as const;

const THEMES = ['light', 'dark'] as const;

const hasReusableAuth =
  process.env.E2E_AUTH_REUSE === '1' &&
  Boolean(process.env.E2E_BASE_URL && process.env.E2E_USER_EMAIL && process.env.E2E_USER_PASSWORD);

test.describe('auditoria visual autenticada das rotas críticas', () => {
  for (const theme of THEMES) {
    test(`${theme}: captura as ${ROUTES.length} rotas sem overflow horizontal`, async ({
      page,
    }, testInfo) => {
      test.skip(
        !hasReusableAuth,
        'Exige E2E_BASE_URL, credenciais descartáveis e E2E_AUTH_REUSE=1 para validar a sessão.',
      );

      await page.addInitScript((preference) => {
        localStorage.setItem('clinicaos-theme', preference);
      }, theme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await authenticate(page);

      for (const route of ROUTES) {
        const response = await page.goto(route.path);
        expect(response?.status(), `${route.path} não respondeu`).not.toBeNull();
        expect(response!.status(), `${route.path} retornou erro de servidor`).toBeLessThan(500);
        await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
        await expect(page.locator('main')).toBeVisible();
        await expect(page.getByRole('heading', { name: route.heading, exact: true })).toBeVisible({
          timeout: 30_000,
        });
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
        // Em modo wave o arquivo é o entregável: nome previsível numa pasta
        // plana, para abrir wave-0 e wave-N lado a lado. Anexar aqui só
        // duplicaria os 72 PNGs dentro de `attachments/`.
        const wave = process.env.VISUAL_WAVE;
        const screenshotPath = wave
          ? path.join('.playwright', 'visual', wave, screenshotName)
          : testInfo.outputPath(screenshotName);
        await page.screenshot({
          path: screenshotPath,
          // Página inteira na revisão de design: as referências são full-page e
          // o corte no viewport esconde justamente o que se quer comparar.
          fullPage: Boolean(wave),
          animations: 'disabled',
        });
        if (!wave) {
          await testInfo.attach(screenshotName, {
            path: screenshotPath,
            contentType: 'image/png',
          });
        }
        if (!wave)
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

      expect(pageErrors).toEqual([]);
    });
  }
});
