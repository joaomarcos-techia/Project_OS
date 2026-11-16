import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ spawnSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: mocks.spawnSync }));
import {
  approvedPreflightEnvironment,
  readPreflightCatalog,
} from '../../../../scripts/abacatepay-preflight-transport';

const project = 'abcdefghijklmnopqrst';
const url = `postgresql://postgres.${project}:synthetic-only@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require`;
const parent = {
  PATH: '/synthetic/bin',
  SUPABASE_PROJECT_ENV: 'prod',
  PGSSLROOTCERT: '/approved/ca.pem',
  GH_TOKEN: 'must-not-survive',
  ABACATEPAY_API_KEY: 'must-not-survive',
  PGHOSTADDR: 'must-not-survive',
  PGSSLMODE: 'disable',
  NODE_OPTIONS: '--import=untrusted',
};
afterEach(() => vi.clearAllMocks());

describe('operator preflight verifies the server without the runtime pool', () => {
  it.each(['require', 'verify-full'])(
    'forces verify-full for a source URL declaring %s, without inheriting secrets or TLS overrides',
    (mode) => {
      const env = approvedPreflightEnvironment(url.replace('require', mode), project, parent);
      expect(env).toMatchObject({
        PGHOST: 'aws-0-us-east-1.pooler.supabase.com',
        PGUSER: `postgres.${project}`,
        PGPASSWORD: 'synthetic-only',
        PGSSLMODE: 'verify-full',
        PGSSLROOTCERT: '/approved/ca.pem',
        PGOPTIONS: '-c default_transaction_read_only=on',
      });
      expect(Object.values(env)).not.toContain('must-not-survive');
      expect(env.NODE_OPTIONS).toBeUndefined();
      expect(parent.PGSSLMODE).toBe('disable');
    },
  );
  it.each(['wrong_project', 'dev', 'context', 'host', 'database', 'port', 'tls', 'password', 'ca'])(
    'rejects %s before spawning a client',
    (kind) => {
      const target = new URL(url);
      const settings: NodeJS.ProcessEnv = { ...parent };
      let ref = project;
      if (kind === 'wrong_project') ref = 'z'.repeat(20);
      if (kind === 'dev') ref = 'pqhkirrszzpwezdaqrai';
      if (kind === 'context') settings.SUPABASE_PROJECT_ENV = 'dev';
      if (kind === 'host') target.hostname += '.invalid';
      if (kind === 'database') target.pathname = '/other';
      if (kind === 'port') target.port = '1111';
      if (kind === 'tls') target.searchParams.set('sslmode', 'disable');
      if (kind === 'password') target.password = '';
      if (kind === 'ca') delete settings.PGSSLROOTCERT;
      expect(() => approvedPreflightEnvironment(target.href, ref, settings)).toThrow();
      expect(mocks.spawnSync).not.toHaveBeenCalled();
    },
  );
  it('uses one read-only snapshot, bounded psql and stdin SQL; never a URL/password argument', () => {
    mocks.spawnSync.mockReturnValue({ status: 0, signal: null, stdout: '{"readOnly":"on"}' });
    const env = approvedPreflightEnvironment(url, project, parent);
    expect(readPreflightCatalog(env)).toEqual({ readOnly: 'on' });
    const [executable, args, options] = mocks.spawnSync.mock.calls[0]!;
    expect(executable).toBe('psql');
    expect(args).toEqual(['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1']);
    expect(JSON.stringify(args)).not.toContain('synthetic-only');
    expect(options).toMatchObject({ env, timeout: 30_000, windowsHide: true });
    expect(options.input).toContain('REPEATABLE READ READ ONLY');
    expect(options.input).toContain("SET LOCAL statement_timeout = '10s'");
    expect(options.input).toContain("SET LOCAL lock_timeout = '2s'");
    expect(options.input).toContain('drizzle.__drizzle_migrations');
    expect(options.input).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/u);
  });
  it.each([
    { status: 1, signal: null, stderr: 'must-not-leak' },
    { status: null, signal: 'SIGTERM', stderr: 'must-not-leak' },
    { status: null, signal: null, error: new Error('must-not-leak') },
    { status: 0, signal: null, stdout: 'must-not-leak' },
  ])('suppresses connection/SQL/output details and rejects incomplete execution', (result) => {
    mocks.spawnSync.mockReturnValue(result);
    expect(() => readPreflightCatalog(approvedPreflightEnvironment(url, project, parent))).toThrow(
      /suppressed/u,
    );
  });
  it('refuses an insecure client even if called outside the command-line guard', () => {
    const env = approvedPreflightEnvironment(url, project, parent);
    expect(() => readPreflightCatalog({ ...env, PGSSLMODE: 'require' })).toThrow();
    expect(() => readPreflightCatalog({ ...env, PGOPTIONS: '' })).toThrow();
    expect(mocks.spawnSync).not.toHaveBeenCalled();
  });
  it('does not let URI parameters override the approved CA, destination or read-only setting', () => {
    const target = new URL(url);
    target.searchParams.set('sslrootcert', '/untrusted.pem');
    target.searchParams.set('hostaddr', '192.0.2.1');
    target.searchParams.set('options', '-c default_transaction_read_only=off');
    const env = approvedPreflightEnvironment(target.href, project, parent);
    expect(env.PGSSLROOTCERT).toBe(parent.PGSSLROOTCERT);
    expect(env.PGHOSTADDR).toBeUndefined();
    expect(env.PGOPTIONS).toBe('-c default_transaction_read_only=on');
  });
});
