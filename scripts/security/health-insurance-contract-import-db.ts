/**
 * P2.7 — importação da tabela contratual por planilha, em Postgres DESCARTÁVEL com as migrations
 * reais: leitura (CSV e XLSX), validação pela MESMA regra da tela numa transação desfeita, prévia,
 * aplicação atômica, idempotência, reajuste, isolamento entre clínicas e o uso do contrato
 * importado na cobertura do agendamento (contrato, valor e coparticipação).
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-contract-import-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';

import { startScratchSchema } from './scratch-schema';

const PORT = 55533;
const cluster = await startScratchSchema({ port: PORT, maxConnections: 12 });
const { sql } = cluster;
if (!new RegExp(`@(?:127\\.0\\.0\\.1|localhost):${PORT}/`, 'u').test(cluster.url))
  throw new Error('não é o cluster local');
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');
process.env.LOG_LEVEL = 'error';

const { withTenant } = await import('../../src/lib/db/tenant');
const svc = await import('../../src/contexts/health-insurance/internal/contract-import-service');
const cfg = await import('../../src/contexts/health-insurance/internal/config-service');
const { recordAppointmentCoverage } =
  await import('../../src/contexts/health-insurance/internal/coverage-service');
const { loadHiFixtures, SYS_ACTOR } = await import('./hi-fixtures');

const fx = await loadHiFixtures(sql, {
  store: { put: async () => {}, get: async () => new Uint8Array(), remove: async () => {} },
  validateXsd: null as never,
});
const RC = { ip: null, userAgent: 'harness', requestId: randomUUID() };
let passed = 0;
const pass = (msg: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${msg}`);
};
const HEADER =
  'tabela;codigo;descricao;tipo_guia;valor;vigencia_inicio;vigencia_fim;plano;exige_autorizacao;coparticipacao_tipo;coparticipacao_valor;retorno_dias;retorno_faturavel;procedimento_clinica';
const csv = (...rows: string[]) =>
  new TextEncoder().encode(`${HEADER}\r\n${rows.join('\r\n')}\r\n`);
const lines = (clinicId: string, insurerId: string) =>
  sql`select procedure_code, guide_type, plan_id::text as plan, unit_value_cents::int as v, valid_from::text as f,
             valid_until::text as u, copay_kind, copay_percentage::text as pct, import_id::text as import_id, supersedes_id
        from public.hi_procedure_contracts where clinic_id = ${clinicId}::uuid and insurer_id = ${insurerId}::uuid
       order by procedure_code, valid_from, created_at`;

function storedZip(entries: Array<{ name: string; data: string }>): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.from(e.data, 'utf8');
    const name = Buffer.from(e.name, 'utf8');
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + data.length;
  }
  const dir = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(dir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, dir, eocd]));
}

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  await sql`insert into public.tiss_terms (version_id, table_code, code, term, starts_on)
    select id, '22', '50000470', 'Sessão de psicoterapia individual', '2010-01-01' from public.tiss_terminology_versions where version = '202609'`;
  const A = await fx.setupClinic('Importação A');
  // Operadora NOVA, sem nenhum contrato (a clínica configura do zero pela planilha).
  const [ins] =
    await sql`insert into public.hi_insurers (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, status, created_by)
    values (${A.clinicId}::uuid, 'Operadora Importada', '654321', 'codigoPrestadorNaOperadora', 'IMP001', 'active', ${SYS_ACTOR}::uuid) returning id`;
  const insurerId = ins!.id as string;
  await sql`insert into public.hi_credentials (clinic_id, insurer_id, plan_id, professional_id, valid_from, status, created_by)
    values (${A.clinicId}::uuid, ${insurerId}::uuid, null, null, '2020-01-01', 'active', ${SYS_ACTOR}::uuid),
           (${A.clinicId}::uuid, ${insurerId}::uuid, null, ${A.doctorId}::uuid, '2020-01-01', 'active', ${SYS_ACTOR}::uuid)`;
  const [plan] = await sql`insert into public.hi_plans (clinic_id, insurer_id, name, status)
    values (${A.clinicId}::uuid, ${insurerId}::uuid, 'Ouro', 'active') returning id`;
  await sql`insert into public.procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
    values (${A.clinicId}::uuid, 'PSI', 'Psicoterapia', 200, 50, true)`;
  const validate = (
    bytes: Uint8Array,
    fileName = 'tabela.csv',
    clinicId = A.clinicId,
    ins = insurerId,
  ) =>
    svc.validateContractImport({
      clinicId,
      userId: A.doctorId,
      insurerId: ins,
      fileName,
      bytes,
      requestContext: RC,
    });
  const apply = (importId: string, clinicId = A.clinicId) =>
    svc.applyContractImport({ clinicId, userId: A.doctorId, importId, requestContext: RC });

  // ── 1. Prévia: valida pela regra da tela SEM gravar contrato ─────────────────
  const good = csv(
    '22;10101012;;consulta;150,00;01/01/2027;;;não;percentual;30;30;não;CONS',
    '22;50000470;;sp_sadt;120,00;01/01/2027;;Ouro;sim;fixa;20,00;;;PSI',
  );
  const p1 = await validate(good);
  assert.deepEqual(
    [p1.status, p1.policy, p1.counts.create, p1.counts.error, p1.alreadyAppliedAt],
    ['validated', 'atomic', 2, 0, null],
  );
  assert.equal((await lines(A.clinicId, insurerId)).length, 0, 'a prévia não grava contrato');
  const [imp1] =
    await sql`select status, row_count, accepted_count, summary->>'policy' as policy from public.hi_contract_imports where id = ${p1.importId}::uuid`;
  assert.deepEqual(
    [imp1!.status, imp1!.row_count, imp1!.accepted_count, imp1!.policy],
    ['validated', 2, 2, 'atomic'],
  );
  pass(
    'prévia de uma operadora vazia: 2 itens novos validados pela regra da tela (TUSS oficial, plano, catálogo), política "atômica" registrada, NENHUM contrato gravado',
  );

  // ── 2. Aplicar: tudo de uma vez, com o rastro da importação ──────────────────
  const a1 = await apply(p1.importId);
  const after1 = await lines(A.clinicId, insurerId);
  assert.deepEqual([a1.status, a1.counts.create, after1.length], ['applied', 2, 2]);
  assert.ok(after1.every((l) => l.import_id === p1.importId));
  const sadt = after1.find((l) => l.procedure_code === '50000470')!;
  assert.deepEqual(
    [sadt.guide_type, sadt.plan, sadt.v, sadt.copay_kind],
    ['sp_sadt', plan!.id, 12000, 'fixed'],
  );
  const [aud] =
    await sql`select count(*)::int as n from public.audit_events where action = 'health_insurance.config.contract_import_applied' and resource_id = ${p1.importId}`;
  assert.equal(aud!.n, 1);
  pass(
    'aplicação: os 2 itens criados com o vínculo à importação (plano Ouro e coparticipação fixa no SP/SADT), importação "aplicada" e auditada',
  );

  // ── 3. Idempotência: a mesma planilha não é aplicada duas vezes ──────────────
  const p3 = await validate(good);
  assert.deepEqual(
    [p3.counts.unchanged, p3.counts.create, Boolean(p3.alreadyAppliedAt)],
    [2, 0, true],
  );
  await assert.rejects(
    () => apply(p3.importId),
    (e: unknown) => (e as { code?: string }).code === 'ALREADY_APPLIED',
  );
  assert.equal((await lines(A.clinicId, insurerId)).length, 2);
  await assert.rejects(
    () => apply(p1.importId),
    (e: unknown) => (e as { code?: string }).code === 'ALREADY_APPLIED',
  );
  pass(
    'reenviar a mesma planilha: todas as linhas "sem mudança", aviso de já aplicada e a aplicação recusada; aplicar de novo a importação aplicada também é recusado — nada duplicado',
  );

  // ── 4. Reajuste a partir de uma data: o passado não muda ───────────────────
  const p4 = await validate(
    csv('22;10101012;;consulta;165,00;01/07/2027;;;não;percentual;30;30;não;CONS'),
    'reajuste.csv',
  );
  assert.deepEqual([p4.status, p4.counts.adjust], ['validated', 1]);
  await apply(p4.importId);
  const cons = (await lines(A.clinicId, insurerId)).filter((l) => l.procedure_code === '10101012');
  const closed = cons.find((l) => l.u === '2027-06-30');
  const next = cons.find((l) => l.f === '2027-07-01');
  assert.ok(closed && next, 'item atual vale até a véspera; o novo começa na data');
  assert.deepEqual([closed!.v, next!.v, next!.import_id], [15000, 16500, p4.importId]);
  pass(
    'reajuste por planilha: o item vigente passa a valer até a véspera (R$ 150,00) e o novo começa em 01/07/2027 (R$ 165,00); a linha original continua no histórico',
  );

  // ── 5. Erros por linha: nada é aplicado (atômico) ──────────────────────────
  const bad = csv(
    '22;10101012;;consulta;150,00;01/01/2028;;Prata;não;;;;;CONS',
    '22;99999999;;consulta;150,00;01/01/2028;;;não;;;;;CONS',
    '22;50000470;;sp_sadt;120,00;01/01/2028;;;não;;;;;NAOEXISTE',
    '22;50000470;;sp_sadt;130,00;01/01/2027;;Ouro;sim;fixa;20,00;;;PSI',
    '22;10101012;=SOMA(1;2);consulta;150,00;01/01/2028;;;não;;;;;CONS',
    '22;50000470;;consulta;99,00;01/03/2028;;;não;;;;;PSI',
  );
  const p5 = await validate(bad, 'com-erros.csv');
  const msg = new Map(p5.rows.map((r) => [r.line, `${r.action}: ${r.messages.join(' ')}`]));
  assert.equal(p5.status, 'rejected');
  assert.match(msg.get(2)!, /^error: plano "Prata" não existe/u);
  assert.match(msg.get(3)!, /^error: .*(TUSS|terminologia|tabela)/iu);
  assert.match(msg.get(4)!, /^error: procedimento_clinica "NAOEXISTE"/u);
  assert.match(msg.get(5)!, /^error: já existe item vigente com o mesmo início/u);
  assert.match(msg.get(6)!, /^error: .*fórmula não é aceita/u);
  assert.match(msg.get(7)!, /^create/u);
  const before5 = (await lines(A.clinicId, insurerId)).length;
  await assert.rejects(
    () => apply(p5.importId),
    (e: unknown) => (e as { code?: string }).code === 'HAS_ERRORS',
  );
  assert.equal(
    (await lines(A.clinicId, insurerId)).length,
    before5,
    'nenhuma linha boa entra sozinha',
  );
  pass(
    'planilha com erros: plano inexistente, TUSS fora da tabela oficial, procedimento fora do catálogo, reescrita do passado e fórmula disfarçada aparecem por linha; a linha boa NÃO entra sozinha (atômica)',
  );

  // ── 6. O estado mudou entre a prévia e a aplicação: tudo desfeito ───────────
  const p6 = await validate(
    csv(
      '22;50000470;;consulta;90,00;01/01/2028;;;não;;;;;PSI',
      '22;10101012;;sp_sadt;80,00;01/01/2028;;;não;;;;;CONS',
    ),
    'corrida.csv',
  );
  assert.equal(p6.status, 'validated');
  // Outra pessoa cadastra pela tela, no meio, um item que conflita com a linha 2.
  const consId = (
    await sql`select id from public.procedures where clinic_id = ${A.clinicId}::uuid and codigo = 'CONS'`
  )[0]!.id as string;
  await withTenant(
    A.clinicId,
    (tx) =>
      cfg.createContractLineTx(tx, A.clinicId, A.doctorId, {
        insurerId,
        planId: null,
        guideType: 'sp_sadt',
        tableCode: '22',
        procedureCode: '10101012',
        description: null,
        procedureId: consId,
        validFrom: '2027-12-01',
        validUntil: null,
        unitValueCents: 7000,
        requiresAuthorization: false,
        copayKind: 'none',
        copayFixedCents: null,
        copayPercentage: null,
        returnDays: null,
        returnBillable: false,
      }),
    A.doctorId,
  );
  const n6 = (await lines(A.clinicId, insurerId)).length;
  const a6 = await apply(p6.importId);
  const [imp6] =
    await sql`select status from public.hi_contract_imports where id = ${p6.importId}::uuid`;
  assert.deepEqual(
    [
      a6.status,
      a6.errors.map((e) => e.line),
      (await lines(A.clinicId, insurerId)).length,
      imp6!.status,
    ],
    ['rejected', [3], n6, 'rejected'],
  );
  assert.equal(
    (await lines(A.clinicId, insurerId)).filter((l) => l.import_id === p6.importId).length,
    0,
  );
  assert.match(a6.errors[0]!.messages.join(' '), /mudou desde a prévia/u);
  pass(
    'contrato alterado pela tela entre a prévia e a aplicação: a linha que deixou de ser "novo item" (virou reajuste) derruba a aplicação, NADA da planilha entra e a importação fica "com erros" pedindo nova prévia',
  );

  // ── 7. XLSX pelo mesmo caminho ────────────────────────────────────────────
  const cell = (ref: string, v: string) => `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
  const head = HEADER.split(';')
    .map((h, i) => cell(`${String.fromCharCode(65 + i)}1`, h))
    .join('');
  const xlsx = storedZip([
    {
      name: 'xl/workbook.xml',
      data: '<workbook xmlns:r="r"><sheets><sheet name="Contrato" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: `<worksheet><sheetData><row r="1">${head}</row><row r="2">${cell('A2', '22')}${cell('B2', '50000470')}${cell('D2', 'sp_sadt')}<c r="E2"><f>100+15</f><v>115</v></c><c r="F2"><v>46753</v></c>${cell('H2', 'Ouro')}${cell('N2', 'PSI')}</row></sheetData></worksheet>`,
    },
  ]);
  const p7 = await validate(xlsx, 'contrato.xlsx');
  assert.deepEqual(
    [p7.status, p7.counts.adjust, p7.rows[0]?.unitValueCents, p7.rows[0]?.validFrom],
    ['validated', 1, 11500, '2028-01-01'],
  );
  pass(
    'XLSX pelo mesmo caminho: valor em cache de fórmula (nunca executada) e data serial do Excel; reajuste do SP/SADT reconhecido na prévia',
  );

  // ── 8. Isolamento: outra clínica não vê nem aplica ─────────────────────────
  const B = await fx.setupClinic('Importação B');
  await assert.rejects(
    () => apply(p7.importId, B.clinicId),
    (e: unknown) => (e as { code?: string }).code === 'NOT_FOUND',
  );
  await assert.rejects(
    () => validate(good, 'x.csv', B.clinicId, insurerId),
    (e: unknown) => (e as { code?: string }).code === 'NOT_FOUND',
  );
  const histB = await svc.listContractImports(B.clinicId, insurerId);
  assert.equal(histB.length, 0);
  const histA = await svc.listContractImports(A.clinicId, insurerId);
  assert.ok(
    histA.length >= 6 &&
      histA.some((h) => h.status === 'applied') &&
      histA.some((h) => h.status === 'rejected'),
  );
  pass(
    'outra clínica: não aplica a importação alheia, não valida contra a operadora alheia e não vê o histórico (RLS); a clínica A vê aplicadas e recusadas',
  );

  // ── 9. O contrato importado serve à agenda (cobertura, valor, coparticipação) ─
  const [pt] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
    values (${A.clinicId}::uuid, 'Paciente da importação', 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`;
  const [card] =
    await sql`insert into public.hi_memberships (clinic_id, patient_id, insurer_id, plan_id, card_number_encrypted, card_number_hash, card_last4, created_by)
    values (${A.clinicId}::uuid, ${pt!.id}::uuid, ${insurerId}::uuid, ${plan!.id}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${randomUUID().replace(/-/g, '').padEnd(64, '0')}, '7777', ${SYS_ACTOR}::uuid) returning id`;
  const [psi] =
    await sql`select id from public.procedures where clinic_id = ${A.clinicId}::uuid and codigo = 'PSI'`;
  const [ap] =
    await sql`insert into public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
      snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via, billing_mode)
    values (${A.clinicId}::uuid, ${A.doctorId}::uuid, ${pt!.id}::uuid, ${psi!.id}::uuid, '2027-03-10T13:00:00Z', 50, 'agendado', 200,
      'Psicoterapia', 200, 50, 'Dra. Sintética', 'attendant', 'convenio') returning id`;
  const cov = await withTenant(
    A.clinicId,
    (tx) =>
      recordAppointmentCoverage(tx, {
        clinicId: A.clinicId,
        appointmentId: ap!.id as string,
        patientId: pt!.id as string,
        procedureId: psi!.id as string,
        appointmentDate: '2027-03-10',
        guideType: 'sp_sadt',
        insurerId,
        planId: null,
        membershipId: card!.id as string,
        authorizationId: null,
        actor: { kind: 'user', userId: A.doctorId },
      }),
    A.doctorId,
  );
  const [line] =
    await sql`select import_id::text as import_id, unit_value_cents::int as v from public.hi_procedure_contracts where id = ${cov.contractLineId}::uuid`;
  const [cop] =
    await sql`select expected_cents::int as e, status from public.hi_copayments where appointment_id = ${ap!.id}::uuid`;
  assert.deepEqual(
    [line?.import_id, line?.v, cop?.e, cop?.status, cov.status],
    [p1.importId, 12000, 2000, 'estimated', 'pending_authorization'],
  );
  pass(
    'o item importado é o que a agenda usa: a cobertura do atendimento de psicoterapia (plano Ouro, pela carteirinha) escolhe a linha da importação, R$ 120,00, coparticipação estimada de R$ 20,00 e "aguardando autorização" como a planilha mandou',
  );

  console.log(`\n${passed}/9 provas do P2.7 passaram (Postgres descartável).`);
} finally {
  await cluster.stop();
}
process.exit(0);
