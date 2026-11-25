import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/payments/saas/acquisition', () => ({ abacatePayEnvironment: () => 'sandbox' }));
import { PgDialect } from 'drizzle-orm/pg-core';
import { createHash } from 'node:crypto';
import type { SQL } from 'drizzle-orm';
import { GatewayReadError } from '@/lib/payments/saas/contracts';
import type { createAbacatePayTransport } from '@/lib/payments/abacatepay/transport';
const mocks = vi.hoisted(() => ({ emit: vi.fn(), capture: vi.fn() }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));
vi.mock('@/lib/observability/capture', () => ({ captureBackgroundError: mocks.capture }));
import {
  advanceAbacatePayStatementScans as advance,
  createPersistentAbacatePayStatementReader as reader,
  createPersistentAbacatePayRefundReader as refundReader,
  AbacatePayStatementScanPending,
} from './abacatepay-statement-scan';

const account = {
  provider: 'abacatepay',
  environment: 'sandbox',
  accountId: 'store_synthetic',
} as const;
const id = '11111111-1111-4111-8111-111111111111',
  generation = '22222222-2222-4222-8222-222222222222';
const expected = {
  checkoutId: 'bill_one',
  customerId: 'cust_one',
  expectedAmountMinor: 39700,
  periodStart: '2026-01-02T00:00:00.000Z',
  periodEnd: '2026-01-30T00:00:00.000Z',
};
const payload = {
  id: 'tran_one',
  currency: 'BRL',
  createdAt: '2026-01-15T12:00:00.000Z',
  checkoutId: 'bill_one',
  paymentIntentId: 'char_one',
  customer: { publicId: 'cust_one' },
  movements: [
    {
      amount: 39700,
      kind: 'CARD_APPROVED',
      method: 'CARD',
      category: 'transaction',
      balanceEffect: 'credit',
    },
  ],
};
const page = { success: true, data: [payload], pagination: { hasMore: false, next: null } };
const claim = {
  id,
  account_id: id,
  generation,
  month_start: '2026-01-01',
  after_cursor: null,
  seen_cursor_hashes: [],
  next_attempt_at: new Date(),
  started_at: new Date(),
  failures: 0,
  refresh_kind: 'full',
  purpose: 'card_approved',
};
const backlog = [{ pending: 0, oldest_ms: 0 }];
function database(responses: unknown[]) {
  const pending = [...responses],
    statements: SQL[] = [];
  const execute = vi.fn(async (statement: SQL) => {
    statements.push(statement);
    if (pending.length === 0) throw new Error('Unexpected SQL in scanner unit proof');
    return pending.shift();
  });
  return { execute, statements };
}
const request = () =>
  vi
    .fn<ReturnType<typeof createAbacatePayTransport>>()
    .mockImplementation(async (input) =>
      input.path === '/stores/get' ? { success: true, data: { id: account.accountId } } : page,
    );
