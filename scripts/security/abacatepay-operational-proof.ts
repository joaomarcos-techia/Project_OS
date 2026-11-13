/** Real loopback HTTP + Redis + leased application worker + PostgreSQL.
 * The provider is an explicitly synthetic HTTP server, never an external renewal.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import type { ScratchCluster } from './scratch-schema';
import type { RecurringPaymentEvidence } from '../../src/lib/payments/saas/recurring-payment';
import type {
  startOperationalRedis,
  startOperationalDatabaseProxy,
} from './abacatepay-operational-infra';

type Fixture = {
  clinicId: string;
  subscription_id: string;
  eventId: string;
  evidence: RecurringPaymentEvidence;
};
type Worker = (input?: {
  eventId?: string;
  deadlineMs?: number;
}) => Promise<{ applied: number; review: number; scanned: number; retry?: boolean }>;
type Dependencies<F extends Fixture> = {
  sql: ScratchCluster['sql'];
  seed: () => Promise<F>;
  handlerFor: (fixture: F) => typeof fetch;
  notification: (fixture: F) => Request;
  webhook: (request: Request) => Promise<Response>;
  worker: Worker;
  originalFetch: typeof fetch;
  redis: Awaited<ReturnType<typeof startOperationalRedis>>;
  databaseProxy: Awaited<ReturnType<typeof startOperationalDatabaseProxy>>;
};

async function http(handler: (request: Request) => Promise<Response>) {
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of req) {
        length += Buffer.byteLength(chunk);
        assert.ok(length <= 1048576);
        chunks.push(Buffer.from(chunk));
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers))
        if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
      const result = await handler(
        new Request(`http://127.0.0.1${req.url}`, {
          method: req.method ?? 'GET',
          headers,
          ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
        }),
      );
      res.writeHead(result.status, Object.fromEntries(result.headers));
      res.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      res
        .writeHead(503, { 'content-type': 'application/json' })
        .end('{"error":"isolated_handler_failed"}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}`,
    async stop() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] ?? 0;
  return { samples: sorted.length, p50Ms: p(0.5), p95Ms: p(0.95), p99Ms: p(0.99) };
}
async function parallel<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>) {
  let cursor = 0;
  const timings: number[] = [],
    start = performance.now();
  const outcomes = await Promise.allSettled(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        const item = items[index];
        assert.ok(item !== undefined);
        const now = performance.now();
        await task(item);
        timings.push(performance.now() - now);
      }
    }),
  );
  for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
  const elapsedMs = performance.now() - start;
  return {
    ...distribution(timings),
    elapsedMs,
    throughputPerSecond: (items.length * 1000) / elapsedMs,
    concurrency,
  };
}

export async function runAbacatePayOperationalProof<F extends Fixture>(d: Dependencies<F>) {
  const fixtures: F[] = [],
    handlers = new Map<string, typeof fetch>();
  const rows: { createdAt: string }[] = [],
    results: string[] = [],
    runs: unknown[] = [];
  const providerStatuses: Record<string, number> = {},
    receiverStatuses: Record<string, number> = {};
  let mode: 'ok' | 'rate' | 'unavailable' | 'stall' = 'ok',
    blockedRequests = 0,
    providerReads = 0;
  let peakRss = 0,
    peakConnections = 0,
    peakLockWaiters = 0,
    sampleError: unknown;
  const cpuStart = process.cpuUsage(),
    startedAt = new Date().toISOString();
  const provider = await http(async (request) => {
    assert.equal(request.method, 'GET');
    providerReads++;
    if (mode === 'stall') {
      await delay(65000);
      return new Response('{}', { status: 503 });
    }
    if (mode !== 'ok') {
      const status = mode === 'rate' ? 429 : 503;
      providerStatuses[status] = (providerStatuses[status] ?? 0) + 1;
      return new Response('{}', { status, headers: { 'retry-after': '1' } });
    }
    providerStatuses[200] = (providerStatuses[200] ?? 0) + 1;
    const url = new URL(request.url);
    if (url.pathname === '/v2/bank-statement/list') {
      const start = url.searchParams.get('startDate'),
        end = url.searchParams.get('endDate');
      const filtered = rows.filter((row) => {
        const day = new Date(Date.parse(row.createdAt) - 3 * 3600000).toISOString().slice(0, 10);
        return (!start || day >= start) && (!end || day <= end);
      });
      const offset = Number(url.searchParams.get('after')?.replace('cursor_', '') ?? 0);
      const page = filtered.slice(offset, offset + 100),
        next = offset + page.length;
      return Response.json({
        success: true,
        data: page,
        pagination: {
          hasMore: next < filtered.length,
          next: next < filtered.length ? `cursor_${next}` : null,
        },
      });
    }
    const id = url.searchParams.get('id') ?? url.searchParams.get('checkoutId');
    const handler = (id ? handlers.get(id) : undefined) ?? handlers.get('default');
    assert.ok(handler);
    return handler(`https://api.abacatepay.com${url.pathname}${url.search}`, { method: 'GET' });
  });
  const receiver = await http(d.webhook);
  const permitted = new Set([new URL(d.redis.url).origin, receiver.url]);
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (permitted.has(url.origin)) return d.originalFetch(input, init);
    if (url.origin === 'https://api.abacatepay.com')
      return d.originalFetch(new URL(url.pathname + url.search, provider.url), init);
    blockedRequests++;
    throw new Error('External IO forbidden in operational proof');
  };
  let sampling: Promise<unknown> | undefined;
  const timer = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    if (sampling) return;
    sampling = d.sql<
      { connections: number; waiting: number }[]
    >`SELECT count(*)::int connections,count(*) FILTER(WHERE wait_event_type='Lock')::int waiting FROM pg_stat_activity WHERE datname=current_database()`
      .then(([row]) => {
        assert.ok(row);
        peakConnections = Math.max(peakConnections, row.connections);
        peakLockWaiters = Math.max(peakLockWaiters, row.waiting);
      })
      .catch((error: unknown) => {
        sampleError = error;
      })
      .finally(() => {
        sampling = undefined;
      });
  }, 100);
  const seed = async () => {
    const f = await d.seed(),
      handler = d.handlerFor(f);
    for (const id of [
      f.evidence.subscriptionId,
      f.evidence.checkoutId,
      f.evidence.originCheckoutId,
    ])
      handlers.set(id, handler);
    handlers.set('default', handler);
    const statement: unknown = await (
      await handler('https://api.abacatepay.com/v2/bank-statement/list', { method: 'GET' })
    ).json();
    rows.unshift(
      ...z
        .object({ data: z.array(z.object({ createdAt: z.string() }).passthrough()) })
        .parse(statement).data,
    );
    // Controlled cache age for newly introduced synthetic receipts. Financial
    // periods, leases and provider dates are not advanced or rewritten.
    await d.sql`UPDATE billing_gateway.statement_scans SET completed_at=now()-interval '61 seconds' WHERE state='complete'`;
    return f;
  };
  const deliver = async (f: F, invalid = false, timeoutMs = 35000) => {
    const request = d.notification(f),
      url = new URL(request.url);
    const headers = new Headers(request.headers);
    if (invalid) headers.delete('x-webhook-signature');
    const response = await d.originalFetch(receiver.url + url.pathname + url.search, {
      method: 'POST',
      headers,
      body: await request.text(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    receiverStatuses[response.status] = (receiverStatuses[response.status] ?? 0) + 1;
    await response.arrayBuffer();
    return response.status;
  };
  const resetDue = async () => {
    await d.sql`UPDATE billing_gateway.event_inbox SET processed_at=NULL WHERE state='received'`;
  };
  const pending = async () => {
    const [row] =
      await d.sql`SELECT count(*)::int n FROM billing_gateway.event_inbox WHERE state IN ('received','processing')`;
    return Number(row?.n);
  };
  const drain = async (concurrency: number) => {
    const start = performance.now();
    let processed = 0;
    while (await pending()) {
      assert.ok(performance.now() - start < 300000, 'Isolated backlog recovery deadline exceeded');
      const outcomes = await Promise.all(Array.from({ length: concurrency }, () => d.worker()));
      processed += outcomes.reduce((n, result) => n + result.applied, 0);
      if (!outcomes.some((result) => result.scanned)) await delay(250);
    }
    return { elapsedMs: performance.now() - start, applied: processed, remaining: await pending() };
  };
  let interrupted: ReturnType<typeof spawn> | undefined;
  try {
    const auth = await seed();
    assert.equal(await deliver(auth, true), 401);
    results.push('HTTP missing HMAC refused before persistence');
    d.redis.pause();
    assert.equal(await deliver(auth), 503);
    const [persisted] =
      await d.sql`SELECT state FROM billing_gateway.event_inbox WHERE event_id=${auth.eventId}`;
    assert.equal(persisted?.state, 'received');
    d.redis.resume();
    await resetDue();
    assert.equal((await d.worker({ eventId: auth.eventId })).applied, 1);
    assert.equal(await deliver(auth), 200);
    results.push('Real Redis paused/recovered; durable event applied once and duplicate HTTP 200');

    const limited = await seed();
    mode = 'rate';
    assert.equal(await deliver(limited), 503);
    assert.ok(providerStatuses[429]);
    mode = 'ok';
    await delay(1100);
    await resetDue();
    assert.equal((await d.worker({ eventId: limited.eventId })).applied, 1);
    results.push(
      'HTTP provider 429/Retry-After defers inbox; retry recovers without financial duplication',
    );

    const lost = await seed();
    mode = 'stall';
    // Persist using the production HMAC receiver, then kill a real leased worker.
    const { createAbacatePayWebhookHandler } =
      await import('../../src/lib/payments/abacatepay/webhook-handler');
    const { createPostgresGatewayInbox } =
      await import('../../src/lib/payments/saas/postgres-store');
    const { dbAdmin } = await import('../../src/lib/db');
    const account = {
      provider: 'abacatepay',
      environment: 'sandbox',
      accountId: 'store_synthetic',
    } as const;
    const secret = process.env.ABACATEPAY_WEBHOOK_SECRET;
    assert.ok(secret);
    const ingress = createAbacatePayWebhookHandler({
      account,
      expectedSecret: secret,
      inbox: createPostgresGatewayInbox(account, dbAdmin),
      onFailure(reason) {
        assert.fail(`Isolated authenticated ingress failed: ${reason}`);
      },
    });
    assert.equal((await ingress(d.notification(lost))).status, 202);
    interrupted = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        '--conditions=react-server',
        'scripts/security/abacatepay-operational-worker.ts',
        lost.eventId,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, QORO_OPERATIONAL_PROVIDER_URL: provider.url },
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      },
    );
    const waitStarted = Date.now();
    let childFailure = '';
    interrupted.stderr?.on('data', (chunk: Buffer) => {
      if (childFailure.length < 4096) childFailure += chunk.toString('utf8');
    });
    let lease: Date | undefined;
    while (!lease) {
      if (interrupted.exitCode !== null) {
        const safe = childFailure
          .replaceAll(d.redis.token, '[redacted]')
          .replaceAll(secret, '[redacted]');
        await writeFile('dist/operational-child-failure.log', safe);
        assert.fail('Owned worker exited before reservation; isolated diagnostic recorded');
      }
      assert.ok(
        Date.now() - waitStarted < 90000,
        'Owned worker startup/reservation deadline exceeded',
      );
      const [row] =
        await d.sql`SELECT lease_until FROM billing_gateway.event_inbox WHERE event_id=${lost.eventId} AND state='processing'`;
      if (row?.lease_until) lease = new Date(row.lease_until);
      else await delay(100);
    }
    const ownedWorker = interrupted;
    const exited = new Promise<void>((resolve) => ownedWorker.once('exit', () => resolve()));
    ownedWorker.kill();
    await exited;
    interrupted = undefined;
    mode = 'ok';
    const { Redis } = await import('@upstash/redis');
    const { createRedisAbacatePayRequestControl } =
      await import('../../src/lib/payments/abacatepay/request-control');
    const { createAbacatePayReadClient } = await import('../../src/lib/payments/abacatepay/reader');
    const circuitRedis = new Redis({ url: d.redis.url, token: d.redis.token, retry: false });
    const circuit = createRedisAbacatePayRequestControl(
      'store_isolated_circuit',
      (script, keys, args) => circuitRedis.eval(script, keys, args),
    );
    const faultReader = createAbacatePayReadClient({
      apiKey: 'synthetic-loopback-renewal-only',
      environment: 'sandbox',
      requestControl: circuit,
      timeoutMs: 500,
    });
    mode = 'unavailable';
    for (let attempt = 0; attempt < 5; attempt++)
      await assert.rejects(() => faultReader.readStore());
    mode = 'ok';
    const blocked = await circuit.admit();
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterMs > 28000);
    const beforeCircuitRead = providerReads;
    await assert.rejects(() => faultReader.readStore());
    assert.equal(providerReads, beforeCircuitRead);
    results.push(
      'Five actual provider HTTP 503s open the shared Redis circuit; blocked request makes no provider call',
    );

    assert.equal((await d.worker({ eventId: lost.eventId })).applied, 0);
    await delay(Math.max(0, lease.getTime() - Date.now() + 100));
    assert.equal((await d.worker({ eventId: lost.eventId })).applied, 1);
    assert.equal((await circuit.admit()).allowed, true);
    results.push(
      'Owned worker killed after reservation; actual 60-second lease expiry, restart applies once; circuit recovered',
    );

    const offline = await seed();
    d.databaseProxy.pause();
    try {
      const status = await deliver(offline, false, 5000);
      assert.equal(status, 503);
    } catch (error) {
      assert.ok(error instanceof DOMException && error.name === 'TimeoutError');
      results.push('DB network outage: sender timed out without a successful acknowledgment');
    }
    d.databaseProxy.resume();
    const restart = Date.now();
    let recovered = false;
    while (!recovered) {
      assert.ok(Date.now() - restart < 35000, 'DB connection recovery deadline');
      const status = await deliver(offline);
      recovered = status === 202 || status === 200;
      if (!recovered) await delay(250);
    }
    results.push(
      'Actual runtime DB TCP loss fails HTTP closed; redelivery after restored network recovers',
    );

    for (const [size, concurrency] of [
      [100, 1],
      [500, 2],
      [1000, 4],
    ] as const) {
      await parallel(
        Array.from({ length: size - fixtures.length }, (_, i) => i),
        4,
        async () => {
          fixtures.push(await seed());
        },
      );
      const batch = fixtures.slice(0, size);
      const ingressMetrics = await parallel(batch, concurrency, async (f) => {
        const statuses = await Promise.all([deliver(f), deliver(f)]);
        assert.ok(statuses.every((status) => [200, 202, 503].includes(status)));
      });
      const backlog = await pending(),
        recovery = await drain(concurrency);
      const [state] = await d.sql`SELECT count(*)::int clinics,
        (SELECT count(*)::int FROM public.invoices i JOIN public.subscriptions s ON s.id=i.subscription_id WHERE i.clinic_id<>s.clinic_id) crossed,
        (SELECT count(*)::int FROM (SELECT account_id,subscription_id,period_start,count(*) n FROM billing_gateway.recurring_access_periods GROUP BY 1,2,3 HAVING count(*)>1) dup) duplicate_cycles
        FROM public.clinics`;
      assert.ok(state);
      assert.equal(state.crossed, 0);
      assert.equal(state.duplicate_cycles, 0);
      for (const f of batch) {
        const [effect] =
          await d.sql`SELECT (SELECT count(*)::int FROM public.invoices WHERE subscription_id=${f.subscription_id}::uuid) invoices,(SELECT count(*)::int FROM billing_gateway.recurring_access_periods WHERE subscription_id=${f.subscription_id}::uuid) cycles,(SELECT state FROM billing_gateway.event_inbox WHERE event_id=${f.eventId}) state`;
        assert.equal(effect?.invoices, 2);
        assert.equal(effect.cycles, 1);
        assert.equal(effect.state, 'applied');
      }
      runs.push({
        clinics: size,
        concurrency,
        duplicateHttpIngress: ingressMetrics,
        backlog,
        recovery,
        state,
        financialInvariantErrors: 0,
      });
      console.log(JSON.stringify({ stage: 'operational_scale', clinics: size, backlog, recovery }));
    }
    assert.equal(blockedRequests, 0);
    if (sampleError) throw sampleError;
    results.push(
      '100/500/1000 clinics through actual HTTP receiver, Redis admission and leased DB workers',
    );
    const report = {
      status: 'PASS',
      startedAt,
      finishedAt: new Date().toISOString(),
      environment: 'isolated_loopback',
      source: {
        financial: process.env.QORO_FINANCIAL_REF ?? 'working_tree',
        tiss: process.env.QORO_TISS_REF,
      },
      scope:
        'Node HTTP adapter of real receiver and worker; real Docker Redis with local REST bridge; real migrated PostgreSQL; synthetic provider HTTP',
      exclusions: [
        'Not Vercel capacity or production SLA',
        'No external renewal or payment',
        'Sentry delivery reuses prior Preview channel proof; this harness measures application metrics',
      ],
      results,
      runs,
      providerReads,
      providerStatuses,
      receiverStatuses,
      redis: d.redis.stats(),
      blockedRequests,
      peaks: {
        rssBytes: peakRss,
        databaseConnections: peakConnections,
        lockWaiters: peakLockWaiters,
      },
      cpuMicroseconds: process.cpuUsage(cpuStart),
      productionWrites: 0,
    };
    await writeFile(
      'dist/abacatepay-operational-http.json',
      JSON.stringify(report, null, 2) + '\n',
    );
  } finally {
    if (interrupted) interrupted.kill();
    clearInterval(timer);
    await sampling;
    await receiver.stop();
    await provider.stop();
  }
}
