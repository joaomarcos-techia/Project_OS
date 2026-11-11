/**
 * Convênios (ADR-072, P1.4): prova da migration 0144 sobre o SCHEMA REAL.
 *
 * Sobe o Postgres descartável de `scratch-schema` (todas as migrations, em
 * ordem) e confere, como o runtime faz (`qoro_runtime` → `authenticated` +
 * `app.current_clinic`):
 *  - isolamento por clínica (leitura, escrita e alteração);
 *  - FKs compostas: nada aponta para operadora ou plano de outra clínica;
 *  - profissional só da mesma clínica; vigências ativas sem sobreposição;
 *  - contrato append-only (UPDATE bloqueado, DELETE sem privilégio);
 *  - anon sem acesso; funções de gatilho sem EXECUTE para o runtime;
 *  - exclusão da clínica remove tudo em cascata, mesmo com contrato imutável.
 *
 * Não toca DEV nem produção: só o cluster local sob o TEMP do SO.
 * Uso: npx tsx scripts/security/health-insurance-clinic-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { startScratchSchema, type ScratchCluster } from './scratch-schema';

type Sql = ScratchCluster['sql'];

const cluster = await startScratchSchema({ port: 55501 });
const { sql } = cluster;
const SYS = '00000000-0000-0000-0000-0000000000aa';
let passed = 0;
const pass = (msg: string): void => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};

async function createClinic(label: string): Promise<{ clinicId: string; profileId: string }> {
  const clinicId = randomUUID();
  const profileId = randomUUID();
  await sql`insert into auth.users (id, email) values (${profileId}::uuid, ${`${profileId}@example.invalid`})`;
  await sql`insert into public.clinics (id, slug, nome, status)
    values (${clinicId}::uuid, ${`hi-${clinicId.slice(0, 8)}`}, ${`Clínica ${label}`}, 'active')`;
  await sql`insert into public.profiles (id, clinic_id, nome, role, ativo)
    values (${profileId}::uuid, ${clinicId}::uuid, ${`Profissional ${label}`}, 'doctor', true)`;
  return { clinicId, profileId };
}

async function rejects(code: string, op: () => Promise<unknown>): Promise<void> {
  await assert.rejects(op, (e: unknown) => {
    assert.equal((e as { code?: string }).code, code, String((e as Error).message));
    return true;
  });
}

/** Executa como o runtime: transação com SET LOCAL ROLE authenticated e a clínica no GUC. */
async function asTenant<T>(clinicId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx.unsafe('SET LOCAL ROLE authenticated');
    await tx`select set_config('app.current_clinic', ${clinicId}, true)`;
    return fn(tx as unknown as Sql);
  })) as T;
}

const insertInsurer = (db: Sql, clinicId: string, ans: string, name = 'Operadora Teste') =>
  db`insert into public.hi_insurers
       (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, created_by)
     values (${clinicId}::uuid, ${name}, ${ans}, 'codigoPrestadorNaOperadora', 'TESTE001', ${SYS}::uuid)
     returning id`;

