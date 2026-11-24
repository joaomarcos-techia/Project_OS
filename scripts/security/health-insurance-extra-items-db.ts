/**
 * P8.4 — itens executados adicionais da sessão SP/SADT, com a política P8.4-r APROVADA em
 * 24/11/2026 e a migration 0167 (docs/convenios/migrations/0167_hi_appointment_extra_items.candidate.sql)
 * aplicada DEPOIS da cadeia na ordem do DEV, em Postgres DESCARTÁVEL. Nunca no DEV compartilhado;
 * só dados sintéticos.
 *
 * Caminho real: solicitação SP/SADT → autorização da operadora → atendimento ligado ao item →
 * registro do item adicional (consultório ou conferência) → conclusão pelo Scheduling → outbox →
 * handler → guia da sessão → regularização → inclusão (ou não faturar) → conferência → aprovação
 * (snapshot) → lote → XML no XSD oficial → envio → recebível.
 *
 * Provas: regras do banco (só item de contrato, cópia dos campos pela linha, pessoa da sessão,
 * transições da política, vínculo com a autorização da solicitação, linha da guia conferida,
 * consumo do saldo comprovado, guia fechada, comercial, módulo, RLS, sem DELETE) e do serviço
 * (vigência, posse da sessão do médico, regra da operadora, aprovação bloqueada, "aprovar sem o
 * item" atômico, concorrência, reprocessamento, XML e recebível com só o que foi incluído).
 *
 *   SECURITY_PG_BIN=... PORT=55569 NODE_OPTIONS="--import ./scripts/security/server-only-hook.mjs" \
 *     ./node_modules/.bin/tsx --tsconfig tsconfig.scripts.json scripts/security/health-insurance-extra-items-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55569);
const CANDIDATE = '0167_hi_appointment_extra_items.candidate.sql';
const TOTAL = 28;
const chain = await readDevOrderChain();
const cluster = await startScratchSchema({
  port: PORT,
  maxConnections: 16,
  migrations: [...chain, { file: CANDIDATE, body: readFileSync(`docs/convenios/migrations/${CANDIDATE}`, 'utf8') }],
});
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
const extra = await import('../../src/contexts/health-insurance/internal/extra-executed-items');
const { issueSpSadtGuide } = await import('../../src/contexts/health-insurance/internal/sadt-issuance');
const { processInsuranceBilling } = await import('../../src/contexts/health-insurance/internal/billing-recovery');
const { loadXmllintValidator } = await import('../../src/contexts/health-insurance/tiss/xml/xsd-validator');
const { decryptForTenant } = await import('../../src/lib/crypto/encryption');
const { loadHiFixtures, SYNTHETIC_CARD, SYS_ACTOR } = await import('./hi-fixtures');

const xsd = loadXmllintValidator();
if (!xsd) throw new Error('validador XSD do app indisponível (TISS_XMLLINT_WASM_DIR fora do CI)');
// Guarda o que a exportação grava (XML cifrado), para a prova do conteúdo exportado.
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
type TxOf = Parameters<Parameters<typeof withTenant>[1]>[0];
const q = fx.sqlTag;

let passed = 0;
const pass = (msg: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${msg}`);
};
const CODE_MAIN = '50000470';
const CODE_FREE = '50000586';
const CODE_AUTH = '50000594';
const CODE_OLD = '50000608';
const CODE_CONF = '50000616';
const CODE_LATE = '50000624';
const CODE_A = '50000632'; // procedimento agendado que exige autorização
const CODE_B = '50000640'; // adicional autorizado na MESMA solicitação

async function contract(c: Clinic, insurerId: string, code: string, cents: number, opts: { requiresAuth?: boolean; until?: string | null; guideType?: string } = {}) {
  const [l] = await sql`insert into public.hi_procedure_contracts (clinic_id, insurer_id, guide_type, table_code, procedure_code, description,
      unit_value_cents, valid_from, valid_until, requires_authorization, copay_kind, created_by)
    values (${c.clinicId}::uuid, ${insurerId}::uuid, ${opts.guideType ?? 'sp_sadt'}, '22', ${code}, ${`Procedimento sintético ${code}`},
      ${cents}, '2026-01-01', ${opts.until ?? null}, ${opts.requiresAuth ?? false}, 'none', ${SYS_ACTOR}::uuid) returning id`;
  return l!.id as string;
}
async function patientWithCard(c: Clinic, label: string) {
  const [p] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
    values (${c.clinicId}::uuid, ${`Paciente ${label}`}, 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`;
  const [m] = await sql`insert into public.hi_memberships (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
    values (${c.clinicId}::uuid, ${p!.id}::uuid, ${c.insurerId}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${randomUUID().replace(/-/g, '').padEnd(64, '0')}, '2345', ${SYS_ACTOR}::uuid) returning id`;
  return { patientId: p!.id as string, membershipId: m!.id as string };
}
const asUser = <T>(c: Clinic, fn: (tx: TxOf) => Promise<T>, userId = c.doctorId) => withTenant(c.clinicId, fn, userId);
const version = async (requestId: string) => Number((await sql`select version from public.hi_sadt_requests where id = ${requestId}::uuid`)[0]!.version);
async function readyRequest(c: Clinic, pt: { patientId: string; membershipId: string }, items: Array<{ code: string; quantity: number }>) {
  const { requestId } = await asUser(c, (tx) =>
    req.createSadtRequestInTx(tx, {
      clinicId: c.clinicId, patientId: pt.patientId, membershipId: pt.membershipId,
      requester: { kind: 'internal', professionalId: c.doctorId }, requestedOn: '2026-11-01', careCharacter: '1', careType: '03',
      items: items.map((i) => ({ tableCode: '22', procedureCode: i.code, quantity: i.quantity })), actorUserId: c.doctorId,
    } as Parameters<typeof req.createSadtRequestInTx>[1]),
  );
  const checked = await asUser(c, async (tx) => req.checkSadtRequestInTx(tx, { clinicId: c.clinicId, requestId, version: await version(requestId), actorUserId: c.doctorId }));
  const rows = await sql`select id, procedure_code from public.hi_sadt_request_items where request_id = ${requestId}::uuid order by sequence`;
  return { requestId, itemIds: rows.map((r) => r.id as string), kind: checked.kind };
}
async function authorize(c: Clinic, requestId: string, quantities: number[]) {
  const items = await sql`select id from public.hi_sadt_request_items where request_id = ${requestId}::uuid order by sequence`;
  await asUser(c, async (tx) => req.recordSadtAuthorizationInTx(tx, {
    decision: 'authorized', clinicId: c.clinicId, requestId, version: await version(requestId), authorizedOn: '2026-11-02',
    operatorGuideNumber: `OP${randomUUID().slice(0, 8)}`, password: 'SENHA987', passwordValidUntil: '2026-12-31',
    items: items.map((it, i) => ({ requestItemId: it.id as string, quantityAuthorized: quantities[i]! })), actorUserId: c.doctorId,
  } as Parameters<typeof req.recordSadtAuthorizationInTx>[1]));
}
let slot = 0;
async function session(c: Clinic, pt: { patientId: string; membershipId: string }, requestItemId: string, day: string, doctorId = c.doctorId) {
  slot += 1;
  const [proc] = await sql`select id from public.procedures where clinic_id = ${c.clinicId}::uuid limit 1`;
  const [a] = await sql`insert into public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
      snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via, billing_mode)
    values (${c.clinicId}::uuid, ${doctorId}::uuid, ${pt.patientId}::uuid, ${proc!.id}::uuid, ${`${day}T13:00:00Z`}::timestamptz + ${slot} * interval '55 minutes', 50, 'agendado', 120,
      'Psicoterapia', 120, 50, 'Profissional sintético', 'attendant', 'convenio') returning id`;
  const appointmentId = a!.id as string;
  await asUser(c, (tx) =>
    recordAppointmentCoverage(tx, {
      clinicId: c.clinicId, appointmentId, patientId: pt.patientId, procedureId: proc!.id as string, appointmentDate: day,
      guideType: 'sp_sadt', insurerId: c.insurerId, planId: null, membershipId: pt.membershipId, authorizationId: null,
      sadtRequestItemId: requestItemId, actor: { kind: 'user', userId: c.doctorId },
    }),
  );
  return appointmentId;
}
async function complete(c: Clinic, appointmentId: string, patientId: string, doctorId = c.doctorId) {
  await sql`insert into public.prontuarios (clinic_id, patient_id, doctor_id, appointment_id, status, signed_at, signed_by, content_encrypted)
    values (${c.clinicId}::uuid, ${patientId}::uuid, ${doctorId}::uuid, ${appointmentId}::uuid, 'assinado', now(), ${doctorId}::uuid, 'ciphertext-sintetico')`;
  await withTenant(c.clinicId, (tx) => applyTransition(tx, {
    clinicId: c.clinicId, appointmentId, target: 'atendido', transitionedBy: doctorId, actorType: 'user',
    clientKey: `concluir-${appointmentId}`, correlationId: null,
  }), doctorId);
  for (let i = 0; i < 4; i++) await runOutboxOnce({ batchSize: 50, parallelism: 1 });
}
/** Resultado de uma operação: 'ok' ou o código (e a constraint, quando há) do erro. */
async function outcome(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'ok';
  } catch (e) {
    if (e instanceof extra.ExtraItemRuleError) return `regra:${e.code}`;
    const err = e as { code?: string; constraint_name?: string; name?: string; message?: string; cause?: { code?: string; constraint_name?: string } };
    if (err.name === 'GuideIssuanceError') return `emissao:${err.message}`;
    const code = err.code ?? err.cause?.code;
    const constraint = err.constraint_name ?? err.cause?.constraint_name;
    if (code) return constraint ? `${code}:${constraint}` : code;
    return `erro:${err.name ?? 'desconhecido'}`;
  }
}
const record = (c: Clinic, appointmentId: string, contractLineId: string, quantity: number, source: 'consultorio' | 'conferencia' = 'conferencia', userId = c.doctorId) =>
  asUser(c, (tx) => extra.recordExtraItemTx(tx, { clinicId: c.clinicId, appointmentId, contractLineId, quantity, source, actorUserId: userId }), userId);
