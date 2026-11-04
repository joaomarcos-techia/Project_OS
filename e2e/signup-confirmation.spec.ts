import { createHmac, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  devices,
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import postgres from 'postgres';
import { isCancelledCheckoutResponse } from '../src/lib/test/asaas-checkout-cleanup';

import {
  SIGNUP_E2E_DEV_PROJECT_REF,
  SIGNUP_E2E_ENV_ALIASES,
} from '../scripts/run-signup-confirmation-e2e';
import { assertPreviewRuntimeIsDev } from './preview-dev-runtime';
import { installVercelBypassForOrigin, vercelBypassHeaders } from './vercel-bypass';

test.use({
  storageState: { cookies: [], origins: [] },
  extraHTTPHeaders: {},
  trace: 'off',
  video: 'off',
  screenshot: 'off',
});

const baseUrl = process.env.E2E_BASE_URL;
const supabaseUrl = firstEnv(...SIGNUP_E2E_ENV_ALIASES.supabaseUrl);
const supabaseSecret = firstEnv(...SIGNUP_E2E_ENV_ALIASES.supabaseAdminKey);
const supabasePublicKey = firstEnv(...SIGNUP_E2E_ENV_ALIASES.supabasePublicKey);
const resendKey = firstEnv('RESEND_API_KEY_DEV');
const expectedEmailFrom = firstEnv('EMAIL_FROM_DEV');
const databaseUrl = firstEnv('DATABASE_URL_DEV');
const magicTokenSecret = firstEnv(...SIGNUP_E2E_ENV_ALIASES.magicTokenSecret);
const loginHashPepper = firstEnv(...SIGNUP_E2E_ENV_ALIASES.loginHashPepper);
const asaasBaseUrl = firstEnv('ASAAS_BASE_URL_DEV', 'ASAAS_BASE_URL');
const asaasApiKey = firstEnv('ASAAS_API_KEY_DEV', 'ASAAS_API_KEY');
const expectedProjectRef = SIGNUP_E2E_DEV_PROJECT_REF;
const productionDatabaseUrl = firstEnv('DATABASE_URL_PROD');
const productionSupabaseSecret = firstEnv(
  'SUPABASE_SECRET_KEY_PROD',
  'SUPABASE_SERVICE_ROLE_KEY_PROD',
);

const FIXTURE_PATH = path.join(process.cwd(), '.playwright', 'signup-confirmation-fixture.json');
const LOCK_PATH = path.join(process.cwd(), '.playwright', 'signup-confirmation.lock');
const OFFER_CHECKOUT_PATH = path.join(process.cwd(), '.playwright', 'offer-checkouts-pending.json');
const RESEND_API = 'https://api.resend.com';
const INITIAL_SUBJECT = 'Confirme seu e-mail — Qoro';
const RESEND_SUBJECT = 'Seu novo link de confirmação — Qoro';
const RESEND_DELIVERY_TIMEOUT_MS = 180_000;

type Fixture = {
  projectRef: string;
  email: string;
  tokenHash?: string;
  tokenHashes?: string[];
};

type AuthUser = {
  id: string;
  email?: string;
  created_at?: string;
  email_confirmed_at?: string | null;
  app_metadata?: Record<string, unknown>;
};
type ResendSummary = {
  id: string;
  to: string[] | string;
  subject: string;
  created_at: string;
};
type ResendMessage = ResendSummary & {
  from: string;
  html: string | null;
  text: string | null;
  last_event?: string;
};
type ConfirmationProof = {
  url: string;
  verificationCode: string;
};
type SignupRun = {
  context: BrowserContext;
  page: Page;
  fixture: Fixture;
  startedAt: number;
  password: string;
};
type OfferCheckoutReceipt = {
  planCode: string;
  billingCycle?: 'monthly' | 'annual';
  priceCents: number;
  email: string;
  password: string;
  authUserId: string;
  tokenHash: string;
  checkoutId: string;
  trialEndsAt: string;
  authAgeDays?: 0 | 15;
};

function isOfferCheckoutReceipt(value: unknown): value is OfferCheckoutReceipt {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.planCode === 'string' &&
    (row.billingCycle === undefined ||
      row.billingCycle === 'monthly' ||
      row.billingCycle === 'annual') &&
    typeof row.priceCents === 'number' &&
    typeof row.email === 'string' &&
    typeof row.password === 'string' &&
    typeof row.authUserId === 'string' &&
    typeof row.tokenHash === 'string' &&
    typeof row.checkoutId === 'string' &&
    typeof row.trialEndsAt === 'string' &&
    (row.authAgeDays === undefined || row.authAgeDays === 0 || row.authAgeDays === 15)
  );
}

function requestedOfferBillingCycle(): 'monthly' | 'annual' {
  const cycle = process.env.E2E_OFFER_BILLING_CYCLE ?? 'monthly';
  if (cycle !== 'monthly' && cycle !== 'annual') {
    throw new Error('E2E_OFFER_BILLING_CYCLE deve ser monthly ou annual');
  }
  return cycle;
}

let lockHeld = false;
const writeEnabled = process.env.E2E_SIGNUP_WRITE === '1';
const invokedByRunner = process.env.E2E_SIGNUP_RUNNER === '1';

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function projectRefFromSupabase(raw: string): string | null {
  try {
    const match = /^([a-z0-9]+)\.supabase\.co$/u.exec(new URL(raw).hostname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function databaseProjectRef(raw: string): string | null {
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    const username = decodeURIComponent(url.username);
    const direct = /^db\.([a-z0-9]+)\.supabase\.co$/u.exec(hostname);
    if (direct && username === 'postgres') return direct[1] ?? null;
    const poolerUser = /^postgres\.([a-z0-9]+)$/u.exec(username);
    if (/^[a-z0-9-]+\.pooler\.supabase\.com$/u.test(hostname) && poolerUser) {
      return poolerUser[1] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

function skipReason(): string | null {
  if (!baseUrl) return 'E2E_BASE_URL ausente';
  if (
    !supabaseUrl ||
    !supabaseSecret ||
    !supabasePublicKey ||
    !resendKey ||
    !expectedEmailFrom ||
    !databaseUrl ||
    !magicTokenSecret ||
    !loginHashPepper ||
    !asaasBaseUrl ||
    !asaasApiKey
  ) {
    return 'credenciais de DEV incompletas para execução e limpeza';
  }
  let target: URL;
  try {
    target = new URL(baseUrl);
  } catch {
    return 'E2E_BASE_URL inválida';
  }
  const normalizedHostname = target.hostname.toLowerCase().replace(/\.+$/u, '');
  if (normalizedHostname === 'qoro.dev' || normalizedHostname.endsWith('.qoro.dev')) {
    return 'este spec recusa qualquer origem de produção';
  }
  const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(normalizedHostname);
  if (target.protocol !== 'https:' && !isLocal) {
    return 'alvo remoto precisa usar HTTPS';
  }
  const actualRef = projectRefFromSupabase(supabaseUrl);
  if (!actualRef || actualRef !== expectedProjectRef)
    return 'Supabase não corresponde ao DEV esperado';
  if (databaseProjectRef(databaseUrl) !== expectedProjectRef) {
    return 'DATABASE_URL não corresponde ao mesmo projeto DEV';
  }
  if (
    (productionDatabaseUrl &&
      (databaseUrl === productionDatabaseUrl ||
        databaseProjectRef(productionDatabaseUrl) === expectedProjectRef)) ||
    (productionSupabaseSecret && supabaseSecret === productionSupabaseSecret)
  ) {
    return 'guard recusou credenciais de produção';
  }
  try {
    const asaas = new URL(asaasBaseUrl);
    if (
      asaas.protocol !== 'https:' ||
      !['api-sandbox.asaas.com', 'sandbox.asaas.com'].includes(asaas.hostname)
    ) {
      return 'Asaas não corresponde ao Sandbox esperado';
    }
  } catch {
    return 'ASAAS_BASE_URL do Sandbox é inválida';
  }
  if (
    process.env.SUPABASE_PROJECT_ENV !== 'dev' ||
    expectedProjectRef === process.env.SUPABASE_PROJECT_REF_PROD
  ) {
    return 'guard recusou projeto de produção';
  }
  if (!isLocal) {
    const allowedOrigin = process.env.E2E_SIGNUP_ALLOWED_ORIGIN?.trim();
    try {
      if (
        process.env.E2E_SIGNUP_ALLOW_PREVIEW !== '1' ||
        !allowedOrigin ||
        new URL(allowedOrigin).origin !== target.origin
      ) {
        return 'Preview exige opt-in e origem exata';
      }
    } catch {
      return 'E2E_SIGNUP_ALLOWED_ORIGIN inválida';
    }
  }
  return null;
}

function isTransientNetworkError(error: unknown): boolean {
  const code =
    error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : '';
  return (
    ['ECONNRESET', 'CONNECT_TIMEOUT', 'ETIMEDOUT', 'EPIPE'].includes(code) ||
    (error instanceof Error &&
      /(?:ECONNRESET|CONNECT_TIMEOUT|ETIMEDOUT|EPIPE)/u.test(error.message))
  );
}

async function admin(apiPath: string, init: { method?: 'GET' | 'DELETE' } = {}): Promise<Response> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1${apiPath}`, {
        method: init.method ?? 'GET',
        headers: {
          apikey: supabaseSecret!,
          Authorization: `Bearer ${supabaseSecret!}`,
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (![502, 503, 504].includes(response.status) || attempt === 3) return response;
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      if (!isTransientNetworkError(error) || attempt === 3) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 250));
  }
  throw new Error('Supabase Admin esgotou tentativas idempotentes');
}

async function createLegacyUnconfirmedUser(email: string, password: string): Promise<AuthUser> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          apikey: supabaseSecret!,
          Authorization: `Bearer ${supabaseSecret!}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
          email_confirm: false,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        const existing = await findUser(email);
        if (existing && !existing.email_confirmed_at && !hasSelfServiceMarker(existing)) {
          return existing;
        }
        if (![502, 503, 504].includes(response.status) || attempt === 3) {
          throw new Error('Supabase Admin não criou a conta legada sintética');
        }
      } else {
        const user = (await response.json()) as AuthUser;
        if (!user.id || user.email?.toLowerCase() !== email.toLowerCase()) {
          throw new Error('Supabase Admin devolveu identidade divergente para a conta legada');
        }
        return user;
      }
    } catch (error) {
      if (!isTransientNetworkError(error)) throw error;
      const existing = await findUser(email);
      if (existing && !existing.email_confirmed_at && !hasSelfServiceMarker(existing)) {
        return existing;
      }
      if (attempt === 3) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 250));
  }
  throw new Error('Supabase Admin esgotou a criação reconciliada da conta legada');
}

function hasSelfServiceMarker(user: AuthUser | null): boolean {
  return Boolean(
    user?.app_metadata &&
    Object.prototype.hasOwnProperty.call(user.app_metadata, 'qoro_self_service_signup'),
  );
}

function selfServiceBinding(
  user: AuthUser | null,
): { signupRef: string; state: 'pending' | 'set' } | null {
  const value = user?.app_metadata?.qoro_self_service_signup;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const binding = value as Record<string, unknown>;
  if (
    binding.version !== 1 ||
    binding.kind !== 'self_service' ||
    typeof binding.signup_ref !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(binding.signup_ref) ||
    (binding.password_state !== 'pending' && binding.password_state !== 'set')
  ) {
    return null;
  }
  return { signupRef: binding.signup_ref, state: binding.password_state };
}

async function findUser(email: string): Promise<AuthUser | null> {
  for (let page = 1; page <= 20; page += 1) {
    const response = await admin(
      `/admin/users?page=${page}&per_page=50&filter=${encodeURIComponent(email)}`,
    );
    if (!response.ok) throw new Error('Supabase Admin não respondeu à busca de cleanup');
    const body = (await response.json()) as { users?: AuthUser[] };
    const users = body.users ?? [];
    const exact = users.find((user) => user.email?.trim().toLowerCase() === email.toLowerCase());
    if (exact) return exact;
    if (users.length < 50) return null;
  }
  throw new Error('Supabase Admin excedeu a paginação de cleanup');
}

function signupTokenHash(rawToken: string): string {
  return createHmac('sha256', magicTokenSecret!)
    .update(`signup-session:v1:${rawToken}`)
    .digest('hex');
}

function emailHash(email: string): string {
  return createHmac('sha256', loginHashPepper!).update(email.trim().toLowerCase()).digest('hex');
}

