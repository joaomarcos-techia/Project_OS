/**
 * R51 — React #418 (hidratação) em rotas reais do Preview, de forma DETERMINÍSTICA.
 *
 * O erro aparecia às vezes (consultório, conciliação): o servidor renderiza num instante e
 * num fuso (UTC na Vercel), o navegador hidrata segundos depois em outro (Brasília). Todo
 * componente que calcula hora, "há X min" ou "atrasado" durante a renderização diverge só
 * quando a virada de um minuto (ou de um dia) cai entre os dois. Aqui o relógio do
 * navegador vai 37 min à frente e o fuso é o de Tóquio: o que depende da hora na
 * renderização diverge SEMPRE, e o que não depende continua igual.
 *
 * Cenário: a recepção põe um paciente na sala de espera (encaixe de convênio), a médica
 * abre o consultório; a gestora abre as telas de convênio e financeiro. Desktop e celular.
 * Qualquer erro de página reprova (sem exceção para o #418).
 *
 *   E2E_BASE_URL=<preview> E2E_HI_CFG_ACCOUNTS=<contas-cfg.json> E2E_RUN=<marca da jornada>
 *   VERCEL_AUTOMATION_BYPASS_SECRET=… MAGIC_TOKEN_SECRET=… npx playwright test e2e/hydration-r51-preview.spec.ts
 */
import { readFileSync } from 'node:fs';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { assertPreviewRuntimeIsDev } from './preview-dev-runtime';
import { vercelBypassHeaders } from './vercel-bypass';

const BASE = process.env.E2E_BASE_URL;
const CFG_ACCOUNTS = process.env.E2E_HI_CFG_ACCOUNTS;
const RUN = process.env.E2E_RUN;

test.skip(!BASE || !CFG_ACCOUNTS || !RUN, 'requer Preview no DEV, a fixture e2e-hi-config e a marca (E2E_RUN) da jornada');
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 45_000 });

const accounts = CFG_ACCOUNTS ? (JSON.parse(readFileSync(CFG_ACCOUNTS, 'utf8')) as Record<string, { email: string; password: string }>) : {};
const PATIENT = `Paciente Sintético Config ${RUN}`;
const PROC_NAME = `Consulta sintética ${RUN}`;
const INSURER = `Operadora Sintética ${RUN}`;
const SKEW_MS = 37 * 60_000;
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

const sessions = new Map<string, Awaited<ReturnType<BrowserContext['storageState']>>>();

