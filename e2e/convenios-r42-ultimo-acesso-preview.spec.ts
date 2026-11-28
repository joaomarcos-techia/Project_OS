/**
 * R42 / requisito 42 da ANS (S8, P12.12) — aviso de último acesso logo depois do login, no perfil TISS. Autenticado,
 * num Preview DEDICADO com `TISS_SECURITY_PROFILE_ENFORCE=true` só naquele deployment. O aviso vive no shell da UI
 * comercial (#56), então o Preview é o da COMPOSIÇÃO #64 + #55, não o do #55 sozinho.
 *
 *   1. login com sucesso → o shell mostra o aviso (primeiro acesso ou último acesso anterior);
 *   2. uma tentativa com senha errada (pela tela: entra na contagem de `login_attempts`);
 *   3. login de novo → "Seu último acesso foi em <data do passo 1>; 1 tentativa sem sucesso desde então";
 *   4. fora do alcance (médica de clínica sem Convênios): nenhum aviso.
 * Gasta 3 tentativas da gestora e 1 da outra conta (limite do S8: 5 por e-mail e 10 por IP em 15 min).
 *
 *   E2E_BASE_URL=<preview dedicado da composição> E2E_S2_ACCOUNT=<contas.json do setup-s2> \
 *     VERCEL_AUTOMATION_BYPASS_SECRET=… npx playwright test e2e/convenios-r42-ultimo-acesso-preview.spec.ts
 */
import { readFileSync } from 'node:fs';

import { expect, test, type Browser } from '@playwright/test';

import { vercelBypassHeaders } from './vercel-bypass';

test.skip(
  !process.env.E2E_BASE_URL || !process.env.E2E_S2_ACCOUNT,
  'requer E2E_BASE_URL e E2E_S2_ACCOUNT',
);
type Account = { email: string; password: string };
const accounts = process.env.E2E_S2_ACCOUNT
  ? (JSON.parse(readFileSync(process.env.E2E_S2_ACCOUNT, 'utf8')) as Record<
      's2' | 's2outra',
      Account
    >)
  : ({} as Record<'s2' | 's2outra', Account>);
test.describe.configure({ mode: 'serial', timeout: 180_000 });

const newContext = (browser: Browser) =>
  browser.newContext({
    extraHTTPHeaders: vercelBypassHeaders(),
    viewport: { width: 1280, height: 800 },
  });

async function attempt(browser: Browser, account: Account, password: string) {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.goto('/login', { waitUntil: 'load' });
  await page.fill('#email', account.email);
  await page.fill('#password', password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  return { context, page };
}

const today = () =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(
    new Date(),
  );

test('1–3. último acesso e a tentativa sem sucesso depois dele aparecem no shell depois do login', async ({
  browser,
}) => {
  const first = await attempt(browser, accounts.s2, accounts.s2.password);
  await first.page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  await expect(first.page.locator('[data-last-access]')).toBeVisible();
  await expect(first.page.locator('[data-last-access]')).toContainText(
    /Seu último acesso foi em|primeiro acesso registrado/,
  );
  await first.context.close();

  const wrong = await attempt(browser, accounts.s2, `${accounts.s2.password}x`);
  await expect(wrong.page.getByText('Email ou senha inválidos.')).toBeVisible({ timeout: 30_000 });
  expect(new URL(wrong.page.url()).pathname).toMatch(/^\/login/);
  await wrong.context.close();

  const second = await attempt(browser, accounts.s2, accounts.s2.password);
  await second.page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  const notice = second.page.locator('[data-last-access]');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(`Seu último acesso foi em ${today()}`);
  await expect(notice).toContainText('1 tentativa sem sucesso desde então');
  await second.context.close();
});

test('4. fora do alcance do perfil TISS (clínica sem Convênios): nenhum aviso', async ({
  browser,
}) => {
  const out = await attempt(browser, accounts.s2outra, accounts.s2outra.password);
  await out.page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  await out.page.waitForLoadState('load');
  await expect(out.page.locator('[data-last-access]')).toHaveCount(0);
  await out.context.close();
});
