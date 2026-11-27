/** Local Sandbox operator journal. Never use for a deployed/multi-instance service. */
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import type { CommandOperationJournal } from '../src/lib/payments/saas/command-operation';

const recordSchema = z.object({
  key: z.string().min(1).max(1000),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(['running', 'confirmed', 'unknown']),
  result: z.unknown(),
});

class LocalJournalError extends Error {
  constructor() {
    super('Sandbox journal unavailable; preserve files and reconcile');
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

export class SandboxFileJournal implements CommandOperationJournal {
  private readonly directory: string;
  constructor(directory: string) {
    if (!path.isAbsolute(directory)) throw new LocalJournalError();
    this.directory = path.resolve(directory);
  }
  private file(key: string): string {
    return path.join(this.directory, `${createHash('sha256').update(key).digest('hex')}.json`);
  }
  private async prepare(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new LocalJournalError();
  }
  private async read(key: string) {
    const file = this.file(key);
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384)
      throw new LocalJournalError();
    const record = recordSchema.parse(JSON.parse(await readFile(file, 'utf8')));
    if (record.key !== key) throw new LocalJournalError();
    return record;
  }
  async reserve(key: string, fingerprint: string) {
    try {
      await this.prepare();
      const record = recordSchema.parse({ key, fingerprint, state: 'running', result: null });
      let handle: Awaited<ReturnType<typeof open>>;
      try {
        handle = await open(this.file(key), 'wx', 0o600);
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error;
        return { claimed: false as const, operation: await this.read(key) };
      }
      try {
        await handle.writeFile(JSON.stringify(record));
        await handle.sync();
      } finally {
        await handle.close();
      }
      return { claimed: true as const };
    } catch {
      throw new LocalJournalError();
    }
  }
  private async transition(
    key: string,
    state: 'confirmed' | 'unknown',
    result: unknown,
  ): Promise<void> {
    try {
      const record = await this.read(key);
      if (record.state !== 'running') throw new LocalJournalError();
      const next = recordSchema.parse({ ...record, state, result });
      const serialized = JSON.stringify(next);
      if (Buffer.byteLength(serialized) > 16_384) throw new LocalJournalError();
      const temporary = path.join(this.directory, `${randomUUID()}.pending`);
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(serialized);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.file(key));
    } catch {
      throw new LocalJournalError();
    }
  }
  confirm(key: string, result: unknown): Promise<void> {
    return this.transition(key, 'confirmed', result);
  }
  markUnknown(key: string): Promise<void> {
    return this.transition(key, 'unknown', null);
  }
}
