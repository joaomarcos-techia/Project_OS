/**
 * R54 — estorno feito DIRETO no Asaas, em Postgres DESCARTÁVEL com a cadeia do DEV (0000–0160,
 * com a 0159 do #53 nos bytes aplicados). O Asaas é SIMULADO na fronteira HTTP (`fetch` só
 * para `sandbox.asaas.invalid`; qualquer outro host derruba o harness); a rota do webhook, o
 * livro, o worker do outbox e os handlers são os REAIS. Nenhuma credencial, nenhum Sandbox.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/payments-external-refund-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';

import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const PORT = 55531;
const chain = await readDevOrderChain();
assert.ok(
  chain.some((m) => m.file.startsWith('0160_')),
  'a cadeia precisa da 0160',
);
const cluster = await startScratchSchema({ port: PORT, maxConnections: 16, migrations: chain });
const { sql } = cluster;
if (!new RegExp(`@(?:127\\.0\\.0\\.1|localhost):${PORT}/`, 'u').test(cluster.url))
  throw new Error('não é o cluster local');
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.OUTBOX_CRON_ALLOW_NON_VERCEL = 'true';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');
process.env.ASAAS_BASE_URL = 'https://sandbox.asaas.invalid/api/v3';
process.env.LOG_LEVEL = 'error';

// ── Asaas simulado (fronteira HTTP) ─────────────────────────────────────────────
interface SimPayment {
  status: string;
  value: number;
  checkout: string;
  chargeback?: string | null;
  refunds: Array<{ status: string; value: number }>;
  /** Faz a próxima leitura de estornos falhar (500). */
  failRefundsOnce?: boolean;
}
const asaas = new Map<string, SimPayment>();
const httpCalls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  );
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return realFetch(input, init);
  if (url.hostname !== 'sandbox.asaas.invalid')
    throw new Error(`rede bloqueada no harness: ${url.hostname}`);
  httpCalls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
  const m = /^\/api\/v3\/payments\/([^/]+)(\/refunds)?$/u.exec(url.pathname);
  const p = m ? asaas.get(decodeURIComponent(m[1]!)) : undefined;
  if (!m || !p) return Response.json({ errors: [{ code: 'not_found' }] }, { status: 404 });
  if (m[2]) {
    if (p.failRefundsOnce) {
      p.failRefundsOnce = false;
      return Response.json({ errors: [{ code: 'internal' }] }, { status: 500 });
    }
    return Response.json({
      data: p.refunds.map((r) => ({
        status: r.status,
        value: r.value,
        dateCreated: '2026-11-13 10:00:00',
      })),
    });
  }
  return Response.json({
    id: m[1],
    status: p.status,
    value: p.value,
    netValue: Number((p.value - 0.99).toFixed(2)),
    dueDate: '2026-11-13',
    billingType: 'PIX',
    invoiceUrl: null,
    checkoutSession: p.checkout,
    chargeback: p.chargeback ? { status: p.chargeback, reason: 'NOT_RECOGNIZED' } : null,
    deleted: false,
  });
}) as typeof fetch;

const { encryptForTenant } = await import('../../src/lib/crypto/encryption');
await import('../../src/app/api/cron/outbox/handlers');
const { runOutboxOnce } = await import('../../src/lib/outbox/worker');
const { POST } = await import('../../src/app/api/webhooks/asaas/patient/[ref]/route');
const { reconcileExternalRefund } =
  await import('../../src/contexts/payments/internal/external-refund');
const { settleRefundNow } =
  await import('../../src/app/api/webhooks/asaas/patient/settlement-follow-up');
const { scanExternalRefundCandidates, reconcileExternalRefundCandidates } =
  await import('../../src/app/api/cron/financial-reconcile/external-refund-sweep');
const { recordProfessionalPayoutReview } =
  await import('../../src/contexts/financial/internal/payout-review');
const { withTenant } = await import('../../src/lib/db/tenant');
const { dbAdmin } = await import('../../src/lib/db');
const { EXTERNAL_REFUND_REASON } =
  await import('../../src/contexts/financial/internal/patient-credit-adjustment');