async function assertTargetRuntime(): Promise<void> {
  const timestamp = Date.now();
  const nonce = randomBytes(32).toString('base64url');
  const signature = createHmac('sha256', magicTokenSecret!)
    .update(`POST\n/api/signup/runtime-fingerprint\n${timestamp}\n${nonce}`)
    .digest('hex');
  const response = await fetch(new URL('/api/signup/runtime-fingerprint', baseUrl), {
    method: 'POST',
    headers: {
      ...vercelBypassHeaders(),
      'content-type': 'application/json',
      'x-qoro-e2e-signature': signature,
    },
    body: JSON.stringify({ timestamp, nonce }),
    cache: 'no-store',
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    throw new Error(`fingerprint do runtime recusou a prova (${response.status})`);
  }
  const fingerprint = (await response.json()) as {
    environment?: unknown;
    authProjectRef?: unknown;
    databaseProjectRef?: unknown;
  };
  if (
    fingerprint.authProjectRef !== expectedProjectRef ||
    fingerprint.databaseProjectRef !== expectedProjectRef
  ) {
    throw new Error('runtime alvo não aponta integralmente para o projeto DEV esperado');
  }
  const target = new URL(baseUrl!);
  const targetHostname = target.hostname.toLowerCase().replace(/\.+$/u, '');
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(targetHostname);
  if (local ? fingerprint.environment !== 'local' : fingerprint.environment !== 'preview') {
    throw new Error('runtime alvo declarou um ambiente diferente do permitido');
  }
}

async function saveFixture(fixture: Fixture): Promise<void> {
  await mkdir(path.dirname(FIXTURE_PATH), { recursive: true });
  await writeFile(FIXTURE_PATH, `${JSON.stringify(fixture)}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function readFixture(): Promise<Fixture | null> {
  try {
    return JSON.parse(await readFile(FIXTURE_PATH, 'utf8')) as Fixture;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}

async function acquireLock(): Promise<void> {
  await mkdir(path.dirname(LOCK_PATH), { recursive: true });
  try {
    const handle = await open(LOCK_PATH, 'wx', 0o600);
    await handle.writeFile(
      `${JSON.stringify({ pid: process.pid, startedAt: Date.now() })}\n`,
      'utf8',
    );
    await handle.close();
    lockHeld = true;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    let stalePid: number | undefined;
    try {
      const stale = JSON.parse(await readFile(LOCK_PATH, 'utf8')) as { pid?: number };
      stalePid = stale.pid;
    } catch {
      stalePid = undefined;
    }
    if (typeof stalePid === 'number' && processIsAlive(stalePid)) {
      throw new Error('outro E2E de confirmação está em execução');
    }
    await rm(LOCK_PATH, { force: true });
    const handle = await open(LOCK_PATH, 'wx', 0o600);
    await handle.writeFile(
      `${JSON.stringify({ pid: process.pid, startedAt: Date.now() })}\n`,
      'utf8',
    );
    await handle.close();
    lockHeld = true;
  }
}

async function releaseLock(): Promise<void> {
  if (!lockHeld) return;
  await rm(LOCK_PATH, { force: true });
  lockHeld = false;
}

async function cleanupFixture(fixture: Fixture): Promise<{ cancelledCheckoutIds: string[] }> {
  if (fixture.projectRef !== expectedProjectRef) {
    throw new Error('fixture anterior pertence a outro projeto; limpeza recusada');
  }

  const mailHash = emailHash(fixture.email);
  const cancelledCheckoutIds = new Set<string>();
  const tokenHashes = [fixture.tokenHash, ...(fixture.tokenHashes ?? [])].filter(
    (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index,
  );

  for (let attempt = 1; attempt <= 3; attempt++) {
    const sql = postgres(databaseUrl!, { max: 1, ssl: 'require', prepare: false });
    try {
      if (tokenHashes.length > 0) {
        const owned = await sql<{ email_hash: string | null }[]>`
          select email_hash from signup_sessions where token_hash=any(${tokenHashes})
        `;
        if (owned.some((row) => row.email_hash !== mailHash))
          throw new Error('Fixture ownership mismatch; cleanup refused before external operations');
      }
      const resources = await sql<
        {
          asaas_checkout_id: string | null;
        }[]
      >`
        select asaas_checkout_id
          from signup_sessions
         where email_hash = ${mailHash}
           and asaas_checkout_id is not null
      `;
      for (const resource of resources) {
        if (!resource.asaas_checkout_id) throw new Error('Checkout cleanup omitted its identifier');
        await cancelSandboxCheckout(resource.asaas_checkout_id);
        cancelledCheckoutIds.add(resource.asaas_checkout_id);
      }
      const [emailLedger] =
        await sql`select to_regclass('public.signup_email_delivery_events') as present`;
      if (emailLedger?.present)
        await sql`delete from signup_email_delivery_events e using signup_sessions s where s.email_hash=${mailHash} and s.confirmation_message_id=e.message_id`;
      const [recoveryLedger] =
        await sql`select to_regclass('public.signup_recovery_grants') as present`;
      if (recoveryLedger?.present && tokenHashes.length > 0) {
        if (emailLedger?.present)
          await sql`delete from signup_email_delivery_events e using signup_recovery_grants g where g.email_hash=${mailHash} and g.signup_ref=any(${tokenHashes}) and e.message_id=g.provider_message_id`;
        await sql`delete from signup_recovery_grants where email_hash=${mailHash} and signup_ref=any(${tokenHashes})`;
      }
      for (const tokenHash of tokenHashes) {
        await sql`delete from signup_sessions where token_hash = ${tokenHash}`;
      }
      await sql`delete from signup_sessions where email_hash = ${mailHash}`;
      if (tokenHashes.length > 0) {
        for (const tokenHash of tokenHashes) {
          const [remainingByToken] = await sql<{ n: number }[]>`
            select count(*)::int as n from signup_sessions where token_hash = ${tokenHash}
          `;
          if ((remainingByToken?.n ?? 1) !== 0) {
            throw new Error('cleanup de signup_sessions por referência incompleto');
          }
        }
        const [remaining] = await sql<{ n: number }[]>`
          select count(*)::int as n from signup_sessions where email_hash = ${mailHash}
        `;
        if ((remaining?.n ?? 1) !== 0) throw new Error('cleanup de signup_sessions incompleto');
      } else {
        const [remaining] = await sql<{ n: number }[]>`
          select count(*)::int as n from signup_sessions where email_hash = ${mailHash}
        `;
        if ((remaining?.n ?? 1) !== 0) throw new Error('cleanup por e-mail incompleto');
      }
      break;
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : '';
      const transient =
        ['ECONNRESET', 'CONNECT_TIMEOUT', 'ETIMEDOUT', 'EPIPE'].includes(code) ||
        (error instanceof Error &&
          /(?:ECONNRESET|CONNECT_TIMEOUT|ETIMEDOUT|EPIPE)/u.test(error.message));
      if (!transient || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    } finally {
      await sql.end({ timeout: 5 }).catch(() => undefined);
    }
  }

  const user = await findUser(fixture.email);
  if (user) {
    const deleted = await admin(`/admin/users/${user.id}`, { method: 'DELETE' });
    if (!deleted.ok && deleted.status !== 404) throw new Error('cleanup do usuário Auth falhou');
  }
  if (await findUser(fixture.email)) throw new Error('usuário Auth persistiu após cleanup');
  await rm(FIXTURE_PATH, { force: true });
  return { cancelledCheckoutIds: [...cancelledCheckoutIds] };
}

async function cancelSandboxCheckout(checkoutId: string): Promise<void> {
  const base = new URL(asaasBaseUrl!);
  if (
    base.protocol !== 'https:' ||
    !['api-sandbox.asaas.com', 'sandbox.asaas.com'].includes(base.hostname)
  ) {
    throw new Error('cleanup recusou host fora do Asaas Sandbox');
  }
  const endpoint = new URL(
    `${base.toString().replace(/\/$/u, '')}/checkouts/${encodeURIComponent(checkoutId)}/cancel`,
  );
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      access_token: asaasApiKey!,
      'content-type': 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`cleanup do Checkout Sandbox falhou (${response.status})`);
  }
  const cancelled: unknown = await response.json();
  if (!isCancelledCheckoutResponse(cancelled, checkoutId)) {
    throw new Error('Checkout Sandbox não confirmou o cancelamento do mesmo identificador');
  }
}

async function assertHostedCheckoutPersisted(
  tokenHash: string,
  expectedPlanCode: string,
  expectedBillingCycle: 'monthly' | 'annual' = 'monthly',
  expectedPriceCents?: number,
): Promise<{ checkoutId: string; checkoutUrl: string }> {
  const sql = postgres(databaseUrl!, { max: 1, ssl: 'require', prepare: false });
  try {
    const [row] = await sql<
      {
        billing_attempt_state: string | null;
        asaas_checkout_id: string | null;
        asaas_checkout_url: string | null;
        asaas_customer_id: string | null;
        asaas_subscription_id: string | null;
        plan_code: string | null;
        selected_billing_cycle: string;
        selected_price_cents: number | null;
        profile_count: number;
      }[]
    >`
      select s.billing_attempt_state,
             s.asaas_checkout_id,
             s.asaas_checkout_url,
             s.asaas_customer_id,
             s.asaas_subscription_id,
             p.code as plan_code, s.selected_billing_cycle,
             (select round(pr.amount * 100)::int from public.prices pr
               where pr.plan_id = s.selected_plan_id
                 and pr.billing_cycle::text = s.selected_billing_cycle
                 and pr.active_until is null and pr.campaign_code is null
               limit 1) as selected_price_cents,
             (select count(*)::int from public.profiles profile
               where profile.id = s.auth_user_id) as profile_count
        from signup_sessions s
        left join plans p on p.id = s.selected_plan_id
       where s.token_hash = ${tokenHash}
    `;
    if (
      row?.billing_attempt_state !== 'checkout_pending' ||
      !row.asaas_checkout_id ||
      !row.asaas_checkout_url ||
      row.asaas_customer_id !== null ||
      row.asaas_subscription_id !== null ||
      row.plan_code !== expectedPlanCode ||
      row.selected_billing_cycle !== expectedBillingCycle ||
      row.profile_count !== 0 ||
      (expectedPriceCents !== undefined && row.selected_price_cents !== expectedPriceCents)
    ) {
      throw new Error('draft não persistiu o Checkout hospedado pendente antes da navegação');
    }
    return { checkoutId: row.asaas_checkout_id, checkoutUrl: row.asaas_checkout_url };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function expireOnlyFixtureTrial(userId: string, email: string): Promise<void> {
  const sql = postgres(databaseUrl!, { max: 1, ssl: 'require', prepare: false });
  try {
    const rows = await sql<{ id: string }[]>`
      update auth.users
         set created_at = now() - interval '15 days'
       where id = ${userId} and lower(email) = ${email.toLowerCase()}
       returning id
    `;
    if (rows.length !== 1 || rows[0]?.id !== userId) {
      throw new Error('não foi possível envelhecer somente a identidade de teste no Auth DEV');
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function assertExactDraftReferences(email: string, expectedRefs: readonly string[]) {
  const sql = postgres(databaseUrl!, { max: 1, ssl: 'require', prepare: false });
  try {
    const rows = await sql<{ token_hash: string }[]>`
      select token_hash
        from signup_sessions
       where email_hash = ${emailHash(email)}
       order by token_hash
    `;
    const actual = rows.map((row) => row.token_hash).sort();
    const expected = [...expectedRefs].sort();
    if (
      actual.length !== expected.length ||
      actual.some((value, index) => value !== expected[index])
    ) {
      throw new Error('o banco não contém exatamente os drafts esperados para a prova cruzada');
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function assertDraftStatuses(expected: Readonly<Record<string, string>>): Promise<void> {
  const refs = Object.keys(expected);
  const sql = postgres(databaseUrl!, { max: 1, ssl: 'require', prepare: false });
  try {
    const rows = await sql<{ token_hash: string; status: string }[]>`
      select token_hash, status
        from signup_sessions
       where token_hash = any(${refs}::text[])
    `;
    if (
      rows.length !== refs.length ||
      rows.some((row) => expected[row.token_hash] !== row.status)
    ) {
      throw new Error('o estado final dos drafts não preservou o isolamento');
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function readSafeContinuationDiagnostic(tokenHash: string): Promise<string> {
  const sql = postgres(databaseUrl!, { max: 1, ssl: 'require', prepare: false });
  try {
    const [row] = await sql<
      {
        status: string;
        row_version: number;
        auth_attempt_state: string | null;
        auth_bound: boolean;
        consumed: boolean;
      }[]
    >`
      select status,
             row_version,
             auth_attempt_state,
             auth_user_id is not null as auth_bound,
             consumed_at is not null as consumed
        from signup_sessions
       where token_hash = ${tokenHash}
       limit 1
    `;
    return row ? JSON.stringify(row) : 'draft_missing';
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function rememberCookie(context: BrowserContext, fixture: Fixture): Promise<void> {
  // Em `next dev` a primeira compilação de /sessions e a ida real ao Postgres
  // podem ultrapassar 30 s. Esperar o cookie é também o que torna o cleanup
  // exato: sem ele teríamos apenas uma sessão anônima recém-criada, sem PII nem
  // identificador seguro para apagar.
  const deadline = Date.now() + 120_000;
  const expectedHost = new URL(baseUrl!).hostname;
  while (Date.now() < deadline) {
    // Playwright omite cookies Secure ao filtrar por uma URL http://, mesmo
    // quando o Chromium os aceita no loopback. A sessão é isolada; conferir o
    // host preserva a prova de que o cookie pertence ao alvo do E2E.
    const cookies = await context.cookies();
    const cookie = cookies.find(
      (item) => item.name === '__Host-qoro_signup' && item.domain === expectedHost,
    );
    if (cookie?.value) {
      fixture.tokenHash = signupTokenHash(cookie.value);
      fixture.tokenHashes = [...new Set([...(fixture.tokenHashes ?? []), fixture.tokenHash])];
      await saveFixture(fixture);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('cookie anônimo do cadastro não foi gravado');
}

async function resend(pathname: string): Promise<Response> {
  return fetch(`${RESEND_API}${pathname}`, {
    headers: { Authorization: `Bearer ${resendKey!}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
}

function recipients(message: ResendSummary): string[] {
  return Array.isArray(message.to) ? message.to : [message.to];
}

async function waitForMessage(input: {
  email: string;
  subject: string;
  after: number;
  excludeIds?: Set<string>;
}): Promise<ResendMessage> {
  // A API de envio pode aceitar antes de a mensagem aparecer como `delivered`
  // na listagem do Resend. Preview já mediu atraso ligeiramente acima de 90 s;
  // o gate continua exigindo entrega, só amplia a janela de observação externa.
  const deadline = Date.now() + RESEND_DELIVERY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const listed = await resend('/emails?limit=100');
    if (!listed.ok) throw new Error('Resend não respondeu à listagem de mensagens');
    const body = (await listed.json()) as { data?: ResendSummary[] };
    const found = (body.data ?? []).find(
      (message) =>
        recipients(message).some(
          (recipient) => recipient.trim().toLowerCase() === input.email.toLowerCase(),
        ) &&
        message.subject === input.subject &&
        Date.parse(message.created_at) >= input.after - 30_000 &&
        !input.excludeIds?.has(message.id),
    );
    if (found) {
      const retrieved = await resend(`/emails/${encodeURIComponent(found.id)}`);
      if (!retrieved.ok) throw new Error('Resend não recuperou o corpo da mensagem');
      const message = (await retrieved.json()) as ResendMessage;
      if (message.last_event === 'delivered') return message;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('Resend não registrou a mensagem esperada dentro do prazo');
}

async function assertNoMessage(input: {
  email: string;
  subject: string;
  after: number;
  excludeIds?: Set<string>;
}): Promise<void> {
  // O envio normal aparece em poucos segundos. Esta janela cobre a fila do
  // provider sem transformar ausência em um teste de 90 s.
  await new Promise((resolve) => setTimeout(resolve, 15_000));
  const listed = await resend('/emails?limit=100');
  if (!listed.ok) throw new Error('Resend não respondeu à prova de ausência');
  const body = (await listed.json()) as { data?: ResendSummary[] };
  const found = (body.data ?? []).find(
    (message) =>
      recipients(message).some(
        (recipient) => recipient.trim().toLowerCase() === input.email.toLowerCase(),
      ) &&
      message.subject === input.subject &&
      Date.parse(message.created_at) >= input.after - 5_000 &&
      !input.excludeIds?.has(message.id),
  );
  if (found) throw new Error('um segundo draft rotacionou o link de confirmação ainda vivo');
}

function singleVerificationCode(body: string, kind: 'html' | 'text'): string {
  const pattern =
    kind === 'text'
      ? /(?:digite|use) este código:\s*\r?\n(\d{8})(?!\d)/giu
      : /(?:digite|use) este código:[\s\S]{0,1000}?>(\d{8})<\/div>/giu;
  const codes = [...body.matchAll(pattern)].map((match) => match[1]).filter(Boolean);
  if (codes.length !== 1 || !codes[0]) {
    throw new Error(`${kind} da mensagem não contém exatamente um código de oito dígitos`);
  }
  return codes[0];
}

function senderIdentity(value: string): { name: string | null; mailbox: string } {
  const wrapped = /^\s*([^<]*)\s*<([^>]+)>\s*$/u.exec(value);
  return {
    name: wrapped?.[1]?.trim() || null,
    mailbox: (wrapped?.[2] ?? value).trim().toLowerCase(),
  };
}

function confirmationProof(message: ResendMessage, expectedSignupRef: string): ConfirmationProof {
  if (!message.text || !message.html) throw new Error('mensagem sem corpo HTML/texto');
  const expectedSender = senderIdentity(expectedEmailFrom!);
  const actualSender = senderIdentity(message.from);
  if (actualSender.mailbox !== expectedSender.mailbox) {
    throw new Error('mensagem usa mailbox de remetente inesperado');
  }
  if (actualSender.name && actualSender.name !== 'Qoro') {
    throw new Error('mensagem usa nome de remetente inesperado');
  }
  if (message.html.includes('/auth/v1/verify') || message.text.includes('/auth/v1/verify')) {
    throw new Error('mensagem voltou a usar o link pronto do provider');
  }
  const textLinks = message.text.match(/https?:\/\/[^\s]+/gu) ?? [];
  const textCandidate = textLinks.find((raw) => {
    try {
      return new URL(raw).pathname === '/auth/confirm';
    } catch {
      return false;
    }
  });
  if (!textCandidate) throw new Error('texto da mensagem não contém o callback do app');

  // A jornada abre o href REAL do HTML. Validar só a alternativa em texto
  // deixaria um CTA quebrado passar enquanto o fallback continuasse correto.
  const htmlCandidates = [...message.html.matchAll(/\bhref="([^"]+)"/gu)]
    .map((match) => match[1]?.replaceAll('&amp;', '&'))
    .filter((raw): raw is string => typeof raw === 'string')
    .filter((raw) => {
      try {
        return new URL(raw).pathname === '/auth/confirm';
      } catch {
        return false;
      }
    });
  if (htmlCandidates.length === 0) throw new Error('HTML da mensagem não contém o callback do app');
  const candidate = htmlCandidates[0]!;
  if (htmlCandidates.some((raw) => raw !== candidate) || candidate !== textCandidate) {
    throw new Error('HTML e texto da mensagem apontam para callbacks diferentes');
  }

  const htmlCode = singleVerificationCode(message.html, 'html');
  const textCode = singleVerificationCode(message.text, 'text');
  if (htmlCode !== textCode) {
    throw new Error('HTML e texto da mensagem contêm códigos diferentes');
  }

  const url = new URL(candidate);
  if (url.origin !== new URL(baseUrl!).origin) throw new Error('callback usa origem inesperada');
  if (url.search) throw new Error('callback novo vazou credencial na query');
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (!fragment.get('token_hash')) throw new Error('callback sem token_hash');
  if (fragment.get('signup_ref') !== expectedSignupRef) {
    throw new Error('callback não está vinculado ao draft que iniciou o envio');
  }
  if (fragment.get('type') !== 'recovery') throw new Error('callback usa tipo inesperado');
  if (fragment.get('next') !== '/cadastro/confirmado') {
    throw new Error('callback usa destino inesperado');
  }
  if (url.toString().includes(htmlCode)) {
    throw new Error('o código de handoff vazou para a URL de confirmação');
  }
  return { url: url.toString(), verificationCode: htmlCode };
}

async function assertScannerGetDoesNotConsume(
  context: BrowserContext,
  proof: ConfirmationProof,
  fixture: Fixture,
): Promise<void> {
  if (!fixture.tokenHash) throw new Error('fixture sem hash para prova de scanner');
  const callback = new URL(proof.url);
  const tokenHash = new URLSearchParams(callback.hash.slice(1)).get('token_hash');
  if (!tokenHash) throw new Error('prova sem token para scanner');

  const response = await context.request.get(proof.url, {
    headers: vercelBypassHeaders(),
    maxRedirects: 0,
  });
  if (response.status() !== 200) throw new Error('scanner GET não recebeu a ponte inerte');
  if (!response.headers()['cache-control']?.includes('no-store')) {
    throw new Error('ponte do callback pode ser armazenada');
  }
  if (response.headers()['referrer-policy'] !== 'no-referrer') {
    throw new Error('ponte do callback permite Referer');
  }
  const html = await response.text();
  if (html.includes(tokenHash)) throw new Error('ponte refletiu o bearer no HTML');

  const user = await findUser(fixture.email);
  if (!user || user.email_confirmed_at) {
    throw new Error('scanner GET sem JavaScript consumiu a confirmação Auth');
  }
  const sql = postgres(databaseUrl!, { max: 1, ssl: 'require', prepare: false });
  try {
    const [row] = await sql<{ status: string }[]>`
      select status from signup_sessions where token_hash = ${fixture.tokenHash}
    `;
    if (row?.status !== 'email_pending') {
      throw new Error('scanner GET sem JavaScript alterou o draft');
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function passwordSignInSucceeds(email: string, password: string): Promise<boolean> {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: supabasePublicKey!,
      Authorization: `Bearer ${supabasePublicKey!}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return true;
  }

  let body: { code?: unknown; error_code?: unknown; message?: unknown; msg?: unknown } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    throw new Error(`Supabase Auth respondeu ${response.status} sem JSON na sonda de senha`);
  }
  const code = typeof body.error_code === 'string' ? body.error_code : body.code;
  const message = typeof body.message === 'string' ? body.message : body.msg;
  const signInDenied =
    response.status === 400 &&
    (code === 'invalid_credentials' ||
      code === 'invalid_grant' ||
      code === 'email_not_confirmed' ||
      (typeof message === 'string' && /invalid login credentials/iu.test(message)));
  if (signInDenied) return false;
  throw new Error(`Supabase Auth respondeu status inesperado ${response.status} na sonda de senha`);
}

async function answerQuestions(page: Page): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    const cards = page.locator('[data-slot="option-card-group"] label');
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });
    await cards.first().click();
    await page
      .getByRole('button', {
        name: index === 3 ? 'Salvar e continuar' : 'Continuar',
        exact: true,
      })
      .click();
  }
}

async function startSignup(
  browser: Browser,
  email: string,
  knownTokenHashes: readonly string[] = [],
  flow: 'legacy' | 'code' = 'legacy',
): Promise<SignupRun> {
  const context = await browser.newContext({
    baseURL: baseUrl!,
    storageState: { cookies: [], origins: [] },
  });
  await installVercelBypassForOrigin(context, new URL(baseUrl!).origin);
  const fixture: Fixture = {
    projectRef: expectedProjectRef!,
    email,
    tokenHashes: [...new Set(knownTokenHashes)],
  };
  const password = `QoroE2e7${randomBytes(12).toString('base64url')}`;
  await saveFixture(fixture);
  try {
    const page = await context.newPage();
    await page.goto('/cadastro');

    const closed = await page
      .getByRole('heading', { name: 'Cadastro indisponível no momento' })
      .isVisible()
      .catch(() => false);
    if (closed) throw new Error('funil de cadastro está fechado no alvo');
    await rememberCookie(context, fixture);

    await answerQuestions(page);
    await page.getByLabel('Seu nome', { exact: true }).fill('Ana E2E');
    await page.getByLabel('Nome da clínica', { exact: true }).fill('Clínica E2E Confirmação');
    await page.getByLabel('E-mail', { exact: true }).fill(email);
    if (flow === 'code') {
      await page.getByLabel('Crie sua senha', { exact: true }).fill(password);
      await page.getByRole('checkbox').click();
      const startedAt = Date.now();
      await page.getByRole('button', { name: 'Enviar confirmação por e-mail' }).click();
      await expect(page.getByRole('heading', { name: 'Confirme seu e-mail aqui' })).toBeVisible({
        timeout: 120_000,
      });
      const user = await findUser(email);
      if (!user || user.email_confirmed_at)
        throw new Error('new code fixture did not create an unconfirmed identity');
      return { context, page, fixture, startedAt, password };
    }
    // These historical scenarios intentionally exercise v1 link/handoff
    // compatibility. The new v2 UI requires an initial password and sends only
    // a code; its actual browser/Auth/mail proof lives in signup-mail.integration.ts.
    // Emulate an already-open v1 client through the retained API contract, rather
    // than falsely expecting today's UI to offer passwordless registration.
    await expect(page.getByLabel('Crie sua senha', { exact: true })).toBeVisible();
    const startedAt = Date.now();
    const bootstrap = await page.evaluate(
      async ({ email }) => {
        const state = await fetch('/api/signup/sessions/me', { cache: 'no-store' });
        const body: unknown = await state.json();
        if (
          !state.ok ||
          typeof body !== 'object' ||
          body === null ||
          !('session' in body) ||
          typeof body.session !== 'object' ||
          body.session === null ||
          !('rowVersion' in body.session) ||
          typeof body.session.rowVersion !== 'number'
        )
          return { stage: 'state', status: state.status };
        const identity = await fetch('/api/signup/sessions/identity', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            rowVersion: body.session.rowVersion,
            ownerName: 'Ana E2E',
            clinicName: 'Clínica E2E Confirmação',
            email,
            accepted: true,
          }),
        });
        const saved: unknown = await identity.json();
        if (
          !identity.ok ||
          typeof saved !== 'object' ||
          saved === null ||
          !('rowVersion' in saved) ||
          typeof saved.rowVersion !== 'number'
        )
          return { stage: 'identity', status: identity.status };
        const auth = await fetch('/api/signup/sessions/auth', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rowVersion: saved.rowVersion, email, accepted: true }),
        });
        return { stage: 'auth', status: auth.status };
      },
      { email },
    );
    expect(bootstrap).toEqual({ stage: 'auth', status: 200 });
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Aguardando a confirmação do e-mail' }),
    ).toBeVisible({ timeout: 120_000 });
    await expect(page.getByLabel('E-mail usado no cadastro')).toHaveCount(0);
    await expect(page.locator('[data-slot="signup-email-pending"] input')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reenviar o e-mail' })).toBeVisible();

    const user = await findUser(email);
    if (!user) throw new Error('conta Auth não foi criada');
    if (user.email_confirmed_at) throw new Error('conta Auth nasceu confirmada');
    return { context, page, fixture, startedAt, password };
  } catch (error) {
    await context.close().catch(() => undefined);
    try {
      await cleanupFixture(fixture);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'o início do cadastro falhou e o cleanup exato também falhou',
      );
    }
    throw error;
  }
}

async function openOnPhone(
  browser: Browser,
  rawUrl: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    baseURL: baseUrl!,
    storageState: { cookies: [], origins: [] },
  });
  await installVercelBypassForOrigin(context, new URL(baseUrl!).origin);
  const page = await context.newPage();
  const expectedToken = new URLSearchParams(new URL(rawUrl).hash.slice(1)).get('token_hash');
  if (!expectedToken) throw new Error('callback do telefone sem token no fragmento');
  let bridgeGets = 0;
  let bridgePosts = 0;
  const bridgeResponses: string[] = [];
  const bridgeViolations: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname !== '/auth/confirm') return;
    if (url.search || url.hash || request.url().includes(expectedToken)) {
      bridgeViolations.push('bearer na URL HTTP');
    }
    const referer = request.headers().referer;
    if (referer?.includes(expectedToken)) bridgeViolations.push('bearer no Referer');
    if (request.method() === 'GET') bridgeGets += 1;
    if (request.method() === 'POST') {
      bridgePosts += 1;
      const posted = new URLSearchParams(request.postData() ?? '');
      if (posted.get('token_hash') !== expectedToken) {
        bridgeViolations.push('POST sem o bearer esperado');
      }
    }
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname !== '/auth/confirm') return;
    bridgeResponses.push(`${response.request().method()}:${response.status()}`);
  });
  try {
    await page.goto(rawUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  } catch {
    throw new Error('navegação do callback falhou');
  }
  try {
    await page.waitForURL(
      (url) => url.pathname === '/cadastro/confirmado' && url.search === '' && url.hash === '',
      { timeout: 90_000 },
    );
  } catch (error) {
    const observed = new URL(page.url());
    const searchKeys = [...new Set(observed.searchParams.keys())].sort().join(',') || 'none';
    const failure = error instanceof Error ? error.name : 'unknown';
    throw new Error(
      `callback não terminou na confirmação sanitizada (path=${observed.pathname}; searchKeys=${searchKeys}; fragment=${observed.hash ? 'present' : 'absent'}; GET=${bridgeGets}; POST=${bridgePosts}; responses=${bridgeResponses.join(',') || 'none'}; pageClosed=${page.isClosed()}; failure=${failure})`,
    );
  }
  await expect(page.getByRole('heading', { name: 'E-mail confirmado' })).toBeVisible();
  if (bridgeGets !== 1 || bridgePosts !== 1 || bridgeViolations.length > 0) {
    throw new Error('ponte fragmento para POST divergiu do contrato seguro');
  }
  const finalReferrer = await page.evaluate(() => document.referrer);
  if (finalReferrer.includes('token_hash') || finalReferrer.includes(expectedToken)) {
    throw new Error('destino recebeu bearer no Referer');
  }
  await expect(page.getByLabel('Crie sua senha')).toBeVisible();
  await expect(page.locator('input[name="email"], input[name="verificationCode"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Criar senha e escolher plano' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);

  const checkoutStatus = await page.evaluate(async () => {
    const response = await fetch('/api/signup/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    return response.status;
  });
  if (checkoutStatus !== 403) {
    throw new Error('sessão com credencial pendente alcançou o checkout ou falhou fora do gate');
  }

  const protectedPage = await context.newPage();
  try {
    await protectedPage.goto('/cadastro/plano', {
      waitUntil: 'domcontentloaded',
      timeout: 90_000,
    });
    if (new URL(protectedPage.url()).pathname === '/cadastro/plano') {
      throw new Error('sessão com credencial pendente alcançou a seleção de plano');
    }
    await expect(protectedPage.getByRole('heading', { name: 'Escolha seu plano' })).toHaveCount(0);
  } finally {
    await protectedPage.close();
  }

  return { context, page };
}

async function waitForOriginalHandoff(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/cadastro$/u, { timeout: 120_000 });
  await expect(page.getByRole('heading', { name: 'E-mail confirmado' })).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByLabel('Código do e-mail')).toBeVisible();
  await expect(page.getByLabel('E-mail usado no cadastro')).toHaveCount(0);
  await expect(page.getByLabel('Crie sua senha')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Escolha seu plano' })).toHaveCount(0);
}

async function completeHandoffAfterRefresh(
  page: Page,
  input: { email: string; password: string; verificationCode: string; tokenHash?: string },
): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/cadastro$/u);
  await expect(page.getByRole('heading', { name: 'E-mail confirmado' })).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByLabel('E-mail usado no cadastro')).toBeVisible();
  await expect(page.getByLabel('Crie sua senha')).toHaveAttribute('type', 'password');
  await expect(page.getByLabel('Código do e-mail')).toHaveAttribute(
    'autocomplete',
    'one-time-code',
  );
  await page.getByRole('button', { name: 'Mostrar senha' }).click();
  await expect(page.getByLabel('Crie sua senha')).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Ocultar senha' }).click();
  await page.getByLabel('E-mail usado no cadastro').fill(input.email);
  await page.getByLabel('Crie sua senha').fill(input.password);
  await page.getByLabel('Código do e-mail').fill(input.verificationCode);
  const continuation = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/signup/sessions/continue',
  );
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  const response = await continuation;
  if (!response.ok()) {
    const body = await response.text();
    const diagnostic = input.tokenHash
      ? await readSafeContinuationDiagnostic(input.tokenHash)
      : 'not_requested';
    throw new Error(
      `continuação respondeu ${response.status()} ${body}; estado sanitizado: ${diagnostic}`,
    );
  }
  await expect(page).toHaveURL(/\/cadastro\/plano$/u, { timeout: 120_000 });
  await expect(page.getByRole('heading', { name: 'Escolha seu plano' })).toBeVisible();
}

test.describe('cadastro — confirmação real via Resend', () => {
  test.describe.configure({ mode: 'serial', timeout: 90_000 });

  test.beforeAll(async ({}, testInfo) => {
    // Inclui prova assinada do runtime e eventual cleanup de uma execução
    // interrompida; em cold start local essas duas etapas passam de 30 s.
    testInfo.setTimeout(180_000);
    if (!writeEnabled || !invokedByRunner) {
      throw new Error(
        'este spec mutável só pode ser executado por npm run test:e2e:signup-confirmation',
      );
    }
    const reason = skipReason();
    if (reason) throw new Error(`E2E de escrita solicitado, mas o guard recusou: ${reason}`);
    await assertTargetRuntime();
    await acquireLock();
    const stale = await readFixture();
    if (stale) {
      let held = '';
      try {
        held = await readFile(OFFER_CHECKOUT_PATH, 'utf8');
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      if (held.includes(stale.email)) {
        throw new Error('fixture de Checkout manual pendente; limpeza automática recusada');
      }
      await cleanupFixture(stale);
    }
  });

  test.afterAll(async () => {
    try {
      if (await readFixture()) throw new Error('fixture local persistiu depois do cleanup');
    } finally {
      await releaseLock();
    }
    try {
      await readFile(LOCK_PATH, 'utf8');
      throw new Error('lock local persistiu depois da suíte');
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  });

  test('@code-flow senha inicial, código, F5 e plano preservado pelo contrato novo', async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    const email = `delivered+qoro-code-${Date.now()}-${randomBytes(4).toString('hex')}@resend.dev`;
    let context: BrowserContext | null = null;
    let fixture: Fixture = { projectRef: expectedProjectRef!, email };
    try {
      const signup = await startSignup(browser, email, [], 'code');
      context = signup.context;
      fixture = signup.fixture;
      const message = await waitForMessage({
        email,
        subject: 'Seu código de confirmação — Qoro',
        after: signup.startedAt,
      });
      const code = /^(\d{8})\r?\n/u.exec(message.text ?? '')?.[1];
      if (!code)
        throw new Error('Confirmation email omitted the expected code; content suppressed');
      if (await passwordSignInSucceeds(email, signup.password))
        throw new Error('Password worked before email confirmation');
      await signup.page.reload();
      await signup.page.getByLabel('Código de confirmação').fill(code);
      const verified = signup.page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/signup/sessions/verify',
      );
      await signup.page.getByRole('button', { name: 'Confirmar e-mail', exact: true }).click();
      expect((await verified).status()).toBe(200);
      await expect(signup.page).toHaveURL(/\/cadastro\/plano$/u, { timeout: 120_000 });
      await expect(signup.page.locator('input[type=password]')).toHaveCount(0);
      if (!(await passwordSignInSucceeds(email, signup.password)))
        throw new Error('Initial password was not preserved after the code');
      await signup.page.locator('[data-slot="option-card-group"] label').first().click();
      await signup.page.getByRole('button', { name: 'Salvar plano', exact: true }).click();
      await expect(
        signup.page.getByRole('button', { name: 'Continuar no Checkout Asaas' }),
      ).toBeVisible();
      await signup.page.reload();
      await expect(
        signup.page.getByRole('button', { name: 'Continuar no Checkout Asaas' }),
      ).toBeVisible();
      if (!fixture.tokenHash) throw new Error('Code fixture lost its reference');
      const codeSignupRef = fixture.tokenHash;
      const sql = postgres(databaseUrl!, { max: 1, ssl: 'require', prepare: false });
      try {
        const [row] =
          await sql`select verification_flow_version,email_code_state,status,selected_plan_id,asaas_checkout_id from signup_sessions where token_hash=${codeSignupRef}`;
        expect(row?.verification_flow_version).toBe(2);
        expect(row?.email_code_state).toBe('verified');
        expect(row?.status).toBe('email_verified');
        expect(row?.selected_plan_id).toBeTruthy();
        expect(row?.asaas_checkout_id).toBeNull();
        if (process.env.E2E_SIGNUP_REQUIRE_DELIVERY_WEBHOOK === '1') {
          await expect
            .poll(
              async () => {
                const [delivery] =
                  await sql`select confirmation_delivery_status from signup_sessions where token_hash=${codeSignupRef}`;
                return delivery?.confirmation_delivery_status;
              },
              { timeout: 60_000, message: 'Provider delivery did not reach the DEV projection' },
            )
            .toBe('delivered');
          const [delivery] =
            await sql`select confirmation_message_id,confirmation_delivery_status from signup_sessions where token_hash=${codeSignupRef}`;
          if (typeof delivery?.confirmation_message_id !== 'string')
            throw new Error('Delivery projection omitted its provider receipt');
          const [events] =
            await sql`select count(*)::int as n from signup_email_delivery_events where message_id=${delivery.confirmation_message_id}::uuid and event='delivered'`;
          expect(events?.n).toBeGreaterThan(0);
          await mkdir(path.join(process.cwd(), 'dist/quality'), { recursive: true });
          await writeFile(
            path.join(process.cwd(), 'dist/quality/signup-preview-code-delivery.json'),
            JSON.stringify({
              at: new Date().toISOString(),
              projectRef: expectedProjectRef,
              origin: new URL(baseUrl!).origin,
              messageId: delivery?.confirmation_message_id,
              status: delivery?.confirmation_delivery_status,
              deliveredEvents: events?.n,
              recipientType: 'Resend controlled delivered alias; not proof of a real inbox',
              noCheckoutCreated: true,
            }),
          );
        }
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      await context?.close();
      await cleanupFixture(fixture);
    }
  });

  for (const cohort of ['missing', 'retained'] as const) {
    test(`@recovery-flow recuperação em outro aparelho — ${cohort}`, async ({ browser }) => {
      test.setTimeout(420_000);
      const email = `delivered+qoro-recovery-${cohort}-${Date.now()}-${randomBytes(4).toString('hex')}@resend.dev`;
      let desktop: BrowserContext | null = null;
      let phone: BrowserContext | null = null;
      let fixture: Fixture = { projectRef: expectedProjectRef!, email };
      try {
        const signup = await startSignup(
          browser,
          email,
          [],
          cohort === 'missing' ? 'legacy' : 'code',
        );
        desktop = signup.context;
        fixture = signup.fixture;
        if (!fixture.tokenHash) throw new Error('Recovery fixture lost its reference');
        const ref = fixture.tokenHash;
        const initial = await waitForMessage({
          email,
          subject: cohort === 'missing' ? INITIAL_SUBJECT : 'Seu código de confirmação — Qoro',
          after: signup.startedAt,
        });
        if (cohort === 'retained') {
          const code = /^(\d{8})\r?\n/u.exec(initial.text ?? '')?.[1];
          if (!code) throw new Error('Retained fixture omitted the code');
          await signup.page.getByLabel('Código de confirmação').fill(code);
          await signup.page.getByRole('button', { name: 'Confirmar e-mail', exact: true }).click();
          await expect(signup.page).toHaveURL(/\/cadastro\/plano$/u, { timeout: 120_000 });
          await signup.page.locator('[data-slot="option-card-group"] label').first().click();
          await signup.page.getByRole('button', { name: 'Salvar plano', exact: true }).click();
          await expect(
            signup.page.getByRole('button', { name: 'Continuar no Checkout Asaas' }),
          ).toBeVisible();
        }
        const before = await findUser(email);
        if (!before) throw new Error('Recovery fixture identity missing');
        const sql = postgres(databaseUrl!, { max: 1, ssl: 'require', prepare: false });
        let credentialFingerprint: string | null = null;
        try {
          const [credential] =
            await sql`select md5(encrypted_password) as fingerprint from auth.users where id=${before.id}::uuid`;
          if (typeof credential?.fingerprint !== 'string')
            throw new Error('Credential fingerprint unavailable');
          credentialFingerprint = credential.fingerprint;
          if (cohort === 'missing') {
            await sql`delete from signup_sessions where token_hash=${ref} and email_hash=${emailHash(email)} and billing_attempt_state is null and asaas_checkout_id is null and asaas_subscription_id is null`;
          } else {
            await sql`update signup_sessions set absolute_expires_at=now()-interval '1 minute',idle_expires_at=now()-interval '1 minute' where token_hash=${ref} and auth_user_id=${before.id}::uuid and recovery_expires_at>now() and asaas_checkout_id is null`;
          }
        } finally {
          await sql.end({ timeout: 5 });
        }
        const sentAt = Date.now();
        let operatorOutput: string;
        try {
          operatorOutput = execFileSync(
            process.execPath,
            [
              'node_modules/tsx/dist/cli.mjs',
              '--conditions=react-server',
              'scripts/run-signup-recovery-dev.ts',
            ],
            {
              input: JSON.stringify({
                userId: before.id,
                operationKey: `e2e-signup-recovery:${cohort}:${sentAt}`,
                purpose: cohort === 'missing' ? 'verify_email' : 'resume_signup',
                priorMessageId: initial.id,
              }),
              encoding: 'utf8',
              windowsHide: true,
              timeout: 90_000,
              stdio: ['pipe', 'pipe', 'pipe'],
            },
          );
        } catch {
          throw new Error('Guarded DEV recovery operator failed; sensitive output suppressed');
        }
        const receiptLine = operatorOutput
          .split(/\r?\n/u)
          .find((line) => line.startsWith('{"kind":"signup-recovery-dev-receipt"'));
        if (!receiptLine) throw new Error('Recovery operator omitted its sanitized receipt');
        const receipt: unknown = JSON.parse(receiptLine);
        if (
          typeof receipt !== 'object' ||
          receipt === null ||
          !('ok' in receipt) ||
          receipt.ok !== true
        )
          throw new Error('Recovery operator refused the synthetic account');
        const recovered = await waitForMessage({
          email,
          subject:
            cohort === 'missing'
              ? 'Problemas para confirmar seu e-mail? Vamos resolver!'
              : 'Seu cadastro está quase pronto!',
          after: sentAt,
        });
        const candidate = [...(recovered.html ?? '').matchAll(/href="([^"]+)"/gu)]
          .map((match) => match[1]?.replaceAll('&amp;', '&'))
          .find((value) => {
            try {
              return typeof value === 'string' && new URL(value).pathname === '/cadastro/retomar';
            } catch {
              return false;
            }
          });
        if (!candidate || new URL(candidate).origin !== new URL(baseUrl!).origin)
          throw new Error('Recovery email omitted the trusted callback');
        phone = await browser.newContext({
          baseURL: baseUrl!,
          storageState: { cookies: [], origins: [] },
        });
        await installVercelBypassForOrigin(phone, new URL(baseUrl!).origin);
        const page = await phone.newPage();
        try {
          await page.goto(candidate, { timeout: 60_000 });
        } catch {
          throw new Error('Recovery bridge navigation failed; active URL suppressed');
        }
        await expect.poll(() => new URL(page.url()).hash).toBe('');
        const check = postgres(databaseUrl!, { max: 1, ssl: 'require', prepare: false });
        try {
          const [grant] =
            await check`select state from signup_recovery_grants where auth_user_id=${before.id}::uuid and provider_message_id=${recovered.id}::uuid`;
          expect(grant?.state).toBe('sent');
          await page.getByRole('button', { name: 'Continuar meu cadastro', exact: true }).click();
          if (cohort === 'missing') {
            await expect(page).toHaveURL(/\/cadastro\/confirmado$/u, { timeout: 90_000 });
            const withoutJavaScript = await browser.newContext({
              baseURL: baseUrl!,
              storageState: await phone.storageState(),
              javaScriptEnabled: false,
            });
            try {
              await installVercelBypassForOrigin(withoutJavaScript, new URL(baseUrl!).origin);
              const staticPage = await withoutJavaScript.newPage();
              await staticPage.goto('/cadastro/confirmado');
              await expect(staticPage.locator('form:has(input[name="password"])')).toHaveAttribute(
                'method',
                'post',
              );
              await expect(staticPage.getByLabel('Crie sua senha')).toBeDisabled();
              await expect(
                staticPage.getByRole('button', { name: 'Criar senha e escolher plano' }),
              ).toBeDisabled();
            } finally {
              await withoutJavaScript.close();
            }
            await page.getByLabel('Crie sua senha', { exact: true }).fill(signup.password);
            await page.getByRole('button', { name: 'Criar senha e escolher plano' }).click();
            await expect(page).toHaveURL(/\/cadastro\/continuar$/u, { timeout: 90_000 });
            await expect(page.getByRole('heading', { name: 'Revise seu cadastro' })).toBeVisible();
          } else {
            await expect(page).toHaveURL(/\/cadastro\/plano$/u, { timeout: 90_000 });
            await expect(page.locator('input[type=password]')).toHaveCount(0);
            await expect(
              page.getByRole('button', { name: 'Continuar no Checkout Asaas' }),
            ).toBeVisible();
            const [credential] =
              await check`select md5(encrypted_password) as fingerprint from auth.users where id=${before.id}::uuid`;
            expect(credential?.fingerprint).toBe(credentialFingerprint);
            const [progress] =
              await check`select owner_name,clinic_name,selected_plan_id from signup_sessions where token_hash=${ref}`;
            expect(progress?.owner_name).toBe('Ana E2E');
            expect(progress?.clinic_name).toBe('Clínica E2E Confirmação');
            expect(progress?.selected_plan_id).toBeTruthy();
          }
          const after = await findUser(email);
          expect(after?.id).toBe(before.id);
          expect(after?.created_at).toBe(before.created_at);
          expect(await passwordSignInSucceeds(email, signup.password)).toBe(true);
          const [consumed] =
            await check`select state from signup_recovery_grants where auth_user_id=${before.id}::uuid and provider_message_id=${recovered.id}::uuid`;
          expect(consumed?.state).toBe('consumed');
          const [charges] =
            await check`select count(*)::int as n from signup_sessions where email_hash=${emailHash(email)} and (asaas_checkout_id is not null or asaas_subscription_id is not null)`;
          expect(charges?.n).toBe(0);
          await mkdir(path.join(process.cwd(), 'dist/quality'), { recursive: true });
          await writeFile(
            path.join(process.cwd(), `dist/quality/signup-preview-recovery-${cohort}.json`),
            JSON.stringify({
              at: new Date().toISOString(),
              cohort,
              origin: new URL(baseUrl!).origin,
              identityPreserved: true,
              birthAndTrialAnchorPreserved: true,
              noGetConsumption: true,
              firstPasswordAfterProof: cohort === 'missing',
              readyPasswordUnchanged: cohort === 'retained',
              noCheckoutCreated: true,
            }),
          );
        } finally {
          await check.end({ timeout: 5 });
        }
      } finally {
        await Promise.allSettled([phone?.close(), desktop?.close()]);
        await cleanupFixture(fixture);
      }
    });
  }

  test('/cadastro/confirmado não afirma confirmação para quem não tem sessão', async ({ page }) => {
    test.skip(!baseUrl, 'E2E_BASE_URL ausente');
    test.setTimeout(90_000);
    await page.goto(new URL('/cadastro/confirmado', baseUrl).toString());
    await expect(page.getByRole('heading', { name: 'E-mail confirmado' })).toHaveCount(0);
    await expect
      .poll(async () => {
        if (new URL(page.url()).pathname === '/login') return true;
        return page
          .getByRole('heading', { name: 'Não foi possível verificar agora' })
          .isVisible()
          .catch(() => false);
      })
      .toBe(true);
  });

  test('o link confirma no telefone, mas só o código libera a aba original', async ({
    browser,
  }) => {
    const reason = skipReason();
    test.skip(!writeEnabled, 'E2E_SIGNUP_WRITE != 1');
    if (reason) throw new Error(`guard recusou a escrita: ${reason}`);
    test.setTimeout(420_000);

    const email = `delivered+qoro-signup-${Date.now()}-${randomBytes(4).toString('hex')}@resend.dev`;
    let desktop: BrowserContext | null = null;
    let phone: BrowserContext | null = null;
    let fixture: Fixture = { projectRef: expectedProjectRef!, email };
    try {
      const signup = await startSignup(browser, email);
      desktop = signup.context;
      fixture = signup.fixture;
      const message = await waitForMessage({
        email,
        subject: INITIAL_SUBJECT,
        after: signup.startedAt,
      });
      if (!fixture.tokenHash) throw new Error('fixture sem hash do draft');
      const proof = confirmationProof(message, fixture.tokenHash);
      await assertScannerGetDoesNotConsume(signup.context, proof, fixture);
      const phoneSession = await openOnPhone(browser, proof.url);
      phone = phoneSession.context;

      await waitForOriginalHandoff(signup.page);
      if (await passwordSignInSucceeds(email, signup.password)) {
        throw new Error('a senha funcionou antes do handoff explícito');
      }

      await completeHandoffAfterRefresh(signup.page, {
        email,
        password: signup.password,
        verificationCode: proof.verificationCode,
        tokenHash: fixture.tokenHash,
      });
      if (!(await passwordSignInSucceeds(email, signup.password))) {
        throw new Error('a senha instalada pelo handoff não autenticou');
      }

      await signup.page.locator('[data-slot="option-card-group"] label').first().click();
      await signup.page.getByRole('button', { name: 'Salvar plano' }).click();
      await expect(signup.page.getByText('Plano salvo')).toBeVisible();
      await expect(signup.page).toHaveURL(/\/cadastro\/plano$/u);
    } finally {
      await Promise.allSettled([phone?.close(), desktop?.close()]);
      await cleanupFixture(fixture);
    }
  });

  test('o destinatário confirma e cria a senha uma única vez no telefone, sem autorizar a aba anônima', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const email = `delivered+qoro-signup-${Date.now()}-${randomBytes(4).toString('hex')}@resend.dev`;
    let desktop: BrowserContext | null = null;
    let phone: BrowserContext | null = null;
    let fixture: Fixture = { projectRef: expectedProjectRef!, email };
    try {
      const signup = await startSignup(browser, email);
      desktop = signup.context;
      fixture = signup.fixture;
      const message = await waitForMessage({
        email,
        subject: INITIAL_SUBJECT,
        after: signup.startedAt,
      });
      if (!fixture.tokenHash) throw new Error('fixture sem hash do draft');
      const proof = confirmationProof(message, fixture.tokenHash);
      const verified = await openOnPhone(browser, proof.url);
      phone = verified.context;
      await waitForOriginalHandoff(signup.page);
      // The anonymous initiator has no authority to use the authenticated-recipient endpoint.
      const anonymous = await signup.page.evaluate(async () => {
        const response = await fetch('/api/signup/password', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: 'UnauthorizedSynthetic7!' }),
        });
        return response.status;
      });
      expect(anonymous).toBe(401);
      expect(await passwordSignInSucceeds(email, signup.password)).toBe(false);
      await verified.page.getByLabel('Crie sua senha').fill(signup.password);
      const passwordResponse = verified.page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/signup/password',
      );
      await verified.page.getByRole('button', { name: 'Criar senha e escolher plano' }).click();
      expect((await passwordResponse).status()).toBe(200);
      await expect(verified.page).toHaveURL(/\/cadastro\/plano$/u, { timeout: 120_000 });
      await expect(verified.page.getByRole('heading', { name: 'Escolha seu plano' })).toBeVisible();
      expect(await passwordSignInSucceeds(email, signup.password)).toBe(true);
      // Fault injection only into this disposable fixture: simulate SQL
      // finalization losing its response after Auth has installed the password.
      const sql = postgres(databaseUrl!, { max: 1, ssl: 'require', prepare: false });
      try {
        const changed = await sql<{ row_version: number }[]>`
          update signup_sessions
             set auth_attempt_state = 'uncertain', row_version = row_version + 1
           where token_hash = ${fixture.tokenHash}
             and email_hash = ${emailHash(email)}
             and status = 'email_verified'
             and auth_attempt_state = 'completed'
             and consumed_at is not null
           returning row_version
        `;
        expect(changed).toHaveLength(1);
      } finally {
        await sql.end({ timeout: 5 });
      }
      await verified.page.goto('/cadastro/confirmado');
      await expect(verified.page.getByLabel('Sua senha', { exact: true })).toBeVisible();
      await verified.page.getByLabel('Sua senha', { exact: true }).fill(signup.password);
      await verified.page.getByRole('button', { name: 'Confirmar senha e continuar' }).click();
      await expect(verified.page).toHaveURL(/\/cadastro\/plano$/u, { timeout: 120_000 });
      await verified.page.goto('/cadastro/confirmado');
      await expect(verified.page.getByRole('link', { name: 'Escolher plano' })).toBeVisible();
      await expect(verified.page.locator('input[name="password"]')).toHaveCount(0);
      // A second submission cannot replace the installed password, even with a live OTP session.
      const replay = await verified.page.evaluate(async () => {
        const response = await fetch('/api/signup/password', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: 'DifferentSyntheticReplay7!' }),
        });
        return response.status;
      });
      expect(replay).toBe(401);
      expect(await passwordSignInSucceeds(email, signup.password)).toBe(true);
      expect(await passwordSignInSucceeds(email, 'DifferentSyntheticReplay7!')).toBe(false);
      await expect(signup.page).toHaveURL(/\/cadastro$/u);
      await expect(signup.page.getByRole('heading', { name: 'Escolha seu plano' })).toHaveCount(0);
    } finally {
      await Promise.allSettled([phone?.close(), desktop?.close()]);
      await cleanupFixture(fixture);
    }
  });

  test('@code-checkout checkout recorrente abre no Asaas após código e senha única', async ({
    browser,
  }) => {
    const reason = skipReason();
    test.skip(!writeEnabled, 'E2E_SIGNUP_WRITE != 1');
    if (reason) throw new Error(`guard recusou a escrita: ${reason}`);
    test.skip(
      new URL(baseUrl!).protocol !== 'https:',
      'Asaas Sandbox recusa callbacks HTTP; este cenário exige Preview HTTPS',
    );
    test.setTimeout(420_000);

    const email = `checkout+qoro-signup-${Date.now()}-${randomBytes(4).toString('hex')}@resend.dev`;
    let desktop: BrowserContext | null = null;
    let checkoutProof: { checkoutId: string; planCode: string } | null = null;
    let fixture: Fixture = { projectRef: expectedProjectRef!, email };
    try {
      const signup = await startSignup(browser, email, [], 'code');
      desktop = signup.context;
      fixture = signup.fixture;
      const message = await waitForMessage({
        email,
        subject: 'Seu código de confirmação — Qoro',
        after: signup.startedAt,
      });
      if (!fixture.tokenHash) throw new Error('fixture sem hash do draft');
      const code = /^(\d{8})\r?\n/u.exec(message.text ?? '')?.[1];
      if (!code) throw new Error('Checkout fixture did not receive its confirmation code');
      await signup.page.getByLabel('Código de confirmação').fill(code);
      await signup.page.getByRole('button', { name: 'Confirmar e-mail', exact: true }).click();
      await expect(signup.page).toHaveURL(/\/cadastro\/plano$/u, { timeout: 120_000 });
      await expect(signup.page.locator('input[type=password]')).toHaveCount(0);
      if (!(await passwordSignInSucceeds(email, signup.password)))
        throw new Error('Initial password failed after the checkout fixture confirmed its code');
      const plansResponse = await signup.page.request.get('/api/signup/plan', {
        headers: vercelBypassHeaders(),
        maxRedirects: 0,
      });
      if (!plansResponse.ok()) throw new Error('catálogo do cadastro indisponível no E2E');
      const catalog = (await plansResponse.json()) as {
        plans?: Array<{ code: string }>;
        trialDays?: number;
        offerTrialEndsAt?: string | null;
      };
      const newOfferActive = catalog.plans?.some((plan) => plan.code === 'clinica_2026_2');
      if (!newOfferActive) throw new Error('New monthly offer is unavailable in the Preview');
      const user = await findUser(email);
      const createdAt = Date.parse(user?.created_at ?? '');
      const endsAt = Date.parse(catalog.offerTrialEndsAt ?? '');
      if (catalog.trialDays !== 14 || endsAt - createdAt !== 14 * 86_400_000) {
        throw new Error('cadastro novo não preservou 14 dias desde a criação no Auth DEV');
      }
      const selectedName = 'Clínica · 2 médicos';
      const selectedCode = 'clinica_2026_2';
      await signup.page
        .locator('[data-slot="option-card-group"]')
        .getByText(selectedName, { exact: true })
        .click();
      await expect(signup.page.getByRole('radio', { name: /Clínica/u })).toBeChecked();
      await signup.page.getByRole('button', { name: 'Salvar plano' }).click();
      await expect(signup.page.getByText('Plano salvo')).toBeVisible();
      await signup.page.getByRole('button', { name: 'Continuar no Checkout Asaas' }).click();
      await signup.page.waitForURL(
        (url) =>
          url.protocol === 'https:' &&
          url.hostname === 'sandbox.asaas.com' &&
          /^\/(?:\d+\/)?checkoutSession\/show(?:\/|$)/u.test(url.pathname),
        { timeout: 90_000, waitUntil: 'domcontentloaded' },
      );
      await expect(signup.page.getByText('Informações da assinatura')).toBeVisible({
        timeout: 30_000,
      });
      const hosted = await assertHostedCheckoutPersisted(fixture.tokenHash!, selectedCode);
      checkoutProof = { checkoutId: hosted.checkoutId, planCode: selectedCode };
    } finally {
      await desktop?.close();
      const cleanup = await cleanupFixture(fixture);
      if (checkoutProof) {
        expect(cleanup.cancelledCheckoutIds).toContain(checkoutProof.checkoutId);
        await mkdir(path.join(process.cwd(), 'dist/quality'), { recursive: true });
        await writeFile(
          path.join(process.cwd(), 'dist/quality/signup-preview-code-checkout.json'),
          JSON.stringify({
            at: new Date().toISOString(),
            origin: new URL(baseUrl!).origin,
            projectRef: expectedProjectRef,
            ...checkoutProof,
            billingCycle: 'monthly',
            initialPasswordPreserved: true,
            trialDaysFromAuth: 14,
            paymentMade: false,
            cancelledResponseCorrelated: true,
            fixtureCleaned: true,
          }),
        );
      }
    }
  });

  test('@prepare-offer-checkout prepara contratação real para pagamento manual no Sandbox', async ({
    browser,
  }) => {
    test.skip(process.env.E2E_SIGNUP_PREPARE_OFFER !== '1', 'preparação manual não solicitada');
    const freshTrial = process.env.E2E_SIGNUP_FRESH_OFFER === '1';
    const planCode = process.env.E2E_OFFER_PLAN_CODE;
    if (planCode !== 'consultorio_2026' && planCode !== 'clinica_2026_2') {
      throw new Error('E2E_OFFER_PLAN_CODE precisa identificar um dos dois planos de entrada');
    }
    const billingCycle = requestedOfferBillingCycle();
    const monthlyPrice = planCode === 'consultorio_2026' ? 19700 : 39700;
    const expectedPrice = billingCycle === 'annual' ? monthlyPrice * 10 : monthlyPrice;
    const reason = skipReason();
    if (reason) throw new Error(`guard recusou a escrita: ${reason}`);
    test.setTimeout(420_000);
    if (!baseUrl) throw new Error('E2E_BASE_URL ausente');
    await assertPreviewRuntimeIsDev(baseUrl, { requireSandboxAsaas: true });

    const email = `offer-${planCode}-${billingCycle}-${Date.now()}-${randomBytes(4).toString('hex')}@resend.dev`;
    let fixture: Fixture = { projectRef: expectedProjectRef!, email };
    let desktop: BrowserContext | null = null;
    let phone: BrowserContext | null = null;
    let heldForManualPayment = false;
    try {
      let priorRaw = '[]';
      try {
        priorRaw = await readFile(OFFER_CHECKOUT_PATH, 'utf8');
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      const prior: unknown = JSON.parse(priorRaw);
      if (!Array.isArray(prior) || !prior.every(isOfferCheckoutReceipt)) {
        throw new Error('recibos locais de Checkout estão ausentes ou inválidos');
      }
      if (
        prior.some(
          (item) =>
            item.planCode === planCode &&
            (item.billingCycle ?? 'monthly') === billingCycle &&
            (item.authAgeDays === 0) === freshTrial,
        )
      ) {
        throw new Error('já existe Checkout manual desse plano; reconcilie antes de criar outro');
      }

      const signup = await startSignup(browser, email);
      desktop = signup.context;
      fixture = signup.fixture;
      const message = await waitForMessage({
        email,
        subject: INITIAL_SUBJECT,
        after: signup.startedAt,
      });
      if (!fixture.tokenHash) throw new Error('fixture sem hash do draft');
      const proof = confirmationProof(message, fixture.tokenHash);
      phone = (await openOnPhone(browser, proof.url)).context;
      await waitForOriginalHandoff(signup.page);
      await completeHandoffAfterRefresh(signup.page, {
        email,
        password: signup.password,
        verificationCode: proof.verificationCode,
        tokenHash: fixture.tokenHash,
      });

      const createdUser = await findUser(email);
      if (!createdUser) throw new Error('conta Auth não foi reencontrada após confirmação');
      if (!freshTrial) {
        // A prova de pagamento tardio precisa vencer o trial. Alteramos apenas
        // o relógio da identidade sintética no Auth DEV.
        await expireOnlyFixtureTrial(createdUser.id, email);
        await signup.page.reload();
      }

      const response = await signup.page.request.get('/api/signup/plan', {
        headers: vercelBypassHeaders(),
        maxRedirects: 0,
      });
      if (!response.ok()) throw new Error(`catálogo do cadastro respondeu ${response.status()}`);
      const state = (await response.json()) as {
        plans?: Array<{
          id: string;
          code: string;
          priceCents: number;
          cycle: 'monthly' | 'annual';
        }>;
        offerTrialEndsAt?: string;
      };
      const codes = [...new Set(state.plans?.map((plan) => plan.code) ?? [])].sort();
      if (JSON.stringify(codes) !== JSON.stringify(['clinica_2026_2', 'consultorio_2026'])) {
        throw new Error('o Preview não oferece exatamente Consultório e Clínica');
      }
      const selected = state.plans?.find(
        (plan) => plan.code === planCode && plan.cycle === billingCycle,
      );
      if (selected?.priceCents !== expectedPrice || !state.offerTrialEndsAt) {
        throw new Error('preço ou prazo do trial não corresponde à nova oferta');
      }
      const authUser = await findUser(email);
      if (!authUser) throw new Error('conta Auth não foi reencontrada após confirmação');
      const createdAt = Date.parse(authUser.created_at ?? '');
      const trialEndsAt = Date.parse(state.offerTrialEndsAt);
      if (!Number.isFinite(createdAt) || trialEndsAt - createdAt !== 14 * 86_400_000) {
        throw new Error('trial não termina 14 dias após a criação da conta Auth');
      }
      if (freshTrial && (createdAt < Date.now() - 3_600_000 || trialEndsAt <= Date.now())) {
        throw new Error('a fixture de conta nova não preservou o trial vigente');
      }

      if (billingCycle === 'annual') {
        await signup.page.getByRole('button', { name: 'Anual · preço de 10 meses' }).click();
      }
      await signup.page
        .locator('[data-slot="option-card-group"]')
        .getByText(planCode === 'consultorio_2026' ? 'Consultório' : 'Clínica · 2 médicos', {
          exact: true,
        })
        .click();
      await signup.page.getByRole('button', { name: 'Salvar plano' }).click();
      await expect(signup.page.getByText('Plano salvo')).toBeVisible();
      await signup.page.getByRole('button', { name: 'Continuar no Checkout Asaas' }).click();
      await signup.page.waitForURL(
        (url) =>
          url.hostname === 'sandbox.asaas.com' &&
          /^\/(?:\d+\/)?checkoutSession\/show(?:\/|$)/u.test(url.pathname),
        { timeout: 90_000, waitUntil: 'domcontentloaded' },
      );
      await expect(signup.page.getByText('Informações da assinatura')).toBeVisible({
        timeout: 30_000,
      });
      const persisted = await assertHostedCheckoutPersisted(
        fixture.tokenHash,
        planCode,
        billingCycle,
        expectedPrice,
      );
      if (persisted.checkoutUrl !== signup.page.url()) {
        throw new Error('URL persistida diverge da página do Asaas aberta pelo cadastro');
      }
      const next = [
        ...prior,
        {
          planCode,
          billingCycle,
          priceCents: expectedPrice,
          email,
          // Credencial sintética somente no arquivo local ignorado, para retomar
          // a sessão após o pagamento manual em outro navegador.
          password: signup.password,
          authUserId: authUser.id,
          tokenHash: fixture.tokenHash,
          checkoutId: persisted.checkoutId,
          checkoutUrl: persisted.checkoutUrl,
          trialEndsAt: state.offerTrialEndsAt,
          authAgeDays: freshTrial ? 0 : 15,
          createdAt: new Date().toISOString(),
        },
      ];
      await mkdir(path.dirname(OFFER_CHECKOUT_PATH), { recursive: true });
      await writeFile(OFFER_CHECKOUT_PATH, `${JSON.stringify(next, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      heldForManualPayment = true;
      await rm(FIXTURE_PATH, { force: true });
      console.log(
        `PASS: Checkout ${planCode} (${freshTrial ? 'trial novo' : 'trial vencido'}) guardado para pagamento manual no Sandbox`,
      );
    } finally {
      await Promise.allSettled([phone?.close(), desktop?.close()]);
      if (!heldForManualPayment) await cleanupFixture(fixture);
    }
  });

  test('@inspect-fresh-offer-checkout confere conta nova antes da conclusão no Asaas', async ({
    browser,
  }) => {
    test.skip(
      process.env.E2E_SIGNUP_INSPECT_FRESH_OFFER !== '1',
      'inspeção da fixture fresca não solicitada',
    );
    const reason = skipReason();
    if (reason) throw new Error(`guard recusou a leitura: ${reason}`);
    const raw: unknown = JSON.parse(await readFile(OFFER_CHECKOUT_PATH, 'utf8'));
    if (!Array.isArray(raw) || !raw.every(isOfferCheckoutReceipt)) {
      throw new Error('recibos locais de Checkout estão ausentes ou inválidos');
    }
    const receipt = raw.find(
      (item) =>
        item.planCode === 'clinica_2026_2' &&
        (item.billingCycle ?? 'monthly') === 'monthly' &&
        item.authAgeDays === 0,
    );
    if (!receipt) throw new Error('Checkout de conta nova não foi preparado');
    const user = await findUser(receipt.email);
    const createdAt = Date.parse(user?.created_at ?? '');
    if (
      user?.id !== receipt.authUserId ||
      !Number.isFinite(createdAt) ||
      Date.parse(receipt.trialEndsAt) - createdAt !== 14 * 86_400_000
    ) {
      throw new Error('identidade e trial absoluto divergem do Auth DEV');
    }
    const persisted = await assertHostedCheckoutPersisted(
      receipt.tokenHash,
      receipt.planCode,
      'monthly',
      receipt.priceCents,
    );

    const checkout = new URL(persisted.checkoutUrl);
    if (checkout.protocol !== 'https:' || checkout.hostname !== 'sandbox.asaas.com') {
      throw new Error('fixture não aponta para o Checkout Sandbox');
    }
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const page = await context.newPage();
      let leakedBypass = false;
      page.on('request', (request) => {
        if (
          new URL(request.url()).hostname === 'sandbox.asaas.com' &&
          request.headers()['x-vercel-protection-bypass']
        ) {
          leakedBypass = true;
        }
      });
      const response = await page.goto(persisted.checkoutUrl);
      if (response?.status() !== 200) throw new Error('Checkout Sandbox indisponível');
      await expect(page.getByText('Informações da assinatura')).toBeVisible();
      await expect(page.locator('body')).toContainText(
        (receipt.priceCents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
      );
      if (leakedBypass) throw new Error('segredo de proteção do Preview vazou ao Asaas');
    } finally {
      await context.close();
    }
    console.log('PASS: conta nova pendente tem Auth, trial, preço e Checkout Sandbox coerentes');
  });

  test('@retire-expired-offer-checkout limpa Checkout vencido sem pagamento antes de nova tentativa', async () => {
    test.skip(
      process.env.E2E_SIGNUP_RETIRE_OFFER !== '1',
      'limpeza de Checkout vencido não solicitada',
    );
    const reason = skipReason();
    if (reason) throw new Error(`guard recusou a escrita: ${reason}`);
    const planCode = process.env.E2E_OFFER_PLAN_CODE;
    if (planCode !== 'consultorio_2026' && planCode !== 'clinica_2026_2') {
      throw new Error('plano de limpeza não pertence aos dois Checkouts de teste');
    }
    const billingCycle = requestedOfferBillingCycle();
    const freshTrial = process.env.E2E_SIGNUP_FRESH_OFFER === '1';
    const raw: unknown = JSON.parse(await readFile(OFFER_CHECKOUT_PATH, 'utf8'));
    if (!Array.isArray(raw) || !raw.every(isOfferCheckoutReceipt)) {
      throw new Error('recibos locais de Checkout estão ausentes ou inválidos');
    }
    const receipt = raw.find(
      (item) =>
        item.planCode === planCode &&
        (item.billingCycle ?? 'monthly') === billingCycle &&
        (item.authAgeDays === 0) === freshTrial,
    );
    if (
      !receipt ||
      !receipt.email.startsWith(`offer-${planCode}-`) ||
      !receipt.email.endsWith('@resend.dev')
    ) {
      throw new Error('limpeza recusou identidade que não é fixture sintética da oferta');
    }

    const sql = postgres(databaseUrl!, { max: 1, ssl: 'require', prepare: false });
    let draftId: string;
    try {
      const rows = await sql<
        {
          id: string;
          billing_attempt_state: string | null;
          asaas_checkout_id: string | null;
          expired: boolean;
          clinic_id: string | null;
        }[]
      >`
        select s.id::text, s.billing_attempt_state, s.asaas_checkout_id,
               s.idle_expires_at < now() and s.absolute_expires_at < now() as expired,
               p.clinic_id
          from public.signup_sessions s
          left join public.profiles p on p.id = s.auth_user_id
         where s.auth_user_id = ${receipt.authUserId}::uuid
           and s.token_hash = ${receipt.tokenHash}
      `;
      const row = rows[0];
      if (
        rows.length !== 1 ||
        row?.billing_attempt_state !== 'checkout_pending' ||
        row.asaas_checkout_id !== receipt.checkoutId ||
        !row.expired ||
        row.clinic_id
      ) {
        throw new Error('limpeza recusou draft ativo, pago, provisionado ou divergente');
      }
      draftId = row.id;
    } finally {
      await sql.end({ timeout: 5 });
    }

    const providerBase = new URL(asaasBaseUrl!);
    if (!['sandbox.asaas.com', 'api-sandbox.asaas.com'].includes(providerBase.hostname)) {
      throw new Error('limpeza recusou Asaas fora do Sandbox');
    }
    const apiBase = asaasBaseUrl!.replace(/\/$/u, '');
    const subscriptionsUrl = new URL(`${apiBase}/subscriptions`);
    subscriptionsUrl.searchParams.set('externalReference', `signup:${draftId}`);
    const subscriptionsResponse = await fetch(subscriptionsUrl, {
      headers: { access_token: asaasApiKey! },
      signal: AbortSignal.timeout(20_000),
    });
    if (!subscriptionsResponse.ok) {
      throw new Error(`readback de assinatura no Asaas respondeu ${subscriptionsResponse.status}`);
    }
    const subscriptions = (await subscriptionsResponse.json()) as { data?: unknown[] };
    if (subscriptions.data?.length) throw new Error('Checkout tem assinatura; limpeza recusada');

    let offset = 0;
    while (true) {
      const paymentsUrl = new URL(`${apiBase}/payments`);
      paymentsUrl.searchParams.set('limit', '100');
      paymentsUrl.searchParams.set('offset', String(offset));
      const paymentsResponse = await fetch(paymentsUrl, {
        headers: { access_token: asaasApiKey! },
        signal: AbortSignal.timeout(20_000),
      });
      if (!paymentsResponse.ok) {
        throw new Error(`readback de cobranças no Asaas respondeu ${paymentsResponse.status}`);
      }
      const payments = (await paymentsResponse.json()) as {
        data?: Array<{ checkoutSession?: string }>;
        hasMore?: boolean;
      };
      if (!Array.isArray(payments.data)) throw new Error('lista de cobranças do Asaas inválida');
      if (payments.data.some((payment) => payment.checkoutSession === receipt.checkoutId)) {
        throw new Error('Checkout tem cobrança; limpeza recusada');
      }
      if (!payments.hasMore) break;
      offset += payments.data.length;
      if (payments.data.length === 0) throw new Error('paginação do Asaas não avançou');
    }

    await cleanupFixture({
      projectRef: expectedProjectRef!,
      email: receipt.email,
      tokenHash: receipt.tokenHash,
    });
    await writeFile(
      OFFER_CHECKOUT_PATH,
      `${JSON.stringify(
        raw.filter(
          (item) =>
            item.planCode !== planCode ||
            (item.billingCycle ?? 'monthly') !== billingCycle ||
            (item.authAgeDays === 0) !== freshTrial,
        ),
        null,
        2,
      )}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    console.log(`PASS: Checkout vencido ${planCode} retirado sem pagamento ou tenant`);
  });

  test('@verify-offer-checkout confirma pagamento, provisionamento e acesso no Preview', async ({
    browser,
  }) => {
    test.skip(process.env.E2E_SIGNUP_VERIFY_OFFER !== '1', 'verificação manual não solicitada');
    const freshTrial = process.env.E2E_SIGNUP_FRESH_OFFER === '1';
    const reason = skipReason();
    if (reason) throw new Error(`guard recusou a escrita: ${reason}`);
    const planCode = process.env.E2E_OFFER_PLAN_CODE;
    if (planCode !== 'consultorio_2026' && planCode !== 'clinica_2026_2') {
      throw new Error('plano de verificação não pertence aos dois Checkouts de teste');
    }
    const billingCycle = requestedOfferBillingCycle();
    test.setTimeout(240_000);

    const raw: unknown = JSON.parse(await readFile(OFFER_CHECKOUT_PATH, 'utf8'));
    if (!Array.isArray(raw) || !raw.every(isOfferCheckoutReceipt)) {
      throw new Error('recibos locais de Checkout estão ausentes ou inválidos');
    }
    const receipt = raw.find(
      (item) =>
        item.planCode === planCode &&
        (item.billingCycle ?? 'monthly') === billingCycle &&
        (item.authAgeDays === 0) === freshTrial,
    );
    if (!receipt) throw new Error('não há Checkout preparado para o plano solicitado');

    const context = await browser.newContext({
      baseURL: baseUrl!,
      storageState: { cookies: [], origins: [] },
    });
    await installVercelBypassForOrigin(context, new URL(baseUrl!).origin);
    try {
      const page = await context.newPage();
      await page.goto('/login');
      await page.locator('#email').fill(receipt.email);
      await page.getByLabel('Senha', { exact: true }).fill(receipt.password);
      await page.getByRole('button', { name: 'Entrar', exact: true }).click();
      await expect(page).toHaveURL(
        /\/(?:cadastro\/(?:continuar|plano|pagamento)|dashboard)(?:\?.*)?$/u,
        {
          timeout: 60_000,
        },
      );

      let provisioned = false;
      for (let attempt = 0; attempt < 18; attempt += 1) {
        const response = await page.evaluate(async () => {
          const result = await fetch('/api/signup/checkout/status', { method: 'POST' });
          return { status: result.status, body: (await result.json()) as { state?: string } };
        });
        if (response.status === 200) {
          if (response.body.state !== 'provisioned')
            throw new Error('status 200 sem tenant provisionado');
          provisioned = true;
          break;
        }
        if (response.status !== 202) {
          throw new Error(`readback autenticado do Checkout respondeu ${response.status}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
      if (!provisioned) {
        throw new Error(
          freshTrial
            ? 'Asaas ainda não confirmou a contratação com trial vigente'
            : 'Asaas ainda não confirmou o pagamento do trial vencido',
        );
      }

      const returnResponses: string[] = [];
      page.on('response', (response) => {
        const path = new URL(response.url()).pathname;
        if (
          path === '/auth/session-refresh' ||
          path === '/api/signup/checkout/status' ||
          path === '/dashboard'
        ) {
          returnResponses.push(`${path}:${response.status()}`);
        }
      });
      await page.goto('/cadastro/pagamento?resultado=success');
      await page.waitForURL(/\/(?:dashboard|login)$/u, { timeout: 60_000 });
      console.log(`retorno ${planCode}: ${returnResponses.join(', ')}`);
      if (new URL(page.url()).pathname === '/login') {
        throw new Error('Checkout provisionado, mas o retorno perdeu a sessão antes do dashboard');
      }
      await expect(page).toHaveURL(/\/dashboard$/u, { timeout: 60_000 });
      const replay = await page.evaluate(async () => {
        const result = await fetch('/api/signup/checkout/status', { method: 'POST' });
        return { status: result.status, body: (await result.json()) as { state?: string } };
      });
      if (replay.status !== 200 || replay.body.state !== 'provisioned') {
        throw new Error('replay da confirmação não foi idempotente');
      }

      const sql = postgres(databaseUrl!, { max: 1, ssl: 'require', prepare: false });
      let subscriptionId: string;
      let paymentId: string;
      try {
        const rows = await sql<
          {
            clinic_id: string;
            billing_status: string;
            clinic_status: string;
            enforce_trial_deadline: boolean;
            trial_ends_at: Date;
            asaas_subscription_id: string;
            code: string;
            amount: string;
            billing_cycle: string;
            ai_config_count: number;
            doctors: number | null;
            staff: number | null;
          }[]
        >`
          select p.clinic_id, s.billing_status, c.status as clinic_status,
                 s.enforce_trial_deadline,
                 s.trial_ends_at, s.asaas_subscription_id, pl.code,
                 pr.amount::text as amount, pr.billing_cycle,
                 (select count(*)::int from public.ai_clinic_config a
                   where a.clinic_id = p.clinic_id) as ai_config_count,
                 seats.doctors, seats.staff
            from public.profiles p
            join public.clinics c on c.id = p.clinic_id
            join public.subscriptions s on s.clinic_id = p.clinic_id
            join public.plans pl on pl.id = s.plan_id
            join public.prices pr on pr.id = s.price_id
            left join public.plan_seat_limits seats on seats.plan_id = s.plan_id
           where p.id = ${receipt.authUserId}
        `;
        const row = rows[0];
        if (
          rows.length !== 1 ||
          !row?.clinic_id ||
          row.billing_status !== (freshTrial ? 'trial' : 'active') ||
          row.clinic_status !== (freshTrial ? 'trial' : 'active') ||
          !row.enforce_trial_deadline ||
          row.code !== planCode ||
          row.billing_cycle !== billingCycle ||
          row.amount !== (receipt.priceCents / 100).toFixed(2) ||
          row.trial_ends_at?.toISOString() !== receipt.trialEndsAt ||
          row.ai_config_count !== 1 ||
          row.doctors !== (planCode === 'consultorio_2026' ? 1 : 2) ||
          row.staff !== 3 ||
          !row.asaas_subscription_id
        ) {
          throw new Error('tenant, configuração, preço ou trial divergem do Checkout concluído');
        }
        subscriptionId = row.asaas_subscription_id;
        const invoices = await sql<
          {
            status: string;
            total_amount: string;
            asaas_payment_id: string | null;
          }[]
        >`
          select status, total_amount::text as total_amount, asaas_payment_id
            from public.invoices where clinic_id = ${row.clinic_id}
        `;
        const paid = invoices.filter((invoice) => invoice.status === 'paid');
        if (freshTrial) {
          if (paid.length !== 0) {
            throw new Error('conta recém-criada recebeu cobrança paga antes do fim do trial');
          }
        } else if (
          paid.length !== 1 ||
          paid[0]?.total_amount !== (receipt.priceCents / 100).toFixed(2) ||
          !paid[0].asaas_payment_id
        ) {
          throw new Error('invoice paga ausente, duplicada ou com valor divergente');
        }
        paymentId = paid[0]?.asaas_payment_id ?? '';
        const draft = await sql<{ count: number }[]>`
          select count(*)::int as count from public.signup_sessions
           where token_hash = ${receipt.tokenHash}
        `;
        if (draft[0]?.count !== 0) throw new Error('draft não foi consumido uma única vez');
      } finally {
        await sql.end({ timeout: 5 });
      }

      const providerBase = new URL(asaasBaseUrl!);
      if (!['sandbox.asaas.com', 'api-sandbox.asaas.com'].includes(providerBase.hostname)) {
        throw new Error('readback de assinatura recusou ambiente fora do Sandbox');
      }
      const providerResponse = await fetch(
        `${asaasBaseUrl!.replace(/\/$/u, '')}/subscriptions/${encodeURIComponent(subscriptionId)}`,
        { headers: { access_token: asaasApiKey! }, signal: AbortSignal.timeout(20_000) },
      );
      if (!providerResponse.ok) throw new Error(`Asaas respondeu ${providerResponse.status}`);
      const provider = (await providerResponse.json()) as {
        status?: string;
        value?: number;
        billingType?: string;
        cycle?: string;
        nextDueDate?: string;
      };
      const firstDueDate = new Date(Date.parse(receipt.trialEndsAt) + 86_400_000)
        .toISOString()
        .slice(0, 10);
      if (
        provider.status !== 'ACTIVE' ||
        Math.round((provider.value ?? -1) * 100) !== receipt.priceCents ||
        provider.billingType !== 'CREDIT_CARD' ||
        provider.cycle !== (billingCycle === 'annual' ? 'YEARLY' : 'MONTHLY')
      ) {
        throw new Error('assinatura do Asaas diverge do plano pago no Qoro');
      }
      if (freshTrial) {
        if (provider.nextDueDate !== firstDueDate) {
          const paymentsUrl = new URL(`${asaasBaseUrl!.replace(/\/$/u, '')}/payments`);
          paymentsUrl.searchParams.set('subscription', subscriptionId);
          paymentsUrl.searchParams.set('limit', '100');
          const pendingResponse = await fetch(paymentsUrl, {
            headers: { access_token: asaasApiKey! },
            signal: AbortSignal.timeout(20_000),
          });
          if (!pendingResponse.ok) {
            throw new Error(`readback da primeira parcela respondeu ${pendingResponse.status}`);
          }
          const pendingBody = (await pendingResponse.json()) as {
            data?: Array<{ dueDate?: string; status?: string; value?: number }>;
          };
          const matching = pendingBody.data?.filter(
            (payment) =>
              payment.dueDate === firstDueDate &&
              payment.status === 'PENDING' &&
              Math.round((payment.value ?? -1) * 100) === receipt.priceCents,
          );
          if (matching?.length !== 1) {
            throw new Error('primeira parcela futura do trial não corresponde ao contrato');
          }
        }
        console.log(`PASS: ${planCode} criado com trial vigente, limites e Asaas conciliados`);
        return;
      }
      const paymentResponse = await fetch(
        `${asaasBaseUrl!.replace(/\/$/u, '')}/payments/${encodeURIComponent(paymentId)}`,
        { headers: { access_token: asaasApiKey! }, signal: AbortSignal.timeout(20_000) },
      );
      if (!paymentResponse.ok)
        throw new Error(`cobrança no Asaas respondeu ${paymentResponse.status}`);
      const payment = (await paymentResponse.json()) as {
        status?: string;
        value?: number;
        subscription?: string;
        checkoutSession?: string;
      };
      if (
        !['CONFIRMED', 'RECEIVED'].includes(payment.status ?? '') ||
        payment.subscription !== subscriptionId ||
        payment.checkoutSession !== receipt.checkoutId ||
        Math.round((payment.value ?? -1) * 100) !== receipt.priceCents
      ) {
        throw new Error('pagamento no Asaas não corresponde à invoice paga no Qoro');
      }
      console.log(`PASS: ${planCode} pago e provisionado, invoice e Asaas conciliados`);
    } finally {
      await context.close();
    }
  });

  test('cadastro expirado retoma a mesma conta após login, sem criar novo usuário', async ({
    browser,
  }) => {
    const reason = skipReason();
    test.skip(!writeEnabled, 'E2E_SIGNUP_WRITE != 1');
    if (reason) throw new Error(`guard recusou a escrita: ${reason}`);
    test.setTimeout(180_000);

    const email = `expired+qoro-${Date.now()}-${randomBytes(4).toString('hex')}@resend.dev`;
    const password = `QoroE2e7${randomBytes(12).toString('base64url')}`;
    const expiredRef = randomBytes(32).toString('hex');
    const fixture: Fixture = { projectRef: expectedProjectRef, email };
    let context: BrowserContext | null = null;
    await saveFixture(fixture);
    try {
      const created = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          apikey: supabaseSecret!,
          Authorization: `Bearer ${supabaseSecret!}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email, password, email_confirm: true }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!created.ok) throw new Error(`Auth DEV não criou a fixture (${created.status})`);
      const user = (await created.json()) as AuthUser;
      if (!user.id || user.email?.toLowerCase() !== email) {
        throw new Error('Auth DEV criou identidade divergente');
      }
      const marked = await fetch(`${supabaseUrl}/auth/v1/admin/users/${user.id}`, {
        method: 'PUT',
        headers: {
          apikey: supabaseSecret!,
          Authorization: `Bearer ${supabaseSecret!}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          app_metadata: {
            qoro_self_service_signup: {
              version: 1,
              kind: 'self_service',
              signup_ref: expiredRef,
              password_state: 'set',
            },
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!marked.ok) throw new Error(`Auth DEV não gravou o marker (${marked.status})`);
      const ready = await findUser(email);
      if (ready?.id !== user.id || !ready.email_confirmed_at) {
        throw new Error('fixture não tem conta confirmada');
      }
      const initialBinding = selfServiceBinding(ready);
      if (initialBinding?.signupRef !== expiredRef || initialBinding.state !== 'set') {
        throw new Error('fixture não reproduziu o marker órfão');
      }

      context = await browser.newContext({
        baseURL: baseUrl!,
        storageState: { cookies: [], origins: [] },
      });
      await installVercelBypassForOrigin(context, new URL(baseUrl!).origin);
      const page = await context.newPage();
      await page.goto('/login');
      await page.locator('#email').fill(email);
      await page.getByLabel('Senha', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Entrar', exact: true }).click();
      await expect(page).toHaveURL(/\/cadastro\/continuar$/u, { timeout: 60_000 });
      await expect(page.getByText(/Não encontramos um cadastro em andamento/u)).toBeVisible();

      await page.getByLabel('Seu nome').fill('Ana Expirada');
      await page.getByLabel('Nome da clínica').fill('Clínica Retomada E2E');
      await page.getByLabel('Profissionais').selectOption('2_5');
      await page.getByLabel('Atendimentos por semana').selectOption('21_50');
      await page.getByLabel('Organização atual').selectOption('outro_sistema');
      await page.getByLabel('Como conheceu a Qoro').selectOption('indicacao_colega');
      await page.getByRole('checkbox').click();
      await page.getByRole('button', { name: 'Confirmar e continuar' }).click();
      await expect(page.getByText('Cadastro recuperado na conta verificada')).toBeVisible({
        timeout: 60_000,
      });

      const rebound = await findUser(email);
      const binding = selfServiceBinding(rebound);
      if (rebound?.id !== user.id || !binding || binding.signupRef === expiredRef) {
        throw new Error('Auth não reatou o mesmo usuário ao novo draft');
      }
      const sql = postgres(databaseUrl!, { max: 1, ssl: 'require', prepare: false });
      try {
        const rows = await sql<
          {
            token_hash: string;
            auth_attempt_state: string | null;
            billing_attempt_state: string | null;
          }[]
        >`
          select token_hash, auth_attempt_state, billing_attempt_state
            from signup_sessions
           where auth_user_id = ${user.id}
        `;
        if (
          rows.length !== 1 ||
          rows[0]?.token_hash !== binding.signupRef ||
          rows[0]?.auth_attempt_state !== null ||
          rows[0]?.billing_attempt_state !== null
        ) {
          throw new Error('draft recriado não corresponde ao Auth ou iniciou cobrança');
        }
      } finally {
        await sql.end({ timeout: 5 });
      }

      await page.reload();
      await expect(page.getByText('Cadastro recuperado na conta verificada')).toBeVisible();
      await page.getByRole('link', { name: 'Escolher plano' }).click();
      await expect(page).toHaveURL(/\/cadastro\/plano$/u);
      await expect(page.getByRole('heading', { name: 'Escolha seu plano' })).toBeVisible();
    } finally {
      try {
        await context?.close();
      } finally {
        await cleanupFixture(fixture);
      }
    }
  });

  test('conta legada não confirmada recebe o fluxo novo sem mutação antes do OTP', async ({
    browser,
  }) => {
    const reason = skipReason();
    test.skip(!writeEnabled, 'E2E_SIGNUP_WRITE != 1');
    if (reason) throw new Error(`guard recusou a escrita: ${reason}`);
    test.setTimeout(420_000);

    const email = `delivered+qoro-legacy-${Date.now()}-${randomBytes(4).toString('hex')}@resend.dev`;
    const legacyPassword = `LegacyE2e7${randomBytes(12).toString('base64url')}`;
    let desktop: BrowserContext | null = null;
    let phone: BrowserContext | null = null;
    let fixture: Fixture = { projectRef: expectedProjectRef!, email };
    try {
      await saveFixture(fixture);
      const legacy = await createLegacyUnconfirmedUser(email, legacyPassword);
      if (legacy.email_confirmed_at || hasSelfServiceMarker(legacy)) {
        throw new Error('fixture legada não nasceu markerless e não confirmada');
      }

      const signup = await startSignup(browser, email);
      desktop = signup.context;
      fixture = signup.fixture;
      if (!fixture.tokenHash) throw new Error('fixture legada sem hash do draft');
      if (signup.password === legacyPassword) throw new Error('as senhas sintéticas coincidiram');

      const message = await waitForMessage({
        email,
        subject: INITIAL_SUBJECT,
        after: signup.startedAt,
      });
      const beforeOtp = await findUser(email);
      if (
        !beforeOtp ||
        beforeOtp.id !== legacy.id ||
        beforeOtp.email_confirmed_at ||
        hasSelfServiceMarker(beforeOtp)
      ) {
        throw new Error('rota anônima alterou a conta legada antes da prova do e-mail');
      }
      const proof = confirmationProof(message, fixture.tokenHash);
      await assertScannerGetDoesNotConsume(signup.context, proof, fixture);
      const phoneSession = await openOnPhone(browser, proof.url);
      phone = phoneSession.context;

      const afterOtp = await findUser(email);
      const pendingBinding = selfServiceBinding(afterOtp);
      if (
        !afterOtp?.email_confirmed_at ||
        afterOtp.id !== legacy.id ||
        pendingBinding?.signupRef !== fixture.tokenHash ||
        pendingBinding.state !== 'pending'
      ) {
        throw new Error('callback não vinculou a conta legada ao draft confirmado');
      }
      if (await passwordSignInSucceeds(email, signup.password)) {
        throw new Error('a senha nova funcionou antes do handoff explícito');
      }
      if (!(await passwordSignInSucceeds(email, legacyPassword))) {
        throw new Error('o callback sobrescreveu a senha legada antes do handoff');
      }

      await waitForOriginalHandoff(signup.page);
      await completeHandoffAfterRefresh(signup.page, {
        email,
        password: signup.password,
        verificationCode: proof.verificationCode,
        tokenHash: fixture.tokenHash,
      });
      if (!(await passwordSignInSucceeds(email, signup.password))) {
        throw new Error('senha da conta legada não autenticou depois do handoff');
      }
      const completedUser = await findUser(email);
      const ready = selfServiceBinding(completedUser);
      if (
        completedUser?.id !== legacy.id ||
        ready?.signupRef !== fixture.tokenHash ||
        ready.state !== 'set'
      ) {
        throw new Error('conta legada não terminou com vínculo ready do draft');
      }
      if (await passwordSignInSucceeds(email, legacyPassword)) {
        throw new Error('a senha legada continuou válida depois da troca explícita');
      }
      await assertDraftStatuses({ [fixture.tokenHash]: 'email_verified' });
    } finally {
      await Promise.allSettled([phone?.close(), desktop?.close()]);
      await cleanupFixture(fixture);
    }
  });

  test('o código do link vivo recupera o segundo draft sem rotacionar a mensagem', async ({
    browser,
  }) => {
    const reason = skipReason();
    test.skip(!writeEnabled, 'E2E_SIGNUP_WRITE != 1');
    if (reason) throw new Error(`guard recusou a escrita: ${reason}`);
    test.setTimeout(420_000);

    const email = `delivered+qoro-bound-${Date.now()}-${randomBytes(4).toString('hex')}@resend.dev`;
    let firstDesktop: BrowserContext | null = null;
    let secondDesktop: BrowserContext | null = null;
    let phone: BrowserContext | null = null;
    let fixture: Fixture = { projectRef: expectedProjectRef!, email };
    try {
      const first = await startSignup(browser, email);
      firstDesktop = first.context;
      fixture = first.fixture;
      if (!fixture.tokenHash) throw new Error('primeiro draft sem hash');
      const firstRef = fixture.tokenHash;
      const firstMessage = await waitForMessage({
        email,
        subject: INITIAL_SUBJECT,
        after: first.startedAt,
      });

      const second = await startSignup(browser, email, [firstRef]);
      secondDesktop = second.context;
      fixture = second.fixture;
      if (!second.fixture.tokenHash) throw new Error('segundo draft sem hash');
      const secondRef = second.fixture.tokenHash;
      if (secondRef === firstRef || second.password === first.password)
        throw new Error('as sessões não são independentes');

      await assertNoMessage({
        email,
        subject: INITIAL_SUBJECT,
        after: second.startedAt,
        excludeIds: new Set([firstMessage.id]),
      });
      const firstProof = confirmationProof(firstMessage, firstRef);
      await assertExactDraftReferences(email, [firstRef, secondRef]);

      const beforeClick = selfServiceBinding(await findUser(email));
      if (beforeClick?.signupRef !== firstRef || beforeClick.state !== 'pending') {
        throw new Error('o segundo draft alterou o marker Auth antes da prova do e-mail');
      }

      const phoneSession = await openOnPhone(browser, firstProof.url);
      phone = phoneSession.context;

      await waitForOriginalHandoff(first.page);
      await waitForOriginalHandoff(second.page);
      const secondState = await second.page.evaluate(async () => {
        const response = await fetch('/api/signup/sessions/me', { cache: 'no-store' });
        const body = (await response.json()) as {
          session?: { status?: unknown; rowVersion?: unknown };
        };
        return {
          httpStatus: response.status,
          signupStatus: body.session?.status,
          rowVersion: body.session?.rowVersion,
        };
      });
      if (
        secondState.httpStatus !== 200 ||
        secondState.signupStatus !== 'email_verified' ||
        typeof secondState.rowVersion !== 'number'
      ) {
        throw new Error('o segundo draft não reconheceu a prova do dono do e-mail');
      }
      await expect(second.page).toHaveURL(/\/cadastro$/u);
      await expect(second.page.getByRole('heading', { name: 'E-mail confirmado' })).toBeVisible();

      if (await passwordSignInSucceeds(email, first.password)) {
        throw new Error('a senha do primeiro draft funcionou antes do handoff');
      }
      if (await passwordSignInSucceeds(email, second.password)) {
        throw new Error('a senha do segundo draft funcionou antes do handoff');
      }

      // O segundo draft não recebeu nem rotacionou mensagem. O código que só o
      // dono do e-mail conhece transfere o ownership para os dados preenchidos
      // nessa sessão; conhecer apenas o endereço continua insuficiente.
      await second.page.getByLabel('Crie sua senha').fill(second.password);
      await second.page.getByLabel('Código do e-mail').fill(firstProof.verificationCode);
      await second.page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await expect(second.page).toHaveURL(/\/cadastro\/plano$/u, { timeout: 120_000 });
      if (!(await passwordSignInSucceeds(email, second.password))) {
        throw new Error('a senha escolhida pelo dono do e-mail não autenticou após a adoção');
      }
      if (await passwordSignInSucceeds(email, first.password)) {
        throw new Error('a senha do draft pré-registrado foi instalada');
      }
      await assertExactDraftReferences(email, [secondRef]);
      await assertDraftStatuses({ [secondRef]: 'email_verified' });
    } finally {
      await Promise.allSettled([phone?.close(), secondDesktop?.close(), firstDesktop?.close()]);
      await cleanupFixture(fixture);
    }
  });

  test('reenvio entrega um link novo, invalida o anterior e mantém a troca entre aparelhos', async ({
    browser,
  }) => {
    const reason = skipReason();
    test.skip(!writeEnabled, 'E2E_SIGNUP_WRITE != 1');
    if (reason) throw new Error(`guard recusou a escrita: ${reason}`);
    test.setTimeout(420_000);

    const email = `delivered+qoro-resend-${Date.now()}-${randomBytes(4).toString('hex')}@resend.dev`;
    let desktop: BrowserContext | null = null;
    let oldPhone: BrowserContext | null = null;
    let phone: BrowserContext | null = null;
    let fixture: Fixture = { projectRef: expectedProjectRef!, email };
    try {
      const signup = await startSignup(browser, email);
      desktop = signup.context;
      fixture = signup.fixture;
      const initial = await waitForMessage({
        email,
        subject: INITIAL_SUBJECT,
        after: signup.startedAt,
      });
      if (!fixture.tokenHash) throw new Error('fixture sem hash do draft');
      const oldProof = confirmationProof(initial, fixture.tokenHash);

      await signup.page.waitForTimeout(61_000);
      const resentAt = Date.now();
      const resendRequestPromise = signup.page.waitForRequest(
        (request) =>
          request.method() === 'POST' &&
          new URL(request.url()).pathname === '/api/signup/sessions/resend',
      );
      await signup.page.getByRole('button', { name: 'Reenviar o e-mail' }).click();
      const resendRequest = await resendRequestPromise;
      const resendBody = resendRequest.postDataJSON() as Record<string, unknown>;
      const resendKeys = Object.keys(resendBody).sort();
      if (
        resendKeys.length !== 2 ||
        resendKeys[0] !== 'email' ||
        resendKeys[1] !== 'rowVersion' ||
        resendBody.email !== email ||
        typeof resendBody.rowVersion !== 'number'
      ) {
        throw new Error('o reenvio enviou dados além de rowVersion e e-mail');
      }
      await expect(signup.page.getByText(/novo e-mail está a caminho/u)).toBeVisible({
        timeout: 90_000,
      });
      const latest = await waitForMessage({
        email,
        subject: RESEND_SUBJECT,
        after: resentAt,
        excludeIds: new Set([initial.id]),
      });
      const newProof = confirmationProof(latest, fixture.tokenHash);
      if (newProof.url === oldProof.url) throw new Error('link reenviado não mudou');
      if (newProof.verificationCode === oldProof.verificationCode) {
        throw new Error('código reenviado não mudou');
      }

      oldPhone = await browser.newContext({
        ...devices['iPhone 13'],
        baseURL: baseUrl!,
        storageState: { cookies: [], origins: [] },
      });
      await installVercelBypassForOrigin(oldPhone, new URL(baseUrl!).origin);
      const expired = await oldPhone.newPage();
      try {
        await expired.goto(oldProof.url);
      } catch {
        throw new Error('navegação do link anterior falhou');
      }
      try {
        await expired.waitForURL(
          (url) =>
            url.pathname === '/auth/auth-error' &&
            ['invalid_token', 'expired'].includes(url.searchParams.get('reason') ?? ''),
          { timeout: 90_000 },
        );
      } catch {
        throw new Error('link anterior não foi recusado de forma sanitizada');
      }

      const phoneSession = await openOnPhone(browser, newProof.url);
      phone = phoneSession.context;
      await waitForOriginalHandoff(signup.page);
      if (await passwordSignInSucceeds(email, signup.password)) {
        throw new Error('a senha funcionou antes do código mais recente');
      }

      await signup.page.getByLabel('Crie sua senha').fill(signup.password);
      await signup.page.getByLabel('Código do e-mail').fill(oldProof.verificationCode);
      await signup.page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await expect(signup.page).toHaveURL(/\/cadastro$/u);
      await expect(signup.page.getByText(/Não foi possível validar o código/u)).toBeVisible({
        timeout: 30_000,
      });

      await signup.page.getByLabel('Código do e-mail').fill(newProof.verificationCode);
      await signup.page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await expect(signup.page).toHaveURL(/\/cadastro\/plano$/u, { timeout: 120_000 });
      await expect(signup.page.getByRole('heading', { name: 'Escolha seu plano' })).toBeVisible();
      if (!(await passwordSignInSucceeds(email, signup.password))) {
        throw new Error('a senha não autenticou depois do código mais recente');
      }
    } finally {
      await Promise.allSettled([phone?.close(), oldPhone?.close(), desktop?.close()]);
      await cleanupFixture(fixture);
    }
  });
});
