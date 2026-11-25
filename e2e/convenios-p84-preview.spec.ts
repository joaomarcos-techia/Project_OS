/**
 * P8.4 / P8.4-r — itens executados adicionais da SP/SADT, pela tela, no Preview ligado ao DEV
 * (navegador remoto). Clínica sintética `e2e-hi-p84` (fixture `setup-p84 --run <MARCA>`): guia
 * SP/SADT nascida da 1ª sessão (pronta para conferir), solicitação com o agendado (4 autorizados),
 * um adicional autorizado (2) e um com saldo curto (1); regra da operadora "não informada".
 *
 *   1. recepção registra cinco itens (dois sem exigência, três que exigem autorização) e vê cada
 *      estado; liga a autorização do que tem saldo; não vê "Incluir" nem "Não faturar";
 *   2. o servidor recusa ligar autorização sem saldo e fora da solicitação; repetir o registro não
 *      duplica; quantidade inválida é recusada;
 *   3. gestora confere: com pendente, nada de "Aprovar e emitir" (aviso com a contagem); motivo
 *      curto não confirma; devolve para correção;
 *   4. gestora inclui (com a confirmação do contrato, operadora sem regra registrada) o item sem
 *      exigência e o autorizado; duas inclusões simultâneas não duplicam; não fatura o outro com
 *      motivo; item decidido não muda (servidor);
 *   5. confere e "aprova sem os pendentes" com motivo: guia aprovada, pendentes não faturados;
 *   6. recepção (sem faturamento) e outra clínica: o servidor recusa incluir/não faturar/registrar;
 *      a médica vê a guia sem nenhum controle; outra médica não abre a guia;
 *   7. lote SP/SADT: XML (validado no XSD) com o agendado e os incluídos, sem os não faturados;
 *      envio: recebível igual ao valor da guia; consumo e auditoria conferidos no banco (relé).
 *
 * Nada é transmitido a operadora nenhuma: autorização, envio e protocolo são registros sintéticos.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

import { assertPreviewRuntimeIsDev } from './preview-dev-runtime';
import { vercelBypassHeaders } from './vercel-bypass';

const BASE = process.env.E2E_BASE_URL;
const ACCOUNTS = process.env.E2E_HI_P84_ACCOUNTS;
const STATE = process.env.E2E_HI_P84;
const FIXTURE_CMD = process.env.E2E_HI_FIXTURE_CMD;

test.skip(!BASE || !ACCOUNTS || !STATE || !FIXTURE_CMD, 'requer E2E_BASE_URL (Preview no DEV), a fixture setup-p84 e o comando da fixture');
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 45_000 });

type Account = { email: string; password: string; userId: string; clinic: string; role: string };
const accounts: Record<string, Account> = ACCOUNTS ? (JSON.parse(readFileSync(ACCOUNTS, 'utf8')) as Record<string, Account>) : {};
const fx = STATE
  ? (JSON.parse(readFileSync(STATE, 'utf8')) as {
      run: string;
      insurerName: string;
      guide: { id: string; status: string; total: number };
      sessions: { s1: string; s2: string; s3: string };
      codes: { main: string; authorized: string; short: string; outside: string; free: string; late: string; doctor: string };
    })
  : null;
const guidePath = () => `/convenios/guias/${fx!.guide.id}`;
const INTERNAL = /(?:\bat\s+\S+\s+\(|node_modules|drizzle|postgres|SQLSTATE|stack|constraint|violates|23514|55000)/iu;
const NO_PERMISSION = 'Seu perfil não tem permissão para esta operação de convênios.';
const REASON = `Operadora não aceita este procedimento sem pedido prévio (${'x'.repeat(4)})`;
const APPROVE_REASON = 'Autorização não concedida pela operadora para estes procedimentos';

type P84State = { s: string; t: number; n: number; x: string; k: number; l: number; v: string; a: string };
function p84State(): P84State {
  const out = execFileSync(process.execPath, [FIXTURE_CMD!, 'p84-state', '--guide', fx!.guide.id], {
    encoding: 'utf8',
    timeout: 240_000,
    windowsHide: true,
  });
  const m = /P84_STATE (\{.+\})/u.exec(out);
  if (!m) throw new Error(`p84-state sem resposta: ${out.slice(-300)}`);
  return JSON.parse(m[1]!) as P84State;
}
/** Contagem da auditoria por letra (r registro, g ligação, i inclusão, e exclusão, o "aprovar sem", p aprovação). */
const audit = (a: string) => Object.fromEntries([...a.matchAll(/([a-z])(\d+)/gu)].map((m) => [m[1]!, Number(m[2])]));

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
function expectRefused(res: { text: string }, message?: string) {
  expect(res.text).toContain('"ok":false');
  expect(res.text).not.toContain('"ok":true');
  expect(res.text).not.toMatch(INTERNAL);
  if (message) expect(res.text).toContain(message);
}
async function fetchFile(page: Page, href: string): Promise<{ status: number; type: string; text: string }> {
  return page.evaluate(async (u) => {
    const r = await fetch(u);
    const buf = new Uint8Array(await r.arrayBuffer());
    return { status: r.status, type: r.headers.get('content-type') ?? '', text: new TextDecoder('latin1').decode(buf) };
  }, href);
}

