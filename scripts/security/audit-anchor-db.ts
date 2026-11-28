/**
 * S5 / P12.10 — a ancoragem por hash encadeado (`src/lib/db/audit-anchor.ts`) contra o banco DESCARTÁVEL, com o SQL
 * real das duas trilhas (`audit_events`, particionada, e `super_admin_actions`). Dados sintéticos.
 *
 *   1. resumos por dia das duas trilhas, encadeados a partir do gênese; conferência íntegra = nenhum achado;
 *   2. determinístico: outra sessão com outro fuso e só leitura calcula exatamente os mesmos resumos;
 *   3. a anonimização LGPD real (`anonymizePatientAuditTrail`) NÃO quebra a cadeia (as chaves retiradas ficam fora);
 *   4. adulterações do dono (o que sobra depois de desligar os gatilhos por DDL): apagar, alterar a ação, inserir com
 *      data retroativa e mudar uma chave que não é dado pessoal são acusados no dia certo, com a quantidade;
 *   5. a trilha da plataforma: mudar o payload de uma ação do super admin é acusado;
 *   6. a sequência guardada fora editada (um dia retirado) é acusada como cadeia quebrada;
 *   7. nada disso escreve: o cálculo roda numa transação READ ONLY;
 *   8. apagar a partição inteira de um mês (DETACH + DROP pelo dono do banco) é acusado em cada dia dela.
 *
 *   SECURITY_PG_BIN=... PORT=55643 NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/audit-anchor-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { connectScratch, startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55643);
const cluster = await startScratchSchema({ port: PORT, maxConnections: 6 });
const { sql } = cluster;
if (!new RegExp(`@(?:127\\.0\\.0\\.1|localhost):${PORT}/`, 'u').test(cluster.url))
  throw new Error('não é o cluster local');
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';

const anchor = await import('../../src/lib/db/audit-anchor');
const { anonymizePatientAuditTrail } =
  await import('../../src/contexts/patient/internal/hard-delete');
const { dbAdmin } = await import('../../src/lib/db');

let passed = 0;
const pass = (msg: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${msg}`);
};
type Q = Parameters<typeof anchor.computeAnchors>[0];
const queryOf =
  (q: { unsafe: (t: string, p: never[]) => Promise<unknown> }): Q =>
  async (text, params) =>
    (await q.unsafe(text, params as never[])) as Array<Record<string, unknown>>;
const DAYS = ['2027-09-01', '2027-09-02', '2027-09-03', '2027-09-04'] as const;
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00Z`;

try {
  const clinic = randomUUID();
  const patient = randomUUID();
  await sql`insert into public.clinics (id, slug, nome, status)
    values (${clinic}::uuid, ${`anc-${clinic.slice(0, 12)}`}, 'Clínica Âncora', 'active')`;
  await sql.unsafe(
    `create table if not exists audit_events_2027_09 partition of audit_events for values from ('2027-09-01') to ('2027-10-01')`,
  );
  const ev = async (day: string, hhmm: string, action: string, canal: string | null = null) =>
    (
      await sql`insert into public.audit_events (clinic_id, action, resource_type, resource_id, before, after, created_at)
        values (${clinic}::uuid, ${action}, 'patient', ${patient},
          jsonb_strip_nulls(jsonb_build_object('nome', 'Paciente Sintético', 'email', 'p@example.invalid',
            'telefoneHash', 'h1', 'canal', ${canal}::text)),
          jsonb_build_object('status', 'ativo'), ${at(day, hhmm)}::timestamptz)
        returning id, created_at`
    )[0]!;
  const d1a = await ev(DAYS[0], '10:00', 'patient.updated');
  await ev(DAYS[0], '11:00', 'patient.viewed');
  const d2 = await ev(DAYS[1], '09:00', 'patient.updated');
  await ev(DAYS[2], '15:00', 'patient.updated');
  const d4 = await ev(DAYS[3], '08:00', 'patient.updated', 'whatsapp');
  const superAdmin = randomUUID();
  const sa = async (day: string, hhmm: string, motivo: string) =>
    (
      await sql`insert into public.super_admin_actions (super_admin_id, action, target_clinic_id, payload, created_at)
        values (${superAdmin}::uuid, 'support.session.started', ${clinic}::uuid, jsonb_build_object('motivo', ${motivo}::text),
          ${at(day, hhmm)}::timestamptz) returning id`
    )[0]!;
  const sa1 = await sa(DAYS[0], '12:00', 'chamado sintético 1');
  await sa(DAYS[1], '12:00', 'chamado sintético 2');

  // ── 1. resumos íntegros ────────────────────────────────────────────
  const q = queryOf(sql as never);
  const clinicAnchors = await anchor.computeAnchors(
    q,
    anchor.CLINIC_AUDIT_ANCHOR,
    DAYS[0],
    DAYS[3],
  );
  const platformAnchors = await anchor.computeAnchors(
    q,
    anchor.PLATFORM_AUDIT_ANCHOR,
    DAYS[0],
    DAYS[3],
  );
  assert.deepEqual(
    clinicAnchors.map((a) => a.count),
    [2, 1, 1, 1],
  );
  assert.deepEqual(
    platformAnchors.map((a) => a.count),
    [1, 1, 0, 0],
  );
  assert.equal(clinicAnchors[0]!.prev, anchor.ANCHOR_GENESIS);
  assert.deepEqual(await anchor.verifyAnchors(q, anchor.CLINIC_AUDIT_ANCHOR, clinicAnchors), []);
  assert.deepEqual(
    await anchor.verifyAnchors(q, anchor.PLATFORM_AUDIT_ANCHOR, platformAnchors),
    [],
  );
  pass(
    'resumos por dia das duas trilhas, encadeados do gênese; a conferência íntegra não acusa nada',
  );

  // ── 2. determinístico em outra sessão, outro fuso, só leitura ──────
  const other = connectScratch(cluster.url, 1);
  try {
    const again = await other.begin('read only', async (tx) => {
      await tx.unsafe(`set local timezone = 'America/Sao_Paulo'`);
      await tx.unsafe(`set local datestyle = 'SQL, DMY'`);
      const [ro] = await tx.unsafe(`select current_setting('transaction_read_only') as ro`);
      assert.equal((ro as unknown as { ro: string }).ro, 'on');
      return anchor.computeAnchors(
        queryOf(tx as never),
        anchor.CLINIC_AUDIT_ANCHOR,
        DAYS[0],
        DAYS[3],
      );
    });
    assert.deepEqual(again, clinicAnchors);
  } finally {
    await other.end({ timeout: 5 });
  }
  pass(
    'determinístico: outra sessão (fuso de São Paulo, outro datestyle, READ ONLY) calcula os mesmos resumos',
  );

  // ── 3. anonimização LGPD real não quebra ───────────────────────────
  await anonymizePatientAuditTrail(dbAdmin as never, [patient]);
  const [anon] = await sql`select before from public.audit_events where id = ${d1a.id}`;
  assert.deepEqual(anon!.before, { telefoneHash: 'h1' });
  assert.deepEqual(await anchor.verifyAnchors(q, anchor.CLINIC_AUDIT_ANCHOR, clinicAnchors), []);
  pass(
    'a anonimização LGPD real retira nome e e-mail e a cadeia continua íntegra (as chaves anonimizadas ficam fora do hash)',
  );

  // ── 4. adulterações do dono ────────────────────────────────────────
  await sql`delete from public.audit_events where id = ${d1a.id}`;
  await sql`update public.audit_events set action = 'patient.viewed' where id = ${d2.id}`;
  await sql`insert into public.audit_events (clinic_id, action, resource_type, created_at)
    values (${clinic}::uuid, 'patient.exported', 'patient', ${at(DAYS[2], '16:00')}::timestamptz)`;
  await sql`update public.audit_events set before = before || '{"canal":"telefone"}'::jsonb where id = ${d4.id}`;
  assert.deepEqual(await anchor.verifyAnchors(q, anchor.CLINIC_AUDIT_ANCHOR, clinicAnchors), [
    { kind: 'day_changed', day: DAYS[0], storedCount: 2, currentCount: 1 },
    { kind: 'day_changed', day: DAYS[1], storedCount: 1, currentCount: 1 },
    { kind: 'day_changed', day: DAYS[2], storedCount: 1, currentCount: 2 },
    { kind: 'day_changed', day: DAYS[3], storedCount: 1, currentCount: 1 },
  ]);
  pass(
    'adulterações do dono acusadas no dia certo: apagar (2→1), alterar a ação, inserir retroativo (1→2) e mudar chave que não é dado pessoal',
  );

  // ── 5. trilha da plataforma ────────────────────────────────────────
  await sql`update public.super_admin_actions set payload = '{"motivo":"reescrito"}'::jsonb where id = ${sa1.id}`;
  assert.deepEqual(await anchor.verifyAnchors(q, anchor.PLATFORM_AUDIT_ANCHOR, platformAnchors), [
    { kind: 'day_changed', day: DAYS[0], storedCount: 1, currentCount: 1 },
  ]);
  pass('trilha da plataforma: o payload reescrito de uma ação do super admin é acusado');

  // ── 6. sequência guardada editada ──────────────────────────────────
  const gap = [platformAnchors[1]!, platformAnchors[3]!];
  const found = await anchor.verifyAnchors(q, anchor.PLATFORM_AUDIT_ANCHOR, gap);
  assert.ok(
    found.some((f) => f.kind === 'chain_broken' && f.day === DAYS[3]),
    JSON.stringify(found),
  );
  pass('a sequência guardada fora com um dia retirado é acusada como cadeia quebrada');

  // ── 7. nada escreve ───────────────────────────────────────────────
  const [before] =
    await sql`select (select count(*) from public.audit_events)::int a, (select count(*) from public.super_admin_actions)::int s`;
  await sql.begin('read only', async (tx) => {
    await anchor.computeAnchors(queryOf(tx as never), anchor.CLINIC_AUDIT_ANCHOR, DAYS[0], DAYS[3]);
    await anchor.verifyAnchors(queryOf(tx as never), anchor.PLATFORM_AUDIT_ANCHOR, platformAnchors);
  });
  const [after] =
    await sql`select (select count(*) from public.audit_events)::int a, (select count(*) from public.super_admin_actions)::int s`;
  assert.deepEqual(after, before);
  pass('cálculo e conferência rodam em transação READ ONLY; nenhuma linha muda');

  // ── 8. apagar a partição inteira (o dono do banco, por fora da aplicação) ──
  await sql.unsafe(`alter table audit_events detach partition audit_events_2027_09`);
  await sql.unsafe(`drop table audit_events_2027_09`);
  assert.deepEqual(
    (await anchor.verifyAnchors(q, anchor.CLINIC_AUDIT_ANCHOR, clinicAnchors)).map((f) =>
      f.kind === 'day_changed' ? [f.day, f.storedCount, f.currentCount] : f.kind,
    ),
    [
      [DAYS[0], 2, 0],
      [DAYS[1], 1, 0],
      [DAYS[2], 1, 0],
      [DAYS[3], 1, 0],
    ],
  );
  pass(
    'apagar a partição inteira (DETACH + DROP pelo dono do banco) é acusado em cada dia: as linhas somem, o resumo guardado fora não',
  );

  console.log(`\naudit-anchor-db: ${passed}/8 PASS`);
  assert.equal(passed, 8);
} finally {
  await dbAdmin.$client.end({ timeout: 5 }).catch(() => undefined);
  await cluster.stop();
}
