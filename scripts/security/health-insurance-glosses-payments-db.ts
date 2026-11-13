/**
 * Convênios 0152 — glosas (6 estados), recursos de glosa, pagamentos da operadora e a
 * conta da guia, em Postgres DESCARTÁVEL com o código real:
 *
 *   guias aprovadas pela emissão real → lote → XML validado pelo motor XSD do app
 *   → enviado (evidência) → protocolo → em análise → retorno do demonstrativo
 *   → glosa / recurso / pagamento pelo serviço (`insurance-account-service`), que
 *     chama as funções SECURITY DEFINER da 0152.
 *
 * Cenários exigidos (orientação de 12/11, seção 4.5): glosa parcial e integral, recurso,
 * glosa revertida e definitiva, pagamento parcial e integral, pagamento e retorno
 * duplicados, pagamento depois do recurso, guia substituída, lote cancelado, falha
 * transacional, concorrência, reprocessamento e acesso entre clínicas. Mais: estorno
 * compensatório, pagamento por lote (rateio só exato), sem dupla contagem por guia e
 * por item, runtime sem escrita direta, D24 (preservação com assinatura cancelada) e
 * nenhum lançamento no livro financeiro (a ponte é da P1.10/P10.2).
 *
 * Fora do CI, o motor XSD pode vir de uma instalação isolada (TISS_XMLLINT_WASM_DIR).
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-glosses-payments-db.ts
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

import { startScratchSchema, grantPaidSubscription, credentialAllPlans } from './scratch-schema';

const cluster = await startScratchSchema({ port: 55510, maxConnections: 32 });
const { sql } = cluster;
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');
if (!/@(?:127\.0\.0\.1|localhost):55510\//u.test(cluster.url)) throw new Error('não é o cluster local');

const { withTenant } = await import('../../src/lib/db/tenant');
const { createConsultaGuideForAppointment } =
  await import('../../src/contexts/health-insurance/internal/consulta-guide-service');
const { issueConsultaGuide } = await import('../../src/contexts/health-insurance/internal/guide-issuance');
const { readGuidesAsSystem } = await import('../../src/contexts/health-insurance/internal/guide-access');
const batches = await import('../../src/contexts/health-insurance/internal/batch-service');
const acct = await import('../../src/contexts/health-insurance/internal/insurance-account-service');
const { loadXmllintValidator } = await import('../../src/contexts/health-insurance/tiss/xml/xsd-validator');
const { sql: sqlTag } = await import('drizzle-orm');

const xsd = loadXmllintValidator();
if (!xsd) throw new Error('validador XSD do app indisponível (xmllint-wasm do package.json; fora do CI, TISS_XMLLINT_WASM_DIR)');

const SYS = '00000000-0000-0000-0000-0000000000aa';
const CARD = '0081234500012345'; // sintético
const VALUE = 15000; // R$ 150,00 por guia (1 item)
let passed = 0;
const pass = (msg: string): void => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};
async function rejects(kind: string, op: () => Promise<unknown>, hint?: RegExp): Promise<void> {
  await assert.rejects(op, (e: unknown) => {
    const err = e as { kind?: string; code?: string; message?: string; cause?: { code?: string; message?: string } };
    const got = err.kind ?? err.code ?? err.cause?.code;
    assert.equal(got, kind, String(err.message ?? err));
    if (hint) assert.match(`${err.message} ${err.cause?.message ?? ''}`, hint);
    return true;
  });
}
const sha = (b: string) => createHash('sha256').update(b).digest('hex');
const objects = new Map<string, Uint8Array>();
const store = {
  async put(ref: string, bytes: Uint8Array) {
    objects.set(ref, bytes);
  },
  async get(ref: string) {
    return objects.get(ref)!;
  },
  async remove(ref: string) {
    objects.delete(ref);
  },
};

let slot = 0;
async function setupClinic(label: string) {
  const clinicId = randomUUID();
  const doctorId = randomUUID();
  await sql`insert into auth.users (id, email) values (${doctorId}::uuid, ${`${doctorId}@example.invalid`})`;
  await sql`insert into public.clinics (id, slug, nome, status)
    values (${clinicId}::uuid, ${`gp-${clinicId.slice(0, 8)}`}, ${`Clínica ${label}`}, 'active')`;
  await grantPaidSubscription(sql, clinicId);
  await sql`insert into public.profiles (id, clinic_id, nome, role, ativo)
    values (${doctorId}::uuid, ${clinicId}::uuid, 'Dra. Sintética', 'doctor', true)`;
  await sql`insert into public.hi_clinic_settings (clinic_id, enabled, enabled_at, enabled_by, provider_kind, cnes_status)
    values (${clinicId}::uuid, true, now(), ${SYS}::uuid, 'PJ', 'none_declared')`;
  await sql`insert into public.hi_professional_profiles (clinic_id, professional_id, council, council_number, council_uf, cbo)
    values (${clinicId}::uuid, ${doctorId}::uuid, '06', '12345', '35', '225125')`;
  const [proc] = await sql`insert into public.procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
    values (${clinicId}::uuid, 'CONS', 'Consulta sintética', 150, 30, true) returning id`;
  const [ins] = await sql`insert into public.hi_insurers
      (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, status, created_by)
    values (${clinicId}::uuid, 'Operadora Um', '123456', 'codigoPrestadorNaOperadora', 'TESTE001', 'active', ${SYS}::uuid) returning id`;
  await credentialAllPlans(sql, clinicId);
  await sql`insert into public.hi_procedure_contracts
      (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id, unit_value_cents, valid_from, created_by)
    values (${clinicId}::uuid, ${ins!.id}::uuid, 'consulta', '22', '10101012', 'Consulta em consultório', ${proc!.id}::uuid,
      ${VALUE}, '2026-01-01', ${SYS}::uuid)`;
  const insurerId = ins!.id as string;
  const approvedGuide = async () => {
    slot += 1;
    const [pt] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
      values (${clinicId}::uuid, ${`Paciente Sintético ${slot}`}, 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`;
    const [card] = await sql`insert into public.hi_memberships
        (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
      values (${clinicId}::uuid, ${pt!.id}::uuid, ${insurerId}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${randomUUID().replace(/-/g, '').padEnd(64, '0')}, '2345', ${SYS}::uuid)
      returning id`;
    const [a] = await sql`insert into public.appointments (
        clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
        snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via)
      values (${clinicId}::uuid, ${doctorId}::uuid, ${pt!.id}::uuid, ${proc!.id}::uuid,
        '2026-11-10T13:00:00Z'::timestamptz + ${slot} * interval '31 minutes', 30, 'atendido', 150,
        'Consulta', 150, 30, 'Dra. Sintética', 'attendant') returning id`;
    const out = await withTenant(clinicId, (tx) =>
      createConsultaGuideForAppointment(tx, {
        clinicId,
        appointment: {
          id: a!.id as string,
          patientId: pt!.id as string,
          professionalId: doctorId,
          procedureId: proc!.id as string,
          date: '2026-11-10',
          billingMode: 'convenio',
        },
        coverage: { insurerId, planId: null, membershipId: card!.id as string },
        terminologyVersion: '202609',
        actor: { kind: 'automation' },
      }),
    );
    const guideId = (out as { guideId: string }).guideId;
    await withTenant(
      clinicId,
      (tx) => tx.execute(sqlTag`update public.hi_guides set status = 'reviewed', reviewed_by = ${doctorId}::uuid where id = ${guideId}::uuid`),
      doctorId,
    );
    await withTenant(
      clinicId,
      (tx) =>
        issueConsultaGuide(tx, {
          clinicId,
          guideId,
          card: { membershipId: card!.id as string, cardNumber: CARD, auditEventId: 'leitura-auditada-simulada' },
          newborn: false,
          professionalName: 'Dra. Sintética',
          actorUserId: doctorId,
          today: '2026-12-31',
        }),
      doctorId,
    );
    return guideId;
  };
  return { clinicId, doctorId, insurerId, approvedGuide };
}
type Clinic = Awaited<ReturnType<typeof setupClinic>>;
const asUser = <T>(c: Clinic, fn: (tx: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<T>) =>
  withTenant(c.clinicId, fn, c.doctorId);
const asSystem = <T>(c: Clinic, fn: (tx: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<T>) =>
  withTenant(c.clinicId, fn);
const batchVersion = async (id: string) => (await sql`select version from public.hi_batches where id = ${id}::uuid`)[0]!.version as number;

/** Lote real até "em análise" na operadora, com um demonstrativo de análise registrado. */
async function sentBatch(c: Clinic, n: number): Promise<{ batchId: string; guides: string[]; analysisReturn: string }> {
  const guides: string[] = [];
  for (let i = 0; i < n; i++) guides.push(await c.approvedGuide());
  const batchId = await asUser(c, (tx) =>
    batches.createBatchInTx(tx, { clinicId: c.clinicId, insurerId: c.insurerId, guideType: 'consulta', guideIds: guides, idempotencyKey: `lote-${randomUUID()}` }),
  );
  const reads = await readGuidesAsSystem({ clinicId: c.clinicId, guideIds: guides, operation: 'operator_integration', service: 'insurance-connector', jobId: randomUUID() });
  await batches.exportBatch({ store, validateXsd: xsd }, { clinicId: c.clinicId, batchId, contents: reads.map((r) => ({ guideId: r.guideId, revision: r.revision, content: r.content })), actorUserId: c.doctorId });
  const exported = await batchVersion(batchId);
  let v = await asUser(c, (tx) => batches.markBatchSentInTx(tx, { clinicId: c.clinicId, batchId, version: exported, channel: 'manual', sentOn: '2026-11-11', evidence: 'Enviado pelo portal da operadora, comprovante sintético' }));
  v = await asUser(c, (tx) => batches.recordBatchProtocolInTx(tx, { clinicId: c.clinicId, batchId, version: v, protocol: `PROT-${batchId.slice(0, 8)}`, receivedOn: '2026-11-11', evidenceSha256: sha(`recibo-${batchId}`) }));
  await asUser(c, (tx) => batches.markBatchUnderReviewInTx(tx, { clinicId: c.clinicId, batchId, version: v }));
  const analysisReturn = await asUser(c, (tx) => batches.recordBatchReturnInTx(tx, { clinicId: c.clinicId, batchId, kind: 'analysis_statement', contentSha256: sha(`analise-${batchId}`), receivedOn: '2026-11-20' }));
  return { batchId, guides, analysisReturn };
}
const account = async (c: Clinic, guideId: string) => (await asUser(c, (tx) => acct.readGuideAccountInTx(tx, c.clinicId, guideId)))!;
const glossRow = async (id: string) => (await sql`select * from public.hi_glosses where id = ${id}::uuid`)[0]!;
const itemOf = async (guideId: string) => (await sql`select id from public.hi_guide_items where guide_id = ${guideId}::uuid`)[0]!.id as string;
const key = (p: string) => `${p}-${randomUUID()}`;

