/**
 * D24 (decisão definitiva do fundador, 11/11/2026) — trial de 14 dias é para
 * CONHECER o Qoro: Convênios TISS só funciona com assinatura paga e ativa. Prova da
 * migration 0151 em Postgres DESCARTÁVEL, com o código real dos serviços e do
 * worker, nos cenários pedidos:
 *
 *   trial no 1º e no 14º dia; trial expirado; sem assinatura; pagamento pendente;
 *   pagamento confirmado/assinatura ativa; cancelada; vencida (dunning suspendeu);
 *   graça do dunning; módulo desligado; acesso direto ao banco (como a API faria);
 *   worker e reconcile com evento atrasado e reprocessado; tentativa de gerar guia no
 *   trial; plano que não inclui o recurso; transição trial → paga; nada apagado
 *   quando a assinatura cai; leitura continua; particular intocado; isolamento.
 *
 * O pool do app aponta para o cluster local. Não toca DEV nem produção; nenhuma
 * chamada ao Asaas. Uso:
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-premium-gate-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { grantPaidSubscription, startScratchSchema, credentialAllPlans } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55509);
const cluster = await startScratchSchema({ port: PORT, maxConnections: 32 });
const { sql } = cluster;
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.OUTBOX_CRON_ALLOW_NON_VERCEL = 'true';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');
if (!new RegExp(`@(?:127\\.0\\.0\\.1|localhost):${PORT}/`, 'u').test(cluster.url))
  throw new Error('não é o cluster local');

const { withTenant } = await import('../../src/lib/db/tenant');
await import('../../src/app/api/cron/outbox/handlers');
const { runOutboxOnce } = await import('../../src/lib/outbox/worker');
const { applyTransition } = await import('../../src/contexts/scheduling/internal/appointment-core');
const { recordAppointmentCoverage } =
  await import('../../src/contexts/health-insurance/internal/coverage-service');
const { listBillingGapCandidates, reconcileInsuranceBilling } =
  await import('../../src/contexts/health-insurance');
const { processInsuranceBilling } =
  await import('../../src/contexts/health-insurance/internal/billing-recovery');
const { createBatchInTx } = await import('../../src/contexts/health-insurance/internal/batch-service');
const { getPremiumDenialTx, PremiumAccessError, premiumAccessErrorFrom } =
  await import('../../src/lib/premium-access');

const SYS = '00000000-0000-0000-0000-0000000000aa';
const CIPHER = 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
let passed = 0;
const pass = (msg: string): void => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};
/** Erro do banco da 0151: 23514 + constraint + motivo no DETAIL (nunca dado de paciente). */
async function premiumRejects(reason: string, op: () => Promise<unknown>): Promise<void> {
  await assert.rejects(op, (e: unknown) => {
    const translated = premiumAccessErrorFrom(e);
    assert.ok(translated, `esperava bloqueio comercial, veio: ${String((e as Error)?.message)}`);
    assert.equal(translated.feature, 'health_insurance');
    assert.equal(translated.reason, reason);
    return true;
  });
}
async function asTenant<T>(clinicId: string, fn: (tx: typeof sql) => Promise<T>, actor?: string): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx.unsafe('SET LOCAL ROLE authenticated');
    await tx`select set_config('app.current_clinic', ${clinicId}, true)`;
    if (actor) await tx`select set_config('app.current_user', ${actor}, true)`;
    return fn(tx as unknown as typeof sql);
  })) as T;
}
const denial = (clinicId: string, feature = 'health_insurance') =>
  withTenant(clinicId, (tx) => getPremiumDenialTx(tx, clinicId, feature as 'health_insurance'));

type SubState =
  | { kind: 'none' }
  | { kind: 'trial'; endsIn: string }
  | { kind: 'paid'; plan?: string };

async function setSubscription(clinicId: string, state: SubState): Promise<void> {
  if (state.kind === 'none') return;
  if (state.kind === 'paid') {
    await grantPaidSubscription(sql, clinicId, state.plan);
    return;
  }
  // O titular (`owner`) já existe: quem chama cria antes (ver setupClinic).
  await sql`insert into public.subscriptions (clinic_id, plan_id, price_id, billing_status, trial_ends_at, enforce_trial_deadline)
    select ${clinicId}::uuid, pl.id, pr.id, 'trial', now() + ${state.endsIn}::interval, true
      from public.plans pl join public.prices pr on pr.plan_id = pl.id
     where pl.code = 'clinica_2026_2' order by pr.id limit 1`;
}

