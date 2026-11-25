/**
 * R45 no navegador: XML do lote gerado EM SEGUNDO PLANO pelo outbox, com a leitura delegada
 * das guias (em nome de quem pediu), contra um PREVIEW que usa o DEV.
 *
 *   guia conferida → aprovada e emitida → lote → "Gerar XML em segundo plano" → job na fila /
 *   gerando → XML pronto (validado no XSD oficial na Vercel) → download íntegro → pedir de novo
 *   não cria outro job nem outro arquivo.
 *
 * Fixture sintética `hi-dev-e2e-fixture.ts setup` (clínica `e2e-hi-paga`): usa a segunda guia de
 * Consulta, que o spec principal deixou conferida.
 *
 *   E2E_BASE_URL=<preview> E2E_HI_ACCOUNTS=<contas.json> E2E_HI_FIXTURE=<ids.json> \
 *     VERCEL_AUTOMATION_BYPASS_SECRET=… MAGIC_TOKEN_SECRET_DEV=… npx playwright test e2e/convenios-batch-async-preview.spec.ts
 */
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { assertPreviewRuntimeIsDev } from './preview-dev-runtime';
import { vercelBypassHeaders } from './vercel-bypass';

const BASE = process.env.E2E_BASE_URL;
const ACCOUNTS = process.env.E2E_HI_ACCOUNTS;
const FIXTURE = process.env.E2E_HI_FIXTURE;

test.skip(!BASE || !ACCOUNTS || !FIXTURE, 'requer Preview no DEV e a fixture e2e-hi');
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 45_000 });

const accounts = ACCOUNTS ? (JSON.parse(readFileSync(ACCOUNTS, 'utf8')) as Record<string, { email: string; password: string }>) : {};
const fx = FIXTURE ? (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { guideIds: string[] }) : null;

test('o Preview usa o projeto DEV (prova assinada antes de qualquer escrita)', async () => {
  test.setTimeout(90_000);
  await assertPreviewRuntimeIsDev(BASE!);
});

test('lote grande em segundo plano: pedido → job → XML pronto e íntegro; pedir de novo não duplica', async ({ browser }) => {
  test.setTimeout(420_000);
  const context = await browser.newContext({ extraHTTPHeaders: vercelBypassHeaders() });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/login');
  await page.fill('#email', accounts.gestor!.email);
  await page.fill('#password', accounts.gestor!.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });

  // A guia conferida pelo spec principal é aprovada e emitida (se ainda não foi).
  await page.goto(`/convenios/guias/${fx!.guideIds[1]}`);
  const approve = page.getByRole('button', { name: 'Aprovar e emitir' });
  if ((await approve.count()) > 0) {
    await approve.click();
    await expect(page.getByText('Guia aprovada e emitida').first()).toBeVisible({ timeout: 60_000 });
  }

  await page.goto('/convenios/lotes');
  await page.getByLabel('Tipo de guia').selectOption('consulta');
  const box = page.getByRole('checkbox').first();
  await expect(box).toBeVisible({ timeout: 30_000 });
  await box.check();
  await page.getByRole('button', { name: 'Montar lote' }).click();
  await page.waitForURL(/\/convenios\/lotes\/[0-9a-f-]{36}$/u, { timeout: 60_000 });
  const batchPath = new URL(page.url()).pathname;

  await page.getByRole('button', { name: 'Gerar XML em segundo plano' }).click();
  await expect(page.getByText('XML do lote na fila').first()).toBeVisible({ timeout: 45_000 });
  // O job roda logo depois da resposta (o cron é a reserva); a tela mostra o estado.
  let href: string | null = null;
  for (let i = 0; i < 20 && !href; i += 1) {
    await page.goto(batchPath);
    href = await page.locator('a[href^="/financeiro/convenios/arquivos/"]').first().getAttribute('href').catch(() => null);
    if (!href) {
      const state = await page.getByTestId('batch-export-job').getAttribute('data-job');
      expect(state, 'o job falhou').not.toBe('failed');
      await page.waitForTimeout(4_000);
    }
  }
  expect(href, 'o XML em segundo plano não ficou pronto em 80 s').toBeTruthy();
  const xml = await context.request.get(href!);
  expect(xml.status()).toBe(200);
  expect(xml.headers()['x-content-sha256']).toMatch(/^[0-9a-f]{64}$/u);
  expect((await xml.body()).toString('latin1')).toContain('ENVIO_LOTE_GUIAS');
  // Exportado: não há mais como pedir de novo (nem o síncrono, nem o assíncrono).
  await expect(page.getByRole('button', { name: 'Gerar XML em segundo plano' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Gerar e validar XML' })).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});
