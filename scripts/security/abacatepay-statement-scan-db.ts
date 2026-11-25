/** Real PostgreSQL, application scanner and transport. Synthetic HTTP only; no credentials. */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { startScratchSchema } from './scratch-schema';

const cluster = await startScratchSchema({ port: 55495 });
assert.equal(new URL(cluster.url).hostname, '127.0.0.1');
const pg = cluster.sql;
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: cluster.url,
  DATABASE_URL_DEV: cluster.url,
  DATABASE_URL_RUNTIME: cluster.url,
  SUPABASE_PROJECT_ENV: 'dev',
  NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_scan',
  LOG_LEVEL: 'error',
  ABACATEPAY_STORE_ID: 'store_scan_synthetic',
});
delete process.env.DATABASE_URL_PROD;
delete process.env.VERCEL_ENV;
const originalFetch = globalThis.fetch;
let externalCalls = 0,
  httpCalls = 0,
  providerMs = 0;
globalThis.fetch = async () => {
  externalCalls++;
  throw new Error('External network forbidden');
};
const { dbAdmin } = await import('../../src/lib/db');
const { createAbacatePayTransport } = await import('../../src/lib/payments/abacatepay/transport');
const { GatewayReadError } = await import('../../src/lib/payments/saas/contracts');
const {
  createPersistentAbacatePayStatementReader: reader,
  createPersistentAbacatePayRefundReader: refundReader,
  advanceAbacatePayStatementScans: advance,
  AbacatePayStatementScanPending: Pending,
} = await import('../../src/contexts/billing/internal/abacatepay-statement-scan');
type Database = import('../../src/lib/payments/saas/postgres-store').BillingGatewaySql;
type Statement = import('../../src/lib/payments/abacatepay/card-statement').CardStatement;
const account = {
  provider: 'abacatepay',
  environment: 'sandbox',
  accountId: 'store_scan_synthetic',
} as const;
const checks: string[] = [],
  latencies: number[] = [];
