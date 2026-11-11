/** Immutable, read-only Git inputs. Never imports SQL into either branch's journal. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { z } from 'zod';

const journalSchema = z.object({
  entries: z.array(
    z.object({
      idx: z.number().int(),
      when: z.number().int(),
      tag: z.string().regex(/^\d{4}_[a-z0-9_]+$/),
    }),
  ),
});

export async function loadTissProofInputs() {
  const input = process.env.QORO_TISS_WORKTREE;
  const ref = process.env.QORO_TISS_REF;
  assert.ok(input, 'Set the authorized read-only QORO_TISS_WORKTREE');
  assert.match(ref ?? '', /^[a-f0-9]{40}$/, 'Pin QORO_TISS_REF to a full reviewed commit SHA');
  const root = await realpath(input);
  assert.notEqual(root.toLowerCase(), (await realpath('.')).toLowerCase());
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
  const head = git('rev-parse', '--verify', `${ref}^{commit}`).trim();
  assert.equal(head, ref);
  const financial = journalSchema.parse(
    JSON.parse(await readFile('drizzle/migrations/meta/_journal.json', 'utf8')),
  ).entries;
  const tiss = journalSchema.parse(
    JSON.parse(git('show', `${head}:drizzle/migrations/meta/_journal.json`)),
  ).entries;
  execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'drizzle/migrations'], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const financialHead = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
  const blobs = (output: string) =>
    new Map(
      output
        .trim()
        .split('\n')
        .map((line): [string, string] => {
          const match = /^\d+ blob ([a-f0-9]{40})\t(.+)$/.exec(line);
          assert.ok(match, 'Unexpected Git tree entry');
          const hash = match[1],
            file = match[2];
          assert.ok(hash && file);
          return [file, hash];
        }),
    );
  const financialBlobs = blobs(
    execFileSync('git', ['ls-tree', '-r', financialHead, '--', 'drizzle/migrations'], {
      encoding: 'utf8',
      windowsHide: true,
    }),
  );
  const tissBlobs = blobs(git('ls-tree', '-r', head, '--', 'drizzle/migrations'));
  assert.equal(financial.at(-1)?.idx, 142, 'Financial base changed: review before recomposing');
  const lastIndex = tiss.at(-1)?.idx;
  assert.ok(
    lastIndex === 149 || lastIndex === 150,
    'Only reviewed 0149/0150 snapshots are supported; do not include moving work',
  );
  const additions = tiss.filter((entry) => entry.idx >= 143);
  assert.deepEqual(
    additions.map((entry) => entry.idx),
    Array.from({ length: lastIndex - 142 }, (_, index) => 143 + index),
  );
  for (const entry of tiss.filter((entry) => entry.idx < 143)) {
    assert.deepEqual(
      financial.find((item) => item.idx === entry.idx),
      entry,
      'Common journal diverged',
    );
    const file = `drizzle/migrations/${entry.tag}.sql`;
    assert.ok(financialBlobs.has(file), `Common SQL missing: ${entry.tag}`);
    assert.equal(
      financialBlobs.get(file),
      tissBlobs.get(file),
      `Common SQL diverged: ${entry.tag}`,
    );
  }
  const ordered = [...financial, ...additions];
  for (let index = 0; index < ordered.length; index++) {
    assert.equal(ordered[index]?.idx, index, 'Noncontiguous composed sequence');
    if (index) assert.ok((ordered[index]?.when ?? 0) > (ordered[index - 1]?.when ?? 0));
  }
  const sources = additions.map((entry) => {
    const body = git('show', `${head}:drizzle/migrations/${entry.tag}.sql`);
    return { ...entry, body, sha256: createHash('sha256').update(body).digest('hex') };
  });
  return {
    head,
    lastIndex,
    financial,
    sources,
    ordered,
    sourceAccess: 'immutable git show only; uncommitted work is excluded',
  };
}
