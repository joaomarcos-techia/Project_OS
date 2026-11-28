/**
 * P11 — jornadas de Convênios do agente de IA contra o banco DESCARTÁVEL, com as consultas reais do Convênios
 * (`getSchedulingInsuranceOptions`, `checkSchedulingChoice`, `procedureRequiresAuthorization`) e o adaptador de
 * respostas seguras (`agent-insurance.ts`). É o lado do Convênios do contrato `handoff-agente-p11.md`; a conversa em
 * si é da frente do agente. Dados sintéticos.
 *
 *   1. só operadoras e planos ATIVOS da própria clínica aparecem para o agente;
 *   2. isolamento: a operadora de uma clínica não aparece (nem casa pelo nome) na outra;
 *   3. módulo desligado = "não atende convênio"; nada a oferecer;
 *   4. jornada 2 (aceito): a agenda aceita a escolha sem carteirinha (pendência da recepção) e o agente só avisa
 *      que a recepção confere a carteirinha;
 *   5. jornada 5 (autorização): o contrato vigente exige autorização → o agente avisa o aval da operadora; fora da
 *      vigência, não;
 *   6. jornada 3 (não aceito): operadora inativa, de outra clínica, plano de outra operadora ou módulo desligado →
 *      recusa com a frase segura (o motivo técnico fica para a recepção);
 *   7. nenhuma resposta entregue ao paciente afirma cobertura, autorização, elegibilidade ou valor;
 *   8. nada disso escreve: atendimentos, guias e lançamentos continuam iguais (nenhum faturamento automático).
 *
 *   SECURITY_PG_BIN=... PORT=55641 NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/agent-insurance-journeys-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { credentialAllPlans, grantPaidSubscription, startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55641);
const cluster = await startScratchSchema({ port: PORT, maxConnections: 8 });
const { sql } = cluster;
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
if (!new RegExp(`@(?:127\\.0\\.0\\.1|localhost):${PORT}/`, 'u').test(cluster.url))
  throw new Error('não é o cluster local');

const { getSchedulingInsuranceOptions, procedureRequiresAuthorization } =
  await import('../../src/contexts/health-insurance/config-queries');
const { checkSchedulingChoice } =
  await import('../../src/contexts/health-insurance/scheduling-coverage');
const agent = await import('../../src/contexts/health-insurance/agent-insurance');

const SYS = '00000000-0000-0000-0000-0000000000aa';
let passed = 0;
const pass = (n: number, msg: string) => {
  passed += 1;
  console.log(`PASS ${n}: ${msg}`);
};

async function clinic(label: string, enabled: boolean) {
  const clinicId = randomUUID();
  await sql`insert into public.clinics (id, slug, nome, status)
    values (${clinicId}::uuid, ${`ag-${clinicId.slice(0, 8)}`}, ${`Clínica ${label}`}, 'active')`;
  await grantPaidSubscription(sql, clinicId);
  await sql`insert into public.hi_clinic_settings (clinic_id, enabled, enabled_at, enabled_by, provider_kind, cnes_status)
    values (${clinicId}::uuid, ${enabled}, case when ${enabled}::boolean then now() end,
      ${enabled ? SYS : null}, 'PJ', 'none_declared')`;
  const insurer = async (name: string, status: string, ans: string) =>
    (
      await sql`insert into public.hi_insurers
          (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, status, created_by)
        values (${clinicId}::uuid, ${name}, ${ans}, 'codigoPrestadorNaOperadora', 'TESTE001', ${status}, ${SYS}::uuid)
        returning id`
    )[0]!.id as string;
  const plan = async (insurerId: string, name: string, status: string) =>
    (
      await sql`insert into public.hi_plans (clinic_id, insurer_id, name, status)
        values (${clinicId}::uuid, ${insurerId}::uuid, ${name}, ${status}) returning id`
    )[0]!.id as string;
  const proc = async (codigo: string) =>
    (
      await sql`insert into public.procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
        values (${clinicId}::uuid, ${codigo}, 'Procedimento sintético', 150, 30, true) returning id`
    )[0]!.id as string;
  const patient = (
    await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
      values (${clinicId}::uuid, 'Paciente Sintético Agente', 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`
  )[0]!.id as string;
  return { clinicId, insurer, plan, proc, patient };
}

const contract = async (
  c: { clinicId: string },
  insurerId: string,
  procedureId: string,
  requiresAuth: boolean,
  from: string,
  until: string | null,
) =>
  sql`insert into public.hi_procedure_contracts
      (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id,
       unit_value_cents, valid_from, valid_until, requires_authorization, copay_kind, created_by)
    values (${c.clinicId}::uuid, ${insurerId}::uuid, 'consulta', '22', ${requiresAuth ? '10101039' : '10101012'},
      'Contrato sintético', ${procedureId}::uuid, 15000, ${from}::date, ${until}::date, ${requiresAuth}, 'none', ${SYS}::uuid)`;

try {
  const a = await clinic('A', true);
  const umId = await a.insurer('Operadora Um Sintética', 'active', '111111');
  const inativa = await a.insurer('Operadora Suspensa Sintética', 'suspended', '222222');
  const planoAtivo = await a.plan(umId, 'Enfermaria', 'active');
  await a.plan(umId, 'Plano Antigo', 'archived');
  const consulta = await a.proc('CONS');
  const comAut = await a.proc('AUT');
  await contract(a, umId, consulta, false, '2026-01-01', null);
  await contract(a, umId, comAut, true, '2026-01-01', null);
  await credentialAllPlans(sql, a.clinicId);

  const b = await clinic('B', true);
  const soDaB = await b.insurer('Operadora Só da B', 'active', '333333');
  await credentialAllPlans(sql, b.clinicId);
  const c = await clinic('C', false);
  await c.insurer('Operadora de Clínica Desligada', 'active', '444444');

  const counts = async () =>
    (
      await sql`select (select count(*)::int from public.appointments) as ap,
                       (select count(*)::int from public.hi_guides) as gu,
                       (select count(*)::int from public.lancamentos) as la`
    )[0]!;
  const before = await counts();

  // 1 e 2 — só ativos da própria clínica; isolamento entre clínicas.
  const optA = agent.agentInsuranceOptions(await getSchedulingInsuranceOptions(a.clinicId));
  assert.equal(optA.kind, 'options');
  assert.deepEqual(
    optA.kind === 'options' ? optA.insurers.map((i) => [i.name, i.plans.map((p) => p.name)]) : [],
    [['Operadora Um Sintética', ['Enfermaria']]],
  );
  pass(
    1,
    'clínica A: o agente vê só a operadora ativa e só o plano ativo dela (inativos e de outras clínicas fora)',
  );
  const optB = agent.agentInsuranceOptions(await getSchedulingInsuranceOptions(b.clinicId));
  assert.deepEqual(optB.kind === 'options' ? optB.insurers.map((i) => i.id) : [], [soDaB]);
  assert.equal(agent.matchInsurerFromPatientText(optB, 'tenho operadora um sintetica'), null);
  assert.deepEqual(agent.matchInsurerFromPatientText(optA, 'Tenho a Operadora Um Sintética'), {
    id: umId,
    name: 'Operadora Um Sintética',
  });
  pass(2, 'isolamento: a operadora da clínica A não aparece nem casa pelo nome na clínica B');

  // 3 — módulo desligado.
  const optC = agent.agentInsuranceOptions(await getSchedulingInsuranceOptions(c.clinicId));
  assert.deepEqual(optC, { kind: 'not_available', reply: agent.AGENT_INSURANCE_TEXT.notAccepted });
  pass(3, 'módulo desligado: "não atende esse convênio pelo Qoro", nada oferecido');

  // 4 — jornada 2.
  const choice = {
    insurerId: umId,
    planId: planoAtivo,
    membershipId: null,
    guideType: 'consulta' as const,
  };
  const refusal = await checkSchedulingChoice(a.clinicId, a.patient, choice);
  assert.equal(refusal, null, String(refusal));
  const needsAuth = await procedureRequiresAuthorization(a.clinicId, {
    ...choice,
    procedureId: consulta,
  });
  const v2 = agent.agentChoiceVerdict({ refusal, requiresAuthorization: needsAuth });
  assert.deepEqual(v2, {
    allowed: true,
    billingMode: 'convenio',
    notices: [agent.AGENT_INSURANCE_TEXT.receptionChecksCard],
  });
  pass(
    4,
    'jornada 2: a agenda aceita sem carteirinha (pendência da recepção) e o agente só avisa a conferência',
  );

  // 5 — jornada 5.
  const needs = await procedureRequiresAuthorization(a.clinicId, {
    ...choice,
    procedureId: comAut,
  });
  const v5 = agent.agentChoiceVerdict({ refusal: null, requiresAuthorization: needs });
  assert.ok(v5.allowed && v5.notices.includes(agent.AGENT_INSURANCE_TEXT.authorizationNeeded));
  assert.equal(
    await procedureRequiresAuthorization(a.clinicId, {
      ...choice,
      procedureId: comAut,
      on: '2025-12-31',
    }),
    false,
  );
  pass(
    5,
    'jornada 5: contrato vigente exige autorização → aviso do aval da operadora; fora da vigência, não',
  );

  // 6 — jornada 3.
  const refused: Array<[string, string, string, Parameters<typeof checkSchedulingChoice>[2]]> = [
    ['operadora suspensa', a.clinicId, a.patient, { ...choice, insurerId: inativa, planId: null }],
    [
      'operadora de outra clínica',
      a.clinicId,
      a.patient,
      { ...choice, insurerId: soDaB, planId: null },
    ],
    ['plano de outra operadora', b.clinicId, b.patient, { ...choice, insurerId: soDaB }],
    ['módulo desligado', c.clinicId, c.patient, { ...choice, planId: null }],
  ];
  for (const [label, clinicId, patientId, ch] of refused) {
    const r = await checkSchedulingChoice(clinicId, patientId, ch);
    assert.notEqual(r, null, label);
    const v = agent.agentChoiceVerdict({ refusal: r, requiresAuthorization: false });
    assert.deepEqual(
      v,
      { allowed: false, reply: agent.AGENT_INSURANCE_TEXT.notAccepted, internalReason: r },
      label,
    );
  }
  pass(
    6,
    `jornada 3: ${refused.length} recusas da agenda viram a frase segura; o motivo técnico fica para a recepção`,
  );

  // 7 — guarda de saída em tudo que vai ao paciente.
  const replies = [
    optC.kind === 'not_available' ? optC.reply : '',
    ...(v2.allowed ? v2.notices : []),
    ...(v5.allowed ? v5.notices : []),
    agent.coverageQuestionReply().reply,
  ];
  for (const r of replies) assert.deepEqual(agent.findUnsafeAgentClaims(r), [], r);
  pass(
    7,
    `${replies.length} respostas ao paciente sem afirmar cobertura, autorização, elegibilidade ou valor`,
  );

  // 8 — nenhuma escrita.
  assert.deepEqual(await counts(), before);
  pass(
    8,
    'nenhum atendimento, guia ou lançamento criado pelas consultas do agente (nenhum faturamento automático)',
  );

  console.log(`\nP11 (lado do Convênios): ${passed}/8 PASS`);
} finally {
  await cluster.stop();
}
