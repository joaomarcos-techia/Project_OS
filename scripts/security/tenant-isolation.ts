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
  [
    '-D',
    data,
    '-p',
    String(port),
    '-h',
    '127.0.0.1',
    '-c',
    'ssl=on',
    // O socket Unix vai para o diretório do PRÓPRIO cluster. O default é
    // `/var/run/postgresql`, onde o runner do CI não tem permissão de escrita —
    // e o servidor morria com "could not create lock file ... Permission denied"
    // antes de aceitar a primeira conexão. Aqui tudo é TCP em 127.0.0.1; o
    // socket só precisa existir em algum lugar gravável. No Windows é ignorado.
    '-c',
    `unix_socket_directories=${cluster}`,
  ],
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
  // --- Saúde de envio do WhatsApp (0116) -----------------------------------
  // Três colunas novas na tabela da conexão, que tem o token cifrado da clínica.
  // Mesmo método de cima: tipo, tabela, GRANTs de coluna e policy vêm
  // literalmente das migrations (0022, 0033, 0045, 0107 e a própria 0116), e a
  // escrita passa pelo seam real (lib/messaging/connection-store, dbAdmin).
  const messagingCore = await readFile('drizzle/migrations/0022_messaging_core.sql', 'utf8');
  const coexistenceSql = await readFile('drizzle/migrations/0107_whatsapp_coexistence.sql', 'utf8');
  const literal = (source: string, pattern: RegExp, label: string): string => {
    const statement = source.match(pattern)?.[0];
    assert.ok(statement, `${label} não encontrado`);
    return statement.replaceAll('--> statement-breakpoint', '');
  };
  await admin.unsafe(`
    CREATE TABLE _schema_version (version text PRIMARY KEY);
    CREATE TABLE audit_events (
      id uuid NOT NULL DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL, user_id uuid,
      action text NOT NULL, resource_type text NOT NULL, resource_id text,
      before jsonb, after jsonb, ip_address text, user_agent text, request_id text,
      correlation_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (id, created_at)
    );
  `);
  for (const [pattern, label] of [
    [/DO \$\$ BEGIN\s+CREATE TYPE "public"\."messaging_provider"[\s\S]*?END \$\$;/, '0022 enum'],
    [/CREATE TABLE IF NOT EXISTS "clinic_whatsapp_numbers" \([\s\S]*?\n\);/, '0022 tabela'],
    [/^REVOKE ALL ON clinic_whatsapp_numbers FROM authenticated;/m, '0022 REVOKE'],
    [/^GRANT SELECT \([^)]*\) ON clinic_whatsapp_numbers TO authenticated;/m, '0022 GRANT'],
  ] as const) {
    await admin.unsafe(literal(messagingCore, pattern, label));
  }
  await admin.unsafe(
    (await readFile('drizzle/migrations/0033_messaging_connection_status.sql', 'utf8')).replaceAll(
      '--> statement-breakpoint',
      '',
    ),
  );
  await admin.unsafe(
    literal(
      policies,
      /ALTER TABLE clinic_whatsapp_numbers ENABLE ROW LEVEL SECURITY;[\s\S]*?CREATE POLICY clinic_whatsapp_numbers_tenant_access[\s\S]*?\);/,
      '0045 policy clinic_whatsapp_numbers',
    ),
  );
  for (const [pattern, label] of [
    [
      /ALTER TABLE public\.clinic_whatsapp_numbers\s+ADD COLUMN IF NOT EXISTS coexistence[^;]*;/,
      '0107 coluna',
    ],
    [
      /GRANT SELECT \("coexistence"\) ON public\.clinic_whatsapp_numbers TO authenticated;/,
      '0107 GRANT',
    ],
  ] as const) {
    await admin.unsafe(literal(coexistenceSql, pattern, label));
  }
  await admin.unsafe(
    (await readFile('drizzle/migrations/0116_whatsapp_messaging_health.sql', 'utf8')).replaceAll(
      '--> statement-breakpoint',
      '',
    ),
  );
  const wa = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const wb = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  await admin`
    INSERT INTO clinic_whatsapp_numbers (id, clinic_id, phone_number, meta_phone_id, token_encrypted)
    VALUES (${wa}, ${a}, '+5500000000001', 'phone-sintetico-a', 'cifrado-sintetico-a'),
           (${wb}, ${b}, '+5500000000002', 'phone-sintetico-b', 'cifrado-sintetico-b')`;

  const store = await import('../../src/lib/messaging/connection-store');
  const harnessContext = {
    ip: null,
    userAgent: null,
    requestId: 'tenant-isolation',
    correlationId: null,
  };
  const blockedRead = {
    clinicId: a,
    connectionId: wa,
    state: 'blocked' as const,
    codes: [141006, 141010],
    requestContext: harnessContext,
  };
  assert.equal((await store.loadConnectionForMessagingHealth(a))?.messagingHealthCheckedAt, null);
  assert.deepEqual(await store.recordMessagingHealth(blockedRead), {
    recorded: true,
    changed: true,
    previous: null,
  });
  assert.deepEqual(await store.recordMessagingHealth(blockedRead), {
    recorded: true,
    changed: false,
    previous: 'blocked',
  });
  // A conexão de A com o clinicId de B: o predicado da clínica não deixa gravar.
  assert.deepEqual(
    await store.recordMessagingHealth({
      ...blockedRead,
      clinicId: b,
      state: 'available',
      codes: [],
    }),
    { recorded: false, changed: false, previous: null },
  );
  const [gravada] = await admin`
    SELECT messaging_health, messaging_health_codes, messaging_health_checked_at IS NOT NULL AS lida
      FROM clinic_whatsapp_numbers WHERE id = ${wa}`;
  assert.equal(gravada?.messaging_health, 'blocked');
  assert.deepEqual(gravada?.messaging_health_codes, [141006, 141010]);
  assert.equal(gravada?.lida, true);
  const [auditoria] = await admin`
    SELECT count(*)::int AS n FROM audit_events
     WHERE resource_id = ${wa} AND action = 'messaging.whatsapp.messaging_health_changed'`;
  assert.equal(Number(auditoria?.n), 1);
  const due = await store.listConnectionsDueForMessagingHealth(10, new Date(Date.now() - 60_000));
  assert.deepEqual(
    due.map((c) => c.id),
    [wb],
  );
  pass(
    'saúde de envio: o seam grava estado, códigos e data; audita só a mudança; não grava com o clinicId de outra clínica; a varredura pega só quem não foi lido',
  );

  for (const [ownClinic, ownUser, ownRow, otherRow, expected] of [
    [a, ua, wa, wb, 'blocked'],
    [b, ub, wb, wa, null],
  ] as const) {
    await withTenant(
      ownClinic,
      async (tx) => {
        const own = await tx.execute<{ messaging_health: string | null }>(
          sql`SELECT messaging_health, messaging_health_codes, messaging_health_checked_at
                FROM clinic_whatsapp_numbers WHERE id = ${ownRow}::uuid`,
        );
        assert.equal(own.length, 1);
        assert.equal(own[0]?.messaging_health, expected);
        assert.equal(
          (
            await tx.execute(
              sql`SELECT messaging_health FROM clinic_whatsapp_numbers WHERE id = ${otherRow}::uuid`,
            )
          ).length,
          0,
        );
      },
      ownUser,
    );
  }
  const permissionDenied = (error: unknown) => {
    const cause = error instanceof Error ? error.cause : undefined;
    return cause instanceof Error && 'code' in cause && cause.code === '42501';
  };
  await assert.rejects(
    withTenant(
      a,
      (tx) =>
        tx.execute(
          sql`UPDATE clinic_whatsapp_numbers SET messaging_health = 'available' WHERE id = ${wa}::uuid`,
        ),
      ua,
    ),
    permissionDenied,
  );
  await assert.rejects(
    withTenant(
      a,
      (tx) =>
        tx.execute(sql`SELECT token_encrypted FROM clinic_whatsapp_numbers WHERE id = ${wa}::uuid`),
      ua,
    ),
    permissionDenied,
  );
  pass(
    'saúde de envio: authenticated LÊ as três colunas só da própria clínica; UPDATE nelas e leitura do token negados (42501)',
  );
  const checkViolation = (error: unknown) =>
    typeof error === 'object' && error !== null && (error as { code?: string }).code === '23514';
  await assert.rejects(
    admin`UPDATE clinic_whatsapp_numbers SET messaging_health = 'bloqueado' WHERE id = ${wa}`,
    checkViolation,
  );
  await assert.rejects(
    admin`UPDATE clinic_whatsapp_numbers SET messaging_health_checked_at = NULL WHERE id = ${wa}`,
    checkViolation,
  );
  pass(
    'saúde de envio: o CHECK recusa estado fora do vocabulário da Meta e estado sem data (23514)',
  );
  await admin`DELETE FROM clinic_whatsapp_numbers`;
  await admin`DELETE FROM audit_events`;

  // Teardown exato: só o cluster criado aqui contém estas fixtures.
  await admin`DELETE FROM patients`;
  await admin`DELETE FROM profiles`;
  await admin`DELETE FROM clinics`;
  const [remaining] =
    await admin`SELECT (SELECT count(*) FROM patients) + (SELECT count(*) FROM profiles) + (SELECT count(*) FROM clinics)
                     + (SELECT count(*) FROM clinic_whatsapp_numbers) + (SELECT count(*) FROM audit_events) AS n`;
  assert.equal(Number(remaining?.n), 0);
  pass('teardown: pacientes + profiles + clínicas + conexões WhatsApp + auditoria = 0');
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
  /*
   * NÃO lançar daqui.
   *
   * Um `throw` no `finally` APAGA o erro que trouxe a execução até aqui. Foi
   * exatamente isso que aconteceu no CI: o cluster morreu durante o teste, o
   * `pg_ctl stop` não achou o PID file e a única coisa que sobrou no log foi
   * "PID file does not exist" — o sintoma do teardown, não a causa.
   *
   * O harness de cadastro já tinha levado esse mesmo tombo e foi corrigido; este
   * ficou para trás. Agora o desfecho do teardown vira código de saída próprio e
   * imprime o log do servidor, que é onde a causa real está.
   */
  if (stop.error || stop.status !== 0) {
    console.error(
      `[tenant-isolation] teardown do cluster falhou: ${stop.error?.message ?? stop.stderr}`,
    );
    console.error(`[tenant-isolation] log do servidor:
${serverLog.slice(-4_000)}`);
    process.exitCode = 1;
  } else {
    console.log(
      `Cluster temporário parado: ${cluster}; evidência em dist/security-local/tenant-results.txt`,
    );
  }
}
