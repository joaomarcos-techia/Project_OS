/** Navegação real da ponte; saídas interceptadas para não gerar conversão/contratação. */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const target = new URL(process.argv[2] ?? '');
if (
  !['localhost', '127.0.0.1'].includes(target.hostname) &&
  !/^landing-page-[a-z0-9-]+-clinic-os-v2-s-projects\.vercel\.app$/u.test(target.hostname)
)
  throw new Error('Only local or approved Preview landing');
const expected = 'https://project-jpjbh7lvh-clinic-os-v2-s-projects.vercel.app/cadastro';
const browser = await chromium.launch();
try {
  for (const width of [1440, 375]) {
    for (const javaScriptEnabled of [true, false]) {
      const context = await browser.newContext({
        javaScriptEnabled,
        viewport: { width, height: 900 },
      });
      try {
        if (process.env.E2E_VERCEL_BYPASS_COOKIE)
          await context.addCookies([
            {
              name: '_vercel_jwt',
              value: process.env.E2E_VERCEL_BYPASS_COOKIE,
              domain: target.hostname,
              path: '/',
              secure: true,
              httpOnly: true,
              sameSite: 'Lax',
            },
          ]);
        let observed: URL | undefined;
        let productionRequests = 0;
        await context.route('**/*', async (route) => {
          const url = new URL(route.request().url());
          if (url.origin === target.origin) return route.continue();
          if (url.hostname === 'app.qoro.dev') productionRequests += 1;
          if (url.origin === new URL(expected).origin && url.pathname === '/cadastro')
            observed = url;
          // Não fazer conversão Google, sair ao app protegido ou criar conta.
          return route.abort();
        });
        const page = await context.newPage();
        await page.goto(
          `${target.origin}/comecar?utm_source=recovery-preview&next=https%3A%2F%2Fapp.qoro.dev%2Fcadastro`,
          { waitUntil: 'domcontentloaded' },
        );
        if (javaScriptEnabled) {
          await page.waitForTimeout(2500);
          assert.ok(observed, 'A ponte não tentou o app Preview esperado');
          assert.equal(observed.origin + observed.pathname, expected);
          assert.equal(observed.searchParams.get('utm_source'), 'recovery-preview');
          assert.equal(observed.searchParams.get('next'), null);
        } else {
          assert.equal(
            await page
              .getByRole('link', { name: 'Voltar para a página inicial', exact: true })
              .getAttribute('href'),
            '/',
          );
          assert.equal(observed, undefined);
        }
        assert.equal(productionRequests, 0, 'Preview tentou abrir produção');
        process.stdout.write(
          `PASS bridge ${width}px JavaScript=${javaScriptEnabled}; no production/analytics request sent\n`,
        );
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
