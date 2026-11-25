import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { extractReleaseArchive } from '../../../../scripts/release-archive';

it('extracts a Git UTF8 member with its exact filename and blob bytes', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'qoro-release-archive-'));
  const archive = path.join(directory, 'fixture.tar');
  const target = path.join(directory, 'output');
  const member = 'docs/VisãoGeral.md';
  mkdirSync(target);
  try {
    const expected = execFileSync('git', ['show', `HEAD:${member}`]);
    execFileSync('git', ['archive', '--format=tar', '--output=' + archive, 'HEAD', '--', member]);
    extractReleaseArchive(archive, target);
    expect(readFileSync(path.join(target, member))).toEqual(expected);
    expect(readdirSync(path.join(target, 'docs'))).toEqual(['VisãoGeral.md']);
  } finally {
    // Only files created in this unique fixture; no recursive deletion.
    const documents = path.join(target, 'docs');
    if (existsSync(documents)) {
      for (const entry of readdirSync(documents, { withFileTypes: true })) {
        if (!entry.isFile()) throw new Error('Unexpected fixture entry; preserve for review');
        unlinkSync(path.join(documents, entry.name));
      }
      rmdirSync(documents);
    }
    if (existsSync(archive)) unlinkSync(archive);
    rmdirSync(target);
    rmdirSync(directory);
  }
});
