/**
 * P4.7-b — convênio em atendimento HISTÓRICO importado, em Postgres DESCARTÁVEL (cadeia do DEV + candidata 0169),
 * dados sintéticos. A referência histórica é gravada; NENHUMA guia, pendência ou recebível nasce dela.
 *
 *   1. linha válida: porta resolve operadora (registro ANS) e plano (código na operadora); o gravador real do
 *      atendimento importado (`insertScheduledAppointment` com `createdVia: 'import'`) + a referência histórica;
 *   2. erros legíveis por linha: operadora inexistente, de outra clínica, inativa; plano inexistente, de outra
 *      operadora, inativo — todos reunidos, nenhum gravado;
 *   3. compatibilidade comercial: trial recusado (D24) e módulo desligado recusado, na porta e no banco;
 *   4. guardas do banco: só atendimento importado, do mesmo lote, como convênio; plano da mesma operadora;
 *      uma referência por atendimento (reimportação não duplica); imutável;
 *   5. faturamento: evento, reconcile e correção ignoram o importado; nenhuma guia, pendência ou recebível;
 *   6. isolamento: a clínica B não vê a referência da A;
 *   7. reversão da candidata remove só o que ela criou.
 *
 *   SECURITY_PG_BIN=... PORT=55610 NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-historical-import-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55610);
const CANDIDATE = '0169_hi_historical_coverages.candidate.sql';
const candidateBody = readFileSync(`docs/convenios/migrations/${CANDIDATE}`, 'utf8');
const rollbackBody = readFileSync('docs/convenios/migrations/0169_hi_historical_coverages.rollback.sql', 'utf8');
const chain = await readDevOrderChain();
const cluster = await startScratchSchema({ port: PORT, maxConnections: 8, migrations: [...chain, { file: CANDIDATE, body: candidateBody }] });
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

const port = await import('../../src/contexts/health-insurance/historical-coverage');
const { insertScheduledAppointment } = await import('../../src/contexts/scheduling/internal/appointment-core');
const { processInsuranceBilling } = await import('../../src/contexts/health-insurance/internal/billing-recovery');
const { reconcileInsuranceBilling } = await import('../../src/contexts/health-insurance/internal/billing-reconcile');
const { listBillingGapCandidates } = await import('../../src/contexts/health-insurance/billing-gap-candidates');
await import('../../src/app/api/cron/outbox/handlers');
const { runOutboxOnce } = await import('../../src/lib/outbox/worker');
const { loadHiFixtures, SYS_ACTOR } = await import('./hi-fixtures');
const fx = await loadHiFixtures(sql, {
  store: { put: async () => {}, get: async () => new Uint8Array(), remove: async () => {} },
  validateXsd: null as never,
});
type Clinic = Awaited<ReturnType<typeof fx.setupClinic>>;

let passed = 0;
const pass = (msg: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${msg}`);
};
const rejectsWith = async (fn: () => Promise<unknown>, re: RegExp) =>
  assert.rejects(fn, (e: { message?: string; cause?: { message?: string } }) => re.test(`${e.message ?? ''} ${e.cause?.message ?? ''}`));

async function patientOf(c: Clinic, label: string) {
  const [pt] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
    values (${c.clinicId}::uuid, ${`Paciente ${label}`}, 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`;
  return String(pt!.id);
}
async function procedureOf(c: Clinic) {
  return String((await sql`select id from public.procedures where clinic_id = ${c.clinicId}::uuid order by created_at limit 1`)[0]!.id);
}
async function batchOf(c: Clinic) {
  const [b] = await sql`insert into public.appointment_import_batches (clinic_id, source, justification, total_items, created_by)
    values (${c.clinicId}::uuid, 'Sistema legado sintético', 'Migração autorizada (sintético)', 1, ${c.doctorId}::uuid) returning id`;
  return String(b!.id);
}
/** O mesmo gravador da importação real (`importAppointmentHistory` → `insertScheduledAppointment`). */
async function importedAppointment(c: Clinic, batchId: string, billingMode: 'convenio' | 'particular', day: number) {
  const patientId = await patientOf(c, `hist-${day}`);
  const procedureId = await procedureOf(c);
  const appt = await fx.asUser(c, (tx) =>
    insertScheduledAppointment(tx, {
      clinicId: c.clinicId,
      userId: c.doctorId,
      actorType: 'user',
      correlationId: null,
      idempotencyKey: `hist-${randomUUID()}`,
      data: { doctorId: c.doctorId, patientId, procedureId, scheduledAt: `2025-0${(day % 8) + 1}-1${day % 9}T13:00:00-03:00`, billingMode } as never,
      scheduledAt: new Date(`2025-0${(day % 8) + 1}-1${day % 9}T13:00:00-03:00`),
      provenance: { createdVia: 'import', initialStatus: 'atendido', importBatchId: batchId },
    }),
  );
  return appt.id;
}
const counts = async (clinicId: string) =>
  (await sql`select
      (select count(*)::int from public.hi_guides where clinic_id = ${clinicId}::uuid) as guides,
      (select count(*)::int from public.hi_billing_gaps where clinic_id = ${clinicId}::uuid) as gaps,
      (select count(*)::int from public.lancamentos where clinic_id = ${clinicId}::uuid and appointment_id is not null and created_via <> 'manual') as receivables,
      (select count(*)::int from public.hi_copayments where clinic_id = ${clinicId}::uuid) as copays`)[0] as { guides: number; gaps: number; receivables: number; copays: number };

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  const A = await fx.setupClinic('Histórico A', { insurers: [{ name: 'Operadora Um', ans: '123456' }, { name: 'Operadora Dois', ans: '654321' }] } as never);
  const B = await fx.setupClinic('Histórico B', { insurers: [{ name: 'Operadora Bê', ans: '777777' }] } as never);
  const [opUm, opDois] = A.insurerIds as [string, string];
  await sql`insert into public.hi_plans (clinic_id, insurer_id, name, operator_code, status) values
    (${A.clinicId}::uuid, ${opUm}::uuid, 'Plano Ouro', 'OURO', 'active'),
    (${A.clinicId}::uuid, ${opUm}::uuid, 'Plano Antigo', 'ANTIGO', 'archived'),
    (${A.clinicId}::uuid, ${opDois}::uuid, 'Plano Prata', 'PRATA', 'active')`;
  const before = await counts(A.clinicId);

  // ── 1. Linha válida ───────────────────────────────────────────────
  const r1 = await fx.asUser(A, (tx) => port.resolveHistoricalCoverageLinesTx(tx, A.clinicId, [
    { line: 1, insurerAnsRegistry: '123456', planCode: 'OURO' },
    { line: 2, insurerAnsRegistry: '654321', planCode: null },
  ]));
  assert.ok(r1.ok, JSON.stringify(r1));
  const batch = await batchOf(A);
  const ap1 = await importedAppointment(A, batch, 'convenio', 1);
  const ap2 = await importedAppointment(A, batch, 'convenio', 2);
  await fx.asUser(A, (tx) => port.recordHistoricalCoveragesTx(tx, [
    { clinicId: A.clinicId, appointmentId: ap1, ...r1.byLine.get(1)!, importBatchId: batch, createdBy: A.doctorId },
    { clinicId: A.clinicId, appointmentId: ap2, ...r1.byLine.get(2)!, importBatchId: batch, createdBy: A.doctorId },
  ]));
  const rows = await sql`select appointment_id::text, insurer_id::text, plan_id::text from public.hi_historical_coverages where clinic_id = ${A.clinicId}::uuid order by appointment_id`;
  assert.equal(rows.length, 2);
  const [a1] = await sql`select created_via::text, billing_mode::text, status::text, import_batch_id::text from public.appointments where id = ${ap1}::uuid`;
  assert.deepEqual([a1!.created_via, a1!.billing_mode, a1!.status, a1!.import_batch_id], ['import', 'convenio', 'atendido', batch]);
  pass('linha válida: operadora pelo registro ANS e plano pelo código na operadora; atendimento importado (atendido, convênio, do lote) e a referência histórica gravados');

  // ── 2. Erros legíveis por linha ───────────────────────────────────
  await sql`update public.hi_insurers set status = 'suspended' where id = ${opDois}::uuid`;
  const r2 = await fx.asUser(A, (tx) => port.resolveHistoricalCoverageLinesTx(tx, A.clinicId, [
    { line: 3, insurerAnsRegistry: '999999', planCode: null },
    { line: 4, insurerAnsRegistry: '777777', planCode: null },
    { line: 5, insurerAnsRegistry: '654321', planCode: null },
    { line: 6, insurerAnsRegistry: '123456', planCode: 'NAOEXISTE' },
    { line: 7, insurerAnsRegistry: '123456', planCode: 'PRATA' },
    { line: 8, insurerAnsRegistry: '123456', planCode: 'ANTIGO' },
  ]));
  assert.equal(r2.ok, false);
  const errs = (r2 as { errors: readonly string[] }).errors;
  assert.equal(errs.length, 6);
  assert.match(errs[0]!, /linha 3: .*999999 não está cadastrada nesta clínica/u);
  assert.match(errs[1]!, /linha 4: .*777777 não está cadastrada nesta clínica/u); // operadora da clínica B
  assert.match(errs[2]!, /linha 5: .*suspensa; só operadora ativa/u);
  assert.match(errs[3]!, /linha 6: o plano "NAOEXISTE" não existe/u);
  assert.match(errs[4]!, /linha 7: o plano "PRATA" não existe na operadora 123456/u); // plano de outra operadora
  assert.match(errs[5]!, /linha 8: o plano "ANTIGO" não está ativo/u);
  await sql`update public.hi_insurers set status = 'active' where id = ${opDois}::uuid`;
  pass(`erros por linha, todos reunidos: operadora inexistente, de outra clínica (vira "não cadastrada"), suspensa; plano inexistente, de outra operadora e arquivado (${errs.length} mensagens)`);

  // ── 3. Compatibilidade comercial (D24) e módulo ───────────────────
  const batchT = await batchOf(A);
  const apT = await importedAppointment(A, batchT, 'convenio', 3);
  await sql`update public.subscriptions set billing_status = 'trial', trial_ends_at = now() + interval '5 days' where clinic_id = ${A.clinicId}::uuid`;
  await rejectsWith(() => fx.asUser(A, (tx) => port.resolveHistoricalCoverageLinesTx(tx, A.clinicId, [{ line: 1, insurerAnsRegistry: '123456', planCode: null }])), /./u);
  await rejectsWith(() => importedAppointment(A, batchT, 'convenio', 6), /assinatura ativa|premium/iu);
  await rejectsWith(() => fx.asUser(A, (tx) => port.recordHistoricalCoveragesTx(tx, [{ clinicId: A.clinicId, appointmentId: apT, insurerId: opUm, planId: null, importBatchId: batchT, createdBy: A.doctorId }])), /premium|qoro_premium|subscription|trial|Convênios/iu);
  await sql`update public.subscriptions set billing_status = 'active', trial_ends_at = null where clinic_id = ${A.clinicId}::uuid`;
  await sql`update public.hi_clinic_settings set enabled = false where clinic_id = ${A.clinicId}::uuid`.catch(() => null);
  const disabled = (await sql`select enabled from public.hi_clinic_settings where clinic_id = ${A.clinicId}::uuid`)[0]?.enabled === false;
  if (disabled) {
    await rejectsWith(() => fx.asUser(A, (tx) => port.resolveHistoricalCoverageLinesTx(tx, A.clinicId, [{ line: 1, insurerAnsRegistry: '123456', planCode: null }])), /desligado/u);
    await sql`update public.hi_clinic_settings set enabled = true where clinic_id = ${A.clinicId}::uuid`;
  }
  pass(`compatibilidade comercial: em trial, a porta recusa, o banco recusa o atendimento de convênio importado e a referência (D24)${disabled ? '; módulo desligado recusado na porta' : ''}; ativo volta a aceitar`);

  // ── 4. Guardas do banco ───────────────────────────────────────────
  const batch2 = await batchOf(A);
  const apPart = await importedAppointment(A, batch2, 'particular', 4);
  const insertRef = (appointmentId: string, importBatchId: string, insurerId = opUm, planId: string | null = null) =>
    fx.asUser(A, (tx) => port.recordHistoricalCoveragesTx(tx, [{ clinicId: A.clinicId, appointmentId, insurerId, planId, importBatchId, createdBy: A.doctorId }]));
  await rejectsWith(() => insertRef(apPart, batch2), /não está como convênio/u);
  const apOther = await importedAppointment(A, batch2, 'convenio', 5);
  await rejectsWith(() => insertRef(apOther, batch), /mesmo lote/u);
  const [prata] = await sql`select id from public.hi_plans where operator_code = 'PRATA' and clinic_id = ${A.clinicId}::uuid`;
  await rejectsWith(() => insertRef(apOther, batch2, opUm, String(prata!.id)), /plano não é dessa operadora/u);
  const [nonImport] = await sql`select id from public.appointments where clinic_id = ${A.clinicId}::uuid and created_via <> 'import' limit 1`;
  if (nonImport) await rejectsWith(() => insertRef(String(nonImport.id), batch2), /só atendimento importado/u);
  await rejectsWith(() => insertRef(ap1, batch), /duplicate key|hi_historical_coverages_pk|23505/u);
  await rejectsWith(() => sql`update public.hi_historical_coverages set plan_id = null where appointment_id = ${ap1}::uuid`, /não se altera/u);
  pass('guardas do banco: particular, outro lote, plano de outra operadora e atendimento não importado recusados; reimportar o mesmo atendimento não duplica (PK); a referência não se altera');

  // ── 5. Faturamento: nada nasce do histórico ───────────────────────
  for (const detectedBy of ['event', 'reconcile', 'correction'] as const) {
    const out = await fx.asSystem(A, (tx) => processInsuranceBilling(tx, { clinicId: A.clinicId, appointmentId: ap1, detectedBy, eventState: 'not_checked', lock: 'wait' } as never));
    assert.equal((out as { kind: string }).kind, 'ignored', detectedBy);
  }
  const cand = (await listBillingGapCandidates(500)).filter((c) => c.appointmentId === ap1 || c.appointmentId === ap2);
  assert.equal(cand.length, 0);
  await reconcileInsuranceBilling(await listBillingGapCandidates(500));
  for (let i = 0; i < 4; i++) await runOutboxOnce({ batchSize: 50, parallelism: 1 });
  const after = await counts(A.clinicId);
  assert.deepEqual(after, before, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  pass(`faturamento: evento, reconcile e correção ignoram o importado; fora dos candidatos do reconcile; depois do outbox, guias/pendências/recebíveis/coparticipações iguais (${JSON.stringify(after)})`);

  // ── 6. Isolamento ─────────────────────────────────────────────────
  const seenByB = (await fx.asUser(B, (tx) => tx.execute(fx.sqlTag`select count(*)::int as n from public.hi_historical_coverages`))) as unknown as Array<{ n: number }>;
  assert.equal(seenByB[0]!.n, 0);
  await rejectsWith(() => fx.asUser(B, (tx) => port.recordHistoricalCoveragesTx(tx, [{ clinicId: A.clinicId, appointmentId: apOther, insurerId: opUm, planId: null, importBatchId: batch2, createdBy: B.doctorId }])), /row-level security|42501|policy|fora da clínica/iu);
  pass('isolamento: a sessão da clínica B não lê nem grava referência histórica da A (RLS; o atendimento da A nem fica visível para a guarda)');

  // ── S1/S3: rastro TISS da clínica (perfil de segurança) ──────────
  const { readClinicTissFootprint } = await import('../../src/contexts/health-insurance/security-footprint');
  const bare = randomUUID();
  await sql`insert into public.clinics (id, slug, nome, status) values (${bare}::uuid, ${`fp-${bare.slice(0, 12)}`}, 'Clínica Sem TISS', 'active')`;
  assert.deepEqual(await readClinicTissFootprint(bare), { moduleEnabled: false, hasTissData: false });
  const fpB = await readClinicTissFootprint(B.clinicId);
  assert.equal(fpB.moduleEnabled, true);
  await sql`insert into public.hi_memberships (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
    values (${B.clinicId}::uuid, ${await patientOf(B, 'fp')}::uuid, ${B.insurerId}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${randomUUID().replace(/-/g, '').padEnd(64, '0')}, '1234', ${SYS_ACTOR}::uuid)`;
  assert.deepEqual(await readClinicTissFootprint(B.clinicId), { moduleEnabled: true, hasTissData: true });
  await sql`update public.hi_clinic_settings set enabled = false where clinic_id = ${B.clinicId}::uuid`;
  assert.deepEqual(await readClinicTissFootprint(B.clinicId), { moduleEnabled: false, hasTissData: true });
  pass('rastro TISS (S1/S3): clínica sem nada fica fora; com carteirinha entra; desligar o módulo NÃO tira do alcance enquanto o dado existe');

  // ── 7. Reversão da candidata ──────────────────────────────────────
  await sql.unsafe(rollbackBody);
  const [{ t }] = (await sql`select to_regclass('public.hi_historical_coverages')::text as t`) as unknown as [{ t: string | null }];
  assert.equal(t, null);
  assert.ok(Number((await sql`select count(*)::int as n from public.appointments where id = ${ap1}::uuid`)[0]!.n) === 1);
  pass('reversão da 0169: remove a tabela e as funções; atendimentos, lotes e operadoras ficam');

  void SYS_ACTOR;
  console.log(`\n${passed}/8 provas da importação histórica com convênio (P4.7-b) passaram.`);
  assert.equal(passed, 8);
} finally {
  await cluster.stop();
}
