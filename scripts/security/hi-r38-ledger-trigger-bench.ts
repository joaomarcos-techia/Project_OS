/**
 * R38 — custo do gatilho do livro (`validate_payment_transaction_insert`) ANTES e DEPOIS da
 * correção (0155), em Postgres DESCARTÁVEL com volumes progressivos. Nunca no DEV
 * compartilhado nem em produção; só dados sintéticos; números desta máquina, não de produção.
 *
 * Variantes medidas no MESMO banco e no MESMO volume:
 *   V0 — função atual (corpo da 0153 = 0073 no caminho particular): soma por lancamento_id.
 *   V1 — 0155: a mesma soma com clinic_id = NEW.clinic_id (usa o índice existente).
 *   V2 — alternativa NÃO adotada, só para comparar: V0 + índice parcial (lancamento_id)
 *        WHERE kind = 'payment'.
 *
 * Por volume e variante: pagamento particular pelo caminho do runtime (papel authenticated,
 * RLS, lock do lançamento, update do saldo, insert no livro — como `confirmPayment`) e pelo
 * caminho sem RLS (service_role/webhook: só o insert); média, p50/p95/p99; CPU do backend;
 * linhas lidas por pagamento (pg_stat); plano e buffers da soma; concorrência (16 clínicas
 * ao mesmo tempo, vazão e locks esperando); disputa no MESMO lançamento (só os pagamentos
 * que cabem passam). No maior volume: aplicação da 0155 com escrita concorrente.
 *
 *   VOLUMES=1000,10000,100000,333000,1000000 SAMPLES=200 npx tsx scripts/security/hi-r38-ledger-trigger-bench.ts
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { functionText, readDevOrderChain } from './dev-order-chain';
import { connectScratch, grantPaidSubscription, startScratchSchema } from './scratch-schema';

type Db = ReturnType<typeof connectScratch>;

const VOLUMES = (process.env.VOLUMES ?? '1000,10000,100000,333000,1000000').split(',').map(Number);
const SAMPLES = Number(process.env.SAMPLES ?? 200);
const CLINICS = Number(process.env.CLINICS ?? 50);
const WORKERS = Number(process.env.WORKERS ?? 16);
const PER_WORKER = Number(process.env.PER_WORKER ?? 10);

const chain = await readDevOrderChain();
const i0155 = chain.findIndex((m) => m.file.startsWith('0155_'));
assert.ok(i0155 > 0, '0155 ausente da cadeia');
const fn0153 = functionText(chain.find((m) => m.file.startsWith('0153_'))!.body, 'validate_payment_transaction_insert');
const m0155 = readFileSync('drizzle/migrations/0155_ledger_payment_sum_by_clinic.sql', 'utf8');
const fn0155 = functionText(m0155, 'validate_payment_transaction_insert');

const cluster = await startScratchSchema({ port: 55520, maxConnections: WORKERS + 6, migrations: chain.slice(0, i0155) });
const { sql } = cluster;
// Um backend só para as amostras sequenciais: a CPU medida é a dele.
const one = connectScratch(cluster.url, 1);

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! * 100) / 100 : 0;
};
const avg = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)) * 100) / 100;
const stats = (xs: number[]) => ({ avg: avg(xs), p50: pct(xs, 50), p95: pct(xs, 95), p99: pct(xs, 99), max: pct(xs, 100) });

function backendCpuMs(pid: number): number | null {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).TotalProcessorTime.TotalMilliseconds`], { encoding: 'utf8' });
      return Number(out.trim().replace(',', '.'));
    }
    const f = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]!.split(' ');
    return (Number(f[11]) + Number(f[12])) * 10;
  } catch {
    return null;
  }
}

async function tableStats() {
  await one`select pg_stat_force_next_flush()`;
  await one`select 1`;
  await new Promise((r) => setTimeout(r, 300));
  const [r] = await sql`select seq_scan::bigint as seq, seq_tup_read::bigint as seq_rows, coalesce(idx_scan, 0)::bigint as idx, coalesce(idx_tup_fetch, 0)::bigint as idx_rows
    from pg_stat_user_tables where relname = 'payment_transactions'`;
  return { seq: Number(r!.seq), seqRows: Number(r!.seq_rows), idx: Number(r!.idx), idxRows: Number(r!.idx_rows) };
}

const clinicIds: string[] = [];
let seeded = 0;

async function seedTo(target: number) {
  const delta = target - seeded;
  if (delta <= 0) return;
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    // Cada lançamento quitado com um pagamento; clínicas em rodízio (multi-tenant real).
    await tx.unsafe(`
      WITH c AS (SELECT array_agg(id ORDER BY id) AS ids FROM public.clinics WHERE slug LIKE 'r38-%'),
      l AS (
        INSERT INTO public.lancamentos (clinic_id, tipo, descricao, valor, valor_pago, status, created_via, payment_method, paid_at)
        SELECT c.ids[1 + (g % ${CLINICS})], 'receber', 'R38 sintético', 100, 100, 'pago', 'manual', 'pix', now()
          FROM c, generate_series(${seeded + 1}, ${target}) g
        RETURNING id, clinic_id)
      INSERT INTO public.payment_transactions (clinic_id, lancamento_id, kind, amount, payment_method)
      SELECT clinic_id, id, 'payment', 100, 'pix' FROM l`);
  });
  seeded = target;
  await sql`analyze public.lancamentos`;
  await sql`analyze public.payment_transactions`;
}

async function install(variant: 'V0' | 'V1' | 'V2') {
  await sql`drop index if exists public.r38_bench_lanc_payment_idx`;
  await sql.unsafe(variant === 'V1' ? fn0155 : fn0153);
  if (variant === 'V2') {
    await sql`create index r38_bench_lanc_payment_idx on public.payment_transactions (lancamento_id) where kind = 'payment'`;
    await sql`analyze public.payment_transactions`;
  }
}

async function freshLancamentos(n: number, valor = 1000): Promise<Array<{ id: string; clinic_id: string }>> {
  return sql`
    WITH c AS (SELECT array_agg(id ORDER BY id) AS ids FROM public.clinics WHERE slug LIKE 'r38-%')
    INSERT INTO public.lancamentos (clinic_id, tipo, descricao, valor, status, created_via)
    SELECT c.ids[1 + (g % ${CLINICS})], 'receber', 'R38 medição', ${valor}, 'pendente', 'manual'
      FROM c, generate_series(1, ${n}) g
    RETURNING id, clinic_id`;
}

/** Pagamento particular como o runtime faz (`confirmPayment`): RLS, lock, saldo, livro. */
async function runtimePayment(db: Db, l: { id: string; clinic_id: string }, amount = 10) {
  const t0 = performance.now();
  let insertMs = 0;
  await db.begin(async (tx) => {
    await tx`select set_config('app.current_clinic', ${l.clinic_id}, true)`;
    await tx`set local role authenticated`;
    await tx`select valor from public.lancamentos where id = ${l.id}::uuid and clinic_id = ${l.clinic_id}::uuid for update`;
    await tx`update public.lancamentos set valor_pago = valor_pago + ${amount}, status = 'parcial', updated_at = now()
      where id = ${l.id}::uuid and clinic_id = ${l.clinic_id}::uuid`;
    const i0 = performance.now();
    await tx`insert into public.payment_transactions (clinic_id, lancamento_id, kind, amount, payment_method)
      values (${l.clinic_id}::uuid, ${l.id}::uuid, 'payment', ${amount}, 'pix')`;
    insertMs = performance.now() - i0;
  });
  return { txMs: performance.now() - t0, insertMs };
}

