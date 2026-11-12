/**
 * Convênios P1.9 — lotes TISS: prova da migration 0150 e do serviço de lotes em
 * Postgres DESCARTÁVEL, com o código real:
 *
 *   guias aprovadas pela emissão real (snapshot cifrado, `issueConsultaGuide`)
 *   → lote pela função do banco (`hi_batch_create`)
 *   → XML montado dos SNAPSHOTS lidos pela leitura auditada de sistema
 *   → XSD oficial da ANS (xmllint-wasm, o motor da D7), regras internas, hash do
 *     epílogo recalculado do texto e codificação
 *   → arquivo cifrado por clínica no armazenamento (aqui, em memória com falhas
 *     injetáveis) + `hi_files` + exportado, numa transação, com compensação
 *   → envio (registro e evidência), protocolo, análise, retorno, processado.
 *
 * Cenários exigidos pelo fundador (11/11): 1, várias e 100 guias; acima do
 * limite; mistura de tipo, operadora e versão; guias duplicadas; exportação
 * concorrente; falha na exportação e na gravação do arquivo; reprocessamento;
 * cancelamento; substituição; retorno duplicado. Mais: estados com prova,
 * reenvio rastreado, protocolo de outra operadora, guia não muda depois do lote,
 * runtime sem escrita direta, RLS e nenhum lançamento financeiro.
 *
 * Pré-requisito local: TISS_XMLLINT_WASM_DIR apontando para uma pasta com
 * node_modules/xmllint-wasm (o mesmo pacote avaliado na P0.8). Sem ele, a prova
 * para (a exportação recusa sem XSD). Não toca DEV nem produção. Uso:
 *   NODE_OPTIONS=--conditions=react-server TISS_XMLLINT_WASM_DIR=... npx tsx scripts/security/health-insurance-batches-db.ts
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

import { startScratchSchema, grantPaidSubscription } from './scratch-schema';

const cluster = await startScratchSchema({ port: 55508, maxConnections: 24 });
const { sql } = cluster;
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');
if (!/@(?:127\.0\.0\.1|localhost):55508\//u.test(cluster.url)) throw new Error('não é o cluster local');

const { withTenant } = await import('../../src/lib/db/tenant');
const { createConsultaGuideForAppointment } =
  await import('../../src/contexts/health-insurance/internal/consulta-guide-service');
const { issueConsultaGuide } = await import('../../src/contexts/health-insurance/internal/guide-issuance');
const { readGuidesAsSystem } = await import('../../src/contexts/health-insurance/internal/guide-access');
const svc = await import('../../src/contexts/health-insurance/internal/batch-service');
const { loadXmllintValidator } = await import('../../src/contexts/health-insurance/tiss/xml/xsd-validator');
const { hiBatches } = await import('../../src/contexts/health-insurance/schema-clinic');
const { PremiumAccessError, premiumAccessErrorFrom } = await import('../../src/lib/premium-access');

const xsd = loadXmllintValidator();
if (!xsd) throw new Error('xmllint-wasm não encontrado: defina TISS_XMLLINT_WASM_DIR');

const SYS = '00000000-0000-0000-0000-0000000000aa';
const CARD = '0081234500012345'; // sintético
let passed = 0;
const pass = (msg: string): void => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};
async function rejects(code: string, op: () => Promise<unknown>, hint?: RegExp): Promise<void> {
  await assert.rejects(op, (e: unknown) => {
    const err = e as { code?: string; message?: string; cause?: { code?: string; message?: string } };
    assert.equal(err.code ?? err.cause?.code, code, String(err.message ?? err));
    if (hint) assert.match(`${err.message} ${err.cause?.message ?? ''}`, hint);
    return true;
  });
}
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

/** Armazenamento em memória com falhas injetáveis (o de produção é o bucket privado). */
const objects = new Map<string, Uint8Array>();
const faults = { put: false, remove: false };
const store = {
  async put(ref: string, bytes: Uint8Array) {
    if (faults.put) throw new Error('falha injetada na gravação do arquivo');
    if (objects.has(ref)) throw new Error('objeto já existe (sem sobrescrita)');
    objects.set(ref, bytes);
  },
  async get(ref: string) {
    const b = objects.get(ref);
    if (!b) throw new Error('objeto inexistente');
    return b;
  },
  async remove(ref: string) {
    if (faults.remove) throw new Error('falha injetada na compensação');
    objects.delete(ref);
  },
};
const deps = { store, validateXsd: xsd };

