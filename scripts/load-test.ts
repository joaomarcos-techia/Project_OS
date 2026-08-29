/**
 * P8 load gate. Real application code, disposable local infrastructure only.
 *
 * Safety contract:
 * - the caller must set LOAD_TEST_CONFIRM=LOCAL_SCRATCH_ONLY;
 * - DEV is used only for `pg_dump --schema-only`;
 * - all traffic and writes target a TLS PostgreSQL cluster created under OS temp;
 * - Meta is replaced before network I/O and every other external HTTP call fails closed;
 * - the Next process receives a clean allowlisted environment with synthetic secrets.
 */
import './_env';

import autocannon, { type Options as AutocannonOptions, type Result } from 'autocannon';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

import postgres, { type Sql } from 'postgres';
import { generate as generateCertificate } from 'selfsigned';

import {
  assertEphemeralScratchTarget,
  assertEphemeralTempDirectory,
  assertLoadTestConfirmation,
  assertSafeSchemaSource,
  LOAD_TEST_GUARD_CONSTANTS,
} from './load-test-guards';

const ROOT = process.cwd();
const POSTGRES_BIN_FALLBACK = 'C:\\Program Files\\PostgreSQL\\17\\bin';
const APPOINTMENT_COUNT = 500;
const WEBHOOK_COUNT = 1_000;
const PROACTIVE_JOB_COUNT = 5_000;
const OUTBOX_COUNT = 5_000;
const HTTP_P95_SLO_MS = 500;
const HTTP_P99_SLO_MS = 1_000;
const WEBHOOK_P99_SLO_MS = 2_000;
const JOB_BATCH_P99_SLO_MS = 30_000;
const QUERY_P99_SLO_MS = 100;

interface SeedResult {
  clinicId: string;
  patientId: string;
  doctorId: string;
  procedureId: string;
  appointments: number;
}

interface ProactiveRunnerResult {
  sent: number;
  cancelled: number;
  retried: number;
  failed: number;
  batches: number;
  replayScanned: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

interface LoadResult {
  title: string;
  sent: number;
  responses2xx: number;
  errors: number;
  non2xx: number;
  mismatches: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

interface PhaseEvidence {
  appointments: { scanned: number; enqueued: number; firstBatchSent: number; durationMs: number };
  proactive: ProactiveRunnerResult & { providerCalls: number; outbound: number };
  webhook: LoadResult & { quarantined: number };
  outbox: LoadResult & { skipped: number; attemptsMin: number; attemptsMax: number };
  reconcile: LoadResult;
  query: { samples: number; p95Ms: number; p99Ms: number; maxMs: number };
  deadlocks: number;
  cleanup?: { postgresStopped: boolean; tempRemoved: boolean };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)]!;
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function findPostgresBinary(name: string): string {
  const extension = process.platform === 'win32' ? '.exe' : '';
  const fallback = join(POSTGRES_BIN_FALLBACK, `${name}${extension}`);
  if (existsSync(fallback)) return fallback;
  const lookup = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], {
    encoding: 'utf8',
  });
  const first = lookup.stdout?.split(/\r?\n/u).find(Boolean);
  if (lookup.status !== 0 || !first) throw new Error(`[load] ${name} não encontrado.`);
  return first.trim();
}

function runChecked(
  executable: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; cwd?: string; maxBuffer?: number } = {},
): void {
  const result = spawnSync(executable, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || 'sem detalhe').slice(
      -8_000,
    );
    throw new Error(`[load] comando ${basename(executable)} falhou (${result.status}):\n${detail}`);
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('[load] não foi possível reservar uma porta local.'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });
}

function pgConnectionArgs(url: URL): string[] {
  return [
    '--host',
    url.hostname,
    '--port',
    url.port || '5432',
    '--username',
    decodeURIComponent(url.username),
    '--dbname',
    decodeURIComponent(url.pathname.replace(/^\//u, '')),
  ];
}

function pgPasswordEnv(url: URL): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PGSSLMODE: 'require',
    PGPASSWORD: decodeURIComponent(url.password),
  };
}

function dynamicSendTimezone(now = new Date()): string {
  const candidates = [
    'Pacific/Honolulu',
    'America/Anchorage',
    'America/Los_Angeles',
    'America/Denver',
    'America/Chicago',
    'America/New_York',
    'America/Sao_Paulo',
    'Atlantic/South_Georgia',
    'Atlantic/Azores',
    'UTC',
    'Europe/London',
    'Europe/Berlin',
    'Europe/Helsinki',
    'Asia/Dubai',
    'Asia/Karachi',
    'Asia/Dhaka',
    'Asia/Bangkok',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Australia/Brisbane',
    'Pacific/Noumea',
    'Pacific/Auckland',
    'Pacific/Kiritimati',
  ];
  for (const timezone of candidates) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    if (hour === 18) return timezone;
  }
  throw new Error('[load] nenhuma timezone de teste colocou o worker na janela das 18h.');
}

