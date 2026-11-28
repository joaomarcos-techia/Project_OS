/**
 * P11.2 — as cinco jornadas do agente de IA com Convênios PELA CONVERSA, contra o banco DESCARTÁVEL com todas as
 * migrations (dados sintéticos). Cada passo é uma mensagem do paciente que percorre o caminho real do turno:
 * `persistInbound` → `processInbound` (identidade pelo telefone, pré-filtro clínico, modelo, registro de ferramentas,
 * portão de confirmação, guarda de saída) → resposta gravada e enviada ao WhatsApp → estado no banco.
 *
 * O modelo tem roteiro FIXO (o `GeminiProvider` devolve as chamadas que ele faria): o que está sob teste é o servidor,
 * que é onde as regras vivem. A interpretação do Gemini de verdade não se prova com roteiro e fica para o E2E no
 * Preview com custo autorizado. Rede externa recusada; o envio ao WhatsApp é capturado (nada sai da máquina).
 *
 *   1. particular: resumo e confirmação sem nenhuma menção a convênio; atendimento particular, sem cobertura;
 *   2. convênio aceito: resumo com operadora e plano, sem sinal nem link; "SIM" → atendimento convênio pelo agente,
 *      cobertura de automação, "a recepção confere a carteirinha"; o handler REAL do pedido de sinal sai como
 *      inelegível (o particular segue elegível); nenhuma guia nem cobrança;
 *   3. convênio não aceito: operadora fora do cadastro → a lista do que a clínica agenda e a saída (particular ou
 *      recepção); com o módulo desligado em outra clínica → "é com a recepção". Nada preparado nem criado;
 *   4. dúvida de cobertura: o modelo tenta afirmar que o plano cobre → a guarda troca pela frase fixa (quem confirma é a
 *      operadora/recepção) e registra a falha; nada preparado nem criado;
 *   5. procedimento com autorização: o resumo avisa o aval da operadora; "SIM" → convênio SP/SADT pelo contrato, sem
 *      dizer que está autorizado; a pendência fica com a recepção (cobertura sem carteirinha);
 *   6. operadora que só o MODELO propôs (o paciente não falou de convênio): pergunta convênio ou particular, nada
 *      preparado; quando o paciente diz o nome, vale, e a origem da escolha fica gravada na ação preparada;
 *   7. o inverso: o paciente citou a operadora e o modelo preparou particular: pergunta antes (sem resumo nem sinal);
 *      com "particular", o resumo diz "como particular";
 *   8. em todas as mensagens enviadas: nada afirma cobertura, autorização, elegibilidade ou valor, nem pede o número da
 *      carteirinha; o que foi ao WhatsApp é o que ficou gravado; nenhuma rede externa.
 *
 *   SECURITY_PG_BIN=... PORT=55644 NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/agent-insurance-conversation-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { credentialAllPlans, grantPaidSubscription, startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55644);
const cluster = await startScratchSchema({ port: PORT, maxConnections: 12 });
const { sql } = cluster;
if (!new RegExp(`@(?:127\\.0\\.0\\.1|localhost):${PORT}/`, 'u').test(cluster.url))
  throw new Error('não é o cluster local');

// Só o processo de teste recebe a URL local e chaves sintéticas; nada do .env.local.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('DATABASE_URL')) delete process.env[key];
}
Object.assign(process.env, {
  DATABASE_URL: cluster.url,
  SUPABASE_PROJECT_ENV: 'dev',
  NEXT_PUBLIC_SUPABASE_URL: 'https://ci.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_ci',
  OUTBOX_CRON_ALLOW_NON_VERCEL: 'true',
  CRYPTO_SECRET_BACKEND: 'env',
  CRYPTO_MASTER_KEY_V1: Buffer.alloc(32, 7).toString('base64'),
  CRYPTO_LOOKUP_SALT: Buffer.alloc(32, 9).toString('base64'),
  MASTER_KEY_VERSION: '1',
  GEMINI_API_KEY: 'synthetic-provider-no-network',
  ASAAS_BASE_URL: 'https://sandbox.asaas.invalid/api/v3',
  LOG_LEVEL: 'error',
});

const { encryptForTenant, decryptForTenant, hashForLookup } = await import('../../src/lib/crypto');
const { GeminiProvider } = await import('../../src/lib/ai/gemini');
const { persistInbound } = await import('../../src/contexts/messaging/internal/inbound');
const { InboundReceivedSchema } = await import('../../src/contexts/messaging/events');
const { __testing__: inbound } =
  await import('../../src/contexts/ai-agent/internal/handlers/inbound-received');
const { AGENT_INSURANCE_TEXT, findUnsafeAgentClaims } =
  await import('../../src/contexts/health-insurance/agent-insurance');
type GenerateResult = import('../../src/lib/ai/provider').GenerateResult;
const { getHandler } = await import('../../src/lib/outbox/registry');
const { metrics } = await import('../../src/lib/observability/metrics');
const DEPOSIT_REQUESTED = 'scheduling.appointment.deposit_requested';
// O handler REAL do pedido de sinal (o mesmo que o cron do outbox registra).
if (!getHandler(DEPOSIT_REQUESTED))
  await import('../../src/contexts/payments/internal/handlers/appointment-deposit-requested');
const emitted: string[] = [];
const originalEmit = metrics.emit.bind(metrics);
metrics.emit = (event, fields) => {
  emitted.push(event);
  originalEmit(event, fields);
};

const SYS = '00000000-0000-0000-0000-0000000000aa';
let passed = 0;
const pass = (n: number, msg: string) => {
  passed += 1;
  console.log(`PASS ${n}: ${msg}`);
};

// ── modelo com roteiro e WhatsApp capturado ─────────────────────────────────────
const usage = { tokensInput: 1, tokensOutput: 1, model: 'gemini-3.6-flash' };
const toolCall = (name: string, args: object = {}): GenerateResult => ({
  toolCalls: [{ name, args }],
  usage,
});
const text = (t: string): GenerateResult => ({ text: t, usage });
let script: GenerateResult[] = [];
let modelCalls = 0;
let externalCalls = 0;
const sentToWhatsApp: string[] = [];
const originalGenerate = GeminiProvider.prototype.generateWithTools;
const originalFetch = globalThis.fetch;
GeminiProvider.prototype.generateWithTools = async () => {
  modelCalls += 1;
  // Roteiro esgotado = o modelo não teria mais o que fazer neste turno: uma frase neutra.
  return script.shift() ?? text('Certo.');
};
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== 'graph.facebook.com') {
    externalCalls += 1;
    throw new Error(`rede externa recusada no harness: ${url.hostname}`);
  }
  const body = JSON.parse(String(init?.body ?? '{}')) as { text?: { body?: string } };
  if (typeof body.text?.body === 'string') sentToWhatsApp.push(body.text.body);
  return new Response(JSON.stringify({ messages: [{ id: `wamid.synthetic.${randomUUID()}` }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

// ── clínicas, contatos e turnos ──────────────────────────────────────────────────
let phoneSeq = 0;
async function clinic(
  label: string,
  enabled: boolean,
  insurers: Array<{ name: string; status: string; plans?: string[] }>,
) {
  const clinicId = randomUUID();
  const doctorId = randomUUID();
  const metaPhoneId = `synthetic-meta-${randomUUID()}`;
  const clinicNumber = `55119${String(10_000_000 + Math.floor(Math.random() * 89_999_999))}`;
  await sql`insert into auth.users (id, email) values (${doctorId}::uuid, ${`${doctorId}@example.invalid`})`;
  await sql`insert into public.clinics (id, slug, nome, status)
    values (${clinicId}::uuid, ${`ag-conv-${clinicId.slice(0, 8)}`}, ${`Clínica ${label}`}, 'active')`;
  await grantPaidSubscription(sql, clinicId);
  await sql`insert into public.ai_clinic_config (clinic_id) values (${clinicId}::uuid)`;
  await sql`insert into public.clinic_whatsapp_numbers
      (clinic_id, provider, phone_number, meta_phone_id, token_encrypted, verified_at, active, connection_status)
    values (${clinicId}::uuid, 'meta', ${clinicNumber}, ${metaPhoneId},
      ${await encryptForTenant(clinicId, 'SYNTHETIC_TOKEN')}, now(), true, 'connected')`;
  await sql`insert into public.profiles (id, clinic_id, nome, role, ativo)
    values (${doctorId}::uuid, ${clinicId}::uuid, 'Dra. Sintética Conversa', 'doctor', true)`;
  // Agenda da médica: todos os dias, o dia inteiro (o horário da execução do CI não importa).
  for (let weekday = 0; weekday < 7; weekday++) {
    await sql`insert into public.doctor_availability (clinic_id, doctor_id, weekday, start_time, end_time)
      values (${clinicId}::uuid, ${doctorId}::uuid, ${weekday}, '00:00', '23:59')`;
  }
  await sql`insert into public.hi_clinic_settings (clinic_id, enabled, enabled_at, enabled_by, provider_kind, cnes_status)
    values (${clinicId}::uuid, ${enabled}, case when ${enabled}::boolean then now() end,
      ${enabled ? SYS : null}, 'PJ', 'none_declared')`;
  await sql`insert into public.hi_professional_profiles (clinic_id, professional_id, council, council_number, council_uf, cbo)
    values (${clinicId}::uuid, ${doctorId}::uuid, '06', '12345', '35', '225125')`;
  const proc = async (codigo: string, descricao: string) =>
    (
      await sql`insert into public.procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
        values (${clinicId}::uuid, ${codigo}, ${descricao}, 150, 30, true) returning id`
    )[0]!.id as string;
  const consulta = await proc('CONS', 'Consulta Sintética');
  const sessao = await proc('SESS', 'Sessão Sintética Programada');
  const insurerIds: Record<string, string> = {};
  const planIds: Record<string, string> = {};
  for (const ins of insurers) {
    const id = (
      await sql`insert into public.hi_insurers
          (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, status, created_by)
        values (${clinicId}::uuid, ${ins.name}, ${String(200000 + Object.keys(insurerIds).length)},
          'codigoPrestadorNaOperadora', 'TESTE001', ${ins.status}, ${SYS}::uuid) returning id`
    )[0]!.id as string;
    insurerIds[ins.name] = id;
    for (const p of ins.plans ?? []) {
      planIds[`${ins.name}/${p}`] = (
        await sql`insert into public.hi_plans (clinic_id, insurer_id, name, status)
          values (${clinicId}::uuid, ${id}::uuid, ${p}, 'active') returning id`
      )[0]!.id as string;
    }
    // Consulta: contrato vigente sem autorização. Sessão: SP/SADT com autorização prévia.
    await sql`insert into public.hi_procedure_contracts
        (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id,
         unit_value_cents, valid_from, requires_authorization, copay_kind, created_by)
      values (${clinicId}::uuid, ${id}::uuid, 'consulta', '22', '10101012', 'Consulta em consultório', ${consulta}::uuid,
         15000, '2026-01-01', false, 'none', ${SYS}::uuid),
        (${clinicId}::uuid, ${id}::uuid, 'sp_sadt', '22', '50000470', 'Sessão sintética', ${sessao}::uuid,
         10000, '2026-01-01', true, 'none', ${SYS}::uuid)`;
  }
  await credentialAllPlans(sql, clinicId);

  /** Paciente já cadastrado, reconhecido pelo telefone (o turno resolve a identidade pelo hash). */
  const contact = async (nome: string) => {
    phoneSeq += 1;
    const phone = `5511987${String(600_000 + phoneSeq).padStart(6, '0')}`;
    const cpf = `cpf-sintetico-${randomUUID()}`;
    const id = (
      await sql`insert into public.patients
          (clinic_id, nome, cpf_encrypted, cpf_hash, telefone_encrypted, telefone_hash)
        values (${clinicId}::uuid, ${nome}, ${await encryptForTenant(clinicId, cpf)}, ${await hashForLookup(cpf)},
          ${await encryptForTenant(clinicId, phone)}, ${await hashForLookup(phone)}) returning id`
    )[0]!.id as string;
    return { phone, patientId: id };
  };

  /** Uma mensagem do paciente, processada até o fim pelo turno real. */
  const say = async (phone: string, message: string, steps: GenerateResult[] = []) => {
    script = [...steps];
    const sentBefore = sentToWhatsApp.length;
    const providerMessageId = `wamid.local.${randomUUID()}`;
    await persistInbound(clinicId, 'meta', {
      providerMessageId,
      fromNumber: phone,
      toPhoneId: metaPhoneId,
      toNumber: clinicNumber,
      text: message,
      timestamp: String(Math.floor(Date.now() / 1000)),
    });
    const [event] = await sql`select id, payload from public.outbox
      where clinic_id = ${clinicId}::uuid and idempotency_key = ${`inbound:meta:${providerMessageId}`}`;
    assert.ok(event, 'evento do inbound');
    await inbound.processInbound({
      clinicId,
      payload: InboundReceivedSchema.parse(event.payload),
      eventId: String(event.id),
      attempt: 1,
    });
    const rows = await sql`select conversation_id::text as conversation, content_encrypted
      from public.ai_messages
      where clinic_id = ${clinicId}::uuid and event_id = ${String(event.id)}::uuid and direction = 'out'`;
    assert.equal(rows.length, 1, `uma resposta para "${message}"`);
    const reply = await decryptForTenant(clinicId, String(rows[0]!.content_encrypted));
    // O que foi ao WhatsApp é exatamente o que ficou gravado.
    assert.deepEqual(
      sentToWhatsApp.slice(sentBefore),
      [reply],
      'envio ao WhatsApp = resposta gravada',
    );
    script = [];
    return { reply, eventId: String(event.id), conversationId: String(rows[0]!.conversation) };
  };

  const counts = async () => {
    const [r] = await sql`select
        (select count(*)::int from public.appointments where clinic_id = ${clinicId}::uuid) as appointments,
        (select count(*)::int from public.ai_pending_actions where clinic_id = ${clinicId}::uuid and status = 'pending') as pending,
        (select count(*)::int from public.hi_appointment_coverages where clinic_id = ${clinicId}::uuid) as coverages,
        (select count(*)::int from public.hi_guides where clinic_id = ${clinicId}::uuid) as guides,
        (select count(*)::int from public.patient_charges where clinic_id = ${clinicId}::uuid) as charges`;
    return r as {
      appointments: number;
      pending: number;
      coverages: number;
      guides: number;
      charges: number;
    };
  };

  const lastAppointment = async (patientId: string) => {
    const [ap] =
      await sql`select id::text as id, billing_mode, created_via::text as via, procedure_id::text as procedure
      from public.appointments where clinic_id = ${clinicId}::uuid and patient_id = ${patientId}::uuid
      order by created_at desc limit 1`;
    return ap as { id: string; billing_mode: string; via: string; procedure: string } | undefined;
  };

  /** O payload cifrado da última ação preparada da conversa. */
  const pendingPayload = async (conversationId: string) => {
    const [row] = await sql`select payload_encrypted from public.ai_pending_actions
      where clinic_id = ${clinicId}::uuid and conversation_id = ${conversationId}::uuid
      order by created_at desc limit 1`;
    return row
      ? (JSON.parse(await decryptForTenant(clinicId, String(row.payload_encrypted))) as Record<
          string,
          unknown
        >)
      : null;
  };

  return {
    clinicId,
    consulta,
    sessao,
    insurerIds,
    planIds,
    contact,
    say,
    counts,
    lastAppointment,
    pendingPayload,
  };
}

