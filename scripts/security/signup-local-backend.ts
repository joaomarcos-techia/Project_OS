/** Read LOCAL CLI state on stdin; no credential is printed or written to disk. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { readFile, open } from 'node:fs/promises';
import { parse } from 'dotenv';
import postgres from 'postgres';
import { z } from 'zod';
import { readMigrations } from './scratch-schema';

let raw = '';
for await (const chunk of process.stdin) {
  raw += String(chunk);
  if (raw.length > 65536) throw new Error('local CLI state too large');
}
const local = z
  .object({
    API_URL: z.string().url(),
    DB_URL: z.string().url(),
    ANON_KEY: z.string().min(1),
    SERVICE_ROLE_KEY: z.string().min(1),
  })
  .parse(JSON.parse(raw));
raw = '';
const api = new URL(local.API_URL);
const database = new URL(local.DB_URL);
assert.ok(['localhost', '127.0.0.1'].includes(api.hostname) && api.port === '55441');
assert.ok(
  ['localhost', '127.0.0.1'].includes(database.hostname) &&
    database.port === '55442' &&
    database.pathname === '/postgres',
);
const sql = postgres(database.toString(), { ssl: 'require', max: 1, onnotice: () => undefined });
try {
  const [tls] = await sql`select ssl from pg_stat_ssl where pid=pg_backend_pid()`;
  assert.equal(tls?.ssl, true);
  const [existing] = await sql`select to_regclass('public.signup_sessions') as existing`;
  if (!existing?.existing) {
    // Platform-shape compatibility only, identical to scratch-schema.ts. The
    // local CLI lacks this managed no-call-site function. No trigger is installed;
    // this does not substitute for Qoro's explicit FORCE RLS/ACL tests.
    await sql`CREATE OR REPLACE FUNCTION public.rls_auto_enable() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$`;
    await sql`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='qoro_runtime') THEN CREATE ROLE qoro_runtime NOLOGIN NOBYPASSRLS; GRANT authenticated TO qoro_runtime; END IF; END $$`;
    for (const migration of await readMigrations()) {
      try {
        await sql.unsafe(migration.body);
      } catch {
        throw new Error(
          `local migration failed: ${migration.file}; inspect isolated DB, no reset performed`,
        );
      }
    }
  } else {
    const [version] =
      await sql`select version from public._schema_version where version='signup-code-and-recovery'`;
    assert.ok(version, 'Existing local schema does not match this worktree; refuse reset');
  }
  // Catalog activation is operational, deliberately not automatic in the real
  // migrations. Prepare only this disposable local fixture with approved prices.
  const catalog =
    await sql`select p.code,(r.amount*100)::int as cents from public.plans p join public.prices r on r.plan_id=p.id where p.code in ('consultorio_2026','clinica_2026_2') and r.billing_cycle='monthly' and r.campaign_code is null and r.active_until is null order by p.code`;
  assert.equal(catalog.length, 2);
  assert.deepEqual(
    catalog.map((row) => row.cents).sort((a, b) => a - b),
    [19700, 39700],
  );
  await sql`update public.plans set ativo=true where code in ('consultorio_2026','clinica_2026_2')`;
} finally {
  await sql.end({ timeout: 2 });
}
const childEnv: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
for (const key of [
  'PATH',
  'Path',
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOME',
  'COMSPEC',
  'PATHEXT',
])
  if (process.env[key]) childEnv[key] = process.env[key];
Object.assign(childEnv, {
  NODE_ENV: 'test',
  DATABASE_URL: local.DB_URL,
  NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
  MAGIC_TOKEN_SECRET: randomBytes(32).toString('base64url'),
  LOGIN_HASH_PEPPER: randomBytes(32).toString('base64url'),
  SIGNUP_AUTH_ENABLED: 'true',
  SIGNUP_IDENTITY_ENABLED: 'true',
  APP_BASE_URL: 'http://localhost:3210',
  SIGNUP_LOCAL_INTEGRATION: 'ONLY_SYNTHETIC_LOCAL_55442',
});
const mailMode = process.argv.includes('--mail');
const browserMode = process.argv.includes('--browser') || mailMode;
let server: ReturnType<typeof spawn> | undefined;
let serverLog: Awaited<ReturnType<typeof open>> | undefined;
try {
  if (browserMode) {
    // Only the existing development rate limiter is used; no email, payment or
    // Production credentials are inherited. Random HMAC keys isolate test keys.
    const configured = parse(await readFile('C:/dev/ClinicaOS_V2/.env.local'));
    for (const key of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
      assert.ok(configured[key], `Missing development rate limiter: ${key}`);
      childEnv[key] = configured[key];
    }
    childEnv.VERCEL_ENV = 'development';
    childEnv.SIGNUP_LOCAL_BROWSER = 'true';
    if (mailMode) {
      for (const key of ['RESEND_API_KEY_DEV', 'EMAIL_FROM_DEV', 'E2E_RESEND_INBOX_ADDRESS'])
        assert.ok(configured[key], `Missing authorized development email configuration: ${key}`);
      childEnv.RESEND_API_KEY = configured.RESEND_API_KEY_DEV;
      childEnv.EMAIL_FROM = configured.EMAIL_FROM_DEV;
      childEnv.E2E_RESEND_INBOX_ADDRESS = configured.E2E_RESEND_INBOX_ADDRESS;
      childEnv.SIGNUP_LOCAL_MAIL = 'true';
    }
    assert.equal(
      await fetch('http://localhost:3210/api/signup/runtime-fingerprint').catch(() => null),
      null,
      'Port 3210 already in use; refuse another server',
    );
    serverLog = await open('dist/signup-browser-server.log', 'w');
    server = spawn(
      process.execPath,
      [
        path.resolve('node_modules/next/dist/bin/next'),
        'dev',
        '--hostname',
        'localhost',
        '--port',
        '3210',
      ],
      {
        env: { ...childEnv, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1' },
        stdio: ['ignore', serverLog.fd, serverLog.fd],
        windowsHide: true,
      },
    );
    let alive = false;
    for (let n = 0; n < 90; n++) {
      if (server.exitCode !== null)
        throw new Error('Local Next server exited; inspect sanitized local log');
      try {
        const response = await fetch('http://localhost:3210/cadastro/retomar', {
          signal: AbortSignal.timeout(2000),
        });
        if (response.ok) {
          alive = true;
          break;
        }
      } catch {
        /* Startup readiness probe; bounded and loopback-only. */
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert.ok(alive, 'Local Next server did not become ready');
    // Compile the read-only destination boundary before the measured UI journey.
    // Missing browser cookie guarantees no address/identity mutation.
    const warm = await fetch('http://localhost:3210/api/signup/sessions/destination', {
      headers: { 'sec-fetch-site': 'same-origin' },
      signal: AbortSignal.timeout(60_000),
    });
    assert.equal(warm.status, 410);
  }
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.resolve('node_modules/vitest/vitest.mjs'),
        'run',
        '--config',
        'scripts/security/signup-local.config.ts',
        '--reporter=json',
        `--outputFile=dist/signup-${mailMode ? 'mail' : browserMode ? 'browser' : 'local'}-integration.json`,
      ],
      { env: childEnv, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true },
    );
    child.once('error', reject);
    child.once('exit', (value) => resolve(value ?? 1));
  });
  process.exitCode = code;
} finally {
  if (server && server.exitCode === null) {
    // Exact child tree only; never kill unrelated Node/Next processes.
    const serverPid = server.pid;
    if (process.platform === 'win32' && serverPid)
      await new Promise<void>((resolve) => {
        const stop = spawn('taskkill', ['/PID', String(serverPid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        stop.once('exit', () => resolve());
        stop.once('error', () => resolve());
      });
    else server.kill('SIGTERM');
  }
  await serverLog?.close();
}