function cleanRuntimeEnv(input: {
  databaseUrl: string;
  appPort?: number;
  metaLog: string;
  metaAppSecret: string;
  cronSecret: string;
  cryptoKey: string;
  lookupSalt: string;
  sourceMarker: string;
  timezone: string;
  extra?: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
  for (const key of [
    'PATH',
    'Path',
    'PATHEXT',
    'SystemRoot',
    'SYSTEMROOT',
    'ComSpec',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'LOCALAPPDATA',
    'APPDATA',
  ]) {
    if (process.env[key]) env[key] = process.env[key];
  }

  Object.assign(env, {
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    VERCEL_ENV: 'development',
    SUPABASE_PROJECT_ENV: 'dev',
    DATABASE_URL: input.databaseUrl,
    DATABASE_URL_RUNTIME: input.databaseUrl,
    NEXT_PUBLIC_SUPABASE_URL: 'https://load-scratch.invalid',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'load-scratch-publishable',
    SUPABASE_SECRET_KEY: 'load-scratch-secret',
    APP_BASE_URL: `http://127.0.0.1:${input.appPort ?? 1}`,
    CRON_SECRET: input.cronSecret,
    OUTBOX_CRON_ALLOW_NON_VERCEL: 'true',
    OUTBOX_BATCH_SIZE: '500',
    OUTBOX_PARALLELISM: '20',
    CRYPTO_SECRET_BACKEND: 'env',
    CRYPTO_MASTER_KEY_V1: input.cryptoKey,
    CRYPTO_LOOKUP_SALT: input.lookupSalt,
    MASTER_KEY_VERSION: '1',
    META_APP_SECRET: input.metaAppSecret,
    META_WEBHOOK_VERIFY_TOKEN: 'load-scratch-verify-token',
    META_TEMPLATE_CONFIRMATION_REMINDER_ID: 'load_confirmation_reminder',
    META_TEMPLATE_DUNNING_FRIENDLY_ID: 'load_dunning',
    META_TEMPLATE_FOLLOWUP_RETURN_ID: 'load_followup',
    META_TEMPLATE_WAITLIST_OFFER_ID: 'load_waitlist',
    META_TEMPLATE_DEPOSIT_LINK_ID: 'load_deposit',
    META_TEMPLATE_REMAINDER_LINK_ID: 'load_remainder',
    META_TEMPLATE_LANG: 'pt_BR',
    META_HTTP_TIMEOUT_MS: '5000',
    ASAAS_API_KEY: 'load-scratch-disabled',
    ASAAS_BASE_URL: 'http://127.0.0.1:1',
    ASAAS_WEBHOOK_TOKEN: 'load-scratch-disabled',
    SENTRY_DSN: '',
    NEXT_PUBLIC_SENTRY_DSN: '',
    LOG_LEVEL: 'error',
    LOAD_TEST_CONFIRM: LOAD_TEST_GUARD_CONSTANTS.confirmation,
    LOAD_TEST_META_STUB: LOAD_TEST_GUARD_CONSTANTS.confirmation,
    LOAD_TEST_META_LOG: input.metaLog,
    LOAD_TEST_SCHEMA_SOURCE: input.sourceMarker,
    LOAD_TEST_CLINIC_TIMEZONE: input.timezone,
    ...input.extra,
  });
  return env;
}

async function runChild(
  args: string[],
  env: NodeJS.ProcessEnv,
  label: string,
  timeoutMs = 120_000,
): Promise<void> {
  await new Promise<void>((resolveChild, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + String(chunk)).slice(-16_000);
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`[load] ${label} excedeu ${timeoutMs}ms.`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolveChild();
      else reject(new Error(`[load] ${label} falhou (${code}):\n${stderr}`));
    });
  });
}

async function waitForApp(baseUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('[load] Next encerrou antes de ficar pronto.');
    try {
      const response = await fetch(`${baseUrl}/api/cron/outbox`, {
        headers: { authorization: 'Bearer intentionally-wrong' },
      });
      if (response.status === 401) return;
    } catch {
      // O processo ainda está iniciando.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error('[load] Next não ficou pronto em 45s.');
}

async function stopChild(child: ChildProcess | undefined): Promise<boolean> {
  if (!child || child.exitCode !== null) return true;
  child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise<boolean>((resolveExit) => child.once('exit', () => resolveExit(true))),
    new Promise<boolean>((resolveExit) => setTimeout(() => resolveExit(false), 5_000)),
  ]);
  if (!exited) child.kill('SIGKILL');
  return exited || child.killed;
}

function countLines(path: string): number {
  if (!existsSync(path)) return 0;
  return readFileSync(path, 'utf8').split(/\r?\n/u).filter(Boolean).length;
}

