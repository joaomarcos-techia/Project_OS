/**
 * Convênios (P4.6, D11): prova dos AJUSTES da Guia de Consulta antes da aprovação, sobre o
 * schema real com a 0161, o `withTenant` real, a cifra real (chave mestra sintética) e o leitor
 * auditado real.
 *
 * Confere: a coluna nasce nula; o CHECK recusa chave desconhecida, formato errado, valor que não
 * é texto, objeto vazio, observação vazia ou longa e ajuste em SP/SADT; o serviço grava o ajuste
 * normalizado com a guia em edição, com histórico (só o NOME do campo) e sem versão nova quando
 * nada muda; recusa versão velha, código fora da tabela, fora da vigência e caractere fora do
 * ISO-8859-1 sem tocar na guia; outra clínica não altera (RLS); depois da conferência o ajuste
 * não muda nem pelo serviço, nem pelo runtime, nem pelo superusuário (gatilho); a emissão usa o
 * ajuste e, sem ajuste, os padrões; reabrir volta a permitir o ajuste e a revisão 2 sai com o
 * conteúdo novo.
 *
 * Não toca DEV nem produção. Uso:
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-consulta-overrides-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { startScratchSchema, grantPaidSubscription, credentialAllPlans } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55543);
const cluster = await startScratchSchema({ port: PORT, maxConnections: 16 });
const { sql } = cluster;
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
// Chave mestra SINTÉTICA, só para este cluster local (mesmo padrão de guide-issuance-db.ts).
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');
if (!new RegExp(`@(?:127\\.0\\.0\\.1|localhost):${PORT}/`, 'u').test(cluster.url))
  throw new Error('não é o cluster local');

const { withTenant } = await import('../../src/lib/db/tenant');
const { createConsultaGuideForAppointment } =
  await import('../../src/contexts/health-insurance/internal/consulta-guide-service');
const { issueConsultaGuide } =
  await import('../../src/contexts/health-insurance/internal/guide-issuance');
const { updateConsultaOverridesInTx, ConsultaOverridesError } =
  await import('../../src/contexts/health-insurance/internal/consulta-overrides-service');
const { readGuidesAsSystem } =
  await import('../../src/contexts/health-insurance/internal/guide-access');

const SYS = '00000000-0000-0000-0000-0000000000aa';
const CARD = '0081234500012345'; // sintético
let passed = 0;
const pass = (msg: string): void => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};
let slot = 0;

type PgErr = { code?: string; constraint_name?: string; message?: string };
const pgErr = (e: unknown): PgErr => {
  const err = e as PgErr & { cause?: PgErr };
  return err.code ? err : (err.cause ?? {});
};

async function setup(label: string) {
  const clinicId = randomUUID();
  const doctorId = randomUUID();
  await sql`insert into auth.users (id, email) values (${doctorId}::uuid, ${`${doctorId}@example.invalid`})`;
  await sql`insert into public.clinics (id, slug, nome, status)
    values (${clinicId}::uuid, ${`co-${clinicId.slice(0, 8)}`}, ${`Clínica ${label}`}, 'active')`;
  await grantPaidSubscription(sql, clinicId);
  await sql`insert into public.profiles (id, clinic_id, nome, role, ativo)
    values (${doctorId}::uuid, ${clinicId}::uuid, 'Dra. Sintética', 'doctor', true)`;
  await sql`insert into public.hi_clinic_settings (clinic_id, enabled, enabled_at, enabled_by, provider_kind, cnes_status)
    values (${clinicId}::uuid, true, now(), ${SYS}::uuid, 'PJ', 'none_declared')`;
  const [ins] = await sql`insert into public.hi_insurers
      (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, status, created_by)
    values (${clinicId}::uuid, 'Operadora Um', '123456', 'codigoPrestadorNaOperadora', 'TESTE001', 'active', ${SYS}::uuid) returning id`;
  await credentialAllPlans(sql, clinicId);
  await sql`insert into public.hi_professional_profiles (clinic_id, professional_id, council, council_number, council_uf, cbo)
    values (${clinicId}::uuid, ${doctorId}::uuid, '06', '12345', '35', '225125')`;
  const [proc] =
    await sql`insert into public.procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
    values (${clinicId}::uuid, 'CONS', 'Consulta sintética', 150, 30, true) returning id`;
  await sql`insert into public.hi_procedure_contracts
      (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id, unit_value_cents, valid_from, created_by)
    values (${clinicId}::uuid, ${ins!.id}::uuid, 'consulta', '22', '10101012', 'Consulta em consultório', ${proc!.id}::uuid,
      15000, '2026-01-01', ${SYS}::uuid)`;
  const [pt] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
    values (${clinicId}::uuid, 'Paciente Sintético', 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`;
  const [card] = await sql`insert into public.hi_memberships
      (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
    values (${clinicId}::uuid, ${pt!.id}::uuid, ${ins!.id}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${'d'.repeat(64)}, '2345', ${SYS}::uuid)
    returning id`;
  /** Guia nova em "pronta para conferência" (sem conferir). */
  const newGuide = async (date: string) => {
    slot += 1;
    const [a] = await sql`insert into public.appointments (
        clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
        snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via)
      values (${clinicId}::uuid, ${doctorId}::uuid, ${pt!.id}::uuid, ${proc!.id}::uuid,
        ${`${date}T13:00:00Z`}::timestamptz + ${slot} * interval '1 minute', 30, 'atendido', 150,
        'Consulta', 150, 30, 'Dra. Sintética', 'attendant') returning id`;
    const out = await withTenant(clinicId, (tx) =>
      createConsultaGuideForAppointment(tx, {
        clinicId,
        appointment: {
          id: a!.id as string,
          patientId: pt!.id as string,
          professionalId: doctorId,
          procedureId: proc!.id as string,
          date,
          billingMode: 'convenio',
        },
        coverage: { insurerId: ins!.id as string, planId: null, membershipId: card!.id as string },
        terminologyVersion: '202609',
        actor: { kind: 'automation' },
      }),
    );
    assert.equal(out.kind, 'created');
    assert.equal((out as { status: string }).status, 'ready_for_review');
    return (out as { guideId: string }).guideId;
  };
  return {
    clinicId,
    doctorId,
    insurerId: ins!.id as string,
    patientId: pt!.id as string,
    membershipId: card!.id as string,
    newGuide,
  };
}
type Clinic = Awaited<ReturnType<typeof setup>>;

