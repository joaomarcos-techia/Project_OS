// Ensaio transacional da migration 0144 no DEV (D19): executa o SQL, roda as sondas e dá ROLLBACK.
// Não grava em drizzle.__drizzle_migrations nem deixa tabela nenhuma. Só DEV.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('C:/dev/Qoro_convenios_tiss_20261110/package.json');
const postgres = require('postgres');
const url = process.env.DATABASE_URL ?? '';
if (!url.includes('pqhkirrszzpwezdaqrai') || url.includes('shlcbxawrxuaebazuiue')) throw new Error('não é o DEV');

const SQL = readFileSync('C:/dev/Qoro_convenios_tiss_20261110/drizzle/migrations/0144_hi_clinic_setup.sql', 'utf8');
const stmts = SQL.split('--> statement-breakpoint').map((s) => s.trim()).filter((s) => s.replace(/--.*$/gmu, '').trim());
const sql = postgres(url, { connect_timeout: 45, max: 1, prepare: false, idle_timeout: 5, onnotice: () => {} });
const results = [];
const t0 = Date.now();

class Rollback extends Error {}

async function probe(tx, name, expect, fn) {
  await tx.unsafe('SAVEPOINT p');
  try {
    const out = await fn();
    await tx.unsafe('RELEASE SAVEPOINT p');
    const ok = expect === 'ok' || (typeof expect === 'function' && expect(out));
    results.push({ name, expected: typeof expect === 'string' ? expect : 'predicado', got: 'ok', detail: out, pass: Boolean(ok) });
  } catch (e) {
    await tx.unsafe('ROLLBACK TO SAVEPOINT p');
    results.push({ name, expected: expect, got: e.code ?? 'erro', detail: String(e.message).slice(0, 140), pass: e.code === expect });
  }
}

