/**
 * Convênios no navegador, contra um PREVIEW que usa o DEV (P5/P3 da orientação de 12/11):
 * acesso (anônimo, sem permissão, trial, suspensa, paga), todas as telas em desktop e celular,
 * guia de Consulta (conferir → emitir → PDF), lote (montar → XML validado no XSD → download),
 * solicitação SP/SADT (registrar → conferir → documento oficial → PDF → autorização parcial →
 * ligar sessão), 404 entre clínicas, ação repetida.
 *
 * Só dados SINTÉTICOS da fixture `scripts/security/hi-dev-e2e-fixture.ts` (clínicas `e2e-hi-*`);
 * antes de qualquer escrita, a prova assinada confirma que o Preview usa o projeto DEV. Contas e
 * IDs vêm de arquivos fora do repositório.
 *
 *   E2E_BASE_URL=<preview> E2E_HI_ACCOUNTS=<contas.json> E2E_HI_FIXTURE=<ids.json> [E2E_HI_SHOTS=<dir>] \
 *     VERCEL_AUTOMATION_BYPASS_SECRET=… MAGIC_TOKEN_SECRET_DEV=… npx playwright test e2e/convenios-preview.spec.ts
 */
import { mkdirSync, readFileSync } from 'node:fs';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { assertPreviewRuntimeIsDev } from './preview-dev-runtime';
import { vercelBypassHeaders } from './vercel-bypass';

const ACCOUNTS = process.env.E2E_HI_ACCOUNTS;
const FIXTURE = process.env.E2E_HI_FIXTURE;
const SHOTS = process.env.E2E_HI_SHOTS;
const BASE = process.env.E2E_BASE_URL;

test.skip(!BASE || !ACCOUNTS || !FIXTURE, 'requer E2E_BASE_URL (Preview no DEV) e a fixture e2e-hi');
test.describe.configure({ mode: 'serial' });

type Account = { email: string; password: string; userId: string; clinic: string; role: string };
const accounts = ACCOUNTS ? (JSON.parse(readFileSync(ACCOUNTS, 'utf8')) as Record<string, Account>) : {};
const fx = FIXTURE
  ? (JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
      clinics: Record<'paga' | 'trial' | 'suspensa', string>;
      guideIds: string[];
      appointments: Record<string, string>;
    })
  : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const PAGES = ['/convenios', '/convenios/guias', '/convenios/solicitacoes', '/convenios/lotes', '/convenios/conciliacao', '/convenios/repasses'];

interface Session {
  context: BrowserContext;
  page: Page;
  errors: string[];
}

