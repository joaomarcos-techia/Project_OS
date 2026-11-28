/** Real synthetic-only recovery rehearsal. Never loads dotenv or connects to a remote database. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  assertRestoreConfinement,
  IsolatedRestoreExitError,
  localDockerHost,
  RESTORE_IMAGE,
  streamIsolatedRestore,
} from './gate-b-isolated-restore';

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const FIXTURE_SCHEMA = 'qoro_synthetic';
const PGDATA = '/var/lib/postgresql/data';
const fixture = `
CREATE SCHEMA qoro_synthetic;
CREATE TABLE qoro_synthetic.parents (id integer PRIMARY KEY, label text NOT NULL UNIQUE);
CREATE TABLE qoro_synthetic.children (
  id integer PRIMARY KEY, parent_id integer NOT NULL REFERENCES qoro_synthetic.parents(id),
  amount numeric(10,2) NOT NULL CHECK (amount >= 0), note text NOT NULL
);
CREATE INDEX children_parent_idx ON qoro_synthetic.children(parent_id);
CREATE TABLE qoro_synthetic.journal (id integer PRIMARY KEY, hash text NOT NULL CHECK(length(hash)=64));
CREATE FUNCTION qoro_synthetic.child_count() RETURNS bigint LANGUAGE sql STABLE SECURITY INVOKER
  AS 'SELECT count(*) FROM qoro_synthetic.children';
INSERT INTO qoro_synthetic.parents VALUES (2,'漢字 — fixture'),(1,'Clínica sintética — João');
INSERT INTO qoro_synthetic.children VALUES (3,2,3.15,'sem dados reais'),(1,1,1.05,'ação'),(2,1,2.10,'UTF8');
INSERT INTO qoro_synthetic.journal VALUES (2,repeat('b',64)),(1,repeat('a',64));
`;
const snapshotSql = `SELECT json_build_object(
  'parents',(SELECT json_agg(t ORDER BY id) FROM qoro_synthetic.parents t),
  'children',(SELECT json_agg(t ORDER BY id) FROM qoro_synthetic.children t),
  'journal',(SELECT json_agg(t ORDER BY id) FROM qoro_synthetic.journal t),
  'tables',(SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='qoro_synthetic'),
  'indexes',(SELECT json_agg(json_build_array(indexname,indexdef) ORDER BY indexname) FROM pg_indexes WHERE schemaname='qoro_synthetic'),
  'constraints',(SELECT json_agg(json_build_array(conname,contype,pg_get_constraintdef(oid),convalidated) ORDER BY conname) FROM pg_constraint WHERE connamespace='qoro_synthetic'::regnamespace),
  'functionCount',qoro_synthetic.child_count(),
  'orphans',(SELECT count(*) FROM qoro_synthetic.children c LEFT JOIN qoro_synthetic.parents p ON p.id=c.parent_id WHERE p.id IS NULL),
  'invalidIndexes',(SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid WHERE c.relnamespace='qoro_synthetic'::regnamespace AND (NOT i.indisvalid OR NOT i.indisready))
);`;

export function verifySyntheticSnapshot(actual: unknown, expected: unknown): void {
  const shape = z.object({
    parents: z.array(z.object({ id: z.number(), label: z.string() })).length(2),
    children: z
      .array(
        z.object({ id: z.number(), parent_id: z.number(), amount: z.number(), note: z.string() }),
      )
      .length(3),
    journal: z.array(z.object({ id: z.number(), hash: z.string().regex(/^[ab]{64}$/u) })).length(2),
    tables: z.array(z.string()).length(3),
    indexes: z.array(z.tuple([z.string(), z.string()])).length(5),
    constraints: z.array(z.tuple([z.string(), z.string(), z.string(), z.literal(true)])).length(7),
    functionCount: z.literal(3),
    orphans: z.literal(0),
    invalidIndexes: z.literal(0),
  });
  shape.parse(actual);
  shape.parse(expected);
  assert.deepEqual(actual, expected, 'Synthetic schema/data/journal parity failed');
}

export async function verifyCipherHash(file: string, expected: string): Promise<void> {
  assert.match(expected, /^[a-f0-9]{64}$/u);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  assert.equal(digest.digest('hex'), expected, 'Ciphertext SHA256 differs');
}

function command(file: string, args: string[], input?: string): string {
  return execFileSync(file, args, {
    input,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 8 * MiB,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}
const docker = (args: string[], input?: string) => command('docker', args, input);
const closed = (child: ReturnType<typeof spawn>): Promise<number> =>
  new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? -1));
  });
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  assert.equal(process.platform, 'linux', 'Dedicated ephemeral Linux runner required');
  const reportPath = path.resolve(z.string().min(1).parse(process.argv[2]));
  await mkdir(path.dirname(reportPath), { recursive: true });
  const initialDisk = await statfs(tmpdir());
  const availableMemory = /MemAvailable:\s+(\d+) kB/u.exec(await readFile('/proc/meminfo', 'utf8'));
  assert.ok(availableMemory?.[1]);
  const resources = {
    availablePhysicalMiB: Math.floor(Number(availableMemory[1]) / 1024),
    freeDiskGiB: (initialDisk.bavail * initialDisk.bsize) / GiB,
  };
  assert.ok(
    resources.availablePhysicalMiB >= 4096,
    'At least 4 GiB available physical RAM required',
  );
  assert.ok(resources.freeDiskGiB >= 8, 'At least 8 GiB disk required');
  const host = localDockerHost();
  const scratch = await mkdtemp(path.join(tmpdir(), 'qoro-synthetic-ci-'));
  await chmod(scratch, 0o700);
  const gpgHome = path.join(scratch, 'gnupg');
  await mkdir(gpgHome, { mode: 0o700 });
  const passphrase = randomBytes(48).toString('base64url');
  const owned: { name: string; id: string }[] = [];
  const checks: { name: string; status: 'PASS'; evidence?: unknown }[] = [];
  let cleanupComplete = false;
  let status: 'PASS' | 'FAIL' = 'FAIL';
  let stage = 'image';
  let imageId = '';
  const sql = (id: string, query: string) =>
    docker(
      [
        '--host',
        host,
        'exec',
        '-i',
        id,
        'psql',
        '-X',
        '-w',
        '-q',
        '-At',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        'supabase_admin',
        '-d',
        'postgres',
      ],
      query,
    );
  async function dispose(item: { name: string; id: string }): Promise<void> {
    const inspected = z
      .array(
        z.object({
          Id: z.string(),
          Name: z.string(),
          Config: z.object({ Image: z.string(), Labels: z.record(z.string(), z.string()) }),
        }),
      )
      .length(1)
      .parse(JSON.parse(docker(['--host', host, 'inspect', item.id])))[0];
    assert.ok(inspected);
    assert.equal(inspected.Id, item.id);
    assert.equal(inspected.Name, '/' + item.name);
    assert.equal(inspected.Config.Image, RESTORE_IMAGE);
    assert.equal(inspected.Config.Labels['qoro.recovery.scope'], 'gate-b1');
    docker(['--host', host, 'rm', '--force', item.id]);
    assert.equal(docker(['--host', host, 'ps', '-aq', '--filter', `id=${item.id}`]), '');
    owned.splice(owned.indexOf(item), 1);
  }
  async function create(): Promise<{ name: string; id: string }> {
    const name = 'qoro-gate-b1-' + randomBytes(6).toString('hex');
    const id = docker([
      '--host',
      host,
      'run',
      '-d',
      '--name',
      name,
      '--label',
      'qoro.recovery.scope=gate-b1',
      '--network',
      'none',
      '--log-driver',
      'none',
      '--memory',
      '2g',
      '--memory-swap',
      '2g',
      '--cpus',
      '1',
      '--tmpfs',
      `${PGDATA}:rw,size=1g,mode=1777`,
      '--tmpfs',
      '/tmp:rw,size=128m,mode=1777',
      '--user',
      'postgres',
      '--env',
      `PGDATA=${PGDATA}/pgdata`,
      '--entrypoint',
      'bash',
      RESTORE_IMAGE,
      '-ceu',
      'initdb -D "$PGDATA" --username=supabase_admin --auth-local=trust --auth-host=reject --encoding=UTF8 --locale=C.UTF-8 >/dev/null; exec postgres -D "$PGDATA" "$@"',
      '--',
      '-c',
      'listen_addresses=',
      '-c',
      'shared_preload_libraries=pg_cron',
      '-c',
      'cron.launch_active_jobs=off',
      '-c',
      'shared_buffers=32MB',
      '-c',
      'max_connections=20',
    ]);
    assert.match(id, /^[a-f0-9]{64}$/u);
    const item = { name, id };
    owned.push(item);
    for (let attempt = 0; attempt < 60; attempt++) {
      const ready = spawn(
        'docker',
        ['--host', host, 'exec', id, 'pg_isready', '-U', 'supabase_admin', '-d', 'postgres'],
        { stdio: 'ignore' },
      );
      if ((await closed(ready)) === 0) break;
      assert.ok(attempt < 59, 'Synthetic PostgreSQL did not become ready');
      await sleep(500);
    }
    const inspected: unknown = JSON.parse(docker(['--host', host, 'inspect', id]));
    assert.equal(assertRestoreConfinement(inspected, name), id);
    assert.equal(z.array(z.object({ Image: z.string() })).parse(inspected)[0]?.Image, imageId);
    assert.equal(sql(id, 'SHOW cron.launch_active_jobs'), 'off');
    assert.equal(sql(id, 'SHOW server_encoding'), 'UTF8');
    return item;
  }
  async function encrypt(name: string, contents: string): Promise<string> {
    const file = path.join(scratch, name + '.sql.gpg');
    const child = spawn(
      'gpg',
      [
        '--no-options',
        '--homedir',
        gpgHome,
        '--batch',
        '--no-symkey-cache',
        '--pinentry-mode',
        'loopback',
        '--passphrase-fd',
        '3',
        '--symmetric',
        '--cipher-algo',
        'AES256',
      ],
      { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] },
    );
    const complete = closed(child);
    const secret = child.stdio[3];
    assert.ok(secret && 'end' in secret);
    secret.end(passphrase + '\n');
    child.stderr.resume();
    child.stdin.end(contents);
    await pipeline(child.stdout, createWriteStream(file, { mode: 0o600, flags: 'wx' }));
    assert.equal(await complete, 0);
    return file;
  }
  async function rejected(name: string, action: () => Promise<unknown>): Promise<void> {
    let evidence: unknown = { rejected: true };
    await assert.rejects(action, (error: unknown) => {
      if (error instanceof IsolatedRestoreExitError)
        evidence = { gpg: error.gpg, psql: error.psql };
      return true;
    });
    checks.push({ name, status: 'PASS', evidence });
  }
  try {
    docker(['--host', host, 'pull', RESTORE_IMAGE]);
    const image = z
      .array(z.object({ Id: z.string(), RepoDigests: z.array(z.string()).nonempty() }))
      .length(1)
      .parse(JSON.parse(docker(['--host', host, 'image', 'inspect', RESTORE_IMAGE])))[0];
    assert.ok(image);
    imageId = image.Id;
    checks.push({ name: 'official_pinned_image', status: 'PASS', evidence: image });
    checks.push({
      name: 'versions',
      status: 'PASS',
      evidence: {
        docker: docker(['version', '--format', '{{.Client.Version}} / {{.Server.Version}}']),
        gpg: command('gpg', ['--version']).split('\n')[0],
      },
    });
    stage = 'source';
    const source = await create();
    sql(source.id, fixture);
    const expected: unknown = JSON.parse(sql(source.id, snapshotSql));
    verifySyntheticSnapshot(expected, expected);
    const backup = path.join(scratch, 'fixture.sql.gpg');
    const dump = spawn(
      'docker',
      [
        '--host',
        host,
        'exec',
        source.id,
        'pg_dump',
        '-U',
        'supabase_admin',
        '-d',
        'postgres',
        '--schema',
        FIXTURE_SCHEMA,
        '--no-owner',
        '--no-privileges',
        '--encoding=UTF8',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const cipher = spawn(
      'gpg',
      [
        '--no-options',
        '--homedir',
        gpgHome,
        '--batch',
        '--no-symkey-cache',
        '--pinentry-mode',
        'loopback',
        '--passphrase-fd',
        '3',
        '--symmetric',
        '--cipher-algo',
        'AES256',
      ],
      { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] },
    );
    const processes = Promise.all([closed(dump), closed(cipher)]);
    dump.stderr.resume();
    cipher.stderr.resume();
    const secret = cipher.stdio[3];
    assert.ok(secret && 'end' in secret);
    secret.end(passphrase + '\n');
    try {
      await Promise.all([
        pipeline(dump.stdout, cipher.stdin),
        pipeline(cipher.stdout, createWriteStream(backup, { mode: 0o600, flags: 'wx' })),
      ]);
      assert.deepEqual(await processes, [0, 0]);
    } finally {
      dump.kill();
      cipher.kill();
    }
    const bytes = await readFile(backup);
    const hash = createHash('sha256').update(bytes).digest('hex');
    await verifyCipherHash(backup, hash);
    checks.push({
      name: 'pg_dump_gpg_AES256_stream',
      status: 'PASS',
      evidence: {
        bytes: bytes.length,
        sha256: hash,
        dumpExit: 0,
        gpgExit: 0,
        postgres: sql(source.id, 'SHOW server_version'),
      },
    });
    await dispose(source);
    stage = 'restore';
    let target = await create();
    const exitCodes = await streamIsolatedRestore(backup, passphrase, target.name, 'gpg', {
      gpgHome,
    });
    const actual: unknown = JSON.parse(sql(target.id, snapshotSql));
    verifySyntheticSnapshot(actual, expected);
    checks.push({
      name: 'restored_schema_data_indexes_constraints_functions_journal',
      status: 'PASS',
      evidence: {
        exitCodes,
        snapshot: actual,
        snapshotSha256: createHash('sha256').update(JSON.stringify(actual)).digest('hex'),
      },
    });
    assert.throws(() =>
      sql(target.id, "INSERT INTO qoro_synthetic.children VALUES (99,99,1,'invalid FK')"),
    );
    checks.push({ name: 'foreign_key_enforced', status: 'PASS' });
    stage = 'negatives';
    await rejected('wrong_passphrase', () =>
      streamIsolatedRestore(backup, 'wrong-synthetic-passphrase', target.name, 'gpg', { gpgHome }),
    );
    await rejected('hash_mismatch_before_restore', () => verifyCipherHash(backup, '0'.repeat(64)));
    for (const kind of ['tampered', 'truncated']) {
      sql(target.id, 'DROP SCHEMA IF EXISTS qoro_synthetic CASCADE');
      const changed = Buffer.from(bytes);
      if (kind === 'tampered') changed[Math.floor(changed.length / 2)]! ^= 1;
      const file = path.join(scratch, kind + '.sql.gpg');
      await writeFile(
        file,
        kind === 'tampered' ? changed : changed.subarray(0, Math.floor(changed.length / 2)),
        { flag: 'wx', mode: 0o600 },
      );
      await rejected(kind + '_ciphertext', () =>
        streamIsolatedRestore(file, passphrase, target.name, 'gpg', { gpgHome }),
      );
    }
    const invalid = await encrypt('invalid', 'SELECT qoro_synthetic.function_does_not_exist();');
    await rejected('invalid_SQL_psql_nonzero', () =>
      streamIsolatedRestore(invalid, passphrase, target.name, 'gpg', { gpgHome }),
    );
    sql(target.id, 'DROP SCHEMA IF EXISTS qoro_synthetic CASCADE');
    await streamIsolatedRestore(backup, passphrase, target.name, 'gpg', { gpgHome });
    const changedJournal: unknown = JSON.parse(sql(target.id, snapshotSql));
    sql(target.id, "UPDATE qoro_synthetic.journal SET hash=repeat('b',64) WHERE id=1");
    assert.throws(() =>
      verifySyntheticSnapshot(JSON.parse(sql(target.id, snapshotSql)), changedJournal),
    );
    checks.push({ name: 'journal_divergence', status: 'PASS' });
    sql(target.id, 'DELETE FROM qoro_synthetic.children WHERE id=3');
    assert.throws(() => verifySyntheticSnapshot(JSON.parse(sql(target.id, snapshotSql)), expected));
    checks.push({ name: 'data_integrity_divergence', status: 'PASS' });
    const inspect = z
      .array(
        z
          .object({
            Name: z.string(),
            Config: z.object({ Labels: z.record(z.string(), z.string()) }).passthrough(),
            HostConfig: z
              .object({
                NetworkMode: z.string(),
                PortBindings: z.record(z.string(), z.unknown()).nullable(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .length(1)
      .parse(JSON.parse(docker(['--host', host, 'inspect', target.id])));
    for (const [name, edit] of [
      [
        'missing_label',
        (v: typeof inspect) => {
          assert.ok(v[0]);
          delete v[0].Config.Labels['qoro.recovery.scope'];
        },
      ],
      [
        'network_enabled',
        (v: typeof inspect) => {
          assert.ok(v[0]);
          v[0].HostConfig.NetworkMode = 'bridge';
        },
      ],
      [
        'published_port',
        (v: typeof inspect) => {
          assert.ok(v[0]);
          v[0].HostConfig.PortBindings = { '5432/tcp': [{ HostPort: '5432' }] };
        },
      ],
      [
        'unexpected_target',
        (v: typeof inspect) => {
          assert.ok(v[0]);
          v[0].Name = '/other';
        },
      ],
    ] satisfies [string, (value: typeof inspect) => void][]) {
      const copy = structuredClone(inspect);
      edit(copy);
      assert.throws(() => assertRestoreConfinement(copy, target.name));
      checks.push({ name: name + '_inspection_contract', status: 'PASS' });
    }
    const slow = await encrypt(
      'slow',
      'BEGIN; SELECT pg_sleep(30); CREATE TABLE qoro_synthetic.must_not_commit(id int); COMMIT;',
    );
    const backpressure = await encrypt(
      'backpressure',
      'BEGIN; SELECT pg_sleep(30);\n' +
        '-- exclusively synthetic filler\n'.repeat(160_000) +
        'ROLLBACK;',
    );
    for (const mode of ['cancel', 'deadline', 'postgres_terminated', 'gpg_terminated']) {
      const controller = new AbortController();
      const signal = mode === 'deadline' ? AbortSignal.timeout(1200) : controller.signal;
      const operation = streamIsolatedRestore(
        mode === 'gpg_terminated' ? backpressure : slow,
        passphrase,
        target.name,
        'gpg',
        { gpgHome, signal },
      );
      // Attach rejection immediately; deliberate process termination must not create an unhandled rejection.
      const result = operation.then(
        () => false,
        () => true,
      );
      await sleep(500);
      if (mode === 'postgres_terminated') docker(['--host', host, 'kill', target.id]);
      else if (mode === 'gpg_terminated') {
        const children = command('ps', ['--ppid', String(process.pid), '-o', 'pid=,comm=']);
        const match = children
          .split('\n')
          .map((line) => /^\s*(\d+)\s+gpg\s*$/u.exec(line))
          .find((value) => value !== null);
        assert.ok(match?.[1], 'Real GPG child must still be running under backpressure');
        process.kill(Number(match[1]), 'SIGTERM');
        sql(
          target.id,
          "SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE application_name='psql' AND state='active' AND pid<>pg_backend_pid()",
        );
      } else if (mode === 'cancel') controller.abort();
      assert.equal(await result, true, 'Interrupted restore must reject');
      await dispose(target);
      assert.equal(
        command('ps', ['--ppid', String(process.pid), '-o', 'comm='])
          .split('\n')
          .filter((v) => /^(gpg|docker)$/u.test(v.trim())).length,
        0,
      );
      checks.push({
        name: mode,
        status: 'PASS',
        evidence: { hostChildrenClosed: true, partialDestinationDisposed: true, platform: 'linux' },
      });
      target = await create();
    }
    await dispose(target);
    status = 'PASS';
  } finally {
    stage = status === 'PASS' ? 'cleanup' : stage;
    const cleanupFailures: string[] = [];
    for (const item of [...owned]) {
      try {
        await dispose(item);
      } catch {
        cleanupFailures.push('owned_container_disposal');
      }
    }
    try {
      command('gpgconf', ['--homedir', gpgHome, '--kill', 'gpg-agent']);
    } catch {
      cleanupFailures.push('isolated_gpg_agent_shutdown');
    }
    try {
      assert.equal(path.dirname(scratch), path.resolve(tmpdir()));
      assert.ok(path.basename(scratch).startsWith('qoro-synthetic-ci-'));
      await rm(scratch, { recursive: true });
    } catch {
      cleanupFailures.push('owned_scratch_disposal');
    }
    cleanupComplete = owned.length === 0 && cleanupFailures.length === 0;
    if (!cleanupComplete) status = 'FAIL';
    await writeFile(
      reportPath,
      JSON.stringify(
        {
          status,
          stage,
          checks,
          resources,
          dockerEndpoint: host,
          cleanupComplete,
          cleanupFailures,
          realDataUsed: false,
          productionAccess: false,
          windowsInterruptionValidated: false,
          completedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
    );
    console.info(
      JSON.stringify({
        status,
        checks: checks.length,
        cleanupComplete,
        evidence: path.basename(reportPath),
      }),
    );
    assert.equal(
      cleanupComplete,
      true,
      'Synthetic cleanup incomplete; isolated runner will be discarded',
    );
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Synthetic rehearsal failed');
    process.exitCode = 1;
  });
}
