/** Auth real, schema Qoro real, identidades sintéticas e SMTP sem saída externa. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { createClient } from '@supabase/supabase-js';

import { parseClaims } from '../src/lib/auth/claims';

const PG_IMAGE = 'public.ecr.aws/supabase/postgres:17.11.0.006';
const AUTH_IMAGE = 'supabase/gotrue:v2.197.0';
const TRANSPORT_IMAGE = 'supabase/storage-api:v1.81.0';
let stage = 'initial';
function docker(args: string[], input?: string): string {
  try {
    return execFileSync('docker', args, {
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  } catch {
    throw new Error(`Docker ${args[0]} falhou na etapa ${stage}; saída sensível suprimida`);
  }
}
function jwt(secret: string): string {
  const head = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
  const body = Buffer.from(
    JSON.stringify({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url');
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}
async function main(): Promise<void> {
  assert.equal(process.env.AUTH_RECOVERY_LOCAL, 'approved', 'Drill local não autorizado');
  // Só sete campos não secretos saem do processo DPAPI. URLs, templates, SMTP,
  // usuários e segredos de Production nunca são enviados aos contêineres.
  const recovered: unknown = JSON.parse(
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Add-Type -AssemblyName System.Security; $p=Join-Path $env:LOCALAPPDATA 'Qoro\\Recovery\\auth-20261029\\auth-config.dpapi'; $b=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($p),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); $c=[Text.Encoding]::UTF8.GetString($b)|ConvertFrom-Json; $c|Select-Object jwt_exp,mailer_autoconfirm,external_email_enabled,refresh_token_rotation_enabled,password_min_length,mfa_totp_enroll_enabled,mfa_totp_verify_enabled|ConvertTo-Json -Compress",
      ],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    ),
  );
  assert.ok(recovered && typeof recovered === 'object');
  const restoredSettings: Record<string, string> = {};
  for (const [name, target] of Object.entries({
    jwt_exp: 'GOTRUE_JWT_EXP',
    mailer_autoconfirm: 'GOTRUE_MAILER_AUTOCONFIRM',
    external_email_enabled: 'GOTRUE_EXTERNAL_EMAIL_ENABLED',
    refresh_token_rotation_enabled: 'GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED',
    password_min_length: 'GOTRUE_PASSWORD_MIN_LENGTH',
    mfa_totp_enroll_enabled: 'GOTRUE_MFA_TOTP_ENROLL_ENABLED',
    mfa_totp_verify_enabled: 'GOTRUE_MFA_TOTP_VERIFY_ENABLED',
  })) {
    const value = Reflect.get(recovered, name);
    assert.ok(typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)));
    restoredSettings[target] = String(value);
  }
  const started = Date.now();
  const prefix = `qoro-auth-drill-${randomBytes(6).toString('hex')}`;
  const network = `${prefix}-net`,
    db = `${prefix}-db`,
    auth = `${prefix}-auth`,
    sink = `${prefix}-sink`;
  const created: string[] = [];
  const secret = randomBytes(32).toString('hex'),
    dbPassword = randomBytes(24).toString('hex');
  const serviceKey = jwt(secret);
  const password = randomBytes(24).toString('base64url');
  const email = `recovery-${randomBytes(6).toString('hex')}@example.invalid`;
  const base = 'http://127.0.0.1:9999';
  const results: string[] = [];
  let networkCreated = false;
  function sql(source: string): string {
    return docker(
      [
        'exec',
        '-i',
        db,
        'psql',
        '-X',
        '-U',
        'supabase_admin',
        '-d',
        'postgres',
        '-At',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      source,
    );
  }
  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    bearer = serviceKey,
    target = auth,
    port = 9999,
  ): Promise<Response> {
    assert.ok(path.startsWith('/') && !path.startsWith('//'));
    const raw = docker(
      [
        'exec',
        '-i',
        sink,
        'node',
        '-e',
        "let b='';process.stdin.on('data',c=>b+=c);process.stdin.on('end',async()=>{try{const q=JSON.parse(b);const r=await fetch(q.url,{method:q.method,headers:q.headers,body:q.body,signal:AbortSignal.timeout(15000)});process.stdout.write(JSON.stringify({status:r.status,headers:Object.fromEntries(r.headers),body:await r.text()}));}catch{process.exit(1);}})",
      ],
      JSON.stringify({
        url: `http://${target}:${port}${path}`,
        method,
        headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    const response: { status: number; headers: Record<string, string>; body: string } =
      JSON.parse(raw);
    return new Response(response.status === 204 ? null : response.body, {
      status: response.status,
      headers: response.headers,
    });
  }
  try {
    docker(['network', 'create', '--internal', network]);
    networkCreated = true;
    stage = 'postgres';
    docker([
      'run',
      '-d',
      '--name',
      db,
      '--network',
      network,
      '--log-driver',
      'none',
      '--memory',
      '1g',
      '--memory-swap',
      '1g',
      '--tmpfs',
      '/var/lib/postgresql/data:rw,nosuid,size=512m',
      '-e',
      `POSTGRES_PASSWORD=${dbPassword}`,
      PG_IMAGE,
    ]);
    created.push(db);
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        docker([
          'exec',
          db,
          'pg_isready',
          '-h',
          '127.0.0.1',
          '-U',
          'supabase_admin',
          '-d',
          'postgres',
        ]);
        if (sql("select count(*) from pg_roles where rolname='supabase_auth_admin'") === '1') {
          ready = true;
          break;
        }
      } catch {
        /* initdb temporário ainda não terminou; há prazo explícito */
      }
      await delay(1000);
    }
    assert.ok(ready, 'PostgreSQL não iniciou');
    sql(`ALTER ROLE supabase_auth_admin WITH LOGIN PASSWORD '${dbPassword}';`);
    stage = 'smtp-sink';
    docker([
      'run',
      '-d',
      '--name',
      sink,
      '--network',
      network,
      '--log-driver',
      'none',
      '--memory',
      '256m',
      '--memory-swap',
      '256m',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,nosuid,size=32m',
      '--mount',
      `type=bind,source=${resolve('scripts/recovery/smtp-sink.mjs')},target=/drill/sink.mjs,readonly`,
      '--entrypoint',
      'node',
      TRANSPORT_IMAGE,
      '/drill/sink.mjs',
    ]);
    created.push(sink);
    stage = 'auth-start';
    const config: Record<string, string> = {
      GOTRUE_API_HOST: '0.0.0.0',
      GOTRUE_API_PORT: '9999',
      API_EXTERNAL_URL: base,
      GOTRUE_DB_DRIVER: 'postgres',
      GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:${dbPassword}@${db}:5432/postgres`,
      GOTRUE_SITE_URL: 'http://127.0.0.1:3000',
      GOTRUE_URI_ALLOW_LIST: 'http://127.0.0.1:3000/**',
      GOTRUE_JWT_SECRET: secret,
      GOTRUE_JWT_EXP: '900',
      GOTRUE_JWT_AUD: 'authenticated',
      GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
      GOTRUE_JWT_ADMIN_ROLES: 'service_role',
      GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
      GOTRUE_EXTERNAL_PHONE_ENABLED: 'false',
      GOTRUE_MAILER_AUTOCONFIRM: 'false',
      GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED: 'true',
      GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL: '0',
      GOTRUE_PASSWORD_MIN_LENGTH: '6',
      GOTRUE_SMTP_HOST: sink,
      GOTRUE_SMTP_PORT: '1025',
      GOTRUE_SMTP_ADMIN_EMAIL: 'recovery@example.invalid',
      GOTRUE_SMTP_SENDER_NAME: 'Recovery local',
      GOTRUE_SMTP_MAX_FREQUENCY: '0s',
      GOTRUE_RATE_LIMIT_EMAIL_SENT: '100',
      GOTRUE_MFA_TOTP_ENROLL_ENABLED: 'true',
      GOTRUE_MFA_TOTP_VERIFY_ENABLED: 'true',
      GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED: 'true',
      GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI:
        'pg-functions://postgres/public/custom_access_token_hook',
      ...restoredSettings,
    };
    docker([
      'run',
      '-d',
      '--name',
      auth,
      '--network',
      network,
      '--log-driver',
      'none',
      '--memory',
      '384m',
      '--memory-swap',
      '384m',
      '--tmpfs',
      '/tmp:rw,nosuid,size=32m',
      ...Object.entries(config).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
      AUTH_IMAGE,
    ]);
    created.push(auth);
    ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        if ((await request('/health')).status === 200) {
          ready = true;
          break;
        }
      } catch {
        /* health pendente, prazo limitado */
      }
      await delay(1000);
    }
    assert.ok(ready, 'Auth não iniciou');
    results.push('auth-health');
    results.push('seven-nonsecret-settings-from-encrypted-snapshot');
    stage = 'qoro-real-schema';
    sql('CREATE ROLE qoro_runtime NOLOGIN NOBYPASSRLS; GRANT authenticated TO qoro_runtime;');
    // A imagem local não provisiona a função opcional do serviço gerenciado.
    // Corpo funcional do exemplo oficial (não stub): https://supabase.com/docs/guides/database/postgres/event-triggers
    sql(`CREATE OR REPLACE FUNCTION public.rls_auto_enable() RETURNS event_trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
      DECLARE cmd record; BEGIN
      FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
        WHERE command_tag IN ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
          AND object_type IN ('table','partitioned table') LOOP
        IF cmd.schema_name='public' THEN
          EXECUTE format('ALTER TABLE IF EXISTS %s ENABLE ROW LEVEL SECURITY',cmd.object_identity);
        END IF;
      END LOOP; END $$;`);
    const migrations = (await readdir('drizzle/migrations'))
      .filter((name) => /^\d{4}_.*\.sql$/u.test(name))
      .sort();
    for (const name of migrations) {
      stage = `migration-${name.slice(0, 4)}`;
      sql(await readFile(resolve('drizzle/migrations', name), 'utf8'));
    }
    results.push(`real-migrations-${migrations.length}`);
    stage = 'signup-and-confirmation';
    const client = createClient(base, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          const url = new URL(
            typeof input === 'string' || input instanceof URL ? input : input.url,
          );
          assert.equal(url.origin, base);
          const req = new Request(url, init);
          const text = ['GET', 'HEAD'].includes(req.method) ? '' : await req.text();
          return request(
            url.pathname.replace(/^\/auth\/v1/u, '') + url.search,
            req.method,
            text ? JSON.parse(text) : undefined,
            req.headers.get('authorization')?.replace(/^Bearer /u, '') ?? '',
          );
        },
      },
    });
    const signup = await client.auth.signUp({ email, password });
    assert.ifError(signup.error);
    assert.ok(signup.data.user);
    assert.equal(signup.data.session, null);
    const unconfirmed = await client.auth.signInWithPassword({ email, password });
    assert.ok(unconfirmed.error, 'Não confirmado não pode autenticar');
    const userId = signup.data.user.id;
    const clinicId = randomUUID();
    sql(`INSERT INTO clinics(id,slug,nome,status) VALUES('${clinicId}','auth-drill-${randomBytes(4).toString('hex')}','Synthetic recovery','active');
      INSERT INTO profiles(id,clinic_id,nome,role,ativo,invite_accepted_at) VALUES('${userId}','${clinicId}','Synthetic owner','owner',true,now());`);
    async function mailLink(): Promise<URL> {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const messages: string[] = await (
          await request('/messages', 'GET', undefined, '', sink, 8025)
        ).json();
        const link = messages
          .at(-1)
          ?.replace(/=\r\n/gu, '')
          .replace(/=3D/giu, '=')
          .match(/https?:\/\/[^\s"<>]+\/verify\?[^\s"<>]+/u)?.[0];
        if (link) return new URL(link.replace(/&amp;/gu, '&'));
        await delay(250);
      }
      throw new Error('E-mail sintético não chegou ao SMTP local');
    }
    const confirm = await mailLink();
    const otp = confirm.searchParams.get('token');
    assert.ok(otp);
    assert.ifError((await client.auth.verifyOtp({ token_hash: otp, type: 'signup' })).error);
    results.push('signup-confirmation-local-email');
    stage = 'login-session-and-qoro-claims';
    const login = await client.auth.signInWithPassword({ email, password });
    assert.ifError(login.error);
    assert.ok(login.data.session);
    const claimsResult = await client.auth.getClaims(login.data.session.access_token);
    assert.ifError(claimsResult.error);
    const claims = parseClaims(claimsResult.data?.claims);
    assert.ok(claims);
    assert.equal(claims.clinic_id, clinicId);
    assert.equal(claims.app_role, 'owner');
    assert.ok(claims.permissions.length > 0);
    const otherClinic = randomUUID();
    sql(
      `INSERT INTO clinics(id,slug,nome,status) VALUES('${otherClinic}','other-${randomBytes(4).toString('hex')}','Other synthetic tenant','active');`,
    );
    const scoped = sql(`BEGIN; SET LOCAL ROLE authenticated;
      SELECT set_config('request.jwt.claims','${JSON.stringify(claims)}',true);
      SELECT jsonb_build_object('own',(SELECT count(*) FROM clinics WHERE id='${clinicId}'),
        'other',(SELECT count(*) FROM clinics WHERE id='${otherClinic}')); ROLLBACK;`).split('\n');
    const scopeResult = scoped.at(-2);
    assert.ok(scopeResult);
    assert.deepEqual(
      JSON.parse(scopeResult),
      { own: 1, other: 0 },
      'RLS precisa permitir a própria clínica e negar outra',
    );
    results.push('real-token-tenant-rls-denial');
    assert.ifError((await client.auth.getUser()).error);
    assert.ok([401, 403].includes((await request('/user', 'GET', undefined, 'invalid')).status));
    assert.equal(
      (await request('/admin/users', 'GET', undefined, login.data.session.access_token)).status,
      403,
    );
    results.push('login-user-claims-parser', 'invalid-token-denied', 'admin-denied');
    stage = 'refresh-and-revocation';
    const oldVersion = claims.claims_version;
    sql(
      `UPDATE profiles SET nome='Synthetic renamed',claims_version=claims_version+1 WHERE id='${userId}';`,
    );
    const refreshed = await client.auth.refreshSession();
    assert.ifError(refreshed.error);
    assert.ok(refreshed.data.session);
    const newClaims = parseClaims(
      (await client.auth.getClaims(refreshed.data.session.access_token)).data?.claims,
    );
    assert.ok(newClaims && newClaims.claims_version > oldVersion);
    results.push('refresh-new-authoritative-claims');
    stage = 'password-recovery';
    assert.ifError((await client.auth.resetPasswordForEmail(email)).error);
    const recovery = await mailLink();
    assert.equal(recovery.searchParams.get('type'), 'recovery');
    const recoveryToken = recovery.searchParams.get('token');
    assert.ok(recoveryToken);
    assert.ifError(
      (await client.auth.verifyOtp({ token_hash: recoveryToken, type: 'recovery' })).error,
    );
    const newPassword = randomBytes(24).toString('base64url');
    assert.ifError((await client.auth.updateUser({ password: newPassword })).error);
    assert.ok(
      (await client.auth.verifyOtp({ token_hash: recoveryToken, type: 'recovery' })).error,
      'Replay de recovery aceito',
    );
    assert.ok(
      (await client.auth.signInWithPassword({ email, password })).error,
      'Senha anterior continua válida',
    );
    assert.ifError((await client.auth.signInWithPassword({ email, password: newPassword })).error);
    stage = 'mfa-totp';
    const enrollment = await client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Synthetic recovery',
    });
    assert.ifError(enrollment.error);
    assert.ok(enrollment.data && enrollment.data.type === 'totp');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const letter of enrollment.data.totp.secret.replace(/=+$/u, '').toUpperCase()) {
      const index = alphabet.indexOf(letter);
      assert.ok(index >= 0);
      bits += index.toString(2).padStart(5, '0');
    }
    const decoded: number[] = [];
    for (let index = 0; index + 8 <= bits.length; index += 8)
      decoded.push(Number.parseInt(bits.slice(index, index + 8), 2));
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
    const mac = createHmac('sha1', Buffer.from(decoded)).update(counter).digest();
    const offset = mac[mac.length - 1]! & 15;
    const otpCode = ((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
    assert.ifError(
      (await client.auth.mfa.challengeAndVerify({ factorId: enrollment.data.id, code: otpCode }))
        .error,
    );
    assert.equal(
      (await client.auth.mfa.getAuthenticatorAssuranceLevel()).data?.currentLevel,
      'aal2',
    );
    results.push('totp-enrollment-and-aal2');
    const refreshToken = (await client.auth.refreshSession()).data.session?.refresh_token;
    assert.ok(refreshToken);
    assert.ifError((await client.auth.signOut({ scope: 'global' })).error);
    assert.ok(
      (await client.auth.refreshSession({ refresh_token: refreshToken })).error,
      'Refresh após logout aceito',
    );
    results.push(
      'password-recovery-local-email',
      'recovery-replay-denied',
      'old-password-denied',
      'logout-refresh-revoked',
    );
    stage = 'isolation';
    assert.equal(docker(['network', 'inspect', '--format', '{{.Internal}}', network]), 'true');
    for (const name of created) {
      const items: Array<{
        HostConfig: {
          LogConfig: { Type: string };
          PortBindings: Record<string, unknown> | null;
          Tmpfs: Record<string, string>;
        };
        NetworkSettings: { Networks: Record<string, unknown> };
      }> = JSON.parse(docker(['inspect', name]));
      assert.equal(items[0]?.HostConfig.LogConfig.Type, 'none');
      assert.equal(Object.keys(items[0]?.HostConfig.PortBindings ?? {}).length, 0);
      assert.ok(Object.keys(items[0]?.HostConfig.Tmpfs ?? {}).length > 0);
      assert.deepEqual(Object.keys(items[0]?.NetworkSettings.Networks ?? {}), [network]);
    }
  } finally {
    for (const name of created.reverse()) docker(['rm', '-f', name]);
    if (networkCreated) docker(['network', 'rm', network]);
  }
  process.stdout.write(
    JSON.stringify({
      result: 'PASS',
      checks: results,
      elapsedMs: Date.now() - started,
      cleanup: 'completed',
      scope:
        'synthetic identities; real Auth and Qoro schema/hook/parser; not full Next request or production secrets',
    }) + '\n',
  );
}
main().catch(() => {
  process.stderr.write(`FAIL Auth recovery: ${stage}; sensitive output suppressed\n`);
  process.exitCode = 1;
});