let slot = 0;
async function setupClinic(label: string) {
  const clinicId = randomUUID();
  const doctorId = randomUUID();
  await sql`insert into auth.users (id, email) values (${doctorId}::uuid, ${`${doctorId}@example.invalid`})`;
  await sql`insert into public.clinics (id, slug, nome, status)
    values (${clinicId}::uuid, ${`bt-${clinicId.slice(0, 8)}`}, ${`Clínica ${label}`}, 'active')`;
  await grantPaidSubscription(sql, clinicId);
  await sql`insert into public.profiles (id, clinic_id, nome, role, ativo)
    values (${doctorId}::uuid, ${clinicId}::uuid, 'Dra. Sintética', 'doctor', true)`;
  await sql`insert into public.hi_clinic_settings (clinic_id, enabled, enabled_at, enabled_by, provider_kind, cnes_status)
    values (${clinicId}::uuid, true, now(), ${SYS}::uuid, 'PJ', 'none_declared')`;
  await sql`insert into public.hi_professional_profiles (clinic_id, professional_id, council, council_number, council_uf, cbo)
    values (${clinicId}::uuid, ${doctorId}::uuid, '06', '12345', '35', '225125')`;
  const [proc] = await sql`insert into public.procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
    values (${clinicId}::uuid, 'CONS', 'Consulta sintética', 150, 30, true) returning id`;
  const insurer = async (name: string, ans: string) => {
    const [ins] = await sql`insert into public.hi_insurers
        (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, status, created_by)
      values (${clinicId}::uuid, ${name}, ${ans}, 'codigoPrestadorNaOperadora', 'TESTE001', 'active', ${SYS}::uuid) returning id`;
    await sql`insert into public.hi_procedure_contracts
        (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id, unit_value_cents, valid_from, created_by)
      values (${clinicId}::uuid, ${ins!.id}::uuid, 'consulta', '22', '10101012', 'Consulta em consultório', ${proc!.id}::uuid,
        15000, '2026-01-01', ${SYS}::uuid)`;
    return ins!.id as string;
  };
  const ins1 = await insurer('Operadora Um', '123456');
  const ins2 = await insurer('Operadora Dois', '654321');
  /** Uma guia APROVADA de verdade (snapshot cifrado), cada uma de um paciente sintético. */
  const approvedGuide = async (insurerId = ins1) => {
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
    assert.equal(out.kind, 'created');
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
  return { clinicId, doctorId, ins1, ins2, approvedGuide };
}
type Clinic = Awaited<ReturnType<typeof setupClinic>>;
const { sql: sqlTag } = await import('drizzle-orm');

const create = (c: Clinic, guideIds: string[], opts: { insurerId?: string; type?: 'consulta' | 'sp_sadt'; key?: string; replaces?: string } = {}) =>
  withTenant(
    c.clinicId,
    (tx) =>
      svc.createBatchInTx(tx, {
        clinicId: c.clinicId,
        insurerId: opts.insurerId ?? c.ins1,
        guideType: opts.type ?? 'consulta',
        guideIds,
        idempotencyKey: opts.key ?? `lote-${randomUUID()}`,
        replacesBatchId: opts.replaces ?? null,
      }),
    c.doctorId,
  );
const contentsOf = async (c: Clinic, batchId: string) => {
  const ids = (await sql`select guide_id from public.hi_batch_guides where batch_id = ${batchId}::uuid and active`).map(
    (r) => r.guide_id as string,
  );
  const reads = await readGuidesAsSystem({
    clinicId: c.clinicId,
    guideIds: ids,
    operation: 'operator_integration',
    service: 'insurance-connector',
    jobId: randomUUID(),
  });
  return reads.map((r) => ({ guideId: r.guideId, revision: r.revision, content: r.content }));
};
const exportIt = async (c: Clinic, batchId: string, d: Parameters<typeof svc.exportBatch>[0] = deps) =>
  svc.exportBatch(d, { clinicId: c.clinicId, batchId, contents: await contentsOf(c, batchId), actorUserId: c.doctorId });
const batchRow = async (id: string) => (await sql`select * from public.hi_batches where id = ${id}::uuid`)[0]!;
const guideStatuses = async (batchId: string) =>
  (
    await sql`select g.status from public.hi_batch_guides bg join public.hi_guides g on g.id = bg.guide_id
       where bg.batch_id = ${batchId}::uuid order by g.number`
  ).map((r) => r.status as string);
const inTenant = <T>(c: Clinic, fn: (tx: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<T>) =>
  withTenant(c.clinicId, fn, c.doctorId);
const audit = { ip: null, userAgent: 'harness', requestId: 'harness-batches' };

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
  const [{ n: lancBefore }] = (await sql`select count(*)::int as n from public.lancamentos`) as unknown as [{ n: number }];

  // ── 1. Uma guia: do lote ao arquivo cifrado, conferido na leitura ─────
  const g1 = await A.approvedGuide();
  const b1 = await create(A, [g1]);
  assert.deepEqual([(await batchRow(b1)).status, await guideStatuses(b1)], ['prepared', ['in_batch']]);
  const e1 = await exportIt(A, b1);
  assert.equal(e1.kind, 'exported');
  const r1 = await batchRow(b1);
  const [file1] = await sql`select * from public.hi_files where id = ${r1.file_id}::uuid`;
  const stored = objects.get(file1!.storage_ref as string)!;
  assert.ok(!Buffer.from(stored).toString('latin1').includes(CARD) && !Buffer.from(stored).toString('latin1').includes('Paciente Sint'));
  const read1 = await inTenant(A, (tx) => svc.readBatchXmlInTx(tx, store, { clinicId: A.clinicId, batchId: b1, userId: A.doctorId, requestContext: audit }));
  const xml1 = read1!.bytes.toString('latin1');
  assert.deepEqual(
    [r1.status, r1.guide_count, r1.item_count, Number(r1.total_value_cents), await guideStatuses(b1), sha(read1!.bytes) === r1.content_sha256,
      xml1.includes(`<ans:numeroLote>${r1.number}</ans:numeroLote>`), xml1.includes(`<ans:hash>${r1.epilogue_hash}</ans:hash>`), xml1.includes(CARD)],
    ['exported', 1, 1, 15000, ['exported'], true, true, true, true],
  );
  const [auditRead] = await sql`select action, after->>'outcome' as outcome from public.audit_events where resource_id = ${file1!.id}`;
  assert.deepEqual([auditRead!.action, auditRead!.outcome], ['health_insurance.batch_file.read', 'granted']);
  pass('lote com 1 guia: XML dos snapshots aprovados passa no XSD oficial (xmllint-wasm), regras, hash e codificação; o arquivo fica CIFRADO (sem carteirinha nem nome em claro), com SHA-256 conferido na leitura e acesso auditado');

  // Adulteração do objeto armazenado: leitura recusada e auditada.
  const tampered = Buffer.from(stored);
  tampered[tampered.length - 5] = (tampered[tampered.length - 5]! + 1) % 256;
  objects.set(file1!.storage_ref as string, tampered);
  await assert.rejects(() => inTenant(A, (tx) => svc.readBatchXmlInTx(tx, store, { clinicId: A.clinicId, batchId: b1, userId: A.doctorId, requestContext: audit })), svc.BatchFileIntegrityError);
  objects.set(file1!.storage_ref as string, stored);
  pass('arquivo adulterado no armazenamento: a leitura confere o SHA-256 do cifrado e recusa (nenhum XML apresentado como emitido sem integridade)');

  // ── 2. Várias guias ─────────────────────────────────────────────────
  const several = [await A.approvedGuide(), await A.approvedGuide(), await A.approvedGuide()];
  const b3 = await create(A, several);
  await exportIt(A, b3);
  const r3 = await batchRow(b3);
  assert.deepEqual([r3.status, r3.guide_count, r3.item_count, Number(r3.total_value_cents)], ['exported', 3, 3, 45000]);
  pass('lote com 3 guias: contagens (3 guias, 3 procedimentos) e total (R$ 450) coerentes entre guias, banco e XML');

  // ── 3. 100 guias e o limite ─────────────────────────────────────────
  const hundred: string[] = [];
  for (let i = 0; i < 101; i++) hundred.push(await A.approvedGuide());
  await rejects('23514', () => create(A, hundred), /de 1 a 100/u);
  const t0 = Date.now();
  const b100 = await create(A, hundred.slice(0, 100));
  await exportIt(A, b100);
  const r100 = await batchRow(b100);
  assert.deepEqual([r100.status, r100.guide_count, Number(r100.total_value_cents)], ['exported', 100, 1500000]);
  pass(`lote com 100 guias exportado e válido no XSD (${Date.now() - t0} ms do lote ao arquivo); 101 guias recusado pelo banco`);

  // ── 4. Misturas e duplicadas ────────────────────────────────────────
  const gOther = await A.approvedGuide(A.ins2);
  const gFree = await A.approvedGuide();
  await rejects('23514', () => create(A, [gFree, gOther]), /operadora/u);
  await rejects('23514', () => create(A, [gFree], { type: 'sp_sadt' }), /tipo/u);
  await rejects('23514', () => create(A, [gFree, gFree]), /mais de uma vez/u);
  await rejects('23505', () => create(A, [gFree, g1]), /outro lote ativo/u);
  await sql`update public.hi_guides set status = 'ready_for_review', transition_note = 'Reaberta para conferir de novo' where id = ${gFree}::uuid`; // reaberta (dono): sai de "aprovada"
  await rejects('23514', () => create(A, [gFree]), /estado/u);
  await assert.rejects(
    async () => {
      const b = await create(A, [await A.approvedGuide()]);
      const contents = await contentsOf(A, b);
      const wrong = contents.map((c) => ({ ...c, content: { ...c.content, tissVersion: '4.01.00' } as never }));
      await svc.exportBatch(deps, { clinicId: A.clinicId, batchId: b, contents: wrong, actorUserId: A.doctorId });
    },
    (e: unknown) => e instanceof svc.BatchExportError && e.layer === 'content',
  );
  pass('mistura recusada: outra operadora, outro tipo de guia, versão TISS diferente no conteúdo, guia repetida no pedido, guia já em lote ativo e guia fora de "aprovada"');

  // ── 5. Exportação concorrente ───────────────────────────────────────
  const bc = await create(A, [await A.approvedGuide(), await A.approvedGuide()]);
  const before = objects.size;
  const results = await Promise.allSettled([exportIt(A, bc), exportIt(A, bc), exportIt(A, bc)]);
  const exportedRuns = results.filter((r) => r.status === 'fulfilled' && r.value.kind === 'exported').length;
  const [{ n: filesBc }] = (await sql`select count(*)::int as n from public.hi_files where batch_id = ${bc}::uuid`) as unknown as [{ n: number }];
  assert.deepEqual([exportedRuns, filesBc, objects.size - before, (await batchRow(bc)).export_count], [1, 1, 1, 1]);
  pass(`exportação concorrente (3 ao mesmo tempo): 1 exporta, as outras não geram nada (${results.filter((r) => r.status === 'rejected').length} recusadas, ${results.filter((r) => r.status === 'fulfilled' && r.value.kind === 'already_exported').length} viram "já exportado"); 1 arquivo e 1 objeto`);

  // ── 6. Falhas: XSD, validador ausente, gravação e compensação ────────
  const bf = await create(A, [await A.approvedGuide()]);
  const txBefore = (await sql`select last_value::int as n from public.hi_counters where clinic_id = ${A.clinicId}::uuid and kind = 'transaction'`)[0]!.n as number;
  await assert.rejects(() => exportIt(A, bf, { store, validateXsd: async () => ({ valid: false, errors: ["Element 'x': 'Fulano' inválido"], engine: 'falso' }) }),
    (e: unknown) => e instanceof svc.BatchExportError && e.layer === 'xsd');
  await assert.rejects(() => exportIt(A, bf, { store, validateXsd: null }), (e: unknown) => e instanceof svc.BatchExportError && e.layer === 'unavailable');
  const objBefore = objects.size;
  faults.put = true;
  await assert.rejects(() => exportIt(A, bf));
  faults.put = false;
  // Falha DEPOIS de gravar o objeto (no banco): a compensação remove o objeto.
  await sql.unsafe(`create or replace function public.harness_file_fault() returns trigger language plpgsql as $f$
    begin raise exception 'falha injetada no hi_files' using errcode = '08006'; end $f$;
    create trigger harness_file_fault before insert on public.hi_files for each row execute function public.harness_file_fault();`);
  await assert.rejects(() => exportIt(A, bf));
  assert.equal(objects.size, objBefore);
  faults.remove = true;
  await assert.rejects(() => exportIt(A, bf));
  faults.remove = false;
  const orphanCount = objects.size - objBefore;
  await sql`drop trigger harness_file_fault on public.hi_files`;
  const rf = await batchRow(bf);
  const txAfter = (await sql`select last_value::int as n from public.hi_counters where clinic_id = ${A.clinicId}::uuid and kind = 'transaction'`)[0]!.n as number;
  const [{ n: filesBf }] = (await sql`select count(*)::int as n from public.hi_files where batch_id = ${bf}::uuid`) as unknown as [{ n: number }];
  assert.deepEqual([rf.status, rf.file_id, filesBf, txAfter, orphanCount], ['prepared', null, 0, txBefore, 1]);
  for (const [ref, bytes] of objects) {
    if (!(await sql`select 1 from public.hi_files where storage_ref = ${ref}`).length) {
      assert.ok(!Buffer.from(bytes).toString('latin1').includes(CARD)); // o órfão é só cifrado
      objects.delete(ref);
    }
  }
  await exportIt(A, bf);
  assert.equal((await batchRow(bf)).status, 'exported');
  pass('falhas: XSD reprovado, validador ausente, gravação do arquivo e banco caindo depois da gravação → o lote continua "preparado", sem arquivo, sem número de transação consumido; a compensação remove o objeto; se ela falhar, sobra só um objeto cifrado sem referência (métrica), nunca um "exportado" sem arquivo; corrigido, exporta');

  // ── 7. Reprocessamento antes do envio ──────────────────────────────
  const rr0 = await batchRow(bf);
  await rejects('23514', () => inTenant(A, (tx) => svc.reopenBatchInTx(tx, { clinicId: A.clinicId, batchId: bf, version: rr0.version as number, note: 'curto' })));
  await inTenant(A, (tx) => svc.reopenBatchInTx(tx, { clinicId: A.clinicId, batchId: bf, version: rr0.version as number, note: 'Operadora pediu novo sequencial de transação' }));
  assert.deepEqual([(await batchRow(bf)).status, await guideStatuses(bf)], ['prepared', ['in_batch']]);
  await exportIt(A, bf);
  const rr1 = await batchRow(bf);
  const chain = await sql`select id, supersedes_file_id from public.hi_files where batch_id = ${bf}::uuid order by created_at`;
  assert.deepEqual([rr1.status, rr1.export_count, chain.length, chain[1]!.supersedes_file_id, rr1.file_id], ['exported', 2, 2, chain[0]!.id, chain[1]!.id]);
  pass('reprocessamento antes do envio: com motivo, o lote volta a "preparado" e reexporta; o XML novo SUBSTITUI o anterior na cadeia de versões (o anterior fica, imutável)');

  // ── 8. Envio, reenvio, protocolo, análise, retorno, processado ──────
  const s0 = await batchRow(b1);
  await rejects('23514', () => inTenant(A, (tx) => svc.markBatchSentInTx(tx, { clinicId: A.clinicId, batchId: b1, version: s0.version as number, channel: 'manual', sentOn: '2026-11-11', evidence: 'curto' })));
  await rejects('42501', () => withTenant(A.clinicId, (tx) => svc.markBatchSentInTx(tx, { clinicId: A.clinicId, batchId: b1, version: s0.version as number, channel: 'manual', sentOn: '2026-11-11', evidence: 'Enviado pelo portal da operadora' })));
  await rejects('55000', () => inTenant(A, (tx) => svc.recordBatchProtocolInTx(tx, { clinicId: A.clinicId, batchId: b1, version: s0.version as number, protocol: 'P-1', receivedOn: '2026-11-11', evidenceSha256: sha('p') })), /enviado/u);
  let ver = await inTenant(A, (tx) => svc.markBatchSentInTx(tx, { clinicId: A.clinicId, batchId: b1, version: s0.version as number, channel: 'manual', sentOn: '2026-11-11', evidence: 'Enviado pelo portal da operadora, comprovante 1' }));
  ver = await inTenant(A, (tx) => svc.markBatchSentInTx(tx, { clinicId: A.clinicId, batchId: b1, version: ver, channel: 'manual', sentOn: '2026-11-11', evidence: 'Reenviado pelo portal: a operadora pediu de novo' }));
  const sent = await batchRow(b1);
  assert.deepEqual([sent.status, sent.send_count, await guideStatuses(b1)], ['sent', 2, ['sent']]);
  await rejects('55000', () => inTenant(A, (tx) => svc.cancelBatchInTx(tx, { clinicId: A.clinicId, batchId: b1, version: ver, reason: 'Tentativa de cancelar depois do envio' })), /enviado/u);
  ver = await inTenant(A, (tx) => svc.recordBatchProtocolInTx(tx, { clinicId: A.clinicId, batchId: b1, version: ver, protocol: 'PROT-2026-001', receivedOn: '2026-11-11', evidenceSha256: sha('recibo-1') }));
  const protocolVersion = ver;
  const again = await inTenant(A, (tx) => svc.recordBatchProtocolInTx(tx, { clinicId: A.clinicId, batchId: b1, version: null, protocol: 'PROT-2026-001', receivedOn: '2026-11-11', evidenceSha256: sha('recibo-1') }));
  await rejects('55000', () => inTenant(A, (tx) => svc.recordBatchProtocolInTx(tx, { clinicId: A.clinicId, batchId: b1, version: null, protocol: 'PROT-OUTRO', receivedOn: '2026-11-11', evidenceSha256: sha('x') })), /já tem o protocolo/u);
  // O mesmo protocolo em outro lote da MESMA operadora: recusado; noutra operadora seria outro número dela.
  const s3 = await batchRow(b3);
  const v3 = await inTenant(A, (tx) => svc.markBatchSentInTx(tx, { clinicId: A.clinicId, batchId: b3, version: s3.version as number, channel: 'manual', sentOn: '2026-11-11', evidence: 'Enviado pelo portal da operadora, comprovante 2' }));
  await rejects('23505', () => inTenant(A, (tx) => svc.recordBatchProtocolInTx(tx, { clinicId: A.clinicId, batchId: b3, version: v3, protocol: 'PROT-2026-001', receivedOn: '2026-11-11', evidenceSha256: sha('recibo-2') })));
  await rejects('55000', () => inTenant(A, (tx) => svc.markBatchProcessedInTx(tx, { clinicId: A.clinicId, batchId: b1, version: ver })), /análise/u);
  ver = await inTenant(A, (tx) => svc.markBatchUnderReviewInTx(tx, { clinicId: A.clinicId, batchId: b1, version: ver }));
  await rejects('23514', () => inTenant(A, (tx) => svc.markBatchProcessedInTx(tx, { clinicId: A.clinicId, batchId: b1, version: ver })), /retorno/u);
  const ret1 = await inTenant(A, (tx) => svc.recordBatchReturnInTx(tx, { clinicId: A.clinicId, batchId: b1, kind: 'analysis_statement', contentSha256: sha('demonstrativo-1'), receivedOn: '2026-11-20' }));
  const ret2 = await inTenant(A, (tx) => svc.recordBatchReturnInTx(tx, { clinicId: A.clinicId, batchId: b1, kind: 'analysis_statement', contentSha256: sha('demonstrativo-1'), receivedOn: '2026-11-20' }));
  const [{ n: returns }] = (await sql`select count(*)::int as n from public.hi_batch_returns where batch_id = ${b1}::uuid and kind = 'analysis_statement'`) as unknown as [{ n: number }];
  const [{ n: retEvents }] = (await sql`select count(*)::int as n from public.hi_batch_events where batch_id = ${b1}::uuid and action = 'return_recorded'`) as unknown as [{ n: number }];
  const verNow = (await batchRow(b1)).version as number;
  await inTenant(A, (tx) => svc.markBatchProcessedInTx(tx, { clinicId: A.clinicId, batchId: b1, version: verNow }));
  const done = await batchRow(b1);
  const actions = (await sql`select action from public.hi_batch_events where batch_id = ${b1}::uuid order by created_at`).map((r) => r.action);
  assert.deepEqual(
    [again === protocolVersion, ret1 === ret2, returns, retEvents, done.status, done.protocol_number, await guideStatuses(b1)],
    [true, true, 1, 1, 'processed', 'PROT-2026-001', ['under_review']],
  );
  assert.deepEqual(actions, ['created', 'validated', 'exported', 'sent', 'resent', 'protocol_recorded', 'under_review', 'return_recorded', 'processed']);
  pass('estados com prova: "enviado" só com registro, autor e evidência (exportar não envia); reenvio rastreado; "recebido" só com protocolo, que é idempotente, não troca e não serve a outro lote da operadora; "processado" só com retorno; o MESMO retorno registrado 2× entra uma vez; histórico completo');

  // ── 9. Cancelamento e substituição ─────────────────────────────────
  const c0 = await batchRow(bc);
  await rejects('42501', () => withTenant(A.clinicId, (tx) => svc.cancelBatchInTx(tx, { clinicId: A.clinicId, batchId: bc, version: c0.version as number, reason: 'Sem usuário autenticado' })));
  await inTenant(A, (tx) => svc.cancelBatchInTx(tx, { clinicId: A.clinicId, batchId: bc, version: c0.version as number, reason: 'Operadora mudou o prazo de envio do lote' }));
  const cancelled = await batchRow(bc);
  const freed = (await sql`select guide_id from public.hi_batch_guides where batch_id = ${bc}::uuid`).map((r) => r.guide_id as string);
  assert.deepEqual([cancelled.status, await guideStatuses(bc)], ['cancelled', ['approved', 'approved']]);
  await rejects('23514', () => create(A, freed, { replaces: b3 }), /cancelado/u);
  const bsub = await create(A, freed, { replaces: bc });
  await exportIt(A, bsub);
  assert.deepEqual([(await batchRow(bsub)).status, (await batchRow(bsub)).replaces_batch_id], ['exported', bc]);
  pass('cancelamento só antes do envio e por um usuário: as guias voltam a "aprovada" e o arquivo do lote cancelado fica; o lote substituto (ligado ao cancelado) reúne as mesmas guias; substituir lote não cancelado é recusado');

  // ── 10. A guia não muda depois de entrar no lote ────────────────────
  await rejects('55000', () => inTenant(A, (tx) => tx.execute(sqlTag`update public.hi_guides set total_value_cents = 1 where id = ${freed[0]!}::uuid`)), /conferida não se edita/u);
  await rejects('55000', () => inTenant(A, (tx) => tx.execute(sqlTag`update public.hi_guides set status = 'ready_for_review', transition_note = 'Reabrir depois do lote' where id = ${freed[0]!}::uuid`)));
  pass('guia em lote não se edita nem reabre pelo runtime: o faturamento só muda por revisão/substituição controlada');

  // ── 11. Runtime sem escrita direta; outra clínica não age; RLS ──────
  await rejects('42501', () => inTenant(A, (tx) => tx.execute(sqlTag`update public.hi_batches set status = 'processed' where id = ${bsub}::uuid`)));
  await rejects('42501', () => inTenant(A, (tx) => tx.execute(sqlTag`insert into public.hi_batch_returns (clinic_id, batch_id, insurer_id, kind, content_sha256, received_on)
    values (${A.clinicId}::uuid, ${bsub}::uuid, ${A.ins1}::uuid, 'analysis_statement', ${sha('x')}, '2026-11-11')`)));
  await rejects('42501', () => withTenant(B.clinicId, (tx) => svc.cancelBatchInTx(tx, { clinicId: A.clinicId, batchId: bsub, version: 1, reason: 'Clínica B tentando cancelar lote da A' }), B.doctorId), /sessão/u);
  const seenByB = await withTenant(B.clinicId, (tx) => tx.select().from(hiBatches));
  assert.equal(seenByB.length, 0);
  const crossRead = await withTenant(B.clinicId, (tx) => svc.readBatchXmlInTx(tx, store, { clinicId: B.clinicId, batchId: bsub, userId: B.doctorId, requestContext: audit }));
  assert.equal(crossRead, null);
  pass('runtime não escreve nas tabelas do lote (só pelas funções); a função recusa clínica fora da sessão; a clínica B não vê lote nem lê o XML da A');

  // ── 12. Nenhum efeito financeiro ────────────────────────────────────
  const [{ n: lancAfter }] = (await sql`select count(*)::int as n from public.lancamentos`) as unknown as [{ n: number }];
  assert.equal(lancAfter, lancBefore);
  pass('nenhum lançamento financeiro criado em todo o ciclo de lotes (exportar, reexportar, enviar, reenviar, retorno duplicado): o recebível da operadora é da P10.2');

  // ── 13. Assinatura cai (D24, 0151): fatos do trabalho entregue entram; operação nova, não ──
  const gLate = await A.approvedGuide();
  const bPrepared = await create(A, [gLate]);
  await sql`update public.subscriptions set billing_status = 'cancelled' where clinic_id = ${A.clinicId}::uuid`;
  const premium = (e: unknown) => {
    assert.ok(e instanceof PremiumAccessError, String((e as Error)?.message));
    assert.equal(e.reason, 'subscription_cancelled');
    return true;
  };
  await assert.rejects(() => create(A, [randomUUID()]), premium);
  await assert.rejects(() => exportIt(A, bPrepared), premium);
  const s3b = await batchRow(b3);
  await assert.rejects(
    () => inTenant(A, (tx) => svc.markBatchSentInTx(tx, { clinicId: A.clinicId, batchId: b3, version: s3b.version as number, channel: 'manual', sentOn: '2026-11-12', evidence: 'Reenvio depois do cancelamento da assinatura' })),
    premium,
  );
  // Direto no banco (como a API faria): validar o lote preparado também é barrado pelo gatilho.
  const okValidation = JSON.stringify({ xsd: 'valid', internal: 'valid', hash: 'valid', encoding: 'valid', guides: 1, items: 1 });
  await assert.rejects(
    () => inTenant(A, (tx) => tx.execute(sqlTag`select public.hi_batch_validate(${A.clinicId}::uuid, ${bPrepared}::uuid, NULL, '9', ${'d'.repeat(64)}, ${'e'.repeat(32)}, ${okValidation}::jsonb)`)),
    (e: unknown) => premiumAccessErrorFrom(e)?.reason === 'subscription_cancelled',
  );
  // O lote já ENVIADO continua recebendo os fatos da operadora (perder isso seria perder dado financeiro).
  let v3b = await inTenant(A, (tx) => svc.recordBatchProtocolInTx(tx, { clinicId: A.clinicId, batchId: b3, version: s3b.version as number, protocol: 'PROT-2026-002', receivedOn: '2026-11-12', evidenceSha256: sha('recibo-3') }));
  v3b = await inTenant(A, (tx) => svc.markBatchUnderReviewInTx(tx, { clinicId: A.clinicId, batchId: b3, version: v3b }));
  await inTenant(A, (tx) => svc.recordBatchReturnInTx(tx, { clinicId: A.clinicId, batchId: b3, kind: 'analysis_statement', contentSha256: sha('demonstrativo-3'), receivedOn: '2026-11-25' }));
  await inTenant(A, (tx) => svc.markBatchProcessedInTx(tx, { clinicId: A.clinicId, batchId: b3, version: v3b }));
  // Leitura do XML já emitido continua (auditada) e o lote preparado continua lá, intacto.
  const lateRead = await inTenant(A, (tx) => svc.readBatchXmlInTx(tx, store, { clinicId: A.clinicId, batchId: b1, userId: A.doctorId, requestContext: audit }));
  assert.ok(lateRead && lateRead.bytes.length > 0);
  assert.deepEqual([(await batchRow(b3)).status, (await batchRow(bPrepared)).status], ['processed', 'prepared']);
  // Regularizada a assinatura, o lote preparado exporta.
  await sql`update public.subscriptions set billing_status = 'active' where clinic_id = ${A.clinicId}::uuid`;
  const eLate = await exportIt(A, bPrepared);
  assert.equal(eLate.kind, 'exported');
  pass('assinatura cancelada: lote novo, exportação, validação direta no banco e envio são barrados com a mensagem comercial; protocolo, análise, retorno e processado do lote JÁ ENVIADO entram; o XML emitido continua legível (auditado); nada é apagado; regularizada, o lote preparado exporta');

  console.log(`\nOK — ${passed}/14 provas da P1.9 (0150) em Postgres descartável, XSD oficial pelo xmllint-wasm.`);
} finally {
  await cluster.stop();
}
