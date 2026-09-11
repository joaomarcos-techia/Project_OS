/** Integração com Postgres temporário real. Nunca lê dotenv nem aceita URL externa. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import selfsigned from 'selfsigned';
import { sql } from 'drizzle-orm';

const bin =
  process.env.SECURITY_PG_BIN ??
  (process.platform === 'win32'
    ? 'C:/Program Files/PostgreSQL/17/bin'
    : '/usr/lib/postgresql/17/bin');
const suffix = process.platform === 'win32' ? '.exe' : '';
const cluster = await mkdtemp(path.join(os.tmpdir(), 'qoro-security-pg-'));
const data = path.join(cluster, 'data');
const port = 55439;
const init = spawnSync(
  path.join(bin, `initdb${suffix}`),
  ['-D', data, '-U', 'security_local', '--auth=trust', '--encoding=UTF8', '--no-locale'],
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
  ['-D', data, '-p', String(port), '-h', '127.0.0.1', '-c', 'ssl=on'],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
);
let serverLog = '';
server.stdout.on('data', (chunk: Buffer) => {
  serverLog += chunk.toString();
});
server.stderr.on('data', (chunk: Buffer) => {
  serverLog += chunk.toString();
});
const url = `postgres://security_local@127.0.0.1:${port}/postgres?sslmode=require`;
const admin = postgres(url, {
  ssl: 'require',
  max: 1,
  connect_timeout: 2,
  onnotice: () => undefined,
});
const results: string[] = [];
function pass(message: string) {
  results.push(`PASS ${message}`);
  console.log(results.at(-1));
}
try {
  // A prontidão deve vir deste processo; porta ocupada faz o filho falhar e aborta.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Postgres timeout: ${serverLog}`)), 20_000);
    server.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Postgres exit ${code}: ${serverLog}`));
    });
    const ready = (chunk: Buffer) => {
      if (chunk.toString().includes('ready to accept connections')) {
        clearTimeout(timer);
        resolve();
      }
    };
    server.stderr.on('data', ready);
    if (serverLog.includes('ready to accept connections')) {
      clearTimeout(timer);
      resolve();
    }
  });
  // O marker do diretório impede confundir este cluster com o serviço Postgres da máquina.
  const [settings] = await admin`SELECT current_setting('data_directory') AS dir`;
  assert.equal(path.resolve(String(settings?.dir)), path.resolve(data));
  await admin.unsafe(`
    CREATE ROLE authenticated NOLOGIN NOBYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
    $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE clinics (id uuid PRIMARY KEY);
    CREATE TABLE profiles (id uuid PRIMARY KEY, clinic_id uuid REFERENCES clinics(id));
    CREATE TABLE patients (id uuid PRIMARY KEY, clinic_id uuid REFERENCES clinics(id), nome text NOT NULL);
    GRANT SELECT, INSERT, UPDATE, DELETE ON patients TO authenticated;
  `);
  // Reutiliza literalmente os helpers versionados, sem reescrever a política no teste.
  const helpers = await readFile('drizzle/migrations/0006_identity_postrest_compat.sql', 'utf8');
  for (const name of ['current_platform_role', 'is_super_admin', 'current_clinic_id']) {
    const expression = new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${name}\\(\\)[\\s\\S]*?\\$\\$;`,
    );
    const statement = helpers.match(expression)?.[0];
    assert.ok(statement, `helper ${name} não encontrado`);
    await admin.unsafe(statement);
  }
  const policies = await readFile('drizzle/migrations/0045_rls_v2_and_least_privilege.sql', 'utf8');
  const policy = policies.match(
    /ALTER TABLE patients ENABLE ROW LEVEL SECURITY;[\s\S]*?CREATE POLICY patients_tenant_access[\s\S]*?\);/,
  )?.[0];
  assert.ok(policy, 'policy pacientes não encontrada');
  await admin.unsafe(policy.replaceAll('--> statement-breakpoint', ''));
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';
  const ua = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await admin`INSERT INTO clinics VALUES (${a}), (${b})`;
  await admin`INSERT INTO profiles VALUES (${ua}, ${a}), (${ub}, ${b})`;
  await admin`INSERT INTO patients VALUES (${ua}, ${a}, 'Paciente A sintético'), (${ub}, ${b}, 'Paciente B sintético')`;
  // Reseta aliases herdados ANTES de importar o runtime. Nenhuma .env é carregada.
  for (const key of ['DATABASE_URL_DEV', 'DATABASE_URL_RUNTIME', 'SUPABASE_PROJECT_ENV'])
    delete process.env[key];
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55440',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_security',
  });
  const { withTenant } = await import('../../src/lib/db/tenant');
  for (const [ownClinic, ownUser, otherUser] of [
    [a, ua, ub],
    [b, ub, ua],
  ] as const) {
    // A identidade e a clínica vêm do seed; o ID alvo estrangeiro simula o payload hostil.
    await withTenant(
      ownClinic,
      async (tx) => {
        const principal = await tx.execute<{ role: string; actor: string }>(
          sql`SELECT current_user AS role, current_setting('app.current_user') AS actor`,
        );
        assert.equal(principal[0]?.role, 'authenticated');
        assert.equal(principal[0]?.actor, ownUser);
        assert.equal(
          (await tx.execute(sql`SELECT * FROM patients WHERE id = ${otherUser}::uuid`)).length,
          0,
        );
        assert.equal(
          (
            await tx.execute(
              sql`UPDATE patients SET nome = 'invasão' WHERE id = ${otherUser}::uuid RETURNING id`,
            )
          ).length,
          0,
        );
        assert.equal(
          (await tx.execute(sql`DELETE FROM patients WHERE id = ${otherUser}::uuid RETURNING id`))
            .length,
          0,
        );
        assert.equal(
          (await tx.execute(sql`SELECT * FROM patients WHERE id = ${ownUser}::uuid`)).length,
          1,
        );
        assert.equal(
          (
            await tx.execute(
              sql`UPDATE patients SET nome = 'edição autorizada' WHERE id = ${ownUser}::uuid RETURNING id`,
            )
          ).length,
          1,
        );
      },
      ownUser,
    );
    pass(
      `${ownClinic === a ? 'A contra B' : 'B contra A'}: SELECT/UPDATE/DELETE estrangeiro=0; SELECT/UPDATE próprio=1; role authenticated`,
    );
  }
  await assert.rejects(
    withTenant(a, (tx) =>
      tx.execute(
        sql`INSERT INTO patients VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', ${b}::uuid, 'intruso')`,
      ),
    ),
    (error: unknown) => {
      // Drizzle preserva o SQLSTATE do driver em cause; não aceitar erro genérico.
      const cause = error instanceof Error ? error.cause : undefined;
      return cause instanceof Error && 'code' in cause && cause.code === '42501';
    },
  );
  pass('INSERT clinic_id estrangeiro rejeitado por RLS 42501');
  await withTenant(
    a,
    async (tx) => {
      assert.equal(
        (await tx.execute(sql`DELETE FROM patients WHERE id = ${ua}::uuid RETURNING id`)).length,
        1,
      );
    },
    ua,
  );
  pass('DELETE próprio permitido');
  // --- CONTRAFACTUAL (auditoria adversarial 2026-09-11, SEC-002) -------------
  // Tudo acima prova que COM o role-switch o isolamento vale. Isso sozinho não
  // diz se quem isola é o `SET LOCAL ROLE authenticated` ou a RLS por si. A
  // diferença importa: se fosse a RLS, esquecer o `withTenant` seria inofensivo.
  // Aqui a MESMA policy é exercitada pelo papel do pool (dono, BYPASSRLS) e o
  // resultado é oposto — é a medição que sustenta o desenho inteiro, e a razão
  // de `withTenant` verificar `current_user` antes de rodar qualquer callback.
  const [vazamento] =
    await admin`SELECT count(*)::int AS n FROM patients WHERE clinic_id = ${b}::uuid`;
  assert.equal(
    Number(vazamento?.n),
    1,
    'o papel do pool deveria enxergar a linha estrangeira; se não enxerga, a fixture mudou',
  );
  const [papelDoPool] =
    await admin`SELECT current_user AS role, usebypassrls FROM pg_user WHERE usename = current_user`;
  assert.equal(papelDoPool?.usebypassrls, true, 'papel do pool deixou de ser BYPASSRLS');
  pass(
    `CONTRAFACTUAL: sem role-switch o papel do pool (${String(papelDoPool?.role)}, BYPASSRLS) LÊ a linha da outra clínica — quem isola é o SET LOCAL ROLE, não a RLS sozinha`,
  );
  // Teardown exato: só o cluster criado aqui contém estas fixtures.
  await admin`DELETE FROM patients`;
  await admin`DELETE FROM profiles`;
  await admin`DELETE FROM clinics`;
  const [remaining] =
    await admin`SELECT (SELECT count(*) FROM patients) + (SELECT count(*) FROM profiles) + (SELECT count(*) FROM clinics) AS n`;
  assert.equal(Number(remaining?.n), 0);
  pass('teardown: pacientes + profiles + clínicas = 0');
} finally {
  await admin.end({ timeout: 1 });
  // pg_ctl recebe o caminho absoluto que esta execução criou, nunca URL/path do usuário.
  const stop = spawnSync(
    path.join(bin, `pg_ctl${suffix}`),
    ['-D', data, '-m', 'immediate', '-w', 'stop'],
    { windowsHide: true, encoding: 'utf8' },
  );
  const output = path.resolve('dist/security-local');
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, 'tenant-results.txt'),
    [...results, serverLog, stop.stdout, stop.stderr].join('\n'),
  );
  if (stop.error) throw stop.error;
  assert.equal(stop.status, 0, stop.stderr);
  console.log(
    `Cluster temporário parado: ${cluster}; evidência em dist/security-local/tenant-results.txt`,
  );
}
