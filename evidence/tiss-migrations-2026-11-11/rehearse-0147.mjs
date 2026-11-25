// Ensaio transacional (D19) das migrations 0144 + 0145 + 0146 + 0147 no DEV: executa o SQL,
// roda as sondas e dá ROLLBACK. Não grava em drizzle.__drizzle_migrations nem deixa nada. Só DEV.
// Pacientes, procedimento e atendimentos são SINTÉTICOS, criados dentro da transação.
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
    results.push({ name, expected: typeof expect === 'string' ? expect : 'predicado', got: 'ok', detail: typeof expect === 'function' ? out : undefined, pass: Boolean(ok) });
  } catch (e) {
    await tx.unsafe('ROLLBACK TO SAVEPOINT p');
    results.push({ name, expected: expect, got: e.code ?? 'erro', detail: String(e.message).slice(0, 160), pass: e.code === expect });
  }
}

try {
  await sql.begin(async (tx) => {
    const [ver] = await tx`select version() as v, current_user as u,
      (select rolbypassrls from pg_roles where rolname = current_user) as bypass`;
    results.push({ name: 'conexão', detail: `${ver.u} | bypassrls=${ver.bypass} | ${ver.v.slice(0, 40)}`, pass: true });
    for (const f of ['0144_hi_clinic_setup.sql', '0145_hi_memberships.sql', '0146_hi_authorizations.sql', '0147_hi_guides.sql']) {
      const st = stmtsOf(f);
      for (const s of st) await tx.unsafe(s);
      results.push({ name: `${f} executada (${st.length} comandos)`, pass: true });
    }
    const [own] = await tx`select pg_get_userbyid(c.relowner) as table_owner,
      (select pg_get_userbyid(p.proowner) from pg_proc p where p.proname = 'hi_guide_apply_replacement') as fn_owner,
      current_user as me from pg_class c where c.oid = 'public.hi_guides'::regclass`;
    results.push({ name: 'dono da tabela = dono das funções DEFINER = quem migra (premissa do gatilho de estado)', detail: own,
      pass: own.table_owner === own.fn_owner && own.fn_owner === own.me });

    const [term] = await tx`select version from public.tiss_terminology_versions order by version desc limit 1`;
    if (!term) throw new Error('DEV sem versão de terminologia carregada (P1.3)');
    const clinics = await tx`
      select c.id as clinic_id, min(p.id::text) as doctor_id from public.clinics c
      join public.profiles p on p.clinic_id = c.id and p.role = 'doctor'
      group by c.id order by c.id limit 2`;
    if (clinics.length < 2) throw new Error('DEV sem duas clínicas com profissional');
    const [A, B] = clinics;
    const sys = '00000000-0000-0000-0000-0000000000aa';
    const H = (c) => c.repeat(64);
    const CIPHER = 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
    const patient = async (clinic, tag) => (await tx`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
      values (${clinic}, ${`Paciente sintético ${tag}`}, 'ciphertext-de-ensaio', ${`ensaio-0147-${tag}-${Date.now()}`}) returning id`)[0].id;
    const pA = await patient(A.clinic_id, 'a');
    const pA2 = await patient(A.clinic_id, 'a2');
    const [proc] = await tx`insert into public.procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
      values (${A.clinic_id}, 'ENSAIO0147', 'Procedimento sintético do ensaio', 150, 30, true) returning id`;
    let slot = 0;
    const appt = async (p) => {
      slot += 1;
      return (await tx`insert into public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min,
        status, valor, snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via)
        values (${A.clinic_id}, ${A.doctor_id}, ${p}, ${proc.id}, '2031-01-01T00:00:00Z'::timestamptz + ${slot} * interval '1 hour',
        30, 'atendido', 150, 'Consulta', 150, 30, 'Profissional sintético', 'attendant') returning id`)[0].id;
    };
    const ap1 = await appt(pA);
    const ap2 = await appt(pA);
    const apOther = await appt(pA2);
    const [ins] = await tx`insert into hi_insurers (clinic_id,name,registro_ans,provider_id_kind,provider_id_value,created_by)
      values (${A.clinic_id},'Operadora Ensaio','123456','codigoPrestadorNaOperadora','TESTE001',${sys}) returning id`;
    const [card] = await tx`insert into hi_memberships (clinic_id,patient_id,insurer_id,card_number_encrypted,card_number_hash,card_last4,created_by)
      values (${A.clinic_id},${pA},${ins.id},${CIPHER},${H('a')},'0001',${sys}) returning id`;
    const [ctr] = await tx`insert into hi_procedure_contracts (clinic_id, insurer_id, guide_type, table_code, procedure_code, description,
      unit_value_cents, valid_from, created_by) values (${A.clinic_id}, ${ins.id}, 'consulta', '22', '10101012', 'Consulta em consultório',
      15000, '2026-01-01', ${sys}) returning id`;

    const asTenant = async (clinic, fn, actor = null) => {
      await tx.unsafe('SET LOCAL ROLE authenticated');
      await tx`select set_config('app.current_clinic', ${clinic}, true)`;
      await tx`select set_config('app.current_user', ${actor ?? ''}, true)`;
      const out = await fn();
      await tx.unsafe('RESET ROLE');
      return out;
    };
    const guide = (key, extra = {}) => asTenant(A.clinic_id, async () => {
      const [{ v }] = await tx`select public.hi_next_counter(${A.clinic_id}::uuid, 'guide', '') as v`;
      return tx`insert into hi_guides (clinic_id, guide_type, number, insurer_id, patient_id, membership_id, executant_professional_id,
        replaces_guide_id, idempotency_key, created_via, created_by)
        values (${A.clinic_id}, 'consulta', ${String(v)}, ${ins.id}, ${pA}, ${card.id}, ${A.doctor_id}, ${extra.replaces ?? null},
        ${key}, 'user', ${A.doctor_id}) returning id, number, live`;
    }, A.doctor_id);
    const item = (guideId, apId) => asTenant(A.clinic_id, () => tx`insert into hi_guide_items (clinic_id, guide_id, sequence, appointment_id,
      contract_line_id, executed_on, table_code, procedure_code, description, quantity, unit_value_cents, total_value_cents)
      values (${A.clinic_id}, ${guideId}, 1, ${apId}, ${ctr.id}, '2026-11-10', '22', '10101012', 'Consulta', 1, 15000, 15000) returning id, live`);
    const approve = (guideId) => asTenant(A.clinic_id, async () => {
      await tx`update hi_guides set status='ready_for_review', total_value_cents=15000, terminology_version=${term.version} where id=${guideId}`;
      await tx`update hi_guides set status='reviewed', reviewed_by=${A.doctor_id} where id=${guideId}`;
      const [s] = await tx`insert into hi_guide_snapshots (clinic_id, guide_id, revision, content_encrypted, content_sha256, tiss_version,
        terminology_version, created_via, created_by) values (${A.clinic_id}, ${guideId}, 1, ${CIPHER}, ${H('c')}, '4.03.00', ${term.version}, 'user', ${A.doctor_id}) returning id`;
      return tx`update hi_guides set status='approved', approved_snapshot_id=${s.id}, approved_by=${A.doctor_id} where id=${guideId} and status='reviewed' returning status`;
    }, A.doctor_id);

    let g1;
    await probe(tx, 'guia: criada pelo runtime com o número alocado na mesma transação', (r) => r.length === 1, async () => { g1 = (await guide('ensaio-0147-chave-1'))[0]; return [g1]; });
    await probe(tx, 'guia: mesma chave de origem (reprocessamento)', '23505', () => guide('ensaio-0147-chave-1'));
    await probe(tx, 'item: atendimento de outro paciente', '23514', () => item(g1.id, apOther));
    await probe(tx, 'item: do contrato vigente, atendimento do paciente', 'ok', () => item(g1.id, ap1));
    let g2;
    await probe(tx, 'segunda Consulta para o mesmo atendimento', '23505', async () => { g2 = (await guide('ensaio-0147-chave-2'))[0]; return item(g2.id, ap1); });
    await probe(tx, 'runtime salta de pendências para aprovada', '55000', () => asTenant(A.clinic_id, () => tx`update hi_guides set status='approved' where id=${g1.id}`));
    await probe(tx, 'aprovação completa (pronta → conferida → snapshot → aprovada)', (r) => r[0]?.status === 'approved', () => approve(g1.id));
    await probe(tx, 'editar guia aprovada', '55000', () => asTenant(A.clinic_id, () => tx`update hi_guides set total_value_cents = 1 where id=${g1.id}`));
    await probe(tx, 'runtime coloca guia em lote', '55000', () => asTenant(A.clinic_id, () => tx`update hi_guides set status='in_batch' where id=${g1.id}`));
    await probe(tx, 'dono (código do banco) leva a guia a lote → exportada → enviada', 'ok', async () => {
      for (const s of ['in_batch', 'exported', 'sent']) await tx`update hi_guides set status=${s} where id=${g1.id}`;
      return [];
    });
    let sub;
    await probe(tx, 'substituta em rascunho não segura o atendimento', (r) => r[0].live === false, async () => {
      sub = (await guide('ensaio-0147-subst-1', { replaces: g1.id }))[0];
      return item(sub.id, ap1);
    });
    await probe(tx, 'aprovar a substituta encerra a original (replaced) na mesma transação', (r) => r.map((x) => `${x.status}/${x.live}`).sort().join(',') === 'approved/true,replaced/false', async () => {
      await approve(sub.id);
      return tx`select status, live from hi_guides where id in (${g1.id}, ${sub.id})`;
    });
    await probe(tx, 'histórico: runtime não escreve', '42501', () => asTenant(A.clinic_id, () => tx`insert into hi_guide_events (clinic_id, guide_id, to_status, revision, actor_kind) values (${A.clinic_id}, ${g1.id}, 'paid', 1, 'system')`));
    await probe(tx, 'histórico gravado pelo banco, com autor e só nomes de campos', (r) => r.length >= 8 && r.every((e) => e.actor_kind === 'user') && !JSON.stringify(r).includes(CIPHER),
      () => tx`select to_status, actor_kind, changed_fields from hi_guide_events where guide_id in (${g1.id}, ${sub.id})`);
    await probe(tx, 'snapshot: nem o dono altera', '55000', () => tx`update hi_guide_snapshots set content_sha256 = ${H('f')} where guide_id = ${g1.id}`);
    await probe(tx, 'outra clínica não vê guias, itens nem histórico', (r) => r.length === 0, () => asTenant(B.clinic_id, () =>
      tx`select id from hi_guides union all select id from hi_guide_items union all select id from hi_guide_events`));
    await probe(tx, 'anon não lê guias', '42501', async () => {
      await tx.unsafe('SET LOCAL ROLE anon');
      const out = await tx`select id from hi_guides`;
      await tx.unsafe('RESET ROLE');
      return out;
    });
    await probe(tx, 'retenção: paciente (sintético) com guia não é excluído', '23503', () => tx`delete from public.patients where id = ${pA}`);
    await probe(tx, 'funções de gatilho da 0147 sem EXECUTE para authenticated', (r) => r[0].n === 0, () =>
      tx`select count(*)::int as n from pg_proc p where p.proname in ('hi_guide_transition','hi_guide_refs','hi_guide_apply_replacement',
        'hi_guide_record_event','hi_guard_guide_item','hi_guard_guide_snapshot','hi_guard_file')
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')`);
    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) results.push({ name: 'falha inesperada', detail: String(e.message).slice(0, 300), pass: false });
}
try {
  const [after] = await sql`select to_regclass('public.hi_guides') as g, to_regclass('public.hi_memberships') as m,
    to_regclass('public.hi_authorizations') as a, to_regclass('public.hi_insurers') as i,
    (select count(*)::int from drizzle.__drizzle_migrations) as n,
    (select count(*)::int from public._schema_version where version like '014%-hi-%') as v,
    (select count(*)::int from public.procedures where codigo = 'ENSAIO0147') as p,
    (select count(*)::int from public.patients where cpf_hash like 'ensaio-0147-%') as pt`;
  results.push({ name: 'depois do ROLLBACK: nenhuma tabela, linha sintética, registro de migration ou versão', detail: after,
    pass: after.g === null && after.m === null && after.a === null && after.i === null && after.n === 144 && after.v === 0 && after.p === 0 && after.pt === 0 });
} finally {
  await sql.end();
}
const pass = results.filter((r) => r.pass).length;
for (const r of results) console.log(`${r.pass ? 'ok ' : 'ERR'} ${r.name}${r.expected ? ` [esperado ${r.expected}, obtido ${r.got}]` : ''}${r.detail && typeof r.detail !== 'object' ? ` — ${r.detail}` : r.detail ? ` — ${JSON.stringify(r.detail).slice(0, 200)}` : ''}`);
console.log(`RESUMO ${pass}/${results.length} em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(pass === results.length ? 0 : 1);