async function runHttpLoad(options: AutocannonOptions): Promise<LoadResult> {
  const latencies: number[] = [];
  const result = await new Promise<Result>((resolveLoad, reject) => {
    const instance = autocannon(options, (error, summary) => {
      if (error) reject(error);
      else resolveLoad(summary);
    });
    instance.on('response', (_client, _statusCode, _bytes, responseTime) => {
      latencies.push(responseTime);
    });
    instance.on('error', reject);
  });
  return {
    title: options.title ?? 'load',
    sent: result.requests.sent,
    responses2xx: result['2xx'],
    errors: result.errors + result.timeouts,
    non2xx: result.non2xx,
    mismatches: result.mismatches,
    p95Ms: roundMs(percentile(latencies, 0.95)),
    p99Ms: roundMs(percentile(latencies, 0.99)),
    maxMs: roundMs(Math.max(0, ...latencies)),
  };
}

async function timedJson<T>(
  url: string,
  cronSecret: string,
): Promise<{ value: T; durationMs: number }> {
  const started = performance.now();
  const response = await fetch(url, { headers: { authorization: `Bearer ${cronSecret}` } });
  const durationMs = performance.now() - started;
  const body = (await response.json()) as T;
  if (!response.ok)
    throw new Error(`[load] ${new URL(url).pathname} respondeu ${response.status}.`);
  return { value: body, durationMs };
}

