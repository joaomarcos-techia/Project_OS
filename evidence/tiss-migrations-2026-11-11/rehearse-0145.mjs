// Ensaio transacional (D19) das migrations 0144 + 0145 no DEV: executa o SQL, roda as sondas e dá ROLLBACK.
// Não grava em drizzle.__drizzle_migrations nem deixa tabela nenhuma. Só DEV.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('C:/dev/Qoro_convenios_tiss_20261110/package.json');
const postgres = require('postgres');
const url = process.env.DATABASE_URL ?? '';
if (!url.includes('pqhkirrszzpwezdaqrai') || url.includes('shlcbxawrxuaebazuiue')) throw new Error('não é o DEV');

const dir = 'C:/dev/Qoro_convenios_tiss_20261110/drizzle/migrations/';
const stmtsOf = (f) =>
  readFileSync(dir + f, 'utf8').split('--> statement-breakpoint').map((s) => s.trim()).filter((s) => s.replace(/--.*$/gmu, '').trim());
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
    for (const f of ['0144_hi_clinic_setup.sql', '0145_hi_memberships.sql']) {
      const st = stmtsOf(f);
      for (const s of st) await tx.unsafe(s);
      results.push({ name: `${f} executada (${st.length} comandos)`, pass: true });
    }
    const rows = await tx`
      select p.clinic_id, min(p.id::text) as patient_id from public.patients p
      where p.clinic_id is not null group by p.clinic_id order by p.clinic_id limit 2`;
    if (rows.length < 2) throw new Error('DEV sem duas clínicas com paciente');
    const [A, B] = rows;
    const sys = '00000000-0000-0000-0000-0000000000aa';
    const [insA] = await tx`insert into hi_insurers (clinic_id,name,registro_ans,provider_id_kind,provider_id_value,created_by) values (${A.clinic_id},'Operadora Teste A','123456','codigoPrestadorNaOperadora','TESTE001',${sys}) returning id`;
    const card = (clinic, patient, insurer, hash) =>
      tx`insert into hi_memberships (clinic_id,patient_id,insurer_id,card_number_encrypted,card_number_hash,card_last4,created_by) values (${clinic},${patient},${insurer},'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',${hash},'0001',${sys}) returning id`;
    const H = (c) => c.repeat(64);

    await probe(tx, 'carteirinha: paciente de outra clínica', '23503', () => card(A.clinic_id, B.patient_id, insA.id, H('a')));
    let c1;
    await probe(tx, 'carteirinha: inserir com paciente da clínica', 'ok', async () => { [c1] = await card(A.clinic_id, A.patient_id, insA.id, H('a')); return []; });
    await probe(tx, 'carteirinha: mesmo número ativo duas vezes', '23505', () => card(A.clinic_id, A.patient_id, insA.id, H('a')));
    await probe(tx, 'carteirinha: número em claro no campo de hash', '23514', () => card(A.clinic_id, A.patient_id, insA.id, 'NUMERO-EM-CLARO'));
    await probe(tx, 'carteirinha: trocar o número (imutável)', '55000', () => tx`update hi_memberships set card_number_hash = ${H('b')} where id = ${c1.id}`);

    const asTenant = async (clinic, fn) => {
      await tx.unsafe('SET LOCAL ROLE authenticated');
      await tx`select set_config('app.current_clinic', ${clinic}, true)`;
      const out = await fn();
      await tx.unsafe('RESET ROLE');
      return out;
    };
    await probe(tx, 'carteirinha: authenticated apaga (inativar em vez de excluir)', '42501', () =>
      asTenant(A.clinic_id, () => tx`delete from hi_memberships where id = ${c1.id}`));
    await probe(tx, 'carteirinha: authenticated de B não vê as de A', (r) => r.length === 0, () =>
      asTenant(B.clinic_id, () => tx`select id from hi_memberships`));

    const next = (clinic, kind) => tx`select public.hi_next_counter(${clinic}::uuid, ${kind}, '') as v`;
    await probe(tx, 'numeração: 1, 2, 3 na mesma clínica', (r) => r.join(',') === '1,2,3', async () => [
      Number((await next(A.clinic_id, 'guide'))[0].v),
      Number((await next(A.clinic_id, 'guide'))[0].v),
      Number((await next(A.clinic_id, 'guide'))[0].v),
    ]);
    await probe(tx, 'numeração: contador independente de outra clínica', (r) => Number(r[0].v) === 1, () => next(B.clinic_id, 'guide'));
    await probe(tx, 'numeração: authenticated de A no contador de B', '42501', () => asTenant(A.clinic_id, () => next(B.clinic_id, 'guide')));
    await probe(tx, 'numeração: authenticated de A no próprio contador', (r) => Number(r[0].v) === 1, () => asTenant(A.clinic_id, () => next(A.clinic_id, 'batch')));
    await probe(tx, 'numeração: anon não executa', '42501', async () => {
      await tx.unsafe('SET LOCAL ROLE anon');
      const out = await next(A.clinic_id, 'guide');
      await tx.unsafe('RESET ROLE');
      return out;
    });
    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) results.push({ name: 'falha inesperada', detail: String(e.message).slice(0, 300), pass: false });
}
try {
  const [after] = await sql`select to_regclass('public.hi_memberships') as m, to_regclass('public.hi_insurers') as i,
    (select count(*)::int from drizzle.__drizzle_migrations) as n,
    (select count(*)::int from public._schema_version where version in ('0144-hi-clinic-setup','0145-hi-memberships')) as v,
    to_regprocedure('public.hi_next_counter(uuid,text,text)') as f`;
  results.push({ name: 'depois do ROLLBACK: nenhuma tabela, função, registro de migration ou versão', detail: after, pass: after.m === null && after.i === null && after.f === null && after.v === 0 && after.n === 144 });
} finally {
  await sql.end();
}
const pass = results.filter((r) => r.pass).length;
for (const r of results) console.log(`${r.pass ? 'ok ' : 'ERR'} ${r.name}${r.expected ? ` [esperado ${r.expected}, obtido ${r.got}]` : ''}${r.detail && typeof r.detail !== 'object' ? ` — ${r.detail}` : r.detail ? ` — ${JSON.stringify(r.detail)}` : ''}`);
console.log(`RESUMO ${pass}/${results.length} em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(pass === results.length ? 0 : 1);
