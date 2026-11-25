/** Isolated DB load. Provider evidence is synthetic; never a provider capacity claim. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import type { ScratchCluster } from './scratch-schema';

type Fixture = { clinicId: string; subscription_id: string; eventId: string };
const concurrency = Number(process.env.QORO_ABACATEPAY_SCALE_CONCURRENCY ?? 32);
assert.ok(
  Number.isSafeInteger(concurrency) && concurrency >= 1 && concurrency <= 64,
  'Synthetic load concurrency must be an integer between 1 and 64',
);
type Dependencies<F extends Fixture> = {
  sql: ScratchCluster['sql'];
  seed: () => Promise<F>;
  accept: (fixture: F) => Promise<void>;
  apply: (fixture: F) => Promise<string>;
  applicationTimings: { connectionAdmissionMs: number; transactionMs: number }[];
  explainBinding: () => Promise<unknown>;
};

async function concurrent<T>(items: T[], work: (item: T) => Promise<void>) {
  let cursor = 0;
  const latency: number[] = [];
  const started = performance.now();
  const completed = await Promise.allSettled(
    Array.from({ length: concurrency }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        assert.ok(item !== undefined);
        const start = performance.now();
        await work(item);
        latency.push(performance.now() - start);
      }
    }),
  );
  const failed = completed.find((r) => r.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  latency.sort((a, b) => a - b);
  const elapsedMs = performance.now() - started;
  const percentile = (p: number) =>
    latency[Math.min(latency.length - 1, Math.ceil(latency.length * p) - 1)] ?? 0;
  return {
    count: items.length,
    concurrency,
    elapsedMs,
    throughputPerSecond: (items.length / elapsedMs) * 1000,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    errors: 0,
  };
}

export async function runAbacatePayScaleProof<F extends Fixture>({
  sql,
  seed,
  accept,
  apply,
  applicationTimings,
  explainBinding,
}: Dependencies<F>) {
  const fixtures: F[] = [];
  const runs: Record<string, unknown>[] = [];
  let connections = 0,
    waitingLocks = 0,
    rss = 0,
    sampling = false;
  let sample: Promise<void> = Promise.resolve();
  let sampleError: unknown;
  const timer = setInterval(() => {
    rss = Math.max(rss, process.memoryUsage().rss);
    if (sampling) return;
    sampling = true;
    sample = sql<{ connections: number; waiting: number }[]>`SELECT count(*)::int connections,
      count(*) FILTER (WHERE wait_event_type='Lock')::int waiting FROM pg_stat_activity WHERE datname=current_database()`
      .then(([row]) => {
        if (row) {
          connections = Math.max(connections, row.connections);
          waitingLocks = Math.max(waitingLocks, row.waiting);
        }
      })
      .catch((error: unknown) => {
        sampleError = error;
      })
      .finally(() => {
        sampling = false;
      });
  }, 100);
  try {
    for (const size of [100, 500, 1000]) {
      const provision = await concurrent(
        Array.from({ length: size - fixtures.length }, (_, i) => i),
        async () => {
          fixtures.push(await seed());
        },
      );
      const batch = fixtures.slice(0, size);
      // A duplicate delivery racing the original must persist one event only.
      const ingress = await concurrent(batch, async (f) => {
        await Promise.all([accept(f), accept(f)]);
      });
      const processing = await concurrent(batch, async (f) => {
        const outcomes = await Promise.all([apply(f), apply(f)]);
        assert.ok(outcomes.every((v) => v === 'applied' || v === 'duplicate'));
        assert.ok(outcomes.filter((v) => v === 'applied').length <= 1);
      });
      const values = applicationTimings.splice(0);
      const timing = (key: 'connectionAdmissionMs' | 'transactionMs') => {
        const sorted = values.map((v) => v[key]).sort((a, b) => a - b);
        const percentile = (p: number) =>
          sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0;
        return {
          samples: sorted.length,
          p50Ms: percentile(0.5),
          p95Ms: percentile(0.95),
          p99Ms: percentile(0.99),
        };
      };
      const [state] = await sql`SELECT (SELECT count(*)::int FROM public.clinics) clinics,
        (SELECT count(*)::int FROM public.invoices) invoices,
        (SELECT count(*)::int FROM billing_gateway.recurring_access_periods) cycles,
        (SELECT count(*)::int FROM billing_gateway.event_inbox) inbox,
        (SELECT count(*)::int FROM public.trial_access_policies WHERE released_by_invoice_id IS NULL) unpaid,
        (SELECT count(*)::int FROM public.invoices i JOIN public.subscriptions s ON s.id=i.subscription_id WHERE i.clinic_id<>s.clinic_id) crossed`;
      assert.ok(state);
      assert.equal(state.clinics, size);
      assert.equal(state.invoices, size * 2);
      assert.equal(state.cycles, size);
      assert.equal(state.inbox, size);
      assert.equal(state.unpaid, 0);
      assert.equal(state.crossed, 0);
      runs.push({
        clinics: size,
        provision,
        duplicateIngress: ingress,
        duplicateRenewalApplication: processing,
        stages: {
          connectionAdmission: timing('connectionAdmissionMs'),
          transactionThroughCommit: timing('transactionMs'),
          note: 'Admission includes pool wait and BEGIN. Transaction includes SQL, lock wait and COMMIT. Provider HTTP and HTTP receiver are not exercised in this domain load.',
        },
        state,
      });
    }
    await sql`ANALYZE billing_gateway.event_inbox`;
    const plan =
      await sql`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT event_id FROM billing_gateway.event_inbox
      WHERE state='received' AND (processed_at IS NULL OR processed_at<now()-interval '1 hour')
      ORDER BY received_at LIMIT 1 FOR UPDATE SKIP LOCKED`;
    const [stats] =
      await sql`SELECT deadlocks,temp_bytes,xact_rollback FROM pg_stat_database WHERE datname=current_database()`;
    if (sampleError) throw sampleError;
    assert.ok(stats);
    assert.equal(Number(stats.deadlocks), 0);
    const report = {
      observedAt: new Date().toISOString(),
      status: 'PASS',
      environment: 'loopback_synthetic',
      scope:
        'Real provision, inbox dedup and atomic renewal domain services, production migrations plus pinned TISS and financial candidate',
      exclusions: [
        'No provider HTTP load',
        'No production or shared DEV',
        'No scheduler throughput claim',
        'No first external payment claim',
      ],
      targets: {
        invariantErrors: 0,
        deadlocks: 0,
        p95DiagnosticMs: 2000,
        note: 'Local diagnostic target, not a production SLA',
      },
      peaks: { databaseConnections: connections, waitingLocks, nodeRssBytes: rss },
      databaseStats: stats,
      inboxPlan: plan,
      renewalBindingPlan: await explainBinding(),
      runs,
      queueNote:
        'Inbox is retained received: this harness applies the domain seam directly, not the HTTP/leased worker. Worker recovery is proved separately.',
      externalRequests: 0,
    };
    await writeFile('dist/abacatepay-scale-db.json', JSON.stringify(report, null, 2) + '\n');
    await writeFile(
      `dist/abacatepay-scale-concurrency-${concurrency}-db.json`,
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(
      JSON.stringify({
        status: 'PASS',
        clinics: 1000,
        peaks: report.peaks,
        runs: runs.map((r) => ({ clinics: r.clinics, processing: r.duplicateRenewalApplication })),
      }),
    );
  } finally {
    clearInterval(timer);
    await sample;
  }
}
