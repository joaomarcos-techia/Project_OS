/**
 * P8.4-r, exceção do médico — pelo CONSULTÓRIO oficial (tela do PR #56 com o bloco do #55 montado:
 * docs/convenios/patches/56-consultorio-p84r.patch). Roda no Preview da COMPOSIÇÃO #53 → #56 → #55
 * (no #55 sozinho o painel do atendimento é o antigo, sem o bloco). Fixture `setup-p84 --run <MARCA>`:
 * a 2ª sessão está em atendimento com a médica; a 3ª, com outra médica.
 *
 *   1. a médica registra, na própria sessão, o item do contrato executado (sem valor, sem decisão
 *      de faturamento, sem campo clínico); repetir não duplica; o estado fica depois do reload;
 *   2. o servidor recusa o registro na sessão de outra médica, pela recepção e por outra clínica;
 *   3. a outra médica vê só a sessão dela, sem o item da primeira;
 *   4. P5.2: o painel do atendimento mostra o resumo do convênio (operadora, carteirinha mascarada,
 *      situação), sem valor;
 *   5. P3.3/P5.2: a agenda oficial mostra "Convênios de hoje" — a recepção vê a pendência pré-consulta
 *      (sessão sem cobertura) e o link para resolver em Convênios; cada médica vê só os próprios.
 */
import { readFileSync } from 'node:fs';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { assertPreviewRuntimeIsDev } from './preview-dev-runtime';
import { vercelBypassHeaders } from './vercel-bypass';

const BASE = process.env.E2E_BASE_URL;
const ACCOUNTS = process.env.E2E_HI_P84_ACCOUNTS;
const STATE = process.env.E2E_HI_P84;

test.skip(!BASE || !ACCOUNTS || !STATE, 'requer E2E_BASE_URL (Preview da composição no DEV) e a fixture setup-p84');
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 45_000 });

type Account = { email: string; password: string; userId: string; clinic: string; role: string };
const accounts: Record<string, Account> = ACCOUNTS ? (JSON.parse(readFileSync(ACCOUNTS, 'utf8')) as Record<string, Account>) : {};
const fx = STATE
  ? (JSON.parse(readFileSync(STATE, 'utf8')) as {
      run: string;
      patientName: string;
      insurerName: string;
      cardLast4: string;
      sessions: { s1: string; s2: string; s3: string; s4: string; s5: string };
      codes: { doctor: string };
      lines: Record<string, string>;
    })
  : null;
const INTERNAL = /(?:\bat\s+\S+\s+\(|node_modules|drizzle|postgres|SQLSTATE|stack|constraint|violates|23514)/iu;
const NOT_OWN = 'Só o profissional desta sessão registra itens pelo consultório.';

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
function expectRefused(res: { text: string }, message?: string) {
  expect(res.text).toContain('"ok":false');
  expect(res.text).not.toContain('"ok":true');
  expect(res.text).not.toMatch(INTERNAL);
  if (message) expect(res.text).toContain(message);
}

/** Abre no consultório o atendimento em curso desta execução (a paciente da marca). */
async function openAttendance(page: Page) {
  await page.goto('/consultorio');
  const tab = page.getByRole('button', { name: fx!.patientName, exact: true });
  if (await tab.isVisible({ timeout: 10_000 }).catch(() => false)) await tab.click();
  const panel = page.locator('[data-slot="attending-panel"]');
  await expect(panel.getByRole('heading', { name: fx!.patientName })).toBeVisible({ timeout: 60_000 });
  return panel;
}

let recordOwn: Captured | null = null;

test('médica registra o item executado na PRÓPRIA sessão, sem valor nem decisão; repetir não duplica', async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await session(browser, 'p84-medica');
  const panel = await openAttendance(s.page);
  // P5.2: resumo administrativo do convênio no consultório (sem valor, carteirinha mascarada).
  const summary = panel.getByRole('note', { name: 'Convênio do atendimento' });
  await expect(summary).toContainText(fx!.insurerName);
  await expect(summary).toContainText(`••••${fx!.cardLast4}`);
  await expect(summary).not.toContainText(/R\$/u);
  const block = panel.locator('details').filter({ hasText: 'Itens executados além do agendado' });
  await block.locator('summary').click();
  const form = block.getByRole('form', { name: 'Registrar item executado' });
  const select = form.getByLabel('Item do contrato');
  const line = fx!.lines[fx!.codes.doctor]!;
  await select.selectOption(line);
  await form.getByLabel('Quantidade').fill('1');
  recordOwn = await capture(s.page, line, async () => {
    await form.getByRole('button', { name: 'Registrar item' }).click();
  });
  const list = block.getByRole('list', { name: 'Itens registrados nesta sessão' });
  await expect(list).toContainText(fx!.codes.doctor, { timeout: 60_000 });
  await expect(list).toContainText('Registrado; a clínica decide o faturamento');
  await expect(block).not.toContainText(/R\$/u);
  for (const name of ['Incluir na guia', 'Não faturar', 'Ligar a autorização']) await expect(block.getByRole('button', { name })).toHaveCount(0);
  const again = await replay(s.page, recordOwn);
  expect(again.text).toContain('"ok":true');
  await s.page.reload();
  const panel2 = await openAttendance(s.page);
  const block2 = panel2.locator('details').filter({ hasText: 'Itens executados além do agendado' });
  await block2.locator('summary').click();
  await expect(block2.getByRole('list', { name: 'Itens registrados nesta sessão' }).getByRole('listitem')).toHaveCount(1);
  expect(s.errors).toEqual([]);
});

