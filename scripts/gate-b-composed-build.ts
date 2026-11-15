/** Builds the exact frozen archive, without the source injection used by security:build. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

export const COMPOSED_TAR_SHA256 =
  '3902f2007742df4016450eeaece806a8f2bc0b535631d33da9a5e691b59ce3f6';
const FINANCIAL_REF = '94f6da4aeb32b1ae7da856dc9afa105120ce6dd9';
const SHARED_SQL_REF = '4d0ed1d5c8a81ab9f66e026f4f36c6e4520a7269';
const MANIFEST_SHA256 = 'bf2775be25ae3bdb2d58d52b99708a3d1ee32620425f1d98ac214a849185af5f';
const MiB = 1024 ** 2;
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

export function validateArchiveNames(names: string[]): string[] {
  const files = names
    .filter((name) => !name.endsWith('/'))
    .map((name) => name.replace(/^\.\//u, ''));
  assert.equal(files.length, 2785);
  assert.equal(new Set(files).size, files.length);
  for (const file of files) {
    assert.ok(
      !path.posix.isAbsolute(file) && !file.split('/').includes('..') && !file.includes('\\'),
      'Unsafe archive path',
    );
    assert.ok(
      !/(^|\/)\.env(?:$|\.(?!example$))/u.test(file),
      'Runtime environment file in artifact',
    );
    assert.ok(!/^drizzle\/migrations\/016[01]_/u.test(file), 'Excluded migration in artifact');
    assert.ok(!file.startsWith('node_modules/') && !file.startsWith('.next/'));
  }
  assert.ok(
    files.some((file) => /[^\x00-\x7f]/u.test(file)),
    'Expected UTF8 file names missing',
  );
  return files.sort();
}

/** Only operating-system locations survive. HOME is fresh and contains no personal configuration. */
export function syntheticBuildEnvironment(
  parent: NodeJS.ProcessEnv,
  home: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    HOME: home,
    TMPDIR: home,
    XDG_CACHE_HOME: path.join(home, 'cache'),
    LANG: 'C.UTF-8',
  };
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT']) {
    if (parent[key]) env[key] = parent[key];
  }
  return Object.assign(env, {
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    DATABASE_URL: 'postgres://synthetic:synthetic@127.0.0.1:55439/synthetic?sslmode=require',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55440',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_build',
    NEXT_PUBLIC_SENTRY_DSN: 'http://public@127.0.0.1:55441/1',
    CRON_SECRET: 'synthetic-build-cron-not-real',
    META_APP_SECRET: 'synthetic-build-meta',
    META_WEBHOOK_VERIFY_TOKEN: 'synthetic-build-meta-verify',
    ASAAS_WEBHOOK_TOKEN: 'synthetic-build-asaas',
    SUPABASE_SECRET_KEY: 'synthetic-build-supabase',
    GEMINI_API_KEY: 'synthetic-build-gemini',
    ASAAS_API_KEY: 'synthetic-build-asaas',
    ABACATEPAY_API_KEY: 'synthetic-build-abacatepay',
    CRYPTO_SECRET_BACKEND: 'env',
    APP_BASE_URL: 'http://localhost:3217',
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  });
}