/** Caminho sem RLS (service_role: webhooks e jobs): só o insert no livro. */
async function servicePayment(db: Db, l: { id: string; clinic_id: string }, amount = 10) {
  const t0 = performance.now();
  await db`insert into public.payment_transactions (clinic_id, lancamento_id, kind, amount, payment_method)
    values (${l.clinic_id}::uuid, ${l.id}::uuid, 'payment', ${amount}, 'pix')`;
  return performance.now() - t0;
}

async function sumPlan(variant: string, l: { id: string; clinic_id: string }) {
  const where = variant === 'V1'
    ? `clinic_id = '${l.clinic_id}' AND lancamento_id = '${l.id}' AND kind = 'payment'`
    : `lancamento_id = '${l.id}' AND kind = 'payment'`;
  const rows = await sql.begin(async (tx) => {
    await tx`select set_config('app.current_clinic', ${l.clinic_id}, true)`;
    await tx`set local role authenticated`;
    return tx.unsafe(`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) SELECT COALESCE(sum(amount), 0) FROM public.payment_transactions WHERE ${where}`);
  });
  const text = rows.map((r) => String(r['QUERY PLAN'])).join(' | ');
  const node = /(Seq Scan|Index Scan|Index Only Scan|Bitmap Heap Scan|Parallel Seq Scan)[^|]*/u.exec(text)?.[0]?.trim() ?? text.slice(0, 80);
  const removed = Number(/Rows Removed by Filter: (\d+)/u.exec(text)?.[1] ?? 0);
  const buffers = /Buffers: shared hit=(\d+)(?: read=(\d+))?/u.exec(text);
  return { node: node.slice(0, 90), rowsRemovedByFilter: removed, sharedHit: Number(buffers?.[1] ?? 0), sharedRead: Number(buffers?.[2] ?? 0) };
}

