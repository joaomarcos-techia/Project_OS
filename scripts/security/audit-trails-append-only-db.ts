/**
 * S5 — trilhas da clínica append-only (candidata 0171, padrão da ADR-075) em Postgres DESCARTÁVEL local, com o
 * código real do expurgo LGPD. Dados sintéticos.
 *
 *   1. INSERT continua (sessão da clínica e pool administrativo);
 *   2. UPDATE, DELETE e TRUNCATE recusados até para o DONO do banco, inclusive com
 *      `session_replication_role = replica` (gatilho ENABLE ALWAYS) e direto na partição do mês;
 *   3. a anonimização LGPD real (`anonymizePatientAuditTrail`) passa e só retira as chaves de dado pessoal;
 *   4. alteração que retira dado pessoal MAS muda outra coluna, ou retira chave fora da lista, é recusada;
 *   5. hi_account_events: UPDATE e DELETE recusados;
 *   6. limite honesto: o dono ainda pode DESABILITAR o gatilho por DDL (por isso a detecção do catálogo e a
 *      evidência externa da ADR-075); a reversão remove só os gatilhos.
 *
 *   SECURITY_PG_BIN=... PORT=55612 NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/audit-trails-append-only-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55612);
const CANDIDATE = '0171_audit_trails_append_only.candidate.sql';
const body = readFileSync(`docs/convenios/migrations/${CANDIDATE}`, 'utf8');
const rollback = readFileSync('docs/convenios/migrations/0171_audit_trails_append_only.rollback.sql', 'utf8');
const chain = await readDevOrderChain();
const cluster = await startScratchSchema({ port: PORT, maxConnections: 6, migrations: [...chain, { file: CANDIDATE, body }] });
const { sql } = cluster;
if (!new RegExp(`@(?:127\\.0\\.0\\.1|localhost):${PORT}/`, 'u').test(cluster.url)) throw new Error('não é o cluster local');
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';

const { anonymizePatientAuditTrail } = await import('../../src/contexts/patient/internal/hard-delete');
const { dbAdmin } = await import('../../src/lib/db');

let passed = 0;
const pass = (msg: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${msg}`);
};
const refused = (fn: () => Promise<unknown>) =>
  assert.rejects(fn, (e: { message?: string }) => /append-only/u.test(String(e.message)));

try {
  const clinic = randomUUID();
  const patient = randomUUID();
  await sql`insert into public.clinics (id, slug, nome, status) values (${clinic}::uuid, ${`au-${clinic.slice(0, 12)}`}, 'Clínica Trilha', 'active')`;

  // ── 1. INSERT continua ────────────────────────────────────────────
  const [row] = await sql`insert into public.audit_events (clinic_id, action, resource_type, resource_id, before, after, created_at)
    values (${clinic}::uuid, 'patient.updated', 'patient', ${patient}, jsonb_build_object('nome', 'Paciente Sintético', 'email', 'p@example.invalid', 'telefoneHash', 'h1'),
      jsonb_build_object('nome', 'Paciente Novo', 'sexo', 'F', 'status', 'ativo'), now()) returning id, created_at`;
  await sql.begin(async (tx) => {
    await tx.unsafe(`set local role authenticated`);
    await tx.unsafe(`select set_config('app.current_clinic', '${clinic}', true)`);
    await tx`insert into public.audit_events (clinic_id, action, resource_type, resource_id) values (${clinic}::uuid, 'teste.lido', 'patient', ${patient})`;
  });
  pass('INSERT continua: pelo dono e pela sessão da clínica (authenticated com app.current_clinic)');

  // ── 2. UPDATE/DELETE/TRUNCATE recusados até para o dono ───────────
  await refused(() => sql`update public.audit_events set action = 'adulterado' where id = ${row!.id}`);
  await refused(() => sql`delete from public.audit_events where id = ${row!.id}`);
  await refused(() => sql`truncate public.audit_events`);
  await refused(() => sql.begin(async (tx) => {
    await tx.unsafe('set local session_replication_role = replica');
    await tx`delete from public.audit_events where id = ${row!.id}`;
  }));
  const part = String((await sql`select tableoid::regclass::text as p from public.audit_events where id = ${row!.id}`)[0]!.p);
  await refused(() => sql.unsafe(`delete from ${part} where id = '${row!.id}'`));
  await assert.rejects(() => sql.begin(async (tx) => {
    await tx.unsafe('set local role authenticated');
    await tx.unsafe(`select set_config('app.current_clinic', '${clinic}', true)`);
    await tx`delete from public.audit_events where clinic_id = ${clinic}::uuid`;
  }));
  pass(`UPDATE, DELETE e TRUNCATE recusados para o dono (inclusive com session_replication_role=replica) e direto na partição ${part}; authenticated sem privilégio`);

  // ── 3. Anonimização LGPD real passa ───────────────────────────────
  await anonymizePatientAuditTrail(dbAdmin as never, [patient]);
  const [after] = await sql`select action, resource_id, created_at, before, after from public.audit_events where id = ${row!.id}`;
  assert.deepEqual(after!.before, { telefoneHash: 'h1' });
  assert.deepEqual(after!.after, { status: 'ativo' });
  assert.equal(after!.action, 'patient.updated');
  assert.equal(new Date(after!.created_at as string).getTime(), new Date(row!.created_at as string).getTime());
  pass('anonimização LGPD real (anonymizePatientAuditTrail): retira nome, e-mail e sexo; ação, recurso e data ficam idênticos');

  // ── 4. "Anonimização" que muda outra coisa é recusada ─────────────
  const [r2] = await sql`insert into public.audit_events (clinic_id, action, resource_type, resource_id, before)
    values (${clinic}::uuid, 'patient.updated', 'patient', ${randomUUID()}, jsonb_build_object('nome', 'X', 'cpfHash', 'c')) returning id`;
  await refused(() => sql`update public.audit_events set before = before - 'nome', action = 'outra' where id = ${r2!.id}`);
  await refused(() => sql`update public.audit_events set before = before - 'cpfHash' where id = ${r2!.id}`);
  pass('retirar dado pessoal mudando outra coluna, ou retirar chave fora da lista, é recusado');

  // ── 5. hi_account_events ──────────────────────────────────────────
  const [ev] = await sql`insert into public.hi_account_events (clinic_id, guide_id, action, actor_kind) values (${clinic}::uuid, ${randomUUID()}::uuid, 'gloss_recorded', 'system') returning id`;
  await refused(() => sql`update public.hi_account_events set note = 'adulterado' where id = ${ev!.id}`);
  await refused(() => sql`delete from public.hi_account_events where id = ${ev!.id}`);
  await refused(() => sql`truncate public.hi_account_events`);
  pass('hi_account_events (histórico da conta da guia): UPDATE, DELETE e TRUNCATE recusados');

  // ── 6. Limite honesto e reversão ──────────────────────────────────
  const [{ enabled }] = (await sql`select tgenabled::text as enabled from pg_trigger where tgname = 'audit_events_append_only_row' and tgrelid = 'public.audit_events'::regclass`) as unknown as [{ enabled: string }];
  assert.equal(enabled, 'A'); // ALWAYS — a detecção do catálogo da ADR-075 confere isto
  await sql.unsafe(rollback);
  await sql`delete from public.audit_events where id = ${r2!.id}`;
  pass('catálogo: gatilho ALWAYS (o que a detecção da ADR-075 confere); o DONO ainda pode removê-lo por DDL — a reversão prova isso e devolve o comportamento anterior');

  console.log(`\n${passed}/6 provas da trilha append-only da clínica (S5) passaram.`);
  assert.equal(passed, 6);
} finally {
  await cluster.stop();
}
