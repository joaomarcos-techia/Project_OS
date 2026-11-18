/**
 * P7.5 — cancelamento da guia na operadora e substituição só com recibo, no Preview ligado ao DEV
 * (navegador remoto, 17/11). Clínica sintética `e2e-hi-p75` (fixture `setup-p75 --run <MARCA>`):
 *
 *   1. a gestora confere e aprova as duas guias e as leva à operadora pela tela (lote, XML no XSD,
 *      envio, protocolo);
 *   2. guia A: pede o cancelamento (motivo), o XML `cancelaGuia` é baixado; recibo 4 (em
 *      processamento) mantém o pedido aguardando e NÃO libera a substituta; recibo 1 confirma; a
 *      substituta nasce, é conferida e aprovada, e a original vira "Substituída" com histórico;
 *   3. guia B: recibo 2 (não cancelada) recusa o pedido; criar a substituta pela server action
 *      chamada DIRETO é recusado pelo servidor (sem recibo 1 não há substituição); repetir a criação
 *      da substituta da A não cria outra;
 *   4. recepção: não vê os controles de faturamento e o servidor recusa registrar recibo;
 *   5. outra clínica: a guia não existe e a action é recusada.
 *
 * Recibos aqui são SINTÉTICOS (homologação interna); nada é transmitido a operadora nenhuma.
 */
import { readFileSync } from 'node:fs';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { assertPreviewRuntimeIsDev } from './preview-dev-runtime';
import { vercelBypassHeaders } from './vercel-bypass';

const BASE = process.env.E2E_BASE_URL;
const ACCOUNTS = process.env.E2E_HI_P75_ACCOUNTS;
const OTHER_ACCOUNTS = process.env.E2E_HI_ACCOUNTS;
const STATE = process.env.E2E_HI_P75;

test.skip(!BASE || !ACCOUNTS || !OTHER_ACCOUNTS || !STATE, 'requer E2E_BASE_URL (Preview no DEV) e a fixture setup-p75');
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 45_000 });

type Account = { email: string; password: string; userId: string; clinic: string; role: string };
const accounts: Record<string, Account> = {
  ...(ACCOUNTS ? (JSON.parse(readFileSync(ACCOUNTS, 'utf8')) as Record<string, Account>) : {}),
  ...(OTHER_ACCOUNTS ? { 'outra-gestor': (JSON.parse(readFileSync(OTHER_ACCOUNTS, 'utf8')) as Record<string, Account>).gestor! } : {}),
};
const fx = STATE
  ? (JSON.parse(readFileSync(STATE, 'utf8')) as { run: string; insurerName: string; guides: { a: { id: string }; b: { id: string } } })
  : null;
