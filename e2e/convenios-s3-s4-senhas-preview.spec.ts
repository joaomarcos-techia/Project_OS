/**
 * S3 / S4 (requisitos 67, 81 e 82 da ANS) — política, histórico das 10 últimas e validade de 90 dias da senha no
 * perfil de segurança TISS, autenticado, num Preview DEDICADO com o perfil ligado só naquele deployment:
 *
 *   vc.js deploy -e TISS_SECURITY_PROFILE_ENFORCE=true -e TISS_SECURITY_PROFILE_ACTIVATED_AT=<há mais de 90 dias>
 *     -e PASSWORD_HISTORY_PEPPER=<sintético, ≥ 32 caracteres> (e os mesmos com -b)
 *
 * PRÉ-REQUISITO: a 0170 (`auth_password_history`) aplicada no DEV. Sem ela, a troca com o perfil ligado responde
 * "Não foi possível validar a senha agora" (fail-closed), e este spec falha de propósito em S3-2.
 *
 * Contas: `hi-dev-e2e-fixture.ts setup-s34` (clínica no alcance: `s34`, `s34exp`; clínica fora do alcance:
 * `s34fora`). O link de recuperação é gerado pela API admin do Auth do DEV e aberto no MESMO formato do e-mail
 * (`/auth/confirm#token_hash=…&type=recovery&next=/reset-password`): o caminho do app é o real.
 *
 *   S3-1. no alcance, senha sem símbolo é recusada com a regra TISS, sem consumir o link
 *   S3-2. senha forte nova é aceita; o login com ela entra (e grava o histórico)
 *   S4-1. a sessão aberta antes da troca não abre mais o shell (revogação por época)
 *   S4-2. repetir uma das 10 últimas é recusado
 *   S4-3. sem troca registrada e com o perfil ativado há mais de 90 dias: login recusado com "senha venceu" e
 *         nenhuma sessão fica aberta
 *   S3-3. fora do alcance (clínica sem rastro TISS), a mesma senha sem símbolo é aceita (só a regra base)
 *
 *   E2E_BASE_URL=<preview dedicado> E2E_S34_ACCOUNT=<contas.json> E2E_S2_SERVER_KEY=<SUPABASE_SECRET_KEY do DEV>
 *   E2E_S2_SUPABASE_URL=<URL do DEV> VERCEL_AUTOMATION_BYPASS_SECRET=… \
 *     npx playwright test e2e/convenios-s3-s4-senhas-preview.spec.ts
 *
 * Logins: 4 no máximo por rodada (abaixo do limite do S8: 5 por e-mail, 10 por IP em 15 min).
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { vercelBypassHeaders } from './vercel-bypass';

const env = (k: string) => process.env[k];
const REQUIRED = ['E2E_BASE_URL', 'E2E_S34_ACCOUNT', 'E2E_S2_SERVER_KEY', 'E2E_S2_SUPABASE_URL'];
test.skip(
  REQUIRED.some((k) => !env(k)),
  `requer ${REQUIRED.join(', ')}`,
);
test.describe.configure({ mode: 'serial', timeout: 240_000 });

type Account = { email: string; password: string; userId: string };
const accounts = env('E2E_S34_ACCOUNT')
  ? (JSON.parse(readFileSync(env('E2E_S34_ACCOUNT')!, 'utf8')) as Record<
      's34' | 's34exp' | 's34fora',
      Account
    >)
  : ({} as Record<'s34' | 's34exp' | 's34fora', Account>);
const SUPA = env('E2E_S2_SUPABASE_URL') ?? '';
const SERVER_KEY = env('E2E_S2_SERVER_KEY') ?? '';

const rand = () => randomBytes(5).toString('hex');
/** Forte para a regra TISS (maiúscula, minúscula, número, símbolo) e aleatória (não aparece em vazamento). */
const strong = () => `Qr#${rand()}Az9`;
/** Válida na regra base, mas SEM símbolo (a TISS exige). */
const noSymbol = () => `Semsimbolo${rand()}A1`;

const newContext = (browser: Browser) =>
  browser.newContext({
    extraHTTPHeaders: vercelBypassHeaders(),
    viewport: { width: 1280, height: 800 },
  });

