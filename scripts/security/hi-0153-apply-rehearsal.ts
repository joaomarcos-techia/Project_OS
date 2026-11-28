/**
 * Ensaio de APLICAÇÃO da 0153/0154 em Postgres DESCARTÁVEL (nunca no DEV compartilhado):
 * schema real até a 0152, `lancamentos`/`payment_transactions` com volume sintético, e as
 * candidatas aplicadas instrução a instrução, com o tempo e os locks que cada uma segura nas
 * tabelas compartilhadas. Alimenta o plano de aplicação (docs/convenios/aplicacao-0153.md).
 *
 * Também mede:
 *  - escrita concorrente durante a aplicação (maior espera de um INSERT particular);
 *  - o custo do gatilho do livro (`validate_payment_transaction_insert`) por pagamento nesse
 *    volume, no caminho particular (0073) e no de convênio (0153) — achado de escala.
 *
 * A semeadura roda com os gatilhos desligados (`session_replication_role = replica`): o que
 * se mede é a aplicação, não a carga inicial.
 *
 *   ROWS=1000000 npx tsx scripts/security/hi-0153-apply-rehearsal.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { readMigrations, startScratchSchema } from './scratch-schema';

const ROWS = Number(process.env.ROWS ?? 1_000_000);
const all = await readMigrations();
const i0153 = all.findIndex((m) => m.file.startsWith('0153_'));
assert.ok(i0153 > 0, '0153 ausente');
const candidates = all.slice(i0153);
const cluster = await startScratchSchema({ port: 55515, maxConnections: 8, migrations: all.slice(0, i0153) });
const { sql } = cluster;

/** Tempo médio de N inserções de pagamento (gatilho real) num lançamento novo. */
async function paymentCost(clinicId: string, label: string, n = 20): Promise<{ label: string; avgMs: number; plan: string }> {
  const [l] = await sql`insert into public.lancamentos (clinic_id, tipo, descricao, valor, status, created_via)
    values (${clinicId}::uuid, 'receber', ${`Medição ${label}`}, ${n * 10}, 'pendente', 'manual') returning id`;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    await sql`insert into public.payment_transactions (clinic_id, lancamento_id, kind, amount, payment_method)
      values (${clinicId}::uuid, ${l!.id}::uuid, 'payment', 10, 'pix')`;
  }
  const avgMs = (performance.now() - t0) / n;
  const plan = (await sql.unsafe(`EXPLAIN SELECT COALESCE(sum(amount), 0) FROM public.payment_transactions
      WHERE lancamento_id = '${l!.id}' AND kind = 'payment'`)).map((r) => String(r['QUERY PLAN'])).join(' | ');
  return { label, avgMs: Math.round(avgMs * 100) / 100, plan: plan.slice(0, 160) };
}

