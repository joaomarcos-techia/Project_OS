/**
 * Ensaio de APLICAÇÃO da cauda inteira do convênio (0144 → 0158) e, por último, da
 * candidata financeira do #53 (`saas_period_snapshot.candidate.sql`, lida do commit dele
 * por `git show`), em Postgres DESCARTÁVEL na ordem do DEV: main → #53 0136–0142 → 0143.
 * Nunca no DEV compartilhado. Volume sintético em `lancamentos`, `payment_transactions` e
 * `appointments` (a 0148 altera `appointments`); semeadura com os gatilhos desligados.
 *
 * Mede, por instrução: tempo e locks nas tabelas compartilhadas; durante tudo, a maior
 * espera de uma escrita particular concorrente (lançamento + pagamento pelo runtime).
 * Depois: o particular não mudou (modalidade, colunas novas zeradas, CHECKs validados),
 * as versões estão registradas e os objetos da candidata do #53 existem.
 *
 *   ROWS=1000000 npx tsx scripts/security/hi-tail-apply-rehearsal.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { readDevOrderChain, readPr53FinancialCandidate } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const ROWS = Number(process.env.ROWS ?? 1_000_000);
const chain = await readDevOrderChain();
const i0144 = chain.findIndex((m) => m.file.startsWith('0144_'));
assert.ok(i0144 > 0, '0144 ausente');
const tail = [
  ...chain.slice(i0144),
  { file: '9999_pr53_saas_period_snapshot.candidate.sql', body: readPr53FinancialCandidate() },
];
const cluster = await startScratchSchema({ port: 55525, maxConnections: 8, migrations: chain.slice(0, i0144) });
const { sql } = cluster;
const SHARED = ['lancamentos', 'payment_transactions', 'appointments', 'patients', 'subscriptions', 'invoices', 'clinics'];

try {
  const clinicId = randomUUID();
  await sql`insert into public.clinics (id, slug, nome, status) values (${clinicId}::uuid, ${`tail-${clinicId.slice(0, 8)}`}, 'Clínica Ensaio da Cauda', 'active')`;
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
    // Atendimentos: um profissional por linha (a exclusão de sobreposição continua valendo em réplica).
    await tx.unsafe(`
      INSERT INTO public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
        snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via)
      SELECT '${clinicId}', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), now() - (g || ' minutes')::interval, 30,
             'atendido', 150, 'Consulta', 150, 30, 'Profissional sintético', 'attendant'
        FROM generate_series(1, ${Math.floor(ROWS / 2)}) g`);
  });
  for (const t of ['lancamentos', 'payment_transactions', 'appointments']) await sql.unsafe(`analyze public.${t}`);
  const [sizes] = await sql`select (select count(*) from public.lancamentos)::int as lancamentos, (select count(*) from public.payment_transactions)::int as pagamentos,
      (select count(*) from public.appointments)::int as atendimentos,
      pg_size_pretty(pg_total_relation_size('public.lancamentos') + pg_total_relation_size('public.payment_transactions') + pg_total_relation_size('public.appointments')) as size`;
  console.log(JSON.stringify({ seededMs: Math.round(performance.now() - t0), sizes }));

  // Escrita particular concorrente durante toda a aplicação (como o Caixa).
  let running = true;
  let maxWaitMs = 0;
  let writes = 0;
  const writer = (async () => {
    while (running) {
      const w0 = performance.now();
      await sql.begin(async (tx) => {
        const [l] = await tx`insert into public.lancamentos (clinic_id, tipo, descricao, valor, status, created_via)
          values (${clinicId}::uuid, 'receber', 'Escrita concorrente', 50, 'pendente', 'manual') returning id`;
        await tx`insert into public.payment_transactions (clinic_id, lancamento_id, kind, amount, payment_method)
          values (${clinicId}::uuid, ${l!.id}::uuid, 'payment', 50, 'pix')`;
      });
      maxWaitMs = Math.max(maxWaitMs, performance.now() - w0);
      writes += 1;
    }
  })();

  const report: Array<{ file: string; n: number; head: string; ms: number; locks: string[] }> = [];
  for (const m of tail) {
    const isCandidate = m.file.startsWith('9999_');
    const statements = isCandidate
      ? [m.body]
      : m.body.split('--> statement-breakpoint').map((s) => s.trim()).filter((s) => s.replace(/--.*$/gmu, '').trim());
    for (const [n, stmt] of statements.entries()) {
      const head = stmt.replace(/--.*$/gmu, '').trim().split('\n')[0]!.slice(0, 90);
      const s0 = performance.now();
      const locks = await sql.begin(async (tx) => {
        await tx`set local lock_timeout = '2s'`;
        await tx`set local statement_timeout = '60s'`;
        await tx.unsafe(stmt);
        const held = await tx`select c.relname, l.mode from pg_locks l join pg_class c on c.oid = l.relation
            where l.pid = pg_backend_pid() and c.relname = any(${SHARED}) and l.granted order by 1, 2`;
        return held.map((h) => `${h.relname}:${h.mode}`);
      });
      report.push({ file: m.file.slice(0, 4), n, head, ms: Math.round(performance.now() - s0), locks: [...new Set(locks)] });
    }
  }
  running = false;
  await writer;

  const perFile = new Map<string, number>();
  for (const r of report) perFile.set(r.file, (perFile.get(r.file) ?? 0) + r.ms);
  for (const r of report.filter((x) => x.locks.length || x.ms > 50)) {
    console.log(`${r.file}#${String(r.n).padStart(2)} ${String(r.ms).padStart(6)} ms  ${r.locks.join(', ').padEnd(90)} ${r.head}`);
  }
  const versions = (await sql`select version from public._schema_version where version ~ '^01(4[4-9]|5[0-8])' order by 1`).map((v) => String(v.version));
  assert.equal(versions.length, 15, versions.join(','));
  const [readbacks] = await sql`select to_regclass('billing_gateway.renewal_api_readbacks') is not null as ok`;
  assert.ok(readbacks!.ok, 'candidata do #53 aplicada');
  const [chk] = await sql`select (select count(*) from public.appointments where billing_mode <> 'particular')::int as not_particular,
      (select count(*) from public.lancamentos where valor_glosado <> 0 or source_hi_guide_id is not null)::int as touched,
      (select bool_and(convalidated) from pg_constraint where conrelid in ('public.lancamentos'::regclass, 'public.appointments'::regclass, 'public.hi_appointment_coverages'::regclass) and contype in ('c', 'f')) as validated`;
  assert.deepEqual([chk!.not_particular, chk!.touched, chk!.validated], [0, 0, true]);
  const total = report.reduce((a, r) => a + r.ms, 0);
  console.log(JSON.stringify({
    rows: ROWS, statements: report.length, totalMs: total, perMigrationMs: Object.fromEntries(perFile),
    concurrentWrites: writes, maxConcurrentWriteWaitMs: Math.round(maxWaitMs), versions,
  }, null, 2));
  console.log(`\nOK — 0144→0158 + candidata do #53 aplicadas sobre ${ROWS} lançamentos e ${Math.floor(ROWS / 2)} atendimentos: ${total} ms; escrita particular concorrente esperou no máximo ${Math.round(maxWaitMs)} ms; particular inalterado.`);
} finally {
  await cluster.stop();
}
