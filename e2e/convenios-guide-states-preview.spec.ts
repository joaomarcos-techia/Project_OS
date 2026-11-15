/**
 * Regressões complementares do Preview (P0.3/P0.4 do ciclo de 15/11, tarde), SEM refazer a jornada
 * de 25 etapas (`convenios-config-preview.spec.ts`): o que a jornada não exercitou na tela.
 *
 *   - acessibilidade do painel "Dados da consulta": axe-core (WCAG 2.0/2.1/2.2 A e AA), títulos,
 *     nomes, ordem de foco por teclado, foco ao abrir e ao fechar, dica ligada ao campo, celular;
 *   - estados no MEIO da sessão (a tela já aberta não contorna o servidor): trial, clínica
 *     suspensa, sessão expirada e acesso desativado; depois de recarregar, a tela não oferece o
 *     que o servidor recusa;
 *   - código fora da terminologia enviado por requisição adulterada: mensagem legível, sem
 *     detalhe interno do banco;
 *   - duplo clique na mesma aba (salvar, conferir, aprovar), segunda aba desatualizada tentando
 *     aprovar de novo e a mesma aba atualizada depois;
 *   - pendência de validação real (carteirinha vencida) aparece e impede conferir;
 *   - ação direta (sem a navegação): recepção sem permissão e gestora de OUTRA clínica chamando a
 *     mesma server action com a guia desta clínica;
 *   - controle positivo no fim: com tudo restaurado, o mesmo ajuste salva (as recusas acima eram
 *     do estado, não de um formulário quebrado).
 *
 * Fixture: `hi-dev-e2e-fixture.ts setup-states` cria três guias novas na clínica `e2e-hi-paga`; o
 * spec troca estados por `set-state`/`set-active` (só clínicas e2e-hi-*, restaurados em `finally`)
 * e lê o banco por `guide-state` através de E2E_HI_FIXTURE_CMD, um script local que roda a fixture
 * com o ambiente DEV: o spec não recebe credencial de banco. Dados 100% sintéticos.
 *
 *   E2E_BASE_URL=<preview> E2E_HI_ACCOUNTS=<contas.json> E2E_HI_CFG_ACCOUNTS=<contas-cfg.json> \
 *   E2E_HI_STATES=<guias.json> E2E_HI_CFG_GUIDE=<id de guia da clínica de configuração> \
 *   E2E_HI_FIXTURE_CMD=<script> [E2E_HI_SHOTS=<dir>] VERCEL_AUTOMATION_BYPASS_SECRET=… MAGIC_TOKEN_SECRET=… \
 *     npx playwright test e2e/convenios-guide-states-preview.spec.ts --project=chromium
 *
 * Logins: gestora da clínica paga (2, o segundo depois de reativar o acesso), recepção (1) e a
 * gestora da clínica de configuração (1). Não rode outro spec autenticado na mesma janela.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';

import { assertPreviewRuntimeIsDev } from './preview-dev-runtime';
import { vercelBypassHeaders } from './vercel-bypass';

const BASE = process.env.E2E_BASE_URL;
const ACCOUNTS = process.env.E2E_HI_ACCOUNTS;
const CFG_ACCOUNTS = process.env.E2E_HI_CFG_ACCOUNTS;
const STATES = process.env.E2E_HI_STATES;
const CFG_GUIDE = process.env.E2E_HI_CFG_GUIDE;
const FIXTURE_CMD = process.env.E2E_HI_FIXTURE_CMD;
const SHOTS = process.env.E2E_HI_SHOTS;

test.skip(
  !BASE || !ACCOUNTS || !CFG_ACCOUNTS || !STATES || !CFG_GUIDE || !FIXTURE_CMD,
  'requer E2E_BASE_URL (Preview no DEV), as fixtures e2e-hi e o comando da fixture',
);
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 45_000 });

type Account = { email: string; password: string; userId: string; clinic: string; role: string };
const accounts: Record<string, Account> = {
  ...(ACCOUNTS ? (JSON.parse(readFileSync(ACCOUNTS, 'utf8')) as Record<string, Account>) : {}),
  ...(CFG_ACCOUNTS
    ? (JSON.parse(readFileSync(CFG_ACCOUNTS, 'utf8')) as Record<string, Account>)
    : {}),
};
type StateGuide = { id: string; status: string };
const fx = STATES
  ? (JSON.parse(readFileSync(STATES, 'utf8')) as {
      run: string;
      guides: { ready1: StateGuide; ready2: StateGuide; pending1: StateGuide };
    })
  : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const g1 = () => `/convenios/guias/${fx!.guides.ready1.id}`;
const g2 = () => `/convenios/guias/${fx!.guides.ready2.id}`;
const g3 = () => `/convenios/guias/${fx!.guides.pending1.id}`;

// Mensagens que o servidor devolve (src/lib/premium-access/policy.ts e actions.ts de Convênios).
const TRIAL_MSG =
  'Convênios: este recurso está disponível para clínicas com assinatura ativa. Conheça os planos do Qoro para habilitar esta funcionalidade.';
const SUSPENDED_MSG =
  'Convênios: a assinatura da clínica não está ativa. Regularize a assinatura para voltar a usar este recurso. Os registros já feitos continuam disponíveis para consulta.';
const DISABLED_MSG =
  'Seu acesso a esta clínica foi desativado. Fale com o administrador da clínica.';
const SESSION_MSG = 'Sua sessão terminou. Entre de novo para continuar.';
const NO_PERMISSION_MSG = 'Seu perfil não tem permissão para esta operação de convênios.';
const OTHER_CLINIC_MSG = 'Guia inexistente nesta clínica.';
/** Nada de detalhe interno do banco na tela. */
const INTERNAL =
  /constraint|violates|syntax|SQL|hi_guides|consulta_overrides|23514|55000|stack|at [\w.]+ \(/iu;

// ── Fixture (via script local com o ambiente DEV; o spec não vê credencial) ──────────────────

function fixture(...args: string[]): string {
  return execFileSync(process.execPath, [FIXTURE_CMD!, ...args], {
    encoding: 'utf8',
    timeout: 240_000,
    windowsHide: true,
  });
}
function setClinicState(state: 'paid' | 'trial' | 'suspended'): { denial: string | null } {
  const out = fixture('set-state', '--state', state);
  const m = /STATE (\{.+\})/u.exec(out);
  if (!m) throw new Error(`set-state sem resposta: ${out.slice(-300)}`);
  return JSON.parse(m[1]!) as { denial: string | null };
}
function setAccountActive(account: string, active: boolean): void {
  const out = fixture('set-active', '--account', account, '--active', String(active));
  if (!out.includes(`"active":${active}`))
    throw new Error(`set-active sem resposta: ${out.slice(-300)}`);
}
type GuideDb = {
  status: string;
  version: number;
  adjusted: boolean;
  events: number;
  revisions: number;
};
function guideDb(id: string): GuideDb {
  const out = fixture('guide-state', '--guide', id);
  const m = /GUIDE_STATE (\{.+\})/u.exec(out);
  if (!m) throw new Error(`guide-state sem resposta: ${out.slice(-300)}`);
  return JSON.parse(m[1]!) as GuideDb;
}

// ── Sessões (mesmo padrão do spec da jornada: um login por conta, estado reusado) ────────────

interface Session {
  context: BrowserContext;
  page: Page;
  errors: string[];
}
const sessions = new Map<string, Awaited<ReturnType<BrowserContext['storageState']>>>();

async function login(browser: Browser, key: string, viewport = DESKTOP): Promise<Session> {
  const account = accounts[key];
  if (!account) throw new Error(`conta ${key} ausente na fixture`);
  const cached = sessions.get(key);
  const context = await browser.newContext({
    viewport,
    extraHTTPHeaders: vercelBypassHeaders(),
    ...(cached ? { storageState: cached } : {}),
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message + ' @ ' + new URL(page.url()).pathname));
  const close = context.close.bind(context);
  context.close = async (...args: Parameters<BrowserContext['close']>) => {
    try {
      const fresh = await context.storageState();
      if (fresh.cookies.some((c) => c.name.startsWith('sb-'))) sessions.set(key, fresh);
    } catch {
      // contexto já encerrado: mantém o cache anterior
    }
    return close(...args);
  };
  if (cached) return { context, page, errors };
  await page.goto('/login', { waitUntil: 'load' });
  await page.fill('#email', account.email);
  await page.fill('#password', account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  sessions.set(key, await context.storageState());
  return { context, page, errors };
}

async function visit(s: Session, path: string, shot?: string): Promise<number> {
  const res = await s.page.goto(path, { waitUntil: 'load' });
  await s.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  const overflow = await s.page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, `${path} transborda na horizontal`).toBeLessThanOrEqual(1);
  if (SHOTS && shot) await s.page.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true });
  return res?.status() ?? 0;
}