const panel = (page: Page) => page.getByRole('region', { name: 'Itens executados adicionais' });
const itemOf = (page: Page, code: string): Locator => panel(page).locator('li[data-item]').filter({ hasText: `· ${code} —` }).first();
const itemId = async (page: Page, code: string) => (await itemOf(page, code).getAttribute('data-item'))!;
const procedures = (page: Page) => page.getByRole('region', { name: 'Procedimentos da guia' });
async function register(page: Page, code: string, quantity: number) {
  const form = panel(page).getByRole('form', { name: 'Registrar item executado' }).first();
  const select = form.getByLabel('Item do contrato');
  const value = await select.locator('option', { hasText: `· ${code} —` }).first().getAttribute('value');
  await select.selectOption(value!);
  await form.getByLabel('Quantidade').fill(String(quantity));
  await form.getByRole('button', { name: 'Registrar item' }).click();
  await done(page, 'Item executado registrado');
  await page.reload();
}

let recordAction: Captured | null = null;
let regularizeAction: Captured | null = null;
let includeAction: Captured | null = null;
let excludeAction: Captured | null = null;
const ids: Record<string, string> = {};

test('recepção registra os itens, vê cada estado e liga a autorização do que tem saldo', async ({ browser }) => {
  test.setTimeout(420_000);
  const s = await session(browser, 'p84-recepcao');
  await s.page.goto(guidePath());
  await expect(panel(s.page)).toBeVisible();
  // P12.11: fornecedor, software e a versão DO BUILD (o commit que este runner testa) na tela.
  const identity = s.page.locator('[data-software-identity]').first();
  await expect(identity).toContainText('Fornecedor Qoro · Qoro Convênios · versão');
  if (process.env.GITHUB_SHA) await expect(identity).toContainText(process.env.GITHUB_SHA.slice(0, 12));
  await expect(procedures(s.page).getByRole('row')).toHaveCount(2); // cabeçalho + a sessão agendada
  // O primeiro registro é capturado para as recusas do servidor depois.
  const form = panel(s.page).getByRole('form', { name: 'Registrar item executado' }).first();
  const select = form.getByLabel('Item do contrato');
  const freeLine = await select.locator('option', { hasText: `· ${fx!.codes.free} —` }).first().getAttribute('value');
  await select.selectOption(freeLine!);
  await form.getByLabel('Quantidade').fill('2');
  recordAction = await capture(s.page, freeLine!, async () => {
    await form.getByRole('button', { name: 'Registrar item' }).click();
  });
  await done(s.page, 'Item executado registrado');
  await s.page.reload();
  await register(s.page, fx!.codes.late, 1);
  await register(s.page, fx!.codes.authorized, 2);
  await register(s.page, fx!.codes.short, 2);
  await register(s.page, fx!.codes.outside, 1);
  for (const k of ['free', 'late', 'authorized', 'short', 'outside'] as const) ids[k] = await itemId(s.page, fx!.codes[k]);
  await expect(itemOf(s.page, fx!.codes.free)).toHaveAttribute('data-stage', 'ready_to_include');
  await expect(itemOf(s.page, fx!.codes.late)).toHaveAttribute('data-stage', 'ready_to_include');
  await expect(itemOf(s.page, fx!.codes.authorized)).toHaveAttribute('data-stage', 'authorization_available');
  await expect(itemOf(s.page, fx!.codes.short)).toHaveAttribute('data-stage', 'awaiting_authorization');
  await expect(itemOf(s.page, fx!.codes.short)).toContainText('saldo autorizado (1)');
  await expect(itemOf(s.page, fx!.codes.outside)).toHaveAttribute('data-stage', 'awaiting_authorization');
  // A recepção não decide faturamento.
  await expect(panel(s.page).getByRole('button', { name: 'Incluir na guia' })).toHaveCount(0);
  await expect(panel(s.page).getByRole('button', { name: 'Não faturar' })).toHaveCount(0);
  await expect(panel(s.page).getByRole('button', { name: 'Ligar a autorização' })).toHaveCount(1);
  regularizeAction = await capture(s.page, ids.authorized!, async () => {
    await itemOf(s.page, fx!.codes.authorized).getByRole('button', { name: 'Ligar a autorização' }).click();
  });
  await done(s.page, 'Autorização ligada ao item');
  await s.page.reload();
  await expect(itemOf(s.page, fx!.codes.authorized)).toHaveAttribute('data-stage', 'ready_to_include');
  // Nada entrou na guia (regra 2: nunca automático).
  await expect(procedures(s.page).getByRole('row')).toHaveCount(2);
  expect(s.errors).toEqual([]);
});

