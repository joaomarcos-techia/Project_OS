/**
 * P11.1 — as ferramentas REAIS do agente de IA com Convênios, pelo registro que já existe (`validateAndExecute`, a
 * mesma porta do turno do WhatsApp), contra o banco DESCARTÁVEL com todas as migrations. Dados sintéticos; nenhum
 * provedor externo (o modelo não é chamado: as chamadas de ferramenta são as que ele faria).
 *
 *   1. list_insurance_options: só nomes das operadoras ATIVAS da clínica do contexto (nem suspensa, nem de outra);
 *   2. isolamento: a operadora da clínica B não casa na A; nada é preparado;
 *   3. módulo desligado: "é com a recepção" (sem recusar convênio) e nada preparado;
 *   4. jornada 2 ponta a ponta: prepare → resumo de convênio sem sinal → "SIM" → atendimento convênio, cobertura
 *      gravada como automação (sem usuário), auditoria, fora do sinal/saldo automático, nenhuma guia;
 *   5. carteirinha que a recepção já cadastrou: a cobertura usa o id dela (o número nunca vai à conversa);
 *   6. jornada 5: contrato vigente exige autorização → o resumo avisa o aval da operadora; SP/SADT pelo contrato;
 *   7. jornada 3: operadora suspensa entre o resumo e o "SIM" → recusa na confirmação, nenhum atendimento;
 *   8. contato sem cadastro: convênio exige o cadastro antes; nada preparado;
 *   9. particular não muda: sem convênio no payload e o atendimento entra no sinal automático como antes;
 *  10. nenhuma resposta das ferramentas afirma cobertura, autorização, elegibilidade ou valor, nem pede a carteirinha.
 *
 *   SECURITY_PG_BIN=... PORT=55642 NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/agent-insurance-tools-db.ts
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

import { credentialAllPlans, grantPaidSubscription, startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55642);
const cluster = await startScratchSchema({ port: PORT, maxConnections: 12 });
const { sql } = cluster;
if (!new RegExp(`@(?:127\\.0\\.0\\.1|localhost):${PORT}/`, 'u').test(cluster.url))
  throw new Error('não é o cluster local');

// Só o processo de teste recebe a URL local e chaves sintéticas; nada do .env.local.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('DATABASE_URL')) delete process.env[key];
}
Object.assign(process.env, {
  DATABASE_URL: cluster.url,
  SUPABASE_PROJECT_ENV: 'dev',
  NEXT_PUBLIC_SUPABASE_URL: 'https://ci.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_ci',
  OUTBOX_CRON_ALLOW_NON_VERCEL: 'true',
  CRYPTO_SECRET_BACKEND: 'env',
  CRYPTO_MASTER_KEY_V1: Buffer.alloc(32, 7).toString('base64'),
  CRYPTO_LOOKUP_SALT: Buffer.alloc(32, 9).toString('base64'),
  ASAAS_BASE_URL: 'https://sandbox.asaas.invalid/api/v3',
  LOG_LEVEL: 'error',
});

const { withTenant } = await import('../../src/lib/db/tenant');
const { encryptForTenant, decryptForTenant } = await import('../../src/lib/crypto');
const { validateAndExecute } = await import('../../src/contexts/ai-agent/tools/registry');
await import('../../src/contexts/ai-agent/tools/list-insurance-options');
await import('../../src/contexts/ai-agent/tools/prepare-appointment');
await import('../../src/contexts/ai-agent/tools/confirm-pending-action');
const { schedulingApiV1 } = await import('../../src/contexts/scheduling');
const { findUnsafeAgentClaims } =
  await import('../../src/contexts/health-insurance/agent-insurance');

const SYS = '00000000-0000-0000-0000-0000000000aa';
let passed = 0;
const pass = (n: number, msg: string) => {
  passed += 1;
  console.log(`PASS ${n}: ${msg}`);
};
const replies: string[] = [];

async function clinic(
  label: string,
  enabled: boolean,
  insurers: Array<{ name: string; status: string; plans?: string[] }>,
) {
  const clinicId = randomUUID();
  const doctorId = randomUUID();
  await sql`insert into auth.users (id, email) values (${doctorId}::uuid, ${`${doctorId}@example.invalid`})`;
  await sql`insert into public.clinics (id, slug, nome, status)
    values (${clinicId}::uuid, ${`ag-tools-${clinicId.slice(0, 8)}`}, ${`Clínica ${label}`}, 'active')`;
  await grantPaidSubscription(sql, clinicId);
  await sql`insert into public.profiles (id, clinic_id, nome, role, ativo)
    values (${doctorId}::uuid, ${clinicId}::uuid, 'Dra. Sintética Agente', 'doctor', true)`;
  // Agenda base da médica: todos os dias, o dia inteiro (o horário da execução do CI não importa).
  for (let weekday = 0; weekday < 7; weekday++) {
    await sql`insert into public.doctor_availability (clinic_id, doctor_id, weekday, start_time, end_time)
      values (${clinicId}::uuid, ${doctorId}::uuid, ${weekday}, '00:00', '23:59')`;
  }
  await sql`insert into public.hi_clinic_settings (clinic_id, enabled, enabled_at, enabled_by, provider_kind, cnes_status)
    values (${clinicId}::uuid, ${enabled}, case when ${enabled}::boolean then now() end,
      ${enabled ? SYS : null}, 'PJ', 'none_declared')`;
  await sql`insert into public.hi_professional_profiles (clinic_id, professional_id, council, council_number, council_uf, cbo)
    values (${clinicId}::uuid, ${doctorId}::uuid, '06', '12345', '35', '225125')`;
  const proc = async (codigo: string, descricao: string) =>
    (
      await sql`insert into public.procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
        values (${clinicId}::uuid, ${codigo}, ${descricao}, 150, 30, true) returning id`
    )[0]!.id as string;
  const consulta = await proc('CONS', 'Consulta Sintética');
  const sessao = await proc('SESS', 'Sessão Sintética de Terapia');
  const insurerIds: Record<string, string> = {};
  const planIds: Record<string, string> = {};
  for (const ins of insurers) {
    const id = (
      await sql`insert into public.hi_insurers
          (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, status, created_by)
        values (${clinicId}::uuid, ${ins.name}, ${String(100000 + Object.keys(insurerIds).length)},
          'codigoPrestadorNaOperadora', 'TESTE001', ${ins.status}, ${SYS}::uuid) returning id`
    )[0]!.id as string;
    insurerIds[ins.name] = id;
    for (const p of ins.plans ?? []) {
      planIds[`${ins.name}/${p}`] = (
        await sql`insert into public.hi_plans (clinic_id, insurer_id, name, status)
          values (${clinicId}::uuid, ${id}::uuid, ${p}, 'active') returning id`
      )[0]!.id as string;
    }
    // Consulta: contrato vigente sem autorização. Sessão: SP/SADT com autorização prévia.
    await sql`insert into public.hi_procedure_contracts
        (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id,
         unit_value_cents, valid_from, requires_authorization, copay_kind, created_by)
      values (${clinicId}::uuid, ${id}::uuid, 'consulta', '22', '10101012', 'Consulta em consultório', ${consulta}::uuid,
         15000, '2026-01-01', false, 'none', ${SYS}::uuid),
        (${clinicId}::uuid, ${id}::uuid, 'sp_sadt', '22', '50000470', 'Sessão sintética', ${sessao}::uuid,
         10000, '2026-01-01', true, 'none', ${SYS}::uuid)`;
  }
  await credentialAllPlans(sql, clinicId);
  const patient = async (nome: string) =>
    (
      await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
        values (${clinicId}::uuid, ${nome}, 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`
    )[0]!.id as string;
  const conversation = async () => {
    const id = randomUUID();
    await sql`insert into public.ai_conversations (id, clinic_id, patient_phone_hash, patient_phone_encrypted)
      values (${id}::uuid, ${clinicId}::uuid, ${randomBytes(32).toString('hex')},
        ${await encryptForTenant(clinicId, 'contato-sintetico')})`;
    return id;
  };
  return { clinicId, doctorId, consulta, sessao, insurerIds, planIds, patient, conversation };
}
type Clinic = Awaited<ReturnType<typeof clinic>>;

/** Uma chamada de ferramenta como o turno faz: transação da clínica + contexto verificado. */
async function call(
  c: Clinic,
  conversationId: string,
  patientId: string | null,
  name: string,
  args: Record<string, unknown>,
  currentMessage: string,
) {
  const out = await withTenant(c.clinicId, (tx) =>
    validateAndExecute(
      { name, args },
      {
        tx,
        clinicId: c.clinicId,
        conversationId,
        eventId: randomUUID(),
        aiRequestId: randomUUID(),
        patientId,
        patientNome: patientId ? 'Paciente Sintético Agente' : null,
        identityAmbiguous: false,
        verifiedPhone: '+5511999990000',
        currentMessage,
        canScheduleAnonymous: true,
        maxDaysAhead: 30,
        clinicTimeZone: 'America/Sao_Paulo',
        pendingAppointmentProcedureName: null,
        canDisclosePayments: false,
      },
    ),
  );
  if (out.ok) {
    const r = out.response as { summary?: unknown; patient_message?: unknown };
    for (const t of [r.summary, r.patient_message]) if (typeof t === 'string') replies.push(t);
  }
  return out;
}
const response = (out: Awaited<ReturnType<typeof call>>) => {
  assert.ok(out.ok, `ferramenta falhou: ${JSON.stringify(out)}`);
  return out.response as Record<string, unknown>;
};
const lastPendingPayload = async (c: Clinic, conversationId: string) => {
  const [row] = await sql`select payload_encrypted from public.ai_pending_actions
    where clinic_id = ${c.clinicId}::uuid and conversation_id = ${conversationId}::uuid
    order by created_at desc limit 1`;
  return row
    ? (JSON.parse(await decryptForTenant(c.clinicId, String(row.payload_encrypted))) as Record<
        string,
        unknown
      >)
    : null;
};
const counts = async (c: Clinic) => {
  const [r] = await sql`select
      (select count(*)::int from public.appointments where clinic_id = ${c.clinicId}::uuid) as appointments,
      (select count(*)::int from public.hi_appointment_coverages where clinic_id = ${c.clinicId}::uuid) as coverages,
      (select count(*)::int from public.hi_guides where clinic_id = ${c.clinicId}::uuid) as guides,
      (select count(*)::int from public.patient_charges where clinic_id = ${c.clinicId}::uuid) as charges`;
  return r as { appointments: number; coverages: number; guides: number; charges: number };
};

