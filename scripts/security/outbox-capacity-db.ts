/**
 * Capacidade do outbox compartilhado (P14.4, desvio do pico): benchmark controlado com o worker REAL
 * (`runOutboxOnce`, o mesmo do cron), os handlers reais da conclusão do atendimento e Postgres 17
 * DESCARTÁVEL com as migrations reais. Sintético: nenhum dado real, nenhuma rede externa, nenhum
 * pagamento. Nada aqui muda configuração de produção: o lote e o paralelismo são passados ao tick.
 *
 * Fidelidade:
 *   - LATÊNCIA DE REDE: o app fala com o banco por um proxy TCP local que atrasa cada pacote (ida e
 *     volta), porque o worker reserva e finaliza TODOS os eventos por UMA conexão (`dbWorker`, pool 2:
 *     1 segura o lock, 1 trabalha): o custo do tick cresce com lote × latência, e banco local sem
 *     latência esconderia isso. O atraso só vale durante o tick (a montagem roda sem atraso);
 *   - TEMPO SIMULADO: cada "minuto" = as conclusões daquele minuto + UM tick (o cron é de 1 minuto).
 *     Antes de cada tick o relógio da fila anda 60 s (`next_attempt_at`), para backoff e retentativa
 *     valerem como em produção. Atraso de um evento = minuto do tick que o tratou − minuto em que nasceu;
 *   - CAMINHO REAL: transições da agenda (chegou → em atendimento → atendido) publicam os eventos; a
 *     guia do convênio sai do evento da própria conclusão processado na hora (`completeConsulta`), o
 *     resto vai para o cron. Particular gera o recebível pelo handler financeiro real;
 *   - EVENTOS SINTÉTICOS só neste processo (tipos `benchmark.*`, registrados aqui): lentos (consumidor
 *     de rede), com falha transitória (recuperação por retentativa) e veneno (falha definitiva).
 *
 * Integridade conferida em cada rodada: nenhum evento perdido, nenhum recebível/guia/prontuário
 * duplicado, nada processado com a clínica errada, nada preso em `processing`.
 *
 *   SECURITY_PG_BIN=... PORT=55565 OUTBOX_BENCH=full|smoke NODE_OPTIONS="--import ./scripts/security/server-only-hook.mjs" \
 *     npx tsx --tsconfig tsconfig.scripts.json scripts/security/outbox-capacity-db.ts --out <arquivo.json>
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import net from 'node:net';
import { performance } from 'node:perf_hooks';

import { startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55565);
const MODE = process.env.OUTBOX_BENCH === 'smoke' ? 'smoke' : 'full';
const cluster = await startScratchSchema({ port: PORT, maxConnections: 40 });
const { sql } = cluster;
if (!new RegExp(`@(?:127\\.0\\.0\\.1|localhost):${PORT}/`, 'u').test(cluster.url)) throw new Error('não é o cluster local');

// ── Proxy de latência: cada pacote sai `delay` ms depois de chegar, na ordem, nos dois sentidos.
const proxyState = { oneWayMs: 0 };
const PROXY_PORT = PORT + 100;
const proxy = net.createServer((client) => {
  const upstream = net.connect(PORT, '127.0.0.1');
  const pipe = (from: net.Socket, to: net.Socket) => {
    let chain = Promise.resolve();
    from.on('data', (chunk) => {
      const due = Date.now() + proxyState.oneWayMs;
      chain = chain.then(async () => {
        const wait = due - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (!to.destroyed) to.write(chunk);
      });
    });
    from.on('close', () => void chain.then(() => to.destroy()));
    from.on('error', () => to.destroy());
  };
  pipe(client, upstream);
  pipe(upstream, client);
});
await new Promise<void>((r) => proxy.listen(PROXY_PORT, '127.0.0.1', r));
const proxied = cluster.url.replace(`:${PORT}/`, `:${PROXY_PORT}/`);

process.env.DATABASE_URL = proxied;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.OUTBOX_CRON_ALLOW_NON_VERCEL = 'true';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');
process.env.LOG_LEVEL = 'error';

const { withTenant } = await import('../../src/lib/db/tenant');
const { dbWorker } = await import('../../src/lib/db');
const { sql: dsql } = await import('drizzle-orm');
await import('../../src/app/api/cron/outbox/handlers');
const { runOutboxOnce, runOutboxEventsNow } = await import('../../src/lib/outbox/worker');
const { registerEventSchema } = await import('../../src/lib/outbox/catalog');
const { registerDetachedHandler } = await import('../../src/lib/outbox/registry');
const { PoisonPillError } = await import('../../src/lib/outbox/errors');
const { applyTransition } = await import('../../src/contexts/scheduling/internal/appointment-core');
const { recordSchedulingCoverage } = await import('../../src/contexts/health-insurance/scheduling-coverage');
const { loadXmllintValidator } = await import('../../src/contexts/health-insurance/tiss/xml/xsd-validator');
const { z } = await import('zod');
const { loadHiFixtures, SYS_ACTOR } = await import('./hi-fixtures');

const fx = await loadHiFixtures(sql, {
  store: { put: async () => {}, get: async () => new Uint8Array(), remove: async () => {} },
  validateXsd: (loadXmllintValidator() ?? null) as never,
});

// ── Consumidores sintéticos (só neste processo).
const SLOW = 'benchmark.consumer.slow';
const FLAKY = 'benchmark.consumer.flaky';
const POISON = 'benchmark.consumer.poison';
const benchPayload = z.object({ n: z.number(), ms: z.number() });
for (const t of [SLOW, FLAKY, POISON]) registerEventSchema(t, benchPayload);
registerDetachedHandler<{ n: number; ms: number }>(SLOW, async ({ payload }) => {
  await new Promise((r) => setTimeout(r, payload.ms));
});
registerDetachedHandler<{ n: number; ms: number }>(FLAKY, async ({ attempt }) => {
  if (attempt === 1) throw new Error('falha transitória sintética');
});
registerDetachedHandler<{ n: number; ms: number }>(POISON, async () => {
  throw new PoisonPillError('evento sintético inválido', 'benchmark_poison');
});

const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};
const r1 = (x: number) => Math.round(x * 10) / 10;
const INSURANCE_COMPLETED = 'scheduling.appointment.insurance_completed';
const rc = { requestId: 'outbox-bench', ip: null, userAgent: null, correlationId: null } as never;

await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
await fx.seedTerminology();

interface Clinic { clinicId: string; doctorId: string; insurerId: string; procId: string; nextSlot: number }
let dayOffset = 0;
async function newClinic(label: string): Promise<Clinic> {
  const c = await fx.setupClinic(label);
  const [proc] = await sql`select id::text from public.procedures where clinic_id = ${c.clinicId}::uuid limit 1`;
  return { clinicId: c.clinicId, doctorId: c.doctorId, insurerId: c.insurerId, procId: String(proc!.id), nextSlot: 0 };
}
/** Atendimento agendado (convênio com cobertura pela função da agenda, ou particular), sem sobrepor a médica. */
async function newAppointment(c: Clinic, convenio: boolean): Promise<string> {
  const slot = c.nextSlot++;
  const at = new Date(Date.UTC(2026, 10, 1) + (dayOffset * 2 + slot) * 26 * 60_000).toISOString();
  const date = at.slice(0, 10);
  const [pt] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
    values (${c.clinicId}::uuid, ${`Paciente Fila ${slot}`}, 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id::text`;
  const [a] = await sql`insert into public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
      snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via, billing_mode)
    values (${c.clinicId}::uuid, ${c.doctorId}::uuid, ${pt!.id}::uuid, ${c.procId}::uuid, ${at}::timestamptz, 25, 'agendado', 150,
      'Consulta', 150, 25, 'Dra. Sintética', 'attendant', ${convenio ? 'convenio' : 'particular'}) returning id::text`;
  if (convenio) {
    const [card] = await sql`insert into public.hi_memberships (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
      values (${c.clinicId}::uuid, ${pt!.id}::uuid, ${c.insurerId}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${randomUUID().replace(/-/g, '').padEnd(64, '0')}, '7777', ${SYS_ACTOR}::uuid)
      returning id::text`;
    await recordSchedulingCoverage({
      clinicId: c.clinicId, userId: c.doctorId, patientId: String(pt!.id), procedureId: c.procId, appointments: [{ id: String(a!.id), date }],
      choice: { insurerId: c.insurerId, planId: null, membershipId: String(card!.id), guideType: 'consulta' }, requestContext: rc,
    });
  }
  return String(a!.id);
}
async function complete(c: Clinic, appointmentId: string, convenio: boolean) {
  const as = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(c.clinicId, fn, c.doctorId);
  for (const target of ['chegou', 'em_atendimento'] as const) {
    await as((tx) => applyTransition(tx, { clinicId: c.clinicId, appointmentId, target, transitionedBy: c.doctorId, actorType: 'user', clientKey: `${target}-${appointmentId}`, correlationId: null }));
  }
  await sql`insert into public.prontuarios (clinic_id, patient_id, doctor_id, appointment_id, status, signed_at, signed_by, content_encrypted)
    values (${c.clinicId}::uuid, (select patient_id from public.appointments where id = ${appointmentId}::uuid), ${c.doctorId}::uuid, ${appointmentId}::uuid, 'assinado', now(), ${c.doctorId}::uuid, 'ciphertext-sintetico')`;
  await as((tx) => applyTransition(tx, { clinicId: c.clinicId, appointmentId, target: 'atendido', transitionedBy: c.doctorId, actorType: 'user', clientKey: `concluir-${appointmentId}`, correlationId: null }));
  // Caminho de produção (`completeConsulta`): a guia sai do evento da própria conclusão, logo depois da resposta.
  if (convenio) await runOutboxEventsNow([{ eventType: INSURANCE_COMPLETED, idempotencyKeys: [`concluir-${appointmentId}:atendido:convenio`] }]);
}
async function insertSynthetic(clinicId: string, type: string, n: number, ms: number) {
  for (let i = 0; i < n; i++) {
    await sql`insert into public.outbox (clinic_id, event_type, payload, payload_hash, idempotency_key)
      values (${clinicId}::uuid, ${type}, ${sql.json({ n: i, ms })}, ${'0'.repeat(64)}, ${`bench-${type}-${randomUUID()}`})`;
  }
}
const pendingNow = async () => Number((await sql`select count(*)::int as n from public.outbox where status = 'pending'`)[0]!.n);
/**
 * O relógio da fila anda 1 minuto: TODAS as marcas de tempo de TODAS as linhas recuam 60 s juntas
 * (equivale a "agora" avançar), então backoff, retentativa e a janela de 5 min do circuito
 * (`circuit.ts`, `last_failed_at`) valem como em produção e a ordem temporal da linha
 * (`outbox_temporal_chk`) continua válida.
 */
const advanceMinute = () => sql`update public.outbox set
    created_at = created_at - interval '60 seconds',
    next_attempt_at = next_attempt_at - interval '60 seconds',
    processing_started_at = processing_started_at - interval '60 seconds',
    processed_at = processed_at - interval '60 seconds',
    first_failed_at = first_failed_at - interval '60 seconds',
    last_failed_at = last_failed_at - interval '60 seconds'`;

/** Ida e volta EFETIVA pelo proxy (o temporizador do sistema pode arredondar o atraso pedido). */
async function measuredRttMs(oneWayMs: number): Promise<number> {
  proxyState.oneWayMs = oneWayMs;
  const xs: number[] = [];
  for (let i = 0; i < 15; i++) {
    const t = performance.now();
    await dbWorker.execute(dsql`select 1`);
    xs.push(performance.now() - t);
  }
  proxyState.oneWayMs = 0;
  return r1(pct(xs, 50)!);
}

/**
 * O que o cron faria em cada invocação. `reserveMs`: prazo de reserva (R61) a partir do início do
 * tick; `skipUnhandled`: descarte em bloco dos eventos sem consumidor (R61). Sem os dois = atual.
 */
interface Strategy {
  label: string;
  batchSize: number;
  parallelism: number;
  reserveMs?: number;
  skipUnhandled?: boolean;
}
const strategyOpts = (st: Strategy) => ({
  batchSize: st.batchSize,
  parallelism: st.parallelism,
  ...(st.reserveMs !== undefined ? { reserveUntil: Date.now() + st.reserveMs } : {}),
  ...(st.skipUnhandled ? { skipUnhandledInBulk: true } : {}),
});

/** Um tick com a latência ligada e amostragem de conexões e locks esperando. */
async function tick(st: Strategy, oneWayMs: number) {
  let maxConn = 0;
  let maxWaiting = 0;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const [s] = await sql`select (select count(*)::int from pg_stat_activity where datname = current_database() and state <> 'idle') as active,
          (select count(*)::int from pg_locks where not granted) as waiting`;
      maxConn = Math.max(maxConn, Number(s!.active));
      maxWaiting = Math.max(maxWaiting, Number(s!.waiting));
      await new Promise((r) => setTimeout(r, 25));
    }
  })();
  proxyState.oneWayMs = oneWayMs;
  const t0 = performance.now();
  const summary = await runOutboxOnce(strategyOpts(st));
  const ms = performance.now() - t0;
  proxyState.oneWayMs = 0;
  sampling = false;
  await sampler;
  const bulk = summary.skipped_bulk ?? 0;
  return {
    ms: r1(ms), handled: summary.processed + summary.skipped + summary.failed + bulk, processed: summary.processed,
    skipped: summary.skipped, skippedBulk: bulk, failed: summary.failed, deferred: summary.deferred ?? 0, maxConn, maxWaiting,
  };
}

interface Scenario {
  name: string;
  minutes: number;
  perMinute: number;
  clinics: number;
  convenioShare: number;
  slowPerMinute?: { n: number; ms: number };
  flakyPerMinute?: number;
  poisonPerMinute?: number;
}
async function runScenario(s: Scenario, st: Strategy, oneWayMs: number) {
  const batchSize = st.batchSize;
  const parallelism = st.parallelism;
  // Fila limpa antes (o que sobrou de outra rodada sai sem latência, fora da medição) e as linhas já
  // tratadas saem da tabela: tudo o que estiver no outbox depois disso é desta rodada.
  for (let i = 0; i < 200 && (await pendingNow()) > 0; i++) {
    await advanceMinute();
    await runOutboxOnce({ batchSize: 500, parallelism: 10 });
  }
  await sql`delete from public.outbox`;
  const bornMinute = new Map<string, number>();
  const handledTick = new Map<string, number>();
  const markBorn = async (m: number) => {
    for (const r of await sql`select id::text from public.outbox`) if (!bornMinute.has(String(r.id))) bornMinute.set(String(r.id), m);
  };
  const markHandled = async (k: number) => {
    for (const r of await sql`select id::text from public.outbox where status in ('processed', 'skipped', 'failed')`) {
      if (!handledTick.has(String(r.id))) handledTick.set(String(r.id), k);
    }
  };
  dayOffset += 3;
  const clinics: Clinic[] = [];
  for (let i = 0; i < s.clinics; i++) clinics.push(await newClinic(`${s.name}-${st.label}-${i}`));
  // Agenda de cada minuto: atendimentos distribuídos entre as clínicas, convênio na proporção pedida.
  const plan: Array<Array<{ c: Clinic; id: string; convenio: boolean }>> = [];
  for (let m = 0; m < s.minutes; m++) {
    const items: Array<{ c: Clinic; id: string; convenio: boolean }> = [];
    for (let i = 0; i < s.perMinute; i++) {
      const c = clinics[i % clinics.length]!;
      const convenio = i % 10 < Math.round(s.convenioShare * 10);
      items.push({ c, id: await newAppointment(c, convenio), convenio });
    }
    plan.push(items);
  }
  const ticks: Array<Awaited<ReturnType<typeof tick>>> = [];
  let maxBacklog = 0;
  // Regime: fila pendente depois de cada tick do período de entrada (tendência = sustentável ou não).
  const backlogAfterTick: number[] = [];
  for (let m = 0; m < s.minutes; m++) {
    for (const it of plan[m]!) await complete(it.c, it.id, it.convenio);
    if (s.slowPerMinute) await insertSynthetic(clinics[0]!.clinicId, SLOW, s.slowPerMinute.n, s.slowPerMinute.ms);
    if (s.flakyPerMinute) await insertSynthetic(clinics[0]!.clinicId, FLAKY, s.flakyPerMinute, 0);
    if (s.poisonPerMinute) await insertSynthetic(clinics[0]!.clinicId, POISON, s.poisonPerMinute, 0);
    await markBorn(m);
    maxBacklog = Math.max(maxBacklog, await pendingNow());
    if (m > 0) await advanceMinute();
    ticks.push(await tick(st, oneWayMs));
    await markHandled(m);
    backlogAfterTick.push(await pendingNow());
  }
  let extra = 0;
  while ((await pendingNow()) > 0 && extra < 60) {
    await advanceMinute();
    ticks.push(await tick(st, oneWayMs));
    await markHandled(s.minutes + extra);
    extra += 1;
  }
  // Atraso por evento em minutos simulados: o tick k roda no fim do minuto k, então atraso = k + 1 − minuto
  // em que nasceu. Fora: o evento da guia (processado na hora) e a falha definitiva (contada à parte).
  const events = await sql`select id::text, event_type, status::text as status, payload->>'appointmentId' as appointment from public.outbox`;
  const delays: number[] = [];
  const completedEventTick = new Map<string, number>();
  for (const e of events) {
    const k = handledTick.get(String(e.id));
    const born = bornMinute.get(String(e.id));
    if (k === undefined || born === undefined || e.status === 'failed' || e.event_type === INSURANCE_COMPLETED) continue;
    delays.push(k + 1 - born);
    if (e.event_type === 'scheduling.appointment.completed' && e.appointment) completedEventTick.set(String(e.appointment), k);
  }
  // Recebível particular: nasce no handler de `appointment.completed`, no tick que o tratou.
  const completedMinute = new Map<string, number>();
  plan.forEach((items, m) => items.forEach((it) => completedMinute.set(it.id, m)));
  const receivableDelay = plan
    .flat()
    .filter((it) => !it.convenio && completedEventTick.has(it.id))
    .map((it) => completedEventTick.get(it.id)! + 1 - completedMinute.get(it.id)!);

  // Integridade.
  const ids = plan.flat().map((p) => p.id);
  const idsArr = `{${ids.join(',')}}`;
  const [integ] = await sql`select
      (select count(*)::int from public.appointments where id = any(${idsArr}::uuid[]) and status = 'atendido') as concluidos,
      (select count(*)::int from (select appointment_id from public.lancamentos where appointment_id = any(${idsArr}::uuid[]) and tipo = 'receber' group by 1 having count(*) > 1) d) as recebiveis_duplicados,
      (select count(*)::int from public.appointments a where a.id = any(${idsArr}::uuid[]) and a.billing_mode = 'particular'
         and not exists (select 1 from public.lancamentos l where l.appointment_id = a.id and l.tipo = 'receber')) as particular_sem_recebivel,
      (select count(*)::int from public.appointments a where a.id = any(${idsArr}::uuid[]) and a.billing_mode = 'convenio'
         and exists (select 1 from public.lancamentos l where l.appointment_id = a.id and l.tipo = 'receber' and l.valor >= 150)) as convenio_com_recebivel_cheio,
      (select count(*)::int from public.appointments a where a.id = any(${idsArr}::uuid[]) and a.billing_mode = 'convenio'
         and not exists (select 1 from public.hi_guide_items i join public.hi_guides g on g.id = i.guide_id where i.appointment_id = a.id and g.live)) as convenio_sem_guia,
      (select count(*)::int from (select i.appointment_id from public.hi_guide_items i join public.hi_guides g on g.id = i.guide_id
         where i.appointment_id = any(${idsArr}::uuid[]) and g.live group by 1 having count(distinct g.id) > 1) d) as guias_duplicadas,
      (select count(*)::int from (select appointment_id from public.prontuarios where appointment_id = any(${idsArr}::uuid[]) group by 1 having count(*) > 1) d) as prontuarios_duplicados,
      (select count(*)::int from public.lancamentos l join public.appointments a on a.id = l.appointment_id where a.id = any(${idsArr}::uuid[]) and l.clinic_id <> a.clinic_id) as recebivel_clinica_errada,
      (select count(*)::int from public.hi_guides g join public.hi_guide_items i on i.guide_id = g.id join public.appointments a on a.id = i.appointment_id
         where a.id = any(${idsArr}::uuid[]) and g.clinic_id <> a.clinic_id) as guia_clinica_errada,
      (select count(*)::int from public.outbox where status = 'processing') as presos_em_processing,
      (select count(*)::int from public.outbox where status = 'pending') as pendentes_no_fim`;
  const byStatus = await sql`select event_type, status::text as status, count(*)::int as n, max(attempts)::int as max_attempts
      from public.outbox group by 1, 2 order by 1, 2`;
  const produced = byStatus.reduce((acc, r) => acc + Number(r.n), 0);
  const failedNonPoison = byStatus.filter((r) => r.status === 'failed' && r.event_type !== POISON).reduce((a, r) => a + Number(r.n), 0);
  const flaky = byStatus.filter((r) => r.event_type === FLAKY);
  // Taxas do período de entrada: o que chega ao cron por minuto × o que o cron trata por tick.
  const cronEvents = byStatusForRate(events);
  const half = Math.floor(backlogAfterTick.length / 2);
  const tail = backlogAfterTick.slice(half);
  const slope = tail.length > 1 ? (tail[tail.length - 1]! - tail[0]!) / (tail.length - 1) : 0;
  return {
    cenario: s.name, estrategia: st.label, orcamentoReservaMs: st.reserveMs ?? null, descarteEmBloco: Boolean(st.skipUnhandled),
    lote: batchSize, paralelismo: parallelism, latenciaIdaMs: oneWayMs, idaEVoltaMedidaMs: await measuredRttMs(oneWayMs),
    regime: {
      minutosDeEntrada: s.minutes,
      entradaNoCronPorMin: r1(cronEvents / s.minutes),
      saidaMediaPorTick: r1(ticks.slice(0, s.minutes).reduce((a, t) => a + t.handled, 0) / s.minutes),
      filaDepoisDeCadaTick: backlogAfterTick,
      tendenciaPorMinuto: r1(slope),
      sustentado: slope <= 0 && (delays.length ? Math.max(...delays) : 0) <= 5,
    },
    vagasAdiadasPeloPrazo: ticks.reduce((a, t) => a + t.deferred, 0),
    descartadosEmBloco: ticks.reduce((a, t) => a + t.skippedBulk, 0),
    conclusoes: ids.length, clinicas: s.clinics,
    eventosProduzidos: produced,
    backlogMaximo: maxBacklog,
    minutosAteDrenar: s.minutes + extra,
    minutosExtrasDepoisDoPico: extra,
    atrasoMin: { p50: pct(delays, 50), p95: pct(delays, 95), p99: pct(delays, 99), max: delays.length ? Math.max(...delays) : null },
    recebivelParticularAtrasoMin: { n: receivableDelay.length, p95: pct(receivableDelay, 95), max: receivableDelay.length ? Math.max(...receivableDelay) : null },
    tick: { n: ticks.length, piorMs: Math.max(...ticks.map((t) => t.ms)), p95Ms: pct(ticks.map((t) => t.ms), 95), maxConexoesAtivas: Math.max(...ticks.map((t) => t.maxConn)), maxLocksEsperando: Math.max(...ticks.map((t) => t.maxWaiting)) },
    retentativas: flaky.length ? { flakyProcessados: flaky.filter((r) => r.status === 'processed').reduce((a, r) => a + Number(r.n), 0), maxTentativas: Math.max(...flaky.map((r) => Number(r.max_attempts))) } : null,
    falhasNaoVeneno: failedNonPoison,
    porStatus: byStatus.map((r) => `${r.event_type}:${r.status}=${r.n}`),
    integridade: integ,
  };
}

/** Eventos que chegam ao cron (sem o da guia, processado na hora). */
function byStatusForRate(events: Array<Record<string, unknown>>): number {
  return events.filter((e) => e.event_type !== INSURANCE_COMPLETED).length;
}

const results: Array<Record<string, unknown>> = [];
const scenarios: Record<string, Scenario> = {
  normal: { name: 'normal', minutes: 3, perMinute: 10, clinics: 2, convenioShare: 0.6 },
  pico: { name: 'pico', minutes: 3, perMinute: 50, clinics: 3, convenioShare: 0.6 },
  acima: { name: 'acima_do_pico', minutes: 2, perMinute: 100, clinics: 3, convenioShare: 0.6 },
  lentos: { name: 'pico_com_lentos', minutes: 3, perMinute: 50, clinics: 3, convenioShare: 0.6, slowPerMinute: { n: 20, ms: 1500 } },
  falha: { name: 'falha_e_recuperacao', minutes: 2, perMinute: 10, clinics: 2, convenioShare: 0.6, flakyPerMinute: 15, poisonPerMinute: 2 },
};
// Orçamento de reserva de 30 s: 60 s de `maxDuration` − até 5 s de partida da função − o maior
// timeout de UMA chamada externa de um handler já iniciado (Resend 20 s; Asaas e Meta 10 s; IA 15 s)
// − 5 s de folga. Configurável; o benchmark mede o efeito real.
const ATUAL50: Strategy = { label: 'atual-50', batchSize: 50, parallelism: 5 };
const LOTE150: Strategy = { label: 'lote-150', batchSize: 150, parallelism: 5 };
const LOTE200: Strategy = { label: 'lote-200', batchSize: 200, parallelism: 5 };
const PROT150: Strategy = { label: 'lote-150+orcamento+descarte', batchSize: 150, parallelism: 5, reserveMs: 30_000, skipUnhandled: true };
const PROT200: Strategy = { label: 'lote-200+orcamento+descarte', batchSize: 200, parallelism: 5, reserveMs: 30_000, skipUnhandled: true };
Object.assign(scenarios, {
  sustentado50: { name: 'sustentado_50_por_min', minutes: 15, perMinute: 50, clinics: 3, convenioShare: 0.6 },
  sustentado100: { name: 'sustentado_100_por_min', minutes: 10, perMinute: 100, clinics: 3, convenioShare: 0.6 },
});
const matrix: Array<[Scenario, Strategy, number]> =
  MODE === 'smoke'
    ? [
        [{ ...scenarios.pico!, minutes: 2 }, ATUAL50, 1],
        [{ ...scenarios.pico!, minutes: 2 }, PROT200, 1],
        [scenarios.falha!, PROT200, 1],
      ]
    : [
        // R61-B: entrada TEMPORÁRIA (3 min a 50/min; 2 min a 100/min) e a drenagem depois, nas 5 estratégias.
        ...[ATUAL50, LOTE150, LOTE200, PROT150, PROT200].map((st) => [scenarios.pico!, st, 1] as [Scenario, Strategy, number]),
        ...[ATUAL50, LOTE150, LOTE200, PROT150, PROT200].map((st) => [scenarios.acima!, st, 1] as [Scenario, Strategy, number]),
        // Entrada SUSTENTADA.
        ...[ATUAL50, LOTE150, LOTE200, PROT150, PROT200].map((st) => [scenarios.sustentado50!, st, 1] as [Scenario, Strategy, number]),
        ...[LOTE200, PROT150, PROT200].map((st) => [scenarios.sustentado100!, st, 1] as [Scenario, Strategy, number]),
        ...[LOTE200, PROT200].map((st) => [scenarios.lentos!, st, 1] as [Scenario, Strategy, number]),
        ...[LOTE200, PROT200].map((st) => [scenarios.pico!, st, 5] as [Scenario, Strategy, number]),
        [scenarios.falha!, PROT200, 1],
      ];
const outIdx = process.argv.indexOf('--out');
const outFile = outIdx >= 0 ? process.argv[outIdx + 1] : null;
const save = () => {
  if (outFile) writeFileSync(outFile, JSON.stringify({ modo: MODE, at: new Date().toISOString(), node: process.version, rodadas: results }, null, 1));
};

try {
  for (const [s, st, oneWay] of matrix) {
    {
      const t0 = performance.now();
      const r = await runScenario(s, st, oneWay);
      results.push({ ...r, duracaoRodadaS: Math.round((performance.now() - t0) / 1000) });
      save();
      const i = r.integridade as Record<string, number>;
      console.log(`${s.name} [${st.label}] lat=${oneWay}ms (ida e volta ${r.idaEVoltaMedidaMs} ms): entrada ${r.regime.entradaNoCronPorMin}/min, saída ${r.regime.saidaMediaPorTick}/tick, tendência ${r.regime.tendenciaPorMinuto}/min (${r.regime.sustentado ? 'SUSTENTADO' : 'não sustentado'}), fila máx ${r.backlogMaximo}, drena em ${r.minutosAteDrenar} min, atraso p95/máx ${r.atrasoMin.p95}/${r.atrasoMin.max} min, recebível máx ${r.recebivelParticularAtrasoMin.max} min, pior tick ${r.tick.piorMs} ms, adiadas ${r.vagasAdiadasPeloPrazo}, descartados em bloco ${r.descartadosEmBloco}, conexões ${r.tick.maxConexoesAtivas}, locks ${r.tick.maxLocksEsperando}`);
      // Integridade é obrigatória em toda rodada; o atraso é o que se compara.
      assert.equal(i.recebiveis_duplicados, 0, 'recebível duplicado');
      assert.equal(i.particular_sem_recebivel, 0, 'recebível perdido');
      assert.equal(i.convenio_com_recebivel_cheio, 0, 'convênio cobrado cheio');
      assert.equal(i.convenio_sem_guia, 0, 'guia perdida');
      assert.equal(i.guias_duplicadas, 0, 'guia duplicada');
      assert.equal(i.prontuarios_duplicados, 0, 'prontuário duplicado');
      assert.equal(i.recebivel_clinica_errada, 0, 'recebível em outra clínica');
      assert.equal(i.guia_clinica_errada, 0, 'guia em outra clínica');
      assert.equal(i.presos_em_processing, 0, 'evento preso em processing');
      assert.equal(i.pendentes_no_fim, 0, 'evento perdido na fila');
      assert.equal(r.falhasNaoVeneno, 0, 'evento falho que não era veneno');
      if (r.retentativas) assert.equal(r.retentativas.maxTentativas, 2, 'retentativa da falha transitória');
    }
  }
  // Pane de um consumidor de rede (ex.: provedor fora, cada chamada até o timeout): 60 eventos de 6 s
  // pendentes num tick só. Mede quanto o tick duraria contra o `maxDuration` de 60 s da função.
  const pane: Array<Record<string, unknown>> = [];
  for (const st of MODE === 'smoke' ? [ATUAL50, PROT200] : [ATUAL50, LOTE200, PROT200]) {
    for (let i = 0; i < 200 && (await pendingNow()) > 0; i++) {
      await advanceMinute();
      await runOutboxOnce({ batchSize: 500, parallelism: 10 });
    }
    const c = await newClinic(`pane-${st.label}`);
    await insertSynthetic(c.clinicId, SLOW, 60, MODE === 'smoke' ? 600 : 6000);
    const t = await tick(st, 1);
    const left = await pendingNow();
    pane.push({ estrategia: st.label, lote: st.batchSize, eventosLentos: 60, msPorEvento: MODE === 'smoke' ? 600 : 6000, tickMs: t.ms, tratados: t.handled, adiadas: t.deferred, ficaramNaFila: left, excede60s: t.ms > 60_000 });
    console.log(`pane [${st.label}]: tick ${t.ms} ms (${t.handled} tratados, ${t.deferred} vagas adiadas, ${left} na fila para o próximo)${t.ms > 60_000 ? ' — EXCEDE o maxDuration de 60 s' : ''}`);
  }
  results.push({ cenario: 'pane_de_consumidor', rodadas: pane });
  save();
  // Consumidor TRAVADO: um evento que não termina dentro da janela (70 s) entre 100 rápidos. O prazo
  // de reserva não abandona handler iniciado, então o tick espera o travado: mede-se, sem esconder.
  const travado: Array<Record<string, unknown>> = [];
  for (const st of MODE === 'smoke' ? [PROT200] : [ATUAL50, PROT200]) {
    for (let i = 0; i < 200 && (await pendingNow()) > 0; i++) {
      await advanceMinute();
      await runOutboxOnce({ batchSize: 500, parallelism: 10 });
    }
    const c = await newClinic(`travado-${st.label}`);
    const stuckMs = MODE === 'smoke' ? 7_000 : 70_000;
    await insertSynthetic(c.clinicId, SLOW, 1, stuckMs);
    await insertSynthetic(c.clinicId, SLOW, 100, 50);
    const t = await tick(st, 1);
    const left = await pendingNow();
    travado.push({ estrategia: st.label, travadoMs: stuckMs, rapidos: 100, tickMs: t.ms, tratados: t.handled, adiadas: t.deferred, ficaramNaFila: left, excede60s: t.ms > 60_000 });
    console.log(`travado [${st.label}]: tick ${t.ms} ms (${t.handled} tratados, ${t.deferred} vagas adiadas, ${left} na fila)${t.ms > 60_000 ? ' — EXCEDE o maxDuration de 60 s (o handler travado segura o tick)' : ''}`);
  }
  results.push({ cenario: 'consumidor_travado', rodadas: travado });
  save();
  console.log(`\n${results.filter((r) => 'integridade' in r).length} rodadas com integridade conferida (nenhuma perda, duplicidade ou clínica errada).`);
} finally {
  save();
  proxy.close();
  await cluster.stop();
}
process.exit(0);