/** Espera um aviso; registra os vistos no caminho para a falha dizer o motivo. */
async function toast(page: Page, text: string | RegExp): Promise<void> {
  const seen = new Set<string>();
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (
      await page
        .getByText(text)
        .first()
        .isVisible()
        .catch(() => false)
    )
      return;
    for (const t of await page
      .getByRole('status')
      .allInnerTexts()
      .catch(() => [] as string[]))
      if (t.trim()) seen.add(t.trim());
    await page.waitForTimeout(300);
  }
  throw new Error(
    `aviso esperado não apareceu (${String(text)}); avisos vistos: ${JSON.stringify([...seen])}`,
  );
}

const panel = (page: Page): Locator => page.getByRole('region', { name: 'Dados da consulta' });
const form = (page: Page): Locator => page.getByRole('form', { name: 'Ajustar dados da consulta' });
const historyItems = (page: Page): Locator =>
  page.getByRole('region', { name: 'Histórico da guia' }).locator('li');

async function openAndPick(page: Page, tipo = '4'): Promise<void> {
  await panel(page).getByRole('button', { name: 'Ajustar dados da consulta' }).click();
  await form(page).getByLabel('Tipo de consulta').selectOption(tipo);
}
const saveButton = (page: Page): Locator =>
  form(page).getByRole('button', { name: 'Salvar dados da consulta' });