/** Como o runtime: papel `authenticated` com a clínica da sessão. */
const asRuntime = <T>(clinicId: string, fn: (tx: typeof sql) => Promise<T>): Promise<T> =>
  sql.begin(async (tx) => {
    await tx.unsafe('SET LOCAL ROLE authenticated');
    await tx`select set_config('app.current_clinic', ${clinicId}, true)`;
    return fn(tx as unknown as typeof sql);
  }) as Promise<T>;

const review = (c: Clinic, guideId: string) =>
  asRuntime(
    c.clinicId,
    (tx) =>
      tx`update public.hi_guides set status = 'reviewed', reviewed_by = ${c.doctorId}::uuid where id = ${guideId}::uuid`,
  );
const edit = (c: Clinic, guideId: string, version: number, input: Record<string, string | null>) =>
  withTenant(
    c.clinicId,
    (tx) => updateConsultaOverridesInTx(tx, { clinicId: c.clinicId, guideId, version, input }),
    c.doctorId,
  );
const issue = (c: Clinic, guideId: string) =>
  withTenant(
    c.clinicId,
    (tx) =>
      issueConsultaGuide(tx, {
        clinicId: c.clinicId,
        guideId,
        card: {
          membershipId: c.membershipId,
          cardNumber: CARD,
          auditEventId: 'leitura-auditada-simulada',
        },
        newborn: false,
        professionalName: 'Dra. Sintética',
        actorUserId: c.doctorId,
        today: '2026-12-31',
      }),
    c.doctorId,
  );
