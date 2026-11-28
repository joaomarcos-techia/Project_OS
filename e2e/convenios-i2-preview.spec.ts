/**
 * Matriz de permissões I.2 de Convênios no Preview ligado ao DEV (homologação por papel, 17/11).
 *
 * Clínica sintética `e2e-hi-i2` (plano legado com permissões granulares) com um perfil por papel:
 * dona, gestora, recepção, financeiro, duas médicas, uma pessoa sem `view:convenios` e uma
 * desativada; "outra clínica" é a gestora da `e2e-hi-paga`. Fixture: `setup-i2 --run <MARCA>`.
 *
 * O que se prova, sempre pela RESPOSTA DO SERVIDOR (não basta o botão sumir):
 *   - o valor do contrato (R$ 173,50, único na fixture) aparece para quem vê faturamento e NÃO sai
 *     do servidor para a recepção nem para a médica (HTML e dados da página, lista e detalhe);
 *   - D-1/D-2: o financeiro lê preços e a política de repasse, não os altera; as server actions de
 *     preço e de política, capturadas da gestora, são recusadas quando chamadas direto por ele;
 *   - D-3: a médica registra a cobertura só no próprio atendimento; no de outra profissional, com
 *     id adulterado ou de outra clínica, a action responde "não encontrado" (sem confirmar existência);
 *   - D-4: a médica só encontra as próprias guias (lista, busca, detalhe, PDF e arquivos);
 *   - as exceções individuais (Equipe) têm spec próprio: `convenios-i2-overrides-preview.spec.ts`;
 *   - sem permissão, desativada e outra clínica não chegam a dado nenhum.
 *
 * Nenhuma cobrança, nenhum arquivo emitido, nenhuma operadora real.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { assertPreviewRuntimeIsDev } from './preview-dev-runtime';
import { vercelBypassHeaders } from './vercel-bypass';

const BASE = process.env.E2E_BASE_URL;
const ACCOUNTS = process.env.E2E_HI_I2_ACCOUNTS;
const OTHER_ACCOUNTS = process.env.E2E_HI_ACCOUNTS;
const STATE = process.env.E2E_HI_I2;

test.skip(!BASE || !ACCOUNTS || !OTHER_ACCOUNTS || !STATE, 'requer E2E_BASE_URL (Preview no DEV) e a fixture setup-i2');
// Em ordem (1 worker), sem abortar os demais quando um falha: cada cenário é uma prova própria.
test.describe.configure({ mode: 'default' });
test.use({ actionTimeout: 45_000 });

type Account = { email: string; password: string; userId: string; clinic: string; role: string };
const accounts: Record<string, Account> = {
  ...(ACCOUNTS ? (JSON.parse(readFileSync(ACCOUNTS, 'utf8')) as Record<string, Account>) : {}),
  ...(OTHER_ACCOUNTS ? { 'outra-gestor': (JSON.parse(readFileSync(OTHER_ACCOUNTS, 'utf8')) as Record<string, Account>).gestor! } : {}),
};
const fx = STATE
  ? (JSON.parse(readFileSync(STATE, 'utf8')) as {
      run: string;
      insurerId: string;
      insurerName: string;
      value: string;
      patients: { own: string; other: string };
      guides: { own: { id: string }; other: { id: string } };
      appointments: { own: string; other: string };
    })
  : null;

const NO_PERMISSION = /Seu perfil não tem permissão para esta (?:operação|configuração) de convênios./u;
const APPOINTMENT_NOT_FOUND = 'Atendimento não encontrado nesta clínica.';
const INTERNAL = /(?:\bat\s+\S+\s+\(|node_modules|drizzle|postgres|SQLSTATE|stack)/iu;

const SPEC_KEY = 'matriz';

type Session = { context: BrowserContext; page: Page; errors: string[] };
const sessions = new Map<string, Session>();

/**
 * Estado da execução fora do repositório: a sessão de cada conta (para um reinício do worker depois
 * de uma falha NÃO refazer login: o limite é de 10 logins por IP em 15 minutos) e as server actions
 * capturadas. Nada disso é publicado como artefato.
 */