/** A recusa fica escrita no formulário (role="alert") e nenhum sucesso aparece. */
async function expectRefusal(page: Page, message: string): Promise<void> {
  await expect(form(page).getByRole('alert')).toHaveText(message, { timeout: 45_000 });
  await expect(page.getByText('Dados da consulta salvos')).toHaveCount(0);
  expect(message).not.toMatch(INTERNAL);
}

// ── Server action capturada (para a chamada direta, sem a navegação) ─────────────────────────

type CapturedAction = {
  id: string;
  body: string;
  contentType: string;
  routerTree?: string | undefined;
};
const ACTION_FILE = STATES ? `${STATES}.action.json` : '';
let captured: CapturedAction | null =
  ACTION_FILE && existsSync(ACTION_FILE)
    ? (JSON.parse(readFileSync(ACTION_FILE, 'utf8')) as CapturedAction)
    : null;

function captureConsultaAction(page: Page, guideId: string): void {
  page.on('request', (r) => {
    const h = r.headers();
    const body = r.postData();
    if (r.method() !== 'POST' || !h['next-action'] || !body?.includes(guideId)) return;
    captured = {
      id: h['next-action'],
      body,
      contentType: h['content-type'] ?? 'text/plain;charset=UTF-8',
      routerTree: h['next-router-state-tree'],
    };
    if (ACTION_FILE) writeFileSync(ACTION_FILE, JSON.stringify(captured));
  });
}

