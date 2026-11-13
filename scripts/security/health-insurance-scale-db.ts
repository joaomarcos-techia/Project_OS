/**
 * Convênios — carga em Postgres DESCARTÁVEL (P9 da orientação de 12/11, seção 13). Nunca no DEV
 * compartilhado nem em produção; só dados sintéticos. Os números são CENÁRIOS DE TESTE nesta
 * máquina, não capacidade demonstrada em produção.
 *
 * Ciclo completo por clínica, com várias clínicas ao mesmo tempo: guia emitida (snapshot cifrado)
 * → lote → XML validado no motor XSD do app → arquivo (armazenamento em memória com falhas
 * injetáveis) → enviado → protocolo → análise → pagamento exato (rateio + ponte com o livro) →
 * leituras do painel e da lista. Mede p50/p95/p99, vazão, falhas, conexões, locks, memória e a
 * recuperação depois de falhas injetadas no armazenamento.
 *
 *   CLINICS=100 GUIDES=2 CONCURRENCY=8 NODE_OPTIONS=--conditions=react-server \
 *   npx tsx scripts/security/health-insurance-scale-db.ts
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

import { startScratchSchema } from './scratch-schema';

const CLINICS = Number(process.env.CLINICS ?? 100);
const GUIDES = Number(process.env.GUIDES ?? 2);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 8);
const FAIL_RATE = Number(process.env.STORAGE_FAIL_RATE ?? 0.05);
/**
 * FINANCIAL=1 (13/11, P5 da orientação): em vez do pagamento exato, o ciclo financeiro inteiro —
 * glosa parcial na 1ª guia (definitiva nas clínicas pares, contestada nas ímpares), pagamento do
 * saldo alocado por guia, estorno e realocação em 1 de cada 5 clínicas, e repasse de 40% sobre o
 * recebido (sincronizar → autorizar → registrar).
 */
const FINANCIAL = process.env.FINANCIAL === '1';
const GLOSS_CENTS = 4500;

const cluster = await startScratchSchema({ port: 55519, maxConnections: CONCURRENCY * 3 + 4 });
const { sql } = cluster;
if (!/@(?:127\.0\.0\.1|localhost):55519\//u.test(cluster.url)) throw new Error('não é o cluster local');
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');

const acct = await import('../../src/contexts/health-insurance/internal/insurance-account-service');
const payouts = await import('../../src/contexts/health-insurance/internal/insurance-payout-service');
const q = await import('../../src/contexts/health-insurance/queries');
const { loadXmllintValidator } = await import('../../src/contexts/health-insurance/tiss/xml/xsd-validator');
const { loadHiFixtures, GUIDE_VALUE_CENTS: VALUE } = await import('./hi-fixtures');

const xsd = loadXmllintValidator();
if (!xsd) throw new Error('validador XSD do app indisponível (TISS_XMLLINT_WASM_DIR fora do CI)');
const objects = new Map<string, Uint8Array>();
let injected = 0;
const store = {
  async put(ref: string, bytes: Uint8Array) {
    if (Math.random() < FAIL_RATE) {
      injected += 1;
      throw new Error('falha injetada no armazenamento');
    }
    objects.set(ref, bytes);
  },
  async get(ref: string) { return objects.get(ref)!; },
  async remove(ref: string) { objects.delete(ref); },
};
const fx = await loadHiFixtures(sql, { store, validateXsd: xsd });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const samples: Record<string, number[]> = {};
const errors: Record<string, number> = {};
async function timed<T>(op: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } catch (e) {
    errors[op] = (errors[op] ?? 0) + 1;
    throw e;
  } finally {
    (samples[op] ??= []).push(performance.now() - t0);
  }
}
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! * 10) / 10 : 0;
};
async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]!, i);
    }
  }));
}

