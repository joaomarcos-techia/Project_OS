import type {
  CommandOperationJournal,
  StoredCommandOperation,
} from '../payments/saas/command-operation';

/** Unit-test double only; never use as durable storage in an application. */
export class TestCommandJournal implements CommandOperationJournal {
  readonly records = new Map<string, StoredCommandOperation>();
  async reserve(key: string, fingerprint: string) {
    const existing = this.records.get(key);
    if (existing) return { claimed: false as const, operation: existing };
    this.records.set(key, { fingerprint, state: 'running', result: null });
    return { claimed: true as const };
  }
  async confirm(key: string, result: unknown) {
    const record = this.records.get(key);
    if (!record) throw new Error('Missing unit fixture');
    this.records.set(key, { ...record, state: 'confirmed', result });
  }
  async markUnknown(key: string) {
    const record = this.records.get(key);
    if (!record) throw new Error('Missing unit fixture');
    this.records.set(key, { ...record, state: 'unknown' });
  }
}