/** Chama a server action do ajuste por `fetch` na página aberta (a sessão é a da conta logada). */
async function callActionDirectly(
  page: Page,
  body: string,
): Promise<{ status: number; text: string }> {
  expect(
    captured,
    'server action do ajuste não capturada (rode o teste de trial antes)',
  ).not.toBeNull();
  return page.evaluate(
    async ({ id, body: b, contentType, routerTree }) => {
      const headers: Record<string, string> = {
        'Next-Action': id,
        'Content-Type': contentType,
        Accept: 'text/x-component',
      };
      if (routerTree) headers['Next-Router-State-Tree'] = routerTree;
      const r = await fetch(location.pathname, { method: 'POST', headers, body: b });
      return { status: r.status, text: await r.text() };
    },
    {
      id: captured!.id,
      body,
      contentType: captured!.contentType,
      routerTree: captured!.routerTree,
    },
  );
}

// ── axe-core (vem pela dependência do eslint-config-next → eslint-plugin-jsx-a11y; sem pacote novo) ──

function axeSource(): string {
  const root = createRequire(join(process.cwd(), 'package.json'));
  const plugin = createRequire(root.resolve('eslint-config-next')).resolve(
    'eslint-plugin-jsx-a11y',
  );
  return readFileSync(createRequire(plugin).resolve('axe-core/axe.min.js'), 'utf8');
}
type AxeViolation = { id: string; impact: string | null; help: string; targets: string[] };
async function axe(page: Page, selector: string, label: string): Promise<AxeViolation[]> {
  // `evaluate` roda pelo protocolo do navegador: a CSP da página não se aplica ao teste.
  await page.evaluate(axeSource());
  const result = await page.evaluate(async (sel) => {
    const w = window as unknown as {
      axe: {
        run: (
          ctx: unknown,
          opts: unknown,
        ) => Promise<{
          violations: Array<{
            id: string;
            impact: string | null;
            help: string;
            nodes: Array<{ target: string[] }>;
          }>;
          incomplete: Array<{ id: string }>;
          passes: unknown[];
        }>;
      };
    };
    const r = await w.axe.run(
      { include: [sel] },
      {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      },
    );
    return {
      violations: r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
      })),
      incomplete: r.incomplete.map((v) => v.id),
      passes: r.passes.length,
    };
  }, selector);
  if (SHOTS) writeFileSync(`${SHOTS}/axe-${label}.json`, JSON.stringify(result, null, 1));
  console.log(
    `axe ${label}: ${result.violations.length} violações, ${result.passes} regras aprovadas, revisão manual: ${result.incomplete.join(', ') || 'nenhuma'}`,
  );
  return result.violations;
}

/** Nome acessível simples do elemento focado (rótulo do campo, aria-label ou texto). */
const focusedName = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const el = document.activeElement as
      | (HTMLElement & { labels?: NodeListOf<HTMLLabelElement> })
      | null;
    if (!el) return '';
    return (
      el.labels?.[0]?.textContent ??
      el.getAttribute('aria-label') ??
      el.textContent ??
      ''
    ).trim();
  });

// ── Testes ───────────────────────────────────────────────────────────────────────────────────

test('o Preview usa o projeto DEV (prova assinada antes de qualquer escrita)', async () => {
  test.setTimeout(90_000);
  await assertPreviewRuntimeIsDev(BASE!);
  expect(fx!.guides.ready1.status).toBe('ready_for_review');
  expect(fx!.guides.ready2.status).toBe('ready_for_review');
  expect(fx!.guides.pending1.status).toBe('pending_data');
});