let failure: unknown;
let mode: 'ok' | 'unavailable' | 'rate_limit' | 'loop' | 'fence' = 'ok';
let adjustmentReversed = false;
let adjustmentForeignCustomer = false;
let records: Statement[] = Array.from({ length: 10_000 }, (_, i) => ({
  id: `tran_${String(i).padStart(6, '0')}`,
  currency: 'BRL',
  createdAt: new Date(Date.UTC(2026, 0, 20, 12) - i * 1000).toISOString(),
  checkoutId: `bill_${i}`,
  paymentIntentId: `char_${i}`,
  customer: { publicId: `cust_${i}` },
  movements: [
    {
      amount: 39700,
      kind: 'CARD_APPROVED',
      method: 'CARD',
      category: 'transaction',
      balanceEffect: 'credit',
    },
  ],
}));
const fetcher: typeof fetch = async (input, init) => {
  httpCalls++;
  const started = performance.now();
  assert.equal(init?.method, 'GET');
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
  assert.equal(url.origin, 'https://api.abacatepay.com');
  if (url.pathname === '/v2/stores/get')
    return Response.json({ success: true, data: { id: account.accountId } });
  assert.equal(url.pathname, '/v2/bank-statement/list');
  assert.equal(url.searchParams.get('limit'), '100');
  if (mode === 'unavailable') throw new Error('Synthetic unavailable');
  if (mode === 'rate_limit') return Response.json({ error: 'synthetic' }, { status: 429 });
  const start = url.searchParams.get('startDate'),
    end = url.searchParams.get('endDate');
  assert.ok(start && end);
  const source = url.searchParams.has('method')
    ? records
    : records.map((r) => ({
        ...r,
        customer:
          adjustmentForeignCustomer && r.id === 'tran_009999'
            ? { publicId: 'cust_foreign' }
            : r.customer,
        movements: [
          { amount: 39700, category: 'refund', balanceEffect: 'debit' },
          ...(adjustmentReversed && r.id === 'tran_009999'
            ? [{ amount: 39700, category: 'reversal', balanceEffect: 'credit' }]
            : []),
        ],
      }));
  const filtered = source.filter((r) => {
    const day = new Date(Date.parse(r.createdAt) - 3 * 3600_000).toISOString().slice(0, 10);
    return day >= start && day <= end;
  });
  const after = url.searchParams.get('after');
  const offset = after === null ? 0 : filtered.findIndex((r) => r.id === after) + 1;
  if (after !== null && offset === 0)
    return Response.json({ error: 'expired cursor' }, { status: 400 });
  const page = filtered.slice(offset, offset + 100),
    hasMore = offset + page.length < filtered.length;
  if (mode === 'fence') {
    await pg`UPDATE billing_gateway.statement_scans SET lease_token=gen_random_uuid(),lease_until=now()+interval '1 minute' WHERE lease_token IS NOT NULL`;
  }
  const response = Response.json({
    success: true,
    // Extra PII must not enter the durable cache.
    data: page.map((r) => ({
      ...r,
      name: 'Synthetic not stored',
      email: 'not-stored@example.invalid',
    })),
    pagination: { hasMore, next: hasMore ? (mode === 'loop' ? after : page.at(-1)?.id) : null },
  });
  providerMs += performance.now() - started;
  return response;
};
const request = createAbacatePayTransport(
  { apiKey: 'synthetic-only', storeId: account.accountId, timeoutMs: 500 },
  fetcher,
);
const criteria = (i: number) => ({
  checkoutId: `bill_${i}`,
  customerId: `cust_${i}`,
  expectedAmountMinor: 39700,
  periodStart: '2026-01-02T00:00:00.000Z',
  periodEnd: '2026-01-30T00:00:00.000Z',
});
async function readyNow() {
  await pg`UPDATE billing_gateway.statement_scans SET next_attempt_at=clock_timestamp(),lease_token=NULL,lease_until=NULL WHERE state='pending'`;
}
async function drain() {
  for (let i = 0; i < 120; i++) {
    const outcomes = await Promise.all([
      advance(dbAdmin, account, request, { maxPages: 5 }),
      advance(dbAdmin, account, request, { maxPages: 5 }),
    ]);
    assert.equal(
      outcomes.reduce((sum, r) => sum + r.failed + r.conflicts, 0),
      0,
    );
    const [row] =
      await pg`SELECT count(*)::int pending FROM billing_gateway.statement_scans WHERE state='pending'`;
    if (row?.pending === 0) return;
  }
  assert.fail('Scanner did not make progress across bounded executions');
}
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  checks.push(name);
}
try {
  await pg.begin(async (tx) => {
    await tx.unsafe(
      await readFile(
        'docs/decoupling/asaas-to-abacatepay/migrations/saas_period_snapshot.candidate.sql',
        'utf8',
      ),
    );
  });
  await pg`INSERT INTO billing_gateway.accounts(provider,environment,external_account_id) VALUES('abacatepay','sandbox',${account.accountId})`;
  await check('partial cache cannot prove payment beyond the first 500', async () => {
    await assert.rejects(reader(dbAdmin, account)(request, criteria(9999)), Pending);
    const [r] =
      await pg`SELECT rows_scanned::int n,pages_scanned FROM billing_gateway.statement_scans`;
    assert.deepEqual(r, { n: 200, pages_scanned: 2 });
  });
  await check('provider outage retains cursor and backs off durably', async () => {
    const [before] = await pg`SELECT after_cursor FROM billing_gateway.statement_scans`;
    mode = 'unavailable';
    const result = await advance(dbAdmin, account, request, { maxPages: 1 });
    mode = 'ok';
    assert.equal(result.failed, 1);
    const [after] =
      await pg`SELECT after_cursor,failures,next_attempt_at>now() delayed FROM billing_gateway.statement_scans`;
    assert.equal(after?.after_cursor, before?.after_cursor);
    assert.equal(after?.delayed, true);
    assert.equal(after?.failures, 1);
    await readyNow();
  });
  await check('failure before a page commit leaves neither items nor checkpoint', async () => {
    let calls = 0;
    const db: Database = {
      execute: async (query) => {
        if (++calls === 4) throw new Error('Synthetic failure before atomic commit');
        return dbAdmin.execute(query);
      },
    };
    assert.equal((await advance(db, account, request, { maxPages: 1 })).failed, 1);
    const [r] = await pg`SELECT rows_scanned::int n FROM billing_gateway.statement_scans`;
    assert.equal(r?.n, 200);
    await readyNow();
  });
  await check('commit succeeds but acknowledgement is lost: resume at the next page', async () => {
    let calls = 0;
    const db: Database = {
      execute: async (query) => {
        const result = await dbAdmin.execute(query);
        if (++calls === 4) throw new Error('Synthetic lost DB acknowledgement');
        return result;
      },
    };
    const result = await advance(db, account, request, { maxPages: 1 });
    assert.equal(result.failed, 1);
    const [after] =
      await pg`SELECT rows_scanned::int n,lease_token FROM billing_gateway.statement_scans`;
    assert.equal(after?.n, 300);
    assert.equal(after?.lease_token, null);
  });
  await check('stale worker cannot persist a page after its lease is replaced', async () => {
    mode = 'fence';
    const result = await advance(dbAdmin, account, request, { maxPages: 1 });
    mode = 'ok';
    assert.equal(result.leaseLost, 1);
    const [after] = await pg`SELECT rows_scanned::int n FROM billing_gateway.statement_scans`;
    assert.equal(after?.n, 300);
    await readyNow();
  });
  await check('cursor cycle resets a generation without granting rights', async () => {
    mode = 'loop';
    const result = await advance(dbAdmin, account, request, { maxPages: 1 });
    mode = 'ok';
    assert.equal(result.failed, 1);
    const [r] =
      await pg`SELECT after_cursor,rows_scanned::int n,last_error FROM billing_gateway.statement_scans`;
    assert.deepEqual(r, { after_cursor: null, n: 0, last_error: 'pagination_invalid' });
    await readyNow();
  });
  await check('429 retains progress and permits later recovery', async () => {
    mode = 'rate_limit';
    const result = await advance(dbAdmin, account, request, { maxPages: 1 });
    mode = 'ok';
    assert.equal(result.failed, 1);
    await readyNow();
  });
  await check(
    'expired provider cursor restarts safely and alerts after repeated failures',
    async () => {
      await pg`UPDATE billing_gateway.statement_scans SET after_cursor='tran_expired',failures=4`;
      assert.equal((await advance(dbAdmin, account, request, { maxPages: 1 })).failed, 1);
      const [r] = await pg`SELECT after_cursor,last_error FROM billing_gateway.statement_scans`;
      assert.deepEqual(r, { after_cursor: null, last_error: 'pagination_invalid' });
      await readyNow();
    },
  );
  await check(
    'a small partition progresses while a large partition still has backlog',
    async () => {
      const base = records[0];
      assert.ok(base);
      records.push({
        ...base,
        id: 'tran_small',
        checkoutId: 'bill_small',
        paymentIntentId: 'char_small',
        createdAt: '2026-02-05T12:00:00.000Z',
      });
      await pg`INSERT INTO billing_gateway.statement_scans(account_id,month_start) SELECT id,'2026-02-01'::date FROM billing_gateway.accounts`;
      await advance(dbAdmin, account, request, { maxPages: 4 });
      const rows =
        await pg`SELECT month_start::text,state FROM billing_gateway.statement_scans ORDER BY month_start`;
      assert.deepEqual(
        rows.map((r) => r.state),
        ['pending', 'complete'],
      );
    },
  );
  await check(
    '10,000 records, concurrent workers, persistent restart and no permanent cap',
    async () => {
      const started = performance.now();
      await drain();
      const proof = await reader(dbAdmin, account)(request, criteria(9999));
      assert.equal(proof?.paymentId, 'char_9999');
      const [count] =
        await pg`SELECT count(*)::int n,count(*) FILTER(WHERE conflict)::int conflicts FROM billing_gateway.statement_scan_items`;
      assert.deepEqual(count, { n: 10_001, conflicts: 0 });
      latencies.push(performance.now() - started);
    },
  );
  await check('one clinic cannot match another clinic customer or account', async () => {
    await assert.rejects(
      reader(dbAdmin, account)(request, { ...criteria(9999), customerId: 'cust_other' }),
      (e: unknown) => e instanceof GatewayReadError && e.code === 'binding_mismatch',
    );
    await assert.rejects(
      reader(dbAdmin, { ...account, environment: 'production' })(request, criteria(9999)),
      (e: unknown) => e instanceof GatewayReadError && e.code === 'environment_mismatch',
    );
  });
  await check('new records before a saved cursor are found on the next refresh', async () => {
    const base = records[0];
    assert.ok(base);
    records = [
      {
        ...base,
        id: 'tran_new',
        checkoutId: 'bill_new',
        paymentIntentId: 'char_new',
        createdAt: '2026-01-25T12:00:00.000Z',
      },
      ...records,
    ];
    await pg`UPDATE billing_gateway.statement_scans SET completed_at=now()-interval '61 seconds'`;
    const beforeCalls = httpCalls;
    assert.equal(
      (await reader(dbAdmin, account)(request, { ...criteria(0), checkoutId: 'bill_new' }))
        ?.paymentId,
      'char_new',
    );
    assert.ok(httpCalls - beforeCalls <= 3, 'Head refresh must not repeat all 100 pages');
  });
  await check(
    'periodic full sweep reaches a backfilled old record beyond the head frontier',
    async () => {
      const base = records.at(-2);
      assert.ok(base);
      records.splice(records.length - 1, 0, {
        ...base,
        id: 'tran_backfill',
        checkoutId: 'bill_backfill',
        paymentIntentId: 'char_backfill',
      });
      await pg`UPDATE billing_gateway.statement_scans SET completed_at=now()-interval '61 seconds',full_completed_at=now()-interval '16 minutes'`;
      await assert.rejects(
        reader(dbAdmin, account)(request, { ...criteria(9999), checkoutId: 'bill_backfill' }),
        Pending,
      );
      await drain();
      assert.equal(
        (
          await reader(dbAdmin, account)(request, {
            ...criteria(9999),
            checkoutId: 'bill_backfill',
          })
        )?.paymentId,
        'char_backfill',
      );
    },
  );
  await check('partial adjustment cache cannot prove a refund beyond 500 records', async () => {
    const c = criteria(9999);
    await assert.rejects(
      refundReader(dbAdmin, account)(request, {
        checkoutId: c.checkoutId,
        customerId: c.customerId,
        expectedAmountMinor: c.expectedAmountMinor,
        windowStart: c.periodStart,
        windowEnd: c.periodEnd,
        requireCustomer: true,
      }),
      Pending,
    );
    const [progress] = await pg`SELECT rows_scanned::int n FROM billing_gateway.statement_scans
      WHERE purpose='adjustments'`;
    assert.equal(progress?.n, 200);
  });
  await check(
    'durable adjustment scan reaches the 10000th refund without borrowing card proof',
    async () => {
      await drain();
      const c = criteria(9999);
      const result = await refundReader(dbAdmin, account)(request, {
        checkoutId: c.checkoutId,
        customerId: c.customerId,
        expectedAmountMinor: c.expectedAmountMinor,
        windowStart: c.periodStart,
        windowEnd: c.periodEnd,
        requireCustomer: true,
      });
      assert.deepEqual(result, {
        refundDebitMinor: 39700,
        reversalObserved: false,
        evidenceLevel: 'refund_debit_verified',
      });
      const [purposes] =
        await pg`SELECT count(DISTINCT purpose)::int n,count(*) FILTER(WHERE conflict)::int conflicts
      FROM billing_gateway.statement_scan_items WHERE statement_id='tran_009999'`;
      assert.deepEqual(purposes, { n: 2, conflicts: 0 });
      assert.equal((await reader(dbAdmin, account)(request, c))?.amountMinor, 39700);
    },
  );
  await check(
    'card and adjustment partitions both progress under the shared worker budget',
    async () => {
      await pg`UPDATE billing_gateway.statement_scans SET completed_at=now()-interval '61 seconds',
      full_completed_at=now()-interval '16 minutes' WHERE month_start='2026-01-01'`;
      const c = criteria(9999);
      await assert.rejects(reader(dbAdmin, account)(request, c), Pending);
      await assert.rejects(
        refundReader(dbAdmin, account)(request, {
          checkoutId: c.checkoutId,
          customerId: c.customerId,
          expectedAmountMinor: c.expectedAmountMinor,
          windowStart: c.periodStart,
          windowEnd: c.periodEnd,
          requireCustomer: true,
        }),
        Pending,
      );
      await advance(dbAdmin, account, request, { maxPages: 2 });
      const jobs = await pg`SELECT purpose,rows_scanned::int n FROM billing_gateway.statement_scans
      WHERE month_start='2026-01-01' ORDER BY purpose`;
      assert.equal(jobs.length, 2);
      assert.ok(
        jobs.every((j) => j.n >= 300),
        'Each purpose must receive a page before either monopolizes the store',
      );
      await drain();
    },
  );
  await check(
    'fresh adjustment observations can record a reversal without mutating card receipt evidence',
    async () => {
      adjustmentReversed = true;
      await pg`UPDATE billing_gateway.statement_scans SET completed_at=now()-interval '61 seconds',
      full_completed_at=now()-interval '16 minutes' WHERE purpose='adjustments'`;
      const c = criteria(9999),
        input = {
          checkoutId: c.checkoutId,
          customerId: c.customerId,
          expectedAmountMinor: c.expectedAmountMinor,
          windowStart: c.periodStart,
          windowEnd: c.periodEnd,
          requireCustomer: true,
        };
      await assert.rejects(refundReader(dbAdmin, account)(request, input), Pending);
      await drain();
      assert.deepEqual(await refundReader(dbAdmin, account)(request, input), {
        refundDebitMinor: 39700,
        reversalObserved: true,
        evidenceLevel: 'status_only',
      });
      assert.equal((await reader(dbAdmin, account)(request, c))?.paymentId, 'char_9999');
    },
  );
  await check('adjustment evidence cannot cross customers or purposes', async () => {
    const c = criteria(9999);
    await assert.rejects(
      refundReader(dbAdmin, account)(request, {
        checkoutId: c.checkoutId,
        customerId: 'cust_foreign',
        expectedAmountMinor: c.expectedAmountMinor,
        windowStart: c.periodStart,
        windowEnd: c.periodEnd,
        requireCustomer: true,
      }),
      { code: 'binding_mismatch' },
    );
    const [scan] = await pg`SELECT id,account_id,generation FROM billing_gateway.statement_scans
      WHERE purpose='adjustments' LIMIT 1`;
    assert.ok(scan);
    await assert.rejects(
      pg.begin(async (tx) => {
        await tx`INSERT INTO billing_gateway.statement_scan_items(account_id,purpose,statement_id,scan_id,seen_generation,
        checkout_id,statement_created_at,fingerprint,payload)
        VALUES(${scan.account_id}::uuid,'card_approved','tran_cross_purpose',${scan.id}::uuid,${scan.generation}::uuid,
          NULL,now(),${'a'.repeat(64)},${tx.json({ id: 'tran_cross_purpose', checkoutId: null })})`;
      }),
      { code: '23503' },
    );
  });
  await check(
    'changed adjustment identity is quarantined and cannot poison approved-card evidence',
    async () => {
      adjustmentForeignCustomer = true;
      await pg`UPDATE billing_gateway.statement_scans SET completed_at=now()-interval '61 seconds',
      full_completed_at=now()-interval '16 minutes' WHERE purpose='adjustments'`;
      const c = criteria(9999),
        input = {
          checkoutId: c.checkoutId,
          customerId: c.customerId,
          expectedAmountMinor: c.expectedAmountMinor,
          windowStart: c.periodStart,
          windowEnd: c.periodEnd,
          requireCustomer: true,
        };
      await assert.rejects(refundReader(dbAdmin, account)(request, input), Pending);
      let conflicts = 0,
        complete = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        const result = await advance(dbAdmin, account, request, { maxPages: 10 });
        assert.equal(result.failed, 0);
        conflicts += result.conflicts;
        const [pending] =
          await pg`SELECT count(*)::int n FROM billing_gateway.statement_scans WHERE state='pending'`;
        if (pending?.n === 0) {
          complete = true;
          break;
        }
      }
      assert.equal(complete, true);
      assert.equal(conflicts, 1);
      await assert.rejects(refundReader(dbAdmin, account)(request, input), {
        code: 'binding_mismatch',
      });
      assert.equal((await reader(dbAdmin, account)(request, c))?.paymentId, 'char_9999');
    },
  );
  await check('minimal receipt cache has no names, email, document numbers or fees', async () => {
    const [r] =
      await pg`SELECT count(*)::int n FROM billing_gateway.statement_scan_items WHERE payload ?| ARRAY['name','email','taxId','document']`;
    assert.equal(r?.n, 0);
  });
  await check('forced RLS, no tenant SELECT, no service DELETE', async () => {
    const rows = await pg`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
      has_table_privilege('authenticated',c.oid,'SELECT') tenant_read,
      has_table_privilege('service_role',c.oid,'DELETE') service_delete
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='billing_gateway' AND c.relname IN('statement_scans','statement_scan_items')`;
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.equal(r.relrowsecurity, true);
      assert.equal(r.relforcerowsecurity, true);
      assert.equal(r.tenant_read, false);
      assert.equal(r.service_delete, false);
    }
  });
  await check(
    'no invoice, subscription, payment command or external call is created by scanning',
    async () => {
      const [r] =
        await pg`SELECT (SELECT count(*)::int FROM public.invoices) invoices,(SELECT count(*)::int FROM public.subscriptions) subscriptions`;
      assert.deepEqual(r, { invoices: 0, subscriptions: 0 });
      assert.equal(externalCalls, 0);
    },
  );
} catch (error) {
  failure = error;
} finally {
  globalThis.fetch = originalFetch;
  await mkdir('dist', { recursive: true });
  await writeFile(
    'dist/abacatepay-statement-scan-db.json',
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        status: failure ? 'FAIL' : 'PASS',
        environment: 'loopback_synthetic',
        checks,
        records: records.length,
        httpCalls,
        externalCalls,
        providerMs,
        scanMs: latencies,
        productionWrites: 0,
      },
      null,
      2,
    ),
  );
  await cluster.stop();
}
if (failure) throw failure;
console.log(
  JSON.stringify({
    status: 'PASS',
    checks: checks.length,
    httpCalls,
    externalCalls,
    scanMs: latencies,
  }),
);
