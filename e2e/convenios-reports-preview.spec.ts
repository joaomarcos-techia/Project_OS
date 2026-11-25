/**
 * P9.10 — relatório por operadora e período, com CSV, no Preview ligado ao DEV (navegador remoto).
 * Clínica sintética `e2e-hi-sadt` (a guia SP/SADT de 3 sessões enviada no E2E da SP/SADT):
 *
 *   1. gestora: resumo da operadora (1 guia, faturado e pendente de R$ 270,00), filtro por operadora,
 *      CSV baixado pela mesma sessão (BOM, cabeçalho, `;`, valores em reais, sem paciente);
 *   2. financeiro: vê e exporta (é quem vê os valores do faturamento);
 *   3. recepção e médica: tela "Sem acesso" e o CSV pedido direto devolve 404;
 *   4. outra clínica: não vê a operadora desta e o CSV com o id dela volta só com o cabeçalho;
 *   5. sem sessão: o CSV não sai.
 */
import { readFileSync } from 'node:fs';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { assertPreviewRuntimeIsDev } from './preview-dev-runtime';
import { vercelBypassHeaders } from './vercel-bypass';

const BASE = process.env.E2E_BASE_URL;
const ACCOUNTS = process.env.E2E_HI_SADT_ACCOUNTS;
const OTHER_ACCOUNTS = process.env.E2E_HI_ACCOUNTS;
const STATE = process.env.E2E_HI_SADT;

test.skip(!BASE || !ACCOUNTS || !OTHER_ACCOUNTS || !STATE, 'requer E2E_BASE_URL (Preview no DEV) e a fixture setup-sadt');
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 45_000 });

type Account = { email: string; password: string; userId: string; clinic: string; role: string };
const accounts: Record<string, Account> = {
  ...(ACCOUNTS ? (JSON.parse(readFileSync(ACCOUNTS, 'utf8')) as Record<string, Account>) : {}),
  ...(OTHER_ACCOUNTS ? { 'outra-gestor': (JSON.parse(readFileSync(OTHER_ACCOUNTS, 'utf8')) as Record<string, Account>).gestor! } : {}),
};
const fx = STATE ? (JSON.parse(readFileSync(STATE, 'utf8')) as { insurerName: string; patientName: string }) : null;
const PERIOD = 'from=2026-11-01&to=2026-12-31';

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

/** Baixa pela sessão da página (mesmos cookies): status, tipo e os bytes. */
async function fetchCsv(page: Page, href: string): Promise<{ status: number; type: string; bytes: number[]; text: string }> {
  return page.evaluate(async (u) => {
    const r = await fetch(u);
    const buf = new Uint8Array(await r.arrayBuffer());
    return { status: r.status, type: r.headers.get('content-type') ?? '', bytes: [...buf.slice(0, 3)], text: new TextDecoder('utf-8').decode(buf) };
  }, href);
}
const summary = (page: Page) => page.getByRole('region', { name: 'Resumo por operadora' });
let insurerId = '';

test('gestora: resumo por operadora, filtro e CSV seguro baixado pela sessão', async ({ browser }) => {
  test.setTimeout(240_000);
  const s = await session(browser, 'sadt-gestor');
  await s.page.goto(`/convenios/relatorios?${PERIOD}`);
  const row = summary(s.page).getByRole('row', { name: new RegExp(fx!.insurerName, 'u') });
  await expect(row).toContainText('270,00');
  const filters = s.page.getByRole('region', { name: 'Filtros do relatório' });
  insurerId = (await filters.getByLabel('Operadora').locator('option', { hasText: fx!.insurerName }).first().getAttribute('value'))!;
  await filters.getByLabel('Operadora').selectOption(insurerId);
  await filters.getByRole('button', { name: 'Aplicar' }).click();
  await s.page.waitForURL(new RegExp(`insurerId=${insurerId}`, 'u'));
  await expect(summary(s.page)).toContainText(fx!.insurerName);
  const href = (await s.page.getByRole('link', { name: 'Exportar CSV' }).getAttribute('href'))!;
  expect(href).toContain(`insurerId=${insurerId}`);
  const csv = await fetchCsv(s.page, href);
  expect([csv.status, csv.type]).toEqual([200, 'text/csv; charset=utf-8']);
  expect(csv.bytes).toEqual([0xef, 0xbb, 0xbf]);
  const lines = csv.text.replace(/^﻿/u, '').split('\r\n').filter(Boolean);
  expect(lines[0]).toBe('Operadora;Tipo de guia;Guia;Situação;Lote;Enviada em;Último pagamento;Faturado (R$);Recebido (R$);Glosa em aberto (R$);Glosa definitiva (R$);Pendente (R$);Dias desde o envio');
  expect(lines.length).toBeGreaterThanOrEqual(2);
  expect(lines.slice(1).every((l) => l.startsWith(`${fx!.insurerName};`))).toBe(true);
  expect(lines.some((l) => l.includes(';SP/SADT;') && l.includes(';270,00;'))).toBe(true);
  expect(csv.text).not.toContain(fx!.patientName);
  expect(s.errors).toEqual([]);
});

test('financeiro: vê o relatório e exporta', async ({ browser }) => {
  const s = await session(browser, 'sadt-financeiro');
  await s.page.goto(`/convenios/relatorios?${PERIOD}`);
  await expect(summary(s.page)).toContainText(fx!.insurerName);
  const csv = await fetchCsv(s.page, `/financeiro/convenios/relatorios/csv?${PERIOD}`);
  expect(csv.status).toBe(200);
  expect(s.errors).toEqual([]);
});

for (const key of ['sadt-recepcao', 'sadt-medica']) {
  test(`${key}: sem acesso na tela e o CSV direto devolve 404`, async ({ browser }) => {
    const s = await session(browser, key);
    await s.page.goto(`/convenios/relatorios?${PERIOD}`);
    await expect(s.page.getByText('Seu perfil não tem permissão para esta área de convênios.')).toBeVisible();
    await expect(summary(s.page)).toHaveCount(0);
    expect((await fetchCsv(s.page, `/financeiro/convenios/relatorios/csv?${PERIOD}`)).status).toBe(404);
  });
}

test('outra clínica: não vê a operadora desta; o CSV com o id dela sai só com o cabeçalho; sem sessão, nada', async ({ browser }) => {
  const s = await session(browser, 'outra-gestor');
  await s.page.goto(`/convenios/relatorios?${PERIOD}`);
  await expect(s.page.locator('main')).not.toContainText(fx!.insurerName);
  const csv = await fetchCsv(s.page, `/financeiro/convenios/relatorios/csv?${PERIOD}&insurerId=${insurerId}`);
  expect(csv.status).toBe(200);
  expect(csv.text.replace(/^﻿/u, '').split('\r\n').filter(Boolean)).toHaveLength(1);
  const anon = await browser.newContext({ baseURL: BASE!, extraHTTPHeaders: vercelBypassHeaders() });
  const r = await anon.request.get(`/financeiro/convenios/relatorios/csv?${PERIOD}`, { maxRedirects: 0 });
  expect(r.status()).not.toBe(200);
  await anon.close();
});
