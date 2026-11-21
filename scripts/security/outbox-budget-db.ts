/**
 * R61 — semântica das duas opções novas do worker do outbox (`reserveUntil` e
 * `skipUnhandledInBulk`), em Postgres DESCARTÁVEL com as migrations reais e o worker REAL.
 * Sintético: só tipos `benchmark.*` registrados aqui e o `scheduling.appointment.checked_in`
 * (do catálogo, sem handler). Nada de produção.
 *
 *   SECURITY_PG_BIN=... PORT=55567 NODE_OPTIONS="--import ./scripts/security/server-only-hook.mjs" \
 *     npx tsx --tsconfig tsconfig.scripts.json scripts/security/outbox-budget-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55567);
const cluster = await startScratchSchema({ port: PORT, maxConnections: 16 });
const { sql } = cluster;
if (!new RegExp(`@(?:127\\.0\\.0\\.1|localhost):${PORT}/`, 'u').test(cluster.url)) throw new Error('não é o cluster local');
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.OUTBOX_CRON_ALLOW_NON_VERCEL = 'true';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');
process.env.LOG_LEVEL = 'error';

await import('../../src/app/api/cron/outbox/handlers');
const { runOutboxOnce } = await import('../../src/lib/outbox/worker');
const { registerEventSchema, getEventSchema } = await import('../../src/lib/outbox/catalog');
const { registerDetachedHandler, getHandler } = await import('../../src/lib/outbox/registry');
const { z } = await import('zod');

const SLOW = 'benchmark.consumer.slow';
const FAST = 'benchmark.consumer.fast';
const CHECKED_IN = 'scheduling.appointment.checked_in';
const payload = z.object({ n: z.number(), ms: z.number() });
registerEventSchema(SLOW, payload);
registerEventSchema(FAST, payload);
// Cada execução de handler conta por evento: duplicidade = algum contador > 1.
const runs = new Map<string, number>();
const count = (id: string) => runs.set(id, (runs.get(id) ?? 0) + 1);
registerDetachedHandler<{ n: number; ms: number }>(SLOW, async ({ eventId, payload: p }) => {
  await new Promise((r) => setTimeout(r, p.ms));
  count(eventId);
});
registerDetachedHandler<{ n: number; ms: number }>(FAST, async ({ eventId }) => {
  count(eventId);
});
assert.ok(getEventSchema(CHECKED_IN) && !getHandler(CHECKED_IN), 'checked_in no catálogo e sem handler');

let passed = 0;
const pass = (m: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${m}`);
};

try {
  const [clinic] = await sql`insert into public.clinics (id, slug, nome, status) values (${randomUUID()}::uuid, ${`fila-${Date.now()}`}, 'Clínica da fila', 'active') returning id::text`;
  const clinicId = String(clinic!.id);
  const insert = async (type: string, n: number, ms = 0, opts: { future?: boolean } = {}) => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const p = type === CHECKED_IN
        ? { appointmentId: randomUUID(), clinicId, fromStatus: 'confirmado', toStatus: 'chegou', reason: null }
        : { n: i, ms };
      const [r] = await sql`insert into public.outbox (clinic_id, event_type, payload, payload_hash, idempotency_key, next_attempt_at)
        values (${clinicId}::uuid, ${type}, ${sql.json(p)}, ${'0'.repeat(64)}, ${`k-${type}-${randomUUID()}`},
                ${opts.future ? sql`now() + interval '1 hour'` : sql`now()`}) returning id::text`;
      ids.push(String(r!.id));
    }
    return ids;
  };
  const statusOf = async (ids: string[]) =>
    (await sql`select status::text as s, count(*)::int as n from public.outbox where id = any(${`{${ids.join(',')}}`}::uuid[]) group by 1`).reduce(
      (acc, r) => ({ ...acc, [String(r.s)]: Number(r.n) }),
      {} as Record<string, number>,
    );
  const reset = async () => {
    await sql`delete from public.outbox`;
    runs.clear();
  };

  // 1. Sem as opções novas, o tick é o de sempre (nenhum campo novo no resumo).
  await reset();
  const plain = await insert(FAST, 10);
  const s0 = await runOutboxOnce({ batchSize: 20, parallelism: 5 });
  assert.equal(s0.processed, 10);
  assert.equal('deferred' in s0, false);
  assert.equal('skipped_bulk' in s0, false);
  assert.deepEqual(await statusOf(plain), { processed: 10 });
  pass('sem as opções, o tick é o de sempre: mesmos campos no resumo e mesmo desfecho');

  // 2. Prazo de reserva: para de RESERVAR no prazo; o que começou termina; o resto fica para o próximo tick.
  await reset();
  const slow = await insert(SLOW, 20, 1_000);
  const fast = await insert(FAST, 30);
  const t0 = performance.now();
  const s1 = await runOutboxOnce({ batchSize: 200, parallelism: 5, reserveUntil: Date.now() + 1_500 });
  const ms1 = performance.now() - t0;
  const after1 = await statusOf([...slow, ...fast]);
  assert.ok((s1.deferred ?? 0) > 0, 'vagas adiadas pelo prazo');
  assert.equal(after1.processing ?? 0, 0, 'nada preso em processamento');
  assert.ok((after1.pending ?? 0) > 0, 'sobrou fila para o próximo tick');
  assert.ok(ms1 < 1_500 + 1_000 + 1_500, `tick de ${Math.round(ms1)} ms excedeu prazo + 1 handler + folga`);
  for (const id of [...slow, ...fast]) assert.ok((runs.get(id) ?? 0) <= 1);
  // Próximos ticks terminam o resto: tudo uma vez só.
  for (let i = 0; i < 10 && ((await statusOf([...slow, ...fast])).pending ?? 0) > 0; i++) await runOutboxOnce({ batchSize: 200, parallelism: 5 });
  assert.deepEqual(await statusOf([...slow, ...fast]), { processed: 50 });
  for (const id of [...slow, ...fast]) assert.equal(runs.get(id), 1, 'cada evento tratado uma única vez');
  pass(`prazo de reserva: o tick parou de reservar em 1,5 s e terminou em ${Math.round(ms1)} ms (os handlers já iniciados concluíram); ${s1.deferred} vagas adiadas; o resto saiu nos ticks seguintes, cada evento uma única vez, nada preso`);

  // 3. Handler já iniciado nunca é abandonado: começa antes do prazo, termina depois dele.
  await reset();
  const long = await insert(SLOW, 1, 2_500);
  const t2 = performance.now();
  const s2 = await runOutboxOnce({ batchSize: 5, parallelism: 5, reserveUntil: Date.now() + 200 });
  const ms2 = performance.now() - t2;
  assert.equal(s2.processed, 1);
  assert.ok(ms2 >= 2_400, 'o tick esperou o handler iniciado');
  assert.deepEqual(await statusOf(long), { processed: 1 });
  pass(`handler iniciado antes do prazo não é abandonado: rodou ${Math.round(ms2)} ms e terminou "processed"`);

  // 4. Descarte em bloco: só tipos sem handler, só devidos; mesmos campos do caminho normal; vagas livres para o resto.
  await reset();
  const due = await insert(CHECKED_IN, 40);
  const later = await insert(CHECKED_IN, 3, 0, { future: true });
  const work = await insert(FAST, 5);
  const s3 = await runOutboxOnce({ batchSize: 5, parallelism: 5, skipUnhandledInBulk: true });
  assert.equal(s3.skipped_bulk, 40);
  assert.equal(s3.processed, 5, 'as 5 vagas foram para eventos com consumidor');
  assert.deepEqual(await statusOf(due), { skipped: 40 });
  assert.deepEqual(await statusOf(later), { pending: 3 });
  assert.deepEqual(await statusOf(work), { processed: 5 });
  // Paridade com o caminho normal (um checked_in pelo processOne, sem o bloco).
  const normal = await insert(CHECKED_IN, 1);
  await runOutboxOnce({ batchSize: 1, parallelism: 1 });
  const [a] = await sql`select status::text, attempts, processed_at is not null as done, processing_started_at is null as free from public.outbox where id = ${due[0]!}::uuid`;
  const [b] = await sql`select status::text, attempts, processed_at is not null as done, processing_started_at is null as free from public.outbox where id = ${normal[0]!}::uuid`;
  assert.deepEqual(a, b, 'mesmo desfecho do caminho normal');
  pass('descarte em bloco: 40 checked_in devidos viraram "skipped" sem ocupar vaga (as 5 vagas trataram eventos com consumidor); os agendados para depois ficaram; campos idênticos aos do caminho normal');

  // 5. Duas invocações ao mesmo tempo: o lock deixa uma só trabalhar; nada duplica.
  await reset();
  const both = await insert(FAST, 60);
  const [x, y] = await Promise.all([
    runOutboxOnce({ batchSize: 200, parallelism: 5, reserveUntil: Date.now() + 10_000, skipUnhandledInBulk: true }),
    runOutboxOnce({ batchSize: 200, parallelism: 5, reserveUntil: Date.now() + 10_000, skipUnhandledInBulk: true }),
  ]);
  assert.equal(x.processed + y.processed, 60);
  assert.ok(x.processed === 0 || y.processed === 0, 'só uma invocação trabalhou');
  for (const id of both) assert.equal(runs.get(id), 1);
  pass('duas invocações simultâneas: uma trabalha, a outra sai pelo lock; cada evento uma vez');

  // 6. Invocação cortada no meio (função morta): o que ficou "processing" volta e sai uma vez só.
  await reset();
  const cut = await insert(FAST, 8);
  await sql`update public.outbox set status = 'processing', attempts = 1, created_at = now() - interval '7 minutes', processing_started_at = now() - interval '6 minutes' where id = any(${`{${cut.join(',')}}`}::uuid[])`;
  const s5 = await runOutboxOnce({ batchSize: 20, parallelism: 5, reserveUntil: Date.now() + 10_000, skipUnhandledInBulk: true });
  assert.equal(s5.stuck_reclaimed, 8);
  for (let i = 0; i < 3 && ((await statusOf(cut)).pending ?? 0) > 0; i++) await runOutboxOnce({ batchSize: 20, parallelism: 5 });
  assert.deepEqual(await statusOf(cut), { processed: 8 });
  for (const id of cut) assert.equal(runs.get(id), 1);
  pass('invocação cortada no meio: o janitor devolve os presos e cada evento sai uma única vez');

  console.log(`\n${passed}/6 provas das opções do worker (R61) passaram.`);
} finally {
  await cluster.stop();
}
process.exit(0);
