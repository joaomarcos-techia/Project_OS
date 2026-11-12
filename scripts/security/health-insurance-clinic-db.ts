/**
 * Convênios (ADR-072, P1.4, P1.5, P7.1): prova das migrations 0144 e 0145 sobre o SCHEMA REAL.
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

import { startScratchSchema, type ScratchCluster, grantPaidSubscription } from './scratch-schema';

type Sql = ScratchCluster['sql'];

const cluster = await startScratchSchema({ port: 55501, maxConnections: 24 });
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
  await grantPaidSubscription(sql, clinicId);
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

  // ── Carteirinhas (0145, P1.5) ────────────────────────────────────────
  const createPatient = async (clinicId: string, tag: string): Promise<string> => {
    const [p] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
      values (${clinicId}::uuid, ${`Paciente ${tag}`}, 'ciphertext-de-teste', ${`hash-${tag}-${randomUUID()}`})
      returning id`;
    return p!.id as string;
  };
  const patA = await createPatient(A.clinicId, 'A');
  const patB = await createPatient(B.clinicId, 'B');
  const HASH = (c: string): string => c.repeat(64).slice(0, 64);
  const insertCard = (
    db: Sql,
    clinicId: string,
    patientId: string,
    insurerId: string,
    hash: string,
  ) =>
    db`insert into public.hi_memberships
         (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
       values (${clinicId}::uuid, ${patientId}::uuid, ${insurerId}::uuid,
         'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${hash}, '0001', ${SYS}::uuid)
       returning id`;

  await rejects('23503', () => insertCard(sql, A.clinicId, patB, insA!.id, HASH('a')));
  await rejects('23503', () => insertCard(sql, A.clinicId, patA, insB!.id, HASH('a')));
  pass('carteirinha: paciente e operadora só da mesma clínica');

  const [card1] = await insertCard(sql, A.clinicId, patA, insA!.id, HASH('a'));
  await rejects('23505', () => insertCard(sql, A.clinicId, patA, insA!.id, HASH('a')));
  await rejects('23514', () =>
    insertCard(sql, A.clinicId, patA, insA!.id, 'NUMERO-EM-CLARO-0000000000000001'),
  );
  pass('carteirinha: número ativo único por operadora; só HMAC hex no campo de busca');

  await sql`update public.hi_memberships set is_preferred = true where id = ${card1!.id}::uuid`;
  const [card2] = await insertCard(sql, A.clinicId, patA, insA!.id, HASH('b'));
  await rejects(
    '23505',
    () => sql`update public.hi_memberships set is_preferred = true where id = ${card2!.id}::uuid`,
  );
  pass('carteirinha: uma preferencial por paciente');

  await rejects(
    '55000',
    () =>
      sql`update public.hi_memberships set card_number_hash = ${HASH('c')} where id = ${card1!.id}::uuid`,
  );
  await rejects(
    '55000',
    () =>
      sql`update public.hi_memberships set insurer_id = ${insB!.id}::uuid where id = ${card1!.id}::uuid`,
  );
  await sql`update public.hi_memberships set status = 'replaced', is_preferred = false,
    replaced_by_id = ${card2!.id}::uuid where id = ${card1!.id}::uuid`;
  await rejects(
    '55000',
    () =>
      sql`update public.hi_memberships set status = 'active', replaced_by_id = null where id = ${card1!.id}::uuid`,
  );
  await rejects(
    '23514',
    () =>
      sql`update public.hi_memberships set replaced_by_id = ${card1!.id}::uuid where id = ${card2!.id}::uuid`,
  );
  pass(
    'carteirinha: número, paciente e operadora imutáveis; substituição só para frente, com histórico',
  );

  const cardsSeen = await asTenant(A.clinicId, (tx) => tx`select id from public.hi_memberships`);
  assert.equal(cardsSeen.length, 2);
  await rejects('42501', () =>
    asTenant(
      A.clinicId,
      (tx) => tx`delete from public.hi_memberships where id = ${card2!.id}::uuid`,
    ),
  );
  await rejects('42501', () =>
    asTenant(A.clinicId, (tx) => insertCard(tx, B.clinicId, patB, insB!.id, HASH('d'))),
  );
  const bSees = await asTenant(B.clinicId, (tx) => tx`select id from public.hi_memberships`);
  assert.equal(bSees.length, 0);
  pass('carteirinha: RLS por clínica; o runtime não apaga (inativa)');

  const tempPatient = await createPatient(A.clinicId, 'T');
  await insertCard(sql, A.clinicId, tempPatient, insA!.id, HASH('e'));
  await sql`delete from public.patients where id = ${tempPatient}::uuid`;
  const [gone] =
    await sql`select count(*)::int as n from public.hi_memberships where patient_id = ${tempPatient}::uuid`;
  assert.equal(gone!.n, 0);
  pass('carteirinha: exclusão definitiva do paciente leva o número junto (LGPD)');

  // ── Numeração (P7.1) ─────────────────────────────────────────────────
  const next = (db: Sql, clinicId: string, kind: string, scope = ''): Promise<number> =>
    db`select public.hi_next_counter(${clinicId}::uuid, ${kind}, ${scope}) as v`.then((r) =>
      Number(r[0]!.v),
    );

  const CONC = 400;
  const values = await Promise.all(
    Array.from({ length: CONC }, () =>
      sql.begin((tx) => next(tx as unknown as Sql, A.clinicId, 'guide')),
    ),
  );
  assert.equal(new Set(values).size, CONC);
  assert.deepEqual(
    [...values].sort((a, b) => a - b),
    Array.from({ length: CONC }, (_, i) => i + 1),
  );
  pass(
    `numeração: ${CONC} alocações concorrentes (24 conexões) dão 1..${CONC}, sem repetição nem buraco`,
  );

  assert.equal(await next(sql, B.clinicId, 'guide'), 1);
  assert.equal(await next(sql, A.clinicId, 'batch'), 1);
  assert.equal(await next(sql, A.clinicId, 'guide', insA!.id), 1);
  assert.equal(await next(sql, A.clinicId, 'guide'), CONC + 1);
  pass('numeração: contadores independentes por clínica, tipo e escopo');

  await assert.rejects(
    sql.begin(async (tx) => {
      const v = await next(tx as unknown as Sql, A.clinicId, 'guide');
      assert.equal(v, CONC + 2);
      throw new Error('falha depois de alocar');
    }),
    /falha depois de alocar/u,
  );
  assert.equal(await next(sql, A.clinicId, 'guide'), CONC + 2);
  pass('numeração: transação desfeita devolve o número (nunca emitido); confirmado não se repete');

  let attempts = 0;
  let emitted = 0;
  while (attempts < 3) {
    attempts += 1;
    try {
      emitted = await sql.begin(async (tx) => {
        const v = await next(tx as unknown as Sql, A.clinicId, 'transaction');
        if (attempts < 3) throw new Error('falha transitória');
        return v;
      });
      break;
    } catch {
      // retenta a transação inteira
    }
  }
  assert.equal(emitted, 1);
  pass('numeração: retentativa da transação inteira após 2 falhas emite o número 1, sem pular');

  await rejects('42501', () => asTenant(A.clinicId, (tx) => next(tx, B.clinicId, 'guide')));
  assert.equal(await asTenant(A.clinicId, (tx) => next(tx, A.clinicId, 'appeal')), 1);
  pass('numeração: o runtime de uma clínica não move o contador de outra (RLS)');

  await sql`update public.hi_counters set last_value = 999999999999
    where clinic_id = ${A.clinicId}::uuid and kind = 'batch' and scope_key = ''`;
  await rejects('23514', () => next(sql, A.clinicId, 'batch'));
  pass('numeração: no limite do Padrão TISS (999999999999) recusa, nunca volta a 1');

  // ── Autorizações (0146, P1.7) ────────────────────────────────────────
  const newAuth = (db: Sql, clinicId: string, membershipId: string, insurerId: string) =>
    db`insert into public.hi_authorizations (clinic_id, insurer_id, membership_id, guide_type, origin, created_by)
       values (${clinicId}::uuid, ${insurerId}::uuid, ${membershipId}::uuid, 'sp_sadt', 'manual', ${SYS}::uuid)
       returning id, version`;
  const [cardB] = await insertCard(sql, B.clinicId, patB, insB!.id, HASH('f'));
  await rejects('23503', () => newAuth(sql, A.clinicId, cardB!.id, insA!.id));
  const [auth] = await newAuth(sql, A.clinicId, card2!.id, insA!.id);
  pass('autorização: carteirinha e operadora só da mesma clínica');

  await rejects(
    '23514',
    () =>
      sql`update public.hi_authorizations set status = 'authorized' where id = ${auth!.id}::uuid`,
  );
  await rejects(
    '23514',
    () =>
      sql`update public.hi_authorizations set status = 'authorized', authorized_on = '2026-11-01',
      recorded_by = ${SYS}::uuid where id = ${auth!.id}::uuid`,
  );
  await rejects(
    '23514',
    () => sql`update public.hi_authorizations set status = 'denied' where id = ${auth!.id}::uuid`,
  );
  pass(
    'autorização: "autorizada" só com data, quem registrou e evidência da operadora; negada só com motivo',
  );

  const [item] = await sql`insert into public.hi_authorization_items
    (clinic_id, authorization_id, table_code, procedure_code, quantity_requested, quantity_authorized)
    values (${A.clinicId}::uuid, ${auth!.id}::uuid, '22', '20104219', 12, 10) returning id`;
  const consume = (
    db: Sql,
    key: string,
    qty = 1,
    extra: { reverses?: string; reason?: string } = {},
  ) =>
    db`insert into public.hi_authorization_consumptions
         (clinic_id, item_id, quantity, idempotency_key, reverses_id, overrun_reason, overrun_approved_by, created_by)
       values (${A.clinicId}::uuid, ${item!.id}::uuid, ${qty}, ${key}, ${extra.reverses ?? null},
         ${extra.reason ?? null}, ${extra.reason ? SYS : null}, ${SYS}::uuid)
       returning id`;
  await rejects('55000', () => consume(sql, 'consumo-antes-de-autorizar'));
  pass('consumo: só depois de a operadora autorizar');

  const [v2] =
    await sql`update public.hi_authorizations set status = 'authorized', authorized_on = '2026-11-01',
    recorded_by = ${SYS}::uuid, operator_guide_number = 'OP-998877' where id = ${auth!.id}::uuid returning version`;
  assert.equal(v2!.version, 2);
  await rejects(
    '55000',
    () =>
      sql`update public.hi_authorizations set membership_id = ${card1!.id}::uuid where id = ${auth!.id}::uuid`,
  );
  pass('autorização: versão sobe a cada mudança; carteirinha e operadora não mudam');

  const results = await Promise.allSettled(
    Array.from({ length: 30 }, (_, i) =>
      sql.begin((tx) => consume(tx as unknown as Sql, `sessao-concorrente-${i}`)),
    ),
  );
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  assert.equal(ok, 10);
  const [after] =
    await sql`select quantity_consumed::int as c from public.hi_authorization_items where id = ${item!.id}::uuid`;
  assert.equal(after!.c, 10);
  pass(
    'consumo: 30 consumos simultâneos contra saldo de 10 → exatamente 10 aceitos, saldo nunca negativo',
  );

  const [acceptedKey] =
    await sql`select idempotency_key as k from public.hi_authorization_consumptions
    where item_id = ${item!.id}::uuid limit 1`;
  await rejects('23505', () => consume(sql, acceptedKey!.k as string));
  await rejects('23514', () => consume(sql, 'acima-do-saldo'));
  // Regressão: aprovador SEM motivo não libera o excesso (o CHECK com NULL passava).
  await rejects(
    '23514',
    () =>
      sql`insert into public.hi_authorization_consumptions
        (clinic_id, item_id, quantity, idempotency_key, overrun_approved_by, created_by)
        values (${A.clinicId}::uuid, ${item!.id}::uuid, 1, 'aprovador-sem-motivo', ${SYS}::uuid, ${SYS}::uuid)`,
  );
  const [exc] = await consume(sql, 'excecao-aprovada', 1, {
    reason: 'Sessão extra aprovada pela operadora por telefone, protocolo 123',
  });
  const [rev] = await consume(sql, 'estorno-da-excecao', -1, { reverses: exc!.id });
  assert.ok(rev);
  await rejects('23505', () => consume(sql, 'estorno-de-novo', -1, { reverses: exc!.id }));
  pass(
    'consumo: idempotente pela chave; acima do saldo só com exceção justificada; estorno uma vez',
  );

  await rejects('42501', () =>
    asTenant(
      A.clinicId,
      (tx) =>
        tx`update public.hi_authorization_items set quantity_consumed = 0 where id = ${item!.id}::uuid`,
    ),
  );
  await asTenant(
    A.clinicId,
    (tx) =>
      tx`update public.hi_authorization_items set quantity_authorized = 11 where id = ${item!.id}::uuid`,
  );
  await rejects('42501', () =>
    asTenant(
      A.clinicId,
      (tx) =>
        tx`update public.hi_authorization_consumptions set quantity = 5 where id = ${exc!.id}::uuid`,
    ),
  );
  await rejects(
    '55000',
    () =>
      sql`update public.hi_authorization_consumptions set quantity = 5 where id = ${exc!.id}::uuid`,
  );
  pass('runtime não reescreve o consumido nem o histórico; só a quantidade pedida/autorizada');

  await rejects(
    '23514',
    () => sql`insert into public.hi_authorization_attachments
    (clinic_id, authorization_id, storage_ref, content_sha256, ciphertext_sha256, size_bytes, media_type, uploaded_by)
    values (${A.clinicId}::uuid, ${auth!.id}::uuid, 'publico/comprovante.pdf', ${HASH('1')}, ${HASH('2')}, 10, 'application/pdf', ${SYS}::uuid)`,
  );
  await sql`insert into public.hi_authorization_attachments
    (clinic_id, authorization_id, storage_ref, content_sha256, ciphertext_sha256, size_bytes, media_type, uploaded_by)
    values (${A.clinicId}::uuid, ${auth!.id}::uuid, ${`${A.clinicId}/${randomUUID()}`}, ${HASH('1')}, ${HASH('2')}, 10, 'application/pdf', ${SYS}::uuid)`;
  const bAuth = await asTenant(B.clinicId, (tx) => tx`select id from public.hi_authorizations`);
  assert.equal(bAuth.length, 0);
  pass('comprovante: só referência opaca e SHA-256 (bytes fora do banco); RLS por clínica');

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

  console.log(
    `OK: ${passed} provas das migrations 0144–0146 (P1.4, P1.5, P1.7, P7.1) sobre o schema real`,
  );
} finally {
  await cluster.stop();
}