let passed = 0;
const pass = (msg: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${msg}`);
};
const drain = async (n = 6) => {
  for (let i = 0; i < n; i++) await runOutboxOnce({ batchSize: 50, parallelism: 1 });
};

interface Clinic {
  clinicId: string;
  doctorId: string;
  procedureId: string;
  ref: string;
  token: string;
}
async function seedClinic(label: string): Promise<Clinic> {
  const clinicId = randomUUID();
  const doctorId = randomUUID();
  const procedureId = randomUUID();
  const ref = randomUUID();
  const token = `token-${label}-${randomUUID()}`;
  await sql`insert into public.clinics (id, nome, slug) values (${clinicId}::uuid, ${`Clínica ${label}`}, ${`ext-refund-${clinicId.slice(0, 8)}`})`;
  await sql`insert into auth.users (id, email, email_confirmed_at) values (${doctorId}::uuid, ${`dr-${doctorId.slice(0, 8)}@example.invalid`}, now())`;
  await sql`insert into public.profiles (id, clinic_id, nome, role, ativo) values (${doctorId}::uuid, ${clinicId}::uuid, 'Dra. Sintética', 'doctor', true)`;
  await sql`insert into public.procedures (id, clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min) values (${procedureId}::uuid, ${clinicId}::uuid, ${`P-${label}`}, 'Consulta', 150, 30)`;
  const apiKey = await encryptForTenant(clinicId, `$aact_hmlg_sintetica_${label}`);
  const tokenEnc = await encryptForTenant(clinicId, token);
  await sql`insert into public.clinic_payment_accounts (clinic_id, provider, api_key_encrypted, key_version, active, connected_at, webhook_ref, webhook_token_encrypted)
    values (${clinicId}::uuid, 'asaas', ${apiKey}, 1, true, now(), ${ref}::uuid, ${tokenEnc})`;
  return { clinicId, doctorId, procedureId, ref, token };
}

let slot = 0;
interface Paid {
  appointmentId: string;
  patientId: string;
  chargeId: string;
  lancamentoId: string;
  payment: string;
  payoutId: string | null;
}
/** Atendimento particular concluído (R$ 150) pago pelo webhook REAL (PAYMENT_RECEIVED). */
async function paidAppointment(
  c: Clinic,
  tag: string,
  opts: { payout?: boolean } = {},
): Promise<Paid> {
  const patientId = randomUUID();
  const appointmentId = randomUUID();
  const lancamentoId = randomUUID();
  const chargeId = randomUUID();
  const payment = `pay_${tag}_${randomUUID().slice(0, 8)}`;
  const checkout = `chk_${tag}_${randomUUID().slice(0, 8)}`;
  await sql`insert into public.patients (id, clinic_id, nome, cpf_encrypted, cpf_hash) values (${patientId}::uuid, ${c.clinicId}::uuid, ${`Paciente ${tag}`}, 'fixture', ${randomUUID().replaceAll('-', '').padEnd(64, '0')})`;
  await sql`insert into public.appointments (id, clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
      snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via)
    values (${appointmentId}::uuid, ${c.clinicId}::uuid, ${c.doctorId}::uuid, ${patientId}::uuid, ${c.procedureId}::uuid,
      '2026-11-01T12:00:00Z'::timestamptz + ${(slot += 1)} * interval '31 minutes', 30, 'atendido', 150, 'Consulta', 150, 30, 'Dra. Sintética', 'attendant')`;
  await sql`insert into public.lancamentos (id, clinic_id, tipo, descricao, valor, valor_pago, status, appointment_id, patient_id, created_via)
    values (${lancamentoId}::uuid, ${c.clinicId}::uuid, 'receber', 'Consulta', 150, 0, 'pendente', ${appointmentId}::uuid, ${patientId}::uuid, 'auto')`;
  await sql`insert into public.patient_charges (id, clinic_id, appointment_id, patient_id, kind, status, amount, external_reference)
    values (${chargeId}::uuid, ${c.clinicId}::uuid, ${appointmentId}::uuid, ${patientId}::uuid, 'remainder', 'pending', 150, ${`remainder:${appointmentId}`})`;
  await sql`insert into public.patient_checkout_generations (clinic_id, patient_charge_id, generation, external_reference, status, provider_checkout_id, checkout_url, expires_at, resolved_at)
    values (${c.clinicId}::uuid, ${chargeId}::uuid, 1, ${`remainder:${tag}:${randomUUID()}`}, 'active', ${checkout}, ${`https://sandbox.asaas.invalid/c/${tag}`}, now() + interval '1 day', now())`;
  let payoutId: string | null = null;
  if (opts.payout) {
    payoutId = randomUUID();
    await sql`insert into public.professional_payouts (id, clinic_id, appointment_id, professional_id, procedure_id, calculation_basis, rule_kind, rule_percentage, gross_amount, basis_amount, payout_amount, calculated_at, status)
      values (${payoutId}::uuid, ${c.clinicId}::uuid, ${appointmentId}::uuid, ${c.doctorId}::uuid, ${c.procedureId}::uuid, 'gross', 'percentage', 50, 150, 150, 75, now(), 'calculated')`;
  }
  asaas.set(payment, { status: 'RECEIVED', value: 150, checkout, refunds: [] });
  const res = await webhook(c, `evt_paid_${tag}`, 'PAYMENT_RECEIVED', payment);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).outcome, 'paid');
  await drain();
  const [l] =
    await sql`select status, valor_pago::text as pago from public.lancamentos where id = ${lancamentoId}::uuid`;
  assert.deepEqual([l!.status, l!.pago], ['pago', '150.00'], `baixa do pagamento ${tag}`);
  return { appointmentId, patientId, chargeId, lancamentoId, payment, payoutId };
}

function webhook(c: Clinic, eventId: string, event: string, paymentId: string, token = c.token) {
  const body = JSON.stringify({ id: eventId, event, payment: { id: paymentId } });
  return POST(
    new Request(`https://app.test/api/webhooks/asaas/patient/${c.ref}`, {
      method: 'POST',
      headers: { 'asaas-access-token': token, 'content-type': 'application/json' },
      body,
    }),
    { params: Promise.resolve({ ref: c.ref }) },
  );
}

