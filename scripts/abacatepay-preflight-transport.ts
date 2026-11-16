/** Operator-only libpq transport. No dotenv, runtime pool, provider or migration. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const READ_ONLY_OPTIONS = '-c default_transaction_read_only=on';
const OS_ENVIRONMENT = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'PATHEXT', 'TEMP', 'TMP'] as const;

export function approvedPreflightEnvironment(
  databaseUrl: string,
  project: string,
  parent: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl);
  assert.match(project, /^[a-z]{20}$/u, 'Explicit approved project required');
  assert.notEqual(project, 'pqhkirrszzpwezdaqrai', 'DEV is not a production preflight target');
  assert.equal(parent.SUPABASE_PROJECT_ENV, 'prod', 'Production context required');
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'PostgreSQL URL required');
  const user = decodeURIComponent(url.username);
  const direct = url.hostname === `db.${project}.supabase.co` && user === 'postgres';
  const pooled =
    /^[a-z0-9-]+\.pooler\.supabase\.com$/u.test(url.hostname) && user.split('.').at(-1) === project;
  assert.ok(direct || pooled, 'Approved project endpoint required');
  assert.ok(['5432', '6543'].includes(url.port || '5432'), 'Unexpected database port');
  if (direct) assert.equal(url.port || '5432', '5432', 'Direct session port required');
  assert.equal(decodeURIComponent(url.pathname), '/postgres', 'Unexpected database');
  assert.ok(
    ['require', 'verify-full'].includes(url.searchParams.get('sslmode') ?? ''),
    'TLS required',
  );
  assert.ok(url.password, 'Database credential required');
  assert.ok(parent.PGSSLROOTCERT?.trim(), 'Explicit trusted CA path required');
  // Next.js requires NODE_ENV in ProcessEnv; use a fixed value, never inherit it.
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
  for (const name of OS_ENVIRONMENT) if (parent[name]) env[name] = parent[name];
  return {
    ...env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: 'postgres',
    PGSSLMODE: 'verify-full',
    PGSSLROOTCERT: parent.PGSSLROOTCERT,
    PGCONNECT_TIMEOUT: '10',
    PGOPTIONS: READ_ONLY_OPTIONS,
    PGAPPNAME: 'qoro-gate-b-readonly-preflight',
  };
}

/** Also usable against an isolated synthetic server; production identity is checked above. */
export function readPreflightCatalog(env: NodeJS.ProcessEnv, psql = 'psql'): unknown {
  assert.equal(env.PGSSLMODE, 'verify-full', 'Certificate and hostname verification required');
  assert.equal(env.PGOPTIONS, READ_ONLY_OPTIONS, 'Read-only startup required');
  assert.ok(env.PGSSLROOTCERT?.trim(), 'Explicit trusted CA path required');
  const result = spawnSync(psql, ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
    env,
    input: readFileSync(new URL('./abacatepay-preflight-catalog.sql', import.meta.url), 'utf8'),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30_000,
    maxBuffer: 2 << 20,
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0)
    throw new Error('Verified read-only preflight failed; connection and SQL details suppressed');
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('Invalid catalog response; database output suppressed');
  }
}
