/** Real Redis Lua, loopback-only disposable container; no AbacatePay HTTP. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://synthetic@127.0.0.1:55492/postgres',
  NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic',
});
delete process.env.VERCEL_ENV;
const docker = process.env.QORO_DOCKER_BIN ?? 'docker';
const label = execFileSync(
  docker,
  [
    'inspect',
    '--format',
    '{{index .Config.Labels "qoro.synthetic"}}',
    'qoro-abacate-scale-20261112',
  ],
  { encoding: 'utf8', windowsHide: true },
).trim();
assert.equal(label, 'abacate-scale-20261112');
const { createRedisAbacatePayRequestControl } =
  await import('../../src/lib/payments/abacatepay/request-control');
type Reply = number | string | Reply[];
function parse(buffer: Buffer, offset = 0): { value: Reply; next: number } | undefined {
  const end = buffer.indexOf('\r\n', offset);
  if (end === -1) return;
  const prefix = String.fromCharCode(buffer[offset] ?? 0),
    text = buffer.toString('utf8', offset + 1, end);
  if (prefix === ':') return { value: Number(text), next: end + 2 };
  if (prefix === '+') return { value: text, next: end + 2 };
  if (prefix === '-') throw new Error('Local Redis command failed');
  if (prefix === '*') {
    const values: Reply[] = [];
    let next = end + 2;
    for (let i = 0; i < Number(text); i++) {
      const entry = parse(buffer, next);
      if (!entry) return;
      values.push(entry.value);
      next = entry.next;
    }
    return { value: values, next };
  }
  throw new Error('Unexpected local Redis protocol');
}
const socket = net.createConnection({ host: '127.0.0.1', port: 63799 });
socket.setTimeout(10000, () => socket.destroy(new Error('Local Redis timeout')));
let buffer = Buffer.alloc(0);
const pending: { resolve: (r: Reply) => void; reject: (e: Error) => void }[] = [];
socket.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  try {
    for (;;) {
      const reply = parse(buffer);
      if (!reply) break;
      buffer = buffer.subarray(reply.next);
      const next = pending.shift();
      assert.ok(next);
      next.resolve(reply.value);
    }
  } catch {
    socket.destroy(new Error('Local Redis response invalid'));
  }
});
socket.on('error', () => {
  for (const p of pending.splice(0)) p.reject(new Error('Local Redis unavailable'));
});
function command(args: (string | number)[]): Promise<Reply> {
  return new Promise((resolve, reject) => {
    pending.push({ resolve, reject });
    socket.write(
      `*${args.length}\r\n` +
        args
          .map((v) => {
            const value = String(v);
            return `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
          })
          .join(''),
    );
  });
}
let evaluations = 0;
const evaluate = async (script: string, keys: string[], args: (string | number)[]) => {
  evaluations++;
  return command(['EVAL', script, keys.length, ...keys, ...args]);
};
const run = randomUUID();
try {
  const controls = Array.from({ length: 20 }, () =>
    createRedisAbacatePayRequestControl(`synthetic-${run}`, evaluate),
  );
  const start = performance.now();
  const results = await Promise.all(
    Array.from({ length: 1000 }, (_, i) => controls[i % controls.length]!.admit()),
  );
  const elapsedMs = performance.now() - start,
    admitted = results.filter((r) => r.allowed).length;
  assert.ok(admitted <= Math.ceil(elapsedMs / 20) + 1);
  assert.ok(admitted < 100);
  const control = controls[0];
  assert.ok(control);
  for (let i = 0; i < 5; i++) await control.observe(503);
  const opened = await control.admit();
  assert.equal(opened.allowed, false);
  assert.ok(opened.retryAfterMs > 29000);
  await control.observe(200);
  assert.equal((await controls[1]!.admit()).allowed, false);
  const separate = createRedisAbacatePayRequestControl(`other-${run}`, evaluate);
  assert.equal((await separate.admit()).allowed, true);
  await separate.throttle(new Headers({ 'retry-after': '60' }));
  assert.ok((await separate.admit()).retryAfterMs > 59000);
  const steady = createRedisAbacatePayRequestControl(`steady-${run}`, evaluate);
  let dispatched = 0;
  const times: number[] = [];
  const steadyStart = performance.now();
  while (performance.now() - steadyStart < 1000) {
    const r = await steady.admit();
    if (r.allowed) {
      dispatched++;
      times.push(performance.now() - steadyStart);
    }
    await delay(20);
  }
  assert.ok(dispatched > 0 && dispatched <= 50);
  const report = {
    observedAt: new Date().toISOString(),
    status: 'PASS',
    environment: 'loopback_Redis_7.4',
    lua: 'production atomic script',
    instances: 20,
    concurrentAdmissions: 1000,
    admitted,
    deferred: 1000 - admitted,
    elapsedMs,
    oneSecondSmoothedAdmissions: dispatched,
    admissionTimesMs: times,
    evaluations,
    assertions: [
      'shared store coordination',
      'independent stores',
      'five failures open 30s circuit',
      'success does not erase cooldown',
      '429 honors Retry-After',
    ],
    externalProviderRequests: 0,
    externalRedisRequests: 0,
  };
  await writeFile('dist/abacatepay-rate-db.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  socket.end();
}
