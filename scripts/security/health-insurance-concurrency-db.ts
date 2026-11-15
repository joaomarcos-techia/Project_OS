/**
 * P14.2 — concorrência (G.7 do plano mestre) em Postgres DESCARTÁVEL, com o código real.
 *
 * Os cenários da G.7 que já tinham prova própria continuam nos seus harnesses (evento entregue N
 * vezes, worker interrompido e duas reconciliações simultâneas em `billing-reconcile`; correção só
 * por substituição e exportação concorrente em `batches`; falha no meio do recebível em
 * `ledger-bridge`/`glosses-payments`; importação simultânea do demonstrativo em `statement-import`).
 * Este harness cobre os que faltavam prova DIRETA, cada um disparado de verdade em paralelo
 * (transações separadas, `Promise.allSettled`):
 *
 *  1. a MESMA consulta finalizada por 4 caminhos ao mesmo tempo → uma guia, um número;
 *  2. aprovação concorrente da MESMA guia (3 aprovações) → uma vence, as outras recebem conflito
 *     com mensagem (nunca erro cru do banco), um snapshot só;
 *  3. dois usuários montando lotes com guias em comum ao mesmo tempo → nenhuma guia em dois lotes
 *     ativos; o perdedor é recusado e as guias dele ficam livres;
 *  4. o mesmo pedido de lote reenviado em paralelo (mesma chave de idempotência) → um lote.
 *
 * Não toca DEV nem produção. Uso:
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-concurrency-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { credentialAllPlans, grantPaidSubscription, startScratchSchema } from './scratch-schema';

const cluster = await startScratchSchema({
  port: Number(process.env.PORT ?? 55539),
  maxConnections: 24,
});
const { sql } = cluster;
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');
if (!/@(?:127\.0\.0\.1|localhost):\d+\//u.test(cluster.url))
  throw new Error('não é o cluster local');

const { withTenant } = await import('../../src/lib/db/tenant');
const { sql: sqlTag } = await import('drizzle-orm');
const { createConsultaGuideForAppointment } =
  await import('../../src/contexts/health-insurance/internal/consulta-guide-service');
const { issueConsultaGuide, GuideIssuanceError } =
  await import('../../src/contexts/health-insurance/internal/guide-issuance');
const svc = await import('../../src/contexts/health-insurance/internal/batch-service');

const SYS = '00000000-0000-0000-0000-0000000000aa';
const CARD = '0081234500012345'; // sintético
const results: string[] = [];
const pass = (msg: string) => {
  results.push(msg);
  console.log(`PASS: ${msg}`);
};

const clinicId = randomUUID();
const doctorId = randomUUID();
const otherUser = randomUUID();
let insurerId = '';
let procedureId = '';
let slot = 0;

try {
  // Terminologia TUSS mínima da Consulta (a mesma semeadura do harness de lotes).
  await sql`GRANT SELECT ON public.clinics TO authenticated`;
  const [tv] = await sql<{ id: string }[]>`
    insert into public.tiss_terminology_versions (version, archive_url, archive_sha256, manifest_sha256)
    values ('202609', 'https://example.invalid/tuss.zip', ${'a'.repeat(64)}, ${'b'.repeat(64)}) returning id::text as id`;
  await sql`insert into public.tiss_terms (version_id, table_code, code, term, starts_on)
    values (${tv!.id}::uuid, '22', '10101012', 'Consulta em consultório (no horário normal ou preestabelecido)', '2010-01-01'),
           (${tv!.id}::uuid, '24', '225125', 'Médico clínico', '2010-01-01'),
           (${tv!.id}::uuid, '26', '06', 'Conselho Regional de Medicina (CRM)', '2010-01-01'),
           (${tv!.id}::uuid, '36', '9', 'Não acidente', '2010-01-01'),
           (${tv!.id}::uuid, '52', '1', 'Primeira consulta', '2010-01-01'),
           (${tv!.id}::uuid, '59', '35', 'São Paulo', '2010-01-01'),
           (${tv!.id}::uuid, '76', '01', 'Ambulatorial', '2010-01-01'),
           (${tv!.id}::uuid, '87', '22', 'Procedimentos e eventos em saúde', '2010-01-01')`;

  // ── Clínica paga, módulo habilitado, operadora com contrato de Consulta ─────────────────────
  for (const id of [doctorId, otherUser]) {
    await sql`insert into auth.users (id, email) values (${id}::uuid, ${`${id}@example.invalid`})`;
  }
  await sql`insert into public.clinics (id, slug, nome, status)
    values (${clinicId}::uuid, ${`cc-${clinicId.slice(0, 8)}`}, 'Clínica Concorrência', 'active')`;
  await grantPaidSubscription(sql, clinicId);
  await sql`insert into public.profiles (id, clinic_id, nome, role, ativo) values
    (${doctorId}::uuid, ${clinicId}::uuid, 'Dra. Sintética', 'doctor', true),
    (${otherUser}::uuid, ${clinicId}::uuid, 'Gestora Sintética', 'gestor', true)`;
  await sql`insert into public.hi_clinic_settings (clinic_id, enabled, enabled_at, enabled_by, provider_kind, cnes_status)
    values (${clinicId}::uuid, true, now(), ${SYS}::uuid, 'PJ', 'none_declared')`;
  await sql`insert into public.hi_professional_profiles (clinic_id, professional_id, council, council_number, council_uf, cbo)
    values (${clinicId}::uuid, ${doctorId}::uuid, '06', '12345', '35', '225125')`;
  const [proc] = await sql<{ id: string }[]>`
    insert into public.procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
    values (${clinicId}::uuid, 'CONS', 'Consulta sintética', 150, 30, true) returning id::text as id`;
  procedureId = proc!.id;
  const [ins] = await sql<{ id: string }[]>`
    insert into public.hi_insurers (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, status, created_by)
    values (${clinicId}::uuid, 'Operadora Sintética', '123456', 'codigoPrestadorNaOperadora', 'TESTE001', 'active', ${SYS}::uuid)
    returning id::text as id`;
  insurerId = ins!.id;
  await credentialAllPlans(sql, clinicId);
  await sql`insert into public.hi_procedure_contracts
      (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id, unit_value_cents, valid_from, created_by)
    values (${clinicId}::uuid, ${insurerId}::uuid, 'consulta', '22', '10101012', 'Consulta em consultório', ${procedureId}::uuid,
      15000, '2026-01-01', ${SYS}::uuid)`;

  /** Paciente, carteirinha e atendimento ATENDIDO de convênio (sintéticos). */
  const attended = async () => {
    slot += 1;
    const [pt] = await sql<{ id: string }[]>`
      insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
      values (${clinicId}::uuid, ${`Paciente Sintético ${slot}`}, 'ciphertext-de-teste', ${`hash-${randomUUID()}`})
      returning id::text as id`;
    const [card] = await sql<{ id: string }[]>`
      insert into public.hi_memberships (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
      values (${clinicId}::uuid, ${pt!.id}::uuid, ${insurerId}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
        ${randomUUID().replace(/-/gu, '').padEnd(64, '0')}, '2345', ${SYS}::uuid)
      returning id::text as id`;
    const [a] = await sql<{ id: string }[]>`
      insert into public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
        snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via)
      values (${clinicId}::uuid, ${doctorId}::uuid, ${pt!.id}::uuid, ${procedureId}::uuid,
        '2026-11-10T13:00:00Z'::timestamptz + ${slot} * interval '31 minutes', 30, 'atendido', 150,
        'Consulta', 150, 30, 'Dra. Sintética', 'attendant')
      returning id::text as id`;
    return { patientId: pt!.id, membershipId: card!.id, appointmentId: a!.id };
  };
  const finalize = (ap: Awaited<ReturnType<typeof attended>>) =>
    withTenant(clinicId, (tx) =>
      createConsultaGuideForAppointment(tx, {
        clinicId,
        appointment: {
          id: ap.appointmentId,
          patientId: ap.patientId,
          professionalId: doctorId,
          procedureId,
          date: '2026-11-10',
          billingMode: 'convenio',
        },
        coverage: { insurerId, planId: null, membershipId: ap.membershipId },
        terminologyVersion: '202609',
        actor: { kind: 'automation' },
      }),
    );
  const review = (guideId: string) =>
    withTenant(
      clinicId,
      (tx) =>
        tx.execute(
          sqlTag`update public.hi_guides set status = 'reviewed', reviewed_by = ${doctorId}::uuid where id = ${guideId}::uuid`,
        ),
      doctorId,
    );
  const approve = (guideId: string, membershipId: string, actor = doctorId) =>
    withTenant(
      clinicId,
      (tx) =>
        issueConsultaGuide(tx, {
          clinicId,
          guideId,
          card: { membershipId, cardNumber: CARD, auditEventId: 'leitura-auditada-simulada' },
          newborn: false,
          professionalName: 'Dra. Sintética',
          actorUserId: actor,
          today: '2026-12-31',
        }),
      actor,
    );
  /** Erro do banco que vazaria cru para a tela (o que a G.7 proíbe como "conflito"). */
  const rawDbCode = (e: unknown) => {
    const err = e as { code?: string; cause?: { code?: string } };
    return err.code ?? err.cause?.code ?? null;
  };

  /** Erro legível: código, constraint e a mensagem do banco (sem a query inteira). */
  const describe = (e: unknown) => {
    const err = e as {
      message?: string;
      cause?: { code?: string; message?: string; constraint_name?: string };
    };
    return `${rawDbCode(e)} ${err.cause?.constraint_name ?? ''} ${err.cause?.message ?? String(err.message).slice(0, 120)}`;
  };

  // ── 1. A mesma consulta finalizada 4 vezes ao mesmo tempo ───────────────────────────────────
  const ap1 = await attended();
  const numbersBefore = (await sql<{ n: number }[]>`
    select count(*)::int as n from public.hi_guides where clinic_id = ${clinicId}::uuid`)[0]!.n;
  const outs1 = await Promise.allSettled(Array.from({ length: 4 }, () => finalize(ap1)));
  const fulfilled1 = outs1.flatMap((o) => (o.status === 'fulfilled' ? [o.value] : []));
  const rejected1 = outs1.flatMap((o) => (o.status === 'rejected' ? [o.reason as unknown] : []));
  assert.deepEqual(
    rejected1.map(describe),
    [],
    'nenhum caminho de finalização pode falhar com erro cru',
  );
  const kinds1 = fulfilled1.map((o) => o.kind).sort();
  assert.equal(kinds1.filter((k) => k === 'created').length, 1, kinds1.join(','));
  assert.ok(
    kinds1.every((k) => k === 'created' || k === 'existing'),
    kinds1.join(','),
  );
  const guides1 = await sql<{ id: string; number: string }[]>`
    select id::text as id, number from public.hi_guides
     where clinic_id = ${clinicId}::uuid and idempotency_key = ${`appointment:${ap1.appointmentId}:consulta`}`;
  assert.equal(guides1.length, 1);
  const ids1 = new Set(fulfilled1.map((o) => ('guideId' in o ? o.guideId : null)));
  assert.deepEqual([...ids1], [guides1[0]!.id], 'todos os caminhos devolvem a MESMA guia');
  const numbersAfter = (await sql<{ n: number }[]>`
    select count(*)::int as n from public.hi_guides where clinic_id = ${clinicId}::uuid`)[0]!.n;
  assert.equal(numbersAfter - numbersBefore, 1);
  pass(
    `mesma consulta finalizada 4 vezes ao mesmo tempo: 1 guia (nº ${guides1[0]!.number}), ${kinds1.filter((k) => k === 'existing').length} caminhos recebem a existente, nenhum erro`,
  );

  // ── 2. Aprovação concorrente da mesma guia ──────────────────────────────────────────────────
  const guide2 = guides1[0]!.id;
  await review(guide2);
  const outs2 = await Promise.allSettled([
    approve(guide2, ap1.membershipId, doctorId),
    approve(guide2, ap1.membershipId, otherUser),
    approve(guide2, ap1.membershipId, doctorId),
  ]);
  const won2 = outs2.filter((o) => o.status === 'fulfilled');
  const lost2 = outs2.flatMap((o) => (o.status === 'rejected' ? [o.reason as unknown] : []));
  assert.equal(won2.length, 1, `vencedoras: ${won2.length}`);
  for (const e of lost2) {
    assert.ok(
      e instanceof GuideIssuanceError,
      `conflito deve vir como mensagem da emissão, não erro cru (${rawDbCode(e)}: ${(e as Error).message})`,
    );
  }
  const [g2] = await sql<
    { status: string; snapshots: number; approved_snapshot_id: string | null }[]
  >`
    select g.status, g.approved_snapshot_id::text,
           (select count(*)::int from public.hi_guide_snapshots s where s.guide_id = g.id) as snapshots
      from public.hi_guides g where g.id = ${guide2}::uuid`;
  assert.equal(g2!.status, 'approved');
  assert.equal(g2!.snapshots, 1);
  pass(
    `aprovação concorrente (3 ao mesmo tempo): 1 vence, ${lost2.length} recebem conflito com mensagem ("${(lost2[0] as Error).message}"); 1 snapshot, guia aprovada`,
  );

  // ── 3. Dois usuários montando lotes com guias em comum ──────────────────────────────────────
  const approvedGuide = async () => {
    const ap = await attended();
    const out = await finalize(ap);
    assert.equal(out.kind, 'created');
    const id = (out as { guideId: string }).guideId;
    await review(id);
    await approve(id, ap.membershipId);
    return id;
  };
  const [ga, gb, gc, gd] = [
    await approvedGuide(),
    await approvedGuide(),
    await approvedGuide(),
    await approvedGuide(),
  ];
  const create = (guideIds: string[], key: string, actor: string) =>
    withTenant(
      clinicId,
      (tx) =>
        svc.createBatchInTx(tx, {
          clinicId,
          insurerId,
          guideType: 'consulta',
          guideIds,
          idempotencyKey: key,
          replacesBatchId: null,
        }),
      actor,
    );
  const outs3 = await Promise.allSettled([
    create([guide2, ga, gb], `lote-u1-${randomUUID()}`, doctorId),
    create([gb, gc], `lote-u2-${randomUUID()}`, otherUser),
  ]);
  const won3 = outs3.filter((o) => o.status === 'fulfilled');
  const lost3 = outs3.flatMap((o) => (o.status === 'rejected' ? [o.reason as unknown] : []));
  assert.equal(won3.length, 1, `lotes criados: ${won3.length}`);
  assert.equal(lost3.length, 1);
  const inTwo = await sql<{ guide_id: string; n: number }[]>`
    select bg.guide_id::text, count(*)::int as n
      from public.hi_batch_guides bg join public.hi_batches b on b.id = bg.batch_id
     where b.clinic_id = ${clinicId}::uuid and b.status <> 'cancelled'
     group by bg.guide_id having count(*) > 1`;
  assert.deepEqual([...inTwo], []);
  const freed = await sql<{ n: number }[]>`
    select count(*)::int as n from public.hi_batch_guides bg
     where bg.guide_id = any(${[gc]}::uuid[])`;
  const winnerHasGc = (won3[0] as PromiseFulfilledResult<string>).value
    ? (
        await sql<{ n: number }[]>`
          select count(*)::int as n from public.hi_batch_guides
           where batch_id = ${(won3[0] as PromiseFulfilledResult<string>).value}::uuid and guide_id = ${gc}::uuid`
      )[0]!.n
    : 0;
  assert.equal(freed[0]!.n, winnerHasGc, 'as guias do pedido perdedor ficam livres');
  pass(
    `dois usuários montando lotes com uma guia em comum ao mesmo tempo: 1 lote criado, o outro recusado (${rawDbCode(lost3[0]) ?? 'regra'}: ${String((lost3[0] as Error).message).slice(0, 90)}); nenhuma guia em dois lotes ativos`,
  );

  // ── 4. O mesmo pedido de lote reenviado em paralelo ─────────────────────────────────────────
  const key4 = `lote-reenvio-${randomUUID()}`;
  const free = [gd, ...(winnerHasGc ? [] : [gc])];
  const outs4 = await Promise.allSettled(
    Array.from({ length: 3 }, () => create(free, key4, otherUser)),
  );
  const ids4 = new Set(outs4.flatMap((o) => (o.status === 'fulfilled' ? [o.value] : [])));
  const rej4 = outs4.flatMap((o) => (o.status === 'rejected' ? [o.reason as unknown] : []));
  assert.deepEqual(rej4.map(describe), [], 'reenvio com a mesma chave não pode falhar');
  assert.equal(ids4.size, 1, `lotes distintos para a mesma chave: ${ids4.size}`);
  const batches4 = (await sql<{ n: number }[]>`
    select count(*)::int as n from public.hi_batches where clinic_id = ${clinicId}::uuid and idempotency_key = ${key4}`)[0]!.n;
  assert.equal(batches4, 1);
  pass(
    'o mesmo pedido de lote reenviado 3 vezes ao mesmo tempo (mesma chave): 1 lote, as 3 respostas com o mesmo id',
  );

  // ── Efeito financeiro: nada disso cria lançamento ───────────────────────────────────────────
  const lanc = (await sql<{ n: number }[]>`
    select count(*)::int as n from public.lancamentos where clinic_id = ${clinicId}::uuid`)[0]!.n;
  assert.equal(lanc, 0);
  pass(
    'nenhum lançamento financeiro nasce de finalização, aprovação ou formação de lote concorrentes',
  );

  console.log(`\nOK ${results.length}/${results.length}`);
} finally {
  await cluster.stop();
}