let slot = 0;
async function setupClinic(label: string, sub: SubState, clinicStatus = 'active') {
  const clinicId = randomUUID();
  const doctorId = randomUUID();
  await sql`insert into auth.users (id, email) values (${doctorId}::uuid, ${`${doctorId}@example.invalid`})`;
  await sql`insert into public.clinics (id, slug, nome, status)
    values (${clinicId}::uuid, ${`pg-${clinicId.slice(0, 8)}`}, ${`Clínica ${label}`}, ${clinicStatus}::clinic_status)`;
  // Integrado sobre o #53 (0136), o trial é de UMA pessoa: a assinatura de trial exige um titular
  // ativo (`enroll_new_subscription_trial_limits`, "trial owner missing") e, durante a avaliação, o
  // banco recusa outro perfil além dele (`team_invites`, "Evaluation feature requires verified
  // subscription payment"). Na clínica em trial, o profissional é o próprio titular; a branch
  // sozinha não tem esses gatilhos, e nada nas provas abaixo depende do papel do profissional.
  // O procedimento nasce antes da assinatura de trial: com a avaliação já vencida, o #53 recusa
  // recurso novo ("Evaluation expired", `enforce_trial_resource_limit`), e a clínica de trial vencido
  // só precisa existir com o que já tinha.
  const trial = sub.kind === 'trial';
  if (trial) {
    await sql`insert into public.profiles (id, clinic_id, nome, role, ativo)
      values (${doctorId}::uuid, ${clinicId}::uuid, 'Profissional sintético (titular)', 'owner', true)`;
  }
  const newProcedure = async () =>
    (await sql`insert into public.procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
      values (${clinicId}::uuid, 'CONS', 'Consulta sintética', 150, 30, true) returning id`)[0]!.id as string;
  const trialProcedure = trial ? await newProcedure() : null;
  await setSubscription(clinicId, sub);
  if (!trial) {
    await sql`insert into public.profiles (id, clinic_id, nome, role, ativo)
      values (${doctorId}::uuid, ${clinicId}::uuid, 'Profissional sintético', 'doctor', true)`;
  }
  const proc = { id: trialProcedure ?? (await newProcedure()) };
  return { clinicId, doctorId, procedureId: proc!.id as string, label };
}
type Clinic = Awaited<ReturnType<typeof setupClinic>>;

/** Liga o módulo e cadastra o mínimo do convênio (só funciona com assinatura liberada). */
async function enableInsurance(c: Clinic) {
  await sql`insert into public.hi_clinic_settings (clinic_id, enabled, enabled_at, enabled_by, provider_kind, cnes_status)
    values (${c.clinicId}::uuid, true, now(), ${SYS}, 'PJ', 'none_declared')`;
  const [ins] = await sql`insert into public.hi_insurers
      (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, status, created_by)
    values (${c.clinicId}::uuid, 'Operadora Um', '123456', 'codigoPrestadorNaOperadora', 'TESTE001', 'active', ${SYS}::uuid)
    returning id`;
  await credentialAllPlans(sql, c.clinicId);
  await sql`insert into public.hi_professional_profiles (clinic_id, professional_id, council, council_number, council_uf, cbo)
    values (${c.clinicId}::uuid, ${c.doctorId}::uuid, '06', '12345', '35', '225125')`;
  await sql`insert into public.hi_procedure_contracts
      (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id,
       unit_value_cents, valid_from, requires_authorization, copay_kind, created_by)
    values (${c.clinicId}::uuid, ${ins!.id}::uuid, 'consulta', '22', '10101012', 'Consulta em consultório',
      ${c.procedureId}::uuid, 15000, '2026-01-01', false, 'none', ${SYS}::uuid)`;
  return ins!.id as string;
}

