/**
 * Matriz I.2 — EXCEÇÕES INDIVIDUAIS pela tela da Equipe, no Preview ligado ao DEV (17/11).
 *
 * A dona concede, revoga e nega uma permissão de Convênios a uma pessoa da clínica `e2e-hi-i2`:
 *   - concessão de "Ver faturamento de convênios" à médica: a sessão que já estava aberta é
 *     ENCERRADA (ADR-037: mudou a permissão, as claims antigas deixam de valer); ao entrar de novo
 *     ela recebe os valores; continua sem configurar;
 *   - revogação: de volta ao padrão do papel, sem valores;
 *   - negativa explícita de "Operar convênios" à recepção: vence o pacote do papel na tela e na
 *     server action chamada direto; removida a negativa, o papel volta a valer;
 *   - nada atravessa clínicas: a gestora de outra clínica não vê ninguém daqui e não muda.
 *
 * Fixture: `setup-i2 --run <MARCA>` (zera as exceções da clínica). Logins: dona 1, médica 3,
 * recepção 3, outra clínica 1 (abaixo de 10 por IP e de 5 por conta em 15 minutos).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const INTERNAL = /(?:\bat\s+\S+\s+\(|node_modules|drizzle|postgres|SQLSTATE|stack)/iu;

const SPEC_KEY = 'excecoes';

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

/** Encerra a sessão guardada e entra de novo (claims novas depois de uma mudança de permissão). */
async function relogin(browser: Browser, key: string): Promise<Session> {
  const open = sessions.get(key);
  if (open) await open.context.close();
  sessions.delete(key);
  rmSync(stateFile(key), { force: true });
  return session(browser, key);
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
const ACTIONS_FILE = join(RUN_DIR, 'actions.json');
const savedActions = existsSync(ACTIONS_FILE)
  ? (JSON.parse(readFileSync(ACTIONS_FILE, 'utf8')) as Record<'price' | 'policy' | 'coverage', Captured | null>)
  : { price: null, policy: null, coverage: null };
let coverageAction: Captured | null = savedActions.coverage;

test.beforeAll(async () => {
  await assertPreviewRuntimeIsDev(BASE!);
});
test.afterEach(() => {
  writeFileSync(ACTIONS_FILE, JSON.stringify({ price: null, policy: null, coverage: coverageAction }));
});
test.afterAll(async () => {
  for (const [key, s] of sessions) {
    await s.context.storageState({ path: stateFile(key) }).catch(() => undefined);
    await s.context.close();
  }
  sessions.clear();
});

const OTHER_PATIENT = 'Paciente Sintético Matriz Dois';

async function setOverride(owner: Session, member: string, label: string, choice: 'default' | 'grant' | 'deny') {
  await owner.page.goto('/equipe');
  await owner.page.getByRole('button', { name: `Ações de ${member}` }).click();
  await owner.page.getByRole('menuitem', { name: 'Permissões individuais' }).click();
  const dialog = owner.page.getByRole('dialog');
  await dialog.getByLabel(label, { exact: true }).selectOption(choice);
  await dialog.getByRole('button', { name: /Salvar permissões/u }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

/** A sessão antiga deixou de valer: a página não entrega mais o dado (redireciona para o login). */
async function expectRevoked(s: Session, path: string, marker: string) {
  await expect
    .poll(async () => {
      const r = await server(s, path);
      return r.status === 200 && r.body.includes(marker);
    }, { timeout: 60_000 })
    .toBe(false);
}

test('concessão e revogação de ver faturamento: a sessão antiga é encerrada; ao entrar de novo, vale a permissão nova', async ({ browser }) => {
  test.setTimeout(360_000);
  const owner = await session(browser, 'i2-owner');
  let medica2 = await session(browser, 'i2-medica2');
  const before = await server(medica2, guide('other'));
  expect(before.status).toBe(200);
  expect(before.body).toContain(OTHER_PATIENT);
  expect(before.body).not.toContain(fx!.value);

  await setOverride(owner, 'Dra. Matriz Dois E2E', 'Ver faturamento de convênios', 'grant');
  await expectRevoked(medica2, guide('other'), OTHER_PATIENT);
  medica2 = await relogin(browser, 'i2-medica2');
  const granted = await server(medica2, guide('other'));
  expect(granted.status).toBe(200);
  expect(granted.body).toContain(fx!.value);
  // A concessão é só de leitura de faturamento: nada de configurar, faturar nem operar.
  const payouts = await server(medica2, '/convenios/repasses');
  expect(payouts.status).toBe(200);
  expect(payouts.body).not.toContain('Salvar política');
  expect(payouts.body).not.toContain('Salvar regra da revisão');
  expect((await server(medica2, guide('other'))).body).not.toContain('Aprovar e emitir');

  await setOverride(owner, 'Dra. Matriz Dois E2E', 'Ver faturamento de convênios', 'default');
  await expectRevoked(medica2, guide('other'), OTHER_PATIENT);
  medica2 = await relogin(browser, 'i2-medica2');
  const after = await server(medica2, guide('other'));
  expect(after.status).toBe(200);
  expect(after.body).toContain(OTHER_PATIENT);
  expect(after.body).not.toContain(fx!.value);
  expect((await server(medica2, '/convenios/repasses')).body).toContain('Sem acesso');
  expect(owner.errors).toEqual([]);
});

test('negativa explícita de operar vence o papel da recepção (tela e action direta); removida, o papel volta', async ({ browser }) => {
  test.setTimeout(360_000);
  const owner = await session(browser, 'i2-owner');
  let recepcao = await session(browser, 'i2-recepcao');
  expect((await server(recepcao, '/convenios/autorizacoes')).body).not.toContain('Sem acesso');
  // A action de cobertura da própria recepção, capturada sem enviar.
  await recepcao.page.goto('/convenios/atendimentos');
  const row = recepcao.page.getByTestId('insurance-appointment').filter({ hasText: OTHER_PATIENT }).first();
  await row.getByRole('button', { name: /Registrar cobertura|Corrigir cobertura/u }).click();
  await row.getByLabel('Operadora').selectOption({ label: fx!.insurerName });
  coverageAction = await capture(recepcao.page, fx!.insurerId, true, async () => {
    await row.getByRole('button', { name: 'Salvar cobertura' }).click();
  });

  await setOverride(owner, 'Recepção Matriz E2E', 'Operar convênios (recepção)', 'deny');
  await expectRevoked(recepcao, '/convenios/atendimentos', OTHER_PATIENT);
  recepcao = await relogin(browser, 'i2-recepcao');
  expect((await server(recepcao, '/convenios/autorizacoes')).body).toContain('Sem acesso');
  await recepcao.page.goto('/convenios/atendimentos');
  await expect(recepcao.page.getByRole('button', { name: /Registrar cobertura|Corrigir cobertura/u })).toHaveCount(0);
  const res = await replay(recepcao.page, coverageAction);
  expectRefused(res, new RegExp(`${NO_PERMISSION.source}|Atendimento não encontrado nesta clínica\.`, 'u'));

  await setOverride(owner, 'Recepção Matriz E2E', 'Operar convênios (recepção)', 'default');
  await expectRevoked(recepcao, '/convenios/atendimentos', 'Sem cobertura');
  recepcao = await relogin(browser, 'i2-recepcao');
  expect((await server(recepcao, '/convenios/autorizacoes')).body).not.toContain('Sem acesso');
  await recepcao.page.goto('/convenios/atendimentos');
  await expect(recepcao.page.getByRole('button', { name: /Registrar cobertura|Corrigir cobertura/u }).first()).toBeVisible();
  expect(owner.errors).toEqual([]);
});

test('nada atravessa clínicas: outra clínica não vê a equipe daqui e continua com os próprios direitos', async ({ browser }) => {
  const s = await session(browser, 'outra-gestor');
  const team = await server(s, '/equipe');
  expect(team.status).toBe(200);
  expect(team.body).not.toContain('Matriz');
  expect((await server(s, '/convenios/autorizacoes')).body).not.toContain('Sem acesso');
  expect((await server(s, guide('other'))).status).toBe(404);
  expect(s.errors).toEqual([]);
});
