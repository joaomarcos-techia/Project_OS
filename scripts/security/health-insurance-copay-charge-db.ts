/**
 * Cobrança da coparticipação (P10.5, 0158) em Postgres DESCARTÁVEL, com o gateway MOCKADO
 * (nenhuma chamada ao Asaas, nenhuma credencial; o Sandbox não é usado aqui). O mock faz
 * o que o Pagamentos faz no banco: grava a cobrança do saldo (`patient_charges`, UNIQUE
 * por atendimento); o "webhook" é o crédito que o Financeiro lança no livro.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-copay-charge-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const chain = await readDevOrderChain();
const cluster = await startScratchSchema({ port: 55524, maxConnections: 12, migrations: chain });
const { sql } = cluster;
if (!/@(?:127\.0\.0\.1|localhost):55524\//u.test(cluster.url)) throw new Error('não é o cluster local');
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.OUTBOX_CRON_ALLOW_NON_VERCEL = 'true';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');

const { withTenant } = await import('../../src/lib/db/tenant');
await import('../../src/app/api/cron/outbox/handlers');
const { runOutboxOnce } = await import('../../src/lib/outbox/worker');
const { applyTransition } = await import('../../src/contexts/scheduling/internal/appointment-core');
const { recordAppointmentCoverage } = await import('../../src/contexts/health-insurance/internal/coverage-service');
const { checkCopay, confirmCopay } = await import('../../src/contexts/health-insurance/internal/copay-service');
const copay = await import('../../src/contexts/health-insurance/internal/copay-charge-service');
const { createCopayCheckout } = await import('../../src/contexts/payments/internal/copay-checkout');
const { loadHiFixtures, SYS_ACTOR } = await import('./hi-fixtures');

const fx = await loadHiFixtures(sql, { store: { put: async () => {}, get: async () => new Uint8Array(), remove: async () => {} }, validateXsd: null as never });
type Clinic = Awaited<ReturnType<typeof fx.setupClinic>>;

let passed = 0;
const pass = (msg: string) => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};

/** Gateway mockado: registra as chamadas e grava a cobrança como o Pagamentos faria. */
const calls: Array<{ appointmentId: string; maxAmount: number }> = [];
let failNext = false;
const deps = {
  async createCheckout(i: { clinicId: string; appointmentId: string; patientId: string; maxAmount: number }) {
    calls.push({ appointmentId: i.appointmentId, maxAmount: i.maxAmount });
    if (failNext) {
      failNext = false;
      throw new Error('timeout do gateway (simulado)');
    }
    const [l] = await sql`select valor - valor_pago as saldo from public.lancamentos where clinic_id = ${i.clinicId}::uuid and appointment_id = ${i.appointmentId}::uuid and tipo = 'receber'`;
    const saldo = Number(l!.saldo);
    if (Math.round(saldo * 100) > Math.round(i.maxAmount * 100)) return { outcome: 'above_confirmed', amount: saldo };
    const ins = await sql`insert into public.patient_charges (clinic_id, appointment_id, patient_id, kind, status, amount, external_reference)
      values (${i.clinicId}::uuid, ${i.appointmentId}::uuid, ${i.patientId}::uuid, 'remainder', 'pending', ${saldo}, ${`remainder:${i.appointmentId}`})
      on conflict (appointment_id, kind) do nothing returning id`;
    return { outcome: ins.length ? 'created' : 'existing', amount: saldo };
  },
};

