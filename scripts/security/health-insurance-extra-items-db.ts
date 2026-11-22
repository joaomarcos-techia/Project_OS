/**
 * P8.4 — itens executados adicionais da sessão SP/SADT, com a migration CANDIDATA 0167
 * (docs/convenios/migrations/0167_hi_appointment_extra_items.candidate.sql) aplicada DEPOIS da
 * cadeia na ordem do DEV, em Postgres DESCARTÁVEL. Nunca no DEV compartilhado; só dados sintéticos.
 *
 * O caminho é o real: solicitação SP/SADT → conferência → atendimento ligado ao item → registro
 * do item adicional (serviço) → conclusão pelo Scheduling → outbox → handler → guia da sessão.
 * Prova: as regras do banco (só item de contrato, cópia dos campos pela linha, pessoa da sessão,
 * um ativo por procedimento, guia fechada, comercial, módulo, RLS, sem DELETE) e do serviço
 * (vigência na data da sessão, atendimento executado, mensagens de regra); e que, com a política
 * P8.4-r ainda sem decisão, a guia NÃO muda.
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
const { loadHiFixtures, SYS_ACTOR } = await import('./hi-fixtures');

const fx = await loadHiFixtures(sql, {
  store: { async put() {}, async get() { return new Uint8Array(); }, async remove() {} },
  validateXsd: null,
});
type Clinic = Awaited<ReturnType<typeof fx.setupClinic>>;
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
const asUser = <T>(c: Clinic, fn: Parameters<typeof withTenant<T>>[1]) => withTenant(c.clinicId, fn, c.doctorId);
const version = async (requestId: string) => Number((await sql`select version from public.hi_sadt_requests where id = ${requestId}::uuid`)[0]!.version);
async function readyRequest(c: Clinic, pt: { patientId: string; membershipId: string }, code: string, quantity: number) {
  const { requestId } = await asUser(c, (tx) =>
    req.createSadtRequestInTx(tx, {
      clinicId: c.clinicId, patientId: pt.patientId, membershipId: pt.membershipId,
      requester: { kind: 'internal', professionalId: c.doctorId }, requestedOn: '2026-11-01', careCharacter: '1', careType: '03',
      items: [{ tableCode: '22', procedureCode: code, quantity }], actorUserId: c.doctorId,
    } as Parameters<typeof req.createSadtRequestInTx>[1]),
  );
  const checked = await asUser(c, async (tx) => req.checkSadtRequestInTx(tx, { clinicId: c.clinicId, requestId, version: await version(requestId), actorUserId: c.doctorId }));
  const [item] = await sql`select id from public.hi_sadt_request_items where request_id = ${requestId}::uuid order by sequence limit 1`;
  return { requestId, itemId: item!.id as string, kind: checked.kind };
}
let slot = 0;
async function session(c: Clinic, pt: { patientId: string; membershipId: string }, requestItemId: string, day: string) {
  slot += 1;
  const [proc] = await sql`select id from public.procedures where clinic_id = ${c.clinicId}::uuid limit 1`;
  const [a] = await sql`insert into public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
      snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via, billing_mode)
    values (${c.clinicId}::uuid, ${c.doctorId}::uuid, ${pt.patientId}::uuid, ${proc!.id}::uuid, ${`${day}T13:00:00Z`}::timestamptz + ${slot} * interval '55 minutes', 50, 'agendado', 120,
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
async function complete(c: Clinic, appointmentId: string, patientId: string) {
  await sql`insert into public.prontuarios (clinic_id, patient_id, doctor_id, appointment_id, status, signed_at, signed_by, content_encrypted)
    values (${c.clinicId}::uuid, ${patientId}::uuid, ${c.doctorId}::uuid, ${appointmentId}::uuid, 'assinado', now(), ${c.doctorId}::uuid, 'ciphertext-sintetico')`;
  await withTenant(c.clinicId, (tx) => applyTransition(tx, {
    clinicId: c.clinicId, appointmentId, target: 'atendido', transitionedBy: c.doctorId, actorType: 'user',
    clientKey: `concluir-${appointmentId}`, correlationId: null,
  }), c.doctorId);
  for (let i = 0; i < 4; i++) await runOutboxOnce({ batchSize: 50, parallelism: 1 });
}
/** Resultado de uma operação: 'ok' ou o código (e a constraint, quando há) do erro. */
async function outcome(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'ok';
  } catch (e) {
    if (e instanceof extra.ExtraItemRuleError) return `regra:${e.code}`;
    const err = e as { code?: string; constraint_name?: string; name?: string; cause?: { code?: string; constraint_name?: string } };
    const code = err.code ?? err.cause?.code;
    const constraint = err.constraint_name ?? err.cause?.constraint_name;
    if (code) return constraint ? `${code}:${constraint}` : code;
    return `erro:${err.name ?? 'desconhecido'}`;
  }
}
const rawInsert = (c: Clinic, appointmentId: string, lineId: string, over: { quantity?: number; description?: string; requiresAuth?: boolean } = {}) =>
  asUser(c, (tx) => tx.execute(q`INSERT INTO public.hi_appointment_extra_items
      (clinic_id, appointment_id, contract_line_id, table_code, procedure_code, description, requires_authorization, quantity, source, recorded_by)
    VALUES (${c.clinicId}::uuid, ${appointmentId}::uuid, ${lineId}::uuid, '22', '99999999', ${over.description ?? 'inventado pelo cliente'},
      ${over.requiresAuth ?? false}, ${over.quantity ?? 1}, 'conferencia', ${SYS_ACTOR}::uuid)
    RETURNING id::text, procedure_code, description, requires_authorization, recorded_by::text`));
