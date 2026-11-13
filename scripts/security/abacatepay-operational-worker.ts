/** Owned child process used only for a real interruption/lease recovery proof. */
import assert from 'node:assert/strict';
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
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin === redis.origin) return original(input, init);
  assert.equal(url.origin, 'https://api.abacatepay.com');
  return original(new URL(url.pathname + url.search, provider), init);
};
const { reconcileAbacatePayInbox } =
  await import('../../src/contexts/billing/internal/abacatepay-processing');
const eventId = process.argv[2];
assert.ok(eventId);
await reconcileAbacatePayInbox({ eventId });
process.exit(0);