test('servidor: sem saldo e fora da solicitação não liga; repetir o registro não duplica; quantidade inválida', async ({ browser }) => {
  // Inclui uma leitura pelo relé da fixture (até 200 s); 46 s no HS25-55D.
  test.setTimeout(180_000);
  const s = await session(browser, 'p84-recepcao');
  await s.page.goto(guidePath());
  expectRefused(await replay(s.page, regularizeAction!, regularizeAction!.body.replaceAll(ids.authorized!, ids.short!)), 'saldo autorizado');
  expectRefused(await replay(s.page, regularizeAction!, regularizeAction!.body.replaceAll(ids.authorized!, ids.outside!)));
  const again = await replay(s.page, recordAction!);
  expect(again.text).toContain('"ok":true');
  expect(again.text).toContain(ids.free!);
  expectRefused(await replay(s.page, recordAction!, recordAction!.body.replace(/"quantity":2/u, '"quantity":1000')), 'A quantidade precisa ser um número inteiro de 1 a 999.');
  await s.page.reload();
  await expect(panel(s.page).locator('li[data-item]').filter({ hasText: `· ${fx!.codes.free} —` })).toHaveCount(1);
  const db = p84State();
  expect(db.x).toBe('R4G1I0E0C0');
  expect([db.n, db.k]).toEqual([1, 0]);
});

