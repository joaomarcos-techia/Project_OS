/** Confere a oferta renderizada e os CTAs em um navegador real, sem criar conta. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

const rawBaseUrl = process.argv[2];
if (!rawBaseUrl) throw new Error('Informe a URL da landing local ou de um Preview.');

const baseUrl = new URL(rawBaseUrl);
const isLocal = ['localhost', '127.0.0.1'].includes(baseUrl.hostname);
const isPreview =
  baseUrl.hostname.startsWith('landing-page-') &&
  baseUrl.hostname.endsWith('-clinic-os-v2-s-projects.vercel.app');
if (!isLocal && !isPreview) {
  throw new Error('Este probe aceita apenas a landing local ou um Preview da Vercel.');
}

const browser = await chromium.launch({ headless: true });
try {
  for (const [device, width, height] of [
    ['desktop', 1440, 900],
    ['mobile', 375, 812],
  ] as const) {
    const context = await browser.newContext({
      viewport: { width, height },
      extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
        ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
        : {},
    });
    try {
      if (isPreview && process.env.E2E_VERCEL_BYPASS_COOKIE) {
        await context.addCookies([
          {
            name: '_vercel_jwt',
            value: process.env.E2E_VERCEL_BYPASS_COOKIE,
            domain: baseUrl.hostname,
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'Lax',
          },
        ]);
      }
      const page = await context.newPage();
      for (const pathname of ['/', '/precos']) {
        const response = await page.goto(new URL(pathname, baseUrl).toString(), {
          waitUntil: 'domcontentloaded',
        });
        assert.equal(new URL(page.url()).host, baseUrl.host, `${device}: Preview exige SSO`);
        assert.equal(response?.status(), 200, `${device}: ${pathname} não respondeu 200`);

        const pricing = page.locator('#pricing');
        await pricing.getByRole('heading', { name: 'Consultório' }).waitFor();
        await pricing.getByRole('heading', { name: 'Clínica' }).waitFor();
        const text = await pricing.innerText();
        assert.ok(
          /R\$ 197[\s\S]*1 profissional incluído nesse valor/u.test(text),
          `${device}: Consultório não explicou o que R$ 197 inclui`,
        );
        assert.ok(
          /R\$ 397[\s\S]*2 profissionais incluídos nesse valor/u.test(text),
          `${device}: Clínica não explicou o que R$ 397 inclui`,
        );
        assert.ok(
          /\+ R\$ 147\/mês por profissional adicional, até 5 no total/u.test(text),
          `${device}: adicional ou teto de profissionais ausente`,
        );
        assert.equal((text.match(/Até 3 acessos de equipe incluídos/gu) ?? []).length, 2);
        assert.equal(/2 a 5 profissionais · até 3 usuários/u.test(text), false);
        assert.equal(await pricing.locator('a[href="/comecar"]').count(), 2);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
          false,
          `${device}: ${pathname} tem overflow horizontal`,
        );

        if (process.env.E2E_VISUAL_CAPTURE === '1') {
          const dir = path.join(process.cwd(), 'dist/quality/landing-offer');
          await mkdir(dir, { recursive: true });
          await page.screenshot({
            path: path.join(dir, `${device}-${pathname === '/' ? 'home' : 'precos'}.png`),
            fullPage: true,
            animations: 'disabled',
          });
        }

        if (pathname === '/precos') {
          const description = await page
            .locator('meta[name="description"]')
            .getAttribute('content');
          assert.ok(/Clínica a partir de R\$ 397\/mês com 2/u.test(description ?? ''));
          assert.equal(/por mês, por profissional/u.test(description ?? ''), false);
          const hero = page.locator('main').first();
          assert.ok(/\+ R\$\s*147\/mês por profissional extra/u.test(await hero.innerText()));
          assert.ok(
            /anual[\s\S]*cancelamento não gera estorno automático/u.test(
              (await page.locator('main').textContent()) ?? '',
            ),
            `${device}: política de cancelamento anual ausente da FAQ`,
          );
        }
        console.log(`PASS ${device} ${pathname}: oferta, CTA e largura`);
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