/**
 * Todo atendimento criado pelo agente publica o pedido de sinal (é o que antecipa o link do particular). Roda o handler
 * real desse evento e devolve as métricas que ele emitiu: para convênio ele precisa sair como inelegível, antes de
 * qualquer política, cobrança ou chamada ao gateway.
 */
const runDepositRequest = async (clinicId: string, appointmentId: string) => {
  const [ev] = await sql`select id::text as id, payload from public.outbox
    where clinic_id = ${clinicId}::uuid and event_type = ${DEPOSIT_REQUESTED}
      and payload->>'appointmentId' = ${appointmentId}`;
  assert.ok(ev, 'pedido de sinal publicado');
  const registered = getHandler(DEPOSIT_REQUESTED);
  assert.ok(registered && registered.execution === 'detached', 'handler do pedido de sinal');
  const from = emitted.length;
  await registered.handler({ clinicId, payload: ev.payload, eventId: String(ev.id), attempt: 1 });
  const [charges] = await sql`select count(*)::int as n from public.patient_charges
    where appointment_id = ${appointmentId}::uuid`;
  return { metrics: emitted.slice(from), charges: charges!.n as number };
};
const INELIGIBLE = 'payments.deposit.request_skipped_ineligible';

try {
  // A mesma ACL gerenciada do Supabase que os outros harnesses reproduzem (ausente no cluster local).
  await sql`GRANT SELECT ON public.clinics, public.subscriptions, public.profiles TO authenticated`;

  const A = await clinic('A', true, [
    { name: 'Unimed Sintética', status: 'active', plans: ['Enfermaria'] },
    { name: 'Saúde Suspensa', status: 'suspended', plans: ['Básico'] },
  ]);
  const OFF = await clinic('módulo desligado', false, [
    { name: 'Unimed Sintética', status: 'active', plans: ['Enfermaria'] },
  ]);
  const UNIMED_A = A.insurerIds['Unimed Sintética']!;
  const ENFERMARIA_A = A.planIds['Unimed Sintética/Enfermaria']!;

  // ── 1. particular ───────────────────────────────────────────────────────────
  {
    const p = await A.contact('Paciente Sintético Particular');
    const first = await A.say(p.phone, 'quero marcar uma consulta sintética', [
      toolCall('prepare_appointment', { procedure_name: 'Consulta Sintética' }),
    ]);
    assert.match(first.reply, /Responda SIM para confirmar\./u, first.reply);
    assert.doesNotMatch(first.reply, /convênio|carteirinha|operadora/iu, first.reply);
    // Clínica com o módulo ligado: o "SIM" é contextual ("como particular").
    assert.match(first.reply, / como particular/u, first.reply);
    const done = await A.say(p.phone, 'SIM', [toolCall('confirm_pending_action')]);
    assert.match(done.reply, /^Pronto! Consulta agendada/u, done.reply);
    assert.doesNotMatch(done.reply, /convênio|carteirinha|operadora/iu, done.reply);
    const ap = await A.lastAppointment(p.patientId);
    assert.ok(ap, 'atendimento particular criado');
    assert.equal(ap.billing_mode, 'particular');
    assert.equal(ap.via, 'ai_agent');
    const [cov] =
      await sql`select count(*)::int as n from public.hi_appointment_coverages where appointment_id = ${ap.id}::uuid`;
    assert.equal(cov!.n, 0);
    const deposit = await runDepositRequest(A.clinicId, ap.id);
    assert.ok(
      !deposit.metrics.includes(INELIGIBLE),
      'particular segue elegível ao sinal, como antes',
    );
    pass(
      1,
      'particular pela conversa: resumo e confirmação sem mencionar convênio; atendimento particular do agente, sem cobertura, elegível ao sinal como antes',
    );
  }

  // ── 2. convênio aceito ──────────────────────────────────────────────────────
  {
    const p = await A.contact('Paciente Sintético Convênio');
    const before = await A.counts();
    const first = await A.say(
      p.phone,
      'quero marcar uma consulta sintética pela Unimed Sintética',
      [
        toolCall('prepare_appointment', {
          insurer_name: 'Unimed Sintética',
          procedure_name: 'Consulta Sintética',
        }),
      ],
    );
    assert.match(first.reply, /pelo convênio Unimed Sintética \(plano Enfermaria\)/u, first.reply);
    assert.match(first.reply, /recepção da clínica vai conferir a sua carteirinha/u);
    assert.match(first.reply, /Responda SIM para confirmar\./u);
    assert.doesNotMatch(first.reply, /R\$|sinal|link|pagamento/iu, first.reply);
    const done = await A.say(p.phone, 'SIM', [toolCall('confirm_pending_action')]);
    assert.match(done.reply, /^Pronto! Consulta agendada/u, done.reply);
    assert.ok(done.reply.endsWith(AGENT_INSURANCE_TEXT.receptionChecksCard), done.reply);
    assert.doesNotMatch(done.reply, /R\$|sinal|link|pague/iu, done.reply);
    const ap = await A.lastAppointment(p.patientId);
    assert.ok(ap, 'atendimento convênio criado');
    assert.deepEqual(
      { billing: ap.billing_mode, via: ap.via, procedure: ap.procedure },
      { billing: 'convenio', via: 'ai_agent', procedure: A.consulta },
    );
    const [cov] =
      await sql`select insurer_id::text as insurer, plan_id::text as plan, membership_id,
        created_via, created_by
      from public.hi_appointment_coverages where appointment_id = ${ap.id}::uuid`;
    assert.ok(cov, 'cobertura registrada');
    assert.deepEqual(
      {
        insurer: cov.insurer,
        plan: cov.plan,
        membership: cov.membership_id,
        via: cov.created_via,
        by: cov.created_by,
      },
      { insurer: UNIMED_A, plan: ENFERMARIA_A, membership: null, via: 'automation', by: null },
    );
    const deposit = await runDepositRequest(A.clinicId, ap.id);
    assert.deepEqual(
      deposit,
      { metrics: [INELIGIBLE], charges: 0 },
      'convênio: pedido de sinal inelegível',
    );
    const after = await A.counts();
    assert.deepEqual(
      { ...after, appointments: after.appointments - 1, coverages: after.coverages - 1 },
      before,
      'só o atendimento e a cobertura: nenhuma guia, cobrança ou pendência sobrando',
    );
    pass(
      2,
      'convênio aceito pela conversa: resumo com operadora e plano sem sinal → SIM → convênio do agente, cobertura de automação, "a recepção confere a carteirinha"; o handler real do sinal sai como inelegível; nenhuma guia nem cobrança',
    );
  }

  // ── 3. convênio não aceito ───────────────────────────────────────────────────
  {
    const p = await A.contact('Paciente Sintético Outro Convênio');
    const before = await A.counts();
    const r = await A.say(
      p.phone,
      'quero marcar uma consulta sintética, tenho a Operadora Fictícia X',
      [
        toolCall('prepare_appointment', {
          insurer_name: 'Operadora Fictícia X',
          procedure_name: 'Consulta Sintética',
        }),
      ],
    );
    assert.equal(
      r.reply,
      'Por aqui, a clínica agenda pelos convênios: Unimed Sintética. Se o seu não estiver na lista, posso agendar como particular ou passar você para a recepção.',
    );
    // A suspensa também não é oferecida nem casa.
    const s = await A.say(p.phone, 'então pela Saúde Suspensa', [
      toolCall('prepare_appointment', {
        insurer_name: 'Saúde Suspensa',
        procedure_name: 'Consulta Sintética',
      }),
    ]);
    assert.doesNotMatch(s.reply, /Saúde Suspensa/u, s.reply);
    assert.deepEqual(await A.counts(), before, 'nada preparado nem criado');

    const q = await OFF.contact('Paciente Sintético Módulo Desligado');
    const offBefore = await OFF.counts();
    const off = await OFF.say(
      q.phone,
      'quero marcar uma consulta sintética pela Unimed Sintética',
      [
        toolCall('prepare_appointment', {
          insurer_name: 'Unimed Sintética',
          procedure_name: 'Consulta Sintética',
        }),
      ],
    );
    assert.equal(off.reply, AGENT_INSURANCE_TEXT.managedByReception);
    assert.deepEqual(await OFF.counts(), offBefore, 'módulo desligado: nada preparado nem criado');
    pass(
      3,
      'convênio não aceito pela conversa: fora do cadastro (ou suspenso) → o que a clínica agenda e a saída particular/recepção; módulo desligado → "é com a recepção"; nada preparado nem criado',
    );
  }

  // ── 4. dúvida de cobertura ───────────────────────────────────────────────────
  {
    const p = await A.contact('Paciente Sintético Dúvida');
    const before = await A.counts();
    const r = await A.say(p.phone, 'o meu plano da Unimed Sintética cobre a consulta?', [
      text('Sim, o seu plano Unimed Sintética cobre a consulta, pode ficar tranquilo.'),
    ]);
    assert.equal(r.reply, AGENT_INSURANCE_TEXT.coverageQuestion);
    const [failure] = await sql`select count(*)::int as n from public.ai_agent_failures
      where event_id = ${r.eventId}::uuid`;
    assert.ok(failure!.n >= 1, 'a troca pela guarda fica registrada como falha do turno');
    assert.deepEqual(await A.counts(), before, 'nada preparado nem criado');
    pass(
      4,
      'dúvida de cobertura pela conversa: o modelo tenta afirmar que o plano cobre → a guarda troca pela frase fixa (quem confirma é a operadora/recepção, com oferta da recepção) e registra a falha; nada criado',
    );
  }

  // ── 5. procedimento com autorização ──────────────────────────────────────────
  {
    const p = await A.contact('Paciente Sintético Autorização');
    const first = await A.say(
      p.phone,
      'quero marcar a sessão sintética programada pela Unimed Sintética',
      [
        toolCall('prepare_appointment', {
          insurer_name: 'Unimed Sintética',
          procedure_name: 'Sessão Sintética Programada',
        }),
      ],
    );
    assert.match(first.reply, /pelo convênio Unimed Sintética/u, first.reply);
    assert.ok(first.reply.includes(AGENT_INSURANCE_TEXT.authorizationNeeded), first.reply);
    assert.doesNotMatch(first.reply, /\bautorizad[oa]\b|R\$|sinal|link/iu, first.reply);
    const done = await A.say(p.phone, 'SIM', [toolCall('confirm_pending_action')]);
    assert.match(done.reply, /^Pronto! Consulta agendada/u, done.reply);
    assert.doesNotMatch(done.reply, /\bautorizad[oa]\b/iu, done.reply);
    const ap = await A.lastAppointment(p.patientId);
    assert.ok(ap, 'atendimento criado');
    assert.deepEqual(
      { billing: ap.billing_mode, procedure: ap.procedure },
      { billing: 'convenio', procedure: A.sessao },
    );
    const [cov] = await sql`select guide_type::text as guide_type, membership_id
      from public.hi_appointment_coverages where appointment_id = ${ap.id}::uuid`;
    assert.ok(cov, 'cobertura registrada');
    assert.equal(cov.guide_type, 'sp_sadt');
    assert.equal(cov.membership_id, null, 'sem carteirinha: pendência da recepção');
    const deposit = await runDepositRequest(A.clinicId, ap.id);
    assert.deepEqual(
      deposit,
      { metrics: [INELIGIBLE], charges: 0 },
      'convênio: pedido de sinal inelegível',
    );
    pass(
      5,
      'procedimento com autorização pela conversa: o resumo avisa o aval da operadora → SIM → convênio SP/SADT pelo contrato, sem dizer que está autorizado; carteirinha e autorização ficam com a recepção',
    );
  }

  // ── 6. operadora que só o modelo propôs ──────────────────────────────────────
  {
    const p = await A.contact('Paciente Sintético Sem Convênio Dito');
    const before = await A.counts();
    const r = await A.say(p.phone, 'quero marcar uma consulta sintética', [
      toolCall('prepare_appointment', {
        insurer_name: 'Unimed Sintética',
        procedure_name: 'Consulta Sintética',
      }),
    ]);
    assert.equal(r.reply, AGENT_INSURANCE_TEXT.insurerNotDeclared);
    assert.deepEqual(await A.counts(), before, 'nada preparado nem criado');
    const named = await A.say(p.phone, 'é pela Unimed Sintética', [
      toolCall('prepare_appointment', {
        insurer_name: 'Unimed Sintética',
        procedure_name: 'Consulta Sintética',
      }),
    ]);
    assert.match(named.reply, /pelo convênio Unimed Sintética \(plano Enfermaria\)/u, named.reply);
    const payload = await A.pendingPayload(named.conversationId);
    assert.deepEqual(payload?.insuranceSource, { insurer: 'patient_text', plan: 'single_active' });
    const done = await A.say(p.phone, 'SIM', [toolCall('confirm_pending_action')]);
    assert.ok(done.reply.endsWith(AGENT_INSURANCE_TEXT.receptionChecksCard), done.reply);
    assert.equal((await A.lastAppointment(p.patientId))?.billing_mode, 'convenio');
    pass(
      6,
      'operadora que só o modelo propôs: "convênio ou particular?" e nada preparado; com o nome dito pelo paciente, convênio, com a origem da escolha gravada na ação preparada',
    );
  }

  // ── 7. o inverso: o paciente citou o convênio e o modelo preparou particular ────
  {
    const p = await A.contact('Paciente Sintético Inverso');
    await A.say(p.phone, 'oi, tenho Unimed Sintética', [
      text('Olá! Qual atendimento você quer marcar?'),
    ]);
    const before = await A.counts();
    const r = await A.say(p.phone, 'quero marcar uma consulta sintética', [
      toolCall('prepare_appointment', { procedure_name: 'Consulta Sintética' }),
    ]);
    assert.equal(r.reply, 'Você quer agendar pelo convênio Unimed Sintética ou como particular?');
    assert.deepEqual(await A.counts(), before, 'nada preparado (nem resumo com sinal)');
    const priv = await A.say(p.phone, 'particular', [
      toolCall('prepare_appointment', { procedure_name: 'Consulta Sintética' }),
    ]);
    assert.match(priv.reply, / como particular/u, priv.reply);
    assert.equal((await A.pendingPayload(priv.conversationId))?.insurance, undefined);
    pass(
      7,
      'o inverso: o paciente citou a operadora e o modelo preparou particular → pergunta antes, sem resumo nem sinal; com "particular", o resumo diz "como particular"',
    );
  }

  // ── 8. nada indevido em nenhuma mensagem enviada ──────────────────────────────
  {
    assert.ok(sentToWhatsApp.length >= 15, `mensagens enviadas: ${sentToWhatsApp.length}`);
    for (const t of sentToWhatsApp) assert.deepEqual(findUnsafeAgentClaims(t), [], t);
    const [guides] = await sql`select count(*)::int as n from public.hi_guides`;
    const [charges] = await sql`select count(*)::int as n from public.patient_charges`;
    assert.deepEqual({ guides: guides!.n, charges: charges!.n }, { guides: 0, charges: 0 });
    assert.equal(externalCalls, 0, 'nenhuma rede externa');
    assert.ok(modelCalls >= 12, `chamadas ao modelo roteirizado: ${modelCalls}`);
    pass(
      8,
      `nenhuma das ${sentToWhatsApp.length} mensagens enviadas afirma cobertura, autorização, elegibilidade ou valor, nem pede a carteirinha; nenhuma guia nem cobrança; nenhuma rede externa`,
    );
  }

  console.log(`\nagent-insurance-conversation-db: ${passed}/8 PASS`);
  assert.equal(passed, 8);
} finally {
  GeminiProvider.prototype.generateWithTools = originalGenerate;
  globalThis.fetch = originalFetch;
  metrics.emit = originalEmit;
  const { dbAdmin, db, dbWorker } = await import('../../src/lib/db');
  await Promise.allSettled([
    dbAdmin.$client.end({ timeout: 5 }),
    db.$client.end({ timeout: 5 }),
    dbWorker.$client.end({ timeout: 5 }),
  ]);
  await cluster.stop();
}