test('gestora: com pendente não há aprovação silenciosa; motivo curto não confirma; devolve para correção', async ({ browser }) => {
  test.setTimeout(240_000);
  const s = await session(browser, 'p84-gestor');
  await s.page.goto(guidePath());
  await s.page.getByRole('button', { name: 'Marcar como conferida' }).click();
  await done(s.page, 'Guia conferida');
  await s.page.reload();
  await expect(s.page.getByRole('button', { name: 'Aprovar e emitir' })).toHaveCount(0);
  const notice = s.page.getByRole('status').filter({ hasText: 'itens executados adicionais sem decisão' });
  await expect(notice).toContainText('Há 5 itens executados adicionais sem decisão nesta guia.');
  await notice.getByRole('button', { name: 'Aprovar sem os itens pendentes' }).click();
  await notice.getByLabel(/Por que os itens pendentes não serão faturados/u).fill('curto');
  await expect(notice.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
  await notice.getByRole('button', { name: 'Voltar' }).click();
  await s.page.getByRole('button', { name: 'Devolver para correção' }).click();
  await s.page.getByLabel('O que precisa ser corrigido').fill('Decidir os itens executados adicionais antes de aprovar');
  await s.page.getByRole('button', { name: 'Confirmar' }).click();
  await done(s.page, 'Guia devolvida para correção');
  expect(s.errors).toEqual([]);
});

test('gestora inclui explicitamente (confirmando o contrato), sem duplicar em concorrência, e não fatura um com motivo', async ({ browser }) => {
  test.setTimeout(420_000);
  const s = await session(browser, 'p84-gestor');
  await s.page.goto(guidePath());
  const free = itemOf(s.page, fx!.codes.free);
  const includeBtn = free.getByRole('button', { name: 'Incluir na guia' });
  await expect(includeBtn).toBeDisabled(); // regra da operadora não informada: pede a confirmação
  await free.getByRole('checkbox', { name: /Confirmo que o contrato desta operadora aceita/u }).click();
  includeAction = await capture(s.page, ids.free!, async () => {
    await includeBtn.click();
  });
  await done(s.page, 'Item incluído na guia');
  await s.page.reload();
  await expect(itemOf(s.page, fx!.codes.free)).toHaveAttribute('data-stage', 'included');
  const auth = itemOf(s.page, fx!.codes.authorized);
  await auth.getByRole('checkbox', { name: /Confirmo que o contrato desta operadora aceita/u }).click();
  await auth.getByRole('button', { name: 'Incluir na guia' }).click();
  await done(s.page, 'Item incluído na guia');
  // Duas inclusões simultâneas do mesmo item (duas abas): uma linha só.
  const both = await Promise.all([replay(s.page, includeAction!), replay(s.page, includeAction!)]);
  for (const r of both) expect(r.text).toContain('"ok":true');
  await s.page.reload();
  await expect(procedures(s.page).getByRole('row')).toHaveCount(4); // cabeçalho + agendado + 2 incluídos
  await expect(procedures(s.page).getByRole('row').filter({ hasText: fx!.codes.free })).toHaveCount(1);
  await expect(procedures(s.page).getByRole('row').filter({ hasText: fx!.codes.free })).toContainText('2');
  await expect(procedures(s.page).getByRole('row').filter({ hasText: fx!.codes.authorized })).toContainText('2');
  // Não faturar: motivo de 10 a 300 caracteres; o item fica no histórico.
  const late = itemOf(s.page, fx!.codes.late);
  await late.getByRole('button', { name: 'Não faturar' }).click();
  await late.getByLabel('Por que este item não será faturado').fill('curto');
  await expect(late.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
  await late.getByLabel('Por que este item não será faturado').fill(REASON);
  excludeAction = await capture(s.page, ids.late!, async () => {
    await late.getByRole('button', { name: 'Confirmar' }).click();
  });
  await done(s.page, 'Registrado como não faturado');
  await s.page.reload();
  await expect(panel(s.page).getByText(/Não faturados e cancelados \(1\)/u)).toBeVisible();
  // Item decidido não muda (servidor): incluir o não faturado é recusado.
  expectRefused(await replay(s.page, includeAction!, includeAction!.body.replaceAll(ids.free!, ids.late!)), 'já foi decidido');
  const db = p84State();
  expect(db.x).toBe('R2G0I2E1C0');
  expect([db.n, db.k, db.t]).toEqual([3, 2, 9000 + 2 * 3000 + 2 * 2500]);
  expect(s.errors).toEqual([]);
});

test('gestora confere e aprova sem os pendentes, com motivo: guia aprovada, pendentes não faturados', async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await session(browser, 'p84-gestor');
  await s.page.goto(guidePath());
  await s.page.getByRole('button', { name: 'Marcar como conferida' }).click();
  await done(s.page, 'Guia conferida');
  await s.page.reload();
  const notice = s.page.getByRole('status').filter({ hasText: 'itens executados adicionais sem decisão' });
  await expect(notice).toContainText('Há 2 itens executados adicionais sem decisão nesta guia.');
  await notice.getByRole('button', { name: 'Aprovar sem os itens pendentes' }).click();
  await notice.getByLabel(/Por que os itens pendentes não serão faturados/u).fill(APPROVE_REASON);
  await notice.getByRole('button', { name: 'Confirmar' }).click();
  await done(s.page, 'Guia aprovada e emitida; itens registrados como não faturados');
  await s.page.reload();
  await expect(s.page.getByRole('region', { name: 'Situação da guia' })).toContainText('Aprovada');
  await expect(panel(s.page).getByText(/Não faturados e cancelados \(3\)/u)).toBeVisible();
  await expect(panel(s.page)).toContainText(`não faturado: ${APPROVE_REASON}`);
  const db = p84State();
  expect(db.s).toBe('ap');
  expect(db.x).toBe('R0G0I2E3C0');
  expect(db.l).toBe(0); // recebível só nasce no envio
  expect(s.errors).toEqual([]);
});

test('sem faturamento, outra clínica e médica: o servidor recusa; a médica vê sem controles; outra médica não abre', async ({ browser }) => {
  // Três logins novos (outra clínica, médica, outra médica) e cinco navegações: o padrão de 30 s
  // não cobre nem os três logins no Preview (HS25-55D, f0a33dc9: estourou no 3º login).
  test.setTimeout(180_000);
  const r = await session(browser, 'p84-recepcao');
  await r.page.goto(guidePath());
  expectRefused(await replay(r.page, includeAction!), NO_PERMISSION);
  expectRefused(await replay(r.page, excludeAction!), NO_PERMISSION);
  const o = await session(browser, 'p84b-medica');
  const res = await o.page.goto(guidePath());
  expect(res?.status()).toBe(404);
  await o.page.goto('/convenios');
  expectRefused(await replay(o.page, recordAction!));
  const m = await session(browser, 'p84-medica');
  await m.page.goto(guidePath());
  await expect(panel(m.page)).toBeVisible();
  for (const name of ['Incluir na guia', 'Não faturar', 'Ligar a autorização', 'Registrar item', 'Cancelar registro']) {
    await expect(panel(m.page).getByRole('button', { name })).toHaveCount(0);
  }
  expectRefused(await replay(m.page, includeAction!), NO_PERMISSION);
  const m2 = await session(browser, 'p84-medica2');
  expect((await m2.page.goto(guidePath()))?.status()).toBe(404);
});

test('lote SP/SADT: XML (XSD) com o agendado e os incluídos, sem os não faturados; envio: recebível igual à guia', async ({ browser }) => {
  test.setTimeout(480_000);
  const s = await session(browser, 'p84-gestor');
  await s.page.goto('/convenios/lotes');
  const ins = s.page.getByLabel('Operadora').first();
  await ins.selectOption((await ins.locator('option', { hasText: fx!.insurerName }).first().getAttribute('value'))!);
  await s.page.getByLabel('Tipo de guia').selectOption('sp_sadt');
  await s.page.getByText('Todas (até 100)').click();
  await s.page.getByRole('button', { name: 'Montar lote' }).click();
  await s.page.waitForURL(/\/convenios\/lotes\/[0-9a-f-]{36}$/u, { timeout: 60_000 });
  const batch = new URL(s.page.url()).pathname;
  await s.page.getByRole('button', { name: 'Gerar e validar XML' }).click();
  await done(s.page, 'XML gerado e validado');
  await s.page.goto(batch);
  const xml = await fetchFile(s.page, (await s.page.getByRole('link', { name: 'Baixar XML' }).first().getAttribute('href'))!);
  expect(xml.status).toBe(200);
  expect(xml.text).toMatch(/guiaSP-SADT/u);
  const codes = [...xml.text.matchAll(/codigoProcedimento>\s*([0-9]+)\s*</gu)].map((m) => m[1]);
  for (const c of [fx!.codes.main, fx!.codes.free, fx!.codes.authorized]) expect(codes, c).toContain(c);
  for (const c of [fx!.codes.late, fx!.codes.short, fx!.codes.outside]) expect(codes, c).not.toContain(c);
  const freeAt = xml.text.indexOf(`>${fx!.codes.free}<`);
  expect(xml.text.slice(freeAt, freeAt + 700)).toMatch(/quantidadeExecutada>\s*2\s*</u);
  await s.page.getByRole('button', { name: 'Marcar como enviado' }).click();
  await s.page.getByLabel('Como o lote foi enviado').fill('Enviado pelo portal da operadora sintética, comprovante de teste');
  await s.page.getByRole('button', { name: 'Confirmar' }).click();
  await done(s.page, 'Envio registrado');
  const total = 9000 + 2 * 3000 + 2 * 2500;
  const db = p84State();
  expect([db.l, db.v, db.t]).toEqual([1, (total / 100).toFixed(2), total]); // um recebível, valor − pago − glosado = guia
  expect(db.k).toBe(2); // o adicional autorizado consumiu exatamente 2, uma vez
  const a = audit(db.a);
  expect(a.r).toBeGreaterThanOrEqual(5);
  expect(a.g).toBe(1);
  expect(a.i).toBeGreaterThanOrEqual(2);
  expect([a.e, a.o, a.p]).toEqual([1, 1, 1]);
  await s.page.goto(guidePath());
  // toLocaleString usa espaço inseparável entre "R$" e o valor.
  await expect(s.page.getByRole('region', { name: 'Conta da guia' })).toContainText(new RegExp(`R\\$\\s${(total / 100).toFixed(2).replace('.', ',')}`, 'u'));
  expect(s.errors).toEqual([]);
});
