/** Real pg_dump/GPG/psql, synthetic local PostgreSQL only. Never runs on Windows. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  createScheduledBackup,
  inspectScheduledBackups,
  pruneScheduledBackups,
  scheduledBackupEnvironment,
} from '../recovery-scheduled-backup';
import { startScratchSchema } from './scratch-schema';

assert.equal(process.platform, 'linux');
const cluster = await startScratchSchema({ port: 55474 });
const directory = await mkdtemp(path.join(tmpdir(), 'qoro-recurring-proof-'));
const results: { name: string; status: 'PASS' | 'FAIL' }[] = [];
let failure: unknown;
try {
  const [pg] = await cluster.sql<
    { data_directory: string; ssl_cert_file: string }[]
  >`SELECT current_setting('data_directory') data_directory,current_setting('ssl_cert_file') ssl_cert_file`;
  assert.ok(pg);
  const ca = path.join(directory, 'fixture-ca.crt');
  await copyFile(path.resolve(pg.data_directory, pg.ssl_cert_file), ca);
  const passphrase = randomBytes(48).toString('base64');
  const databaseUrl = cluster.url.replace('127.0.0.1', 'localhost');
  const input = { directory, databaseUrl, ca, passphrase, synthetic: true };
  async function check(name: string, run: () => Promise<void>) {
    try {
      await run();
      results.push({ name, status: 'PASS' });
    } catch (error) {
      results.push({ name, status: 'FAIL' });
      throw error;
    }
  }
  await cluster.sql`CREATE TABLE public.qoro_backup_fixture(id int PRIMARY KEY,label text NOT NULL)`;
  await cluster.sql`INSERT INTO public.qoro_backup_fixture VALUES(1,'ação — synthetic'),(2,'漢字')`;
  let first: Awaited<ReturnType<typeof createScheduledBackup>> | undefined;
  await check(
    'real read-only TLS dump streams into AES256 envelope and authenticated verification',
    async () => {
      first = await createScheduledBackup(input);
      assert.equal(first.status, 'VERIFIED');
      assert.equal((await inspectScheduledBackups(directory)).stale, false);
    },
  );
  assert.ok(first);
  const cipher = path.join(directory, first.id + '.gpg');
  await check('real GPG to psql restores UTF8 rows in a second isolated database', async () => {
    await cluster.sql`CREATE DATABASE qoro_backup_restored`;
    const env = {
      ...scheduledBackupEnvironment(input, process.env),
      PGDATABASE: 'qoro_backup_restored',
      PGOPTIONS: '-c default_transaction_read_only=off',
    };
    const gpgHome = await mkdtemp(path.join(directory, 'gpg-restore-'));
    const decrypt = spawn(
      'gpg',
      [
        '--no-options',
        '--homedir',
        gpgHome,
        '--batch',
        '--quiet',
        '--no-tty',
        '--pinentry-mode',
        'loopback',
        '--passphrase-fd',
        '3',
        '--decrypt',
        cipher,
      ],
      { env, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] },
    );
    const restore = spawn('psql', ['-X', '-w', '-q', '-v', 'ON_ERROR_STOP=1'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const done = (child: ReturnType<typeof spawn>) =>
      new Promise<number>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code) => resolve(code ?? -1));
      });
    const codes = Promise.all([done(decrypt), done(restore)]);
    assert.ok(decrypt.stdout && decrypt.stderr);
    assert.ok(restore.stdin && restore.stdout && restore.stderr);
    const secret = decrypt.stdio[3];
    assert.ok(secret instanceof Writable);
    secret.end(passphrase + '\n');
    decrypt.stderr.resume();
    restore.stderr.resume();
    restore.stdout.resume();
    try {
      await Promise.all([pipeline(decrypt.stdout, restore.stdin), codes]);
      assert.deepEqual(await codes, [0, 0]);
    } finally {
      decrypt.kill();
      restore.kill();
      assert.equal(
        spawnSync('gpgconf', ['--homedir', gpgHome, '--kill', 'gpg-agent'], {
          env,
          stdio: 'ignore',
          timeout: 5_000,
        }).status,
        0,
      );
      await rm(gpgHome, { recursive: true });
    }
    const postgres = (await import('postgres')).default;
    const restored = postgres(databaseUrl.replace('/postgres?', '/qoro_backup_restored?'), {
      ssl: 'require',
      onnotice: () => undefined,
    });
    try {
      assert.deepEqual(
        Array.from(await restored`SELECT * FROM public.qoro_backup_fixture ORDER BY id`),
        [
          { id: 1, label: 'ação — synthetic' },
          { id: 2, label: '漢字' },
        ],
      );
    } finally {
      await restored.end();
    }
  });
  await check(
    'overlapping scheduler execution is refused without replacing last healthy backup',
    async () => {
      await mkdir(path.join(directory, '.backup-running'));
      await assert.rejects(createScheduledBackup(input), { code: 'EEXIST' });
      await rm(path.join(directory, '.backup-running'), { recursive: true });
      assert.equal((await inspectScheduledBackups(directory)).healthy.length, 1);
    },
  );
  await check('unavailable database fails closed and preserves healthy ciphertext', async () => {
    const broken = { ...input, databaseUrl: databaseUrl.replace(':55474', ':55475') };
    await assert.rejects(createScheduledBackup({ ...broken, timeoutMs: 5_000 }));
    assert.equal((await inspectScheduledBackups(directory)).healthy.length, 1);
  });
  await check(
    'actual cancellation kills pipeline, publishes no manifest and leaves no partial result',
    async () => {
      // Hold a table lock so real pg_dump waits; cancel the actual children, not a mock.
      let acquired: (() => void) | undefined, release: (() => void) | undefined;
      const ready = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const held = cluster.sql.begin(async (tx) => {
        await tx`LOCK public.qoro_backup_fixture IN ACCESS EXCLUSIVE MODE`;
        acquired!();
        await released;
      });
      await ready;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 500);
      try {
        await assert.rejects(createScheduledBackup({ ...input, signal: controller.signal }));
      } finally {
        clearTimeout(timer);
        release!();
        await held;
      }
      assert.equal((await inspectScheduledBackups(directory)).healthy.length, 1);
      assert.ok(
        (await readdir(directory)).every(
          (file) => !file.endsWith('.partial') && file !== '.backup-running',
        ),
      );
    },
  );
  await check('tampering is detected; unverifiable backups cannot be pruned', async () => {
    const bytes = await readFile(cipher);
    await writeFile(cipher, bytes.subarray(0, bytes.length - 12));
    await assert.rejects(inspectScheduledBackups(directory));
    await assert.rejects(pruneScheduledBackups(directory));
    await writeFile(cipher, bytes);
  });
  await check(
    'retention keeps at least two healthy copies and ignores unrelated files',
    async () => {
      await createScheduledBackup(input);
      await writeFile(path.join(directory, 'unrelated.txt'), 'synthetic');
      assert.equal(await pruneScheduledBackups(directory), 0);
      assert.equal((await inspectScheduledBackups(directory)).healthy.length, 2);
      assert.equal(await readFile(path.join(directory, 'unrelated.txt'), 'utf8'), 'synthetic');
      assert.equal(
        (await inspectScheduledBackups(directory, Date.now() + 27 * 60 * 60_000)).stale,
        true,
      );
    },
  );
} catch (error) {
  failure = error;
} finally {
  await cluster.stop();
  await rm(directory, { recursive: true });
  await mkdir('dist', { recursive: true });
  await writeFile(
    'dist/scheduled-backup-synthetic.json',
    JSON.stringify(
      {
        status: failure ? 'FAIL' : 'PASS',
        observedAt: new Date().toISOString(),
        environment: 'ephemeral Linux runner; loopback synthetic only',
        results,
        cleanupComplete: true,
        realData: false,
        scheduledOnProduction: false,
        oldWorkflowDisabled: false,
        productionWrites: 0,
      },
      null,
      2,
    ) + '\n',
  );
}
if (failure) throw failure;
console.info(JSON.stringify({ status: 'PASS', checks: results.length }));
