/**
 * P14.4 — metas de desempenho da H.2 medidas com o código real, em Postgres 17 DESCARTÁVEL
 * (migrations reais) e no processo local. Sintético: nenhum dado real, nenhuma rede externa.
 *
 * Mede e compara com a meta (a prova falha se a meta não for cumprida, com o número):
 *   1. importação da TUSS 22 (e da terminologia inteira), pelo mesmo núcleo do operador do DEV;
 *   2. pico de 50 conclusões por minuto, 3 minutos seguidos, pelo caminho real (transição da
 *      agenda → evento → tick do cron com os parâmetros de produção → guia), sem atraso acumulado;
 *   3. lista de faturamento com 10 mil guias e filtros (`listGuides` real, RLS), p95;
 *   4. XML de lote com 100 guias (consulta e SP/SADT) gerado e validado no XSD, tempo e memória;
 *   5. validação de XML com 1.000 guias;
 *   6. PDF de guia (consulta e SP/SADT com itens).
 * A latência conclusão → guia no Preview real (cron de 1 minuto) é medida à parte, só leitura.
 *
 *   SECURITY_PG_BIN=... PORT=55564 NODE_OPTIONS="--import ./scripts/security/server-only-hook.mjs" \
 *     npx tsx --tsconfig tsconfig.scripts.json scripts/security/health-insurance-performance-db.ts
 *
 * Fora do CI: TISS_XMLLINT_WASM_DIR=<pasta com xmllint-wasm 5.3.0>. Saída JSON opcional: --out <arquivo>.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55564);
const cluster = await startScratchSchema({ port: PORT, maxConnections: 24 });
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

const { withTenant } = await import('../../src/lib/db/tenant');
await import('../../src/app/api/cron/outbox/handlers');
const { runOutboxOnce, runOutboxEventsNow } = await import('../../src/lib/outbox/worker');
const { applyTransition } = await import('../../src/contexts/scheduling/internal/appointment-core');
const { recordSchedulingCoverage } = await import('../../src/contexts/health-insurance/scheduling-coverage');
const { listGuides } = await import('../../src/contexts/health-insurance/queries');
const { loadXmllintValidator } = await import('../../src/contexts/health-insurance/tiss/xml/xsd-validator');
const { consultaGuide, sadtGuide, sadtItem } = await import('../../src/contexts/health-insurance/tiss/corpus/fixtures');
const { renderGuidePdf } = await import('../../src/contexts/health-insurance/tiss/print/render');
const { consultaPrintView, spSadtCobrancaPrintView } = await import('../../src/contexts/health-insurance/tiss/print/values');
const { loadTerminologyTx, readTerminologyArtifacts } = await import('../tiss/terminology/load-core');
const { loadHiFixtures, SYS_ACTOR } = await import('./hi-fixtures');

const outIdx = process.argv.indexOf('--out');
const outFile = outIdx >= 0 ? process.argv[outIdx + 1] : null;
const xsd = loadXmllintValidator();
if (!xsd) throw new Error('validador XSD do app indisponível (TISS_XMLLINT_WASM_DIR fora do CI)');
const objects = new Map<string, Uint8Array>();
const fx = await loadHiFixtures(sql, {
  store: { put: async (r: string, b: Uint8Array) => void objects.set(r, b), get: async (r: string) => objects.get(r)!, remove: async (r: string) => void objects.delete(r) },
  validateXsd: xsd,
});

const results: Record<string, unknown> = { at: new Date().toISOString(), node: process.version, platform: `${process.platform}/${process.arch}` };
let passed = 0;
const pass = (m: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${m}`);
};
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};
const ms = (x: number) => Math.round(x * 10) / 10;
const ROLLBACK = new Error('rollback da medição');

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;

  // ── 1. TUSS 22 (meta ≤ 30 s) e a terminologia inteira, desfeitas no fim (o banco segue limpo).
  const artifacts = readTerminologyArtifacts('202609');
  const tuss: Record<string, unknown> = {};
  for (const [label, only] of [['tuss22', ['22']], ['todas', undefined]] as const) {
    let took = 0;
    let terms = 0;
    await sql
      .begin(async (tx) => {
        const t0 = performance.now();
        const out = await loadTerminologyTx(tx as never, artifacts, only ? { onlyTables: only } : {});
        took = performance.now() - t0;
        terms = out.terms;
        throw ROLLBACK;
      })
      .catch((e: unknown) => {
        if (e !== ROLLBACK) throw e;
      });
    tuss[label] = { termos: terms, ms: ms(took) };
  }
  results.tuss = tuss;
  const t22 = tuss.tuss22 as { termos: number; ms: number };
  assert.ok(t22.termos > 5000 && t22.ms <= 30_000, `TUSS 22: ${JSON.stringify(t22)}`);
  pass(`importação da TUSS 22: ${t22.termos} termos em ${t22.ms} ms (meta ≤ 30 s); terminologia inteira ${JSON.stringify(tuss.todas)}`);

  await fx.seedTerminology();
  const C = await fx.setupClinic('Desempenho');
  const asUser = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(C.clinicId, fn, C.doctorId);
  const [proc] = await sql`select id::text from public.procedures where clinic_id = ${C.clinicId}::uuid limit 1`;
  const rc = { requestId: 'p14-4', ip: null, userAgent: null, correlationId: null } as never;

  // ── 2. Pico: 50 conclusões por minuto, 3 minutos seguidos (meta: nenhum atraso acumulado
  // > 5 min). Caminho de produção (`completeConsulta`): a guia nasce do evento da PRÓPRIA
  // conclusão, processado logo depois da resposta (`processOutboxSoon` → `runOutboxEventsNow`);
  // o cron de 1 minuto (`runOutboxOnce`) é a reserva e leva os demais eventos da conclusão
  // (chegada, início, conclusão: recebível particular, prontuário rascunho). Duas rodadas:
  //   A) parâmetros de produção (lote 50, paralelismo 5): o número é registrado como está;
  //   B) lote 200 (só a variável de ambiente `OUTBOX_BATCH_SIZE`): a correção proposta, que a
  //      prova exige cumprir a meta.
  const WAVES = 3;
  const PER_WAVE = 50;
  const ROUNDS = [
    { label: 'producao', batchSize: 50, parallelism: 5 },
    { label: 'lote200', batchSize: 200, parallelism: 5 },
  ] as const;
  const people: Array<{ appts: string[] }> = [];
  for (let i = 0; i < PER_WAVE; i++) {
    const [pt] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
      values (${C.clinicId}::uuid, ${`Paciente Pico ${i}`}, 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id::text`;
    const [card] = await sql`insert into public.hi_memberships (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
      values (${C.clinicId}::uuid, ${pt!.id}::uuid, ${C.insurerId}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${randomUUID().replace(/-/g, '').padEnd(64, '0')}, '7777', ${SYS_ACTOR}::uuid)
      returning id::text`;
    const appts: Array<{ id: string; date: string }> = [];
    for (let w = 0; w < WAVES * ROUNDS.length; w++) {
      // Mesmo dia local (America/Sao_Paulo): 00h00 + 28 min por paciente, 25 min cada, sem sobreposição da médica.
      const date = new Date(Date.UTC(2026, 10, 2 + 3 * w)).toISOString().slice(0, 10);
      const at = new Date(Date.UTC(2026, 10, 2 + 3 * w, 3, 0) + i * 28 * 60_000).toISOString();
      const [a] = await sql`insert into public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
          snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via, billing_mode)
        values (${C.clinicId}::uuid, ${C.doctorId}::uuid, ${pt!.id}::uuid, ${proc!.id}::uuid, ${at}::timestamptz, 25, 'agendado', 150,
          'Consulta', 150, 25, 'Dra. Sintética', 'attendant', 'convenio') returning id::text`;
      appts.push({ id: String(a!.id), date });
    }
    const cov = await recordSchedulingCoverage({
      clinicId: C.clinicId, userId: C.doctorId, patientId: String(pt!.id), procedureId: String(proc!.id), appointments: appts,
      choice: { insurerId: C.insurerId, planId: null, membershipId: String(card!.id), guideType: 'consulta' }, requestContext: rc,
    });
    assert.ok(cov, 'cobertura gravada');
    people.push({ appts: appts.map((a) => a.id) });
  }
  const complete = async (appointmentId: string) => {
    for (const target of ['chegou', 'em_atendimento'] as const) {
      await asUser((tx) => applyTransition(tx, { clinicId: C.clinicId, appointmentId, target, transitionedBy: C.doctorId, actorType: 'user', clientKey: `${target}-${appointmentId}`, correlationId: null }));
    }
    await sql`insert into public.prontuarios (clinic_id, patient_id, doctor_id, appointment_id, status, signed_at, signed_by, content_encrypted)
      values (${C.clinicId}::uuid, (select patient_id from public.appointments where id = ${appointmentId}::uuid), ${C.doctorId}::uuid, ${appointmentId}::uuid, 'assinado', now(), ${C.doctorId}::uuid, 'ciphertext-sintetico')`;
    await asUser((tx) => applyTransition(tx, { clinicId: C.clinicId, appointmentId, target: 'atendido', transitionedBy: C.doctorId, actorType: 'user', clientKey: `concluir-${appointmentId}`, correlationId: null }));
  };
  const INSURANCE_COMPLETED = 'scheduling.appointment.insurance_completed';
  const pending = async () => Number((await sql`select count(*)::int as n from public.outbox where status = 'pending'`)[0]!.n);
  const dbNow = async () => String((await sql`select clock_timestamp()::text as t`)[0]!.t);
  const peak: Record<string, unknown> = {};
  for (const [r, round] of ROUNDS.entries()) {
    const waves: Array<Record<string, unknown>> = [];
    const guideLatency: number[] = [];
    // Relógio simulado: a onda w acontece no minuto w; o tick do fim dela é o minuto w + 1; cada
    // tick extra, mais um minuto. Atraso de um evento = minuto do tick que o tratou − minuto da onda.
    const waveStart: string[] = [];
    const tickEnd: string[] = [];
    for (let w = 0; w < WAVES; w++) {
      waveStart.push(await dbNow());
      const t0 = performance.now();
      for (const p of people) {
        const id = p.appts[r * WAVES + w]!;
        const tc = performance.now();
        await complete(id);
        await runOutboxEventsNow([{ eventType: INSURANCE_COMPLETED, idempotencyKeys: [`concluir-${id}:atendido:convenio`] }]);
        const [g] = await sql`select count(*)::int as n from public.hi_guide_items where appointment_id = ${id}::uuid`;
        assert.ok(Number(g!.n) > 0, `guia da conclusão ${id}`);
        guideLatency.push(performance.now() - tc);
      }
      const completedMs = performance.now() - t0;
      const before = await sql`select event_type, count(*)::int as n from public.outbox where status = 'pending' group by 1 order by 1`;
      const t1 = performance.now();
      const tick = await runOutboxOnce({ batchSize: round.batchSize, parallelism: round.parallelism });
      tickEnd.push(await dbNow());
      waves.push({
        onda: w + 1, conclusoesMs: ms(completedMs), pendentesAntesDoTick: Object.fromEntries(before.map((x) => [x.event_type, x.n])),
        tickMs: ms(performance.now() - t1), tratadosNoTick: tick.processed + tick.skipped, falhasNoTick: tick.failed, pendentesDepoisDoTick: await pending(),
      });
    }
    // Depois do pico, cada tick é mais um minuto de cron: quanto falta para a fila esvaziar?
    let extraMinutes = 0;
    while ((await pending()) > 0 && extraMinutes < 30) {
      await runOutboxOnce({ batchSize: round.batchSize, parallelism: round.parallelism });
      tickEnd.push(await dbNow());
      extraMinutes += 1;
    }
    const events = await sql`select created_at::text as c, processed_at::text as p from public.outbox
      where created_at >= ${waveStart[0]!}::timestamptz and event_type <> ${INSURANCE_COMPLETED} and processed_at is not null`;
    const minuteOf = (ts: string, marks: string[]) => marks.findIndex((m) => ts <= m);
    let worstDelay = 0;
    for (const e of events) {
      const createdIn = waveStart.findLastIndex((m) => String(e.c) >= m);
      const handledAt = minuteOf(String(e.p), tickEnd) + 1;
      worstDelay = Math.max(worstDelay, handledAt - createdIn);
    }
    const [failed] = await sql`select count(*)::int as n from public.outbox where status in ('pending', 'failed')`;
    peak[round.label] = {
      tick: { lote: round.batchSize, paralelismo: round.parallelism, cron: '1 min' },
      ondas: waves,
      conclusaoParaGuia: { p50: ms(pct(guideLatency, 50)), p95: ms(pct(guideLatency, 95)), max: ms(Math.max(...guideLatency)), n: guideLatency.length },
      eventosDaReserva: events.length,
      piorAtrasoMin: worstDelay,
      minutosExtrasDeCron: extraMinutes,
      sobrouPendenteOuFalho: Number(failed!.n),
      piorTickMs: Math.max(...waves.map((x) => Number(x.tickMs))),
    };
    assert.equal(Number(failed!.n), 0, `${round.label}: sobrou evento pendente ou falho`);
    assert.ok(pct(guideLatency, 95) <= 120_000, `${round.label}: conclusão → guia`);
  }
  const [guidesMade] = await sql`select count(distinct g.id)::int as n from public.hi_guides g join public.hi_guide_items i on i.guide_id = g.id
    join public.appointments a on a.id = i.appointment_id where a.clinic_id = ${C.clinicId}::uuid and a.status = 'atendido'`;
  assert.equal(Number(guidesMade!.n), WAVES * PER_WAVE * ROUNDS.length);
  results.pico = peak;
  const prod = peak.producao as { piorAtrasoMin: number; conclusaoParaGuia: { p95: number }; minutosExtrasDeCron: number };
  const fixed = peak.lote200 as { piorAtrasoMin: number; piorTickMs: number };
  pass(`conclusão → guia no pico: p95 ${prod.conclusaoParaGuia.p95} ms (meta ≤ 2 min; a guia sai do evento da própria conclusão, sem esperar o cron)`);
  if (prod.piorAtrasoMin > 5) {
    console.log(`DESVIO: com os parâmetros de produção (lote 50/min) o pico deixa ${prod.minutosExtrasDeCron} min de fila nos demais eventos: pior atraso ${prod.piorAtrasoMin} min (meta ≤ 5)`);
  }
  assert.ok(fixed.piorAtrasoMin <= 5 && fixed.piorTickMs < 60_000, `lote 200: ${JSON.stringify(fixed)}`);
  pass(`pico com OUTBOX_BATCH_SIZE=200: pior atraso ${fixed.piorAtrasoMin} min, pior tick ${fixed.piorTickMs} ms (meta ≤ 5 min); produção atual (50): ${prod.piorAtrasoMin} min (${prod.piorAtrasoMin > 5 ? 'DESVIO registrado' : 'dentro da meta'})`);

  // ── 3. Lista de faturamento com 10 mil guias (meta p95 ≤ 800 ms), pelo `listGuides` real (RLS).
  const TARGET = 10_000;
  await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
    select ${C.clinicId}::uuid, 'Paciente Volume ' || n, 'ciphertext-de-teste', 'hash-vol-' || n || '-' || gen_random_uuid() from generate_series(1, 2000) n`;
  const [ins2] = await sql`insert into public.hi_insurers (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, status, created_by)
    values (${C.clinicId}::uuid, 'Operadora Dois', '654321', 'codigoPrestadorNaOperadora', 'TESTE002', 'active', ${SYS_ACTOR}::uuid) returning id::text`;
  const cols = (await sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'hi_guides' order by ordinal_position`).map((c) => String(c.column_name));
  // Modelo: uma guia EMITIDA pelo fluxo real (conferência e aprovação preenchidas), copiada com o
  // estado e os campos que cada estado exige (as CHECK da tabela continuam valendo na carga).
  const templateId = await C.approvedGuide();
  const [have] = await sql`select count(*)::int as n from public.hi_guides where clinic_id = ${C.clinicId}::uuid`;
  const missing = TARGET - Number(have!.n);
  const statuses = ['pending_data', 'ready_for_review', 'reviewed', 'approved', 'in_batch', 'exported', 'sent', 'under_review', 'paid', 'partially_paid', 'partially_glossed', 'fully_glossed', 'closed', 'cancelled'];
  const override: Record<string, string> = {
    id: 'gen_random_uuid()',
    idempotency_key: `'volume-' || n`,
    number: `'VOL' || lpad(n::text, 8, '0')`,
    status: 's.st',
    live: "s.st <> 'cancelled'",
    issues: "'[]'::jsonb",
    cancelled_at: "case when s.st = 'cancelled' then now() end",
    cancelled_by: "case when s.st = 'cancelled' then g.approved_by end",
    cancel_reason: "case when s.st = 'cancelled' then 'Cancelamento sintético do volume de medição' end",
    patient_id: `(select id from public.patients where clinic_id = g.clinic_id and nome = 'Paciente Volume ' || (1 + n % 2000) limit 1)`,
    insurer_id: `case when n % 3 = 0 then '${String(ins2!.id)}'::uuid else g.insurer_id end`,
    created_at: `now() - (n || ' minutes')::interval`,
    updated_at: `now() - (n || ' minutes')::interval`,
    replaces_guide_id: 'null',
  };
  const selectList = cols.map((c) => override[c] ?? `g.${c}`).join(', ');
  const t0Seed = performance.now();
  await sql.begin(async (tx) => {
    // Só a carga do volume (dado de leitura): sem gatilhos de transição; índices e chaves valem.
    await tx`set local session_replication_role = replica`;
    await tx.unsafe(`insert into public.hi_guides (${cols.join(', ')})
      select ${selectList} from public.hi_guides g, generate_series(1, ${missing}) n
        cross join lateral (select ('{${statuses.join(',')}}'::text[])[1 + (n % ${statuses.length})] as st) s
       where g.id = '${templateId}'::uuid`);
  });
  await sql`analyze public.hi_guides`;
  await sql`analyze public.patients`;
  const [total] = await sql`select count(*)::int as n from public.hi_guides where clinic_id = ${C.clinicId}::uuid`;
  assert.equal(Number(total!.n), TARGET);
  const view = { scope: { kind: 'clinic' as const }, values: true };
  const filters: Array<[string, Parameters<typeof listGuides>[1]]> = [
    ['sem filtro', {}],
    ['pendentes', { status: 'pendentes' }],
    ['faturadas', { status: 'faturadas' }],
    ['operadora', { insurerId: String(ins2!.id) }],
    ['operadora + desfecho', { insurerId: C.insurerId, status: 'desfecho' }],
    ['busca pelo número', { q: 'VOL00004' }],
    ['busca pelo paciente', { q: 'Volume 1234' }],
    ['página 100', { page: 100 }],
  ];
  const list: Record<string, unknown> = {};
  const all: number[] = [];
  for (const [label, f] of filters) {
    await listGuides(C.clinicId, f, view); // aquece o plano
    const xs: number[] = [];
    let n = 0;
    for (let i = 0; i < 30; i++) {
      const t = performance.now();
      const r = await listGuides(C.clinicId, f, view);
      xs.push(performance.now() - t);
      n = r.total;
    }
    all.push(...xs);
    list[label] = { total: n, p50: ms(pct(xs, 50)), p95: ms(pct(xs, 95)), max: ms(Math.max(...xs)) };
  }
  results.lista = { guias: TARGET, cargaMs: ms(performance.now() - t0Seed), porFiltro: list, p95Geral: ms(pct(all, 95)) };
  const worstP95 = Math.max(...Object.values(list).map((v) => (v as { p95: number }).p95));
  assert.ok(worstP95 <= 800, `lista: pior p95 ${worstP95} ms`);
  pass(`lista de faturamento com ${TARGET} guias: pior p95 entre ${filters.length} filtros = ${worstP95} ms, p95 geral ${ms(pct(all, 95))} ms (meta ≤ 800 ms)`);

  // ── 4 e 5. XML em processo Node LIMPO (`health-insurance-performance-xml.ts`), um por modo, para
  // a memória ser a do trabalho (como uma função que só exporta) e não a do harness.
  const child = (mode: 'lote' | 'mil') => {
    const r = spawnSync(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), '--tsconfig', 'tsconfig.scripts.json', 'scripts/security/health-insurance-performance-xml.ts', mode], {
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '--import ./scripts/security/server-only-hook.mjs' },
      timeout: 300_000,
    });
    if (r.status !== 0) throw new Error(`XML (${mode}) falhou: ${(r.stderr ?? '').slice(-400)}`);
    return JSON.parse(r.stdout.trim().split('\n').at(-1)!) as Record<string, unknown>;
  };
  const lote = child('lote') as { lote100: Record<string, { primeiraMs: number }>; rssPicoMb: number };
  const mil = child('mil') as { mil: { bytes: number; ms: number }; rssPicoMb: number };
  results.xml = { lote, mil };
  const worst100 = Math.max(...Object.values(lote.lote100).map((v) => v.primeiraMs));
  assert.ok(worst100 <= 5_000 && lote.rssPicoMb < 256, `XML 100: ${worst100} ms, ${lote.rssPicoMb} MB`);
  pass(`XML de lote com 100 guias gerado + validado: pior ${worst100} ms (meta ≤ 5 s); pico de memória do processo ${lote.rssPicoMb} MB (meta < 256 MB)`);
  assert.ok(mil.mil.ms <= 15_000);
  pass(`validação de um demonstrativo com 1.000 guias (${Math.round(mil.mil.bytes / 1024)} KB): ${mil.mil.ms} ms (meta ≤ 15 s), pico ${mil.rssPicoMb} MB`);

  // ── 6. PDF de guia (meta ≤ 2 s): consulta e SP/SADT com 10 itens, frio e quente.
  const PRINT = { schema: 'qoro.hi.guide-print/1', beneficiarioNome: 'Maria Sintética', nomeSocial: null, contratadoNome: 'Clínica Sintética Ltda', operadoraNome: 'Operadora Sintética S.A.' } as const;
  const views = {
    consulta: consultaPrintView(consultaGuide(1), PRINT),
    sp_sadt: spSadtCobrancaPrintView(sadtGuide(1, { procedimentos: Array.from({ length: 10 }, (_, k) => sadtItem(k + 1)) }), PRINT),
  };
  const pdf: Record<string, unknown> = {};
  for (const [label, v] of Object.entries(views)) {
    const runs: number[] = [];
    for (let i = 0; i < 6; i++) {
      const t = performance.now();
      const out = await renderGuidePdf(v, { guideNumber: v.fields[2]!, revision: 1, snapshotSha256: 'c'.repeat(64), software: { name: 'Qoro', version: 'p14.4' } });
      runs.push(performance.now() - t);
      assert.ok(out.pdf.length > 1000);
    }
    pdf[label] = { primeiroMs: ms(runs[0]!), seguintesP95Ms: ms(pct(runs.slice(1), 95)) };
  }
  results.pdf = pdf;
  const worstPdf = Math.max(...Object.values(pdf).map((v) => (v as { primeiroMs: number }).primeiroMs));
  assert.ok(worstPdf <= 2_000, `PDF: ${worstPdf} ms`);
  pass(`PDF de guia: pior ${worstPdf} ms (meta ≤ 2 s): ${JSON.stringify(pdf)}`);

  console.log(JSON.stringify(results, null, 1));
  console.log(`\n${passed}/7 provas de desempenho (P14.4) passaram; desvios registrados acima, se houver.`);
} finally {
  // Os números ficam gravados mesmo quando uma meta falha (o desvio é o que se registra).
  if (outFile) writeFileSync(outFile, JSON.stringify(results, null, 1));
  await cluster.stop();
}
process.exit(0);
