/**
 * S2 / requisito 83 da ANS — o rascunho clínico não se perde no bloqueio por inatividade. Autenticado, no MESMO
 * tipo de Preview dedicado do `convenios-s2-inatividade-preview.spec.ts` (perfil TISS ligado só naquele
 * deployment, Auth e banco do DEV).
 *
 * Contas e paciente: `hi-dev-e2e-fixture.ts setup-s2` (médica da clínica paga no alcance; médica de OUTRA clínica;
 * paciente sintético só da S2). O rascunho é criado pela tela em cada teste.
 *
 *   R1. aviso aos 9 min salva o rascunho no servidor, MESMO depois de uma falha temporária de rede no autosave;
 *       bloqueio; o servidor tem o rascunho (status, clínica, versão, cifrado em repouso); login novo recupera o texto
 *   R2. rede caída no aviso e no bloqueio: o login avisa que o salvamento não foi confirmado (nada de "salvo" falso)
 *   R3. duas abas no mesmo rascunho: o salvamento concorrente da versão antiga recebe conflito e não sobrescreve
 *   R4. duas abas e bloqueio simultâneo: o pendente da aba do editor vai ao servidor
 *   R5. outra clínica: não abre o rascunho pela tela (404) nem pela API com o token dela (RLS)
 *   R6. sessão revogada: o refresh token da sessão bloqueada é recusado pelo Auth e os cookies antigos não reabrem
 *       o shell
 *
 *   E2E_BASE_URL=<preview dedicado> E2E_S2_ACCOUNT=<contas.json> E2E_S2_IDS=<ids.json> \
 *   E2E_S2_SERVER_KEY=<SUPABASE_SECRET_KEY do DEV> E2E_S2_SUPABASE_URL=<URL do DEV> \
 *   E2E_S2_SUPABASE_ANON_KEY=<chave publicável do DEV> VERCEL_AUTOMATION_BYPASS_SECRET=… \
 *     npx playwright test e2e/convenios-s2-rascunho-preview.spec.ts
 */
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Cookie,
  type Page,
} from '@playwright/test';

import { vercelBypassHeaders } from './vercel-bypass';

const env = (k: string) => process.env[k];
const REQUIRED = [
  'E2E_BASE_URL',
  'E2E_S2_ACCOUNT',
  'E2E_S2_IDS',
  'E2E_S2_SERVER_KEY',
  'E2E_S2_SUPABASE_URL',
  'E2E_S2_SUPABASE_ANON_KEY',
];
test.skip(
  REQUIRED.some((k) => !env(k)),
  `requer ${REQUIRED.join(', ')}`,
);

type Account = { email: string; password: string; userId: string };
const accounts = env('E2E_S2_ACCOUNT')
  ? (JSON.parse(readFileSync(env('E2E_S2_ACCOUNT')!, 'utf8')) as Record<
      's2medica' | 's2outra',
      Account
    >)
  : ({} as Record<'s2medica' | 's2outra', Account>);
const ids = env('E2E_S2_IDS')
  ? (JSON.parse(readFileSync(env('E2E_S2_IDS')!, 'utf8')) as {
      clinicId: string;
      patientId: string;
      otherClinicId: string;
    })
  : { clinicId: '', patientId: '', otherClinicId: '' };
const SUPA = env('E2E_S2_SUPABASE_URL') ?? '';
const ANON = env('E2E_S2_SUPABASE_ANON_KEY') ?? '';
const SERVER_KEY = env('E2E_S2_SERVER_KEY') ?? '';
const MIN = 60_000;
const ACTIVITY = 'qoro_atividade';
test.describe.configure({ mode: 'serial', timeout: 300_000 });

const marker = (tag: string) =>
  `S2-${tag}-${randomBytes(4).toString('hex')} conduta sintética de teste`;

// ── navegador ─────────────────────────────────────────────────────────────────────────────────────

const newContext = (browser: Browser) =>
  browser.newContext({
    extraHTTPHeaders: vercelBypassHeaders(),
    viewport: { width: 1280, height: 800 },
  });