async function login(browser: Browser, key: string, viewport = DESKTOP): Promise<Session> {
  const account = accounts[key];
  if (!account) throw new Error(`conta ${key} ausente na fixture`);
  const context = await browser.newContext({ viewport, extraHTTPHeaders: vercelBypassHeaders() });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/login', { waitUntil: 'load' });
  await page.fill('#email', account.email);
  await page.fill('#password', account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  return { context, page, errors };
}

async function visit(s: Session, path: string, shot?: string): Promise<number> {
  const res = await s.page.goto(path, { waitUntil: 'load' });
  // O shell tem chamadas periódicas: "rede ociosa" pode nunca chegar; espera curta e segue.
  await s.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  // Página inteira sem rolagem horizontal (tabelas rolam dentro do próprio contêiner).
  const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${path} transborda na horizontal`).toBeLessThanOrEqual(1);
  if (SHOTS && shot) await s.page.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true });
  return res?.status() ?? 0;
}

const toast = (page: Page, text: string) => expect(page.getByText(text, { exact: false }).first()).toBeVisible({ timeout: 45_000 });

test('o Preview usa o projeto DEV (prova assinada antes de qualquer escrita)', async () => {
  test.setTimeout(90_000);
  await assertPreviewRuntimeIsDev(BASE!);
});

test('anônimo: Convênios e documentos exigem sessão', async ({ browser }) => {
  const context = await browser.newContext({ extraHTTPHeaders: vercelBypassHeaders() });
  const page = await context.newPage();
  await page.goto('/convenios', { waitUntil: 'load' });
  expect(new URL(page.url()).pathname).toBe('/login');
  const pdf = await context.request.get(`/financeiro/convenios/guias/${fx!.guideIds[0]}/pdf`, { maxRedirects: 0 });
  expect([302, 303, 307, 401, 404]).toContain(pdf.status());
  await context.close();
});

test('médica (sem ver o financeiro): vê o aviso de acesso e não baixa documento (404)', async ({ browser }) => {
  test.setTimeout(120_000);
  const s = await login(browser, 'medica');
  await visit(s, '/convenios', 'medica-sem-acesso');
  await expect(s.page.getByText('Seu perfil não tem permissão para o faturamento de convênios.')).toBeVisible();
  const pdf = await s.context.request.get(`/financeiro/convenios/guias/${fx!.guideIds[0]}/pdf`);
  expect(pdf.status()).toBe(404);
  expect((await s.context.request.get('/financeiro/convenios/solicitacoes/00000000-0000-4000-8000-000000000000/pdf')).status()).toBe(404);
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('recepção (vê, não gerencia o financeiro): telas abertas, nenhuma ação disponível', async ({ browser }) => {
  test.setTimeout(150_000);
  const s = await login(browser, 'recepcao');
  expect(await visit(s, '/convenios', 'recepcao-painel')).toBe(200);
  await expect(s.page.getByText('Seu perfil não tem permissão')).toHaveCount(0);
  expect(await visit(s, `/convenios/guias/${fx!.guideIds[0]}`, 'recepcao-guia')).toBe(200);
  for (const name of ['Marcar como conferida', 'Aprovar e emitir', 'Cancelar guia']) {
    await expect(s.page.getByRole('button', { name })).toHaveCount(0);
  }
  expect(await visit(s, '/convenios/solicitacoes', 'recepcao-solicitacoes')).toBe(200);
  await expect(s.page.getByRole('button', { name: 'Registrar solicitação' })).toHaveCount(0);
  expect(await visit(s, '/convenios/lotes', 'recepcao-lotes')).toBe(200);
  await expect(s.page.getByRole('button', { name: 'Montar lote' })).toHaveCount(0);
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('trial: as telas mostram Convênios como recurso contratável, sem operação', async ({ browser }) => {
  test.setTimeout(180_000);
  const s = await login(browser, 'gestor-trial');
  for (const path of PAGES) {
    expect(await visit(s, path, `trial${path.replaceAll('/', '-')}`)).toBe(200);
    const notice = s.page.getByTestId('convenios-commercial-notice');
    await expect(notice).toBeVisible();
    expect(await notice.getAttribute('data-denial')).toBe('trial');
  }
  // Documento de outra clínica: o mesmo 404.
  expect((await s.context.request.get(`/financeiro/convenios/guias/${fx!.guideIds[0]}/pdf`)).status()).toBe(404);
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('suspensa: modo de consulta com o motivo do banco', async ({ browser }) => {
  test.setTimeout(180_000);
  const s = await login(browser, 'gestor-suspensa');
  await visit(s, '/convenios', 'suspensa-painel');
  const notice = s.page.getByTestId('convenios-commercial-notice');
  await expect(notice).toBeVisible();
  expect(['period_expired', 'clinic_suspended', 'subscription_inactive']).toContain(await notice.getAttribute('data-denial'));
  await expect(notice).toContainText('continuam disponíveis');
  expect(s.errors).toEqual([]);
  await s.context.close();
});

for (const [label, viewport] of [['desktop', DESKTOP], ['celular', MOBILE]] as const) {
  test(`clínica paga, ${label}: todas as telas de Convênios abrem sem erro e sem aviso comercial`, async ({ browser }) => {
    test.setTimeout(240_000);
    const s = await login(browser, 'gestor', viewport);
    for (const path of PAGES) {
      expect(await visit(s, path, `paga-${label}${path.replaceAll('/', '-')}`)).toBe(200);
      await expect(s.page.getByTestId('convenios-commercial-notice')).toHaveCount(0);
    }
    expect(await visit(s, `/convenios/guias/${fx!.guideIds[0]}`, `paga-${label}-guia`)).toBe(200);
    expect(s.errors).toEqual([]);
    await s.context.close();
  });
}

test('guia de Consulta: conferir → aprovar e emitir → PDF oficial do snapshot', async ({ browser }) => {
  test.setTimeout(240_000);
  const s = await login(browser, 'gestor');
  const guide = fx!.guideIds[0]!;
  await visit(s, `/convenios/guias/${guide}`);
  await s.page.getByRole('button', { name: 'Marcar como conferida' }).click();
  await toast(s.page, 'Guia conferida');
  await s.page.getByRole('button', { name: 'Aprovar e emitir' }).click();
  await toast(s.page, 'Guia aprovada e emitida');
  const pdf = await s.context.request.get(`/financeiro/convenios/guias/${guide}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(pdf.headers()['cache-control']).toContain('no-store');
  await visit(s, `/convenios/guias/${guide}`, 'paga-guia-emitida');
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('ação repetida: dois cliques em "Marcar como conferida" fazem UMA transição', async ({ browser }) => {
  test.setTimeout(180_000);
  const s = await login(browser, 'gestor');
  const guide = fx!.guideIds[1]!;
  await visit(s, `/convenios/guias/${guide}`);
  const button = s.page.getByRole('button', { name: 'Marcar como conferida' });
  await button.dblclick();
  await toast(s.page, 'Guia conferida');
  await s.page.reload({ waitUntil: 'load' });
  await expect(s.page.getByRole('button', { name: 'Marcar como conferida' })).toHaveCount(0);
  await expect(s.page.getByRole('button', { name: 'Aprovar e emitir' })).toBeVisible();
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('lote: montar com a guia emitida → XML gerado e validado no XSD → download conferido', async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await login(browser, 'gestor');
  await visit(s, '/convenios/lotes', 'paga-lotes-antes');
  const form = (await s.page.getByLabel('Tipo de guia').count()) > 0;
  if (form) await s.page.getByLabel('Tipo de guia').selectOption('consulta', { timeout: 15_000 });
  if (form && (await s.page.getByRole('checkbox').count()) > 0) {
    await s.page.getByRole('checkbox').first().check();
    await s.page.getByRole('button', { name: 'Montar lote' }).click();
    await s.page.waitForURL(/\/convenios\/lotes\/[0-9a-f-]{36}$/u, { timeout: 60_000 });
  } else {
    // Reexecução: a guia emitida já está num lote preparado (a fixture é a mesma).
    await s.page.goto((await s.page.locator('a[href^="/convenios/lotes/"]').first().getAttribute('href'))!, { waitUntil: 'load' });
  }
  await s.page.getByRole('button', { name: 'Gerar e validar XML' }).click();
  await toast(s.page, 'XML gerado e validado');
  await s.page.reload({ waitUntil: 'load' });
  const href = await s.page.locator('a[href^="/financeiro/convenios/arquivos/"]').first().getAttribute('href');
  expect(href).toBeTruthy();
  const xml = await s.context.request.get(href!);
  expect(xml.status()).toBe(200);
  expect(xml.headers()['content-type']).toContain('application/xml');
  expect(xml.headers()['x-content-sha256']).toMatch(/^[0-9a-f]{64}$/u);
  const text = (await xml.body()).toString('latin1');
  expect(text).toContain('ENVIO_LOTE_GUIAS');
  await visit(s, s.page.url().replace(BASE!, ''), 'paga-lote-xml');
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('solicitação SP/SADT: registrar → conferir → documento oficial (PDF) → autorização parcial → ligar sessão', async ({ browser }) => {
  test.setTimeout(360_000);
  const s = await login(browser, 'gestor');
  await visit(s, '/convenios/solicitacoes');
  const card = s.page.getByLabel('Paciente e carteirinha');
  const option = card.locator('option', { hasText: 'Três' }).first();
  await card.selectOption(await option.getAttribute('value') as string);
  await s.page.getByLabel('Procedimento 1').selectOption('22:50000470');
  await s.page.getByLabel('Quantidade').first().fill('4');
  await s.page.getByRole('button', { name: 'Registrar solicitação' }).click();
  await s.page.waitForURL(/\/convenios\/solicitacoes\/[0-9a-f-]{36}$/u, { timeout: 60_000 });
  const requestId = s.page.url().split('/').at(-1)!;
  await s.page.getByRole('button', { name: 'Conferir solicitação' }).click();
  await toast(s.page, 'Conferência registrada');
  await s.page.reload({ waitUntil: 'load' });
  await expect(s.page.getByRole('region', { name: 'Documento oficial do pedido à operadora' })).toBeVisible();
  await expect(s.page.getByRole('link', { name: 'Abrir PDF' })).toBeVisible({ timeout: 30_000 });
  const pdf = await s.context.request.get(`/financeiro/convenios/solicitacoes/${requestId}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect(pdf.headers()['x-content-sha256']).toMatch(/^[0-9a-f]{64}$/u);
  await visit(s, `/convenios/solicitacoes/${requestId}`, 'paga-solicitacao-documento');

  await s.page.getByRole('button', { name: 'Registrar autorização da operadora' }).click();
  // Data no fuso da clínica (a operadora respondeu hoje em São Paulo; em UTC já pode ser amanhã).
  await s.page.getByLabel('Data da autorização').fill(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()));
  await s.page.getByLabel('Número da guia na operadora').fill(`E2E${Date.now() % 1e8}`);
  await s.page.getByLabel('Senha', { exact: true }).fill('SENHAE2E');
  await s.page.getByLabel(/\(pedido: 4\)/u).fill('2');
  await s.page.getByRole('button', { name: 'Confirmar' }).click();
  await toast(s.page, 'Autorização registrada');
  await s.page.reload({ waitUntil: 'load' });
  await expect(s.page.getByText('Autorizada em parte').first()).toBeVisible();

  const appointments = s.page.getByLabel('Atendimento agendado');
  await appointments.selectOption({ index: 0 });
  await s.page.getByRole('button', { name: 'Ligar sessão' }).click();
  await toast(s.page, 'Sessão ligada à solicitação');
  await visit(s, `/convenios/solicitacoes/${requestId}`, 'paga-solicitacao-autorizada');
  // Documento de outra clínica / inexistente: o mesmo 404; sem documento = 409.
  expect((await s.context.request.get('/financeiro/convenios/solicitacoes/00000000-0000-4000-8000-000000000000/pdf')).status()).toBe(404);
  expect(s.errors).toEqual([]);
  await s.context.close();

  const other = await login(browser, 'gestor-suspensa');
  expect((await other.context.request.get(`/financeiro/convenios/solicitacoes/${requestId}/pdf`)).status()).toBe(404);
  await other.context.close();
});
