import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { captureBackgroundError } from '@/lib/observability/capture';
import { metrics } from '@/lib/observability/metrics';
import {
  billingAccountSchema,
  GatewayReadError,
  opaqueBillingId,
  parseBillingValue,
} from '@/lib/payments/saas/contracts';
import type { BillingAccount } from '@/lib/payments/saas/contracts';
import type { BillingGatewaySql } from '@/lib/payments/saas/postgres-store';
import {
  cardStatementBrazilDate,
  cardStatementPageSchema,
  cardStatementSchema,
  readApprovedCardStatement,
  RECEIPT_CLOCK_SKEW_MS,
  selectApprovedCardStatement,
  validateCardStatementInput,
  type CardStatementReader,
} from '@/lib/payments/abacatepay/card-statement';
import type { createAbacatePayTransport } from '@/lib/payments/abacatepay/transport';

const FRESH_MS = 60_000;
const FULL_SWEEP_SECONDS = 15 * 60;
const LEASE_SECONDS = 30;
const INLINE_PAGES = 2;
const PAGE_RESERVE_MS = 2000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const storedStatementSchema = cardStatementSchema.extend({
  movements: cardStatementSchema.shape.movements.min(0),
});
const claimSchema = z.object({
  id: z.uuid(),
  account_id: z.uuid(),
  generation: z.uuid(),
  month_start: z.iso.date(),
  after_cursor: opaqueBillingId.nullable(),
  seen_cursor_hashes: z.array(z.string()),
  next_attempt_at: z.coerce.date(),
  started_at: z.coerce.date(),
  failures: z.number().int().nonnegative(),
  refresh_kind: z.enum(['full', 'head']),
});
type Request = ReturnType<typeof createAbacatePayTransport>;
const readyDatabases = new WeakSet<BillingGatewaySql>();

export class AbacatePayStatementScanPending extends GatewayReadError {
  constructor() {
    super('unavailable');
    this.name = 'AbacatePayStatementScanPending';
  }
}

export async function abacatePayStatementScanReady(database: BillingGatewaySql) {
  if (readyDatabases.has(database)) return true;
  const [row] = z
    .array(z.object({ ready: z.boolean() }))
    .max(1)
    .parse(
      await database.execute(sql`
    SELECT to_regclass('billing_gateway.statement_scans') IS NOT NULL
      AND to_regclass('billing_gateway.statement_scan_items') IS NOT NULL ready`),
    );
  if (row?.ready) readyDatabases.add(database);
  return row?.ready === true;
}

async function accountId(database: BillingGatewaySql, accountInput: BillingAccount) {
  const account = billingAccountSchema.parse(accountInput);
  if (account.provider !== 'abacatepay') throw new GatewayReadError('binding_mismatch');
  const [row] = z
    .array(z.object({ id: z.uuid() }))
    .max(1)
    .parse(
      await database.execute(sql`
    SELECT id::text FROM billing_gateway.accounts WHERE provider='abacatepay'
      AND environment=${account.environment} AND external_account_id=${account.accountId}`),
    );
  if (!row) throw new GatewayReadError('binding_mismatch');
  return row.id;
}

function months(start: number, end: number) {
  const first = cardStatementBrazilDate(start - RECEIPT_CLOCK_SKEW_MS).slice(0, 7) + '-01';
  const last = cardStatementBrazilDate(end - 1).slice(0, 7) + '-01';
  const cursor = new Date(first + 'T00:00:00.000Z');
  const result: string[] = [];
  while (cursor.toISOString().slice(0, 10) <= last) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}

async function ensureMonths(database: BillingGatewaySql, id: string, keys: string[]) {
  await database.execute(sql`INSERT INTO billing_gateway.statement_scans(account_id,month_start)
    SELECT ${id}::uuid,value::date FROM jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb)
    ON CONFLICT(account_id,month_start) DO UPDATE SET state='pending',
      generation=CASE WHEN statement_scans.full_completed_at IS NULL OR statement_scans.full_completed_at<now()-make_interval(secs=>${FULL_SWEEP_SECONDS}) THEN gen_random_uuid() ELSE statement_scans.generation END,
      refresh_kind=CASE WHEN statement_scans.full_completed_at IS NULL OR statement_scans.full_completed_at<now()-make_interval(secs=>${FULL_SWEEP_SECONDS}) THEN 'full' ELSE 'head' END,
      after_cursor=NULL,seen_cursor_hashes='{}',pages_scanned=0,rows_scanned=0,completed_at=NULL,
      next_attempt_at=clock_timestamp(),started_at=clock_timestamp(),updated_at=clock_timestamp(),last_error=NULL
    WHERE statement_scans.state='complete' AND statement_scans.completed_at<now()-interval '60 seconds'
      AND statement_scans.lease_token IS NULL`);
}

