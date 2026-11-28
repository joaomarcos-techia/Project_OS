// Ensaio transacional (D19) da cadeia 0144–0148 no DEV, com ROLLBACK. Só DEV.
// Cuidados por a 0148 tocar tabelas vivas (appointments, lancamentos):
//  - cada migration vai num único comando (uma ida ao banco), para o lock durar segundos;
//  - lock_timeout de 2 s: se outra sessão segurar a tabela, o ensaio desiste em vez de enfileirar;
//  - nenhuma linha real é alterada: a única sonda sobre atendimento real é recusada pelo gatilho
//    antes de gravar; o resto usa paciente, procedimento e atendimentos SINTÉTICOS da transação.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('C:/dev/Qoro_convenios_tiss_20261110/package.json');
const postgres = require('postgres');
const url = process.env.DATABASE_URL ?? '';
if (!url.includes('pqhkirrszzpwezdaqrai') || url.includes('shlcbxawrxuaebazuiue')) throw new Error('não é o DEV');

const dir = 'C:/dev/Qoro_convenios_tiss_20261110/drizzle/migrations/';
const sql = postgres(url, { connect_timeout: 45, max: 1, prepare: false, idle_timeout: 5, onnotice: () => {} });
const results = [];
const t0 = Date.now();
let lockMs = null;
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
    results.push({ name, expected: expect, got: e.code ?? 'erro', detail: String(e.message).slice(0, 150), pass: e.code === expect });
  }
}

