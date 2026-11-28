/** Linux operator, outside GitHub Actions. No dotenv, clinical logs or plaintext SQL files. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { approvedPreflightEnvironment } from './abacatepay-preflight-transport';

const PROJECT = 'shlcbxawrxuaebazuiue';
const manifestSchema = z.object({
  id: z.string().regex(/^qoro-backup-[0-9T-]+-[a-f0-9-]{36}$/u),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  bytes: z.number().int().positive(),
  completedAt: z.string().datetime(),
  scope: z.literal('logical_database_not_storage_binaries_or_managed_auth_settings'),
  status: z.literal('VERIFIED'),
});
export type ScheduledBackupManifest = z.infer<typeof manifestSchema>;

export function scheduledBackupEnvironment(
  input: { databaseUrl: string; ca: string; synthetic: boolean },
  parent: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  assert.equal(process.platform, 'linux', 'Protected Linux recovery host required');
  const url = new URL(input.databaseUrl);
  if (!input.synthetic) {
    assert.ok(!parent.GITHUB_ACTIONS && !parent.CI, 'Real backups are forbidden in CI');
    return approvedPreflightEnvironment(input.databaseUrl, PROJECT, {
      ...parent,
      SUPABASE_PROJECT_ENV: 'prod',
      PGSSLROOTCERT: input.ca,
    });
  }
  assert.equal(url.hostname, 'localhost', 'Synthetic TLS fixture must stay on localhost');
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(url.port && Number(url.port) >= 1024);
  assert.equal(url.pathname, '/postgres');
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
  for (const key of ['PATH', 'LANG', 'LC_ALL']) if (parent[key]) env[key] = parent[key];
  return {
    ...env,
    PGHOST: 'localhost',
    PGPORT: url.port,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: 'postgres',
    PGSSLMODE: 'verify-full',
    PGSSLROOTCERT: input.ca,
    PGCONNECT_TIMEOUT: '10',
    PGOPTIONS: '-c default_transaction_read_only=on',
    PGAPPNAME: 'qoro-synthetic-recurring-backup',
  };
}

async function privateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Private real directory required');
  assert.equal(info.mode & 0o077, 0, 'Directory must deny group/world access');
  if (process.getuid) assert.equal(info.uid, process.getuid(), 'Directory owner differs');
}
async function fileHash(file: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
const closed = (child: ReturnType<typeof spawn>): Promise<number> =>
  new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? -1));
  });

export async function createScheduledBackup(input: {
  directory: string;
  databaseUrl: string;
  ca: string;
  passphrase: string;
  synthetic: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<ScheduledBackupManifest> {
  const env = scheduledBackupEnvironment(input, process.env);
  assert.ok(
    input.passphrase.length >= 32 && !/[\r\n]/u.test(input.passphrase),
    'Recovery key must be long and single-line',
  );
  input.signal?.throwIfAborted();
  const directory = path.resolve(input.directory);
  await privateDirectory(directory);
  const lock = path.join(directory, '.backup-running');
  await mkdir(lock, { mode: 0o700 }); // EEXIST is a hard stop, never remove someone else's lock.
  const gpgHome = await mkdtemp(path.join(tmpdir(), 'qoro-scheduled-gpg-'));
  const id = 'qoro-backup-' + new Date().toISOString().replace(/[:.Z]/gu, '-') + randomUUID();
  const partial = path.join(directory, id + '.gpg.partial');
  const cipher = path.join(directory, id + '.gpg');
  const manifestFile = path.join(directory, id + '.json');
  const children: ReturnType<typeof spawn>[] = [];
  let complete = false,
    interrupted = false;
  const stop = () => {
    interrupted = true;
    for (const child of children) child.kill('SIGKILL');
  };
  const timeout = setTimeout(stop, input.timeoutMs ?? 15 * 60_000);
  input.signal?.addEventListener('abort', stop, { once: true });
  try {
    const gpgArgs = [
      '--no-options',
      '--homedir',
      gpgHome,
      '--no-symkey-cache',
      '--batch',
      '--quiet',
      '--no-tty',
      '--pinentry-mode',
      'loopback',
      '--passphrase-fd',
      '3',
    ];
    const dump = spawn(
      'pg_dump',
      [
        '--no-password',
        '--no-owner',
        '--no-acl',
        '--clean',
        '--if-exists',
        '--exclude-schema=storage',
        '--exclude-schema=realtime',
        '--exclude-schema=supabase_functions',
        '--exclude-schema=supabase_migrations',
        '--exclude-schema=graphql',
        '--exclude-schema=graphql_public',
        '--exclude-schema=extensions',
        '--exclude-schema=vault',
        '--exclude-schema=cron',
        '--exclude-schema=net',
      ],
      { env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    children.push(dump);
    const encrypt = spawn('gpg', [...gpgArgs, '--cipher-algo', 'AES256', '--symmetric'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });
    children.push(encrypt);
    const dumpDone = closed(dump),
      encryptDone = closed(encrypt);
    assert.ok(encrypt.stdin && encrypt.stdout && encrypt.stderr);
    dump.stderr.resume();
    encrypt.stderr.resume();
    const passInput = encrypt.stdio[3];
    assert.ok(passInput instanceof Writable);
    passInput.on('error', stop);
    passInput.end(input.passphrase + '\n');
    const [, , codes] = await Promise.all([
      pipeline(dump.stdout, encrypt.stdin),
      pipeline(encrypt.stdout, createWriteStream(partial, { flags: 'wx', mode: 0o600 })),
      Promise.all([dumpDone, encryptDone]),
    ]);
    assert.deepEqual(codes, [0, 0], 'Backup pipeline returned nonzero');
    assert.equal(interrupted, false, 'Backup interrupted');
    const decrypt = spawn('gpg', [...gpgArgs, '--decrypt', partial], {
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    });
    children.push(decrypt);
    const decryptDone = closed(decrypt);
    assert.ok(decrypt.stdout && decrypt.stderr);
    decrypt.stderr.resume();
    const secret = decrypt.stdio[3];
    assert.ok(secret instanceof Writable);
    secret.on('error', stop);
    secret.end(input.passphrase + '\n');
    let tail = Buffer.alloc(0);
    for await (const chunk of decrypt.stdout)
      tail = Buffer.concat([tail, Buffer.from(chunk)]).subarray(-512);
    assert.equal(await decryptDone, 0, 'Encrypted backup authentication failed');
    assert.ok(
      tail.toString('utf8').includes('PostgreSQL database dump complete'),
      'Incomplete SQL stream',
    );
    assert.equal(interrupted, false, 'Verification interrupted');
    const manifest = manifestSchema.parse({
      id,
      sha256: await fileHash(partial),
      bytes: (await stat(partial)).size,
      completedAt: new Date().toISOString(),
      scope: 'logical_database_not_storage_binaries_or_managed_auth_settings',
      status: 'VERIFIED',
    });
    await writeFile(manifestFile + '.partial', JSON.stringify(manifest, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    await rename(partial, cipher);
    await rename(manifestFile + '.partial', manifestFile); // Manifest publication is the commit point.
    complete = true;
    return manifest;
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener('abort', stop);
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
    await Promise.allSettled(
      children.map((child) =>
        child.exitCode !== null || child.signalCode !== null
          ? Promise.resolve()
          : new Promise<void>((resolve) => child.once('close', () => resolve())),
      ),
    );
    if (!complete)
      for (const own of [partial, cipher, manifestFile + '.partial'])
        await rm(own, { force: true });
    const agent = spawnSync('gpgconf', ['--homedir', gpgHome, '--kill', 'gpg-agent'], {
      env,
      stdio: 'ignore',
      timeout: 5_000,
    });
    assert.equal(
      agent.status,
      0,
      'Isolated GPG agent cleanup failed; preserve keyring and lock for review',
    );
    await rm(gpgHome, { recursive: true });
    await rm(lock, { recursive: true });
  }
}

export async function inspectScheduledBackups(directory: string, now = Date.now()) {
  await privateDirectory(directory);
  const healthy: ScheduledBackupManifest[] = [];
  for (const file of (await readdir(directory)).filter((name) =>
    /^qoro-backup-[0-9T-]+-[a-f0-9-]{36}\.json$/u.test(name),
  )) {
    const manifest = manifestSchema.parse(
      JSON.parse(await readFile(path.join(directory, file), 'utf8')),
    );
    assert.equal(file, manifest.id + '.json');
    const cipher = path.join(directory, manifest.id + '.gpg');
    const info = await lstat(cipher);
    assert.ok(info.isFile() && !info.isSymbolicLink() && (info.mode & 0o077) === 0);
    assert.equal(info.size, manifest.bytes);
    assert.equal(await fileHash(cipher), manifest.sha256);
    healthy.push(manifest);
  }
  healthy.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  const latest = healthy[0];
  return { healthy, stale: !latest || now - Date.parse(latest.completedAt) > 26 * 60 * 60_000 };
}

/** Only this operator's verified files; retain at least two healthy generations. */
export async function pruneScheduledBackups(directory: string, now = Date.now()): Promise<number> {
  const { healthy, stale } = await inspectScheduledBackups(directory, now);
  assert.equal(stale, false, 'Never prune while backup continuity is unhealthy');
  let removed = 0;
  for (const item of healthy.slice(2)) {
    if (now - Date.parse(item.completedAt) < 7 * 24 * 60 * 60_000) continue;
    await rm(path.join(directory, item.id + '.gpg'));
    await rm(path.join(directory, item.id + '.json'));
    removed++;
  }
  return removed;
}

