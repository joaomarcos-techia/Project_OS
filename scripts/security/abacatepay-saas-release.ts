/** SaaS-only code with the frozen shared SQL. No merge, deploy or database writes. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';
import { readReviewedCheckoutMigrations } from '../abacatepay-checkout-session';

const financial = z
  .string()
  .regex(/^[a-f0-9]{40}$/u)
  .parse(process.env.QORO_FINANCIAL_REF);
const git = (...args: string[]) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
assert.equal(git('rev-parse', financial).trim(), financial);
assert.equal(git('cat-file', '-t', financial).trim(), 'commit');
const manifestPath = 'docs/decoupling/asaas-to-abacatepay/migrations/release-manifest.json';
const manifestSource = await readFile(manifestPath, 'utf8');
assert.equal(
  manifestSource.replaceAll('\r\n', '\n'),
  git('show', `${financial}:${manifestPath}`).replaceAll('\r\n', '\n'),
);
const manifest = z
  .object({ financialSql: z.object({ sha256: z.string() }) })
  .parse(JSON.parse(manifestSource));
const inputs = z
  .object({
    frozenMatch: z.literal(true),
    journalProposal: z.object({
      directory: z.string().regex(/^dist\/abacatepay-tiss-release-158-[a-f0-9]{8}$/u),
    }),
  })
  .parse(JSON.parse(await readFile('dist/abacatepay-tiss-composition.json', 'utf8')));
const source = path.resolve(inputs.journalProposal.directory, 'drizzle/migrations');
assert.ok(source.startsWith(path.resolve('dist') + path.sep));
const journal = z
  .object({
    entries: z
      .array(
        z.object({
          idx: z.number().int(),
          tag: z.string().regex(/^\d{4}_[a-z0-9_]+$/u),
          when: z.number().int(),
        }),
      )
      .length(160),
  })
  .parse(JSON.parse(await readFile(path.join(source, 'meta/_journal.json'), 'utf8')));
const reviewed = await readReviewedCheckoutMigrations();
const relative = `dist/abacatepay-saas-${financial.slice(0, 8)}`;
const directory = path.resolve(relative);
assert.ok(directory.startsWith(path.resolve('dist') + path.sep));
let exists = false;
try {
  await access(directory);
  exists = true;
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}
assert.equal(exists, false, 'Export exists; preserve and inspect its recorded inputs');
await mkdir(directory);
const archive = path.resolve(relative + '.tar');
git('archive', '--format=tar', '--output=' + archive, financial);
execFileSync('tar', ['-xf', archive, '-C', directory], { windowsHide: true });
const sqlProof: { tag: string; sha256: string }[] = [];
for (const [index, entry] of journal.entries.entries()) {
  assert.equal(entry.idx, index);
  if (index) assert.ok(entry.when > journal.entries[index - 1]!.when);
  const file = `${entry.tag}.sql`;
  const body = (await readFile(path.join(source, file), 'utf8')).replaceAll('\r\n', '\n');
  const hash = createHash('sha256').update(body).digest('hex');
  if (index < 143) {
    const original = (
      await readFile(path.join(directory, 'drizzle/migrations', file), 'utf8')
    ).replaceAll('\r\n', '\n');
    assert.equal(body, original, 'Common financial migration source changed');
  } else {
    const frozen = reviewed.find((item) => item.tag === entry.tag);
    assert.ok(frozen);
    assert.equal(frozen.hash, hash);
    assert.equal(frozen.when, entry.when);
  }
  await copyFile(path.join(source, file), path.join(directory, 'drizzle/migrations', file));
  sqlProof.push({ tag: entry.tag, sha256: hash });
}
await copyFile(
  path.join(source, 'meta/_journal.json'),
  path.join(directory, 'drizzle/migrations/meta/_journal.json'),
);
for (const omitted of [
  'src/contexts/health-insurance',
  'src/app/(app)/(shell)/convenios',
  'src/lib/premium-access',
]) {
  let present = false;
  try {
    await access(path.join(directory, omitted));
    present = true;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  assert.equal(present, false, 'Financial source unexpectedly contains TISS operational code');
}
const report = {
  observedAt: new Date().toISOString(),
  financial,
  directory: relative,
  sourceScope: 'financial_commit_only_no_tiss_code_merge',
  sharedSqlSource: inputs.journalProposal.directory,
  journalEntries: journal.entries.length,
  financialSqlSha256: manifest.financialSql.sha256,
  sqlProof,
  tissCodeHeadRequired: false,
  tissOperationalCodeIncluded: false,
  tissUiIncluded: false,
  mergePerformed: false,
  databaseWrites: 0,
  productionWrites: 0,
  otherWorktreeWrites: 0,
  state: 'EXPORTED_REQUIRES_TYPES_LINT_BUILD_AND_SHARED_SCHEMA_REGRESSION',
};
await writeFile(
  path.join(directory, 'saas-release-inputs.json'),
  JSON.stringify(report, null, 2) + '\n',
);
await writeFile('dist/abacatepay-saas-release.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, sqlProof: sqlProof.length }));