try {
  await sql.begin(async (tx) => {
    const [ver] = await tx`select version() as v, current_user as u`;
    results.push({ name: 'conexão', detail: `${ver.u} | ${ver.v.slice(0, 40)}`, pass: true });
    for (const s of stmts) await tx.unsafe(s);
    results.push({ name: `migration executada (${stmts.length} comandos)`, pass: true });

    // duas clínicas do DEV com ao menos um perfil cada (só leitura em clinics/profiles)
    const rows = await tx`
      select p.clinic_id, min(p.id::text) as profile_id from public.profiles p
      where p.clinic_id is not null group by p.clinic_id order by p.clinic_id limit 2`;
    if (rows.length < 2) throw new Error('DEV sem duas clínicas com perfil');
    const [A, B] = rows;
    const sys = '00000000-0000-0000-0000-0000000000aa';

    // dados base como dono (postgres, BYPASSRLS): operadora e plano de A e de B
    const [insA] = await tx`insert into hi_insurers (clinic_id,name,registro_ans,provider_id_kind,provider_id_value,created_by) values (${A.clinic_id},'Operadora Teste A','123456','codigoPrestadorNaOperadora','TESTE001',${sys}) returning id`;
    const [insB] = await tx`insert into hi_insurers (clinic_id,name,registro_ans,provider_id_kind,provider_id_value,created_by) values (${B.clinic_id},'Operadora Teste B','123456','codigoPrestadorNaOperadora','TESTE001',${sys}) returning id`;
    const [planB] = await tx`insert into hi_plans (clinic_id,insurer_id,name) values (${B.clinic_id},${insB.id},'Plano B') returning id`;

    await probe(tx, 'FK composta: plano de B ligado à operadora de A', '23503', () =>
      tx`insert into hi_plans (clinic_id,insurer_id,name) values (${B.clinic_id},${insA.id},'cruzado')`);
    await probe(tx, 'FK composta: credenciamento de A com plano de B', '23503', () =>
      tx`insert into hi_credentials (clinic_id,insurer_id,plan_id,valid_from,created_by) values (${A.clinic_id},${insA.id},${planB.id},'2026-01-01',${sys})`);
    await probe(tx, 'CHECK: registro ANS com 5 dígitos', '23514', () =>
      tx`insert into hi_insurers (clinic_id,name,registro_ans,provider_id_kind,provider_id_value,created_by) values (${A.clinic_id},'Operadora X','12345','codigoPrestadorNaOperadora','T',${sys})`);
    await probe(tx, 'CHECK: CNPJ do prestador fora do formato TISS', '23514', () =>
      tx`insert into hi_insurers (clinic_id,name,registro_ans,provider_id_kind,provider_id_value,created_by) values (${A.clinic_id},'Operadora X','654321','cnpjContratado','12.ABC.345/01DE-35',${sys})`);
    await probe(tx, 'CHECK: flag ligada sem quem/quando', '23514', () =>
      tx`insert into hi_clinic_settings (clinic_id,enabled) values (${A.clinic_id},true)`);
    await probe(tx, 'CHECK: coparticipação fixa maior que o valor', '23514', () =>
      tx`insert into hi_procedure_contracts (clinic_id,insurer_id,guide_type,table_code,procedure_code,description,unit_value_cents,valid_from,copay_kind,copay_fixed_cents,created_by) values (${A.clinic_id},${insA.id},'consulta','22','10101012','Consulta',15000,'2026-01-01','fixed',20000,${sys})`);
    await probe(tx, 'gatilho: profissional de outra clínica', '23503', () =>
      tx`insert into hi_professional_profiles (clinic_id,professional_id,council,council_number,council_uf,cbo) values (${A.clinic_id},${B.profile_id},'06','1','35','225133')`);
    await probe(tx, 'gatilho: profissional da mesma clínica', 'ok', () =>
      tx`insert into hi_professional_profiles (clinic_id,professional_id,council,council_number,council_uf,cbo) values (${A.clinic_id},${A.profile_id},'06','1','35','225133')`);
    await probe(tx, 'EXCLUDE: primeiro credenciamento ativo', 'ok', () =>
      tx`insert into hi_credentials (clinic_id,insurer_id,valid_from,valid_until,created_by) values (${A.clinic_id},${insA.id},'2026-01-01','2026-12-31',${sys})`);
    await probe(tx, 'EXCLUDE: segundo credenciamento ativo sobreposto', '23P01', () =>
      tx`insert into hi_credentials (clinic_id,insurer_id,valid_from,created_by) values (${A.clinic_id},${insA.id},'2026-06-01',${sys})`);
    await probe(tx, 'EXCLUDE: vigência seguinte sem sobreposição', 'ok', () =>
      tx`insert into hi_credentials (clinic_id,insurer_id,valid_from,created_by) values (${A.clinic_id},${insA.id},'2027-01-01',${sys})`);
    const [ctr] = await tx`insert into hi_procedure_contracts (clinic_id,insurer_id,guide_type,table_code,procedure_code,description,unit_value_cents,valid_from,copay_kind,copay_percentage,created_by) values (${A.clinic_id},${insA.id},'consulta','22','10101012','Consulta em consultório',15000,'2026-01-01','percentage',30,${sys}) returning id`;
    await probe(tx, 'append-only: UPDATE de contrato pelo dono (gatilho)', '55000', () =>
      tx`update hi_procedure_contracts set unit_value_cents = 1 where id = ${ctr.id}`);
    await probe(tx, 'append-only: nova versão que substitui a anterior', 'ok', () =>
      tx`insert into hi_procedure_contracts (clinic_id,insurer_id,guide_type,table_code,procedure_code,description,unit_value_cents,valid_from,supersedes_id,created_by) values (${A.clinic_id},${insA.id},'consulta','22','10101012','Consulta em consultório',16000,'2026-01-01',${ctr.id},${sys})`);
    await probe(tx, 'append-only: segunda substituição da mesma versão', '23505', () =>
      tx`insert into hi_procedure_contracts (clinic_id,insurer_id,guide_type,table_code,procedure_code,description,unit_value_cents,valid_from,supersedes_id,created_by) values (${A.clinic_id},${insA.id},'consulta','22','10101012','Consulta',17000,'2026-01-01',${ctr.id},${sys})`);

    // como o runtime: SET LOCAL ROLE authenticated + clínica A no GUC (padrão do withTenant)
    const asTenant = async (clinic, fn) => {
      await tx.unsafe('SET LOCAL ROLE authenticated');
      await tx`select set_config('app.current_clinic', ${clinic}, true)`;
      const out = await fn();
      await tx.unsafe('RESET ROLE'); // em erro, o ROLLBACK TO SAVEPOINT da sonda desfaz o SET LOCAL ROLE
      return out;
    };
    await probe(tx, 'RLS: authenticated de A vê só as operadoras de A', (r) => r.length === 1 && r[0].clinic_id === A.clinic_id, () =>
      asTenant(A.clinic_id, () => tx`select clinic_id from hi_insurers`));
    await probe(tx, 'RLS: authenticated de A grava operadora de B', '42501', () =>
      asTenant(A.clinic_id, () => tx`insert into hi_insurers (clinic_id,name,registro_ans,provider_id_kind,provider_id_value,created_by) values (${B.clinic_id},'Invasora','777777','codigoPrestadorNaOperadora','T',${sys})`));
    await probe(tx, 'RLS: authenticated de A grava operadora própria', 'ok', () =>
      asTenant(A.clinic_id, () => tx`insert into hi_insurers (clinic_id,name,registro_ans,provider_id_kind,provider_id_value,created_by) values (${A.clinic_id},'Própria','777777','codigoPrestadorNaOperadora','T',${sys})`));
    await probe(tx, 'RLS: authenticated de A altera operadora de B (0 linhas)', (r) => r.count === 0, () =>
      asTenant(A.clinic_id, () => tx`update hi_insurers set name = 'x' where id = ${insB.id}`));
    await probe(tx, 'privilégio: authenticated faz UPDATE em contrato', '42501', () =>
      asTenant(A.clinic_id, () => tx`update hi_procedure_contracts set description = 'x' where id = ${ctr.id}`));
    await probe(tx, 'privilégio: authenticated faz DELETE em contrato', '42501', () =>
      asTenant(A.clinic_id, () => tx`delete from hi_procedure_contracts where id = ${ctr.id}`));
    await probe(tx, 'privilégio: authenticated lê contratos de A', (r) => r.length === 2, () =>
      asTenant(A.clinic_id, () => tx`select id from hi_procedure_contracts`));
    await probe(tx, 'privilégio: anon lê operadoras', '42501', async () => {
      await tx.unsafe('SET LOCAL ROLE anon');
      const out = await tx`select 1 from hi_insurers limit 1`;
      await tx.unsafe('RESET ROLE');
      return out;
    });
    await probe(tx, 'privilégio: authenticated executa função de gatilho', '42501', () =>
      asTenant(A.clinic_id, () => tx`select public.hi_block_contract_update()`));

    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) results.push({ name: 'falha inesperada', detail: String(e.message).slice(0, 300), pass: false });
}

// depois do ROLLBACK: nada pode ter ficado
try {
  const [after] = await sql`select to_regclass('public.hi_insurers') as t, (select count(*)::int from drizzle.__drizzle_migrations) as n, (select count(*)::int from public._schema_version where version = '0144-hi-clinic-setup') as v`;
  results.push({ name: 'depois do ROLLBACK: tabela, journal do banco e _schema_version', detail: after, pass: after.t === null && after.v === 0 });
} finally {
  await sql.end();
}
const pass = results.filter((r) => r.pass).length;
for (const r of results) console.log(`${r.pass ? 'ok ' : 'ERR'} ${r.name}${r.expected ? ` [esperado ${r.expected}, obtido ${r.got}]` : ''}${r.detail && typeof r.detail !== 'object' ? ` — ${r.detail}` : r.detail ? ` — ${JSON.stringify(r.detail)}` : ''}`);
console.log(`RESUMO ${pass}/${results.length} em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(pass === results.length ? 0 : 1);
