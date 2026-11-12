import 'server-only';

import { createHash } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { z } from 'zod';

import { env } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';
import { GatewayReadError } from '../saas/contracts';

// Official ceiling: 100 requests/s/store. Use half, smooth requests (no burst),
// and count GET retries and POSTs alike. No new infrastructure or paid tier.
export const ABACATEPAY_REQUEST_INTERVAL_MS = 20;
export const ABACATEPAY_CIRCUIT_MS = 30_000;
const FAILURE_THRESHOLD = 5;
const MAX_COOLDOWN_MS = 900_000;
export const ABACATEPAY_ADMISSION_LUA = `
local time=redis.call('TIME')
local now=tonumber(time[1])*1000+math.floor(tonumber(time[2])/1000)
local key=KEYS[1]
local action=ARGV[1]
if action=='admit' then
  local blocked=tonumber(redis.call('HGET',key,'blocked') or '0')
  local next=tonumber(redis.call('HGET',key,'next') or '0')
  local wait=math.max(blocked,next)-now
  if wait>0 then return {0,wait} end
  redis.call('HSET',key,'next',now+tonumber(ARGV[2]))
  redis.call('PEXPIRE',key,900000)
  return {1,0}
end
if action=='success' then
  redis.call('HDEL',key,'failures')
  return {1,0}
end
local failures=redis.call('HINCRBY',key,'failures',1)
local cooldown=tonumber(ARGV[2])
if failures>=tonumber(ARGV[3]) then cooldown=math.max(cooldown,tonumber(ARGV[4])) end
local blocked=math.max(tonumber(redis.call('HGET',key,'blocked') or '0'),now+cooldown)
redis.call('HSET',key,'blocked',blocked)
redis.call('PEXPIRE',key,900000)
return {1,math.max(0,blocked-now)}
`;

export interface AbacatePayRequestControl {
  admit(): Promise<{ allowed: boolean; retryAfterMs: number }>;
  observe(status: number | null): Promise<void>;
  throttle(headers: Headers): Promise<void>;
}
type Eval = (script: string, keys: string[], args: (string | number)[]) => Promise<unknown>;
const resultSchema = z.tuple([z.union([z.literal(0), z.literal(1)]), z.number().nonnegative()]);

/** Only numeric durations/timestamps are retained; response text is never logged. */
export function providerCooldownMs(headers: Headers, now = Date.now()): number {
  const retry = headers.get('retry-after');
  let duration = retry && /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : 0;
  if (retry && !duration) duration = Date.parse(retry) - now;
  const reset = Number(headers.get('ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) {
    // Treat only a recognisable future Unix timestamp as an absolute date.
    // A small positive value is a delay in seconds; unknown forms use fallback.
    const remaining = reset > 1_000_000_000 ? reset * 1000 - now : reset * 1000;
    if (remaining > 0) duration = Math.max(duration || 0, remaining);
  }
  if (!Number.isFinite(duration) || duration <= 0) duration = 60_000;
  return Math.ceil(Math.min(MAX_COOLDOWN_MS, Math.max(1000, duration)));
}

export function createRedisAbacatePayRequestControl(
  scope: string,
  evaluate: Eval,
): AbacatePayRequestControl {
  // Never put the API key, tenant identifiers or patient information in Redis keys.
  const key = `qoro:billing:abacatepay:store:${createHash('sha256').update(scope).digest('hex')}`;
  async function run(action: string, cooldown = 0) {
    try {
      return resultSchema.parse(
        await evaluate(
          ABACATEPAY_ADMISSION_LUA,
          [key],
          [
            action,
            action === 'admit' ? ABACATEPAY_REQUEST_INTERVAL_MS : cooldown,
            FAILURE_THRESHOLD,
            ABACATEPAY_CIRCUIT_MS,
          ],
        ),
      );
    } catch {
      metrics.emit('billing.abacatepay.request_control', { outcome: 'coordination_unavailable' });
      throw new GatewayReadError('unavailable');
    }
  }
  return {
    async admit() {
      const [allowed, retryAfterMs] = await run('admit');
      if (!allowed) metrics.emit('billing.abacatepay.request_control', { outcome: 'deferred' });
      return { allowed: allowed === 1, retryAfterMs };
    },
    async observe(status) {
      if (status !== null && status < 400) {
        await run('success');
        return;
      }
      if (status === null || status >= 500 || status === 401 || status === 403) {
        await run('failure', status === 401 || status === 403 ? 60_000 : 0);
        metrics.emit('billing.abacatepay.request_control', {
          outcome: 'provider_failure',
          httpStatus: status,
        });
      }
    },
    async throttle(headers) {
      await run('failure', providerCooldownMs(headers));
      metrics.emit('billing.abacatepay.request_control', { outcome: 'provider_rate_limited' });
    },
  };
}

let redis: Redis | undefined;
export function defaultAbacatePayRequestControl(
  storeId: string | undefined,
): AbacatePayRequestControl | undefined {
  // The deterministic local suites forbid external IO and inject the control in
  // its own tests. No production/Preview bypass exists when Redis is unavailable.
  if (env.NODE_ENV === 'test' && !env.VERCEL_ENV) return undefined;
  if (!storeId || !env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN)
    throw new GatewayReadError('unavailable');
  redis ??= new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
    retry: false,
    signal: () => AbortSignal.timeout(2000),
  });
  const client = redis;
  return createRedisAbacatePayRequestControl(storeId, (script, keys, args) =>
    client.eval(script, keys, args),
  );
}