// Amostragem de conexões, locks esperando e memória durante a carga.
let maxConn = 0;
let maxWaitingLocks = 0;
let maxRss = 0;
let sampling = true;
const sampler = (async () => {
  while (sampling) {
    const [r] = await sql`select (select count(*) from pg_stat_activity where datname = current_database())::int as conn,
        (select count(*) from pg_locks where not granted)::int as waiting`;
    maxConn = Math.max(maxConn, r!.conn as number);
    maxWaitingLocks = Math.max(maxWaitingLocks, r!.waiting as number);
    maxRss = Math.max(maxRss, process.memoryUsage().rss);
    await new Promise((res) => setTimeout(res, 250));
  }
})();

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  const tAll = performance.now();

  // 1) Clínicas.
  const clinics: Array<Awaited<ReturnType<typeof fx.setupClinic>>> = [];
  await pool(Array.from({ length: CLINICS }, (_, i) => i), CONCURRENCY, async (i) => {
    clinics.push(await timed('clinica_setup', () => fx.setupClinic(`Carga ${i}`)));
  });

  // 2) Guias emitidas (snapshot cifrado), todas as clínicas em paralelo.
  const guides = new Map<string, string[]>();
  await pool(clinics, CONCURRENCY, async (c) => {
    const ids: string[] = [];
    for (let g = 0; g < GUIDES; g++) ids.push(await timed('guia_emitida', () => c.approvedGuide()));
    guides.set(c.clinicId, ids);
  });

  // 3) Lote + exportação (XSD + arquivo), com falhas injetadas e repetição até recuperar.
  const batchOf = new Map<string, string>();
  let retries = 0;
  const tRecover: number[] = [];
  await pool(clinics, CONCURRENCY, async (c) => {
    const batchId = await timed('lote_criado', () => fx.createBatch(c, guides.get(c.clinicId)!));
    const first = performance.now();
    for (let attempt = 0; ; attempt++) {
      try {
        await timed('lote_exportado_xsd', () => fx.exportBatch(c, batchId));
        if (attempt > 0) tRecover.push(performance.now() - first);
        break;
      } catch (e) {
        if (attempt >= 5) throw e;
        retries += 1;
      }
    }
    batchOf.set(c.clinicId, batchId);
  });

  // 4) Envio, protocolo, análise.
  await pool(clinics, CONCURRENCY, async (c) => {
    const batchId = batchOf.get(c.clinicId)!;
    await timed('envio_protocolo_analise', async () => {
      const v0 = await fx.batchVersion(batchId);
      let v = await fx.asUser(c, (tx) => fx.batches.markBatchSentInTx(tx, { clinicId: c.clinicId, batchId, version: v0, channel: 'manual', sentOn: '2026-11-11', evidence: 'Envio sintético pelo portal' }));
      v = await fx.asUser(c, (tx) => fx.batches.recordBatchProtocolInTx(tx, { clinicId: c.clinicId, batchId, version: v, protocol: `${batchId.replace(/\D/gu, '').slice(0, 12).padEnd(12, '7')}`, receivedOn: '2026-11-11', evidenceSha256: sha(`r-${batchId}`) }));
      await fx.asUser(c, (tx) => fx.batches.markBatchUnderReviewInTx(tx, { clinicId: c.clinicId, batchId, version: v }));
    });
  });

  // 5) Pagamento exato do lote (rateio + ponte com o livro), conciliações concorrentes.
  if (!FINANCIAL) {
    await pool(clinics, CONCURRENCY, async (c) => {
      const batchId = batchOf.get(c.clinicId)!;
      await timed('pagamento_rateio_livro', () =>
        fx.asUser(c, (tx) => acct.recordPaymentInTx(tx, { clinicId: c.clinicId, insurerId: c.insurerId, batchId, paidOn: '2026-11-11', amountCents: GUIDES * VALUE, source: 'manual', idempotencyKey: `carga-${randomUUID()}` })),
      );
    });
  } else {
    // 5F) Glosa → pagamento do saldo por guia → estorno/realocação → repasse.
    await pool(clinics, CONCURRENCY, async (c, i) => {
      const batchId = batchOf.get(c.clinicId)!;
      const ids = guides.get(c.clinicId)!;
      await sql`insert into public.professional_payout_rules (clinic_id, professional_id, procedure_id, kind, percentage, fixed_amount, effective_from)
        values (${c.clinicId}::uuid, ${c.doctorId}::uuid, null, 'percentage', 40, null, '2020-01-01')`;
      const glossId = await timed('glosa_registrada', () =>
        fx.asUser(c, (tx) => acct.recordGlossInTx(tx, { clinicId: c.clinicId, batchId, guideId: ids[0]!, code: '1705', amountCents: GLOSS_CENTS, source: 'manual', idempotencyKey: `glosa-${randomUUID()}` })),
      );
      const gv = async () => Number((await sql`select version from public.hi_glosses where id = ${glossId}::uuid`)[0]!.version);
      await timed('glosa_decidida', async () => {
        const v1 = await gv();
        await fx.asUser(c, (tx) => acct.transitionGlossInTx(tx, { clinicId: c.clinicId, glossId, version: v1, to: 'under_analysis' }));
        const v2 = await gv();
        await fx.asUser(c, (tx) =>
          acct.transitionGlossInTx(tx, i % 2 === 0
            ? { clinicId: c.clinicId, glossId, version: v2, to: 'definitive', reason: 'Conferido na carga sintética: a glosa procede' }
            : { clinicId: c.clinicId, glossId, version: v2, to: 'contested' }),
        );
      });
      const allocations = ids.map((g, k) => ({ guideId: g, batchId, amountCents: k === 0 ? VALUE - GLOSS_CENTS : VALUE }));
      const paymentId = await timed('pagamento_por_guia', () =>
        fx.asUser(c, (tx) => acct.recordPaymentInTx(tx, { clinicId: c.clinicId, insurerId: c.insurerId, batchId, paidOn: '2026-11-11', amountCents: GUIDES * VALUE - GLOSS_CENTS, source: 'manual', idempotencyKey: `carga-${randomUUID()}`, allocations })),
      );
      if (i % 5 === 0) {
        await timed('estorno_realocacao', async () => {
          const [alloc] = await sql`select id from public.hi_payment_allocations where payment_id = ${paymentId}::uuid and guide_id = ${ids[ids.length - 1]!}::uuid order by created_at desc limit 1`;
          await fx.asUser(c, (tx) => acct.reversePaymentAllocationInTx(tx, { clinicId: c.clinicId, allocationId: String(alloc!.id), reason: 'Estorno sintético na carga: alocação refeita' }));
          await fx.asUser(c, (tx) => acct.allocatePaymentInTx(tx, { clinicId: c.clinicId, paymentId, allocationKey: `realoc-${randomUUID()}`, allocations: [{ guideId: ids[ids.length - 1]!, batchId, amountCents: VALUE }] }));
        });
      }
      await timed('repasse_sync_autoriza_registra', async () => {
        await fx.asUser(c, (tx) => payouts.syncInsurancePayoutsTx(tx, c.clinicId, c.doctorId));
        for (const p of await fx.asUser(c, (tx) => payouts.listInsurancePayoutPositionsTx(tx, c.clinicId))) {
          if (p.pendingAuthorizationCents > 0) {
            await fx.asUser(c, (tx) => payouts.authorizeInsurancePayoutTx(tx, { clinicId: c.clinicId, payoutId: p.payoutId, amountCents: p.pendingAuthorizationCents, idempotencyKey: `aut-${randomUUID()}`, actorUserId: c.doctorId }));
          }
        }
        for (const p of await fx.asUser(c, (tx) => payouts.listInsurancePayoutPositionsTx(tx, c.clinicId))) {
          if (p.dueCents > 0) {
            await fx.asUser(c, (tx) => payouts.settleInsurancePayoutTx(tx, { clinicId: c.clinicId, payoutId: p.payoutId, amountCents: p.dueCents, paidOn: '2026-11-12', reference: null, idempotencyKey: `rep-${randomUUID()}`, actorUserId: c.doctorId }));
          }
        }
      });
    });
  }

  // 6) Leituras da interface.
  await pool(clinics, CONCURRENCY, async (c) => {
    await timed('painel', () => q.getInsuranceOverview(c.clinicId));
    await timed('lista_guias', () => q.listGuides(c.clinicId, { status: 'desfecho' }));
    await timed('detalhe_lote', () => q.getBatchDetail(c.clinicId, batchOf.get(c.clinicId)!));
  });

  const totalMs = performance.now() - tAll;
  sampling = false;
  await sampler;

  // Integridade depois da carga: tudo pago, livro igual à conta, nada duplicado.
  const [check] = await sql`select
      (select count(*) from public.hi_guides where status = 'paid')::int as paid_guides,
      (select count(*) from public.lancamentos where source_hi_guide_id is not null and status = 'pago')::int as paid_receivables,
      (select count(*) from public.hi_ledger_drift)::int as drift,
      (select count(*) from public.hi_files where kind = 'batch_xml')::int as files,
      pg_size_pretty(pg_database_size(current_database())) as db_size`;
  let financial: Record<string, number> | null = null;
  if (!FINANCIAL) {
    assert.deepEqual([check!.paid_guides, check!.paid_receivables, check!.drift, check!.files], [CLINICS * GUIDES, CLINICS * GUIDES, 0, CLINICS]);
  } else {
    const [f] = await sql`select
        (select count(*) from public.hi_glosses where status = 'definitive')::int as definitive,
        (select count(*) from public.hi_glosses where status = 'contested')::int as contested,
        (select coalesce(sum(amount_cents), 0) from public.hi_payout_movements where kind = 'settlement')::bigint as settled,
        (select count(*) from public.hi_payment_allocations where reverses_id is not null)::int as reversed`;
    financial = { definitiveGlosses: f!.definitive as number, contestedGlosses: f!.contested as number, payoutSettledCents: Number(f!.settled), reversedAllocations: f!.reversed as number };
    // Livro = conta; um arquivo por lote; glosas no estado pedido; repasse = 40% do RECEBIDO (nunca do faturado).
    assert.equal(check!.drift, 0);
    assert.equal(check!.files, CLINICS);
    assert.equal(financial.definitiveGlosses, Math.ceil(CLINICS / 2));
    assert.equal(financial.contestedGlosses, Math.floor(CLINICS / 2));
    assert.equal(financial.payoutSettledCents, CLINICS * Math.round(0.4 * (GUIDES * VALUE - GLOSS_CENTS)));
    assert.equal(financial.reversedAllocations, Math.ceil(CLINICS / 5));
  }
  assert.equal(objects.size, CLINICS);

  const ops = Object.fromEntries(
    Object.entries(samples).map(([op, xs]) => [op, { n: xs.length, p50: pct(xs, 50), p95: pct(xs, 95), p99: pct(xs, 99), max: pct(xs, 100), errors: errors[op] ?? 0 }]),
  );
  console.log(JSON.stringify({
    scenario: { clinics: CLINICS, guidesPerClinic: GUIDES, concurrency: CONCURRENCY, storageFailRate: FAIL_RATE },
    totalSeconds: Math.round(totalMs / 100) / 10,
    throughput: { guidesPerSecond: Math.round(((CLINICS * GUIDES) / totalMs) * 1000 * 10) / 10 },
    opsMs: ops,
    failures: { storageInjected: injected, exportRetries: retries, recoveredAfterFailureMs: { n: tRecover.length, p50: pct(tRecover, 50), p95: pct(tRecover, 95) } },
    database: { maxConnections: maxConn, maxWaitingLocks, size: check!.db_size },
    process: { maxRssMb: Math.round(maxRss / 1024 / 1024) },
    integrity: { paidGuides: check!.paid_guides, paidReceivables: check!.paid_receivables, ledgerDrift: check!.drift, xmlFiles: check!.files },
    ...(financial ? { financial } : {}),
  }, null, 2));
  console.log(`\nOK — ${CLINICS} clínicas × ${GUIDES} guias: ciclo completo íntegro (livro = conta, sem duplicidade) com ${injected} falhas de armazenamento injetadas e recuperadas.`);
} finally {
  sampling = false;
  await cluster.stop();
}
