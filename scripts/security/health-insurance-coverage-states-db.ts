/**
 * Convênios P5.1 — estados administrativos da cobertura: NENHUM estado bloqueia o atendimento
 * clínico. Postgres DESCARTÁVEL (cadeia do DEV), dados sintéticos, transições reais do Scheduling e
 * o worker real do outbox (handlers da plataforma). Nunca no DEV compartilhado.
 *
 *   1. cinco atendimentos de convênio, um em cada estado administrativo (pronta; incompleta sem
 *      carteirinha; aguardando autorização; autorização negada; senha vencida) e as pendências com
 *      o responsável certo;
 *   2. todos passam por chegada, atendimento, prontuário assinado e conclusão pelo caminho real
 *      (`applyTransition`), sem nenhuma recusa vinda de Convênios;
 *   3. depois da conclusão, o administrativo segue o seu caminho sem desfazer o clínico: a pronta
 *      vira guia; as outras viram pendência de faturamento (sem guia, sem recebível do paciente) e o
 *      atendimento continua "atendido".
 *
 *   SECURITY_PG_BIN=... NODE_OPTIONS="--import ./scripts/security/server-only-hook.mjs" \
 *     ./node_modules/.bin/tsx --tsconfig tsconfig.scripts.json scripts/security/health-insurance-coverage-states-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55561);
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
const { recordAppointmentCoverage } = await import('../../src/contexts/health-insurance/internal/coverage-service');
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

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  const C = await fx.setupClinic('Estados da cobertura');
  const asUser = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(C.clinicId, fn, C.doctorId);
  const [proc] = await sql`select id::text from public.procedures where clinic_id = ${C.clinicId}::uuid limit 1`;
  // Operadora cujo contrato EXIGE autorização (a da fixture não exige): mesmo código e procedimento.
  const [ins] = await sql`insert into public.hi_insurers (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, status, created_by)
    values (${C.clinicId}::uuid, 'Operadora que Autoriza', '654321', 'codigoPrestadorNaOperadora', 'TESTE002', 'active', ${SYS_ACTOR}::uuid) returning id::text`;
  const insurerId = String(ins!.id);
  await sql`insert into public.hi_procedure_contracts (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id,
      unit_value_cents, valid_from, requires_authorization, created_by)
    values (${C.clinicId}::uuid, ${insurerId}::uuid, 'consulta', '22', '10101012', 'Consulta em consultório', ${proc!.id}::uuid, 15000, '2026-01-01', true, ${SYS_ACTOR}::uuid)`;
  await sql`insert into public.hi_credentials (clinic_id, insurer_id, plan_id, professional_id, valid_from, status, created_by)
    values (${C.clinicId}::uuid, ${insurerId}::uuid, null, null, '2020-01-01', 'active', ${SYS_ACTOR}::uuid),
           (${C.clinicId}::uuid, ${insurerId}::uuid, null, ${C.doctorId}::uuid, '2020-01-01', 'active', ${SYS_ACTOR}::uuid)`;
  const [pt] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
    values (${C.clinicId}::uuid, 'Paciente Sintética Estados', 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id::text`;
  const patientId = String(pt!.id);
  const [card] = await sql`insert into public.hi_memberships (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
    values (${C.clinicId}::uuid, ${patientId}::uuid, ${insurerId}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${randomUUID().replace(/-/g, '').padEnd(64, '0')}, '7777', ${SYS_ACTOR}::uuid)
    returning id::text`;
  const membershipId = String(card!.id);
  // Outra paciente, com carteirinha e SEM nenhuma autorização: a guia não pode ligar autorização alguma.
  const [pt2] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
    values (${C.clinicId}::uuid, 'Paciente Sintética Sem Autorização', 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id::text`;
  const [card2] = await sql`insert into public.hi_memberships (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
    values (${C.clinicId}::uuid, ${pt2!.id}::uuid, ${insurerId}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${randomUUID().replace(/-/g, '').padEnd(64, '0')}, '8888', ${SYS_ACTOR}::uuid)
    returning id::text`;

  const authorization = async (decision: 'authorized' | 'denied', validUntil: string) => {
    const { authorizationId } = await asUser((tx) => auths.requestManualAuthorizationTx(tx, {
      clinicId: C.clinicId, insurerId, membershipId, requestedOn: '2026-11-01',
      items: [{ tableCode: '22', procedureCode: '10101012', quantityRequested: 1 }], actorUserId: C.doctorId,
    }));
    const [a] = await sql`select version from public.hi_authorizations where id = ${authorizationId}::uuid`;
    const items = await sql`select id::text from public.hi_authorization_items where authorization_id = ${authorizationId}::uuid`;
    await asUser((tx) => auths.recordManualAuthorizationResponseTx(tx, decision === 'denied'
      ? { decision, clinicId: C.clinicId, authorizationId, version: Number(a!.version), actorUserId: C.doctorId, denialReason: 'Negada pela operadora (sintético)' }
      : {
          decision, clinicId: C.clinicId, authorizationId, version: Number(a!.version), actorUserId: C.doctorId, authorizedOn: '2026-11-02',
          operatorGuideNumber: `OP${randomUUID().slice(0, 8)}`, password: 'SENHA-SINTETICA', passwordValidUntil: validUntil,
          items: items.map((i) => ({ itemId: String(i.id), quantityAuthorized: 1 })),
        }));
    return authorizationId;
  };
  const okAuth = await authorization('authorized', '2026-12-31');
  const deniedAuth = await authorization('denied', '2026-12-31');
  const expiredAuth = await authorization('authorized', '2026-11-05');

  let minute = 0;
  const appointment = async (who: string = patientId) => {
    minute += 1;
    const [a] = await sql`insert into public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
        snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via, billing_mode)
      values (${C.clinicId}::uuid, ${C.doctorId}::uuid, ${who}::uuid, ${proc!.id}::uuid,
        '2026-11-12T12:00:00Z'::timestamptz + ${minute} * interval '35 minutes', 30, 'agendado', 150,
        'Consulta', 150, 30, 'Dra. Sintética', 'attendant', 'convenio') returning id::text`;
    return String(a!.id);
  };
  const cover = (appointmentId: string, opts: { membershipId: string | null; authorizationId: string | null; patient?: string }) =>
    asUser((tx) => recordAppointmentCoverage(tx, {
      clinicId: C.clinicId, appointmentId, patientId: opts.patient ?? patientId, procedureId: String(proc!.id), appointmentDate: '2026-11-12', guideType: 'consulta',
      insurerId, planId: null, membershipId: opts.membershipId, authorizationId: opts.authorizationId, actor: { kind: 'user', userId: C.doctorId },
    }));

  // 1. Um atendimento em cada estado administrativo.
  const cases = [
    { name: 'pronta', opts: { membershipId, authorizationId: okAuth }, status: 'ready', owner: null },
    { name: 'incompleta (sem carteirinha)', opts: { membershipId: null, authorizationId: null }, status: 'incomplete', owner: 'recepcao' },
    { name: 'aguardando autorização', opts: { membershipId: String(card2!.id), authorizationId: null, patient: String(pt2!.id) }, status: 'pending_authorization', owner: null },
    { name: 'autorização negada', opts: { membershipId, authorizationId: deniedAuth }, status: 'authorization_denied', owner: null },
    { name: 'senha vencida', opts: { membershipId, authorizationId: expiredAuth }, status: 'incomplete', owner: 'recepcao' },
  ] as const;
  const ids: string[] = [];
  for (const c of cases) {
    const id = await appointment('patient' in c.opts ? c.opts.patient : patientId);
    const out = await cover(id, c.opts);
    assert.equal(out.status, c.status, c.name);
    if (c.owner) assert.ok(out.issues.some((i) => i.owner === c.owner), `${c.name}: pendência com responsável`);
    ids.push(id);
  }
  pass('cinco atendimentos de convênio, um por estado administrativo (pronta, incompleta, aguardando autorização, negada, senha vencida), com a pendência e o responsável');

  // 2. O clínico anda em todos: chegada, atendimento, prontuário assinado, conclusão (caminho real).
  for (const [i, id] of ids.entries()) {
    for (const target of ['chegou', 'em_atendimento'] as const) {
      await asUser((tx) => applyTransition(tx, {
        clinicId: C.clinicId, appointmentId: id, target, transitionedBy: C.doctorId, actorType: 'user',
        clientKey: `${target}-${id}`, correlationId: null,
      }));
    }
    await sql`insert into public.prontuarios (clinic_id, patient_id, doctor_id, appointment_id, status, signed_at, signed_by, content_encrypted)
      values (${C.clinicId}::uuid, (select patient_id from public.appointments where id = ${id}::uuid), ${C.doctorId}::uuid, ${id}::uuid, 'assinado', now(), ${C.doctorId}::uuid, 'ciphertext-sintetico')`;
    await asUser((tx) => applyTransition(tx, {
      clinicId: C.clinicId, appointmentId: id, target: 'atendido', transitionedBy: C.doctorId, actorType: 'user',
      clientKey: `concluir-${id}`, correlationId: null,
    }));
    const [st] = await sql`select status::text from public.appointments where id = ${id}::uuid`;
    assert.equal(st!.status, 'atendido', `${cases[i]!.name}: concluído`);
  }
  pass('em todos os estados o atendimento passa por chegada, atendimento, prontuário assinado e conclusão pelo caminho real, sem recusa vinda de Convênios');

  // 3. O administrativo segue sem desfazer o clínico.
  for (let i = 0; i < 6; i++) await runOutboxOnce({ batchSize: 50, parallelism: 1 });
  const guides = await sql`select i.appointment_id::text as ap, g.status from public.hi_guide_items i
      join public.hi_guides g on g.clinic_id = i.clinic_id and g.id = i.guide_id where i.clinic_id = ${C.clinicId}::uuid`;
  const guideStatus = new Map(guides.map((g) => [String(g.ap), String(g.status)]));
  assert.equal(guideStatus.get(ids[0]!), 'ready_for_review', 'a pronta vira guia pronta para conferir');
  for (const [i, id] of ids.slice(1).entries()) {
    const st = guideStatus.get(id);
    // Com pendência, a automação no máximo guarda a guia "pendente de dados" (nunca conferível).
    assert.ok(st === undefined || st === 'pending_data', `${cases[i + 1]!.name}: guia ${st}`);
  }
  const gaps = await sql`select appointment_id::text as ap from public.hi_billing_gaps where clinic_id = ${C.clinicId}::uuid and status = 'open'`;
  const gapSet = new Set(gaps.map((g) => String(g.ap)));
  for (const id of ids.slice(1)) assert.ok(gapSet.has(id), 'pendência de faturamento aberta');
  const charges = await sql`select count(*)::int as n from public.patient_charges where clinic_id = ${C.clinicId}::uuid`;
  assert.equal(Number(charges[0]!.n), 0, 'nenhuma cobrança ao paciente');
  const still = await sql`select count(*)::int as n from public.appointments where id = any(${`{${ids.join(',')}}`}::uuid[]) and status = 'atendido'`;
  assert.equal(Number(still[0]!.n), 5);
  pass('depois da conclusão, a pronta vira guia pronta para conferir; as outras viram pendência de faturamento com o responsável (no máximo guia "pendente de dados", nunca conferível; sem cobrança ao paciente); todos continuam "atendido"');

  console.log(`\n${passed}/3 provas dos estados administrativos da cobertura (P5.1).`);
  assert.equal(passed, 3);
} finally {
  await cluster.stop();
}