/** One page is the commit unit. Network IO never holds a database lock. */
export async function advanceAbacatePayStatementScans(
  database: BillingGatewaySql,
  account: BillingAccount,
  request: Request,
  options: { maxPages?: number; deadlineMs?: number; months?: string[] } = {},
) {
  const result = {
    pages: 0,
    rows: 0,
    complete: 0,
    conflicts: 0,
    failed: 0,
    leaseLost: 0,
    deferred: false,
  };
  if (!(await abacatePayStatementScanReady(database))) return result;
  const id = await accountId(database, account);
  const maxPages = z
    .number()
    .int()
    .min(1)
    .max(100)
    .parse(options.maxPages ?? 10);
  const deadline = z
    .number()
    .int()
    .positive()
    .parse(options.deadlineMs ?? Date.now() + 10_000);
  const selected =
    options.months === undefined ? null : z.array(z.iso.date()).min(1).max(3).parse(options.months);
  const started = Date.now();
  let providerMs = 0,
    databaseMs = 0,
    maxQueueAgeMs = 0;
  let sourceVerified = false;
  const timedRequest: Request = async (input) => {
    const before = Date.now();
    try {
      return await request(input);
    } finally {
      providerMs += Date.now() - before;
    }
  };
  const execute = async (statement: SQL) => {
    const before = Date.now();
    try {
      return await database.execute(statement);
    } finally {
      databaseMs += Date.now() - before;
    }
  };
  for (let page = 0; page < maxPages; page++) {
    if (Date.now() + PAGE_RESERVE_MS > deadline) {
      result.deferred = true;
      break;
    }
    const token = randomUUID();
    const [claim] = z
      .array(claimSchema)
      .max(1)
      .parse(
        await execute(sql`
      UPDATE billing_gateway.statement_scans s SET lease_token=${token}::uuid,
        lease_until=clock_timestamp()+make_interval(secs=>${LEASE_SECONDS}),updated_at=clock_timestamp()
      WHERE s.id=(SELECT q.id FROM billing_gateway.statement_scans q WHERE q.account_id=${id}::uuid
        AND q.state='pending' AND q.next_attempt_at<=now() AND (q.lease_until IS NULL OR q.lease_until<now())
        AND (${JSON.stringify(selected)}::jsonb='null'::jsonb OR q.month_start::text IN
          (SELECT jsonb_array_elements_text(${JSON.stringify(selected ?? [])}::jsonb)))
        ORDER BY q.next_attempt_at,q.updated_at,q.month_start,q.id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING s.id::text,s.account_id::text,s.generation::text,s.month_start::text,s.after_cursor,
        s.seen_cursor_hashes,s.next_attempt_at,s.started_at,s.failures,s.refresh_kind`),
      );
    if (!claim) break;
    maxQueueAgeMs = Math.max(maxQueueAgeMs, Date.now() - claim.next_attempt_at.getTime());
    try {
      if (!sourceVerified) {
        const store = parseBillingValue(
          z.object({ success: z.literal(true), data: z.object({ id: opaqueBillingId }) }),
          await timedRequest({ method: 'GET', path: '/stores/get' }),
        );
        if (store.data.id !== account.accountId) throw new GatewayReadError('binding_mismatch');
        sourceVerified = true;
      }
      const monthEnd = new Date(claim.month_start + 'T00:00:00.000Z');
      monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
      monthEnd.setUTCDate(0);
      const params = new URLSearchParams({
        limit: '100',
        method: 'CARD',
        kind: 'CARD_APPROVED',
        status: 'APPROVED',
        startDate: claim.month_start,
        endDate: monthEnd.toISOString().slice(0, 10),
      });
      if (claim.after_cursor) params.set('after', claim.after_cursor);
      const response = parseBillingValue(
        cardStatementPageSchema,
        await timedRequest({ method: 'GET', path: '/bank-statement/list', params }),
      );
      const next = response.pagination.next;
      if (
        (response.pagination.hasMore && response.data.length === 0) ||
        (!response.pagination.hasMore && next !== null) ||
        (response.pagination.hasMore &&
          (next === null || claim.seen_cursor_hashes.includes(hash(next))))
      )
        throw new GatewayReadError('pagination_invalid');
      const seen = new Set<string>();
      const rows = response.data.map((item) => {
        if (seen.has(item.id)) throw new GatewayReadError('pagination_invalid');
        seen.add(item.id);
        if (
          cardStatementBrazilDate(Date.parse(item.createdAt)).slice(0, 7) !==
          claim.month_start.slice(0, 7)
        )
          throw new GatewayReadError('invalid_response');
        // Discard names, email, document numbers and fees. Retain only receipt evidence.
        const payload = {
          ...item,
          createdAt: new Date(item.createdAt).toISOString(),
          customer: item.customer ?? null,
          movements: item.movements.filter((m) => m.kind === 'CARD_APPROVED'),
        };
        return {
          statement_id: item.id,
          checkout_id: item.checkoutId,
          created_at: item.createdAt,
          fingerprint: hash(JSON.stringify(payload)),
          payload,
        };
      });
      const cursorHashes = next
        ? [...claim.seen_cursor_hashes, hash(next)]
        : claim.seen_cursor_hashes;
      const [persisted] = z
        .array(
          z.object({
            updated: z.number().int(),
            conflicts: z.number().int(),
            complete: z.boolean(),
          }),
        )
        .parse(
          await execute(sql`
        WITH lease AS (SELECT id,account_id,generation FROM billing_gateway.statement_scans
          WHERE id=${claim.id}::uuid AND account_id=${id}::uuid AND lease_token=${token}::uuid
            AND lease_until>clock_timestamp() AND generation=${claim.generation}::uuid FOR UPDATE),
        frontier AS (SELECT (NOT ${response.pagination.hasMore} OR (${claim.refresh_kind === 'head'} AND NOT EXISTS(
          SELECT 1 FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r(statement_id text,fingerprint text)
          LEFT JOIN billing_gateway.statement_scan_items i ON i.account_id=${id}::uuid AND i.statement_id=r.statement_id
            AND i.scan_id=${claim.id}::uuid AND i.seen_generation=${claim.generation}::uuid AND i.fingerprint=r.fingerprint
          WHERE i.statement_id IS NULL))) complete),
        items AS (INSERT INTO billing_gateway.statement_scan_items(account_id,statement_id,scan_id,seen_generation,
          checkout_id,statement_created_at,fingerprint,payload)
          SELECT l.account_id,r.statement_id,l.id,l.generation,r.checkout_id,r.created_at,r.fingerprint,r.payload
          FROM lease l CROSS JOIN jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
            AS r(statement_id text,checkout_id text,created_at timestamptz,fingerprint text,payload jsonb)
          ON CONFLICT(account_id,statement_id) DO UPDATE SET
            seen_generation=CASE WHEN statement_scan_items.scan_id=EXCLUDED.scan_id THEN EXCLUDED.seen_generation
              ELSE statement_scan_items.seen_generation END,
            conflict=statement_scan_items.conflict OR statement_scan_items.fingerprint<>EXCLUDED.fingerprint
              OR statement_scan_items.scan_id<>EXCLUDED.scan_id
          RETURNING conflict),
        checkpoint AS (UPDATE billing_gateway.statement_scans s SET after_cursor=CASE WHEN (SELECT complete FROM frontier) THEN NULL ELSE ${next} END,
          seen_cursor_hashes=ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(cursorHashes)}::jsonb)),
          pages_scanned=s.pages_scanned+1,rows_scanned=s.rows_scanned+${rows.length},
          state=CASE WHEN (SELECT complete FROM frontier) THEN 'complete' ELSE 'pending' END,
          completed_at=CASE WHEN (SELECT complete FROM frontier) THEN clock_timestamp() ELSE NULL END,
          full_completed_at=CASE WHEN (SELECT complete FROM frontier) AND s.refresh_kind='full' THEN clock_timestamp() ELSE s.full_completed_at END,
          next_attempt_at=clock_timestamp(),updated_at=clock_timestamp(),lease_token=NULL,lease_until=NULL,
          failures=0,last_error=NULL
          WHERE s.id IN(SELECT id FROM lease) AND (SELECT count(*) FROM items)>=0 RETURNING id)
        SELECT (SELECT count(*)::int FROM checkpoint) updated,(SELECT count(*)::int FROM items WHERE conflict) conflicts,(SELECT complete FROM frontier) complete`),
        );
      if (persisted?.updated !== 1) {
        result.leaseLost++;
        continue;
      }
      result.pages++;
      result.rows += rows.length;
      result.conflicts += persisted.conflicts;
      if (persisted.complete) result.complete++;
    } catch (error) {
      const reason =
        error instanceof GatewayReadError &&
        claim.after_cursor !== null &&
        (error.httpStatus === 400 || error.httpStatus === 404)
          ? 'pagination_invalid'
          : error instanceof GatewayReadError &&
              ['pagination_invalid', 'invalid_response', 'binding_mismatch'].includes(error.code)
            ? error.code
            : 'unavailable';
      const reset = reason === 'pagination_invalid';
      const backoff = Math.min(3600, 5 * 2 ** Math.min(claim.failures, 10));
      await execute(sql`UPDATE billing_gateway.statement_scans SET lease_token=NULL,lease_until=NULL,
        failures=failures+1,last_error=${reason},next_attempt_at=clock_timestamp()+make_interval(secs=>${backoff}),
        updated_at=clock_timestamp(),after_cursor=CASE WHEN ${reset} THEN NULL ELSE after_cursor END,
        seen_cursor_hashes=CASE WHEN ${reset} THEN '{}'::text[] ELSE seen_cursor_hashes END,
        generation=CASE WHEN ${reset} THEN gen_random_uuid() ELSE generation END,
        refresh_kind=CASE WHEN ${reset} THEN 'full' ELSE refresh_kind END,
        pages_scanned=CASE WHEN ${reset} THEN 0 ELSE pages_scanned END,
        rows_scanned=CASE WHEN ${reset} THEN 0 ELSE rows_scanned END,
        started_at=CASE WHEN ${reset} THEN clock_timestamp() ELSE started_at END
        WHERE id=${claim.id}::uuid AND account_id=${id}::uuid AND lease_token=${token}::uuid`);
      result.failed++;
      if (claim.failures >= 4)
        captureBackgroundError(new Error('AbacatePay statement scan needs attention'), {
          flow: 'billing.abacatepay.statement_scan',
        });
    }
  }
  const [backlog] = z
    .array(z.object({ pending: z.number().int(), oldest_ms: z.coerce.number().nonnegative() }))
    .parse(
      await execute(sql`SELECT count(*)::int pending,coalesce(greatest(0,extract(epoch FROM clock_timestamp()-min(started_at))*1000),0) oldest_ms
      FROM billing_gateway.statement_scans WHERE account_id=${id}::uuid AND state='pending'`),
    );
  metrics.emit('billing.abacatepay.statement_scan', {
    ...result,
    processingMs: Date.now() - started,
    providerMs,
    databaseMs,
    maxQueueAgeMs,
    pendingPartitions: backlog?.pending ?? 0,
    oldestPendingMs: backlog?.oldest_ms ?? 0,
  });
  if (result.conflicts)
    captureBackgroundError(new Error('AbacatePay statement identity changed'), {
      flow: 'billing.abacatepay.statement_scan',
    });
  return result;
}