function metaWebhookBody(sequence: number): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'load-waba',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '+5511999999998',
                phone_number_id: 'load-orphan-phone',
              },
              messages: [
                {
                  from: '+5511888888888',
                  id: `wamid.webhook.${sequence}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: `payload sintético ${sequence}` },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

async function waitForCount(
  sql: Sql,
  query: () => Promise<number>,
  expected: number,
  label: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await query()) === expected) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  const actual = await query();
  throw new Error(`[load] ${label}: esperado ${expected}, observado ${actual}.`);
}

async function main(): Promise<void> {
  assertLoadTestConfirmation(process.env.LOAD_TEST_CONFIRM);
  const sourceUrlValue = process.env.DATABASE_URL_DEV;
  const sourceUrl = assertSafeSchemaSource({
    sourceUrl: sourceUrlValue,
    productionUrl: process.env.DATABASE_URL_PROD,
    projectEnv: process.env.SUPABASE_PROJECT_ENV,
  });

  assert(
    existsSync(resolve(ROOT, '.next', 'BUILD_ID')),
    '[load] rode `pnpm build` antes de test:load.',
  );

  const initdb = findPostgresBinary('initdb');
  const pgCtl = findPostgresBinary('pg_ctl');
  const pgDump = findPostgresBinary('pg_dump');
  const psql = findPostgresBinary('psql');
  const tempRoot = mkdtempSync(join(tmpdir(), 'clinicaos-load-'));
  const dataDir = join(tempRoot, 'pgdata');
  const schemaPath = join(tempRoot, 'schema.sql');
  const bootstrapPath = join(tempRoot, 'bootstrap.sql');
  const finalizePath = join(tempRoot, 'finalize.sql');
  const seedResultPath = join(tempRoot, 'seed.json');
  const proactiveResultPath = join(tempRoot, 'proactive.json');
  const appMetaLog = join(tempRoot, 'meta-app.log');
  const workerMetaLog = join(tempRoot, 'meta-worker.log');
  const pgLog = join(tempRoot, 'postgres.log');
  const databaseName = `${LOAD_TEST_GUARD_CONSTANTS.scratchDatabasePrefix}${randomUUID().replaceAll('-', '')}`;
  const pgPort = await freePort();
  const appPort = await freePort();
  const databaseUrl = `postgresql://postgres@127.0.0.1:${pgPort}/${databaseName}?sslmode=require`;
  const adminUrl = `postgresql://postgres@127.0.0.1:${pgPort}/postgres?sslmode=require`;
  const sourceMarker = 'postgresql://schema-source.invalid/postgres?sslmode=require';
  assertEphemeralScratchTarget(databaseUrl, sourceUrlValue!);

  const timezone = dynamicSendTimezone();
  const cryptoKey = randomBytes(32).toString('base64');
  const lookupSalt = randomBytes(32).toString('base64');
  const metaAppSecret = randomBytes(32).toString('hex');
  const cronSecret = randomBytes(32).toString('base64url');
  const preloadUrl = pathToFileURL(resolve(ROOT, 'scripts', 'load-test-meta-preload.mjs')).href;
  let sql: Sql | undefined;
  let nextChild: ChildProcess | undefined;
  let postgresStarted = false;
  const evidence = {} as PhaseEvidence;

  try {
    process.stdout.write('[load] 1/8 extraindo somente o schema do DEV...\n');
    runChecked(
      pgDump,
      [
        ...pgConnectionArgs(sourceUrl),
        '--schema=public',
        '--schema-only',
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-privileges',
        '--file',
        schemaPath,
      ],
      { env: pgPasswordEnv(sourceUrl), maxBuffer: 32 * 1024 * 1024 },
    );
    // `pg_dump --schema=public` inclui constraints que usam as extensões, mas
    // não inclui o objeto EXTENSION. No DEV, btree_gist e pg_trgm vivem em
    // public; recriá-las logo após o próprio dump recriar o schema preserva a
    // mesma resolução de opclass/função e mantém ON_ERROR_STOP=1 no restore.
    const publicSchemaMarker = 'CREATE SCHEMA public;';
    const schemaDump = readFileSync(schemaPath, 'utf8');
    assert(
      schemaDump.includes(publicSchemaMarker),
      '[load] dump sem CREATE SCHEMA public; formato inesperado.',
    );
    writeFileSync(
      schemaPath,
      schemaDump.replace(
        publicSchemaMarker,
        `${publicSchemaMarker}\nCREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;\n` +
          'CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;',
      ),
      { encoding: 'utf8' },
    );

    process.stdout.write('[load] 2/8 iniciando PostgreSQL TLS descartável...\n');
    runChecked(initdb, [
      '-D',
      dataDir,
      '--username=postgres',
      '--auth=trust',
      '--encoding=UTF8',
      '--no-locale',
    ]);
    const pems = await generateCertificate([{ name: 'commonName', value: 'localhost' }], {
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
          ],
        },
      ],
    });
    writeFileSync(join(dataDir, 'server.crt'), pems.cert, { encoding: 'utf8' });
    writeFileSync(join(dataDir, 'server.key'), pems.private, { encoding: 'utf8' });
    if (process.platform !== 'win32') chmodSync(join(dataDir, 'server.key'), 0o600);
    appendFileSync(
      join(dataDir, 'postgresql.conf'),
      `\nlisten_addresses = '127.0.0.1'\nport = ${pgPort}\nssl = on\n` +
        `ssl_cert_file = '${join(dataDir, 'server.crt').replaceAll('\\', '/')}'\n` +
        `ssl_key_file = '${join(dataDir, 'server.key').replaceAll('\\', '/')}'\n` +
        'fsync = off\nsynchronous_commit = off\nfull_page_writes = off\nlog_min_messages = warning\n',
      { encoding: 'utf8' },
    );
    // Windows: o `postgres.exe` filho pode herdar os pipes de stdout/stderr do
    // `pg_ctl`. Com `spawnSync` capturando esses pipes, o Node espera EOF do
    // descendente mesmo depois de o pg_ctl já ter retornado. `inherit` evita o
    // handle pendurado; o servidor continua escrevendo no arquivo passado em -l.
    const pgStart = spawnSync(pgCtl, ['-D', dataDir, '-l', pgLog, '-w', 'start'], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    if (pgStart.status !== 0) {
      throw new Error(`[load] pg_ctl start falhou (${pgStart.status}).`);
    }
    postgresStarted = true;
    runChecked(psql, [adminUrl, '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${databaseName}`]);

    writeFileSync(
      bootstrapPath,
      `DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;\n` +
        `DO $$ BEGIN CREATE ROLE authenticated NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;\n` +
        `DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;\n` +
        `DO $$ BEGIN CREATE ROLE supabase_auth_admin NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;\n` +
        `DO $$ BEGIN CREATE ROLE supabase_realtime NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;\n` +
        `GRANT authenticated, service_role, anon TO postgres;\n` +
        `CREATE SCHEMA IF NOT EXISTS auth;\n` +
        `CREATE SCHEMA IF NOT EXISTS extensions;\n` +
        `CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;\n` +
        `CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\" WITH SCHEMA extensions;\n` +
        `CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);\n` +
        `CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;\n` +
        `CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim', true), '')::jsonb, '{}'::jsonb) $$;\n` +
        `CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;\n` +
        `GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;\n` +
        `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;\n`,
      { encoding: 'utf8' },
    );
    runChecked(psql, [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', bootstrapPath]);
    runChecked(psql, [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', schemaPath], {
      maxBuffer: 64 * 1024 * 1024,
    });
    writeFileSync(
      finalizePath,
      `GRANT USAGE ON SCHEMA public TO authenticated, service_role;\n` +
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;\n` +
        `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;\n` +
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;\n` +
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO authenticated, service_role;\n`,
      { encoding: 'utf8' },
    );
    runChecked(psql, [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', finalizePath]);

    const baseRuntime = cleanRuntimeEnv({
      databaseUrl,
      appPort,
      metaLog: appMetaLog,
      metaAppSecret,
      cronSecret,
      cryptoKey,
      lookupSalt,
      sourceMarker,
      timezone,
    });
    await runChild(
      [
        '--conditions=react-server',
        '--import=tsx',
        resolve(ROOT, 'scripts', 'load-test-seed-runner.ts'),
      ],
      { ...baseRuntime, LOAD_TEST_RESULT_PATH: seedResultPath },
      'seed sintético',
    );
    const seed = JSON.parse(readFileSync(seedResultPath, 'utf8')) as SeedResult;
    assert(
      seed.appointments === APPOINTMENT_COUNT,
      `[load] fixture criou ${seed.appointments}/500 consultas.`,
    );

    sql = postgres(databaseUrl, { ssl: 'require', max: 10, prepare: false });
    const deadlockRowsBefore = await sql<{ deadlocks: number }[]>`
      SELECT deadlocks::int AS deadlocks FROM pg_stat_database WHERE datname = current_database()
    `;
    const deadlocksBefore = deadlockRowsBefore[0]?.deadlocks ?? 0;

    process.stdout.write('[load] 3/8 iniciando a aplicação real no scratch...\n');
    const nextLogs: string[] = [];
    nextChild = spawn(
      process.execPath,
      [
        resolve(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'),
        'start',
        '-p',
        String(appPort),
      ],
      {
        cwd: ROOT,
        env: { ...baseRuntime, NODE_OPTIONS: `--import=${preloadUrl}` },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const retainLog = (chunk: unknown) => {
      nextLogs.push(String(chunk));
      if (nextLogs.length > 200) nextLogs.shift();
    };
    nextChild.stdout?.on('data', retainLog);
    nextChild.stderr?.on('data', retainLog);
    nextChild.once('exit', (code) => {
      if (code && code !== 0)
        process.stderr.write(`[load] Next encerrou (${code}):\n${nextLogs.join('')}\n`);
    });
    const baseUrl = `http://127.0.0.1:${appPort}`;
    await waitForApp(baseUrl, nextChild);

    process.stdout.write('[load] 4/8 scan de 500 consultas + 5.000 jobs C14...\n');
    const [reminderDiagnostic] = await sql<
      Array<{
        candidates: number;
        localHour: number;
        appointmentDate: string;
        expectedDate: string;
        timezone: string;
      }>
    >`
      SELECT count(*)::int AS candidates,
             extract(hour FROM (now() AT TIME ZONE c.timezone))::int AS "localHour",
             min((a.scheduled_at AT TIME ZONE c.timezone)::date)::text AS "appointmentDate",
             ((now() AT TIME ZONE c.timezone)::date + 1)::text AS "expectedDate",
             c.timezone
        FROM appointments a
        JOIN clinics c ON c.id = a.clinic_id
       WHERE a.clinic_id = ${seed.clinicId}::uuid
       GROUP BY c.timezone
    `;
    assert(
      reminderDiagnostic?.candidates === APPOINTMENT_COUNT,
      '[load] diagnóstico perdeu consultas da fixture.',
    );
    assert(
      reminderDiagnostic.appointmentDate === reminderDiagnostic.expectedDate,
      `[load] data da fixture ${reminderDiagnostic.appointmentDate} != ${reminderDiagnostic.expectedDate}.`,
    );
    assert(
      reminderDiagnostic.localHour >= 8 && reminderDiagnostic.localHour < 20,
      `[load] timezone ${reminderDiagnostic.timezone} fora da janela: ${reminderDiagnostic.localHour}h.`,
    );
    const firstReminder = await timedJson<{
      scanned: number;
      enqueued: number;
      sent: number;
      failed: number;
      retried: number;
      cancelled: number;
    }>(`${baseUrl}/api/cron/proactive-reminders`, cronSecret);
    assert(
      firstReminder.value.enqueued === APPOINTMENT_COUNT,
      '[load] o enqueue não materializou 500 jobs.',
    );
    assert(
      firstReminder.value.scanned === 50,
      `[load] o primeiro batch reservou ${String(firstReminder.value.scanned)}/50 jobs.`,
    );
    if (
      firstReminder.value.sent !== 50 ||
      firstReminder.value.failed !== 0 ||
      firstReminder.value.retried !== 0 ||
      firstReminder.value.cancelled !== 0
    ) {
      const reasons = await sql<Array<{ reason: string | null; count: number }>>`
        SELECT failed_reason AS reason, count(*)::int AS count
          FROM ai_proactive_jobs
         WHERE clinic_id = ${seed.clinicId}::uuid AND status <> 'pending'
         GROUP BY failed_reason
         ORDER BY count(*) DESC
      `;
      throw new Error(
        `[load] primeiro batch C14 divergiu: ${JSON.stringify(firstReminder.value)}; ` +
          `reasons=${JSON.stringify(reasons)}; metaCalls=${countLines(appMetaLog)}.`,
      );
    }
    evidence.appointments = {
      scanned: APPOINTMENT_COUNT,
      enqueued: firstReminder.value.enqueued,
      firstBatchSent: firstReminder.value.sent,
      durationMs: roundMs(firstReminder.durationMs),
    };

    await sql`
      WITH numbered AS (
        SELECT id, scheduled_at,
               row_number() OVER (ORDER BY scheduled_at, id) AS rn
          FROM appointments
         WHERE clinic_id = ${seed.clinicId}::uuid
      ), generated AS (
        SELECT g.i, a.id AS appointment_id, a.scheduled_at
          FROM generate_series(1, 4500) AS g(i)
          JOIN numbered a ON a.rn = (((g.i - 1) % ${APPOINTMENT_COUNT}) + 1)
      )
      INSERT INTO ai_proactive_jobs
        (clinic_id, type, scheduled_for, payload, status, attempts, dedup_key)
      SELECT ${seed.clinicId}::uuid, 'reminder', now() - interval '1 minute',
             jsonb_build_object(
               'patientId', ${seed.patientId}::text,
               'appointmentId', appointment_id::text,
               'scheduledAt', to_char(scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               'doctorNome', 'Dra. Carga Sintética'
             ),
             'pending', 0, 'load-reminder:' || i::text
        FROM generated
    `;

    await runChild(
      [
        '--conditions=react-server',
        '--import=tsx',
        resolve(ROOT, 'scripts', 'load-test-proactive-runner.ts'),
      ],
      {
        ...cleanRuntimeEnv({
          databaseUrl,
          metaLog: workerMetaLog,
          metaAppSecret,
          cronSecret,
          cryptoKey,
          lookupSalt,
          sourceMarker,
          timezone,
        }),
        NODE_OPTIONS: `--import=${preloadUrl}`,
        LOAD_TEST_SEED_PATH: seedResultPath,
        LOAD_TEST_RESULT_PATH: proactiveResultPath,
        LOAD_TEST_EXPECTED_JOBS: '4950',
      },
      'worker C14 em volume',
      240_000,
    );
    const proactive = JSON.parse(
      readFileSync(proactiveResultPath, 'utf8'),
    ) as ProactiveRunnerResult;
    assert(proactive.sent === 4_950, `[load] worker enviou ${proactive.sent}/4950 jobs restantes.`);
    assert(
      proactive.cancelled === 0 && proactive.retried === 0 && proactive.failed === 0,
      '[load] houve cancelamento/retry/falha no worker C14.',
    );
    assert(proactive.replayScanned === 0, '[load] replay do worker encontrou jobs entregáveis.');

    const [jobState] = await sql<
      Array<{
        total: number;
        sent: number;
        attemptsMin: number;
        attemptsMax: number;
        outbound: number;
        idemDistinct: number;
        providerDistinct: number;
      }>
    >`
      SELECT
        (SELECT count(*)::int FROM ai_proactive_jobs WHERE clinic_id = ${seed.clinicId}::uuid AND type = 'reminder') AS total,
        (SELECT count(*)::int FROM ai_proactive_jobs WHERE clinic_id = ${seed.clinicId}::uuid AND type = 'reminder' AND status = 'sent') AS sent,
        (SELECT min(attempts)::int FROM ai_proactive_jobs WHERE clinic_id = ${seed.clinicId}::uuid AND type = 'reminder') AS "attemptsMin",
        (SELECT max(attempts)::int FROM ai_proactive_jobs WHERE clinic_id = ${seed.clinicId}::uuid AND type = 'reminder') AS "attemptsMax",
        (SELECT count(*)::int FROM outbound_messages WHERE clinic_id = ${seed.clinicId}::uuid) AS outbound,
        (SELECT count(DISTINCT idempotency_key)::int FROM outbound_messages WHERE clinic_id = ${seed.clinicId}::uuid) AS "idemDistinct",
        (SELECT count(DISTINCT provider_message_id)::int FROM outbound_messages WHERE clinic_id = ${seed.clinicId}::uuid) AS "providerDistinct"
    `;
    assert(
      jobState?.total === PROACTIVE_JOB_COUNT && jobState.sent === PROACTIVE_JOB_COUNT,
      '[load] estado final dos jobs C14 divergiu.',
    );
    assert(
      jobState.attemptsMin === 1 && jobState.attemptsMax === 1,
      '[load] jobs C14 foram processados mais de uma vez.',
    );
    assert(
      jobState.outbound === PROACTIVE_JOB_COUNT,
      '[load] quantidade de outbound_messages divergiu.',
    );
    assert(
      jobState.idemDistinct === PROACTIVE_JOB_COUNT,
      '[load] idempotency_key duplicada no outbound.',
    );
    assert(
      jobState.providerDistinct === PROACTIVE_JOB_COUNT,
      '[load] provider_message_id duplicado.',
    );
    const providerCalls = countLines(appMetaLog) + countLines(workerMetaLog);
    assert(
      providerCalls === PROACTIVE_JOB_COUNT,
      `[load] Meta fake recebeu ${providerCalls}/5000 chamadas.`,
    );
    assert(proactive.p99Ms < JOB_BATCH_P99_SLO_MS, '[load] P99 do batch C14 excedeu 30s.');
    evidence.proactive = { ...proactive, providerCalls, outbound: jobState.outbound };

    const replayBefore = jobState.outbound;
    const replay = await Promise.all([
      timedJson<{ enqueued: number; sent: number }>(
        `${baseUrl}/api/cron/proactive-reminders`,
        cronSecret,
      ),
      timedJson<{ enqueued: number; sent: number }>(
        `${baseUrl}/api/cron/proactive-reminders`,
        cronSecret,
      ),
    ]);
    assert(
      replay.every((item) => item.value.enqueued === 0 && item.value.sent === 0),
      '[load] replay concorrente criou ou enviou job duplicado.',
    );
    const outboundRowsAfterReplay = await sql<{ outbound: number }[]>`
      SELECT count(*)::int AS outbound FROM outbound_messages WHERE clinic_id = ${seed.clinicId}::uuid
    `;
    const outboundAfterReplay = outboundRowsAfterReplay[0]?.outbound ?? 0;
    assert(outboundAfterReplay === replayBefore, '[load] replay concorrente duplicou outbound.');

    process.stdout.write('[load] 5/8 1.000 webhooks Meta assinados...\n');
    let webhookSequence = 0;
    const firstWebhookBody = metaWebhookBody(++webhookSequence);
    const firstWebhookResponse = await fetch(`${baseUrl}/api/webhooks/meta`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${createHmac('sha256', metaAppSecret).update(firstWebhookBody).digest('hex')}`,
      },
      body: firstWebhookBody,
    });
    const firstWebhookAck = (await firstWebhookResponse.json()) as {
      received?: number;
      statuses?: number;
    };
    assert(
      firstWebhookResponse.ok && firstWebhookAck.received === 1,
      `[load] smoke do webhook não confirmou 1 mensagem: status=${firstWebhookResponse.status}; body=${JSON.stringify(firstWebhookAck)}.`,
    );
    const webhook = await runHttpLoad({
      title: 'meta-webhook-1000',
      url: `${baseUrl}/api/webhooks/meta`,
      connections: 20,
      amount: WEBHOOK_COUNT - 1,
      timeout: 30,
      method: 'POST',
      setupClient: (client) => {
        const prepareNext = () => {
          webhookSequence += 1;
          const body = metaWebhookBody(webhookSequence);
          client.setHeadersAndBody(
            {
              'content-type': 'application/json',
              'x-hub-signature-256': `sha256=${createHmac('sha256', metaAppSecret).update(body).digest('hex')}`,
            },
            body,
          );
        };
        prepareNext();
        client.on('response', prepareNext);
      },
    });
    assert(
      webhook.sent === WEBHOOK_COUNT - 1 && webhook.responses2xx === WEBHOOK_COUNT - 1,
      `[load] autocannon iniciou ${webhook.sent}/999 e concluiu ${webhook.responses2xx}/999 webhooks.`,
    );
    assert(
      webhook.errors === 0 && webhook.non2xx === 0 && webhook.mismatches === 0,
      '[load] webhook teve erro HTTP/mismatch.',
    );
    assert(webhook.p99Ms < WEBHOOK_P99_SLO_MS, '[load] P99 do webhook excedeu 2s.');
    await waitForCount(
      sql,
      async () => {
        const countRows = await sql!<
          { count: number }[]
        >`SELECT count(*)::int AS count FROM inbound_messages_orphaned`;
        return countRows[0]?.count ?? 0;
      },
      WEBHOOK_COUNT,
      'quarentena dos webhooks',
    );
    evidence.webhook = {
      ...webhook,
      sent: webhook.sent + 1,
      responses2xx: webhook.responses2xx + 1,
      quarantined: WEBHOOK_COUNT,
    };

    process.stdout.write('[load] 6/8 outbox saturado + reconcile concorrente...\n');
    const outboxPayload = {
      clinicId: seed.clinicId,
      appointmentId: seed.procedureId,
      kind: 'deposit',
      amount: 1,
      failureCode: 'load_test',
    };
    const payloadJson = JSON.stringify(outboxPayload);
    const payloadHash = createHash('sha256').update(payloadJson).digest('hex');
    await sql`
      INSERT INTO outbox
        (clinic_id, event_type, payload, payload_hash, idempotency_key, status, attempts, next_attempt_at)
      SELECT ${seed.clinicId}::uuid, 'payments.patient_charge.failed', ${sql.json(outboxPayload)},
             ${payloadHash}, 'load-outbox:' || g.i::text, 'pending', 0, now()
        FROM generate_series(1, ${OUTBOX_COUNT}) AS g(i)
    `;
    const outboxLoad = await runHttpLoad({
      title: 'outbox-5000',
      url: `${baseUrl}/api/cron/outbox`,
      connections: 2,
      amount: 12,
      timeout: 45,
      headers: { authorization: `Bearer ${cronSecret}` },
    });
    assert(
      outboxLoad.sent === 12 &&
        outboxLoad.responses2xx === 12 &&
        outboxLoad.errors === 0 &&
        outboxLoad.non2xx === 0,
      '[load] cron de outbox teve erro HTTP.',
    );
    for (let i = 0; i < 20; i += 1) {
      const pendingRows = await sql<{ pending: number }[]>`
        SELECT count(*)::int AS pending FROM outbox WHERE idempotency_key LIKE 'load-outbox:%' AND status IN ('pending', 'processing')
      `;
      const pending = pendingRows[0]?.pending ?? 0;
      if (pending === 0) break;
      await timedJson(`${baseUrl}/api/cron/outbox`, cronSecret);
    }
    const [outboxState] = await sql<
      Array<{
        total: number;
        skipped: number;
        attemptsMin: number;
        attemptsMax: number;
        active: number;
      }>
    >`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status = 'skipped')::int AS skipped,
             min(attempts)::int AS "attemptsMin",
             max(attempts)::int AS "attemptsMax",
             count(*) FILTER (WHERE status IN ('pending', 'processing'))::int AS active
        FROM outbox
       WHERE idempotency_key LIKE 'load-outbox:%'
    `;
    assert(
      outboxState?.total === OUTBOX_COUNT && outboxState.skipped === OUTBOX_COUNT,
      '[load] outbox não terminou 5000 eventos como skipped.',
    );
    assert(outboxState.active === 0, '[load] outbox deixou eventos ativos.');
    assert(
      outboxState.attemptsMin === 1 && outboxState.attemptsMax === 1,
      '[load] outbox processou evento mais de uma vez.',
    );
    assert(outboxLoad.p99Ms < JOB_BATCH_P99_SLO_MS, '[load] P99 do outbox excedeu 30s.');
    evidence.outbox = {
      ...outboxLoad,
      skipped: outboxState.skipped,
      attemptsMin: outboxState.attemptsMin,
      attemptsMax: outboxState.attemptsMax,
    };

    const reconcile = await runHttpLoad({
      title: 'financial-reconcile',
      url: `${baseUrl}/api/cron/financial-reconcile?limit=1000`,
      connections: 2,
      amount: 20,
      timeout: 30,
      headers: { authorization: `Bearer ${cronSecret}` },
    });
    assert(
      reconcile.sent === 20 &&
        reconcile.responses2xx === 20 &&
        reconcile.errors === 0 &&
        reconcile.non2xx === 0,
      '[load] reconcile teve erro HTTP.',
    );
    assert(
      reconcile.p95Ms < HTTP_P95_SLO_MS && reconcile.p99Ms < HTTP_P99_SLO_MS,
      '[load] reconcile excedeu SLO HTTP.',
    );
    evidence.reconcile = reconcile;

    process.stdout.write('[load] 7/8 latência SQL, deadlocks e invariantes finais...\n');
    const querySamples: number[] = [];
    for (let i = 0; i < 100; i += 1) {
      const started = performance.now();
      await sql`
        SELECT id
          FROM ai_proactive_jobs
         WHERE clinic_id = ${seed.clinicId}::uuid AND status = 'sent'
         ORDER BY sent_at DESC NULLS LAST
         LIMIT 20
      `;
      querySamples.push(performance.now() - started);
    }
    evidence.query = {
      samples: querySamples.length,
      p95Ms: roundMs(percentile(querySamples, 0.95)),
      p99Ms: roundMs(percentile(querySamples, 0.99)),
      maxMs: roundMs(Math.max(...querySamples)),
    };
    assert(evidence.query.p99Ms < QUERY_P99_SLO_MS, '[load] P99 da query excedeu 100ms.');
    const deadlockRowsAfter = await sql<{ deadlocks: number }[]>`
      SELECT deadlocks::int AS deadlocks FROM pg_stat_database WHERE datname = current_database()
    `;
    const deadlocksAfter = deadlockRowsAfter[0]?.deadlocks ?? 0;
    evidence.deadlocks = deadlocksAfter - deadlocksBefore;
    assert(evidence.deadlocks === 0, `[load] detectados ${evidence.deadlocks} deadlocks.`);

    process.stdout.write('[load] 8/8 encerrando processos e removendo o scratch...\n');
  } finally {
    if (sql) await sql.end({ timeout: 5 }).catch(() => undefined);
    const appStopped = await stopChild(nextChild);
    let pgStopped = !postgresStarted;
    if (postgresStarted) {
      const stopped = spawnSync(pgCtl, ['-D', dataDir, '-m', 'fast', '-w', 'stop'], {
        cwd: ROOT,
        encoding: 'utf8',
      });
      pgStopped = stopped.status === 0;
    }
    const resolvedTemp = assertEphemeralTempDirectory(tempRoot, tmpdir());
    rmSync(resolvedTemp, { recursive: true, force: true });
    evidence.cleanup = {
      postgresStopped: pgStopped && appStopped,
      tempRemoved: !existsSync(resolvedTemp),
    };
  }

  assert(evidence.cleanup?.postgresStopped, '[load] algum processo descartável não encerrou.');
  assert(evidence.cleanup.tempRemoved, '[load] o diretório temporário não foi removido.');
  process.stdout.write(`\n[load] PASS\n${JSON.stringify(evidence, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`[load] FAILED: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
