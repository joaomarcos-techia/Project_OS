import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { SandboxFileJournal } from '../../../../scripts/abacatepay-sandbox-journal';
import { executeCommandOnce } from './command-operation';

const account = {
  provider: 'abacatepay',
  environment: 'sandbox',
  accountId: 'store_fixture',
} as const;
const operationId = 'bfbe400f-3579-4bb5-8cb6-c9b95577cfe8';
const resultSchema = z.object({ id: z.literal('bill_fixture') });
const directories: string[] = [];
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'qoro-sandbox-journal-unit-'));
  directories.push(directory);
  return { directory, journal: new SandboxFileJournal(directory) };
}
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const resolved = path.resolve(directory);
    if (
      path.dirname(resolved) !== path.resolve(tmpdir()) ||
      !path.basename(resolved).startsWith('qoro-sandbox-journal-unit-')
    ) {
      throw new Error('Synthetic cleanup target outside the created scratch directory');
    }
    for (const name of await readdir(resolved)) await unlink(path.join(resolved, name));
    await rmdir(resolved);
  }
});

describe('local Sandbox file journal (real filesystem, synthetic data)', () => {
  it('survives process/client recreation without resending a confirmed command', async () => {
    const { directory, journal } = await setup();
    const execute = vi.fn(async () => ({ id: 'bill_fixture' as const }));
    const base = {
      account,
      operationId,
      kind: 'create_checkout',
      parameters: { amount: 100 },
      resultSchema,
      execute,
    };
    await executeCommandOnce({ ...base, journal });
    await expect(
      executeCommandOnce({ ...base, journal: new SandboxFileJournal(directory) }),
    ).resolves.toEqual({ id: 'bill_fixture' });
    expect(execute).toHaveBeenCalledTimes(1);
    const file = (await readdir(directory))[0];
    expect(file).toBeDefined();
    if (!file) throw new Error('Missing synthetic record');
    const contents = await readFile(path.join(directory, file), 'utf8');
    expect(contents).toContain('confirmed');
    expect(contents).not.toContain('Authorization');
  });
  it('allows only one command across independent file-journal instances racing', async () => {
    const { directory } = await setup();
    const execute = vi.fn(async () => ({ id: 'bill_fixture' as const }));
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        executeCommandOnce({
          account,
          operationId,
          kind: 'create_checkout',
          parameters: {},
          resultSchema,
          execute,
          journal: new SandboxFileJournal(directory),
        }),
      ),
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
  });
  it('keeps an interrupted running reservation blocked after reopening', async () => {
    const { directory, journal } = await setup();
    expect(await journal.reserve('fixture-key', 'a'.repeat(64))).toEqual({ claimed: true });
    expect(
      await new SandboxFileJournal(directory).reserve('fixture-key', 'a'.repeat(64)),
    ).toMatchObject({ claimed: false, operation: { state: 'running' } });
  });
  it('does not replace a truncated reservation or send a command', async () => {
    const { directory, journal } = await setup();
    const key = JSON.stringify([
      account.provider,
      account.environment,
      account.accountId,
      operationId,
    ]);
    const file = path.join(directory, `${createHash('sha256').update(key).digest('hex')}.json`);
    await writeFile(file, '{', { flag: 'wx' });
    const execute = vi.fn(async () => ({ id: 'bill_fixture' as const }));
    await expect(
      executeCommandOnce({
        account,
        operationId,
        kind: 'create_checkout',
        parameters: {},
        resultSchema,
        execute,
        journal,
      }),
    ).rejects.toMatchObject({ code: 'journal_unavailable' });
    expect(execute).not.toHaveBeenCalled();
    expect(await readFile(file, 'utf8')).toBe('{');
  });
  it('preserves unknown outcomes across recreation', async () => {
    const { directory, journal } = await setup();
    await journal.reserve('fixture-key', 'b'.repeat(64));
    await journal.markUnknown('fixture-key');
    expect(
      await new SandboxFileJournal(directory).reserve('fixture-key', 'b'.repeat(64)),
    ).toMatchObject({ claimed: false, operation: { state: 'unknown', result: null } });
  });
  it('refuses transitions that would turn an unknown result into a success', async () => {
    const { journal } = await setup();
    await journal.reserve('fixture-key', 'b'.repeat(64));
    await journal.markUnknown('fixture-key');
    await expect(journal.confirm('fixture-key', { id: 'bill_fixture' })).rejects.toThrow(
      'Sandbox journal unavailable',
    );
  });
});