async function newPatient(c: Clinic): Promise<string> {
  slot += 1;
  const [p] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
    values (${c.clinicId}::uuid, ${`Paciente ${c.label}-${slot}`}, 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`;
  return p!.id as string;
}
async function newCard(c: Clinic, patientId: string, insurerId: string): Promise<string> {
  const [m] = await sql`insert into public.hi_memberships
      (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
    values (${c.clinicId}::uuid, ${patientId}::uuid, ${insurerId}::uuid, ${CIPHER},
      ${randomUUID().replace(/-/g, '').padEnd(64, '0')}, '9876', ${SYS}::uuid) returning id`;
  return m!.id as string;
}
async function newAppointment(c: Clinic, patientId: string, mode: 'particular' | 'convenio' = 'particular') {
  slot += 1;
  const [a] = await sql`insert into public.appointments (
      clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
      snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via)
    values (${c.clinicId}::uuid, ${c.doctorId}::uuid, ${patientId}::uuid, ${c.procedureId}::uuid,
      '2026-11-12T12:00:00Z'::timestamptz + ${slot} * interval '1 hour', 30, 'agendado', 150,
      'Consulta', 150, 30, 'Profissional sintético', 'attendant') returning id`;
  if (mode === 'convenio') {
    await sql`update public.appointments set billing_mode = 'convenio' where id = ${a!.id}::uuid`;
  }
  return a!.id as string;
}
const coverageFor = (c: Clinic, appointmentId: string, patientId: string, insurerId: string, cardId: string) =>
  withTenant(
    c.clinicId,
    (tx) =>
      recordAppointmentCoverage(tx, {
        clinicId: c.clinicId,
        appointmentId,
        patientId,
        procedureId: c.procedureId,
        appointmentDate: '2026-11-12',
        guideType: 'consulta',
        insurerId,
        planId: null,
        membershipId: cardId,
        authorizationId: null,
        actor: { kind: 'user', userId: c.doctorId },
      }),
    c.doctorId,
  );
async function complete(c: Clinic, appointmentId: string, patientId: string): Promise<void> {
  await sql`update public.appointments set status = 'em_atendimento' where id = ${appointmentId}::uuid`;
  await sql`insert into public.prontuarios (clinic_id, patient_id, doctor_id, appointment_id, status, signed_at, signed_by, content_encrypted)
    values (${c.clinicId}::uuid, ${patientId}::uuid, ${c.doctorId}::uuid, ${appointmentId}::uuid, 'assinado', now(), ${c.doctorId}::uuid,
      'ciphertext-sintetico-do-prontuario')`;
  await withTenant(
    c.clinicId,
    (tx) =>
      applyTransition(tx, {
        clinicId: c.clinicId,
        appointmentId,
        target: 'atendido',
        transitionedBy: c.doctorId,
        actorType: 'user',
        clientKey: `concluir-${appointmentId}`,
        correlationId: null,
      }),
    c.doctorId,
  );
}
async function drainOutbox(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const [{ n }] = (await sql`select count(*)::int as n from public.outbox where status = 'pending'
      and next_attempt_at <= now()`) as unknown as [{ n: number }];
    if (n === 0) return;
    await runOutboxOnce({ batchSize: 50, parallelism: 1 });
  }
}
async function age(appointmentId: string): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`update public.appointments set updated_at = now() - interval '20 minutes' where id = ${appointmentId}::uuid`;
  });
}
const gapOf = async (appointmentId: string) =>
  (
    await sql`select status, reason, owner, recovery, attempts, next_attempt_at, resolution, issues, guide_id
      from public.hi_billing_gaps where appointment_id = ${appointmentId}::uuid`
  )[0] ?? null;
const guidesOf = (appointmentId: string) =>
  sql`select g.id, g.number, g.status from public.hi_guides g
       where g.idempotency_key = ${`appointment:${appointmentId}:consulta`}`;
const receivables = async (appointmentId: string) =>
  (
    await sql`select count(*)::int as n from public.lancamentos
               where appointment_id = ${appointmentId}::uuid and tipo = 'receber'`
  )[0]!.n as number;

try {
  // Supabase concede SELECT em `clinics` ao `authenticated` (a RLS filtra); o scaffold não.
  await sql`GRANT SELECT ON public.clinics TO authenticated`;
  // ── 1. Trial (1º e 14º dia) e trial expirado: nada de Convênios ───────────
  {
    const day1 = await setupClinic('trial-dia-1', { kind: 'trial', endsIn: '13 days 23 hours' });
    const day14 = await setupClinic('trial-dia-14', { kind: 'trial', endsIn: '1 hour' });
    const expired = await setupClinic('trial-expirado', { kind: 'trial', endsIn: '-1 hour' });
    assert.equal(await denial(day1.clinicId), 'trial');
    assert.equal(await denial(day14.clinicId), 'trial');
    assert.equal(await denial(expired.clinicId), 'trial_expired');
    for (const [c, reason] of [[day1, 'trial'], [day14, 'trial'], [expired, 'trial_expired']] as const) {
      // Ligar o módulo é a porta de entrada: o banco recusa, mesmo para o operador (superusuário).
      await premiumRejects(reason, () => enableInsurance(c));
      const [{ n }] = (await sql`select count(*)::int as n from public.hi_clinic_settings
        where clinic_id = ${c.clinicId}::uuid`) as unknown as [{ n: number }];
      assert.equal(n, 0);
    }
    // Os outros dois recursos premium seguem a MESMA decisão central.
    for (const feature of ['patient_charges', 'ai_agents']) {
      assert.equal(await denial(day1.clinicId, feature), 'trial');
      assert.equal(await denial(expired.clinicId, feature), 'trial_expired');
    }
    pass('trial no 1º e no 14º dia e trial expirado: o módulo não liga (nem pelo operador); a decisão vale para os 3 recursos');
  }

  // ── 2. Sem assinatura, pagamento pendente, cancelada, vencida, graça ──────
  {
    const none = await setupClinic('sem-assinatura', { kind: 'none' });
    const pendingTrial = await setupClinic('pagamento-pendente-trial', { kind: 'trial', endsIn: '5 days' }, 'pending_payment');
    const pendingPaid = await setupClinic('pagamento-pendente', { kind: 'paid' }, 'pending_payment');
    const cancelled = await setupClinic('cancelada', { kind: 'paid' }, 'cancelled');
    const suspended = await setupClinic('vencida', { kind: 'paid' }, 'suspended_readonly');
    const grace = await setupClinic('graca-dunning', { kind: 'paid' });
    await sql`update public.subscriptions set billing_status = 'past_due' where clinic_id = ${grace.clinicId}::uuid`;
    const billingCancelled = await setupClinic('billing-cancelado', { kind: 'paid' });
    await sql`update public.subscriptions set billing_status = 'cancelled' where clinic_id = ${billingCancelled.clinicId}::uuid`;
    assert.equal(await denial(none.clinicId), 'no_subscription');
    assert.equal(await denial(pendingTrial.clinicId), 'trial');
    assert.equal(await denial(pendingPaid.clinicId), 'payment_pending');
    assert.equal(await denial(cancelled.clinicId), 'subscription_cancelled');
    assert.equal(await denial(billingCancelled.clinicId), 'subscription_cancelled');
    assert.equal(await denial(suspended.clinicId), 'clinic_suspended');
    await premiumRejects('no_subscription', () => enableInsurance(none));
    await premiumRejects('payment_pending', () => enableInsurance(pendingPaid));
    await premiumRejects('subscription_cancelled', () => enableInsurance(cancelled));
    await premiumRejects('clinic_suspended', () => enableInsurance(suspended));
    // Graça do dunning (ADR-016): a clínica paga com fatura atrasada e ainda ativa segue faturando.
    assert.equal(await denial(grace.clinicId), null);
    await enableInsurance(grace);
    pass('sem assinatura, pagamento pendente, cancelada e vencida (dunning suspendeu) são negadas; past_due com a clínica ativa segue (graça do dunning)');
  }

  // ── 3. Plano que não inclui o recurso (falha fechada) ─────────────────────
  {
    const [plan] = await sql`insert into public.plans (code, name) values ('plano_sintetico_x', 'Plano sintético sem premium') returning id`;
    await sql`insert into public.prices (plan_id, amount, billing_cycle) values (${plan!.id}::uuid, 10, 'monthly')`;
    const c = await setupClinic('plano-sem-recurso', { kind: 'paid', plan: 'plano_sintetico_x' });
    assert.equal(await denial(c.clinicId), 'plan_excludes');
    assert.equal(await denial(c.clinicId, 'ai_agents'), 'plan_excludes');
    await premiumRejects('plan_excludes', () => enableInsurance(c));
    pass('clínica paga com plano que não inclui o recurso: negado (plano desconhecido fica de fora)');
  }

  // ── 4. Assinatura ativa: o fluxo completo funciona; particular intocado ────
  const paid = await setupClinic('paga', { kind: 'paid' });
  const insurerId = await enableInsurance(paid);
  {
    assert.equal(await denial(paid.clinicId), null);
    const patientId = await newPatient(paid);
    const cardId = await newCard(paid, patientId, insurerId);
    const appt = await newAppointment(paid, patientId, 'convenio');
    await coverageFor(paid, appt, patientId, insurerId, cardId);
    await complete(paid, appt, patientId);
    await drainOutbox();
    const guides = await guidesOf(appt);
    assert.equal(guides.length, 1, JSON.stringify({ gap: await gapOf(appt), ev: await sql`select status, last_error from public.outbox where payload->>'appointmentId' = ${appt}` }));
    assert.equal(await receivables(appt), 0, 'convênio nunca cobra o paciente pelo valor cheio');
    const pPatient = await newPatient(paid);
    const pAppt = await newAppointment(paid, pPatient, 'particular');
    await complete(paid, pAppt, pPatient);
    await drainOutbox();
    assert.equal(await receivables(pAppt), 1, 'particular gera o recebível normalmente');
    pass('assinatura paga e ativa: módulo liga, cobertura, conclusão, worker e guia automática; particular gera o recebível');
  }

  // ── 5. Trial: tentativa direta de operar Convênios (como a API faria) ─────
  {
    const trial = await setupClinic('trial-api', { kind: 'trial', endsIn: '10 days' });
    const patientId = await newPatient(trial);
    // Atendimento como convênio: barrado (módulo não liga; e o gatilho comercial confere de novo).
    const appt = await newAppointment(trial, patientId, 'particular');
    await premiumRejects('trial', () =>
      asTenant(trial.clinicId, (tx) => tx`update public.appointments set billing_mode = 'convenio' where id = ${appt}::uuid`),
    );
    // O serviço de cobertura nega ANTES de qualquer leitura, com a mensagem comercial.
    await assert.rejects(
      () => coverageFor(trial, appt, patientId, randomUUID(), randomUUID()),
      (e: unknown) => {
        assert.ok(e instanceof PremiumAccessError);
        assert.equal(e.reason, 'trial');
        assert.match(e.message, /disponível para clínicas com assinatura ativa\. Conheça os planos do Qoro/u);
        return true;
      },
    );
    // Gravação direta nas tabelas operacionais, como `authenticated` na clínica da sessão.
    await premiumRejects('trial', () =>
      asTenant(trial.clinicId, (tx) => tx`insert into public.hi_memberships
          (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
        values (${trial.clinicId}::uuid, ${patientId}::uuid, ${randomUUID()}::uuid, ${CIPHER}, ${'f'.repeat(64)}, '1234', ${SYS}::uuid)`),
    );
    await premiumRejects('trial', () =>
      asTenant(trial.clinicId, (tx) => tx`insert into public.hi_guides (clinic_id, guide_type, insurer_id, status, created_by)
        values (${trial.clinicId}::uuid, 'consulta', ${randomUUID()}::uuid, 'pending_data', ${SYS}::uuid)`),
    );
    await assert.rejects(
      () => withTenant(trial.clinicId, (tx) =>
        createBatchInTx(tx, { clinicId: trial.clinicId, insurerId: randomUUID(), guideType: 'consulta', guideIds: [randomUUID()], idempotencyKey: 'k1' })),
      (e: unknown) => e instanceof PremiumAccessError && e.reason === 'trial',
    );
    pass('trial: marcar convênio, cobertura (serviço), carteirinha, guia e lote (direto no banco e pelo serviço) são todos recusados');
  }

  // ── 6. Isolamento: a decisão não fala de outra clínica ─────────────────────
  {
    const other = await setupClinic('outra', { kind: 'trial', endsIn: '3 days' });
    await assert.rejects(
      () => asTenant(paid.clinicId, (tx) => tx`select public.qoro_premium_denial(${other.clinicId}::uuid, 'health_insurance')`),
      (e: unknown) => (e as { code?: string }).code === '42501',
    );
    await assert.rejects(
      () => asTenant(paid.clinicId, (tx) => tx`select public.qoro_premium_denial_for(${paid.clinicId}::uuid, 'health_insurance')`),
      (e: unknown) => (e as { code?: string }).code === '42501',
    );
    await assert.rejects(
      () => asTenant(paid.clinicId, (tx) => tx`select public.qoro_premium_denial(${paid.clinicId}::uuid, 'outro')`),
      (e: unknown) => (e as { code?: string }).code === '22023',
    );
    pass('isolamento: consultar o estado comercial de outra clínica = 42501; o núcleo sem vínculo de sessão não é executável pelo runtime; recurso desconhecido = 22023');
  }

  // ── 7. Assinatura cai depois do atendimento: worker atrasado, reprocesso, recuperação ──
  {
    const c = await setupClinic('cai-depois', { kind: 'paid' });
    const ins = await enableInsurance(c);
    const patientId = await newPatient(c);
    const cardId = await newCard(c, patientId, ins);
    const appt = await newAppointment(c, patientId, 'convenio');
    await coverageFor(c, appt, patientId, ins, cardId);
    await complete(c, appt, patientId);
    // O evento chega DEPOIS do cancelamento (evento atrasado).
    await sql`update public.subscriptions set billing_status = 'cancelled' where clinic_id = ${c.clinicId}::uuid`;
    await sql`update public.clinics set status = 'cancelled' where id = ${c.clinicId}::uuid`;
    await drainOutbox();
    assert.equal((await guidesOf(appt)).length, 0, 'nenhuma guia nova com a assinatura cancelada');
    let gap = await gapOf(appt);
    assert.deepEqual([gap?.status, gap?.reason, gap?.owner, gap?.recovery], ['open', 'subscription_inactive', 'gestor', 'automatic']);
    assert.ok(gap?.next_attempt_at, 'reavaliação automática agendada (24 h, sem teto)');
    assert.match(JSON.stringify(gap?.issues), /assinatura da clínica não está ativa/u);
    // Reprocessar (evento duplicado / reconcile) não cria guia nem duplica pendência.
    await withTenant(c.clinicId, (tx) =>
      processInsuranceBilling(tx, { clinicId: c.clinicId, appointmentId: appt, detectedBy: 'event', eventState: 'processed', lock: 'wait' }));
    await withTenant(c.clinicId, (tx) =>
      processInsuranceBilling(tx, { clinicId: c.clinicId, appointmentId: appt, detectedBy: 'reconcile', eventState: 'processed', lock: 'wait' }));
    gap = await gapOf(appt);
    assert.equal((await guidesOf(appt)).length, 0);
    assert.equal(gap?.reason, 'subscription_inactive');
    const [{ n: gaps }] = (await sql`select count(*)::int as n from public.hi_billing_gaps where appointment_id = ${appt}::uuid`) as unknown as [{ n: number }];
    assert.equal(gaps, 1);
    // Nada foi apagado: cobertura e carteirinha continuam; leitura funciona.
    const kept = await asTenant(c.clinicId, (tx) => tx`select
        (select count(*)::int from public.hi_appointment_coverages where appointment_id = ${appt}::uuid) as coverages,
        (select count(*)::int from public.hi_memberships where id = ${cardId}::uuid) as cards`);
    assert.deepEqual([kept[0]!.coverages, kept[0]!.cards], [1, 1]);
    // Nova operação continua barrada; desligar o módulo é permitido.
    await premiumRejects('subscription_cancelled', () => newCard(c, patientId, ins));
    // Regularizada (reativação auditada): o reconcile gera a guia sozinho, uma vez.
    await sql`update public.subscriptions set billing_status = 'active' where clinic_id = ${c.clinicId}::uuid`;
    await sql`update public.clinics set status = 'active' where id = ${c.clinicId}::uuid`;
    await age(appt);
    await sql`update public.hi_billing_gaps set next_attempt_at = now() - interval '1 minute' where appointment_id = ${appt}::uuid`;
    const summary = await reconcileInsuranceBilling(await listBillingGapCandidates(50));
    assert.ok(summary.processed >= 1, JSON.stringify(summary));
    const guides = await guidesOf(appt);
    assert.equal(guides.length, 1, 'uma guia, depois da regularização');
    gap = await gapOf(appt);
    assert.deepEqual([gap?.status, gap?.resolution], ['resolved', 'guide_ready']);
    await reconcileInsuranceBilling(await listBillingGapCandidates(50));
    assert.equal((await guidesOf(appt)).length, 1, 'reconcile repetido não duplica');
    assert.equal(await receivables(appt), 0);
    pass('assinatura cancelada antes do worker: sem guia, pendência automática "assinatura inativa"; reprocesso idempotente; nada apagado; regularizada, o reconcile gera UMA guia');
  }

  // ── 8. Transição trial → paga ──────────────────────────────────────────────
  {
    const c = await setupClinic('trial-para-paga', { kind: 'trial', endsIn: '2 days' });
    await premiumRejects('trial', () => enableInsurance(c));
    // Pagamento confirmado (o #53 faz isto ao materializar a fatura paga): assinatura ativa
    // COM o período pago gravado (sem ele, desde a 0154, Convênios fica "period_unverified").
    await sql`update public.subscriptions set billing_status = 'active', trial_ends_at = null,
        current_period_start = now(), current_period_end = now() + interval '30 days'
      where clinic_id = ${c.clinicId}::uuid`;
    assert.equal(await denial(c.clinicId), null);
    const ins = await enableInsurance(c);
    const patientId = await newPatient(c);
    const cardId = await newCard(c, patientId, ins);
    const appt = await newAppointment(c, patientId, 'convenio');
    await coverageFor(c, appt, patientId, ins, cardId);
    await complete(c, appt, patientId);
    await drainOutbox();
    assert.equal((await guidesOf(appt)).length, 1);
    pass('trial → pagamento confirmado: o mesmo estado que era negado passa a liberar, e o fluxo gera a guia');
  }

  // ── 9. Módulo desligado (flag operacional) com assinatura paga ─────────────
  {
    const c = await setupClinic('flag-desligada', { kind: 'paid' });
    await sql`insert into public.hi_clinic_settings (clinic_id, enabled, provider_kind, cnes_status)
      values (${c.clinicId}::uuid, false, 'PJ', 'none_declared')`;
    const patientId = await newPatient(c);
    const appt = await newAppointment(c, patientId, 'particular');
    await assert.rejects(
      () => sql`update public.appointments set billing_mode = 'convenio' where id = ${appt}::uuid`,
      (e: unknown) => (e as { code?: string }).code === '55000',
    );
    // Desligar o módulo de uma clínica sem direito nunca é barrado.
    const lapsed = await setupClinic('desliga-sem-direito', { kind: 'paid' });
    await enableInsurance(lapsed);
    await sql`update public.subscriptions set billing_status = 'cancelled' where clinic_id = ${lapsed.clinicId}::uuid`;
    await sql`update public.hi_clinic_settings set enabled = false where clinic_id = ${lapsed.clinicId}::uuid`;
    pass('assinatura paga com o módulo desligado: convênio não entra (habilitação operacional continua obrigatória); desligar nunca é barrado');
  }

  // ── 10. Carência limitada (0152; orientação de 12/11, seção 7) ─────────────
  {
    const sub = (c: Clinic, set: { end: string | null; grace: string | null; cancelAtEnd?: boolean; status?: string }) =>
      sql`update public.subscriptions set
            current_period_end = ${set.end === null ? null : sql`now() + ${set.end}::interval`},
            grace_period_until = ${set.grace === null ? null : sql`now() + ${set.grace}::interval`},
            cancel_at_period_end = ${set.cancelAtEnd ?? false},
            billing_status = ${set.status ?? 'active'}
          where clinic_id = ${c.clinicId}::uuid`;
    const c = await setupClinic('carencia', { kind: 'paid' });
    // [caso, estado, Convênios, cobrança e IA]
    const cases: Array<[string, Parameters<typeof sub>[1], string | null, string | null]> = [
      ['período em curso', { end: '20 days', grace: '23 days' }, null, null],
      // 0154 (D24-c): fim do período sem registro = dado parcial; Convênios exige evidência,
      // cobrança e IA seguem a compatibilidade transitória do #53 (cenário 11 detalha).
      ['período sem fim registrado (dado parcial)', { end: null, grace: null }, 'period_unverified', null],
      ['período vencido sem carência gravada', { end: '-1 day', grace: null }, 'period_expired', 'period_expired'],
      ['past_due dentro da carência do dunning', { end: '-2 days', grace: '1 day', status: 'past_due' }, null, null],
      ['past_due depois da carência', { end: '-4 days', grace: '-1 hour', status: 'past_due' }, 'period_expired', 'period_expired'],
      ['cancelada no fim do período: sem carência', { end: '-1 hour', grace: '2 days', cancelAtEnd: true }, 'period_expired', 'period_expired'],
    ];
    for (const [name, set, forInsurance, forOthers] of cases) {
      await sub(c, set);
      assert.equal(await denial(c.clinicId, 'health_insurance'), forInsurance, `${name} (health_insurance)`);
      for (const feature of ['patient_charges', 'ai_agents']) {
        assert.equal(await denial(c.clinicId, feature), forOthers, `${name} (${feature})`);
      }
    }
    await sub(c, { end: '-4 days', grace: '-1 hour', status: 'past_due' });
    await premiumRejects('period_expired', () => enableInsurance(c));
    // Preservação: com o período vencido, desligar continua permitido (nada é apagado).
    await sub(c, { end: '20 days', grace: '23 days' });
    await enableInsurance(c);
    await sub(c, { end: '-4 days', grace: '-1 hour', status: 'past_due' });
    await sql`update public.hi_clinic_settings set enabled = false where clinic_id = ${c.clinicId}::uuid`;
    pass('carência limitada: past_due só dentro do `grace_period_until` gravado pelo billing; período vencido sem carência, carência expirada e cancelamento no fim do período = "period_expired" para os 3 recursos; desligar continua permitido');
  }

  // ── 11. D24-c (0154): assinatura antiga sem período pago verificável ────────
  {
    const c = await setupClinic('legada', { kind: 'paid' });
    const [subRow] = await sql`select id from public.subscriptions where clinic_id = ${c.clinicId}::uuid`;
    const subId = subRow!.id as string;
    const setSub = (s: { start: string | null; end: string | null; grace?: string | null; status?: string }) =>
      sql`update public.subscriptions set
            current_period_start = ${s.start === null ? null : sql`now() + ${s.start}::interval`},
            current_period_end = ${s.end === null ? null : sql`now() + ${s.end}::interval`},
            grace_period_until = ${s.grace == null ? null : sql`now() + ${s.grace}::interval`},
            billing_status = ${s.status ?? 'active'}
          where clinic_id = ${c.clinicId}::uuid`;
    const invoice = (from: string, to: string, status = 'paid') =>
      sql`insert into public.invoices (clinic_id, subscription_id, total_amount, status, due_date, paid_at, period_start, period_end)
        values (${c.clinicId}::uuid, ${subId}::uuid, '199.00', ${status}, current_date,
          ${status === 'paid' ? sql`now()` : null}, current_date + ${from}::interval, current_date + ${to}::interval)`;
    const audit = async () =>
      ((await sql`select classification from public.qoro_subscription_period_audit where clinic_id = ${c.clinicId}::uuid`)[0]?.classification ?? null) as string | null;
    const expect3 = async (label: string, insurance: string | null, others: string | null) => {
      assert.equal(await denial(c.clinicId, 'health_insurance'), insurance, `${label} (health_insurance)`);
      for (const f of ['patient_charges', 'ai_agents']) assert.equal(await denial(c.clinicId, f), others, `${label} (${f})`);
    };

    // Ausência de período, sem nenhuma evidência: Convênios negado com motivo explícito;
    // cobrança e IA na compatibilidade transitória do #53; aparece no alerta administrativo.
    await setSub({ start: null, end: null });
    await expect3('antiga sem período e sem fatura', 'period_unverified', null);
    assert.equal(await audit(), 'legacy_unverified');
    await premiumRejects('period_unverified', () => enableInsurance(c));
    // Antiga VENCIDA: a última fatura paga já terminou → não serve de evidência.
    await invoice('-40 days', '-10 days');
    await expect3('antiga com fatura paga vencida', 'period_unverified', null);
    // Fatura em aberto (não paga) nunca libera.
    await invoice('-5 days', '25 days', 'open');
    await expect3('antiga com fatura em aberto', 'period_unverified', null);
    assert.equal(await audit(), 'legacy_unverified');
    // Antiga PAGA: fatura paga cobrindo hoje = evidência verificável.
    await invoice('-5 days', '25 days');
    await expect3('antiga com fatura paga cobrindo hoje', null, null);
    assert.equal(await audit(), 'legacy_paid_invoice_evidence');
    // Duplicidade: duas faturas pagas do mesmo período não estendem nada (só cobrem o período).
    await invoice('-5 days', '25 days');
    const [{ covering }] = (await sql`select covering_paid_invoices as covering from public.qoro_subscription_period_audit where clinic_id = ${c.clinicId}::uuid`) as unknown as [{ covering: number }];
    assert.equal(covering, 2);
    await sql`update public.invoices set period_end = current_date - 1 where subscription_id = ${subId}::uuid and status = 'paid'`;
    await expect3('duas faturas pagas do mesmo período, já vencidas', 'period_unverified', null);
    // Dados parcialmente migrados: início sem fim (ou o contrário).
    await setSub({ start: '-10 days', end: null });
    await expect3('só o início registrado', 'period_unverified', null);
    assert.equal(await audit(), 'inconsistent_period');
    // Período inconsistente: começa no futuro (a regra do #53 nega para os 3 recursos).
    await setSub({ start: '5 days', end: '35 days' });
    await expect3('período que ainda não começou', 'period_expired', 'period_expired');
    assert.equal(await audit(), 'inconsistent_period');
    // Pagamento existente sem atualização do período: o período REGISTRADO venceu; a fatura
    // não o substitui (uma fonte só: o billing) — nega e alerta para a reconciliação.
    await invoice('-1 day', '29 days');
    await setSub({ start: '-32 days', end: '-2 days' });
    await expect3('pago, mas o período registrado não foi atualizado', 'period_expired', 'period_expired');
    assert.equal(await audit(), 'paid_without_period_update');
    // Reconciliação posterior (feita pelo billing do #53, com autorização): período gravado → liberado.
    await setSub({ start: '-1 day', end: '29 days' });
    await expect3('depois da reconciliação do período', null, null);
    assert.equal(await audit(), 'verified_period');
    // Cancelada: negada para os 3, com ou sem evidência.
    await setSub({ start: null, end: null, status: 'cancelled' });
    await expect3('cancelada', 'subscription_cancelled', 'subscription_cancelled');
    assert.equal(await audit(), null);
    // O alerta é só administrativo: o runtime da clínica não lê.
    await assert.rejects(() => asTenant(c.clinicId, (tx) => tx`select * from public.qoro_subscription_period_audit`), (e: unknown) => (e as { code?: string }).code === '42501');
    await setSub({ start: '-1 day', end: '29 days' });
    pass('D24-c: antiga sem período só libera Convênios com fatura PAGA cobrindo hoje (vencida, em aberto ou duplicada não estende); sem evidência = "period_unverified" explícito, com cobrança e IA na compatibilidade transitória do #53; início sem fim, período no futuro e pago-sem-atualização aparecem no alerta administrativo; o período registrado vence a fatura (uma fonte: o billing); reconciliação posterior libera; cancelada nega; alerta não é legível pelo runtime');
  }

  console.log(`\nRESULT: ${passed}/11 PASS`);
  assert.equal(passed, 11);
} finally {
  await cluster.stop();
}
