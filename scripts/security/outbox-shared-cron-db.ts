/**
 * R61-B — a invocação COMPARTILHADA do cron do outbox, como a rota do #53 fica com o patch
 * R61-B (`docs/convenios/r61b/r61b-para-53.patch`): o outbox com prazo de reserva de 30 s e
 * descarte em bloco, em paralelo com quatro tarefas financeiras que imitam as da AbacatePay
 * (mesmos prazos: 35 s; 35 s com admissão de 15 s; 20 s; e o da vigilância, 12 s), num pool
 * próprio como o `dbAdmin`. Postgres DESCARTÁVEL com as migrations reais e o worker REAL; só
 * tipos `benchmark.*` registrados aqui e o `scheduling.appointment.checked_in` do catálogo.
 *
 * O corte da função (`maxDuration` = 60 s) é real: um processo filho, num grupo próprio, morto
 * com SIGKILL aos 60 s. Nada de produção, nenhuma chamada externa.
 *
 *   SECURITY_PG_BIN=... PORT=55568 NODE_OPTIONS="--import ./scripts/security/server-only-hook.mjs" \
 *     ./node_modules/.bin/tsx --tsconfig tsconfig.scripts.json scripts/security/outbox-shared-cron-db.ts [--out x.json]
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const CHILD = process.env.R61_CHILD === 'stuck';
const PORT = Number(process.env.PORT ?? 55568);
/** `maxDuration` da rota do cron. */
const WINDOW_MS = 60_000;
/** Prazo de reserva do patch R61-B. */
const RESERVE_MS = 30_000;
/** As tarefas financeiras da rota, com os prazos que a rota do #53 passa hoje. */
const FIN = [
  { job: 'recovery', deadlineMs: 35_000, admissionMs: undefined },
  { job: 'inbox', deadlineMs: 35_000, admissionMs: 15_000 },
  { job: 'closures', deadlineMs: 20_000, admissionMs: undefined },
  { job: 'watch', deadlineMs: 12_000, admissionMs: undefined },
] as const;
/** Cada item financeiro "chama o provedor" por 1 s, dentro de uma transação com o item travado. */
const FIN_ITEM_MS = 1_000;
const r1 = (n: number) => Math.round(n * 10) / 10;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Cluster = Awaited<ReturnType<(typeof import('./scratch-schema'))['startScratchSchema']>>;
let cluster: Cluster | null = null;
let url: string;
if (CHILD) {
  url = String(process.env.R61_DATABASE_URL);
} else {
  const { startScratchSchema } = await import('./scratch-schema');
  cluster = await startScratchSchema({ port: PORT, maxConnections: 8 });
  url = cluster.url;
}
if (!/@(?:127\.0\.0\.1|localhost):\d+\//u.test(url)) throw new Error('não é o cluster local');
process.env.DATABASE_URL = url;
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

const T = {
  fast: 'benchmark.consumer.fast',
  slow: 'benchmark.consumer.slow',
  stuck: 'benchmark.consumer.stuck',
  cpu: 'benchmark.consumer.cpu',
} as const;
const CHECKED_IN = 'scheduling.appointment.checked_in';
const payloadSchema = z.object({ ms: z.number() });
for (const t of Object.values(T)) registerEventSchema(t, payloadSchema);
assert.ok(getEventSchema(CHECKED_IN) && !getHandler(CHECKED_IN), 'checked_in no catálogo e sem handler');

/**
 * Os pools REAIS do app: os efeitos dos handlers vão pelo `db` (o dos handlers) e as tarefas
 * financeiras pelo `dbAdmin` (o mesmo das tarefas da AbacatePay); o worker usa o `dbWorker`.
 */
const { db, dbAdmin } = await import('../../src/lib/db');
const { sql: q } = await import('drizzle-orm');
/** Efeito idempotente por evento: repetir a entrega não duplica o efeito, só conta a execução. */
const effect = (eventId: string, clinicId: string) =>
  db.execute(q`insert into r61_effects (event_id, clinic_id) values (${eventId}::uuid, ${clinicId}::uuid)
      on conflict (event_id) do update set runs = r61_effects.runs + 1`);
type P = { ms: number };
registerDetachedHandler<P>(T.fast, async ({ eventId, clinicId }) => {
  await effect(eventId, clinicId);
});
registerDetachedHandler<P>(T.slow, async ({ eventId, clinicId, payload }) => {
  await sleep(payload.ms);
  await effect(eventId, clinicId);
});
// Travado: grava o efeito e SÓ ENTÃO trava — o pior caso para a idempotência (o corte vem depois do efeito).
registerDetachedHandler<P>(T.stuck, async ({ eventId, clinicId, payload, attempt }) => {
  await effect(eventId, clinicId);
  if (attempt <= 1) await sleep(payload.ms);
});
// CPU: um bloco síncrono inteiro (como montar e conferir um XML grande), sem ceder o event loop.
registerDetachedHandler<P>(T.cpu, async ({ eventId, clinicId, payload }) => {
  const until = performance.now() + payload.ms;
  while (performance.now() < until) {
    /* CPU */
  }
  await effect(eventId, clinicId);
});

interface FinResult {
  job: string;
  done: number;
  finishedAtMs: number;
  deadlineMs: number;
}
/**
 * Uma tarefa financeira como as da AbacatePay: só admite item novo com 2 s de folga até o próprio
 * prazo (e, na `inbox`, só na janela de admissão); cada item fica travado (SKIP LOCKED) na
 * transação até gravar. Se a função for cortada no meio, a transação volta e o item fica para depois.
 */
async function financialTick(f: (typeof FIN)[number], startedAt: number, tag: string): Promise<FinResult> {
  const deadline = startedAt + f.deadlineMs;
  const admissionUntil = startedAt + (f.admissionMs ?? f.deadlineMs);
  let done = 0;
  while (Date.now() < admissionUntil && deadline - Date.now() >= 2_000) {
    const took = await dbAdmin.transaction(async (tx) => {
      const rows = await tx.execute<{ id: number }>(
        q`select id from r61_fin_queue where job = ${f.job} and done_count = 0 order by id for update skip locked limit 1`,
      );
      const row = rows[0];
      if (!row) return false;
      await sleep(FIN_ITEM_MS);
      await tx.execute(
        q`update r61_fin_queue set done_count = done_count + 1, done_by = ${tag}, done_offset_ms = ${Date.now() - startedAt} where id = ${row.id}`,
      );
      return true;
    });
    if (!took) break;
    done += 1;
  }
  return { job: f.job, done, finishedAtMs: Date.now() - startedAt, deadlineMs: f.deadlineMs };
}

/** Uma invocação da rota com o patch: outbox + 4 tarefas financeiras em paralelo, um relógio só. */
async function invoke(startedAt: number, tag: string, onFin?: (r: FinResult) => void) {
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  const t0 = performance.now();
  const outbox = runOutboxOnce({
    batchSize: 200,
    parallelism: 5,
    reserveUntil: startedAt + RESERVE_MS,
    skipUnhandledInBulk: true,
  }).then((summary) => ({ summary, msFromStart: Date.now() - startedAt }));
  const fins = FIN.map((f) =>
    financialTick(f, startedAt, tag).then((r) => {
      onFin?.(r);
      return r;
    }),
  );
  const [o, ...f] = await Promise.all([outbox, ...fins]);
  loop.disable();
  return {
    outbox: o.summary,
    outboxMsFromStart: o.msFromStart,
    totalMsFromStart: Date.now() - startedAt,
    wallMs: Math.round(performance.now() - t0),
    fins: f,
    loopP99Ms: r1(loop.percentile(99) / 1e6),
    loopMaxMs: r1(loop.max / 1e6),
  };
}

if (CHILD) {
  // Filho: só a invocação; o pai mata o processo (e o grupo) aos 60 s, como o `maxDuration`.
  const startedAt = Date.now();
  const say = (m: unknown) => process.stdout.write(`R61:${JSON.stringify(m)}\n`);
  say({ t: 'start' });
  const r = await invoke(startedAt, 'cut', (f) => say({ t: 'fin', ...f }));
  say({ t: 'end', totalMsFromStart: r.totalMsFromStart });
  process.exit(0);
}

const sql = cluster!.sql;
const results: Record<string, unknown> = {};
let passed = 0;
const pass = (m: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${m}`);
};

try {
  await sql`create table r61_effects (event_id uuid primary key, clinic_id uuid not null, runs int not null default 1)`;
  await sql`create table r61_fin_queue (id serial primary key, job text not null, done_count int not null default 0, done_by text, done_offset_ms int)`;
  const clinics: string[] = [];
  for (const nome of ['Clínica A', 'Clínica B']) {
    const [c] = await sql`insert into public.clinics (id, slug, nome, status) values (${randomUUID()}::uuid, ${`r61b-${randomUUID().slice(0, 8)}`}, ${nome}, 'active') returning id::text`;
    clinics.push(String(c!.id));
  }

  const seed = async (type: string, n: number, ms = 0) => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const clinicId = clinics[i % clinics.length]!;
      const p = type === CHECKED_IN
        ? { appointmentId: randomUUID(), clinicId, fromStatus: 'confirmado', toStatus: 'chegou', reason: null }
        : { ms };
      const [r] = await sql`insert into public.outbox (clinic_id, event_type, payload, payload_hash, idempotency_key)
        values (${clinicId}::uuid, ${type}, ${sql.json(p)}, ${'0'.repeat(64)}, ${`r61b-${type}-${randomUUID()}`}) returning id::text`;
      ids.push(String(r!.id));
    }
    return ids;
  };
  const reset = async () => {
    await sql`delete from public.outbox`;
    await sql`delete from r61_effects`;
    await sql`delete from r61_fin_queue`;
    for (const f of FIN) await sql`insert into r61_fin_queue (job) select ${f.job} from generate_series(1, 100)`;
  };
  const statusOf = async (ids: string[]) =>
    (await sql`select status::text as s, count(*)::int as n from public.outbox where id = any(${`{${ids.join(',')}}`}::uuid[]) group by 1`).reduce(
      (acc, r) => ({ ...acc, [String(r.s)]: Number(r.n) }),
      {} as Record<string, number>,
    );
  const drain = async () => {
    for (let i = 0; i < 40; i++) {
      const [p] = await sql`select count(*)::int as n from public.outbox where status in ('pending', 'processing')`;
      if (Number(p!.n) === 0) return i;
      await runOutboxOnce({ batchSize: 500, parallelism: 10 });
    }
    throw new Error('a fila não drenou');
  };
  /** Integridade ao fim de cada cenário: nada perdido, nada duplicado, nada na clínica errada. */
  const integrity = async (allowRerun: string[] = []) => {
    const [o] = await sql`select count(*) filter (where status in ('pending', 'processing'))::int as abertos,
        count(*) filter (where status = 'failed')::int as falhos from public.outbox`;
    const [e] = await sql`select count(*) filter (where e.runs > 1 and not (e.event_id = any(${`{${allowRerun.join(',')}}`}::uuid[])))::int as reexecutados,
        count(*) filter (where o.id is null)::int as orfaos,
        count(*) filter (where o.clinic_id <> e.clinic_id)::int as clinica_errada,
        count(*) filter (where o.status <> 'processed')::int as efeito_sem_processado
      from r61_effects e left join public.outbox o on o.id = e.event_id`;
    const [m] = await sql`select count(*)::int as n from public.outbox o where o.status = 'processed'
        and not exists (select 1 from r61_effects e where e.event_id = o.id)`;
    const [f] = await sql`select coalesce(max(done_count), 0)::int as max_done from r61_fin_queue`;
    const r = {
      abertos: Number(o!.abertos), falhos: Number(o!.falhos), reexecutados: Number(e!.reexecutados), orfaos: Number(e!.orfaos),
      clinicaErrada: Number(e!.clinica_errada), efeitoSemProcessado: Number(e!.efeito_sem_processado),
      processadoSemEfeito: Number(m!.n), itemFinanceiroDuplicado: Number(f!.max_done) > 1 ? 1 : 0,
    };
    for (const [k, v] of Object.entries(r)) assert.equal(v, 0, `integridade: ${k}`);
    return r;
  };
  /** As tarefas financeiras terminam no próprio prazo (com folga de `slackMs`), qualquer que seja o outbox. */
  const finWithinDeadline = (fins: FinResult[], slackMs: number) => {
    for (const f of fins) {
      assert.ok(f.done > 0, `${f.job}: tarefa financeira não fez nada`);
      assert.ok(f.finishedAtMs <= f.deadlineMs + slackMs, `${f.job}: terminou em ${f.finishedAtMs} ms, prazo ${f.deadlineMs} ms`);
    }
  };
  const finSummary = (fins: FinResult[]) => Object.fromEntries(fins.map((f) => [f.job, { itens: f.done, terminouEmMs: f.finishedAtMs, prazoMs: f.deadlineMs }]));

  // 1. Encerramento normal: consumidores rápidos; o outbox termina cedo; as financeiras usam a janela delas.
  await reset();
  await seed(T.fast, 150);
  await seed(CHECKED_IN, 50);
  const s1 = await invoke(Date.now(), 'normal');
  assert.equal(s1.outbox.processed, 150);
  assert.equal(s1.outbox.skipped_bulk, 50);
  assert.ok(s1.totalMsFromStart < WINDOW_MS, 'invocação dentro de 60 s');
  finWithinDeadline(s1.fins, 1_000);
  results.normal = { outboxMs: s1.outboxMsFromStart, totalMs: s1.totalMsFromStart, financeiras: finSummary(s1.fins), integridade: await integrity() };
  pass(`normal: outbox 150 tratados + 50 descartados em bloco em ${s1.outboxMsFromStart} ms; invocação em ${s1.totalMsFromStart} ms; as 4 financeiras dentro dos prazos`);

  // 2. Consumidor lento (pane de provedor: 60 eventos de 6 s): o outbox para de reservar aos 30 s.
  await reset();
  const slow = await seed(T.slow, 60, 6_000);
  const fast2 = await seed(T.fast, 140);
  const s2 = await invoke(Date.now(), 'lento');
  assert.ok((s2.outbox.deferred ?? 0) > 0, 'vagas adiadas pelo prazo');
  assert.ok(s2.outboxMsFromStart <= RESERVE_MS + 6_000 + 2_000, `outbox em ${s2.outboxMsFromStart} ms`);
  assert.ok(s2.totalMsFromStart < WINDOW_MS, 'invocação dentro de 60 s');
  finWithinDeadline(s2.fins, 1_000);
  const left2 = await statusOf([...slow, ...fast2]);
  assert.equal(left2.processing ?? 0, 0, 'nada preso em processamento');
  await drain();
  results.consumidorLento = {
    outboxMs: s2.outboxMsFromStart, totalMs: s2.totalMsFromStart, tratados: s2.outbox.processed, vagasAdiadas: s2.outbox.deferred,
    ficaramParaDepois: left2.pending ?? 0, financeiras: finSummary(s2.fins), integridade: await integrity(),
  };
  pass(`consumidor lento: outbox parou de reservar aos 30 s e terminou em ${s2.outboxMsFromStart} ms (${s2.outbox.processed} tratados, ${s2.outbox.deferred} vagas adiadas, ${left2.pending ?? 0} para depois); invocação em ${s2.totalMsFromStart} ms; financeiras nos prazos; drenado sem perda nem duplicidade`);

  // 3. Consumidor TRAVADO (70 s) + corte da função aos 60 s (processo filho morto) + recuperação.
  await reset();
  const [stuck] = await seed(T.stuck, 1, 70_000);
  const fast3 = await seed(T.fast, 50);
  const slow3 = await seed(T.slow, 20, 2_000);
  await seed(CHECKED_IN, 30);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const tsx = path.resolve(here, '../../node_modules/.bin/tsx');
  const child = spawn(tsx, ['--tsconfig', 'tsconfig.scripts.json', fileURLToPath(import.meta.url)], {
    env: { ...process.env, R61_CHILD: 'stuck', R61_DATABASE_URL: url },
    detached: true,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const msgs: Array<Record<string, unknown>> = [];
  const cut = { startedAt: 0, killedAt: 0 };
  const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  let buf = '';
  child.stdout!.on('data', (d: Buffer) => {
    buf += d.toString();
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.startsWith('R61:')) continue;
      const m = JSON.parse(line.slice(4)) as Record<string, unknown>;
      msgs.push(m);
      if (m.t === 'start') {
        cut.startedAt = Date.now();
        setTimeout(() => {
          cut.killedAt = Date.now();
          // O grupo inteiro: o tsx e o node que ele sobe morrem juntos, como a função cortada.
          try {
            process.kill(-child.pid!, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }, WINDOW_MS);
      }
    }
  });
  await exited;
  assert.ok(cut.startedAt > 0 && cut.killedAt > 0, 'o filho começou e foi cortado aos 60 s');
  const cutAtMs = cut.killedAt - cut.startedAt;
  assert.equal(msgs.some((m) => m.t === 'end'), false, 'a invocação NÃO terminou sozinha (o travado segura o outbox)');
  const childFins = msgs.filter((m) => m.t === 'fin') as unknown as FinResult[];
  assert.equal(childFins.length, FIN.length, 'as 4 financeiras terminaram ANTES do corte');
  finWithinDeadline(childFins, 1_000);
  const [stuckRow] = await sql`select status::text as s from public.outbox where id = ${stuck!}::uuid`;
  assert.equal(stuckRow!.s, 'processing', 'o travado ficou em processamento no corte');
  const others3 = await statusOf([...fast3, ...slow3]);
  assert.equal(others3.processing ?? 0, 0, 'só o travado ficou preso');
  const [finCut] = await sql`select count(*) filter (where done_count > 0)::int as feitos, coalesce(max(done_count), 0)::int as max_done,
      coalesce(max(done_offset_ms), 0)::int as ultimo_ms from r61_fin_queue where done_by = 'cut'`;
  assert.ok(Number(finCut!.feitos) > 0 && Number(finCut!.max_done) === 1, 'trabalho financeiro gravado antes do corte, sem duplicidade');
  assert.ok(Number(finCut!.ultimo_ms) < WINDOW_MS - 20_000, 'o último item financeiro foi gravado bem antes do corte');
  const [effBefore] = await sql`select runs from r61_effects where event_id = ${stuck!}::uuid`;
  assert.equal(Number(effBefore!.runs), 1, 'o efeito do travado foi gravado uma vez antes do corte');
  // Recuperação: passados 5 min, o janitor devolve o preso; a nova entrega não duplica o efeito.
  await sql`update public.outbox set created_at = now() - interval '7 minutes', processing_started_at = now() - interval '6 minutes' where id = ${stuck!}::uuid`;
  const s3b = await invoke(Date.now(), 'recuperacao');
  assert.equal(s3b.outbox.stuck_reclaimed, 1, 'o janitor devolveu o travado');
  await drain();
  const [effAfter] = await sql`select runs from r61_effects where event_id = ${stuck!}::uuid`;
  assert.equal(Number(effAfter!.runs), 2, 'entregue de novo (pelo menos uma vez)...');
  const [effCount] = await sql`select count(*)::int as n from r61_effects where event_id = ${stuck!}::uuid`;
  assert.equal(Number(effCount!.n), 1, '...com UM efeito só');
  results.consumidorTravadoComCorte = {
    cortadoAosMs: cutAtMs, financeirasAntesDoCorte: finSummary(childFins),
    ultimoItemFinanceiroGravadoMs: Number(finCut!.ultimo_ms), travadoNoCorte: 'processing', demaisNoCorte: others3,
    recuperacao: { devolvidosPeloJanitor: s3b.outbox.stuck_reclaimed, entregasDoTravado: 2, efeitosDoTravado: 1 },
    integridade: await integrity([stuck!]),
  };
  pass(`consumidor travado + corte aos ${cutAtMs} ms: as 4 financeiras terminaram e gravaram antes do corte (último item aos ${finCut!.ultimo_ms} ms); só o travado ficou preso; o janitor o devolveu e a nova entrega não duplicou o efeito`);

  // 4. Prazo quase esgotado: invocação que "começou" há 29 s e há 31 s.
  await reset();
  const late = await seed(T.slow, 100, 500);
  const s4a = await invoke(Date.now() - 29_000, 'prazo-29s');
  const st4a = await statusOf(late);
  assert.ok(s4a.outbox.processed > 0 && (s4a.outbox.deferred ?? 0) > 0, 'reservou só no 1 s que sobrava');
  assert.equal(st4a.processing ?? 0, 0, 'nada preso');
  assert.equal(s4a.fins.find((f) => f.job === 'closures')!.done, 0, 'closures (prazo de 20 s já passado) não começou nada');
  assert.equal(s4a.fins.find((f) => f.job === 'inbox')!.done, 0, 'inbox (admissão de 15 s já passada) não começou nada');
  await reset();
  const later = await seed(T.fast, 100);
  await seed(CHECKED_IN, 20);
  const s4b = await invoke(Date.now() - 31_000, 'prazo-31s');
  assert.equal(s4b.outbox.processed, 0, 'prazo vencido: nenhum evento reservado');
  assert.equal(s4b.outbox.deferred, 200, 'as 200 vagas adiadas');
  assert.equal(s4b.outbox.skipped_bulk, 20, 'o descarte em bloco não depende de vaga');
  assert.deepEqual(await statusOf(later), { pending: 100 }, 'tudo pendente para a próxima invocação, nada preso');
  await drain();
  results.prazoQuaseEsgotado = {
    comecouHa29s: { tratados: s4a.outbox.processed, vagasAdiadas: s4a.outbox.deferred, outboxMs: s4a.outboxMsFromStart - 29_000, financeiras: finSummary(s4a.fins) },
    comecouHa31s: { tratados: 0, vagasAdiadas: s4b.outbox.deferred, descartadosEmBloco: s4b.outbox.skipped_bulk },
    integridade: await integrity(),
  };
  pass(`prazo quase esgotado: com 1 s restante, ${s4a.outbox.processed} reservados e ${s4a.outbox.deferred} adiados; com o prazo vencido, nenhum reservado e as 200 vagas adiadas; financeiras sem prazo não começaram nada; nada preso`);

  // 5. Duas invocações sobrepostas: o outbox trabalha numa só; os itens financeiros, cada um uma vez.
  await reset();
  await seed(T.fast, 150);
  const [a, b] = await Promise.all([invoke(Date.now(), 'A'), invoke(Date.now(), 'B')]);
  assert.equal(a.outbox.processed + b.outbox.processed, 150);
  assert.ok(a.outbox.processed === 0 || b.outbox.processed === 0, 'só uma invocação processou o outbox');
  finWithinDeadline(a.fins, 1_000);
  finWithinDeadline(b.fins, 1_000);
  const [ab] = await sql`select count(*) filter (where done_by = 'A')::int as a, count(*) filter (where done_by = 'B')::int as b from r61_fin_queue`;
  results.sobrepostas = { outboxA: a.outbox.processed, outboxB: b.outbox.processed, itensFinanceirosA: Number(ab!.a), itensFinanceirosB: Number(ab!.b), integridade: await integrity() };
  pass(`sobrepostas: outbox numa invocação só (${a.outbox.processed}/${b.outbox.processed}); itens financeiros divididos (${ab!.a}/${ab!.b}) sem nenhum repetido`);

  // 6. Handler de CPU (60 eventos de 300 ms síncronos): quanto atrasa as financeiras no mesmo processo.
  await reset();
  await seed(T.cpu, 60, 300);
  const s6 = await invoke(Date.now(), 'cpu');
  assert.equal(s6.outbox.processed, 60);
  const lateness = Math.max(...s6.fins.map((f) => f.finishedAtMs - f.deadlineMs));
  for (const f of s6.fins) assert.ok(f.finishedAtMs < WINDOW_MS - 5_000, `${f.job} terminou em ${f.finishedAtMs} ms`);
  assert.ok(s6.totalMsFromStart < WINDOW_MS, 'invocação dentro de 60 s');
  results.handlerDeCpu = { outboxMs: s6.outboxMsFromStart, totalMs: s6.totalMsFromStart, atrasoMaxFinanceiraMs: lateness, eventLoopP99Ms: s6.loopP99Ms, eventLoopMaxMs: s6.loopMaxMs, financeiras: finSummary(s6.fins), integridade: await integrity() };
  pass(`handler de CPU: outbox em ${s6.outboxMsFromStart} ms; event loop p99 ${s6.loopP99Ms} ms (máx ${s6.loopMaxMs} ms); financeiras até ${lateness} ms além do prazo, todas antes de 55 s`);

  console.log(`\n${passed}/6 provas da invocação compartilhada do cron (R61-B) passaram.`);
  console.log(`R61B_RESULT ${JSON.stringify(results)}`);
  const outIdx = process.argv.indexOf('--out');
  if (outIdx >= 0) writeFileSync(process.argv[outIdx + 1]!, JSON.stringify({ at: new Date().toISOString(), node: process.version, cenarios: results }, null, 1));
} finally {
  await cluster!.stop();
}
process.exit(0);