async function ledger(p: Paid) {
  const [l] =
    await sql`select status, valor_pago::text as pago from public.lancamentos where id = ${p.lancamentoId}::uuid`;
  const txs =
    await sql`select kind, amount::text as amount, original_payment_id::text as orig, id::text as id from public.payment_transactions where lancamento_id = ${p.lancamentoId}::uuid order by created_at, kind`;
  const [ch] =
    await sql`select status, refunded_at is not null as refunded from public.patient_charges where id = ${p.chargeId}::uuid`;
  const ev =
    await sql`select external_total::text as total, amount::text as amount, source, full_refund from public.patient_external_refunds where patient_charge_id = ${p.chargeId}::uuid order by external_total`;
  const [cr] =
    await sql`select allocated_reversed_amount::text as ar, unallocated_reversed_amount::text as ur, status from public.patient_credits where patient_charge_id = ${p.chargeId}::uuid`;
  const [pend] =
    await sql`select motivo, valor::text as valor, status from public.faturamento_pendencias where appointment_id = ${p.appointmentId}::uuid`;
  const charges =
    await sql`select count(*)::int as n from public.patient_charges where appointment_id = ${p.appointmentId}::uuid`;
  return {
    status: l!.status as string,
    pago: l!.pago as string,
    payments: txs.filter((t) => t.kind === 'payment'),
    refunds: txs.filter((t) => t.kind === 'refund'),
    charge: ch!.status as string,
    evidence: ev.map((e) => `${e.total}/${e.amount}/${e.source}/${e.full_refund}`),
    credit: cr ? `${cr.ar}/${cr.ur}/${cr.status}` : null,
    pendencia: pend ? `${pend.status}:${pend.valor}:${pend.motivo}` : null,
    chargeCount: charges[0]!.n as number,
  };
}

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  const A = await seedClinic('A');
  const B = await seedClinic('B');

  // ── 1. Estorno integral depois do pagamento, pelo webhook real ──────────────────
  const p1 = await paidAppointment(A, 'um', { payout: true });
  const [po1] =
    await sql`select status, payout_amount::text as v from public.professional_payouts where id = ${p1.payoutId}::uuid`;
  assert.deepEqual(
    [po1!.status, po1!.v],
    ['calculated', '75.00'],
    'repasse calculado antes do estorno',
  );
  asaas.get(p1.payment)!.status = 'REFUNDED';
  asaas.get(p1.payment)!.refunds = [{ status: 'DONE', value: 150 }];
  const r1 = await webhook(A, 'evt_ref_um', 'PAYMENT_REFUNDED', p1.payment);
  assert.equal(r1.status, 200);
  await drain();
  const l1 = await ledger(p1);
  assert.equal(l1.payments.length, 1, 'a baixa original fica');
  assert.equal(l1.refunds.length, 1);
  assert.deepEqual(
    [
      l1.status,
      l1.pago,
      l1.refunds[0]!.amount,
      l1.refunds[0]!.orig,
      l1.charge,
      l1.evidence,
      l1.credit,
      l1.chargeCount,
    ],
    [
      'pendente',
      '0.00',
      '150.00',
      l1.payments[0]!.id,
      'refunded',
      ['150.00/150.00/webhook/true'],
      '150.00/0.00/allocated',
      1,
    ],
  );
  assert.ok(
    l1.pendencia?.startsWith(`aberta:150.00:${EXTERNAL_REFUND_REASON}`),
    `pendência: ${l1.pendencia}`,
  );
  const [aud1] =
    await sql`select count(*)::int as n, max(user_id::text) as uid, max(after->>'externalRefundedTotal') as total
    from public.audit_events where action = 'payments.patient_charge.external_refund_recognized' and resource_id = ${p1.chargeId}`;
  assert.deepEqual([aud1!.n, aud1!.uid, aud1!.total], [1, null, '150']);
  const [po1b] =
    await sql`select status, payout_amount from public.professional_payouts where id = ${p1.payoutId}::uuid`;
  const [aud1p] =
    await sql`select before->>'payoutAmount' as v, after->>'reason' as reason from public.audit_events
    where action = 'financial.professional_payout.suspended' and resource_id = ${p1.payoutId}`;
  assert.deepEqual(
    [po1b!.status, po1b!.payout_amount, aud1p!.v, aud1p!.reason],
    ['cancelled', null, '75.00', 'payment_reversed'],
  );
  pass(
    'estorno integral feito no Asaas depois do pagamento (webhook real): baixa original preservada + estorno de R$ 150 vinculado a ela, recebível reaberto (R$ 0), cobrança "estornada", evidência, crédito revertido, pendência para revisão humana, auditoria com ator de sistema; repasse calculado (R$ 75) suspenso com o valor anterior na auditoria; nenhuma cobrança nova',
  );

  // ── 2. Webhook duplicado, reentrega, outro evento do mesmo estorno, handler repetido ─
  const before2 = await ledger(p1);
  for (const [evt, type] of [
    ['evt_ref_um', 'PAYMENT_REFUNDED'],
    ['evt_ref_um_2', 'PAYMENT_REFUNDED'],
    ['evt_ref_um_3', 'PAYMENT_CONFIRMED'],
  ] as const) {
    assert.equal((await webhook(A, evt, type, p1.payment)).status, 200);
  }
  await drain();
  // O evento do livro processado de novo à força (worker reiniciado no meio): dedup pelo evento.
  await sql`update public.outbox set status = 'pending', attempts = 0, processed_at = null, next_attempt_at = now()
    where event_type = 'payments.patient_refund.external_recognized' and clinic_id = ${A.clinicId}::uuid`;
  await drain();
  assert.deepEqual(await ledger(p1), before2);
  pass(
    'webhook duplicado, reentrega com outro id, "pago" atrasado que já encontra o pagamento devolvido e o evento do livro reprocessado à força: nenhuma segunda compensação, nenhuma baixa nova, nada muda',
  );

  // ── 3. Estornos parciais em dois passos + leitura atrasada ─────────────────────
  const p3 = await paidAppointment(A, 'parcial');
  asaas.get(p3.payment)!.refunds = [{ status: 'DONE', value: 40 }];
  await webhook(A, 'evt_p3_1', 'PAYMENT_PARTIALLY_REFUNDED', p3.payment);
  await drain();
  asaas.get(p3.payment)!.refunds.push({ status: 'DONE', value: 30 });
  await webhook(A, 'evt_p3_2', 'PAYMENT_PARTIALLY_REFUNDED', p3.payment);
  await drain();
  const l3 = await ledger(p3);
  assert.deepEqual(
    [l3.status, l3.pago, l3.refunds.map((r) => r.amount), l3.charge, l3.evidence],
    [
      'parcial',
      '80.00',
      ['40.00', '30.00'],
      'paid',
      ['40.00/40.00/webhook/false', '70.00/30.00/webhook/false'],
    ],
  );
  // Leitura velha (o estado de quando só havia R$ 40) chegando depois: nada muda.
  const stale = await reconcileExternalRefund({
    clinicId: A.clinicId,
    providerPaymentId: p3.payment,
    payment: { paymentId: p3.payment, status: 'RECEIVED', value: 150, deleted: false },
    refunds: [{ refundId: null, status: 'DONE', value: 40 }],
    source: 'webhook',
    asaasEventId: 'evt_p3_1',
  });
  assert.equal(stale.outcome, 'unchanged');
  assert.deepEqual(await ledger(p3), l3);
  pass(
    'estorno parcial em dois passos (R$ 40, depois +R$ 30): dois patamares de evidência, duas compensações só da diferença (recebível "parcial", R$ 80 pagos), cobrança continua "paga"; a leitura velha de R$ 40 entregue depois não muda nada',
  );

  // ── 4. Estorno ANTES do webhook de pagamento ─────────────────────────────────
  const p4id = randomUUID();
  const ap4 = randomUUID();
  const pt4 = randomUUID();
  await sql`insert into public.patients (id, clinic_id, nome, cpf_encrypted, cpf_hash) values (${pt4}::uuid, ${A.clinicId}::uuid, 'Paciente antes', 'fixture', ${randomUUID().replaceAll('-', '').padEnd(64, '0')})`;
  await sql`insert into public.appointments (id, clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
      snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via)
    values (${ap4}::uuid, ${A.clinicId}::uuid, ${A.doctorId}::uuid, ${pt4}::uuid, ${A.procedureId}::uuid, now() - interval '3 days', 30, 'atendido', 150, 'Consulta', 150, 30, 'Dra. Sintética', 'attendant')`;
  await sql`insert into public.patient_charges (id, clinic_id, appointment_id, patient_id, kind, status, amount, external_reference, provider_payment_id)
    values (${p4id}::uuid, ${A.clinicId}::uuid, ${ap4}::uuid, ${pt4}::uuid, 'remainder', 'pending', 150, ${`remainder:${ap4}`}, 'pay_antes')`;
  asaas.set('pay_antes', {
    status: 'REFUNDED',
    value: 150,
    checkout: 'chk_antes',
    refunds: [{ status: 'DONE', value: 150 }],
  });
  const r4a = await webhook(A, 'evt_antes_ref', 'PAYMENT_REFUNDED', 'pay_antes');
  const r4b = await webhook(A, 'evt_antes_paid', 'PAYMENT_RECEIVED', 'pay_antes');
  await drain();
  const [c4] = await sql`select status from public.patient_charges where id = ${p4id}::uuid`;
  const [e4] =
    await sql`select count(*)::int as n from public.patient_external_refunds where patient_charge_id = ${p4id}::uuid`;
  const [k4] =
    await sql`select count(*)::int as n from public.patient_credits where patient_charge_id = ${p4id}::uuid`;
  assert.deepEqual([r4a.status, r4b.status, c4!.status, e4!.n, k4!.n], [200, 200, 'pending', 0, 0]);
  pass(
    'estorno ANTES do webhook de pagamento (e o "pago" chegando depois já devolvido): sem baixa, sem crédito, sem evidência, nada a compensar — a cobrança segue o próprio ciclo (expira); nada é confirmado',
  );

  // ── 5. Webhook perdido → recuperação pela varredura (consulta autenticada) ──────
  const p5 = await paidAppointment(A, 'perdido');
  asaas.get(p5.payment)!.status = 'REFUNDED';
  asaas.get(p5.payment)!.refunds = [{ status: 'DONE', value: 150 }];
  // Nenhum webhook. Só a varredura do financial-reconcile.
  await sql`update public.patient_charges set refund_checked_at = null where id = ${p5.chargeId}::uuid`;
  await sql`update public.patient_charges set refund_checked_at = now() where id <> ${p5.chargeId}::uuid and status = 'paid'`;
  const cand5 = await dbAdmin.transaction((tx) => scanExternalRefundCandidates(tx, 10));
  assert.deepEqual(
    cand5.map((c) => [c.chargeId, c.clinicId, c.providerPaymentId]),
    [[p5.chargeId, A.clinicId, p5.payment]],
  );
  assert.deepEqual(Object.keys(cand5[0]!).sort(), ['chargeId', 'clinicId', 'providerPaymentId']);
  const sweep5 = await reconcileExternalRefundCandidates(cand5, {
    deadlineAt: Date.now() + 30_000,
  });
  const l5 = await ledger(p5);
  assert.deepEqual(
    [sweep5.recorded, sweep5.failed, l5.status, l5.pago, l5.charge, l5.evidence],
    [1, 0, 'pendente', '0.00', 'refunded', ['150.00/150.00/reconcile/true']],
  );
  const cand5b = await dbAdmin.transaction((tx) => scanExternalRefundCandidates(tx, 10));
  assert.equal(
    cand5b.length,
    0,
    'cobrança estornada sai da varredura; as lidas agora só voltam depois do intervalo',
  );
  pass(
    'webhook perdido: a varredura administrativa devolve SÓ identificadores (cobrança, clínica, pagamento), a leitura autenticada com a chave da clínica reconhece o estorno integral e o livro compensa; na volta seguinte não há candidato',
  );

  // ── 6. Falha transacional (evidência) e retry; falha no livro (handler) e retry ───
  const p6 = await paidAppointment(A, 'falha');
  asaas.get(p6.payment)!.refunds = [{ status: 'DONE', value: 50 }];
  await sql`create or replace function public.__harness_fail() returns trigger language plpgsql as $$ begin raise exception 'falha simulada'; end $$`;
  await sql`create trigger __harness_fail_evidence before insert on public.patient_external_refunds for each row execute function public.__harness_fail()`;
  const r6a = await webhook(A, 'evt_p6_1', 'PAYMENT_PARTIALLY_REFUNDED', p6.payment);
  const [ob6a] =
    await sql`select count(*)::int as n from public.outbox where event_type like 'payments.patient_refund.external%' and payload->>'chargeId' = ${p6.chargeId}`;
  assert.deepEqual(
    [r6a.status, ob6a!.n, (await ledger(p6)).evidence.length],
    [500, 0, 0],
    'nada pela metade: 500 pede reentrega',
  );
  await sql`drop trigger __harness_fail_evidence on public.patient_external_refunds`;
  // Agora o LIVRO falha uma vez (worker): a compensação inteira volta e o evento é re-tentado.
  await sql`create trigger __harness_fail_refund before insert on public.payment_transactions for each row when (new.kind = 'refund') execute function public.__harness_fail()`;
  const r6b = await webhook(A, 'evt_p6_1', 'PAYMENT_PARTIALLY_REFUNDED', p6.payment);
  assert.equal(r6b.status, 200);
  await drain(1);
  const mid6 = await ledger(p6);
  const [ob6b] =
    await sql`select status::text as status, attempts from public.outbox where event_type = 'payments.patient_refund.external_recognized' and payload->>'chargeId' = ${p6.chargeId}`;
  const [adj6] =
    await sql`select count(*)::int as n from public.patient_credit_adjustments where patient_charge_id = ${p6.chargeId}::uuid`;
  assert.deepEqual(
    [
      mid6.evidence.length,
      mid6.refunds.length,
      mid6.pago,
      adj6!.n,
      ob6b!.status === 'processed',
      Number(ob6b!.attempts) >= 1,
    ],
    [1, 0, '150.00', 0, false, true],
  );
  await sql`drop trigger __harness_fail_refund on public.payment_transactions`;
  await sql`update public.outbox set next_attempt_at = now() where event_type = 'payments.patient_refund.external_recognized' and payload->>'chargeId' = ${p6.chargeId}`;
  await drain();
  const l6 = await ledger(p6);
  assert.deepEqual(
    [l6.refunds.map((r) => r.amount), l6.pago, l6.status],
    [['50.00'], '100.00', 'parcial'],
  );
  pass(
    'falha transacional: com a evidência falhando, o webhook devolve 500 e nada fica pela metade (sem evento, sem evidência); na reentrega reconhece. Com o livro falhando no worker, a compensação volta inteira (sem ajuste, sem estorno no recebível) e o retry aplica UMA vez',
  );

  // ── 7. Worker interrompido: o passo pós-resposta não roda; o cron do outbox conclui ─
  const p7 = await paidAppointment(A, 'interrompido');
  asaas.get(p7.payment)!.refunds = [{ status: 'DONE', value: 20 }];
  const direct7 = await reconcileExternalRefund({
    clinicId: A.clinicId,
    providerPaymentId: p7.payment,
    payment: { paymentId: p7.payment, status: 'RECEIVED', value: 150, deleted: false },
    refunds: [{ refundId: null, status: 'DONE', value: 20 }],
    source: 'webhook',
    asaasEventId: 'evt_p7',
  });
  assert.equal(direct7.outcome, 'recorded');
  assert.equal((await ledger(p7)).refunds.length, 0, 'evento pendente: o livro ainda não mudou');
  const s7 = await settleRefundNow({
    clinicId: A.clinicId,
    chargeId: direct7.chargeId!,
    appointmentId: direct7.appointmentId!,
    eventKey: direct7.eventKey!,
    eventType: 'payments.patient_refund.external_recognized',
  });
  const l7 = await ledger(p7);
  assert.deepEqual(
    [s7.processed >= 1, l7.refunds.map((r) => r.amount), l7.pago],
    [true, ['20.00'], '130.00'],
  );
  pass(
    'worker interrompido: o reconhecimento fica gravado com o evento pendente e o livro intacto; o passo pós-resposta (ou o cron do outbox) processa só aquele evento e compensa R$ 20',
  );

  // ── 8. Cobrança inexistente, clínica divergente, paciente divergente ─────────────
  const unk = await reconcileExternalRefund({
    clinicId: A.clinicId,
    providerPaymentId: 'pay_que_nao_existe',
    payment: { paymentId: 'pay_que_nao_existe', status: 'REFUNDED', value: 150, deleted: false },
    refunds: [{ refundId: null, status: 'DONE', value: 150 }],
    source: 'webhook',
    asaasEventId: 'evt_unk',
  });
  const p8a = await paidAppointment(A, 'pacienteA');
  const p8b = await paidAppointment(A, 'pacienteB');
  const beforeA = await ledger(p8a);
  // O token/conta de B com o pagamento de A: a cobrança só é procurada na clínica B.
  asaas.get(p8a.payment)!.status = 'REFUNDED';
  asaas.get(p8a.payment)!.refunds = [{ status: 'DONE', value: 150 }];
  const cross = await reconcileExternalRefund({
    clinicId: B.clinicId,
    providerPaymentId: p8a.payment,
    payment: { paymentId: p8a.payment, status: 'REFUNDED', value: 150, deleted: false },
    refunds: [{ refundId: null, status: 'DONE', value: 150 }],
    source: 'webhook',
    asaasEventId: 'evt_cross',
  });
  const crossRoute = await webhook(B, 'evt_cross_route', 'PAYMENT_REFUNDED', p8a.payment);
  await drain();
  assert.deepEqual(
    [unk.outcome, cross.outcome, crossRoute.status],
    ['unknown_charge', 'unknown_charge', 200],
  );
  assert.deepEqual(await ledger(p8a), beforeA, 'nada muda na clínica A pelo caminho da clínica B');
  const wrongToken = await webhook(A, 'evt_forjado', 'PAYMENT_REFUNDED', p8b.payment, B.token);
  assert.equal(wrongToken.status, 401);
  // Estorno do paciente B: só a cobrança de B muda.
  asaas.get(p8a.payment)!.status = 'RECEIVED';
  asaas.get(p8a.payment)!.refunds = [];
  asaas.get(p8b.payment)!.refunds = [{ status: 'DONE', value: 60 }];
  await webhook(A, 'evt_p8b', 'PAYMENT_PARTIALLY_REFUNDED', p8b.payment);
  await drain();
  assert.deepEqual(await ledger(p8a), beforeA);
  assert.deepEqual(
    (await ledger(p8b)).refunds.map((r) => r.amount),
    ['60.00'],
  );
  pass(
    'cobrança inexistente → "unknown_charge" sem escrita; o pagamento da clínica A chegando pela conta da clínica B (serviço e rota real) não encontra nada (RLS) e A fica intacta; token de outra clínica → 401; estorno do paciente B não toca o paciente A',
  );

  // ── 9. Valor divergente e devolução acima do valor: só pendência, nada compensado ─
  const p9 = await paidAppointment(A, 'divergente');
  asaas.get(p9.payment)!.value = 145;
  asaas.get(p9.payment)!.refunds = [{ status: 'DONE', value: 50 }];
  await webhook(A, 'evt_p9', 'PAYMENT_PARTIALLY_REFUNDED', p9.payment);
  await drain();
  const l9 = await ledger(p9);
  assert.deepEqual([l9.refunds.length, l9.pago, l9.evidence.length], [0, '150.00', 0]);
  assert.match(
    l9.pendencia ?? '',
    /^aberta:50\.00:Estorno no Asaas sem conciliação automática \(o valor da cobrança no Asaas difere/u,
  );
  const p9b = await paidAppointment(A, 'acima');
  asaas.get(p9b.payment)!.refunds = [
    { status: 'DONE', value: 100 },
    { status: 'DONE', value: 60 },
  ];
  const r9b1 = await webhook(A, 'evt_p9b', 'PAYMENT_REFUNDED', p9b.payment);
  const r9b2 = await webhook(A, 'evt_p9b_2', 'PAYMENT_REFUNDED', p9b.payment);
  assert.deepEqual(
    [r9b1.status, r9b2.status],
    [200, 200],
    'a segunda entrega do mesmo fato não pode virar 500',
  );
  await drain();
  const l9b = await ledger(p9b);
  const [rev9] =
    await sql`select count(*)::int as n from public.outbox where event_type = 'payments.patient_refund.external_review_required' and payload->>'chargeId' = ${p9b.chargeId}`;
  assert.deepEqual([l9b.refunds.length, l9b.pago, rev9!.n], [0, '150.00', 1]);
  assert.match(l9b.pendencia ?? '', /devolveu mais que o valor/u);
  pass(
    'valor divergente (Asaas R$ 145 × cobrança R$ 150) e devolução acima do valor: nenhuma compensação, só a pendência com o motivo; o mesmo fato entregue duas vezes responde 200 nas duas e abre UM aviso',
  );

  // ── 10. Repasse já APROVADO (revisão humana) e novo estorno ───────────────────
  const p10 = await paidAppointment(A, 'repasse', { payout: true });
  asaas.get(p10.payment)!.refunds = [{ status: 'DONE', value: 50 }];
  await webhook(A, 'evt_p10_1', 'PAYMENT_PARTIALLY_REFUNDED', p10.payment);
  await drain();
  const review = await withTenant(
    A.clinicId,
    (tx) =>
      recordProfessionalPayoutReview(tx, {
        clinicId: A.clinicId,
        payoutId: p10.payoutId!,
        amount: 60,
        reason: 'Atendimento realizado; devolução parcial acordada.',
        decidedBy: A.doctorId,
      }),
    A.doctorId,
  );
  assert.deepEqual(
    [review.ceilingAmount, review.referenceAmount, review.decidedAmount],
    [75, 50, 60],
  );
  asaas.get(p10.payment)!.refunds.push({ status: 'DONE', value: 30 });
  await webhook(A, 'evt_p10_2', 'PAYMENT_PARTIALLY_REFUNDED', p10.payment);
  await drain();
  const [po10] =
    await sql`select status from public.professional_payouts where id = ${p10.payoutId}::uuid`;
  const reviews10 =
    await sql`select version, decided_amount::text as v from public.professional_payout_reviews where payout_id = ${p10.payoutId}::uuid order by version`;
  const [aud10] =
    await sql`select before->>'payoutAmount' as v, after->>'reason' as reason from public.audit_events
    where action = 'financial.professional_payout.suspended' and resource_id = ${p10.payoutId} and after->>'reason' = 'payment_reversed_after_review'`;
  const review2 = await withTenant(
    A.clinicId,
    (tx) =>
      recordProfessionalPayoutReview(tx, {
        clinicId: A.clinicId,
        payoutId: p10.payoutId!,
        amount: 35,
        reason: 'Novo estorno; ajuste ao recebido.',
        decidedBy: A.doctorId,
      }),
    A.doctorId,
  );
  assert.deepEqual(
    [
      po10!.status,
      reviews10.map((r) => `${r.version}:${r.v}`),
      aud10!.v,
      review2.version,
      review2.referenceAmount,
    ],
    ['cancelled', ['1:60.00'], '60.00', 2, 35],
  );
  pass(
    'repasse já aprovado por revisão humana (R$ 60) e novo estorno no Asaas (+R$ 30): o repasse volta a "suspenso" com o valor aprovado preservado na auditoria e a versão 1 intacta; a nova referência (R$ 35 = 50% de R$ 70 recebidos) dá o valor a compensar (R$ 25) e a nova decisão vira a versão 2 — nenhum dinheiro é movido',
  );

  // ── 11. Duas instâncias concorrentes (webhook × varredura) ──────────────────
  const p11 = await paidAppointment(A, 'concorrente');
  asaas.get(p11.payment)!.status = 'REFUNDED';
  asaas.get(p11.payment)!.refunds = [{ status: 'DONE', value: 150 }];
  const both = await Promise.all(
    ['webhook', 'reconcile', 'webhook', 'reconcile'].map((source, i) =>
      reconcileExternalRefund({
        clinicId: A.clinicId,
        providerPaymentId: p11.payment,
        payment: { paymentId: p11.payment, status: 'REFUNDED', value: 150, deleted: false },
        refunds: [{ refundId: null, status: 'DONE', value: 150 }],
        source: source as 'webhook' | 'reconcile',
        asaasEventId: source === 'webhook' ? `evt_p11_${i}` : null,
      }),
    ),
  );
  await drain();
  const l11 = await ledger(p11);
  assert.deepEqual(
    [
      both.filter((r) => r.outcome === 'recorded').length,
      l11.evidence.length,
      l11.refunds.length,
      l11.pago,
    ],
    [1, 1, 1, '0.00'],
  );
  pass(
    'quatro instâncias concorrentes (webhook × varredura) para o mesmo estorno: UM reconhecimento, UMA evidência, UMA compensação',
  );

  // ── 12. Intenção do Qoro confirmada + estorno externo; intenção aberta → revisão ──
  const p12 = await paidAppointment(A, 'intencao');
  await sql`insert into public.patient_refund_intents (clinic_id, patient_charge_id, purpose, amount, status, provider_payment_id, baseline_refunded_amount, baseline_refund_count, baseline_rejected_refund_count, source_event_id, confirmed_at)
    values (${A.clinicId}::uuid, ${p12.chargeId}::uuid, 'excess', 10, 'confirmed', ${p12.payment}, 0, 0, 0, ${randomUUID()}::uuid, now())`;
  asaas.get(p12.payment)!.refunds = [
    { status: 'DONE', value: 10 },
    { status: 'DONE', value: 25 },
  ];
  await webhook(A, 'evt_p12', 'PAYMENT_PARTIALLY_REFUNDED', p12.payment);
  await drain();
  const l12 = await ledger(p12);
  assert.deepEqual(
    [l12.evidence, l12.refunds.map((r) => r.amount)],
    [['25.00/25.00/webhook/false'], ['25.00']],
  );
  const p12b = await paidAppointment(A, 'intencao-aberta');
  await sql`insert into public.patient_refund_intents (clinic_id, patient_charge_id, purpose, amount, status, provider_payment_id, baseline_refunded_amount, baseline_refund_count, baseline_rejected_refund_count, source_event_id)
    values (${A.clinicId}::uuid, ${p12b.chargeId}::uuid, 'excess', 40, 'confirmation_pending', ${p12b.payment}, 0, 0, 0, ${randomUUID()}::uuid)`;
  asaas.get(p12b.payment)!.refunds = [{ status: 'DONE', value: 25 }];
  await webhook(A, 'evt_p12b', 'PAYMENT_PARTIALLY_REFUNDED', p12b.payment);
  await drain();
  const l12b = await ledger(p12b);
  assert.deepEqual([l12b.evidence.length, l12b.refunds.length], [0, 0]);
  assert.match(l12b.pendencia ?? '', /devolução pedida pelo Qoro ainda sem confirmação/u);
  pass(
    'o que a intenção CONFIRMADA do Qoro explica (R$ 10) não é externo: só os R$ 25 restantes são compensados; com intenção ainda aberta a atribuição é ambígua e vira pendência, sem compensação',
  );

  // ── 13. Falha na leitura do Asaas: 500 (reentrega), nada gravado ─────────────
  const p13 = await paidAppointment(A, 'leitura');
  asaas.get(p13.payment)!.refunds = [{ status: 'DONE', value: 15 }];
  asaas.get(p13.payment)!.failRefundsOnce = true;
  const r13a = await webhook(A, 'evt_p13', 'PAYMENT_PARTIALLY_REFUNDED', p13.payment);
  const mid13 = await ledger(p13);
  const r13b = await webhook(A, 'evt_p13', 'PAYMENT_PARTIALLY_REFUNDED', p13.payment);
  await drain();
  assert.deepEqual(
    [
      r13a.status,
      mid13.evidence.length,
      r13b.status,
      (await ledger(p13)).refunds.map((r) => r.amount),
    ],
    [500, 0, 200, ['15.00']],
  );
  pass(
    'a leitura dos estornos no Asaas falha: 500 (o Asaas reentrega) sem nada gravado; a reentrega reconhece normalmente',
  );

  // ── 14. Isolamento: RLS na evidência e só inclusão para o runtime ────────────
  const visibleFromB = await withTenant(B.clinicId, (tx) =>
    tx.execute(dsql`select count(*)::int as n from public.patient_external_refunds`),
  );
  await assert.rejects(
    withTenant(A.clinicId, (tx) =>
      tx.execute(dsql`update public.patient_external_refunds set amount = 1`),
    ),
    (e: unknown) => /permission denied/u.test(String((e as { cause?: Error }).cause?.message ?? e)),
  );
  await assert.rejects(
    withTenant(A.clinicId, (tx) => tx.execute(dsql`delete from public.patient_external_refunds`)),
    (e: unknown) => /permission denied/u.test(String((e as { cause?: Error }).cause?.message ?? e)),
  );
  assert.equal((visibleFromB as unknown as Array<{ n: number }>)[0]!.n, 0);
  assert.ok(
    httpCalls.every((c) => c.startsWith('GET ')),
    'o Qoro só LEU o Asaas: nenhum POST de estorno, nenhuma cobrança',
  );
  pass(
    'a clínica B não enxerga a evidência da A (RLS); o runtime não altera nem apaga evidência; o Qoro só fez GET no Asaas (nenhum estorno nem cobrança criados)',
  );

  console.log(
    `\n${passed}/14 provas do R54 passaram (Postgres descartável, Asaas simulado na fronteira HTTP).`,
  );
} finally {
  globalThis.fetch = realFetch;
  await cluster.stop();
}
process.exit(0);
