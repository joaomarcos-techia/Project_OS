/** Read-only browser check of the private pricing proposal in a DEV Preview. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { config as loadDotenv } from 'dotenv';
import { chromium } from '@playwright/test';

loadDotenv({ path: process.env.QORO_ENV_PATH ?? '.env.local' });

const baseUrl = process.env.E2E_BASE_URL;
const email = process.env['2E2_UI_EMAIL'];
const password = process.env['2E2_UI_PASSWORD'];
if (!baseUrl || !email || !password) {
  throw new Error('E2E_BASE_URL e credenciais 2E2_UI do ambiente de teste são obrigatórias');
}
const target = new URL(baseUrl);
if (!target.hostname.startsWith('project-os-git-') || !target.hostname.endsWith('.vercel.app')) {
  throw new Error('este probe aceita somente deployment Preview isolado do app');
}

const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const browser = await chromium.launch({ headless: true });
try {
  for (const [device, width, height] of [
    ['desktop', 1440, 900],
    ['mobile', 375, 812],
  ] as const) {
    const context = await browser.newContext({
      viewport: { width, height },
      extraHTTPHeaders: bypass ? { 'x-vercel-protection-bypass': bypass } : {},
    });
    try {
      const page = await context.newPage();
      await page.goto(new URL('/dashboard', target).toString(), { waitUntil: 'domcontentloaded' });
      if (new URL(page.url()).pathname === '/login') {
        await page.locator('#email').fill(email);
        await page.locator('input[name="password"]').fill(password);
        await page.getByRole('button', { name: 'Entrar' }).click();
        await page.waitForURL('**/dashboard', { timeout: 90_000 });
      }
      const response = await page.goto(new URL('/oferta-preview', target).toString(), {
        waitUntil: 'domcontentloaded',
      });
      assert.equal(response?.status(), 200, `${device}: página da oferta não respondeu 200`);
      const main = page.locator('main');
      await main.getByRole('heading', { name: 'Proposta de planos em validação' }).waitFor();
      const body = await main.innerText();
      assert.ok(
        /Consultório e Clínica com dois médicos estão habilitados/u.test(body),
        `${device}: texto dos planos de entrada desatualizado`,
      );
      assert.ok(/14 dias desde a criação da conta/u.test(body), `${device}: prazo do trial errado`);
      assert.ok(!/primeiro agendamento pela IA/u.test(body), `${device}: regra revogada do trial`);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      assert.equal(overflow, false, `${device}: overflow horizontal`);
      if (process.env.E2E_VISUAL_CAPTURE === '1') {
        const dir = path.join(process.cwd(), 'dist/quality/pricing-preview');
        await mkdir(dir, { recursive: true });
        await main.screenshot({ path: path.join(dir, `${device}.png`) });
      }
      console.log(`PASS ${device}: HTTP 200, copy atual e sem overflow horizontal`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
