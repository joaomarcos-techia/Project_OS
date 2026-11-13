/**
 * P3 — coparticipação no ASAAS SANDBOX, depois da jornada `convenios-config-preview.spec.ts`
 * (coparticipação de R$ 45,00 conferida e confirmada na clínica sintética `e2e-hi-config`).
 *
 *   conta Sandbox conectada pela interface (webhook da PRÓPRIA branch, com bypass da Vercel)
 *   → "Gerar link de cobrança" cria o checkout REAL no Sandbox pelo valor confirmado
 *   → pedir de novo não cria segunda cobrança.
 *
 * O pagamento do checkout hospedado exige reCAPTCHA humano no Sandbox: fica como ação do
 * fundador (o webhook então concilia). Só chave de SANDBOX (`$aact_hmlg_`), nunca a de produção.
 *
 *   E2E_BASE_URL=<preview> E2E_HI_CFG_ACCOUNTS=<contas-cfg.json> E2E_ASAAS_SANDBOX_KEY=<chave hmlg> \
 *     VERCEL_AUTOMATION_BYPASS_SECRET=… MAGIC_TOKEN_SECRET_DEV=… npx playwright test e2e/convenios-copay-sandbox-preview.spec.ts
 */
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { assertPreviewRuntimeIsDev } from './preview-dev-runtime';
import { vercelBypassHeaders } from './vercel-bypass';

const BASE = process.env.E2E_BASE_URL;
const CFG_ACCOUNTS = process.env.E2E_HI_CFG_ACCOUNTS;
const SANDBOX_KEY = process.env.E2E_ASAAS_SANDBOX_KEY;

test.skip(!BASE || !CFG_ACCOUNTS || !SANDBOX_KEY, 'requer Preview no DEV, a fixture e2e-hi-config e uma chave de Sandbox');
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 45_000 });

if (SANDBOX_KEY && !SANDBOX_KEY.startsWith('$aact_hmlg_')) throw new Error('E2E_ASAAS_SANDBOX_KEY não é chave de Sandbox: recusado');
const accounts = CFG_ACCOUNTS ? (JSON.parse(readFileSync(CFG_ACCOUNTS, 'utf8')) as Record<string, { email: string; password: string }>) : {};

test('o Preview usa o projeto DEV (prova assinada antes de qualquer escrita)', async () => {
  test.setTimeout(90_000);
  await assertPreviewRuntimeIsDev(BASE!);
});

test('gestora conecta a conta Asaas SANDBOX e gera a cobrança só da coparticipação confirmada', async ({ browser }) => {
  test.setTimeout(300_000);
  const context = await browser.newContext({ extraHTTPHeaders: vercelBypassHeaders() });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/login');
  await page.fill('#email', accounts['cfg-gestor']!.email);
  await page.fill('#password', accounts['cfg-gestor']!.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });

  await page.goto('/configuracoes/pagamentos');
  await page.locator('#asaas-api-key').fill(SANDBOX_KEY!);
  await page.getByRole('button', { name: /Conectar conta|Conectar ou retomar/u }).click();
  await expect(page.getByText(/Conta conectada/u).first()).toBeVisible({ timeout: 90_000 });

  await page.goto('/convenios/conciliacao');
  const charge = page.getByRole('button', { name: 'Gerar link de cobrança' }).first();
  await expect(charge).toBeVisible({ timeout: 30_000 });
  await charge.click();
  await expect(page.getByText('Link de cobrança da coparticipação criado.').first()).toBeVisible({ timeout: 90_000 });
  await page.reload();
  await expect(page.getByText('cobrança enviada').first()).toBeVisible({ timeout: 30_000 });
  // Pedir de novo não cria segunda cobrança (o botão vira "Atualizar situação").
  await expect(page.getByRole('button', { name: 'Gerar link de cobrança' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Atualizar situação' }).first().click();
  await expect(page.getByText(/Situação atualizada|Situação:/u).first()).toBeVisible({ timeout: 60_000 });
  expect(errors).toEqual([]);
  await context.close();
});
