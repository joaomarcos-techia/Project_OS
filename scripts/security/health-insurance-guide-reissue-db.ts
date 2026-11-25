/**
 * Guia nova depois de uma guia CANCELADA antes do envio (defeito de 24/11: a chave de idempotência
 * da sessão pertencia à cancelada e nenhum caminho gerava outra guia). Postgres DESCARTÁVEL, cadeia
 * do DEV (com a 0167), dados sintéticos, código real.
 *
 * Provas: SP/SADT por sessão e Consulta; identidade própria da guia nova (id, número, chave); a
 * cancelada fica no histórico; repetição, clique duplo e concorrência dão UMA guia; o reprocessamento
 * e a reentrega da conclusão não criam outra; guia aprovada, enviada, com cancelamento na operadora
 * pendente ou recusado é recusada (o caminho é a substituição); outra clínica não reemite; a operadora
 * corrigida na cobertura vale na guia nova (Consulta); a pendência "guia cancelada" se resolve; o
 * consumo da autorização não se repete; a guia nova emite, vai ao lote (XML no XSD) e o recebível
 * nasce só dela; uma segunda guia cancelada ganha a sua própria guia nova.
 *
 *   SECURITY_PG_BIN=... PORT=55571 NODE_OPTIONS="--import ./scripts/security/server-only-hook.mjs" \
 *     ./node_modules/.bin/tsx --tsconfig tsconfig.scripts.json scripts/security/health-insurance-guide-reissue-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55571);
const TOTAL = 14;
const cluster = await startScratchSchema({ port: PORT, maxConnections: 16, migrations: await readDevOrderChain() });
const { sql } = cluster;
if (!new RegExp(`@(?:127\\.0\\.0\\.1|localhost):${PORT}/`, 'u').test(cluster.url)) throw new Error('não é o cluster local');
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.OUTBOX_CRON_ALLOW_NON_VERCEL = 'true';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');
process.env.LOG_LEVEL = 'error';

const { withTenant } = await import('../../src/lib/db/tenant');
await import('../../src/app/api/cron/outbox/handlers');
const { runOutboxOnce } = await import('../../src/lib/outbox/worker');
const { applyTransition } = await import('../../src/contexts/scheduling/internal/appointment-core');
const { recordAppointmentCoverage } = await import('../../src/contexts/health-insurance/internal/coverage-service');
const req = await import('../../src/contexts/health-insurance/internal/sadt-request-service');
const reissue = await import('../../src/contexts/health-insurance/internal/guide-reissue');
const { createConsultaGuideForAppointment } = await import('../../src/contexts/health-insurance/internal/consulta-guide-service');
const { issueSpSadtGuide } = await import('../../src/contexts/health-insurance/internal/sadt-issuance');
const { processInsuranceBilling } = await import('../../src/contexts/health-insurance/internal/billing-recovery');
const { correctCoverageInTx } = await import('../../src/contexts/health-insurance/internal/billing-gap-actions');
const cancellations = await import('../../src/contexts/health-insurance/internal/guide-cancellation-service');
const { loadXmllintValidator } = await import('../../src/contexts/health-insurance/tiss/xml/xsd-validator');
const { loadHiFixtures, SYNTHETIC_CARD, SYS_ACTOR } = await import('./hi-fixtures');

const xsd = loadXmllintValidator();
if (!xsd) throw new Error('validador XSD do app indisponível (TISS_XMLLINT_WASM_DIR fora do CI)');
const objects = new Map<string, Uint8Array>();
const fx = await loadHiFixtures(sql, {
  store: {
    async put(ref: string, bytes: Uint8Array) { objects.set(ref, bytes); },
    async get(ref: string) { return objects.get(ref)!; },
    async remove(ref: string) { objects.delete(ref); },
  },
  validateXsd: xsd,
});
type Clinic = Awaited<ReturnType<typeof fx.setupClinic>>;
const q = fx.sqlTag;
let passed = 0;
const pass = (m: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${m}`);
};
const CODE = '50000470';
const asUser = <T>(c: Clinic, fn: Parameters<typeof withTenant<T>>[1]) => withTenant(c.clinicId, fn, c.doctorId);
async function outcome(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'ok';
  } catch (e) {
    if (e instanceof reissue.GuideReissueError) return `regra:${e.kind}:${e.message}`;
    const err = e as { code?: string; cause?: { code?: string } };
    return `erro:${err.code ?? err.cause?.code ?? (e as Error).message}`;
  }
}
async function patientWithCard(c: Clinic, label: string, insurerId = c.insurerId) {
  const [p] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
    values (${c.clinicId}::uuid, ${`Paciente ${label}`}, 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`;
  const [m] = await sql`insert into public.hi_memberships (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
    values (${c.clinicId}::uuid, ${p!.id}::uuid, ${insurerId}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${randomUUID().replace(/-/g, '').padEnd(64, '0')}, '2345', ${SYS_ACTOR}::uuid) returning id`;
  return { patientId: p!.id as string, membershipId: m!.id as string };
}
const version = async (id: string) => Number((await sql`select version from public.hi_sadt_requests where id = ${id}::uuid`)[0]!.version);
let slot = 0;
async function sadtSession(c: Clinic, pt: { patientId: string; membershipId: string }, requestItemId: string, day: string) {
  slot += 1;
  const [proc] = await sql`select id from public.procedures where clinic_id = ${c.clinicId}::uuid limit 1`;
  const [a] = await sql`insert into public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
      snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via, billing_mode)
    values (${c.clinicId}::uuid, ${c.doctorId}::uuid, ${pt.patientId}::uuid, ${proc!.id}::uuid, ${`${day}T13:00:00Z`}::timestamptz + ${slot} * interval '55 minutes', 50, 'agendado', 120,
      'Psicoterapia', 120, 50, 'Profissional sintético', 'attendant', 'convenio') returning id`;
  // A cobertura só se registra antes do atendimento começar (regra do banco); depois, em atendimento.
  await asUser(c, (tx) => recordAppointmentCoverage(tx, {
    clinicId: c.clinicId, appointmentId: a!.id as string, patientId: pt.patientId, procedureId: proc!.id as string, appointmentDate: day,
    guideType: 'sp_sadt', insurerId: c.insurerId, planId: null, membershipId: pt.membershipId, authorizationId: null,
    sadtRequestItemId: requestItemId, actor: { kind: 'user', userId: c.doctorId },
  }));
  await sql`update public.appointments set status = 'em_atendimento' where id = ${a!.id}::uuid`;
  return a!.id as string;
}
async function complete(c: Clinic, appointmentId: string, patientId: string) {
  await sql`insert into public.prontuarios (clinic_id, patient_id, doctor_id, appointment_id, status, signed_at, signed_by, content_encrypted)
    values (${c.clinicId}::uuid, ${patientId}::uuid, ${c.doctorId}::uuid, ${appointmentId}::uuid, 'assinado', now(), ${c.doctorId}::uuid, 'ciphertext-sintetico')`;
  await withTenant(c.clinicId, (tx) => applyTransition(tx, {
    clinicId: c.clinicId, appointmentId, target: 'atendido', transitionedBy: c.doctorId, actorType: 'user', clientKey: `concluir-${appointmentId}`, correlationId: null,
  }), c.doctorId);
  for (let i = 0; i < 4; i++) await runOutboxOnce({ batchSize: 50, parallelism: 1 });
}
const liveGuideOf = async (appointmentId: string) =>
  (await sql`select g.id::text, g.number, g.status, g.idempotency_key, g.insurer_id::text, g.total_value_cents::int total from public.hi_guides g
     where g.live and exists (select 1 from public.hi_guide_items i where i.guide_id = g.id and i.appointment_id = ${appointmentId}::uuid)`)[0] ?? null;
const guidesOf = async (appointmentId: string) =>
  (await sql`select count(*)::int n from public.hi_guides g where exists (select 1 from public.hi_guide_items i where i.guide_id = g.id and i.appointment_id = ${appointmentId}::uuid)`)[0]!.n as number;
const cancel = (c: Clinic, guideId: string, why = 'Guia emitida com erro de cadastro') =>
  asUser(c, async (tx) => {
    const [g] = (await tx.execute(q`select version from public.hi_guides where id = ${guideId}::uuid`)) as unknown as Array<{ version: number }>;
    await tx.execute(q`UPDATE public.hi_guides SET status = 'cancelled', cancel_reason = ${why}, cancelled_by = ${c.doctorId}::uuid
      WHERE clinic_id = ${c.clinicId}::uuid AND id = ${guideId}::uuid AND version = ${g!.version}`);
  });
const reissueOf = (c: Clinic, guideId: string) =>
  asUser(c, (tx) => reissue.reissueGuideAfterCancellationTx(tx, { clinicId: c.clinicId, cancelledGuideId: guideId, actorUserId: c.doctorId }));
const gapOf = async (appointmentId: string) =>
  (await sql`select status, reason from public.hi_billing_gaps where appointment_id = ${appointmentId}::uuid`)[0] ?? null;

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  await sql`insert into public.tiss_terms (version_id, table_code, code, term, starts_on)
    select v.id, t.table_code, t.code, t.term, '2010-01-01' from public.tiss_terminology_versions v,
      (values ('22', ${CODE}, 'Sessão de psicoterapia individual'), ('23', '1', 'Eletiva'), ('50', '03', 'Outras terapias')) t(table_code, code, term)
     where v.version = '202609'`;
  const A = await fx.setupClinic('Reemissão A', { insurers: [{ name: 'Operadora Um', ans: '123456' }, { name: 'Operadora Dois', ans: '654321' }] });
  const B = await fx.setupClinic('Reemissão B');
  await sql`insert into public.hi_procedure_contracts (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, unit_value_cents, valid_from, requires_authorization, copay_kind, created_by)
    values (${A.clinicId}::uuid, ${A.insurerId}::uuid, 'sp_sadt', '22', ${CODE}, 'Sessão de psicoterapia', 12000, '2026-01-01', true, 'none', ${SYS_ACTOR}::uuid)`;
  const p1 = await patientWithCard(A, 'um');
  const { requestId } = await asUser(A, (tx) => req.createSadtRequestInTx(tx, {
    clinicId: A.clinicId, patientId: p1.patientId, membershipId: p1.membershipId, requester: { kind: 'internal', professionalId: A.doctorId },
    requestedOn: '2026-11-01', careCharacter: '1', careType: '03', items: [{ tableCode: '22', procedureCode: CODE, quantity: 4 }], actorUserId: A.doctorId,
  } as Parameters<typeof req.createSadtRequestInTx>[1]));
  await asUser(A, async (tx) => req.checkSadtRequestInTx(tx, { clinicId: A.clinicId, requestId, version: await version(requestId), actorUserId: A.doctorId }));
  await asUser(A, async (tx) => req.setClinicalIndicationInTx(tx, { clinicId: A.clinicId, requestId, version: await version(requestId), text: 'Indicação sintética de teste.', actorUserId: A.doctorId }));
  const [ri] = await sql`select id from public.hi_sadt_request_items where request_id = ${requestId}::uuid`;
  await asUser(A, async (tx) => req.recordSadtAuthorizationInTx(tx, {
    decision: 'authorized', clinicId: A.clinicId, requestId, version: await version(requestId), authorizedOn: '2026-11-02',
    operatorGuideNumber: 'OP12345678', password: 'SENHA987', passwordValidUntil: '2026-12-31',
    items: [{ requestItemId: ri!.id as string, quantityAuthorized: 4 }], actorUserId: A.doctorId,
  } as Parameters<typeof req.recordSadtAuthorizationInTx>[1]));
  // Fora de 10/11: o `approvedGuide` compartilhado (hi-fixtures) agenda a mesma médica nesse dia.
  const ap1 = await sadtSession(A, p1, ri!.id as string, '2026-11-05');

  // 1. A guia nasce da conclusão; cancelada antes do envio; a recuperação pede a guia nova e NÃO a cria sozinha.
  await complete(A, ap1, p1.patientId);
  const g1 = await liveGuideOf(ap1);
  assert.equal(g1!.status, 'ready_for_review');
  await cancel(A, g1!.id as string);
  await withTenant(A.clinicId, (tx) => processInsuranceBilling(tx, { clinicId: A.clinicId, appointmentId: ap1, detectedBy: 'event', eventState: 'processed', lock: 'wait' }));
  assert.equal(await liveGuideOf(ap1), null);
  assert.deepEqual(await gapOf(ap1), { status: 'open', reason: 'guide_cancelled' });
  const blockBefore = await withTenant(A.clinicId, (tx) => reissue.reissueBlockTx(tx, A.clinicId, g1!.id as string));
  assert.equal(blockBefore, null, 'a cancelada antes do envio pode ganhar guia nova');
  pass('SP/SADT: guia da conclusão cancelada antes do envio; a recuperação abre a pendência "guia cancelada" e não gera guia sozinha');

  // 2. Guia nova legítima: identidade própria; a cancelada fica no histórico; a pendência se resolve.
  const consumedBefore = (await sql`select coalesce(sum(quantity), 0)::int n from public.hi_authorization_consumptions where idempotency_key like ${`sadt:${ap1}:%`}`)[0]!.n;
  const r1 = await reissueOf(A, g1!.id as string);
  assert.equal(r1.existing, false);
  const n1 = await liveGuideOf(ap1);
  assert.equal(n1!.id, r1.guideId);
  assert.notEqual(n1!.id, g1!.id);
  assert.notEqual(n1!.number, g1!.number, 'número TISS novo');
  assert.equal(n1!.idempotency_key, `sadt:appointment:${ap1}:reissue:${g1!.id}`);
  const [old] = await sql`select status, live, cancel_reason from public.hi_guides where id = ${g1!.id}::uuid`;
  assert.deepEqual([old!.status, old!.live, old!.cancel_reason], ['cancelled', false, 'Guia emitida com erro de cadastro']);
  assert.notEqual((await gapOf(ap1))?.status, 'open', 'a pendência "guia cancelada" se resolve com a guia nova');
  const consumedAfter = (await sql`select coalesce(sum(quantity), 0)::int n from public.hi_authorization_consumptions where idempotency_key like ${`sadt:${ap1}:%`}`)[0]!.n;
  assert.equal(consumedAfter, consumedBefore, 'o consumo da autorização da sessão não se repete');
  pass(`guia nova com identidade própria (número ${n1!.number}, chave de reemissão), a cancelada segue no histórico; pendência resolvida; consumo da sessão igual (${consumedAfter})`);

  // 3. Repetição (retry do mesmo ato) e reprocessamento da conclusão: nenhuma guia a mais.
  assert.deepEqual(await reissueOf(A, g1!.id as string), { guideId: r1.guideId, number: r1.number, existing: true });
  for (let k = 0; k < 3; k++) {
    await withTenant(A.clinicId, (tx) => processInsuranceBilling(tx, { clinicId: A.clinicId, appointmentId: ap1, detectedBy: 'event', eventState: 'processed', lock: 'wait' }));
  }
  await sql`insert into public.outbox (clinic_id, event_type, payload, idempotency_key, payload_hash, correlation_id)
    select clinic_id, event_type, payload, idempotency_key || ':reentrega', payload_hash, correlation_id from public.outbox
     where clinic_id = ${A.clinicId}::uuid and event_type = 'scheduling.appointment.insurance_completed'`;
  for (let i = 0; i < 4; i++) await runOutboxOnce({ batchSize: 50, parallelism: 1 });
  assert.equal(await guidesOf(ap1), 2, 'a cancelada e a nova; nada mais');
  pass('repetir a reemissão devolve a mesma guia; reprocessamento (3×) e reentrega da conclusão não criam outra (2 guias: a cancelada e a nova)');

  // 4. Clique duplo / duas abas: duas reemissões simultâneas da mesma cancelada dão UMA guia nova.
  // Outra sessão da MESMA solicitação (a cobertura exige o paciente, a operadora e a carteirinha dela).
  const ap2 = await sadtSession(A, p1, ri!.id as string, '2026-11-11');
  await complete(A, ap2, p1.patientId);
  const g2 = await liveGuideOf(ap2);
  await cancel(A, g2!.id as string);
  const race = await Promise.all([reissueOf(A, g2!.id as string), reissueOf(A, g2!.id as string)]);
  assert.equal(race[0]!.guideId, race[1]!.guideId);
  assert.deepEqual(race.map((r) => r.existing).sort(), [false, true]);
  assert.equal(await guidesOf(ap2), 2);
  pass('duas reemissões simultâneas da mesma guia cancelada (clique duplo, duas abas): uma cria, a outra espera a trava e recebe a mesma');

  // 5. Guia não cancelada: em conferência, aprovada ou enviada → recusada (o caminho é a substituição).
  assert.match(await outcome(() => reissueOf(A, r1.guideId)), /^regra:state:Só se gera guia nova de uma guia cancelada antes do envio/u);
  const sentRun = await fx.sentBatch(A, 1);
  const sentGuide = sentRun.guides[0]!;
  assert.match(await outcome(() => reissueOf(A, sentGuide)), /^regra:state:Guia que já chegou à operadora se corrige pela substituição/u);
  pass('guia em edição (não cancelada) e guia já enviada à operadora: a reemissão é recusada; a enviada é corrigida pela substituição');

  // 6. Cancelamento na operadora pendente e recusado: continua recusada.
  const cr = await asUser(A, (tx) => cancellations.requestGuideCancellationTx(tx, { validateXsd: xsd }, {
    clinicId: A.clinicId, guideId: sentGuide, purpose: 'substitution', channel: 'portal', requestedOn: '2026-11-12',
    reason: 'Guia enviada com o tipo de consulta errado; reenvio corrigido', idempotencyKey: `can-${randomUUID()}`, generateXml: true,
  }));
  assert.match(await outcome(() => reissueOf(A, sentGuide)), /substituição/u);
  await asUser(A, (tx) => cancellations.recordGuideCancellationReceiptTx(tx, {
    clinicId: A.clinicId, cancellationId: cr.cancellationId, statusCode: '2', receivedOn: '2026-11-13',
    operatorProtocol: '9123456789', evidenceSha256: null, operatorMessage: 'Recibo SINTÉTICO (recusado)', idempotencyKey: `rec-${randomUUID()}`,
  }));
  assert.match(await outcome(() => reissueOf(A, sentGuide)), /substituição/u);
  const [sentStill] = await sql`select status from public.hi_guides where id = ${sentGuide}::uuid`;
  assert.notEqual(sentStill!.status, 'cancelled');
  pass('com o cancelamento na operadora pendente e depois recusado, a reemissão segue recusada (nenhuma guia nova; a enviada não muda)');

  // 7. Outra clínica não reemite nem vê a guia de A.
  assert.match(await outcome(() => withTenant(B.clinicId, (tx) => reissue.reissueGuideAfterCancellationTx(tx, { clinicId: B.clinicId, cancelledGuideId: g1!.id as string, actorUserId: B.doctorId }), B.doctorId)), /^regra:not_found/u);
  assert.match(await outcome(() => withTenant(B.clinicId, (tx) => reissue.reissueGuideAfterCancellationTx(tx, { clinicId: A.clinicId, cancelledGuideId: g1!.id as string, actorUserId: B.doctorId }), B.doctorId)), /not_found|regra|erro/u);
  pass('a clínica B não reemite a guia de A (inexistente para ela pela RLS), nem pedindo o id da clínica A');

  // 8. A guia nova emite, vai ao lote (XML no XSD) e o recebível nasce só dela.
  await asUser(A, async (tx) => {
    const [g] = (await tx.execute(q`select version from public.hi_guides where id = ${r1.guideId}::uuid`)) as unknown as Array<{ version: number }>;
    await tx.execute(q`UPDATE public.hi_guides SET status = 'reviewed', reviewed_by = ${A.doctorId}::uuid WHERE id = ${r1.guideId}::uuid AND version = ${g!.version}`);
  });
  await asUser(A, (tx) => issueSpSadtGuide(tx, {
    clinicId: A.clinicId, guideId: r1.guideId, card: { membershipId: p1.membershipId, cardNumber: SYNTHETIC_CARD, auditEventId: randomUUID() },
    newborn: false, professionalName: 'Dra. Sintética', actorUserId: A.doctorId, today: '2026-11-15',
  }));
  const batchId = await fx.createBatch(A, [r1.guideId], { guideType: 'sp_sadt' });
  const exported = await fx.exportBatch(A, batchId);
  assert.equal(exported.kind, 'exported');
  let v = await fx.batchVersion(batchId);
  v = await fx.asUser(A, (tx) => fx.batches.markBatchSentInTx(tx, { clinicId: A.clinicId, batchId, version: v, channel: 'manual', sentOn: '2026-11-16', evidence: 'Enviado pelo portal da operadora, comprovante sintético' }));
  const recv = await sql`select source_hi_guide_id::text g, valor::numeric(12,2)::text v from public.lancamentos where clinic_id = ${A.clinicId}::uuid and source_hi_guide_id in (${g1!.id}::uuid, ${r1.guideId}::uuid)`;
  assert.deepEqual(recv.map((x) => [x.g, x.v]), [[r1.guideId, '120.00']]);
  pass('a guia nova emite (snapshot), vai ao lote SP/SADT com o XML validado no XSD oficial, e o recebível nasce só dela (120,00); a cancelada não tem recebível');

  // 9. Cancelar a guia nova e gerar outra: novo ato legítimo, nova identidade.
  const ap3 = await sadtSession(A, p1, ri!.id as string, '2026-11-12');
  await complete(A, ap3, p1.patientId);
  const g3 = await liveGuideOf(ap3);
  await cancel(A, g3!.id as string);
  const r3 = await reissueOf(A, g3!.id as string);
  await cancel(A, r3.guideId, 'A nova também saiu com erro');
  const r3b = await reissueOf(A, r3.guideId);
  assert.notEqual(r3b.guideId, r3.guideId);
  assert.equal((await liveGuideOf(ap3))!.idempotency_key, `sadt:appointment:${ap3}:reissue:${r3.guideId}`);
  assert.equal(await guidesOf(ap3), 3);
  pass('cancelar a guia nova e reemitir é outro ato legítimo: terceira guia, com a chave da segunda cancelada; as duas canceladas no histórico');

  // 10. Consulta: guia cancelada, cobertura corrigida para OUTRA operadora, guia nova com a operadora certa.
  const [proc] = await sql`select id from public.procedures where clinic_id = ${A.clinicId}::uuid limit 1`;
  const pc = await patientWithCard(A, 'consulta');
  // A carteirinha é imutável (regra do banco): o mesmo paciente ganha uma SEGUNDA, da Operadora Dois.
  const [m2] = await sql`insert into public.hi_memberships (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
    values (${A.clinicId}::uuid, ${pc.patientId}::uuid, ${A.insurerIds[1]!}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${randomUUID().replace(/-/g, '').padEnd(64, '0')}, '6789', ${SYS_ACTOR}::uuid) returning id`;
  const pc2 = { patientId: pc.patientId, membershipId: m2!.id as string };
  const [ca] = await sql`insert into public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
      snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via, billing_mode)
    values (${A.clinicId}::uuid, ${A.doctorId}::uuid, ${pc.patientId}::uuid, ${proc!.id}::uuid, '2026-11-13T16:00:00Z', 30, 'agendado', 150,
      'Consulta', 150, 30, 'Dra. Sintética', 'attendant', 'convenio') returning id`;
  const capId = ca!.id as string;
  await asUser(A, (tx) => recordAppointmentCoverage(tx, {
    clinicId: A.clinicId, appointmentId: capId, patientId: pc.patientId, procedureId: proc!.id as string, appointmentDate: '2026-11-13',
    guideType: 'consulta', insurerId: A.insurerId, planId: null, membershipId: pc.membershipId, authorizationId: null, actor: { kind: 'user', userId: A.doctorId },
  } as Parameters<typeof recordAppointmentCoverage>[1]));
  await sql`update public.appointments set status = 'atendido' where id = ${capId}::uuid`;
  const cg = await withTenant(A.clinicId, (tx) => createConsultaGuideForAppointment(tx, {
    clinicId: A.clinicId, appointment: { id: capId, patientId: pc.patientId, professionalId: A.doctorId, procedureId: proc!.id as string, date: '2026-11-13', billingMode: 'convenio' },
    coverage: { insurerId: A.insurerId, planId: null, membershipId: pc.membershipId }, terminologyVersion: '202609', actor: { kind: 'automation' },
  }));
  assert.equal(cg.kind, 'created');
  const cgId = (cg as { guideId: string }).guideId;
  await cancel(A, cgId, 'Operadora errada no cadastro');
  await withTenant(A.clinicId, (tx) => processInsuranceBilling(tx, { clinicId: A.clinicId, appointmentId: capId, detectedBy: 'event', eventState: 'processed', lock: 'wait' }));
  await asUser(A, (tx) => correctCoverageInTx(tx, {
    clinicId: A.clinicId, appointmentId: capId, guideType: 'consulta', insurerId: A.insurerIds[1]!, planId: null, membershipId: pc2.membershipId, authorizationId: null,
    note: 'Operadora corrigida: o paciente é da Operadora Dois',
  }, A.doctorId));
  const rc = await reissueOf(A, cgId);
  const nc = await liveGuideOf(capId);
  assert.deepEqual([nc!.id, nc!.insurer_id, nc!.idempotency_key], [rc.guideId, A.insurerIds[1]!, `appointment:${capId}:consulta:reissue:${cgId}`]);
  assert.deepEqual(await reissueOf(A, cgId), { guideId: rc.guideId, number: rc.number, existing: true });
  pass('Consulta: guia cancelada, cobertura corrigida para a Operadora Dois, guia nova com a operadora certa e a chave de reemissão; repetir devolve a mesma');

  // 11. O índice da 0147 impede duas guias vivas da mesma sessão mesmo por fora do serviço.
  const dup = await outcome(() => asUser(A, (tx) => tx.execute(q`insert into public.hi_guide_items
      (clinic_id, guide_id, sequence, appointment_id, contract_line_id, executed_on, table_code, procedure_code, description, quantity, factor_hundredths, unit_value_cents, total_value_cents)
    select clinic_id, ${g2!.id}::uuid, 9, appointment_id, contract_line_id, executed_on, table_code, procedure_code, description, quantity, factor_hundredths, unit_value_cents, total_value_cents
      from public.hi_guide_items where guide_id = ${race[0]!.guideId}::uuid limit 1`)));
  assert.notEqual(dup, 'ok');
  pass('nenhuma segunda guia viva da mesma sessão: a guia cancelada não recebe linha, e o índice "sem cobrança dupla" barra o resto');

  // 12. Módulo desligado: nada é reemitido.
  const ap4 = await sadtSession(A, p1, ri!.id as string, '2026-11-14');
  await complete(A, ap4, p1.patientId);
  const g4 = await liveGuideOf(ap4);
  await cancel(A, g4!.id as string);
  await sql`update public.hi_clinic_settings set enabled = false where clinic_id = ${A.clinicId}::uuid`;
  assert.notEqual(await outcome(() => reissueOf(A, g4!.id as string)), 'ok');
  await sql`update public.hi_clinic_settings set enabled = true where clinic_id = ${A.clinicId}::uuid`;
  assert.equal(await guidesOf(ap4), 1);
  pass('com o módulo desligado, a reemissão é recusada (nenhuma guia nova)');

  // 13. Guia cancelada SEM sessão viva e sem guia nova ainda aparece como "pode gerar"; depois, como "gerada".
  const before13 = await withTenant(A.clinicId, (tx) => reissue.reissueBlockTx(tx, A.clinicId, g4!.id as string));
  assert.equal(before13, null);
  const r4 = await reissueOf(A, g4!.id as string);
  assert.deepEqual(await withTenant(A.clinicId, (tx) => reissue.reissuedFromTx(tx, A.clinicId, g4!.id as string)), { id: r4.guideId, number: r4.number });
  pass('a tela sabe o estado: cancelada sem guia nova = pode gerar; depois, a guia nova é achada pela chave da cancelada');

  // 14. Auditoria de domínio: a guia nova é criada por pessoa (createdVia user), com o histórico de eventos.
  const [meta] = await sql`select created_via, created_by::text by from public.hi_guides where id = ${r4.guideId}::uuid`;
  assert.deepEqual([meta!.created_via, meta!.by], ['user', A.doctorId]);
  pass('a guia nova registra quem a gerou (pessoa da sessão, origem "user")');

  assert.equal(passed, TOTAL);
  console.log(`\n${passed}/${TOTAL} provas da guia nova depois de cancelada passaram.`);
} finally {
  await cluster.stop();
}
process.exit(0);
