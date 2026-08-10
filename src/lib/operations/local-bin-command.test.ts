import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { existsSyncMock } = vi.hoisted(() => ({ existsSyncMock: vi.fn() }));

vi.mock('node:fs', () => ({ existsSync: existsSyncMock }));

import { localBinCommand } from '../../../scripts/_local-bin';

const repoRoot = process.cwd();

describe('localBinCommand', () => {
  beforeEach(() => {
    existsSyncMock.mockReturnValue(true);
  });

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
    existsSyncMock.mockReturnValue(false);

    expect(() => localBinCommand('missing-tool', 'win32', repoRoot)).toThrow(
      'Required local binary is missing',
    );
  });
});