try {
  const clinicId = randomUUID();
  await sql`insert into public.clinics (id, slug, nome, status) values (${clinicId}::uuid, ${`ens-${clinicId.slice(0, 8)}`}, 'Clínica Ensaio', 'active')`;
  const t0 = performance.now();
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx.unsafe(`
      INSERT INTO public.lancamentos (clinic_id, tipo, descricao, valor, valor_pago, status, created_via, paid_at)
      SELECT '${clinicId}', CASE WHEN g % 10 = 0 THEN 'pagar' ELSE 'receber' END::lancamento_tipo, 'Sintético ' || g,
             100, CASE WHEN g % 3 = 0 THEN 100 ELSE 0 END,
             CASE WHEN g % 3 = 0 THEN 'pago' ELSE 'pendente' END::lancamento_status, 'manual',
             CASE WHEN g % 3 = 0 THEN now() END
        FROM generate_series(1, ${ROWS}) g`);
    await tx.unsafe(`
      INSERT INTO public.payment_transactions (clinic_id, lancamento_id, kind, amount, payment_method)
      SELECT clinic_id, id, 'payment', 100, 'pix' FROM public.lancamentos WHERE status = 'pago'`);
  });
  await sql`analyze public.lancamentos`;
  await sql`analyze public.payment_transactions`;
  const [sizes] = await sql`select pg_size_pretty(pg_total_relation_size('public.lancamentos')) as lanc,
      pg_size_pretty(pg_total_relation_size('public.payment_transactions')) as pt,
      (select count(*) from public.lancamentos)::int as n_lanc, (select count(*) from public.payment_transactions)::int as n_pt`;
  console.log(JSON.stringify({ seededMs: Math.round(performance.now() - t0), sizes }));

  // Achado de escala: custo do gatilho do livro ANTES da 0153 (caminho particular da 0073).
  const before = await paymentCost(clinicId, 'particular, antes da 0153');

  // Escrita concorrente durante a aplicação (o Caixa continua lançando).
  let running = true;
  let maxWaitMs = 0;
  let writes = 0;
  const writer = (async () => {
    while (running) {
      const w0 = performance.now();
      await sql`insert into public.lancamentos (clinic_id, tipo, descricao, valor, status, created_via)
        values (${clinicId}::uuid, 'receber', 'Escrita concorrente', 50, 'pendente', 'manual')`;
      maxWaitMs = Math.max(maxWaitMs, performance.now() - w0);
      writes += 1;
    }
  })();

  const report: Array<{ file: string; n: number; head: string; ms: number; locks: string[] }> = [];
  for (const m of candidates) {
    const statements = m.body.split('--> statement-breakpoint').map((s) => s.trim()).filter((s) => s.replace(/--.*$/gmu, '').trim());
    for (const [n, stmt] of statements.entries()) {
      const head = stmt.replace(/--.*$/gmu, '').trim().split('\n')[0]!.slice(0, 90);
      const s0 = performance.now();
      const locks = await sql.begin(async (tx) => {
        await tx`set local lock_timeout = '2s'`;
        await tx`set local statement_timeout = '60s'`;
        await tx.unsafe(stmt);
        const held = await tx`select c.relname, l.mode from pg_locks l join pg_class c on c.oid = l.relation
            where l.pid = pg_backend_pid() and c.relname in ('lancamentos', 'payment_transactions', 'subscriptions', 'invoices') and l.granted order by 1, 2`;
        return held.map((h) => `${h.relname}:${h.mode}`);
      });
      report.push({ file: m.file.slice(0, 4), n, head, ms: Math.round(performance.now() - s0), locks: [...new Set(locks)] });
    }
  }
  running = false;
  await writer;

  const total = report.reduce((acc, r) => acc + r.ms, 0);
  for (const r of report.filter((x) => x.locks.length || x.ms > 50)) {
    console.log(`${r.file}#${String(r.n).padStart(2)} ${String(r.ms).padStart(6)} ms  ${r.locks.join(', ').padEnd(80)} ${r.head}`);
  }
  for (const v of ['0153-hi-ledger-bridge', '0154-hi-premium-period-evidence']) {
    const [row] = await sql`select version from public._schema_version where version = ${v}`;
    assert.ok(row, v);
  }
  // Nada mudou para o particular: colunas novas zeradas, CHECKs validados.
  const [chk] = await sql`select count(*) filter (where valor_glosado <> 0)::int as glossed, count(*) filter (where source_hi_guide_id is not null)::int as insurer,
      (select bool_and(convalidated) from pg_constraint where conrelid = 'public.lancamentos'::regclass and contype = 'c') as validated
    from public.lancamentos`;
  assert.deepEqual([chk!.glossed, chk!.insurer, chk!.validated], [0, 0, true]);

  // Custo do gatilho DEPOIS da 0153: particular (mesmo corpo da 0073) e convênio (filtra por clínica).
  const after = await paymentCost(clinicId, 'particular, depois da 0153');
  const [ins] = await sql.begin(async (t) => {
    await t`select set_config('app.current_clinic', ${clinicId}, true)`;
    return t`insert into public.lancamentos (clinic_id, tipo, descricao, valor, status, payment_method, created_via, source_hi_guide_id)
      values (${clinicId}::uuid, 'receber', 'Convênio medição', 200, 'pendente', 'convenio', 'auto', ${randomUUID()}::uuid) returning id`;
  });
  const t1 = performance.now();
  for (let i = 0; i < 20; i++) {
    await sql`insert into public.payment_transactions (clinic_id, lancamento_id, kind, amount, payment_method)
      values (${clinicId}::uuid, ${ins!.id}::uuid, 'payment', 10, 'convenio')`;
  }
  const insurerAvg = Math.round(((performance.now() - t1) / 20) * 100) / 100;

  console.log(JSON.stringify({
    rows: ROWS, statements: report.length, totalMs: total, concurrentWrites: writes, maxConcurrentWriteWaitMs: Math.round(maxWaitMs),
    paymentTriggerCost: [before, after, { label: 'convênio, depois da 0153', avgMs: insurerAvg }],
  }, null, 2));
  console.log(`\nOK — 0153+0154 aplicadas sobre ${ROWS} lançamentos sintéticos: ${total} ms no total; escrita concorrente esperou no máximo ${Math.round(maxWaitMs)} ms.`);
} finally {
  await cluster.stop();
}