try {
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout = '2s'");
    const [ver] = await tx`select current_user as u, version() as v`;
    results.push({ name: 'conexão', detail: `${ver.u} | ${ver.v.slice(0, 30)}`, pass: true });
    for (const f of ['0144_hi_clinic_setup.sql', '0145_hi_memberships.sql', '0146_hi_authorizations.sql', '0147_hi_guides.sql']) {
      await tx.unsafe(readFileSync(dir + f, 'utf8'));
      results.push({ name: `${f} executada`, pass: true });
    }
    const tLock = Date.now();
    await tx.unsafe(readFileSync(dir + '0148_hi_coverage_copay.sql', 'utf8'));
    results.push({ name: '0148_hi_coverage_copay.sql executada (lock de appointments/lancamentos a partir daqui)', pass: true });

    await probe(tx, 'atendimentos reais: todos nascem particular e o CHECK foi validado', (r) => r[0].other === 0 && r[0].valid === true,
      () => tx`select (select count(*)::int from appointments where billing_mode <> 'particular') as other,
        (select convalidated from pg_constraint where conname = 'appointments_billing_mode_chk') as valid`);
    const [real] = await tx`select id from appointments where status in ('agendado','confirmado') limit 1`;
    if (real) {
      await probe(tx, 'atendimento real: convênio recusado em clínica sem o módulo (nada é gravado)', '55000',
        () => tx`update appointments set billing_mode = 'convenio' where id = ${real.id}`);
    }

    // Fluxo sintético numa clínica real com o módulo ligado SÓ nesta transação.
    const [c] = await tx`select c.id as clinic_id, min(p.id::text) as doctor_id from clinics c
      join profiles p on p.clinic_id = c.id and p.role = 'doctor' group by c.id order by c.id limit 1`;
    const sys = '00000000-0000-0000-0000-0000000000aa';
    await tx`insert into hi_clinic_settings (clinic_id, enabled, enabled_at, enabled_by, provider_kind, cnes_status)
      values (${c.clinic_id}, true, now(), ${sys}, 'PJ', 'none_declared')`;
    const [pt] = await tx`insert into patients (clinic_id, nome, cpf_encrypted, cpf_hash)
      values (${c.clinic_id}, 'Paciente sintético 0148', 'ciphertext-de-ensaio', ${`ensaio-0148-${Date.now()}`}) returning id`;
    const [proc] = await tx`insert into procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
      values (${c.clinic_id}, 'ENSAIO0148', 'Procedimento sintético', 150, 30, true) returning id`;
    const appt = async (n) => (await tx`insert into appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at,
        duration_min, status, valor, snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min,
        snapshot_doctor_nome, created_via) values (${c.clinic_id}, ${c.doctor_id}, ${pt.id}, ${proc.id},
        '2032-02-02T00:00:00Z'::timestamptz + ${n} * interval '1 hour', 30, 'agendado', 150, 'Consulta', 150, 30,
        'Profissional sintético', 'attendant') returning id`)[0].id;
    const apConv = await appt(1);
    const apPart = await appt(2);
    await probe(tx, 'convênio aceito com o módulo ligado (atendimento sintético agendado)', 'ok',
      () => tx`update appointments set billing_mode = 'convenio' where id = ${apConv}`);
    const receivable = (apId, valor) => tx`insert into lancamentos (clinic_id, tipo, descricao, valor, status, due_date,
      patient_id, appointment_id, created_via) values (${c.clinic_id}, 'receber', 'Atendimento - Consulta', ${valor},
      'pendente', current_date, ${pt.id}, ${apId}, 'auto')`;
    await probe(tx, 'rede de segurança no DEV: recebível cheio de convênio recusado', '23514', () => receivable(apConv, '150.00'));
    await probe(tx, 'particular segue igual: recebível cheio aceito (sintético, desfeito no fim)', 'ok', () => receivable(apPart, '150.00'));
    await probe(tx, 'cobertura de outro paciente recusada pelo banco', '23514', async () => {
      const [ins] = await tx`insert into hi_insurers (clinic_id,name,registro_ans,provider_id_kind,provider_id_value,created_by)
        values (${c.clinic_id},'Operadora Ensaio','123456','codigoPrestadorNaOperadora','TESTE001',${sys}) returning id`;
      const [other] = await tx`insert into patients (clinic_id, nome, cpf_encrypted, cpf_hash)
        values (${c.clinic_id}, 'Outro sintético', 'ciphertext-de-ensaio', ${`ensaio-0148b-${Date.now()}`}) returning id`;
      const [card] = await tx`insert into hi_memberships (clinic_id,patient_id,insurer_id,card_number_encrypted,card_number_hash,card_last4,created_by)
        values (${c.clinic_id},${other.id},${ins.id},'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',${'c'.repeat(64)},'0001',${sys}) returning id`;
      return tx`insert into hi_appointment_coverages (clinic_id, appointment_id, patient_id, insurer_id, membership_id, created_via)
        values (${c.clinic_id}, ${apConv}, ${pt.id}, ${ins.id}, ${card.id}, 'automation')`;
    });
    lockMs = Date.now() - tLock;
    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) results.push({ name: 'falha inesperada', detail: String(e.message).slice(0, 300), pass: false });
}
try {
  const [after] = await sql`select
    (select count(*)::int from information_schema.columns where table_name = 'appointments' and column_name = 'billing_mode') as col,
    (select count(*)::int from pg_trigger where tgname in ('lancamentos_convenio_patient_guard','appointments_billing_mode_guard')) as trg,
    to_regclass('public.hi_appointment_coverages') as cov, to_regclass('public.hi_guides') as g,
    (select count(*)::int from drizzle.__drizzle_migrations) as n,
    (select count(*)::int from public.patients where cpf_hash like 'ensaio-0148%') as pt`;
  results.push({ name: 'depois do ROLLBACK: sem coluna, gatilho, tabela, linha sintética ou registro de migration', detail: after,
    pass: after.col === 0 && after.trg === 0 && after.cov === null && after.g === null && after.n === 144 && after.pt === 0 });
} finally {
  await sql.end();
}
const pass = results.filter((r) => r.pass).length;
for (const r of results) console.log(`${r.pass ? 'ok ' : 'ERR'} ${r.name}${r.expected ? ` [esperado ${r.expected}, obtido ${r.got}]` : ''}${r.detail && typeof r.detail !== 'object' ? ` — ${r.detail}` : r.detail ? ` — ${JSON.stringify(r.detail).slice(0, 200)}` : ''}`);
console.log(`lock das tabelas vivas por ~${lockMs === null ? '?' : (lockMs / 1000).toFixed(1)} s`);
console.log(`RESUMO ${pass}/${results.length} em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(pass === results.length ? 0 : 1);
