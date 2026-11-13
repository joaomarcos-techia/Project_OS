import { describe, expect, it, vi } from 'vitest';
import {
  ensureMonthlyLiveCatalog,
  liveCatalogSpecification,
  type LiveProductInput,
} from '../../../../scripts/abacatepay-live-catalog';

const specification = liveCatalogSpecification();
const product = (input: LiveProductInput, index = 0) => ({
  ...input,
  id: `prod_live${index}`,
  devMode: false,
  status: 'ACTIVE',
  trialDays: null,
});
function fixture(existing: unknown[] = []) {
  let sequence = 0;
  const events: string[] = [];
  return {
    events,
    readStore: vi.fn(async () => ({ id: 'store_live' })),
    listProducts: vi.fn(async () => existing),
    createProduct: vi.fn(async (input: LiveProductInput) => {
      events.push(`POST:${input.externalId}`);
      return product(input, sequence++);
    }),
    started: vi.fn(async (externalId: string) => {
      events.push(`started:${externalId}`);
    }),
    confirmed: vi.fn(async () => {}),
  };
}
describe('authorized monthly live catalog, without financial transactions', () => {
  it('uses server quotes and includes three staff logins without native trial or annual products', () => {
    expect(specification.map((s) => [s.doctors, s.staff, s.input.price])).toEqual([
      [1, 3, 19700],
      [2, 3, 39700],
      [3, 3, 54400],
      [4, 3, 69100],
      [5, 3, 83800],
    ]);
    for (const { input } of specification) {
      expect(input.cycle).toBe('MONTHLY');
      expect(input.currency).toBe('BRL');
      expect(input).not.toHaveProperty('trialDays');
    }
  });
  it('journals every creation before POST and reuses the full existing catalog', async () => {
    const ops = fixture();
    const result = await ensureMonthlyLiveCatalog('store_live', ops, new Set());
    expect(result).toHaveLength(5);
    expect(ops.events).toEqual(
      specification.flatMap(({ input }) => [
        `started:${input.externalId}`,
        `POST:${input.externalId}`,
      ]),
    );
    const reused = fixture(result);
    expect(
      await ensureMonthlyLiveCatalog(
        'store_live',
        reused,
        new Set(result.map((p) => p.externalId)),
      ),
    ).toEqual(result);
    expect(reused.createProduct).not.toHaveBeenCalled();
  });
  it('refuses another merchant before listing or writing', async () => {
    const ops = fixture();
    await expect(ensureMonthlyLiveCatalog('store_wrong', ops, new Set())).rejects.toThrow('store');
    expect(ops.listProducts).not.toHaveBeenCalled();
    expect(ops.started).not.toHaveBeenCalled();
  });
  it.each([
    { price: 1 },
    { devMode: true },
    { trialDays: 14 },
    { cycle: 'ANNUALLY' },
    { currency: 'USD' },
    { status: 'INACTIVE' },
  ])('refuses existing catalog drift before ANY POST: %j', async (drift) => {
    const last = specification[4]!.input;
    const ops = fixture([{ ...product(last), ...drift }]);
    await expect(ensureMonthlyLiveCatalog('store_live', ops, new Set())).rejects.toThrow();
    expect(ops.started).not.toHaveBeenCalled();
    expect(ops.createProduct).not.toHaveBeenCalled();
  });
  it('does not replay an unknown POST, but accepts its later GET evidence', async () => {
    const first = specification[0]!.input;
    const blocked = fixture();
    await expect(
      ensureMonthlyLiveCatalog('store_live', blocked, new Set([first.externalId])),
    ).rejects.toThrow('Unknown');
    expect(blocked.createProduct).not.toHaveBeenCalled();
    const all = specification.map(({ input }, i) => product(input, i));
    const recovered = fixture(all);
    await ensureMonthlyLiveCatalog('store_live', recovered, new Set([first.externalId]));
    expect(recovered.createProduct).not.toHaveBeenCalled();
  });
  it('stops if the durable journal fails', async () => {
    const ops = fixture();
    ops.started.mockRejectedValueOnce(new Error('disk failure'));
    await expect(ensureMonthlyLiveCatalog('store_live', ops, new Set())).rejects.toThrow(
      'disk failure',
    );
    expect(ops.createProduct).not.toHaveBeenCalled();
  });
  it('stops on provider uncertainty without posting the next product', async () => {
    const ops = fixture();
    ops.createProduct.mockRejectedValueOnce(new Error('timeout'));
    await expect(ensureMonthlyLiveCatalog('store_live', ops, new Set())).rejects.toThrow('timeout');
    expect(ops.createProduct).toHaveBeenCalledTimes(1);
    expect(ops.started).toHaveBeenCalledTimes(1);
  });
});