async function login(context: BrowserContext, account: Account): Promise<Page> {
  const page = await context.newPage();
  await page.goto('/login', { waitUntil: 'load' });
  await page.fill('#email', account.email);
  await page.fill('#password', account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  return page;
}

/** Rascunho novo pela tela (aba Prontuários do paciente da S2); devolve o id e a página já no editor. */
async function newDraft(page: Page): Promise<string> {
  await page.goto(`/pacientes/${ids.patientId}?tab=prontuarios`, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Novo prontuário' }).click();
  await page.waitForURL(/\/prontuarios\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const pid = new URL(page.url()).pathname.split('/').pop()!;
  await expect(field(page)).toBeEditable();
  return pid;
}

const field = (page: Page) => page.locator('textarea').first();
const draftUrl = (pid: string) => `/pacientes/${ids.patientId}/prontuarios/${pid}`;

/** Digita como gente (clique + teclas): conta como interação para o guarda. */
async function typeDraft(page: Page, text: string) {
  await field(page).click();
  await field(page).fill(text);
}

/** Server Actions do editor que carregam o texto (o autosave): só elas falham na "rede caída". */
async function failAutosave(
  page: Page,
  text: string,
  state: { failing: boolean; aborted: number },
) {
  await page.route('**/*', async (route) => {
    const r = route.request();
    if (
      state.failing &&
      r.method() === 'POST' &&
      r.headers()['next-action'] &&
      (r.postData() ?? '').includes(text)
    ) {
      state.aborted += 1;
      return route.abort('internetdisconnected');
    }
    return route.continue();
  });
}

const autosaveOk = (page: Page, text: string) =>
  page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      (r.request().postData() ?? '').includes(text) &&
      r.status() === 200,
    { timeout: 60_000 },
  );

// ── servidor (DEV) ────────────────────────────────────────────────────────────────────────────────

type DraftRow = {
  id: string;
  clinic_id: string;
  patient_id: string;
  doctor_id: string;
  status: string;
  row_version: number;
};

/** Leitura pela chave de servidor (ignora RLS): é a verdade do banco, não a da tela. */
async function serverDraft(pid: string): Promise<{ row: DraftRow; raw: string }> {
  const res = await fetch(`${SUPA}/rest/v1/prontuarios?id=eq.${pid}&select=*`, {
    headers: { apikey: SERVER_KEY },
  });
  expect(res.status, 'leitura de servidor do rascunho').toBe(200);
  const raw = await res.text();
  const rows = JSON.parse(raw) as DraftRow[];
  expect(rows).toHaveLength(1);
  return { row: rows[0]!, raw };
}

async function passwordToken(account: Account): Promise<string> {
  const res = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  expect(res.status, 'login de API').toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Leitura com o token do USUÁRIO (RLS vale). */
async function userReads(token: string, pid: string): Promise<number> {
  const res = await fetch(`${SUPA}/rest/v1/prontuarios?id=eq.${pid}&select=id`, {
    headers: { apikey: ANON, authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as unknown[]).length;
}

/** Sessão do `@supabase/ssr` guardada em cookie (às vezes em pedaços `.0`, `.1`…; prefixo `base64-`). */
function sessionFromCookies(cookies: Cookie[]): { access_token: string; refresh_token: string } {
  const parts = cookies
    .filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => Number(a.name.split('.').pop()) - Number(b.name.split('.').pop()));
  expect(parts.length, 'cookie de sessão do Supabase').toBeGreaterThan(0);
  let value = parts.map((c) => c.value).join('');
  value = decodeURIComponent(value);
  if (value.startsWith('base64-'))
    value = Buffer.from(value.slice(7), 'base64url').toString('utf8');
  return JSON.parse(value) as { access_token: string; refresh_token: string };
}

// Mesmo codec de `src/lib/auth/session-activity.ts` (ver o spec de inatividade).
const activityKey = (base: string) =>
  createHmac('sha256', base).update('qoro/session-activity/v1').digest('base64url');
const decodeActivity = (value: string) =>
  JSON.parse(Buffer.from(value.split('.')[0]!, 'base64url').toString('utf8')) as { at: number };
const encodeActivity = (a: object) => {
  const payload = Buffer.from(JSON.stringify(a)).toString('base64url');
  return `${payload}.${createHmac('sha256', activityKey(SERVER_KEY)).update(payload).digest('base64url')}`;
};

// ── cenários ──────────────────────────────────────────────────────────────────────────────────────

let r1: { pid: string; text: string; preLock: Cookie[] } | null = null;

test('R1. aviso salva o rascunho no servidor mesmo após falha de rede; bloqueio; login novo recupera o texto', async ({
  browser,
}) => {
  const context = await newContext(browser);
  await context.clock.install();
  const page = await login(context, accounts.s2medica);
  const pid = await newDraft(page);
  const text = marker('R1');
  const net = { failing: true, aborted: 0 };
  await failAutosave(page, text, net);

  await typeDraft(page, text);
  await context.clock.fastForward(11_000); // debounce de 10 s: o autosave sai e a rede "cai"
  await expect(page.getByText('Erro ao salvar')).toBeVisible({ timeout: 30_000 });
  expect(net.aborted).toBeGreaterThan(0);
  await expect(field(page)).toHaveValue(text);
  expect((await serverDraft(pid)).row.row_version, 'nada chegou ao servidor ainda').toBe(1);

  // A rede volta; ninguém mexe. O aviso aos 9 min pede o flush e o mesmo texto vai ao servidor.
  net.failing = false;
  const saved = autosaveOk(page, text);
  await context.clock.fastForward(9 * MIN);
  await expect(page.locator('[data-session-warning]')).toBeVisible();
  await saved;
  const after = await serverDraft(pid);
  expect(after.row).toMatchObject({
    status: 'rascunho',
    clinic_id: ids.clinicId,
    patient_id: ids.patientId,
    doctor_id: accounts.s2medica.userId,
  });
  expect(after.row.row_version).toBe(2);
  expect(after.raw, 'texto clínico cifrado em repouso').not.toContain(text.slice(0, 15));

  r1 = { pid, text, preLock: await context.cookies() };
  await context.clock.fastForward(MIN);
  await page.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 30_000 });
  expect(new URL(page.url()).searchParams.get('reason')).toBe('inactivity');
  await expect(page.getByText(/o rascunho do prontuário ficou salvo/)).toBeVisible();

  const again = await login(context, accounts.s2medica);
  await again.goto(draftUrl(pid), { waitUntil: 'load' });
  await expect(field(again)).toHaveValue(text);
  await context.close();
});

test('R2. rede caída no aviso e no bloqueio: o login avisa que o salvamento não foi confirmado', async ({
  browser,
}) => {
  const context = await newContext(browser);
  await context.clock.install();
  const page = await login(context, accounts.s2medica);
  const pid = await newDraft(page);
  const text = marker('R2');
  const net = { failing: true, aborted: 0 };
  await failAutosave(page, text, net);
  await typeDraft(page, text);

  await context.clock.fastForward(9 * MIN + 5_000);
  await expect(page.locator('[data-session-warning]')).toBeVisible();
  await context.clock.fastForward(MIN);
  await page.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 30_000 });
  expect(new URL(page.url()).searchParams.get('reason')).toBe('inactivity_unsaved');
  await expect(page.getByText(/Não foi possível confirmar o salvamento/)).toBeVisible();
  expect(net.aborted, 'tentou no aviso e de novo no bloqueio').toBeGreaterThanOrEqual(2);
  expect(
    (await serverDraft(pid)).row.row_version,
    'nenhum "salvo" falso: o servidor não recebeu nada',
  ).toBe(1);
  await context.close();
});

