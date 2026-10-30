/** Restore protegido + migrations reais. Sem URL de banco remoto ou SQL aberto em disco. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const IMAGE = 'public.ecr.aws/supabase/postgres:17.11.0.006';
const { values } = parseArgs({
  options: {
    backup: { type: 'string' },
    sha256: { type: 'string' },
    gpg: { type: 'string', default: 'gpg' },
    'authorize-local-real-data': { type: 'boolean', default: false },
  },
});
const name = `qoro-offer-restore-${randomBytes(6).toString('hex')}`;
let stage = 'preflight';
let created = false;
let restoreDiagnostics: Record<string, number> = {};

function docker(
  args: string[],
  input?: string,
  extraEnv: Readonly<Record<string, string>> = {},
): string {
  try {
    return execFileSync('docker', args, {
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...extraEnv },
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  } catch {
    // psql pode incluir valores de linhas na mensagem. Nunca expor sua saída.
    throw new Error(`Docker/SQL falhou na etapa ${stage}; saída sensível suprimida`);
  }
}
function sql(source: string): string {
  return docker(
    [
      'exec',
      '-i',
      name,
      'psql',
      '-X',
      '-q',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
    ],
    source,
  );
}
/** Só aceita a falha esperada; nunca imprime stderr, que pode conter dados. */
function expectedSqlFailure(source: string, marker: string): void {
  let matched = false;
  try {
    execFileSync(
      'docker',
      [
        'exec',
        '-i',
        name,
        'psql',
        '-X',
        '-q',
        '-At',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        'supabase_admin',
        '-d',
        'postgres',
      ],
      {
        input: source,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30_000,
        windowsHide: true,
      },
    );
  } catch (error: unknown) {
    const stderr: unknown =
      error && typeof error === 'object' ? Reflect.get(error, 'stderr') : null;
    matched = Buffer.isBuffer(stderr) && stderr.toString('utf8').includes(marker);
  }
  assert.ok(matched, 'A falha SQL esperada não foi comprovada');
}
async function proveMigrationAtomicity(body: string): Promise<void> {
  const clinic = randomUUID(),
    owner = randomUUID(),
    staff = randomUUID();
  sql(`BEGIN;
    INSERT INTO clinics(id,slug,nome,status) VALUES('${clinic}','rollback-${clinic.slice(0, 8)}','Synthetic atomicity clinic','active');
    INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${owner}','${owner}@example.invalid',now()),('${staff}','${staff}@example.invalid',now());
    INSERT INTO profiles(id,clinic_id,nome,role,ativo,invite_accepted_at) VALUES
      ('${owner}','${clinic}','Synthetic owner','owner',true,now()),('${staff}','${clinic}','Synthetic staff','attendant',true,now());
    INSERT INTO ai_clinic_config(clinic_id) VALUES('${clinic}');
    INSERT INTO subscriptions(clinic_id,plan_id,price_id,billing_status)
      SELECT '${clinic}',p.id,pr.id,'active' FROM plans p JOIN prices pr ON pr.plan_id=p.id
      WHERE p.code='clinica_2026_2' AND pr.billing_cycle='monthly' AND pr.active_until IS NULL AND pr.campaign_code IS NULL LIMIT 1;
    COMMIT;`);
  const state = () =>
    sql(
      `select json_build_array(claims_version,granular_permissions_enabled) from effective_permissions_v where user_id='${staff}'`,
    );
  const before = state();
  assert.equal(JSON.parse(before)[1], false, 'Baseline deve reproduzir a falha da view');
  expectedSqlFailure(
    `BEGIN; ${body}\nDO $$ BEGIN RAISE EXCEPTION 'QORO_EXPECTED_0133_ABORT'; END $$; COMMIT;`,
    'QORO_EXPECTED_0133_ABORT',
  );
  assert.equal(state(), before, 'View/epoch não reverteram com a transação');
  assert.equal(
    sql("select count(*) from _schema_version where version='0133-offer-2026-feature-permissions'"),
    '0',
  );
  assert.equal(sql('select count(*) from drizzle.__drizzle_migrations'), '133');

  // Uma leitura concorrente mantém lock da view. A migration deve abortar
  // integralmente ao atingir lock_timeout, e funcionar após liberar a leitura.
  const holder = spawn(
    'docker',
    [
      'exec',
      '-i',
      name,
      'psql',
      '-X',
      '-q',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  const ended = closed(holder);
  holder.stderr.resume();
  let ready = false;
  holder.stdout.on('data', (chunk: Buffer) => {
    if (chunk.toString('utf8').includes('QORO_LOCK_READY')) ready = true;
  });
  holder.stdin.end(
    "BEGIN; SELECT count(*) FROM effective_permissions_v; SELECT 'QORO_LOCK_READY'; SELECT pg_sleep(3); COMMIT;",
  );
  try {
    for (let attempt = 0; attempt < 40 && !ready; attempt++) await delay(50);
    assert.ok(ready, 'Leitura concorrente não iniciou');
    expectedSqlFailure(`BEGIN; SET LOCAL lock_timeout='200ms'; ${body}\nCOMMIT;`, 'lock timeout');
    assert.equal(state(), before, 'Tentativa bloqueada alterou o epoch/view');
    assert.equal(await ended, 0, 'Leitura concorrente não concluiu');
  } finally {
    holder.kill();
  }
}
function closed(child: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error(`Processo indisponível na etapa ${stage}`)));
    child.once('close', (code) => resolve(code ?? -1));
  });
}
async function restore(backup: string, passphrase: string): Promise<void> {
  const decrypt = spawn(
    values.gpg!,
    [
      '--batch',
      '--quiet',
      '--no-tty',
      '--pinentry-mode',
      'loopback',
      '--passphrase-fd',
      '0',
      '--decrypt',
      backup,
    ],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  const restore = spawn(
    'docker',
    [
      'exec',
      '-i',
      name,
      'psql',
      '-X',
      '-w',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
    ],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  const codes = Promise.all([closed(decrypt), closed(restore)]);
  // Drenar sem armazenar/registrar SQL ou erros potencialmente sensíveis.
  let sqlErrors = 0;
  restore.stdout.resume();
  restore.stderr.on('data', (bytes: Buffer) => {
    sqlErrors += (bytes.toString('utf8').match(/(?:ERROR|FATAL):/gu) ?? []).length;
  });
  decrypt.stderr.resume();
  decrypt.stdin.on('error', () => decrypt.kill());
  restore.stdin.on('error', () => decrypt.kill());
  decrypt.stdout.pipe(restore.stdin);
  decrypt.stdin.end(`${passphrase}\n`);
  const timer = setTimeout(() => {
    decrypt.kill();
    restore.kill();
  }, 120_000);
  try {
    const [gpg, psql] = await codes;
    restoreDiagnostics = { gpg, psql, sqlErrors };
    assert.equal(gpg, 0, 'GPG não concluiu');
    assert.equal(psql, 0, 'Restore estrito não concluiu');
    assert.equal(sqlErrors, 0, 'Restore teve erros SQL');
  } finally {
    clearTimeout(timer);
    decrypt.kill();
    restore.kill();
  }
}

type Journal = { entries: Array<{ idx: number; when: number; tag: string }> };
type Digest = { table: string; ids: string[]; columns: string[]; digest: string };
function legacyDigest(table: string, ids?: string[], columns?: string[]): Digest {
  assert.ok(['subscriptions', 'plans', 'prices', 'profiles'].includes(table));
  const originalIds: string[] =
    ids ??
    JSON.parse(sql(`select coalesce(json_agg(id::text order by id),'[]') from public.${table}`));
  const originalColumns: string[] =
    columns ??
    JSON.parse(
      sql(
        `select json_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='${table}'`,
      ),
    );
  assert.ok(originalIds.every((id) => /^[a-f0-9-]{36}$/u.test(id)));
  assert.ok(originalColumns.every((column) => /^[a-z_]+$/u.test(column)));
  const fields = originalColumns.map((column) => `'${column}', t."${column}"`).join(',');
  const scope = originalIds.length
    ? `id in (${originalIds.map((id) => `'${id}'::uuid`).join(',')})`
    : 'false';
  const digest = sql(
    `select md5(coalesce(jsonb_agg(jsonb_build_object(${fields}) order by id)::text,'[]')) from public.${table} t where ${scope}`,
  );
  return { table, ids: originalIds, columns: originalColumns, digest };
}

const MATRIX = `
DO $$
DECLARE v_code text; allowed boolean; clinic uuid; owner_id uuid; staff_id uuid;
  plan_id uuid; price_id uuid; perms text[]; enabled boolean; hook jsonb;
  before_epoch int; after_epoch int;
BEGIN
  FOREACH v_code IN ARRAY ARRAY['solo','consultorio_2026','clinica','pro','clinica_2026_2','clinica_2026_3','clinica_2026_4','clinica_2026_5'] LOOP
    allowed := v_code NOT IN ('solo','consultorio_2026');
    clinic := gen_random_uuid(); owner_id := gen_random_uuid(); staff_id := gen_random_uuid();
    INSERT INTO clinics(id,slug,nome,status) VALUES(clinic,'restored-'||left(clinic::text,8),'Synthetic restored clinic','active');
    INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
      (owner_id,'owner-'||owner_id||'@example.invalid',now()),(staff_id,'staff-'||staff_id||'@example.invalid',now());
    INSERT INTO profiles(id,clinic_id,nome,role,ativo,invite_accepted_at) VALUES
      (owner_id,clinic,'Synthetic owner','owner',true,now()),(staff_id,clinic,'Synthetic staff','attendant',true,now());
    INSERT INTO ai_clinic_config(clinic_id) VALUES(clinic);
    SELECT p.id,pr.id INTO STRICT plan_id,price_id FROM plans p JOIN prices pr ON pr.plan_id=p.id
      WHERE p.code=v_code AND pr.billing_cycle='monthly' AND pr.active_until IS NULL AND pr.campaign_code IS NULL LIMIT 1;
    INSERT INTO subscriptions(clinic_id,plan_id,price_id,billing_status,asaas_subscription_id)
      VALUES(clinic,plan_id,price_id,'active','sub_synthetic_restored_'||clinic);
    INSERT INTO user_permission_overrides(clinic_id,user_id,permission_code,granted)
      VALUES(clinic,staff_id,'manage:settings',true),(clinic,staff_id,'view:financial',false);
    SELECT v.permissions,v.granular_permissions_enabled,v.claims_version INTO perms,enabled,before_epoch
      FROM effective_permissions_v v WHERE v.user_id=staff_id;
    IF enabled IS DISTINCT FROM allowed OR ('manage:settings'=ANY(perms)) IS DISTINCT FROM allowed
      OR ('view:financial'=ANY(perms)) IS DISTINCT FROM NOT allowed THEN RAISE EXCEPTION 'entitlement matrix failed'; END IF;
    hook := public.custom_access_token_hook(jsonb_build_object('user_id',staff_id::text,'claims','{}'::jsonb));
    IF (hook->'claims'->>'granular_permissions_enabled')::boolean IS DISTINCT FROM allowed
      OR (hook->'claims'->'permissions' ? 'manage:settings') IS DISTINCT FROM allowed THEN RAISE EXCEPTION 'token hook matrix failed'; END IF;
    IF v_code='clinica_2026_2' THEN
      UPDATE subscriptions SET plan_id=(SELECT id FROM plans WHERE plans.code='consultorio_2026'),
        price_id=(SELECT pr.id FROM prices pr JOIN plans p ON p.id=pr.plan_id WHERE p.code='consultorio_2026'
          AND pr.billing_cycle='monthly' AND pr.active_until IS NULL AND pr.campaign_code IS NULL LIMIT 1) WHERE clinic_id=clinic;
      SELECT v.permissions,v.granular_permissions_enabled,v.claims_version INTO perms,enabled,after_epoch
        FROM effective_permissions_v v WHERE v.user_id=staff_id;
      IF enabled OR 'manage:settings'=ANY(perms) OR NOT ('view:financial'=ANY(perms)) OR after_epoch<=before_epoch
        THEN RAISE EXCEPTION 'downgrade/session invalidation failed'; END IF;
      IF (SELECT count(*) FROM user_permission_overrides WHERE user_id=staff_id)<>2 THEN RAISE EXCEPTION 'override history lost'; END IF;
      UPDATE subscriptions s SET plan_id=p.id,price_id=pr.id FROM plans p JOIN prices pr ON pr.plan_id=p.id
        WHERE s.clinic_id=clinic AND p.code='clinica_2026_2' AND pr.billing_cycle='monthly'
          AND pr.active_until IS NULL AND pr.campaign_code IS NULL;
      SELECT v.permissions INTO perms FROM effective_permissions_v v WHERE v.user_id=staff_id;
      IF NOT ('manage:settings'=ANY(perms)) THEN RAISE EXCEPTION 'upgrade did not reapply overrides'; END IF;
    END IF;
  END LOOP;
END $$;
`;

async function main(): Promise<void> {
  assert.equal(
    values['authorize-local-real-data'],
    true,
    'Exige autorização explícita de restore local',
  );
  assert.ok(values.backup && values.sha256 && /^[a-f0-9]{64}$/u.test(values.sha256));
  const backup = resolve(values.backup);
  assert.ok(backup.endsWith('.sql.gpg'), 'Somente backup cifrado');
  const passphrase = process.env.BACKUP_PASSPHRASE;
  assert.ok(
    passphrase && !/[\r\n]/u.test(passphrase),
    'Senha deve vir do cofre no ambiente do processo',
  );
  const encrypted = await readFile(backup);
  assert.equal(
    createHash('sha256').update(encrypted).digest('hex'),
    values.sha256,
    'Hash do backup divergente',
  );
  const journal: Journal = JSON.parse(
    await readFile('drizzle/migrations/meta/_journal.json', 'utf8'),
  );
  assert.equal(journal.entries.length, 134, 'Revisar alvo se o journal mudou');
  assert.equal(journal.entries[133]?.tag, '0133_offer_2026_feature_permissions');
  const evidence: Record<string, unknown> = {
    backupSha256: values.sha256,
    image: IMAGE,
    startedAt: new Date().toISOString(),
  };
  try {
    stage = 'start';
    docker(
      [
        'run',
        '-d',
        '--name',
        name,
        '--network',
        'none',
        '--log-driver',
        'none',
        '--memory',
        '2g',
        '--memory-swap',
        '2g',
        '--tmpfs',
        '/var/lib/postgresql/data:rw,nosuid,size=1g',
        '--tmpfs',
        '/tmp:rw,nosuid,size=128m',
        '-e',
        'POSTGRES_PASSWORD',
        IMAGE,
      ],
      undefined,
      { POSTGRES_PASSWORD: randomBytes(32).toString('hex') },
    );
    created = true;
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        // O initdb pode ter um servidor temporário no socket Unix. Exigir TCP,
        // como o drill Auth existente, evita restaurar durante essa fase.
        docker([
          'exec',
          name,
          'pg_isready',
          '-h',
          '127.0.0.1',
          '-U',
          'supabase_admin',
          '-d',
          'postgres',
        ]);
        ready = sql("select count(*) from pg_roles where rolname='supabase_auth_admin'") === '1';
      } catch {
        /* initdb em andamento, com prazo limitado */
      }
      if (ready) break;
      await delay(1000);
    }
    assert.ok(ready, 'Servidor local não iniciou');
    const [inspect] = JSON.parse(docker(['inspect', name])) as Array<{
      HostConfig: {
        NetworkMode: string;
        PortBindings: Record<string, unknown> | null;
        LogConfig: { Type: string };
        Tmpfs: Record<string, string>;
        Memory: number;
        MemorySwap: number;
      };
    }>;
    assert.ok(inspect);
    assert.equal(inspect.HostConfig.NetworkMode, 'none');
    assert.equal(Object.keys(inspect.HostConfig.PortBindings ?? {}).length, 0);
    assert.equal(inspect.HostConfig.LogConfig.Type, 'none');
    assert.equal(Object.keys(inspect.HostConfig.Tmpfs).length, 2);
    assert.equal(inspect.HostConfig.MemorySwap, inspect.HostConfig.Memory);
    evidence.confinement = 'network none; no ports; log none; tmpfs; swap bounded';
    const versions: { postgres: string; vault: string } = JSON.parse(
      sql(
        "select json_build_object('postgres',current_setting('server_version'),'vault',(select extversion from pg_extension where extname='supabase_vault'))",
      ),
    );
    assert.ok(versions.postgres.startsWith('17.'));
    assert.equal(versions.vault, '0.3.1');
    evidence.postgresAndVault = versions;
    stage = 'restore';
    await restore(backup, passphrase);
    const inventory: Record<string, number> = JSON.parse(
      sql(`select json_build_object(
      'publicTables',(select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'),
      'authTables',(select count(*) from information_schema.tables where table_schema='auth' and table_type='BASE TABLE'),
      'users',(select count(*) from auth.users),'clinics',(select count(*) from clinics),
      'profiles',(select count(*) from profiles),'subscriptions',(select count(*) from subscriptions))`),
    );
    assert.deepEqual(
      inventory,
      { publicTables: 135, authTables: 27, users: 8, clinics: 4, profiles: 8, subscriptions: 4 },
      'Inventário não corresponde ao snapshot aprovado de 28/10',
    );
    evidence.restoredInventory = inventory;
    const applied: Array<{ hash: string; created_at: string }> = JSON.parse(
      sql(
        "select json_agg(json_build_object('hash',hash,'created_at',created_at::text) order by created_at) from drizzle.__drizzle_migrations",
      ),
    );
    assert.equal(applied.length, 119, 'Snapshot não corresponde à baseline aprovada');
    assert.ok(
      applied.every((entry, index) => entry.created_at === String(journal.entries[index]?.when)),
      'Ordem histórica divergente',
    );
    const before = ['subscriptions', 'plans', 'prices', 'profiles'].map((table) =>
      legacyDigest(table),
    );
    const migrations: Array<{ tag: string; sha256: string }> = [];
    for (const entry of journal.entries.slice(119)) {
      stage = entry.tag;
      const body = await readFile(resolve('drizzle/migrations', `${entry.tag}.sql`), 'utf8');
      const hash = createHash('sha256').update(body).digest('hex');
      if (entry.idx === 133) {
        stage = '0133-rollback-and-concurrency';
        await proveMigrationAtomicity(body);
        evidence.atomicity = {
          injectedFailureRolledBack: true,
          concurrentReadLockTimeoutRolledBack: true,
        };
        stage = entry.tag;
      }
      sql(
        `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';\n${body}\nINSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES('${hash}',${entry.when}); COMMIT;`,
      );
      migrations.push({ tag: entry.tag, sha256: hash });
    }
    stage = 'integrity';
    for (const original of before)
      assert.equal(
        legacyDigest(original.table, original.ids, original.columns).digest,
        original.digest,
        `Contrato/campo legado alterado: ${original.table}`,
      );
    const after: Array<{ hash: string; created_at: string }> = JSON.parse(
      sql(
        "select json_agg(json_build_object('hash',hash,'created_at',created_at::text) order by created_at) from drizzle.__drizzle_migrations",
      ),
    );
    assert.equal(after.length, 134);
    assert.deepEqual(after.slice(0, 119), applied, 'Histórico anterior foi modificado');
    assert.equal(
      sql(
        "select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and not c.convalidated",
      ),
      '0',
    );
    assert.equal(sql('select count(*) from plan_seat_limits'), '5');
    assert.equal(
      sql(
        "select count(*) from plans where code in ('consultorio_2026','clinica_2026_2','clinica_2026_3','clinica_2026_4','clinica_2026_5') and ativo=false",
      ),
      '5',
    );
    evidence.migrations = migrations;
    evidence.journal = { before: 119, after: 134, priorHashesUnchanged: true };
    evidence.legacy = {
      tables: before.map((entry) => entry.table),
      fieldsUnchanged: true,
      subscriptions: before[0]?.ids.length,
    };
    stage = 'synthetic-feature-matrix';
    sql(MATRIX);
    evidence.featureMatrix = {
      plans: 8,
      grantDenyAndHook: true,
      downgradeAndOldSessionEpoch: true,
      overrideHistoryAndUpgrade: true,
    };
    evidence.result = 'PASS';
  } finally {
    if (created) {
      const completedStage = stage;
      stage = 'cleanup';
      docker(['rm', '-f', name]);
      assert.equal(
        docker(['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}']),
        '',
      );
      evidence.cleanup = 'container removed; no persistent volume';
      stage = completedStage;
    }
  }
  evidence.finishedAt = new Date().toISOString();
  await mkdir('dist/quality', { recursive: true });
  const report = `dist/quality/offer-restored-backup-db-${Date.now()}.json`;
  await writeFile(report, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  console.log(
    'PASS: restore real estrito; 15/15 migrations; contratos legados; oito planos, hook e downgrade; cleanup confirmado.',
  );
}
main().catch(() => {
  console.error(
    `FAIL na etapa ${stage}; códigos ${JSON.stringify(restoreDiagnostics)}; SQL, dados e credenciais suprimidos.`,
  );
  process.exitCode = 1;
});
