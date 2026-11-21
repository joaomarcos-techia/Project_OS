/**
 * Convênios (ADR-072, P1.8): prova da migration 0147 (guias TISS) sobre o SCHEMA REAL.
 *
 * Sobe o Postgres descartável de `scratch-schema` (todas as migrations, em
 * ordem) e confere, como o runtime faz (`authenticated` + `app.current_clinic`
 * + `app.current_user`):
 *  - numeração P7.1 na mesma transação da guia: única, sem buraco no rollback,
 *    concorrente e idempotente (retentativa não consome número);
 *  - isolamento por clínica e coerência das referências (operadora, plano,
 *    carteirinha, autorização, paciente, atendimento, profissional, contrato);
 *  - sem cobrança dupla, com SP/SADT agrupada permitida;
 *  - estado: transições editoriais do runtime, as de lote/envio/retorno só do
 *    código do banco com dono; conteúdo congelado depois da conferência;
 *  - snapshot, histórico e arquivo append-only; histórico gravado pelo banco;
 *  - reabertura (nova revisão), cancelamento e substituição;
 *  - retenção: paciente com guia não é excluído; a clínica leva tudo.
 *
 * Não toca DEV nem produção: só o cluster local sob o TEMP do SO.
 * Uso: npx tsx scripts/security/health-insurance-guides-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { startScratchSchema, type ScratchCluster, grantPaidSubscription } from './scratch-schema';

type Sql = ScratchCluster['sql'];

const cluster = await startScratchSchema({ port: Number(process.env.PORT ?? 55502), maxConnections: 48 });
const { sql } = cluster;
const SYS = '00000000-0000-0000-0000-0000000000aa';
const HASH = (c: string): string => c.repeat(64).slice(0, 64);
const CIPHER = 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
let passed = 0;
const pass = (msg: string): void => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};

async function rejects(code: string, op: () => Promise<unknown>, hint?: RegExp): Promise<void> {
  await assert.rejects(op, (e: unknown) => {
    const err = e as { code?: string; message?: string };
    assert.equal(err.code, code, String(err.message));
    if (hint) assert.match(String(err.message), hint);
    return true;
  });
}

/** Como o runtime: SET LOCAL ROLE authenticated, clínica e usuário nos GUCs. */
async function asTenant<T>(
  clinicId: string,
  fn: (tx: Sql) => Promise<T>,
  actor: string | null = null,
): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx.unsafe('SET LOCAL ROLE authenticated');
    await tx`select set_config('app.current_clinic', ${clinicId}, true)`;
    if (actor) await tx`select set_config('app.current_user', ${actor}, true)`;
    return fn(tx as unknown as Sql);
  })) as T;
}

async function createClinic(label: string) {
  const clinicId = randomUUID();
  const doctorId = randomUUID();
  await sql`insert into auth.users (id, email) values (${doctorId}::uuid, ${`${doctorId}@example.invalid`})`;
  await sql`insert into public.clinics (id, slug, nome, status)
    values (${clinicId}::uuid, ${`hg-${clinicId.slice(0, 8)}`}, ${`Clínica ${label}`}, 'active')`;
  await grantPaidSubscription(sql, clinicId);
  await sql`insert into public.profiles (id, clinic_id, nome, role, ativo)
    values (${doctorId}::uuid, ${clinicId}::uuid, ${`Profissional ${label}`}, 'doctor', true)`;
  const [proc] = await sql`insert into public.procedures
      (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
    values (${clinicId}::uuid, 'CONS', 'Consulta sintética', 150, 30, true) returning id`;
  const [insurer] = await sql`insert into public.hi_insurers
      (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, created_by)
    values (${clinicId}::uuid, 'Operadora Um', '123456', 'codigoPrestadorNaOperadora', 'TESTE001', ${SYS}::uuid)
    returning id`;
  const [insurer2] = await sql`insert into public.hi_insurers
      (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, created_by)
    values (${clinicId}::uuid, 'Operadora Dois', '654321', 'codigoPrestadorNaOperadora', 'TESTE002', ${SYS}::uuid)
    returning id`;
  return {
    clinicId,
    doctorId,
    procedureId: proc!.id as string,
    insurerId: insurer!.id as string,
    insurer2Id: insurer2!.id as string,
  };
}
type Clinic = Awaited<ReturnType<typeof createClinic>>;