const INTERNAL = /(?:\bat\s+\S+\s+\(|node_modules|drizzle|postgres|SQLSTATE|stack)/iu;

type Session = { context: BrowserContext; page: Page; errors: string[] };
const sessions = new Map<string, Session>();
async function session(browser: Browser, key: string): Promise<Session> {
  const open = sessions.get(key);
  if (open) return open;
  const account = accounts[key];
  if (!account) throw new Error(`conta ${key} ausente na fixture`);
  const context = await browser.newContext({ baseURL: BASE!, extraHTTPHeaders: vercelBypassHeaders() });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${e.message} @ ${new URL(page.url()).pathname}`));
  await page.goto('/login', { waitUntil: 'load' });
  await page.fill('#email', account.email);
  await page.fill('#password', account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  const s = { context, page, errors };
  sessions.set(key, s);
  return s;
}
test.beforeAll(async () => {
  await assertPreviewRuntimeIsDev(BASE!);
});
test.afterAll(async () => {
  for (const s of sessions.values()) await s.context.close();
});

const guidePath = (which: 'a' | 'b') => `/convenios/guias/${fx!.guides[which].id}`;
const panel = (page: Page) => page.getByRole('region', { name: 'Cancelamento na operadora e substituição' });
const situation = (page: Page) => page.getByRole('region', { name: 'Situação da guia' });

/** Espera o aviso flutuante (ou o texto na página) de sucesso de uma ação. */
async function done(page: Page, text: string | RegExp) {
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 60_000 });
}

type Captured = { id: string; body: string; contentType: string; routerTree?: string | undefined };
async function capture(page: Page, marker: string, trigger: () => Promise<void>): Promise<Captured> {
  let got: Captured | null = null;
  const handler = async (route: import('@playwright/test').Route) => {
    const req = route.request();
    const h = req.headers();
    const body = req.postData();
    if (req.method() === 'POST' && h['next-action'] && body?.includes(marker) && !got) {
      got = { id: h['next-action'], body, contentType: h['content-type'] ?? 'text/plain;charset=UTF-8', routerTree: h['next-router-state-tree'] };
    }
    return route.continue();
  };
  await page.route('**/*', handler);
  try {
    await trigger();
    await expect.poll(() => got !== null, { timeout: 30_000 }).toBe(true);
  } finally {
    await page.unroute('**/*', handler);
  }
  return got!;
}
async function replay(page: Page, action: Captured, body = action.body): Promise<{ status: number; text: string }> {
  return page.evaluate(
    async ({ id, b, contentType, routerTree }) => {
      const headers: Record<string, string> = { 'Next-Action': id, 'Content-Type': contentType, Accept: 'text/x-component' };
      if (routerTree) headers['Next-Router-State-Tree'] = routerTree;
      const r = await fetch(location.pathname, { method: 'POST', headers, body: b });
      return { status: r.status, text: await r.text() };
    },
    { id: action.id, b: body, contentType: action.contentType, routerTree: action.routerTree },
  );
}
function expectRefused(res: { text: string }) {
  expect(res.text).toContain('"ok":false');
  expect(res.text).not.toContain('"ok":true');
  expect(res.text).not.toMatch(INTERNAL);
}

let createSubstitute: Captured | null = null;
let receiptAction: Captured | null = null;

async function requestCancellation(page: Page, reason: string) {
  await panel(page).getByRole('button', { name: 'Pedir o cancelamento à operadora' }).click();
  const form = page.getByRole('form', { name: 'Pedido de cancelamento à operadora' });
  await form.getByLabel('Motivo').fill(reason);
  await form.getByRole('button', { name: 'Registrar o pedido' }).click();
  await done(page, 'Pedido de cancelamento registrado');
  await page.reload();
  await expect(panel(page)).toContainText('Aguardando a operadora');
}
async function registerReceipt(page: Page, code: string, protocol: string) {
  await panel(page).getByRole('button', { name: 'Registrar o recibo da operadora' }).click();
  const form = page.getByRole('form', { name: 'Recibo do cancelamento' });
  await form.getByLabel('Situação informada pela operadora (Tabela 46)').selectOption(code);
  await form.getByLabel('Protocolo da operadora').fill(protocol);
  await form.getByRole('button', { name: 'Registrar o recibo' }).click();
  await done(page, 'Recibo registrado');
  await page.reload();
}

test('gestora: confere, aprova e leva as duas guias à operadora pela tela (lote, XML no XSD, envio, protocolo)', async ({ browser }) => {
  test.setTimeout(420_000);
  const s = await session(browser, 'p75-gestor');
  for (const which of ['a', 'b'] as const) {
    await s.page.goto(guidePath(which));
    if (await s.page.getByRole('button', { name: 'Marcar como conferida' }).isVisible().catch(() => false)) {
      await s.page.getByRole('button', { name: 'Marcar como conferida' }).click();
      await done(s.page, 'Guia conferida');
      await s.page.reload();
    }
    if (await s.page.getByRole('button', { name: 'Aprovar e emitir' }).isVisible().catch(() => false)) {
      await s.page.getByRole('button', { name: 'Aprovar e emitir' }).click();
      await done(s.page, 'Guia aprovada e emitida');
    }
  }
  await s.page.goto('/convenios/lotes');
  // Pela operadora (a contagem do rótulo muda entre execuções: a substituta aprovada de uma anterior entra junto).
  const select = s.page.getByLabel('Operadora').first();
  const value = await select.locator('option', { hasText: fx!.insurerName }).first().getAttribute('value');
  await select.selectOption(value!);
  await s.page.getByText('Todas (até 100)').click();
  await s.page.getByRole('button', { name: 'Montar lote' }).click();
  await s.page.waitForURL(/\/convenios\/lotes\/[0-9a-f-]{36}$/u, { timeout: 60_000 });
  const batch = new URL(s.page.url()).pathname;
  await s.page.getByRole('button', { name: 'Gerar e validar XML' }).click();
  await done(s.page, 'XML gerado e validado');
  await s.page.goto(batch);
  await s.page.getByRole('button', { name: 'Marcar como enviado' }).click();
  await s.page.getByLabel('Como o lote foi enviado').fill('Enviado pelo portal da operadora sintética, comprovante de teste');
  await s.page.getByRole('button', { name: 'Confirmar' }).click();
  await done(s.page, 'Envio registrado');
  await s.page.goto(batch);
  await s.page.getByRole('button', { name: 'Registrar protocolo' }).click();
  await s.page.getByLabel('Protocolo da operadora').fill(String(Date.now()).slice(-12));
  await s.page.getByLabel('Recibo emitido pela operadora').setInputFiles({
    name: 'recibo-sintetico.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.4\n% recibo sintetico de teste ${fx!.run}\n%%EOF\n`),
  });
  await s.page.getByRole('button', { name: 'Registrar', exact: true }).click();
  await done(s.page, 'Protocolo registrado');
  for (const which of ['a', 'b'] as const) {
    await s.page.goto(guidePath(which));
    await expect(panel(s.page).getByRole('button', { name: 'Pedir o cancelamento à operadora' })).toBeVisible();
  }
  expect(s.errors).toEqual([]);
});