beforeEach(() => vi.clearAllMocks());
describe('durable statement scan boundary (SQL doubles; PostgreSQL proof is separate)', () => {
  it('does not use the CARD cache to confirm a Pix deposit', async () => {
    const db = database([]);
    const read = request().mockResolvedValue({
      ...page,
      data: [
        {
          ...payload,
          movements: [
            { ...payload.movements[0], kind: 'DEPOSIT', method: 'PIX', balanceEffect: 'credit' },
          ],
        },
      ],
    });
    expect(await reader(db, account)(read, { ...expected, paymentMethod: 'PIX' })).toMatchObject({
      paymentId: 'char_one',
      amountMinor: 39700,
    });
    expect(db.execute).not.toHaveBeenCalled();
    expect(read.mock.calls[0]?.[0].params?.get('method')).toBe('PIX');
    expect(read.mock.calls[0]?.[0].params?.get('kind')).toBe('DEPOSIT');
  });
  it('N-1 performs no scan or provider call before the approved schema exists', async () => {
    const db = database([[{ ready: false }]]),
      read = request();
    expect((await advance(db, account, read)).pages).toBe(0);
    expect(read).not.toHaveBeenCalled();
  });
  it('refuses a Production account before account lookup or provider access', async () => {
    const db = database([[{ ready: true }]]),
      read = request();
    await expect(
      advance(db, { ...account, environment: 'production' }, read),
    ).rejects.toMatchObject({ code: 'environment_mismatch' });
    expect(db.execute).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
  });
  it('keeps adjustment requests unfiltered by CARD and stores only refund/reversal movements', async () => {
    const read = request()
      .mockResolvedValueOnce({ success: true, data: { id: account.accountId } })
      .mockResolvedValueOnce({
        ...page,
        data: [
          {
            ...payload,
            movements: [
              ...payload.movements,
              { amount: 39700, category: 'refund', balanceEffect: 'debit' },
            ],
          },
        ],
      });
    const db = database([
      [{ ready: true }],
      [{ id }],
      [{ ...claim, purpose: 'adjustments' }],
      [{ updated: 1, conflicts: 0, complete: true }],
      backlog,
    ]);
    expect((await advance(db, account, read, { maxPages: 1 })).pages).toBe(1);
    const params = read.mock.calls[1]?.[0].params;
    expect(params?.has('method')).toBe(false);
    expect(params?.has('kind')).toBe(false);
    const statement = db.statements[3];
    if (!statement) throw new Error('Expected an atomic page checkpoint');
    const persisted = JSON.stringify(new PgDialect().sqlToQuery(statement).params);
    expect(persisted).toContain('refund');
    expect(persisted).not.toContain('CARD_APPROVED');
  });
  it('partial adjustment coverage never returns a refund amount', async () => {
    const db = database([
      [{ ready: true }],
      [{ id }],
      [],
      [{ id }],
      [],
      backlog,
      [{ complete: 0 }],
    ]);
    await expect(
      refundReader(db, account)(request(), {
        checkoutId: expected.checkoutId,
        customerId: expected.customerId,
        expectedAmountMinor: 39700,
        windowStart: expected.periodStart,
        windowEnd: expected.periodEnd,
        requireCustomer: true,
      }),
    ).rejects.toBeInstanceOf(AbacatePayStatementScanPending);
  });
  it.each([false, true])(
    'complete adjustment cache conflict=%s preserves bound refund semantics',
    async (conflict) => {
      const db = database([
        [{ ready: true }],
        [{ id }],
        [],
        [{ id }],
        [],
        backlog,
        [{ complete: 1 }],
        [
          {
            payload: {
              ...payload,
              movements: [{ amount: 39700, category: 'refund', balanceEffect: 'debit' }],
            },
            conflict,
          },
        ],
      ]);
      const result = refundReader(db, account)(request(), {
        checkoutId: expected.checkoutId,
        customerId: expected.customerId,
        expectedAmountMinor: 39700,
        windowStart: expected.periodStart,
        windowEnd: expected.periodEnd,
        requireCustomer: true,
      });
      if (conflict) await expect(result).rejects.toMatchObject({ code: 'binding_mismatch' });
      else
        await expect(result).resolves.toEqual({
          refundDebitMinor: 39700,
          reversalObserved: false,
          evidenceLevel: 'refund_debit_verified',
        });
    },
  );
  it('refuses an account that is absent in the exact environment before provider access', async () => {
    const db = database([[{ ready: true }], []]),
      read = request();
    await expect(advance(db, account, read)).rejects.toMatchObject({ code: 'binding_mismatch' });
    expect(read).not.toHaveBeenCalled();
  });
  it('rejects an unsupported provider before provider access', async () => {
    const db = database([[{ ready: true }]]),
      read = request();
    await expect(advance(db, { ...account, provider: 'asaas' }, read)).rejects.toMatchObject({
      code: 'binding_mismatch',
    });
    expect(read).not.toHaveBeenCalled();
  });
  it('rejects an excessive per-execution budget', async () => {
    await expect(
      advance(database([[{ ready: true }], [{ id }]]), account, request(), { maxPages: 101 }),
    ).rejects.toThrow();
  });
  it('defers when the deadline leaves no page budget', async () => {
    const read = request();
    expect(
      (
        await advance(database([[{ ready: true }], [{ id }], backlog]), account, read, {
          deadlineMs: Date.now() + 1,
        })
      ).deferred,
    ).toBe(true);
    expect(read).not.toHaveBeenCalled();
  });
  it('does not query the provider when another worker owns the pending page', async () => {
    const read = request();
    expect(
      (await advance(database([[{ ready: true }], [{ id }], [], backlog]), account, read)).pages,
    ).toBe(0);
    expect(read).not.toHaveBeenCalled();
  });
  it('validates the source store before ingesting a page', async () => {
    const read = request().mockResolvedValueOnce({ success: true, data: { id: 'store_wrong' } });
    const db = database([[{ ready: true }], [{ id }], [claim], [], backlog]);
    expect((await advance(db, account, read, { maxPages: 1 })).failed).toBe(1);
    expect(read).toHaveBeenCalledOnce();
  });
  it('commits a verified page and emits only numeric operational observations', async () => {
    const db = database([
      [{ ready: true }],
      [{ id }],
      [claim],
      [{ updated: 1, conflicts: 0, complete: true }],
      backlog,
    ]);
    expect(await advance(db, account, request(), { maxPages: 1 })).toMatchObject({
      pages: 1,
      rows: 1,
      complete: 1,
      failed: 0,
    });
    expect(mocks.emit).toHaveBeenCalledWith(
      'billing.abacatepay.statement_scan',
      expect.objectContaining({
        databaseMs: expect.any(Number),
        providerMs: expect.any(Number),
        pendingPartitions: 0,
      }),
    );
  });
  it('does not credit a page whose fencing token lost the race', async () => {
    const db = database([
      [{ ready: true }],
      [{ id }],
      [claim],
      [{ updated: 0, conflicts: 0, complete: true }],
      backlog,
    ]);
    expect(await advance(db, account, request(), { maxPages: 1 })).toMatchObject({
      pages: 0,
      complete: 0,
      leaseLost: 1,
    });
  });
  it('retains a continuing page without reporting the partition complete', async () => {
    const read = request()
      .mockResolvedValueOnce({ success: true, data: { id: account.accountId } })
      .mockResolvedValueOnce({ ...page, pagination: { hasMore: true, next: 'tran_next' } });
    const db = database([
      [{ ready: true }],
      [{ id }],
      [claim],
      [{ updated: 1, conflicts: 0, complete: false }],
      backlog,
    ]);
    expect(await advance(db, account, read, { maxPages: 1 })).toMatchObject({
      pages: 1,
      complete: 0,
      failed: 0,
    });
  });
  it('refuses a cursor cycle even across separate worker invocations', async () => {
    const read = request()
      .mockResolvedValueOnce({ success: true, data: { id: account.accountId } })
      .mockResolvedValueOnce({ ...page, pagination: { hasMore: true, next: 'tran_next' } });
    const db = database([
      [{ ready: true }],
      [{ id }],
      [
        {
          ...claim,
          after_cursor: 'tran_next',
          seen_cursor_hashes: [createHash('sha256').update('tran_next').digest('hex')],
        },
      ],
      [],
      backlog,
    ]);
    expect((await advance(db, account, read, { maxPages: 1 })).failed).toBe(1);
  });
  it('refuses records outside the selected Brazilian calendar month', async () => {
    const read = request()
      .mockResolvedValueOnce({ success: true, data: { id: account.accountId } })
      .mockResolvedValueOnce({
        ...page,
        data: [{ ...payload, createdAt: '2026-02-10T12:00:00.000Z' }],
      });
    expect(
      (
        await advance(
          database([[{ ready: true }], [{ id }], [claim], [], backlog]),
          account,
          read,
          { maxPages: 1 },
        )
      ).failed,
    ).toBe(1);
  });
  it('alerts identity conflicts without treating them as proof of payment', async () => {
    const db = database([
      [{ ready: true }],
      [{ id }],
      [claim],
      [{ updated: 1, conflicts: 1, complete: true }],
      backlog,
    ]);
    expect((await advance(db, account, request(), { maxPages: 1 })).conflicts).toBe(1);
    expect(mocks.capture).toHaveBeenCalledOnce();
  });
  it('records pagination failure without accepting an empty continuing page', async () => {
    const read = request()
      .mockResolvedValueOnce({ success: true, data: { id: account.accountId } })
      .mockResolvedValueOnce({
        success: true,
        data: [],
        pagination: { hasMore: true, next: 'tran_next' },
      });
    const db = database([[{ ready: true }], [{ id }], [claim], [], backlog]);
    expect((await advance(db, account, read, { maxPages: 1 })).failed).toBe(1);
  });
  it('does not store extra personal fields returned by the provider', async () => {
    const read = request()
      .mockResolvedValueOnce({ success: true, data: { id: account.accountId } })
      .mockResolvedValueOnce({
        ...page,
        data: [{ ...payload, email: 'personal@example.invalid', name: 'Do not store' }],
      });
    const db = database([
      [{ ready: true }],
      [{ id }],
      [claim],
      [{ updated: 1, conflicts: 0, complete: true }],
      backlog,
    ]);
    await advance(db, account, read, { maxPages: 1 });
    const text = JSON.stringify(
      db.statements.map((statement) => new PgDialect().sqlToQuery(statement).params),
    );
    expect(text).not.toContain('personal@example.invalid');
    expect(text).not.toContain('Do not store');
  });
  it('alerts repeated failures and retains no provider response body', async () => {
    const read = request().mockRejectedValue(new GatewayReadError('unavailable'));
    expect(
      (
        await advance(
          database([[{ ready: true }], [{ id }], [{ ...claim, failures: 4 }], [], backlog]),
          account,
          read,
          { maxPages: 1 },
        )
      ).failed,
    ).toBe(1);
    expect(mocks.capture).toHaveBeenCalledOnce();
  });
  it.each([false, true])(
    'fresh complete cache conflict=%s is checked before returning evidence',
    async (conflict) => {
      const db = database([
          [{ ready: true }],
          [{ id }],
          [],
          [{ id }],
          [],
          backlog,
          [{ complete: 1 }],
          [{ payload, conflict }],
        ]),
        read = request();
      const result = reader(db, account)(read, expected);
      if (conflict) await expect(result).rejects.toMatchObject({ code: 'binding_mismatch' });
      else expect((await result)?.paymentId).toBe('char_one');
      expect(read).not.toHaveBeenCalled();
    },
  );
  it('partial cache is deferred rather than reported as no payment', async () => {
    const db = database([
      [{ ready: true }],
      [{ id }],
      [],
      [{ id }],
      [],
      backlog,
      [{ complete: 0 }],
    ]);
    await expect(reader(db, account)(request(), expected)).rejects.toBeInstanceOf(
      AbacatePayStatementScanPending,
    );
  });
});