test('R3. duas abas no mesmo rascunho: a versão antiga recebe conflito e não sobrescreve a nova', async ({
  browser,
}) => {
  const context = await newContext(browser);
  const a = await login(context, accounts.s2medica);
  const pid = await newDraft(a);
  const b = await context.newPage();
  await b.goto(draftUrl(pid), { waitUntil: 'load' });
  await expect(field(b)).toBeEditable();

  const newer = marker('R3-nova');
  await typeDraft(a, newer);
  await a.getByRole('button', { name: 'Salvar agora' }).click();
  await expect(a.getByText(/^Salvo/)).toBeVisible({ timeout: 30_000 });

  const stale = marker('R3-antiga');
  await typeDraft(b, stale);
  await b.getByRole('button', { name: 'Salvar agora' }).click();
  await expect(b.getByText('Conflito de versão')).toBeVisible({ timeout: 30_000 });
  await expect(b.getByText(/Suas mudanças NÃO foram salvas/)).toBeVisible();
  expect((await serverDraft(pid)).row.row_version, 'só o salvamento da versão nova entrou').toBe(2);

  await b.reload({ waitUntil: 'load' });
  await expect(field(b)).toHaveValue(newer);
  await context.close();
});

test('R4. duas abas e bloqueio simultâneo: o pendente da aba do editor vai ao servidor', async ({
  browser,
}) => {
  const context = await newContext(browser);
  await context.clock.install();
  const editor = await login(context, accounts.s2medica);
  const pid = await newDraft(editor);
  const other = await context.newPage();
  await other.goto('/dashboard', { waitUntil: 'load' });
  const text = marker('R4');
  await typeDraft(editor, text);

  await context.clock.fastForward(10 * MIN + 5_000);
  for (const p of [editor, other])
    await p.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 30_000 });
  expect(new URL(editor.url()).searchParams.get('reason')).toBe('inactivity');
  expect((await serverDraft(pid)).row.row_version).toBe(2);

  const again = await login(context, accounts.s2medica);
  await again.goto(draftUrl(pid), { waitUntil: 'load' });
  await expect(field(again)).toHaveValue(text);
  await context.close();
});

