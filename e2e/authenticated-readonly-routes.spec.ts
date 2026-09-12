import { expect, test, type Page } from '@playwright/test';

import { authenticate, hasE2ECredentials } from './auth';

const READ_ONLY_ROUTES = [
  '/dashboard',
  '/agenda',
  '/agenda/ausencias',
  '/agenda/importar',
  '/agenda/lista-espera',
  '/caixa',
  '/financeiro',
  '/financeiro/fornecedores',
  // O índice É a tela: desde a remoção das rotas de categoria, `/configuracoes`
  // é a lista única e não redireciona para lugar nenhum.
  '/configuracoes',
  '/configuracoes/agente',
  '/configuracoes/assinatura',
  '/configuracoes/horarios',
  '/configuracoes/perfil',
  '/configuracoes/procedimentos',
  '/configuracoes/recursos',
  '/configuracoes/sugestoes',
  '/configuracoes/lgpd',
  '/configuracoes/whatsapp',
  '/equipe',
  '/pacientes',
  '/consultorio',
  '/conversas',
  '/documentos',
  '/modelos-receita',
  '/relatorios',
  '/account/security',
] as const;

type RouteInventory = {
  route: string;
  status: number | null;
  buttons: number;
  forms: number;
  links: number;
};

async function assertFirstDynamicRoute(
  page: Page,
  listRoute: string,
  hrefPrefix: string,
): Promise<'visited' | 'empty'> {
  await page.goto(listRoute);
  const link = page.locator(`a[href^="${hrefPrefix}"]`).first();
  if ((await link.count()) === 0) return 'empty';

  const href = await link.getAttribute('href');
  expect(href, `${listRoute} expôs link dinâmico inválido`).toBeTruthy();
  const response = await page.goto(href!);
  expect(response?.status(), `${listRoute} link dinâmico retornou erro`).toBeLessThan(500);
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await expect(page.locator('main')).toBeVisible({ timeout: 30_000 });
  return 'visited';
}

test.describe('auditoria autenticada somente-leitura', () => {
  test('todas as rotas estáticas do shell renderizam sem erro de servidor', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(
      !hasE2ECredentials(),
      'Defina E2E_USER_EMAIL e E2E_USER_PASSWORD de uma conta descartável.',
    );

    await authenticate(page);

    const inventory: RouteInventory[] = [];
    for (const route of READ_ONLY_ROUTES) {
      const response = await page.goto(route);
      const status = response?.status() ?? null;
      expect(status, `${route} retornou ${status ?? 'sem resposta'}`).not.toBeNull();
      expect(status!, `${route} retornou erro de servidor`).toBeLessThan(500);
      await expect(page, `${route} redirecionou indevidamente para login`).not.toHaveURL(
        /\/login(?:\?|$)/,
      );
      await expect(page.locator('main')).toBeVisible({ timeout: 30_000 });

      inventory.push({
        route,
        status,
        buttons: await page.getByRole('button').count(),
        forms: await page.locator('form').count(),
        links: await page.getByRole('link').count(),
      });
    }

    await testInfo.attach('authenticated-readonly-route-inventory.json', {
      body: JSON.stringify(inventory, null, 2),
      contentType: 'application/json',
    });
    console.log(`[readonly-route-audit] ${JSON.stringify(inventory)}`);
  });

  test('as rotas dinâmicas existentes mantêm a sessão e renderizam', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(
      !hasE2ECredentials(),
      'Defina E2E_USER_EMAIL e E2E_USER_PASSWORD de uma conta descartável.',
    );

    await authenticate(page);

    const outcomes = {
      patient: await assertFirstDynamicRoute(page, '/pacientes', '/pacientes/'),
      conversation: await assertFirstDynamicRoute(page, '/conversas', '/conversas/'),
    };

    await testInfo.attach('authenticated-dynamic-route-outcomes.json', {
      body: JSON.stringify(outcomes, null, 2),
      contentType: 'application/json',
    });
    console.log(`[dynamic-route-audit] ${JSON.stringify(outcomes)}`);
  });
});
