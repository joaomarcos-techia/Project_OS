/**
 * Ordem FINAL das migrations em Postgres DESCARTÁVEL local: a cadeia exata do DEV compartilhado (0000–0167 com a
 * 0159 do #53, `dev-order-chain.ts`), a 0168 do #64 lida do git do próprio #64, as candidatas do #55 (0169, 0170,
 * 0171) e a candidata da trilha da plataforma do #59 na posição 0172 (renumerada SÓ aqui; o arquivo dela não muda).
 * Nada é aplicado fora do descartável; nenhum arquivo de outra branch é alterado.
 *
 *   1. bytes: 0168, 0169–0171 e a do #59 com o sha256 do manifesto (`manifesto-migrations-2026-11-26.md`);
 *   2. a cadeia inteira aplica nessa ordem (173 arquivos) e os objetos de cada uma existem;
 *   3. as DUAS trilhas append-only conferidas pelo MESMO verificador do catálogo (`append-only-barrier.ts`): a da
 *      clínica (0171, spec pronta) e a da plataforma (#59, spec do contrato S5 com o hash tirado da candidata);
 *   4. as duas trilhas recusam UPDATE, DELETE e TRUNCATE até para o dono, inclusive com
 *      `session_replication_role = replica`; INSERT continua;
 *   5. adulterações do dono na trilha da plataforma são acusadas pelo verificador (cada uma desfeita);
 *   6. 0171 e 0172 não se tocam: objetos disjuntos, e a reversão da 0171 deixa a 0172 intacta.
 *
 *   SECURITY_PG_BIN="$(pg_config --bindir)" PORT=55631 NODE_OPTIONS=--conditions=react-server \
 *     npx tsx scripts/security/migration-final-order-db.ts
 *   (PR64_REF e PR59_REF trocam os commits lidos; padrão: os remotos de 27/11)
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  CLINIC_AUDIT_BARRIER,
  inspectAppendOnlyBarrier,
  type AppendOnlyBarrierSpec,
  type CatalogQuery,
} from '../../src/lib/db/append-only-barrier';
import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55631);
const PR64_REF = process.env.PR64_REF ?? '74823d64';
const PR59_REF = process.env.PR59_REF ?? 'c6e91bf1';
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 << 20 });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const manifest = readFileSync('docs/convenios/manifesto-migrations-2026-11-26.md', 'utf8');
const pinned = (file: string) => {
  const row = manifest.split('\n').find((l) => l.includes(`\`${file}\``) && /`[0-9a-f]{64}`/.test(l));
  assert.ok(row, `${file} sem hash no manifesto`);
  return /`([0-9a-f]{64})`/.exec(row)![1]!;
};

const results: string[] = [];
const pass = (n: number, msg: string) => {
  results.push(`PASS ${n}: ${msg}`);
  console.log(`PASS ${n}: ${msg}`);
};

// ── 1. bytes ─────────────────────────────────────────────────────────────────────────────────────
const m0168 = {
  file: '0168_saas_pix_replacement_intents.sql',
  body: git('show', `${PR64_REF}:docs/decoupling/asaas-to-abacatepay/migrations/0168_saas_pix_replacement_intents.sql`),
};
const tiss = ['0169_hi_historical_coverages', '0170_auth_password_history', '0171_audit_trails_append_only'].map((t) => ({
  file: `${t}.candidate.sql`,
  body: readFileSync(`docs/convenios/migrations/${t}.candidate.sql`, 'utf8'),
}));
const p59File = '0165_super_admin_actions_append_only.candidate.sql';
const m0172 = { file: `0172 (#59 ${p59File})`, body: git('show', `${PR59_REF}:docs/security/migrations/${p59File}`) };
assert.equal(sha(m0168.body), pinned('0168_saas_pix_replacement_intents.sql'), '0168 difere do aplicado no DEV');
for (const m of tiss) assert.equal(sha(m.body), pinned(m.file), `${m.file} difere do manifesto`);
assert.equal(sha(m0172.body), pinned(p59File), 'candidata do #59 difere do manifesto');
pass(1, `bytes: 0168 (#64 ${PR64_REF}), 0169–0171 e a do #59 (${PR59_REF}) iguais ao manifesto`);

// Spec da trilha da plataforma (contrato S5 com o #59): o hash do corpo vem da própria candidata.
const fnBody = (src: string, fn: string) => {
  const start = src.indexOf('AS $$', src.indexOf(`FUNCTION ${fn}(`)) + 'AS $$'.length;
  return src.slice(start, src.indexOf('$$;', start));
};
const PLATFORM_AUDIT_BARRIER: AppendOnlyBarrierSpec = {
  id: 'platform_audit',
  schemaVersion: 'super-admin-actions-append-only',
  functions: { 'public.super_admin_actions_append_only': sha(fnBody(m0172.body, 'public.super_admin_actions_append_only')) },
  trails: [
    {
      table: 'public.super_admin_actions',
      rowTrigger: 'super_admin_actions_append_only_row',
      stmtTrigger: 'super_admin_actions_append_only_stmt',
      triggerFunction: 'public.super_admin_actions_append_only',
      forbidden: { roles: ['anon', 'authenticated', 'service_role', 'qoro_runtime'], privileges: ['UPDATE', 'DELETE', 'TRUNCATE'] },
    },
  ],
};

// ── 2. cadeia inteira ────────────────────────────────────────────────────────────────────────────
const chain = await readDevOrderChain();
assert.equal(chain.length, 168, `cadeia do DEV até 0167 com a 0159: esperava 168, achei ${chain.length}`);
assert.ok(chain.some((m) => m.file.startsWith('0159_')), 'cadeia sem a 0159');
const all = [...chain, m0168, ...tiss, m0172];
const cluster = await startScratchSchema({ port: PORT, maxConnections: 4, migrations: all });
const { sql } = cluster;

try {
  const [objs] = await sql<{ pix: boolean; hist: boolean; pwd: boolean; sv171: boolean; sv172: boolean }[]>`
    SELECT to_regclass('billing_gateway.pix_replacement_intents') IS NOT NULL AS pix,
           to_regclass('public.hi_historical_coverages') IS NOT NULL AS hist,
           to_regclass('public.auth_password_history') IS NOT NULL AS pwd,
           EXISTS (SELECT 1 FROM _schema_version WHERE version = '0171-audit-trails-append-only') AS sv171,
           EXISTS (SELECT 1 FROM _schema_version WHERE version = 'super-admin-actions-append-only') AS sv172`;
  assert.deepEqual(objs, { pix: true, hist: true, pwd: true, sv171: true, sv172: true });
  pass(2, `${all.length} arquivos aplicados na ordem 0000–0167 (com a 0159) → 0168 → 0169 → 0170 → 0171 → 0172; objetos de cada uma presentes`);

  // ── 3. o mesmo verificador nas duas trilhas ────────────────────────────────────────────────────
  const q: CatalogQuery = async (text, params) => (await sql.unsafe(text, params as never[])) as never;
  const clinic = await inspectAppendOnlyBarrier(q, CLINIC_AUDIT_BARRIER, new Date());
  const platform = await inspectAppendOnlyBarrier(q, PLATFORM_AUDIT_BARRIER, new Date());
  assert.ok(clinic.installed && clinic.ok, `clínica: ${JSON.stringify(clinic.findings)}`);
  assert.ok(platform.installed && platform.ok, `plataforma: ${JSON.stringify(platform.findings)}`);
  pass(3, `um verificador, duas trilhas: clínica ok (${clinic.relationsChecked} relações) e plataforma ok (${platform.relationsChecked})`);

  // ── 4. recusas para o dono, inclusive replica ──────────────────────────────────────────────────
  const clinicId = randomUUID();
  await sql`INSERT INTO public.clinics (id, slug, nome, status) VALUES (${clinicId}, ${`final-order-${clinicId.slice(0, 8)}`}, 'Clínica Sintética Ordem Final', 'active')`;
  const [cols] = await sql<{ cols: string }[]>`
    SELECT string_agg(column_name || ':' || is_nullable || ':' || coalesce(column_default, ''), ' ') AS cols
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'super_admin_actions'`;
  await sql.unsafe(`INSERT INTO public.audit_events (clinic_id, action, resource_type) VALUES ('${clinicId}', 'synthetic.final_order', 'test')`);
  await sql.unsafe(
    `INSERT INTO public.super_admin_actions (super_admin_id, action, target_clinic_id, payload)
     VALUES ('${randomUUID()}', 'synthetic.final_order', '${clinicId}', '{"motivo":"prova sintética da ordem final"}')`,
  ).catch((e: Error) => {
    throw new Error(`INSERT na trilha da plataforma falhou (${e.message}); colunas: ${cols?.cols}`);
  });
  const refused = async (stmt: string, replica: boolean) => {
    let code = '';
    await sql
      .begin(async (tx) => {
        if (replica) await tx.unsafe('SET LOCAL session_replication_role = replica');
        await tx.unsafe(stmt);
      })
      .catch((e: { code?: string }) => {
        code = e.code ?? 'erro';
      });
    return code;
  };
  for (const table of ['public.audit_events', 'public.super_admin_actions']) {
    for (const replica of [false, true]) {
      for (const stmt of [`UPDATE ${table} SET action = 'adulterado'`, `DELETE FROM ${table}`, `TRUNCATE ${table}`]) {
        assert.equal(await refused(stmt, replica), '42501', `${stmt} (replica=${replica}) não foi recusado`);
      }
    }
  }
  const [counts] = await sql<{ a: number; p: number }[]>`
    SELECT (SELECT count(*)::int FROM public.audit_events WHERE action = 'synthetic.final_order') AS a,
           (SELECT count(*)::int FROM public.super_admin_actions WHERE action = 'synthetic.final_order') AS p`;
  assert.deepEqual(counts, { a: 1, p: 1 });
  pass(4, 'audit_events e super_admin_actions: INSERT continua; UPDATE, DELETE e TRUNCATE recusados (42501) para o dono, com e sem replica');

  // ── 5. adulteração da trilha da plataforma acusada ─────────────────────────────────────────────
  const tampers: Array<{ name: string; ddl: string; kind: string }> = [
    { name: 'gatilho de linha desligado', ddl: 'ALTER TABLE public.super_admin_actions DISABLE TRIGGER super_admin_actions_append_only_row', kind: 'trigger_not_always' },
    { name: 'gatilho de comando só em origin', ddl: 'ALTER TABLE public.super_admin_actions ENABLE TRIGGER super_admin_actions_append_only_stmt', kind: 'trigger_not_always' },
    { name: 'gatilho removido', ddl: 'DROP TRIGGER super_admin_actions_append_only_row ON public.super_admin_actions', kind: 'trigger_missing' },
    { name: 'função reescrita', ddl: `CREATE OR REPLACE FUNCTION public.super_admin_actions_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $f$ BEGIN RETURN OLD; END $f$`, kind: 'function_changed' },
    { name: 'DELETE devolvido ao service_role', ddl: 'GRANT DELETE ON public.super_admin_actions TO service_role', kind: 'privilege_granted' },
  ];
  for (const t of tampers) {
    let kinds: string[] = [];
    await sql
      .begin(async (tx) => {
        await tx.unsafe(t.ddl);
        const r = await inspectAppendOnlyBarrier(async (text, params) => (await tx.unsafe(text, params as never[])) as never, PLATFORM_AUDIT_BARRIER, new Date());
        kinds = r.findings.map((f) => f.kind);
        throw new Error('desfazer');
      })
      .catch((e: Error) => {
        if (e.message !== 'desfazer') throw e;
      });
    assert.ok(kinds.includes(t.kind), `${t.name}: esperava ${t.kind}, achei ${kinds.join(',') || 'nada'}`);
  }
  const back = await inspectAppendOnlyBarrier(q, PLATFORM_AUDIT_BARRIER, new Date());
  assert.ok(back.ok, 'barreira da plataforma não voltou depois de desfazer');
  pass(5, `${tampers.length} adulterações do dono na trilha da plataforma acusadas pelo verificador e desfeitas`);

  // ── 6. 0171 e 0172 independentes ───────────────────────────────────────────────────────────────
  const rollback = readFileSync('docs/convenios/migrations/0171_audit_trails_append_only.rollback.sql', 'utf8');
  await sql.unsafe(rollback);
  const clinicAfter = await inspectAppendOnlyBarrier(q, CLINIC_AUDIT_BARRIER, new Date());
  const platformAfter = await inspectAppendOnlyBarrier(q, PLATFORM_AUDIT_BARRIER, new Date());
  assert.equal(clinicAfter.installed, false, 'a reversão da 0171 deixou a barreira da clínica');
  assert.ok(platformAfter.installed && platformAfter.ok, 'a reversão da 0171 mexeu na trilha da plataforma');
  assert.equal(await refused('DELETE FROM public.super_admin_actions', true), '42501');
  pass(6, 'reversão da 0171 remove só a barreira da clínica; a da plataforma (0172) continua instalada e recusando');

  console.log(`\nORDEM FINAL: ${results.length}/6 PASS`);
} finally {
  await cluster.stop();
}