async function concurrency() {
  const targets = await freshLancamentos(WORKERS * PER_WORKER);
  const lat: number[] = [];
  let maxWaiting = 0;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const [r] = await sql`select count(*)::int as n from pg_locks where not granted`;
      maxWaiting = Math.max(maxWaiting, r!.n as number);
      await new Promise((res) => setTimeout(res, 25));
    }
  })();
  const t0 = performance.now();
  await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
    for (let k = 0; k < PER_WORKER; k++) lat.push((await runtimePayment(sql, targets[w * PER_WORKER + k]!)).txMs);
  }));
  const wall = performance.now() - t0;
  sampling = false;
  await sampler;
  return { payments: lat.length, wallMs: Math.round(wall), throughputPerSec: Math.round((lat.length / wall) * 1000 * 10) / 10, txMs: stats(lat), maxWaitingLocks: maxWaiting };
}

/** Disputa no MESMO lançamento: 16 pagamentos de 10 num título de 100 → exatamente 10 passam. */
async function contention() {
  const [l] = await freshLancamentos(1, 100);
  const results = await Promise.allSettled(Array.from({ length: 16 }, () => servicePayment(sql, l!)));
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const rejected = results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason?.message ?? ''));
  const [s] = await sql`select coalesce(sum(amount), 0)::numeric as total from public.payment_transactions where lancamento_id = ${l!.id}::uuid`;
  return { ok, rejected: rejected.length, reasons: [...new Set(rejected)], ledgerTotal: Number(s!.total) };
}

