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
 *   - exceções individuais pela tela da Equipe (dona): concessão, revogação e negativa valem para a
 *     sessão que já estava aberta; nada atravessa clínicas;
 *   - sem permissão, desativada e outra clínica não chegam a dado nenhum.
 *
 * Nenhuma cobrança, nenhum arquivo emitido, nenhuma operadora real.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { assertPreviewRuntimeIsDev } from './preview-dev-runtime';
import { vercelBypassHeaders } from './vercel-bypass';

const BASE = process.env.E2E_BASE_URL;
const ACCOUNTS = process.env.E2E_HI_I2_ACCOUNTS;
const OTHER_ACCOUNTS = process.env.E2E_HI_ACCOUNTS;
const STATE = process.env.E2E_HI_I2;

test.skip(!BASE || !ACCOUNTS || !OTHER_ACCOUNTS || !STATE, 'requer E2E_BASE_URL (Preview no DEV) e a fixture setup-i2');
test.describe.configure({ mode: 'serial' });
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

const NO_PERMISSION = 'Seu perfil não tem permissão para esta operação de convênios.';
const APPOINTMENT_NOT_FOUND = 'Atendimento não encontrado nesta clínica.';
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
      if (abort) return route.abort();
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

function expectRefused(res: { text: string }, message: string) {
  expect(res.text).toContain('"ok":false');
  expect(res.text).not.toContain('"ok":true');
  expect(res.text).toContain(message);
  expect(res.text).not.toMatch(INTERNAL);
}

const guide = (which: 'own' | 'other') => `/convenios/guias/${fx!.guides[which].id}`;
const insurerPage = () => `/convenios/configuracao/operadoras/${fx!.insurerId}`;
let priceAction: Captured | null = null;
let policyAction: Captured | null = null;
let coverageAction: Captured | null = null;

test.beforeAll(async () => {
  await assertPreviewRuntimeIsDev(BASE!);
});
test.afterAll(async () => {
  for (const s of sessions.values()) await s.context.close();
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
  expect(s.errors.filter((e) => !/Failed to fetch|NetworkError|aborted/iu.test(e))).toEqual([]);
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

test('exceções individuais pela Equipe: concessão e revogação valem para a sessão já aberta; a negativa vence o papel', async ({ browser }) => {
  test.setTimeout(300_000);
  const owner = await session(browser, 'i2-owner');
  const medica2 = await session(browser, 'i2-medica2');
  const recepcao = await session(browser, 'i2-recepcao');
  // Antes: a médica 2 vê a própria guia sem valores.
  const before = await server(medica2, guide('other'));
  expect(before.status).toBe(200);
  expect(before.body).not.toContain(fx!.value);

  const setOverride = async (member: string, label: string, choice: 'default' | 'grant' | 'deny') => {
    await owner.page.goto('/equipe');
    await owner.page.getByRole('button', { name: `Ações de ${member}` }).click();
    await owner.page.getByRole('menuitem', { name: 'Permissões individuais' }).click();
    const dialog = owner.page.getByRole('dialog');
    await dialog.getByLabel(label, { exact: true }).selectOption(choice);
    await dialog.getByRole('button', { name: /Salvar permissões/u }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
  };

  // Concessão individual de ver faturamento (D-4): a sessão antiga passa a receber o valor.
  await setOverride('Dra. Matriz Dois E2E', 'Ver faturamento de convênios', 'grant');
  await expect.poll(async () => (await server(medica2, guide('other'))).body.includes(fx!.value), { timeout: 90_000 }).toBe(true);
  // A concessão é só de leitura de faturamento: configurar continua recusado.
  await medica2.page.goto('/convenios');
  expectRefused(await replay(medica2.page, policyAction!), NO_PERMISSION);
  // Revogação: volta ao padrão do papel.
  await setOverride('Dra. Matriz Dois E2E', 'Ver faturamento de convênios', 'default');
  await expect.poll(async () => (await server(medica2, guide('other'))).body.includes(fx!.value), { timeout: 90_000 }).toBe(false);

  // Negativa explícita vence o pacote do papel: a recepção perde o operar (tela e action).
  await setOverride('Recepção Matriz E2E', 'Operar convênios (recepção)', 'deny');
  await expect
    .poll(async () => (await server(recepcao, '/convenios/autorizacoes')).body.includes('Sem acesso'), { timeout: 90_000 })
    .toBe(true);
  await recepcao.page.goto('/convenios/atendimentos');
  const res = await replay(recepcao.page, coverageAction!, coverageAction!.body);
  expect(res.text).toContain('"ok":false');
  expect(res.text).not.toContain('"ok":true');
  await setOverride('Recepção Matriz E2E', 'Operar convênios (recepção)', 'default');
  await expect
    .poll(async () => (await server(recepcao, '/convenios/autorizacoes')).body.includes('Sem acesso'), { timeout: 90_000 })
    .toBe(false);
  expect(owner.errors).toEqual([]);
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
