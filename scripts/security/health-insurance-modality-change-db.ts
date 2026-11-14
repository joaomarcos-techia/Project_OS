/**
 * P4.3 — troca particular ↔ convênio pela agenda e remarcação levando a cobertura (R50), em
 * Postgres DESCARTÁVEL com as migrations reais. Serviço real (`changeAppointmentModalityTx`),
 * Scheduling real, gatilhos reais, worker do outbox com o handler real do Payments; o Asaas é
 * SIMULADO na fronteira HTTP (só `sandbox.asaas.invalid`). Nenhuma credencial, nenhum Sandbox.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-modality-change-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';

import { startScratchSchema } from './scratch-schema';

const PORT = 55532;
const cluster = await startScratchSchema({ port: PORT, maxConnections: 16 });
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

// ── Asaas simulado ──────────────────────────────────────────────────────────────
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
  if (url.pathname === '/api/v3/payments') return Response.json({ data: [], hasMore: false });
  if (/^\/api\/v3\/checkouts\/[^/]+\/cancel$/u.test(url.pathname))
    return Response.json({ id: 'x', status: 'CANCELLED' });
  return Response.json({ errors: [{ code: 'not_found' }] }, { status: 404 });
}) as typeof fetch;

const { withTenant } = await import('../../src/lib/db/tenant');
const { encryptForTenant } = await import('../../src/lib/crypto/encryption');
await import('../../src/app/api/cron/outbox/handlers');
const { runOutboxOnce } = await import('../../src/lib/outbox/worker');
const { changeAppointmentModalityTx, carryCoverageOnRescheduleTx } =
  await import('../../src/contexts/health-insurance/modality-change');
const core = await import('../../src/contexts/scheduling/internal/appointment-core');
const { loadHiFixtures, SYS_ACTOR } = await import('./hi-fixtures');

const fx = await loadHiFixtures(sql, {
  store: { put: async () => {}, get: async () => new Uint8Array(), remove: async () => {} },
  validateXsd: null as never,
});
type Clinic = Awaited<ReturnType<typeof fx.setupClinic>>;
const RC = { ip: null, userAgent: 'harness', requestId: randomUUID() };

let passed = 0;
const pass = (msg: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${msg}`);
};
const drain = async (n = 4) => {
  for (let i = 0; i < n; i++) await runOutboxOnce({ batchSize: 50, parallelism: 1 });
};
async function rejectsCode(code: string, op: () => Promise<unknown>) {
  await assert.rejects(op, (e: unknown) => {
    assert.equal((e as { code?: string }).code, code, String((e as Error).message));
    return true;
  });
}

let slot = 0;
interface Ctx {
  c: Clinic;
  procedureId: string;
}
async function ctxOf(c: Clinic): Promise<Ctx> {
  const [p] =
    await sql`select id from public.procedures where clinic_id = ${c.clinicId}::uuid limit 1`;
  return { c, procedureId: p!.id as string };
}
async function patientWithCard(x: Ctx, label: string, opts: { card?: boolean } = {}) {
  const [pt] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
    values (${x.c.clinicId}::uuid, ${`Paciente ${label}`}, 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`;
  let cardId: string | null = null;
  if (opts.card !== false) {
    const [card] =
      await sql`insert into public.hi_memberships (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
      values (${x.c.clinicId}::uuid, ${pt!.id}::uuid, ${x.c.insurerId}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${randomUUID().replace(/-/g, '').padEnd(64, '0')}, '4321', ${SYS_ACTOR}::uuid) returning id`;
    cardId = card!.id as string;
  }
  return { patientId: pt!.id as string, cardId };
}
async function appointment(x: Ctx, patientId: string, mode: 'particular' | 'convenio') {
  slot += 1;
  const when = new Date(Date.now() + 3 * 86_400_000 + slot * 37 * 60_000).toISOString();
  const r = await core.createAppointmentCore(
    { clinicId: x.c.clinicId, userId: x.c.doctorId },
    'user',
    RC,
    {
      doctorId: x.c.doctorId,
      patientId,
      procedureId: x.procedureId,
      scheduledAt: when,
      ...(mode === 'convenio' ? { billingMode: 'convenio' as const } : {}),
    },
    randomUUID(),
  );
  return r.id;
}
const change = (
  x: Ctx,
  appointmentId: string,
  to: 'particular' | 'convenio',
  choice: { membershipId: string | null; planId?: string | null } | null,
  key = randomUUID(),
) =>
  withTenant(
    x.c.clinicId,
    (tx) =>
      changeAppointmentModalityTx(tx, {
        clinicId: x.c.clinicId,
        userId: x.c.doctorId,
        appointmentId,
        to,
        choice: choice
          ? {
              insurerId: x.c.insurerId,
              planId: choice.planId ?? null,
              membershipId: choice.membershipId,
              guideType: 'consulta',
            }
          : null,
        reason: 'Paciente apresentou a carteirinha na recepção.',
        idempotencyKey: key,
      }),
    x.c.doctorId,
  );
const state = async (appointmentId: string) => {
  const [a] =
    await sql`select billing_mode, status::text as status from public.appointments where id = ${appointmentId}::uuid`;
  const [cv] =
    await sql`select id, status, membership_id::text as card, version from public.hi_appointment_coverages where appointment_id = ${appointmentId}::uuid`;
  const [cp] =
    await sql`select status from public.hi_copayments where appointment_id = ${appointmentId}::uuid`;
  const charges =
    await sql`select kind, status::text as status from public.patient_charges where appointment_id = ${appointmentId}::uuid order by kind`;
  const [ev] =
    await sql`select count(*)::int as n from public.outbox where event_type = 'scheduling.appointment.billing_mode_changed' and payload->>'appointmentId' = ${appointmentId}`;
  return {
    mode: a!.billing_mode as string,
    status: a!.status as string,
    coverage: cv ? (cv.status as string) : null,
    card: cv ? (cv.card as string | null) : null,
    version: cv ? Number(cv.version) : 0,
    copay: cp ? (cp.status as string) : null,
    charges: charges.map((c) => `${c.kind}:${c.status}`),
    events: ev!.n as number,
  };
};
/** Link particular ainda aberto (sinal pendente com checkout no Asaas). */
async function openDepositLink(
  x: Ctx,
  appointmentId: string,
  patientId: string,
  status: 'pending' | 'paid' = 'pending',
) {
  const checkout = `chk_${randomUUID().slice(0, 8)}`;
  await sql`insert into public.patient_charges (clinic_id, appointment_id, patient_id, kind, status, amount, external_reference,
      provider_checkout_id, checkout_generation, invoice_url, checkout_expires_at, paid_at, provider_payment_id)
    values (${x.c.clinicId}::uuid, ${appointmentId}::uuid, ${patientId}::uuid, 'deposit', ${status}, 50, ${`deposit:${appointmentId}`},
      ${checkout}, 1, ${`https://sandbox.asaas.invalid/c/${checkout}`}, now() + interval '1 day',
      ${status === 'paid' ? sql`now()` : null}, ${status === 'paid' ? `pay_${checkout}` : null})`;
  return checkout;
}

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  const A = await ctxOf(await fx.setupClinic('Modalidade A'));
  const apiKey = await encryptForTenant(A.c.clinicId, '$aact_hmlg_sintetica_modalidade');
  await sql`insert into public.clinic_payment_accounts (clinic_id, provider, api_key_encrypted, key_version, active, connected_at)
    values (${A.c.clinicId}::uuid, 'asaas', ${apiKey}, 1, true, now())`;

  // ── 1. Particular → convênio com link do sinal aberto ─────────────────────────
  const p1 = await patientWithCard(A, 'um');
  const ap1 = await appointment(A, p1.patientId, 'particular');
  const chk1 = await openDepositLink(A, ap1, p1.patientId);
  const r1 = await change(A, ap1, 'convenio', { membershipId: p1.cardId });
  const mid1 = await state(ap1);
  assert.deepEqual(
    [r1.from, r1.to, mid1.mode, mid1.card, mid1.events, mid1.charges],
    ['particular', 'convenio', 'convenio', p1.cardId, 1, ['deposit:pending']],
  );
  assert.ok(['ready', 'incomplete', 'pending_authorization'].includes(String(mid1.coverage)));
  await drain();
  const after1 = await state(ap1);
  assert.deepEqual(after1.charges, ['deposit:cancelled']);
  assert.ok(
    httpCalls.includes(`POST /api/v3/checkouts/${chk1}/cancel`),
    'o link do sinal foi cancelado no Asaas',
  );
  // A cobrança cheia não volta: o banco recusa recebível do valor cheio para convênio.
  await assert.rejects(
    sql`insert into public.lancamentos (clinic_id, tipo, descricao, valor, status, due_date, patient_id, appointment_id, created_via)
        values (${A.c.clinicId}::uuid, 'receber', 'Consulta cheia', 150, 'pendente', current_date, ${p1.patientId}::uuid, ${ap1}::uuid, 'manual')`,
    (e: unknown) => (e as { code?: string }).code === '23514',
  );
  pass(
    `particular → convênio com o link do sinal aberto: modalidade, cobertura (${String(mid1.coverage)}) e evento numa transação; o worker anula o link no Asaas e a cobrança vira "cancelada"; recebível do valor cheio continua recusado pelo banco`,
  );

  // ── 2. → convênio com pagamento do paciente já recebido: recusado, nada muda ─────
  const p2 = await patientWithCard(A, 'pago');
  const ap2 = await appointment(A, p2.patientId, 'particular');
  await openDepositLink(A, ap2, p2.patientId, 'paid');
  const before2 = await state(ap2);
  await rejectsCode('PATIENT_PAYMENT_RECEIVED', () =>
    change(A, ap2, 'convenio', { membershipId: p2.cardId }),
  );
  assert.deepEqual(await state(ap2), before2);
  pass(
    '→ convênio com sinal já PAGO: recusado com orientação (decidir o dinheiro no Caixa); modalidade, cobertura, cobrança e eventos intactos',
  );

  // ── 3. Carteirinha de outro paciente; operadora de outra clínica ─────────────
  const p3 = await patientWithCard(A, 'tres', { card: false });
  const ap3 = await appointment(A, p3.patientId, 'particular');
  await rejectsCode('CHOICE_INVALID', () =>
    change(A, ap3, 'convenio', { membershipId: p1.cardId }),
  );
  await rejectsCode('CHOICE_REQUIRED', () => change(A, ap3, 'convenio', null));
  assert.equal((await state(ap3)).mode, 'particular');
  pass(
    'carteirinha de OUTRO paciente → recusada; sem operadora → recusada; o atendimento continua particular',
  );

  // ── 4. Convênio → particular antes da chegada: cobertura encerrada, nada apagado ──
  const p4 = await patientWithCard(A, 'quatro');
  const ap4 = await appointment(A, p4.patientId, 'particular');
  await change(A, ap4, 'convenio', { membershipId: p4.cardId });
  const conv4 = await state(ap4);
  const r4 = await change(A, ap4, 'particular', null);
  await drain();
  const part4 = await state(ap4);
  assert.deepEqual(
    [r4.to, part4.mode, part4.coverage, part4.card, part4.version > conv4.version, part4.charges],
    ['particular', 'particular', 'cancelled', p4.cardId, true, []],
  );
  // Volta para convênio: a mesma cobertura (versão nova) e a estimativa reaproveitada.
  await change(A, ap4, 'convenio', { membershipId: p4.cardId });
  const back4 = await state(ap4);
  assert.deepEqual(
    [back4.mode, back4.coverage === 'cancelled', back4.version > part4.version],
    ['convenio', false, true],
  );
  const [nCov] =
    await sql`select count(*)::int as n from public.hi_appointment_coverages where appointment_id = ${ap4}::uuid`;
  assert.equal(nCov!.n, 1);
  pass(
    'convênio → particular: cobertura "cancelada" com operadora e carteirinha no histórico (versão nova), nenhuma cobrança criada; voltar para convênio reaproveita a mesma cobertura (outra versão), sem erro na coparticipação',
  );

  // ── 5. Depois da chegada: recusado pelo serviço e pelo banco ─────────────────
  const p5 = await patientWithCard(A, 'cinco');
  const ap5 = await appointment(A, p5.patientId, 'particular');
  await sql`update public.appointments set status = 'em_atendimento' where id = ${ap5}::uuid`;
  await rejectsCode('APPOINTMENT_STARTED', () =>
    change(A, ap5, 'convenio', { membershipId: p5.cardId }),
  );
  await assert.rejects(
    withTenant(A.c.clinicId, (tx) =>
      tx.execute(
        dsql`update public.appointments set billing_mode = 'convenio' where id = ${ap5}::uuid`,
      ),
    ),
    (e: unknown) =>
      /só muda até a chegada/u.test(String((e as { cause?: Error }).cause?.message ?? e)),
  );
  pass(
    'em atendimento: o serviço recusa com orientação (correção do atendimento) e o banco recusa a mesma troca feita direto (gatilho 0148)',
  );

  // ── 6. Outra clínica; clínica sem o módulo; assinatura suspensa ──────────────
  const B = await ctxOf(await fx.setupClinic('Modalidade B'));
  await rejectsCode('APPOINTMENT_NOT_FOUND', () => change(B, ap3, 'convenio', null));
  const C = await ctxOf(await fx.setupClinic('Modalidade C'));
  const pc = await patientWithCard(C, 'c');
  const apc = await appointment(C, pc.patientId, 'convenio');
  await sql`update public.hi_clinic_settings set enabled = false where clinic_id = ${C.c.clinicId}::uuid`;
  const apcPart = await appointment(C, pc.patientId, 'particular');
  await rejectsCode('CHOICE_INVALID', () =>
    change(C, apcPart, 'convenio', { membershipId: pc.cardId }),
  );
  const rc = await change(C, apc, 'particular', null);
  assert.equal(rc.to, 'particular');
  const D = await ctxOf(await fx.setupClinic('Modalidade D'));
  const pd = await patientWithCard(D, 'd');
  const apd = await appointment(D, pd.patientId, 'convenio');
  const apdPart = await appointment(D, pd.patientId, 'particular');
  await sql`update public.subscriptions set billing_status = 'past_due', current_period_start = now() - interval '40 days',
      current_period_end = now() - interval '10 days', grace_period_until = now() - interval '3 days' where clinic_id = ${D.c.clinicId}::uuid`;
  await assert.rejects(() => change(D, apdPart, 'convenio', { membershipId: pd.cardId }));
  assert.equal((await state(apdPart)).mode, 'particular');
  assert.equal((await change(D, apd, 'particular', null)).to, 'particular');
  pass(
    'outra clínica não acha o atendimento; sem o módulo ou com a assinatura suspensa, virar convênio é recusado — e voltar para particular continua possível (não prende a operação)',
  );

  // ── 7. Duas trocas concorrentes do mesmo atendimento ──────────────────────
  const p7 = await patientWithCard(A, 'sete');
  const ap7 = await appointment(A, p7.patientId, 'particular');
  const both = await Promise.allSettled([
    change(A, ap7, 'convenio', { membershipId: p7.cardId }),
    change(A, ap7, 'convenio', { membershipId: p7.cardId }),
  ]);
  const ok7 = both.filter((r) => r.status === 'fulfilled').length;
  const same7 = both.filter(
    (r) => r.status === 'rejected' && (r.reason as { code?: string }).code === 'SAME_MODE',
  ).length;
  const st7 = await state(ap7);
  assert.deepEqual([ok7, same7, st7.mode, st7.events], [1, 1, 'convenio', 1]);
  pass(
    'duas trocas simultâneas: uma vence, a outra vê "já é convênio" (atendimento travado); UM evento, UMA cobertura',
  );

  // ── 8. Remarcação leva a cobertura (R50) ────────────────────────────────
  const p8 = await patientWithCard(A, 'oito');
  const ap8 = await appointment(A, p8.patientId, 'particular');
  await change(A, ap8, 'convenio', { membershipId: p8.cardId });
  const moved = await core.rescheduleCore(
    { clinicId: A.c.clinicId, userId: A.c.doctorId },
    'user',
    RC,
    ap8,
    { newScheduledAt: new Date(Date.now() + 9 * 86_400_000).toISOString() },
    randomUUID(),
  );
  await drain();
  const old8 = await state(ap8);
  const new8 = await state(moved.id);
  assert.deepEqual(
    [
      old8.status,
      old8.coverage,
      new8.mode,
      new8.card,
      new8.coverage !== null && new8.coverage !== 'cancelled',
    ],
    ['cancelado', 'cancelled', 'convenio', p8.cardId, true],
  );
  const [aud8] =
    await sql`select count(*)::int as n from public.audit_events where action = 'health_insurance.coverage.carried_on_reschedule' and after->>'appointmentId' = ${moved.id}`;
  assert.equal(aud8!.n, 1);
  // Reentrega do evento: nada muda.
  const again8 = await withTenant(A.c.clinicId, (tx) =>
    carryCoverageOnRescheduleTx(tx, {
      clinicId: A.c.clinicId,
      oldAppointmentId: ap8,
      newAppointmentId: moved.id,
    }),
  );
  assert.equal(again8.outcome, 'no_coverage');
  // Carteirinha desativada antes de remarcar: o novo fica convênio SEM cobertura (pendência), nunca particular.
  const p8b = await patientWithCard(A, 'oito-b');
  const ap8b = await appointment(A, p8b.patientId, 'particular');
  await change(A, ap8b, 'convenio', { membershipId: p8b.cardId });
  await sql`update public.hi_memberships set status = 'inactive' where id = ${p8b.cardId}::uuid`;
  const moved8b = await core.rescheduleCore(
    { clinicId: A.c.clinicId, userId: A.c.doctorId },
    'user',
    RC,
    ap8b,
    { newScheduledAt: new Date(Date.now() + 10 * 86_400_000).toISOString() },
    randomUUID(),
  );
  await drain();
  const new8b = await state(moved8b.id);
  assert.equal(new8b.mode, 'convenio');
  pass(
    `remarcar convênio (R50): o novo horário continua convênio com a MESMA carteirinha e cobertura rederivada, a do antigo vira "cancelada" e a cópia é auditada; reentrega não duplica; com a carteirinha desativada o novo fica convênio (${new8b.coverage ?? 'sem cobertura'}), nunca particular`,
  );

  // ── 9. Reprocessar o evento da troca: nada a mais ────────────────────────
  const calls9 = httpCalls.length;
  await sql`update public.outbox set status = 'pending', attempts = 0, processed_at = null, next_attempt_at = now()
    where event_type = 'scheduling.appointment.billing_mode_changed' and payload->>'appointmentId' = ${ap1}`;
  await drain();
  assert.deepEqual([(await state(ap1)).charges, httpCalls.length], [['deposit:cancelled'], calls9]);
  pass(
    'o evento da troca reprocessado à força: a cobrança já cancelada não é tocada e o Asaas não é chamado de novo',
  );

  console.log(
    `\n${passed}/9 provas do P4.3 passaram (Postgres descartável, Asaas simulado na fronteira HTTP).`,
  );
} finally {
  globalThis.fetch = realFetch;
  await cluster.stop();
}
process.exit(0);
