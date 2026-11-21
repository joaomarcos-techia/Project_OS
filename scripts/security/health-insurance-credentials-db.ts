/**
 * Credenciamento por plano e vigência (P2.2) em Postgres DESCARTÁVEL, pelos SERVIÇOS REAIS
 * que a tela chama e pelos que decidem a cobertura (agenda) e a guia (emissão), como o
 * runtime faz (`withTenant` → `authenticated` + clínica da sessão, RLS e gatilhos).
 *
 *  1. Cadastro: plano obrigatório (ou "todos os planos" marcado de propósito, nunca os
 *     dois); plano de outra operadora, fim antes do início, código inválido, profissional
 *     de outra clínica e vigências sobrepostas recusados.
 *  2. Cobertura (agenda): sem credenciamento → pendência; credenciada só no plano A,
 *     atendimento no B → pendência "só em outros planos"; clínica no B mas profissional não
 *     habilitado (PJ) → pendência do profissional; os dois → pronta.
 *  3. Suspenso → pendência "SUSPENSO"; reativado → pronta. Vigência encerrada antes da
 *     data → pendência; futura → pendência.
 *  4. Nova vigência (mudança de credenciamento): a anterior fecha na véspera, nasce uma
 *     linha nova, o passado continua coberto pela antiga e o histórico fica (2 linhas).
 *  5. Operadora que dispensa a habilitação individual: só a clínica conta.
 *  6. Guia (emissão): sem credenciamento a guia nasce com pendência; registrado, a
 *     atualização tira a pendência.
 *  7. Outra clínica não vê nem muda o credenciamento; trial cadastra (preparação) mas não
 *     registra cobertura (D24).
 *
 * Não toca DEV nem produção. Uso:
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-credentials-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { sql as sqlTag } from 'drizzle-orm';

import { grantPaidSubscription, startScratchSchema } from './scratch-schema';

const cluster = await startScratchSchema({ port: 55530, maxConnections: 16 });
const { sql } = cluster;
if (!/@(?:127\.0\.0\.1|localhost):55530\//u.test(cluster.url))
  throw new Error('não é o cluster local');
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');

const { withTenant } = await import('../../src/lib/db/tenant');
const cfg = await import('../../src/contexts/health-insurance/internal/config-service');
const { recordAppointmentCoverage } =
  await import('../../src/contexts/health-insurance/internal/coverage-service');
const { createConsultaGuideForAppointment, refreshConsultaGuide } =
  await import('../../src/contexts/health-insurance/internal/consulta-guide-service');
const { getInsurerDetail } = await import('../../src/contexts/health-insurance/config-queries');
const batches = await import('../../src/contexts/health-insurance/internal/batch-service');

let passed = 0;
const pass = (msg: string) => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};

async function rejectsConfig(code: string, op: () => Promise<unknown>) {
  await assert.rejects(op, (e: unknown) => {
    assert.equal(
      (e as { name?: string }).name,
      'InsuranceConfigError',
      String((e as Error).message),
    );
    assert.equal((e as { code?: string }).code, code, String((e as Error).message));
    return true;
  });
}

const [tv] =
  await sql`insert into public.tiss_terminology_versions (version, archive_url, archive_sha256, manifest_sha256)
  values ('202609', 'https://example.invalid/tuss.zip', ${'a'.repeat(64)}, ${'b'.repeat(64)}) returning id`;
await sql`insert into public.tiss_terms (version_id, table_code, code, term, starts_on, ends_on) values
  (${tv!.id}::uuid, '22', '10101012', 'Consulta em consultório (no horário normal ou preestabelecido)', '2010-01-01', null),
  (${tv!.id}::uuid, '24', '225125', 'Médico clínico', '2010-01-01', null),
  (${tv!.id}::uuid, '26', '06', 'Conselho Regional de Medicina (CRM)', '2010-01-01', null),
  (${tv!.id}::uuid, '59', '35', 'São Paulo', '2010-01-01', null),
  (${tv!.id}::uuid, '36', '9', 'Não acidente', '2010-01-01', null),
  (${tv!.id}::uuid, '87', '22', 'Procedimentos e eventos em saúde', '2010-01-01', null)`;
await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;

async function clinic(label: string, paid = true) {
  const clinicId = randomUUID();
  const owner = randomUUID();
  const doctor = randomUUID();
  for (const id of [owner, doctor])
    await sql`insert into auth.users (id, email) values (${id}::uuid, ${`${id}@example.invalid`})`;
  await sql`insert into public.clinics (id, slug, nome, status) values (${clinicId}::uuid, ${`cred-${clinicId.slice(0, 8)}`}, ${`Clínica ${label}`}, 'active')`;
  await sql`insert into public.profiles (id, clinic_id, nome, role, ativo, invite_accepted_at) values
    (${owner}::uuid, ${clinicId}::uuid, ${`Dona ${label}`}, 'owner', true, now()),
    (${doctor}::uuid, ${clinicId}::uuid, ${`Dra. ${label}`}, 'doctor', true, now())`;
  if (paid) await grantPaidSubscription(sql, clinicId);
  else {
    await sql`insert into public.subscriptions (clinic_id, plan_id, price_id, billing_status, trial_ends_at, enforce_trial_deadline)
      select ${clinicId}::uuid, pl.id, pr.id, 'trial', now() + interval '10 days', true
        from public.plans pl join public.prices pr on pr.plan_id = pl.id where pl.code = 'clinica_2026_2' order by pr.id limit 1`;
  }
  const [proc] =
    await sql`insert into public.procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
    values (${clinicId}::uuid, 'CONS', 'Consulta', 150, 30, true) returning id`;
  const [pat] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
    values (${clinicId}::uuid, ${`Paciente Sintético ${label}`}, 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`;
  return { clinicId, owner, doctor, procedureId: proc!.id as string, patientId: pat!.id as string };
}
type C = Awaited<ReturnType<typeof clinic>>;
const as = <T>(c: C, fn: Parameters<typeof withTenant<T>>[1]) =>
  withTenant(c.clinicId, fn, c.owner);

try {
  const A = await clinic('A');
  const B = await clinic('B');
  const T = await clinic('Trial', false);

  // Base da clínica A: PJ, operadora ativa, planos A e B, contrato da operadora, perfil TISS, carteirinha no plano B.
  await as(A, (tx) =>
    cfg.saveProviderIdentityTx(tx, A.clinicId, {
      providerKind: 'PJ',
      contractorName: 'Clínica A Ltda',
      cnesStatus: 'none_declared',
      cnes: null,
    }),
  );
  await sql`insert into public.hi_clinic_settings (clinic_id) values (${A.clinicId}::uuid) on conflict do nothing`;
  await sql`update public.hi_clinic_settings set enabled = true, enabled_at = now(), enabled_by = ${A.owner}::uuid where clinic_id = ${A.clinicId}::uuid`;
  const { insurerId } = await as(A, (tx) =>
    cfg.createInsurerTx(tx, A.clinicId, A.owner, {
      name: 'Operadora Sintética',
      registroAns: '400001',
      providerIdKind: 'codigoPrestadorNaOperadora',
      providerIdValue: 'PREST001',
      sadtGrouping: 'per_session',
    }),
  );
  await as(A, (tx) => cfg.setInsurerStatusTx(tx, A.clinicId, insurerId, 'active'));
  const { planId: planA } = await as(A, (tx) =>
    cfg.createPlanTx(tx, A.clinicId, insurerId, {
      name: 'Plano A',
      operatorCode: null,
      category: null,
    }),
  );
  const { planId: planB } = await as(A, (tx) =>
    cfg.createPlanTx(tx, A.clinicId, insurerId, {
      name: 'Plano B',
      operatorCode: null,
      category: null,
    }),
  );
  const { insurerId: otherInsurer } = await as(A, (tx) =>
    cfg.createInsurerTx(tx, A.clinicId, A.owner, {
      name: 'Outra Operadora',
      registroAns: '400002',
      providerIdKind: 'codigoPrestadorNaOperadora',
      providerIdValue: 'PREST002',
      sadtGrouping: 'per_session',
    }),
  );
  const { planId: planOther } = await as(A, (tx) =>
    cfg.createPlanTx(tx, A.clinicId, otherInsurer, {
      name: 'Plano Outro',
      operatorCode: null,
      category: null,
    }),
  );
  await as(A, (tx) =>
    cfg.createContractLineTx(tx, A.clinicId, A.owner, {
      insurerId,
      planId: null,
      guideType: 'consulta',
      tableCode: '22',
      procedureCode: '10101012',
      description: null,
      procedureId: A.procedureId,
      validFrom: '2026-01-01',
      validUntil: null,
      unitValueCents: 15000,
      requiresAuthorization: false,
      copayKind: 'none',
      copayFixedCents: null,
      copayPercentage: null,
      returnDays: null,
      returnBillable: false,
    }),
  );
  await as(A, (tx) =>
    cfg.saveProfessionalProfileTx(tx, A.clinicId, {
      professionalId: A.doctor,
      council: '06',
      councilNumber: '12345',
      councilUf: '35',
      cbo: '225125',
    }),
  );
  const { membershipId } = await as(A, (tx) =>
    cfg.createMembershipTx(tx, A.clinicId, A.owner, {
      patientId: A.patientId,
      insurerId,
      planId: planB,
      cardNumber: '0099887766554433',
      holderKind: 'titular',
      validUntil: '2027-12-31',
      preferred: true,
    }),
  );

  // ── 1. Cadastro ───────────────────────────────────────────────────────
  const cred = (over: Partial<Parameters<typeof cfg.createCredentialTx>[3]> = {}) => ({
    insurerId,
    planId: null,
    allPlans: false,
    professionalId: null,
    providerCode: null,
    validFrom: '2026-01-01',
    validUntil: null,
    ...over,
  });
  await rejectsConfig('CREDENTIAL_PLAN_REQUIRED', () =>
    as(A, (tx) => cfg.createCredentialTx(tx, A.clinicId, A.owner, cred())),
  );
  await rejectsConfig('CREDENTIAL_PLAN_CONFLICT', () =>
    as(A, (tx) =>
      cfg.createCredentialTx(tx, A.clinicId, A.owner, cred({ planId: planA, allPlans: true })),
    ),
  );
  await rejectsConfig('PLAN_MISMATCH', () =>
    as(A, (tx) => cfg.createCredentialTx(tx, A.clinicId, A.owner, cred({ planId: planOther }))),
  );
  await rejectsConfig('CREDENTIAL_PERIOD', () =>
    as(A, (tx) =>
      cfg.createCredentialTx(
        tx,
        A.clinicId,
        A.owner,
        cred({ planId: planA, validUntil: '2025-12-31' }),
      ),
    ),
  );
  await rejectsConfig('CREDENTIAL_CODE', () =>
    as(A, (tx) =>
      cfg.createCredentialTx(
        tx,
        A.clinicId,
        A.owner,
        cred({ planId: planA, providerCode: 'código com espaço' }),
      ),
    ),
  );
  await rejectsConfig('CREDENTIAL_PROFESSIONAL', () =>
    as(A, (tx) =>
      cfg.createCredentialTx(
        tx,
        A.clinicId,
        A.owner,
        cred({ planId: planA, professionalId: B.doctor }),
      ),
    ),
  );
  const { credentialId: credA } = await as(A, (tx) =>
    cfg.createCredentialTx(tx, A.clinicId, A.owner, cred({ planId: planA, providerCode: 'A-001' })),
  );
  await rejectsConfig('CREDENTIAL_OVERLAP', () =>
    as(A, (tx) =>
      cfg.createCredentialTx(
        tx,
        A.clinicId,
        A.owner,
        cred({ planId: planA, validFrom: '2026-06-01' }),
      ),
    ),
  );
  pass(
    '1. cadastro: plano obrigatório (ou "todos" de propósito, nunca os dois); plano de outra operadora, período invertido, código inválido, profissional de outra clínica e vigência sobreposta recusados',
  );

  // ── 2. Cobertura (agenda) ─────────────────────────────────────────────
  let slot = 0;
  async function coverage(date: string, planId: string | null = planB) {
    slot += 1;
    const [ap] =
      await sql`insert into public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
        snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via, billing_mode)
      values (${A.clinicId}::uuid, ${A.doctor}::uuid, ${A.patientId}::uuid, ${A.procedureId}::uuid, ${`${date}T12:00:00Z`}::timestamptz + ${slot} * interval '31 minutes',
        30, 'agendado', 150, 'Consulta', 150, 30, 'Dra. A', 'attendant', 'convenio') returning id`;
    const out = await as(A, (tx) =>
      recordAppointmentCoverage(tx, {
        clinicId: A.clinicId,
        appointmentId: ap!.id as string,
        patientId: A.patientId,
        procedureId: A.procedureId,
        appointmentDate: date,
        guideType: 'consulta',
        insurerId,
        planId,
        membershipId,
        authorizationId: null,
        actor: { kind: 'user', userId: A.owner },
      }),
    );
    return {
      status: out.status,
      codes: out.issues.map((i) => i.code).filter((c) => c.startsWith('CREDENTIAL')),
      issues: out.issues,
    };
  }
  const c1 = await coverage('2026-11-20');
  assert.deepEqual(
    [c1.status, c1.codes],
    ['incomplete', ['CREDENTIAL_CLINIC_MISSING', 'CREDENTIAL_PROFESSIONAL_MISSING']],
  );
  assert.match(
    c1.issues.find((i) => i.code === 'CREDENTIAL_CLINIC_MISSING')!.message,
    /só em outros planos/u,
  );
  const { credentialId: credB } = await as(A, (tx) =>
    cfg.createCredentialTx(tx, A.clinicId, A.owner, cred({ planId: planB })),
  );
  const c2 = await coverage('2026-11-20');
  assert.deepEqual([c2.status, c2.codes], ['incomplete', ['CREDENTIAL_PROFESSIONAL_MISSING']]);
  const { credentialId: credDoc } = await as(A, (tx) =>
    cfg.createCredentialTx(
      tx,
      A.clinicId,
      A.owner,
      cred({ planId: planB, professionalId: A.doctor }),
    ),
  );
  const c3 = await coverage('2026-11-20');
  assert.deepEqual([c3.status, c3.codes], ['ready', []]);
  // Sem plano escolhido na agenda, o plano é o da carteirinha (plano B): pronta e gravada no plano B.
  const c3b = await coverage('2026-11-21', null);
  assert.deepEqual([c3b.status, c3b.codes], ['ready', []]);
  const [covPlan] = await sql`select plan_id::text as plan_id from public.hi_appointment_coverages where clinic_id = ${A.clinicId}::uuid order by created_at desc limit 1`;
  assert.equal(covPlan!.plan_id, planB);
  pass(
    '2. agenda: credenciada só no plano A e atendimento no B → pendência "só em outros planos"; clínica no B sem a médica habilitada (PJ) → pendência do profissional; os dois → cobertura pronta',
  );

  // ── 3. Suspensão, reativação, encerramento e vigência futura ─────────
  await rejectsConfig('CREDENTIAL_REASON', () =>
    as(A, (tx) =>
      cfg.reviseCredentialTx(tx, A.clinicId, A.owner, credB, { mode: 'suspend', reason: 'curto' }),
    ),
  );
  await as(A, (tx) =>
    cfg.reviseCredentialTx(tx, A.clinicId, A.owner, credB, {
      mode: 'suspend',
      reason: 'Operadora suspendeu o credenciamento (sintético)',
    }),
  );
  const c4 = await coverage('2026-11-20');
  assert.equal(c4.status, 'incomplete');
  assert.match(c4.issues.find((i) => i.code === 'CREDENTIAL_CLINIC_MISSING')!.message, /SUSPENSO/u);
  await rejectsConfig('CREDENTIAL_STATE', () =>
    as(A, (tx) =>
      cfg.reviseCredentialTx(tx, A.clinicId, A.owner, credB, {
        mode: 'suspend',
        reason: 'Tentativa de suspender de novo',
      }),
    ),
  );
  await as(A, (tx) =>
    cfg.reviseCredentialTx(tx, A.clinicId, A.owner, credB, {
      mode: 'reactivate',
      reason: 'Operadora reativou o credenciamento (sintético)',
    }),
  );
  assert.equal((await coverage('2026-11-20')).status, 'ready');
  await as(A, (tx) =>
    cfg.reviseCredentialTx(tx, A.clinicId, A.owner, credDoc, {
      mode: 'end',
      validUntil: '2026-11-30',
      reason: 'Médica deixou o corpo clínico da operadora',
    }),
  );
  await rejectsConfig('CREDENTIAL_EXTEND', () =>
    as(A, (tx) =>
      cfg.reviseCredentialTx(tx, A.clinicId, A.owner, credDoc, {
        mode: 'end',
        validUntil: '2026-12-31',
        reason: 'Tentativa de estender por aqui',
      }),
    ),
  );
  const before = await coverage('2026-11-30');
  const after = await coverage('2026-12-01');
  assert.deepEqual(
    [before.status, after.status, after.codes],
    ['ready', 'incomplete', ['CREDENTIAL_PROFESSIONAL_MISSING']],
  );
  pass(
    '3. suspenso → pendência que diz SUSPENSO; reativado → pronta; vigência da médica encerrada em 30/11: atendimento em 30/11 coberto, em 01/12 com pendência; estender pelo "encerrar" é recusado',
  );

  // ── 4. Nova vigência preserva o histórico ────────────────────────────
  await rejectsConfig('CREDENTIAL_PERIOD', () =>
    as(A, (tx) =>
      cfg.reviseCredentialTx(tx, A.clinicId, A.owner, credB, {
        mode: 'new_period',
        validFrom: '2025-12-01',
        reason: 'Nova vigência antes da atual',
      }),
    ),
  );
  const np = await as(A, (tx) =>
    cfg.reviseCredentialTx(tx, A.clinicId, A.owner, credB, {
      mode: 'new_period',
      validFrom: '2027-01-01',
      providerCode: 'B-2027',
      reason: 'Recredenciamento anual com código novo',
    }),
  );
  const rowsB =
    await sql`select valid_from::text, valid_until::text, provider_code from public.hi_credentials where clinic_id = ${A.clinicId}::uuid and plan_id = ${planB}::uuid and professional_id is null order by valid_from`;
  assert.deepEqual(
    rowsB.map((r) => [r.valid_from, r.valid_until, r.provider_code]),
    [
      ['2026-01-01', '2026-12-31', null],
      ['2027-01-01', null, 'B-2027'],
    ],
  );
  assert.ok(np.newCredentialId);
  const detail = await getInsurerDetail(A.clinicId, insurerId, { prices: true });
  assert.equal(
    detail!.credentials.filter((c) => c.planId === planB && !c.professionalId).length,
    2,
  );
  pass(
    '4. nova vigência a partir de 01/01/2027 com código novo: a anterior fecha em 31/12/2026 e continua no histórico (2 linhas); o passado segue coberto pela antiga',
  );

  // ── 5. Regras da operadora (P2.5): dispensa da habilitação, limites, lote ─
  const rules = (over: Partial<Parameters<typeof cfg.saveInsurerRulesTx>[3]> = {}) => ({
    requireProfessionalCredential: true,
    maxGuidesPerBatch: 100,
    submissionDeadlineDays: null,
    ...over,
  });
  await rejectsConfig('RULE_MAX_GUIDES', () =>
    as(A, (tx) =>
      cfg.saveInsurerRulesTx(tx, A.clinicId, insurerId, rules({ maxGuidesPerBatch: 101 })),
    ),
  );
  await rejectsConfig('RULE_MAX_GUIDES', () =>
    as(A, (tx) =>
      cfg.saveInsurerRulesTx(tx, A.clinicId, insurerId, rules({ maxGuidesPerBatch: 0 })),
    ),
  );
  await rejectsConfig('RULE_DEADLINE', () =>
    as(A, (tx) =>
      cfg.saveInsurerRulesTx(tx, A.clinicId, insurerId, rules({ submissionDeadlineDays: 400 })),
    ),
  );
  await as(A, (tx) =>
    cfg.saveInsurerRulesTx(
      tx,
      A.clinicId,
      insurerId,
      rules({
        requireProfessionalCredential: false,
        maxGuidesPerBatch: 1,
        submissionDeadlineDays: 30,
      }),
    ),
  );
  const [st] = await sql`select settings from public.hi_insurers where id = ${insurerId}::uuid`;
  assert.deepEqual(cfg.insurerRules(st!.settings), {
    requireProfessionalCredential: false,
    maxGuidesPerBatch: 1,
    submissionDeadlineDays: 30,
  });
  await assert.rejects(
    () =>
      as(A, (tx) =>
        batches.createBatchInTx(tx, {
          clinicId: A.clinicId,
          insurerId,
          guideType: 'consulta',
          guideIds: [randomUUID(), randomUUID()],
          idempotencyKey: `rule:${randomUUID()}`,
        }),
      ),
    (e: Error) => e.name === 'BatchRuleError' && /até 1 guias por lote/u.test(e.message),
  );
  await rejectsConfig('INSURER_NOT_FOUND', () =>
    as(B, (tx) => cfg.saveInsurerRulesTx(tx, B.clinicId, insurerId, rules())),
  );
  const c5 = await coverage('2026-12-15');
  assert.deepEqual([c5.status, c5.codes], ['ready', []]);
  await as(A, (tx) => cfg.saveInsurerRulesTx(tx, A.clinicId, insurerId, rules()));
  pass(
    '5. regras da operadora (P2.5): máximo de guias fora de 1..100 e prazo acima de 365 recusados; a dispensa da habilitação vale na cobertura (a médica fora da vigência não pende); lote acima do máximo do contrato recusado antes de tocar nas guias; outra clínica não altera',
  );

  // ── 6. Guia (emissão): a pendência segura a guia até o cadastro ──────
  await as(A, (tx) =>
    cfg.reviseCredentialTx(tx, A.clinicId, A.owner, credB, {
      mode: 'suspend',
      reason: 'Suspensão para a prova da guia',
    }),
  );
  const [done] =
    await sql`insert into public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
      snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via, billing_mode)
    values (${A.clinicId}::uuid, ${A.doctor}::uuid, ${A.patientId}::uuid, ${A.procedureId}::uuid, '2026-11-10T13:00:00Z', 30, 'atendido', 150,
      'Consulta', 150, 30, 'Dra. A', 'attendant', 'convenio') returning id`;
  const appointment = {
    id: done!.id as string,
    patientId: A.patientId,
    professionalId: A.doctor,
    procedureId: A.procedureId,
    date: '2026-11-10',
    billingMode: 'convenio' as const,
  };
  const coverageRef = { insurerId, planId: planB, membershipId };
  // Como o worker: sem usuário na sessão (guia automática; a atualização recusa guia mexida por pessoa).
  const g = await withTenant(A.clinicId, (tx) =>
    createConsultaGuideForAppointment(tx, {
      clinicId: A.clinicId,
      appointment,
      coverage: coverageRef,
      terminologyVersion: '202609',
      actor: { kind: 'automation' },
    }),
  );
  assert.equal(g.kind, 'created');
  const guideId = (g as { guideId: string }).guideId;
  const [g1] = await sql`select status, issues from public.hi_guides where id = ${guideId}::uuid`;
  const codes1 = (g1!.issues as Array<{ code: string }>).map((i) => i.code);
  assert.equal(g1!.status, 'pending_data');
  assert.ok(codes1.includes('CREDENTIAL_CLINIC_MISSING'), JSON.stringify(codes1));
  await as(A, (tx) =>
    cfg.reviseCredentialTx(tx, A.clinicId, A.owner, credB, {
      mode: 'reactivate',
      reason: 'Reativado para a prova da guia',
    }),
  );
  const rf = await withTenant(A.clinicId, (tx) =>
    refreshConsultaGuide(tx, {
      clinicId: A.clinicId,
      guideId,
      appointment,
      coverage: coverageRef,
      terminologyVersion: '202609',
    }),
  );
  assert.equal(rf.kind, 'refreshed', JSON.stringify(rf).slice(0, 300));
  const [g2] = await sql`select status, issues from public.hi_guides where id = ${guideId}::uuid`;
  const codes2 = (g2!.issues as Array<{ code: string }>).map((i) => i.code);
  assert.ok(!codes2.some((c) => c.startsWith('CREDENTIAL')), JSON.stringify(codes2));
  pass(
    `6. emissão: com o credenciamento suspenso a guia nasce em "${String(g1!.status)}" com a pendência do credenciamento; reativado, a atualização tira a pendência (estado agora: ${String(g2!.status)})`,
  );

  // ── 7. Outra clínica e trial ─────────────────────────────────────────
  await rejectsConfig('CREDENTIAL_NOT_FOUND', () =>
    as(B, (tx) =>
      cfg.reviseCredentialTx(tx, B.clinicId, B.owner, credA, {
        mode: 'suspend',
        reason: 'Tentativa de outra clínica',
      }),
    ),
  );
  await rejectsConfig('INSURER_NOT_FOUND', () =>
    as(B, (tx) => cfg.createCredentialTx(tx, B.clinicId, B.owner, cred({ planId: planA }))),
  );
  const [{ n: seen }] = (await withTenant(
    B.clinicId,
    (tx) => tx.execute(sqlTag`select count(*)::int as n from public.hi_credentials`),
    B.owner,
  )) as unknown as [{ n: number }];
  assert.equal(seen, 0);
  assert.equal(await getInsurerDetail(B.clinicId, insurerId, { prices: true }), null);
  const { insurerId: insT } = await as(T, (tx) =>
    cfg.createInsurerTx(tx, T.clinicId, T.owner, {
      name: 'Operadora do Trial',
      registroAns: '400009',
      providerIdKind: 'codigoPrestadorNaOperadora',
      providerIdValue: 'PREST009',
      sadtGrouping: 'per_session',
    }),
  );
  await as(T, (tx) =>
    cfg.createCredentialTx(tx, T.clinicId, T.owner, cred({ insurerId: insT, allPlans: true })),
  );
  pass(
    '7. outra clínica não vê (RLS: 0 linhas), não muda nem cria credenciamento na operadora alheia; o trial cadastra o credenciamento (preparação permitida pelo D24)',
  );

  console.log(`\nOK — ${passed} provas do credenciamento por plano e vigência.`);
} finally {
  await cluster.stop();
}
