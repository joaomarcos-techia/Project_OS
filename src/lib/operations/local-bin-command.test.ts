import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { localBinCommand } from '../../../scripts/_local-bin';

const repoRoot = process.cwd();

describe('localBinCommand', () => {
  it('uses the Windows command shim when requested', () => {
    expect(localBinCommand('drizzle-kit', 'win32', repoRoot)).toBe(
      `"${resolve(repoRoot, 'node_modules', '.bin', 'drizzle-kit.cmd')}"`,
    );
  });

  it('uses the POSIX executable when requested', () => {
    expect(localBinCommand('drizzle-kit', 'linux', repoRoot)).toBe(
      `"${resolve(repoRoot, 'node_modules', '.bin', 'drizzle-kit')}"`,
    );
  });

  it('fails before launching a missing binary', () => {
    expect(() => localBinCommand('missing-tool', 'win32', repoRoot)).toThrow(
      'Required local binary is missing',
    );
  });
});