const include = (c: Clinic, itemId: string, confirmed = true) =>
  asUser(c, (tx) => extra.includeExtraItemTx(tx, { clinicId: c.clinicId, itemId, actorUserId: c.doctorId, insurerRuleConfirmed: confirmed }));
const rawInsert = (c: Clinic, appointmentId: string, lineId: string, over: { quantity?: number; description?: string; requiresAuth?: boolean } = {}) =>
  asUser(c, (tx) => tx.execute(q`INSERT INTO public.hi_appointment_extra_items
      (clinic_id, appointment_id, contract_line_id, table_code, procedure_code, description, requires_authorization, quantity, source, recorded_by,
       status, guide_item_id, included_by, included_at, exclusion_reason)
    VALUES (${c.clinicId}::uuid, ${appointmentId}::uuid, ${lineId}::uuid, '22', '99999999', ${over.description ?? 'inventado pelo cliente'},
      ${over.requiresAuth ?? false}, ${over.quantity ?? 1}, 'conferencia', ${SYS_ACTOR}::uuid,
      'included', NULL, ${SYS_ACTOR}::uuid, now(), 'tentativa de decidir no registro')
    RETURNING id::text, procedure_code, description, requires_authorization, recorded_by::text, status, included_by::text, exclusion_reason`));
const guideOf = async (appointmentId: string) =>
  (await sql`select g.id::text, g.status, g.total_value_cents::int as total, g.version,
       (select count(*)::int from public.hi_guide_items i where i.guide_id = g.id) as items
     from public.hi_guides g where g.live and exists (select 1 from public.hi_guide_items i where i.guide_id = g.id and i.appointment_id = ${appointmentId}::uuid)`)[0] ?? null;
const itemRow = async (id: string) =>
  (await sql`select status, guide_item_id::text, authorization_item_id::text, recorded_by::text, regularized_by::text, included_by::text,
       excluded_by::text, exclusion_reason, cancelled_by::text, cancel_reason from public.hi_appointment_extra_items where id = ${id}::uuid`)[0]!;
const decisionOf = async (c: Clinic, appointmentId: string, itemId: string) =>
  (await withTenant(c.clinicId, (tx) => extra.listExtraItemsTx(tx, { clinicId: c.clinicId, appointmentId }))).find((i) => i.id === itemId)!.decision;
const setReviewed = async (c: Clinic, guideId: string) => {
  const [g] = await sql`select version from public.hi_guides where id = ${guideId}::uuid`;
  await asUser(c, (tx) => tx.execute(q`UPDATE public.hi_guides SET status = 'reviewed', reviewed_by = ${c.doctorId}::uuid
    WHERE clinic_id = ${c.clinicId}::uuid AND id = ${guideId}::uuid AND version = ${g!.version}`));
};
const setReturned = async (c: Clinic, guideId: string) => {
  const [g] = await sql`select version from public.hi_guides where id = ${guideId}::uuid`;
  await asUser(c, (tx) => tx.execute(q`UPDATE public.hi_guides SET status = 'ready_for_review', transition_note = 'Devolvida para decidir os itens adicionais'
    WHERE clinic_id = ${c.clinicId}::uuid AND id = ${guideId}::uuid AND version = ${g!.version}`));
};
const consumptions = async (key: string) =>
  (await sql`select coalesce(sum(quantity), 0)::int n, count(*)::int k from public.hi_authorization_consumptions where idempotency_key = ${key}`)[0] as { n: number; k: number };
const authItemOf = async (requestId: string, code: string) =>
  (await sql`select i.id::text, i.quantity_authorized::int auth, i.quantity_consumed::int used from public.hi_authorization_items i
     join public.hi_sadt_requests r on r.authorization_id = i.authorization_id where r.id = ${requestId}::uuid and i.procedure_code = ${code}`)[0]!;
const ledgerDigest = async (clinicId: string) =>
  (await sql`select count(*)::int n, md5(coalesce(string_agg(md5(l::text), ',' order by md5(l::text)), '')) h
     from public.lancamentos l where l.clinic_id = ${clinicId}::uuid`)[0] as { n: number; h: string };
