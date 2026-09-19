import { expect, test, type Page } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';

import { authenticate, hasE2ECredentials } from './auth';

loadDotenv({ path: '.env.local' });

/**
 * O-7 no navegador, com sessão REAL.
 *
 * O que só este arquivo prova: que o onboarding operacional funciona atrás de
 * autenticação de verdade — cookies reais, middleware real, Server Actions
 * reais, contexto de tenant real. Os harnesses de banco provam a máquina de
 * estados; nenhum deles prova que a pessoa logada consegue usar as telas.
 *
 * ALVO: `E2E_BASE_URL`. Roda contra o Preview do PR, nunca contra produção — e
 * com a conta sintética de teste, nunca com conta de cliente. Sem credencial ou
 * sem alvo, os testes são pulados com anotação em vez de darem verde vazio.
 *
 * NÃO cria tenant: o cadastro autônomo está fechado por `SIGNUP_IDENTITY_ENABLED`
 * fora do ambiente de prova, e forçá-lo aqui seria testar outra coisa. O que se
 * exercita é o trecho `sessão → dashboard → tour → ajuda`, que é exatamente o
 * pedaço do Track O que nenhum outro teste alcançava.
 */
const baseUrl = process.env.E2E_BASE_URL;

test.describe('O-7 — onboarding operacional autenticado', () => {
  test.skip(!baseUrl, 'E2E_BASE_URL ausente: sem alvo para exercitar.');
  test.skip(!hasE2ECredentials(), 'E2E_USER_EMAIL/E2E_USER_PASSWORD ausentes.');

  /** Falha o teste em erro de página — hidratação quebrada não pode passar. */
  function vigiar(page: Page): { erros: string[] } {
    const erros: string[] = [];
    page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
    page.on('response', (r) => {
      if (r.status() >= 500 && new URL(r.url()).origin === new URL(baseUrl!).origin) {
        erros.push(`${r.status()} em ${new URL(r.url()).pathname}`);
      }
    });
    return { erros };
  }

  test('o dashboard abre para uma sessão real, sem 5xx e sem erro de página', async ({ page }) => {
    const { erros } = vigiar(page);
    await authenticate(page);
    await expect(page).toHaveURL(/\/dashboard(?:\?|$)/u);
    // O `<h1>` do dashboard é a saudação; basta existir para provar que o RSC
    // renderizou em vez de cair no error boundary.
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    expect(erros, erros.join(' | ')).toEqual([]);
  });

  test('/documentacao abre autenticada e lista os tópicos', async ({ page }) => {
    const { erros } = vigiar(page);
    await authenticate(page);
    await page.goto('/documentacao');
    await expect(page).toHaveURL(/\/documentacao(?:\?|$)/u);
    const topicos = page.getByTestId('doc-topics').getByRole('link');
    await expect(topicos.first()).toBeVisible();
    expect(await topicos.count()).toBeGreaterThanOrEqual(5);
    expect(erros, erros.join(' | ')).toEqual([]);
  });

  test('um tópico abre e um slug inexistente dá 404, não 500', async ({ page }) => {
    const { erros } = vigiar(page);
    await authenticate(page);
    await page.goto('/documentacao/primeiros-passos');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Primeiros passos');

    const resposta = await page.goto('/documentacao/slug-que-nao-existe');
    expect(resposta?.status(), 'slug desconhecido deveria ser 404').toBe(404);
    expect(erros, erros.join(' | ')).toEqual([]);
  });

  test('o tour some ao ser dispensado e não reabre sozinho', async ({ page }) => {
    const { erros } = vigiar(page);
    await authenticate(page);

    const tour = page.getByTestId('product-tour');
    if (await tour.count()) {
      await page.getByTestId('tour-skip').click();
      await expect(tour).toBeHidden();
    }

    // Recarregar é o teste real: se "fechar" fosse memória de componente, o
    // tour voltaria aqui.
    await page.reload();
    await expect(page.getByTestId('product-tour')).toHaveCount(0);
    expect(erros, erros.join(' | ')).toEqual([]);
  });

  test('duas abas convergem para o mesmo estado de onboarding', async ({ browser }) => {
    const contexto = await browser.newContext();
    try {
      const abaA = await contexto.newPage();
      const { erros } = vigiar(abaA);
      await authenticate(abaA);

      const abaB = await contexto.newPage();
      await abaB.goto('/dashboard');

      // Dispensar em A; B tem de concordar depois de recarregar, porque a
      // autoridade é o servidor e não a aba.
      const tourA = abaA.getByTestId('product-tour');
      if (await tourA.count()) await abaA.getByTestId('tour-skip').click();
      await abaA.reload();

      await abaB.reload();
      await expect(abaB.getByTestId('product-tour')).toHaveCount(0);
      expect(erros, erros.join(' | ')).toEqual([]);
    } finally {
      await contexto.close();
    }
  });
});