const guideOf = async (appointmentId: string) =>
  (await sql`select g.id::text, g.status, g.total_value_cents::int as total,
       (select count(*)::int from public.hi_guide_items i where i.guide_id = g.id) as items
     from public.hi_guides g where exists (select 1 from public.hi_guide_items i where i.guide_id = g.id and i.appointment_id = ${appointmentId}::uuid)`)[0] ?? null;

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  const A = await fx.setupClinic('Itens A', { insurers: [{ name: 'Operadora Um', ans: '123456' }, { name: 'Operadora Dois', ans: '654321' }] });
  const B = await fx.setupClinic('Itens B');
  await contract(A, A.insurerId, CODE_MAIN, 12000);
  const lineFree = await contract(A, A.insurerId, CODE_FREE, 3000);
  const lineAuth = await contract(A, A.insurerId, CODE_AUTH, 5000, { requiresAuth: true });
  const lineOld = await contract(A, A.insurerId, CODE_OLD, 2000, { until: '2026-10-31' });
  const lineOtherInsurer = await contract(A, A.insurerIds[1]!, CODE_FREE, 3100);
  const [consultaLine] = await sql`select id from public.hi_procedure_contracts where clinic_id = ${A.clinicId}::uuid and guide_type = 'consulta' limit 1`;
  const p1 = await patientWithCard(A, 'um');
  const r1 = await readyRequest(A, p1, CODE_MAIN, 3);
  assert.equal(r1.kind, 'ready');
  const ap1 = await session(A, p1, r1.itemId, '2026-11-10');

  // 1. Antes da sessão acontecer, não há item "executado".
  assert.equal(await outcome(() => asUser(A, (tx) => extra.recordExtraItemTx(tx, { clinicId: A.clinicId, appointmentId: ap1, contractLineId: lineFree, quantity: 1, source: 'consultorio' }))), 'regra:APPOINTMENT_NOT_EXECUTED');
  pass('com o atendimento ainda agendado, nenhum item executado é aceito');

  // 2. Em atendimento (consultório), registra; o banco copia código, descrição e "exige autorização" da linha.
  await sql`update public.appointments set status = 'em_atendimento' where id = ${ap1}::uuid`;
  const { id: e1 } = await asUser(A, (tx) => extra.recordExtraItemTx(tx, { clinicId: A.clinicId, appointmentId: ap1, contractLineId: lineFree, quantity: 2, source: 'consultorio' }));
  const raw = (await rawInsert(A, ap1, lineAuth, { description: 'descrição inventada', requiresAuth: false })) as unknown as Array<Record<string, unknown>>;
  assert.equal(raw[0]!.procedure_code, CODE_AUTH, 'o código vem da linha, não do cliente');
  assert.equal(raw[0]!.description, `Procedimento sintético ${CODE_AUTH}`, 'a descrição vem da linha');
  assert.equal(raw[0]!.requires_authorization, true, '"exige autorização" vem da linha');
  assert.equal(raw[0]!.recorded_by, A.doctorId, 'quem registrou é a pessoa da sessão, não o que o cliente mandou');
  pass('em atendimento, o item é registrado; código, descrição, "exige autorização" e autor vêm da linha do contrato e da sessão, nunca do cliente');

  // 3. Um ativo por procedimento; quantidade de 1 a 999.
  assert.equal(await outcome(() => asUser(A, (tx) => extra.recordExtraItemTx(tx, { clinicId: A.clinicId, appointmentId: ap1, contractLineId: lineFree, quantity: 1, source: 'conferencia' }))), 'regra:DUPLICATE');
  for (const quantity of [0, 1000, 1.5]) {
    assert.equal(await outcome(() => asUser(A, (tx) => extra.recordExtraItemTx(tx, { clinicId: A.clinicId, appointmentId: ap1, contractLineId: lineOld, quantity, source: 'conferencia' }))), 'regra:QUANTITY_INVALID');
  }
  assert.equal(await outcome(() => rawInsert(A, ap1, lineOld, { quantity: 0 })), '23514:hi_extra_items_quantity_chk');
  pass('o mesmo procedimento não fica ativo duas vezes na sessão; quantidade fora de 1 a 999 é recusada pelo serviço e pelo banco');

  // 4. Só item de contrato SP/SADT da operadora do atendimento, vigente na data da sessão.
  assert.equal(await outcome(() => asUser(A, (tx) => extra.recordExtraItemTx(tx, { clinicId: A.clinicId, appointmentId: ap1, contractLineId: lineOtherInsurer, quantity: 1, source: 'conferencia' }))), 'regra:CONTRACT_INVALID');
  assert.equal(await outcome(() => rawInsert(A, ap1, lineOtherInsurer)), '23514:hi_extra_item_contract');
  assert.equal(await outcome(() => rawInsert(A, ap1, consultaLine!.id as string)), '23514:hi_extra_item_contract');
  assert.equal(await outcome(() => asUser(A, (tx) => extra.recordExtraItemTx(tx, { clinicId: A.clinicId, appointmentId: ap1, contractLineId: lineOld, quantity: 1, source: 'conferencia' }))), 'regra:CONTRACT_NOT_EFFECTIVE');
  pass('linha de outra operadora ou de Consulta é recusada pelo serviço e pelo banco; linha fora de vigência na data da sessão é recusada pelo serviço');

  // 5. Sem a pessoa da sessão, nada é gravado.
  assert.equal(await outcome(() => withTenant(A.clinicId, (tx) => tx.execute(q`INSERT INTO public.hi_appointment_extra_items
      (clinic_id, appointment_id, contract_line_id, table_code, procedure_code, description, requires_authorization, quantity, source, recorded_by)
    VALUES (${A.clinicId}::uuid, ${ap1}::uuid, ${lineOld}::uuid, '22', '1', 'x', false, 1, 'conferencia', ${SYS_ACTOR}::uuid)`))), '42501');
  pass('sem a pessoa da sessão, o banco recusa o registro (42501)');

  // 6. Cancelar: só com motivo, pela pessoa da sessão; cancelado não volta; o fato não muda; nada é apagado.
  assert.equal(await outcome(() => asUser(A, (tx) => extra.cancelExtraItemTx(tx, { clinicId: A.clinicId, itemId: e1, reason: 'x' }))), 'regra:REASON_REQUIRED');
  assert.equal(await outcome(() => asUser(A, (tx) => tx.execute(q`UPDATE public.hi_appointment_extra_items SET quantity = 5 WHERE id = ${e1}::uuid`))), '23514:hi_extra_item_immutable');
  await asUser(A, (tx) => extra.cancelExtraItemTx(tx, { clinicId: A.clinicId, itemId: e1, reason: 'Registrado na sessão errada' }));
  const [c1] = await sql`select status, cancelled_by::text, cancel_reason from public.hi_appointment_extra_items where id = ${e1}::uuid`;
  assert.deepEqual([c1!.status, c1!.cancelled_by, c1!.cancel_reason], ['cancelled', A.doctorId, 'Registrado na sessão errada']);
  assert.equal(await outcome(() => asUser(A, (tx) => extra.cancelExtraItemTx(tx, { clinicId: A.clinicId, itemId: e1, reason: 'De novo, por engano' }))), 'regra:ALREADY_CANCELLED');
  assert.equal(await outcome(() => asUser(A, (tx) => tx.execute(q`DELETE FROM public.hi_appointment_extra_items WHERE id = ${e1}::uuid`))), '42501');
  const { id: e1b } = await asUser(A, (tx) => extra.recordExtraItemTx(tx, { clinicId: A.clinicId, appointmentId: ap1, contractLineId: lineFree, quantity: 1, source: 'conferencia' }));
  pass('cancelar exige motivo e grava quem cancelou; cancelado não volta; quantidade não muda por edição; o runtime não apaga; depois do cancelamento o procedimento pode ser registrado de novo');

  // 7. Conclusão: a guia da sessão nasce SÓ com o item agendado (política P8.4-r sem decisão).
  await complete(A, ap1, p1.patientId);
  const g1 = await guideOf(ap1);
  assert.ok(g1, 'a guia da sessão existe');
  assert.deepEqual([g1!.status, g1!.items, g1!.total], ['ready_for_review', 1, 12000], 'nenhum item adicional entrou na guia');
  const list = await withTenant(A.clinicId, (tx) => extra.listExtraItemsTx(tx, { clinicId: A.clinicId, appointmentId: ap1 }));
  const active = list.filter((i) => i.status === 'active');
  assert.equal(active.length, 2);
  for (const i of active) assert.equal(i.billing?.bill === false && i.billing.issue?.code, 'EXTRA_ITEM_POLICY_PENDING');
  assert.equal(list.filter((i) => i.status === 'cancelled').length, 1, 'o cancelado continua no histórico');
  pass('na conclusão, a guia SP/SADT nasce só com o item agendado (12.000 centavos, 1 item); os 2 adicionais ficam registrados, com a pendência "regra de faturamento aguardando decisão"; o cancelado fica no histórico');

  // 8. Na conferência (guia em ready_for_review) a recepção ainda completa; a guia continua igual.
  const lineConf = await contract(A, A.insurerId, '50000616', 4000);
  await asUser(A, (tx) => extra.recordExtraItemTx(tx, { clinicId: A.clinicId, appointmentId: ap1, contractLineId: lineConf, quantity: 3, source: 'conferencia' }));
  const g1b = await guideOf(ap1);
  assert.deepEqual([g1b!.items, g1b!.total], [1, 12000]);
  pass('com a guia em conferência, a recepção ainda completa os itens; a guia não muda enquanto a regra P8.4-r não for decidida');

  // 9. As alternativas da decisão leem o banco certo (a política vigente não muda).
  const r2 = await readyRequest(A, p1, CODE_AUTH, 3);
  assert.notEqual(r2.kind, 'ready', 'o contrato de CODE_AUTH exige autorização');
  const beforeAuth = await withTenant(A.clinicId, (tx) => extra.listExtraItemsTx(tx, { clinicId: A.clinicId, appointmentId: ap1, policy: 'post_authorization' }));
  const authItemView = beforeAuth.find((i) => i.status === 'active' && i.procedureCode === CODE_AUTH)!;
  assert.equal(authItemView.billing?.bill === false && authItemView.billing.issue?.code, 'EXTRA_ITEM_AUTHORIZATION_MISSING');
  const freeView = beforeAuth.find((i) => i.status === 'active' && i.procedureCode === CODE_FREE)!;
  assert.deepEqual(freeView.billing, { bill: true, authorizationItemId: null });
  const itemsR2 = await sql`select id from public.hi_sadt_request_items where request_id = ${r2.requestId}::uuid order by sequence`;
  await asUser(A, async (tx) => req.recordSadtAuthorizationInTx(tx, {
    decision: 'authorized', clinicId: A.clinicId, requestId: r2.requestId, version: await version(r2.requestId), authorizedOn: '2026-11-02',
    operatorGuideNumber: 'OP12345678', password: 'SENHA987', passwordValidUntil: '2026-12-31',
    items: itemsR2.map((it) => ({ requestItemId: it.id as string, quantityAuthorized: 3 })), actorUserId: A.doctorId,
  } as Parameters<typeof req.recordSadtAuthorizationInTx>[1]));
  const afterAuth = await withTenant(A.clinicId, (tx) => extra.listExtraItemsTx(tx, { clinicId: A.clinicId, appointmentId: ap1, policy: 'post_authorization' }));
  const authAfter = afterAuth.find((i) => i.status === 'active' && i.procedureCode === CODE_AUTH)!;
  assert.equal(authAfter.billing?.bill, true, 'com autorização concedida e saldo, a alternativa (c) faturaria');
  const stillUndecided = await withTenant(A.clinicId, (tx) => extra.listExtraItemsTx(tx, { clinicId: A.clinicId, appointmentId: ap1 }));
  assert.ok(stillUndecided.filter((i) => i.status === 'active').every((i) => i.billing?.bill === false), 'a vigente continua sem faturar');
  const [consumed] = await sql`select coalesce(sum(quantity_consumed), 0)::int as n from public.hi_authorization_items i
    join public.hi_sadt_request_items ri on ri.authorization_item_id = i.id where ri.request_id = ${r2.requestId}::uuid`;
  assert.equal(Number(consumed!.n), 0, 'ler a alternativa não consome autorização');
  pass('alternativa (c) "autorização posterior": sem autorização, pendência; com autorização concedida e saldo, faturaria; a leitura não consome saldo; a política vigente continua sem faturar');

  // 10. Guia conferida (fechada): nem inclusão nem cancelamento.
  const [gv] = await sql`select version from public.hi_guides where id = ${g1!.id}::uuid`;
  await asUser(A, (tx) => tx.execute(q`UPDATE public.hi_guides SET status = 'reviewed', reviewed_by = ${A.doctorId}::uuid
    WHERE clinic_id = ${A.clinicId}::uuid AND id = ${g1!.id}::uuid AND version = ${gv!.version}`));
  const lineLate = await contract(A, A.insurerId, '50000624', 1500);
  assert.equal(await outcome(() => asUser(A, (tx) => extra.recordExtraItemTx(tx, { clinicId: A.clinicId, appointmentId: ap1, contractLineId: lineLate, quantity: 1, source: 'conferencia' }))), 'regra:GUIDE_CLOSED');
  assert.equal(await outcome(() => asUser(A, (tx) => extra.cancelExtraItemTx(tx, { clinicId: A.clinicId, itemId: e1b, reason: 'Depois de conferida' }))), 'regra:GUIDE_CLOSED');
  pass('com a guia conferida, o banco recusa incluir e cancelar itens (a mudança passa pela devolução ou substituição da guia)');

  // 11. Comercial primeiro, depois o módulo.
  const p3 = await patientWithCard(A, 'três');
  const r3 = await readyRequest(A, p3, CODE_MAIN, 1);
  const ap3 = await session(A, p3, r3.itemId, '2026-11-11');
  await sql`update public.appointments set status = 'em_atendimento' where id = ${ap3}::uuid`;
  await sql`update public.hi_clinic_settings set enabled = false where clinic_id = ${A.clinicId}::uuid`;
  assert.equal(await outcome(() => rawInsert(A, ap3, lineFree)), '55000:hi_module_enabled');
  await sql`update public.subscriptions set billing_status = 'trial', trial_ends_at = now() + interval '10 days', enforce_trial_deadline = true where clinic_id = ${A.clinicId}::uuid`;
  assert.equal(await outcome(() => rawInsert(A, ap3, lineFree)), '23514:qoro_premium_health_insurance');
  const svc = await outcome(() => asUser(A, (tx) => extra.recordExtraItemTx(tx, { clinicId: A.clinicId, appointmentId: ap3, contractLineId: lineFree, quantity: 1, source: 'conferencia' })));
  assert.ok(!svc.startsWith('ok'), `o serviço também recusa no trial (${svc})`);
  await sql`update public.subscriptions set billing_status = 'active', trial_ends_at = null, enforce_trial_deadline = false where clinic_id = ${A.clinicId}::uuid`;
  await sql`update public.hi_clinic_settings set enabled = true where clinic_id = ${A.clinicId}::uuid`;
  assert.equal(await outcome(() => asUser(A, (tx) => extra.recordExtraItemTx(tx, { clinicId: A.clinicId, appointmentId: ap3, contractLineId: lineFree, quantity: 1, source: 'conferencia' }))), 'ok');
  pass('módulo desligado → 55000; trial → 23514 comercial (antes do módulo), no banco e no serviço; com assinatura e módulo de volta, registra');

  // 12. Isolamento: a clínica B não vê nem grava itens de atendimento da clínica A.
  const seenByB = await withTenant(B.clinicId, (tx) => tx.execute(q`select count(*)::int as n from public.hi_appointment_extra_items where clinic_id = ${A.clinicId}::uuid`), B.doctorId);
  assert.equal(Number((seenByB as unknown as Array<{ n: number }>)[0]!.n), 0);
  const [seenAll] = await sql`select count(*)::int as n from public.hi_appointment_extra_items where clinic_id = ${A.clinicId}::uuid`;
  assert.ok(Number(seenAll!.n) > 0, 'os itens de A existem (a contagem zero de B é da RLS)');
  assert.equal(await outcome(() => withTenant(B.clinicId, (tx) => tx.execute(q`INSERT INTO public.hi_appointment_extra_items
      (clinic_id, appointment_id, contract_line_id, table_code, procedure_code, description, requires_authorization, quantity, source, recorded_by)
    VALUES (${A.clinicId}::uuid, ${ap3}::uuid, ${lineAuth}::uuid, '22', '1', 'x', false, 1, 'conferencia', ${SYS_ACTOR}::uuid)`), B.doctorId)), '42501');
  const listedByB = await withTenant(B.clinicId, (tx) => extra.listExtraItemsTx(tx, { clinicId: A.clinicId, appointmentId: ap3 }), B.doctorId);
  assert.deepEqual(listedByB, [], 'nem pelo serviço, mesmo pedindo a clínica A');
  pass('a clínica B não lê nem grava itens de atendimento da clínica A (RLS), nem pelo serviço pedindo o id de A');

  // 13. Item de Consulta: não existe item adicional.
  const consultaAp = (await sql`insert into public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
      snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via, billing_mode)
    select ${A.clinicId}::uuid, ${A.doctorId}::uuid, ${p3.patientId}::uuid, p.id, '2026-11-12T13:00:00Z', 30, 'agendado', 150,
      'Consulta', 150, 30, 'Profissional sintético', 'attendant', 'convenio' from public.procedures p where p.clinic_id = ${A.clinicId}::uuid limit 1
    returning id`)[0]!.id as string;
  const [proc] = await sql`select id from public.procedures where clinic_id = ${A.clinicId}::uuid limit 1`;
  await asUser(A, (tx) => recordAppointmentCoverage(tx, {
    clinicId: A.clinicId, appointmentId: consultaAp, patientId: p3.patientId, procedureId: proc!.id as string, appointmentDate: '2026-11-12',
    guideType: 'consulta', insurerId: A.insurerId, planId: null, membershipId: p3.membershipId, authorizationId: null,
    actor: { kind: 'user', userId: A.doctorId },
  } as Parameters<typeof recordAppointmentCoverage>[1]));
  await sql`update public.appointments set status = 'em_atendimento' where id = ${consultaAp}::uuid`;
  assert.equal(await outcome(() => asUser(A, (tx) => extra.recordExtraItemTx(tx, { clinicId: A.clinicId, appointmentId: consultaAp, contractLineId: lineFree, quantity: 1, source: 'conferencia' }))), 'regra:NOT_SADT');
  assert.equal(await outcome(() => rawInsert(A, consultaAp, lineFree)), '23514:hi_extra_item_coverage');
  pass('atendimento de Consulta (um procedimento só) não aceita item adicional, no serviço e no banco');

  // 14. Sem a candidata aplicada, o serviço diz "indisponível" (é o caso do DEV e do Preview hoje).
  const available = await withTenant(A.clinicId, (tx) => extra.extraItemsAvailableTx(tx));
  assert.equal(available, true);
  await sql`ALTER TABLE public.hi_appointment_extra_items RENAME TO hi_appointment_extra_items_off`;
  assert.equal(await withTenant(A.clinicId, (tx) => extra.extraItemsAvailableTx(tx)), false);
  assert.deepEqual(await withTenant(A.clinicId, (tx) => extra.listExtraItemsTx(tx, { clinicId: A.clinicId, appointmentId: ap1 })), []);
  assert.equal(await outcome(() => asUser(A, (tx) => extra.recordExtraItemTx(tx, { clinicId: A.clinicId, appointmentId: ap3, contractLineId: lineFree, quantity: 1, source: 'conferencia' }))), 'regra:NOT_AVAILABLE');
  await sql`ALTER TABLE public.hi_appointment_extra_items_off RENAME TO hi_appointment_extra_items`;
  pass('sem a tabela (DEV e Preview sem a 0167), o serviço responde "indisponível" e a lista vem vazia, sem erro técnico');

  console.log(`\n${passed}/14 provas dos itens executados adicionais (P8.4, candidata 0167) passaram.`);
} finally {
  await cluster.stop();
}
process.exit(0);