test('acessibilidade do painel Dados da consulta: axe WCAG 2.2 AA, títulos, nomes, teclado, foco e celular', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const s = await login(browser, 'gestor');
  expect(await visit(s, g1(), 'states-01-guia')).toBe(200);
  const region = panel(s.page);
  await expect(region.getByRole('heading', { name: 'Dados da consulta' })).toBeVisible();

  // Títulos: um h1 na página. A sequência fica registrada: o título do painel vem do PanelCard do
  // design system (`<h4>` logo abaixo do `<h1>`, salto de nível em todas as telas) e é tratado
  // com a branch de UI (handoff-ui.md §9), não aqui.
  const levels = await s.page.evaluate(() =>
    [...document.querySelectorAll('main h1, main h2, main h3, main h4, main h5, main h6')].map(
      (h) => `${h.tagName.toLowerCase()}:${(h.textContent ?? '').trim().slice(0, 30)}`,
    ),
  );
  console.log(`títulos da guia: ${levels.join(' | ')}`);
  expect(levels.filter((l) => l.startsWith('h1:'))).toHaveLength(1);

  expect(await axe(s.page, '[data-testid="consulta-fields"]', 'painel-fechado')).toEqual([]);

  // Teclado: o botão abre o formulário com o foco no primeiro campo; Tab percorre na ordem visual.
  const open = region.getByRole('button', { name: 'Ajustar dados da consulta' });
  await open.focus();
  await s.page.keyboard.press('Enter');
  await expect(form(s.page)).toBeVisible();
  await expect(form(s.page).getByLabel('Regime de atendimento')).toBeFocused();
  const order: string[] = [];
  for (let i = 0; i < 7; i++) {
    await s.page.keyboard.press('Tab');
    order.push(await focusedName(s.page));
  }
  expect(order).toEqual([
    'Indicação de acidente',
    'Tipo de consulta',
    'Cobertura especial',
    'Saúde ocupacional',
    'Observação',
    'Salvar dados da consulta',
    'Voltar',
  ]);
  // A dica da observação (limite e aviso de CID) é a descrição acessível do campo.
  const describedBy = await form(s.page).getByLabel('Observação').getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  await expect(s.page.locator(`[id="${describedBy}"]`)).toHaveText(
    /^0\/500 \(padrão TISS\)\. Não escreva diagnóstico/u,
  );
  if (SHOTS)
    await s.page.screenshot({ path: `${SHOTS}/states-01b-formulario-teclado.png`, fullPage: true });
  expect(await axe(s.page, '[data-testid="consulta-fields"]', 'painel-aberto')).toEqual([]);

  // "Voltar" pelo teclado devolve o foco ao botão que abriu (nada foi salvo).
  await s.page.keyboard.press('Enter');
  await expect(form(s.page)).toHaveCount(0);
  await expect(open).toBeFocused();
  await expect(region.locator('[data-adjusted="true"]')).toHaveCount(0);

  // A página inteira da guia (conteúdo principal), para registro: o resultado vai para a evidência.
  const main = await axe(s.page, 'main', 'pagina-guia');
  expect(main, JSON.stringify(main, null, 1)).toEqual([]);
  expect(s.errors).toEqual([]);
  await s.context.close();

  // Celular: sem rolagem lateral, formulário aberto e o mesmo axe.
  const m = await login(browser, 'gestor', MOBILE);
  expect(await visit(m, g1())).toBe(200);
  await panel(m.page).getByRole('button', { name: 'Ajustar dados da consulta' }).click();
  await expect(form(m.page).getByLabel('Regime de atendimento')).toBeFocused();
  const overflow = await m.page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  if (SHOTS) await m.page.screenshot({ path: `${SHOTS}/states-01c-celular.png`, fullPage: true });
  expect(await axe(m.page, '[data-testid="consulta-fields"]', 'painel-celular')).toEqual([]);
  expect(m.errors).toEqual([]);
  await m.context.close();
});

