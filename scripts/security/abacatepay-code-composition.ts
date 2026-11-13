/** Review-only source export. Never merges branches or modifies the TISS worktree. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const root = process.cwd();
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
const financial = z
  .string()
  .regex(/^[a-f0-9]{40}$/)
  .parse(process.env.QORO_FINANCIAL_REF);
const tiss = z
  .string()
  .regex(/^[a-f0-9]{40}$/)
  .parse(process.env.QORO_TISS_REF);
assert.equal(git('rev-parse', financial).trim(), financial);
assert.equal(git('rev-parse', tiss).trim(), tiss);
const manifest = z
  .object({
    tissHead: z.string().regex(/^[a-f0-9]{40}$/),
    financialSql: z.object({ sha256: z.string() }),
  })
  .parse(
    JSON.parse(
      await readFile(
        'docs/decoupling/asaas-to-abacatepay/migrations/release-manifest.json',
        'utf8',
      ),
    ),
  );
// A later source release can reuse the frozen SQL only if the entire migration
// tree is identical. Never rewrite the approved manifest to follow a moving PR.
git('merge-base', '--is-ancestor', manifest.tissHead, tiss);
assert.equal(
  git('diff', '--name-only', manifest.tissHead, tiss, '--', 'drizzle/migrations').trim(),
  '',
  'TISS schema changed after the frozen release; coordinate a new manifest first',
);
const inputs = z
  .object({
    frozenMatch: z.literal(true),
    source: z.object({ tissRef: z.literal(manifest.tissHead) }),
    journalProposal: z.object({
      directory: z.string().regex(/^dist\/abacatepay-tiss-release-158-[a-f0-9]{8}$/),
    }),
  })
  .parse(JSON.parse(await readFile('dist/abacatepay-tiss-composition.json', 'utf8')));
const merged = spawnSync('git', ['merge-tree', '--write-tree', '--name-only', financial, tiss], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
  maxBuffer: 16 << 20,
});
assert.ok(merged.status === 0 || merged.status === 1, 'Source projection failed');
const [header] = merged.stdout.split('\n\n');
assert.ok(header);
const [tree, ...conflicts] = header.trim().split('\n');
assert.ok(tree && /^[a-f0-9]{40}$/.test(tree));
assert.deepEqual(conflicts.sort(), [
  'docs/security/acoes.md',
  'drizzle/migrations/meta/_journal.json',
  'scripts/arch-db-check.ts',
]);

const relative = `dist/abacatepay-code-${financial.slice(0, 8)}-${tiss.slice(0, 8)}`;
const directory = path.resolve(root, relative);
assert.ok(directory.startsWith(path.resolve(root, 'dist') + path.sep));
let exists = false;
try {
  await access(directory);
  exists = true;
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}
assert.equal(exists, false, 'Export already exists; preserve it and inspect its recorded inputs');
await mkdir(directory);
const archive = path.resolve(root, relative + '.tar');
git('archive', '--format=tar', '--output=' + archive, tree);
execFileSync('tar', ['-xf', archive, '-C', directory], { windowsHide: true });
const generated = path.resolve(root, inputs.journalProposal.directory, 'drizzle/migrations');
await copyFile(
  path.join(generated, 'meta/_journal.json'),
  path.join(directory, 'drizzle/migrations/meta/_journal.json'),
);
const sql = await readFile(path.join(generated, '0159_saas_period_snapshot.sql'), 'utf8');
assert.equal(
  createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex'),
  manifest.financialSql.sha256,
);
await writeFile(path.join(directory, 'drizzle/migrations/0159_saas_period_snapshot.sql'), sql);
await copyFile(
  path.join(root, 'docs/decoupling/asaas-to-abacatepay/migrations/release-manifest.json'),
  path.join(directory, 'docs/decoupling/asaas-to-abacatepay/migrations/release-manifest.json'),
);
const archPath = path.join(directory, 'scripts/arch-db-check.ts');
const arch = await readFile(archPath, 'utf8');
const markers = arch.match(/^<<<<<<< .*$/gm) ?? [];
assert.equal(markers.length, 1, 'Unexpected architecture conflict; review manually');
const resolution = [
  '// Both exact, guarded migrators remain explicit; no directory-wide exemption.',
  'const ALLOWED_DRIZZLE_PG_IMPORTS = new Set([',
  "  'src/lib/db/index.ts',",
  "  'scripts/security/abacatepay-dev-release.ts',",
  "  'scripts/db-migrate-dev-limited.ts',",
].join('\n');
const resolved = arch.replace(/^<<<<<<< [\s\S]*?^>>>>>>> .*$/m, resolution);
assert.ok(!/^<<<<<<< |^=======|^>>>>>>> /m.test(resolved));
await writeFile(archPath, resolved);
const patches = ['tiss-ledger-integration.patch', 'tiss-composition-harness.patch'];
for (const patch of patches) {
  const file = `docs/decoupling/asaas-to-abacatepay/migrations/${patch}`;
  git('apply', '--check', '--unidiff-zero', '--directory=' + relative, file);
  git('apply', '--unidiff-zero', '--directory=' + relative, file);
}
// Regenerate, rather than choosing one side of the security inventory conflict.
execFileSync(
  process.execPath,
  [
    path.join(root, 'node_modules/tsx/dist/cli.mjs'),
    path.join(root, 'scripts/security/inventory.ts'),
    '--write',
  ],
  {
    cwd: directory,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  },
);
const report = {
  observedAt: new Date().toISOString(),
  financial,
  tiss,
  frozenSqlRef: manifest.tissHead,
  projectedTree: tree,
  directory: relative,
  conflicts,
  patches,
  journalEntries: 160,
  financialSqlSha256: manifest.financialSql.sha256,
  mergePerformed: false,
  databaseWrites: 0,
  otherWorktreeWrites: 0,
  state: 'EXPORTED_REQUIRES_TYPES_LINT_BUILD_AND_REGRESSION',
};
await writeFile(
  path.join(directory, 'composition-inputs.json'),
  JSON.stringify(report, null, 2) + '\n',
);
await writeFile('dist/abacatepay-code-composition.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
