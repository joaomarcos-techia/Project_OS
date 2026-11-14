/**
 * Convênios — configuração pela interface (P2.1–P2.5, P3.1, P4.1/P4.4; R44): prova dos
 * SERVIÇOS REAIS que as telas chamam, sobre o schema real num Postgres descartável, como
 * o runtime faz (`withTenant` → `authenticated` + clínica da sessão, RLS e gatilhos).
 *
 *  1. Prestador: grava PJ/PF, nome e CNES (ou a declaração), recusa CNES inválido e NUNCA
 *     liga o módulo; outra clínica não enxerga.
 *  2. Operadora: rascunho → ativa → suspensa → arquivada → reativada; transição inválida
 *     recusada; registro ANS só muda no rascunho; ANS duplicado, CNPJ e CPF inválidos
 *     recusados; CNPJ alfanumérico aceito; outra clínica não altera.
 *  3. Plano: duplicado recusado; plano de outra operadora recusado no contrato.
 *  4. Contrato: TUSS inexistente e fora de vigência recusados (só a tabela oficial
 *     carregada); procedimento de outra clínica recusado; sobreposição recusada; reajuste
 *     a partir de uma data NÃO muda o passado (seleção real `selectEffectiveContract`);
 *     corrigir e encerrar criam versão; duas revisões simultâneas do mesmo item → só uma;
 *     a linha antiga continua imutável no banco.
 *  5. Perfil TISS: conselho, UF e CBO só da terminologia; 999999 recusado; profissional de
 *     outra clínica recusado.
 *  6. Carteirinha: número cifrado (decifra igual), HMAC D21 `clínica:ANS:número`, final 4;
 *     mesma carteirinha ativa em dois pacientes recusada; outra clínica com o mesmo número
 *     tem hash diferente; uma preferencial; substituição encadeada; mesmo número recusado;
 *     desativar/reativar; trial recusado pelo bloqueio comercial (D24).
 *  7. Agenda: escolha conferida antes de criar; o atendimento nasce `convenio` pelo core
 *     real do Scheduling; a cobertura é registrada com coparticipação ESTIMADA; o banco
 *     recusa recebível do valor cheio para o paciente; particular continua particular;
 *     remarcar mantém a forma de atendimento.
 *
 * Não toca DEV nem produção. Uso:
 *   NODE_OPTIONS="--import ./scripts/security/server-only-hook.mjs" npx tsx --tsconfig tsconfig.scripts.json scripts/security/health-insurance-config-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { sql as sqlTag } from 'drizzle-orm';

import { grantPaidSubscription, startScratchSchema } from './scratch-schema';

const cluster = await startScratchSchema({ port: 55528, maxConnections: 24 });
const { sql } = cluster;
if (!/@(?:127\.0\.0\.1|localhost):55528\//u.test(cluster.url))
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
const { selectEffectiveContract } =
  await import('../../src/contexts/health-insurance/tiss/assembly/contract-selection');
const { decryptForTenant, hashForLookup } = await import('../../src/lib/crypto/encryption');
const { checkSchedulingChoice, recordSchedulingCoverage } =
  await import('../../src/contexts/health-insurance/scheduling-coverage');
const {
  getInsuranceSetup,
  getInsurerDetail,
  getPatientInsuranceOverview,
  getPatientMemberships,
  listUpcomingInsuranceAppointments,
} = await import('../../src/contexts/health-insurance/config-queries');
const core = await import('../../src/contexts/scheduling/internal/appointment-core');
const { carryCoverageOnRescheduleTx } =
  await import('../../src/contexts/health-insurance/modality-change');

let passed = 0;
const pass = (msg: string) => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};
const RC = { ip: null, userAgent: 'harness', requestId: randomUUID() };

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

// Terminologia mínima (a de verdade vem do pacote oficial; aqui, termos sintéticos com o formato real).
const [tv] =
  await sql`insert into public.tiss_terminology_versions (version, archive_url, archive_sha256, manifest_sha256)
  values ('202609', 'https://example.invalid/tuss.zip', ${'a'.repeat(64)}, ${'b'.repeat(64)}) returning id`;
await sql`insert into public.tiss_terms (version_id, table_code, code, term, starts_on, ends_on) values
  (${tv!.id}::uuid, '22', '10101012', 'Consulta em consultório (no horário normal ou preestabelecido)', '2010-01-01', null),
  (${tv!.id}::uuid, '22', '50000470', 'Sessão de psicoterapia individual', '2010-01-01', null),
  (${tv!.id}::uuid, '22', '10101039', 'Termo encerrado (sintético)', '2010-01-01', '2020-12-31'),
  (${tv!.id}::uuid, '24', '225125', 'Médico clínico', '2010-01-01', null),
  (${tv!.id}::uuid, '26', '06', 'Conselho Regional de Medicina (CRM)', '2010-01-01', null),
  (${tv!.id}::uuid, '59', '35', 'São Paulo', '2010-01-01', null),
  (${tv!.id}::uuid, '36', '9', 'Não acidente', '2010-01-01', null),
  (${tv!.id}::uuid, '87', '22', 'Procedimentos e eventos em saúde', '2010-01-01', null)`;

async function clinic(label: string, paid = true) {
  const clinicId = randomUUID();
  const owner = randomUUID();
  const doctor = randomUUID();
  for (const id of [owner, doctor])
    await sql`insert into auth.users (id, email) values (${id}::uuid, ${`${id}@example.invalid`})`;
  await sql`insert into public.clinics (id, slug, nome, status) values (${clinicId}::uuid, ${`cfg-${clinicId.slice(0, 8)}`}, ${`Clínica ${label}`}, 'active')`;
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
    values (${clinicId}::uuid, ${`Paciente ${label}`}, 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`;
  const [pat2] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
    values (${clinicId}::uuid, ${`Paciente ${label} Dois`}, 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`;
  return {
    clinicId,
    owner,
    doctor,
    procedureId: proc!.id as string,
    patientId: pat!.id as string,
    patient2Id: pat2!.id as string,
  };
}
type C = Awaited<ReturnType<typeof clinic>>;
const as = <T>(c: C, fn: Parameters<typeof withTenant<T>>[1]) =>
  withTenant(c.clinicId, fn, c.owner);
const insurerInput = (
  ans: string,
  over: Partial<Parameters<typeof cfg.createInsurerTx>[3]> = {},
) => ({
  name: 'Operadora Sintética',
  registroAns: ans,
  providerIdKind: 'codigoPrestadorNaOperadora' as const,
  providerIdValue: 'PREST001',
  sadtGrouping: 'per_session' as const,
  ...over,
});
const terms = (
  unitValueCents: number,
  copay: Partial<{
    copayKind: 'none' | 'fixed' | 'percentage';
    copayFixedCents: number | null;
    copayPercentage: number | null;
  }> = {},
) => ({
  unitValueCents,
  requiresAuthorization: false,
  copayKind: 'none' as const,
  copayFixedCents: null,
  copayPercentage: null,
  returnDays: null,
  returnBillable: false,
  ...copay,
});

// No Supabase, `authenticated` lê clinics/profiles (privilégio padrão do projeto); o scaffold local não tem.
await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;

try {
  const A = await clinic('A');
  const B = await clinic('B');
  const T = await clinic('Trial', false);

  // ── 1. Prestador ───────────────────────────────────────────────────────
  await rejectsConfig('CNES', () =>
    as(A, (tx) =>
      cfg.saveProviderIdentityTx(tx, A.clinicId, {
        providerKind: 'PJ',
        contractorName: 'Clínica A Ltda',
        cnesStatus: 'has',
        cnes: '9999999',
      }),
    ),
  );
  await as(A, (tx) =>
    cfg.saveProviderIdentityTx(tx, A.clinicId, {
      providerKind: 'PJ',
      contractorName: '  Clínica   A Ltda ',
      cnesStatus: 'none_declared',
      cnes: '1234567',
    }),
  );
  const [stA] =
    await sql`select enabled, provider_kind, contractor_name, cnes_status, cnes from public.hi_clinic_settings where clinic_id = ${A.clinicId}::uuid`;
  assert.deepEqual(
    { ...stA },
    {
      enabled: false,
      provider_kind: 'PJ',
      contractor_name: 'Clínica A Ltda',
      cnes_status: 'none_declared',
      cnes: null,
    },
  );
  const seenByB = await as(B, (tx) =>
    tx.execute(
      sqlTag`select 1 from public.hi_clinic_settings where clinic_id = ${A.clinicId}::uuid`,
    ),
  );
  assert.equal((seenByB as unknown as unknown[]).length, 0);
  pass(
    'prestador: PJ + declaração de ausência de CNES gravados; CNES 9999999 recusado; módulo continua DESLIGADO; outra clínica não vê',
  );

  // ── 2. Operadora ───────────────────────────────────────────────────────
  await rejectsConfig('REGISTRO_ANS', () =>
    as(A, (tx) => cfg.createInsurerTx(tx, A.clinicId, A.owner, insurerInput('12345'))),
  );
  await rejectsConfig('PROVIDER_ID', () =>
    as(A, (tx) =>
      cfg.createInsurerTx(
        tx,
        A.clinicId,
        A.owner,
        insurerInput('400001', {
          providerIdKind: 'cnpjContratado',
          providerIdValue: '11.222.333/0001-00',
        }),
      ),
    ),
  );
  await rejectsConfig('PROVIDER_ID', () =>
    as(A, (tx) =>
      cfg.createInsurerTx(
        tx,
        A.clinicId,
        A.owner,
        insurerInput('400001', {
          providerIdKind: 'cpfContratado',
          providerIdValue: '111.111.111-11',
        }),
      ),
    ),
  );
  // CNPJ alfanumérico (IN RFB 2.229/2024) com DV correto: 12ABC34501DE35.
  const { insurerId: insCnpj } = await as(A, (tx) =>
    cfg.createInsurerTx(
      tx,
      A.clinicId,
      A.owner,
      insurerInput('400002', {
        name: 'Operadora CNPJ',
        providerIdKind: 'cnpjContratado',
        providerIdValue: '12.ABC.345/01DE-35',
      }),
    ),
  );
  const [cnpjRow] =
    await sql`select provider_id_value from public.hi_insurers where id = ${insCnpj}::uuid`;
  assert.equal(cnpjRow!.provider_id_value, '12ABC34501DE35');
  const { insurerId } = await as(A, (tx) =>
    cfg.createInsurerTx(tx, A.clinicId, A.owner, insurerInput('400001')),
  );
  await rejectsConfig('INSURER_DUPLICATE', () =>
    as(A, (tx) => cfg.createInsurerTx(tx, A.clinicId, A.owner, insurerInput('400001'))),
  );
  const { insurerId: insB } = await as(B, (tx) =>
    cfg.createInsurerTx(tx, B.clinicId, B.owner, insurerInput('400001')),
  );
  // ANS editável só no rascunho.
  await as(A, (tx) =>
    cfg.updateInsurerTx(
      tx,
      A.clinicId,
      insCnpj,
      insurerInput('400003', {
        name: 'Operadora CNPJ',
        providerIdKind: 'cnpjContratado',
        providerIdValue: '12ABC34501DE35',
      }),
    ),
  );
  await as(A, (tx) => cfg.setInsurerStatusTx(tx, A.clinicId, insurerId, 'active'));
  await rejectsConfig('REGISTRO_ANS_LOCKED', () =>
    as(A, (tx) => cfg.updateInsurerTx(tx, A.clinicId, insurerId, insurerInput('400009'))),
  );
  await rejectsConfig('INSURER_TRANSITION', () =>
    as(A, (tx) => cfg.setInsurerStatusTx(tx, A.clinicId, insurerId, 'draft')),
  );
  await as(A, (tx) => cfg.setInsurerStatusTx(tx, A.clinicId, insurerId, 'suspended'));
  await as(A, (tx) => cfg.setInsurerStatusTx(tx, A.clinicId, insurerId, 'archived'));
  await rejectsConfig('INSURER_ARCHIVED', () =>
    as(A, (tx) =>
      cfg.updateInsurerTx(tx, A.clinicId, insurerId, insurerInput('400001', { name: 'Nome novo' })),
    ),
  );
  await as(A, (tx) => cfg.setInsurerStatusTx(tx, A.clinicId, insurerId, 'active'));
  // Outra clínica não altera nem enxerga (RLS: a operadora "não existe" para B).
  await rejectsConfig('INSURER_NOT_FOUND', () =>
    as(B, (tx) => cfg.setInsurerStatusTx(tx, B.clinicId, insurerId, 'archived')),
  );
  await rejectsConfig('INSURER_NOT_FOUND', () =>
    as(B, (tx) => cfg.setInsurerStatusTx(tx, A.clinicId, insurerId, 'archived')),
  );
  const [stillActive] =
    await sql`select status from public.hi_insurers where id = ${insurerId}::uuid`;
  assert.equal(stillActive!.status, 'active');
  pass(
    'operadora: rascunho → ativa → suspensa → arquivada → reativada; ANS travado fora do rascunho; ANS/CNPJ/CPF inválidos e duplicado recusados; CNPJ alfanumérico normalizado; outra clínica não altera',
  );

  // ── 3. Plano ───────────────────────────────────────────────────────────
  const { planId } = await as(A, (tx) =>
    cfg.createPlanTx(tx, A.clinicId, insurerId, {
      name: 'Plano Ouro',
      operatorCode: 'OURO',
      category: 'ambulatorial',
    }),
  );
  await rejectsConfig('PLAN_DUPLICATE', () =>
    as(A, (tx) =>
      cfg.createPlanTx(tx, A.clinicId, insurerId, {
        name: 'Plano Ouro',
        operatorCode: null,
        category: null,
      }),
    ),
  );
  const { planId: planOtherInsurer } = await as(A, (tx) =>
    cfg.createPlanTx(tx, A.clinicId, insCnpj, {
      name: 'Plano Outro',
      operatorCode: null,
      category: null,
    }),
  );
  pass('plano: cadastrado; nome duplicado na operadora recusado');

  // ── 4. Contrato ────────────────────────────────────────────────────────
  const line = (over: Partial<Parameters<typeof cfg.createContractLineTx>[3]> = {}) => ({
    insurerId,
    planId: null,
    guideType: 'consulta' as const,
    tableCode: '22' as const,
    procedureCode: '10101012',
    description: null,
    procedureId: A.procedureId,
    validFrom: '2026-01-01',
    validUntil: null,
    ...terms(15000, { copayKind: 'fixed', copayFixedCents: 4500 }),
    ...over,
  });
  await rejectsConfig('TERM_NOT_FOUND', () =>
    as(A, (tx) =>
      cfg.createContractLineTx(tx, A.clinicId, A.owner, line({ procedureCode: '99999999' })),
    ),
  );
  await rejectsConfig('TERM_NOT_EFFECTIVE', () =>
    as(A, (tx) =>
      cfg.createContractLineTx(tx, A.clinicId, A.owner, line({ procedureCode: '10101039' })),
    ),
  );
  await rejectsConfig('PROCEDURE_NOT_FOUND', () =>
    as(A, (tx) =>
      cfg.createContractLineTx(tx, A.clinicId, A.owner, line({ procedureId: B.procedureId })),
    ),
  );
  await rejectsConfig('PLAN_MISMATCH', () =>
    as(A, (tx) =>
      cfg.createContractLineTx(tx, A.clinicId, A.owner, line({ planId: planOtherInsurer })),
    ),
  );
  await rejectsConfig('COPAY', () =>
    as(A, (tx) =>
      cfg.createContractLineTx(tx, A.clinicId, A.owner, line({ copayFixedCents: 20000 })),
    ),
  );
  const { lineId } = await as(A, (tx) => cfg.createContractLineTx(tx, A.clinicId, A.owner, line()));
  const [l0] =
    await sql`select description, unit_value_cents, copay_fixed_cents from public.hi_procedure_contracts where id = ${lineId}::uuid`;
  assert.equal(l0!.description, 'Consulta em consultório (no horário normal ou preestabelecido)');
  await rejectsConfig('CONTRACT_OVERLAP', () =>
    as(A, (tx) =>
      cfg.createContractLineTx(tx, A.clinicId, A.owner, line({ validFrom: '2026-06-01' })),
    ),
  );
  // Percentual com 2 casas (33,33) entra sem erro de ponto flutuante; plano específico não colide com o geral.
  await as(A, (tx) =>
    cfg.createContractLineTx(
      tx,
      A.clinicId,
      A.owner,
      line({ planId, copayKind: 'percentage', copayFixedCents: null, copayPercentage: 33.33 }),
    ),
  );
  pass(
    'contrato: TUSS inexistente e fora de vigência recusados; procedimento de outra clínica, plano de outra operadora, coparticipação acima do valor e sobreposição recusados; descrição oficial da TUSS',
  );

  // Reajuste a partir de 01/12: o passado continua com o preço antigo.
  await rejectsConfig('REASON', () =>
    as(A, (tx) =>
      cfg.reviseContractLineTx(tx, A.clinicId, A.owner, lineId, {
        mode: 'new_period',
        from: '2026-12-01',
        terms: terms(18000),
        reason: 'curto',
      }),
    ),
  );
  const rev = await as(A, (tx) =>
    cfg.reviseContractLineTx(tx, A.clinicId, A.owner, lineId, {
      mode: 'new_period',
      from: '2026-12-01',
      terms: terms(18000, { copayKind: 'fixed', copayFixedCents: 5000 }),
      reason: 'Reajuste anual do contrato da operadora',
    }),
  );
  assert.equal(rev.lineIds.length, 2);
  const rows =
    await sql`select * from public.hi_procedure_contracts where clinic_id = ${A.clinicId}::uuid and insurer_id = ${insurerId}::uuid and plan_id is null`;
  const asLines = rows.map((r) => ({
    id: r.id as string,
    insurerId: r.insurer_id as string,
    planId: (r.plan_id as string | null) ?? null,
    guideType: r.guide_type as 'consulta',
    tableCode: r.table_code as string,
    procedureCode: r.procedure_code as string,
    description: r.description as string,
    unitValueCents: Number(r.unit_value_cents),
    validFrom: (r.valid_from as Date).toISOString().slice(0, 10),
    validUntil: r.valid_until ? (r.valid_until as Date).toISOString().slice(0, 10) : null,
    requiresAuthorization: r.requires_authorization as boolean,
    copayKind: r.copay_kind as 'fixed',
    copayFixedCents: r.copay_fixed_cents === null ? null : Number(r.copay_fixed_cents),
    copayPercentage: r.copay_percentage as string | null,
    returnDays: r.return_days as number | null,
    returnBillable: r.return_billable as boolean,
    supersedesId: (r.supersedes_id as string | null) ?? null,
  }));
  const q = (date: string) =>
    selectEffectiveContract(asLines, {
      insurerId,
      planId: null,
      guideType: 'consulta',
      tableCode: '22',
      procedureCode: '10101012',
      date,
    });
  const nov = q('2026-11-20');
  const dec = q('2026-12-15');
  assert.equal(nov.kind, 'found');
  assert.equal(dec.kind, 'found');
  assert.equal(nov.kind === 'found' && nov.line.unitValueCents, 15000);
  assert.equal(dec.kind === 'found' && dec.line.unitValueCents, 18000);
  assert.equal(nov.kind === 'found' && nov.line.validUntil, '2026-11-30');
  pass(
    'reajuste a partir de 01/12: atendimento de 20/11 continua a R$ 150,00 (versão encerrada na véspera); de 15/12 sai a R$ 180,00 — a seleção REAL da guia confere',
  );

  // Duas revisões simultâneas do mesmo item vivo: só uma vence.
  const novId = nov.kind === 'found' ? nov.line.id : '';
  const race = await Promise.allSettled([
    as(A, (tx) =>
      cfg.reviseContractLineTx(tx, A.clinicId, A.owner, novId, {
        mode: 'end',
        until: '2026-11-25',
        reason: 'Encerramento combinado com a operadora',
      }),
    ),
    as(A, (tx) =>
      cfg.reviseContractLineTx(tx, A.clinicId, A.owner, novId, {
        mode: 'correct',
        terms: terms(15500),
        description: null,
        procedureId: A.procedureId,
        reason: 'Correção de valor digitado errado',
      }),
    ),
  ]);
  assert.equal(
    race.filter((r) => r.status === 'fulfilled').length,
    1,
    JSON.stringify(race.map((r) => r.status)),
  );
  const loser = race.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.equal((loser.reason as { code?: string }).code, 'CONTRACT_ALREADY_REVISED');
  await assert.rejects(
    sql`update public.hi_procedure_contracts set unit_value_cents = 1 where id = ${lineId}::uuid`,
    (e: unknown) => (e as { code?: string }).code === '55000',
  );
  const [orig] =
    await sql`select unit_value_cents from public.hi_procedure_contracts where id = ${lineId}::uuid`;
  assert.equal(Number(orig!.unit_value_cents), 15000);
  pass(
    'duas revisões simultâneas do mesmo item: uma vence, a outra recebe "já revisado"; a linha original segue imutável no banco (UPDATE → 55000)',
  );

  // ── 5. Perfil TISS ─────────────────────────────────────────────────────
  const prof = (over: Partial<Parameters<typeof cfg.saveProfessionalProfileTx>[2]> = {}) => ({
    professionalId: A.doctor,
    council: '06',
    councilNumber: '12345',
    councilUf: '35',
    cbo: '225125',
    ...over,
  });
  await rejectsConfig('TERM_NOT_FOUND', () =>
    as(A, (tx) => cfg.saveProfessionalProfileTx(tx, A.clinicId, prof({ council: '99' }))),
  );
  await rejectsConfig('TERM_NOT_FOUND', () =>
    as(A, (tx) => cfg.saveProfessionalProfileTx(tx, A.clinicId, prof({ councilUf: '99' }))),
  );
  await rejectsConfig('CBO', () =>
    as(A, (tx) => cfg.saveProfessionalProfileTx(tx, A.clinicId, prof({ cbo: '999999' }))),
  );
  await rejectsConfig('TERM_NOT_FOUND', () =>
    as(A, (tx) => cfg.saveProfessionalProfileTx(tx, A.clinicId, prof({ cbo: '123456' }))),
  );
  await rejectsConfig('PROFESSIONAL_NOT_FOUND', () =>
    as(A, (tx) =>
      cfg.saveProfessionalProfileTx(tx, A.clinicId, prof({ professionalId: B.doctor })),
    ),
  );
  await as(A, (tx) => cfg.saveProfessionalProfileTx(tx, A.clinicId, prof()));
  await as(A, (tx) =>
    cfg.saveProfessionalProfileTx(tx, A.clinicId, prof({ councilNumber: '54321' })),
  );
  const pp =
    await sql`select council_number from public.hi_professional_profiles where clinic_id = ${A.clinicId}::uuid`;
  assert.deepEqual(
    pp.map((r) => r.council_number),
    ['54321'],
  );
  pass(
    'perfil TISS: conselho, UF e CBO só da terminologia oficial; 999999 recusado; profissional de outra clínica recusado; edição sobrescreve o mesmo perfil',
  );

  // ── 6. Carteirinha ─────────────────────────────────────────────────────
  const card = (over: Partial<Parameters<typeof cfg.createMembershipTx>[3]> = {}) => ({
    patientId: A.patientId,
    insurerId,
    planId,
    cardNumber: ' 0081.2345-0001 2345 ',
    holderKind: 'titular' as const,
    validUntil: '2027-12-31',
    preferred: true,
    ...over,
  });
  const { membershipId: m1 } = await as(A, (tx) =>
    cfg.createMembershipTx(tx, A.clinicId, A.owner, card()),
  );
  const [r1] =
    await sql`select card_number_encrypted, card_number_hash, card_last4, is_preferred from public.hi_memberships where id = ${m1}::uuid`;
  assert.notEqual(r1!.card_number_encrypted, '0081234500012345');
  assert.equal(
    await decryptForTenant(A.clinicId, r1!.card_number_encrypted as string),
    '0081234500012345',
  );
  assert.equal(r1!.card_number_hash, await hashForLookup(`${A.clinicId}:400001:0081234500012345`));
  assert.equal(r1!.card_last4, '2345');
  await rejectsConfig('CARD_DUPLICATE', () =>
    as(A, (tx) =>
      cfg.createMembershipTx(
        tx,
        A.clinicId,
        A.owner,
        card({ patientId: A.patient2Id, preferred: false }),
      ),
    ),
  );
  const { membershipId: mB } = await as(B, (tx) =>
    cfg.createMembershipTx(
      tx,
      B.clinicId,
      B.owner,
      card({ patientId: B.patientId, insurerId: insB, planId: null }),
    ),
  );
  const [rB] = await sql`select card_number_hash from public.hi_memberships where id = ${mB}::uuid`;
  assert.notEqual(rB!.card_number_hash, r1!.card_number_hash);
  await rejectsConfig('PLAN_MISMATCH', () =>
    as(A, (tx) =>
      cfg.createMembershipTx(
        tx,
        A.clinicId,
        A.owner,
        card({ cardNumber: '777', planId: planOtherInsurer }),
      ),
    ),
  );
  pass(
    'carteirinha: número só cifrado (decifra igual ao normalizado), HMAC D21 clínica:ANS:número, final 4; ativa em outro paciente recusada; mesma numeração em outra clínica tem hash diferente',
  );

  const { membershipId: m2 } = await as(A, (tx) =>
    cfg.createMembershipTx(
      tx,
      A.clinicId,
      A.owner,
      card({ insurerId: insCnpj, planId: null, cardNumber: 'ABC998877', preferred: true }),
    ),
  );
  const prefs =
    await sql`select id from public.hi_memberships where patient_id = ${A.patientId}::uuid and is_preferred`;
  assert.deepEqual(
    prefs.map((r) => r.id),
    [m2],
  );
  await as(A, (tx) => cfg.setPreferredMembershipTx(tx, A.clinicId, m1));
  await rejectsConfig('CARD_SAME_NUMBER', () =>
    as(A, (tx) =>
      cfg.replaceMembershipTx(tx, A.clinicId, A.owner, m1, {
        cardNumber: '0081234500012345',
        planId,
        holderKind: 'titular',
        validUntil: '2028-12-31',
      }),
    ),
  );
  const { membershipId: m3 } = await as(A, (tx) =>
    cfg.replaceMembershipTx(tx, A.clinicId, A.owner, m1, {
      cardNumber: '0081234599990000',
      planId,
      holderKind: 'titular',
      validUntil: '2028-12-31',
    }),
  );
  const [old1] =
    await sql`select status, replaced_by_id, is_preferred from public.hi_memberships where id = ${m1}::uuid`;
  const [new3] =
    await sql`select status, is_preferred, card_last4 from public.hi_memberships where id = ${m3}::uuid`;
  assert.deepEqual({ ...old1 }, { status: 'replaced', replaced_by_id: m3, is_preferred: false });
  assert.deepEqual({ ...new3 }, { status: 'active', is_preferred: true, card_last4: '0000' });
  await rejectsConfig('MEMBERSHIP_REPLACED', () =>
    as(A, (tx) => cfg.setMembershipActiveTx(tx, A.clinicId, m1, true)),
  );
  await as(A, (tx) => cfg.setMembershipActiveTx(tx, A.clinicId, m2, false));
  const [m2row] =
    await sql`select status, is_preferred from public.hi_memberships where id = ${m2}::uuid`;
  assert.deepEqual({ ...m2row }, { status: 'inactive', is_preferred: false });
  await as(A, (tx) => cfg.setMembershipActiveTx(tx, A.clinicId, m2, true));
  await as(A, (tx) =>
    cfg.updateMembershipTx(tx, A.clinicId, m3, {
      planId: null,
      holderKind: 'dependente',
      validUntil: '2029-01-31',
    }),
  );
  pass(
    'carteirinha: uma preferencial por paciente; substituição encadeada (antiga replaced → nova, preferencial herdada); mesmo número recusado; substituída não reativa; desativar/reativar; validade e titularidade editáveis',
  );

  const { insurerId: insT } = await as(T, (tx) =>
    cfg.createInsurerTx(tx, T.clinicId, T.owner, insurerInput('400001')),
  );
  await assert.rejects(
    as(T, (tx) =>
      cfg.createMembershipTx(
        tx,
        T.clinicId,
        T.owner,
        card({ patientId: T.patientId, insurerId: insT, planId: null }),
      ),
    ),
    (e: unknown) =>
      /assinatura ativa/u.test(
        String((e as { cause?: Error }).cause?.message ?? (e as Error).message),
      ),
  );
  pass(
    'trial: a clínica cadastra a operadora (preparação), mas a carteirinha é recusada pelo bloqueio comercial do banco (D24)',
  );

  // ── 7. Agenda: forma de atendimento ───────────────────────────────────
  const choice = { insurerId, planId: null, membershipId: m3, guideType: 'consulta' as const };
  assert.match(
    (await checkSchedulingChoice(A.clinicId, A.patientId, choice)) ?? '',
    /não está habilitado/u,
  );
  await sql`update public.hi_clinic_settings set enabled = true, enabled_at = now(), enabled_by = ${A.owner}::uuid where clinic_id = ${A.clinicId}::uuid`;
  assert.match(
    (await checkSchedulingChoice(A.clinicId, A.patient2Id, choice)) ?? '',
    /não é deste paciente/u,
  );
  assert.match(
    (await checkSchedulingChoice(A.clinicId, A.patientId, { ...choice, insurerId: insCnpj })) ?? '',
    /não está ativa|não é deste/u,
  );
  assert.equal(await checkSchedulingChoice(A.clinicId, A.patientId, choice), null);

  const actor = { clinicId: A.clinicId, userId: A.owner };
  const when = new Date(Date.now() + 3 * 86_400_000);
  when.setUTCHours(13, 0, 0, 0);
  const conv = await core.createAppointmentCore(
    actor,
    'user',
    RC,
    {
      doctorId: A.doctor,
      patientId: A.patientId,
      procedureId: A.procedureId,
      scheduledAt: when.toISOString(),
      billingMode: 'convenio',
    },
    randomUUID(),
  );
  const part = await core.createAppointmentCore(
    actor,
    'user',
    RC,
    {
      doctorId: A.doctor,
      patientId: A.patient2Id,
      procedureId: A.procedureId,
      scheduledAt: new Date(when.getTime() + 3_600_000).toISOString(),
    },
    randomUUID(),
  );
  const modes =
    await sql`select id, billing_mode from public.appointments where id in (${conv.id}::uuid, ${part.id}::uuid)`;
  assert.equal(modes.find((r) => r.id === conv.id)!.billing_mode, 'convenio');
  assert.equal(modes.find((r) => r.id === part.id)!.billing_mode, 'particular');
  const date = when.toISOString().slice(0, 10);
  const out = await recordSchedulingCoverage({
    clinicId: A.clinicId,
    userId: A.owner,
    patientId: A.patientId,
    procedureId: A.procedureId,
    appointments: [{ id: conv.id, date }],
    choice,
    requestContext: RC,
  });
  assert.equal(out.error, null, String(out.error));
  assert.equal(out.recorded, 1);
  const [cov] =
    await sql`select status, membership_id, contract_line_id from public.hi_appointment_coverages where appointment_id = ${conv.id}::uuid`;
  assert.equal(cov!.membership_id, m3);
  assert.ok(cov!.contract_line_id);
  const [copay] =
    await sql`select status, expected_cents from public.hi_copayments where appointment_id = ${conv.id}::uuid`;
  assert.equal(copay!.status, 'estimated');
  const [audit] =
    await sql`select count(*)::int as n from public.audit_events where action = 'health_insurance.coverage.recorded_at_scheduling' and clinic_id = ${A.clinicId}::uuid`;
  assert.equal(audit!.n, 1);
  // Cobrança integral do atendimento coberto: o banco recusa.
  await assert.rejects(
    sql`insert into public.lancamentos (clinic_id, tipo, descricao, valor, status, due_date, patient_id, appointment_id, created_via)
        values (${A.clinicId}::uuid, 'receber', 'Consulta cheia', 150, 'pendente', current_date, ${A.patientId}::uuid, ${conv.id}::uuid, 'manual')`,
    (e: unknown) => (e as { code?: string }).code === '23514',
  );
  const upcoming = await listUpcomingInsuranceAppointments(A.clinicId);
  assert.equal(upcoming.find((u) => u.appointmentId === conv.id)?.coverage?.status, cov!.status);
  pass(
    `agenda: escolha conferida antes (módulo, operadora ativa, carteirinha do paciente); atendimento nasce "convenio" pelo core real; cobertura ${String(cov!.status)} com coparticipação ESTIMADA (R$ ${(Number(copay!.expected_cents) / 100).toFixed(2)}); recebível do valor cheio recusado pelo banco; particular continua particular`,
  );

  const moved = await core.rescheduleCore(
    actor,
    'user',
    RC,
    conv.id,
    { newScheduledAt: new Date(when.getTime() + 86_400_000).toISOString() },
    randomUUID(),
  );
  const [movedRow] =
    await sql`select billing_mode from public.appointments where id = ${moved.id}::uuid`;
  assert.equal(movedRow!.billing_mode, 'convenio');
  const pending = (await listUpcomingInsuranceAppointments(A.clinicId)).find(
    (u) => u.appointmentId === moved.id,
  );
  assert.equal(
    pending?.coverage,
    null,
    'antes do worker processar a remarcação, o novo ainda não tem cobertura',
  );
  // P4.3/R50: o handler da remarcação leva a mesma escolha para o novo horário.
  const carried = await withTenant(A.clinicId, (tx) =>
    carryCoverageOnRescheduleTx(tx, {
      clinicId: A.clinicId,
      oldAppointmentId: conv.id,
      newAppointmentId: moved.id,
    }),
  );
  const [newCov] =
    await sql`select membership_id from public.hi_appointment_coverages where appointment_id = ${moved.id}::uuid`;
  const [oldCov] =
    await sql`select status from public.hi_appointment_coverages where appointment_id = ${conv.id}::uuid`;
  assert.deepEqual(
    [carried.outcome, newCov?.membership_id, oldCov?.status],
    ['carried', m3, 'cancelled'],
  );
  pass(
    'remarcar mantém a forma de atendimento (convênio continua convênio) e o handler da remarcação leva a MESMA carteirinha para o novo horário (a cobertura do antigo vira "cancelada") — antes, a remarcação o transformava em particular e depois o deixava sem cobertura',
  );

  // Leituras das telas (RLS da clínica; número nunca decifrado na lista).
  const setup = await getInsuranceSetup(A.clinicId);
  assert.equal(setup.readiness.find((r) => r.key === 'identity')?.ok, true);
  assert.equal(setup.readiness.find((r) => r.key === 'enabled')?.ok, true);
  assert.ok(setup.councils.some((c) => c.code === '06'));
  const detail = await getInsurerDetail(A.clinicId, insurerId);
  assert.ok(detail && detail.lines.some((l) => !l.live) && detail.lines.some((l) => l.live));
  assert.equal(await getInsurerDetail(B.clinicId, insurerId), null);
  const cards = await getPatientMemberships(A.clinicId, A.patientId);
  assert.ok(
    cards &&
      cards.cards.every((c) => /^[0-9A-Z]{1,4}$/u.test(c.last4)) &&
      !JSON.stringify(cards).includes('0081234599990000'),
  );
  assert.equal(await getPatientMemberships(B.clinicId, A.patientId), null);
  pass(
    'leituras das telas: prontidão, detalhe com versões, carteirinhas só com o final; outra clínica recebe "não encontrado"',
  );

  // Aba Convênios da ficha do paciente (P1.3, 14/11): só leitura, RLS da clínica, sem segredo.
  const CIPHER = 'cifra-sintetica-da-senha-nunca-exibida-0001';
  await sql`insert into public.hi_authorizations (clinic_id, insurer_id, plan_id, membership_id, guide_type, status, origin, requested_on, authorized_on, password_encrypted, password_valid_until, recorded_by, created_by)
            values (${A.clinicId}::uuid, ${insurerId}::uuid, ${planId}::uuid, ${m3}::uuid, 'consulta', 'authorized', 'manual', '2026-11-01', '2026-11-02', ${CIPHER}, '2026-12-02', ${A.owner}::uuid, ${A.owner}::uuid)`;
  const ov = await getPatientInsuranceOverview(A.clinicId, A.patientId);
  assert.ok(ov && ov.enabled);
  assert.deepEqual(
    ov.cards.map((c) => c.id),
    cards!.cards.map((c) => c.id),
  );
  const covStatuses = Object.fromEntries(ov.coverages.map((c) => [c.appointmentId, c.status]));
  assert.equal(covStatuses[conv.id], 'cancelled');
  assert.ok(covStatuses[moved.id] && covStatuses[moved.id] !== 'cancelled');
  assert.equal(ov.coverages[0]!.appointmentId, moved.id, 'próximo atendimento primeiro');
  assert.deepEqual(
    ov.authorizations.map((x) => [x.status, x.passwordValidUntil]),
    [['authorized', '2026-12-02']],
  );
  const dump = JSON.stringify(ov);
  assert.ok(
    !dump.includes(CIPHER) &&
      !dump.includes('0081234599990000') &&
      !/password(?!ValidUntil)/u.test(dump),
  );
  assert.equal(await getPatientInsuranceOverview(B.clinicId, A.patientId), null);
  const [bPatient] =
    await sql`select id::text as id from public.patients where clinic_id = ${B.clinicId}::uuid limit 1`;
  if (bPatient) assert.equal(await getPatientInsuranceOverview(A.clinicId, bPatient.id), null);
  pass(
    'aba Convênios do paciente: carteirinhas mascaradas, cobertura do próximo atendimento primeiro (a do horário antigo "cancelada"), autorização sem a senha cifrada; outra clínica recebe "não encontrado"',
  );

  console.log(`\n${passed}/${passed} provas da configuração de Convênios passaram.`);
} finally {
  await cluster.stop();
}
