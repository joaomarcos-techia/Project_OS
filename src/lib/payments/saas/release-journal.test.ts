import { describe, expect, it } from 'vitest';
import { composeFrozenSaasJournal } from '../../../../scripts/abacatepay-checkout-session';

const entry = (idx: number) => ({
  idx,
  version: '7',
  breakpoints: true,
  when: 1000 + idx,
  tag: `${String(idx).padStart(4, '0')}_synthetic`,
});
const base = {
  version: '7',
  dialect: 'postgresql',
  entries: Array.from({ length: 143 }, (_, index) => entry(index)),
};
const partial = {
  ...base,
  entries: [
    ...base.entries.slice(0, 136),
    ...Array.from({ length: 16 }, (_, index) => entry(143 + index)),
  ],
};
const successor = { ...entry(159), tag: '0159_saas_period_snapshot' };

describe('frozen shared SQL without a TISS code dependency', () => {
  it('joins the partial TISS journal without dropping the seven financial migrations', () => {
    const before = structuredClone({ base, partial, successor });
    const result = composeFrozenSaasJournal(base, partial, successor);
    expect(partial.entries).toHaveLength(152);
    expect(result.entries).toHaveLength(160);
    expect(result.entries.map((row) => row.idx)).toEqual(
      Array.from({ length: 160 }, (_, index) => index),
    );
    expect(result.entries.slice(136, 143)).toEqual(base.entries.slice(136));
    expect({ base, partial, successor }).toEqual(before);
  });
  it('also recognizes a complete shared prefix without duplicating it', () => {
    const full = { ...base, entries: [...base.entries, ...partial.entries.slice(136)] };
    expect(composeFrozenSaasJournal(base, full, successor)).toEqual(
      composeFrozenSaasJournal(base, partial, successor),
    );
  });
  it.each(['common_drift', 'duplicate', 'missing_tail', 'reordered_tail', 'timestamp'])(
    'rejects %s before exporting an ambiguous history',
    (reason) => {
      const shared = structuredClone(partial);
      if (reason === 'common_drift') shared.entries[0]!.when++;
      if (reason === 'duplicate') shared.entries.push(shared.entries[0]!);
      if (reason === 'missing_tail') shared.entries.pop();
      if (reason === 'reordered_tail') shared.entries.reverse();
      if (reason === 'timestamp') shared.entries.at(-1)!.when = 1;
      expect(() => composeFrozenSaasJournal(base, shared, successor)).toThrow();
    },
  );
});
