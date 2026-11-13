/** Owned child process used only for a real interruption/lease recovery proof. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
assert.equal(process.env.QORO_ABACATEPAY_OPERATIONAL, '1');
assert.equal(new URL(process.env.DATABASE_URL ?? '').hostname, '127.0.0.1');
assert.equal(process.env.ABACATEPAY_ENVIRONMENT, 'sandbox');
assert.ok(
  process.env.ABACATEPAY_API_KEY === 'synthetic-loopback-renewal-only',
  'Operational worker requires synthetic credentials',
);
const provider = new URL(process.env.QORO_OPERATIONAL_PROVIDER_URL ?? '');
assert.equal(provider.hostname, '127.0.0.1');
const redis = new URL(process.env.UPSTASH_REDIS_REST_URL ?? '');
assert.equal(redis.hostname, '127.0.0.1');
const original = globalThis.fetch;
const reads: { path: string; status: number | null }[] = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  try {
    let response: Response;
    if (url.origin === redis.origin) response = await original(input, init);
    else {
      assert.equal(url.origin, 'https://api.abacatepay.com');
      response = await original(new URL(url.pathname + url.search, provider), init);
    }
    reads.push({
      path: url.origin === redis.origin ? 'redis' : url.pathname,
      status: response.status,
    });
    return response;
  } catch (error) {
    reads.push({ path: url.origin === redis.origin ? 'redis' : url.pathname, status: null });
    throw error;
  }
};
const { reconcileAbacatePayInbox, reconcileAbacatePayInboxTick } =
  await import('../../src/contexts/billing/internal/abacatepay-processing');
const eventId = process.argv[2];
assert.ok(eventId);
if (eventId === '--tick') {
  const { metrics } = await import('../../src/lib/observability/metrics');
  const emit = metrics.emit;
  const failures: { code: string; reason: string }[] = [];
  metrics.emit = (name: string, fields: Record<string, unknown> = {}) => {
    if (name === 'billing.abacatepay.reconcile_failed')
      failures.push({
        code: typeof fields.code === 'string' ? fields.code : 'unknown',
        reason: typeof fields.reason === 'string' ? fields.reason : 'unknown',
      });
    emit(name, fields);
  };
  console.log(JSON.stringify({ kind: 'qoro_operational_worker_ready' }));
  const result = await reconcileAbacatePayInboxTick();
  await writeFile(
    `dist/abacatepay-pilot-worker-${process.pid}.json`,
    JSON.stringify({ result, reads, failures }),
  );
  console.log(JSON.stringify({ kind: 'qoro_operational_worker_result', result }));
} else {
  await reconcileAbacatePayInbox({ eventId });
}
process.exit(0);
