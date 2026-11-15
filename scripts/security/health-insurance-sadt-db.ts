/**
 * SP/SADT automática e solicitação persistida (P8.7, P6.2; 0156) em Postgres DESCARTÁVEL
 * (cadeia na ordem do DEV: main → #53 0136–0142 → #55). Nunca no DEV compartilhado; só
 * dados sintéticos.
 *
 * O caminho é o real: solicitação → conferência (contrato, TUSS, número) → pedido à
 * operadora / dispensa → resposta registrada com evidência → atendimento ligado ao item →
 * conclusão pelo Scheduling → outbox → handler → sessão na guia SP/SADT (consumo da
 * autorização uma vez) → conferência → emissão (snapshot cifrado, regras TISS) → lote →
 * XML validado no XSD oficial.
 *
 *   TISS_XMLLINT_WASM_DIR=… NODE_OPTIONS="--import ./scripts/security/server-only-hook.mjs" npx tsx --tsconfig tsconfig.scripts.json scripts/security/health-insurance-sadt-db.ts
 *   (sem `--conditions=react-server`: o PDF da prova 10 usa o @react-pdf como no runtime; ver o hook)
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema, credentialAllPlans } from './scratch-schema';

const chain = await readDevOrderChain();
const cluster = await startScratchSchema({ port: 55522, maxConnections: 16, migrations: chain });
const { sql } = cluster;
if (!/@(?:127\.0\.0\.1|localhost):55522\//u.test(cluster.url)) throw new Error('não é o cluster local');
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
const req = await import('../../src/contexts/health-insurance/internal/sadt-request-service');
const { issueSpSadtGuide } = await import('../../src/contexts/health-insurance/internal/sadt-issuance');
const { processInsuranceBilling } = await import('../../src/contexts/health-insurance/internal/billing-recovery');
const { loadXmllintValidator } = await import('../../src/contexts/health-insurance/tiss/xml/xsd-validator');
const { loadHiFixtures, SYNTHETIC_CARD, SYS_ACTOR } = await import('./hi-fixtures');

const xsd = loadXmllintValidator();
if (!xsd) throw new Error('validador XSD do app indisponível (TISS_XMLLINT_WASM_DIR fora do CI)');
const objects = new Map<string, Uint8Array>();
const store = {
  async put(ref: string, bytes: Uint8Array) { objects.set(ref, bytes); },
  async get(ref: string) { return objects.get(ref)!; },
  async remove(ref: string) { objects.delete(ref); },
};
const fx = await loadHiFixtures(sql, { store, validateXsd: xsd });
type Clinic = Awaited<ReturnType<typeof fx.setupClinic>>;

let passed = 0;
const pass = (msg: string) => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};
const CODE_IND = '50000470';
const CODE_GRP = '50000462';

/** Contrato SP/SADT de um código, com janela de vigência. */
async function sadtContract(c: Clinic, code: string, cents: number, opts: { requiresAuth?: boolean; from?: string; until?: string | null } = {}) {
  const [l] = await sql`insert into public.hi_procedure_contracts (clinic_id, insurer_id, guide_type, table_code, procedure_code, description,
      unit_value_cents, valid_from, valid_until, requires_authorization, copay_kind, created_by)
    values (${c.clinicId}::uuid, ${c.insurerId}::uuid, 'sp_sadt', '22', ${code}, ${code === CODE_IND ? 'Sessão de psicoterapia individual' : 'Sessão de psicoterapia em grupo'},
      ${cents}, ${opts.from ?? '2026-01-01'}, ${opts.until ?? null}, ${opts.requiresAuth ?? false}, 'none', ${SYS_ACTOR}::uuid) returning id`;
  return l!.id as string;
}
async function patientWithCard(c: Clinic, label: string) {
  const [p] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
    values (${c.clinicId}::uuid, ${`Paciente ${label}`}, 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`;
  const [m] = await sql`insert into public.hi_memberships (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
    values (${c.clinicId}::uuid, ${p!.id}::uuid, ${c.insurerId}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${randomUUID().replace(/-/g, '').padEnd(64, '0')}, '2345', ${SYS_ACTOR}::uuid) returning id`;
  return { patientId: p!.id as string, membershipId: m!.id as string };
}
const asUser = <T>(c: Clinic, fn: Parameters<typeof withTenant<T>>[1]) => withTenant(c.clinicId, fn, c.doctorId);
const version = async (requestId: string) => Number((await sql`select version from public.hi_sadt_requests where id = ${requestId}::uuid`)[0]!.version);

async function createRequest(c: Clinic, pt: { patientId: string; membershipId: string }, items: Array<{ code: string; quantity: number }>, over: Record<string, unknown> = {}) {
  const { requestId } = await asUser(c, (tx) =>
    req.createSadtRequestInTx(tx, {
      clinicId: c.clinicId,
      patientId: pt.patientId,
      membershipId: pt.membershipId,
      requester: { kind: 'internal', professionalId: c.doctorId },
      requestedOn: '2026-11-01',
      careCharacter: '1',
      careType: '03',
      items: items.map((i) => ({ tableCode: '22', procedureCode: i.code, quantity: i.quantity })),
      actorUserId: c.doctorId,
      ...over,
    } as Parameters<typeof req.createSadtRequestInTx>[1]),
  );
  return requestId;
}
const check = async (c: Clinic, requestId: string) =>
  asUser(c, async (tx) => req.checkSadtRequestInTx(tx, { clinicId: c.clinicId, requestId, version: await version(requestId), actorUserId: c.doctorId }));
const itemsOf = async (requestId: string) =>
  sql`select id, procedure_code, quantity_requested, authorization_item_id, contract_line_id, status from public.hi_sadt_request_items where request_id = ${requestId}::uuid order by sequence`;
async function authorize(c: Clinic, requestId: string, quantities: number[], over: Record<string, unknown> = {}) {
  const items = await itemsOf(requestId);
  return asUser(c, async (tx) =>
    req.recordSadtAuthorizationInTx(tx, {
      decision: 'authorized',
      clinicId: c.clinicId,
      requestId,
      version: await version(requestId),
      authorizedOn: '2026-11-02',
      operatorGuideNumber: `OP${Math.floor(Math.random() * 1e8)}`,
      password: 'SENHA987',
      passwordValidUntil: '2026-12-31',
      items: items.map((it, i) => ({ requestItemId: it.id as string, quantityAuthorized: quantities[i] ?? 0 })),
      actorUserId: c.doctorId,
      ...over,
    } as Parameters<typeof req.recordSadtAuthorizationInTx>[1]),
  );
}

const perDay = new Map<string, number>();
/** Atendimento de convênio ligado a um item da solicitação; `complete` conclui pelo Scheduling. */
async function session(c: Clinic, pt: { patientId: string; membershipId: string }, itemId: string, day: string, professionalId = c.doctorId) {
  const n = (perDay.get(day) ?? 0) + 1;
  perDay.set(day, n);
  const [proc] = await sql`select id from public.procedures where clinic_id = ${c.clinicId}::uuid limit 1`;
  const [a] = await sql`insert into public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
      snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via, billing_mode)
    values (${c.clinicId}::uuid, ${professionalId}::uuid, ${pt.patientId}::uuid, ${proc!.id}::uuid, ${`${day}T03:00:00Z`}::timestamptz + ${n} * interval '55 minutes', 50, 'agendado', 120,
      'Psicoterapia', 120, 50, 'Profissional sintético', 'attendant', 'convenio') returning id`;
  const appointmentId = a!.id as string;
  await asUser(c, (tx) =>
    recordAppointmentCoverage(tx, {
      clinicId: c.clinicId, appointmentId, patientId: pt.patientId, procedureId: proc!.id as string, appointmentDate: day,
      guideType: 'sp_sadt', insurerId: c.insurerId, planId: null, membershipId: pt.membershipId, authorizationId: null,
      sadtRequestItemId: itemId, actor: { kind: 'user', userId: c.doctorId },
    }),
  );
  return appointmentId;
}
async function complete(c: Clinic, appointmentId: string, patientId: string, professionalId = c.doctorId, drain = true) {
  await sql`update public.appointments set status = 'em_atendimento' where id = ${appointmentId}::uuid`;
  await sql`insert into public.prontuarios (clinic_id, patient_id, doctor_id, appointment_id, status, signed_at, signed_by, content_encrypted)
    values (${c.clinicId}::uuid, ${patientId}::uuid, ${professionalId}::uuid, ${appointmentId}::uuid, 'assinado', now(), ${professionalId}::uuid, 'ciphertext-sintetico')`;
  await withTenant(c.clinicId, (tx) => applyTransition(tx, {
    clinicId: c.clinicId, appointmentId, target: 'atendido', transitionedBy: professionalId, actorType: 'user',
    clientKey: `concluir-${appointmentId}`, correlationId: null,
  }), professionalId);
  if (drain) for (let i = 0; i < 4; i++) await runOutboxOnce({ batchSize: 50, parallelism: 1 });
}
const guidesOfRequest = async (requestId: string) =>
  sql`select g.id, g.number, g.status, g.total_value_cents::int as total, g.executant_professional_id,
        (select count(*)::int from public.hi_guide_items i where i.guide_id = g.id) as items
      from public.hi_guides g
     where g.guide_type = 'sp_sadt' and exists (
       select 1 from public.hi_guide_items i join public.hi_appointment_coverages c on c.clinic_id = i.clinic_id and c.appointment_id = i.appointment_id
         join public.hi_sadt_request_items ri on ri.id = c.sadt_request_item_id where i.guide_id = g.id and ri.request_id = ${requestId}::uuid)
     order by g.created_at`;
const gapOf = async (appointmentId: string) =>
  (await sql`select reason, owner, recovery, status, issues from public.hi_billing_gaps where appointment_id = ${appointmentId}::uuid`)[0] ?? null;
const consumed = async (authItemId: string) =>
  Number((await sql`select quantity_consumed from public.hi_authorization_items where id = ${authItemId}::uuid`)[0]!.quantity_consumed);
const review = (c: Clinic, guideId: string) =>
  asUser(c, async (tx) => {
    const [g] = await sql`select version from public.hi_guides where id = ${guideId}::uuid`;
    await tx.execute(fx.sqlTag`UPDATE public.hi_guides SET status = 'reviewed', reviewed_by = ${c.doctorId}::uuid
      WHERE clinic_id = ${c.clinicId}::uuid AND id = ${guideId}::uuid AND version = ${g!.version}`);
  });
const issue = (c: Clinic, guideId: string, membershipId: string) =>
  asUser(c, (tx) => issueSpSadtGuide(tx, {
    clinicId: c.clinicId, guideId, card: { membershipId, cardNumber: SYNTHETIC_CARD, auditEventId: randomUUID() },
    newborn: false, professionalName: 'Dra. Sintética', actorUserId: c.doctorId, today: '2026-11-12',
  }));

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  await sql`insert into public.tiss_terms (version_id, table_code, code, term, starts_on)
    select v.id, t.table_code, t.code, t.term, '2010-01-01' from public.tiss_terminology_versions v,
      (values ('22', ${CODE_IND}, 'Sessão de psicoterapia individual'), ('22', ${CODE_GRP}, 'Sessão de psicoterapia em grupo'),
              ('23', '1', 'Eletiva'), ('23', '2', 'Urgência/Emergência'), ('50', '03', 'Outras terapias')) t(table_code, code, term)
     where v.version = '202609'`;

  // ── 1. Um procedimento, contrato SEM autorização: pronta → sessão → guia → emissão → XML ──
  const A = await fx.setupClinic('SP/SADT A');
  await sql`update public.procedures set descricao = 'Psicoterapia' where clinic_id = ${A.clinicId}::uuid`;
  await sadtContract(A, CODE_IND, 12000);
  const p1 = await patientWithCard(A, 'um');
  const r1 = await createRequest(A, p1, [{ code: CODE_IND, quantity: 2 }]);
  const c1 = await check(A, r1);
  assert.equal(c1.kind, 'ready');
  const [i1] = await itemsOf(r1);
  const ap1 = await session(A, p1, i1!.id as string, '2026-11-03');
  await complete(A, ap1, p1.patientId);
  const g1 = await guidesOfRequest(r1);
  assert.deepEqual(g1.map((g) => [g.status, g.items, g.total]), [['ready_for_review', 1, 12000]]);
  // indicação clínica exigida para "outras terapias" (03): a emissão aponta ao médico, nunca inventa.
  await review(A, g1[0]!.id as string);
  await assert.rejects(() => issue(A, g1[0]!.id as string, p1.membershipId), (e: { issues?: Array<{ owner: string; field: string }> }) =>
    (e.issues ?? []).some((i) => i.owner === 'medico' && /indicacaoClinica/u.test(i.field)));
  await assert.rejects(
    () => asUser(A, async (tx) => req.setClinicalIndicationInTx(tx, { clinicId: A.clinicId, requestId: r1, version: await version(r1), text: 'texto de outro usuário', actorUserId: randomUUID() })),
    /profissional solicitante/u,
  );
  await asUser(A, async (tx) => req.setClinicalIndicationInTx(tx, { clinicId: A.clinicId, requestId: r1, version: await version(r1), text: 'Ansiedade generalizada, psicoterapia semanal.', actorUserId: A.doctorId }));
  const [stored] = await sql`select clinical_indication_encrypted as enc from public.hi_sadt_requests where id = ${r1}::uuid`;
  assert.ok(!String(stored!.enc).includes('Ansiedade'), 'indicação cifrada no banco');
  pass('1a. sem autorização exigida: solicitação pronta, sessão concluída vira guia SP/SADT pronta para conferência (R$ 120,00); a emissão de "outras terapias" sem indicação clínica é barrada com pendência do MÉDICO; outro usuário não informa a indicação; o solicitante informa (cifrada no banco)');

  // A guia conferida foi emitida? Não: a emissão falhou e desfez tudo; ela segue conferida.
  const [g1now] = await sql`select status from public.hi_guides where id = ${g1[0]!.id}::uuid`;
  assert.equal(g1now!.status, 'reviewed');
  const issued = await issue(A, g1[0]!.id as string, p1.membershipId);
  assert.match(issued.sha256, /^[0-9a-f]{64}$/u);
  const [snap] = await sql`select content_encrypted from public.hi_guide_snapshots where id = ${issued.snapshotId}::uuid`;
  assert.ok(!String(snap!.content_encrypted).includes('Ansiedade') && !String(snap!.content_encrypted).includes(SYNTHETIC_CARD));
  const batchId = await fx.createBatch(A, [g1[0]!.id as string], { guideType: 'sp_sadt' });
  const out = await fx.exportBatch(A, batchId);
  assert.equal(out.kind, 'exported');
  const [xmlFile] = await sql`select count(*)::int as n from public.hi_files where kind = 'batch_xml' and batch_id = ${batchId}::uuid`;
  assert.equal(xmlFile!.n, 1);
  pass('1b. emissão com a indicação do solicitante e as regras TISS (snapshot cifrado, sem indicação nem carteirinha em claro) → lote → XML SP/SADT validado no XSD oficial e guardado');

  // ── 2. Vários procedimentos, autorização exigida e PARCIAL ──────────
  const B = await fx.setupClinic('SP/SADT B');
  await sadtContract(B, CODE_IND, 10000, { requiresAuth: true });
  await sadtContract(B, CODE_GRP, 6000, { requiresAuth: true });
  const p2 = await patientWithCard(B, 'dois');
  const r2 = await createRequest(B, p2, [{ code: CODE_IND, quantity: 4 }, { code: CODE_GRP, quantity: 2 }]);
  const c2 = await check(B, r2);
  assert.equal(c2.kind, 'awaiting_authorization');
  const [i2a, i2b] = await itemsOf(r2);
  // sessão antes da resposta: pendência automática, sem guia e sem consumo
  const ap2pending = await session(B, p2, i2a!.id as string, '2026-11-03');
  await complete(B, ap2pending, p2.patientId);
  const gapPending = await gapOf(ap2pending);
  assert.deepEqual([gapPending?.reason, gapPending?.recovery, (await guidesOfRequest(r2)).length], ['authorization_pending', 'automatic', 0]);
  // autorização sem evidência é recusada; com evidência, parcial (2 de 4, 0 de 2 no grupo)
  await assert.rejects(() => authorize(B, r2, [2, 0], { operatorGuideNumber: null, password: null, operatorProtocol: null }), /evidência/u);
  const auth2 = await authorize(B, r2, [2, 0]);
  assert.equal(auth2.status, 'partially_authorized');
  await assert.rejects(
    () => asUser(B, async (tx) => req.setClinicalIndicationInTx(tx, { clinicId: B.clinicId, requestId: r2, version: await version(r2), text: 'Texto depois da resposta.', actorUserId: B.doctorId })),
    /depois da resposta/u,
  );
  // a resposta chega: o reprocessamento gera a guia e consome UMA vez
  await withTenant(B.clinicId, (tx) => processInsuranceBilling(tx, { clinicId: B.clinicId, appointmentId: ap2pending, detectedBy: 'reconcile', eventState: 'processed', lock: 'wait' }));
  assert.equal(await consumed(i2a!.authorization_item_id as string), 1);
  const ap2b = await session(B, p2, i2a!.id as string, '2026-11-05');
  await complete(B, ap2b, p2.patientId);
  const ap2c = await session(B, p2, i2a!.id as string, '2026-11-06');
  await complete(B, ap2c, p2.patientId);
  const gapExhausted = await gapOf(ap2c);
  assert.deepEqual([gapExhausted?.reason, (gapExhausted?.issues as Array<{ code: string }>)[0]?.code], ['authorization_pending', 'SADT_QUANTITY_EXHAUSTED']);
  assert.equal(await consumed(i2a!.authorization_item_id as string), 2);
  // item do grupo com 0 autorizado: nenhuma sessão passa
  const ap2g = await session(B, p2, i2b!.id as string, '2026-11-06');
  await complete(B, ap2g, p2.patientId);
  assert.equal((await gapOf(ap2g))?.reason, 'authorization_pending');
  assert.equal(await consumed(i2b!.authorization_item_id as string), 0);
  pass('2. vários procedimentos com autorização exigida: sessão antes da resposta vira pendência automática (sem guia, sem consumo); autorização sem evidência é recusada; parcial (2 de 4; 0 de 2) consome uma vez por sessão; a 3ª sessão e o item não autorizado viram pendência "saldo esgotado", nunca guia');

  // ── 3. Reprocessamento e reentrega: nada duplica ─────────────────────
  for (let k = 0; k < 3; k++) {
    await withTenant(B.clinicId, (tx) => processInsuranceBilling(tx, { clinicId: B.clinicId, appointmentId: ap2b, detectedBy: 'event', eventState: 'processed', lock: 'wait' }));
  }
  await sql`update public.outbox set status = 'pending', next_attempt_at = now() where clinic_id = ${B.clinicId}::uuid and event_type = 'scheduling.appointment.insurance_completed'`.catch(() => undefined);
  for (let i = 0; i < 3; i++) await runOutboxOnce({ batchSize: 50, parallelism: 1 });
  const [{ live }] = (await sql`select count(*)::int as live from public.hi_guide_items i join public.hi_appointment_coverages c on c.appointment_id = i.appointment_id
      where c.sadt_request_item_id = ${i2a!.id}::uuid and i.live`) as unknown as [{ live: number }];
  assert.deepEqual([live, await consumed(i2a!.authorization_item_id as string)], [2, 2]);
  pass('3. reprocessamento (3×) e reentrega do evento: as 2 sessões seguem em uma guia cada, consumo 2 (nenhuma sessão nem consumo duplicado)');

  // ── 4. Agrupamento por solicitação, datas e contrato que muda no meio ─
  const C = await fx.setupClinic('SP/SADT C');
  await sql`update public.hi_insurers set sadt_grouping = 'per_request' where id = ${C.insurerId}::uuid`;
  await sadtContract(C, CODE_IND, 10000, { until: '2026-11-05' });
  await sadtContract(C, CODE_IND, 12500, { from: '2026-11-06' });
  const p4 = await patientWithCard(C, 'quatro');
  const r4 = await createRequest(C, p4, [{ code: CODE_IND, quantity: 4 }]);
  await check(C, r4);
  const [i4] = await itemsOf(r4);
  for (const day of ['2026-11-03', '2026-11-05', '2026-11-09']) {
    const ap = await session(C, p4, i4!.id as string, day);
    await complete(C, ap, p4.patientId);
  }
  let g4 = await guidesOfRequest(r4);
  assert.deepEqual(g4.map((g) => [g.items, g.total]), [[3, 10000 + 10000 + 12500]]);
  const prices = await sql`select executed_on::text, unit_value_cents::int from public.hi_guide_items where guide_id = ${g4[0]!.id}::uuid order by sequence`;
  assert.deepEqual(prices.map((p) => [p.executed_on, p.unit_value_cents]), [['2026-11-03', 10000], ['2026-11-05', 10000], ['2026-11-09', 12500]]);
  // outro profissional: outra guia (o executante da guia é um só)
  const otherDoc = randomUUID();
  await sql`insert into auth.users (id, email) values (${otherDoc}::uuid, ${`${otherDoc}@example.invalid`})`;
  await sql`insert into public.profiles (id, clinic_id, nome, role, ativo) values (${otherDoc}::uuid, ${C.clinicId}::uuid, 'Dr. Outro Sintético', 'doctor', true)`;
  await sql`insert into public.hi_professional_profiles (clinic_id, professional_id, council, council_number, council_uf, cbo)
    values (${C.clinicId}::uuid, ${otherDoc}::uuid, '06', '54321', '35', '225125')`;
  // P2.2: o segundo médico também precisa estar habilitado na operadora (PJ).
  await credentialAllPlans(sql, C.clinicId);
  const apOther = await session(C, p4, i4!.id as string, '2026-11-10', otherDoc);
  await complete(C, apOther, p4.patientId, otherDoc);
  g4 = await guidesOfRequest(r4);
  assert.deepEqual(g4.map((g) => g.items), [3, 1]);
  assert.notEqual(g4[0]!.executant_professional_id, g4[1]!.executant_professional_id);
  // conferida, a guia aberta fecha: a próxima sessão abre outra
  await review(C, g4[0]!.id as string);
  pass('4. agrupamento por solicitação (regra da operadora): 3 sessões em datas diferentes numa guia, cada uma pelo contrato vigente NA SUA DATA (100,00; 100,00; 125,00); sessão de outro profissional vai para outra guia');

  // ── 5. Uma guia por sessão (padrão) e execução parcial ───────────────
  const r5 = await createRequest(A, p1, [{ code: CODE_IND, quantity: 5 }], { careType: '03' });
  await asUser(A, async (tx) => req.setClinicalIndicationInTx(tx, { clinicId: A.clinicId, requestId: r5, version: await version(r5), text: 'Indicação informada pela profissional.', actorUserId: A.doctorId }));
  await check(A, r5);
  const [i5] = await itemsOf(r5);
  for (const day of ['2026-11-06', '2026-11-07']) {
    const ap = await session(A, p1, i5!.id as string, day);
    await complete(A, ap, p1.patientId);
  }
  const g5 = await guidesOfRequest(r5);
  assert.deepEqual(g5.map((g) => g.items), [1, 1]);
  const exec5 = await withTenant(A.clinicId, (tx) => req.executedByItemTx(tx, A.clinicId, [i5!.id as string]));
  assert.equal(exec5.get(i5!.id as string), 2);
  const [r5row] = await sql`select status from public.hi_sadt_requests where id = ${r5}::uuid`;
  assert.equal(r5row!.status, 'ready');
  pass('5. uma guia por sessão (padrão da operadora); execução parcial: 2 de 5 executadas, a solicitação segue aceitando sessões');

  // ── 6. Negada, cancelamento e senha vencida ─────────────────────────
  const r6 = await createRequest(B, p2, [{ code: CODE_IND, quantity: 2 }]);
  await check(B, r6);
  const [i6] = await itemsOf(r6);
  const ap6 = await session(B, p2, i6!.id as string, '2026-11-07');
  await asUser(B, async (tx) => req.recordSadtAuthorizationInTx(tx, { decision: 'denied', clinicId: B.clinicId, requestId: r6, version: await version(r6), denialReason: 'Operadora negou por falta de cobertura contratual.', actorUserId: B.doctorId }));
  await complete(B, ap6, p2.patientId);
  assert.equal((await gapOf(ap6))?.reason, 'authorization_denied');
  assert.equal((await guidesOfRequest(r6)).length, 0);
  // cancelamento: com sessão executada é recusado; sem sessão, cancela e a autorização pedida também
  await assert.rejects(() => asUser(B, async (tx) => req.cancelSadtRequestInTx(tx, { clinicId: B.clinicId, requestId: r2, version: await version(r2), reason: 'Paciente desistiu do tratamento.', actorUserId: B.doctorId })), /encerre/u);
  const r6b = await createRequest(B, p2, [{ code: CODE_IND, quantity: 1 }]);
  await check(B, r6b);
  await asUser(B, async (tx) => req.cancelSadtRequestInTx(tx, { clinicId: B.clinicId, requestId: r6b, version: await version(r6b), reason: 'Pedido em duplicidade pela recepção.', actorUserId: B.doctorId }));
  const [a6b] = await sql`select a.status from public.hi_authorizations a join public.hi_sadt_requests r on r.authorization_id = a.id where r.id = ${r6b}::uuid`;
  assert.equal(a6b!.status, 'cancelled');
  const [i6b] = await itemsOf(r6b);
  await assert.rejects(() => session(B, p2, i6b!.id as string, '2026-11-08'), /não aceita sessões/u);
  // senha vencida
  const r6c = await createRequest(B, p2, [{ code: CODE_IND, quantity: 2 }]);
  await check(B, r6c);
  await authorize(B, r6c, [2], { passwordValidUntil: '2026-11-05' });
  const [i6c] = await itemsOf(r6c);
  const ap6c = await session(B, p2, i6c!.id as string, '2026-11-09');
  await complete(B, ap6c, p2.patientId);
  const gapPwd = await gapOf(ap6c);
  assert.equal((gapPwd?.issues as Array<{ code: string }>)[0]?.code, 'SADT_PASSWORD_EXPIRED');
  assert.equal(await consumed(i6c!.authorization_item_id as string), 0);
  pass('6. negada: pendência sem guia; cancelar com sessão executada é recusado (encerra-se), sem sessão cancela também o pedido à operadora e a solicitação deixa de aceitar sessões; sessão depois da validade da senha vira pendência sem consumo');

  // ── 7. Concorrência: duas sessões disputando o último saldo ─────────
  const r7 = await createRequest(B, p2, [{ code: CODE_IND, quantity: 1 }]);
  await check(B, r7);
  await authorize(B, r7, [1]);
  const [i7] = await itemsOf(r7);
  const ap7a = await session(B, p2, i7!.id as string, '2026-11-10');
  const ap7b = await session(B, p2, i7!.id as string, '2026-11-10');
  await complete(B, ap7a, p2.patientId, B.doctorId, false);
  await complete(B, ap7b, p2.patientId, B.doctorId, false);
  await Promise.all([ap7a, ap7b].map((appointmentId) =>
    withTenant(B.clinicId, (tx) => processInsuranceBilling(tx, { clinicId: B.clinicId, appointmentId, detectedBy: 'event', eventState: 'processed', lock: 'wait' }))));
  for (let i = 0; i < 4; i++) await runOutboxOnce({ batchSize: 50, parallelism: 2 });
  const live7 = await guidesOfRequest(r7);
  const gaps7 = [await gapOf(ap7a), await gapOf(ap7b)].filter((g) => g && g.status === 'open');
  assert.deepEqual([live7.length, await consumed(i7!.authorization_item_id as string), gaps7.length], [1, 1, 1]);
  pass('7. concorrência: duas sessões concluídas ao mesmo tempo com saldo 1 → uma guia, consumo 1, a outra vira pendência (trava por item)');

  // ── 8. Isolamento entre clínicas, trial e dados obrigatórios ────────
  const [peek] = await withTenant(C.clinicId, (tx) => tx.execute(fx.sqlTag`select count(*)::int as n from public.hi_sadt_requests where clinic_id = ${A.clinicId}::uuid`)) as unknown as Array<{ n: number }>;
  assert.equal(peek!.n, 0);
  const pC = await patientWithCard(C, 'isolamento');
  await assert.rejects(() => session(C, pC, i1!.id as string, '2026-11-08'));
  // Suspensa pelo dunning (past_due fora da carência): solicitação nova é recusada (D24).
  const T = await fx.setupClinic('SP/SADT suspensa');
  await sadtContract(T, CODE_IND, 10000);
  const pT = await patientWithCard(T, 'suspensa');
  await sql`update public.subscriptions set billing_status = 'past_due', current_period_start = now() - interval '40 days',
      current_period_end = now() - interval '10 days', grace_period_until = now() - interval '3 days' where clinic_id = ${T.clinicId}::uuid`;
  await assert.rejects(() => createRequest(T, pT, [{ code: CODE_IND, quantity: 1 }]), (e: Error & { constraint_name?: string }) =>
    e.name === 'PremiumAccessError' || e.constraint_name === 'qoro_premium_health_insurance');
  await assert.rejects(() => createRequest(A, p1, [{ code: '99999999', quantity: 1 }]), /não está no contrato nem na terminologia/u);
  await assert.rejects(() => createRequest(A, p1, [{ code: CODE_IND, quantity: 1 }, { code: CODE_IND, quantity: 2 }]), /duas vezes/u);
  const pOther = await patientWithCard(A, 'outro');
  await assert.rejects(() => createRequest(A, { patientId: pOther.patientId, membershipId: p1.membershipId }, [{ code: CODE_IND, quantity: 1 }]), /não é deste paciente/u);
  pass('8. RLS: outra clínica não lê a solicitação nem liga atendimento ao item dela; clínica suspensa pelo dunning não cria solicitação (D24); procedimento fora do contrato e da TUSS, item duplicado e carteirinha de outro paciente são recusados');

  // ── 9. Histórico e nada de CID/prontuário ───────────────────────────
  const hist = await sql`select from_status, to_status, created_via from public.hi_sadt_request_events where request_id = ${r2}::uuid order by created_at`;
  assert.deepEqual(hist.map((h) => `${h.from_status ?? '∅'}→${h.to_status}`), ['∅→draft', 'draft→awaiting_authorization', 'awaiting_authorization→partially_authorized']);
  await assert.rejects(() => sql`update public.hi_sadt_request_events set note = 'x' where request_id = ${r2}::uuid`, /só de inclusão/u);
  const cols = (await sql`select column_name from information_schema.columns where table_name like 'hi_sadt_request%'`).map((c) => String(c.column_name));
  assert.ok(!cols.some((c) => /cid|prontuario|diagn/iu.test(c)), cols.join(','));
  pass('9. histórico só de inclusão (rascunho → aguardando → parcialmente autorizada); nenhuma coluna de CID, diagnóstico ou prontuário');

  // ── 10. Documento oficial do pedido à operadora (P6.2) ──────────────
  const doc = await import('../../src/contexts/health-insurance/internal/sadt-request-document');
  const fileAccess = await import('../../src/contexts/health-insurance/internal/tiss-file-access');
  const rc = { ip: null, userAgent: null, requestId: 'harness-sadt-doc' };
  const card = (membershipId: string) => ({ membershipId, cardNumber: SYNTHETIC_CARD, auditEventId: randomUUID() });
  const docDeps = { store, validateXsd: xsd, now: () => new Date('2026-11-12T15:00:00Z'), software: { name: 'Qoro', version: 'harness' } };
  const p10 = await patientWithCard(B, 'documento');
  const r10 = await createRequest(B, p10, [{ code: CODE_IND, quantity: 3 }, { code: CODE_GRP, quantity: 1 }]);
  await asUser(B, async (tx) => req.setClinicalIndicationInTx(tx, { clinicId: B.clinicId, requestId: r10, version: await version(r10), text: 'Psicoterapia semanal indicada pela profissional.', actorUserId: B.doctorId }));
  assert.equal((await check(B, r10)).kind, 'awaiting_authorization');
  const [authRow] = await sql`select authorization_id, request_number from public.hi_sadt_requests where id = ${r10}::uuid`;
  // XSD indisponível: nada é gravado (nem objeto, nem registro).
  const before10 = objects.size;
  await assert.rejects(
    () => doc.exportSadtRequestDocument({ ...docDeps, validateXsd: null }, { clinicId: B.clinicId, requestId: r10, card: card(p10.membershipId), newborn: false, actorUserId: B.doctorId, requestContext: rc }),
    (e: Error & { layer?: string }) => e.layer === 'unavailable',
  );
  assert.equal(objects.size, before10);
  // Carteirinha de outra pessoa: recusada antes de gerar.
  await assert.rejects(
    () => doc.exportSadtRequestDocument(docDeps, { clinicId: B.clinicId, requestId: r10, card: card(p2.membershipId), newborn: false, actorUserId: B.doctorId, requestContext: rc }),
    (e: Error & { layer?: string }) => e.layer === 'card',
  );
  // Duas gerações simultâneas: uma gera, a outra encontra; exatamente 2 arquivos (XML + PDF).
  const both = await Promise.all([0, 1].map(() =>
    doc.exportSadtRequestDocument(docDeps, { clinicId: B.clinicId, requestId: r10, card: card(p10.membershipId), newborn: false, actorUserId: B.doctorId, requestContext: rc })));
  assert.deepEqual(both.map((o) => o.kind).sort(), ['already_exported', 'exported']);
  const files10 = await sql`select id, kind, media_type, content_sha256, storage_ref from public.hi_files where authorization_id = ${String(authRow!.authorization_id)}::uuid order by kind`;
  assert.deepEqual(files10.map((f) => `${f.kind}:${f.media_type}`), ['authorization_request_pdf:application/pdf', 'authorization_request_xml:application/xml']);
  // Guardado CIFRADO: nada de PDF, XML, carteirinha nem indicação em claro no armazenamento.
  for (const f of files10) {
    const raw = Buffer.from(objects.get(String(f.storage_ref))!).toString('utf8');
    assert.ok(!raw.includes('%PDF') && !raw.includes('solicitacaoSP-SADT') && !raw.includes(SYNTHETIC_CARD) && !raw.includes('Psicoterapia semanal'));
  }
  const readFile = (clinic: Clinic, fileId: string) =>
    asUser(clinic, (tx) => fileAccess.readTissFileCoreInTx(tx, store, { clinicId: clinic.clinicId, fileId, userId: clinic.doctorId, purpose: 'download_arquivo', requestContext: rc }));
  const pdfRow = files10.find((f) => f.kind === 'authorization_request_pdf')!;
  const xmlRow = files10.find((f) => f.kind === 'authorization_request_xml')!;
  const pdfRead = await readFile(B, String(pdfRow.id));
  const xmlRead = await readFile(B, String(xmlRow.id));
  if (pdfRead?.outcome !== 'granted' || xmlRead?.outcome !== 'granted') throw new Error('leitura do documento negada');
  assert.ok(pdfRead.bytes.subarray(0, 5).toString('latin1') === '%PDF-' && pdfRead.bytes.length > 2_000);
  assert.equal(pdfRead.fileName, `solicitacao-sp-sadt-${String(authRow!.request_number)}.pdf`);
  if (process.env.EVIDENCE_DIR) {
    // Só dados sintéticos (paciente, carteirinha e clínica do harness): para conferência visual.
    writeFileSync(`${process.env.EVIDENCE_DIR}/solicitacao-sp-sadt-sintetica.pdf`, pdfRead.bytes);
    writeFileSync(`${process.env.EVIDENCE_DIR}/solicitacao-sp-sadt-sintetica.xml`, xmlRead.bytes);
  }
  const xmlText = xmlRead.bytes.toString('latin1');
  // O XML guardado passa no XSD oficial de novo, com o número, a carteirinha lida e a indicação do solicitante; sem execução nem CID.
  assert.equal((await xsd({ fileName: 'reler.xml', bytes: xmlRead.bytes })).valid, true);
  for (const needle of ['SOLICITACAO_PROCEDIMENTOS', `numeroGuiaPrestador>${String(authRow!.request_number)}<`, `numeroCarteira>${SYNTHETIC_CARD}<`, 'Psicoterapia semanal indicada pela profissional.', 'quantidadeSolicitada>3<', 'quantidadeSolicitada>1<', 'tipoEtapaAutorizacao>1<']) {
    assert.ok(xmlText.includes(needle), needle);
  }
  assert.ok(!/dadosExecutante|CID|diagnostico/iu.test(xmlText));
  // Congelado: mudar o cadastro depois NÃO muda o documento; gerar de novo devolve o mesmo.
  await sql`update public.patients set nome = 'Nome Alterado Depois' where id = ${p10.patientId}::uuid`;
  await sql`update public.hi_professional_profiles set council_number = '999999' where clinic_id = ${B.clinicId}::uuid and professional_id = ${B.doctorId}::uuid`;
  const again = await doc.exportSadtRequestDocument(docDeps, { clinicId: B.clinicId, requestId: r10, card: card(p10.membershipId), newborn: false, actorUserId: B.doctorId, requestContext: rc });
  assert.deepEqual(again, { kind: 'already_exported', pdfFileId: String(pdfRow.id), xmlFileId: String(xmlRow.id) });
  const reread = await readFile(B, String(pdfRow.id));
  assert.equal(reread?.outcome === 'granted' ? reread.contentSha256 : null, String(pdfRow.content_sha256));
  assert.equal((await sql`select count(*)::int n from public.hi_files where authorization_id = ${String(authRow!.authorization_id)}::uuid`)[0]!.n, 2);
  // Adulterado no armazenamento: nunca entregue, e a leitura fica auditada.
  const pdfRef = String(pdfRow.storage_ref);
  const original = objects.get(pdfRef)!;
  objects.set(pdfRef, Buffer.concat([Buffer.from(original), Buffer.from('x')]));
  assert.equal((await readFile(B, String(pdfRow.id)))?.outcome, 'integrity_failed');
  objects.set(pdfRef, original);
  const audits = await sql`select after->>'outcome' as outcome from public.audit_events where resource_type = 'hi_file' and resource_id = ${String(pdfRow.id)} order by created_at`;
  assert.deepEqual(audits.map((a) => a.outcome), ['granted', 'granted', 'integrity_failed']);
  const [exportAudit] = await sql`select after from public.audit_events where action = ${doc.SADT_REQUEST_DOCUMENT_ACTION} and resource_id = ${r10}`;
  const exportAfter = JSON.stringify(exportAudit!.after);
  assert.ok(!exportAfter.includes(SYNTHETIC_CARD) && !exportAfter.includes('Psicoterapia') && exportAfter.includes('"xsd":"valid"'));
  // Outra clínica: não encontra a solicitação nem lê o arquivo.
  assert.equal(await doc.findSadtRequestDocument(A.clinicId, r10, A.doctorId), null);
  assert.equal(await readFile(A, String(pdfRow.id)), null);
  assert.deepEqual(await doc.findSadtRequestDocument(B.clinicId, r10, B.doctorId), { state: 'ready', pdfFileId: String(pdfRow.id), xmlFileId: String(xmlRow.id) });
  // Sem autorização exigida (r1, pronta) não há pedido à operadora.
  assert.deepEqual(await doc.findSadtRequestDocument(A.clinicId, r1, A.doctorId), { state: 'no_authorization' });
  await assert.rejects(
    () => doc.exportSadtRequestDocument(docDeps, { clinicId: A.clinicId, requestId: r1, card: card(p1.membershipId), newborn: false, actorUserId: A.doctorId, requestContext: rc }),
    (e: Error & { layer?: string }) => e.layer === 'state',
  );
  // Data da resposta da operadora: nem no futuro (fuso da clínica) nem antes do pedido.
  await assert.rejects(() => authorize(B, r10, [1, 1], { authorizedOn: '2099-01-01' }), /futuro/u);
  await assert.rejects(() => authorize(B, r10, [1, 1], { authorizedOn: '2026-10-01' }), /anterior/u);
  // Assinatura suspensa (D24): não GERA documento novo, mas o já gerado continua legível (preservação).
  const p10b = await patientWithCard(B, 'documento-suspenso');
  const r10b = await createRequest(B, p10b, [{ code: CODE_IND, quantity: 1 }]);
  assert.equal((await check(B, r10b)).kind, 'awaiting_authorization');
  await sql`update public.subscriptions set billing_status = 'past_due', current_period_start = now() - interval '40 days',
      current_period_end = now() - interval '10 days', grace_period_until = now() - interval '3 days' where clinic_id = ${B.clinicId}::uuid`;
  await assert.rejects(
    () => doc.exportSadtRequestDocument(docDeps, { clinicId: B.clinicId, requestId: r10b, card: card(p10b.membershipId), newborn: false, actorUserId: B.doctorId, requestContext: rc }),
    (e: Error & { constraint_name?: string }) => e.name === 'PremiumAccessError' || e.constraint_name === 'qoro_premium_health_insurance',
  );
  assert.equal((await readFile(B, String(pdfRow.id)))?.outcome, 'granted');
  // Nem a indicação clínica muda com a assinatura parada (prepara o envio, como o ajuste da
  // Consulta da P4.6); a que já estava gravada fica como estava.
  const [indBefore] = await sql`select clinical_indication_encrypted as enc, version from public.hi_sadt_requests where id = ${r10b}::uuid`;
  await assert.rejects(
    () => asUser(B, async (tx) => req.setClinicalIndicationInTx(tx, { clinicId: B.clinicId, requestId: r10b, version: await version(r10b), text: 'Indicação com a assinatura parada.', actorUserId: B.doctorId })),
    (e: Error) => e.name === 'PremiumAccessError',
  );
  const [indAfter] = await sql`select clinical_indication_encrypted as enc, version from public.hi_sadt_requests where id = ${r10b}::uuid`;
  assert.deepEqual(indAfter, indBefore);
  pass('10. documento oficial do pedido (P6.2): XML SOLICITACAO_PROCEDIMENTOS validado no XSD + PDF do modelo oficial, cifrados e ligados à autorização; geração única sob concorrência; congelado (cadastro alterado depois não muda nada); adulterado nunca é entregue e fica auditado; outra clínica não vê; sem autorização exigida não há pedido; XSD indisponível não grava; carteirinha errada recusada; suspensa não gera nem muda a indicação clínica, mas lê o que já existe; autorização com data no futuro ou antes do pedido é recusada');

  console.log(`\nOK — ${passed} provas: solicitação SP/SADT persistida e SP/SADT automática ponta a ponta (até o XML validado no XSD).`);
} finally {
  await cluster.stop();
}
