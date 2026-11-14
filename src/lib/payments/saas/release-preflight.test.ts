import { describe, expect, it } from 'vitest';
import {
  assertReleaseHistory,
  assertReleaseSchema,
  type ReleasePlan,
} from '../../../../scripts/abacatepay-release-validation';

const plan: ReleasePlan = {
  financial: 'a'.repeat(40),
  folder: 'synthetic',
  migrations: Array.from({ length: 160 }, (_, idx) => ({
    idx,
    tag: String(idx).padStart(4, '0') + '_synthetic',
    when: 1000 + idx,
    hash: 'a'.repeat(64),
    acceptedHashes: ['a'.repeat(64), 'b'.repeat(64)],
  })),
};
const history = (count: number) =>
  plan.migrations
    .slice(0, count)
    .map((item, idx) => ({ id: idx * 2 + 1, hash: item.hash, created_at: String(item.when) }));
describe('read-only release preflight', () => {
  it('recognizes the exact 136-entry prefix and returns 24 pending migrations', () => {
    const rows = history(136);
    const before = structuredClone(rows);
    expect(assertReleaseHistory(plan, rows, 'before').pending).toHaveLength(24);
    expect(rows).toEqual(before);
  });
  it('accepts reviewed byte variants without rewriting applied history', () => {
    const rows = history(160);
    rows[0]!.hash = 'b'.repeat(64);
    expect(assertReleaseHistory(plan, rows, 'after').pending).toHaveLength(0);
    expect(rows[0]!.hash).toBe('b'.repeat(64));
  });
  it.each([
    'missing',
    'hash',
    'order',
    'duplicate',
    'timestamp',
    'partial',
    'unreviewed_tail',
    'invalid_input',
  ])('rejects %s rather than silently skipping history', (kind) => {
    const rows = history(160);
    if (kind === 'missing') rows.splice(136, 1);
    if (kind === 'hash') rows[100]!.hash = 'c'.repeat(64);
    if (kind === 'order') [rows[1], rows[2]] = [rows[2]!, rows[1]!];
    if (kind === 'duplicate') rows.push(rows[0]!);
    if (kind === 'timestamp') rows[0]!.created_at = '2';
    if (kind === 'partial') rows.pop();
    if (kind === 'unreviewed_tail')
      rows.push({ id: 1000, hash: 'a'.repeat(64), created_at: '2000' });
    if (kind === 'invalid_input') rows[0]!.hash = 'invalid';
    expect(() => assertReleaseHistory(plan, rows, 'after')).toThrow();
  });
  it('rejects reordered release inputs even with the expected total count', () => {
    const modified = structuredClone(plan);
    [modified.migrations[136], modified.migrations[137]] = [
      modified.migrations[137]!,
      modified.migrations[136]!,
    ];
    expect(() => assertReleaseHistory(modified, history(136), 'before')).toThrow();
  });
  const baseline = {
    tables: [
      'public.subscriptions',
      'public.invoices',
      'public.profiles',
      'public.patient_charges',
    ].map((name) => ({ name, secured: true })),
    billingProviderColumn: false,
    futureTables: 0,
    periodColumns: 0,
    originTriggers: 0,
    periodConstraint: false,
    invalidGatewayIndexes: 0,
  };
  it('accepts a secure baseline without future DDL', () =>
    expect(assertReleaseSchema(baseline, 'before').requiredSecuredRelations).toBe(4));
  it.each(['missing_relation', 'rls_disabled', 'future_table', 'future_column'])(
    'rejects schema inconsistency %s',
    (kind) => {
      const facts = structuredClone(baseline);
      if (kind === 'missing_relation') facts.tables.pop();
      if (kind === 'rls_disabled') facts.tables[0]!.secured = false;
      if (kind === 'future_table') facts.futureTables++;
      if (kind === 'future_column') facts.billingProviderColumn = true;
      expect(() => assertReleaseSchema(facts, 'before')).toThrow();
    },
  );
});
