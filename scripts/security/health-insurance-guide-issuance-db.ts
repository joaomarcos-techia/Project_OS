/**
 * Convênios (P7.5): prova da EMISSÃO da Guia de Consulta com snapshot cifrado,
 * sobre o schema real, com o `withTenant` real, a cifra real (`encryptForTenant`,
 * chave mestra sintética de teste) e o LEITOR AUDITADO real (`guide-access.ts`).
 *
 * Confere: a emissão monta, valida, cifra e aprova numa transação; o conteúdo
 * relido confere com o SHA-256; emissões concorrentes deixam um snapshot só;
 * validação reprovada não emite nada; reabertura gera a revisão 2 e preserva a 1;
 * snapshot adulterado nunca é devolvido (e a falha fica auditada); outra clínica
 * não lê; a auditoria não leva a carteirinha.
 *
 * Não toca DEV nem produção. Uso:
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-guide-issuance-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { startScratchSchema, grantPaidSubscription, credentialAllPlans } from './scratch-schema';

const cluster = await startScratchSchema({ port: Number(process.env.PORT ?? 55505), maxConnections: 24 });
const { sql } = cluster;
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
// Chave mestra SINTÉTICA, só para este cluster local (mesmo padrão de payout-review-db.ts).
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');
if (!new RegExp(`@(?:127\\.0\\.0\\.1|localhost):${process.env.PORT ?? 55505}/`, 'u').test(cluster.url))
  throw new Error('não é o cluster local');

const { withTenant } = await import('../../src/lib/db/tenant');
const { createConsultaGuideForAppointment } =
  await import('../../src/contexts/health-insurance/internal/consulta-guide-service');
const { issueConsultaGuide, GuideIssuanceError } =
  await import('../../src/contexts/health-insurance/internal/guide-issuance');
const { readGuidesAsSystem, GuideIntegrityError, GuideAccessError } =
  await import('../../src/contexts/health-insurance/internal/guide-access');

const SYS = '00000000-0000-0000-0000-0000000000aa';
const CARD = '0081234500012345'; // sintético
let passed = 0;
const pass = (msg: string): void => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};
let slot = 0;

async function setup(label: string, cbo: string) {
  const clinicId = randomUUID();
  const doctorId = randomUUID();
  await sql`insert into auth.users (id, email) values (${doctorId}::uuid, ${`${doctorId}@example.invalid`})`;
  await sql`insert into public.clinics (id, slug, nome, status)
    values (${clinicId}::uuid, ${`gi-${clinicId.slice(0, 8)}`}, ${`Clínica ${label}`}, 'active')`;
  await grantPaidSubscription(sql, clinicId);
  await sql`insert into public.profiles (id, clinic_id, nome, role, ativo)
    values (${doctorId}::uuid, ${clinicId}::uuid, 'Dra. Sintética', 'doctor', true)`;
  await sql`insert into public.hi_clinic_settings (clinic_id, enabled, enabled_at, enabled_by, provider_kind, cnes_status)
    values (${clinicId}::uuid, true, now(), ${SYS}::uuid, 'PJ', 'none_declared')`;
  const [ins] = await sql`insert into public.hi_insurers
      (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, status, created_by)
    values (${clinicId}::uuid, 'Operadora Um', '123456', 'codigoPrestadorNaOperadora', 'TESTE001', 'active', ${SYS}::uuid) returning id`;
  await credentialAllPlans(sql, clinicId);
  await sql`insert into public.hi_professional_profiles (clinic_id, professional_id, council, council_number, council_uf, cbo)
    values (${clinicId}::uuid, ${doctorId}::uuid, '06', '12345', '35', ${cbo})`;
  const [proc] =
    await sql`insert into public.procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
    values (${clinicId}::uuid, 'CONS', 'Consulta sintética', 150, 30, true) returning id`;
  await sql`insert into public.hi_procedure_contracts
      (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id, unit_value_cents, valid_from, created_by)
    values (${clinicId}::uuid, ${ins!.id}::uuid, 'consulta', '22', '10101012', 'Consulta em consultório', ${proc!.id}::uuid,
      15000, '2026-01-01', ${SYS}::uuid)`;
  const [pt] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
    values (${clinicId}::uuid, 'Paciente Sintético', 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`;
  const [card] = await sql`insert into public.hi_memberships
      (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
    values (${clinicId}::uuid, ${pt!.id}::uuid, ${ins!.id}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${'d'.repeat(64)}, '2345', ${SYS}::uuid)
    returning id`;
  const newGuide = async (date: string) => {
    slot += 1;
    const [a] = await sql`insert into public.appointments (
        clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
        snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via)
      values (${clinicId}::uuid, ${doctorId}::uuid, ${pt!.id}::uuid, ${proc!.id}::uuid,
        ${`${date}T13:00:00Z`}::timestamptz + ${slot} * interval '1 minute', 30, 'atendido', 150,
        'Consulta', 150, 30, 'Dra. Sintética', 'attendant') returning id`;
    const out = await withTenant(clinicId, (tx) =>
      createConsultaGuideForAppointment(tx, {
        clinicId,
        appointment: {
          id: a!.id as string,
          patientId: pt!.id as string,
          professionalId: doctorId,
          procedureId: proc!.id as string,
          date,
          billingMode: 'convenio',
        },
        coverage: { insurerId: ins!.id as string, planId: null, membershipId: card!.id as string },
        terminologyVersion: '202609',
        actor: { kind: 'automation' },
      }),
    );
    assert.equal(out.kind, 'created');
    const guideId = (out as { guideId: string }).guideId;
    // Conferência humana: pronta → conferida, com quem conferiu.
    await sql.begin(async (tx) => {
      await tx.unsafe('SET LOCAL ROLE authenticated');
      await tx`select set_config('app.current_clinic', ${clinicId}, true)`;
      await tx`update public.hi_guides set status = 'reviewed', reviewed_by = ${doctorId}::uuid where id = ${guideId}::uuid`;
    });
    return guideId;
  };
  return { clinicId, doctorId, membershipId: card!.id as string, newGuide };
}

const issue = (c: Awaited<ReturnType<typeof setup>>, guideId: string) =>
  withTenant(
    c.clinicId,
    (tx) =>
      issueConsultaGuide(tx, {
        clinicId: c.clinicId,
        guideId,
        card: {
          membershipId: c.membershipId,
          cardNumber: CARD,
          auditEventId: 'leitura-auditada-simulada',
        },
        newborn: false,
        professionalName: 'Dra. Sintética',
        actorUserId: c.doctorId,
        today: '2026-12-31',
      }),
    c.doctorId,
  );
const systemRead = (clinicId: string, guideIds: string[]) =>
  readGuidesAsSystem({
    clinicId,
    guideIds,
    operation: 'operator_integration',
    service: 'insurance-connector',
    jobId: randomUUID(),
  });

try {
  await sql`GRANT SELECT ON public.clinics TO authenticated`; // padrão do Supabase (ver health-insurance-coverage-db.ts)
  const [tv] =
    await sql`insert into public.tiss_terminology_versions (version, archive_url, archive_sha256, manifest_sha256)
    values ('202609', 'https://example.invalid/tuss.zip', ${'a'.repeat(64)}, ${'b'.repeat(64)}) returning id`;
  await sql`insert into public.tiss_terms (version_id, table_code, code, term, starts_on)
    values (${tv!.id}::uuid, '22', '10101012', 'Consulta em consultório (no horário normal ou preestabelecido)', '2010-01-01'),
           (${tv!.id}::uuid, '24', '225125', 'Médico clínico', '2010-01-01'),
           -- Tabelas de domínio (termos oficiais mínimos usados pela guia sintética).
           (${tv!.id}::uuid, '26', '06', 'Conselho Regional de Medicina (CRM)', '2010-01-01'),
           (${tv!.id}::uuid, '36', '9', 'Não acidente', '2010-01-01'),
           (${tv!.id}::uuid, '52', '1', 'Primeira consulta', '2010-01-01'),
           (${tv!.id}::uuid, '52', '2', 'Retorno', '2010-01-01'),
           (${tv!.id}::uuid, '59', '35', 'São Paulo', '2010-01-01'),
           (${tv!.id}::uuid, '76', '01', 'Ambulatorial', '2010-01-01'),
           (${tv!.id}::uuid, '87', '22', 'Procedimentos e eventos em saúde', '2010-01-01')`;
  const A = await setup('A', '225125');
  const B = await setup('B', '225125');

  // ── Emissão ──────────────────────────────────────────────────────────
  const g1 = await A.newGuide('2026-11-10');
  const issued = await issue(A, g1);
  const [row] =
    await sql`select g.status, g.approved_snapshot_id = s.id as linked, s.revision, s.content_sha256,
      s.content_encrypted like ${`%${CARD}%`} as plaintext_card
    from public.hi_guides g join public.hi_guide_snapshots s on s.guide_id = g.id where g.id = ${g1}::uuid`;
  assert.deepEqual(
    [row!.status, row!.linked, row!.revision, row!.content_sha256, row!.plaintext_card],
    ['approved', true, 1, issued.sha256, false],
  );
  const [read] = await systemRead(A.clinicId, [g1]);
  assert.equal(read!.content.guideType, 'consulta');
  const data = read!.content.data as {
    beneficiario: { numeroCarteira: string };
    numeroGuiaPrestador: string;
  };
  assert.deepEqual([data.beneficiario.numeroCarteira, data.numeroGuiaPrestador], [CARD, '1']);
  pass(
    'emissão: monta, valida, cifra (sem a carteirinha em claro no banco) e aprova; o leitor auditado decifra e o SHA-256 confere',
  );

  // ── PDF oficial (P7.6): sai do snapshot emitido, nunca do cadastro atual ──
  // A diagramação (pura) é a mesma que alimenta o PDF; a renderização em si é provada no vitest
  // (print.test.ts), porque este harness roda com a condição react-server do Next.
  const { layoutGuide } = await import('../../src/contexts/health-insurance/tiss/print/layout');
  const { consultaPrintView } = await import('../../src/contexts/health-insurance/tiss/print/values');
  type Content = NonNullable<typeof read>['content'];
  const printOf = (content: Content) => {
    assert.ok(content.print, 'o snapshot emitido leva o bloco de impressão');
    return content.print;
  };
  const p1 = printOf(read!.content);
  assert.deepEqual(
    [p1.beneficiarioNome, p1.contratadoNome, p1.operadoraNome, p1.nomeSocial],
    ['Paciente Sintético', 'Clínica A', 'Operadora Um', null],
  );
  assert.ok(!JSON.stringify(read!.content.data).includes('Paciente Sintético'), 'o nome não entra no dado do XML');
  const renderText = async (content: Content) => {
    const view = consultaPrintView(content.data as Parameters<typeof consultaPrintView>[0], printOf(content));
    const layout = layoutGuide(view, { guideNumber: '1', revision: 1, snapshotSha256: issued.sha256, software: { name: 'Qoro', version: null } });
    return layout.pages[0]!.flatMap((op) => (op.t === 'text' ? [op.text] : [])).join(' | ');
  };
  const before = await renderText(read!.content);
  assert.ok(before.includes('Paciente Sintético') && before.includes('Clínica A') && before.includes(CARD));
  // O cadastro muda depois da emissão: o PDF da guia emitida continua o mesmo.
  await sql`update public.patients set nome = 'Nome Trocado Depois' where clinic_id = ${A.clinicId}::uuid`;
  await sql`update public.clinics set nome = 'Razão Social Nova' where id = ${A.clinicId}::uuid`;
  const [again] = await systemRead(A.clinicId, [g1]);
  const after = await renderText(again!.content);
  assert.ok(after.includes('Paciente Sintético') && !after.includes('Nome Trocado Depois') && !after.includes('Razão Social Nova'));
  await sql`update public.patients set nome = 'Paciente Sintético' where clinic_id = ${A.clinicId}::uuid`;
  await sql`update public.clinics set nome = 'Clínica A' where id = ${A.clinicId}::uuid`;
  pass(
    'PDF oficial: a emissão congela no snapshot cifrado o que só existe no papel (nome do beneficiário, do contratado e da operadora), fora do dado do XML; renomear paciente e clínica depois não muda o PDF da guia emitida',
  );

  // ── Concorrência: duas emissões, um snapshot ─────────────────────────
  const g2 = await A.newGuide('2026-11-20');
  const both = await Promise.allSettled([issue(A, g2), issue(A, g2)]);
  assert.equal(both.filter((r) => r.status === 'fulfilled').length, 1);
  const [{ n: snaps2 }] =
    (await sql`select count(*)::int as n from public.hi_guide_snapshots where guide_id = ${g2}::uuid`) as unknown as [
      { n: number },
    ];
  assert.equal(snaps2, 1);
  pass(
    'duas emissões simultâneas da mesma guia: uma aprova, a outra falha inteira (nenhum snapshot órfão)',
  );

  // ── Validação reprovada não emite ────────────────────────────────────
  const C = await setup('C', '123456'); // CBO bem formado, mas fora da tabela 24 da terminologia
  const g3 = await C.newGuide('2026-11-10');
  await assert.rejects(
    () => issue(C, g3),
    (e: unknown) => e instanceof GuideIssuanceError && e.issues.length > 0,
  );
  const [s3] =
    await sql`select g.status, (select count(*)::int from public.hi_guide_snapshots s where s.guide_id = g.id) as snaps
    from public.hi_guides g where g.id = ${g3}::uuid`;
  assert.deepEqual([s3!.status, s3!.snaps], ['reviewed', 0]);
  pass(
    'validação TISS reprovada (CBO fora da terminologia; o 999999 já é barrado no cadastro pela 0144): nada é emitido, a guia segue conferida, com as pendências devolvidas',
  );

  // ── Reabertura: revisão 2, a 1 preservada ────────────────────────────
  await sql.begin(async (tx) => {
    await tx.unsafe('SET LOCAL ROLE authenticated');
    await tx`select set_config('app.current_clinic', ${A.clinicId}, true)`;
    await tx`update public.hi_guides set status = 'ready_for_review', transition_note = 'Correção pedida pela operadora' where id = ${g1}::uuid`;
    await tx`update public.hi_guides set status = 'reviewed', reviewed_by = ${A.doctorId}::uuid where id = ${g1}::uuid`;
  });
  const issued2 = await issue(A, g1);
  const revs =
    await sql`select revision from public.hi_guide_snapshots where guide_id = ${g1}::uuid order by revision`;
  assert.deepEqual(
    revs.map((r) => r.revision),
    [1, 2],
  );
  assert.equal(issued2.revision, 2);
  pass(
    'reabertura e nova emissão: revisão 2 cifrada e aprovada; a revisão 1 continua no histórico',
  );

  // ── Adulteração e leitura indevida ───────────────────────────────────
  await sql`alter table public.hi_guide_snapshots disable trigger hi_guide_snapshots_immutable`;
  await sql`update public.hi_guide_snapshots set content_sha256 = ${'0'.repeat(64)} where guide_id = ${g2}::uuid`;
  await sql`alter table public.hi_guide_snapshots enable trigger hi_guide_snapshots_immutable`;
  await assert.rejects(() => systemRead(A.clinicId, [g2]), GuideIntegrityError);
  const [{ n: integ }] = (await sql`select count(*)::int as n from public.audit_events
    where action = 'health_insurance.guide.integrity_failed' and resource_id = ${g2}`) as unknown as [
    { n: number },
  ];
  assert.equal(integ, 1);
  pass(
    'snapshot adulterado (por superusuário, com o gatilho desligado): o leitor recusa e registra a falha de integridade',
  );

  await assert.rejects(
    () => systemRead(B.clinicId, [g1]),
    (e: unknown) => e instanceof GuideAccessError && e.reason === 'not_found',
  );
  const [{ n: denied }] = (await sql`select count(*)::int as n from public.audit_events
    where action = 'health_insurance.guide.access_denied' and clinic_id = ${B.clinicId}::uuid`) as unknown as [
    { n: number },
  ];
  assert.equal(denied, 1);
  const audits =
    await sql`select after::text as a from public.audit_events where action like 'health_insurance.guide.%'`;
  // 2 leituras concedidas (a 2ª, a do PDF depois da troca de nome) + 1 falha de integridade + 1 negação (outra clínica).
  assert.equal(audits.length, 4);
  for (const r of audits) {
    assert.ok(!String(r.a).includes(CARD), 'auditoria com carteirinha');
    assert.ok(!String(r.a).includes(issued.sha256), 'auditoria com hash do conteúdo');
  }
  pass(
    'outra clínica não lê (negado e registrado na clínica de quem tentou); a auditoria nunca leva carteirinha nem hash',
  );

  console.log(`OK: ${passed} provas da emissão com snapshot cifrado sobre o schema real`);
} finally {
  await cluster.stop();
}
process.exit(0);