const waitingOnLock = async () => {
  for (let i = 0; i < 200; i++) {
    const [w] = await sql`select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type in ('Lock', 'LWLock') and state = 'active'`;
    if (Number(w!.n) > 0) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};
const setInsurerRule = (c: Clinic, rule: 'unknown' | 'accepts' | 'forbids') =>
  rule === 'unknown'
    ? sql`update public.hi_insurers set settings = coalesce(settings, '{}'::jsonb) - 'extraItemsAfterSession' where id = ${c.insurerId}::uuid`
    : sql`update public.hi_insurers set settings = coalesce(settings, '{}'::jsonb) || ${JSON.stringify({ extraItemsAfterSession: rule })}::jsonb where id = ${c.insurerId}::uuid`;

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  await sql`insert into public.tiss_terms (version_id, table_code, code, term, starts_on)
    select v.id, t.table_code, t.code, t.term, '2010-01-01' from public.tiss_terminology_versions v,
      (values ('22', ${CODE_MAIN}, 'Sessão de psicoterapia individual'), ('22', ${CODE_FREE}, 'Procedimento sintético livre'),
              ('22', ${CODE_AUTH}, 'Procedimento sintético com autorização'), ('22', ${CODE_OLD}, 'Procedimento sintético vencido'),
              ('22', ${CODE_CONF}, 'Procedimento sintético da conferência'), ('22', ${CODE_LATE}, 'Procedimento sintético tardio'),
              ('22', ${CODE_A}, 'Procedimento sintético agendado com autorização'), ('22', ${CODE_B}, 'Procedimento sintético adicional autorizado'),
              ('23', '1', 'Eletiva'), ('23', '2', 'Urgência/Emergência'), ('50', '03', 'Outras terapias')) t(table_code, code, term)
     where v.version = '202609'`;
  const A = await fx.setupClinic('Itens A', { insurers: [{ name: 'Operadora Um', ans: '123456' }, { name: 'Operadora Dois', ans: '654321' }] });
  const B = await fx.setupClinic('Itens B');
  // Segundo profissional da clínica A (exceção do médico: sessão de outra pessoa).
  const otherDoctor = randomUUID();
  await sql`insert into auth.users (id, email) values (${otherDoctor}::uuid, ${`${otherDoctor}@example.invalid`})`;
  await sql`insert into public.profiles (id, clinic_id, nome, role, ativo) values (${otherDoctor}::uuid, ${A.clinicId}::uuid, 'Dr. Outro Sintético', 'doctor', true)`;
  await sql`insert into public.hi_professional_profiles (clinic_id, professional_id, council, council_number, council_uf, cbo)
    values (${A.clinicId}::uuid, ${otherDoctor}::uuid, '06', '54321', '35', '225125')`;
  await sql`insert into public.hi_credentials (clinic_id, insurer_id, plan_id, professional_id, valid_from, status, created_by)
    values (${A.clinicId}::uuid, ${A.insurerId}::uuid, null, ${otherDoctor}::uuid, '2020-01-01', 'active', ${SYS_ACTOR}::uuid)`;

  await contract(A, A.insurerId, CODE_MAIN, 12000);
  const lineFree = await contract(A, A.insurerId, CODE_FREE, 3000);
  const lineAuth = await contract(A, A.insurerId, CODE_AUTH, 5000, { requiresAuth: true });
  const lineOld = await contract(A, A.insurerId, CODE_OLD, 2000, { until: '2026-10-31' });
  const lineConf = await contract(A, A.insurerId, CODE_CONF, 4000);
  const lineLate = await contract(A, A.insurerId, CODE_LATE, 1500);
  await contract(A, A.insurerId, CODE_A, 9000, { requiresAuth: true });
  const lineB = await contract(A, A.insurerId, CODE_B, 2500, { requiresAuth: true });
  const lineOtherInsurer = await contract(A, A.insurerIds[1]!, CODE_FREE, 3100);
  const [consultaLine] = await sql`select id from public.hi_procedure_contracts where clinic_id = ${A.clinicId}::uuid and guide_type = 'consulta' limit 1`;
  const p1 = await patientWithCard(A, 'um');
  const r1 = await readyRequest(A, p1, [{ code: CODE_MAIN, quantity: 3 }]);
  assert.equal(r1.kind, 'ready');
  const ap1 = await session(A, p1, r1.itemIds[0]!, '2026-11-10');

  // ── Registro (regra 1) ────────────────────────────────────────────────
  // 1. Antes da sessão acontecer, não há item "executado".
  assert.equal(await outcome(() => record(A, ap1, lineFree, 1, 'consultorio')), 'regra:APPOINTMENT_NOT_EXECUTED');
  pass('com o atendimento ainda agendado, nenhum item executado é aceito');

  // 2. Em atendimento, registra. O banco copia código, descrição e "exige autorização" da linha e
  // ignora qualquer decisão mandada junto (nasce "registrado", sem guia, sem quem incluiu).
  await sql`update public.appointments set status = 'em_atendimento' where id = ${ap1}::uuid`;
  const { id: e1 } = await record(A, ap1, lineFree, 2, 'consultorio');
  const raw = (await rawInsert(A, ap1, lineAuth, { description: 'descrição inventada', requiresAuth: false })) as unknown as Array<Record<string, unknown>>;
  assert.equal(raw[0]!.procedure_code, CODE_AUTH, 'o código vem da linha, não do cliente');
  assert.equal(raw[0]!.description, `Procedimento sintético ${CODE_AUTH}`, 'a descrição vem da linha');
  assert.equal(raw[0]!.requires_authorization, true, '"exige autorização" vem da linha');
  assert.equal(raw[0]!.recorded_by, A.doctorId, 'quem registrou é a pessoa da sessão');
  assert.deepEqual([raw[0]!.status, raw[0]!.included_by, raw[0]!.exclusion_reason], ['recorded', null, null], 'a decisão não nasce com o registro');
  const eAuthRaw = raw[0]!.id as string;
  pass('em atendimento, o item é registrado como "registrado"; código, descrição, "exige autorização" e autor vêm da linha e da sessão; status, inclusão e motivo mandados pelo cliente são ignorados');

  // 3. Duplicado, repetição idempotente e quantidade.
  assert.equal(await outcome(() => record(A, ap1, lineFree, 1)), 'regra:DUPLICATE', 'outra quantidade do mesmo procedimento');
  const again = await record(A, ap1, lineFree, 2, 'consultorio');
  assert.deepEqual(again, { id: e1, existing: true }, 'a mesma pessoa repetindo o mesmo registro recebe o item que já existe');
  for (const quantity of [0, 1000, 1.5]) assert.equal(await outcome(() => record(A, ap1, lineOld, quantity)), 'regra:QUANTITY_INVALID');
  assert.equal(await outcome(() => rawInsert(A, ap1, lineOld, { quantity: 0 })), '23514:hi_extra_items_quantity_chk');
  const [n3] = await sql`select count(*)::int n from public.hi_appointment_extra_items where appointment_id = ${ap1}::uuid and procedure_code = ${CODE_FREE}`;
  assert.equal(Number(n3!.n), 1);
  pass('o mesmo procedimento não é registrado duas vezes na sessão; a repetição idêntica (duplo clique) devolve o item existente sem duplicar; quantidade fora de 1 a 999 é recusada pelo serviço e pelo banco');

  // 4. Só item de contrato SP/SADT da operadora do atendimento, vigente na data da sessão.
  assert.equal(await outcome(() => record(A, ap1, lineOtherInsurer, 1)), 'regra:CONTRACT_INVALID');
  assert.equal(await outcome(() => rawInsert(A, ap1, lineOtherInsurer)), '23514:hi_extra_item_contract');
  assert.equal(await outcome(() => rawInsert(A, ap1, consultaLine!.id as string)), '23514:hi_extra_item_contract');
  assert.equal(await outcome(() => record(A, ap1, lineOld, 1)), 'regra:CONTRACT_NOT_EFFECTIVE');
  pass('linha de outra operadora ou de Consulta é recusada pelo serviço e pelo banco; linha fora de vigência na data da sessão é recusada pelo serviço');

  // 5. Sem a pessoa da sessão, nada é gravado nem mudado.
  assert.equal(await outcome(() => withTenant(A.clinicId, (tx) => tx.execute(q`INSERT INTO public.hi_appointment_extra_items
      (clinic_id, appointment_id, contract_line_id, table_code, procedure_code, description, requires_authorization, quantity, source, recorded_by)
    VALUES (${A.clinicId}::uuid, ${ap1}::uuid, ${lineOld}::uuid, '22', '1', 'x', false, 1, 'conferencia', ${SYS_ACTOR}::uuid)`))), '42501');
  assert.equal(await outcome(() => withTenant(A.clinicId, (tx) => tx.execute(q`UPDATE public.hi_appointment_extra_items
      SET status = 'excluded', exclusion_reason = 'sem pessoa da sessão' WHERE id = ${e1}::uuid`))), '42501');
  pass('sem a pessoa da sessão, o banco recusa registrar e decidir (42501)');

  // 6. Exceção do médico: só na PRÓPRIA sessão, conferido no servidor.
  const apOther = await session(A, p1, r1.itemIds[0]!, '2026-11-10', otherDoctor);
  await sql`update public.appointments set status = 'em_atendimento' where id = ${apOther}::uuid`;
  assert.equal(await outcome(() => asUser(A, (tx) => extra.assertOwnSessionTx(tx, { clinicId: A.clinicId, appointmentId: apOther, userId: A.doctorId }))), 'regra:NOT_OWN_SESSION');
  assert.equal(await outcome(() => asUser(A, (tx) => extra.assertOwnSessionTx(tx, { clinicId: A.clinicId, appointmentId: ap1, userId: otherDoctor }), otherDoctor)), 'regra:NOT_OWN_SESSION');
  assert.equal(await outcome(() => asUser(A, (tx) => extra.assertOwnSessionTx(tx, { clinicId: A.clinicId, appointmentId: apOther, userId: otherDoctor }), otherDoctor)), 'ok');
  assert.equal(await outcome(() => withTenant(B.clinicId, (tx) => extra.assertOwnSessionTx(tx, { clinicId: B.clinicId, appointmentId: ap1, userId: A.doctorId }), B.doctorId)), 'regra:APPOINTMENT_NOT_FOUND');
  const { id: eOwn } = await record(A, apOther, lineFree, 1, 'consultorio', otherDoctor);
  assert.equal((await itemRow(eOwn)).recorded_by, otherDoctor);
  await asUser(A, (tx) => extra.cancelExtraItemTx(tx, { clinicId: A.clinicId, itemId: eOwn, reason: 'Prova da exceção do médico' }));
  pass('exceção do médico: a posse do atendimento é conferida no servidor (sessão de outro profissional e de outra clínica recusadas); na própria sessão, o registro grava o médico como autor');

  // 7. Cancelar o REGISTRO errado: só com motivo; final; o fato não muda; nada é apagado.
  assert.equal(await outcome(() => asUser(A, (tx) => extra.cancelExtraItemTx(tx, { clinicId: A.clinicId, itemId: e1, reason: 'x' }))), 'regra:REASON_REQUIRED');
  assert.equal(await outcome(() => asUser(A, (tx) => tx.execute(q`UPDATE public.hi_appointment_extra_items SET quantity = 5 WHERE id = ${e1}::uuid`))), '23514:hi_extra_item_immutable');
  await asUser(A, (tx) => extra.cancelExtraItemTx(tx, { clinicId: A.clinicId, itemId: e1, reason: 'Registrado na sessão errada' }));
  const c1 = await itemRow(e1);
  assert.deepEqual([c1.status, c1.cancelled_by, c1.cancel_reason], ['cancelled', A.doctorId, 'Registrado na sessão errada']);
  assert.equal(await outcome(() => asUser(A, (tx) => extra.cancelExtraItemTx(tx, { clinicId: A.clinicId, itemId: e1, reason: 'De novo, por engano' }))), 'regra:ALREADY_CANCELLED');
  assert.equal(await outcome(() => asUser(A, (tx) => tx.execute(q`UPDATE public.hi_appointment_extra_items SET status = 'recorded', cancelled_by = NULL, cancelled_at = NULL, cancel_reason = NULL WHERE id = ${e1}::uuid`))), '23514:hi_extra_item_closed');
  assert.equal(await outcome(() => asUser(A, (tx) => tx.execute(q`DELETE FROM public.hi_appointment_extra_items WHERE id = ${e1}::uuid`))), '42501');
  const { id: eFree } = await record(A, ap1, lineFree, 2);
  pass('cancelar exige motivo e grava quem cancelou; cancelado não volta nem pelo banco; quantidade não muda por edição; o runtime não apaga; depois do cancelamento o procedimento pode ser registrado de novo');

  // ── Guia, regra 2 e regra 5 ───────────────────────────────────────────
  // 8. Conclusão: a guia nasce SÓ com o agendado; os adicionais ficam pendentes, nada entra sozinho.
  await complete(A, ap1, p1.patientId);
  const g1 = await guideOf(ap1);
  assert.ok(g1, 'a guia da sessão existe');
  assert.deepEqual([g1!.status, g1!.items, g1!.total], ['ready_for_review', 1, 12000], 'nenhum item adicional entrou na guia');
  const dFree = await decisionOf(A, ap1, eFree);
  assert.deepEqual([dFree.stage, dFree.pending, dFree.canInclude, dFree.includeNeedsInsurerConfirmation], ['ready_to_include', true, true, true]);
  const dAuthNoReq = await decisionOf(A, ap1, eAuthRaw);
  assert.deepEqual([dAuthNoReq.stage, dAuthNoReq.canRegularize, dAuthNoReq.canInclude], ['awaiting_authorization', false, false]);
  assert.equal(await outcome(() => asUser(A, (tx) => extra.regularizeExtraItemTx(tx, { clinicId: A.clinicId, itemId: eAuthRaw }))), 'regra:AUTHORIZATION_INVALID', 'a solicitação da sessão não tem autorização');
  assert.equal(await outcome(() => include(A, eAuthRaw)), 'regra:NOT_INCLUDABLE', 'exige autorização: não entra sem ligar uma');
  pass('na conclusão, a guia nasce só com o agendado (12.000 centavos, 1 linha); o adicional sem exigência fica "aguardando decisão do faturamento" (regra da operadora desconhecida pede confirmação); o que exige autorização sem autorização na solicitação não é ligado nem incluído');

  // 9. Regra 5: com item pendente, a aprovação é recusada (nada muda).
  await asUser(A, async (tx) => req.setClinicalIndicationInTx(tx, { clinicId: A.clinicId, requestId: r1.requestId, version: await version(r1.requestId), text: 'Indicação sintética de teste.', actorUserId: A.doctorId }));
  await setReviewed(A, g1!.id as string);
  const issue1 = (tx: TxOf, guideId: string, membershipId = p1.membershipId) => issueSpSadtGuide(tx, {
    clinicId: A.clinicId, guideId, card: { membershipId, cardNumber: SYNTHETIC_CARD, auditEventId: randomUUID() },
    newborn: false, professionalName: 'Dra. Sintética', actorUserId: A.doctorId, today: '2026-11-15',
  });
  const blockedApproval = await outcome(() => asUser(A, (tx) => issue1(tx, g1!.id as string)));
  assert.match(blockedApproval, /^emissao:Há 2 itens executados adicionais pendentes/u);
  const [g1after] = await sql`select status, approved_snapshot_id from public.hi_guides where id = ${g1!.id}::uuid`;
  assert.deepEqual([g1after!.status, g1after!.approved_snapshot_id], ['reviewed', null]);
  const [snaps] = await sql`select count(*)::int n from public.hi_guide_snapshots where guide_id = ${g1!.id}::uuid`;
  assert.equal(Number(snaps!.n), 0);
  pass('regra 5: guia conferida com 2 itens adicionais pendentes não é aprovada ("inclua o item ou aprove sem ele, informando o motivo"); sem snapshot, a guia segue conferida');

  // 10. Incluir exige a guia em edição e a decisão sobre a regra da operadora (regra 7).
  assert.equal(await outcome(() => include(A, eFree)), 'regra:GUIDE_NOT_OPEN', 'conferida: só devolvendo para correção');
  await setReturned(A, g1!.id as string);
  assert.equal(await outcome(() => include(A, eFree, false)), 'regra:INSURER_CONFIRMATION_REQUIRED');
  await setInsurerRule(A, 'forbids');
  assert.equal(await outcome(() => include(A, eFree, true)), 'regra:INSURER_FORBIDS', 'proibição registrada vale mesmo com a confirmação');
  assert.equal((await decisionOf(A, ap1, eFree)).stage, 'insurer_forbids');
  await setInsurerRule(A, 'unknown');
  const [gi0] = await sql`select count(*)::int n from public.hi_guide_items where guide_id = ${g1!.id}::uuid`;
  assert.equal(Number(gi0!.n), 1, 'nada entrou na guia');
  pass('incluir: guia conferida é recusada (devolver para correção); regra da operadora desconhecida exige a confirmação do contrato; proibição registrada recusa mesmo confirmada; a guia segue com 1 linha');

  // 11. Regra 4: inclusão explícita do faturamento (sem exigência de autorização).
  const ledgerBeforeInclude = await ledgerDigest(A.clinicId);
  const inc = await include(A, eFree, true);
  assert.equal(inc.existing, false);
  const g1i = await guideOf(ap1);
  assert.deepEqual([g1i!.status, g1i!.items, g1i!.total], ['ready_for_review', 2, 12000 + 2 * 3000]);
  const [gl] = await sql`select quantity, unit_value_cents::int unit, total_value_cents::int total, contract_line_id::text line, authorization_item_id from public.hi_guide_items where id = ${inc.guideItemId}::uuid`;
  assert.deepEqual([gl!.quantity, gl!.unit, gl!.total, gl!.line, gl!.authorization_item_id], [2, 3000, 6000, lineFree, null]);
  const eFreeRow = await itemRow(eFree);
  assert.deepEqual([eFreeRow.status, eFreeRow.guide_item_id, eFreeRow.included_by], ['included', inc.guideItemId, A.doctorId]);
  assert.deepEqual(await include(A, eFree, true), { guideId: inc.guideId, guideItemId: inc.guideItemId, existing: true }, 'repetir a inclusão não duplica');
  assert.equal((await guideOf(ap1))!.items, 2);
  assert.deepEqual(await ledgerDigest(A.clinicId), ledgerBeforeInclude, 'antes do envio não há recebível novo');
  pass('regra 4: "Incluir na guia" pelo faturamento põe uma linha nova com a quantidade (2) e o valor do contrato vigente (3.000 cada), soma o total da guia (18.000), grava quem incluiu; repetir devolve a mesma linha; o livro não muda antes do envio');

  // 12. O banco só aceita "incluído" apontando para a linha certa da guia (sem atalho pelo cliente).
  const { id: eConf } = await record(A, ap1, lineConf, 3);
  const [mainLine] = await sql`select id from public.hi_guide_items where guide_id = ${g1!.id}::uuid and procedure_code = ${CODE_MAIN}`;
  assert.equal(await outcome(() => asUser(A, (tx) => tx.execute(q`UPDATE public.hi_appointment_extra_items SET status = 'included', guide_item_id = ${mainLine!.id}::uuid WHERE id = ${eConf}::uuid`))), '23514:hi_extra_item_guide_item');
  assert.equal(await outcome(() => asUser(A, (tx) => tx.execute(q`UPDATE public.hi_appointment_extra_items SET status = 'included', guide_item_id = ${inc.guideItemId}::uuid WHERE id = ${eConf}::uuid`))), '23514:hi_extra_item_guide_item');
  assert.equal(await outcome(() => asUser(A, (tx) => tx.execute(q`UPDATE public.hi_appointment_extra_items SET status = 'regularized' WHERE id = ${eConf}::uuid`))), '23514:hi_extra_item_transition');
  assert.equal(await outcome(() => asUser(A, (tx) => tx.execute(q`UPDATE public.hi_appointment_extra_items SET status = 'included', guide_item_id = NULL WHERE id = ${eConf}::uuid`))), '23514:hi_extra_item_guide_item');
  assert.equal((await itemRow(eConf)).status, 'recorded');
  pass('transições inválidas recusadas pelo banco: "incluído" apontando a linha agendada, a linha de outro item ou nenhuma linha; "regularizado" sem exigência de autorização; o item segue registrado');

  // 13. Regra 6: não faturar exige motivo; o registro fica; nada vai à guia; decidido não muda.
  assert.equal(await outcome(() => asUser(A, (tx) => extra.excludeExtraItemTx(tx, { clinicId: A.clinicId, itemId: eConf, reason: 'curto' }))), 'regra:REASON_REQUIRED');
  assert.equal(await outcome(() => asUser(A, (tx) => tx.execute(q`UPDATE public.hi_appointment_extra_items SET status = 'excluded', exclusion_reason = 'curto' WHERE id = ${eConf}::uuid`))), '23514:hi_extra_items_reasons_chk');
  await asUser(A, (tx) => extra.excludeExtraItemTx(tx, { clinicId: A.clinicId, itemId: eConf, reason: 'Operadora não aceita este procedimento sem pedido' }));
  const ex = await itemRow(eConf);
  assert.deepEqual([ex.status, ex.excluded_by, ex.exclusion_reason, ex.guide_item_id], ['excluded', A.doctorId, 'Operadora não aceita este procedimento sem pedido', null]);
  assert.equal(await outcome(() => include(A, eConf)), 'regra:ALREADY_DECIDED');
  assert.equal(await outcome(() => asUser(A, (tx) => extra.cancelExtraItemTx(tx, { clinicId: A.clinicId, itemId: eConf, reason: 'Cancelar depois de decidir' }))), 'regra:ALREADY_DECIDED');
  assert.equal(await outcome(() => asUser(A, (tx) => tx.execute(q`UPDATE public.hi_appointment_extra_items SET status = 'recorded', excluded_by = NULL, excluded_at = NULL, exclusion_reason = NULL WHERE id = ${eConf}::uuid`))), '23514:hi_extra_item_closed');
  assert.deepEqual([(await guideOf(ap1))!.items, (await guideOf(ap1))!.total], [2, 18000]);
  assert.equal(await outcome(() => record(A, ap1, lineConf, 3)), 'regra:DUPLICATE', 'o não faturado continua sendo o registro deste procedimento na sessão');
  pass('regra 6: "não faturar" exige motivo (10 a 300), grava quem e quando, fica fora da guia; decidido não volta (serviço e banco) e continua sendo o registro do procedimento na sessão');

  // ── Regra 3: autorização, saldo, consumo uma vez ────────────────────────
  // 14. Adicional autorizado na MESMA solicitação: ligar (recepção), incluir (consome o saldo uma vez).
  await setInsurerRule(A, 'accepts');
  const p4 = await patientWithCard(A, 'quatro');
  const r4 = await readyRequest(A, p4, [{ code: CODE_A, quantity: 2 }, { code: CODE_B, quantity: 2 }]);
  assert.equal(r4.kind, 'awaiting_authorization');
  const ap4 = await session(A, p4, r4.itemIds[0]!, '2026-11-12');
  await sql`update public.appointments set status = 'em_atendimento' where id = ${ap4}::uuid`;
  const { id: eB } = await record(A, ap4, lineB, 2);
  assert.equal((await decisionOf(A, ap4, eB)).stage, 'awaiting_authorization', 'ainda sem autorização da operadora');
  assert.equal(await outcome(() => asUser(A, (tx) => extra.regularizeExtraItemTx(tx, { clinicId: A.clinicId, itemId: eB }))), 'regra:AUTHORIZATION_INVALID');
  await authorize(A, r4.requestId, [2, 2]);
  const dB = await decisionOf(A, ap4, eB);
  assert.deepEqual([dB.stage, dB.canRegularize, dB.canInclude], ['authorization_available', true, false]);
  await asUser(A, (tx) => extra.regularizeExtraItemTx(tx, { clinicId: A.clinicId, itemId: eB }));
  const aiB = await authItemOf(r4.requestId, CODE_B);
  const regB = await itemRow(eB);
  assert.deepEqual([regB.status, regB.authorization_item_id, regB.regularized_by], ['regularized', aiB.id, A.doctorId]);
  assert.equal(aiB.used, 0, 'ligar a autorização não consome saldo');
  await complete(A, ap4, p4.patientId);
  const g4 = await guideOf(ap4);
  assert.deepEqual([g4!.items, g4!.total], [1, 9000]);
  const inc4 = await include(A, eB, false);
  const g4i = await guideOf(ap4);
  assert.deepEqual([g4i!.items, g4i!.total], [2, 9000 + 2 * 2500]);
  assert.deepEqual(await consumptions(`extra:${eB}`), { n: 2, k: 1 });
  assert.equal((await authItemOf(r4.requestId, CODE_B)).used, 2);
  const [gl4] = await sql`select authorization_item_id::text a, quantity from public.hi_guide_items where id = ${inc4.guideItemId}::uuid`;
  assert.deepEqual([gl4!.a, gl4!.quantity], [aiB.id, 2]);
  assert.deepEqual((await include(A, eB, false)).existing, true);
  assert.deepEqual(await consumptions(`extra:${eB}`), { n: 2, k: 1 }, 'repetir a inclusão não consome de novo');
  pass('regra 3: adicional autorizado na mesma solicitação — sem autorização, não liga; com a autorização concedida, a recepção liga (sem consumir); na guia, a inclusão consome o saldo exato (2 de 2) uma vez, com a autorização na linha; repetir não consome de novo; operadora "aceita" dispensa a confirmação');

  // 15. Saldo esgotado e a conclusão de outra sessão do mesmo item: pendência, nunca acima do autorizado.
  const ap4b = await session(A, p4, r4.itemIds[1]!, '2026-11-13');
  await sql`update public.appointments set status = 'em_atendimento' where id = ${ap4b}::uuid`;
  await complete(A, ap4b, p4.patientId);
  assert.equal(await guideOf(ap4b), null, 'a sessão do procedimento B não vira guia: o saldo de B acabou (consumido pelo adicional)');
  const [ev4b] = await sql`select count(*)::int n from public.outbox where clinic_id = ${A.clinicId}::uuid and status not in ('processed', 'skipped')`;
  assert.equal(Number(ev4b!.n), 0, 'a conclusão não derrubou o outbox (pendência com responsável, não erro)');
  const ap4c = await session(A, p4, r4.itemIds[0]!, '2026-11-14');
  await sql`update public.appointments set status = 'em_atendimento' where id = ${ap4c}::uuid`;
  const { id: eB2 } = await record(A, ap4c, lineB, 1);
  const dB2 = await decisionOf(A, ap4c, eB2);
  assert.equal(dB2.stage, 'awaiting_authorization');
  assert.match(dB2.message, /saldo autorizado \(0\)/u);
  assert.equal(await outcome(() => asUser(A, (tx) => extra.regularizeExtraItemTx(tx, { clinicId: A.clinicId, itemId: eB2 }))), 'regra:AUTHORIZATION_INVALID');
  assert.equal(await outcome(() => asUser(A, (tx) => tx.execute(q`UPDATE public.hi_appointment_extra_items SET status = 'regularized', authorization_item_id = ${aiB.id}::uuid WHERE id = ${eB2}::uuid`))), '23514:hi_extra_item_authorization');
  pass('saldo esgotado: outra sessão do mesmo procedimento vira pendência (sem guia e sem erro no outbox); outro adicional não é ligado ("saldo autorizado (0)"), nem pelo serviço nem direto no banco');

  // 16. Autorização cancelada depois de ligada: a inclusão é recusada, nada consumido.
  const p5 = await patientWithCard(A, 'cinco');
  const r5 = await readyRequest(A, p5, [{ code: CODE_A, quantity: 2 }, { code: CODE_B, quantity: 1 }]);
  await authorize(A, r5.requestId, [2, 1]);
  const ap5 = await session(A, p5, r5.itemIds[0]!, '2026-11-12');
  await sql`update public.appointments set status = 'em_atendimento' where id = ${ap5}::uuid`;
  const { id: eB5 } = await record(A, ap5, lineB, 1);
  await asUser(A, (tx) => extra.regularizeExtraItemTx(tx, { clinicId: A.clinicId, itemId: eB5 }));
  await complete(A, ap5, p5.patientId);
  const [auth5] = await sql`select authorization_id::text a from public.hi_sadt_requests where id = ${r5.requestId}::uuid`;
  await sql`update public.hi_authorizations set status = 'cancelled' where id = ${auth5!.a}::uuid`;
  assert.equal((await decisionOf(A, ap5, eB5)).stage, 'authorization_invalid');
  assert.equal(await outcome(() => include(A, eB5)), 'regra:AUTHORIZATION_INVALID');
  assert.deepEqual(await consumptions(`extra:${eB5}`), { n: 0, k: 0 });
  assert.equal((await guideOf(ap5))!.items, 1);
  pass('autorização cancelada depois de ligada: o item fica "autorização não serve mais", a inclusão é recusada, nada é consumido e a guia não muda');

  // ── Regra 5: "aprovar sem o item" atômico ───────────────────────────────
  // 17. Falha na emissão desfaz a exclusão; com a emissão certa, os pendentes ficam "não faturados".
  await asUser(A, async (tx) => req.setClinicalIndicationInTx(tx, { clinicId: A.clinicId, requestId: r5.requestId, version: await version(r5.requestId), text: 'Indicação sintética de teste.', actorUserId: A.doctorId }));
  const g5 = await guideOf(ap5);
  await setReviewed(A, g5!.id as string);
  const approveWithout = (membershipId: string) => asUser(A, async (tx) => {
    await tx.execute(q`SELECT id FROM public.hi_guides WHERE clinic_id = ${A.clinicId}::uuid AND id = ${g5!.id}::uuid FOR UPDATE`);
    const ids = await extra.excludePendingExtraItemsForGuideTx(tx, { clinicId: A.clinicId, guideId: g5!.id as string, reason: 'Operadora cancelou a autorização' });
    await issueSpSadtGuide(tx, { clinicId: A.clinicId, guideId: g5!.id as string, card: { membershipId, cardNumber: SYNTHETIC_CARD, auditEventId: randomUUID() },
      newborn: false, professionalName: 'Dra. Sintética', actorUserId: A.doctorId, today: '2026-11-15' });
    return ids;
  });
  assert.match(await outcome(() => approveWithout(p1.membershipId)), /^emissao:a carteirinha lida não é a da guia/u);
  assert.equal((await itemRow(eB5)).status, 'regularized', 'a emissão falhou: a exclusão foi desfeita junto');
  assert.equal(await outcome(() => asUser(A, (tx) => extra.excludePendingExtraItemsForGuideTx(tx, { clinicId: A.clinicId, guideId: g5!.id as string, reason: 'curto' }))), 'regra:REASON_REQUIRED');
  const excludedIds = await approveWithout(p5.membershipId);
  assert.deepEqual(excludedIds, [eB5]);
  const [g5a] = await sql`select status, approved_snapshot_id from public.hi_guides where id = ${g5!.id}::uuid`;
  assert.equal(g5a!.status, 'approved');
  assert.ok(g5a!.approved_snapshot_id);
  const ex5 = await itemRow(eB5);
  assert.deepEqual([ex5.status, ex5.exclusion_reason, ex5.excluded_by], ['excluded', 'Operadora cancelou a autorização', A.doctorId]);
  assert.equal(await outcome(() => asUser(A, (tx) => extra.excludeExtraItemTx(tx, { clinicId: A.clinicId, itemId: eB2, reason: 'Sessão ainda sem guia, sem saldo' }))), 'ok', 'sessão sem guia: não faturar é aceito');
  pass('"aprovar sem o item": a exclusão dos pendentes e a emissão são uma transação — falhando a emissão, o item volta a pendente; com a carteirinha certa, a guia é aprovada (snapshot) e o item fica "não faturado por decisão", com motivo e autor');

  // 18. Guia aprovada: nada entra, sai ou muda (a mudança é pela substituição da P7.5).
  assert.equal(await outcome(() => record(A, ap5, lineLate, 1)), 'regra:GUIDE_CLOSED');
  assert.equal(await outcome(() => asUser(A, (tx) => tx.execute(q`UPDATE public.hi_appointment_extra_items SET status = 'recorded' WHERE id = ${eB5}::uuid`))), '23514:hi_extra_item_closed');
  pass('guia aprovada: o banco recusa registrar item novo na sessão e mudar o item decidido (a mudança passa pela substituição P7.5)');

  // ── XML e recebível: só o agendado + o incluído ─────────────────────────
  // 19. Emite a guia da sessão 1 (agendado + incluído; o não faturado fica fora) e o lote vai ao XSD.
  const dPend1 = (await withTenant(A.clinicId, (tx) => extra.listExtraItemsTx(tx, { clinicId: A.clinicId, appointmentId: ap1 }))).filter((i) => i.decision.pending);
  assert.deepEqual(dPend1.map((i) => i.id), [eAuthRaw], 'o único pendente da sessão 1 é o que exige autorização sem autorização');
  await asUser(A, (tx) => extra.excludeExtraItemTx(tx, { clinicId: A.clinicId, itemId: eAuthRaw, reason: 'Solicitação sem autorização para este procedimento' }));
  await setReviewed(A, g1!.id as string);
  await asUser(A, (tx) => issue1(tx, g1!.id as string));
  const batchId = await fx.createBatch(A, [g1!.id as string], { guideType: 'sp_sadt' });
  const exported = await fx.exportBatch(A, batchId);
  assert.equal(exported.kind, 'exported');
  const [file] = await sql`select storage_ref from public.hi_files where kind = 'batch_xml' and batch_id = ${batchId}::uuid`;
  const cipher = Buffer.from(objects.get(file!.storage_ref as string)!).toString('utf8');
  const xml = Buffer.from(await decryptForTenant(A.clinicId, cipher), 'base64').toString('utf8');
  const codes = [...xml.matchAll(/codigoProcedimento>\s*([0-9]+)\s*</gu)].map((m) => m[1]);
  assert.deepEqual([...new Set(codes)].sort(), [CODE_FREE, CODE_MAIN].sort(), `procedimentos no XML: ${codes.join(',')}`);
  for (const c of [CODE_AUTH, CODE_CONF, CODE_LATE]) assert.ok(!xml.includes(`>${c}<`), `o item ${c} (não faturado ou pendente) não vai ao XML`);
  const freeBlock = xml.slice(xml.indexOf(`>${CODE_FREE}<`));
  assert.match(freeBlock.slice(0, 600), /quantidadeExecutada>\s*2\s*</u, 'a quantidade do adicional vai ao XML');
  pass(`XML do lote (validado no XSD oficial, decifrado): leva o agendado (${CODE_MAIN}) e o adicional incluído (${CODE_FREE}, quantidade 2); o não faturado e o pendente não vão`);

  // 20. Recebível = valor da guia (agendado + incluído); a fórmula do livro não muda.
  let v = await fx.batchVersion(batchId);
  v = await fx.asUser(A, (tx) => fx.batches.markBatchSentInTx(tx, { clinicId: A.clinicId, batchId, version: v, channel: 'manual', sentOn: '2026-11-16', evidence: 'Enviado pelo portal da operadora, comprovante sintético' }));
  const [recv] = await sql`select count(*)::int n, coalesce(sum(valor), 0)::numeric(12,2)::text total,
       coalesce(sum(valor - valor_pago - valor_glosado), 0)::numeric(12,2)::text aberto
     from public.lancamentos where clinic_id = ${A.clinicId}::uuid and tipo = 'receber' and source_hi_guide_id = ${g1!.id}::uuid`;
  assert.deepEqual([Number(recv!.n), recv!.total, recv!.aberto], [1, '180.00', '180.00']);
  const [gTot] = await sql`select total_value_cents::int t, (select sum(total_value_cents)::int from public.hi_guide_items where guide_id = ${g1!.id}::uuid) s from public.hi_guides where id = ${g1!.id}::uuid`;
  assert.deepEqual([gTot!.t, gTot!.s], [18000, 18000]);
  pass('recebível da guia enviada: 1 lançamento de 180,00 = agendado (120,00) + adicional incluído (2 × 30,00); total da guia = soma das linhas; em aberto = valor − valorPago − valorGlosado');

  // ── Concorrência ────────────────────────────────────────────────────────
  const p6 = await patientWithCard(A, 'seis');
  const r6 = await readyRequest(A, p6, [{ code: CODE_MAIN, quantity: 3 }]);
  const ap6 = await session(A, p6, r6.itemIds[0]!, '2026-11-13');
  const ap7 = await session(A, p6, r6.itemIds[0]!, '2026-11-14');
  await sql`update public.appointments set status = 'em_atendimento' where id in (${ap6}::uuid, ${ap7}::uuid)`;
  // 21. Dois registros simultâneos do mesmo procedimento (pessoas diferentes): um grava.
  const race = await Promise.all([
    outcome(() => record(A, ap6, lineConf, 1)),
    outcome(() => record(A, ap6, lineConf, 1, 'conferencia', otherDoctor)),
  ]);
  assert.deepEqual([...race].sort(), ['ok', 'regra:DUPLICATE']);
  const [act6] = await sql`select count(*)::int n from public.hi_appointment_extra_items where appointment_id = ${ap6}::uuid and procedure_code = ${CODE_CONF}`;
  assert.equal(Number(act6!.n), 1);
  pass('dois registros simultâneos do mesmo procedimento na mesma sessão: um grava, o outro recebe "já registrado" (índice único); um item só');

  // 22. Duas inclusões simultâneas do mesmo item: uma linha e um consumo.
  const { id: e6 } = await (async () => {
    const [x] = await sql`select id::text from public.hi_appointment_extra_items where appointment_id = ${ap6}::uuid and procedure_code = ${CODE_CONF}`;
    return { id: x!.id as string };
  })();
  await complete(A, ap6, p6.patientId);
  const incRace = await Promise.all([1, 2].map(() => include(A, e6).then((r) => (r.existing ? 'existente' : 'nova'))));
  assert.deepEqual([...incRace].sort(), ['existente', 'nova']);
  const [lines6] = await sql`select count(*)::int n from public.hi_guide_items where appointment_id = ${ap6}::uuid and procedure_code = ${CODE_CONF}`;
  assert.equal(Number(lines6!.n), 1);
  pass('duas inclusões simultâneas do mesmo item: uma cria a linha, a outra espera e recebe a mesma (trava da guia e do item); uma linha só na guia');

  // 23. Inclusão × conferência, nas duas ordens.
  const g6 = await guideOf(ap6);
  // (a) a conferência fecha primeiro e segura: a inclusão espera e, liberada, lê "não está em edição".
  const { id: e7 } = await record(A, ap7, lineLate, 1);
  await complete(A, ap7, p6.patientId);
  const g7 = await guideOf(ap7);
  let releaseA!: () => void;
  const heldA = new Promise<void>((r) => (releaseA = r));
  let closedA!: () => void;
  const isClosedA = new Promise<void>((r) => (closedA = r));
  const closingA = asUser(A, async (tx) => {
    const [g] = await sql`select version from public.hi_guides where id = ${g7!.id}::uuid`;
    await tx.execute(q`UPDATE public.hi_guides SET status = 'reviewed', reviewed_by = ${A.doctorId}::uuid WHERE id = ${g7!.id}::uuid AND version = ${g!.version}`);
    closedA();
    await heldA;
  });
  await isClosedA;
  const includingA = outcome(() => include(A, e7));
  const waitedA = await waitingOnLock();
  releaseA();
  await closingA;
  assert.equal(waitedA, true, 'a inclusão deveria esperar a conferência em andamento');
  assert.equal(await includingA, 'regra:GUIDE_NOT_OPEN');
  assert.equal((await guideOf(ap7))!.items, 1);
  // (b) a inclusão grava primeiro e segura: a conferência espera e, liberada, vê a guia mudada (versão nova).
  const { id: e6b } = await (async () => {
    await sql`update public.appointments set status = 'atendido' where id = ${ap6}::uuid`;
    return record(A, ap6, lineLate, 1);
  })();
  const v6 = Number((await sql`select version from public.hi_guides where id = ${g6!.id}::uuid`)[0]!.version);
  let releaseB!: () => void;
  const heldB = new Promise<void>((r) => (releaseB = r));
  let includedB!: () => void;
  const isIncludedB = new Promise<void>((r) => (includedB = r));
  const includingB = asUser(A, async (tx) => {
    await extra.includeExtraItemTx(tx, { clinicId: A.clinicId, itemId: e6b, actorUserId: A.doctorId, insurerRuleConfirmed: true });
    includedB();
    await heldB;
  });
  await isIncludedB;
  const reviewingB = asUser(A, (tx) => tx.execute(q`UPDATE public.hi_guides SET status = 'reviewed', reviewed_by = ${A.doctorId}::uuid
    WHERE id = ${g6!.id}::uuid AND version = ${v6} RETURNING id`));
  const waitedB = await waitingOnLock();
  releaseB();
  await includingB;
  const reviewed = (await reviewingB) as unknown as unknown[];
  assert.equal(waitedB, true, 'a conferência deveria esperar a inclusão em andamento');
  assert.equal(reviewed.length, 0, 'a conferência da versão antiga não passa: a guia mudou');
  const g6after = await guideOf(ap6);
  assert.deepEqual([g6after!.status, g6after!.items], ['ready_for_review', 3]);
  pass('inclusão × conferência: com a conferência primeiro, a inclusão espera e é recusada (guia não está em edição); com a inclusão primeiro, a conferência espera e não passa sobre a versão antiga (a guia mudou), sem conferir conteúdo que não viu');

  // 24. Registro × conferência (trava FOR SHARE da guia), como na versão de 23/11.
  let releaseC!: () => void;
  const heldC = new Promise<void>((r) => (releaseC = r));
  let closedC!: () => void;
  const isClosedC = new Promise<void>((r) => (closedC = r));
  const closingC = asUser(A, async (tx) => {
    const [g] = await sql`select version from public.hi_guides where id = ${g6!.id}::uuid`;
    await tx.execute(q`UPDATE public.hi_guides SET status = 'reviewed', reviewed_by = ${A.doctorId}::uuid WHERE id = ${g6!.id}::uuid AND version = ${g!.version}`);
    closedC();
    await heldC;
  });
  await isClosedC;
  const recordingC = outcome(() => record(A, ap6, lineAuth, 1));
  const waitedC = await waitingOnLock();
  releaseC();
  await closingC;
  assert.equal(waitedC, true);
  assert.equal(await recordingC, 'regra:GUIDE_CLOSED');
  pass('registro × conferência: com a conferência em andamento, o registro espera e é recusado ("guia fechada"), sem item');

  // ── Guia cancelada: o incluído volta a ser pendência e entra na guia nova sem consumir de novo ──
  // 25.
  const g4c = await guideOf(ap4);
  await asUser(A, (tx) => tx.execute(q`UPDATE public.hi_guides SET status = 'cancelled', cancel_reason = 'Guia emitida com erro de cadastro', cancelled_by = ${A.doctorId}::uuid
    WHERE id = ${g4c!.id}::uuid AND version = ${g4c!.version}`));
  assert.equal((await decisionOf(A, ap4, eB)).stage, 'included_in_dead_guide');
  await withTenant(A.clinicId, (tx) => processInsuranceBilling(tx, { clinicId: A.clinicId, appointmentId: ap4, detectedBy: 'event', eventState: 'processed', lock: 'wait' }));
  const g4n = await guideOf(ap4);
  assert.ok(g4n && g4n.id !== g4c!.id, 'a sessão ganhou guia nova');
  assert.deepEqual([g4n!.items, g4n!.total], [1, 9000]);
  const reinc = await include(A, eB, false);
  assert.equal(reinc.existing, false);
  assert.deepEqual([(await guideOf(ap4))!.items, (await guideOf(ap4))!.total], [2, 14000]);
  assert.deepEqual(await consumptions(`extra:${eB}`), { n: 2, k: 1 }, 'o saldo não é consumido de novo');
  assert.equal((await authItemOf(r4.requestId, CODE_B)).used, 2);
  assert.equal((await decisionOf(A, ap4, eB)).stage, 'included');
  pass('guia cancelada: o adicional incluído volta a ser pendência; na guia nova da sessão ele entra de novo (2 linhas, 140,00) sem consumir o saldo outra vez (2 de 2, um consumo)');

  // ── Isolamento, comercial, módulo, reprocessamento, indisponível ────────
  // 26. Comercial primeiro, depois o módulo (registro e decisão pelo serviço).
  const p8 = await patientWithCard(A, 'oito');
  const r8 = await readyRequest(A, p8, [{ code: CODE_MAIN, quantity: 1 }]);
  const ap8 = await session(A, p8, r8.itemIds[0]!, '2026-11-11');
  await sql`update public.appointments set status = 'em_atendimento' where id = ${ap8}::uuid`;
  await sql`update public.hi_clinic_settings set enabled = false where clinic_id = ${A.clinicId}::uuid`;
  assert.equal(await outcome(() => asUser(A, (tx) => tx.execute(q`INSERT INTO public.hi_appointment_extra_items
      (clinic_id, appointment_id, contract_line_id, table_code, procedure_code, description, requires_authorization, quantity, source, recorded_by)
    VALUES (${A.clinicId}::uuid, ${ap8}::uuid, ${lineFree}::uuid, '22', '1', 'x', false, 1, 'conferencia', ${SYS_ACTOR}::uuid)`))), '55000:hi_module_enabled');
  assert.ok(!(await outcome(() => include(A, eB5))).startsWith('ok'), 'módulo desligado: nada é incluído');
  await sql`update public.subscriptions set billing_status = 'trial', trial_ends_at = now() + interval '10 days', enforce_trial_deadline = true where clinic_id = ${A.clinicId}::uuid`;
  assert.equal(await outcome(() => asUser(A, (tx) => tx.execute(q`INSERT INTO public.hi_appointment_extra_items
      (clinic_id, appointment_id, contract_line_id, table_code, procedure_code, description, requires_authorization, quantity, source, recorded_by)
    VALUES (${A.clinicId}::uuid, ${ap8}::uuid, ${lineFree}::uuid, '22', '1', 'x', false, 1, 'conferencia', ${SYS_ACTOR}::uuid)`))), '23514:qoro_premium_health_insurance');
  await sql`update public.subscriptions set billing_status = 'active', trial_ends_at = null, enforce_trial_deadline = false where clinic_id = ${A.clinicId}::uuid`;
  await sql`update public.hi_clinic_settings set enabled = true where clinic_id = ${A.clinicId}::uuid`;
  assert.equal(await outcome(() => record(A, ap8, lineFree, 1)), 'ok');
  pass('módulo desligado → 55000 (registro) e nada é incluído; trial → 23514 comercial (antes do módulo); com assinatura e módulo de volta, registra');

  // 27. Isolamento: a clínica B não lê, não grava e não decide itens da clínica A.
  const seenByB = await withTenant(B.clinicId, (tx) => tx.execute(q`select count(*)::int as n from public.hi_appointment_extra_items where clinic_id = ${A.clinicId}::uuid`), B.doctorId);
  assert.equal(Number((seenByB as unknown as Array<{ n: number }>)[0]!.n), 0);
  const [seenAll] = await sql`select count(*)::int as n from public.hi_appointment_extra_items where clinic_id = ${A.clinicId}::uuid`;
  assert.ok(Number(seenAll!.n) > 0);
  assert.equal(await outcome(() => withTenant(B.clinicId, (tx) => tx.execute(q`INSERT INTO public.hi_appointment_extra_items
      (clinic_id, appointment_id, contract_line_id, table_code, procedure_code, description, requires_authorization, quantity, source, recorded_by)
    VALUES (${A.clinicId}::uuid, ${ap8}::uuid, ${lineAuth}::uuid, '22', '1', 'x', false, 1, 'conferencia', ${SYS_ACTOR}::uuid)`), B.doctorId)), '42501');
  const updByB = await withTenant(B.clinicId, (tx) => tx.execute(q`UPDATE public.hi_appointment_extra_items SET status = 'excluded', exclusion_reason = 'tentativa de outra clínica' WHERE id = ${eB2}::uuid RETURNING id`), B.doctorId);
  assert.equal((updByB as unknown as unknown[]).length, 0);
  assert.equal(await outcome(() => withTenant(B.clinicId, (tx) => extra.includeExtraItemTx(tx, { clinicId: B.clinicId, itemId: eB2, actorUserId: B.doctorId, insurerRuleConfirmed: true }), B.doctorId)), 'regra:ITEM_NOT_FOUND');
  assert.deepEqual(await withTenant(B.clinicId, (tx) => extra.listExtraItemsTx(tx, { clinicId: A.clinicId, appointmentId: ap8 }), B.doctorId), []);
  pass('a clínica B não lê, não grava e não decide itens da clínica A (RLS), nem pelo serviço pedindo o id de A');

  // 28. Reprocessamento (3×) e reentrega da conclusão: nada duplica; sem a tabela, "indisponível".
  const snap = async () => JSON.stringify({
    items: (await sql`select id::text, status, guide_item_id::text from public.hi_appointment_extra_items where clinic_id = ${A.clinicId}::uuid order by id`).map((r) => `${r.id}:${r.status}:${r.guide_item_id}`),
    guides: (await sql`select id::text, status, total_value_cents::int t from public.hi_guides where clinic_id = ${A.clinicId}::uuid order by id`).map((r) => `${r.id}:${r.status}:${r.t}`),
    consumptions: (await sql`select idempotency_key, quantity from public.hi_authorization_consumptions where clinic_id = ${A.clinicId}::uuid order by idempotency_key`).map((r) => `${r.idempotency_key}:${r.quantity}`),
  });
  const before28 = await snap();
  const ledger28 = await ledgerDigest(A.clinicId);
  for (let k = 0; k < 3; k++) {
    for (const ap of [ap1, ap4, ap6, ap7]) {
      await withTenant(A.clinicId, (tx) => processInsuranceBilling(tx, { clinicId: A.clinicId, appointmentId: ap, detectedBy: 'event', eventState: 'processed', lock: 'wait' }));
    }
  }
  const redelivered = await sql`insert into public.outbox (clinic_id, event_type, payload, idempotency_key, payload_hash, correlation_id)
    select clinic_id, event_type, payload, idempotency_key || ':reentrega', payload_hash, correlation_id from public.outbox
     where clinic_id = ${A.clinicId}::uuid and event_type = 'scheduling.appointment.insurance_completed' returning id`;
  for (let i = 0; i < 4; i++) await runOutboxOnce({ batchSize: 50, parallelism: 1 });
  const [pendingEv] = await sql`select count(*)::int n from public.outbox where id = any(${redelivered.map((r) => r.id as string)}::uuid[]) and status <> 'processed'`;
  assert.equal(Number(pendingEv!.n), 0);
  assert.equal(await snap(), before28);
  assert.deepEqual(await ledgerDigest(A.clinicId), ledger28);
  await sql`ALTER TABLE public.hi_appointment_extra_items RENAME TO hi_appointment_extra_items_off`;
  assert.equal(await withTenant(A.clinicId, (tx) => extra.extraItemsAvailableTx(tx)), false);
  assert.deepEqual(await withTenant(A.clinicId, (tx) => extra.listExtraItemsTx(tx, { clinicId: A.clinicId, appointmentId: ap1 })), []);
  assert.deepEqual(await withTenant(A.clinicId, (tx) => extra.pendingExtraItemsForGuideTx(tx, { clinicId: A.clinicId, guideId: g7!.id as string })), []);
  assert.equal(await outcome(() => record(A, ap8, lineConf, 1)), 'regra:NOT_AVAILABLE');
  await sql`ALTER TABLE public.hi_appointment_extra_items_off RENAME TO hi_appointment_extra_items`;
  pass(`reprocessamento (3× por sessão) e reentrega de ${redelivered.length} eventos de conclusão: itens, guias, consumos e livro iguais; sem a tabela (ambiente sem a 0167), o serviço responde "indisponível" e a aprovação não acha pendente`);

  assert.equal(passed, TOTAL);
  console.log(`\n${passed}/${TOTAL} provas dos itens executados adicionais (P8.4, política P8.4-r, 0167) passaram.`);
} finally {
  await cluster.stop();
}
process.exit(0);
