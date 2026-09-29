import { createHmac, randomBytes } from 'node:crypto';
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

import {
  SIGNUP_E2E_DEV_PROJECT_REF,
  SIGNUP_E2E_ENV_ALIASES,
} from '../scripts/run-signup-confirmation-e2e';
import { vercelBypassHeaders } from './vercel-bypass';

test.use({
  storageState: { cookies: [], origins: [] },
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
const expectedProjectRef = SIGNUP_E2E_DEV_PROJECT_REF;
const productionDatabaseUrl = firstEnv('DATABASE_URL_PROD');
const productionSupabaseSecret = firstEnv(
  'SUPABASE_SECRET_KEY_PROD',
  'SUPABASE_SERVICE_ROLE_KEY_PROD',
);

const FIXTURE_PATH = path.join(process.cwd(), '.playwright', 'signup-confirmation-fixture.json');
const LOCK_PATH = path.join(process.cwd(), '.playwright', 'signup-confirmation.lock');
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
    !loginHashPepper
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

async function admin(apiPath: string, init: { method?: 'GET' | 'DELETE' } = {}): Promise<Response> {
  return fetch(`${supabaseUrl}/auth/v1${apiPath}`, {
    method: init.method ?? 'GET',
    headers: {
      apikey: supabaseSecret!,
      Authorization: `Bearer ${supabaseSecret!}`,
    },
    signal: AbortSignal.timeout(15_000),
  });
}

async function createLegacyUnconfirmedUser(email: string, password: string): Promise<AuthUser> {
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
  if (!response.ok) throw new Error('Supabase Admin não criou a conta legada sintética');
  const user = (await response.json()) as AuthUser;
  if (!user.id || user.email?.toLowerCase() !== email.toLowerCase()) {
    throw new Error('Supabase Admin devolveu identidade divergente para a conta legada');
  }
  return user;
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

async function cleanupFixture(fixture: Fixture): Promise<void> {
  if (fixture.projectRef !== expectedProjectRef) {
    throw new Error('fixture anterior pertence a outro projeto; limpeza recusada');
  }

  const sql = postgres(databaseUrl!, { max: 1, ssl: 'require', prepare: false });
  try {
    const mailHash = emailHash(fixture.email);
    const tokenHashes = [fixture.tokenHash, ...(fixture.tokenHashes ?? [])].filter(
      (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index,
    );
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
  } finally {
    await sql.end({ timeout: 5 });
  }

  const user = await findUser(fixture.email);
  if (user) {
    const deleted = await admin(`/admin/users/${user.id}`, { method: 'DELETE' });
    if (!deleted.ok) throw new Error('cleanup do usuário Auth falhou');
  }
  if (await findUser(fixture.email)) throw new Error('usuário Auth persistiu após cleanup');
  await rm(FIXTURE_PATH, { force: true });
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

async function rememberCookie(context: BrowserContext, fixture: Fixture): Promise<void> {
  // Em `next dev` a primeira compilação de /sessions e a ida real ao Postgres
  // podem ultrapassar 30 s. Esperar o cookie é também o que torna o cleanup
  // exato: sem ele teríamos apenas uma sessão anônima recém-criada, sem PII nem
  // identificador seguro para apagar.
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const cookies = await context.cookies(baseUrl);
    const cookie = cookies.find((item) => item.name === '__Host-qoro_signup');
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
      ? /digite este código:\s*\r?\n(\d{8})(?!\d)/giu
      : /digite este código:[\s\S]{0,1000}?>(\d{8})<\/div>/giu;
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

  const response = await context.request.get(proof.url, { maxRedirects: 0 });
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
  const invalidCredential =
    response.status === 400 &&
    (code === 'invalid_credentials' ||
      code === 'invalid_grant' ||
      (typeof message === 'string' && /invalid login credentials/iu.test(message)));
  if (invalidCredential) return false;
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
): Promise<SignupRun> {
  const context = await browser.newContext({
    baseURL: baseUrl!,
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: vercelBypassHeaders(),
  });
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
    await page.getByLabel('Senha', { exact: true }).fill(password);
    await expect(page.getByLabel('Senha', { exact: true })).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Mostrar senha' }).click();
    await expect(page.getByLabel('Senha', { exact: true })).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Ocultar senha' }).click();
    await page.getByRole('checkbox').click();
    const startedAt = Date.now();
    await page.getByRole('button', { name: 'Criar conta e continuar' }).click();
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
    extraHTTPHeaders: vercelBypassHeaders(),
  });
  const page = await context.newPage();
  const expectedToken = new URLSearchParams(new URL(rawUrl).hash.slice(1)).get('token_hash');
  if (!expectedToken) throw new Error('callback do telefone sem token no fragmento');
  let bridgeGets = 0;
  let bridgePosts = 0;
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
  } catch {
    const observed = new URL(page.url());
    const searchKeys = [...new Set(observed.searchParams.keys())].sort().join(',') || 'none';
    throw new Error(
      `callback não terminou na confirmação sanitizada (path=${observed.pathname}; searchKeys=${searchKeys}; fragment=${observed.hash ? 'present' : 'absent'})`,
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
  // O Next injeta um botão próprio de Dev Tools fora do app em `next dev`.
  // A asserção de produto precisa olhar somente a tela entregue pelo Qoro.
  await expect(
    page.locator('main input, main select, main textarea, main a, main button'),
  ).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);

  const checkoutStatus = await page.evaluate(async () => {
    const response = await fetch('/api/signup/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cpfCnpj: '24971563792' }),
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
  await expect(page.getByLabel('Crie sua senha')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Escolha seu plano' })).toHaveCount(0);
}

async function completeHandoffAfterRefresh(
  page: Page,
  input: { email: string; password: string; verificationCode: string },
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
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
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
    if (stale) await cleanupFixture(stale);
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
      });
      if (!(await passwordSignInSucceeds(email, signup.password))) {
        throw new Error('a senha instalada pelo handoff não autenticou');
      }
    } finally {
      await Promise.allSettled([phone?.close(), desktop?.close()]);
      await cleanupFixture(fixture);
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
        extraHTTPHeaders: vercelBypassHeaders(),
      });
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