async function main(): Promise<void> {
  assert.equal(process.platform, 'linux');
  const directory = z.string().min(1).parse(process.env.STATE_DIRECTORY);
  if (process.argv.includes('--check')) {
    const health = await inspectScheduledBackups(directory);
    assert.equal(health.stale, false, 'No verified backup within 26 hours');
    console.info(JSON.stringify({ status: 'VERIFIED', backups: health.healthy.length }));
    return;
  }
  const credentials = z.string().min(1).parse(process.env.CREDENTIALS_DIRECTORY);
  const values = await Promise.all(
    ['database-url', 'recovery-passphrase', 'database-ca'].map((name) =>
      readFile(path.join(credentials, name), 'utf8'),
    ),
  );
  const outcome = await createScheduledBackup({
    directory,
    databaseUrl: values[0]!.trim(),
    passphrase: values[1]!.trim(),
    ca: path.join(credentials, 'database-ca'),
    synthetic: false,
  });
  await pruneScheduledBackups(directory);
  console.info(JSON.stringify({ status: outcome.status, id: outcome.id, bytes: outcome.bytes }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error(
      JSON.stringify({
        status: 'FAILED',
        event: 'qoro.recovery.backup_failed',
        detailsSuppressed: true,
      }),
    );
    process.exitCode = 1;
  });
}