try {
  await sql`GRANT SELECT ON public.clinics TO authenticated`;
  const [tv] = await sql`insert into public.tiss_terminology_versions (version, archive_url, archive_sha256, manifest_sha256)
    values ('202609', 'https://example.invalid/tuss.zip', ${'a'.repeat(64)}, ${'b'.repeat(64)}) returning id`;
  await sql`insert into public.tiss_terms (version_id, table_code, code, term, starts_on)
    values (${tv!.id}::uuid, '22', '10101012', 'Consulta em consultório (no horário normal ou preestabelecido)', '2010-01-01'),
           (${tv!.id}::uuid, '24', '225125', 'Médico clínico', '2010-01-01'),
           (${tv!.id}::uuid, '26', '06', 'Conselho Regional de Medicina (CRM)', '2010-01-01'),
           (${tv!.id}::uuid, '36', '9', 'Não acidente', '2010-01-01'),
           (${tv!.id}::uuid, '52', '1', 'Primeira consulta', '2010-01-01'),
           (${tv!.id}::uuid, '59', '35', 'São Paulo', '2010-01-01'),
           (${tv!.id}::uuid, '76', '01', 'Ambulatorial', '2010-01-01'),
           (${tv!.id}::uuid, '87', '22', 'Procedimentos e eventos em saúde', '2010-01-01')`;
  const A = await setupClinic('A');
  const B = await setupClinic('B');
  const [{ n: lancBefore }] = (await sql`select count(*)::int as n from public.lancamentos where source_hi_guide_id is null`) as unknown as [{ n: number }];

  // ── 1. Glosa parcial (do demonstrativo) e pagamento do resto ─────────
  const L1 = await sentBatch(A, 4);
  const [g1, g2, g3, g4] = L1.guides as [string, string, string, string];
  const item1 = await itemOf(g1);
  const gl1 = await asSystem(A, (tx) => acct.recordGlossInTx(tx, { clinicId: A.clinicId, batchId: L1.batchId, guideId: g1, itemId: item1, code: '1705', amountCents: 5000, source: 'statement', returnId: L1.analysisReturn, idempotencyKey: `dem:${L1.analysisReturn}:${g1}:1:1705` }));
  let a1 = await account(A, g1);
  assert.deepEqual([a1.status, a1.billedCents, a1.glossOpenCents, a1.glossDefinitiveCents, a1.pendingCents], ['partially_glossed', VALUE, 5000, 0, VALUE]);
  pass('glosa parcial do demonstrativo (item, tabela 38): guia "parcialmente glosada"; glosa em aberto NÃO é perda (pendente continua R$ 150,00)');

  // ── 2. Retorno duplicado e reprocessamento: a mesma glosa entra uma vez ─
  const again = await asSystem(A, (tx) => acct.recordGlossInTx(tx, { clinicId: A.clinicId, batchId: L1.batchId, guideId: g1, itemId: item1, code: '1705', amountCents: 5000, source: 'statement', returnId: L1.analysisReturn, idempotencyKey: `dem:${L1.analysisReturn}:${g1}:1:1705` }));
  await rejects('duplicate', () => asSystem(A, (tx) => acct.recordGlossInTx(tx, { clinicId: A.clinicId, batchId: L1.batchId, guideId: g1, itemId: item1, code: '1705', amountCents: 6000, source: 'statement', returnId: L1.analysisReturn, idempotencyKey: `dem:${L1.analysisReturn}:${g1}:1:1705` })));
  const [{ n: glossCount }] = (await sql`select count(*)::int as n from public.hi_glosses where guide_id = ${g1}::uuid`) as unknown as [{ n: number }];
  assert.deepEqual([again, glossCount, (await account(A, g1)).glossOpenCents], [gl1, 1, 5000]);
  pass('retorno duplicado e reprocessamento: a mesma glosa (mesma chave) entra uma vez; a mesma chave com outro valor é conflito, nunca soma');

  // ── 3. Sem dupla contagem: glosa + pagamento acima do faturado é recusado ─
  await rejects('invalid', () => asUser(A, (tx) => acct.recordGlossInTx(tx, { clinicId: A.clinicId, batchId: L1.batchId, guideId: g1, itemId: item1, code: '1801', amountCents: 10001, source: 'manual', idempotencyKey: key('gl') })), /saldo do item/u);
  await rejects('invalid', () => asUser(A, (tx) => acct.recordPaymentInTx(tx, { clinicId: A.clinicId, insurerId: A.insurerId, paidOn: '2026-11-11', amountCents: 10001, source: 'manual', idempotencyKey: key('pg'), allocations: [{ guideId: g1, batchId: L1.batchId, amountCents: 10001 }] })), /saldo da guia/u);
  pass('sem dupla contagem: pago + glosa em aberto + glosa definitiva nunca passa do faturado, por item e por guia (a glosa de R$ 50 reserva R$ 50)');

  // ── 4. Pagamento parcial não quita ───────────────────────────────────
  await asUser(A, (tx) => acct.recordPaymentInTx(tx, { clinicId: A.clinicId, insurerId: A.insurerId, batchId: L1.batchId, statementRef: 'DEM-PG-001', paidOn: '2026-11-11', amountCents: 10000, source: 'manual', idempotencyKey: key('pg'), allocations: [{ guideId: g1, batchId: L1.batchId, amountCents: 10000 }] }));
  a1 = await account(A, g1);
  assert.deepEqual([a1.status, a1.paidCents, a1.pendingCents], ['partially_glossed', 10000, 5000]);
  await rejects('state', () => asUser(A, async (tx) => acct.reconcileGuideInTx(tx, { clinicId: A.clinicId, guideId: g1, version: a1.version })), /glosa ou recurso em aberto/u);
  const p2guide = g2;
  await asUser(A, (tx) => acct.recordPaymentInTx(tx, { clinicId: A.clinicId, insurerId: A.insurerId, paidOn: '2026-11-11', amountCents: 9000, source: 'manual', idempotencyKey: key('pg'), allocations: [{ guideId: p2guide, batchId: L1.batchId, amountCents: 9000 }] }));
  const a2 = await account(A, p2guide);
  assert.deepEqual([a2.status, a2.paidCents, a2.pendingCents], ['partially_paid', 9000, 6000]);
  await rejects('invalid', () => asUser(A, (tx) => acct.reconcileGuideInTx(tx, { clinicId: A.clinicId, guideId: p2guide, version: a2.version })), /não fecha/u);
  pass('pagamento parcial nunca quita: guia "parcialmente paga" com R$ 60 pendentes; conciliar é recusado enquanto houver pendente ou glosa em aberto');

  // ── 5. Glosa definitiva (aceite com motivo, por uma pessoa) e conciliação ─
  const glv = (await glossRow(gl1)).version as number;
  await rejects('forbidden', () => asSystem(A, (tx) => acct.transitionGlossInTx(tx, { clinicId: A.clinicId, glossId: gl1, version: glv, to: 'definitive', reason: 'A clínica aceita a glosa do demonstrativo' })));
  await asUser(A, (tx) => acct.transitionGlossInTx(tx, { clinicId: A.clinicId, glossId: gl1, version: glv, to: 'under_analysis' }));
  await asUser(A, (tx) => acct.transitionGlossInTx(tx, { clinicId: A.clinicId, glossId: gl1, version: glv + 1, to: 'definitive', reason: 'Conferido: a operadora tem razão, o código não cobre' }));
  a1 = await account(A, g1);
  assert.deepEqual([a1.status, a1.glossOpenCents, a1.glossDefinitiveCents, a1.paidCents, a1.pendingCents], ['partially_glossed', 0, 5000, 10000, 0]);
  await rejects('state', () => asUser(A, (tx) => acct.transitionGlossInTx(tx, { clinicId: A.clinicId, glossId: gl1, version: glv + 2, to: 'reversed', reason: 'Tentar voltar atrás numa glosa decidida' })));
  await asUser(A, (tx) => acct.reconcileGuideInTx(tx, { clinicId: A.clinicId, guideId: g1, version: a1.version, note: 'Pago R$ 100, glosa definitiva R$ 50' }));
  assert.equal((await account(A, g1)).status, 'closed');
  await rejects('state', () => asUser(A, (tx) => acct.recordGlossInTx(tx, { clinicId: A.clinicId, batchId: L1.batchId, guideId: g1, code: '1801', amountCents: 1, source: 'manual', idempotencyKey: key('gl') })), /não encerrada/u);
  pass('glosa definitiva: só uma pessoa aceita, com motivo (o sistema não); só ela reduz o que a operadora deve; decidida não volta; pago + definitiva = faturado → conciliada por uma pessoa e encerrada; guia encerrada não recebe mais nada');

  // ── 6. Glosa integral, recurso, resposta parcial e pagamento depois do recurso ─
  const gl3 = await asSystem(A, (tx) => acct.recordGlossInTx(tx, { clinicId: A.clinicId, batchId: L1.batchId, guideId: g3, code: '1909', amountCents: VALUE, source: 'statement', returnId: L1.analysisReturn, idempotencyKey: `dem:${L1.analysisReturn}:${g3}:1909` }));
  assert.equal((await account(A, g3)).status, 'fully_glossed');
  await rejects('forbidden', () => asSystem(A, (tx) => acct.createAppealInTx(tx, { clinicId: A.clinicId, guideId: g3, items: [{ glossId: gl3 }], justification: 'Justificativa automática não pode existir', idempotencyKey: key('rec') })));
  await assert.rejects(() => asUser(A, (tx) => acct.createAppealInTx(tx, { clinicId: A.clinicId, guideId: g3, items: [{ glossId: gl3 }], justification: 'curta', idempotencyKey: key('rec') })));
  const appealKey = key('rec');
  const ap = await asUser(A, (tx) => acct.createAppealInTx(tx, { clinicId: A.clinicId, guideId: g3, items: [{ glossId: gl3 }], justification: 'O procedimento foi autorizado pela operadora (senha no prontuário administrativo) e realizado na data.', idempotencyKey: appealKey }));
  assert.equal(await asUser(A, (tx) => acct.createAppealInTx(tx, { clinicId: A.clinicId, guideId: g3, items: [{ glossId: gl3 }], justification: 'O procedimento foi autorizado pela operadora (senha no prontuário administrativo) e realizado na data.', idempotencyKey: appealKey })), ap);
  assert.equal((await glossRow(gl3)).status, 'contested');
  await rejects('state', () => asUser(A, (tx) => acct.transitionGlossInTx(tx, { clinicId: A.clinicId, glossId: gl3, version: 2, to: 'definitive', reason: 'Aceitar com recurso em preparo não pode' })), /recurso em preparo/u);
  await rejects('invalid', () => asUser(A, (tx) => acct.fileAppealInTx(tx, { clinicId: A.clinicId, appealId: ap, version: 1, channel: 'manual', filedOn: '2026-11-11' })), /protocolo|evidência/u);
  await asUser(A, (tx) => acct.fileAppealInTx(tx, { clinicId: A.clinicId, appealId: ap, version: 1, channel: 'manual', filedOn: '2026-11-11', protocol: 'REC-2026-77' }));
  assert.equal((await glossRow(gl3)).status, 'appeal_filed');
  await asUser(A, (tx) => acct.answerAppealInTx(tx, { clinicId: A.clinicId, appealId: ap, version: 2, answeredOn: '2026-11-11', items: [{ glossId: gl3, acceptedCents: 9000 }], note: 'Revisão parcial da operadora' }));
  const g3row = await glossRow(gl3);
  let a3 = await account(A, g3);
  assert.deepEqual([g3row.status, Number(g3row.reversed_cents), Number(g3row.definitive_cents), a3.status, a3.pendingCents], ['definitive', 9000, 6000, 'partially_glossed', 9000]);
  await asUser(A, (tx) => acct.recordPaymentInTx(tx, { clinicId: A.clinicId, insurerId: A.insurerId, paidOn: '2026-11-11', amountCents: 9000, source: 'manual', idempotencyKey: key('pg'), allocations: [{ guideId: g3, batchId: L1.batchId, amountCents: 9000 }] }));
  a3 = await account(A, g3);
  assert.deepEqual([a3.paidCents, a3.glossDefinitiveCents, a3.glossReversedCents, a3.pendingCents], [9000, 6000, 9000, 0]);
  const [apRow] = await sql`select status, answer, accepted_cents, protocol_number, justified_by from public.hi_gloss_appeals where id = ${ap}::uuid`;
  assert.deepEqual([apRow!.status, apRow!.answer, Number(apRow!.accepted_cents), apRow!.protocol_number, apRow!.justified_by], ['answered', 'partially_accepted', 9000, 'REC-2026-77', A.doctorId]);
  pass('glosa integral → recurso com justificativa de uma pessoa (sistema e texto curto recusados; mesma chave não duplica) → apresentado só com protocolo ou evidência → resposta parcial: R$ 90 revertidos, R$ 60 definitivos → pagamento depois do recurso fecha a conta (pendente 0)');

  // ── 7. Glosa revertida pela operadora e volta a "em análise" sem pagamento ─
  const gl4 = await asSystem(A, (tx) => acct.recordGlossInTx(tx, { clinicId: A.clinicId, batchId: L1.batchId, guideId: g4, code: '1705', amountCents: VALUE, source: 'statement', returnId: L1.analysisReturn, idempotencyKey: `dem:${L1.analysisReturn}:${g4}:1705` }));
  assert.equal((await account(A, g4)).status, 'fully_glossed');
  await asUser(A, (tx) => acct.transitionGlossInTx(tx, { clinicId: A.clinicId, glossId: gl4, version: 1, to: 'reversed', reason: 'A operadora reprocessou e retirou a glosa (ofício 12)' }));
  const a4 = await account(A, g4);
  assert.deepEqual([a4.status, a4.glossReversedCents, a4.pendingCents], ['under_review', VALUE, VALUE]);
  pass('glosa revertida: valor volta a ser devido (pendente R$ 150) e a guia volta a "em análise" até o pagamento — revertida não é paga');

  // ── 8. Pagamento integral, duplicado, demonstrativo repetido e estorno compensatório ─
  const payKey = key('pg');
  const pFull = await asUser(A, (tx) => acct.recordPaymentInTx(tx, { clinicId: A.clinicId, insurerId: A.insurerId, statementRef: 'DEM-PG-002', paidOn: '2026-11-11', amountCents: VALUE, source: 'manual', idempotencyKey: payKey, allocations: [{ guideId: g4, batchId: L1.batchId, amountCents: VALUE }] }));
  const pDup = await asUser(A, (tx) => acct.recordPaymentInTx(tx, { clinicId: A.clinicId, insurerId: A.insurerId, statementRef: 'DEM-PG-002', paidOn: '2026-11-11', amountCents: VALUE, source: 'manual', idempotencyKey: payKey, allocations: [{ guideId: g4, batchId: L1.batchId, amountCents: VALUE }] }));
  await rejects('duplicate', () => asUser(A, (tx) => acct.recordPaymentInTx(tx, { clinicId: A.clinicId, insurerId: A.insurerId, statementRef: 'DEM-PG-002', paidOn: '2026-11-11', amountCents: VALUE, source: 'manual', idempotencyKey: key('pg') })), /demonstrativo/u);
  let a4b = await account(A, g4);
  assert.deepEqual([pDup, a4b.status, a4b.paidCents, a4b.pendingCents], [pFull, 'paid', VALUE, 0]);
  const [alloc] = await sql`select id from public.hi_payment_allocations where payment_id = ${pFull}::uuid and kind = 'allocation'`;
  const rev1 = await asUser(A, (tx) => acct.reversePaymentAllocationInTx(tx, { clinicId: A.clinicId, allocationId: alloc!.id as string, reason: 'Crédito devolvido pelo banco (TED recusada)' }));
  const rev2 = await asUser(A, (tx) => acct.reversePaymentAllocationInTx(tx, { clinicId: A.clinicId, allocationId: alloc!.id as string, reason: 'Crédito devolvido pelo banco (TED recusada)' }));
  a4b = await account(A, g4);
  const [{ n: allocRows }] = (await sql`select count(*)::int as n from public.hi_payment_allocations where payment_id = ${pFull}::uuid`) as unknown as [{ n: number }];
  assert.deepEqual([rev1, a4b.paidCents, a4b.status, allocRows], [rev2, 0, 'under_review', 2]);
  await rejects('55000', () => sql`update public.hi_payment_allocations set amount_cents = 1 where id = ${alloc!.id}::uuid`);
  pass('pagamento integral → "paga"; o mesmo pagamento (mesma chave) entra uma vez; o mesmo demonstrativo com outra chave é recusado; estorno é lançamento COMPENSATÓRIO (a alocação original fica, imutável), idempotente, e a guia volta a "em análise"');

  // ── 9. Pagamento por lote: rateio só quando o valor é exatamente o saldo ─
  const L2 = await sentBatch(A, 3);
  const exact = 3 * VALUE;
  const pInexact = await asUser(A, (tx) => acct.recordPaymentInTx(tx, { clinicId: A.clinicId, insurerId: A.insurerId, batchId: L2.batchId, paidOn: '2026-11-11', amountCents: exact - 100, source: 'manual', idempotencyKey: key('pg') }));
  const bal = await asUser(A, (tx) => acct.readPaymentBalanceInTx(tx, A.clinicId, pInexact));
  assert.deepEqual([bal!.allocatedCents, bal!.unreconciledCents], [0, exact - 100]);
  assert.deepEqual((await asUser(A, (tx) => acct.listBatchAccountsInTx(tx, A.clinicId, L2.batchId))).map((x) => x.paidCents), [0, 0, 0]);
  const L3 = await sentBatch(A, 2);
  const pExact = await asUser(A, (tx) => acct.recordPaymentInTx(tx, { clinicId: A.clinicId, insurerId: A.insurerId, batchId: L3.batchId, paidOn: '2026-11-11', amountCents: 2 * VALUE, source: 'manual', idempotencyKey: key('pg') }));
  const accounts3 = await asUser(A, (tx) => acct.listBatchAccountsInTx(tx, A.clinicId, L3.batchId));
  assert.deepEqual([accounts3.map((x) => x.status), (await asUser(A, (tx) => acct.readPaymentBalanceInTx(tx, A.clinicId, pExact)))!.unreconciledCents], [['paid', 'paid'], 0]);
  // O valor não conciliado é atribuído depois, por guia, com chave própria (repetir não duplica).
  const allocKey = key('conc');
  const s1 = await asUser(A, (tx) => acct.allocatePaymentInTx(tx, { clinicId: A.clinicId, paymentId: pInexact, allocationKey: allocKey, allocations: [{ guideId: L2.guides[0]!, batchId: L2.batchId, amountCents: VALUE }] }));
  const s2 = await asUser(A, (tx) => acct.allocatePaymentInTx(tx, { clinicId: A.clinicId, paymentId: pInexact, allocationKey: allocKey, allocations: [{ guideId: L2.guides[0]!, batchId: L2.batchId, amountCents: VALUE }] }));
  assert.deepEqual([s1, s2, (await account(A, L2.guides[0]!)).paidCents], [VALUE, VALUE, VALUE]);
  await rejects('invalid', () => asUser(A, (tx) => acct.allocatePaymentInTx(tx, { clinicId: A.clinicId, paymentId: pInexact, allocationKey: key('conc'), allocations: [{ guideId: L2.guides[1]!, batchId: L2.batchId, amountCents: VALUE }, { guideId: L2.guides[2]!, batchId: L2.batchId, amountCents: VALUE }] })), /acima do valor pago/u);
  pass('pagamento por lote: valor diferente do saldo NÃO é rateado (fica "não conciliado", divergência visível); valor exato quita cada guia; a conciliação posterior por guia é idempotente e nunca aloca mais que o recebido');

  // ── 10. Concorrência: pagamentos e glosas simultâneos na mesma guia ───
  const L4 = await sentBatch(A, 1);
  const gc = L4.guides[0]!;
  const races = await Promise.allSettled(
    Array.from({ length: 6 }, (_, i) =>
      i % 2 === 0
        ? asUser(A, (tx) => acct.recordPaymentInTx(tx, { clinicId: A.clinicId, insurerId: A.insurerId, paidOn: '2026-11-11', amountCents: VALUE, source: 'manual', idempotencyKey: key('pg'), allocations: [{ guideId: gc, batchId: L4.batchId, amountCents: VALUE }] }))
        : asUser(A, (tx) => acct.recordGlossInTx(tx, { clinicId: A.clinicId, batchId: L4.batchId, guideId: gc, code: '1705', amountCents: VALUE, source: 'manual', idempotencyKey: key('gl') })),
    ),
  );
  const won = races.filter((r) => r.status === 'fulfilled').length;
  const ac = await account(A, gc);
  assert.equal(won, 1);
  assert.ok(ac.paidCents + ac.glossOpenCents === VALUE, JSON.stringify(ac));
  const sameKey = key('pg');
  const twins = await Promise.all(
    [0, 1, 2].map(() =>
      asUser(A, (tx) => acct.recordPaymentInTx(tx, { clinicId: A.clinicId, insurerId: A.insurerId, batchId: L2.batchId, paidOn: '2026-11-11', amountCents: 123, source: 'manual', idempotencyKey: sameKey })),
    ),
  );
  const [{ n: twinRows }] = (await sql`select count(*)::int as n from public.hi_payments where idempotency_key = ${sameKey}`) as unknown as [{ n: number }];
  assert.deepEqual([new Set(twins).size, twinRows], [1, 1]);
  pass(`concorrência: 6 operações simultâneas (3 pagamentos e 3 glosas de R$ 150) na mesma guia → ${won} vence, as outras são recusadas pelo saldo (guia travada); 3 registros simultâneos com a mesma chave → 1 pagamento`);

  // ── 11. Falha transacional: nada fica pela metade ─────────────────────
  const L5 = await sentBatch(A, 1);
  await sql.unsafe(`create or replace function public.harness_account_fault() returns trigger language plpgsql as $f$
    begin if new.action = 'payment_allocated' then raise exception 'falha injetada' using errcode = '08006'; end if; return new; end $f$;
    create trigger harness_account_fault before insert on public.hi_account_events for each row execute function public.harness_account_fault();`);
  const failKey = key('pg');
  await assert.rejects(() => asUser(A, (tx) => acct.recordPaymentInTx(tx, { clinicId: A.clinicId, insurerId: A.insurerId, paidOn: '2026-11-11', amountCents: VALUE, source: 'manual', idempotencyKey: failKey, allocations: [{ guideId: L5.guides[0]!, batchId: L5.batchId, amountCents: VALUE }] })));
  await sql`drop trigger harness_account_fault on public.hi_account_events`;
  const [{ n: failRows }] = (await sql`select count(*)::int as n from public.hi_payments where idempotency_key = ${failKey}`) as unknown as [{ n: number }];
  const a5 = await account(A, L5.guides[0]!);
  assert.deepEqual([failRows, a5.paidCents, a5.status], [0, 0, 'under_review']);
  await asUser(A, (tx) => acct.recordPaymentInTx(tx, { clinicId: A.clinicId, insurerId: A.insurerId, paidOn: '2026-11-11', amountCents: VALUE, source: 'manual', idempotencyKey: failKey, allocations: [{ guideId: L5.guides[0]!, batchId: L5.batchId, amountCents: VALUE }] }));
  assert.equal((await account(A, L5.guides[0]!)).status, 'paid');
  pass('falha transacional no meio do pagamento: nem o pagamento, nem a alocação, nem o estado da guia ficam; reprocessado com a mesma chave, entra uma vez');

  // ── 12. Lote cancelado e guia substituída: nada é registrado ──────────
  const gx = await A.approvedGuide();
  const bx = await asUser(A, (tx) => batches.createBatchInTx(tx, { clinicId: A.clinicId, insurerId: A.insurerId, guideType: 'consulta', guideIds: [gx], idempotencyKey: key('lote') }));
  await asUser(A, async (tx) => batches.cancelBatchInTx(tx, { clinicId: A.clinicId, batchId: bx, version: await batchVersion(bx), reason: 'Lote montado por engano, cancelado antes do envio' }));
  await rejects('state', () => asUser(A, (tx) => acct.recordGlossInTx(tx, { clinicId: A.clinicId, batchId: bx, guideId: gx, code: '1705', amountCents: 100, source: 'manual', idempotencyKey: key('gl') })), /enviada/u);
  await rejects('state', () => asUser(A, (tx) => acct.recordPaymentInTx(tx, { clinicId: A.clinicId, insurerId: A.insurerId, paidOn: '2026-11-11', amountCents: 100, source: 'manual', idempotencyKey: key('pg'), allocations: [{ guideId: gx, batchId: bx, amountCents: 100 }] })));
  const L6 = await sentBatch(A, 1);
  const gr = L6.guides[0]!;
  // Estado "substituída" posto sem os gatilhos SÓ para provar a recusa: a substituição real
  // (substituta aprovada troca a original) já é provada no harness de guias.
  await sql.begin(async (t) => {
    await t`set local session_replication_role = replica`;
    await t`update public.hi_guides set status = 'replaced', live = false where id = ${gr}::uuid`;
  });
  await rejects('state', () => asUser(A, (tx) => acct.recordGlossInTx(tx, { clinicId: A.clinicId, batchId: L6.batchId, guideId: gr, code: '1705', amountCents: 100, source: 'manual', idempotencyKey: key('gl') })), /replaced/u);
  await rejects('state', () => asUser(A, (tx) => acct.recordPaymentInTx(tx, { clinicId: A.clinicId, insurerId: A.insurerId, paidOn: '2026-11-11', amountCents: 100, source: 'manual', idempotencyKey: key('pg'), allocations: [{ guideId: gr, batchId: L6.batchId, amountCents: 100 }] })), /replaced/u);
  pass('lote cancelado antes do envio e guia substituída: glosa e pagamento recusados (só guia enviada num lote enviado e ainda viva recebe desfecho)');

  // ── 13. Acesso entre clínicas ─────────────────────────────────────────
  await rejects('forbidden', () => withTenant(B.clinicId, (tx) => acct.recordGlossInTx(tx, { clinicId: A.clinicId, batchId: L1.batchId, guideId: g2, code: '1705', amountCents: 100, source: 'manual', idempotencyKey: key('gl') }), B.doctorId));
  await rejects('not_found', () => withTenant(B.clinicId, (tx) => acct.recordGlossInTx(tx, { clinicId: B.clinicId, batchId: L1.batchId, guideId: g2, code: '1705', amountCents: 100, source: 'manual', idempotencyKey: key('gl') }), B.doctorId));
  await rejects('forbidden', () => withTenant(B.clinicId, (tx) => acct.reversePaymentAllocationInTx(tx, { clinicId: A.clinicId, allocationId: alloc!.id as string, reason: 'Tentativa de outra clínica estornar' }), B.doctorId));
  const seen = await withTenant(B.clinicId, async (tx) => ({
    glosses: (await tx.execute(sqlTag`select count(*)::int as n from public.hi_glosses`))[0]!.n,
    payments: (await tx.execute(sqlTag`select count(*)::int as n from public.hi_payments`))[0]!.n,
    accounts: (await tx.execute(sqlTag`select count(*)::int as n from public.hi_guide_accounts`))[0]!.n,
    events: (await tx.execute(sqlTag`select count(*)::int as n from public.hi_account_events`))[0]!.n,
  }), B.doctorId);
  assert.deepEqual(seen, { glosses: 0, payments: 0, accounts: 0, events: 0 });
  pass('acesso entre clínicas: a função recusa clínica fora da sessão (42501); a clínica B não acha a guia da A (23503) nem estorna pagamento dela; RLS: B não vê glosa, pagamento, conta nem histórico da A');

  // ── 14. Runtime sem escrita direta ───────────────────────────────────
  for (const stmt of [
    sqlTag`insert into public.hi_glosses (clinic_id, insurer_id, batch_id, guide_id, gloss_code, amount_cents, source, idempotency_key) values (${A.clinicId}::uuid, ${A.insurerId}::uuid, ${L1.batchId}::uuid, ${g2}::uuid, '1705', 1, 'manual', 'direto-123456')`,
    sqlTag`update public.hi_glosses set status = 'reversed' where clinic_id = ${A.clinicId}::uuid`,
    sqlTag`delete from public.hi_payment_allocations where clinic_id = ${A.clinicId}::uuid`,
    sqlTag`update public.hi_guides set status = 'paid' where id = ${g2}::uuid`,
  ]) {
    await rejects('42501', () => asUser(A, (tx) => tx.execute(stmt)).catch((e: { cause?: { code?: string } }) => {
      // update de guia pelo runtime cai no gatilho de transição (55000) — também recusa.
      if (e.cause?.code === '55000') throw Object.assign(new Error('recusado'), { code: '42501' });
      throw e;
    }));
  }
  pass('runtime não escreve nas tabelas de glosa, pagamento e conta (só pelas funções), nem leva a guia a "paga" por fora');

  // ── 15. D24: com a assinatura cancelada, o desfecho de lote JÁ enviado continua ─
  await sql`update public.subscriptions set billing_status = 'cancelled' where clinic_id = ${A.clinicId}::uuid`;
  const [{ denial }] = (await sql`select public.qoro_premium_denial_for(${A.clinicId}::uuid, 'health_insurance') as denial`) as unknown as [{ denial: string }];
  const glPres = await asSystem(A, (tx) => acct.recordGlossInTx(tx, { clinicId: A.clinicId, batchId: L2.batchId, guideId: L2.guides[1]!, code: '1705', amountCents: 1000, source: 'statement', returnId: L2.analysisReturn, idempotencyKey: key('gl') }));
  await asUser(A, (tx) => acct.allocatePaymentInTx(tx, { clinicId: A.clinicId, paymentId: pInexact, allocationKey: key('conc'), allocations: [{ guideId: L2.guides[2]!, batchId: L2.batchId, amountCents: VALUE - 100 }] }));
  // D24-a (decisão do fundador, 12/11): o RECURSO da glosa anterior segue com a assinatura
  // suspensa — preparar a justificativa humana, apresentar com protocolo e receber a resposta.
  const apPres = await asUser(A, (tx) => acct.createAppealInTx(tx, { clinicId: A.clinicId, guideId: L2.guides[1]!, items: [{ glossId: glPres }], justification: 'Procedimento realizado conforme autorização prévia da operadora; segue a comprovação do atendimento.', idempotencyKey: key('rec') }));
  await asUser(A, (tx) => acct.fileAppealInTx(tx, { clinicId: A.clinicId, appealId: apPres, version: 1, channel: 'manual', filedOn: '2026-11-12', protocol: 'REC-SUSP-01' }));
  await asUser(A, (tx) => acct.answerAppealInTx(tx, { clinicId: A.clinicId, appealId: apPres, version: 2, answeredOn: '2026-11-12', items: [{ glossId: glPres, acceptedCents: 1000 }], note: 'Deferido' }));
  assert.equal((await glossRow(glPres)).status, 'reversed');
  // Limite: o vínculo com uma obrigação ANTERIOR real é exigido — recurso sem glosa, glosa de
  // outra guia ou guia que nunca foi enviada é recusado; e operação nova continua negada.
  await assert.rejects(() => asUser(A, (tx) => acct.createAppealInTx(tx, { clinicId: A.clinicId, guideId: L2.guides[0]!, items: [{ glossId: glPres }], justification: 'Tentativa de usar a glosa de outra guia no recurso', idempotencyKey: key('rec') })));
  await assert.rejects(() => asUser(A, (tx) => acct.createAppealInTx(tx, { clinicId: A.clinicId, guideId: L2.guides[0]!, items: [], justification: 'Recurso sem nenhuma glosa vinculada não pode existir', idempotencyKey: key('rec') })));
  const unsent = await sql`select id from public.hi_guides where clinic_id = ${A.clinicId}::uuid and status = 'approved' limit 1`;
  if (unsent[0]) {
    await rejects('state', () => asUser(A, (tx) => acct.recordGlossInTx(tx, { clinicId: A.clinicId, batchId: L2.batchId, guideId: unsent[0]!.id as string, code: '1705', amountCents: 100, source: 'manual', idempotencyKey: key('gl') })));
  }
  await assert.rejects(() => asUser(A, async (tx) => batches.createBatchInTx(tx, { clinicId: A.clinicId, insurerId: A.insurerId, guideType: 'consulta', guideIds: [await A.approvedGuide()], idempotencyKey: key('lote') })));
  await sql`update public.subscriptions set billing_status = 'active' where clinic_id = ${A.clinicId}::uuid`;
  assert.ok(denial === 'subscription_cancelled' && glPres);
  pass('D24-a (preservação): com a assinatura cancelada ("subscription_cancelled"), glosa do demonstrativo, conciliação de pagamento e o RECURSO da glosa anterior (justificativa humana, protocolo e resposta) continuam; recurso sem glosa ou com glosa de outra guia é recusado e lote novo segue negado');

  // ── 16. Livro financeiro (0153): só a projeção da conta das guias enviadas ─
  const [{ n: lancAfter }] = (await sql`select count(*)::int as n from public.lancamentos where source_hi_guide_id is null`) as unknown as [{ n: number }];
  // A guia do cenário 12 foi posta em "substituída" COM OS GATILHOS DESLIGADOS (replica):
  // a conferência acusa o recebível vivo dela, e o reprocessamento corrige.
  const driftBefore = (await sql`select guide_id, drift from public.hi_ledger_drift`).map((r) => [r.guide_id, r.drift]);
  assert.deepEqual(driftBefore, [[gr, 'stale_receivable']]);
  await asUser(A, (tx) => acct.syncLedgerForClinicInTx(tx, A.clinicId));
  const [{ n: billedGuides }] = (await sql`select count(*)::int as n from public.hi_guides where status in ('sent','under_review','paid','partially_paid','partially_glossed','fully_glossed','closed')`) as unknown as [{ n: number }];
  const [{ n: liveReceivables }] = (await sql`select count(*)::int as n from public.lancamentos where source_hi_guide_id is not null and status <> 'cancelado'`) as unknown as [{ n: number }];
  const [{ n: driftRows }] = (await sql`select count(*)::int as n from public.hi_ledger_drift`) as unknown as [{ n: number }];
  assert.deepEqual([liveReceivables, driftRows], [billedGuides, 0]);
  const [{ n: histNoPii }] = (await sql`select count(*)::int as n from public.hi_account_events where details::text ilike '%Paciente%' or note ilike ${`%${CARD}%`}`) as unknown as [{ n: number }];
  assert.deepEqual([lancAfter, histNoPii], [lancBefore, 0]);
  pass('livro financeiro: nenhum lançamento particular criado em todo o ciclo; cada guia enviada tem UM recebível da operadora (0153); a guia substituída por fora dos gatilhos aparece na conferência (recebível vivo) e o reprocessamento a cancela; divergência vazia; histórico sem nome de paciente nem carteirinha');

  console.log(`\nOK — ${passed}/16 provas da 0152 (glosas, recursos, pagamentos e conta da guia) em Postgres descartável.`);
} finally {
  await cluster.stop();
}