async function main(): Promise<void> {
  assert.equal(process.platform, 'linux', 'Ephemeral Linux runner required');
  const archive = path.resolve(z.string().min(1).parse(process.argv[2]));
  const restoreEvidence = path.resolve(z.string().min(1).parse(process.argv[3]));
  const output = path.resolve(z.string().min(1).parse(process.argv[4]));
  await mkdir(output, { recursive: true });
  const restored = z
    .object({ cleanupComplete: z.literal(true) })
    .parse(JSON.parse(await readFile(restoreEvidence, 'utf8')));
  assert.equal(restored.cleanupComplete, true);
  assert.equal(
    execFileSync('docker', ['ps', '-aq', '--filter', 'label=qoro.recovery.scope=gate-b1'], {
      encoding: 'utf8',
    }).trim(),
    '',
    'Recovery containers remain; build must not overlap',
  );
  const disk = await statfs(tmpdir());
  const availableMemory = /MemAvailable:\s+(\d+) kB/u.exec(await readFile('/proc/meminfo', 'utf8'));
  assert.ok(availableMemory?.[1]);
  const resources = {
    availablePhysicalMiB: Math.floor(Number(availableMemory[1]) / 1024),
    freeDiskGiB: (disk.bavail * disk.bsize) / 1024 ** 3,
  };
  assert.ok(
    resources.availablePhysicalMiB >= 4096,
    'At least 4 GiB available physical RAM required for the build',
  );
  assert.ok(resources.freeDiskGiB >= 6, 'At least 6 GiB free disk required for build');
  assert.equal((await stat(archive)).size, 234562048);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(archive)) digest.update(chunk);
  assert.equal(digest.digest('hex'), COMPOSED_TAR_SHA256);
  const listing = execFileSync('tar', ['-tf', archive], { maxBuffer: 4 * MiB });
  const members = validateArchiveNames(
    new TextDecoder('utf-8', { fatal: true }).decode(listing).trim().split('\n'),
  );
  const directory = await mkdtemp(path.join(tmpdir(), 'qoro-composed-build-'));
  const home = await mkdtemp(path.join(tmpdir(), 'qoro-composed-home-'));
  const env = syntheticBuildEnvironment(process.env, home);
  const before = new Map<string, string>();
  const startedAt = new Date().toISOString();
  let stage = 'extract';
  let result = 'FAIL';
  const commands: { command: string; exitCode: number; durationMs: number }[] = [];
  async function run(file: string, args: string[], name: string, childEnv = env): Promise<void> {
    const started = Date.now();
    const chunks: Buffer[] = [];
    const child = spawn(file, args, {
      cwd: directory,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const capture = (chunk: Buffer) => {
      chunks.push(chunk);
      process.stdout.write(chunk);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (value) => resolve(value ?? -1));
    });
    const text = Buffer.concat(chunks).toString('utf8');
    await writeFile(path.join(output, name + '.log'), text);
    commands.push({
      command: [file, ...args].join(' '),
      exitCode: code,
      durationMs: Date.now() - started,
    });
    assert.equal(code, 0, name + ' returned nonzero');
    assert.ok(!text.includes('ESLint:'), 'Next reported an ESLint loading failure');
  }
  try {
    execFileSync('tar', ['-xf', archive, '-C', directory]);
    for (const file of members) {
      assert.equal(
        (await lstat(path.join(directory, file))).isFile(),
        true,
        'Archive member is not a regular file',
      );
      before.set(file, hash(await readFile(path.join(directory, file))));
    }
    const proof = z
      .object({
        financial: z.literal(FINANCIAL_REF),
        sharedSqlSource: z.literal(SHARED_SQL_REF),
        journalEntries: z.literal(160),
        tissOperationalCodeIncluded: z.literal(false),
        sqlProof: z
          .array(z.object({ tag: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/u) }))
          .length(160),
      })
      .parse(JSON.parse(await readFile(path.join(directory, 'saas-release-inputs.json'), 'utf8')));
    assert.equal(
      before.get('docs/decoupling/asaas-to-abacatepay/migrations/release-manifest.json'),
      MANIFEST_SHA256,
    );
    for (const item of proof.sqlProof)
      assert.equal(before.get('drizzle/migrations/' + item.tag + '.sql'), item.sha256);
    const journal = z
      .object({
        entries: z
          .array(z.object({ idx: z.number(), tag: z.string(), when: z.number() }))
          .length(160),
      })
      .parse(
        JSON.parse(
          await readFile(path.join(directory, 'drizzle/migrations/meta/_journal.json'), 'utf8'),
        ),
      );
    for (const [i, item] of journal.entries.entries()) {
      assert.equal(item.idx, i);
      assert.equal(item.tag, proof.sqlProof[i]?.tag);
      if (i) assert.ok(item.when > journal.entries[i - 1]!.when);
    }
    assert.equal(journal.entries[159]?.tag, '0159_saas_period_snapshot');
    for (const excluded of ['src/contexts/health-insurance', 'src/app/(app)/(shell)/convenios']) {
      assert.ok(!members.some((file) => file.startsWith(excluded + '/')));
    }
    stage = 'dependencies';
    // Installation needs devDependencies too; the build environment itself remains production.
    await run('pnpm', ['install', '--frozen-lockfile'], 'install', {
      ...env,
      NODE_ENV: 'development',
    });
    stage = 'build';
    await run(
      process.execPath,
      [
        '--max-old-space-size=4096',
        path.join(directory, 'node_modules/next/dist/bin/next'),
        'build',
      ],
      'next-build',
    );
    stage = 'parity';
    const changed: string[] = [];
    for (const [file, expected] of before)
      if (hash(await readFile(path.join(directory, file))) !== expected) changed.push(file);
    assert.deepEqual(changed, [], 'The exact source inputs changed during installation/build');
    const nextFiles = await readdir(path.join(directory, '.next'));
    assert.ok(nextFiles.includes('BUILD_ID') && nextFiles.includes('build-manifest.json'));
    result = 'PASS';
  } finally {
    for (const own of [directory, home]) {
      assert.equal(path.dirname(own), path.resolve(tmpdir()));
      assert.ok(/^qoro-composed-(?:build|home)-/u.test(path.basename(own)));
      await rm(own, { recursive: true });
    }
    await writeFile(
      path.join(output, 'composed-build.json'),
      JSON.stringify(
        {
          status: result,
          stage,
          source: FINANCIAL_REF,
          sharedSql: SHARED_SQL_REF,
          archiveSha256: COMPOSED_TAR_SHA256,
          archiveBytes: 234562048,
          files: members.length,
          sqlHashes: 160,
          manifestSha256: MANIFEST_SHA256,
          resources,
          node: process.version,
          commands,
          startedAt,
          completedAt: new Date().toISOString(),
          environment:
            'allowlist; new HOME; synthetic values only; no inherited tokens/DSNs/financial URLs',
          securityHarnessInjected: false,
          cleanupComplete: true,
          deployed: false,
          productionAccess: false,
        },
        null,
        2,
      ) + '\n',
    );
    console.info(JSON.stringify({ status: result, stage, cleanupComplete: true }));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Composed build failed');
    process.exitCode = 1;
  });
}
