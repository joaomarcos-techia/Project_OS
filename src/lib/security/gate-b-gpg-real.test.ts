import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gpgFileArgument } from '../../../scripts/gate-b-isolated-restore';

// This suite uses real GPG, fresh random synthetic secrets and no database/network.
const gpg = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/gpg.exe' : 'gpg';
const gpgconf =
  process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/gpgconf.exe' : 'gpgconf';
const secret = randomBytes(32).toString('hex');
const input = Buffer.from('-- Synthetic only: Jos\u00e9 \ud83d\ude91\nSELECT 1;\n', 'utf8');
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
let root: string, home: string, cipher: string;
let passed = 0;
let version: string;
const observedAt = new Date().toISOString();

async function run(
  args: string[],
  passphrase = secret,
  options: {
    plaintext?: Buffer;
    holdInput?: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<{ code: number; bytes: Buffer; stopped: boolean }> {
  const argv = [
    '--no-options',
    '--homedir',
    gpgFileArgument(home, gpg),
    '--batch',
    '--quiet',
    '--no-tty',
    '--no-symkey-cache',
    '--pinentry-mode',
    'loopback',
    '--passphrase-fd',
    '0',
    ...args,
  ];
  assert.ok(!argv.some((arg) => arg.includes(secret) || arg.includes(passphrase)));
  const child = spawn(gpg, argv, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const output: Buffer[] = [];
  const finished = new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? -1));
  });
  child.stdout.on('data', (bytes: Buffer) => output.push(bytes));
  child.stderr.resume();
  child.stdin.on('error', () => child.kill());
  let stopped = false;
  const stop = () => {
    stopped = true;
    child.kill();
  };
  options.signal?.addEventListener('abort', stop, { once: true });
  const timeout = setTimeout(stop, options.timeoutMs ?? 20_000);
  try {
    if (!options.holdInput)
      child.stdin.end(
        Buffer.concat([Buffer.from(passphrase + '\n'), options.plaintext ?? Buffer.alloc(0)]),
      );
    const code = await finished;
    return { code, bytes: Buffer.concat(output), stopped };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', stop);
    child.stdin.destroy();
    child.kill();
  }
}

beforeAll(async () => {
  if (process.platform === 'win32')
    assert.ok(existsSync(gpg), 'Install official GPG before this real test');
  root = await mkdtemp(path.join(os.tmpdir(), 'qoro-b1a-gpg-real-'));
  home = path.join(root, 'gnupg');
  await mkdir(home, { mode: 0o700 });
  cipher = path.join(root, 'synthetic.sql.gpg');
  version = execFileSync(gpg, ['--version'], { encoding: 'utf8', windowsHide: true }).split(
    /\r?\n/u,
  )[0]!;
});

afterAll(async () => {
  if (!root) return;
  // Only our fresh keyring is stopped; never the user's real GPG agent.
  execFileSync(gpgconf, ['--homedir', gpgFileArgument(home, gpg), '--kill', 'gpg-agent'], {
    stdio: 'pipe',
    windowsHide: true,
    timeout: 10_000,
  });
  assert.ok(
    path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('qoro-b1a-gpg-real-'),
  );
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name === 'gnupg') {
      assert.ok(entry.isDirectory() && !entry.isSymbolicLink());
      for (const file of await readdir(home, { withFileTypes: true })) {
        const target = path.join(home, file.name);
        if (file.isDirectory()) {
          assert.deepEqual(await readdir(target), []);
          await rmdir(target);
        } else {
          assert.ok(file.isFile() && !file.isSymbolicLink());
          await unlink(target);
        }
      }
      await rmdir(home);
    } else {
      assert.ok(
        entry.isFile() &&
          ['synthetic.sql.gpg', 'tampered.gpg', 'truncated.gpg'].includes(entry.name),
      );
      await unlink(path.join(root, entry.name));
    }
  }
  await rmdir(root);
  await mkdir('dist', { recursive: true });
  await writeFile(
    'dist/gate-b-gpg-real.json',
    JSON.stringify(
      {
        observedAt,
        finishedAt: new Date().toISOString(),
        status: passed === 7 ? 'PASS' : 'FAIL',
        scope:
          'real GPG only; exclusively synthetic in-memory plaintext; NOT Docker/PostgreSQL restore',
        version,
        testsPassed: passed,
        testsExpected: 7,
        plaintextSha256: sha256(input),
        plaintextFileCreated: false,
        ownFixtureDiscarded: true,
        networkCalls: 0,
        realDataRead: false,
        productionWrites: 0,
        passwordInArgv: false,
      },
      null,
      2,
    ) + '\n',
  );
});

describe('real synthetic GPG recovery (not a database restore)', () => {
  it('encrypts stdin with AES256 and preserves UTF8 bytes/hash on decryption', async () => {
    const encrypted = await run(
      ['--symmetric', '--cipher-algo', 'AES256', '--output', gpgFileArgument(cipher, gpg)],
      secret,
      { plaintext: input },
    );
    expect(encrypted.code).toBe(0);
    expect(encrypted.stopped).toBe(false);
    const restored = await run(['--decrypt', gpgFileArgument(cipher, gpg)]);
    expect(restored.code).toBe(0);
    expect(restored.bytes).toEqual(input);
    expect(sha256(restored.bytes)).toBe(sha256(input));
    expect((await readFile(cipher)).equals(input)).toBe(false);
    passed++;
  });
  it('refuses a wrong passphrase without modifying the ciphertext', async () => {
    const before = sha256(await readFile(cipher));
    const result = await run(
      ['--decrypt', gpgFileArgument(cipher, gpg)],
      'wrong-synthetic-passphrase',
    );
    expect(result.code).not.toBe(0);
    expect(result.bytes.length).toBe(0);
    expect(sha256(await readFile(cipher))).toBe(before);
    passed++;
  });
  it('refuses tampered authenticated ciphertext', async () => {
    const bytes = await readFile(cipher);
    bytes[bytes.length - 1]! ^= 1;
    const file = path.join(root, 'tampered.gpg');
    await writeFile(file, bytes, { flag: 'wx' });
    const result = await run(['--decrypt', gpgFileArgument(file, gpg)]);
    expect(result.code).not.toBe(0);
    passed++;
  });
  it('refuses a truncated encrypted file', async () => {
    const bytes = await readFile(cipher);
    const file = path.join(root, 'truncated.gpg');
    await writeFile(file, bytes.subarray(0, 20), { flag: 'wx' });
    expect((await run(['--decrypt', gpgFileArgument(file, gpg)])).code).not.toBe(0);
    passed++;
  });
  it('closes a real interrupted process', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      const result = await run(['--decrypt', gpgFileArgument(cipher, gpg)], secret, {
        holdInput: true,
        signal: controller.signal,
      });
      expect(result.stopped).toBe(true);
      expect(result.code).not.toBe(0);
      passed++;
    } finally {
      clearTimeout(timer);
    }
  });
  it('bounds a real stalled process with timeout', async () => {
    const result = await run(['--decrypt', gpgFileArgument(cipher, gpg)], secret, {
      holdInput: true,
      timeoutMs: 100,
    });
    expect(result.stopped).toBe(true);
    expect(result.code).not.toBe(0);
    passed++;
  });
  it('never persists open SQL alongside the encrypted fixture', async () => {
    const files = await readdir(root);
    expect(files.sort()).toEqual(['gnupg', 'synthetic.sql.gpg', 'tampered.gpg', 'truncated.gpg']);
    passed++;
  });
});