const RUN_DIR = join(tmpdir(), `hi-i2-${fx?.run ?? 'x'}-${SPEC_KEY}`);
mkdirSync(RUN_DIR, { recursive: true });
const stateFile = (key: string) => join(RUN_DIR, `session-${key}.json`);

async function session(browser: Browser, key: string): Promise<Session> {
  const open = sessions.get(key);
  if (open) return open;
  const account = accounts[key];
  if (!account) throw new Error(`conta ${key} ausente na fixture`);
  const saved = existsSync(stateFile(key));
  const context = await browser.newContext({
    baseURL: BASE!,
    extraHTTPHeaders: vercelBypassHeaders(),
    ...(saved ? { storageState: stateFile(key) } : {}),
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${e.message} @ ${new URL(page.url()).pathname}`));
  if (saved) {
    await page.goto('/convenios', { waitUntil: 'load' });
  }
  if (!saved || new URL(page.url()).pathname.startsWith('/login')) {
    await page.goto('/login', { waitUntil: 'load' });
    await page.fill('#email', account.email);
    await page.fill('#password', account.password);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  }
  await context.storageState({ path: stateFile(key) });
  const s = { context, page, errors };
  sessions.set(key, s);
  return s;
}

/** Resposta do servidor para a rota (HTML + dados da página), com a sessão da conta. */
async function server(s: Session, path: string): Promise<{ status: number; body: string }> {
  const r = await s.context.request.get(path, { maxRedirects: 0, failOnStatusCode: false });
  return { status: r.status(), body: await r.text() };
}

type Captured = { id: string; body: string; contentType: string; routerTree?: string | undefined };

/** Captura a próxima server action cujo corpo contém `marker`. `abort`: a chamada NÃO chega ao servidor. */
async function capture(page: Page, marker: string, abort: boolean, trigger: () => Promise<void>): Promise<Captured> {
  let got: Captured | null = null;
  const handler = async (route: import('@playwright/test').Route) => {
    const req = route.request();
    const h = req.headers();
    const body = req.postData();
    if (req.method() === 'POST' && h['next-action'] && body?.includes(marker) && !got) {
      got = { id: h['next-action'], body, contentType: h['content-type'] ?? 'text/plain;charset=UTF-8', routerTree: h['next-router-state-tree'] };
      // Não chega ao servidor: responde no lugar dele com uma recusa bem formada (um aborto de rede
      // viraria "Failed to fetch" no monitoramento do Preview).
      if (abort) {
        return route.fulfill({
          status: 200,
          contentType: 'text/x-component',
          body: ['0:{"a":"$@1","f":"","b":"e2e"}', '1:{"ok":false,"error":"Captura do teste: nada foi enviado."}', ''].join('\n'),
        });
      }
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

/** Chama a server action por `fetch` na página aberta (a sessão é a da conta logada). */
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

function expectRefused(res: { text: string }, message: string | RegExp) {
  expect(res.text).toContain('"ok":false');
  expect(res.text).not.toContain('"ok":true');
  if (typeof message === 'string') expect(res.text).toContain(message);
  else expect(res.text).toMatch(message);
  expect(res.text).not.toMatch(INTERNAL);
}

const guide = (which: 'own' | 'other') => `/convenios/guias/${fx!.guides[which].id}`;
const insurerPage = () => `/convenios/configuracao/operadoras/${fx!.insurerId}`;
const ACTIONS_FILE = join(RUN_DIR, 'actions.json');
const savedActions = existsSync(ACTIONS_FILE)
  ? (JSON.parse(readFileSync(ACTIONS_FILE, 'utf8')) as Record<'price' | 'policy' | 'coverage', Captured | null>)
  : { price: null, policy: null, coverage: null };
let priceAction: Captured | null = savedActions.price;
let policyAction: Captured | null = savedActions.policy;
let coverageAction: Captured | null = savedActions.coverage;

test.beforeAll(async () => {
  await assertPreviewRuntimeIsDev(BASE!);
});
test.afterEach(() => {
  writeFileSync(ACTIONS_FILE, JSON.stringify({ price: priceAction, policy: policyAction, coverage: coverageAction }));
});
test.afterAll(async () => {
  for (const [key, s] of sessions) {
    await s.context.storageState({ path: stateFile(key) }).catch(() => undefined);
    await s.context.close();
  }
  sessions.clear();
});

test('gestora: vê valores e administra; as actions de política (D-2) e de preço (D-1) são capturadas', async ({ browser }) => {
  test.setTimeout(240_000);
  const s = await session(browser, 'i2-gestor');
  const list = await server(s, '/convenios/guias');
  expect(list.status).toBe(200);
  expect(list.body).toContain(fx!.guides.own.id);
  expect(list.body).toContain(fx!.guides.other.id);
  expect((await server(s, guide('own'))).body).toContain(fx!.value);

  // D-2: a gestora altera a regra da revisão do repasse (auditada) e a devolve ao que era.
  await s.page.goto('/convenios/repasses');
  const policy = s.page.getByRole('region', { name: 'Política de repasse' });
  const limit = policy.getByLabel(/Exigir outra pessoa a partir de/u);
  await limit.fill('987,65');
  policyAction = await capture(s.page, '98765', false, async () => {
    await policy.getByRole('button', { name: 'Salvar regra da revisão' }).click();
  });
  await expect(policy).toContainText('a partir de R$ 987,65', { timeout: 30_000 });
  await limit.fill('');
  await policy.getByRole('button', { name: 'Salvar regra da revisão' }).click();
  await expect(policy).not.toContainText('987,65', { timeout: 30_000 });

  // D-1: o formulário de preço existe para a gestora; a chamada é capturada e NÃO enviada.
  await s.page.goto(insurerPage());
  const line = s.page.locator('[data-testid="contract-line"][data-code="10101012"]').first();
  await expect(line).toContainText(fx!.value);
  await line.getByRole('button', { name: 'Alterar' }).click();
  await line.getByLabel('Valor contratado (R$)').fill('999,99');
  await line.getByLabel('Motivo').fill('Captura sintética da action de preço (não enviada)');
  priceAction = await capture(s.page, '99999', true, async () => {
    await line.getByRole('button', { name: 'Salvar nova versão' }).click();
  });
  expect((await server(s, insurerPage())).body).not.toContain('999,99');
  expect(s.errors).toEqual([]);
});

test('dona: administra Convênios (política, lotes, repasses) como a gestora', async ({ browser }) => {
  const s = await session(browser, 'i2-owner');
  for (const path of ['/convenios', '/convenios/lotes', '/convenios/repasses', '/convenios/autorizacoes', insurerPage()]) {
    const r = await server(s, path);
    expect(r.status, path).toBe(200);
    expect(r.body, path).not.toContain('Sem acesso');
  }
  await s.page.goto('/convenios/repasses');
  await expect(s.page.getByRole('button', { name: 'Salvar política' })).toHaveCount(1);
  expect(s.errors).toEqual([]);
});

test('financeiro: fatura e vê valores; NÃO altera preço (D-1) nem política de repasse (D-2), nem pela action direta', async ({ browser }) => {
  test.setTimeout(180_000);
  const s = await session(browser, 'i2-financeiro');
  expect((await server(s, guide('own'))).body).toContain(fx!.value);
  for (const path of ['/convenios/lotes', '/convenios/autorizacoes']) {
    const r = await server(s, path);
    expect(r.status, path).toBe(200);
    expect(r.body, path).not.toContain('Sem acesso');
  }
  await s.page.goto('/convenios/repasses');
  await expect(s.page.getByRole('region', { name: 'Política de repasse' })).toBeVisible();
  await expect(s.page.getByRole('button', { name: 'Salvar política' })).toHaveCount(0);
  await expect(s.page.getByRole('button', { name: 'Salvar regra da revisão' })).toHaveCount(0);
  expectRefused(await replay(s.page, policyAction!), NO_PERMISSION);

  await s.page.goto(insurerPage());
  const line = s.page.locator('[data-testid="contract-line"][data-code="10101012"]').first();
  await expect(line).toContainText(fx!.value);
  await expect(line.getByRole('button', { name: 'Alterar' })).toHaveCount(0);
  await expect(s.page.getByRole('button', { name: 'Novo procedimento contratado' })).toHaveCount(0);
  expectRefused(await replay(s.page, priceAction!), NO_PERMISSION);
  expect((await server(s, insurerPage())).body).not.toContain('999,99');
  expect(s.errors).toEqual([]);
});

test('recepção: opera sem valores; o servidor não envia o valor e recusa preço, política e faturamento', async ({ browser }) => {
  test.setTimeout(180_000);
  const s = await session(browser, 'i2-recepcao');
  const list = await server(s, '/convenios/guias');
  expect(list.body).toContain(fx!.guides.own.id);
  expect(list.body).toContain(fx!.guides.other.id);
  expect(list.body).not.toContain(fx!.value);
  const detail = await server(s, guide('own'));
  expect(detail.status).toBe(200);
  expect(detail.body).not.toContain(fx!.value);
  expect((await server(s, insurerPage())).body).not.toContain(fx!.value);
  for (const path of ['/convenios/lotes', '/convenios/repasses']) expect((await server(s, path)).body, path).toContain('Sem acesso');

  await s.page.goto('/convenios/atendimentos');
  const rows = s.page.getByTestId('insurance-appointment');
  await expect(rows.filter({ hasText: 'Dra. Matriz Um E2E' }).first()).toBeVisible();
  await expect(rows.filter({ hasText: 'Dra. Matriz Dois E2E' }).first()).toBeVisible();
  expectRefused(await replay(s.page, policyAction!), NO_PERMISSION);
  expectRefused(await replay(s.page, priceAction!), NO_PERMISSION);
  expect(s.errors).toEqual([]);
});

test('médica (D-4): só as próprias guias, sem valores; guia alheia, PDF e arquivos não existem para ela', async ({ browser }) => {
  test.setTimeout(180_000);
  const s = await session(browser, 'i2-medica');
  for (const path of ['/convenios/guias', '/convenios/guias?q=Matriz', '/convenios/guias?q=Matriz%20Dois', '/convenios/guias?page=2', '/convenios/guias?status=abertas', '/convenios']) {
    const r = await server(s, path);
    expect(r.status, path).toBe(200);
    expect(r.body, path).not.toContain(fx!.guides.other.id);
    expect(r.body, path).not.toContain(fx!.value);
    expect(r.body, path).not.toContain('Paciente Sintético Matriz Dois');
  }
  expect((await server(s, '/convenios/guias')).body).toContain(fx!.guides.own.id);
  const own = await server(s, guide('own'));
  expect(own.status).toBe(200);
  expect(own.body).toContain('Paciente Sintético Matriz Um');
  expect(own.body).not.toContain(fx!.value);
  expect((await server(s, guide('other'))).status).toBe(404);
  expect((await server(s, `/convenios/guias/${randomUUID()}`)).status).toBe(404);
  for (const path of [
    `/financeiro/convenios/guias/${fx!.guides.own.id}/pdf`,
    `/financeiro/convenios/guias/${fx!.guides.other.id}/pdf`,
    `/financeiro/convenios/arquivos/${randomUUID()}`,
    `/financeiro/convenios/comprovantes/${randomUUID()}`,
  ]) {
    expect((await server(s, path)).status, path).toBe(404);
  }
  for (const path of ['/convenios/lotes', '/convenios/repasses', '/convenios/autorizacoes', '/convenios/conciliacao']) {
    expect((await server(s, path)).body, path).toContain('Sem acesso');
  }
  // Carteirinhas (D-3): só o paciente com atendimento dela existe na tela; o de outra médica é "não encontrado".
  const ownCards = await server(s, `/convenios/carteirinhas?paciente=${fx!.patients.own}`);
  expect(ownCards.body).toContain('data-last4="3331"');
  const otherCards = await server(s, `/convenios/carteirinhas?paciente=${fx!.patients.other}`);
  expect(otherCards.body).not.toContain('data-last4');
  expect(otherCards.body).toContain('Paciente não encontrado nesta clínica.');
  expect((await server(s, '/convenios/carteirinhas?q=Matriz')).body).not.toContain('Paciente Sintético Matriz Dois');
  expect(s.errors).toEqual([]);
});

test('médica (D-3): registra a cobertura no PRÓPRIO atendimento; no de outra profissional e com id adulterado, "não encontrado"', async ({ browser }) => {
  test.setTimeout(180_000);
  const s = await session(browser, 'i2-medica');
  await s.page.goto('/convenios/atendimentos');
  const rows = s.page.getByTestId('insurance-appointment');
  await expect(rows.filter({ hasText: 'Dra. Matriz Dois E2E' })).toHaveCount(0);
  const row = rows.filter({ hasText: 'Paciente Sintético Matriz Um' }).first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /Registrar cobertura|Corrigir cobertura/u }).click();
  await row.getByLabel('Operadora').selectOption({ label: fx!.insurerName });
  await expect(row.getByLabel('Carteirinha').locator('option', { hasText: 'final 3331' })).toHaveCount(1, { timeout: 30_000 });
  await row.getByLabel('Carteirinha').selectOption({ index: 1 });
  coverageAction = await capture(s.page, fx!.insurerId, false, async () => {
    await row.getByRole('button', { name: 'Salvar cobertura' }).click();
  });
  await expect(rows.filter({ hasText: 'Paciente Sintético Matriz Um' }).first()).toContainText('final 3331', { timeout: 30_000 });
  const ownId = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u.exec(coverageAction.body.replace(fx!.insurerId, ''))?.[0];
  expect(ownId, 'id do atendimento na action capturada').toBeTruthy();
  // Atendimento de outra profissional da MESMA clínica e id que não existe: a mesma resposta.
  expectRefused(await replay(s.page, coverageAction, coverageAction.body.split(ownId!).join(fx!.appointments.other)), APPOINTMENT_NOT_FOUND);
  expectRefused(await replay(s.page, coverageAction, coverageAction.body.split(ownId!).join(randomUUID())), APPOINTMENT_NOT_FOUND);
  // A recusa não mudou nada: o atendimento da outra médica continua sem cobertura para a recepção.
  const rec = await session(browser, 'i2-recepcao');
  await rec.page.goto('/convenios/atendimentos');
  await expect(rec.page.getByTestId('insurance-appointment').filter({ hasText: 'Paciente Sintético Matriz Dois' }).first()).toHaveAttribute('data-coverage', 'none');
  expect(s.errors).toEqual([]);
});

test('sem permissão (negativa de view:convenios): nenhuma tela, nenhum arquivo, nenhuma action', async ({ browser }) => {
  const s = await session(browser, 'i2-semperm');
  for (const path of ['/convenios', '/convenios/guias', guide('own'), '/convenios/atendimentos', '/convenios/carteirinhas']) {
    const r = await server(s, path);
    expect(r.body, path).toContain('Sem acesso');
    expect(r.body, path).not.toContain('Paciente Sintético Matriz');
    expect(r.body, path).not.toContain(fx!.value);
  }
  expect((await server(s, `/financeiro/convenios/guias/${fx!.guides.own.id}/pdf`)).status).toBe(404);
  await s.page.goto('/convenios');
  const res = await replay(s.page, coverageAction!);
  expect(res.text).toContain('"ok":false');
  expect(res.text).not.toContain('"ok":true');
  expect(res.text).not.toMatch(INTERNAL);
  expect(s.errors).toEqual([]);
});

test('outra clínica: guia, PDF e atendimento desta clínica não existem; a Equipe dela não lista ninguém daqui', async ({ browser }) => {
  const s = await session(browser, 'outra-gestor');
  expect((await server(s, guide('own'))).status).toBe(404);
  expect((await server(s, `/financeiro/convenios/guias/${fx!.guides.own.id}/pdf`)).status).toBe(404);
  expect((await server(s, insurerPage())).body).not.toContain(fx!.insurerName);
  expect((await server(s, `/convenios/carteirinhas?paciente=${fx!.patients.own}`)).body).not.toContain('data-last4');
  expect((await server(s, '/equipe')).body).not.toContain('Matriz');
  await s.page.goto('/convenios/atendimentos');
  expectRefused(await replay(s.page, coverageAction!), APPOINTMENT_NOT_FOUND);
  expect(s.errors).toEqual([]);
});

test('conta desativada: não entra e não chega a dado nenhum', async ({ browser }) => {
  const account = accounts['i2-desativado']!;
  const context = await browser.newContext({ baseURL: BASE!, extraHTTPHeaders: vercelBypassHeaders() });
  try {
    const page = await context.newPage();
    await page.goto('/login', { waitUntil: 'load' });
    await page.fill('#email', account.email);
    await page.fill('#password', account.password);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.waitForTimeout(8_000);
    for (const path of [guide('own'), '/convenios/guias', '/convenios/atendimentos']) {
      const r = await context.request.get(path, { failOnStatusCode: false });
      const body = await r.text();
      expect(body, path).not.toContain('Paciente Sintético Matriz');
      expect(body, path).not.toContain(fx!.guides.own.id);
      expect(body, path).not.toContain(fx!.value);
    }
  } finally {
    await context.close();
  }
});

// ── D-5: via de atendimento (fase 2) ─────────────────────────────────────────────────────────────

const via = (which: 'own' | 'other') => `/financeiro/convenios/guias/${fx!.guides[which].id}/via`;
const fullPdf = (which: 'own' | 'other') => `/financeiro/convenios/guias/${fx!.guides[which].id}/pdf`;
const FULL_CARD = '0081234500033331';
const MASKED_CARD = '************3331';
const COPY_MARK = 'VIA DE ATENDIMENTO';
/** Fase 3 ativa (PDF completo só para quem vê faturamento)? O pedido da execução diz. */
const PHASE3 = process.env.E2E_HI_D5_PHASE === '3';

async function pdfOf(s: Session, path: string): Promise<{ status: number; type: string; text: string; cache: string }> {
  const r = await s.context.request.get(path, { maxRedirects: 0, failOnStatusCode: false });
  const type = r.headers()['content-type'] ?? '';
  let text = '';
  if (r.status() === 200 && type.includes('application/pdf')) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await r.body()), disableFontFace: true, verbosity: 0 }).promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      text += ` ${(content.items as Array<{ str: string }>).map((i) => i.str).join(' ')}`;
    }
  }
  return { status: r.status(), type, text, cache: r.headers()['cache-control'] ?? '' };
}

test('D-5: a gestora confere e emite a guia; antes da emissão não existe via', async ({ browser }) => {
  test.setTimeout(240_000);
  const s = await session(browser, 'i2-gestor');
  await s.page.goto(guide('own'));
  const situation = s.page.getByRole('region', { name: 'Situação da guia' });
  if (!(await situation.getByText('Aprovada', { exact: true }).first().isVisible().catch(() => false))) {
    expect((await pdfOf(s, via('own'))).status).toBe(404);
    const review = s.page.getByRole('button', { name: 'Marcar como conferida' });
    if (await review.isVisible().catch(() => false)) await review.click();
    const approve = s.page.getByRole('button', { name: 'Aprovar e emitir' });
    await expect(approve).toBeVisible({ timeout: 60_000 });
    await approve.click();
    await expect(situation.getByText('Aprovada', { exact: true }).first()).toBeVisible({ timeout: 90_000 });
  }
  // A guia da outra médica continua sem emissão: a via dela não existe para ninguém.
  expect((await pdfOf(s, via('other'))).status).toBe(404);
  expect(s.errors).toEqual([]);
});

test('D-5: recepção baixa a via pelo botão; o PDF não tem valor nem a carteirinha completa', async ({ browser }) => {
  test.setTimeout(180_000);
  const s = await session(browser, 'i2-recepcao');
  await s.page.goto(guide('own'));
  const button = s.page.getByRole('button', { name: 'Via para assinatura' });
  await expect(button).toBeVisible();
  await button.focus();
  const [download] = await Promise.all([s.page.waitForEvent('download', { timeout: 90_000 }), s.page.keyboard.press('Enter')]);
  expect(download.suggestedFilename()).toMatch(/^via-atendimento-consulta-.+\.pdf$/u);
  await expect(s.page.getByRole('status').filter({ hasText: 'Via baixada' })).toBeVisible();

  const copy = await pdfOf(s, via('own'));
  expect([copy.status, copy.type]).toEqual([200, 'application/pdf']);
  expect(copy.cache).toContain('no-store');
  expect(copy.text).toContain(COPY_MARK);
  expect(copy.text).toContain('Paciente Sintético Matriz Um');
  expect(copy.text).toContain('10101012');
  expect(copy.text).toContain(MASKED_CARD);
  expect(copy.text).not.toContain(FULL_CARD);
  expect(copy.text).not.toContain(fx!.value);
  expect(copy.text.split(/\s+/u).filter((t) => /^\d{1,3}(?:\.\d{3})*,\d{2}$/u.test(t))).toEqual([]);
  // Download repetido: a mesma via, de novo auditada.
  expect((await pdfOf(s, via('own'))).status).toBe(200);
  // URL adulterada e guia inexistente: o mesmo 404.
  expect((await pdfOf(s, `/financeiro/convenios/guias/${randomUUID()}/via`)).status).toBe(404);
  expect((await pdfOf(s, '/financeiro/convenios/guias/nao-e-uuid/via')).status).toBe(404);

  const full = await pdfOf(s, fullPdf('own'));
  if (PHASE3) {
    // Fase 3: o PDF completo (com valores) deixou de existir para a recepção; a tela não oferece.
    expect(full.status).toBe(404);
    await expect(s.page.getByRole('link', { name: 'Ver PDF da guia' })).toHaveCount(0);
  } else {
    expect(full.status).toBe(200);
  }
  expect(s.errors).toEqual([]);
});

test('D-5: financeiro tem a via e o PDF completo (com valor); médica só a via da PRÓPRIA guia', async ({ browser }) => {
  test.setTimeout(180_000);
  const fin = await session(browser, 'i2-financeiro');
  const finCopy = await pdfOf(fin, via('own'));
  expect(finCopy.status).toBe(200);
  expect(finCopy.text).not.toContain(fx!.value);
  const finFull = await pdfOf(fin, fullPdf('own'));
  expect(finFull.status).toBe(200);
  expect(finFull.text).toContain(fx!.value);
  expect(finFull.text).not.toContain(COPY_MARK);

  const medica = await session(browser, 'i2-medica');
  const own = await pdfOf(medica, via('own'));
  expect(own.status).toBe(200);
  expect(own.text).toContain(COPY_MARK);
  expect(own.text).not.toContain(fx!.value);
  expect(own.text).not.toContain(FULL_CARD);
  expect((await pdfOf(medica, fullPdf('own'))).status).toBe(404);
  await medica.page.goto(guide('own'));
  await expect(medica.page.getByRole('button', { name: 'Via para assinatura' })).toBeVisible();
  await expect(medica.page.getByRole('link', { name: 'Ver PDF da guia' })).toHaveCount(0);

  // A outra médica não é executante nem solicitante desta guia: a via não existe para ela.
  const medica2 = await session(browser, 'i2-medica2');
  expect((await pdfOf(medica2, via('own'))).status).toBe(404);
  expect((await pdfOf(medica2, fullPdf('own'))).status).toBe(404);
});

test('D-5: sem permissão, outra clínica e sessão encerrada não recebem a via', async ({ browser }) => {
  test.setTimeout(120_000);
  const semperm = await session(browser, 'i2-semperm');
  expect((await pdfOf(semperm, via('own'))).status).toBe(404);
  const outra = await session(browser, 'outra-gestor');
  expect((await pdfOf(outra, via('own'))).status).toBe(404);
  expect((await pdfOf(outra, fullPdf('own'))).status).toBe(404);
  // Sem sessão (cookies descartados): nenhum PDF sai.
  const anon = await browser.newContext({ baseURL: BASE!, extraHTTPHeaders: vercelBypassHeaders() });
  try {
    const r = await anon.request.get(via('own'), { maxRedirects: 0, failOnStatusCode: false });
    expect(r.status()).not.toBe(200);
    expect(r.headers()['content-type'] ?? '').not.toContain('application/pdf');
  } finally {
    await anon.close();
  }
});
