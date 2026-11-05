import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { authenticate } from './auth';
import { installVercelBypassForOrigin } from './vercel-bypass';

test.describe('central de ajuda para usuários da Qoro', () => {
  test.skip(
    process.env.E2E_DOCUMENTATION !== '1',
    'Exige autorização e conta de teste no Preview.',
  );
  test.describe.configure({ mode: 'serial' });
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const baseURL = process.env.E2E_BASE_URL;
    if (!baseURL || !process.env.E2E_USER_EMAIL || !process.env.E2E_USER_PASSWORD) {
      throw new Error('A validação requer Preview e credenciais da conta de teste.');
    }
    const target = new URL(baseURL);
    const host = target.hostname;
    if (target.username || target.password)
      throw new Error('O endereço não pode conter credenciais.');
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(host) &&
      (target.protocol !== 'https:' || !host.endsWith('.vercel.app'))
    ) {
      throw new Error('Somente Preview ou localhost são permitidos neste teste autenticado.');
    }
    context = await browser.newContext({ baseURL });
    await installVercelBypassForOrigin(context, new URL(baseURL).origin);
    page = await context.newPage();
    try {
      await authenticate(page);
    } catch {
      throw new Error(
        'Não foi possível entrar com a conta de teste do Preview; credenciais omitidas.',
      );
    }
  });

  test.afterAll(async () => {
    await context?.close();
  });

  for (const width of [1440, 375]) {
    test(`índice e busca em ${width}px`, async () => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/documentação');
      await expect(page.getByRole('heading', { name: 'Central de ajuda' })).toBeVisible();
      await expect(page.locator('[data-testid="doc-topics"] a')).toHaveCount(19);
      await expect(page.getByRole('main')).not.toContainText(/ClinicaOS|Mintlify|outbox|webhook/iu);
      await page.getByRole('searchbox').fill('MEDICO CRM');
      await expect(page.getByRole('link', { name: /Planos, médicos e acessos/u })).toBeVisible();
      await page.getByRole('searchbox').fill('palavra-sem-resultado-123');
      await expect(page.getByRole('heading', { name: 'Nenhum guia encontrado' })).toBeVisible();
      await page.getByRole('button', { name: 'Limpar busca' }).click();
      await expect(page.locator('[data-testid="doc-topics"] a')).toHaveCount(19);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    });

    test(`guia, endereço antigo e nome da Qoro em ${width}px`, async () => {
      await page.goto('/documentacao/agenda');
      await expect(page).toHaveURL(/\/documenta(?:%C3%A7%C3%A3|çã)o\/agenda$/iu);
      await expect(
        page.getByRole('heading', { name: 'Agendar, remarcar e cancelar' }),
      ).toBeVisible();
      await expect(page.locator('main ol li')).toHaveCount(4);
      await expect(page.getByRole('main')).not.toContainText(/ClinicaOS|Mintlify/iu);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await page.getByRole('link', { name: 'Ajuda', exact: true }).last().click();
      await expect(page.getByRole('heading', { name: 'Central de ajuda' })).toBeVisible();
    });
  }

  test('todos os guias abrem e um endereço desconhecido retorna 404', async () => {
    await page.goto('/documentação');
    const hrefs = await page
      .locator('[data-testid="doc-topics"] a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    for (const href of hrefs) {
      if (!href) throw new Error('Guia sem endereço');
      const response = await page.goto(href);
      expect(response?.status()).toBe(200);
      await expect(page.locator('main h1')).toHaveCount(1);
    }
    const missing = await page.goto('/documentação/guia-inexistente-123');
    expect(missing?.status()).toBe(404);
  });
});