const issuedData = async (clinicId: string, guideId: string) => {
  const [read] = await readGuidesAsSystem({
    clinicId,
    guideIds: [guideId],
    operation: 'operator_integration',
    service: 'insurance-connector',
    jobId: randomUUID(),
  });
  return read!.content.data as {
    indicacaoAcidente: string;
    observacao: string | null;
    atendimento: {
      regimeAtendimento: string;
      tipoConsulta: string;
      coberturaEspecial: string | null;
      saudeOcupacional: string | null;
    };
  };
};
const state = async (guideId: string) => {
  const [r] = await sql<
    { version: number; overrides: Record<string, string> | null; status: string }[]
  >`
    select version, consulta_overrides as overrides, status from public.hi_guides where id = ${guideId}::uuid`;
  return r!;
};

try {
  await sql`GRANT SELECT ON public.clinics TO authenticated`; // padrão do Supabase (ver health-insurance-coverage-db.ts)
  const [tv] =
    await sql`insert into public.tiss_terminology_versions (version, archive_url, archive_sha256, manifest_sha256)
    values ('202609', 'https://example.invalid/tuss.zip', ${'a'.repeat(64)}, ${'b'.repeat(64)}) returning id`;
  await sql`insert into public.tiss_terms (version_id, table_code, code, term, starts_on)
    values (${tv!.id}::uuid, '22', '10101012', 'Consulta em consultório (no horário normal ou preestabelecido)', '2010-01-01'),
           (${tv!.id}::uuid, '24', '225125', 'Médico clínico', '2010-01-01'),
           (${tv!.id}::uuid, '26', '06', 'Conselho Regional de Medicina (CRM)', '2010-01-01'),
           (${tv!.id}::uuid, '36', '0', 'Acidente de trabalho', '2010-01-01'),
           (${tv!.id}::uuid, '36', '1', 'Acidente de trânsito', '2010-01-01'),
           (${tv!.id}::uuid, '36', '2', 'Outros acidentes', '2010-01-01'),
           (${tv!.id}::uuid, '36', '9', 'Não acidente', '2010-01-01'),
           (${tv!.id}::uuid, '52', '1', 'Primeira consulta', '2010-01-01'),
           (${tv!.id}::uuid, '52', '2', 'Retorno', '2010-01-01'),
           (${tv!.id}::uuid, '52', '3', 'Pré-natal', '2010-01-01'),
           (${tv!.id}::uuid, '52', '4', 'Por encaminhamento', '2010-01-01'),
           (${tv!.id}::uuid, '59', '35', 'São Paulo', '2010-01-01'),
           (${tv!.id}::uuid, '75', '01', 'Atendimento a RN', '2010-01-01'),
           (${tv!.id}::uuid, '76', '01', 'Ambulatorial', '2010-01-01'),
           (${tv!.id}::uuid, '76', '02', 'Emergência', '2010-01-01'),
           (${tv!.id}::uuid, '76', '05', 'Termo sintético que só começa em 2027', '2027-01-01'),
           (${tv!.id}::uuid, '77', '02', 'Exame periódico', '2010-01-01'),
           (${tv!.id}::uuid, '87', '22', 'Procedimentos e eventos em saúde', '2010-01-01')`;
  const A = await setup('A');
  const B = await setup('B');

  // ── 1. A 0161 no schema ───────────────────────────────────────────────
  const g1 = await A.newGuide('2026-11-10');
  const s0 = await state(g1);
  assert.equal(s0.overrides, null);
  const [{ n: trig }] = (await sql`select count(*)::int as n from pg_trigger
    where tgname = 'hi_guides_ab_consulta_overrides' and not tgisinternal`) as unknown as [
    { n: number },
  ];
  assert.equal(trig, 1);
  const [{ ok: granted }] =
    (await sql`select has_column_privilege('authenticated', 'public.hi_guides', 'consulta_overrides', 'UPDATE') as ok`) as unknown as [
      { ok: boolean },
    ];
  assert.equal(granted, true);
  pass('0161: a coluna nasce nula, o gatilho existe e o runtime tem UPDATE só nessa coluna nova');

  // ── 2. CHECK do banco ────────────────────────────────────────────────
  const refusedByCheck = async (value: unknown, label: string) => {
    await assert.rejects(
      () =>
        sql`update public.hi_guides set consulta_overrides = ${sql.json(value as never)} where id = ${g1}::uuid`,
      (e: unknown) => {
        const pe = pgErr(e);
        return pe.code === '23514' && pe.constraint_name === 'hi_guides_consulta_overrides_chk';
      },
      label,
    );
  };
  await refusedByCheck({ regime: '01' }, 'chave desconhecida');
  await refusedByCheck({ regimeAtendimento: '1' }, 'regime com 1 dígito');
  await refusedByCheck({ tipoConsulta: 4 }, 'número em vez de texto');
  await refusedByCheck({ coberturaEspecial: null }, 'nulo explícito');
  await refusedByCheck({}, 'objeto vazio');
  await refusedByCheck({ observacao: '   ' }, 'observação só com espaços');
  await refusedByCheck({ observacao: 'a'.repeat(501) }, 'observação longa');
  await refusedByCheck(['01'], 'lista em vez de objeto');
  await assert.rejects(
    () => sql`insert into public.hi_guides
        (clinic_id, guide_type, number, insurer_id, patient_id, status, idempotency_key, created_via, consulta_overrides)
      values (${A.clinicId}::uuid, 'sp_sadt', 'SADT9', ${A.insurerId}::uuid, ${A.patientId}::uuid, 'pending_data',
        ${`teste:${randomUUID()}`}, 'automation', ${sql.json({ tipoConsulta: '1' })})`,
    (e: unknown) => pgErr(e).constraint_name === 'hi_guides_consulta_overrides_chk',
  );
  assert.equal((await state(g1)).overrides, null);
  pass(
    'CHECK: recusa chave desconhecida, formato fora do XSD, valor que não é texto, nulo explícito, objeto vazio, observação vazia ou com mais de 500 caracteres, lista e ajuste em guia SP/SADT',
  );

  // ── 3. Serviço: grava normalizado, com histórico e sem versão inútil ──
  const v1 = s0.version;
  const saved = await edit(A, g1, v1, {
    regimeAtendimento: '02',
    indicacaoAcidente: '1',
    tipoConsulta: '4',
    coberturaEspecial: '01',
    saudeOcupacional: '02',
    observacao: '  Encaminhado pela UBS.  ',
  });
  const s1 = await state(g1);
  assert.deepEqual(s1.overrides, {
    regimeAtendimento: '02',
    indicacaoAcidente: '1',
    tipoConsulta: '4',
    coberturaEspecial: '01',
    saudeOcupacional: '02',
    observacao: 'Encaminhado pela UBS.',
  });
  assert.deepEqual(
    [saved.changed, saved.version, s1.version, s1.status],
    [true, v1 + 1, v1 + 1, 'ready_for_review'],
  );
  const events = await sql<
    { changed_fields: string[]; actor_id: string | null; actor_kind: string; dump: string }[]
  >`
    select changed_fields, actor_id::text, actor_kind, to_jsonb(e)::text as dump
      from public.hi_guide_events e where guide_id = ${g1}::uuid order by created_at desc, id desc`;
  assert.deepEqual(events[0]!.changed_fields, ['consulta_overrides']);
  assert.deepEqual([events[0]!.actor_id, events[0]!.actor_kind], [A.doctorId, 'user']);
  assert.ok(
    events.every((e) => !e.dump.includes('UBS')),
    'o histórico guarda só o nome do campo',
  );
  const again = await edit(A, g1, v1 + 1, {
    tipoConsulta: '4',
    observacao: 'Encaminhado pela UBS.',
    saudeOcupacional: '02',
    coberturaEspecial: '01',
    indicacaoAcidente: '1',
    regimeAtendimento: '02',
  });
  const [{ n: evCount }] =
    (await sql`select count(*)::int as n from public.hi_guide_events where guide_id = ${g1}::uuid`) as unknown as [
      { n: number },
    ];
  assert.deepEqual(
    [again.changed, again.version, (await state(g1)).version, evCount],
    [false, v1 + 1, v1 + 1, events.length],
  );
  pass(
    'serviço: com a guia em edição grava o ajuste normalizado (espaços fora), uma versão nova e um evento com só o NOME do campo e quem ajustou; salvar o mesmo conteúdo não gera versão nem evento',
  );

  // ── 4. Serviço: recusas sem tocar na guia ─────────────────────────────
  const refused = async (
    version: number,
    input: Record<string, string>,
    kind: string,
    text: string,
  ) => {
    await assert.rejects(
      () => edit(A, g1, version, input),
      (e: unknown) =>
        e instanceof ConsultaOverridesError && e.kind === kind && e.message.includes(text),
    );
  };
  await refused(v1, { tipoConsulta: '1' }, 'conflict', 'mudou desde que a tela foi aberta');
  await refused(v1 + 1, { tipoConsulta: '7' }, 'invalid', 'não está na tabela 52');
  await refused(v1 + 1, { regimeAtendimento: '05' }, 'invalid', 'não estava vigente');
  await refused(v1 + 1, { observacao: 'Paciente 🙂' }, 'invalid', 'ISO-8859-1');
  const s2 = await state(g1);
  assert.deepEqual([s2.version, s2.overrides], [s1.version, s1.overrides]);
  pass(
    'serviço: versão velha (outra pessoa mexeu), código fora da tabela 52, código fora da vigência na data do atendimento e emoji na observação são recusados com mensagem, e a guia fica como estava',
  );

  // ── 4b. Duas pessoas salvando ao mesmo tempo (P14.2) ─────────────────
  const gC = await A.newGuide('2026-11-12');
  const vC = (await state(gC)).version;
  const racing = await Promise.allSettled([
    edit(A, gC, vC, { tipoConsulta: '3' }),
    edit(A, gC, vC, { tipoConsulta: '4' }),
    edit(A, gC, vC, { regimeAtendimento: '02' }),
  ]);
  const wonC = racing.filter((r) => r.status === 'fulfilled');
  const lostC = racing.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));
  assert.equal(wonC.length, 1, `vencedoras: ${wonC.length}`);
  for (const e of lostC) {
    assert.ok(
      e instanceof ConsultaOverridesError && e.kind === 'conflict',
      `quem perde recebe conflito com mensagem, não erro cru (${pgErr(e).code ?? ''}: ${(e as Error).message})`,
    );
  }
  assert.equal((await state(gC)).version, vC + 1);
  pass(
    `três salvamentos simultâneos com a mesma versão: 1 grava, ${lostC.length} recebem "a guia mudou desde que a tela foi aberta"; uma versão nova só`,
  );

  // ── 5. Outra clínica não altera ──────────────────────────────────────
  const touched = await asRuntime(
    B.clinicId,
    (tx) =>
      tx`update public.hi_guides set consulta_overrides = ${sql.json({ tipoConsulta: '1' })} where id = ${g1}::uuid returning id`,
  );
  assert.equal(touched.length, 0);
  await assert.rejects(
    () => edit(B, g1, s2.version, { tipoConsulta: '1' }),
    (e: unknown) => e instanceof ConsultaOverridesError && e.kind === 'not_found',
  );
  assert.deepEqual((await state(g1)).overrides, s1.overrides);
  pass(
    'outra clínica: o UPDATE direto não acha a guia (RLS) e o serviço responde "guia inexistente"; nada muda',
  );

  // ── 6. Depois da conferência, o ajuste congela ───────────────────────
  await review(A, g1);
  const sR = await state(g1);
  await assert.rejects(
    () => edit(A, g1, sR.version, { tipoConsulta: '1' }),
    (e: unknown) => e instanceof ConsultaOverridesError && e.kind === 'not_editable',
  );
  await assert.rejects(
    () =>
      asRuntime(
        A.clinicId,
        (tx) => tx`update public.hi_guides set consulta_overrides = null where id = ${g1}::uuid`,
      ),
    (e: unknown) =>
      pgErr(e).code === '55000' && /devolva para correção/u.test(pgErr(e).message ?? ''),
  );
  await assert.rejects(
    () =>
      sql`update public.hi_guides set consulta_overrides = ${sql.json({ tipoConsulta: '1' })} where id = ${g1}::uuid`,
    (e: unknown) => pgErr(e).code === '55000',
  );
  assert.deepEqual((await state(g1)).overrides, s1.overrides);
  pass(
    'conferida: o serviço recusa ("devolva para correção"), e o gatilho da 0161 recusa o UPDATE do runtime e até o do superusuário (55000); o ajuste continua o mesmo',
  );

  // ── 7. A emissão usa o ajuste; sem ajuste, os padrões ────────────────
  await issue(A, g1);
  const d1 = await issuedData(A.clinicId, g1);
  assert.deepEqual(
    [
      d1.atendimento.regimeAtendimento,
      d1.indicacaoAcidente,
      d1.atendimento.tipoConsulta,
      d1.atendimento.coberturaEspecial,
      d1.atendimento.saudeOcupacional,
      d1.observacao,
    ],
    ['02', '1', '4', '01', '02', 'Encaminhado pela UBS.'],
  );
  const g2 = await A.newGuide('2026-11-11');
  await review(A, g2);
  await issue(A, g2);
  const d2 = await issuedData(A.clinicId, g2);
  assert.deepEqual(
    [
      d2.atendimento.regimeAtendimento,
      d2.indicacaoAcidente,
      d2.atendimento.tipoConsulta,
      d2.atendimento.coberturaEspecial,
      d2.atendimento.saudeOcupacional,
      d2.observacao,
    ],
    ['01', '9', '1', null, null, null],
  );
  pass(
    'emissão: a guia ajustada sai com regime 02, acidente 1, tipo 4, cobertura 01, saúde ocupacional 02 e a observação; a guia sem ajuste sai com os padrões da D11 (01, 9, 1) e sem os opcionais',
  );

  // ── 8. Reabrir volta a permitir o ajuste; a revisão 2 sai com o novo ─
  await asRuntime(
    A.clinicId,
    (tx) =>
      tx`update public.hi_guides set status = 'ready_for_review', transition_note = 'Operadora pediu tipo de consulta 1' where id = ${g1}::uuid`,
  );
  const sO = await state(g1);
  await edit(A, g1, sO.version, {
    regimeAtendimento: '02',
    indicacaoAcidente: '1',
    tipoConsulta: '',
    coberturaEspecial: '01',
    saudeOcupacional: '02',
    observacao: 'Encaminhado pela UBS.',
  });
  assert.equal((await state(g1)).overrides?.tipoConsulta, undefined);
  await review(A, g1);
  const rev2 = await issue(A, g1);
  const d3 = await issuedData(A.clinicId, g1);
  const snaps = await sql<
    { revision: number }[]
  >`select revision from public.hi_guide_snapshots where guide_id = ${g1}::uuid order by revision`;
  assert.deepEqual(
    [
      rev2.revision,
      snaps.map((r) => r.revision),
      d3.atendimento.tipoConsulta,
      d3.atendimento.regimeAtendimento,
    ],
    [2, [1, 2], '1', '02'],
  );
  pass(
    'reaberta: o ajuste volta a ser editável (tipo de consulta de volta ao padrão), e a revisão 2 sai com o conteúdo novo; a revisão 1 continua no histórico',
  );

  console.log(
    `OK: ${passed} provas dos ajustes da Guia de Consulta (D11) sobre o schema real com a 0161`,
  );
} finally {
  await cluster.stop();
}
process.exit(0);
