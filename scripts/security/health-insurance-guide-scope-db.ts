/**
 * Convênios — matriz I.2, P1.12-b: o ESCOPO e os VALORES das leituras da interface em Postgres
 * DESCARTÁVEL (cadeia do DEV, dados sintéticos). Nunca no DEV compartilhado.
 *
 * O que a tela mostra não é a fronteira: as consultas do servidor recebem a visão (escopo + valores)
 * e filtram no SQL. Provas:
 *   1. visão ampla com valores (gestão/faturamento): lista e detalhe da clínica, com valores;
 *   2. visão ampla SEM valores (recepção): a mesma guia, mas nenhum valor sai (total, itens, conta,
 *      glosas, pagamentos, recursos e recebível nulos ou vazios); painel sem totais por operadora;
 *   3. só as próprias (D-4): a executante vê a sua guia; outra profissional da MESMA clínica não a
 *      encontra (lista vazia, detalhe nulo = "não encontrada", não confirma existência); o painel
 *      conta só as próprias e não mostra pendências da clínica;
 *   4. atendimentos (D-3): sem visão ampla, só os atendimentos da própria profissional;
 *   5. preço do contrato (D-1, matriz 4.4): sem configurar nem ver faturamento, o preço não sai;
 *   6. isolamento: outra clínica não vê nada, com qualquer visão.
 *
 *   SECURITY_PG_BIN=... PORT=55553 NODE_OPTIONS=--conditions=react-server \
 *     npx tsx scripts/security/health-insurance-guide-scope-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55553);
const chain = await readDevOrderChain();
const cluster = await startScratchSchema({ port: PORT, maxConnections: 8, migrations: chain });
const { sql } = cluster;
if (!new RegExp(`@(?:127\\.0\\.0\\.1|localhost):${PORT}/`, 'u').test(cluster.url)) throw new Error('não é o cluster local');
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');

const q = await import('../../src/contexts/health-insurance/queries');
const cq = await import('../../src/contexts/health-insurance/config-queries');
const { loadXmllintValidator } = await import('../../src/contexts/health-insurance/tiss/xml/xsd-validator');
const { loadHiFixtures } = await import('./hi-fixtures');

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
const pass = (m: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${m}`);
};
const CLINIC_VIEW = { kind: 'clinic' as const };

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  const A = await fx.setupClinic('Escopo A');
  const B = await fx.setupClinic('Escopo B');
  const g1 = await A.approvedGuide();
  // Outra profissional da MESMA clínica (sem guia).
  const other = randomUUID();
  await sql`insert into auth.users (id, email) values (${other}::uuid, ${`${other}@example.invalid`})`;
  await sql`insert into public.profiles (id, clinic_id, nome, role, ativo) values (${other}::uuid, ${A.clinicId}::uuid, 'Dra. Outra Sintética', 'doctor', true)`;
  const FULL = { scope: CLINIC_VIEW, values: true };
  const RECEPTION = { scope: CLINIC_VIEW, values: false };
  const OWN = (professionalId: string) => ({ scope: { kind: 'own' as const, professionalId }, values: false });

  // 1. Visão ampla com valores.
  const full = await q.listGuides(A.clinicId, {}, FULL);
  assert.deepEqual(full.rows.map((r) => r.id), [g1]);
  assert.ok((full.rows[0]!.totalValueCents ?? 0) > 0);
  const dFull = (await q.getGuideDetail(A.clinicId, g1, FULL))!;
  assert.ok(dFull.totalValueCents! > 0 && dFull.items.every((i) => i.totalValueCents !== null));
  const oFull = await q.getInsuranceOverview(A.clinicId, FULL);
  assert.ok(oFull.totals !== null);
  pass('visão ampla com valores (gestão/faturamento): a guia da clínica com valor na lista, no detalhe e nos totais do painel');

  // 2. Visão ampla SEM valores (recepção).
  const rec = await q.listGuides(A.clinicId, {}, RECEPTION);
  assert.deepEqual(rec.rows.map((r) => [r.id, r.totalValueCents]), [[g1, null]]);
  const dRec = (await q.getGuideDetail(A.clinicId, g1, RECEPTION))!;
  assert.deepEqual(
    [dRec.totalValueCents, dRec.items.map((i) => i.totalValueCents), dRec.account, dRec.glosses, dRec.allocations, dRec.appeals, dRec.receivable],
    [null, dRec.items.map(() => null), null, [], [], [], null],
  );
  assert.ok(dRec.items.length > 0 && dRec.events.length > 0, 'itens e histórico continuam (sem valores)');
  const oRec = await q.getInsuranceOverview(A.clinicId, RECEPTION);
  assert.deepEqual([oRec.totals, oRec.insurers, oRec.ledgerDrift], [null, [], 0]);
  assert.equal(oRec.guidesByStatus.approved, 1);
  pass('visão ampla sem valores (recepção): a guia aparece, mas nenhum valor sai do servidor (total, itens, conta, glosas, pagamentos, recursos, recebível); painel sem totais por operadora, com as contagens');

  // 3. Só as próprias (D-4).
  const mine = await q.listGuides(A.clinicId, {}, OWN(A.doctorId));
  assert.deepEqual(mine.rows.map((r) => [r.id, r.totalValueCents]), [[g1, null]]);
  assert.ok(await q.getGuideDetail(A.clinicId, g1, OWN(A.doctorId)));
  const notMine = await q.listGuides(A.clinicId, {}, OWN(other));
  assert.deepEqual([notMine.rows, notMine.total], [[], 0]);
  assert.equal(await q.getGuideDetail(A.clinicId, g1, OWN(other)), null, 'guia de outra profissional = não encontrada');
  const oMine = await q.getInsuranceOverview(A.clinicId, OWN(A.doctorId));
  const oOther = await q.getInsuranceOverview(A.clinicId, OWN(other));
  assert.deepEqual([oMine.guidesByStatus.approved, oOther.guidesByStatus.approved ?? 0, oOther.openGapsByOwner, oOther.totals], [1, 0, {}, null]);
  pass('só as próprias (D-4): a executante vê a sua guia, sem valores; outra profissional da mesma clínica não a encontra (lista vazia, detalhe nulo) e o painel dela conta zero, sem pendências da clínica');

  // 4. Atendimentos (D-3): só os da própria profissional.
  const future = await sql`insert into public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
      snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via, billing_mode)
    select clinic_id, doctor_id, patient_id, procedure_id, now() + interval '2 days', 30, 'agendado', valor,
           snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, 'attendant', 'convenio'
      from public.appointments where clinic_id = ${A.clinicId}::uuid limit 1
    returning id`;
  const apId = String(future[0]!.id);
  const upClinic = await cq.listUpcomingInsuranceAppointments(A.clinicId, CLINIC_VIEW);
  const upMine = await cq.listUpcomingInsuranceAppointments(A.clinicId, { kind: 'own', professionalId: A.doctorId });
  const upOther = await cq.listUpcomingInsuranceAppointments(A.clinicId, { kind: 'own', professionalId: other });
  assert.ok(upClinic.some((x) => x.appointmentId === apId));
  assert.ok(upMine.some((x) => x.appointmentId === apId));
  assert.deepEqual(upOther, []);
  assert.equal(await cq.hasOwnAppointmentWithPatient(A.clinicId, other, String((await sql`select patient_id from public.appointments where id = ${apId}::uuid`)[0]!.patient_id)), false);
  pass('atendimentos (D-3): sem visão ampla, a lista traz só os atendimentos da própria profissional; a posse do paciente é falsa para outra profissional');

  // 5. Preço do contrato (D-1, matriz 4.4).
  const insurerId = A.insurerId;
  const withPrices = await cq.getInsurerDetail(A.clinicId, insurerId, { prices: true });
  const noPrices = await cq.getInsurerDetail(A.clinicId, insurerId, { prices: false });
  assert.ok(withPrices && withPrices.lines.length > 0 && withPrices.lines.every((l) => (l.unitValueCents ?? 0) > 0));
  assert.ok(noPrices && noPrices.lines.length === withPrices.lines.length && noPrices.lines.every((l) => l.unitValueCents === null));
  pass('preço do contrato (D-1): sem configurar nem ver faturamento, as linhas aparecem sem o valor unitário (nulo no servidor)');

  // 6. Isolamento.
  for (const view of [FULL, RECEPTION, OWN(A.doctorId)]) {
    assert.deepEqual((await q.listGuides(B.clinicId, {}, view)).rows.filter((r) => r.id === g1), []);
    assert.equal(await q.getGuideDetail(B.clinicId, g1, view), null);
  }
  pass('isolamento: a clínica B não vê a guia da A com nenhuma visão (ampla, sem valores ou própria)');

  console.log(`\n${passed}/6 provas de escopo e valores das leituras (matriz I.2).`);
  assert.equal(passed, 6);
} finally {
  await cluster.stop();
}