try {
  const A = await createClinic('A');
  const B = await createClinic('B');
  const [insA] = await insertInsurer(sql, A.clinicId, '123456');
  const [insB] = await insertInsurer(sql, B.clinicId, '123456');
  const [planB] = await sql`insert into public.hi_plans (clinic_id, insurer_id, name)
    values (${B.clinicId}::uuid, ${insB!.id}::uuid, 'Plano B') returning id`;

  // ── FKs compostas ────────────────────────────────────────────────────
  await rejects(
    '23503',
    () => sql`insert into public.hi_plans (clinic_id, insurer_id, name)
    values (${B.clinicId}::uuid, ${insA!.id}::uuid, 'cruzado')`,
  );
  await rejects(
    '23503',
    () => sql`insert into public.hi_credentials
    (clinic_id, insurer_id, plan_id, valid_from, created_by)
    values (${A.clinicId}::uuid, ${insA!.id}::uuid, ${planB!.id}::uuid, '2026-01-01', ${SYS}::uuid)`,
  );
  pass('FK composta impede plano e credenciamento ligados a outra clínica');

  // ── Domínio ──────────────────────────────────────────────────────────
  await rejects('23514', () => insertInsurer(sql, A.clinicId, '12345', 'Operadora X'));
  await rejects(
    '23514',
    () => sql`insert into public.hi_insurers
    (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, created_by)
    values (${A.clinicId}::uuid, 'Operadora X', '654321', 'cnpjContratado', '12.ABC.345/01DE-35', ${SYS}::uuid)`,
  );
  await sql`insert into public.hi_insurers
    (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, created_by)
    values (${A.clinicId}::uuid, 'Operadora Alfanumérica', '654321', 'cnpjContratado', '12ABC34501DE35', ${SYS}::uuid)`;
  await rejects(
    '23514',
    () => sql`insert into public.hi_clinic_settings (clinic_id, enabled)
    values (${A.clinicId}::uuid, true)`,
  );
  pass(
    'CHECKs: registro ANS, CNPJ no formato TISS (alfanumérico aceito) e flag só com quem/quando',
  );

  const [settings] = await sql`insert into public.hi_clinic_settings (clinic_id)
    values (${B.clinicId}::uuid) returning enabled, cnes_status`;
  assert.deepEqual(settings, { enabled: false, cnes_status: 'unknown' });
  pass('módulo nasce desligado para a clínica');

  // ── Profissional e vigência ──────────────────────────────────────────
  await rejects(
    '23503',
    () => sql`insert into public.hi_professional_profiles
    (clinic_id, professional_id, council, council_number, council_uf, cbo)
    values (${A.clinicId}::uuid, ${B.profileId}::uuid, '06', '1', '35', '225133')`,
  );
  await sql`insert into public.hi_professional_profiles
    (clinic_id, professional_id, council, council_number, council_uf, cbo)
    values (${A.clinicId}::uuid, ${A.profileId}::uuid, '06', '1', '35', '225133')`;
  pass('perfil TISS só para profissional da mesma clínica');

  await sql`insert into public.hi_credentials (clinic_id, insurer_id, valid_from, valid_until, created_by)
    values (${A.clinicId}::uuid, ${insA!.id}::uuid, '2026-01-01', '2026-12-31', ${SYS}::uuid)`;
  await rejects(
    '23P01',
    () => sql`insert into public.hi_credentials
    (clinic_id, insurer_id, valid_from, created_by)
    values (${A.clinicId}::uuid, ${insA!.id}::uuid, '2026-06-01', ${SYS}::uuid)`,
  );
  await sql`insert into public.hi_credentials (clinic_id, insurer_id, valid_from, created_by)
    values (${A.clinicId}::uuid, ${insA!.id}::uuid, '2027-01-01', ${SYS}::uuid)`;
  pass('credenciamentos ativos do mesmo alvo não se sobrepõem');

  // ── Contrato append-only ─────────────────────────────────────────────
  const [ctr] = await sql`insert into public.hi_procedure_contracts
    (clinic_id, insurer_id, guide_type, table_code, procedure_code, description,
     unit_value_cents, valid_from, copay_kind, copay_percentage, created_by)
    values (${A.clinicId}::uuid, ${insA!.id}::uuid, 'consulta', '22', '10101012',
     'Consulta em consultório', 15000, '2026-01-01', 'percentage', 30, ${SYS}::uuid) returning id`;
  await rejects(
    '55000',
    () => sql`update public.hi_procedure_contracts set unit_value_cents = 1
    where id = ${ctr!.id}::uuid`,
  );
  await sql`insert into public.hi_procedure_contracts
    (clinic_id, insurer_id, guide_type, table_code, procedure_code, description,
     unit_value_cents, valid_from, supersedes_id, created_by)
    values (${A.clinicId}::uuid, ${insA!.id}::uuid, 'consulta', '22', '10101012',
     'Consulta em consultório', 16000, '2026-01-01', ${ctr!.id}::uuid, ${SYS}::uuid)`;
  await rejects(
    '23505',
    () => sql`insert into public.hi_procedure_contracts
    (clinic_id, insurer_id, guide_type, table_code, procedure_code, description,
     unit_value_cents, valid_from, supersedes_id, created_by)
    values (${A.clinicId}::uuid, ${insA!.id}::uuid, 'consulta', '22', '10101012',
     'Consulta', 17000, '2026-01-01', ${ctr!.id}::uuid, ${SYS}::uuid)`,
  );
  await rejects(
    '23514',
    () => sql`insert into public.hi_procedure_contracts
    (clinic_id, insurer_id, guide_type, table_code, procedure_code, description,
     unit_value_cents, valid_from, copay_kind, copay_fixed_cents, created_by)
    values (${A.clinicId}::uuid, ${insA!.id}::uuid, 'consulta', '22', '10101012',
     'Consulta', 15000, '2026-01-01', 'fixed', 20000, ${SYS}::uuid)`,
  );
  pass('contrato imutável: correção só por nova versão, uma por linha; coparticipação ≤ valor');

  // ── Como o runtime ───────────────────────────────────────────────────
  const visible = await asTenant(A.clinicId, (tx) => tx`select clinic_id from public.hi_insurers`);
  assert.ok(visible.length >= 1 && visible.every((r) => r.clinic_id === A.clinicId));
  await rejects('42501', () =>
    asTenant(A.clinicId, (tx) => insertInsurer(tx, B.clinicId, '777777')),
  );
  await asTenant(A.clinicId, (tx) => insertInsurer(tx, A.clinicId, '777777', 'Própria'));
  const changed = await asTenant(
    A.clinicId,
    (tx) => tx`update public.hi_insurers set name = 'invadida' where id = ${insB!.id}::uuid`,
  );
  assert.equal(changed.count, 0);
  pass('RLS: a clínica A só lê, grava e altera o que é dela');

  await rejects('42501', () =>
    asTenant(
      A.clinicId,
      (tx) =>
        tx`update public.hi_procedure_contracts set description = 'x' where id = ${ctr!.id}::uuid`,
    ),
  );
  await rejects('42501', () =>
    asTenant(
      A.clinicId,
      (tx) => tx`delete from public.hi_procedure_contracts where id = ${ctr!.id}::uuid`,
    ),
  );
  const contracts = await asTenant(
    A.clinicId,
    (tx) => tx`select id from public.hi_procedure_contracts`,
  );
  assert.equal(contracts.length, 2);
  await rejects('42501', () =>
    asTenant(A.clinicId, (tx) => tx`select public.hi_block_contract_update()`),
  );
  await rejects('42501', () =>
    sql.begin(async (tx) => {
      await tx.unsafe('SET LOCAL ROLE anon');
      return tx`select 1 from public.hi_insurers limit 1`;
    }),
  );
  pass(
    'privilégios: runtime sem UPDATE/DELETE em contrato e sem EXECUTE nos gatilhos; anon sem acesso',
  );

  // ── Exclusão da clínica em cascata ───────────────────────────────────
  await sql`delete from public.clinics where id = ${A.clinicId}::uuid`;
  const [left] = await sql`select
      (select count(*)::int from public.hi_insurers where clinic_id = ${A.clinicId}::uuid) +
      (select count(*)::int from public.hi_procedure_contracts where clinic_id = ${A.clinicId}::uuid) +
      (select count(*)::int from public.hi_credentials where clinic_id = ${A.clinicId}::uuid) +
      (select count(*)::int from public.hi_professional_profiles where clinic_id = ${A.clinicId}::uuid) as n`;
  assert.equal(left!.n, 0);
  const [others] =
    await sql`select count(*)::int as n from public.hi_insurers where clinic_id = ${B.clinicId}::uuid`;
  assert.equal(others!.n, 1);
  pass(
    'excluir a clínica remove os dados de convênio dela (inclusive contratos) e não toca nas outras',
  );

  console.log(`OK: ${passed} provas da migration 0144 sobre o schema real`);
} finally {
  await cluster.stop();
}
