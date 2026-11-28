/** Compose the single Drizzle history from immutable SQL inputs; no DB or deploy writes. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { composeFrozenSaasJournal } from './abacatepay-checkout-session';

const sha = z.string().regex(/^[a-f0-9]{40}$/u);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const entry = z.object({
  idx: z.number().int().nonnegative(),
  tag: z.string().regex(/^\d{4}_[a-z0-9_]+$/u),
  when: z.number().int().positive(),
});
const journalSchema = z.object({
  version: z.literal('7'),
  dialect: z.literal('postgresql'),
  entries: z.array(entry.extend({ version: z.literal('7'), breakpoints: z.boolean() })),
});
const manifest = z
  .object({
    version: z.literal(1),
    devProjectRef: z.literal('pqhkirrszzpwezdaqrai'),
    sharedTailCommit: sha,
    sharedTail: z.array(entry.extend({ sha256: digest })).length(8),
    pix: entry.extend({ file: z.string(), sha256: digest }),
  })
  .parse(
    JSON.parse(
      await readFile(
        'docs/decoupling/asaas-to-abacatepay/migrations/pix-release-manifest.json',
        'utf8',
      ),
    ),
  );
const frozen = z
  .object({
    tissHead: sha,
    financialEntry: entry.extend({ version: z.literal('7'), breakpoints: z.boolean() }),
    financialSql: z.object({ file: z.string(), sha256: digest }),
  })
  .parse(
    JSON.parse(
      await readFile(
        'docs/decoupling/asaas-to-abacatepay/migrations/release-manifest.json',
        'utf8',
      ),
    ),
  );
const git = (...args: string[]) =>
  execFileSync('git', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const readGit = (ref: string, file: string) => git('show', `${ref}:${file}`);
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const appHead = sha.parse(git('rev-parse', 'HEAD').toString().trim());
for (const ref of [appHead, frozen.tissHead, manifest.sharedTailCommit])
  assert.equal(git('cat-file', '-t', ref).toString().trim(), 'commit');
const base = journalSchema.parse(
  JSON.parse(await readFile('drizzle/migrations/meta/_journal.json', 'utf8')),
);
const shared = journalSchema.parse(
  JSON.parse(readGit(frozen.tissHead, 'drizzle/migrations/meta/_journal.json').toString()),
);
const tail = journalSchema.parse(
  JSON.parse(
    readGit(manifest.sharedTailCommit, 'drizzle/migrations/meta/_journal.json').toString(),
  ),
);
const prefix = composeFrozenSaasJournal(base, shared, frozen.financialEntry);
assert.equal(prefix.entries.length, 160);
assert.equal(tail.entries.at(-1)?.idx, 167, 'Shared TISS source advanced; review again');
for (let idx = 143; idx <= 158; idx++)
  assert.deepEqual(
    tail.entries.find((item) => item.idx === idx),
    prefix.entries[idx],
    'Shared SQL history changed',
  );
for (const [offset, item] of manifest.sharedTail.entries()) {
  assert.equal(item.idx, 160 + offset);
  assert.deepEqual(
    tail.entries.find((candidate) => candidate.idx === item.idx),
    {
      idx: item.idx,
      tag: item.tag,
      when: item.when,
      version: '7',
      breakpoints: true,
    },
  );
}
assert.equal(manifest.pix.idx, 168);
assert.equal(manifest.pix.tag, '0168_saas_pix_replacement_intents');
const lastShared = tail.entries.find((item) => item.idx === 167);
assert.ok(lastShared && manifest.pix.when > lastShared.when);
const journalPixEntry = {
  idx: manifest.pix.idx,
  tag: manifest.pix.tag,
  when: manifest.pix.when,
  version: '7' as const,
  breakpoints: true,
};
const journal = journalSchema.parse({
  ...prefix,
  entries: [
    ...prefix.entries,
    ...tail.entries.filter((item) => item.idx >= 160 && item.idx <= 167),
    journalPixEntry,
  ],
});
assert.equal(journal.entries.length, 169);
for (const [idx, item] of journal.entries.entries()) {
  assert.equal(item.idx, idx);
  if (idx > 0) assert.ok(item.when > journal.entries[idx - 1]!.when);
}
const candidate = await readFile(
  'docs/decoupling/asaas-to-abacatepay/propostas/pix-replacement-intents.sql',
  'utf8',
);
const finalPix = await readFile(manifest.pix.file);
assert.equal(hash(finalPix), manifest.pix.sha256);
const statements = (body: string) =>
  body
    .replaceAll('\r\n', '\n')
    .split('\n')
    .filter((line) => line.trim() && !line.trimStart().startsWith('--'))
    .join('\n');
assert.equal(
  statements(finalPix.toString()),
  statements(candidate),
  'Pix proposal and migration differ',
);
await mkdir('dist', { recursive: true });
const output = await mkdtemp(path.join('dist', 'abacatepay-pix-migrations-'));
await mkdir(path.join(output, 'meta'));
const sqlProof: { idx: number; tag: string; sha256: string }[] = [];
for (const item of journal.entries) {
  const relative = `drizzle/migrations/${item.tag}.sql`;
  const body =
    item.idx <= 142
      ? readGit(appHead, relative)
      : item.idx <= 158
        ? readGit(frozen.tissHead, relative)
        : item.idx === 159
          ? await readFile(frozen.financialSql.file)
          : item.idx <= 167
            ? readGit(manifest.sharedTailCommit, relative)
            : finalPix;
  if (item.idx <= 142)
    assert.equal(hash(body), hash(await readFile(relative)), 'Application migration changed');
  if (item.idx === 159) assert.equal(hash(body), frozen.financialSql.sha256);
  if (item.idx >= 160 && item.idx <= 167)
    assert.equal(hash(body), manifest.sharedTail[item.idx - 160]!.sha256);
  await writeFile(path.join(output, `${item.tag}.sql`), body);
  sqlProof.push({ idx: item.idx, tag: item.tag, sha256: hash(body) });
}
await writeFile(path.join(output, 'meta/_journal.json'), JSON.stringify(journal, null, 2) + '\n');
const report = {
  status: 'PREPARED_NOT_APPLIED',
  appHead,
  frozenSharedSql: frozen.tissHead,
  sharedTailSql: manifest.sharedTailCommit,
  migrationFolder: output,
  journalEntries: journal.entries.length,
  pixHash: manifest.pix.sha256,
  sqlProof,
  tissApplicationCodeImported: false,
  databaseWrites: 0,
  productionWrites: 0,
};
await writeFile(path.join(output, 'composition.json'), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(
  JSON.stringify({ ...report, sqlProof: sqlProof.length, migrationFolder: path.resolve(output) }) +
    '\n',
);