test('guia A: pedido com motivo e XML; recibo 4 não libera; recibo 1 confirma; substituta conferida e aprovada; original substituída', async ({ browser }) => {
  test.setTimeout(420_000);
  const s = await session(browser, 'p75-gestor');
  await s.page.goto(guidePath('a'));
  await requestCancellation(s.page, `Guia enviada com o tipo de consulta errado (teste sintético ${fx!.run})`);
  // XML cancelaGuia do pedido.
  const [download] = await Promise.all([
    s.page.waitForEvent('download', { timeout: 60_000 }),
    panel(s.page).getByRole('button', { name: 'Baixar o XML do pedido' }).click(),
  ]);
  const xml = readFileSync((await download.path())!, 'latin1');
  expect(xml).toContain('cancelaGuia');
  expect(xml).toContain('4.03.00');
  // Recibo 4: continua aguardando; nada de substituta.
  receiptAction = await capture(s.page, `P4${fx!.run}`.slice(0, 12), async () => {
    await registerReceipt(s.page, '4', `P4${fx!.run}`.slice(0, 12));
  });
  await expect(panel(s.page)).toContainText('Aguardando a operadora');
  await expect(panel(s.page).getByRole('button', { name: 'Criar a guia substituta' })).toHaveCount(0);
  // Recibo 1: confirmado; a substituta pode nascer.
  await registerReceipt(s.page, '1', `P1${fx!.run}`.slice(0, 12));
  await expect(panel(s.page)).toContainText('Cancelada pela operadora');
  createSubstitute = await capture(s.page, fx!.guides.a.id, async () => {
    await panel(s.page).getByRole('button', { name: 'Criar a guia substituta' }).click();
  });
  await s.page.waitForURL((u) => /\/convenios\/guias\/[0-9a-f-]{36}$/u.test(u.pathname) && !u.pathname.endsWith(fx!.guides.a.id), { timeout: 60_000 });
  const substitute = new URL(s.page.url()).pathname;
  await expect(panel(s.page)).toContainText('Esta guia substitui a');
  if (await s.page.getByRole('button', { name: 'Marcar como conferida' }).isVisible().catch(() => false)) {
    await s.page.getByRole('button', { name: 'Marcar como conferida' }).click();
    await done(s.page, 'Guia conferida');
    await s.page.reload();
  }
  await s.page.getByRole('button', { name: 'Aprovar e emitir' }).click();
  await done(s.page, 'Guia aprovada e emitida');
  await s.page.goto(substitute);
  await expect(situation(s.page).getByText('Aprovada', { exact: true }).first()).toBeVisible();
  await s.page.goto(guidePath('a'));
  await expect(situation(s.page).getByText('Substituída', { exact: true }).first()).toBeVisible();
  await expect(panel(s.page)).toContainText('Substituta:');
  await expect(s.page.getByRole('region', { name: 'Histórico da guia' })).toContainText('Substituída');
  expect(s.errors).toEqual([]);
});

test('guia B: recibo 2 recusa; a substituta pela action direta é recusada sem recibo 1; repetir a da A não cria outra', async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await session(browser, 'p75-gestor');
  await s.page.goto(guidePath('b'));
  await requestCancellation(s.page, `Pedido de cancelamento sintético da guia B (${fx!.run})`);
  await registerReceipt(s.page, '2', `P2${fx!.run}`.slice(0, 12));
  await expect(panel(s.page)).toContainText('Não cancelada pela operadora');
  await expect(panel(s.page).getByRole('button', { name: 'Criar a guia substituta' })).toHaveCount(0);
  // Server action chamada direto com a guia B (cancelamento recusado): o servidor recusa.
  expectRefused(await replay(s.page, createSubstitute!, createSubstitute!.body.split(fx!.guides.a.id).join(fx!.guides.b.id)));
  // Repetir a criação da substituta da A: não nasce uma segunda.
  await replay(s.page, createSubstitute!);
  await s.page.goto(guidePath('a'));
  const links = await panel(s.page).getByRole('link', { name: /guia nº/u }).count();
  expect(links).toBe(1);
  expect(s.errors).toEqual([]);
});

test('recepção: sem controles de faturamento; registrar recibo pela action direta é recusado', async ({ browser }) => {
  const s = await session(browser, 'p75-recepcao');
  await s.page.goto(guidePath('b'));
  await expect(s.page.getByRole('button', { name: 'Pedir o cancelamento à operadora' })).toHaveCount(0);
  await expect(s.page.getByRole('button', { name: 'Registrar o recibo da operadora' })).toHaveCount(0);
  await expect(s.page.getByRole('button', { name: 'Criar a guia substituta' })).toHaveCount(0);
  expectRefused(await replay(s.page, receiptAction!));
  expectRefused(await replay(s.page, createSubstitute!, createSubstitute!.body.split(fx!.guides.a.id).join(fx!.guides.b.id)));
  expect(s.errors).toEqual([]);
});

test('outra clínica: a guia não existe e as actions são recusadas', async ({ browser }) => {
  const s = await session(browser, 'outra-gestor');
  const r = await s.context.request.get(guidePath('a'), { failOnStatusCode: false });
  expect(r.status()).toBe(404);
  await s.page.goto('/convenios/guias');
  expectRefused(await replay(s.page, createSubstitute!));
  expectRefused(await replay(s.page, receiptAction!));
  expect(s.errors).toEqual([]);
});