async function session(browser: Browser, key: string): Promise<Awaited<ReturnType<BrowserContext['storageState']>>> {
  const cached = sessions.get(key);
  if (cached) return cached;
  const context = await browser.newContext({ extraHTTPHeaders: vercelBypassHeaders() });
  const page = await context.newPage();
  await page.goto('/login', { waitUntil: 'load' });
  await page.fill('#email', accounts[key]!.email);
  await page.fill('#password', accounts[key]!.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  const state = await context.storageState();
  sessions.set(key, state);
  await context.close();
  return state;
}

/** Contexto com o relógio 37 min à frente e o fuso de Tóquio (o servidor segue em UTC e na hora real). */
async function skewedPage(browser: Browser, key: string, viewport = DESKTOP): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
  const context = await browser.newContext({
    viewport,
    timezoneId: 'Asia/Tokyo',
    extraHTTPHeaders: vercelBypassHeaders(),
    storageState: await session(browser, key),
  });
  await context.addInitScript((offset: number) => {
    const RealDate = Date;
    class SkewedDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(RealDate.now() + offset);
        else super(...(args as [string | number]));
      }
      static override now(): number {
        return RealDate.now() + offset;
      }
    }
    (globalThis as unknown as { Date: DateConstructor }).Date = SkewedDate as unknown as DateConstructor;
  }, SKEW_MS);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${new URL(page.url()).pathname}: ${e.message.slice(0, 140)}`));
  return { context, page, errors };
}

/**
 * Visita as rotas e, se uma delas acusar erro de página, anexa ao relatório o HTML que o
 * servidor mandou, o DOM depois da hidratação e o contexto (rota, viewport, SHA esperado,
 * id da requisição na Vercel, mensagens de console) — o bastante para comparar a estrutura
 * e achar o componente. Sintético: a clínica e o paciente são de teste.
 */
async function sweep(browser: Browser, key: string, routes: string[], viewport = DESKTOP): Promise<string[]> {
  const s = await skewedPage(browser, key, viewport);
  const consoleErrors: string[] = [];
  s.page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 400));
  });
  for (const route of routes) {
    const before = s.errors.length;
    consoleErrors.length = 0;
    const res = await s.page.goto(route, { waitUntil: 'load' });
    expect(res?.status(), route).toBe(200);
    const serverHtml = (await res?.text().catch(() => '')) ?? '';
    await s.page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    // A hidratação termina depois do load; dá tempo de o erro aparecer.
    await s.page.waitForTimeout(2_500);
    if (s.errors.length > before) {
      const tag = `${key}-${viewport.width}-${route.replace(/\W+/gu, '_')}`;
      const info = test.info();
      await info.attach(`r51-${tag}-server.html`, { body: serverHtml, contentType: 'text/html' });
      await info.attach(`r51-${tag}-client.html`, { body: await s.page.content(), contentType: 'text/html' });
      await info.attach(`r51-${tag}-contexto.json`, {
        contentType: 'application/json',
        body: JSON.stringify({
          route,
          viewport,
          expectedSha: process.env.E2E_EXPECTED_SHA ?? null,
          vercelRequestId: res?.headers()['x-vercel-id'] ?? null,
          environment: 'preview (DEV)',
          errors: s.errors.slice(before),
          consoleErrors: [...consoleErrors],
        }, null, 1),
      });
    }
  }
  await s.context.close();
  return s.errors;
}

test('o Preview usa o projeto DEV (prova assinada antes de qualquer escrita)', async () => {
  test.setTimeout(90_000);
  await assertPreviewRuntimeIsDev(BASE!);
});

test('recepção põe um paciente na sala de espera (encaixe de convênio)', async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ extraHTTPHeaders: vercelBypassHeaders(), storageState: await session(browser, 'cfg-recepcao') });
  const page = await context.newPage();
  await page.goto('/agenda', { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Novo atendimento' }).click();
  await page.getByRole('radio', { name: 'Encaixe (agora)' }).click();
  await page.locator('#appointment-patient').fill(PATIENT.slice(0, 12));
  await page.getByRole('option', { name: PATIENT }).first().click();
  await page.locator('#appointment-procedure').selectOption({ label: PROC_NAME });
  await page.locator('#appointment-doctor').selectOption({ label: 'Dra. Sintética Configuração' });
  await page.getByRole('radio', { name: 'Convênio' }).click();
  await page.locator('#appointment-insurer').selectOption({ label: INSURER });
  const card = page.locator('#appointment-card option', { hasText: 'preferencial' });
  await expect(card).toHaveCount(1, { timeout: 30_000 });
  await page.locator('#appointment-card').selectOption({ label: (await card.textContent())!.trim() });
  await page.getByRole('button', { name: 'Criar encaixe' }).click();
  await expect(page.getByText('Encaixe criado').first()).toBeVisible({ timeout: 45_000 });
  await context.close();
});

test('médica: consultório com paciente esperando, relógio adiantado e outro fuso — sem #418 (desktop e celular)', async ({ browser }) => {
  test.setTimeout(300_000);
  const routes = ['/consultorio', '/agenda', '/dashboard', '/pacientes'];
  const errors = [...(await sweep(browser, 'cfg-medica', routes)), ...(await sweep(browser, 'cfg-medica', ['/consultorio', '/agenda'], MOBILE))];
  console.log('R51 médica: ' + JSON.stringify(errors));
  expect(errors).toEqual([]);
});

test('gestora: convênio e financeiro, relógio adiantado e outro fuso — sem #418 (desktop e celular)', async ({ browser }) => {
  test.setTimeout(420_000);
  const routes = [
    '/dashboard', '/agenda', '/financeiro', '/caixa', '/convenios', '/convenios/configuracao', '/convenios/carteirinhas',
    '/convenios/atendimentos', '/convenios/guias', '/convenios/lotes', '/convenios/conciliacao', '/convenios/repasses',
    '/convenios/solicitacoes',
  ];
  const errors = [...(await sweep(browser, 'cfg-gestor', routes)), ...(await sweep(browser, 'cfg-gestor', ['/convenios/conciliacao', '/convenios/atendimentos', '/dashboard'], MOBILE))];
  console.log('R51 gestora: ' + JSON.stringify(errors));
  expect(errors).toEqual([]);
});

test('recepção: painel, agenda, caixa e conciliação, relógio adiantado e outro fuso — sem #418 (desktop e celular)', async ({ browser }) => {
  test.setTimeout(300_000);
  const routes = ['/dashboard', '/agenda', '/caixa', '/consultorio', '/convenios/conciliacao', '/convenios/atendimentos'];
  const errors = [...(await sweep(browser, 'cfg-recepcao', routes)), ...(await sweep(browser, 'cfg-recepcao', ['/caixa', '/agenda'], MOBILE))];
  console.log('R51 recepção: ' + JSON.stringify(errors));
  expect(errors).toEqual([]);
});
