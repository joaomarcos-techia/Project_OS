/**
 * S2 / requisito 83 da ANS — bloqueio por inatividade, autenticado, num Preview DEDICADO com o perfil TISS ligado só
 * naquele deployment (`TISS_SECURITY_PROFILE_ENFORCE=true` como override do deploy, nunca no ambiente Preview
 * compartilhado: lá as fixtures dos outros E2E trocam senhas e a 0170 ainda não está no DEV).
 *
 * Conta: `hi-dev-e2e-fixture.ts setup-s2` (uma conta dedicada na clínica `e2e-hi-paga`, módulo ligado = no alcance).
 * Logar com ela já prova que o Preview usa o Auth do DEV (a conta só existe lá).
 *
 *   1. servidor: com o registro de atividade parado há 11 min (o mesmo codec e a mesma chave do servidor), a próxima
 *      requisição é recusada pela porta única e o shell manda para `/login?reason=inactivity`; o login novo volta;
 *   2. cliente: aviso aos 9 min e bloqueio aos 10 min (relógio do navegador controlado), tela sem as informações;
 *   3. duas abas: a interação numa aba mantém a outra; o bloqueio numa aba bloqueia a outra.
 *
 *   E2E_BASE_URL=<preview dedicado> E2E_S2_ACCOUNT=<conta-s2.json> E2E_S2_SERVER_KEY=<SUPABASE_SECRET_KEY do DEV> \
 *     VERCEL_AUTOMATION_BYPASS_SECRET=… npx playwright test e2e/convenios-s2-inatividade-preview.spec.ts
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { vercelBypassHeaders } from './vercel-bypass';

const BASE = process.env.E2E_BASE_URL;
const ACCOUNT = process.env.E2E_S2_ACCOUNT;
const SERVER_KEY = process.env.E2E_S2_SERVER_KEY;
test.skip(!BASE || !ACCOUNT || !SERVER_KEY, 'requer E2E_BASE_URL (Preview dedicado), E2E_S2_ACCOUNT e E2E_S2_SERVER_KEY');

const account = ACCOUNT
  ? (JSON.parse(readFileSync(ACCOUNT, 'utf8')) as { s2: { email: string; password: string; userId: string } }).s2
  : { email: '', password: '', userId: '' };
const COOKIE = 'qoro_atividade';
const MIN = 60_000;
test.describe.configure({ mode: 'serial', timeout: 240_000 });

// Mesmo codec de `src/lib/auth/session-activity.ts` (payload base64url + HMAC-SHA256 com a chave derivada do segredo
// do servidor). Reimplementado aqui de propósito: o teste prova que o SERVIDOR aceita/recusa, não o codec contra si.
const activityKey = (base: string) => createHmac('sha256', base).update('qoro/session-activity/v1').digest('base64url');
const decode = (value: string) => JSON.parse(Buffer.from(value.split('.')[0]!, 'base64url').toString('utf8')) as {
  uid: string; sid: string; at: number; scope: boolean;
};
const encode = (a: object, base: string) => {
  const payload = Buffer.from(JSON.stringify(a)).toString('base64url');
  return `${payload}.${createHmac('sha256', activityKey(base)).update(payload).digest('base64url')}`;
};

async function login(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto('/login', { waitUntil: 'load' });
  await page.fill('#email', account.email);
  await page.fill('#password', account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  return page;
}

const newContext = (browser: import('@playwright/test').Browser) =>
  browser.newContext({ extraHTTPHeaders: vercelBypassHeaders(), viewport: { width: 1280, height: 800 } });

test('1. servidor: atividade parada há 11 min → porta única recusa e o shell manda ao login; login novo volta', async ({ browser }) => {
  const context = await newContext(browser);
  const page = await login(context);
  const cookie = (await context.cookies()).find((c) => c.name === COOKIE);
  expect(cookie, 'o login no alcance grava o registro de atividade').toBeTruthy();
  expect(cookie!.httpOnly).toBe(true);
  const current = decode(cookie!.value);
  expect(current.uid).toBe(account.userId);
  expect(current.scope).toBe(true);
  expect(Date.now() - current.at).toBeLessThan(5 * MIN);

  // Mesma sessão, mesmo usuário, mesma assinatura do servidor — só a última atividade recuada 11 minutos.
  await context.addCookies([{ ...cookie!, value: encode({ ...current, at: Date.now() - 11 * MIN }, SERVER_KEY!) }]);
  await page.goto('/dashboard', { waitUntil: 'load' });
  await page.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 30_000 });
  expect(new URL(page.url()).searchParams.get('reason')).toBe('inactivity');
  await expect(page.getByText(/10 minutos sem atividade/).first()).toBeVisible();

  // Desbloqueio só com login novo (requisito 83 d): sessão nova, shell volta a abrir.
  const relog = await login(context);
  const fresh = (await context.cookies()).find((c) => c.name === COOKIE)!;
  expect(decode(fresh.value).sid).not.toBe(current.sid); // login novo = sessão nova
  await relog.goto('/dashboard', { waitUntil: 'load' });
  expect(new URL(relog.url()).pathname).not.toMatch(/^\/login/);
  await context.close();
});

test('2. cliente: aviso aos 9 min, bloqueio aos 10 min e a tela deixa de mostrar as informações', async ({ browser }) => {
  const context = await newContext(browser);
  await context.clock.install();
  const page = await login(context);
  await page.goto('/dashboard', { waitUntil: 'load' });
  await expect(page.locator('[data-session-warning]')).toHaveCount(0);

  await context.clock.fastForward(9 * MIN + 5_000);
  await expect(page.locator('[data-session-warning]')).toBeVisible();
  await expect(page.getByText('Sua sessão será bloqueada em 1 minuto')).toBeVisible();

  await context.clock.fastForward(MIN);
  await page.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 30_000 });
  expect(['inactivity', 'inactivity_unsaved']).toContain(new URL(page.url()).searchParams.get('reason'));
  // A sessão foi encerrada de verdade: voltar ao shell sem login cai no login.
  await page.goto('/dashboard', { waitUntil: 'load' });
  expect(new URL(page.url()).pathname).toMatch(/^\/login/);
  await context.close();
});

test('3. duas abas: interação numa mantém a outra; o bloqueio numa bloqueia a outra', async ({ browser }) => {
  const context = await newContext(browser);
  await context.clock.install();
  const a = await login(context);
  await a.goto('/dashboard', { waitUntil: 'load' });
  const b = await context.newPage();
  await b.goto('/dashboard', { waitUntil: 'load' });

  await context.clock.fastForward(8 * MIN);
  await a.mouse.move(200, 200);
  await a.mouse.move(260, 240);
  await a.keyboard.press('Shift');
  // 2 min depois da interação na aba A (10 min desde que a aba B abriu): B continua aberta, sem aviso nem bloqueio.
  await context.clock.fastForward(2 * MIN + 5_000);
  await expect(b.locator('[data-session-locked]')).toHaveCount(0);
  await expect(b.locator('[data-session-warning]')).toHaveCount(0);
  expect(new URL(b.url()).pathname).not.toMatch(/^\/login/);

  // Sem interação: as duas chegam aos 10 min; quem bloquear primeiro avisa a outra pelo canal.
  await context.clock.fastForward(10 * MIN + 5_000);
  for (const p of [a, b]) {
    await p.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 30_000 });
  }
  await context.close();
});