const report: Record<string, unknown>[] = [];
try {
  for (let i = 0; i < CLINICS; i++) {
    const [c] = await sql`insert into public.clinics (slug, nome, status) values (${`r38-${String(i).padStart(3, '0')}`}, ${`Clínica R38 ${i}`}, 'active') returning id`;
    clinicIds.push(c!.id as string);
    await grantPaidSubscription(sql, c!.id as string);
  }
  const [{ pid }] = (await one`select pg_backend_pid() as pid`) as unknown as [{ pid: number }];
  const [{ version: pgVersion }] = (await sql`select current_setting('server_version') as version`) as unknown as [{ version: string }];
  console.log(`Postgres ${pgVersion}, ${CLINICS} clínicas, ${SAMPLES} amostras por variante`);

  for (const volume of VOLUMES) {
    await seedTo(volume);
    for (const variant of ['V0', 'V1', 'V2'] as const) {
      await install(variant);
      const rt = await freshLancamentos(SAMPLES);
      const sv = await freshLancamentos(SAMPLES);
      await sql`analyze public.payment_transactions`;
      // aquecimento (cache de plano da função nesta sessão)
      await runtimePayment(one, (await freshLancamentos(1))[0]!);

      const s0 = await tableStats();
      const c0 = backendCpuMs(pid);
      const tx: number[] = [];
      const ins: number[] = [];
      for (const l of rt) {
        const r = await runtimePayment(one, l);
        tx.push(r.txMs);
        ins.push(r.insertMs);
      }
      const c1 = backendCpuMs(pid);
      const s1 = await tableStats();
      const svc: number[] = [];
      for (const l of sv) svc.push(await servicePayment(one, l));
      const c2 = backendCpuMs(pid);

      const plan = await sumPlan(variant, rt[0]!);
      const conc = await concurrency();
      const cont = await contention();
      assert.deepEqual([cont.ok, cont.ledgerTotal], [10, 100], `${variant}@${volume}: disputa no mesmo lançamento`);
      const row = {
        volume,
        variant,
        runtime: { txMs: stats(tx), insertMs: stats(ins), cpuMsPerPayment: c0 != null && c1 != null ? Math.round(((c1 - c0) / SAMPLES) * 100) / 100 : null },
        serviceRole: { insertMs: stats(svc), cpuMsPerPayment: c1 != null && c2 != null ? Math.round(((c2 - c1) / SAMPLES) * 100) / 100 : null },
        perPayment: {
          seqScans: Math.round(((s1.seq - s0.seq) / SAMPLES) * 100) / 100,
          rowsReadSeq: Math.round((s1.seqRows - s0.seqRows) / SAMPLES),
          idxScans: Math.round(((s1.idx - s0.idx) / SAMPLES) * 100) / 100,
          rowsReadIdx: Math.round(((s1.idxRows - s0.idxRows) / SAMPLES) * 100) / 100,
        },
        sumPlan: plan,
        concurrency: conc,
        sameLancamentoContention: cont,
      };
      report.push(row);
      console.log(`${String(volume).padStart(8)} ${variant}  runtime avg ${row.runtime.txMs.avg} p95 ${row.runtime.txMs.p95} p99 ${row.runtime.txMs.p99} | insert avg ${row.runtime.insertMs.avg} | service avg ${row.serviceRole.insertMs.avg} | cpu ${row.runtime.cpuMsPerPayment} ms | linhas lidas ${row.perPayment.rowsReadSeq + row.perPayment.rowsReadIdx} | ${plan.node.slice(0, 40)} | conc ${conc.throughputPerSec}/s p95 ${conc.txMs.p95} locks ${conc.maxWaitingLocks}`);
    }
  }

  // Aplicação da 0155 (como o migrador: uma transação, lock_timeout) com escrita concorrente.
  await install('V0');
  const writerTargets = await freshLancamentos(5000);
  let running = true;
  let maxWait = 0;
  let writes = 0;
  const writer = (async () => {
    for (const l of writerTargets) {
      if (!running) break;
      const w = await runtimePayment(sql, l);
      maxWait = Math.max(maxWait, w.txMs);
      writes += 1;
    }
  })();
  await new Promise((r) => setTimeout(r, 500));
  const a0 = performance.now();
  const locks = await sql.begin(async (tx) => {
    await tx`set local lock_timeout = '2s'`;
    await tx`set local statement_timeout = '15s'`;
    await tx.unsafe(m0155);
    const held = await tx`select c.relname, l.mode from pg_locks l join pg_class c on c.oid = l.relation
      where l.pid = pg_backend_pid() and c.relname in ('lancamentos', 'payment_transactions') and l.granted`;
    return held.map((h) => `${h.relname}:${h.mode}`);
  });
  const applyMs = performance.now() - a0;
  await new Promise((r) => setTimeout(r, 500));
  running = false;
  await writer;
  const [v] = await sql`select version from public._schema_version where version = '0155-ledger-payment-sum-by-clinic'`;
  assert.ok(v, '0155 registrada');
  const apply = { volume: seeded, applyMs: Math.round(applyMs), tableLocksHeld: locks, concurrentWrites: writes, maxConcurrentTxMs: Math.round(maxWait) };
  console.log(JSON.stringify({ apply }));
  console.log(JSON.stringify({ scenario: { volumes: VOLUMES, samples: SAMPLES, clinics: CLINICS, workers: WORKERS, perWorker: PER_WORKER }, report }, null, 2));
  console.log(`\nOK — R38: V0/V1/V2 medidas em ${VOLUMES.join(', ')} pagamentos; disputa no mesmo lançamento correta em todas; 0155 aplicada com escrita concorrente em ${Math.round(applyMs)} ms.`);
} finally {
  await one.end({ timeout: 5 }).catch(() => {});
  await cluster.stop();
}
