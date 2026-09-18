/** Local real Postgres + real handlers. No dotenv, provider credentials or external targets. */
import assert from 'node:assert/strict';
import { fork, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Route } from '@playwright/test';
import postgres from 'postgres';
import selfsigned from 'selfsigned';

const root = process.cwd();
const SELF_SERVICE_PLAN_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const SELF_SERVICE_OTHER_PLAN_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const SELF_SERVICE_INACTIVE_PLAN_ID = 'cccccccc-3333-4333-8333-333333333333';
const bin =
  process.env.SECURITY_PG_BIN ??
  (process.platform === 'win32'
    ? 'C:/Program Files/PostgreSQL/17/bin'
    : '/usr/lib/postgresql/17/bin');
const allowed = new Set([
  'PATH',
  'Path',
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'HOME',
  'USERPROFILE',
  'COMSPEC',
  'PATHEXT',
]);
for (const key of Object.keys(process.env)) if (!allowed.has(key)) delete process.env[key];
const suffix = process.platform === 'win32' ? '.exe' : '';
const cluster = await mkdtemp(path.join(os.tmpdir(), 'qoro-signup-regression-'));
const data = path.join(cluster, 'data');
const port = 55447;
const init = spawnSync(
  path.join(bin, `initdb${suffix}`),
  ['-D', data, '-U', 'signup_local', '--auth=trust', '--encoding=UTF8', '--no-locale'],
  { windowsHide: true, encoding: 'utf8' },
);
if (init.error) throw init.error;
assert.equal(init.status, 0, init.stderr);
const cert = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
  keySize: 2048,
});
await writeFile(path.join(data, 'server.crt'), cert.cert);
await writeFile(path.join(data, 'server.key'), cert.private, { mode: 0o600 });
const server = spawn(
  path.join(bin, `postgres${suffix}`),
  [
    '-D',
    data,
    '-p',
    String(port),
    '-h',
    '127.0.0.1',
    '-c',
    'ssl=on',
    // Socket Unix no diretório do próprio cluster: o default `/var/run/postgresql`
    // não é gravável no runner do CI. Tudo aqui é TCP em 127.0.0.1.
    '-c',
    `unix_socket_directories=${cluster}`,
  ],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
);
let serverLog = '';
server.stderr.on('data', (chunk: Buffer) => {
  serverLog += chunk.toString();
});
const url = `postgres://signup_local@127.0.0.1:${port}/postgres?sslmode=require`;
const admin = postgres(url, {
  ssl: 'require',
  max: 1,
  connect_timeout: 2,
  onnotice: () => undefined,
});
const results: { name: string; status: 'PASS' | 'FAIL'; detail?: string }[] = [];
let verified = false;
let schemaReady = false;
let stopped: { ok: true } | { ok: false; detail: string } = { ok: false, detail: 'not attempted' };
async function check(name: string, run: () => Promise<void>) {
  try {
    await run();
    results.push({ name, status: 'PASS' });
  } catch (error) {
    results.push({
      name,
      status: 'FAIL',
      detail: error instanceof Error ? (error.stack ?? error.message) : 'unknown failure',
    });
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

async function readJsonBody(request: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > 64 * 1024) throw new Error('Redis fixture body exceeds 64 KiB');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Percorre as quatro telas do perfil e para na última, sem salvar ainda. */
async function answerAllQuestions(page: import('@playwright/test').Page): Promise<void> {
  const steps: [string, string][] = [
    ['2 a 5', 'Quantos atendimentos são realizados por semana?'],
    ['21 a 50', 'Como a clínica se organiza hoje?'],
    ['Outro sistema', 'Como você conheceu a Qoro?'],
  ];
  for (const [option, nextHeading] of steps) {
    await page.getByText(option, { exact: true }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByRole('heading', { name: nextHeading }).waitFor();
  }
  await page.getByText('Indicação de um colega', { exact: true }).click();
}

async function runBrowserJourney(
  databaseUrl: string,
  sql: ReturnType<typeof postgres>,
  hashToken: (rawToken: string) => string,
): Promise<void> {
  const buildResult: unknown = JSON.parse(
    await readFile(path.join(root, 'dist/security-local/build-result.json'), 'utf8'),
  );
  assert.ok(
    typeof buildResult === 'object' &&
      buildResult !== null &&
      'exitCode' in buildResult &&
      buildResult.exitCode === 0,
    'build isolado ausente ou inválido; rode pnpm security:build antes de --browser',
  );
  const parsedRuntime: unknown = JSON.parse(
    await readFile(path.join(root, 'dist/security-local/runtime-env.json'), 'utf8'),
  );
  assert.ok(isStringRecord(parsedRuntime), 'runtime-env.json não contém apenas strings');
  const providerUrl = new URL(parsedRuntime.NEXT_PUBLIC_SUPABASE_URL ?? '');
  assert.equal(providerUrl.hostname, '127.0.0.1', 'Auth fixture requires loopback');
  assert.equal(providerUrl.protocol, 'http:', 'Synthetic Auth fixture requires HTTP');

  const appPort = 3217;
  const baseUrl = `http://127.0.0.1:${appPort}`;
  const redisPort = 55449;
  const redisObservations: {
    commandCount: number;
    durationMs: number;
    error?: string;
    path: string;
    status: number;
  }[] = [];
  const redisFailures: string[] = [];
  let redisRequests = 0;
  let redisControlId = 0;
  const redisControls = new Map<number, { reject: (error: Error) => void; resolve: () => void }>();
  const redisFixture = fork(path.join(root, 'scripts/security/signup-redis-fixture.mjs'), [], {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let redisFixtureLog = '';
  redisFixture.stdout?.on('data', (chunk: Buffer) => {
    redisFixtureLog += chunk.toString();
  });
  redisFixture.stderr?.on('data', (chunk: Buffer) => {
    redisFixtureLog += chunk.toString();
  });
  const redisReady = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Redis fixture readiness timeout')), 10_000);
    redisFixture.on('message', (message: unknown) => {
      if (typeof message !== 'object' || message === null || !('type' in message)) return;
      if (message.type === 'ready') {
        clearTimeout(timeout);
        resolve();
        return;
      }
      if (message.type === 'fatal') {
        const detail = 'error' in message ? String(message.error) : 'Redis fixture failed';
        redisFailures.push(detail);
        clearTimeout(timeout);
        reject(new Error(detail));
        return;
      }
      if (message.type === 'observation') {
        const observation = message as (typeof redisObservations)[number] & {
          type: 'observation';
        };
        const observationError =
          typeof observation.error === 'string' ? observation.error : undefined;
        redisRequests += observation.commandCount;
        if (observationError) redisFailures.push(observationError);
        redisObservations.push({
          commandCount: observation.commandCount,
          durationMs: observation.durationMs,
          path: observation.path,
          status: observation.status,
          ...(observationError ? { error: observationError } : {}),
        });
        return;
      }
      if (message.type === 'ack' && 'id' in message && typeof message.id === 'number') {
        const pending = redisControls.get(message.id);
        if (!pending) return;
        redisControls.delete(message.id);
        if ('error' in message && message.error) pending.reject(new Error(String(message.error)));
        else pending.resolve();
      }
    });
    redisFixture.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    redisFixture.once('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Redis fixture exited ${code}: ${redisFixtureLog}`));
      }
    });
  });
  await redisReady;
  async function controlRedis(command: 'clear' | 'stop' | 'unavailable', value?: boolean) {
    const id = ++redisControlId;
    await new Promise<void>((resolve, reject) => {
      redisControls.set(id, { reject, resolve });
      redisFixture.send({ type: 'control', id, command, value }, (error) => {
        if (!error) return;
        redisControls.delete(id);
        reject(error);
      });
    });
  }
  const appEnv: NodeJS.ProcessEnv = {
    ...parsedRuntime,
    NODE_ENV: 'development', // Loopback HTTP fixture; the inspected Next build remains production.
    DATABASE_URL: databaseUrl,
    APP_BASE_URL: baseUrl,
    MAGIC_TOKEN_SECRET: 'synthetic-local-signup-only-magic-token-secret',
    LOGIN_HASH_PEPPER: 'synthetic-local-signup-only-email-hmac-pepper',
    SIGNUP_IDENTITY_ENABLED: 'true',
    SIGNUP_AUTH_ENABLED: 'true',
    LOG_LEVEL: 'warn',
    UPSTASH_REDIS_REST_URL: `http://127.0.0.1:${redisPort}`,
    UPSTASH_REDIS_REST_TOKEN: 'synthetic-upstash-token',
  };
  const appServer = spawn(
    process.execPath,
    [
      path.join(root, 'node_modules/next/dist/bin/next'),
      'start',
      '-p',
      String(appPort),
      '-H',
      '127.0.0.1',
    ],
    {
      cwd: path.join(root, 'dist/security-local/app'),
      env: appEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let appLog = '';
  appServer.stdout.on('data', (chunk: Buffer) => {
    appLog += chunk.toString();
  });
  appServer.stderr.on('data', (chunk: Buffer) => {
    appLog += chunk.toString();
  });

  let browser: Awaited<
    ReturnType<(typeof import('@playwright/test'))['chromium']['launch']>
  > | null = null;
  let providerCalls = 0;
  let otpVerifyCalls = 0;
  let getUserCalls = 0;
  let providerMode = 'new';
  let expectedReservedVersion = 4;
  let resendMode = 'success';
  let resendCalls = 0;
  let activeHash = '';
  const verifiedOtpUser = {
    id: '33333333-3333-4333-8333-333333333333',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'confirmed.synthetic@example.invalid',
    email_confirmed_at: '2026-09-16T03:00:00.000Z',
    is_anonymous: false,
    identities: [{ provider: 'email' }],
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    created_at: '2026-09-16T02:59:00.000Z',
  };
  const verifiedOtpToken = [
    '{"alg":"HS256","typ":"JWT"}',
    JSON.stringify({
      sub: verifiedOtpUser.id,
      aud: 'authenticated',
      role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    'synthetic-signature',
  ]
    .map((part) => Buffer.from(part).toString('base64url'))
    .join('.');
  const providerFailures: string[] = [];
  const providerServer = createServer(async (request, response) => {
    try {
      const target = new URL(request.url ?? '', providerUrl);
      if (request.method === 'POST' && target.pathname === '/auth/v1/verify') {
        const body = await readJsonBody(request);
        assert.ok(typeof body === 'object' && body !== null && 'token_hash' in body);
        assert.equal(body.token_hash, 'synthetic-signup-token');
        assert.equal('type' in body ? body.type : undefined, 'signup');
        otpVerifyCalls++;
        if (providerMode === 'otp-expired' || providerMode === 'otp-invalid') {
          response.writeHead(403, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              code: providerMode === 'otp-expired' ? 'otp_expired' : 'bad_jwt',
              error_code: providerMode === 'otp-expired' ? 'otp_expired' : 'bad_jwt',
              msg:
                providerMode === 'otp-expired'
                  ? 'OTP expired for raw-person@example.invalid'
                  : 'Synthetic invalid OTP',
            }),
          );
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            user: verifiedOtpUser,
            access_token: verifiedOtpToken,
            refresh_token: 'synthetic-otp-refresh',
            expires_in: 3600,
            token_type: 'bearer',
          }),
        );
        return;
      }
      if (request.method === 'GET' && target.pathname === '/auth/v1/user') {
        assert.equal(request.headers.authorization, `Bearer ${verifiedOtpToken}`);
        getUserCalls++;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(verifiedOtpUser));
        return;
      }
      if (request.method === 'POST' && target.pathname === '/auth/v1/resend') {
        const body = await readJsonBody(request);
        assert.ok(typeof body === 'object' && body !== null);
        assert.equal('type' in body ? body.type : undefined, 'signup');
        assert.equal('email' in body ? body.email : undefined, 'synthetic@example.invalid');
        assert.equal(target.searchParams.get('redirect_to'), `${baseUrl}/auth/confirm`);
        resendCalls++;
        if (resendMode === 'timeout') return;
        if (resendMode === 'concurrent') await new Promise((resolve) => setTimeout(resolve, 300));
        if (resendMode === 'provider-5xx') {
          response.writeHead(503, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ msg: 'synthetic resend unavailable' }));
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{}');
        return;
      }
      assert.equal(request.method, 'POST');
      assert.equal(target.pathname, '/auth/v1/signup');
      assert.equal(target.searchParams.get('redirect_to'), `${baseUrl}/auth/confirm`);
      const body = await readJsonBody(request);
      assert.ok(
        typeof body === 'object' && body !== null && 'password' in body && 'code_challenge' in body,
      );
      assert.equal(body.password, 'Abcdef1!');
      const [row] =
        await sql`SELECT status, auth_attempt_state, row_version FROM signup_sessions WHERE token_hash = ${activeHash}`;
      assert.equal(row?.status, 'email_pending');
      assert.equal(row?.auth_attempt_state, 'reserved');
      assert.equal(row?.row_version, expectedReservedVersion);
      providerCalls++;
      if (providerMode === 'timeout') return; // Real SDK 20s abort; close connections in finally.
      if (providerMode === 'concurrent') await new Promise((resolve) => setTimeout(resolve, 300));
      if (providerMode === 'finish-conflict')
        await sql`UPDATE signup_sessions SET row_version = row_version + 1 WHERE token_hash = ${activeHash}`;
      const user = {
        id:
          providerMode === 'verified'
            ? '22222222-2222-4222-8222-222222222222'
            : '11111111-1111-4111-8111-111111111111',
        aud: 'authenticated',
        role: 'authenticated',
        email: 'synthetic@example.invalid',
        email_confirmed_at: providerMode === 'verified' ? new Date().toISOString() : null,
        identities: providerMode === 'unverified' ? [{ provider: 'email' }] : [],
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: {},
        created_at: new Date().toISOString(),
      };
      let payload: unknown = { user };
      let status = 200;
      if (['user_already_exists', 'weak_password'].includes(providerMode)) {
        status = 422;
        payload = {
          code: providerMode,
          error_code: providerMode,
          msg: 'synthetic account outcome',
        };
      }
      if (providerMode === 'provider-5xx') {
        status = 503;
        payload = { msg: 'synthetic provider unavailable' };
      }
      if (providerMode === 'unexpected-session') {
        const token = [
          '{"alg":"HS256","typ":"JWT"}',
          JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 }),
          'synthetic-signature',
        ]
          .map((part) => Buffer.from(part).toString('base64url'))
          .join('.');
        payload = {
          user,
          access_token: token,
          refresh_token: 'synthetic-refresh',
          expires_in: 3600,
          token_type: 'bearer',
        };
      }
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    } catch (error) {
      providerFailures.push(error instanceof Error ? error.message : 'fixture failure');
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ msg: 'synthetic fixture failed' }));
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      providerServer.once('error', reject);
      providerServer.listen(Number(providerUrl.port), '127.0.0.1', resolve);
    });
    const readyUntil = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < readyUntil && !ready) {
      if (appServer.exitCode !== null)
        throw new Error(`next start exit ${appServer.exitCode}: ${appLog}`);
      try {
        const response = await fetch(`${baseUrl}/cadastro`);
        ready = response.status > 0;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    assert.ok(ready, `next start timeout: ${appLog}`);

    const authProofs: { name: string; status: 'PASS'; durationMs?: number }[] = [];
    async function seedAuth(label: string, email = 'synthetic@example.invalid') {
      const token = createHash('sha256').update(`http-auth-${label}`).digest('base64url');
      const { hashEmail } = await import('../../src/lib/auth/email-hash');
      activeHash = hashToken(token);
      await sql`INSERT INTO signup_sessions (token_hash, status, row_version, idle_expires_at, absolute_expires_at,
        professionals_band, weekly_appointments_band, current_tooling, discovery_source, answered_at,
        owner_name, clinic_name, email_hash, accepted_at)
        VALUES (${activeHash}, 'identity_pending', 3, now() + interval '10 minutes', now() + interval '45 minutes',
          '2_5', '21_50', 'outro_sistema', 'indicacao_colega', now(), 'Synthetic owner', 'Synthetic clinic', ${hashEmail(email)}, now())`;
      return token;
    }
    async function postAuth(
      token: string,
      email = 'synthetic@example.invalid',
      rowVersion = 3,
    ): Promise<Response> {
      const tokenHash = hashToken(token);
      const [before] =
        await sql`SELECT status, row_version, auth_attempt_state FROM signup_sessions WHERE token_hash = ${tokenHash}`;
      const callsBefore = providerCalls;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          return await fetch(`${baseUrl}/api/signup/sessions/auth`, {
            method: 'POST',
            headers: {
              origin: baseUrl,
              cookie: `__Host-qoro_signup=${token}; qoro-auth-session=${'a'.repeat(32)}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ rowVersion, email, password: 'Abcdef1!', accepted: true }),
          });
        } catch (error) {
          const [after] =
            await sql`SELECT status, row_version, auth_attempt_state FROM signup_sessions WHERE token_hash = ${tokenHash}`;
          const unchanged = JSON.stringify(after) === JSON.stringify(before);
          if (attempt === 3 || !unchanged || providerCalls !== callsBefore) throw error;
        }
      }
      throw new Error('Unreachable signup auth transport retry');
    }
    async function postAuthAfterLocalLimiterReady(
      token: string,
      email = 'synthetic@example.invalid',
      rowVersion = 3,
    ): Promise<{ durationMs: number; response: Response }> {
      const tokenHash = hashToken(token);
      for (let attempt = 1; attempt <= 3; attempt++) {
        const [before] =
          await sql`SELECT status, row_version, auth_attempt_state FROM signup_sessions WHERE token_hash = ${tokenHash}`;
        const callsBefore = providerCalls;
        const startedAt = performance.now();
        const response = await postAuth(token, email, rowVersion);
        const durationMs = Math.round(performance.now() - startedAt);
        if (response.status !== 503) return { durationMs, response };
        const [after] =
          await sql`SELECT status, row_version, auth_attempt_state FROM signup_sessions WHERE token_hash = ${tokenHash}`;
        const limiterOnlyFailure =
          JSON.stringify(after) === JSON.stringify(before) && providerCalls === callsBefore;
        if (!limiterOnlyFailure || attempt === 3) return { durationMs, response };
        await controlRedis('clear');
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error('Unreachable local limiter retry');
    }
    async function seedResend(
      label: string,
      state: 'reserved' | 'completed' | 'uncertain' = 'completed',
      secondsAgo = 61,
    ) {
      const token = createHash('sha256').update(`http-resend-${label}`).digest('base64url');
      const tokenHash = hashToken(token);
      const { hashEmail } = await import('../../src/lib/auth/email-hash');
      await sql`INSERT INTO signup_sessions (token_hash, status, row_version,
        idle_expires_at, absolute_expires_at, professionals_band,
        weekly_appointments_band, current_tooling, discovery_source, answered_at,
        owner_name, clinic_name, email_hash, accepted_at, auth_attempt_kind,
        auth_attempt_state, auth_attempted_at)
        VALUES (${tokenHash}, 'email_pending', 5, now() + interval '10 minutes',
          now() + interval '45 minutes', '2_5', '21_50', 'outro_sistema',
          'indicacao_colega', now(), 'Synthetic owner', 'Synthetic clinic',
          ${hashEmail('synthetic@example.invalid')}, now(), 'initial', ${state},
          now() - make_interval(secs => ${secondsAgo}))`;
      return { token, tokenHash };
    }
    const postResend = (token: string, rowVersion = 5) =>
      fetch(`${baseUrl}/api/signup/sessions/resend`, {
        method: 'POST',
        headers: {
          origin: baseUrl,
          cookie: `__Host-qoro_signup=${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          rowVersion,
          email: 'synthetic@example.invalid',
          accepted: true,
        }),
      });
    providerMode = 'new';
    const warmToken = await seedAuth('warm');
    const { response: warmResponse } = await postAuthAfterLocalLimiterReady(warmToken);
    if (warmResponse.status !== 200) {
      const [warmRow] =
        await sql`SELECT status, row_version, auth_attempt_state FROM signup_sessions WHERE token_hash = ${activeHash}`;
      throw new Error(
        `warm auth ${warmResponse.status}: ${await warmResponse.text()}; ` +
          `row=${JSON.stringify(warmRow)} providerCalls=${providerCalls} redisRequests=${redisRequests} ` +
          `redisObservations=${JSON.stringify(redisObservations)} ` +
          `redisFailures=${JSON.stringify(redisFailures)} providerFailures=${JSON.stringify(providerFailures)}`,
      );
    }
    await sql`DELETE FROM signup_sessions WHERE token_hash = ${activeHash}`;
    await controlRedis('clear');
    const accountDurationSamples: number[] = [];
    let pendingUiToken = '';
    for (const mode of [
      'new',
      'verified',
      'unverified',
      'user_already_exists',
      'provider-5xx',
      'unexpected-session',
      'finish-conflict',
      'timeout',
    ]) {
      await controlRedis('clear');
      providerMode = mode;
      const token = await seedAuth(mode),
        callsBefore = providerCalls;
      const { durationMs: requestDurationMs, response } =
          await postAuthAfterLocalLimiterReady(token),
        failed = ['provider-5xx', 'unexpected-session', 'finish-conflict', 'timeout'].includes(
          mode,
        );
      const expectedStatus = failed ? 503 : 200;
      if (response.status !== expectedStatus) {
        const [failedRow] =
          await sql`SELECT status, row_version, auth_attempt_state FROM signup_sessions WHERE token_hash = ${activeHash}`;
        throw new Error(
          `real SDK ${mode}: expected ${expectedStatus}, received ${response.status} ` +
            `body=${await response.text()} row=${JSON.stringify(failedRow)} ` +
            `providerCalls=${providerCalls} redisRequests=${redisRequests} ` +
            `redisObservations=${JSON.stringify(redisObservations.slice(-5))} ` +
            `redisFailures=${JSON.stringify(redisFailures)} providerFailures=${JSON.stringify(providerFailures)}`,
        );
      }
      assert.deepEqual(
        await response.json(),
        failed ? { error: 'unavailable' } : { rowVersion: 5 },
      );
      assert.equal(providerCalls - callsBefore, 1, 'No automatic provider retry');
      const cookie = response.headers.get('set-cookie') ?? '';
      assert.equal(
        cookie.includes('qoro-auth-session='),
        false,
        'Initial signup may not replace current selector',
      );
      assert.equal(
        /sb-127-auth-token-v2-[a-f0-9]+(?:\.\d+)?=/u.test(cookie),
        false,
        'No session cookie installed',
      );
      if (mode === 'new')
        assert.ok(cookie.includes('-code-verifier=') && cookie.includes('HttpOnly'));
      const [pending] =
        await sql`SELECT auth_attempt_state, row_version, idle_expires_at, absolute_expires_at FROM signup_sessions WHERE token_hash = ${activeHash}`;
      assert.equal(
        pending?.auth_attempt_state,
        mode === 'finish-conflict' ? 'reserved' : failed ? 'uncertain' : 'completed',
      );
      const readback = await fetch(`${baseUrl}/api/signup/sessions/me`, {
        headers: { cookie: `__Host-qoro_signup=${token}` },
      });
      assert.equal(readback.status, 200);
      const state = await readback.json();
      assert.equal(state.session.status, 'email_pending');
      assert.deepEqual(Object.keys(state.session).sort(), [
        'answers',
        'expiresAt',
        'riskLevel',
        'rowVersion',
        'status',
      ]);
      assert.equal(
        (await postAuth(token, 'synthetic@example.invalid', pending?.row_version)).status,
        409,
      );
      assert.equal(providerCalls - callsBefore, 1);
      const [after] =
        await sql`SELECT idle_expires_at, absolute_expires_at FROM signup_sessions WHERE token_hash = ${activeHash}`;
      assert.equal(after?.idle_expires_at.getTime(), pending?.idle_expires_at.getTime());
      assert.equal(after?.absolute_expires_at.getTime(), pending?.absolute_expires_at.getTime());
      if (mode === 'new') pendingUiToken = token;
      authProofs.push({
        name: `real HTTP/SDK ${mode}: uniform response, no retry/session, frozen pending`,
        status: 'PASS',
        durationMs: requestDurationMs,
      });
    }
    // Senha recusada pelo provider: contrato próprio, porque não depende de conta
    // e prova que nada foi enviado. A reserva volta atrás e a pessoa tenta de novo
    // na hora — sem isso, `password_hibp_enabled` transformava senha comum em
    // espera eterna.
    {
      await controlRedis('clear');
      providerMode = 'weak_password';
      const token = await seedAuth('weak-password');
      const callsBefore = providerCalls;
      const { response } = await postAuthAfterLocalLimiterReady(token);

      assert.equal(response.status, 422);
      const rejected = await response.text();
      assert.deepEqual(JSON.parse(rejected), { error: 'weak_password' });
      assert.equal(rejected.includes('synthetic@example.invalid'), false);
      assert.equal(rejected.includes('Abcdef1!'), false);
      assert.equal(providerCalls - callsBefore, 1);

      const [returned] = await sql`SELECT status, row_version, auth_attempt_kind,
        auth_attempt_state, auth_attempted_at, owner_name, clinic_name, accepted_at
        FROM signup_sessions WHERE token_hash = ${activeHash}`;
      // Estado anterior à reserva, inteiro: etapa de volta, tentativa zerada e
      // staging preservado — os CHECKs de 0099 recusariam qualquer outra coisa.
      assert.equal(returned?.status, 'identity_pending');
      assert.equal(returned?.auth_attempt_kind, null);
      assert.equal(returned?.auth_attempt_state, null);
      assert.equal(returned?.auth_attempted_at, null);
      assert.equal(returned?.owner_name, 'Synthetic owner');
      assert.ok(returned?.accepted_at instanceof Date);
      assert.equal(returned?.row_version, 5);

      const meAfter = await fetch(`${baseUrl}/api/signup/sessions/me`, {
        headers: { cookie: `__Host-qoro_signup=${token}` },
      });
      assert.equal((await meAfter.json()).session.status, 'identity_pending');

      // Nova senha imediatamente: sem cooldown, sem reenvio, uma chamada a mais.
      providerMode = 'new';
      expectedReservedVersion = 6;
      const retry = await postAuth(token, 'synthetic@example.invalid', 5);
      assert.equal(retry.status, 200);
      assert.deepEqual(await retry.json(), { rowVersion: 7 });
      assert.equal(providerCalls - callsBefore, 2);
      const [sent] = await sql`SELECT status, auth_attempt_state FROM signup_sessions
        WHERE token_hash = ${activeHash}`;
      assert.equal(sent?.status, 'email_pending');
      assert.equal(sent?.auth_attempt_state, 'completed');
      expectedReservedVersion = 4;
      await sql`DELETE FROM signup_sessions WHERE token_hash = ${activeHash}`;
      authProofs.push({
        name: 'real HTTP/SDK weak_password: reservation returned, retry allowed immediately, no email claimed',
        status: 'PASS',
      });
    }

    for (const mode of ['new', 'verified', 'unverified', 'user_already_exists']) {
      await controlRedis('clear');
      providerMode = mode;
      const token = await seedAuth(`timing-${mode}`);
      const { durationMs, response } = await postAuthAfterLocalLimiterReady(token);
      accountDurationSamples.push(durationMs);
      assert.equal(response.status, 200, `warmed account timing ${mode}`);
      assert.deepEqual(await response.json(), { rowVersion: 5 });
    }
    assert.ok(
      Math.max(...accountDurationSamples) - Math.min(...accountDurationSamples) <= 500,
      `Synthetic account timing spread exceeded 500ms: ${accountDurationSamples.join(',')}`,
    );
    assert.ok(pendingUiToken, 'Pending UI token was not captured');
    const { chromium } = await import('@playwright/test');
    browser = await chromium.launch({ headless: true });
    const pendingUiCallsBefore = providerCalls;
    const pendingUiContext = await browser.newContext({ baseURL: baseUrl });
    try {
      await pendingUiContext.addCookies([
        {
          name: '__Host-qoro_signup',
          value: pendingUiToken,
          domain: '127.0.0.1',
          path: '/',
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
      ]);
      const page = await pendingUiContext.newPage();
      await page.goto('/cadastro');
      await page.getByText(/Se houver uma etapa de confirmação/u).waitFor();
      // A espera não reabre pergunta nenhuma: as quatro telas saem do DOM, em
      // vez de ficarem renderizadas e desabilitadas.
      assert.equal(await page.getByRole('radio').count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Continuar' }).count(), 0);
      assert.equal(await page.getByLabel('Seu nome').count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Salvar e continuar' }).count(), 0);
      assert.equal(providerCalls, pendingUiCallsBefore);
    } finally {
      await pendingUiContext.close();
    }
    await controlRedis('clear');
    providerMode = 'concurrent';
    const concurrentToken = await seedAuth('concurrent'),
      callsBefore = providerCalls;
    const responses = await Promise.all([postAuth(concurrentToken), postAuth(concurrentToken)]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    assert.equal(providerCalls - callsBefore, 1);
    authProofs.push({
      name: 'real HTTP concurrent requests: one CAS winner and one SDK call',
      status: 'PASS',
    });
    await controlRedis('clear');
    providerMode = 'new';
    const lostToken = await seedAuth('lost-response'),
      lostBefore = providerCalls;
    const lostContext = await browser.newContext({ baseURL: baseUrl });
    try {
      await lostContext.addCookies([
        {
          name: '__Host-qoro_signup',
          value: lostToken,
          domain: '127.0.0.1',
          path: '/',
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
      ]);
      const page = await lostContext.newPage();
      await page.goto('/cadastro');
      await page.route('**/api/signup/sessions/auth', async (route) => {
        const response = await route.fetch();
        const responseBody = await response.json();
        assert.equal(
          response.status(),
          200,
          `lost-response auth route: ${JSON.stringify(responseBody)}`,
        );
        await route.abort('failed'); // Real commit happened, browser loses HTTP response.
      });
      const lost = await page.evaluate(async () => {
        try {
          await fetch('/api/signup/sessions/auth', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              rowVersion: 3,
              email: 'synthetic@example.invalid',
              password: 'Abcdef1!',
              accepted: true,
            }),
          });
          return false;
        } catch {
          return true;
        }
      });
      assert.equal(lost, true);
      await page.reload();
      await page.getByText(/Se houver uma etapa de confirmação/u).waitFor();
      assert.equal(await page.getByRole('radio').count(), 0);
      assert.equal(providerCalls - lostBefore, 1);
      const [saved] =
        await sql`SELECT status, auth_attempt_state, row_version FROM signup_sessions WHERE token_hash = ${activeHash}`;
      assert.deepEqual(saved, {
        status: 'email_pending',
        auth_attempt_state: 'completed',
        row_version: 5,
      });
    } finally {
      await lostContext.close();
    }
    authProofs.push({
      name: 'real Chromium lost POST response: committed attempt survives reload without resend',
      status: 'PASS',
    });
    await controlRedis('clear');
    providerMode = 'new';
    const rateBefore = providerCalls;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const token = await seedAuth(`rate-${attempt}`, 'rate@example.invalid');
      const response = await postAuth(token, 'rate@example.invalid');
      assert.equal(response.status, attempt === 4 ? 429 : 200);
      if (attempt === 4) assert.ok(Number(response.headers.get('retry-after')) > 0);
    }
    assert.equal(providerCalls - rateBefore, 3);
    authProofs.push({
      name: 'real Upstash SDK: fourth email HMAC bucket request blocked before Auth',
      status: 'PASS',
    });
    await controlRedis('clear');
    await controlRedis('unavailable', true);
    const unavailableToken = await seedAuth('redis-unavailable'),
      unavailableBefore = providerCalls;
    assert.equal((await postAuth(unavailableToken)).status, 503);
    assert.equal(providerCalls, unavailableBefore);
    const [notReserved] =
      await sql`SELECT status, auth_attempt_kind FROM signup_sessions WHERE token_hash = ${activeHash}`;
    assert.equal(notReserved?.status, 'identity_pending');
    assert.equal(notReserved?.auth_attempt_kind, null);
    await controlRedis('unavailable', false);
    await controlRedis('clear');
    authProofs.push({
      name: 'real HTTP unavailable Redis: zero CAS/provider, no fallback',
      status: 'PASS',
    });

    for (const state of ['completed', 'uncertain', 'reserved'] as const) {
      await controlRedis('clear');
      resendMode = 'success';
      const seeded = await seedResend(`recover-${state}`, state);
      const callsBefore = resendCalls;
      const [before] = await sql`SELECT idle_expires_at, absolute_expires_at
        FROM signup_sessions WHERE token_hash = ${seeded.tokenHash}`;
      const response = await postResend(seeded.token);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { rowVersion: 7 });
      assert.equal(resendCalls - callsBefore, 1);
      const [saved] = await sql`SELECT auth_attempt_kind, auth_attempt_state, row_version,
        idle_expires_at, absolute_expires_at FROM signup_sessions
        WHERE token_hash = ${seeded.tokenHash}`;
      assert.equal(saved?.auth_attempt_kind, 'resend');
      assert.equal(saved?.auth_attempt_state, 'completed');
      assert.equal(saved?.row_version, 7);
      assert.equal(saved?.idle_expires_at.getTime(), before?.idle_expires_at.getTime());
      assert.equal(saved?.absolute_expires_at.getTime(), before?.absolute_expires_at.getTime());
      const cooldown = await postResend(seeded.token, 7);
      assert.equal(cooldown.status, 429);
      assert.ok(Number(cooldown.headers.get('retry-after')) >= 1);
      assert.equal(resendCalls - callsBefore, 1);
      const [afterCooldown] = await sql`SELECT auth_attempt_kind, auth_attempt_state,
        row_version, idle_expires_at, absolute_expires_at FROM signup_sessions
        WHERE token_hash = ${seeded.tokenHash}`;
      assert.deepEqual(afterCooldown, saved);
      await sql`DELETE FROM signup_sessions WHERE token_hash = ${seeded.tokenHash}`;
    }
    authProofs.push({
      name: 'real SDK resend: completed/uncertain/abandoned reservation recover after DB cooldown, immediate repeat denied',
      status: 'PASS',
    });

    await controlRedis('clear');
    resendMode = 'concurrent';
    const concurrentResend = await seedResend('concurrent');
    const resendBefore = resendCalls;
    const resendResponses = await Promise.all([
      postResend(concurrentResend.token),
      postResend(concurrentResend.token),
    ]);
    assert.deepEqual(resendResponses.map((response) => response.status).sort(), [200, 409]);
    assert.equal(resendCalls - resendBefore, 1);
    await sql`DELETE FROM signup_sessions WHERE token_hash = ${concurrentResend.tokenHash}`;
    authProofs.push({
      name: 'real HTTP concurrent resend: one CAS winner and one SDK call',
      status: 'PASS',
    });

    for (const mode of ['provider-5xx', 'timeout'] as const) {
      await controlRedis('clear');
      resendMode = mode;
      const seeded = await seedResend(mode);
      const callsBefore = resendCalls;
      const startedAt = performance.now();
      const response = await postResend(seeded.token);
      const durationMs = Math.round(performance.now() - startedAt);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'unavailable' });
      assert.equal(resendCalls - callsBefore, 1);
      if (mode === 'timeout') assert.ok(durationMs >= 15_000 && durationMs <= 30_000);
      const [uncertain] = await sql`SELECT auth_attempt_kind, auth_attempt_state, row_version
        FROM signup_sessions WHERE token_hash = ${seeded.tokenHash}`;
      assert.deepEqual(uncertain, {
        auth_attempt_kind: 'resend',
        auth_attempt_state: 'uncertain',
        row_version: 7,
      });
      await sql`DELETE FROM signup_sessions WHERE token_hash = ${seeded.tokenHash}`;
    }
    authProofs.push({
      name: 'real SDK resend 5xx/timeout: one call, uncertain reservation and no automatic retry',
      status: 'PASS',
    });

    await controlRedis('clear');
    resendMode = 'success';
    const rateResends: { token: string; tokenHash: string }[] = [];
    const rateCallsBefore = resendCalls;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const seeded = await seedResend(`rate-${attempt}`);
      rateResends.push(seeded);
      const response = await postResend(seeded.token);
      assert.equal(response.status, attempt === 4 ? 429 : 200);
      if (attempt === 4) assert.ok(Number(response.headers.get('retry-after')) > 0);
    }
    assert.equal(resendCalls - rateCallsBefore, 3);
    for (const seeded of rateResends)
      await sql`DELETE FROM signup_sessions WHERE token_hash = ${seeded.tokenHash}`;
    authProofs.push({
      name: 'real Upstash SDK resend: fourth email HMAC bucket request blocked before Auth',
      status: 'PASS',
    });

    await controlRedis('clear');
    const unavailableResend = await seedResend('redis-unavailable');
    await controlRedis('unavailable', true);
    const unavailableResendBefore = resendCalls;
    assert.equal((await postResend(unavailableResend.token)).status, 503);
    assert.equal(resendCalls, unavailableResendBefore);
    const [unchangedResend] = await sql`SELECT auth_attempt_kind, auth_attempt_state, row_version
      FROM signup_sessions WHERE token_hash = ${unavailableResend.tokenHash}`;
    assert.deepEqual(unchangedResend, {
      auth_attempt_kind: 'initial',
      auth_attempt_state: 'completed',
      row_version: 5,
    });
    await controlRedis('unavailable', false);
    await sql`DELETE FROM signup_sessions WHERE token_hash = ${unavailableResend.tokenHash}`;
    authProofs.push({
      name: 'real HTTP resend unavailable Redis: zero reservation/provider and no fallback',
      status: 'PASS',
    });

    providerMode = 'otp-success';
    for (const next of [
      '/dashboard',
      '/cadastro/continuar?draft=secret',
      '/cadastro/continuar#access-token',
      'https://evil.example/steal',
    ]) {
      const otpContext = await browser.newContext({ baseURL: baseUrl });
      try {
        assert.deepEqual(
          await otpContext.cookies(),
          [],
          'OTP context must start without PKCE/session',
        );
        const page = await otpContext.newPage();
        const verifyBefore = otpVerifyCalls;
        const getUserBefore = getUserCalls;
        await page.goto(
          `/auth/confirm?token_hash=synthetic-signup-token&type=signup&next=${encodeURIComponent(next)}`,
        );
        await page.getByText('E-mail confirmado', { exact: true }).waitFor();
        const destination = new URL(page.url());
        assert.equal(destination.pathname, '/cadastro/continuar');
        assert.equal(destination.search, '');
        assert.equal(destination.hash, '');
        assert.equal(otpVerifyCalls - verifyBefore, 1);
        assert.equal(
          getUserCalls - getUserBefore,
          3,
          'confirm route, protected continuation and authenticated draft GET each revalidate getUser',
        );
        const cookies = await otpContext.cookies();
        const selector = cookies.find((entry) => entry.name === 'qoro-auth-session');
        const session = cookies.find((entry) =>
          /^sb-127-auth-token-v2-[a-f0-9]+(?:\.\d+)?$/u.test(entry.name),
        );
        assert.equal(selector?.httpOnly, true);
        assert.equal(session?.httpOnly, true);
        const body = await page.locator('body').innerText();
        assert.equal(body.includes(verifiedOtpUser.email), false);
        assert.equal(body.includes(verifiedOtpUser.id), false);
        assert.equal(body.includes(verifiedOtpToken), false);
      } finally {
        await otpContext.close();
      }
    }
    authProofs.push({
      name: 'real SDK token-hash signup: fixed destination, getUser seam and HttpOnly session',
      status: 'PASS',
    });

    for (const [mode, reason] of [
      ['otp-expired', 'expired'],
      ['otp-invalid', 'invalid_token'],
    ] as const) {
      providerMode = mode;
      const errorContext: import('@playwright/test').BrowserContext = await browser.newContext({
        baseURL: baseUrl,
      });
      try {
        const errorPage: import('@playwright/test').Page = await errorContext.newPage();
        const verifyBefore = otpVerifyCalls;
        const getUserBefore = getUserCalls;
        await errorPage.goto('/auth/confirm?token_hash=synthetic-signup-token&type=signup');
        const errorDestination: URL = new URL(errorPage.url());
        assert.equal(errorDestination.pathname, '/auth/auth-error');
        assert.equal(errorDestination.searchParams.get('reason'), reason);
        assert.equal(otpVerifyCalls - verifyBefore, 1);
        assert.equal(getUserCalls - getUserBefore, 0);
        assert.equal(
          (await errorContext.cookies()).some((entry) =>
            /^sb-127-auth-token-v2-[a-f0-9]+(?:\.\d+)?$/u.test(entry.name),
          ),
          false,
        );
      } finally {
        await errorContext.close();
      }
    }
    assert.equal(appLog.includes('raw-person@example.invalid'), false);
    authProofs.push({
      name: 'real SDK invalid/expired OTP: categorical redirect, no session or raw provider PII log',
      status: 'PASS',
    });

    await controlRedis('clear');
    providerMode = 'otp-success';
    const draftToken = createHash('sha256').update('http-verified-draft').digest('base64url');
    const draftHash = hashToken(draftToken);
    const { hashEmail } = await import('../../src/lib/auth/email-hash');
    await sql`INSERT INTO signup_sessions (
      token_hash, status, row_version, idle_expires_at, absolute_expires_at,
      professionals_band, weekly_appointments_band, current_tooling, discovery_source,
      answered_at, owner_name, clinic_name, email_hash, accepted_at,
      auth_attempt_kind, auth_attempt_state, auth_attempted_at
    ) VALUES (
      ${draftHash}, 'email_pending', 5, now() + interval '10 minutes',
      now() + interval '45 minutes', '2_5', '21_50', 'outro_sistema', 'indicacao_colega',
      now(), 'Bootstrap owner', 'Bootstrap clinic', ${hashEmail(verifiedOtpUser.email)}, now(),
      'initial', 'completed', now()
    )`;
    const draftContext = await browser.newContext({ baseURL: baseUrl });
    let replayContext: import('@playwright/test').BrowserContext | null = null;
    try {
      await draftContext.addCookies([
        {
          name: '__Host-qoro_signup',
          value: draftToken,
          domain: '127.0.0.1',
          path: '/',
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
      ]);
      const page = await draftContext.newPage();
      const [beforeClaim] = await sql`SELECT idle_expires_at, absolute_expires_at
        FROM signup_sessions WHERE token_hash = ${draftHash}`;
      await page.goto('/auth/confirm?token_hash=synthetic-signup-token&type=signup');
      // Sem formulário nenhum: o servidor reencontra o cadastro pelo e-mail que
      // o OTP acabou de verificar e devolve os dados do staging.
      await page.getByText('Cadastro recuperado na conta verificada', { exact: true }).waitFor();
      const recovered = await page.locator('body').innerText();
      assert.match(recovered, /Bootstrap owner/u);
      assert.match(recovered, /Bootstrap clinic/u);
      assert.equal(await page.getByLabel('Seu nome').count(), 0);
      assert.equal(await page.locator('input[type=password]').count(), 0);
      // O cookie sobrevive ao vínculo de propósito: quem limpa é o `/me` que
      // conta à aba original que o e-mail foi confirmado. Limpar antes faria
      // aquela aba anunciar "sessão expirou" logo depois da confirmação.
      assert.equal(
        (await draftContext.cookies()).some((cookie) => cookie.name === '__Host-qoro_signup'),
        true,
      );
      const pendingTab = await page.evaluate(async () => {
        const response = await fetch('/api/signup/sessions/me');
        return { status: response.status, body: await response.json() };
      });
      assert.equal(pendingTab.status, 200);
      assert.equal(pendingTab.body.session.status, 'email_verified');
      assert.equal(pendingTab.body.session.answers, null);
      assert.equal(
        (await draftContext.cookies()).some((cookie) => cookie.name === '__Host-qoro_signup'),
        false,
      );
      const readback = await page.evaluate(async () => {
        const response = await fetch('/api/signup/draft');
        return { status: response.status, body: await response.json() };
      });
      assert.equal(readback.status, 200);
      assert.deepEqual(Object.keys(readback.body).sort(), [
        'absoluteExpiresAt',
        'answers',
        'clinicName',
        'idleExpiresAt',
        'ownerName',
        'rowVersion',
        'status',
      ]);
      const publicDraft = JSON.stringify(readback.body);
      assert.equal(publicDraft.includes(verifiedOtpUser.email), false);
      assert.equal(publicDraft.includes(verifiedOtpUser.id), false);
      assert.equal(publicDraft.includes(draftToken), false);
      const [afterRead] = await sql`SELECT status, auth_user_id, consumed_at, idle_expires_at,
        absolute_expires_at FROM signup_sessions WHERE token_hash = ${draftHash}`;
      assert.equal(afterRead?.status, 'email_verified');
      assert.equal(afterRead?.auth_user_id, verifiedOtpUser.id);
      assert.ok(afterRead?.consumed_at instanceof Date);
      assert.equal(
        afterRead?.idle_expires_at.getTime(),
        afterRead?.absolute_expires_at.getTime(),
        'draft vinculado perde a janela de inatividade separada',
      );
      assert.equal(
        afterRead?.absolute_expires_at.getTime(),
        beforeClaim?.absolute_expires_at.getTime(),
      );

      // Outro navegador com a MESMA sessão verificada copiada não recria nem
      // sobrescreve nada: o usuário já é dono de um draft, e o recomeço dá 409.
      replayContext = await browser.newContext({ baseURL: baseUrl });
      await replayContext.addCookies(await draftContext.cookies());
      const replayPage = await replayContext.newPage();
      await replayPage.goto('/cadastro/continuar');
      const replay = await replayPage.evaluate(async () => {
        const response = await fetch('/api/signup/draft', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ownerName: 'Pessoa HTTP',
            clinicName: 'Clínica HTTP',
            answers: {
              professionalsBand: '2_5',
              weeklyAppointmentsBand: '21_50',
              currentTooling: 'outro_sistema',
              discoverySource: 'indicacao_colega',
            },
            accepted: true,
          }),
        });
        return { status: response.status, body: await response.json() };
      });
      assert.deepEqual(replay, { status: 409, body: { error: 'conflict' } });
      const [afterReplay] = await sql`SELECT row_version, auth_user_id, consumed_at,
        idle_expires_at, absolute_expires_at FROM signup_sessions WHERE token_hash = ${draftHash}`;
      assert.equal(afterReplay?.row_version, 6);
      assert.equal(afterReplay?.auth_user_id, verifiedOtpUser.id);
      assert.equal(afterReplay?.consumed_at.getTime(), afterRead?.consumed_at.getTime());
      assert.equal(afterReplay?.idle_expires_at.getTime(), afterRead?.idle_expires_at.getTime());
      assert.equal(
        afterReplay?.absolute_expires_at.getTime(),
        afterRead?.absolute_expires_at.getTime(),
      );

      await controlRedis('clear');
      await page.getByRole('link', { name: 'Escolher plano' }).click();
      await page.getByRole('heading', { name: 'Escolha seu plano' }).waitFor();
      await page.waitForFunction(
        () => document.querySelectorAll<HTMLInputElement>('input[type="radio"]').length === 2,
      );
      assert.equal(await page.getByRole('radio').count(), 2);
      const planBody = await page.locator('body').innerText();
      assert.match(planBody, /R\$\s*149,00 por mês/u);
      assert.match(planBody, /7 dias grátis/u);
      const planRead = await page.evaluate(async () => {
        const response = await fetch('/api/signup/plan');
        return { status: response.status, body: await response.json() };
      });
      assert.equal(planRead.status, 200);
      assert.equal(planRead.body.clinicName, 'Bootstrap clinic');
      assert.equal(planRead.body.trialDays, 7);
      assert.deepEqual(
        planRead.body.plans.map((plan: { code: string; priceCents: number }) => [
          plan.code,
          plan.priceCents,
        ]),
        // Ordenado por NOME: "Clinica" antes de "Solo".
        [
          ['clinica', 24_990],
          ['solo', 14_900],
        ],
      );
      const injected = await page.evaluate(async (planId) => {
        const response = await fetch('/api/signup/plan', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rowVersion: 6, planId, priceCents: 1, trialDays: 999 }),
        });
        return { status: response.status, body: await response.json() };
      }, SELF_SERVICE_PLAN_ID);
      assert.deepEqual(injected, { status: 400, body: { error: 'invalid_body' } });

      await page.getByText('Solo', { exact: true }).click();
      assert.equal(await page.getByRole('radio', { name: /Solo/u }).isChecked(), true);
      await page.getByRole('button', { name: 'Salvar plano' }).click();
      await page.getByText('Plano salvo', { exact: true }).waitFor();
      const [selectedPlan] = await sql`SELECT selected_plan_id, row_version, idle_expires_at,
        absolute_expires_at FROM signup_sessions WHERE token_hash = ${draftHash}`;
      assert.equal(selectedPlan?.selected_plan_id, SELF_SERVICE_PLAN_ID);
      assert.equal(selectedPlan?.row_version, 7);
      // Escolher plano NÃO mexe no prazo: num draft vinculado o idle já é o
      // absoluto, e renovar com `least(now() + idle, absoluto)` o encurtaria.
      assert.equal(
        selectedPlan?.idle_expires_at.getTime(),
        afterRead?.idle_expires_at.getTime(),
        'escolher plano não pode encurtar nem estender o prazo do draft',
      );
      assert.equal(
        selectedPlan?.absolute_expires_at.getTime(),
        afterRead?.absolute_expires_at.getTime(),
      );

      const retry = await page.evaluate(
        async ({ planId }) => {
          const response = await fetch('/api/signup/plan', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ rowVersion: 6, planId }),
          });
          return { status: response.status, body: await response.json() };
        },
        { planId: SELF_SERVICE_PLAN_ID },
      );
      assert.deepEqual(retry, {
        status: 200,
        body: { rowVersion: 7, selectedPlanId: SELF_SERVICE_PLAN_ID },
      });
      const staleOther = await page.evaluate(
        async ({ planId }) => {
          const response = await fetch('/api/signup/plan', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ rowVersion: 6, planId }),
          });
          return { status: response.status, body: await response.json() };
        },
        { planId: SELF_SERVICE_OTHER_PLAN_ID },
      );
      assert.deepEqual(staleOther, { status: 409, body: { error: 'conflict' } });
      const inactive = await page.evaluate(
        async ({ planId }) => {
          const response = await fetch('/api/signup/plan', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ rowVersion: 7, planId }),
          });
          return { status: response.status, body: await response.json() };
        },
        { planId: SELF_SERVICE_INACTIVE_PLAN_ID },
      );
      assert.deepEqual(inactive, { status: 422, body: { error: 'invalid_plan' } });
    } finally {
      if (replayContext) await replayContext.close();
      await draftContext.close();
      await sql`DELETE FROM signup_sessions WHERE token_hash = ${draftHash}`;
    }
    authProofs.push({
      name: 'real Auth/browser UI claim: cross-device recovery without retyping, consumed owner, stable TTL and copied-cookie replay denied',
      status: 'PASS',
    });

    await controlRedis('clear');
    const restartContext = await browser.newContext({ baseURL: baseUrl });
    try {
      const restartPage = await restartContext.newPage();
      await restartPage.goto('/auth/confirm?token_hash=synthetic-signup-token&type=signup');
      await restartPage.getByText(/Não encontramos um cadastro em andamento/u).waitFor();
      assert.equal(
        (await restartContext.cookies()).some((cookie) => cookie.name === '__Host-qoro_signup'),
        false,
      );
      await restartPage.getByLabel('Seu nome').fill('Pessoa Restart');
      await restartPage.getByLabel('Nome da clínica').fill('Clínica Restart');
      await restartPage.getByLabel('Profissionais').selectOption('2_5');
      await restartPage.getByLabel('Atendimentos por semana').selectOption('21_50');
      await restartPage.getByLabel('Organização atual').selectOption('outro_sistema');
      await restartPage.getByLabel('Como conheceu a Qoro').selectOption('indicacao_colega');
      await restartPage.getByRole('checkbox').check();
      await restartPage.getByRole('button', { name: 'Confirmar e continuar' }).click();
      await restartPage
        .getByText('Cadastro recuperado na conta verificada', { exact: true })
        .waitFor();
      const [restarted] = await sql`SELECT status, auth_user_id, consumed_at, owner_name,
        clinic_name, row_version FROM signup_sessions WHERE auth_user_id = ${verifiedOtpUser.id}`;
      assert.equal(restarted?.status, 'email_verified');
      assert.equal(restarted?.auth_user_id, verifiedOtpUser.id);
      assert.ok(restarted?.consumed_at instanceof Date);
      assert.equal(restarted?.owner_name, 'Pessoa Restart');
      assert.equal(restarted?.clinic_name, 'Clínica Restart');
      assert.equal(restarted?.row_version, 1);
      const restartPublic = await restartPage.locator('body').innerText();
      assert.equal(restartPublic.includes(verifiedOtpUser.email), false);
      assert.equal(restartPublic.includes(verifiedOtpUser.id), false);
      await sql`DELETE FROM signup_sessions WHERE auth_user_id = ${verifiedOtpUser.id}`;
    } finally {
      await restartContext.close();
    }
    authProofs.push({
      name: 'real Auth/browser UI restart: another browser re-enters all fields and owns a sanitized draft',
      status: 'PASS',
    });

    assert.deepEqual(providerFailures, []);
    await mkdir(path.join(root, 'dist/signup-regression'), { recursive: true });
    await writeFile(
      path.join(root, 'dist/signup-regression/auth-http-results.json'),
      JSON.stringify(
        {
          environment: 'loopback synthetic Auth/Redis, real installed SDK and disposable Postgres',
          results: authProofs,
        },
        null,
        2,
      ),
    );
    const context = await browser.newContext({ baseURL: baseUrl });
    try {
      const [before] = await sql`SELECT count(*)::int AS n FROM signup_sessions`;
      const page = await context.newPage();
      await page.goto('/cadastro');
      // Uma pergunta por tela: só as opções da pergunta atual existem no DOM.
      await page
        .getByRole('heading', { name: 'Quantos profissionais atendem na clínica?' })
        .waitFor();

      assert.equal(await page.getByRole('radio').count(), 4);
      assert.equal(await page.getByText('Pergunta 1 de 4').count(), 1);
      assert.equal(await page.getByRole('textbox').count(), 0);
      assert.equal(
        await page.locator('input[type=email], input[type=password], textarea').count(),
        0,
      );
      const cookies = await context.cookies();
      const cookie = cookies.find((entry) => entry.name === '__Host-qoro_signup');
      assert.ok(cookie, 'navegador não armazenou __Host-qoro_signup');
      assert.equal(cookie.httpOnly, true);
      assert.equal(cookie.secure, true);
      assert.equal(cookie.sameSite, 'Lax');
      const [afterOpen] = await sql`SELECT count(*)::int AS n FROM signup_sessions`;
      assert.equal(afterOpen?.n, Number(before?.n) + 1);

      await mkdir(path.join(root, 'dist/signup-regression'), { recursive: true });
      await page.screenshot({
        path: path.join(root, 'dist/signup-regression/signup-page.png'),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: path.join(root, 'dist/signup-regression/signup-page-mobile.png'),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1280, height: 720 });

      const first = page.getByRole('radio', { name: '1 profissional' });
      await first.focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.getByRole('radio', { name: '2 a 5' }).isChecked(), true);

      // Avançar e voltar não perde a escolha, e nada vai ao servidor no caminho.
      await page.getByRole('button', { name: 'Continuar' }).click();
      await page
        .getByRole('heading', { name: 'Quantos atendimentos são realizados por semana?' })
        .waitFor();
      await page.getByRole('button', { name: 'Voltar' }).click();
      await page
        .getByRole('heading', { name: 'Quantos profissionais atendem na clínica?' })
        .waitFor();
      assert.equal(await page.getByRole('radio', { name: '2 a 5' }).isChecked(), true);
      const [afterNavigation] = await sql`SELECT row_version FROM signup_sessions
        WHERE token_hash = ${hashToken(cookie.value)}`;
      assert.equal(afterNavigation?.row_version, 1, 'navegar entre perguntas escreveu no banco');

      await answerAllQuestions(page);

      // A segunda aba lê a mesma versão antes de a primeira vencer o CAS.
      const secondPage = await context.newPage();
      await secondPage.goto('/cadastro');
      await secondPage
        .getByRole('heading', { name: 'Quantos profissionais atendem na clínica?' })
        .waitFor();

      const rateLimited = async (route: Route) => {
        await route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'rate_limited' }),
        });
      };
      await page.route('**/api/signup/sessions/answers', rateLimited);
      await page.getByRole('button', { name: 'Salvar e continuar' }).click();
      await page.getByText(/Aguarde um minuto antes de salvar/u).waitFor();
      await page.unroute('**/api/signup/sessions/answers', rateLimited);
      // A tela continua na última pergunta, com a escolha preservada.
      assert.equal(
        await page.getByRole('radio', { name: 'Indicação de um colega' }).isChecked(),
        true,
      );

      const disconnected = async (route: Route) => route.abort('failed');
      await page.route('**/api/signup/sessions/answers', disconnected);
      await page.getByRole('button', { name: 'Salvar e continuar' }).click();
      await page.getByText(/A conexão falhou antes da confirmação/u).waitFor();
      await page.unroute('**/api/signup/sessions/answers', disconnected);

      let releaseRequest = (): void => undefined;
      const holdRequest = new Promise<void>((resolve) => {
        releaseRequest = resolve;
      });
      let answerPosts = 0;
      const delayed = async (route: Route) => {
        answerPosts += 1;
        await holdRequest;
        await route.continue();
      };
      await page.route('**/api/signup/sessions/answers', delayed);
      const submit = page.getByRole('button', { name: 'Salvar e continuar' });
      await submit.click();
      await page.waitForFunction(() =>
        [...document.querySelectorAll<HTMLInputElement>('input[type=radio]')].every(
          (input) => input.disabled,
        ),
      );
      await submit.click({ force: true });
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(answerPosts, 1);
      releaseRequest();
      await page.getByText(/Respostas salvas\. Preencha seus dados/u).waitFor();
      await page.unroute('**/api/signup/sessions/answers', delayed);

      const [saved] = await sql`SELECT token_hash, status, row_version, professionals_band,
        weekly_appointments_band, current_tooling, discovery_source
        FROM signup_sessions ORDER BY created_at DESC LIMIT 1`;
      assert.equal(saved?.status, 'details_complete');
      assert.equal(saved?.row_version, 2);
      assert.equal(saved?.professionals_band, '2_5');
      assert.equal(saved?.weekly_appointments_band, '21_50');
      assert.equal(saved?.current_tooling, 'outro_sistema');
      assert.equal(saved?.discovery_source, 'indicacao_colega');

      // A aba perdedora escolhe OUTRAS respostas nas quatro telas e perde o CAS.
      const loserSteps: [string, string][] = [
        ['16 ou mais', 'Quantos atendimentos são realizados por semana?'],
        ['Mais de 100', 'Como a clínica se organiza hoje?'],
        ['Nada ou papel', 'Como você conheceu a Qoro?'],
      ];
      for (const [option, nextHeading] of loserSteps) {
        await secondPage.getByText(option, { exact: true }).click();
        await secondPage.getByRole('button', { name: 'Continuar' }).click();
        await secondPage.getByRole('heading', { name: nextHeading }).waitFor();
      }
      await secondPage.getByText('Evento ou congresso', { exact: true }).click();
      await secondPage.getByRole('button', { name: 'Salvar e continuar' }).click();
      await secondPage.getByText(/Outra aba salvou primeiro/u).waitFor();
      // A releitura traz as respostas vencedoras e a etapa já avançou: nenhuma
      // pergunta continua editável nesta aba, e nada da escolha perdedora foi gravado.
      await secondPage.getByRole('heading', { name: 'Seus dados e o nome da clínica' }).waitFor();
      assert.equal(await secondPage.getByRole('radio').count(), 0);
      const [notOverwritten] = await sql`SELECT professionals_band, discovery_source, row_version
        FROM signup_sessions ORDER BY created_at DESC LIMIT 1`;
      assert.equal(notOverwritten?.professionals_band, '2_5');
      assert.equal(notOverwritten?.discovery_source, 'indicacao_colega');
      assert.equal(notOverwritten?.row_version, 2);

      await page.reload();
      // Recarregar não volta ao começo: as respostas salvas levam direto à etapa
      // seguinte, sem recriar sessão nem reabrir as quatro telas.
      await page.getByText('Carregamos as respostas salvas nesta sessão.').waitFor();
      assert.equal(await page.getByRole('radio').count(), 0);
      const [afterReload] = await sql`SELECT count(*)::int AS n FROM signup_sessions`;
      assert.equal(afterReload?.n, afterOpen?.n);

      await page.getByRole('heading', { name: 'Seus dados e o nome da clínica' }).waitFor();
      const owner = page.getByRole('textbox', { name: 'Seu nome', exact: true });
      const clinic = page.getByRole('textbox', { name: 'Nome da clínica', exact: true });
      const email = page.getByRole('textbox', { name: 'E-mail', exact: true });
      const password = page.getByLabel('Senha', { exact: true });
      const accepted = page.getByRole('checkbox');
      assert.equal(await accepted.isChecked(), false);
      assert.equal(await page.locator('input[type=password]').count(), 1);
      await owner.fill('Pessoa Browser Sintética');
      await owner.focus();
      await page.keyboard.press('Tab');
      assert.equal(await clinic.evaluate((input) => input === document.activeElement), true);
      await clinic.fill('Clínica Browser Sintética');
      await email.fill('browser.synthetic@example.test');
      await password.fill('sem-regras');
      let identityPosts = 0;
      const lostResponse = async (route: Route) => {
        identityPosts += 1;
        assert.equal(route.request().postData()?.includes('password'), false);
        const response = await route.fetch();
        const responseBody = await response.json();
        assert.equal(response.status(), 200, `identity route: ${JSON.stringify(responseBody)}`);
        assert.deepEqual(responseBody, { rowVersion: 3 });
        await route.abort('failed'); // Actual HTTP+DB committed; browser never receives the response.
      };
      await page.route('**/api/signup/sessions/identity', lostResponse);
      await page.getByRole('button', { name: 'Criar conta e continuar' }).click();
      await page.getByText(/confirme o aceite para continuar/u).waitFor();
      assert.equal(identityPosts, 0, 'PII was transmitted before consent');
      await accepted.check();
      await page.getByRole('button', { name: 'Criar conta e continuar' }).click();
      await page.getByText(/Use de 8 a 72 caracteres, sem espaços/u).waitFor();
      assert.equal(identityPosts, 0, 'invalid password reached staging');
      await password.fill('Abcdef1!');
      await page.getByRole('button', { name: 'Criar conta e continuar' }).click();
      await page.getByText(/A conexão falhou antes da confirmação.*somente nesta tela/u).waitFor();
      await page.unroute('**/api/signup/sessions/identity', lostResponse);
      assert.equal(identityPosts, 1);
      assert.equal(await password.inputValue(), '', 'password survived a staging attempt');
      const [identityRow] = await sql`SELECT status, row_version FROM signup_sessions
        WHERE token_hash = ${hashToken(cookie.value)}`;
      assert.equal(identityRow?.status, 'identity_pending');
      assert.equal(identityRow?.row_version, 3);
      await page.reload();
      await page.getByText(/solicitação da conta ainda não foi confirmada/u).waitFor();
      assert.equal(await page.getByRole('textbox').count(), 0);
      assert.equal(await page.locator('input[type=password]').count(), 0);
      assert.equal(await page.locator('input[type=radio]:enabled').count(), 0);
      assert.equal(
        /Pessoa Browser|Clínica Browser|browser.synthetic/u.test(
          await page.locator('body').innerText(),
        ),
        false,
      );
      assert.equal(
        await page.evaluate(() =>
          /Pessoa Browser|Clínica Browser|browser.synthetic/u.test(
            JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]),
          ),
        ),
        false,
      );

      await page.getByRole('button', { name: 'Retomar criação da conta' }).click();
      assert.equal(await owner.inputValue(), '');
      assert.equal(await password.inputValue(), '');
      assert.equal(await accepted.isChecked(), false);
      await owner.fill('Pessoa Browser Sintética');
      await clinic.fill('Clínica Browser Sintética');
      await email.fill('synthetic@example.invalid');
      await password.fill('Abcdef1!');
      await accepted.check();
      activeHash = hashToken(cookie.value);
      expectedReservedVersion = 5;
      providerMode = 'new';
      await controlRedis('clear');
      const providerBeforeUi = providerCalls;
      let authPosts = 0;
      const lostAuthResponse = async (route: Route) => {
        authPosts += 1;
        assert.equal(route.request().postData()?.includes('Abcdef1!'), true);
        const response = await route.fetch();
        const responseBody = await response.json();
        assert.equal(response.status(), 200, `auth route: ${JSON.stringify(responseBody)}`);
        assert.deepEqual(responseBody, { rowVersion: 6 });
        await route.abort('failed'); // Auth/DB concluíram; o browser perdeu somente a resposta.
      };
      await page.route('**/api/signup/sessions/auth', lostAuthResponse);
      await page.getByRole('button', { name: 'Criar conta e continuar' }).click();
      await page.getByRole('heading', { name: 'Aguardando a confirmação do e-mail' }).waitFor();
      await page.getByText(/Não repetimos automaticamente a criação da conta/u).waitFor();
      await page.unroute('**/api/signup/sessions/auth', lostAuthResponse);
      expectedReservedVersion = 4;
      assert.equal(authPosts, 1);
      assert.equal(providerCalls - providerBeforeUi, 1, 'lost Auth response retried provider');
      assert.equal(await page.locator('input[type=password]').count(), 0);
      const [pendingUi] = await sql`SELECT status, row_version, auth_attempt_kind,
        auth_attempt_state FROM signup_sessions WHERE token_hash = ${activeHash}`;
      assert.deepEqual(pendingUi, {
        status: 'email_pending',
        row_version: 6,
        auth_attempt_kind: 'initial',
        auth_attempt_state: 'completed',
      });
      const pageAndStorage = await page.evaluate(() =>
        JSON.stringify({
          body: document.body.innerText,
          local: Object.entries(localStorage),
          session: Object.entries(sessionStorage),
        }),
      );
      assert.equal(/Pessoa Browser|Clínica Browser|Abcdef1!/u.test(pageAndStorage), false);

      const resendEmail = page.getByLabel('E-mail usado no cadastro');
      const resendAccepted = page.getByRole('checkbox');
      const resendBeforeUi = resendCalls;
      await resendEmail.fill('synthetic@example.invalid');
      await resendAccepted.check();
      await page.getByRole('button', { name: 'Reenviar instruções' }).click();
      await page.getByText(/Aguarde \d+ segundos antes/u).waitFor();
      assert.equal(resendCalls, resendBeforeUi, 'cooldown reached provider');
      assert.equal(await resendEmail.inputValue(), '');
      assert.equal(await resendAccepted.isChecked(), false);

      await sql`UPDATE signup_sessions SET auth_attempted_at = now() - interval '61 seconds'
        WHERE token_hash = ${activeHash}`;
      await controlRedis('clear');
      resendMode = 'success';
      await resendEmail.fill('synthetic@example.invalid');
      await resendAccepted.check();
      await page.getByRole('button', { name: 'Reenviar instruções' }).click();
      await page.getByText(/nova solicitação foi concluída/u).waitFor();
      assert.equal(resendCalls - resendBeforeUi, 1);
      assert.equal(await resendEmail.inputValue(), '');
      assert.equal(await resendAccepted.isChecked(), false);
      const [resentUi] = await sql`SELECT row_version, auth_attempt_kind, auth_attempt_state
        FROM signup_sessions WHERE token_hash = ${activeHash}`;
      assert.deepEqual(resentUi, {
        row_version: 8,
        auth_attempt_kind: 'resend',
        auth_attempt_state: 'completed',
      });
    } finally {
      await context.close();
    }

    const challengeContext = await browser.newContext({ baseURL: baseUrl });
    try {
      const challengePage = await challengeContext.newPage();
      await challengePage.route('**/api/signup/sessions', async (route) => {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'challenge_required' }),
        });
      });
      await challengePage.goto('/cadastro');
      await challengePage.getByText(/Conclua a verificação de segurança/u).waitFor();
      await challengePage.getByRole('button', { name: 'Continuar' }).click();
      await challengePage.getByText(/A verificação ainda não foi concluída/u).waitFor();
    } finally {
      await challengeContext.close();
    }
    assert.ok(redisRequests > 0, 'E2E não atravessou o limiter Redis real');
  } catch (error) {
    const detail =
      error instanceof Error
        ? `${error.stack ?? error.message}${error.cause ? `\ncause: ${String(error.cause)}` : ''}`
        : 'browser journey failed';
    throw new Error(`${detail}\nnext start log:\n${appLog.slice(-4_000)}`, { cause: error });
  } finally {
    await browser?.close();
    providerServer.closeAllConnections();
    if (providerServer.listening)
      await new Promise<void>((resolve, reject) => {
        providerServer.close((error) => (error ? reject(error) : resolve()));
      });
    if (appServer.exitCode === null) appServer.kill();
    await Promise.race([
      new Promise<void>((resolve) => appServer.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ]);
    await controlRedis('stop');
    if (redisFixture.exitCode === null)
      await Promise.race([
        new Promise<void>((resolve) => redisFixture.once('exit', () => resolve())),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Redis fixture stop timeout: ${redisFixtureLog}`)),
            5_000,
          ),
        ),
      ]);
    assert.ok(
      appServer.exitCode !== null || appServer.signalCode !== null,
      'next start não encerrou após o E2E',
    );
  }
}
try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Local PG readiness timeout')), 20_000);
    server.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.once('exit', (code) => {
      clearTimeout(timer);
      // Sem o log do servidor, "exit 1" não diz nada: é o texto do Postgres que
      // aponta porta ocupada, permissão do data dir ou falha de SSL.
      reject(new Error(`Local PG exit ${code}\n${serverLog.slice(-2_000)}`));
    });
    server.stderr.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('ready to accept connections')) {
        clearTimeout(timer);
        resolve();
      }
    });
    if (serverLog.includes('ready to accept connections')) {
      clearTimeout(timer);
      resolve();
    }
  });
  const [settings] = await admin`SELECT current_setting('data_directory') AS dir`;
  assert.equal(path.resolve(String(settings?.dir)), path.resolve(data));
  verified = true;
  await admin.unsafe(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE qoro_runtime NOLOGIN;
    CREATE TABLE _schema_version(version text PRIMARY KEY);
    CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;`);
  for (const file of [
    '0096_signup_sessions.sql',
    '0097_signup_sessions_runtime_revoke.sql',
    '0098_signup_session_answers.sql',
  ]) {
    await admin.unsafe(await readFile(path.join(root, 'drizzle/migrations', file), 'utf8'));
  }
  schemaReady = true;
  const identityMigration = await readFile(
    path.join(root, 'drizzle/migrations/0099_signup_session_identity.sql'),
    'utf8',
  );
  async function downIdentity() {
    // Only this verified, disposable cluster; deliberately drops synthetic PII.
    const [staging] = await admin`SELECT count(*)::int AS n FROM signup_sessions
      WHERE owner_name IS NOT NULL OR clinic_name IS NOT NULL
        OR email_hash IS NOT NULL OR accepted_at IS NOT NULL`;
    assert.equal(staging?.n, 0, 'down refused while staging PII exists; purge first');
    await admin.unsafe(`UPDATE signup_sessions SET status = 'details_complete'
      WHERE status = 'identity_pending';
      ALTER TABLE signup_sessions DROP CONSTRAINT signup_sessions_identity_all_or_none_check,
        DROP CONSTRAINT signup_sessions_identity_values_check,
        DROP CONSTRAINT signup_sessions_identity_pending_check;
      ALTER TABLE signup_sessions DROP COLUMN owner_name, DROP COLUMN clinic_name,
        DROP COLUMN email_hash, DROP COLUMN accepted_at;
      ALTER TABLE signup_sessions DROP CONSTRAINT signup_sessions_status_check;
      ALTER TABLE signup_sessions ADD CONSTRAINT signup_sessions_status_check
        CHECK (status IN ('initiated', 'details_complete', 'expired', 'blocked'));
      DELETE FROM _schema_version WHERE version = 'signup-session-identity';`);
  }
  await check('migration 0099 empty up/down/up, populated volume, RLS and grants', async () => {
    await admin.unsafe(identityMigration);
    await downIdentity();
    await admin.unsafe(`INSERT INTO signup_sessions
      (token_hash, idle_expires_at, absolute_expires_at)
      SELECT md5(n::text) || md5(('old-' || n)::text), now() + interval '10 minutes',
        now() + interval '45 minutes' FROM generate_series(1, 2000) n;`);
    const before =
      await admin`SELECT to_jsonb(s) AS row FROM signup_sessions s ORDER BY token_hash`;
    await admin.unsafe(identityMigration);
    const after = await admin`SELECT to_jsonb(s) - 'owner_name' - 'clinic_name'
      - 'email_hash' - 'accepted_at' AS row FROM signup_sessions s ORDER BY token_hash`;
    assert.equal(after.length, 2000);
    assert.deepEqual(after, before);
    const [pii] = await admin`SELECT count(*)::int AS n FROM signup_sessions
      WHERE num_nonnulls(owner_name, clinic_name, email_hash, accepted_at) <> 0`;
    assert.equal(pii?.n, 0);
    const [rls] = await admin`SELECT relrowsecurity, relforcerowsecurity,
      (SELECT count(*)::int FROM pg_policy WHERE polrelid = 'signup_sessions'::regclass) AS policies
      FROM pg_class WHERE oid = 'signup_sessions'::regclass`;
    assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true, policies: 0 });
    await admin`DELETE FROM signup_sessions`;
  });
  const authMigration = await readFile(
    path.join(root, 'drizzle/migrations/0100_signup_auth_attempt.sql'),
    'utf8',
  );
  async function downAuth() {
    const [attempts] =
      await admin`SELECT count(*)::int AS n FROM signup_sessions WHERE auth_attempt_kind IS NOT NULL`;
    assert.equal(attempts?.n, 0, 'down refused while attempts exist; purge first');
    await admin.unsafe(`ALTER TABLE signup_sessions DROP CONSTRAINT signup_sessions_auth_attempt_check,
      DROP CONSTRAINT signup_sessions_email_pending_check, DROP CONSTRAINT signup_sessions_status_check;
      ALTER TABLE signup_sessions DROP COLUMN auth_attempt_kind, DROP COLUMN auth_attempt_state, DROP COLUMN auth_attempted_at;
      ALTER TABLE signup_sessions ADD CONSTRAINT signup_sessions_status_check
        CHECK (status IN ('initiated', 'details_complete', 'identity_pending', 'expired', 'blocked'));
      DELETE FROM _schema_version WHERE version = 'signup-auth-attempt';`);
  }
  await check(
    'migration 0100 empty up/down/up, populated 2000 rows, no privilege expansion',
    async () => {
      await admin.unsafe(authMigration);
      await downAuth();
      await admin.unsafe(authMigration);
      await downAuth();
      await admin.unsafe(`INSERT INTO signup_sessions (token_hash, idle_expires_at, absolute_expires_at)
      SELECT md5(('auth-old-' || n)::text) || md5(n::text), now() + interval '10 minutes', now() + interval '45 minutes'
      FROM generate_series(1, 2000) n;`);
      const before =
        await admin`SELECT to_jsonb(s) AS row FROM signup_sessions s ORDER BY token_hash`;
      await admin.unsafe(authMigration);
      const after =
        await admin`SELECT to_jsonb(s) - 'auth_attempt_kind' - 'auth_attempt_state' - 'auth_attempted_at' AS row
      FROM signup_sessions s ORDER BY token_hash`;
      assert.deepEqual(after, before);
      for (const role of ['anon', 'authenticated', 'qoro_runtime', 'service_role']) {
        const [grants] =
          await admin`SELECT has_table_privilege(${role}, 'signup_sessions', 'SELECT,INSERT,UPDATE,DELETE') AS allowed`;
        assert.equal(grants?.allowed, role === 'service_role');
      }
      const [rls] = await admin`SELECT relrowsecurity, relforcerowsecurity,
      (SELECT count(*)::int FROM pg_policy WHERE polrelid = 'signup_sessions'::regclass) AS policies
      FROM pg_class WHERE oid = 'signup_sessions'::regclass`;
      assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true, policies: 0 });
      await admin`DELETE FROM signup_sessions`;
    },
  );
  const ownershipMigration = await readFile(
    path.join(root, 'drizzle/migrations/0101_signup_draft_ownership.sql'),
    'utf8',
  );
  async function downOwnership() {
    const [owned] = await admin`SELECT count(*)::int AS n FROM signup_sessions
      WHERE auth_user_id IS NOT NULL OR consumed_at IS NOT NULL OR status = 'email_verified'`;
    assert.equal(owned?.n, 0, 'down refused while owned/consumed drafts exist; purge first');
    await admin.unsafe(`ALTER TABLE signup_sessions
      DROP CONSTRAINT signup_sessions_email_verified_owner_check,
      DROP CONSTRAINT signup_sessions_auth_user_id_unique,
      DROP CONSTRAINT signup_sessions_auth_attempt_check,
      DROP CONSTRAINT signup_sessions_status_check;
      ALTER TABLE signup_sessions DROP COLUMN auth_user_id;
      ALTER TABLE signup_sessions ADD CONSTRAINT signup_sessions_auth_attempt_check CHECK (
        num_nonnulls(auth_attempt_kind, auth_attempt_state, auth_attempted_at) IN (0, 3)
        AND (auth_attempt_kind IS NULL OR (
          auth_attempt_kind IN ('initial', 'resend')
          AND auth_attempt_state IN ('reserved', 'completed', 'uncertain')
          AND status IN ('email_pending', 'blocked', 'expired')
        ))
      );
      ALTER TABLE signup_sessions ADD CONSTRAINT signup_sessions_status_check
        CHECK (status IN ('initiated', 'details_complete', 'identity_pending', 'email_pending', 'expired', 'blocked'));
      DELETE FROM _schema_version WHERE version = 'signup-draft-ownership';`);
  }
  await check(
    'migration 0101 empty up/down/up, populated 2000 rows, unique owner and no privilege expansion',
    async () => {
      await admin.unsafe(ownershipMigration);
      await downOwnership();
      await admin.unsafe(ownershipMigration);
      await downOwnership();
      await admin.unsafe(`INSERT INTO signup_sessions (token_hash, idle_expires_at, absolute_expires_at)
        SELECT md5(('owner-old-' || n)::text) || md5(n::text), now() + interval '10 minutes',
          now() + interval '45 minutes' FROM generate_series(1, 2000) n;`);
      const before =
        await admin`SELECT to_jsonb(s) AS row FROM signup_sessions s ORDER BY token_hash`;
      await admin.unsafe(ownershipMigration);
      const after = await admin`SELECT to_jsonb(s) - 'auth_user_id' AS row
        FROM signup_sessions s ORDER BY token_hash`;
      assert.equal(after.length, 2000);
      assert.deepEqual(after, before);
      const [owners] =
        await admin`SELECT count(*)::int AS n FROM signup_sessions WHERE auth_user_id IS NOT NULL`;
      assert.equal(owners?.n, 0);
      for (const role of ['anon', 'authenticated', 'qoro_runtime', 'service_role']) {
        const [grants] =
          await admin`SELECT has_table_privilege(${role}, 'signup_sessions', 'SELECT,INSERT,UPDATE,DELETE') AS allowed`;
        assert.equal(grants?.allowed, role === 'service_role');
      }
      const [rls] = await admin`SELECT relrowsecurity, relforcerowsecurity,
        (SELECT count(*)::int FROM pg_policy WHERE polrelid = 'signup_sessions'::regclass) AS policies
        FROM pg_class WHERE oid = 'signup_sessions'::regclass`;
      assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true, policies: 0 });
      await admin`DELETE FROM signup_sessions`;
    },
  );
  await admin.unsafe(`CREATE TABLE plans (
      id uuid PRIMARY KEY,
      code text NOT NULL UNIQUE,
      name text NOT NULL,
      ativo boolean NOT NULL DEFAULT true
    );`);
  const planMigration = await readFile(
    path.join(root, 'drizzle/migrations/0102_signup_plan_selection.sql'),
    'utf8',
  );
  async function downPlanSelection() {
    const [selected] =
      await admin`SELECT count(*)::int AS n FROM signup_sessions WHERE selected_plan_id IS NOT NULL`;
    assert.equal(selected?.n, 0, 'down refused while selected plans exist; purge first');
    await admin.unsafe(`ALTER TABLE signup_sessions
      DROP CONSTRAINT signup_sessions_selected_plan_id_fk;
      ALTER TABLE signup_sessions DROP COLUMN selected_plan_id;
      DELETE FROM _schema_version WHERE version = 'signup-plan-selection';`);
  }
  await check(
    'migration 0102 empty up/down/up, populated 2000 rows, FK, RLS and grants preserved',
    async () => {
      await admin.unsafe(planMigration);
      await downPlanSelection();
      await admin.unsafe(planMigration);
      await downPlanSelection();
      await admin.unsafe(`INSERT INTO signup_sessions (token_hash, idle_expires_at, absolute_expires_at)
        SELECT md5(('plan-old-' || n)::text) || md5(n::text), now() + interval '10 minutes',
          now() + interval '45 minutes' FROM generate_series(1, 2000) n;`);
      const before =
        await admin`SELECT to_jsonb(s) AS row FROM signup_sessions s ORDER BY token_hash`;
      await admin.unsafe(planMigration);
      const after = await admin`SELECT to_jsonb(s) - 'selected_plan_id' AS row
        FROM signup_sessions s ORDER BY token_hash`;
      assert.equal(after.length, 2000);
      assert.deepEqual(after, before);
      const [fk] = await admin`SELECT confdeltype FROM pg_constraint
        WHERE conname = 'signup_sessions_selected_plan_id_fk'
          AND conrelid = 'signup_sessions'::regclass`;
      assert.equal(fk?.confdeltype, 'r');
      for (const role of ['anon', 'authenticated', 'qoro_runtime', 'service_role']) {
        const [grants] =
          await admin`SELECT has_table_privilege(${role}, 'signup_sessions', 'SELECT,INSERT,UPDATE,DELETE') AS allowed`;
        assert.equal(grants?.allowed, role === 'service_role');
      }
      const [rls] = await admin`SELECT relrowsecurity, relforcerowsecurity,
        (SELECT count(*)::int FROM pg_policy WHERE polrelid = 'signup_sessions'::regclass) AS policies
        FROM pg_class WHERE oid = 'signup_sessions'::regclass`;
      assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true, policies: 0 });
      await admin`DELETE FROM signup_sessions`;
    },
  );
  await admin.unsafe(`CREATE TABLE prices (
      id uuid PRIMARY KEY,
      plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
      amount numeric(12,2) NOT NULL,
      currency text NOT NULL DEFAULT 'BRL',
      billing_cycle text NOT NULL,
      active_from timestamptz NOT NULL DEFAULT now(),
      active_until timestamptz,
      campaign_code text
    );
    INSERT INTO plans (id, code, name, ativo) VALUES
      ('${SELF_SERVICE_PLAN_ID}', 'solo', 'Solo', true),
      ('${SELF_SERVICE_OTHER_PLAN_ID}', 'clinica', 'Clinica', true),
      ('${SELF_SERVICE_INACTIVE_PLAN_ID}', 'pro', 'Pro', false);
    INSERT INTO prices (id, plan_id, amount, currency, billing_cycle, campaign_code) VALUES
      ('dddddddd-4444-4444-8444-444444444444', '${SELF_SERVICE_PLAN_ID}', 149.00, 'BRL', 'monthly', NULL),
      ('eeeeeeee-5555-4555-8555-555555555555', '${SELF_SERVICE_PLAN_ID}', 49.00, 'BRL', 'monthly', 'fundador'),
      ('ffffffff-6666-4666-8666-666666666666', '${SELF_SERVICE_OTHER_PLAN_ID}', 249.90, 'BRL', 'monthly', NULL),
      ('11111111-7777-4777-8777-777777777777', '${SELF_SERVICE_INACTIVE_PLAN_ID}', 9.90, 'BRL', 'monthly', NULL);`);
  const billingMigration = await readFile(
    path.join(root, 'drizzle/migrations/0103_signup_billing_attempt.sql'),
    'utf8',
  );
  async function downBilling() {
    const [attempts] = await admin`SELECT count(*)::int AS n FROM signup_sessions
      WHERE billing_attempt_state IS NOT NULL OR asaas_subscription_id IS NOT NULL`;
    assert.equal(attempts?.n, 0, 'down refused while billing attempts exist; reconcile first');
    await admin.unsafe(`ALTER TABLE signup_sessions
      DROP CONSTRAINT signup_sessions_billing_attempt_check,
      DROP CONSTRAINT signup_sessions_billing_active_check,
      DROP CONSTRAINT signup_sessions_billing_failure_check,
      DROP CONSTRAINT signup_sessions_asaas_subscription_id_unique;
      ALTER TABLE signup_sessions
        DROP COLUMN billing_attempt_state,
        DROP COLUMN billing_attempted_at,
        DROP COLUMN asaas_customer_id,
        DROP COLUMN asaas_subscription_id,
        DROP COLUMN billing_failure_code;
      DELETE FROM _schema_version WHERE version = 'signup-billing-attempt';`);
  }
  async function seedVerifiedForBilling(suffix: string, plan: string | null) {
    const hash = 'b'.repeat(32) + suffix.padStart(32, '0');
    const user = `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
    await admin`INSERT INTO signup_sessions (token_hash, status, idle_expires_at,
      absolute_expires_at, consumed_at, auth_user_id, owner_name, clinic_name, email_hash,
      accepted_at, answered_at, professionals_band, weekly_appointments_band, current_tooling,
      discovery_source, selected_plan_id)
      VALUES (${hash}, 'email_verified', now() + interval '30 minutes',
        now() + interval '45 minutes', now(), ${user}::uuid, 'Ana', 'Clinica',
        ${createHash('sha256')
          .update('billing-' + suffix)
          .digest('hex')},
        now(), now(), '2_5', '21_50', 'outro_sistema', 'indicacao_colega', ${plan}::uuid)`;
    return { hash, user };
  }
  await check(
    'migration 0103 empty up/down/up, populated 2000 rows, unique subscription and no privilege expansion',
    async () => {
      await admin.unsafe(billingMigration);
      await downBilling();
      await admin.unsafe(billingMigration);
      await downBilling();
      await admin.unsafe(`INSERT INTO signup_sessions (token_hash, idle_expires_at, absolute_expires_at)
        SELECT md5(('billing-old-' || n)::text) || md5(n::text), now() + interval '10 minutes',
          now() + interval '45 minutes' FROM generate_series(1, 2000) n;`);
      const before =
        await admin`SELECT to_jsonb(s) AS row FROM signup_sessions s ORDER BY token_hash`;
      await admin.unsafe(billingMigration);
      const after =
        await admin`SELECT to_jsonb(s) - 'billing_attempt_state' - 'billing_attempted_at'
        - 'asaas_customer_id' - 'asaas_subscription_id' - 'billing_failure_code' AS row
        FROM signup_sessions s ORDER BY token_hash`;
      assert.equal(after.length, 2000);
      assert.deepEqual(after, before);

      // Linha antiga segue legal: tentativa toda nula, e o CHECK aceita zero.
      const [untouched] = await admin`SELECT count(*)::int AS n FROM signup_sessions
        WHERE billing_attempt_state IS NULL AND asaas_subscription_id IS NULL`;
      assert.equal(untouched?.n, 2000);
      await admin`DELETE FROM signup_sessions`;

      // --- o que os CHECKs precisam recusar ---------------------------------
      const semPlano = await seedVerifiedForBilling('1', null);
      await assert.rejects(
        admin`UPDATE signup_sessions SET billing_attempt_state = 'reserved',
          billing_attempted_at = now() WHERE token_hash = ${semPlano.hash}`,
        /signup_sessions_billing_attempt_check/u,
        'tentativa sem plano deve ser recusada pelo banco',
      );

      const comPlano = await seedVerifiedForBilling('2', SELF_SERVICE_PLAN_ID);
      await assert.rejects(
        admin`UPDATE signup_sessions SET billing_attempt_state = 'reserved'
          WHERE token_hash = ${comPlano.hash}`,
        /signup_sessions_billing_attempt_check/u,
        'tentativa pela metade deve ser recusada pelo banco',
      );
      await assert.rejects(
        admin`UPDATE signup_sessions SET billing_attempt_state = 'pago', billing_attempted_at = now()
          WHERE token_hash = ${comPlano.hash}`,
        /signup_sessions_billing_attempt_check/u,
        'estado inventado deve ser recusado pelo banco',
      );
      await assert.rejects(
        admin`UPDATE signup_sessions SET billing_attempt_state = 'active', billing_attempted_at = now()
          WHERE token_hash = ${comPlano.hash}`,
        /signup_sessions_billing_active_check/u,
        'ativo sem assinatura deve ser recusado pelo banco',
      );
      await assert.rejects(
        admin`UPDATE signup_sessions SET billing_attempt_state = 'failed', billing_attempted_at = now(),
          asaas_subscription_id = 'sub_x', asaas_customer_id = 'cus_x'
          WHERE token_hash = ${comPlano.hash}`,
        /signup_sessions_billing_active_check/u,
        'assinatura fora de active deve ser recusada pelo banco',
      );
      await assert.rejects(
        admin`UPDATE signup_sessions SET billing_attempt_state = 'reserved', billing_attempted_at = now(),
          billing_failure_code = 'qualquer' WHERE token_hash = ${comPlano.hash}`,
        /signup_sessions_billing_failure_check/u,
        'motivo em reserva deve ser recusado pelo banco',
      );

      // Caminho legítimo, e a unicidade da assinatura entre cadastros.
      await admin`UPDATE signup_sessions SET billing_attempt_state = 'active',
        billing_attempted_at = now(), asaas_customer_id = 'cus_1', asaas_subscription_id = 'sub_1'
        WHERE token_hash = ${comPlano.hash}`;
      const outro = await seedVerifiedForBilling('3', SELF_SERVICE_PLAN_ID);
      await assert.rejects(
        admin`UPDATE signup_sessions SET billing_attempt_state = 'active', billing_attempted_at = now(),
          asaas_customer_id = 'cus_2', asaas_subscription_id = 'sub_1'
          WHERE token_hash = ${outro.hash}`,
        /signup_sessions_asaas_subscription_id_unique/u,
        'mesma assinatura em dois cadastros deve ser recusada pelo banco',
      );

      for (const role of ['anon', 'authenticated', 'qoro_runtime', 'service_role']) {
        const [grants] =
          await admin`SELECT has_table_privilege(${role}, 'signup_sessions', 'SELECT,INSERT,UPDATE,DELETE') AS allowed`;
        assert.equal(grants?.allowed, role === 'service_role');
      }
      const [rls] = await admin`SELECT relrowsecurity, relforcerowsecurity,
        (SELECT count(*)::int FROM pg_policy WHERE polrelid = 'signup_sessions'::regclass) AS policies
        FROM pg_class WHERE oid = 'signup_sessions'::regclass`;
      assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true, policies: 0 });
      await admin`DELETE FROM signup_sessions`;
    },
  );
  await admin.unsafe(`CREATE TABLE clinics (
      id uuid PRIMARY KEY,
      nome text NOT NULL
    );
    CREATE TABLE profiles (
      id uuid PRIMARY KEY,
      clinic_id uuid REFERENCES clinics(id),
      nome text NOT NULL,
      role text NOT NULL,
      ativo boolean NOT NULL DEFAULT true,
      mfa_enrolled_at timestamptz,
      deleted_at timestamptz,
      claims_version integer NOT NULL DEFAULT 1,
      invite_accepted_at timestamptz DEFAULT now()
    );`);
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55448',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_signup',
    MAGIC_TOKEN_SECRET: 'synthetic-local-signup-only-magic-token-secret',
    LOGIN_HASH_PEPPER: 'synthetic-local-signup-only-email-hmac-pepper',
    SIGNUP_IDENTITY_ENABLED: 'true',
    SIGNUP_AUTH_ENABLED: 'true',
    LOG_LEVEL: 'error',
  });
  const {
    SIGNUP_RESEND_COOLDOWN_SECONDS,
    hashSignupToken,
    readSignupSession,
    purgeExpiredSignupSessions,
    recordSignupIdentity,
    reserveSignupAuthAttempt,
    finishSignupAuthAttempt,
    reserveSignupResendAttempt,
    finishSignupResendAttempt,
  } = await import('../../src/contexts/onboarding/internal/signup-session');
  const { recordSignupAnswers } =
    await import('../../src/contexts/onboarding/internal/signup-answers');
  const {
    reserveSignupBillingAttempt,
    activateSignupBillingAttempt,
    markSignupBillingIssue,
    reconcileSignupBillingAttempt,
    readSignupBilling,
  } = await import('../../src/contexts/onboarding/internal/signup-billing');
  const { claimSignupDraftByVerifiedEmail, readSignupDraft, writeSignupDraft } =
    await import('../../src/contexts/onboarding/internal/signup-draft');
  const { hashEmail } = await import('../../src/lib/auth/email-hash');
  const { POST } = await import('../../src/app/api/signup/sessions/answers/route');
  const { GET } = await import('../../src/app/api/signup/sessions/me/route');
  const answerValues = {
    professionalsBand: '2_5',
    weeklyAppointmentsBand: '21_50',
    currentTooling: 'outro_sistema',
    discoverySource: 'indicacao_colega',
  } as const;
  const answers = {
    ...answerValues,
    rowVersion: 1,
  } as const;
  const request = (token: string, rowVersion = 1) =>
    new Request('https://localhost/api/signup/sessions/answers', {
      method: 'POST',
      headers: { cookie: `__Host-qoro_signup=${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...answers, rowVersion }),
    });
  async function seed(token: string, idleMinutes = 10, absoluteMinutes = 45, status = 'initiated') {
    await admin`INSERT INTO signup_sessions (token_hash, idle_expires_at, absolute_expires_at, status)
      VALUES (${hashSignupToken(token)}, now() + make_interval(mins => ${idleMinutes}), now() + make_interval(mins => ${absoluteMinutes}), ${status})`;
  }
  async function snapshot(token: string) {
    return admin`SELECT * FROM signup_sessions WHERE token_hash = ${hashSignupToken(token)}`;
  }

  await check('real handler saves answers, CAS version, status and bounded idle', async () => {
    await seed('live', 1, 5);
    const res = await POST(request('live'));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { rowVersion: 2 });
    const [row] = await snapshot('live');
    assert.equal(row?.professionals_band, answers.professionalsBand);
    assert.equal(row?.weekly_appointments_band, answers.weeklyAppointmentsBand);
    assert.equal(row?.current_tooling, answers.currentTooling);
    assert.equal(row?.discovery_source, answers.discoverySource);
    assert.equal(row?.status, 'details_complete');
    assert.ok(row?.answered_at instanceof Date);
    assert.equal(row?.idle_expires_at.getTime(), row?.absolute_expires_at.getTime());
    const state = await readSignupSession('live');
    assert.equal(state?.rowVersion, 2);
    assert.deepEqual(state?.answers, answerValues);
    const readback = await GET(
      new Request('https://localhost/api/signup/sessions/me', {
        headers: { cookie: '__Host-qoro_signup=live' },
      }),
    );
    assert.equal(readback.status, 200);
    const readbackBody = await readback.json();
    assert.deepEqual(readbackBody.session.answers, answerValues);
  });
  await check('stale CAS returns 409, preserves cookie and every database column', async () => {
    const before = await snapshot('live');
    const res = await POST(request('live'));
    assert.equal(res.status, 409);
    assert.equal(res.headers.get('set-cookie'), null);
    assert.deepEqual(await snapshot('live'), before);
  });
  await check('concurrent CAS has exactly one winner', async () => {
    await seed('concurrent');
    const responses = await Promise.all([POST(request('concurrent')), POST(request('concurrent'))]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    const [row] = await snapshot('concurrent');
    assert.equal(row?.row_version, 2);
  });
  for (const [token, idle, absolute, status] of [
    ['idle', -1, 45, 'initiated'],
    ['absolute', 10, -1, 'initiated'],
    ['blocked', 10, 45, 'blocked'],
    ['expired', 10, 45, 'expired'],
  ] as const) {
    await check(
      `${token}: service and handler return gone, clear cookie, zero mutation`,
      async () => {
        await seed(token, idle, absolute, status);
        const before = await snapshot(token);
        assert.deepEqual(await recordSignupAnswers(token, answers), { ok: false, reason: 'gone' });
        const res = await POST(request(token));
        assert.equal(res.status, 410);
        assert.deepEqual(await res.json(), { error: 'gone' });
        assert.ok(res.headers.get('set-cookie')?.includes('Max-Age=0'));
        assert.equal(await readSignupSession(token), null);
        assert.deepEqual(await snapshot(token), before);
      },
    );
  }
  await check('unknown token and malformed cookies are uniform, no row created', async () => {
    const [before] = await admin`SELECT count(*)::int AS n FROM signup_sessions`;
    for (const token of ['unknown', '%', '%E0%A4', '']) {
      for (const res of [
        await POST(request(token)),
        await GET(
          new Request('https://localhost/api/signup/sessions/me', {
            headers: { cookie: `__Host-qoro_signup=${token}` },
          }),
        ),
      ]) {
        assert.equal(res.status, 410);
        assert.deepEqual(await res.json(), { error: 'gone' });
        assert.ok(res.headers.get('set-cookie')?.includes('Max-Age=0'));
      }
    }
    const [after] = await admin`SELECT count(*)::int AS n FROM signup_sessions`;
    assert.equal(after?.n, before?.n);
  });
  await check(
    'database denies non-enum/partial answers and anonymous/authenticated/runtime grants',
    async () => {
      for (const role of ['anon', 'authenticated', 'qoro_runtime', 'service_role']) {
        const [row] =
          await admin`SELECT has_table_privilege(${role}, 'signup_sessions', 'SELECT,INSERT,UPDATE,DELETE') AS granted`;
        assert.equal(row?.granted, role === 'service_role');
      }
      const before = await snapshot('live');
      await assert.rejects(
        admin`UPDATE signup_sessions SET discovery_source = 'free text' WHERE token_hash = ${hashSignupToken('live')}`,
        { code: '23514' },
      );
      await assert.rejects(
        admin`UPDATE signup_sessions SET discovery_source = NULL WHERE token_hash = ${hashSignupToken('live')}`,
        { code: '23514' },
      );
      assert.deepEqual(await snapshot('live'), before);
    },
  );
  await check('janitor removes expired rows without removing live sessions', async () => {
    const result = await purgeExpiredSignupSessions();
    assert.equal(result.deleted, 2);
    assert.equal((await snapshot('live')).length, 1);
    assert.equal((await snapshot('idle')).length, 0);
    assert.equal((await snapshot('absolute')).length, 0);
  });
  const identity = {
    rowVersion: 2,
    ownerName: '  Pessoa Sintética  ',
    clinicName: '  Clínica Sintética  ',
    email: '  Owner.Synthetic@EXAMPLE.test  ',
    accepted: true,
  } as const;
  const identityToken = (label: string) => createHash('sha256').update(label).digest('base64url');
  const liveToken = identityToken('identity-live');
  const earlyToken = identityToken('identity-initiated');
  const savedIdentity = { ok: true, rowVersion: 3 };
  const conflictingIdentity = { ok: false, reason: 'conflict' };
  const goneIdentity = { ok: false, reason: 'gone' };
  async function seedDetails(token: string, absoluteMinutes = 45) {
    await seed(token, 1, absoluteMinutes);
    assert.deepEqual(await recordSignupAnswers(token, answers), { ok: true, rowVersion: 2 });
  }
  await check('identity: names/HMAC/DB acceptance/TTL and public readback', async () => {
    await seedDetails(liveToken, 5);
    const [clockBefore] = await admin`SELECT now() AS at`;
    assert.deepEqual(await recordSignupIdentity(liveToken, identity), savedIdentity);
    const [clockAfter] = await admin`SELECT now() AS at`;
    const [row] = await snapshot(liveToken);
    assert.equal(row?.owner_name, 'Pessoa Sintética');
    assert.equal(row?.clinic_name, 'Clínica Sintética');
    assert.equal(row?.email_hash, hashEmail(identity.email));
    assert.equal(JSON.stringify(row).toLowerCase().includes('owner.synthetic@'), false);
    assert.equal(row?.status, 'identity_pending');
    assert.equal(row?.row_version, 3);
    assert.ok(row?.accepted_at instanceof Date);
    assert.ok(row.accepted_at >= clockBefore?.at && row.accepted_at <= clockAfter?.at);
    assert.equal(row?.idle_expires_at.getTime(), row?.absolute_expires_at.getTime());
    const res = await GET(
      new Request('https://localhost/api/signup/sessions/me', {
        headers: { cookie: `__Host-qoro_signup=${liveToken}` },
      }),
    );
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.session.status, 'identity_pending');
    assert.equal(body.session.rowVersion, 3);
    const publicFields = ['answers', 'expiresAt', 'riskLevel', 'rowVersion', 'status'];
    assert.deepEqual(Object.keys(body.session).sort(), publicFields);
  });
  await check('identity: two-tab CAS, stale replay, frozen answers, no skipped step', async () => {
    const before = await snapshot(liveToken);
    assert.deepEqual(await recordSignupIdentity(liveToken, identity), conflictingIdentity);
    assert.deepEqual(
      await recordSignupAnswers(liveToken, { ...answers, rowVersion: 3 }),
      conflictingIdentity,
    );
    assert.deepEqual(await snapshot(liveToken), before);
    const replacement = { ...identity, rowVersion: 3 };
    const outcomes = await Promise.all([
      recordSignupIdentity(liveToken, replacement),
      recordSignupIdentity(liveToken, replacement),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1);
    assert.ok(outcomes.some((outcome) => !outcome.ok && outcome.reason === 'conflict'));
    assert.equal((await snapshot(liveToken))[0]?.row_version, 4);
    await seed(earlyToken);
    const earlyBefore = await snapshot(earlyToken);
    assert.deepEqual(
      await recordSignupIdentity(earlyToken, { ...identity, rowVersion: 1 }),
      goneIdentity,
    );
    assert.deepEqual(await snapshot(earlyToken), earlyBefore);
  });
  await check('identity: SQL checks and PII prevents down migration', async () => {
    const assignments = [
      'owner_name = NULL',
      'clinic_name = NULL',
      'email_hash = NULL',
      'accepted_at = NULL',
      "owner_name = ''",
      "clinic_name = repeat('x', 121)",
      "owner_name = E'bad\\nname'",
      "owner_name = chr(133) || 'x'",
      "email_hash = 'raw@example.test'",
      "email_hash = repeat('A', 64)",
      'professionals_band = NULL',
      'consumed_at = now()',
      'professionals_band = NULL, weekly_appointments_band = NULL, current_tooling = NULL, discovery_source = NULL, answered_at = NULL',
    ];
    const before = await snapshot(liveToken);
    await assert.rejects(downIdentity(), /down refused while staging PII exists/u);
    for (const assignment of assignments) {
      await assert.rejects(
        admin.unsafe(
          `UPDATE signup_sessions SET ${assignment}
        WHERE token_hash = $1`,
          [hashSignupToken(liveToken)],
        ),
        { code: '23514' },
      );
    }
    await assert.rejects(
      admin`UPDATE signup_sessions SET owner_name = 'partial'
      WHERE token_hash = ${hashSignupToken(earlyToken)}`,
      { code: '23514' },
    );
    await assert.rejects(
      admin`UPDATE signup_sessions SET status = 'identity_pending'
      WHERE token_hash = ${hashSignupToken(earlyToken)}`,
      { code: '23514' },
    );
    assert.deepEqual(await snapshot(liveToken), before);
  });
  await check('identity: terminal/expired replay and physical PII deletion', async () => {
    for (const mode of ['idle', 'absolute', 'blocked']) {
      const token = identityToken(`identity-${mode}`);
      await seedDetails(token);
      assert.deepEqual(await recordSignupIdentity(token, identity), savedIdentity);
      if (mode === 'idle')
        await admin`UPDATE signup_sessions SET idle_expires_at = now() - interval '1 second' WHERE token_hash = ${hashSignupToken(token)}`;
      if (mode === 'absolute')
        await admin`UPDATE signup_sessions SET absolute_expires_at = now() - interval '1 second' WHERE token_hash = ${hashSignupToken(token)}`;
      if (mode === 'blocked')
        await admin`UPDATE signup_sessions SET status = 'blocked' WHERE token_hash = ${hashSignupToken(token)}`;
      const before = await snapshot(token);
      assert.deepEqual(
        await recordSignupIdentity(token, { ...identity, rowVersion: 3 }),
        goneIdentity,
      );
      assert.equal(await readSignupSession(token), null);
      assert.deepEqual(await snapshot(token), before);
    }
    assert.equal((await purgeExpiredSignupSessions()).deleted, 2);
    for (const token of ['identity-idle', 'identity-absolute'])
      assert.equal((await snapshot(identityToken(token))).length, 0);
    assert.equal((await snapshot(liveToken)).length, 1);
    assert.equal((await snapshot(identityToken('identity-blocked'))).length, 1);
  });
  await check(
    'auth: real CAS one winner, frozen staging, GET does not renew, completion once',
    async () => {
      const token = identityToken('auth-cas');
      await seedDetails(token);
      assert.deepEqual(await recordSignupIdentity(token, identity), savedIdentity);
      const input = { rowVersion: 3, email: identity.email, password: 'Abcdef1!', accepted: true };
      const before = await snapshot(token);
      assert.deepEqual(
        await reserveSignupAuthAttempt(token, { ...input, email: 'wrong@example.invalid' }),
        conflictingIdentity,
      );
      assert.deepEqual(await snapshot(token), before);
      const results = await Promise.all([
        reserveSignupAuthAttempt(token, input),
        reserveSignupAuthAttempt(token, input),
      ]);
      assert.deepEqual(
        results.filter((result) => result.ok),
        [{ ok: true, rowVersion: 4 }],
      );
      assert.ok(results.some((result) => !result.ok && result.reason === 'conflict'));
      const [reserved] = await snapshot(token);
      assert.equal(reserved?.auth_attempt_kind, 'initial');
      assert.equal(reserved?.auth_attempt_state, 'reserved');
      assert.equal(reserved?.status, 'email_pending');
      assert.ok(reserved?.auth_attempted_at instanceof Date);
      assert.equal(JSON.stringify(reserved).includes(input.password), false);
      for (const operation of [
        recordSignupIdentity(token, { ...identity, rowVersion: 4 }),
        recordSignupAnswers(token, { ...answers, rowVersion: 4 }),
        reserveSignupAuthAttempt(token, { ...input, rowVersion: 4 }),
      ]) {
        assert.deepEqual(await operation, conflictingIdentity);
      }
      assert.deepEqual((await snapshot(token))[0], reserved);
      const state = await readSignupSession(token);
      assert.equal(state?.status, 'email_pending');
      const [read] = await snapshot(token);
      assert.equal(read?.idle_expires_at.getTime(), reserved?.idle_expires_at.getTime());
      assert.equal(read?.row_version, 4);
      assert.equal(read?.auth_attempted_at.getTime(), reserved?.auth_attempted_at.getTime());
      assert.deepEqual(await finishSignupAuthAttempt(token, 4, 'completed'), {
        ok: true,
        rowVersion: 5,
      });
      const [done] = await snapshot(token);
      assert.equal(done?.auth_attempt_state, 'completed');
      // Finalizar a tentativa fixa o idle no absoluto: a espera pelo e-mail dura
      // o que o teto permitir, sem depender de o navegador continuar aberto — e
      // sem estender nada, porque o absoluto segue intocado.
      assert.equal(done?.idle_expires_at.getTime(), done?.absolute_expires_at.getTime());
      assert.equal(done?.absolute_expires_at.getTime(), read?.absolute_expires_at.getTime());
      assert.deepEqual(await finishSignupAuthAttempt(token, 4, 'uncertain'), conflictingIdentity);
      assert.deepEqual((await snapshot(token))[0], done);
      await assert.rejects(downAuth(), /down refused while attempts exist/u);
      for (const assignment of [
        'auth_attempt_kind = NULL',
        "auth_attempt_state = 'other'",
        'owner_name = NULL',
        'auth_attempted_at = NULL',
        "status = 'identity_pending'",
        'consumed_at = now()',
      ]) {
        await assert.rejects(
          admin.unsafe(`UPDATE signup_sessions SET ${assignment} WHERE token_hash = $1`, [
            hashSignupToken(token),
          ]),
          { code: '23514' },
        );
      }
    },
  );
  await check(
    'auth: uncertain/crash stays pending, terminal/TTL rejects, janitor deletes attempt and PII',
    async () => {
      for (const mode of ['uncertain', 'crash', 'idle', 'absolute', 'blocked']) {
        const token = identityToken(`auth-${mode}`);
        await seedDetails(token);
        assert.deepEqual(await recordSignupIdentity(token, identity), savedIdentity);
        const input = {
          rowVersion: 3,
          email: identity.email,
          password: 'Abcdef1!',
          accepted: true,
        };
        assert.deepEqual(await reserveSignupAuthAttempt(token, input), { ok: true, rowVersion: 4 });
        if (mode === 'uncertain')
          assert.deepEqual(await finishSignupAuthAttempt(token, 4, 'uncertain'), {
            ok: true,
            rowVersion: 5,
          });
        if (mode === 'idle')
          await admin`UPDATE signup_sessions SET idle_expires_at = now() - interval '1 second' WHERE token_hash = ${hashSignupToken(token)}`;
        if (mode === 'absolute')
          await admin`UPDATE signup_sessions SET absolute_expires_at = now() - interval '1 second' WHERE token_hash = ${hashSignupToken(token)}`;
        if (mode === 'blocked')
          await admin`UPDATE signup_sessions SET status = 'blocked' WHERE token_hash = ${hashSignupToken(token)}`;
        const before = await snapshot(token);
        const terminal = ['idle', 'absolute', 'blocked'].includes(mode);
        assert.deepEqual(
          await reserveSignupAuthAttempt(token, {
            ...input,
            rowVersion: mode === 'uncertain' ? 5 : 4,
          }),
          terminal ? goneIdentity : conflictingIdentity,
        );
        if (terminal)
          assert.deepEqual(await finishSignupAuthAttempt(token, 4, 'completed'), goneIdentity);
        assert.deepEqual(await snapshot(token), before);
      }
      assert.equal((await purgeExpiredSignupSessions()).deleted, 2);
      assert.equal((await snapshot(identityToken('auth-idle'))).length, 0);
      assert.equal((await snapshot(identityToken('auth-absolute'))).length, 0);
    },
  );
  await check(
    'resend: cooldown DB, CAS one winner, recovery and late finalization isolation',
    async () => {
      const token = identityToken('resend-direct');
      await seedDetails(token);
      assert.deepEqual(await recordSignupIdentity(token, identity), savedIdentity);
      const initial = {
        rowVersion: 3,
        email: identity.email,
        password: 'Abcdef1!',
        accepted: true,
      } as const;
      assert.deepEqual(await reserveSignupAuthAttempt(token, initial), {
        ok: true,
        rowVersion: 4,
      });
      assert.deepEqual(await finishSignupAuthAttempt(token, 4, 'completed'), {
        ok: true,
        rowVersion: 5,
      });
      await admin`UPDATE signup_sessions
        SET auth_attempted_at = now() - make_interval(secs => ${SIGNUP_RESEND_COOLDOWN_SECONDS + 1})
        WHERE token_hash = ${hashSignupToken(token)}`;
      const [before] = await snapshot(token);
      const resend = { rowVersion: 5, email: identity.email, accepted: true } as const;
      const outcomes = await Promise.all([
        reserveSignupResendAttempt(token, resend),
        reserveSignupResendAttempt(token, resend),
      ]);
      assert.deepEqual(
        outcomes.filter((outcome) => outcome.ok),
        [{ ok: true, rowVersion: 6 }],
      );
      assert.ok(outcomes.some((outcome) => !outcome.ok && outcome.reason === 'conflict'));
      const [reserved] = await snapshot(token);
      assert.equal(reserved?.auth_attempt_kind, 'resend');
      assert.equal(reserved?.auth_attempt_state, 'reserved');
      assert.equal(reserved?.row_version, 6);
      assert.equal(reserved?.idle_expires_at.getTime(), before?.idle_expires_at.getTime());
      assert.equal(reserved?.absolute_expires_at.getTime(), before?.absolute_expires_at.getTime());
      assert.deepEqual(await finishSignupAuthAttempt(token, 4, 'completed'), conflictingIdentity);
      assert.deepEqual(await finishSignupResendAttempt(token, 6, 'completed'), {
        ok: true,
        rowVersion: 7,
      });
      const [completed] = await snapshot(token);
      assert.equal(completed?.idle_expires_at.getTime(), reserved?.idle_expires_at.getTime());
      const cooldown = await reserveSignupResendAttempt(token, {
        ...resend,
        rowVersion: 7,
      });
      assert.equal(cooldown.ok, false);
      if (cooldown.ok || cooldown.reason !== 'cooldown') {
        throw new Error('resend cooldown was not enforced');
      }
      assert.ok(cooldown.retryAfter >= 1 && cooldown.retryAfter <= SIGNUP_RESEND_COOLDOWN_SECONDS);
      assert.deepEqual((await snapshot(token))[0], completed);

      await admin`UPDATE signup_sessions
        SET auth_attempt_state = 'uncertain',
          auth_attempted_at = now() - make_interval(secs => ${SIGNUP_RESEND_COOLDOWN_SECONDS + 1})
        WHERE token_hash = ${hashSignupToken(token)}`;
      assert.deepEqual(await reserveSignupResendAttempt(token, { ...resend, rowVersion: 7 }), {
        ok: true,
        rowVersion: 8,
      });
      const [secondReservation] = await snapshot(token);
      assert.deepEqual(await finishSignupResendAttempt(token, 6, 'completed'), conflictingIdentity);
      assert.deepEqual((await snapshot(token))[0], secondReservation);
      await admin`UPDATE signup_sessions
        SET auth_attempted_at = now() - make_interval(secs => ${SIGNUP_RESEND_COOLDOWN_SECONDS + 1})
        WHERE token_hash = ${hashSignupToken(token)}`;
      assert.deepEqual(await reserveSignupResendAttempt(token, { ...resend, rowVersion: 8 }), {
        ok: true,
        rowVersion: 9,
      });
      assert.deepEqual(await finishSignupResendAttempt(token, 9, 'uncertain'), {
        ok: true,
        rowVersion: 10,
      });
      const [final] = await snapshot(token);
      assert.equal(final?.auth_attempt_kind, 'resend');
      assert.equal(final?.auth_attempt_state, 'uncertain');
      assert.equal(final?.idle_expires_at.getTime(), before?.idle_expires_at.getTime());
      assert.equal(JSON.stringify(final).includes(initial.password), false);
      await admin`DELETE FROM signup_sessions WHERE token_hash = ${hashSignupToken(token)}`;
    },
  );
  await check(
    'draft owner: cross-device claim by verified e-mail, mismatch denial, no TTL renewal, exclusive restart and purge',
    async () => {
      const ownerA = '44444444-4444-4444-8444-444444444444';
      const ownerB = '55555555-5555-4555-8555-555555555555';
      const ownerC = '66666666-6666-4666-8666-666666666666';
      const ownerD = '77777777-7777-4777-8777-777777777777';
      const ownerE = '88888888-8888-4888-8888-888888888888';
      const ownerF = '99999999-9999-4999-8999-999999999999';
      const email = 'verified.draft@example.invalid';
      const restartInput = {
        ownerName: '  Pessoa Reiniciada  ',
        clinicName: '  Clínica Reiniciada  ',
        answers: answerValues,
        accepted: true,
      } as const;
      const claimToken = identityToken('draft-claim');
      const olderToken = identityToken('draft-claim-older');
      const reservedToken = identityToken('draft-reserved');
      const mismatchToken = identityToken('draft-mismatch');
      const raceTokens = [identityToken('draft-race-a'), identityToken('draft-race-b')];
      const seededTokens = [claimToken, olderToken, reservedToken, mismatchToken, ...raceTokens];

      async function seedEmailPending(
        token: string,
        pendingEmail = email,
        attemptState = 'completed',
        ageMinutes = 0,
      ) {
        await admin`INSERT INTO signup_sessions (
          token_hash, status, row_version, idle_expires_at, absolute_expires_at,
          professionals_band, weekly_appointments_band, current_tooling, discovery_source,
          answered_at, owner_name, clinic_name, email_hash, accepted_at,
          auth_attempt_kind, auth_attempt_state, auth_attempted_at
        ) VALUES (
          ${hashSignupToken(token)}, 'email_pending', 5, now() + interval '45 minutes',
          now() + interval '45 minutes', ${answerValues.professionalsBand},
          ${answerValues.weeklyAppointmentsBand}, ${answerValues.currentTooling},
          ${answerValues.discoverySource}, now(), 'Bootstrap Owner', 'Bootstrap Clinic',
          ${hashEmail(pendingEmail)}, now(), 'initial', ${attemptState},
          now() - make_interval(mins => ${ageMinutes})
        )`;
      }

      // Aparelho diferente: nenhum cookie anônimo chega aqui, só a identidade já
      // verificada. Entre dois cadastros do MESMO e-mail, vincula o mais recente.
      await seedEmailPending(olderToken, email, 'completed', 5);
      await seedEmailPending(claimToken);
      await seedEmailPending(reservedToken, 'reserved.draft@example.invalid', 'reserved');
      await seedEmailPending(mismatchToken, 'mismatch.draft@example.invalid');
      for (const token of raceTokens) await seedEmailPending(token, 'race.draft@example.invalid');
      const [claimBefore] = await snapshot(claimToken);
      assert.deepEqual(await claimSignupDraftByVerifiedEmail(ownerA, email), {
        ok: true,
        rowVersion: 6,
      });
      const [claimed] = await snapshot(claimToken);
      assert.equal(claimed?.status, 'email_verified');
      assert.equal(claimed?.auth_user_id, ownerA);
      assert.ok(claimed?.consumed_at instanceof Date);
      assert.equal(claimed?.owner_name, 'Bootstrap Owner');
      assert.equal(claimed?.clinic_name, 'Bootstrap Clinic');
      assert.equal(claimed?.row_version, 6);
      assert.equal(
        claimed?.idle_expires_at.getTime(),
        claimed?.absolute_expires_at.getTime(),
        'draft vinculado nao guarda janela de inatividade propria',
      );
      assert.equal(
        claimed?.absolute_expires_at.getTime(),
        claimBefore?.absolute_expires_at.getTime(),
        'vincular nao estende o teto absoluto',
      );
      // A linha mais antiga do mesmo e-mail fica intocada: uma confirmação
      // vincula UM cadastro, nunca varre tudo que carrega aquele hash.
      const [older] = await snapshot(olderToken);
      assert.equal(older?.status, 'email_pending');
      assert.equal(older?.auth_user_id, null);
      assert.equal(older?.consumed_at, null);

      // Reabrir a continuação não vincula de novo nem mexe na linha.
      assert.deepEqual(await claimSignupDraftByVerifiedEmail(ownerA, email), {
        ok: true,
        rowVersion: 6,
      });
      assert.deepEqual((await snapshot(claimToken))[0], claimed);

      const read = await readSignupDraft(ownerA);
      assert.equal(read.ok, true);
      if (!read.ok) throw new Error('claimed owner draft not readable');
      assert.deepEqual(Object.keys(read.draft).sort(), [
        'absoluteExpiresAt',
        'answers',
        'clinicName',
        'idleExpiresAt',
        'ownerName',
        'rowVersion',
        'status',
      ]);
      const publicDraft = JSON.stringify(read.draft);
      assert.equal(publicDraft.includes(email), false);
      assert.equal(publicDraft.includes(ownerA), false);
      assert.equal(publicDraft.includes(claimToken), false);
      const [afterRead] = await snapshot(claimToken);
      assert.equal(afterRead?.idle_expires_at.getTime(), claimed?.idle_expires_at.getTime());
      assert.equal(
        afterRead?.absolute_expires_at.getTime(),
        claimed?.absolute_expires_at.getTime(),
      );

      // Reserva cuja finalização se perdeu: o e-mail pode ter sido entregue, e
      // quem chega com OTP válido daquele endereço não redigita nada por isso.
      const reservedEmail = 'reserved.draft@example.invalid';
      assert.equal((await snapshot(reservedToken))[0]?.auth_attempt_state, 'reserved');
      assert.deepEqual(await claimSignupDraftByVerifiedEmail(ownerB, reservedEmail), {
        ok: true,
        rowVersion: 6,
      });
      assert.equal((await snapshot(reservedToken))[0]?.auth_user_id, ownerB);

      // E-mail verificado diferente não alcança o cadastro de outra pessoa.
      const mismatchBefore = await snapshot(mismatchToken);
      assert.deepEqual(await claimSignupDraftByVerifiedEmail(ownerC, 'different@example.invalid'), {
        ok: false,
        reason: 'gone',
      });
      assert.deepEqual(await snapshot(mismatchToken), mismatchBefore);
      assert.deepEqual(await readSignupDraft(ownerC), { ok: false, reason: 'gone' });

      // Teto absoluto vencido também fecha o vínculo: expirar encerra autoridade.
      await admin`UPDATE signup_sessions SET absolute_expires_at = now() - interval '1 second'
        WHERE token_hash IN (${hashSignupToken(mismatchToken)}, ${hashSignupToken(olderToken)})`;
      assert.deepEqual(await claimSignupDraftByVerifiedEmail(ownerD, email), {
        ok: false,
        reason: 'gone',
      });

      // Duas abas do mesmo usuário disputando: um único owner, sem linha extra.
      const raceEmail = 'race.draft@example.invalid';
      const raceOutcomes = await Promise.all([
        claimSignupDraftByVerifiedEmail(ownerE, raceEmail),
        claimSignupDraftByVerifiedEmail(ownerE, raceEmail),
      ]);
      assert.ok(raceOutcomes.some((outcome) => outcome.ok));
      const [exclusiveOwner] =
        await admin`SELECT count(*)::int AS n FROM signup_sessions WHERE auth_user_id = ${ownerE}`;
      assert.equal(exclusiveOwner?.n, 1);

      await admin`UPDATE signup_sessions SET idle_expires_at = now() - interval '1 second',
        absolute_expires_at = now() - interval '1 second' WHERE auth_user_id = ${ownerA}`;
      assert.deepEqual(await readSignupDraft(ownerA), { ok: false, reason: 'gone' });
      const [restartClock] = await admin`SELECT now() AS at`;
      assert.deepEqual(await writeSignupDraft({ userId: ownerA, email, input: restartInput }), {
        ok: true,
        rowVersion: 1,
      });
      const [restarted] = await admin`SELECT * FROM signup_sessions WHERE auth_user_id = ${ownerA}`;
      assert.equal(restarted?.status, 'email_verified');
      assert.equal(restarted?.owner_name, 'Pessoa Reiniciada');
      assert.equal(restarted?.token_hash === hashSignupToken(claimToken), false);
      assert.match(String(restarted?.token_hash), /^[0-9a-f]{64}$/u);
      assert.ok(restarted?.idle_expires_at > restartClock?.at);
      assert.equal(
        restarted?.idle_expires_at.getTime(),
        restarted?.absolute_expires_at.getTime(),
        'redigitacao nao pode vencer em 15 min sem renovacao possivel',
      );
      assert.equal(
        JSON.stringify(await readSignupDraft(ownerA)).includes(restarted?.token_hash),
        false,
      );
      assert.deepEqual(await writeSignupDraft({ userId: ownerA, email, input: restartInput }), {
        ok: false,
        reason: 'conflict',
      });
      await assert.rejects(downOwnership(), /down refused while owned\/consumed drafts exist/u);

      const concurrentRestart = await Promise.all([
        writeSignupDraft({ userId: ownerF, email, input: restartInput }),
        writeSignupDraft({ userId: ownerF, email, input: restartInput }),
      ]);
      assert.equal(concurrentRestart.filter((outcome) => outcome.ok).length, 1);
      assert.ok(concurrentRestart.some((outcome) => !outcome.ok && outcome.reason === 'conflict'));
      const [oneRestart] =
        await admin`SELECT count(*)::int AS n FROM signup_sessions WHERE auth_user_id = ${ownerF}`;
      assert.equal(oneRestart?.n, 1);

      await admin`UPDATE signup_sessions SET idle_expires_at = now() - interval '1 second'
        WHERE auth_user_id IN (${ownerA}, ${ownerE}, ${ownerF})`;
      const purge = await purgeExpiredSignupSessions();
      assert.ok(purge.deleted >= 3);
      const [ownedAfterPurge] = await admin`SELECT count(*)::int AS n FROM signup_sessions
        WHERE auth_user_id IN (${ownerA}, ${ownerE}, ${ownerF})`;
      assert.equal(ownedAfterPurge?.n, 0);
      for (const token of seededTokens) {
        await admin`DELETE FROM signup_sessions WHERE token_hash = ${hashSignupToken(token)}`;
      }
      await admin`DELETE FROM signup_sessions WHERE auth_user_id IS NOT NULL`;
    },
  );
  await check(
    'billing O-5: reserva CAS com vencedor unico, creation_unknown nao retenta, reconcilia e janitor preserva assinatura',
    async () => {
      const owner = '00000000-0000-4000-8000-0000000000b1';
      const seedOwner = async () => {
        await admin`DELETE FROM signup_sessions WHERE auth_user_id = ${owner}::uuid`;
        await admin`INSERT INTO signup_sessions (token_hash, status, idle_expires_at,
          absolute_expires_at, consumed_at, auth_user_id, owner_name, clinic_name, email_hash,
          accepted_at, answered_at, professionals_band, weekly_appointments_band, current_tooling,
          discovery_source, selected_plan_id)
          VALUES (${createHash('sha256').update('billing-cas').digest('hex')}, 'email_verified',
            now() + interval '30 minutes', now() + interval '45 minutes', now(), ${owner}::uuid,
            'Ana', 'Clinica Aurora',
            ${createHash('sha256').update('billing-cas-email').digest('hex')},
            now(), now(), '2_5', '21_50', 'outro_sistema', 'indicacao_colega',
            ${SELF_SERVICE_PLAN_ID}::uuid)`;
      };

      // Duas abas pedindo checkout ao mesmo tempo: uma reserva, a outra perde.
      await seedOwner();
      const disputed = await Promise.all([
        reserveSignupBillingAttempt(owner),
        reserveSignupBillingAttempt(owner),
      ]);
      assert.equal(disputed.filter((outcome) => outcome.ok).length, 1, 'uma unica reserva vence');
      assert.ok(
        disputed.some((outcome) => !outcome.ok && outcome.reason === 'conflict'),
        'a perdedora recebe conflict',
      );
      const winner = disputed.find((outcome) => outcome.ok);
      assert.ok(winner?.ok);
      // Preco e plano vem do catalogo, nao do chamador.
      assert.equal(winner.intent.priceCents, 14900);
      assert.equal(winner.intent.planCode, 'solo');
      assert.ok(winner.intent.externalReference.startsWith('signup:'));

      // Ativacao com versao velha perde; com a versao reservada, vence.
      const stale = await activateSignupBillingAttempt({
        userId: owner,
        reservedVersion: winner.rowVersion - 1,
        asaasCustomerId: 'cus_cas',
        asaasSubscriptionId: 'sub_cas',
      });
      assert.deepEqual(stale, { ok: false, reason: 'conflict' });
      const activated = await activateSignupBillingAttempt({
        userId: owner,
        reservedVersion: winner.rowVersion,
        asaasCustomerId: 'cus_cas',
        asaasSubscriptionId: 'sub_cas',
      });
      assert.ok(activated.ok);

      // De `active` nao se reserva de novo: seria a segunda assinatura.
      assert.deepEqual(await reserveSignupBillingAttempt(owner), {
        ok: false,
        reason: 'already_active',
      });

      // `creation_unknown` nao e retentavel — so reconciliacao sai dali.
      await seedOwner();
      const second = await reserveSignupBillingAttempt(owner);
      assert.ok(second.ok);
      const unknown = await markSignupBillingIssue({
        userId: owner,
        reservedVersion: second.rowVersion,
        outcome: 'creation_unknown',
        failureCode: 'subscription_creation_unknown',
        asaasCustomerId: 'cus_lost',
      });
      assert.ok(unknown.ok);
      assert.deepEqual(await reserveSignupBillingAttempt(owner), {
        ok: false,
        reason: 'reconcile_required',
      });
      const reconciled = await reconcileSignupBillingAttempt({
        userId: owner,
        asaasCustomerId: 'cus_lost',
        asaasSubscriptionId: 'sub_lost',
      });
      assert.ok(reconciled.ok);
      const snapshot = await readSignupBilling(owner);
      assert.ok(snapshot.ok);
      assert.equal(snapshot.snapshot.state, 'active');
      assert.equal(snapshot.snapshot.asaasSubscriptionId, 'sub_lost');
      assert.equal(snapshot.snapshot.failureCode, null);

      // `failed` (4xx conhecido) CONTINUA retentavel — a diferenca que importa.
      await seedOwner();
      const third = await reserveSignupBillingAttempt(owner);
      assert.ok(third.ok);
      const failed = await markSignupBillingIssue({
        userId: owner,
        reservedVersion: third.rowVersion,
        outcome: 'failed',
        failureCode: 'invalid_cpfcnpj',
      });
      assert.ok(failed.ok);
      const retried = await reserveSignupBillingAttempt(owner);
      assert.ok(retried.ok, 'apos 4xx a pessoa pode tentar de novo');

      // O janitor NAO pode apagar linha que guarda assinatura no Asaas.
      await activateSignupBillingAttempt({
        userId: owner,
        reservedVersion: retried.rowVersion,
        asaasCustomerId: 'cus_keep',
        asaasSubscriptionId: 'sub_keep',
      });
      await admin`UPDATE signup_sessions SET idle_expires_at = now() - interval '1 second'
        WHERE auth_user_id = ${owner}::uuid`;
      const purged = await purgeExpiredSignupSessions();
      assert.equal(purged.retainedWithSubscription, 1, 'assinatura viva retem a linha');
      const [kept] = await admin`SELECT count(*)::int AS n FROM signup_sessions
        WHERE auth_user_id = ${owner}::uuid`;
      assert.equal(kept?.n, 1, 'cobranca orfa seria o resultado de apagar aqui');

      await admin`DELETE FROM signup_sessions WHERE auth_user_id = ${owner}::uuid`;
    },
  );
  if (process.argv.includes('--browser')) {
    await check('real browser signup journey, two-tab CAS, readback and expiry', async () => {
      await runBrowserJourney(url, admin, hashSignupToken);
    });
  }
} finally {
  try {
    if (verified && schemaReady) {
      await admin`DELETE FROM signup_sessions`;
      const [remaining] = await admin`SELECT count(*)::int AS n FROM signup_sessions`;
      assert.equal(remaining?.n, 0);
      results.push({ name: 'fixture cleanup readback zero', status: 'PASS' });
    }
  } finally {
    try {
      for (const key of ['__runtimeClient', '__adminClient', '__workerClient']) {
        const client: unknown = Reflect.get(globalThis, key);
        if (typeof client === 'function' && 'end' in client && typeof client.end === 'function')
          await client.end({ timeout: 1 });
      }
    } finally {
      await admin.end({ timeout: 1 });
      const stop = spawnSync(
        path.join(bin, `pg_ctl${suffix}`),
        ['-D', data, '-m', 'fast', '-w', 'stop'],
        { windowsHide: true, encoding: 'utf8' },
      );
      // `throw` aqui apagaria o erro que trouxe a execução ao finally — foi o
      // que escondeu a causa real quando o cluster sequer subiu. O resultado
      // vira FAIL no relatório e no exit code, sem substituir o erro original.
      stopped = stop.status === 0 ? { ok: true } : { ok: false, detail: stop.stderr };
    }
  }
  results.push(
    stopped.ok
      ? { name: 'own Postgres stopped', status: 'PASS' }
      : { name: 'own Postgres stopped', status: 'FAIL', detail: stopped.detail },
  );
  const resolved = path.resolve(cluster);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('qoro-signup-regression-'));
  await rm(resolved, { recursive: true });
  const output = path.join(root, 'dist/signup-regression');
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify({ environment: 'local synthetic Postgres 17', results }, null, 2),
  );
  for (const result of results)
    console.log(`${result.status} ${result.name}${result.detail ? `: ${result.detail}` : ''}`);
  if (results.some((result) => result.status === 'FAIL')) process.exitCode = 1;
}