/** Atendimento de convênio com coparticipação de 30% confirmada (R$ 45 de R$ 150), pelo caminho real. */
async function confirmedCopay(c: Clinic, label: string, opts: { confirm?: boolean } = {}) {
  // Procedimento com contrato próprio de coparticipação de 30% (o da fixture não tem).
  let [proc] = await sql`select id from public.procedures where clinic_id = ${c.clinicId}::uuid and codigo = 'CONSCP'`;
  if (!proc) {
    [proc] = await sql`insert into public.procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
      values (${c.clinicId}::uuid, 'CONSCP', 'Consulta com coparticipação', 150, 30, true) returning id`;
    await sql`insert into public.hi_procedure_contracts (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id,
        unit_value_cents, valid_from, copay_kind, copay_percentage, created_by)
      values (${c.clinicId}::uuid, ${c.insurerId}::uuid, 'consulta', '22', '10101039', 'Consulta em pronto socorro',
        ${proc!.id}::uuid, 15000, '2026-01-01', 'percentage', 30, ${SYS_ACTOR}::uuid)`;
  }
  const [pt] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
    values (${c.clinicId}::uuid, ${`Paciente ${label}`}, 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`;
  const [card] = await sql`insert into public.hi_memberships (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
    values (${c.clinicId}::uuid, ${pt!.id}::uuid, ${c.insurerId}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${randomUUID().replace(/-/g, '').padEnd(64, '0')}, '2345', ${SYS_ACTOR}::uuid) returning id`;
  const [ap] = await sql`insert into public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
      snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via, billing_mode)
    values (${c.clinicId}::uuid, ${c.doctorId}::uuid, ${pt!.id}::uuid, ${proc!.id}::uuid, ${'2026-11-11T12:00:00Z'}::timestamptz + ${Math.floor(Math.random() * 500)} * interval '31 minutes',
      30, 'agendado', 150, 'Consulta', 150, 30, 'Dra. Sintética', 'attendant', 'convenio') returning id`;
  const appointmentId = ap!.id as string;
  await withTenant(c.clinicId, (tx) => recordAppointmentCoverage(tx, {
    clinicId: c.clinicId, appointmentId, patientId: pt!.id as string, procedureId: proc!.id as string, appointmentDate: '2026-11-11',
    guideType: 'consulta', insurerId: c.insurerId, planId: null, membershipId: card!.id as string, authorizationId: null,
    actor: { kind: 'user', userId: c.doctorId },
  }), c.doctorId);
  await sql`update public.appointments set status = 'em_atendimento' where id = ${appointmentId}::uuid`;
  await sql`insert into public.prontuarios (clinic_id, patient_id, doctor_id, appointment_id, status, signed_at, signed_by, content_encrypted)
    values (${c.clinicId}::uuid, ${pt!.id}::uuid, ${c.doctorId}::uuid, ${appointmentId}::uuid, 'assinado', now(), ${c.doctorId}::uuid, 'ciphertext-sintetico')`;
  await withTenant(c.clinicId, (tx) => applyTransition(tx, {
    clinicId: c.clinicId, appointmentId, target: 'atendido', transitionedBy: c.doctorId, actorType: 'user', clientKey: `concluir-${appointmentId}`, correlationId: null,
  }), c.doctorId);
  for (let i = 0; i < 4; i++) await runOutboxOnce({ batchSize: 50, parallelism: 1 });
  const [cp] = await sql`select id, status from public.hi_copayments where appointment_id = ${appointmentId}::uuid`;
  assert.ok(cp, 'coparticipação calculada');
  if (opts.confirm !== false) {
    await withTenant(c.clinicId, (tx) => checkCopay(tx, { clinicId: c.clinicId, copaymentId: cp!.id as string, checkedCents: 4500, actorUserId: c.doctorId }), c.doctorId);
    await withTenant(c.clinicId, (tx) => confirmCopay(tx, { clinicId: c.clinicId, copaymentId: cp!.id as string, confirmedCents: 4500, chargeableCents: 4500, actorUserId: c.doctorId, procedureName: 'Consulta' }), c.doctorId);
    for (let i = 0; i < 4; i++) await runOutboxOnce({ batchSize: 50, parallelism: 1 });
  }
  return { copaymentId: cp!.id as string, appointmentId, patientId: pt!.id as string };
}
const statusOf = async (id: string) => (await sql`select status, received_cents::int as received, charge_ref from public.hi_copayments where id = ${id}::uuid`)[0]!;
const request = (c: Clinic, copaymentId: string) => copay.requestCopayCharge(deps, { clinicId: c.clinicId, copaymentId, actorUserId: c.doctorId });
/** "Webhook" pago: o crédito que o Financeiro lança no recebível do paciente. */
async function webhookPaid(c: Clinic, appointmentId: string) {
  return sql.begin(async (tx) => {
    const [l] = await tx`select id, valor from public.lancamentos where clinic_id = ${c.clinicId}::uuid and appointment_id = ${appointmentId}::uuid and tipo = 'receber' for update`;
    await tx`insert into public.payment_transactions (clinic_id, lancamento_id, kind, amount, payment_method) values (${c.clinicId}::uuid, ${l!.id}::uuid, 'payment', ${l!.valor}, 'pix')`;
    await tx`update public.lancamentos set valor_pago = valor, status = 'pago', paid_at = now() where id = ${l!.id}::uuid`;
  });
}

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  await sql`insert into public.tiss_terms (version_id, table_code, code, term, starts_on)
    select id, '22', '10101039', 'Consulta em pronto socorro', '2010-01-01' from public.tiss_terminology_versions where version = '202609'`;
  const A = await fx.setupClinic('Coparticipação A');

  // ── 1. Confirmada: cobra só os R$ 45 confirmados, nunca os R$ 150 ────
  const c1 = await confirmedCopay(A, 'um');
  const r1 = await request(A, c1.copaymentId);
  const [charge] = await sql`select amount::text from public.patient_charges where appointment_id = ${c1.appointmentId}::uuid`;
  assert.deepEqual([r1.outcome, r1.status, r1.amountCents, charge!.amount, calls.length, calls[0]!.maxAmount], ['created', 'charged', 4500, '45.00', 1, 45]);
  pass('1. coparticipação confirmada de R$ 45 (atendimento de R$ 150): o link vai com R$ 45, o teto enviado ao Pagamentos é o confirmado; estado "cobrada" com a referência da cobrança');

  // ── 2. Pedido repetido: nenhuma segunda cobrança nem chamada ─────────
  const r2 = await request(A, c1.copaymentId);
  const [{ n: charges }] = (await sql`select count(*)::int as n from public.patient_charges where appointment_id = ${c1.appointmentId}::uuid`) as unknown as [{ n: number }];
  assert.deepEqual([r2.outcome, calls.length, charges], ['existing', 1, 1]);
  pass('2. pedido repetido: devolve a cobrança existente, sem nova chamada ao gateway (1 cobrança só)');

  // ── 3. Não confirmada e zero: nada é cobrado ─────────────────────────
  const c3 = await confirmedCopay(A, 'pendente', { confirm: false });
  await assert.rejects(() => request(A, c3.copaymentId), /só se cobra coparticipação confirmada/u);
  const zero = await confirmedCopay(A, 'zero', { confirm: false });
  await withTenant(A.clinicId, (tx) => checkCopay(tx, { clinicId: A.clinicId, copaymentId: zero.copaymentId, checkedCents: 0, actorUserId: A.doctorId }), A.doctorId).catch(() => undefined);
  const zeroConfirm = await withTenant(A.clinicId, (tx) => confirmCopay(tx, { clinicId: A.clinicId, copaymentId: zero.copaymentId, confirmedCents: 0, chargeableCents: 0, actorUserId: A.doctorId, procedureName: 'Consulta' }), A.doctorId).then(() => 'ok', (e: Error) => e.message);
  await assert.rejects(() => request(A, zero.copaymentId), /sem valor a cobrar|só se cobra/u);
  assert.equal(calls.length, 1);
  pass(`3. coparticipação calculada mas não confirmada é recusada; coparticipação zero (confirmação: ${zeroConfirm === 'ok' ? 'aceita com zero' : 'recusada'}) não gera cobrança; o gateway não foi chamado`);

  // ── 4. Valor incorreto e tentativa de cobrança integral ──────────────
  await assert.rejects(
    () => sql`insert into public.lancamentos (clinic_id, tipo, descricao, valor, status, due_date, patient_id, appointment_id, created_via)
      values (${A.clinicId}::uuid, 'receber', 'Consulta cheia', 150, 'pendente', current_date, ${c3.patientId}::uuid, ${c3.appointmentId}::uuid, 'manual')`,
    (e: { code?: string }) => e.code === '23514',
  );
  const above = await createCopayCheckout({ clinicId: A.clinicId, appointmentId: c1.appointmentId, patientId: c1.patientId, maxAmount: 40 });
  assert.deepEqual([above.outcome], ['above_confirmed']);
  const noAccount = await createCopayCheckout({ clinicId: A.clinicId, appointmentId: c1.appointmentId, patientId: c1.patientId, maxAmount: 45 });
  assert.equal(noAccount.outcome, 'no_account');
  pass('4. recebível de R$ 150 num atendimento de convênio é recusado pelo banco; o Pagamentos REAL recusa saldo acima do confirmado antes de qualquer chamada e, sem conta Asaas ativa, não cobra');

  // ── 5. Timeout do gateway: nada fica pela metade; a nova tentativa cobra uma vez ─
  const c5 = await confirmedCopay(A, 'timeout');
  failNext = true;
  await assert.rejects(() => request(A, c5.copaymentId), /timeout/u);
  assert.equal((await statusOf(c5.copaymentId)).status, 'confirmed');
  const r5 = await request(A, c5.copaymentId);
  assert.deepEqual([r5.outcome, r5.status], ['created', 'charged']);
  pass('5. timeout do gateway: a coparticipação continua confirmada, sem cobrança; a nova tentativa cria UMA cobrança');

  // ── 6. Pagamento (webhook), webhook duplicado e reprocessamento ──────
  await webhookPaid(A, c1.appointmentId);
  await assert.rejects(() => webhookPaid(A, c1.appointmentId), /payment exceeds lancamento value/u);
  for (let i = 0; i < 3; i++) await withTenant(A.clinicId, (tx) => copay.syncCopayChargeTx(tx, A.clinicId, c1.copaymentId), A.doctorId);
  const s6 = await statusOf(c1.copaymentId);
  assert.deepEqual([s6.status, s6.received], ['paid', 4500]);
  pass('6. pagamento confirmado: "paga" com R$ 45 recebidos; o webhook duplicado é recusado pelo livro; reprocessar (3×) não muda nada');

  // ── 7. Estorno ───────────────────────────────────────────────────────
  const [pay] = await sql`select pt.id, pt.lancamento_id from public.payment_transactions pt join public.lancamentos l on l.id = pt.lancamento_id where l.appointment_id = ${c1.appointmentId}::uuid and pt.kind = 'payment'`;
  await sql`insert into public.payment_transactions (clinic_id, lancamento_id, kind, amount, payment_method, original_payment_id, reason)
    values (${A.clinicId}::uuid, ${pay!.lancamento_id}::uuid, 'refund', 45, 'pix', ${pay!.id}::uuid, 'Estorno sintético da coparticipação')`;
  await withTenant(A.clinicId, (tx) => copay.syncCopayChargeTx(tx, A.clinicId, c1.copaymentId), A.doctorId);
  assert.equal((await statusOf(c1.copaymentId)).status, 'refunded');
  pass('7. estorno integral no livro: a coparticipação fica "estornada" (o histórico de cobrança e pagamento fica)');

  // ── 8. Assinatura suspensa, outra clínica e mutação direta ──────────
  const c8 = await confirmedCopay(A, 'suspensa');
  await sql`update public.subscriptions set billing_status = 'past_due', current_period_start = now() - interval '40 days',
      current_period_end = now() - interval '10 days', grace_period_until = now() - interval '3 days' where clinic_id = ${A.clinicId}::uuid`;
  await assert.rejects(() => request(A, c8.copaymentId), (e: Error) => e.name === 'PremiumAccessError' || /assinatura/iu.test(e.message));
  const B = await fx.setupClinic('Coparticipação B');
  await assert.rejects(() => copay.requestCopayCharge(deps, { clinicId: B.clinicId, copaymentId: c5.copaymentId, actorUserId: B.doctorId }), /inexistente nesta clínica/u);
  await assert.rejects(() => withTenant(B.clinicId, (tx) => copay.syncCopayChargeTx(tx, A.clinicId, c5.copaymentId), B.doctorId));
  await assert.rejects(
    () => withTenant(A.clinicId, (tx) => tx.execute(fx.sqlTag`update public.hi_copayments set charge_ref = 'forjado' where id = ${c5.copaymentId}::uuid`), A.doctorId),
  );
  pass('8. assinatura suspensa (dunning): cobrança recusada; outra clínica não cobra nem sincroniza a coparticipação; o runtime não forja referência de cobrança');

  console.log(`\nOK — ${passed} provas da cobrança da coparticipação (gateway mockado, nenhuma cobrança real).`);
} finally {
  await cluster.stop();
}