async function createPatient(c: Clinic, tag: string): Promise<string> {
  const [p] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
    values (${c.clinicId}::uuid, ${`Paciente ${tag}`}, 'ciphertext-de-teste', ${`hash-${tag}-${randomUUID()}`})
    returning id`;
  return p!.id as string;
}

async function createCard(
  c: Clinic,
  patientId: string,
  insurerId: string,
  hash: string,
): Promise<string> {
  const [m] = await sql`insert into public.hi_memberships
      (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
    values (${c.clinicId}::uuid, ${patientId}::uuid, ${insurerId}::uuid, ${CIPHER}, ${hash}, '0001', ${SYS}::uuid)
    returning id`;
  return m!.id as string;
}

// Horários sequenciais de 1 h: o `appointments_no_overlap` recusa sobreposição do mesmo profissional.
let slot = 0;
async function createAppointment(c: Clinic, patientId: string): Promise<string> {
  slot += 1;
  const [a] = await sql`insert into public.appointments (
      clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status,
      valor, snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min,
      snapshot_doctor_nome, created_via)
    values (${c.clinicId}::uuid, ${c.doctorId}::uuid, ${patientId}::uuid, ${c.procedureId}::uuid,
      '2026-11-01T00:00:00Z'::timestamptz + ${slot} * interval '1 hour',
      30, 'atendido', 150, 'Consulta', 150, 30, 'Profissional sintético', 'attendant')
    returning id`;
  return a!.id as string;
}

async function contract(
  c: Clinic,
  args: {
    insurerId?: string;
    guideType: 'consulta' | 'sp_sadt';
    code: string;
    cents: number;
    from?: string;
    until?: string | null;
    supersedes?: string | null;
  },
): Promise<string> {
  const [r] = await sql`insert into public.hi_procedure_contracts
      (clinic_id, insurer_id, guide_type, table_code, procedure_code, description,
       unit_value_cents, valid_from, valid_until, supersedes_id, created_by)
    values (${c.clinicId}::uuid, ${args.insurerId ?? c.insurerId}::uuid, ${args.guideType}, '22', ${args.code},
      'Procedimento sintético', ${args.cents}, ${args.from ?? '2026-01-01'}, ${args.until ?? null},
      ${args.supersedes ?? null}, ${SYS}::uuid)
    returning id`;
  return r!.id as string;
}

interface GuideArgs {
  guideType?: 'consulta' | 'sp_sadt';
  insurerId?: string;
  patientId: string;
  membershipId?: string | null;
  authorizationId?: string | null;
  planId?: string | null;
  replaces?: string | null;
  key?: string;
  number?: string;
  executant?: string | null;
}

/** Cria a guia como o serviço fará: número alocado na MESMA transação. */
async function newGuide(tx: Sql, c: Clinic, g: GuideArgs) {
  const number =
    g.number ??
    String((await tx`select public.hi_next_counter(${c.clinicId}::uuid, 'guide', '') as v`)[0]!.v);
  const [row] = await tx`insert into public.hi_guides
      (clinic_id, guide_type, number, insurer_id, plan_id, patient_id, membership_id, authorization_id,
       executant_professional_id, replaces_guide_id, idempotency_key, created_via, created_by)
    values (${c.clinicId}::uuid, ${g.guideType ?? 'consulta'}, ${number}, ${g.insurerId ?? c.insurerId}::uuid,
      ${g.planId ?? null}, ${g.patientId}::uuid, ${g.membershipId ?? null}, ${g.authorizationId ?? null},
      ${g.executant === undefined ? c.doctorId : g.executant}, ${g.replaces ?? null},
      ${g.key ?? `teste:${randomUUID()}`}, 'user', ${c.doctorId}::uuid)
    returning id, number, status, live, version, revision`;
  return row!;
}

interface ItemArgs {
  guideId: string;
  sequence?: number;
  appointmentId?: string | null;
  contractId: string;
  code: string;
  cents: number;
  quantity?: number;
  factor?: number;
  total?: number;
  executedOn?: string;
  authorizationItemId?: string | null;
}

function newItem(tx: Sql, c: Clinic, i: ItemArgs) {
  const quantity = i.quantity ?? 1;
  const factor = i.factor ?? 100;
  const total = i.total ?? Math.floor((quantity * i.cents * factor + 50) / 100);
  return tx`insert into public.hi_guide_items
      (clinic_id, guide_id, sequence, appointment_id, contract_line_id, authorization_item_id, executed_on,
       table_code, procedure_code, description, quantity, factor_hundredths, unit_value_cents, total_value_cents)
    values (${c.clinicId}::uuid, ${i.guideId}::uuid, ${i.sequence ?? 1}, ${i.appointmentId ?? null},
      ${i.contractId}::uuid, ${i.authorizationItemId ?? null}, ${i.executedOn ?? '2026-11-10'}, '22', ${i.code},
      'Procedimento sintético', ${quantity}, ${factor}, ${i.cents}, ${total})
    returning id, live, guide_type`;
}

/** pending → ready → reviewed → snapshot → approved, como o serviço fará. */
async function approve(c: Clinic, guideId: string, total: number, actor: string): Promise<string> {
  return asTenant(
    c.clinicId,
    async (tx) => {
      await tx`update public.hi_guides set status = 'ready_for_review', total_value_cents = ${total}, issues = '[]', terminology_version = '202609'
        where id = ${guideId}::uuid`;
      await tx`update public.hi_guides set status = 'reviewed', reviewed_by = ${actor}::uuid where id = ${guideId}::uuid`;
      const [g] = await tx`select revision from public.hi_guides where id = ${guideId}::uuid`;
      const [snap] = await tx`insert into public.hi_guide_snapshots
          (clinic_id, guide_id, revision, content_encrypted, content_sha256, tiss_version, terminology_version,
           created_via, created_by)
        values (${c.clinicId}::uuid, ${guideId}::uuid, ${g!.revision}, ${CIPHER}, ${HASH('c')}, '4.03.00', '202609',
          'user', ${actor}::uuid)
        returning id`;
      await tx`update public.hi_guides set status = 'approved', approved_snapshot_id = ${snap!.id}::uuid,
          approved_by = ${actor}::uuid
        where id = ${guideId}::uuid and status = 'reviewed'`;
      return snap!.id as string;
    },
    actor,
  );
}

/** Simula o código do banco com dono (funções do lote na 0148): roda como dono da tabela. */
async function ownerAdvance(guideId: string, path: string[]): Promise<void> {
  for (const status of path) {
    await sql`update public.hi_guides set status = ${status} where id = ${guideId}::uuid`;
  }
}

try {
  await sql`insert into public.tiss_terminology_versions (version, archive_url, archive_sha256, manifest_sha256)
    values ('202609', 'https://example.invalid/tuss.zip', ${HASH('a')}, ${HASH('b')})
    on conflict (version) do nothing`;
  const A = await createClinic('A');
  const B = await createClinic('B');
  const patA = await createPatient(A, 'A');
  const patA2 = await createPatient(A, 'A2');
  const patB = await createPatient(B, 'B');
  const cardA = await createCard(A, patA, A.insurerId, HASH('1'));
  const cardA2 = await createCard(A, patA2, A.insurerId, HASH('2'));
  const cardAOther = await createCard(A, patA, A.insurer2Id, HASH('3'));
  const cardB = await createCard(B, patB, B.insurerId, HASH('4'));
  const consulta = await contract(A, { guideType: 'consulta', code: '10101012', cents: 15000 });
  const sadt = await contract(A, { guideType: 'sp_sadt', code: '50000470', cents: 4000 });
  const sadt2 = await contract(A, { guideType: 'sp_sadt', code: '50000144', cents: 3500 });
  const otherInsurer = await contract(A, {
    insurerId: A.insurer2Id,
    guideType: 'consulta',
    code: '10101012',
    cents: 9000,
  });
  const oldLine = await contract(A, { guideType: 'sp_sadt', code: '50000160', cents: 2000 });
  await contract(A, { guideType: 'sp_sadt', code: '50000160', cents: 2500, supersedes: oldLine });
  const expired = await contract(A, {
    guideType: 'sp_sadt',
    code: '50000179',
    cents: 1000,
    until: '2026-06-30',
  });
  const ap = await Promise.all(Array.from({ length: 6 }, () => createAppointment(A, patA)));
  const apOther = await createAppointment(A, patA2);

  // ── Numeração na mesma transação (P7.1 + P1.8) ───────────────────────
  const g1 = await asTenant(
    A.clinicId,
    (tx) => newGuide(tx, A, { patientId: patA, membershipId: cardA, key: 'auto:ap0:consulta' }),
    A.doctorId,
  );
  assert.equal(g1.number, '1');
  assert.equal(g1.status, 'pending_data');
  const [ev1] =
    await sql`select from_status, to_status, actor_kind, actor_id from public.hi_guide_events where guide_id = ${g1.id}::uuid`;
  assert.deepEqual(
    [ev1!.from_status, ev1!.to_status, ev1!.actor_kind, ev1!.actor_id],
    [null, 'pending_data', 'user', A.doctorId],
  );
  pass(
    'guia nasce em edição, com o número alocado na mesma transação e o histórico gravado pelo banco (autor = usuário)',
  );

  await rejects('23505', () =>
    asTenant(A.clinicId, (tx) => newGuide(tx, A, { patientId: patA, key: 'auto:ap0:consulta' })),
  );
  const [ctr1] =
    await sql`select last_value from public.hi_counters where clinic_id = ${A.clinicId}::uuid and kind = 'guide'`;
  assert.equal(Number(ctr1!.last_value), 1);
  pass(
    'reprocessamento com a mesma chave de origem: recusado e o número alocado volta (contador intacto)',
  );

  await rejects('23505', () =>
    asTenant(A.clinicId, (tx) => newGuide(tx, A, { patientId: patA, number: '1' })),
  );
  pass('número do prestador nunca se repete na mesma operadora');

  await rejects('P0001', () =>
    sql.begin(async (tx) => {
      await tx.unsafe('SET LOCAL ROLE authenticated');
      await tx`select set_config('app.current_clinic', ${A.clinicId}, true)`;
      await newGuide(tx as unknown as Sql, A, { patientId: patA });
      throw Object.assign(new Error('falha simulada depois de gravar'), { code: 'P0001' });
    }),
  );
  const [ctr2] =
    await sql`select last_value from public.hi_counters where clinic_id = ${A.clinicId}::uuid and kind = 'guide'`;
  assert.equal(Number(ctr2!.last_value), 1);
  pass('rollback da transação desfaz a guia e devolve o número (sem buraco)');

  // 40 criações concorrentes para atendimentos distintos → 40 números distintos e contíguos.
  const extraAps = await Promise.all(Array.from({ length: 40 }, () => createAppointment(A, patA)));
  const created = await Promise.all(
    extraAps.map((apId, i) =>
      asTenant(A.clinicId, async (tx) => {
        const g = await newGuide(tx, A, { patientId: patA, key: `concorrente:${i}` });
        await newItem(tx, A, {
          guideId: g.id,
          appointmentId: apId,
          contractId: consulta,
          code: '10101012',
          cents: 15000,
        });
        return g.number as string;
      }),
    ),
  );
  const nums = created.map(Number).sort((x, y) => x - y);
  assert.deepEqual(
    nums,
    Array.from({ length: 40 }, (_, i) => i + 2),
  );
  pass('40 guias criadas em paralelo: 40 números distintos e contíguos (2..41)');

  // 20 tentativas concorrentes de Consulta para o MESMO atendimento → uma só guia viva.
  const sameAp = await createAppointment(A, patA);
  const before = Number(
    (
      await sql`select last_value from public.hi_counters where clinic_id = ${A.clinicId}::uuid and kind = 'guide'`
    )[0]!.last_value,
  );
  const race = await Promise.allSettled(
    Array.from({ length: 20 }, (_, i) =>
      asTenant(A.clinicId, async (tx) => {
        const g = await newGuide(tx, A, { patientId: patA, key: `corrida:${i}` });
        await newItem(tx, A, {
          guideId: g.id,
          appointmentId: sameAp,
          contractId: consulta,
          code: '10101012',
          cents: 15000,
        });
        return g.number;
      }),
    ),
  );
  const ok = race.filter((r) => r.status === 'fulfilled');
  const failed = race.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  assert.equal(ok.length, 1);
  assert.ok(failed.every((r) => (r.reason as { code?: string }).code === '23505'));
  const after = Number(
    (
      await sql`select last_value from public.hi_counters where clinic_id = ${A.clinicId}::uuid and kind = 'guide'`
    )[0]!.last_value,
  );
  assert.equal(after, before + 1);
  pass(
    '20 tentativas simultâneas de Consulta para o mesmo atendimento: 1 guia, 19 recusas, contador +1',
  );

  // ── Coerência das referências ────────────────────────────────────────
  await rejects('23503', () =>
    asTenant(A.clinicId, (tx) => newGuide(tx, A, { patientId: patA, insurerId: B.insurerId })),
  );
  await rejects('23503', () =>
    asTenant(A.clinicId, (tx) => newGuide(tx, A, { patientId: patA, membershipId: cardAOther })),
  );
  await rejects('23514', () =>
    asTenant(A.clinicId, (tx) => newGuide(tx, A, { patientId: patA, membershipId: cardA2 })),
  );
  await rejects('23503', () => asTenant(A.clinicId, (tx) => newGuide(tx, A, { patientId: patB })));
  await rejects('23503', () =>
    asTenant(A.clinicId, (tx) => newGuide(tx, A, { patientId: patA, executant: B.doctorId })),
  );
  const [planOther] = await sql`insert into public.hi_plans (clinic_id, insurer_id, name)
    values (${A.clinicId}::uuid, ${A.insurer2Id}::uuid, 'Plano da outra') returning id`;
  await rejects('23503', () =>
    asTenant(A.clinicId, (tx) => newGuide(tx, A, { patientId: patA, planId: planOther!.id })),
  );
  pass(
    'guia: operadora, carteirinha, plano e profissional da mesma clínica; carteirinha e plano da MESMA operadora; carteirinha do mesmo paciente',
  );

  // Autorização: da mesma operadora, do mesmo tipo de guia e do mesmo paciente.
  const [authSadt] = await sql`insert into public.hi_authorizations
      (clinic_id, insurer_id, membership_id, guide_type, origin, status, authorized_on, recorded_by,
       operator_guide_number, created_by)
    values (${A.clinicId}::uuid, ${A.insurerId}::uuid, ${cardA}::uuid, 'sp_sadt', 'manual', 'authorized',
      '2026-11-01', ${SYS}::uuid, 'OP-1001', ${SYS}::uuid) returning id`;
  const [authItem] = await sql`insert into public.hi_authorization_items
      (clinic_id, authorization_id, table_code, procedure_code, quantity_requested, quantity_authorized)
    values (${A.clinicId}::uuid, ${authSadt!.id}::uuid, '22', '50000470', 10, 10) returning id`;
  const [authOtherPatient] = await sql`insert into public.hi_authorizations
      (clinic_id, insurer_id, membership_id, guide_type, origin, created_by)
    values (${A.clinicId}::uuid, ${A.insurerId}::uuid, ${cardA2}::uuid, 'sp_sadt', 'manual', ${SYS}::uuid) returning id`;
  await rejects('23503', () =>
    asTenant(A.clinicId, (tx) =>
      newGuide(tx, A, { patientId: patA, authorizationId: authSadt!.id }),
    ),
  );
  await rejects('23514', () =>
    asTenant(A.clinicId, (tx) =>
      newGuide(tx, A, {
        guideType: 'sp_sadt',
        patientId: patA,
        authorizationId: authOtherPatient!.id,
      }),
    ),
  );
  pass(
    'autorização só da mesma operadora, do mesmo tipo de guia (consulta × SP/SADT) e do mesmo paciente',
  );

  // ── Itens ────────────────────────────────────────────────────────────
  const gs = await asTenant(A.clinicId, (tx) =>
    newGuide(tx, A, {
      guideType: 'sp_sadt',
      patientId: patA,
      membershipId: cardA,
      authorizationId: authSadt!.id,
      key: 'grupo-sadt:1',
    }),
  );
  const item = (i: Omit<ItemArgs, 'guideId'> & { guideId?: string }) =>
    asTenant(A.clinicId, (tx) => newItem(tx, A, { guideId: gs.id as string, ...i }));
  await rejects(
    '23514',
    () => item({ contractId: otherInsurer, code: '10101012', cents: 9000 }),
    /contrato/u,
  );
  await rejects(
    '23514',
    () => item({ contractId: consulta, code: '10101012', cents: 15000 }),
    /contrato/u,
  );
  await rejects(
    '23514',
    () => item({ contractId: oldLine, code: '50000160', cents: 2000 }),
    /substituído/u,
  );
  await rejects(
    '23514',
    () => item({ contractId: expired, code: '50000179', cents: 1000 }),
    /vigente/u,
  );
  await rejects(
    '23514',
    () => item({ contractId: sadt, code: '50000470', cents: 3999 }),
    /unitário/u,
  );
  await rejects('23514', () =>
    item({ contractId: sadt, code: '50000470', cents: 4000, total: 4001 }),
  );
  await rejects(
    '23514',
    () => item({ contractId: sadt, code: '50000470', cents: 4000, appointmentId: apOther }),
    /paciente/u,
  );
  pass(
    'item: só do contrato desta operadora, deste tipo e procedimento, vigente, não substituído, com o valor do contrato e o total certo; atendimento do mesmo paciente',
  );

  // SP/SADT agrupada: 3 sessões (3 atendimentos) na mesma guia, com fator e quantidade.
  for (const [n, apId] of [ap[1], ap[2], ap[3]].entries()) {
    await item({
      sequence: n + 1,
      appointmentId: apId!,
      contractId: sadt,
      code: '50000470',
      cents: 4000,
      authorizationItemId: authItem!.id,
    });
  }
  const [reduced] = await item({
    sequence: 4,
    appointmentId: ap[1]!,
    contractId: sadt2,
    code: '50000144',
    cents: 3500,
    quantity: 3,
    factor: 70,
  });
  assert.equal(reduced!.guide_type, 'sp_sadt');
  const [sumRow] =
    await sql`select sum(total_value_cents)::int as total from public.hi_guide_items where guide_id = ${gs.id}::uuid`;
  assert.equal(sumRow!.total, 3 * 4000 + Math.floor((3 * 3500 * 70 + 50) / 100));
  pass(
    'SP/SADT agrupada: várias sessões e atendimentos na mesma guia, outro procedimento na mesma sessão, fator e quantidade',
  );

  const [authOther] = await sql`insert into public.hi_authorizations
      (clinic_id, insurer_id, membership_id, guide_type, origin, status, authorized_on, recorded_by,
       operator_guide_number, created_by)
    values (${A.clinicId}::uuid, ${A.insurerId}::uuid, ${cardA}::uuid, 'sp_sadt', 'manual', 'authorized',
      '2026-11-01', ${SYS}::uuid, 'OP-1002', ${SYS}::uuid) returning id`;
  const [authOtherItem] = await sql`insert into public.hi_authorization_items
      (clinic_id, authorization_id, table_code, procedure_code, quantity_requested, quantity_authorized)
    values (${A.clinicId}::uuid, ${authOther!.id}::uuid, '22', '50000470', 5, 5) returning id`;
  await rejects(
    '23514',
    () =>
      item({
        sequence: 9,
        appointmentId: ap[4]!,
        contractId: sadt,
        code: '50000470',
        cents: 4000,
        authorizationItemId: authOtherItem!.id,
      }),
    /autorização/u,
  );
  await rejects('23514', () =>
    asTenant(
      A.clinicId,
      (tx) =>
        tx`update public.hi_guides set authorization_id = ${authOther!.id}::uuid where id = ${gs.id}::uuid`,
    ),
  );
  pass(
    'item de autorização só da autorização da guia; trocar a autorização com itens ligados à anterior é recusado',
  );

  // Sem cobrança dupla.
  const gs2 = await asTenant(A.clinicId, (tx) =>
    newGuide(tx, A, {
      guideType: 'sp_sadt',
      patientId: patA,
      membershipId: cardA,
      key: 'grupo-sadt:2',
    }),
  );
  await rejects('23505', () =>
    asTenant(A.clinicId, (tx) =>
      newItem(tx, A, {
        guideId: gs2.id,
        appointmentId: ap[2]!,
        contractId: sadt,
        code: '50000470',
        cents: 4000,
      }),
    ),
  );
  await asTenant(A.clinicId, (tx) =>
    newItem(tx, A, {
      guideId: gs2.id,
      appointmentId: ap[2]!,
      contractId: sadt2,
      code: '50000144',
      cents: 3500,
    }),
  );
  const gc = await asTenant(A.clinicId, (tx) =>
    newGuide(tx, A, { patientId: patA, membershipId: cardA, key: 'auto:ap5:consulta' }),
  );
  await asTenant(A.clinicId, (tx) =>
    newItem(tx, A, {
      guideId: gc.id,
      appointmentId: ap[5]!,
      contractId: consulta,
      code: '10101012',
      cents: 15000,
    }),
  );
  const gc2 = await asTenant(A.clinicId, (tx) =>
    newGuide(tx, A, { patientId: patA, membershipId: cardA }),
  );
  await rejects('23505', () =>
    asTenant(A.clinicId, (tx) =>
      newItem(tx, A, {
        guideId: gc2.id,
        appointmentId: ap[5]!,
        contractId: consulta,
        code: '10101012',
        cents: 15000,
      }),
    ),
  );
  await rejects('23514', () =>
    asTenant(A.clinicId, (tx) =>
      newItem(tx, A, {
        guideId: gc.id,
        sequence: 2,
        contractId: consulta,
        code: '10101012',
        cents: 15000,
      }),
    ),
  );
  pass(
    'sem cobrança dupla: o mesmo procedimento do mesmo atendimento em uma guia viva só; uma Consulta por atendimento; Consulta com um procedimento só',
  );

  // ── Isolamento ───────────────────────────────────────────────────────
  const seenByB = await asTenant(B.clinicId, async (tx) => ({
    g: (await tx`select id from public.hi_guides`).length,
    i: (await tx`select id from public.hi_guide_items`).length,
    e: (await tx`select id from public.hi_guide_events`).length,
  }));
  assert.deepEqual(seenByB, { g: 0, i: 0, e: 0 });
  await rejects('42501', () =>
    asTenant(
      B.clinicId,
      (tx) =>
        tx`insert into public.hi_guides (clinic_id, guide_type, number, insurer_id, patient_id, idempotency_key, created_via)
         values (${A.clinicId}::uuid, 'consulta', '999', ${A.insurerId}::uuid, ${patA}::uuid, 'intruso-123', 'automation')`,
    ),
  );
  const changedByB = await asTenant(
    B.clinicId,
    (tx) => tx`update public.hi_guides set issues = '[]' where id = ${gc.id}::uuid returning id`,
  );
  assert.equal(changedByB.length, 0);
  await rejects('42501', () =>
    sql.begin(async (tx) => {
      await tx.unsafe('SET LOCAL ROLE anon');
      return tx`select id from public.hi_guides`;
    }),
  );
  pass(
    'RLS: outra clínica não lê, não cria e não altera guias, itens nem histórico; anon sem acesso',
  );

  // ── Estado ───────────────────────────────────────────────────────────
  await rejects('55000', () =>
    asTenant(
      A.clinicId,
      (tx) => tx`update public.hi_guides set status = 'approved' where id = ${gc.id}::uuid`,
    ),
  );
  await rejects('23514', () =>
    asTenant(
      A.clinicId,
      (tx) => tx`update public.hi_guides set status = 'ready_for_review',
      issues = '[{"code":"MEMBERSHIP_MISSING"}]' where id = ${gc.id}::uuid`,
    ),
  );
  await asTenant(
    A.clinicId,
    (tx) =>
      tx`update public.hi_guides set status = 'ready_for_review', total_value_cents = 14999 where id = ${gc.id}::uuid`,
  );
  await rejects(
    '23514',
    () =>
      asTenant(
        A.clinicId,
        (tx) =>
          tx`update public.hi_guides set status = 'reviewed', reviewed_by = ${A.doctorId}::uuid where id = ${gc.id}::uuid`,
      ),
    /soma/u,
  );
  await rejects('23514', () =>
    asTenant(
      A.clinicId,
      (tx) =>
        tx`update public.hi_guides set total_value_cents = 15000, status = 'reviewed' where id = ${gc.id}::uuid`,
    ),
  );
  await rejects('23514', () =>
    asTenant(
      A.clinicId,
      (tx) => tx`insert into public.hi_guide_snapshots
      (clinic_id, guide_id, revision, content_encrypted, content_sha256, tiss_version, terminology_version, created_via)
      values (${A.clinicId}::uuid, ${gc.id}::uuid, 1, ${CIPHER}, ${HASH('d')}, '4.03.00', '202609', 'automation')`,
    ),
  );
  pass(
    'estado: sem salto para aprovada; pronta só sem pendências; conferência exige quem conferiu e soma dos itens = total; snapshot só da guia conferida',
  );

  const snap1 = await approve(A, gc.id, 15000, A.doctorId);
  const [appr] =
    await sql`select status, revision, approved_at is not null as at, reviewed_at is not null as rv from public.hi_guides where id = ${gc.id}::uuid`;
  assert.deepEqual([appr!.status, appr!.revision, appr!.at, appr!.rv], ['approved', 1, true, true]);
  await rejects('55000', () =>
    asTenant(
      A.clinicId,
      (tx) =>
        tx`update public.hi_guides set membership_id = ${cardA}::uuid, total_value_cents = 1 where id = ${gc.id}::uuid`,
    ),
  );
  await rejects('55000', () =>
    asTenant(
      A.clinicId,
      (tx) =>
        tx`update public.hi_guide_items set quantity = 2, total_value_cents = 30000 where guide_id = ${gc.id}::uuid`,
    ),
  );
  await rejects('55000', () =>
    asTenant(
      A.clinicId,
      (tx) => tx`delete from public.hi_guide_items where guide_id = ${gc.id}::uuid`,
    ),
  );
  await rejects('42501', () =>
    asTenant(
      A.clinicId,
      (tx) => tx`update public.hi_guides set approved_at = now() where id = ${gc.id}::uuid`,
    ),
  );
  await rejects('55000', () =>
    asTenant(
      A.clinicId,
      (tx) => tx`update public.hi_guides set status = 'in_batch' where id = ${gc.id}::uuid`,
    ),
  );
  await rejects('55000', () =>
    asTenant(
      A.clinicId,
      (tx) => tx`update public.hi_guides set status = 'sent' where id = ${gc.id}::uuid`,
    ),
  );
  pass(
    'aprovada: conteúdo e itens congelados; horários só do banco; lote e envio não são transições do runtime',
  );

  // Aprovação concorrente: 12 tentativas com a mesma versão → 1 vence.
  const gr = await asTenant(A.clinicId, (tx) =>
    newGuide(tx, A, { patientId: patA, membershipId: cardA }),
  );
  const apRace = await createAppointment(A, patA);
  await asTenant(A.clinicId, (tx) =>
    newItem(tx, A, {
      guideId: gr.id,
      appointmentId: apRace,
      contractId: consulta,
      code: '10101012',
      cents: 15000,
    }),
  );
  await asTenant(A.clinicId, async (tx) => {
    await tx`update public.hi_guides set status = 'ready_for_review', total_value_cents = 15000, terminology_version = '202609' where id = ${gr.id}::uuid`;
    await tx`update public.hi_guides set status = 'reviewed', reviewed_by = ${A.doctorId}::uuid where id = ${gr.id}::uuid`;
  });
  const [snapR] = await asTenant(
    A.clinicId,
    (tx) => tx`insert into public.hi_guide_snapshots
      (clinic_id, guide_id, revision, content_encrypted, content_sha256, tiss_version, terminology_version, created_via)
      values (${A.clinicId}::uuid, ${gr.id}::uuid, 1, ${CIPHER}, ${HASH('e')}, '4.03.00', '202609', 'automation') returning id`,
  );
  const [verRow] = await sql`select version from public.hi_guides where id = ${gr.id}::uuid`;
  const vr = verRow!.version as number;
  const approvals = await Promise.all(
    Array.from({ length: 12 }, () =>
      asTenant(
        A.clinicId,
        (
          tx,
        ) => tx`update public.hi_guides set status = 'approved', approved_snapshot_id = ${snapR!.id}::uuid,
          approved_by = ${A.doctorId}::uuid
        where id = ${gr.id}::uuid and status = 'reviewed' and version = ${vr} returning id`,
      ),
    ),
  );
  assert.equal(approvals.filter((r) => r.length === 1).length, 1);
  pass(
    'aprovação concorrente com versão (concorrência otimista): 12 tentativas, 1 vence, nenhuma erra o estado',
  );

  // ── Reabertura (nova revisão) ────────────────────────────────────────
  await rejects(
    '23514',
    () =>
      asTenant(
        A.clinicId,
        (tx) =>
          tx`update public.hi_guides set status = 'ready_for_review' where id = ${gc.id}::uuid`,
      ),
    /motivo/u,
  );
  await asTenant(
    A.clinicId,
    (tx) => tx`update public.hi_guides set status = 'ready_for_review',
      transition_note = 'Data do atendimento corrigida na recepção' where id = ${gc.id}::uuid`,
    A.doctorId,
  );
  const [reopened] =
    await sql`select revision, approved_snapshot_id, reviewed_by from public.hi_guides where id = ${gc.id}::uuid`;
  assert.deepEqual(
    [reopened!.revision, reopened!.approved_snapshot_id, reopened!.reviewed_by],
    [2, null, null],
  );
  await asTenant(
    A.clinicId,
    (tx) =>
      tx`update public.hi_guide_items set executed_on = '2026-11-11' where guide_id = ${gc.id}::uuid`,
  );
  const snap2 = await approve(A, gc.id, 15000, A.doctorId);
  const snaps =
    await sql`select id, revision from public.hi_guide_snapshots where guide_id = ${gc.id}::uuid order by revision`;
  assert.deepEqual(
    snaps.map((s) => [s.id, s.revision]),
    [
      [snap1, 1],
      [snap2, 2],
    ],
  );
  pass(
    'reabertura: exige motivo, abre a revisão 2, limpa conferência e aprovação; a revisão 1 fica no snapshot',
  );

  // ── Append-only e histórico do banco ─────────────────────────────────
  await rejects('42501', () =>
    asTenant(
      A.clinicId,
      (tx) =>
        tx`update public.hi_guide_snapshots set content_sha256 = ${HASH('f')} where id = ${snap1}::uuid`,
    ),
  );
  await rejects(
    '55000',
    () =>
      sql`update public.hi_guide_snapshots set content_sha256 = ${HASH('f')} where id = ${snap1}::uuid`,
  );
  await rejects('42501', () =>
    asTenant(
      A.clinicId,
      (tx) => tx`delete from public.hi_guide_snapshots where id = ${snap1}::uuid`,
    ),
  );
  await rejects('42501', () =>
    asTenant(
      A.clinicId,
      (
        tx,
      ) => tx`insert into public.hi_guide_events (clinic_id, guide_id, to_status, revision, actor_kind)
      values (${A.clinicId}::uuid, ${gc.id}::uuid, 'paid', 1, 'system')`,
    ),
  );
  await rejects(
    '55000',
    () => sql`update public.hi_guide_events set to_status = 'paid' where guide_id = ${gc.id}::uuid`,
  );
  const events =
    await sql`select from_status, to_status, revision, changed_fields, note from public.hi_guide_events
    where guide_id = ${gc.id}::uuid order by created_at, revision`;
  const reopenEv = events.find(
    (e) => e.from_status === 'approved' && e.to_status === 'ready_for_review',
  );
  assert.ok(reopenEv);
  assert.equal(reopenEv!.note, 'Data do atendimento corrigida na recepção');
  const allFields = events.flatMap((e) => e.changed_fields as string[]);
  assert.ok(allFields.every((f) => /^[a-z_]+$/u.test(f)));
  assert.ok(!JSON.stringify(events).includes(CIPHER));
  pass(
    'snapshot e histórico append-only (nem o dono altera); histórico só pelo banco, com nomes de campos e nunca valores',
  );

  // ── Cancelamento ─────────────────────────────────────────────────────
  await rejects('23514', () =>
    asTenant(
      A.clinicId,
      (tx) =>
        tx`update public.hi_guides set status = 'cancelled', cancelled_by = ${A.doctorId}::uuid where id = ${gc.id}::uuid`,
    ),
  );
  await asTenant(
    A.clinicId,
    (tx) => tx`update public.hi_guides set status = 'cancelled', cancelled_by = ${A.doctorId}::uuid,
    cancel_reason = 'Atendimento lançado como convênio por engano' where id = ${gc.id}::uuid`,
    A.doctorId,
  );
  const [itemLive] =
    await sql`select bool_or(live) as any_live from public.hi_guide_items where guide_id = ${gc.id}::uuid`;
  assert.equal(itemLive!.any_live, false);
  await asTenant(A.clinicId, (tx) =>
    newItem(tx, A, {
      guideId: gc2.id,
      appointmentId: ap[5]!,
      contractId: consulta,
      code: '10101012',
      cents: 15000,
    }),
  );
  await rejects('55000', () =>
    asTenant(
      A.clinicId,
      (tx) => tx`update public.hi_guides set status = 'ready_for_review' where id = ${gc.id}::uuid`,
    ),
  );
  pass('cancelamento: exige motivo, é final e libera o atendimento para uma guia nova');

  // ── Substituição ─────────────────────────────────────────────────────
  const orig = await asTenant(A.clinicId, (tx) =>
    newGuide(tx, A, { patientId: patA, membershipId: cardA, key: 'original:1' }),
  );
  const apSub = await createAppointment(A, patA);
  await asTenant(A.clinicId, (tx) =>
    newItem(tx, A, {
      guideId: orig.id,
      appointmentId: apSub,
      contractId: consulta,
      code: '10101012',
      cents: 15000,
    }),
  );
  await approve(A, orig.id, 15000, A.doctorId);
  await rejects(
    '55000',
    () =>
      asTenant(A.clinicId, (tx) =>
        newGuide(tx, A, { patientId: patA, membershipId: cardA, replaces: orig.id }),
      ),
    /substitui/u,
  );
  await ownerAdvance(orig.id, ['in_batch', 'exported', 'sent']);
  await rejects('55000', () =>
    asTenant(
      A.clinicId,
      (
        tx,
      ) => tx`update public.hi_guides set status = 'cancelled', cancelled_by = ${A.doctorId}::uuid,
      cancel_reason = 'Tentativa de cancelar depois de enviada' where id = ${orig.id}::uuid`,
    ),
  );
  await rejects('23514', () =>
    asTenant(A.clinicId, (tx) =>
      newGuide(tx, A, { patientId: patA2, membershipId: cardA2, replaces: orig.id }),
    ),
  );
  await rejects('23503', () =>
    asTenant(A.clinicId, (tx) =>
      newGuide(tx, A, { patientId: patA, insurerId: A.insurer2Id, replaces: orig.id }),
    ),
  );
  const sub = await asTenant(
    A.clinicId,
    (tx) =>
      newGuide(tx, A, {
        patientId: patA,
        membershipId: cardA,
        replaces: orig.id,
        key: 'substituta:1',
      }),
    A.doctorId,
  );
  assert.equal(sub.live, false);
  const [subItem] = await asTenant(A.clinicId, (tx) =>
    newItem(tx, A, {
      guideId: sub.id,
      appointmentId: apSub,
      contractId: consulta,
      code: '10101012',
      cents: 15000,
    }),
  );
  assert.equal(subItem!.live, false);
  await rejects('23505', () =>
    asTenant(A.clinicId, (tx) =>
      newGuide(tx, A, { patientId: patA, membershipId: cardA, replaces: orig.id }),
    ),
  );
  await rejects('55000', () =>
    asTenant(
      A.clinicId,
      (tx) => tx`update public.hi_guides set status = 'replaced' where id = ${orig.id}::uuid`,
    ),
  );
  await approve(A, sub.id, 15000, A.doctorId);
  const pair =
    await sql`select id, status, live from public.hi_guides where id in (${orig.id}::uuid, ${sub.id}::uuid)`;
  const byId = new Map(pair.map((r) => [r.id as string, r]));
  assert.deepEqual([byId.get(orig.id)!.status, byId.get(orig.id)!.live], ['replaced', false]);
  assert.deepEqual([byId.get(sub.id)!.status, byId.get(sub.id)!.live], ['approved', true]);
  const livePerAp =
    await sql`select count(*)::int as n from public.hi_guide_items where appointment_id = ${apSub}::uuid and live`;
  assert.equal(livePerAp[0]!.n, 1);
  const [origEv] = await sql`select from_status, to_status, actor_id from public.hi_guide_events
    where guide_id = ${orig.id}::uuid and to_status = 'replaced'`;
  assert.deepEqual([origEv!.from_status, origEv!.actor_id], ['sent', A.doctorId]);
  pass(
    'substituição: só de guia exportada/enviada; mesmo paciente e operadora; uma por vez; a substituta em rascunho não segura o atendimento; aprovar a substituta encerra a original na mesma transação',
  );

  // ── Arquivos gerados ─────────────────────────────────────────────────
  const fileRef = () => `${A.clinicId}/${randomUUID()}`;
  const newFile = (
    tx: Sql,
    g: {
      guideId?: string | null;
      snapshotId?: string | null;
      authId?: string | null;
      kind?: string;
      supersedes?: string | null;
      ref?: string;
      media?: string;
    },
  ) =>
    tx`insert into public.hi_files
        (clinic_id, kind, guide_id, snapshot_id, authorization_id, supersedes_file_id, storage_ref, content_sha256,
         ciphertext_sha256, size_bytes, media_type, tiss_version, created_via)
      values (${A.clinicId}::uuid, ${g.kind ?? 'guide_pdf'}, ${g.guideId ?? null}, ${g.snapshotId ?? null},
        ${g.authId ?? null}, ${g.supersedes ?? null}, ${g.ref ?? fileRef()}, ${HASH('7')}, ${HASH('8')}, 2048,
        ${g.media ?? 'application/pdf'}, '4.03.00', 'automation')
      returning id`;
  await rejects('55000', () =>
    asTenant(A.clinicId, (tx) => newFile(tx, { guideId: gs.id, snapshotId: snap1 })),
  );
  const [subSnap] =
    await sql`select approved_snapshot_id as s from public.hi_guides where id = ${sub.id}::uuid`;
  await rejects('23503', () =>
    asTenant(A.clinicId, (tx) => newFile(tx, { guideId: sub.id, snapshotId: snap1 })),
  );
  const [f1] = await asTenant(A.clinicId, (tx) =>
    newFile(tx, { guideId: sub.id, snapshotId: subSnap!.s }),
  );
  const [f2] = await asTenant(A.clinicId, (tx) =>
    newFile(tx, { guideId: sub.id, snapshotId: subSnap!.s, supersedes: f1!.id }),
  );
  await rejects('23505', () =>
    asTenant(A.clinicId, (tx) =>
      newFile(tx, { guideId: sub.id, snapshotId: subSnap!.s, supersedes: f1!.id }),
    ),
  );
  await rejects('23514', () =>
    asTenant(A.clinicId, (tx) =>
      newFile(tx, {
        kind: 'authorization_request_xml',
        guideId: sub.id,
        snapshotId: subSnap!.s,
        media: 'application/xml',
      }),
    ),
  );
  await rejects('23514', () =>
    asTenant(A.clinicId, (tx) =>
      newFile(tx, { guideId: sub.id, snapshotId: subSnap!.s, ref: 'publico/arquivo.pdf' }),
    ),
  );
  await asTenant(A.clinicId, (tx) =>
    newFile(tx, {
      kind: 'authorization_request_xml',
      authId: authSadt!.id,
      media: 'application/xml',
    }),
  );
  await rejects('42501', () =>
    asTenant(
      A.clinicId,
      (tx) => tx`update public.hi_files set size_bytes = 1 where id = ${f2!.id}::uuid`,
    ),
  );
  await rejects(
    '55000',
    () => sql`update public.hi_files set size_bytes = 1 where id = ${f2!.id}::uuid`,
  );
  pass(
    'arquivo: PDF oficial só de guia aprovada e do snapshot dela; versões em cadeia linear, sem sobrescrita; referência opaca; append-only',
  );

  // ── Funções e retenção ───────────────────────────────────────────────
  const fns = [
    'hi_guide_transition',
    'hi_guide_refs',
    'hi_guide_apply_replacement',
    'hi_guide_record_event',
    'hi_guard_guide_item',
    'hi_guard_guide_snapshot',
    'hi_guard_file',
  ];
  for (const fn of fns) {
    const [r] =
      await sql`select has_function_privilege('authenticated', ${`public.${fn}()`}, 'EXECUTE') as x,
      has_function_privilege('anon', ${`public.${fn}()`}, 'EXECUTE') as y`;
    assert.deepEqual([r!.x, r!.y], [false, false], fn);
  }
  pass('funções de gatilho da 0147 sem EXECUTE para authenticated e anon');

  await rejects('23503', () => sql`delete from public.patients where id = ${patA}::uuid`);
  pass('retenção: paciente com guia não é excluído (a guia não some com a exclusão do paciente)');

  await sql`delete from public.clinics where id = ${A.clinicId}::uuid`;
  const [left] = await sql`select
      (select count(*)::int from public.hi_guides where clinic_id = ${A.clinicId}::uuid) +
      (select count(*)::int from public.hi_guide_items where clinic_id = ${A.clinicId}::uuid) +
      (select count(*)::int from public.hi_guide_snapshots where clinic_id = ${A.clinicId}::uuid) +
      (select count(*)::int from public.hi_guide_events where clinic_id = ${A.clinicId}::uuid) +
      (select count(*)::int from public.hi_files where clinic_id = ${A.clinicId}::uuid) as n`;
  assert.equal(left!.n, 0);
  const [others] =
    await sql`select count(*)::int as n from public.hi_memberships where clinic_id = ${B.clinicId}::uuid and id = ${cardB}::uuid`;
  assert.equal(others!.n, 1);
  pass(
    'excluir a clínica remove guias, itens, snapshots, histórico e arquivos dela (mesmo aprovados) e não toca nas outras',
  );

  console.log(`OK: ${passed} provas da migration 0147 (P1.8) sobre o schema real`);
} finally {
  await cluster.stop();
}
