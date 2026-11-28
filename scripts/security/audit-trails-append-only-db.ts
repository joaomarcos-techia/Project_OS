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
 *   6. compatibilidade: excluir clínica COM histórico TISS é recusado (cascata); sem histórico, continua possível;
 *   7. partições: TRUNCATE direto na partição recusado (o gatilho de comando do pai não dispara nele; a selagem
 *      cria um em cada partição) e o default ACL do Supabase na partição é revogado;
 *   8. partição nova: o provisionador (código real) sela depois de criar;
 *   9. detecção pelo catálogo (`append-only-barrier.ts`): 7 adulterações do dono acusadas, cada uma desfeita;
 *  10. limite honesto: o dono ainda pode REMOVER a barreira por DDL (a reversão prova) — por isso a detecção e a
 *      ancoragem externa da ADR-075;
 *  11. replay: reaplicar depois da reversão devolve a proteção.
 *
 *   SECURITY_PG_BIN=... PORT=55612 NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/audit-trails-append-only-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  CLINIC_AUDIT_BARRIER,
  inspectAppendOnlyBarrier,
  sealAuditPartitionsIfInstalled,
} from '../../src/lib/db/append-only-barrier';

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

  // ── 6. Compatibilidade: exclusão de clínica (reset:prod/dev e limpeza de E2E fazem DELETE FROM clinics) ──
  const withHistory = randomUUID();
  const withoutHistory = randomUUID();
  await sql`insert into public.clinics (id, slug, nome, status) values
    (${withHistory}::uuid, ${`au-h-${withHistory.slice(0, 10)}`}, 'Clínica com histórico TISS', 'active'),
    (${withoutHistory}::uuid, ${`au-s-${withoutHistory.slice(0, 10)}`}, 'Clínica sem histórico', 'active')`;
  await sql`insert into public.hi_account_events (clinic_id, guide_id, action, actor_kind) values (${withHistory}::uuid, ${randomUUID()}::uuid, 'payment_recorded', 'system')`;
  await refused(() => sql`delete from public.clinics where id = ${withHistory}::uuid`);
  await sql`delete from public.clinics where id = ${withoutHistory}::uuid`;
  assert.equal((await sql`select 1 from public.clinics where id = ${withHistory}::uuid`).length, 1);
  pass('exclusão de clínica COM histórico da conta TISS é recusada (o ON DELETE CASCADE bate no gatilho); clínica sem histórico continua excluível — reset:prod/dev e limpezas de E2E precisam preservar a trilha antes da promoção');

  // ── 7. Partições seladas (achado de 27/11): TRUNCATE direto na partição e default ACL do Supabase ──
  const parts = (await sql`select i.inhrelid::regclass::text as p from pg_inherits i where i.inhparent = 'public.audit_events'::regclass order by 1`).map((r) => String(r.p));
  assert.ok(parts.length >= 12, `partições de audit_events: ${parts.length}`);
  await refused(() => sql.unsafe(`truncate ${part}`));
  await refused(() => sql.begin(async (tx) => {
    await tx.unsafe('set local session_replication_role = replica');
    await tx.unsafe(`truncate ${part}`);
  }));
  assert.equal((await sql`select count(*)::int as n from public.audit_events where id = ${row!.id}`)[0]!.n, 1);
  // Emula o default ACL do Supabase (Production: service_role com TRUNCATE e authenticated com DML nas 13 partições).
  await sql.unsafe(`grant update, delete, truncate on ${part} to authenticated, service_role`);
  await sql`select public.clinic_audit_seal_partitions()`;
  const leaked = await sql`select c.oid::regclass::text as rel, r.rolname, p.priv from pg_inherits i join pg_class c on c.oid = i.inhrelid
      cross join pg_roles r cross join unnest(array['UPDATE','DELETE','TRUNCATE']) p(priv)
     where i.inhparent = 'public.audit_events'::regclass and r.rolname in ('anon','authenticated','service_role')
       and has_table_privilege(r.oid, c.oid, p.priv)`;
  assert.deepEqual([...leaked], []);
  const sealedStates = await sql`select count(*)::int as n from pg_trigger t join pg_inherits i on i.inhrelid = t.tgrelid
     where i.inhparent = 'public.audit_events'::regclass and t.tgname = 'audit_events_append_only_stmt' and t.tgenabled = 'A'`;
  assert.equal(sealedStates[0]!.n, parts.length);
  pass(`partições: TRUNCATE direto em ${part} recusado ao DONO (também com replica) e a linha continua; as ${parts.length} partições têm o gatilho de comando em ALWAYS; o default ACL do Supabase (UPDATE/DELETE/TRUNCATE na partição) é revogado pela selagem`);

  // ── 8. Partição NOVA: o provisionador (código real) sela depois de criar ──
  const catalog = (q: typeof sql) => async (text: string, params: unknown[]) =>
    (await q.unsafe(text, params as never[])) as unknown as Array<Record<string, unknown>>;
  const NOW = new Date('2026-11-27T12:00:00Z');
  await sql.unsafe(`create table if not exists audit_events_2027_09 partition of audit_events for values from ('2027-09-01') to ('2027-10-01')`);
  await sql.unsafe('grant update, delete, truncate on audit_events_2027_09 to service_role');
  const unsealed = await inspectAppendOnlyBarrier(catalog(sql), CLINIC_AUDIT_BARRIER, NOW);
  assert.ok(unsealed.findings.some((f) => f.kind === 'trigger_missing' && f.table === 'public.audit_events_2027_09' && f.trigger === 'audit_events_append_only_stmt'), JSON.stringify(unsealed.findings));
  assert.ok(unsealed.findings.some((f) => f.kind === 'privilege_granted' && f.table === 'public.audit_events_2027_09' && f.privilege === 'TRUNCATE'), JSON.stringify(unsealed.findings));
  const sealedCount = await sealAuditPartitionsIfInstalled(catalog(sql));
  assert.equal(sealedCount, parts.length + 1);
  await refused(() => sql.unsafe('truncate audit_events_2027_09'));
  const healthy = await inspectAppendOnlyBarrier(catalog(sql), CLINIC_AUDIT_BARRIER, NOW);
  assert.deepEqual(healthy.findings, []);
  assert.equal(healthy.ok, true);
  pass(`partição nova: nasce sem o gatilho de comando e com TRUNCATE para o service_role (a checagem acusa os dois); o provisionador sela as ${sealedCount}; depois, checagem limpa (${healthy.relationsChecked} relações conferidas)`);

  // ── 9. Detecção de adulteração pelo catálogo: cada DDL do dono que tira a barreira aparece ──
  type Report = Awaited<ReturnType<typeof inspectAppendOnlyBarrier>>;
  const tamper = async (ddl: string, found: (r: Report) => boolean, label: string) => {
    const ROLLBACK = new Error('desfaz');
    let seen: Report | undefined;
    await sql.begin(async (tx) => {
      await tx.unsafe(ddl);
      seen = await inspectAppendOnlyBarrier(catalog(tx as unknown as typeof sql), CLINIC_AUDIT_BARRIER, NOW);
      throw ROLLBACK;
    }).catch((e) => { if (e !== ROLLBACK) throw e; });
    assert.ok(seen && !seen.ok && found(seen), `${label}: ${JSON.stringify(seen?.findings)}`);
    return label;
  };
  const detected = [
    await tamper('alter table public.audit_events disable trigger audit_events_append_only_row',
      (r) => r.findings.some((f) => f.kind === 'trigger_not_always' && f.table === 'public.audit_events' && f.state === 'disabled'), 'gatilho de linha desabilitado no pai'),
    await tamper(`alter table ${part} enable trigger audit_events_append_only_stmt`,
      (r) => r.findings.some((f) => f.kind === 'trigger_not_always' && f.table === `public.${part}` && f.state === 'origin'), 'gatilho de comando de UMA partição tirado de ALWAYS (replica o desligaria)'),
    await tamper(`drop trigger audit_events_append_only_stmt on ${part}`,
      (r) => r.findings.some((f) => f.kind === 'trigger_missing' && f.table === `public.${part}`), 'gatilho de comando removido de uma partição'),
    await tamper(`create or replace function public.clinic_audit_append_only() returns trigger language plpgsql set search_path = public, pg_temp as $f$ begin return coalesce(new, old); end; $f$`,
      (r) => r.findings.some((f) => f.kind === 'function_changed' && f.fn === 'public.clinic_audit_append_only'), 'função do gatilho reescrita para aceitar tudo'),
    await tamper(`grant delete on ${part} to authenticated`,
      (r) => r.findings.some((f) => f.kind === 'privilege_granted' && f.table === `public.${part}` && f.role === 'authenticated' && f.privilege === 'DELETE'), 'DELETE devolvido ao authenticated numa partição'),
    await tamper('grant update on public.hi_account_events to authenticated',
      (r) => r.findings.some((f) => f.kind === 'privilege_granted' && f.table === 'public.hi_account_events' && f.privilege === 'UPDATE'), 'UPDATE devolvido em hi_account_events'),
    await tamper('alter table public.audit_events detach partition audit_events_2026_09',
      (r) => r.findings.some((f) => f.kind === 'partition_missing' && f.month === '2026_09'), 'partição de 2026-09 (menos de 180 dias) desanexada'),
  ];
  assert.deepEqual((await inspectAppendOnlyBarrier(catalog(sql), CLINIC_AUDIT_BARRIER, NOW)).findings, []);
  pass(`detecção pelo catálogo: ${detected.length}/7 adulterações acusadas (${detected.join('; ')}); barreira intacta = checagem limpa`);

  // ── 10. Limite honesto e reversão ─────────────────────────────────
  const [{ enabled }] = (await sql`select tgenabled::text as enabled from pg_trigger where tgname = 'audit_events_append_only_row' and tgrelid = 'public.audit_events'::regclass`) as unknown as [{ enabled: string }];
  assert.equal(enabled, 'A'); // ALWAYS — a detecção do catálogo confere isto
  await sql.unsafe(rollback);
  await sql`delete from public.audit_events where id = ${r2!.id}`;
  assert.equal((await sql`select count(*)::int as n from pg_trigger where tgname in ('audit_events_append_only_row', 'audit_events_append_only_stmt', 'hi_account_events_append_only_row', 'hi_account_events_append_only_stmt') and not tgisinternal`)[0]!.n, 0);
  assert.equal((await inspectAppendOnlyBarrier(catalog(sql), CLINIC_AUDIT_BARRIER, NOW)).installed, false);
  pass('o DONO ainda pode remover a barreira por DDL — a reversão prova isso: tira os gatilhos do pai, das partições e de hi_account_events, e a checagem passa a ver "não instalada"');

  // ── 11. Recuperação: reaplicar depois da reversão (replay) devolve a proteção ──
  await sql.unsafe(body);
  const [r3] = await sql`insert into public.audit_events (clinic_id, action, resource_type, resource_id) values (${clinic}::uuid, 'teste.replay', 'patient', ${randomUUID()}) returning id`;
  await refused(() => sql`update public.audit_events set action = 'adulterado' where id = ${r3!.id}`);
  await refused(() => sql.unsafe(`truncate ${part}`));
  assert.deepEqual((await inspectAppendOnlyBarrier(catalog(sql), CLINIC_AUDIT_BARRIER, NOW)).findings, []);
  pass('recuperação: a 0171 reaplica limpa depois da reversão, volta a recusar UPDATE e o TRUNCATE da partição, e a checagem fica limpa');

  console.log(`\n${passed}/11 provas da trilha append-only da clínica (S5) passaram.`);
  assert.equal(passed, 11);
} finally {
  await cluster.stop();
}
