/** Explicit revision of the frozen package. Never repurposes its original attestation. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
  COMPOSED_TAR_SHA256,
  syntheticBuildEnvironment,
  validateArchiveNames,
} from './gate-b-composed-build';

assert.equal(process.platform, 'linux', 'Isolated Linux runner required');
const BASE = '94f6da4aeb32b1ae7da856dc9afa105120ce6dd9';
const PATCH = '0fca440917b52636033d5ba2c2236e3b63249387';
const MAIN = '5620a0987ec53db7d7358728eb7d457d9d373df3';
const archive = path.resolve(z.string().min(1).parse(process.argv[2]));
const output = path.resolve(z.string().min(1).parse(process.argv[3]));
await mkdir(output, { recursive: true });
const git = (...args: string[]) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 << 20 });
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const digest = createHash('sha256');
for await (const chunk of createReadStream(archive)) digest.update(chunk);
assert.equal(digest.digest('hex'), COMPOSED_TAR_SHA256);
const members = validateArchiveNames(
  execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).trim().split('\n'),
);
const changes = git('diff', '--name-only', BASE, PATCH, '--', 'src')
  .trim()
  .split('\n')
  .filter((name) => !/\.test\.tsx?$/u.test(name));
assert.deepEqual(changes, ['src/contexts/billing/internal/deferred-checkout.ts']);
const directory = await mkdtemp(path.join(tmpdir(), 'qoro-cancellation-candidate-'));
const home = await mkdtemp(path.join(tmpdir(), 'qoro-cancellation-home-'));
const startedAt = new Date().toISOString();
const commands: { name: string; code: number; durationMs: number }[] = [];
let status = 'FAIL';
try {
  execFileSync('tar', ['-xf', archive, '-C', directory]);
  const before = new Map<string, string>();
  for (const file of members) {
    assert.equal((await lstat(path.join(directory, file))).isFile(), true);
    before.set(file, hash(await readFile(path.join(directory, file))));
  }
  const patched = [
    'src/contexts/billing/internal/deferred-checkout.ts',
    'src/contexts/billing/internal/deferred-overview-origin.test.ts',
  ];
  const oldFile = git('show', BASE + ':' + patched[0]);
  assert.equal(before.get(patched[0]!), hash(oldFile));
  for (const file of patched)
    await writeFile(path.join(directory, file), git('show', PATCH + ':' + file));
  const provenance = {
    baseSource: BASE,
    baseTarSha256: COMPOSED_TAR_SHA256,
    patchSource: PATCH,
    mainSource: MAIN,
    patchedFiles: patched.map((file) => ({ file, sha256: hash(git('show', PATCH + ':' + file)) })),
    sqlHashesPreserved: 160,
    excludedMigrations: ['0160', '0161', '0162'],
    reason: 'deterministic legacy cancellation regression; explicit application revision',
    sourceScope: 'original composed package plus two reviewed cancellation files only',
  };
  await writeFile(
    path.join(directory, 'saas-cancellation-revision.json'),
    JSON.stringify(provenance, null, 2) + '\n',
  );
  for (const [file, expected] of before) {
    if (file === patched[0]) continue;
    assert.equal(
      hash(await readFile(path.join(directory, file))),
      expected,
      'Unreviewed artifact change: ' + file,
    );
  }
  const revisedArchive = path.join(output, 'qoro-saas-cancellation-' + PATCH.slice(0, 8) + '.tar');
  execFileSync('tar', [
    '--sort=name',
    '--format=posix',
    '--pax-option=delete=atime,delete=ctime',
    '--mtime=2026-11-16T00:00:00Z',
    '--owner=0',
    '--group=0',
    '--numeric-owner',
    '-cf',
    revisedArchive,
    '-C',
    directory,
    '.',
  ]);
  const revisedHash = createHash('sha256');
  for await (const chunk of createReadStream(revisedArchive)) revisedHash.update(chunk);
  const newMembers = execFileSync('tar', ['-tf', revisedArchive], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((file) => !file.endsWith('/'))
    .map((file) => file.replace(/^\.\//u, ''));
  assert.equal(newMembers.length, members.length + 2);
  assert.equal(new Set(newMembers).size, newMembers.length);
  assert.ok(newMembers.every((file) => !/^drizzle\/migrations\/016[0-2]_/u.test(file)));
  const inputs = new Map<string, string>();
  for (const file of newMembers) inputs.set(file, hash(await readFile(path.join(directory, file))));
  // Same frozen dependency inputs, installed on this fresh VM. No reinstall on the notebook.
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'])
    assert.equal(hash(await readFile(path.join(directory, file))), hash(await readFile(file)));
  await symlink(path.resolve('node_modules'), path.join(directory, 'node_modules'), 'dir');
  const env = syntheticBuildEnvironment(process.env, home);
  const begin = Date.now();
  const child = spawn(
    process.execPath,
    ['--max-old-space-size=4096', path.join(directory, 'node_modules/next/dist/bin/next'), 'build'],
    { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const chunks: Buffer[] = [];
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      process.stdout.write(chunk);
    });
  const code = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (value) => resolve(value ?? -1));
  });
  commands.push({
    name: 'exact revised package: next build (no presentation harness)',
    code,
    durationMs: Date.now() - begin,
  });
  const log = Buffer.concat(chunks).toString('utf8');
  await writeFile(path.join(output, 'revised-build.log'), log);
  assert.equal(code, 0);
  assert.ok(!log.includes('ESLint:'));
  await stat(path.join(directory, '.next/BUILD_ID'));
  for (const [file, expected] of inputs)
    assert.equal(
      hash(await readFile(path.join(directory, file))),
      expected,
      'Source changed during build',
    );
  status = 'PASS';
  await writeFile(
    path.join(output, 'revised-build.json'),
    JSON.stringify(
      {
        status,
        startedAt,
        completedAt: new Date().toISOString(),
        ...provenance,
        archiveSha256: revisedHash.digest('hex'),
        archiveBytes: (await stat(revisedArchive)).size,
        files: newMembers.length,
        node: process.version,
        commands,
        sourceParity: true,
        buildEnvironment: 'fresh HOME; OS allowlist; synthetic variables; no inherited credentials',
        securityHarnessInjected: false,
        deployed: false,
        productionWrites: 0,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  for (const own of [directory, home]) {
    assert.equal(path.dirname(own), path.resolve(tmpdir()));
    assert.ok(/^qoro-cancellation-(candidate|home)-/u.test(path.basename(own)));
    await rm(own, { recursive: true });
  }
  console.info(JSON.stringify({ status, cleanupComplete: true }));
}
