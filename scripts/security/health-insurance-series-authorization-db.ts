/**
 * Convênios P4.7 — série recorrente de convênio e o CONSUMO da autorização, em Postgres DESCARTÁVEL
 * (cadeia do DEV), dados sintéticos, transições reais do Scheduling e o worker real do outbox.
 *
 *   1. série semanal de 3 consultas de convênio: a cobertura é registrada em CADA ocorrência pela
 *      mesma função que a agenda usa para a série (`recordSchedulingCoverage`);
 *   2. uma autorização de 2 consultas: concluídas as 3, duas guias ligam a autorização e consomem
 *      uma unidade cada; a terceira fica "pendente de dados" com saldo esgotado (antes, as três
 *      ligavam a mesma autorização sem conferir o saldo — achado da P4.7);
 *   3. reentrega dos eventos: nenhum consumo nem guia a mais;
 *   4. corrida: duas consultas concluídas ao mesmo tempo com uma autorização de 1 unidade — só uma
 *      consome (o gatilho da 0146 trava o item); a outra fica pendente.
 *
 *   SECURITY_PG_BIN=... PORT=55562 NODE_OPTIONS="--import ./scripts/security/server-only-hook.mjs" \
 *     ./node_modules/.bin/tsx --tsconfig tsconfig.scripts.json scripts/security/health-insurance-series-authorization-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55562);
const chain = await readDevOrderChain();
const cluster = await startScratchSchema({ port: PORT, maxConnections: 16, migrations: chain });
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

const { withTenant } = await import('../../src/lib/db/tenant');
await import('../../src/app/api/cron/outbox/handlers');
const { runOutboxOnce } = await import('../../src/lib/outbox/worker');
const { applyTransition } = await import('../../src/contexts/scheduling/internal/appointment-core');
const { recordSchedulingCoverage } = await import('../../src/contexts/health-insurance/scheduling-coverage');
const auths = await import('../../src/contexts/health-insurance/internal/authorizations');
const { loadXmllintValidator } = await import('../../src/contexts/health-insurance/tiss/xml/xsd-validator');
const { loadHiFixtures, SYS_ACTOR } = await import('./hi-fixtures');

const xsd = loadXmllintValidator();
if (!xsd) throw new Error('validador XSD do app indisponível (TISS_XMLLINT_WASM_DIR fora do CI)');
const objects = new Map<string, Uint8Array>();
const store = {
  async put(ref: string, bytes: Uint8Array) { objects.set(ref, bytes); },
  async get(ref: string) { return objects.get(ref)!; },
  async remove(ref: string) { objects.delete(ref); },
};
const fx = await loadHiFixtures(sql, { store, validateXsd: xsd });

let passed = 0;
const pass = (msg: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${msg}`);
};
const rc = { requestId: 'harness', ip: null, userAgent: null, correlationId: null } as never;

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  const C = await fx.setupClinic('Série com autorização');
  const asUser = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(C.clinicId, fn, C.doctorId);
  const [proc] = await sql`select id::text from public.procedures where clinic_id = ${C.clinicId}::uuid limit 1`;
  const [ins] = await sql`insert into public.hi_insurers (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, status, created_by)
    values (${C.clinicId}::uuid, 'Operadora que Autoriza', '654321', 'codigoPrestadorNaOperadora', 'TESTE002', 'active', ${SYS_ACTOR}::uuid) returning id::text`;
  const insurerId = String(ins!.id);
  await sql`insert into public.hi_procedure_contracts (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id,
      unit_value_cents, valid_from, requires_authorization, created_by)
    values (${C.clinicId}::uuid, ${insurerId}::uuid, 'consulta', '22', '10101012', 'Consulta em consultório', ${proc!.id}::uuid, 15000, '2026-01-01', true, ${SYS_ACTOR}::uuid)`;
  await sql`insert into public.hi_credentials (clinic_id, insurer_id, plan_id, professional_id, valid_from, status, created_by)
    values (${C.clinicId}::uuid, ${insurerId}::uuid, null, null, '2020-01-01', 'active', ${SYS_ACTOR}::uuid),
           (${C.clinicId}::uuid, ${insurerId}::uuid, null, ${C.doctorId}::uuid, '2020-01-01', 'active', ${SYS_ACTOR}::uuid)`;
  const person = async (label: string) => {
    const [pt] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
      values (${C.clinicId}::uuid, ${`Paciente Sintética ${label}`}, 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id::text`;
    const [card] = await sql`insert into public.hi_memberships (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
      values (${C.clinicId}::uuid, ${pt!.id}::uuid, ${insurerId}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${randomUUID().replace(/-/g, '').padEnd(64, '0')}, '7777', ${SYS_ACTOR}::uuid)
      returning id::text`;
    return { patientId: String(pt!.id), membershipId: String(card!.id) };
  };
  const authorize = async (who: { membershipId: string }, quantity: number) => {
    const { authorizationId } = await asUser((tx) => auths.requestManualAuthorizationTx(tx, {
      clinicId: C.clinicId, insurerId, membershipId: who.membershipId, requestedOn: '2026-11-01',
      items: [{ tableCode: '22', procedureCode: '10101012', quantityRequested: quantity }], actorUserId: C.doctorId,
    }));
    const [a] = await sql`select version from public.hi_authorizations where id = ${authorizationId}::uuid`;
    const items = await sql`select id::text from public.hi_authorization_items where authorization_id = ${authorizationId}::uuid`;
    await asUser((tx) => auths.recordManualAuthorizationResponseTx(tx, {
      decision: 'authorized', clinicId: C.clinicId, authorizationId, version: Number(a!.version), actorUserId: C.doctorId, authorizedOn: '2026-11-02',
      operatorGuideNumber: `OP${randomUUID().slice(0, 8)}`, password: 'SENHA-SINTETICA', passwordValidUntil: '2026-12-31',
      items: items.map((i) => ({ itemId: String(i.id), quantityAuthorized: quantity })),
    }));
    return { authorizationId, itemId: String(items[0]!.id) };
  };
  /** Série semanal (a linha da série e as ocorrências como o core grava) e a cobertura de TODAS pela função da agenda. */
  const series = async (who: { patientId: string; membershipId: string }, n: number, firstDay: number) => {
    const [s] = await sql`insert into public.recurrence_series (clinic_id, doctor_id, patient_id, procedure_id, interval_weeks, occurrences, created_by)
      values (${C.clinicId}::uuid, ${C.doctorId}::uuid, ${who.patientId}::uuid, ${proc!.id}::uuid, 1, ${n}, ${C.doctorId}::uuid) returning id::text`;
    const appts: Array<{ id: string; date: string }> = [];
    for (let i = 0; i < n; i++) {
      const date = new Date(Date.UTC(2026, 10, firstDay + 7 * i)).toISOString().slice(0, 10);
      const [a] = await sql`insert into public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
          snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via, billing_mode,
          recurrence_series_id, recurrence_occurrence)
        values (${C.clinicId}::uuid, ${C.doctorId}::uuid, ${who.patientId}::uuid, ${proc!.id}::uuid, ${`${date}T13:00:00Z`}::timestamptz, 30, 'agendado', 150,
          'Consulta', 150, 30, 'Dra. Sintética', 'attendant', 'convenio', ${s!.id}::uuid, ${i + 1}) returning id::text`;
      appts.push({ id: String(a!.id), date });
    }
    const out = await recordSchedulingCoverage({
      clinicId: C.clinicId, userId: C.doctorId, patientId: who.patientId, procedureId: String(proc!.id), appointments: appts,
      choice: { insurerId, planId: null, membershipId: who.membershipId, guideType: 'consulta' }, requestContext: rc,
    });
    return { appts, out };
  };
  const complete = async (appointmentId: string) => {
    for (const target of ['chegou', 'em_atendimento'] as const) {
      await asUser((tx) => applyTransition(tx, { clinicId: C.clinicId, appointmentId, target, transitionedBy: C.doctorId, actorType: 'user', clientKey: `${target}-${appointmentId}`, correlationId: null }));
    }
    await sql`insert into public.prontuarios (clinic_id, patient_id, doctor_id, appointment_id, status, signed_at, signed_by, content_encrypted)
      values (${C.clinicId}::uuid, (select patient_id from public.appointments where id = ${appointmentId}::uuid), ${C.doctorId}::uuid, ${appointmentId}::uuid, 'assinado', now(), ${C.doctorId}::uuid, 'ciphertext-sintetico')`;
    await asUser((tx) => applyTransition(tx, { clinicId: C.clinicId, appointmentId, target: 'atendido', transitionedBy: C.doctorId, actorType: 'user', clientKey: `concluir-${appointmentId}`, correlationId: null }));
  };
  const drain = async () => { for (let i = 0; i < 6; i++) await runOutboxOnce({ batchSize: 50, parallelism: 1 }); };
  const guideOf = async (appointmentId: string) =>
    (await sql`select g.status, g.authorization_id::text as auth, g.issues from public.hi_guides g
                 join public.hi_guide_items i on i.clinic_id = g.clinic_id and i.guide_id = g.id
                where i.appointment_id = ${appointmentId}::uuid and g.live`)[0];
  const consumed = async (itemId: string) => {
    const [r] = await sql`select quantity_consumed::int as q,
      (select count(*)::int from public.hi_authorization_consumptions c where c.item_id = i.id) as rows
      from public.hi_authorization_items i where i.id = ${itemId}::uuid`;
    return [Number(r!.q), Number(r!.rows)];
  };

  // 1. Série de 3 com cobertura em cada ocorrência.
  const P = await person('Série');
  const A = await authorize(P, 2);
  const { appts, out } = await series(P, 3, 3);
  assert.equal(out.error, null);
  assert.equal(out.recorded, 3);
  const cov = await sql`select appointment_id::text from public.hi_appointment_coverages where appointment_id = any(${`{${appts.map((a) => a.id).join(',')}}`}::uuid[])`;
  assert.equal(cov.length, 3, 'cada ocorrência com a sua cobertura');
  pass('série semanal de 3 consultas de convênio: cobertura registrada em cada ocorrência pela função que a agenda usa para a série');

  // 2. Autorização de 2: duas guias consomem, a terceira fica pendente com saldo esgotado.
  for (const a of appts) await complete(a.id);
  await drain();
  const gs = [];
  for (const a of appts) gs.push(await guideOf(a.id));
  const linked = gs.filter((g) => g?.auth === A.authorizationId && g.status === 'ready_for_review');
  const exhausted = gs.filter((g) => g?.status === 'pending_data' && JSON.stringify(g.issues).includes('AUTHORIZATION_EXHAUSTED'));
  assert.deepEqual([linked.length, exhausted.length], [2, 1], JSON.stringify(gs.map((g) => [g?.status, g?.auth ? 'auth' : null])));
  assert.deepEqual(await consumed(A.itemId), [2, 2], 'duas unidades consumidas, uma por atendimento');
  pass('autorização de 2 consultas: duas guias ligam a autorização e consomem uma unidade cada; a terceira fica "pendente de dados" com saldo esgotado');

  // 3. Reentrega: nada a mais.
  await sql`update public.outbox set status = 'pending', attempts = 0, next_attempt_at = now(), processed_at = null
             where clinic_id = ${C.clinicId}::uuid and event_type = 'scheduling.appointment.insurance_completed'`;
  await drain();
  assert.deepEqual(await consumed(A.itemId), [2, 2]);
  const guides = await sql`select count(*)::int as n from public.hi_guides where clinic_id = ${C.clinicId}::uuid and live and guide_type = 'consulta'
                             and patient_id = ${P.patientId}::uuid`;
  assert.equal(Number(guides[0]!.n), 3);
  pass('reentrega dos eventos de conclusão: nenhum consumo nem guia a mais');

  // 4. Corrida: autorização de 1 e duas consultas concluídas ao mesmo tempo.
  const Q = await person('Corrida');
  const B = await authorize(Q, 1);
  const { appts: race } = await series(Q, 2, 4);
  await Promise.all(race.map((a) => complete(a.id)));
  await Promise.all([1, 2].map(() => runOutboxOnce({ batchSize: 50, parallelism: 2 })));
  await drain();
  const rg = [await guideOf(race[0]!.id), await guideOf(race[1]!.id)];
  assert.deepEqual(rg.map((g) => g?.status).sort(), ['pending_data', 'ready_for_review'], JSON.stringify(rg));
  assert.deepEqual(await consumed(B.itemId), [1, 1]);
  pass('corrida: duas consultas concluídas juntas com autorização de 1 unidade — só uma consome; a outra fica pendente (o gatilho trava o item)');

  console.log(`\n${passed}/4 provas da série recorrente com autorização (P4.7).`);
  assert.equal(passed, 4);
} finally {
  await cluster.stop();
}
