/** B1 operator tool: encrypted input -> isolated psql. No migration or remote database URL. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { assertReleaseHistory, readFrozenRelease } from '../abacatepay-release-validation';

export const RESTORE_IMAGE = 'public.ecr.aws/supabase/postgres:17.11.0.006';
const PGDATA = '/var/lib/postgresql/data';
const containerName = z.string().regex(/^qoro-gate-b1-[a-f0-9]{12}$/u);
let stage = 'input';

export class IsolatedRestoreExitError extends Error {
  constructor(
    readonly gpg: number,
    readonly psql: number,
  ) {
    super('Strict restore process did not complete');
    this.name = 'IsolatedRestoreExitError';
  }
}

export function assertRestoreConfinement(input: unknown, expectedName: string): void {
  containerName.parse(expectedName);
  const [value] = z
    .array(
      z.object({
        Name: z.string(),
        State: z.object({ Running: z.literal(true) }),
        Config: z.object({
          Image: z.literal(RESTORE_IMAGE),
          Labels: z.record(z.string(), z.string()),
          Cmd: z.array(z.string()),
          Env: z.array(z.string()),
        }),
        Mounts: z.array(z.object({ Type: z.literal('tmpfs') })),
        HostConfig: z.object({
          Privileged: z.literal(false),
          NetworkMode: z.literal('none'),
          PortBindings: z.record(z.string(), z.unknown()).nullable(),
          LogConfig: z.object({ Type: z.literal('none') }),
          Tmpfs: z.record(z.string(), z.string()),
          Memory: z.number().int().positive(),
          MemorySwap: z.number().int().positive(),
        }),
      }),
    )
    .length(1)
    .parse(input);
  assert.ok(value);
  assert.equal(value.Name, '/' + expectedName);
  assert.equal(value.Config.Labels['qoro.recovery.scope'], 'gate-b1');
  assert.equal(Object.keys(value.HostConfig.PortBindings ?? {}).length, 0);
  assert.ok(value.HostConfig.Tmpfs[PGDATA]);
  assert.ok(value.HostConfig.Tmpfs['/tmp']);
  assert.equal(value.HostConfig.MemorySwap, value.HostConfig.Memory);
  assert.ok(value.Config.Cmd.includes('cron.launch_active_jobs=off'));
  const pgdata = value.Config.Env.find((entry) => entry.startsWith('PGDATA='))?.slice(7);
  assert.ok(pgdata === PGDATA || pgdata?.startsWith(PGDATA + '/'));
}

function docker(args: string[], input?: string): string {
  try {
    return execFileSync('docker', args, {
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000,
      maxBuffer: 16 << 20,
      windowsHide: true,
    }).trim();
  } catch {
    throw new Error('Isolated Docker/SQL step failed; sensitive output suppressed');
  }
}
const psql = (container: string) => [
  'exec',
  '-i',
  container,
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
];
const closed = (child: ReturnType<typeof spawn>): Promise<number> =>
  new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? -1));
  });

export async function streamIsolatedRestore(
  backup: string,
  passphrase: string,
  container: string,
  gpg = 'gpg',
): Promise<{ gpg: number; psql: number }> {
  containerName.parse(container);
  assert.ok(passphrase && !/[\r\n]/u.test(passphrase));
  const decrypt = spawn(
    gpg,
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
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  const restore = spawn('docker', psql(container), {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const finished = Promise.all([closed(decrypt), closed(restore)]);
  assert.ok(decrypt.stdin && decrypt.stdout && decrypt.stderr);
  assert.ok(restore.stdin && restore.stdout && restore.stderr);
  decrypt.stderr.resume();
  restore.stdout.resume();
  restore.stderr.resume();
  decrypt.stdin.on('error', () => decrypt.kill());
  restore.stdin.on('error', () => decrypt.kill());
  restore.once('close', () => {
    if (decrypt.exitCode === null) decrypt.kill();
  });
  decrypt.stdout.pipe(restore.stdin);
  decrypt.stdin.end(passphrase + '\n');
  const timeout = setTimeout(() => {
    decrypt.kill();
    restore.kill();
  }, 120_000);
  try {
    const [gpgCode, psqlCode] = await finished;
    if (gpgCode !== 0 || psqlCode !== 0) throw new IsolatedRestoreExitError(gpgCode, psqlCode);
    return { gpg: gpgCode, psql: psqlCode };
  } finally {
    clearTimeout(timeout);
    decrypt.kill();
    restore.kill();
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      backup: { type: 'string' },
      sha256: { type: 'string' },
      container: { type: 'string' },
      release: { type: 'string' },
      ref: { type: 'string' },
      evidence: { type: 'string' },
      gpg: { type: 'string', default: 'gpg' },
      'authorize-local-real-data': { type: 'boolean', default: false },
    },
  });
  assert.equal(values['authorize-local-real-data'], true, 'B1 approval required');
  const backup = path.resolve(z.string().endsWith('.sql.gpg').parse(values.backup));
  const expected = z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .parse(values.sha256);
  const container = containerName.parse(values.container);
  const evidencePath = path.resolve(z.string().min(1).parse(values.evidence));
  const passphrase = z.string().min(1).parse(process.env.BACKUP_PASSPHRASE);
  stage = 'release_inputs';
  const release = await readFrozenRelease(
    path.join(path.resolve(z.string().min(1).parse(values.release)), 'drizzle/migrations'),
    z.string().min(1).parse(values.ref),
  );
  stage = 'encrypted_hash';
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(backup)) digest.update(bytes);
  assert.equal(digest.digest('hex'), expected, 'Encrypted backup hash differs');
  stage = 'confinement';
  assertRestoreConfinement(JSON.parse(docker(['inspect', container])), container);
  const query = (sql: string) => docker(psql(container), sql);
  assert.equal(query('SHOW cron.launch_active_jobs'), 'off');
  const actualDataDirectory = query('SHOW data_directory');
  assert.ok(actualDataDirectory === PGDATA || actualDataDirectory.startsWith(PGDATA + '/'));
  const startedAt = new Date().toISOString();
  stage = 'strict_restore';
  const exitCodes = await streamIsolatedRestore(backup, passphrase, container, values.gpg);
  stage = 'history';
  const history: unknown = JSON.parse(
    query(
      "SELECT coalesce(json_agg(json_build_object('id',id,'hash',hash,'created_at',created_at::text) ORDER BY id),'[]') FROM drizzle.__drizzle_migrations",
    ),
  );
  const checkedHistory = assertReleaseHistory(release, history, 'before');
  stage = 'integrity';
  const integrity: unknown = JSON.parse(
    query(
      "SELECT json_build_object('invalidIndexes',(SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','billing_gateway') AND (NOT i.indisvalid OR NOT i.indisready)),'unvalidatedConstraints',(SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN ('public','auth','billing_gateway') AND NOT c.convalidated),'publicTables',(SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'),'authTables',(SELECT count(*) FROM information_schema.tables WHERE table_schema='auth' AND table_type='BASE TABLE'))",
    ),
  );
  const checkedIntegrity = z
    .object({
      invalidIndexes: z.literal(0),
      unvalidatedConstraints: z.literal(0),
      publicTables: z.number().int().positive(),
      authTables: z.number().int().positive(),
    })
    .parse(integrity);
  const evidence = {
    status: 'LOCAL_RESTORE_COMPLETE_REQUIRES_MANIFEST_REVIEW',
    startedAt,
    finishedAt: new Date().toISOString(),
    backupSha256: expected,
    image: RESTORE_IMAGE,
    container,
    exitCodes,
    history: checkedHistory,
    integrity: checkedIntegrity,
    sourceRef: release.financial,
    confinement: 'network none; no ports; log none; tmpfs; no container swap; cron off',
    sourceManifestParityRequiresReview: true,
    fullServiceRecoveryClaimed: false,
    managedBackupRestoreClaimed: false,
    migrationsApplied: 0,
    providerCalls: 0,
    productionWrites: 0,
    cleanup: 'Pending approved operator disposal; tool never removes containers or source backups',
  };
  stage = 'evidence';
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(
    JSON.stringify({ status: evidence.status, evidenceWritten: true, productionWrites: 0 }),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        status: 'BLOCKED_B1_RESTORE',
        stage,
        ...(error instanceof IsolatedRestoreExitError ? { gpg: error.gpg, psql: error.psql } : {}),
        detailsSuppressed: true,
        productionWrites: 0,
      }),
    );
    process.exitCode = 1;
  });
}