test('trial no meio da sessão: o formulário já aberto não contorna o servidor; recarregada, a tela não oferece o ajuste', async ({
  browser,
}) => {
  test.setTimeout(360_000);
  const s = await login(browser, 'gestor');
  expect(await visit(s, g1())).toBe(200);
  captureConsultaAction(s.page, fx!.guides.ready1.id);
  await openAndPick(s.page);
  try {
    expect(setClinicState('trial').denial).toBe('trial');
    await saveButton(s.page).click();
    await expectRefusal(s.page, TRIAL_MSG);
    expect(await visit(s, g1(), 'states-02-trial')).toBe(200);
    await expect(s.page.getByTestId('convenios-commercial-notice')).toHaveAttribute(
      'data-denial',
      'trial',
    );
    await expect(
      panel(s.page).getByRole('button', { name: 'Ajustar dados da consulta' }),
    ).toHaveCount(0);
    await expect(s.page.getByRole('button', { name: 'Marcar como conferida' })).toHaveCount(0);
    await expect(panel(s.page).locator('[data-adjusted="true"]')).toHaveCount(0);
  } finally {
    expect(setClinicState('paid').denial).toBeNull();
  }
  expect(captured, 'a tela não chamou a server action do ajuste').not.toBeNull();
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('clínica suspensa no meio da sessão: recusa legível; recarregada, só consulta (cancelar continua disponível)', async ({
  browser,
}) => {
  test.setTimeout(360_000);
  const s = await login(browser, 'gestor');
  expect(await visit(s, g1())).toBe(200);
  await openAndPick(s.page);
  try {
    expect(setClinicState('suspended').denial).toBe('clinic_suspended');
    await saveButton(s.page).click();
    await expectRefusal(s.page, SUSPENDED_MSG);
    expect(await visit(s, g1(), 'states-03-suspensa')).toBe(200);
    await expect(s.page.getByTestId('convenios-commercial-notice')).toHaveAttribute(
      'data-denial',
      'clinic_suspended',
    );
    for (const name of ['Ajustar dados da consulta', 'Marcar como conferida', 'Aprovar e emitir'])
      await expect(s.page.getByRole('button', { name })).toHaveCount(0);
    await expect(s.page.getByRole('button', { name: 'Cancelar guia' })).toBeVisible();
  } finally {
    expect(setClinicState('paid').denial).toBeNull();
  }
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('sessão expirada com o formulário aberto: nada é salvo e a pessoa é levada a entrar de novo', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const s = await login(browser, 'gestor');
  expect(await visit(s, g1())).toBe(200);
  await openAndPick(s.page);
  await s.context.clearCookies();
  await saveButton(s.page).click();
  // Dois desfechos corretos: o servidor responde "sessão terminou" ou o proxy leva ao login.
  await expect
    .poll(
      async () => {
        if (new URL(s.page.url()).pathname.startsWith('/login')) return 'login';
        const alert = await form(s.page)
          .getByRole('alert')
          .textContent({ timeout: 500 })
          .catch(() => null);
        return alert ?? 'aguardando';
      },
      { timeout: 45_000 },
    )
    .toMatch(new RegExp(`^(login|${SESSION_MSG.replace(/[.]/gu, '\\.')})$`, 'u'));
  console.log(
    `sessão expirada: desfecho = ${new URL(s.page.url()).pathname.startsWith('/login') ? 'redirecionada ao login' : 'mensagem no formulário'}`,
  );
  await expect(s.page.getByText('Dados da consulta salvos')).toHaveCount(0);
  if (SHOTS)
    await s.page.screenshot({ path: `${SHOTS}/states-04-sessao-expirada.png`, fullPage: true });
  expect(s.errors).toEqual([]);
  await s.context.close(); // sem cookie "sb-": o cache da conta continua com a sessão anterior
});

test('código fora da terminologia por requisição adulterada: recusa legível, sem detalhe do banco', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const s = await login(browser, 'gestor');
  expect(await visit(s, g1())).toBe(200);
  let tampered = false;
  await s.page.route(`**${g1()}`, async (route) => {
    const req = route.request();
    const body = req.postData() ?? '';
    if (
      req.method() === 'POST' &&
      req.headers()['next-action'] &&
      body.includes('"tipoConsulta":"4"')
    ) {
      tampered = true;
      await route.continue({ postData: body.replace('"tipoConsulta":"4"', '"tipoConsulta":"44"') });
      return;
    }
    await route.continue();
  });
  await openAndPick(s.page);
  await saveButton(s.page).click();
  const alert = form(s.page).getByRole('alert');
  await expect(alert).toBeVisible({ timeout: 45_000 });
  expect(tampered, 'a requisição não foi adulterada (formato do corpo mudou?)').toBe(true);
  const text = (await alert.textContent()) ?? '';
  console.log(`código adulterado: "${text}"`);
  expect(text.length).toBeGreaterThan(10);
  expect(text).not.toMatch(INTERNAL);
  await expect(s.page.getByText('Dados da consulta salvos')).toHaveCount(0);
  await s.page.unroute(`**${g1()}`);
  expect(await visit(s, g1())).toBe(200);
  await expect(panel(s.page).locator('[data-adjusted="true"]')).toHaveCount(0);
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('duplo clique e duas abas (P14.2): um ajuste, uma conferência, UMA emissão; a aba desatualizada lê o conflito e, atualizada, mostra a aprovada', async ({
  browser,
}) => {
  test.setTimeout(420_000);
  const a = await login(browser, 'gestor');
  expect(await visit(a, g2())).toBe(200);
  await openAndPick(a.page);
  await saveButton(a.page).dblclick();
  await toast(a.page, 'Dados da consulta salvos');
  await a.page.waitForTimeout(1_500);
  await expect(
    a.page.getByText('A guia mudou desde que a tela foi aberta', { exact: false }),
  ).toHaveCount(0);
  expect(await visit(a, g2())).toBe(200);
  await expect(historyItems(a.page).filter({ hasText: 'Dados da consulta ajustados' })).toHaveCount(
    1,
  );

  await a.page.getByRole('button', { name: 'Marcar como conferida' }).dblclick();
  await toast(a.page, 'Guia conferida');
  await a.page.waitForTimeout(1_500);
  await expect(
    a.page.getByText('A guia mudou desde que a tela foi aberta', { exact: false }),
  ).toHaveCount(0);

  // Segunda aba aberta com a guia conferida, ANTES da aprovação.
  const b = await login(browser, 'gestor');
  expect(await visit(b, g2())).toBe(200);
  await expect(b.page.getByRole('button', { name: 'Aprovar e emitir' })).toBeVisible();

  expect(await visit(a, g2())).toBe(200);
  await a.page.getByRole('button', { name: 'Aprovar e emitir' }).dblclick();
  await toast(a.page, 'Guia aprovada e emitida');
  await a.page.waitForTimeout(1_500);
  await expect(a.page.getByText(/Esta guia já foi aprovada e emitida/u)).toHaveCount(0);

  // A aba desatualizada tenta aprovar de novo: conflito específico, não erro genérico.
  await b.page.getByRole('button', { name: 'Aprovar e emitir' }).click();
  await toast(
    b.page,
    /Esta guia já foi aprovada e emitida \(etapa: Aprovada\)\. Atualize a página para ver a situação mais recente/u,
  );
  // Atualizada, a mesma aba mostra a aprovada, sem botão de aprovar e com a nota do emitido.
  expect(await visit(b, g2(), 'states-05-aba-atualizada')).toBe(200);
  await expect(
    b.page
      .getByRole('region', { name: 'Situação da guia' })
      .getByText('Aprovada', { exact: true })
      .first(),
  ).toBeVisible();
  await expect(b.page.getByRole('button', { name: 'Aprovar e emitir' })).toHaveCount(0);
  await expect(panel(b.page).getByText(/^Guia aprovada: vale o conteúdo emitido/u)).toBeVisible();
  await expect(historyItems(b.page).filter({ hasText: 'Conferida → Aprovada' })).toHaveCount(1);
  await expect(historyItems(b.page).filter({ hasText: 'Para conferir → Conferida' })).toHaveCount(
    1,
  );
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
  await b.context.close();
  await a.context.close();

  const db = guideDb(fx!.guides.ready2.id);
  console.log(`G2 no banco: ${JSON.stringify(db)}`);
  expect(db).toMatchObject({ status: 'approved', adjusted: true, revisions: 1 });
});

test('pendência de validação: a carteirinha vencida aparece e a guia não se confere', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const s = await login(browser, 'gestor');
  expect(await visit(s, g3(), 'states-06-pendencia')).toBe(200);
  await expect(
    s.page
      .getByRole('region', { name: 'Pendências da guia' })
      .getByText(/A carteirinha venceu em 2026-01-31, antes do atendimento\./u),
  ).toBeVisible();
  for (const name of ['Marcar como conferida', 'Aprovar e emitir'])
    await expect(s.page.getByRole('button', { name })).toHaveCount(0);
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('ação direta sem permissão: a recepção chama a server action do ajuste e o servidor recusa', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const s = await login(browser, 'recepcao');
  expect(await visit(s, g1())).toBe(200);
  await expect(
    panel(s.page).getByRole('button', { name: 'Ajustar dados da consulta' }),
  ).toHaveCount(0);
  const res = await callActionDirectly(s.page, captured!.body);
  console.log(`recepção, chamada direta: HTTP ${res.status}`);
  expect(res.text).toContain('"ok":false');
  expect(res.text).not.toContain('"ok":true');
  expect(res.text).toContain(NO_PERMISSION_MSG);
  expect(res.text).not.toMatch(INTERNAL);
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('outra clínica: URL direta dá 404 e a server action com a guia desta clínica é recusada', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const s = await login(browser, 'cfg-gestor');
  expect(await visit(s, g1())).toBe(404);
  expect(await visit(s, `/convenios/guias/${CFG_GUIDE}`)).toBe(200);
  const res = await callActionDirectly(s.page, captured!.body);
  console.log(`outra clínica, chamada direta: HTTP ${res.status}`);
  expect(res.text).toContain('"ok":false');
  expect(res.text).not.toContain('"ok":true');
  expect(res.text).toContain(OTHER_CLINIC_MSG);
  expect(res.text).not.toMatch(INTERNAL);
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('acesso desativado no meio da sessão: recusa dizendo o motivo; recarregada, a guia não abre', async ({
  browser,
}) => {
  test.setTimeout(360_000);
  const s = await login(browser, 'gestor');
  expect(await visit(s, g1())).toBe(200);
  await openAndPick(s.page);
  try {
    setAccountActive('gestor', false);
    await saveButton(s.page).click();
    await expectRefusal(s.page, DISABLED_MSG);
    await s.page.goto(g1(), { waitUntil: 'load' });
    await expect(panel(s.page)).toHaveCount(0);
    console.log(`acesso desativado, recarregada: ${new URL(s.page.url()).pathname}`);
    if (SHOTS)
      await s.page.screenshot({ path: `${SHOTS}/states-07-desativada.png`, fullPage: true });
  } finally {
    setAccountActive('gestor', true);
  }
  await s.context.close();
  sessions.delete('gestor'); // a sessão antiga pode ter ficado desatualizada: o controle positivo entra de novo
});

test('nada mudou com as recusas; controle positivo: com tudo restaurado, o mesmo ajuste salva', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const before = guideDb(fx!.guides.ready1.id);
  console.log(`G1 antes do controle: ${JSON.stringify(before)}`);
  expect(before).toEqual({
    status: 'ready_for_review',
    version: 1,
    adjusted: false,
    events: 1,
    revisions: 0,
  });

  const s = await login(browser, 'gestor');
  expect(await visit(s, g1())).toBe(200);
  await openAndPick(s.page);
  await saveButton(s.page).click();
  await toast(s.page, 'Dados da consulta salvos');
  await expect(
    panel(s.page).getByRole('button', { name: 'Ajustar dados da consulta' }),
  ).toBeFocused();
  expect(await visit(s, g1(), 'states-08-controle-positivo')).toBe(200);
  await expect(panel(s.page).locator('[data-adjusted="true"]')).toHaveCount(1);
  await expect(
    historyItems(s.page).filter({ hasText: 'Dados da consulta ajustados (etapa: Para conferir)' }),
  ).toHaveCount(1);
  expect(s.errors).toEqual([]);
  await s.context.close();

  const after = guideDb(fx!.guides.ready1.id);
  expect(after).toMatchObject({
    status: 'ready_for_review',
    version: 2,
    adjusted: true,
    events: 2,
  });
});