/** Link de recuperação pela API admin do Auth do DEV, no formato do e-mail do app. */
async function recoveryLink(email: string): Promise<string> {
  const res = await fetch(`${SUPA}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: SERVER_KEY,
      Authorization: `Bearer ${SERVER_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ type: 'recovery', email }),
  });
  expect(res.status, 'generate_link').toBe(200);
  const json = (await res.json()) as {
    hashed_token?: string;
    properties?: { hashed_token?: string };
  };
  const token = json.hashed_token ?? json.properties?.hashed_token;
  expect(token, 'hashed_token').toBeTruthy();
  return `/auth/confirm#token_hash=${token}&type=recovery&next=/reset-password`;
}

async function openReset(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(await recoveryLink(email), { waitUntil: 'load' });
  await expect(page).toHaveURL(/\/reset-password$/u, { timeout: 90_000 });
  await expect(page.getByText('Link inválido ou expirado')).toHaveCount(0);
  return page;
}

async function submitPassword(page: Page, value: string) {
  await page.locator('#password').fill(value);
  await page.getByRole('button', { name: 'Atualizar senha' }).click();
}

async function login(context: BrowserContext, email: string, password: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto('/login', { waitUntil: 'load' });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  return page;
}

const authCookies = async (context: BrowserContext) =>
  (await context.cookies()).filter((c) =>
    /^sb-.+-auth-token-v2(-[0-9a-f]{32})?(\.\d+)?$/u.test(c.name),
  );

let p1 = '';
let p2 = '';

test('S3-1: no alcance, senha sem símbolo é recusada pela regra TISS e o link continua válido', async ({
  browser,
}) => {
  const context = await newContext(browser);
  try {
    const page = await openReset(context, accounts.s34.email);
    await submitPassword(page, noSymbol());
    await expect(
      page.getByText(/perfil de segurança de Convênios \(TISS\): a senha precisa de um símbolo/u),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/\/reset-password$/u);
    // O mesmo link segue servindo (a recusa veio antes de consumir): S3-2 continua daqui.
    p1 = strong();
    await submitPassword(page, p1);
    await expect(page).toHaveURL(/\/login\?reason=password_updated/u, { timeout: 90_000 });
  } finally {
    await context.close();
  }
});

test('S3-2 + S4-1: a senha nova entra; a sessão aberta antes de outra troca é revogada', async ({
  browser,
}) => {
  const before = await newContext(browser);
  const resetter = await newContext(browser);
  try {
    const page = await login(before, accounts.s34.email, p1);
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
    expect((await authCookies(before)).length).toBeGreaterThan(0);

    const reset = await openReset(resetter, accounts.s34.email);
    p2 = strong();
    await submitPassword(reset, p2);
    await expect(reset).toHaveURL(/\/login\?reason=password_updated/u, { timeout: 90_000 });

    // A sessão de antes da troca não abre mais o shell.
    const again = await before.newPage();
    await again.goto('/agenda', { waitUntil: 'load' });
    await expect(again).toHaveURL(/\/login/u, { timeout: 60_000 });
  } finally {
    await before.close();
    await resetter.close();
  }
});

test('S4-2: repetir uma das 10 últimas é recusado (histórico gravado pelas trocas acima)', async ({
  browser,
}) => {
  const context = await newContext(browser);
  try {
    const page = await openReset(context, accounts.s34.email);
    await submitPassword(page, p1);
    await expect(
      page.getByText(
        'Escolha uma senha diferente das 10 últimas (perfil de segurança de Convênios).',
      ),
    ).toBeVisible({
      timeout: 60_000,
    });
    await expect(page).toHaveURL(/\/reset-password$/u);
  } finally {
    await context.close();
  }
});

test('S4-3: sem troca registrada e perfil ativado há mais de 90 dias, o login diz que a senha venceu e não deixa sessão', async ({
  browser,
}) => {
  const context = await newContext(browser);
  try {
    const page = await login(context, accounts.s34exp.email, accounts.s34exp.password);
    await expect(page.getByText(/Sua senha venceu \(troca a cada 90 dias/u)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page).toHaveURL(/\/login/u);
    expect(await authCookies(context)).toEqual([]);
  } finally {
    await context.close();
  }
});

test('S3-3: fora do alcance (clínica sem rastro TISS), a senha sem símbolo vale (só a regra base)', async ({
  browser,
}) => {
  const context = await newContext(browser);
  try {
    const page = await openReset(context, accounts.s34fora.email);
    await submitPassword(page, noSymbol());
    await expect(page).toHaveURL(/\/login\?reason=password_updated/u, { timeout: 90_000 });
  } finally {
    await context.close();
  }
});