test('servidor: sessão de outra médica, recepção e outra clínica não registram pela exceção do médico', async ({ browser }) => {
  // Dois logins novos (recepção e outra clínica) e três navegações.
  test.setTimeout(180_000);
  const s = await session(browser, 'p84-medica');
  await s.page.goto('/consultorio');
  expectRefused(await replay(s.page, recordOwn!, recordOwn!.body.replaceAll(fx!.sessions.s2, fx!.sessions.s3)), NOT_OWN);
  const r = await session(browser, 'p84-recepcao');
  await r.page.goto('/consultorio');
  expectRefused(await replay(r.page, recordOwn!), NOT_OWN);
  const o = await session(browser, 'p84b-medica');
  await o.page.goto('/consultorio');
  expectRefused(await replay(o.page, recordOwn!));
});

test('a outra médica vê só a própria sessão, sem o item registrado pela primeira', async ({ browser }) => {
  // Login novo e a espera do painel do atendimento (até 60 s, como no 1º teste).
  test.setTimeout(180_000);
  const s = await session(browser, 'p84-medica2');
  const panel = await openAttendance(s.page);
  const block = panel.locator('details').filter({ hasText: 'Itens executados além do agendado' });
  await expect(block).toBeVisible();
  await block.locator('summary').click();
  await expect(block.getByRole('list', { name: 'Itens registrados nesta sessão' })).toHaveCount(0);
  await expect(block).not.toContainText(fx!.codes.doctor);
  expect(s.errors).toEqual([]);
});

const strip = (page: Page) => page.getByRole('region', { name: 'Convênios de hoje' });
const row = (page: Page, id: string) => strip(page).locator(`li[data-appointment="${id}"]`);

test('agenda: a recepção vê a pendência pré-consulta de hoje e vai resolver em Convênios', async ({ browser }) => {
  test.setTimeout(180_000);
  const s = await session(browser, 'p84-recepcao');
  await s.page.goto('/agenda');
  await expect(strip(s.page)).toBeVisible({ timeout: 60_000 });
  await expect(row(s.page, fx!.sessions.s5)).toHaveAttribute('data-pending', 'yes');
  await expect(row(s.page, fx!.sessions.s5)).toContainText('Sem cobertura de convênio registrada.');
  await expect(row(s.page, fx!.sessions.s4)).toHaveAttribute('data-pending', 'no');
  await expect(row(s.page, fx!.sessions.s4)).toContainText(`••••${fx!.cardLast4}`);
  await expect(strip(s.page)).not.toContainText(/R\$/u);
  await strip(s.page).getByRole('link', { name: 'Resolver as pendências em Convênios' }).click();
  await s.page.waitForURL(/\/convenios\/atendimentos/u, { timeout: 60_000 });
  await expect(s.page.locator('body')).toContainText(fx!.patientName);
  expect(s.errors).toEqual([]);
});

test('agenda: cada médica vê só os próprios convênios de hoje, sem o link de resolver', async ({ browser }) => {
  // Duas cargas da agenda, cada uma com espera de até 60 s pela faixa.
  test.setTimeout(180_000);
  const m1 = await session(browser, 'p84-medica');
  await m1.page.goto('/agenda');
  await expect(row(m1.page, fx!.sessions.s4)).toBeVisible({ timeout: 60_000 });
  await expect(row(m1.page, fx!.sessions.s5)).toHaveCount(0);
  await expect(strip(m1.page).getByRole('link', { name: 'Resolver as pendências em Convênios' })).toHaveCount(0);
  const m2 = await session(browser, 'p84-medica2');
  await m2.page.goto('/agenda');
  await expect(row(m2.page, fx!.sessions.s5)).toHaveAttribute('data-pending', 'yes', { timeout: 60_000 });
  await expect(row(m2.page, fx!.sessions.s4)).toHaveCount(0);
  await expect(strip(m2.page)).toContainText('A recepção resolve as pendências em Convênios.');
});