/** All monthly pages must be complete; partial caches never prove payment. */
export function createPersistentAbacatePayStatementReader(
  database: BillingGatewaySql,
  account: BillingAccount,
): CardStatementReader {
  return async (request, raw) => {
    const expected = validateCardStatementInput(raw);
    if (!(await abacatePayStatementScanReady(database)))
      return readApprovedCardStatement(request, expected);
    const id = await accountId(database, account);
    const keys = months(Date.parse(expected.periodStart), Date.parse(expected.periodEnd));
    await ensureMonths(database, id, keys);
    await advanceAbacatePayStatementScans(database, account, request, {
      maxPages: INLINE_PAGES,
      deadlineMs: Date.now() + 6000,
      months: keys,
    });
    const [coverage] = z.array(z.object({ complete: z.number().int() })).parse(
      await database.execute(sql`
      SELECT count(*)::int complete FROM billing_gateway.statement_scans WHERE account_id=${id}::uuid
        AND month_start::text IN(SELECT jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb))
        AND state='complete' AND completed_at>=now()-make_interval(secs=>${FRESH_MS / 1000})`),
    );
    if (coverage?.complete !== keys.length) throw new AbacatePayStatementScanPending();
    const rows = z.array(z.object({ payload: storedStatementSchema, conflict: z.boolean() })).parse(
      await database.execute(sql`
      SELECT i.payload,i.conflict FROM billing_gateway.statement_scan_items i
      JOIN billing_gateway.statement_scans s ON s.id=i.scan_id AND s.account_id=i.account_id
        AND s.generation=i.seen_generation AND s.state='complete'
      WHERE i.account_id=${id}::uuid AND i.checkout_id=${expected.checkoutId}
        AND s.month_start::text IN(SELECT jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb))
        AND i.statement_created_at>=${expected.periodStart}::timestamptz-interval '60 seconds'
        AND i.statement_created_at<${expected.periodEnd}::timestamptz
        AND i.statement_created_at<=s.started_at
      ORDER BY i.statement_created_at,i.statement_id`),
    );
    if (rows.some((row) => row.conflict)) throw new GatewayReadError('binding_mismatch');
    return selectApprovedCardStatement(
      rows.map((row) => row.payload),
      expected,
    );
  };
}