test('R5. outra clínica não abre o rascunho: tela 404 e a API com o token dela devolve zero linhas', async ({
  browser,
}) => {
  expect(r1, 'R1 precisa ter rodado').not.toBeNull();
  const context = await newContext(browser);
  const page = await login(context, accounts.s2outra);
  const res = await page.goto(draftUrl(r1!.pid), { waitUntil: 'load' });
  expect(res?.status()).toBe(404);
  await expect(page.locator('body')).not.toContainText(r1!.text.slice(0, 15));
  await context.close();

  expect(
    await userReads(await passwordToken(accounts.s2outra), r1!.pid),
    'RLS: outra clínica',
  ).toBe(0);
  expect(
    await userReads(await passwordToken(accounts.s2medica), r1!.pid),
    'controle: a dona lê',
  ).toBe(1);
});

test('R6. sessão revogada: refresh token recusado pelo Auth e cookies antigos não reabrem o shell', async ({
  browser,
}) => {
  expect(r1, 'R1 precisa ter rodado').not.toBeNull();
  const old = sessionFromCookies(r1!.preLock);
  const refresh = await fetch(`${SUPA}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: old.refresh_token }),
  });
  expect(refresh.status, 'o bloqueio encerrou a sessão no Auth').toBeGreaterThanOrEqual(400);

  // Os cookies de antes do bloqueio, com o tempo real que um bloqueio por inatividade implica (≥ 10 min).
  const activity = r1!.preLock.find((c) => c.name === ACTIVITY)!;
  const aged = { ...decodeActivity(activity.value), at: Date.now() - 11 * MIN };
  const context = await newContext(browser);
  await context.addCookies(
    r1!.preLock.map((c) => (c.name === ACTIVITY ? { ...c, value: encodeActivity(aged) } : c)),
  );
  const page = await context.newPage();
  await page.goto('/dashboard', { waitUntil: 'load' });
  expect(new URL(page.url()).pathname).toMatch(/^\/login/);
  await context.close();
});