try {
  // A mesma ACL gerenciada do Supabase que os outros harnesses reproduzem (ausente no cluster local).
  await sql`GRANT SELECT ON public.clinics, public.subscriptions, public.profiles TO authenticated`;

  const A = await clinic('A', true, [
    { name: 'Unimed Sintética', status: 'active', plans: ['Enfermaria'] },
    { name: 'Saúde Suspensa', status: 'suspended', plans: ['Básico'] },
  ]);
  const B = await clinic('B', true, [{ name: 'Operadora Só da B', status: 'active' }]);
  const C = await clinic('C (módulo desligado)', false, [
    { name: 'Unimed Sintética', status: 'active' },
  ]);
  const patientA = await A.patient('Paciente Sintético A');

  // ── 1. lista: só ativas da própria clínica ─────────────────────────────────────
  {
    const conv = await A.conversation();
    const r = response(
      await call(A, conv, patientA, 'list_insurance_options', {}, 'vocês atendem convênio?'),
    );
    assert.equal(r.status, 'insurance_options');
    assert.deepEqual(r.insurers, [{ name: 'Unimed Sintética', plans: ['Enfermaria'] }]);
    assert.ok(
      !JSON.stringify(r).includes(A.insurerIds['Unimed Sintética']!),
      'id não vai ao modelo',
    );
    const rb = response(
      await call(B, await B.conversation(), null, 'list_insurance_options', {}, 'convênio?'),
    );
    assert.deepEqual(rb.insurers, [{ name: 'Operadora Só da B', plans: [] }]);
    pass(
      1,
      'list_insurance_options: só nomes das operadoras ATIVAS da clínica do contexto (sem suspensa, sem ids, sem a de outra clínica)',
    );
  }

  // ── 2. isolamento ─────────────────────────────────────────────────────────────
  {
    const conv = await A.conversation();
    const before = await counts(A);
    const r = response(
      await call(
        A,
        conv,
        patientA,
        'prepare_appointment',
        { insurer_name: 'Operadora Só da B' },
        'tenho Operadora Só da B',
      ),
    );
    assert.equal(r.status, 'appointment_information_required');
    assert.match(String(r.patient_message), /Unimed Sintética/);
    assert.doesNotMatch(String(r.patient_message), /Só da B/);
    assert.equal(await lastPendingPayload(A, conv), null);
    assert.deepEqual(await counts(A), before);
    pass(2, 'isolamento: a operadora da clínica B não casa na A; nada preparado nem criado');
  }

  // ── 3. módulo desligado ───────────────────────────────────────────────────────
  {
    const conv = await C.conversation();
    const pc = await C.patient('Paciente Sintético C');
    const list = response(await call(C, conv, pc, 'list_insurance_options', {}, 'aceita Unimed?'));
    assert.equal(list.status, 'insurance_not_available');
    const r = response(
      await call(
        C,
        conv,
        pc,
        'prepare_appointment',
        { insurer_name: 'Unimed Sintética' },
        'quero marcar pela Unimed',
      ),
    );
    assert.equal(r.status, 'appointment_unavailable');
    assert.match(String(r.patient_message), /feito pela recepção/);
    assert.doesNotMatch(String(r.patient_message), /não atende/);
    assert.equal(await lastPendingPayload(C, conv), null);
    pass(3, 'módulo desligado: "é com a recepção" (sem recusar convênio) e nada preparado');
  }

  // ── 4. jornada 2 ponta a ponta ────────────────────────────────────────────────
  let convenioAppointment = '';
  {
    const conv = await A.conversation();
    const prep = response(
      await call(
        A,
        conv,
        patientA,
        'prepare_appointment',
        { insurer_name: 'Unimed Sintética', procedure_name: 'Consulta Sintética' },
        'quero marcar uma consulta pela Unimed Sintética',
      ),
    );
    assert.equal(prep.status, 'appointment_prepared', JSON.stringify(prep));
    const summary = String(prep.summary);
    assert.match(summary, /pelo convênio Unimed Sintética \(plano Enfermaria\)/);
    assert.match(summary, /recepção da clínica vai conferir a sua carteirinha/);
    assert.doesNotMatch(summary, /R\$|sinal|link|número/i);
    const payload = await lastPendingPayload(A, conv);
    assert.deepEqual(payload?.insurance, {
      insurerId: A.insurerIds['Unimed Sintética'],
      planId: A.planIds['Unimed Sintética/Enfermaria'],
      membershipId: null,
      guideType: 'consulta',
    });
    assert.equal(payload?.depositAmount, undefined);

    const done = response(await call(A, conv, patientA, 'confirm_pending_action', {}, 'SIM'));
    convenioAppointment = String(done.appointment_id);
    const [ap] =
      await sql`select billing_mode, created_via::text as via, patient_id::text as patient
      from public.appointments where id = ${convenioAppointment}::uuid`;
    assert.deepEqual({ ...ap }, { billing_mode: 'convenio', via: 'ai_agent', patient: patientA });
    const [cov] =
      await sql`select insurer_id::text as insurer, plan_id::text as plan, membership_id, created_via, created_by
      from public.hi_appointment_coverages where appointment_id = ${convenioAppointment}::uuid`;
    assert.ok(cov, 'cobertura registrada');
    assert.equal(cov.insurer, A.insurerIds['Unimed Sintética']);
    assert.equal(cov.plan, A.planIds['Unimed Sintética/Enfermaria']);
    assert.equal(cov.membership_id, null);
    assert.equal(cov.created_via, 'automation');
    assert.equal(cov.created_by, null);
    const [audit] = await sql`select user_id from public.audit_events
      where clinic_id = ${A.clinicId}::uuid and action = 'health_insurance.coverage.recorded_at_scheduling'
        and after->>'appointmentId' = ${convenioAppointment}`;
    assert.ok(audit, 'auditoria da cobertura');
    assert.equal(audit.user_id, null);
    assert.equal(
      await schedulingApiV1.lookupDepositCandidate(A.clinicId, convenioAppointment),
      null,
    );
    const [g] =
      await sql`select count(*)::int as n from public.hi_guides where appointment_id = ${convenioAppointment}::uuid`;
    assert.equal(g!.n, 0);
    const [ch] =
      await sql`select count(*)::int as n from public.patient_charges where appointment_id = ${convenioAppointment}::uuid`;
    assert.equal(ch!.n, 0);
    pass(
      4,
      'jornada 2: prepare → resumo de convênio sem sinal → SIM → atendimento convênio (ai_agent), cobertura como automação sem usuário, auditoria, fora do sinal/saldo, nenhuma guia nem cobrança',
    );
  }

  // ── 5. carteirinha já cadastrada ──────────────────────────────────────────────
  {
    const pt = await A.patient('Paciente Sintético Com Carteirinha');
    const [card] = await sql`insert into public.hi_memberships
        (clinic_id, patient_id, insurer_id, plan_id, card_number_encrypted, card_number_hash, card_last4, created_by)
      values (${A.clinicId}::uuid, ${pt}::uuid, ${A.insurerIds['Unimed Sintética']}::uuid, ${A.planIds['Unimed Sintética/Enfermaria']}::uuid,
        'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${randomUUID().replace(/-/g, '').padEnd(64, '0')}, '4321', ${SYS}::uuid) returning id`;
    const conv = await A.conversation();
    const prep = response(
      await call(
        A,
        conv,
        pt,
        'prepare_appointment',
        { insurer_name: 'unimed sintetica', procedure_name: 'Consulta Sintética' },
        'pela unimed sintetica',
      ),
    );
    assert.equal(prep.status, 'appointment_prepared');
    assert.doesNotMatch(String(prep.summary), /4321/);
    assert.equal(
      (await lastPendingPayload(A, conv))?.insurance &&
        ((await lastPendingPayload(A, conv))!.insurance as { membershipId: string }).membershipId,
      card!.id,
    );
    const done = response(await call(A, conv, pt, 'confirm_pending_action', {}, 'confirmo'));
    const [cov] =
      await sql`select membership_id::text as m from public.hi_appointment_coverages where appointment_id = ${String(done.appointment_id)}::uuid`;
    assert.equal(cov?.m, card!.id);
    pass(
      5,
      'carteirinha que a recepção já cadastrou: a cobertura usa o id dela; os últimos dígitos não vão para a conversa',
    );
  }

  // ── 6. jornada 5 (autorização) + SP/SADT pelo contrato ────────────────────────
  {
    const conv = await A.conversation();
    const prep = response(
      await call(
        A,
        conv,
        patientA,
        'prepare_appointment',
        { insurer_name: 'Unimed Sintética', procedure_name: 'Sessão Sintética de Terapia' },
        'quero marcar a sessão pela Unimed Sintética',
      ),
    );
    assert.equal(prep.status, 'appointment_prepared', JSON.stringify(prep));
    assert.match(String(prep.summary), /precisa do aval da operadora/);
    assert.doesNotMatch(String(prep.summary), /está autorizad|foi autorizad/i);
    assert.equal(
      ((await lastPendingPayload(A, conv))!.insurance as { guideType: string }).guideType,
      'sp_sadt',
    );
    pass(
      6,
      'jornada 5: contrato vigente com autorização → o resumo avisa o aval da operadora (sem afirmar autorização); tipo de guia SP/SADT pelo contrato',
    );
  }

  // ── 7. jornada 3: suspensa entre o resumo e o SIM ─────────────────────────────
  {
    const conv = await A.conversation();
    const prep = response(
      await call(
        A,
        conv,
        patientA,
        'prepare_appointment',
        { insurer_name: 'Unimed Sintética', procedure_name: 'Consulta Sintética' },
        'pela Unimed Sintética',
      ),
    );
    assert.equal(prep.status, 'appointment_prepared');
    const before = await counts(A);
    await sql`update public.hi_insurers set status = 'suspended' where id = ${A.insurerIds['Unimed Sintética']}::uuid`;
    const out = await call(A, conv, patientA, 'confirm_pending_action', {}, 'SIM');
    // O registro devolve a falha do handler sem detalhe ao modelo; o motivo (a reconferência do convênio)
    // está no teste unitário da execução. Aqui vale o efeito: nada criado e a pendência não executada.
    assert.equal(out.ok, false);
    assert.equal((out as { kind?: string }).kind, 'handler_error');
    assert.deepEqual(await counts(A), before);
    const [pending] = await sql`select status from public.ai_pending_actions
      where clinic_id = ${A.clinicId}::uuid and conversation_id = ${conv}::uuid order by created_at desc limit 1`;
    assert.equal(pending!.status, 'pending');
    // Operadora suspensa também não casa no prepare (só ativas): "não está entre as que a clínica agenda".
    const again = response(
      await call(
        A,
        conv,
        patientA,
        'prepare_appointment',
        { insurer_name: 'Saúde Suspensa' },
        'tenho Saúde Suspensa',
      ),
    );
    assert.equal(again.status, 'appointment_information_required');
    await sql`update public.hi_insurers set status = 'active' where id = ${A.insurerIds['Unimed Sintética']}::uuid`;
    pass(
      7,
      'jornada 3: operadora suspensa entre o resumo e o SIM → recusa na confirmação e nada criado; suspensa nunca casa no prepare',
    );
  }

  // ── 8. contato sem cadastro ───────────────────────────────────────────────────
  {
    const conv = await A.conversation();
    const r = response(
      await call(
        A,
        conv,
        null,
        'prepare_appointment',
        { insurer_name: 'Unimed Sintética' },
        'quero marcar pela Unimed Sintética',
      ),
    );
    assert.deepEqual(r, {
      status: 'patient_registration_required',
      required_fields: ['nome', 'cpf', 'motivo'],
    });
    assert.equal(await lastPendingPayload(A, conv), null);
    pass(
      8,
      'contato sem cadastro: convênio exige o cadastro antes (mesmo com marcação anônima permitida); nada preparado',
    );
  }

  // ── 9. particular não muda ────────────────────────────────────────────────────
  {
    const conv = await A.conversation();
    const prep = response(
      await call(
        A,
        conv,
        patientA,
        'prepare_appointment',
        { procedure_name: 'Consulta Sintética' },
        'quero marcar uma consulta particular',
      ),
    );
    assert.equal(prep.status, 'appointment_prepared');
    assert.doesNotMatch(String(prep.summary), /convênio/);
    assert.equal((await lastPendingPayload(A, conv))?.insurance, undefined);
    const done = response(await call(A, conv, patientA, 'confirm_pending_action', {}, 'SIM'));
    const [ap] =
      await sql`select billing_mode from public.appointments where id = ${String(done.appointment_id)}::uuid`;
    assert.equal(ap!.billing_mode, 'particular');
    assert.notEqual(
      await schedulingApiV1.lookupDepositCandidate(A.clinicId, String(done.appointment_id)),
      null,
    );
    const [cov] =
      await sql`select count(*)::int as n from public.hi_appointment_coverages where appointment_id = ${String(done.appointment_id)}::uuid`;
    assert.equal(cov!.n, 0);
    pass(
      9,
      'particular não muda: sem convênio no payload, atendimento particular, segue para o sinal automático como antes, sem cobertura',
    );
  }

  // ── 10. nenhuma frase das ferramentas afirma o que não pode ───────────────────
  {
    assert.ok(replies.length >= 8, `respostas coletadas: ${replies.length}`);
    for (const t of replies) assert.deepEqual(findUnsafeAgentClaims(t), [], t);
    pass(
      10,
      `nenhuma das ${replies.length} respostas das ferramentas afirma cobertura, autorização, elegibilidade ou valor, nem pede a carteirinha`,
    );
  }

  console.log(`\nagent-insurance-tools-db: ${passed}/10 PASS`);
  assert.equal(passed, 10);
} finally {
  const { dbAdmin, db, dbWorker } = await import('../../src/lib/db');
  await Promise.allSettled([
    dbAdmin.$client.end({ timeout: 5 }),
    db.$client.end({ timeout: 5 }),
    dbWorker.$client.end({ timeout: 5 }),
  ]);
  await cluster.stop();
}
