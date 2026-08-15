/**
 * Smoke — Jornadas conversacionais do agente (§36 da auditoria 2026-08-14).
 *
 * Roda contra qoro-dev (DATABASE_URL do .env.local). NUNCA contra prod.
 * Gemini e Meta stubados por override de globalThis.fetch; o resto do caminho é
 * REAL: persistInbound → outbox → worker → saga → tools → cores → banco.
 *
 * COMPLEMENTA smoke-c12, não o repete. Lá se prova o contrato de mutação
 * (preparar/confirmar, cross-tenant, LGPD, financeiro). Aqui se prova o que a
 * auditoria mostrou estar quebrado: o ESTADO da conversa depois de uma pessoa
 * real interagir — loops sem saída, horário no passado, data errada,
 * confirmação que não confirma e rajada de mensagens.
 *
 * O QUE ESTE SMOKE NÃO PROVA (e nenhum smoke com stub prova): a interpretação do
 * modelo. Cenários puramente linguísticos da §36 — gírias, erros de digitação,
 * frases ambíguas — dependem do Gemini real e continuam sendo verificação
 * manual. Aqui o roteiro do modelo é FIXO de propósito: o que está sob teste é o
 * servidor, que é onde as correções vivem.
 *
 * Muitos cenários não roteirizam o Gemini porque, por desenho, ele não é
 * chamado: mensagem clínica é barrada no pré-filtro e turno de cadastro é
 * conduzido inteiramente pelo servidor. Onde não há `setScript`, é isso.
 *
 * NB: requer SUPABASE_SECRET_KEY do MESMO projeto do DATABASE_URL.
 * Uso: `pnpm smoke:journeys`. NUNCA em paralelo com outro smoke — o worker do
 * outbox tem advisory lock GLOBAL e o outro processo rouba os ticks.
 */
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { __testing__ as aiCircuitTesting } from '@/lib/ai/circuit-breaker';
import { createAdminClient } from '@/lib/auth/supabase-admin';
import { decryptForTenant, encryptForTenant, hashForLookup, normalizeCpf } from '@/lib/crypto';
import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import type { ParsedInboundMessage } from '@/lib/messaging';
import { runOutboxOnce } from '@/lib/outbox/worker';

import '@/lib/db/schema';
import '@/app/api/cron/outbox/handlers';

import { persistInbound } from '@/contexts/messaging/internal/inbound';
import { escalateToHuman, returnToAgent } from '@/contexts/ai-agent/internal/conversation';
import { CLINICAL_FALLBACK, OPERATIONAL_NUDGE } from '@/contexts/ai-agent/prompts/system';
import { MAX_COLLECT_STAGNATION, MAX_FALLBACKS } from '@/contexts/ai-agent/limits';

assertDevContext();

// --- harness ------------------------------------------------------------------
type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, ok: boolean, detail?: string): void {
  results.push(detail === undefined ? { name, ok } : { name, ok, detail });
  console.log(ok ? `[OK]   ${name}` : `[FAIL] ${name}${detail ? `\n       ${detail}` : ''}`);
}
function fmtErr(e: unknown): string {
  return e instanceof Error ? (e.stack ?? e.message) : String(e);
}
/** Contenção do worker não é falha de cenário — é ambiente. Aborta tudo. */
class WorkerContentionError extends Error {}
let aborted = false;

async function tryStep(name: string, fn: () => Promise<void>): Promise<void> {
  if (aborted) return; // não empilhar falhas em cascata depois de abortar
  try {
    await fn();
    record(name, true);
  } catch (e) {
    record(name, false, fmtErr(e));
    if (e instanceof WorkerContentionError) {
      aborted = true;
      console.log('\n>>> execução ABORTADA: o worker do outbox está sendo disputado.');
      console.log('>>> Os cenários seguintes NÃO rodaram — não conclua nada sobre eles.\n');
    }
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// --- stub de Gemini + Meta -----------------------------------------------------
type FetchFn = typeof globalThis.fetch;
const realFetch: FetchFn = globalThis.fetch;
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const G_USAGE = { promptTokenCount: 600, candidatesTokenCount: 60 };
const gText = (t: string): Response =>
  jsonResponse({ candidates: [{ content: { parts: [{ text: t }] } }], usageMetadata: G_USAGE });
const gCall = (name: string, args: object): Response =>
  jsonResponse({
    candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }],
    usageMetadata: G_USAGE,
  });

/**
 * Passos do roteiro são ASSÍNCRONOS de propósito: um passo pode executar um
 * efeito no banco ANTES de devolver a resposta do modelo. É o que torna a
 * corrida do handoff (F-09) determinística — o humano assume exatamente
 * enquanto o turno está na chamada ao LLM, que é a janela real do defeito.
 */
type ScriptStep = () => Promise<Response> | Response;
let geminiScript: ScriptStep[] = [];
let geminiCalls = 0;
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const u = String(url);
  if (u.includes('generativelanguage.googleapis.com')) {
    geminiCalls += 1;
    const next = geminiScript.shift();
    return next ? await next() : gText('OK');
  }
  if (u.includes('graph.facebook.com')) {
    return jsonResponse({ messages: [{ id: `wamid.${randomUUID()}` }] }, 200);
  }
  return realFetch(url, init);
}) as FetchFn;
function setScript(...steps: ScriptStep[]): void {
  geminiScript = steps;
  geminiCalls = 0;
}

// --- fixtures ------------------------------------------------------------------
const created: string[] = [];
let doctorId = '';
let nightDoctorId = '';
const supabase = createAdminClient();
const CPF = '39053344705'; // válido (Luhn)
const RUN = Date.now().toString().slice(-9);
const PHONE = `5511${RUN}`;
const PHONE_ID = `journeys-${RUN}`;

/** Segunda clínica: agenda NOTURNA, para provar que a decisão vem da config. */
const NIGHT_PHONE = `5521${RUN}`;
const NIGHT_PHONE_ID = `journeys-night-${RUN}`;

async function createClinicNamed(tag: string): Promise<string> {
  const slug = `jrn${tag}${RUN}`.slice(0, 30).toLowerCase();
  const rows = await dbAdmin.execute<{ id: string }>(
    sql`INSERT INTO clinics (slug, nome, endereco, status)
        VALUES (${slug}, ${`Smoke Jornadas ${tag}`}, 'Rua das Jornadas, 36', 'active') RETURNING id`,
  );
  created.push(rows[0]!.id);
  return rows[0]!.id;
}

/** Clínica que atende 14–22: às 9 só existe 21:00. */
async function seedNightClinic(clinicId: string): Promise<void> {
  const token = await encryptForTenant(clinicId, 'TEST_TOKEN');
  await dbAdmin.execute(sql`
    INSERT INTO clinic_whatsapp_numbers (clinic_id, provider, phone_number, meta_phone_id, token_encrypted, verified_at, active)
    VALUES (${clinicId}, 'meta', ${`5521${RUN}00`}, ${NIGHT_PHONE_ID}, ${token}, now(), true)`);
  await dbAdmin.execute(sql`INSERT INTO ai_clinic_config (clinic_id) VALUES (${clinicId})`);
  const { data, error } = await supabase.auth.admin.createUser({
    email: `journeys.night.${RUN}@example.com`,
    password: randomUUID(),
    email_confirm: true,
  });
  if (error || !data.user?.id) throw new Error(`createUser noturno falhou: ${error?.message}`);
  const nightDoctor = data.user.id;
  nightDoctorId = nightDoctor;
  await dbAdmin.execute(sql`
    INSERT INTO profiles (id, clinic_id, nome, role, ativo)
    VALUES (${nightDoctor}, ${clinicId}, 'Dr. Noturno', 'doctor', true)
    ON CONFLICT (id) DO UPDATE SET clinic_id = ${clinicId}`);
  await dbAdmin.execute(sql`
    INSERT INTO procedures (clinic_id, codigo, descricao, categoria, valor_padrao, duracao_padrao_min, ativo)
    VALUES (${clinicId}, 'HARM01', 'Harmonização Facial', 'estetica', 900.00, 30, true)`);
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    await dbAdmin.execute(sql`
      INSERT INTO doctor_availability (clinic_id, doctor_id, weekday, start_time, end_time)
      VALUES (${clinicId}, ${nightDoctor}, ${weekday}, '14:00', '22:00') ON CONFLICT DO NOTHING`);
  }
  // Paciente JÁ cadastrado: o que este cenário testa é a resolução de horário
  // contra a agenda, não a coleta (que tem cenários próprios). Sem ele,
  // `prepare_appointment` pediria cadastro e nunca chegaria a agendar.
  const nightCpf = '52998224725'; // válido (Luhn), distinto do CPF da 1ª clínica
  await dbAdmin.execute(sql`
    INSERT INTO patients (clinic_id, nome, cpf_encrypted, cpf_hash, telefone_encrypted, telefone_hash)
    VALUES (
      ${clinicId}, 'Paciente Noturno',
      ${await encryptForTenant(clinicId, nightCpf)}, ${await hashForLookup(nightCpf)},
      ${await encryptForTenant(clinicId, NIGHT_PHONE)}, ${await hashForLookup(NIGHT_PHONE)}
    )`);
}

async function createClinic(): Promise<string> {
  const slug = `jrn${RUN}`.slice(0, 30).toLowerCase();
  const rows = await dbAdmin.execute<{ id: string }>(
    sql`INSERT INTO clinics (slug, nome, endereco, status)
        VALUES (${slug}, 'Smoke Jornadas', 'Rua das Jornadas, 36', 'active') RETURNING id`,
  );
  created.push(rows[0]!.id);
  return rows[0]!.id;
}
async function seedClinic(
  clinicId: string,
  hours: { start: string; end: string } = { start: '08:00', end: '18:00' },
): Promise<void> {
  const token = await encryptForTenant(clinicId, 'TEST_TOKEN');
  await dbAdmin.execute(sql`
    INSERT INTO clinic_whatsapp_numbers (clinic_id, provider, phone_number, meta_phone_id, token_encrypted, verified_at, active)
    VALUES (${clinicId}, 'meta', ${`5511${RUN}00`}, ${PHONE_ID}, ${token}, now(), true)`);
  await dbAdmin.execute(sql`INSERT INTO ai_clinic_config (clinic_id) VALUES (${clinicId})`);

  const { data, error } = await supabase.auth.admin.createUser({
    email: `journeys.${RUN}@example.com`,
    password: randomUUID(),
    email_confirm: true,
  });
  if (error || !data.user?.id) throw new Error(`createUser falhou: ${error?.message}`);
  doctorId = data.user.id;
  await dbAdmin.execute(sql`
    INSERT INTO profiles (id, clinic_id, nome, role, ativo)
    VALUES (${doctorId}, ${clinicId}, 'Dra. Jornada', 'doctor', true)
    ON CONFLICT (id) DO UPDATE SET clinic_id = ${clinicId}`);
  await dbAdmin.execute(sql`
    INSERT INTO procedures (clinic_id, codigo, descricao, categoria, valor_padrao, duracao_padrao_min, ativo)
    VALUES (${clinicId}, 'HARM01', 'Harmonização Facial', 'estetica', 900.00, 30, true)`);
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    await dbAdmin.execute(sql`
      INSERT INTO doctor_availability (clinic_id, doctor_id, weekday, start_time, end_time)
      VALUES (${clinicId}, ${doctorId}, ${weekday}, ${hours.start}, ${hours.end}) ON CONFLICT DO NOTHING`);
  }
}

// --- entrega de turnos ----------------------------------------------------------
const MAX_TICKS = 10;
let seq = 0;
function makeMsg(text: string, phoneId = PHONE_ID, from = PHONE): ParsedInboundMessage {
  seq += 1;
  return {
    providerMessageId: `wamid.jrn.${Date.now().toString(36)}.${seq}`,
    fromNumber: from,
    toPhoneId: phoneId,
    toNumber: `5511${RUN}00`,
    text,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
}
async function persistOnly(
  clinicId: string,
  text: string,
  phoneId = PHONE_ID,
  from = PHONE,
): Promise<string> {
  const msg = makeMsg(text, phoneId, from);
  await persistInbound(clinicId, 'meta', msg);
  const ev = await dbAdmin.execute<{ id: string }>(
    sql`SELECT id FROM outbox WHERE idempotency_key = ${`inbound:meta:${msg.providerMessageId}`}`,
  );
  return ev[0]!.id;
}
/**
 * Roda o worker até o evento do turno ser consumido.
 *
 * Distingue "o produto falhou" de "o ambiente está ocupado" — sem isso, um
 * segundo processo tocando o worker transforma UMA contenção de lock em uma
 * dezena de falhas em cascata, e o operador procura bug onde não há.
 *
 * `runOutboxOnce` devolve `empty: 0` quando o tick foi ROUBADO (não conseguiu o
 * advisory lock global) e `empty > 0` quando a fila estava genuinamente vazia.
 * É essa diferença que permite acusar a causa certa.
 *
 * `batchSize` é folgado de propósito: eventos residuais de outra clínica na fila
 * não podem empurrar o evento deste turno para fora do lote.
 */
async function drainUntil(eventId: string): Promise<void> {
  let stolen = 0;
  for (let tick = 0; tick < MAX_TICKS; tick += 1) {
    const summary = await runOutboxOnce({ batchSize: 10, parallelism: 1 });
    if (summary.processed === 0 && summary.failed === 0 && summary.empty === 0) {
      stolen += 1;
      if (stolen >= 3) {
        throw new WorkerContentionError(
          'outro processo está usando o worker do outbox (advisory lock global). ' +
            'Feche qualquer outro smoke, `worker:once` ou dev server rodando contra este banco ' +
            'e execute de novo — NÃO é falha do agente.',
        );
      }
      continue;
    }
    stolen = 0;
    const st = await dbAdmin.execute<{ p: Date | null }>(
      sql`SELECT processed_at AS p FROM outbox WHERE id = ${eventId} LIMIT 1`,
    );
    if (st[0]?.p) return;
  }
  throw new Error(`outbox não processou o evento após ${MAX_TICKS} ticks`);
}
/** Uma mensagem do paciente, processada até o fim. Devolve o eventId do turno. */
async function say(clinicId: string, text: string): Promise<string> {
  const eventId = await persistOnly(clinicId, text);
  await drainUntil(eventId);
  return eventId;
}
/** Mesma coisa, mas para a segunda clínica (outro número, outro contato). */
async function sayTo(
  clinicId: string,
  phoneId: string,
  from: string,
  text: string,
): Promise<string> {
  const eventId = await persistOnly(clinicId, text, phoneId, from);
  await drainUntil(eventId);
  return eventId;
}
async function outcomeOf(eventId: string): Promise<string | null> {
  const r = await dbAdmin.execute<{ payload: { outcome?: string } }>(
    sql`SELECT payload FROM outbox WHERE idempotency_key = ${`ai-turn:${eventId}`} LIMIT 1`,
  );
  return r[0]?.payload?.outcome ?? null;
}

// --- leitura de estado ----------------------------------------------------------
async function lastReply(clinicId: string): Promise<string> {
  const r = await dbAdmin.execute<{ c: string }>(sql`
    SELECT content_encrypted AS c FROM ai_messages
    WHERE clinic_id = ${clinicId} AND direction = 'out'
    ORDER BY created_at DESC LIMIT 1`);
  return r[0] ? decryptForTenant(clinicId, r[0].c) : '';
}
async function lastInbound(clinicId: string): Promise<string> {
  const r = await dbAdmin.execute<{ c: string }>(sql`
    SELECT content_encrypted AS c FROM ai_messages
    WHERE clinic_id = ${clinicId} AND direction = 'in'
    ORDER BY created_at DESC LIMIT 1`);
  return r[0] ? decryptForTenant(clinicId, r[0].c) : '';
}
async function conversationRow(
  clinicId: string,
): Promise<{ id: string; status: string; fallbackCount: number } | null> {
  const r = await dbAdmin.execute<{ id: string; status: string; fallback_count: number }>(sql`
    SELECT id, status, fallback_count FROM ai_conversations
    WHERE clinic_id = ${clinicId} ORDER BY created_at DESC LIMIT 1`);
  return r[0] ? { id: r[0].id, status: r[0].status, fallbackCount: Number(r[0].fallback_count) } : null;
}
async function outboundCount(clinicId: string): Promise<number> {
  const r = await dbAdmin.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM ai_messages WHERE clinic_id = ${clinicId} AND direction = 'out'`,
  );
  return Number(r[0]?.n ?? 0);
}
async function unprocessedInbound(clinicId: string): Promise<number> {
  const r = await dbAdmin.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM inbound_messages_raw
    WHERE clinic_id = ${clinicId} AND processed_at IS NULL`);
  return Number(r[0]?.n ?? 0);
}
async function pendingActionCount(clinicId: string): Promise<number> {
  const r = await dbAdmin.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM ai_pending_actions
    WHERE clinic_id = ${clinicId} AND status = 'pending'`);
  return Number(r[0]?.n ?? 0);
}
async function apptCount(clinicId: string): Promise<number> {
  const r = await dbAdmin.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM appointments
    WHERE clinic_id = ${clinicId} AND status <> 'cancelado'`);
  return Number(r[0]?.n ?? 0);
}
async function latestAppt(
  clinicId: string,
): Promise<{ id: string; at: Date; status: string } | null> {
  const r = await dbAdmin.execute<{ id: string; at: string | Date; status: string }>(sql`
    SELECT id, scheduled_at AS at, status FROM appointments
    WHERE clinic_id = ${clinicId} ORDER BY created_at DESC LIMIT 1`);
  return r[0] ? { id: r[0].id, at: new Date(r[0].at), status: r[0].status } : null;
}
async function patientExists(clinicId: string): Promise<boolean> {
  const cpfHash = await hashForLookup(normalizeCpf(CPF));
  const r = await dbAdmin.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM patients
    WHERE clinic_id = ${clinicId} AND cpf_hash = ${cpfHash} AND deleted_at IS NULL`);
  return Number(r[0]?.n ?? 0) > 0;
}
/** Devolve a conversa ao agente entre cenários que terminam em handoff. */
async function backToAgent(clinicId: string): Promise<void> {
  const conv = await conversationRow(clinicId);
  if (!conv || conv.status !== 'handoff') return;
  await withTenant(clinicId, (tx) => returnToAgent(tx, clinicId, conv.id));
  await dbAdmin.execute(
    sql`UPDATE ai_conversations SET fallback_count = 0 WHERE id = ${conv.id}`,
  );
}

/** Horário local da clínica (São Paulo, sem DST) alinhado a um slot real. */
function slotISO(daysAhead: number, hour: number): string {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + daysAhead * 86_400_000));
  return new Date(`${day}T${String(hour).padStart(2, '0')}:00:00-03:00`).toISOString();
}
function localHourOf(instant: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(instant),
  );
}
function localDayOf(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

// ================================================================================
/**
 * Drena o que já estava na fila ANTES de semear.
 *
 * Uma execução anterior interrompida deixa eventos de outra clínica pendentes;
 * eles competem por lugar no lote e fazem o evento deste turno parecer não
 * processado. Limpar o terreno primeiro é mais barato que diagnosticar depois.
 */
async function drainLeftovers(): Promise<void> {
  const pend = await dbAdmin.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM outbox WHERE status = 'pending' AND next_attempt_at <= now()`,
  );
  const n = Number(pend[0]?.n ?? 0);
  if (n === 0) return;
  console.log(`[preflight] ${n} evento(s) residual(is) na fila — drenando antes de começar.`);
  for (let i = 0; i < 12; i += 1) {
    const s = await runOutboxOnce({ batchSize: 10, parallelism: 1 });
    if (s.processed === 0 && s.failed === 0 && s.empty > 0) return; // fila limpa
  }
}

async function main(): Promise<void> {
  aiCircuitTesting.reset();
  await drainLeftovers();
  const clinic = await createClinic();
  await seedClinic(clinic);

  // ---------------------------------------------------------------- F-01
  await tryStep(
    'CV-09 clínico + operacional: recusa o sintoma E preserva o agendamento',
    async () => {
      // Roteiro VAZIO: se o modelo for chamado, a chamada é contada e o cenário
      // falha — que é exatamente a invariante (o pré-filtro barra antes do LLM).
      setScript();
      const ev = await say(clinic, 'quero marcar uma consulta, to com dor de dente');
      const reply = await lastReply(clinic);
      assert(reply.includes(CLINICAL_FALLBACK), 'a recusa clínica é obrigatória e literal');
      assert(
        reply.includes(OPERATIONAL_NUDGE),
        'o pedido de agendamento não pode morrer junto com o sintoma',
      );
      assert(geminiCalls === 0, 'mensagem clínica JAMAIS pode chegar ao modelo');
      assert((await outcomeOf(ev)) === 'prefiltered', 'turno deveria ser prefiltered');
    },
  );

  await tryStep('CV-15 sintomas repetidos escalam para humano em vez de repetir', async () => {
    // O 1º clínico já contou acima; faltam MAX_FALLBACKS-1 para o limiar.
    for (let i = 1; i < MAX_FALLBACKS; i += 1) {
      await say(clinic, 'e essa dor de cabeça, o que pode ser?');
    }
    const conv = await conversationRow(clinic);
    assert(conv?.status === 'handoff', `conversa deveria escalar; status=${conv?.status}`);
    const q = await dbAdmin.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM ai_handoff_queue
      WHERE clinic_id = ${clinic} AND resolved_at IS NULL`);
    assert(Number(q[0]?.n) === 1, 'deveria haver handoff aberto na fila');
    await backToAgent(clinic);
  });

  // ---------------------------------------------------------------- F-02
  await tryStep('CV-10 cadastro: pedir humano no meio da coleta escapa do formulário', async () => {
    setScript(() =>
      gCall('prepare_appointment', { procedure_name: 'Harmonização Facial' }),
    );
    await say(clinic, 'quero marcar harmonização');
    assert(
      (await lastReply(clinic)).includes('nome completo'),
      'a coleta deveria começar pedindo o nome',
    );
    await say(clinic, 'quero falar com um atendente');
    const conv = await conversationRow(clinic);
    assert(conv?.status === 'handoff', 'pedido de humano durante a coleta deveria escalar');
    await backToAgent(clinic);
  });

  await tryStep('CV-14 cadastro: resposta inválida repetida escala em vez de travar', async () => {
    for (let i = 0; i < MAX_COLLECT_STAGNATION; i += 1) {
      await say(clinic, 'joao'); // nome incompleto: sempre rejeitado
    }
    const conv = await conversationRow(clinic);
    assert(
      conv?.status === 'handoff',
      `estagnação deveria escalar após ${MAX_COLLECT_STAGNATION} tentativas; status=${conv?.status}`,
    );
    await backToAgent(clinic);
  });

  await tryStep('CV-12 cadastro: motivo clínico é DADO, não pergunta — grava e segue', async () => {
    setScript(); // zera o contador: a coleta inteira tem de rodar sem LLM
    await say(clinic, 'joao marcos silva');
    assert((await lastReply(clinic)).includes('CPF'), 'deveria pedir o CPF');
    await say(clinic, CPF);
    assert((await lastReply(clinic)).includes('motivo'), 'deveria pedir o motivo');
    // O motivo carrega um termo clínico — antes da F-01 isto travava o cadastro.
    await say(clinic, 'dor nas costas');
    const reply = await lastReply(clinic);
    assert(
      !reply.includes(CLINICAL_FALLBACK),
      'motivo clínico NÃO pode ser barrado pelo pré-filtro dentro da coleta',
    );
    assert(reply.includes('SIM'), `deveria pedir a confirmação do cadastro; veio: ${reply}`);
    assert(geminiCalls === 0, 'a coleta inteira é conduzida pelo servidor, sem LLM');
  });

  await tryStep('CV-20 informal: "blz" confirma o cadastro (F-07)', async () => {
    await say(clinic, 'blz');
    assert(await patientExists(clinic), '"blz" deveria confirmar e criar o paciente');
    assert(
      (await lastReply(clinic)).toLowerCase().includes('cadastro conclu'),
      'deveria anunciar o cadastro concluído',
    );
  });

  // ---------------------------------------------------------------- F-03/F-04
  await tryStep('CV-07 "primeiro horário livre" nunca cai no passado (F-03)', async () => {
    setScript(
      () => gCall('prepare_appointment', { procedure_name: 'Harmonização Facial' }),
      () => gText('Confirma?'),
    );
    await say(clinic, 'pode ser qualquer horário');
    assert((await pendingActionCount(clinic)) === 1, 'deveria preparar uma ação');
    const conv = await conversationRow(clinic);
    const pa = await dbAdmin.execute<{ summary: string }>(sql`
      SELECT summary FROM ai_pending_actions
      WHERE conversation_id = ${conv!.id} AND status = 'pending' LIMIT 1`);
    assert(!!pa[0], 'resumo da ação pendente deveria existir');
    setScript(() => gCall('confirm_pending_action', {}), () => gText('Agendado!'));
    await say(clinic, 'sim');
    const appt = await latestAppt(clinic);
    assert(!!appt, 'consulta deveria ter sido criada');
    assert(appt!.at.getTime() > Date.now(), 'consulta NUNCA pode ser criada no passado');
    const h = localHourOf(appt!.at);
    assert(h >= 8 && h < 18, `horário fora da agenda da clínica: ${h}h`);
  });

  await tryStep('CV-11 "depois de amanhã" marca D+2, não D+1 (F-04)', async () => {
    // O modelo propõe D+1 de propósito; o servidor tem de vencer.
    setScript(
      () => gCall('prepare_appointment', {
        procedure_name: 'Harmonização Facial',
        scheduled_at: slotISO(1, 14),
      }),
      () => gText('Confirma?'),
    );
    await say(clinic, 'na verdade quero depois de amanhã às 15');
    setScript(() => gCall('confirm_pending_action', {}), () => gText('Marcado!'));
    await say(clinic, 'isso mesmo');
    const appt = await latestAppt(clinic);
    assert(!!appt, 'consulta deveria existir');
    const esperado = localDayOf(new Date(Date.now() + 2 * 86_400_000));
    assert(
      localDayOf(appt!.at) === esperado,
      `dia errado: esperado ${esperado}, veio ${localDayOf(appt!.at)}`,
    );
    assert(localHourOf(appt!.at) === 15, `hora errada: ${localHourOf(appt!.at)}h`);
  });

  // ---------------------------------------------------------------- F-07
  await tryStep('CV-19 "ok e qual o endereço" NÃO confirma nada (F-07)', async () => {
    setScript(
      () => gCall('prepare_appointment', {
        procedure_name: 'Harmonização Facial',
        scheduled_at: slotISO(4, 9),
      }),
      () => gText('Confirma?'),
    );
    await say(clinic, 'quero marcar dia 4 às 9');
    const antes = await apptCount(clinic);
    assert((await pendingActionCount(clinic)) === 1, 'deveria haver ação pendente');

    setScript(() => gCall('confirm_pending_action', {}), () => gText('resposta'));
    await say(clinic, 'ok e qual o endereço');
    assert(
      (await apptCount(clinic)) === antes,
      'ack seguido de pergunta NUNCA pode executar a ação preparada',
    );
    assert((await pendingActionCount(clinic)) === 1, 'a pendência deveria continuar de pé');
  });

  await tryStep('regressão: "quero confirmar minha consulta" só PREPARA (F-07)', async () => {
    // Foi este caso que o smoke-c12 pegou e o teste unitário não cobria.
    const antes = await apptCount(clinic);
    setScript(() => gCall('confirm_pending_action', {}), () => gText('resposta'));
    await say(clinic, 'quero confirmar minha consulta');
    assert(
      (await apptCount(clinic)) === antes,
      'pedido de INICIAR confirmação não é consentimento — não pode executar',
    );
  });

  await tryStep('CV-12b "sim" sem ação pendente não executa nada (F-07)', async () => {
    // Consome a pendência que sobrou, para partir de um estado limpo.
    setScript(() => gCall('confirm_pending_action', {}), () => gText('ok'));
    await say(clinic, 'sim');
    const antes = await apptCount(clinic);
    assert((await pendingActionCount(clinic)) === 0, 'não deveria sobrar pendência');
    setScript(() => gCall('confirm_pending_action', {}), () => gText('nada a confirmar'));
    const ev = await say(clinic, 'sim');
    assert((await apptCount(clinic)) === antes, '"sim" solto não pode criar consulta');
    assert((await outcomeOf(ev)) !== 'replied', 'turno sem pendência deveria cair em fallback');
  });

  // ---------------------------------------------------------------- F-08
  await tryStep('CV-04 rajada de mensagens vira UM atendimento (F-08)', async () => {
    await backToAgent(clinic);
    const outAntes = await outboundCount(clinic);
    setScript(() => gText('Perfeito, vou verificar.'));
    // Três mensagens ANTES de qualquer tick — é a rajada real do WhatsApp.
    const primeiro = await persistOnly(clinic, 'oi, queria remarcar');
    await persistOnly(clinic, 'de manhã');
    await persistOnly(clinic, 'pode ser cedo');
    await drainUntil(primeiro);

    const inbound = await lastInbound(clinic);
    assert(inbound.includes('remarcar'), 'o turno deveria conter a primeira mensagem');
    assert(inbound.includes('de manhã'), 'o turno deveria absorver a segunda mensagem');
    assert(inbound.includes('cedo'), 'o turno deveria absorver a terceira mensagem');
    assert(
      (await outboundCount(clinic)) === outAntes + 1,
      'três mensagens em rajada devem produzir UMA resposta',
    );
    // Os eventos das irmãs ainda estão na fila: drenar e conferir que viram no-op.
    for (let i = 0; i < 3; i += 1) await runOutboxOnce({ batchSize: 4, parallelism: 1 });
    assert(
      (await outboundCount(clinic)) === outAntes + 1,
      'os eventos das mensagens absorvidas não podem gerar respostas extras',
    );
    assert((await unprocessedInbound(clinic)) === 0, 'toda a rajada deveria estar consumida');
  });

  // ---------------------------------------------------------------- F-09
  await tryStep('CV-14b humano assume DURANTE o turno: o agente cala (F-09)', async () => {
    const outAntes = await outboundCount(clinic);
    const conv = await conversationRow(clinic);
    // O passo do roteiro escala ANTES de devolver a resposta do modelo: é
    // exatamente a janela em que o operador clica "Assumir" no painel.
    setScript(async () => {
      await withTenant(clinic, (tx) =>
        escalateToHuman(tx, clinic, conv!.id, 'operador assumiu no painel'),
      );
      return gText('resposta que NÃO deve ser entregue');
    });
    const ev = await say(clinic, 'tem horário na sexta?');
    assert(
      (await outboundCount(clinic)) === outAntes,
      'o agente não pode responder por cima de um humano que assumiu',
    );
    assert((await outcomeOf(ev)) === 'handoff', 'turno deveria terminar como handoff');
    await backToAgent(clinic);
  });

  await tryStep('CV-14c depois do handoff, o agente não responde mais', async () => {
    const conv = await conversationRow(clinic);
    await withTenant(clinic, (tx) => escalateToHuman(tx, clinic, conv!.id, 'atendente humano'));
    const outAntes = await outboundCount(clinic);
    setScript(() => gText('não deveria sair'));
    await say(clinic, 'oi, alguém aí?');
    assert(
      (await outboundCount(clinic)) === outAntes,
      'conversa em handoff não pode receber resposta do agente',
    );
    assert(geminiCalls === 0, 'em handoff o modelo nem deveria ser chamado');
    await backToAgent(clinic);
  });

  // ---------------------------------------------------------------- consistência
  // ------------------------------------------------- hora ambígua × agenda real
  /**
   * "às 3" é 03:00 ou 15:00 no relógio. Quem decide NÃO é faixa de horário
   * embutida no código — é a agenda que a clínica configurou. Prova-se com DUAS
   * clínicas de janelas diferentes: a mesma frase tem de produzir horários
   * diferentes, cada um dentro da agenda da sua clínica.
   */
  await tryStep('CV-17 clínica diurna (08–18): "às 3" vira 15:00 sem perguntar', async () => {
    setScript(
      () => gCall('prepare_appointment', { procedure_name: 'Harmonização Facial' }),
      () => gText('Confirma?'),
    );
    await say(clinic, 'pode ser amanhã às 3');
    const reply = await lastReply(clinic);
    assert(
      !reply.includes('você prefere'),
      `não deveria perguntar: 03:00 não existe numa agenda 08–18. Veio: ${reply}`,
    );
    setScript(() => gCall('confirm_pending_action', {}), () => gText('Marcado!'));
    await say(clinic, 'sim');
    const appt = await latestAppt(clinic);
    assert(!!appt, 'consulta deveria ter sido criada');
    assert(
      localHourOf(appt!.at) === 15,
      `deveria resolver para 15:00 na clínica diurna; veio ${localHourOf(appt!.at)}h`,
    );
  });

  await tryStep('CV-17b clínica noturna (14–22): a MESMA frase resolve para outro horário', async () => {
    // Segunda clínica, mesma frase, agenda diferente. Se a decisão viesse de
    // código e não da configuração, este cenário produziria 15:00 de novo.
    const nightClinic = await createClinicNamed('noturna');
    await seedNightClinic(nightClinic);
    setScript(
      () => gCall('prepare_appointment', { procedure_name: 'Harmonização Facial' }),
      () => gText('Confirma?'),
    );
    await sayTo(nightClinic, NIGHT_PHONE_ID, NIGHT_PHONE, 'pode ser amanhã às 9');
    const reply = await lastReply(nightClinic);
    assert(
      !reply.includes('você prefere'),
      `não deveria perguntar: 09:00 não existe numa agenda 14–22. Veio: ${reply}`,
    );
    setScript(() => gCall('confirm_pending_action', {}), () => gText('Marcado!'));
    await sayTo(nightClinic, NIGHT_PHONE_ID, NIGHT_PHONE, 'sim');
    const appt = await latestAppt(nightClinic);
    assert(!!appt, 'consulta deveria ter sido criada na clínica noturna');
    assert(
      localHourOf(appt!.at) === 21,
      `deveria resolver para 21:00 na clínica noturna; veio ${localHourOf(appt!.at)}h`,
    );

    // ---- RLS: a clínica diurna não enxerga nada da noturna, e vice-versa.
    const cruzado = await dbAdmin.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM appointments
      WHERE clinic_id = ${clinic} AND id = ${appt!.id}`);
    assert(Number(cruzado[0]?.n) === 0, 'consulta da clínica B não pode aparecer sob a clínica A');

    const isolada = await withTenant(clinic, async (tx) => {
      const r = await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM appointments WHERE id = ${appt!.id}`,
      );
      return Number(r[0]?.n ?? 0);
    });
    assert(isolada === 0, 'RLS deveria esconder a consulta da outra clínica sob withTenant');

    const convCruzada = await dbAdmin.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM ai_conversations
      WHERE clinic_id = ${clinic} AND patient_phone_hash = ${await hashForLookup(NIGHT_PHONE)}`);
    assert(Number(convCruzada[0]?.n) === 0, 'conversa da clínica B não pode existir sob a clínica A');
  });

  // ------------------------------------------------- sem vazamento clínico
  /**
   * O termo clínico do paciente não pode reaparecer em lugar nenhum que não
   * seja o conteúdo cifrado da própria conversa: nem na resposta, nem no
   * `tool_calls` (jsonb SEM cifra), nem no intent.
   */
  await tryStep('CV-18 termo clínico não vaza para colunas não cifradas', async () => {
    setScript(() => gText('resposta'));
    await say(clinic, 'to com dor de cabeça, quero marcar');

    const linhas = await dbAdmin.execute<{ tool_calls: unknown; intent: string | null }>(sql`
      SELECT m.tool_calls, c.intent_atual AS intent
        FROM ai_messages m JOIN ai_conversations c ON c.id = m.conversation_id
       WHERE m.clinic_id = ${clinic}`);
    const cru = JSON.stringify(linhas);
    for (const termo of ['dor de cabeça', 'dor de cabeca', 'dor']) {
      assert(!cru.includes(termo), `termo clínico "${termo}" vazou para coluna não cifrada`);
    }

    const falhas = await dbAdmin.execute<{ payload: unknown }>(
      sql`SELECT payload FROM ai_agent_failures WHERE clinic_id = ${clinic}`,
    );
    assert(
      !JSON.stringify(falhas).includes('dor'),
      'dead letter não pode carregar termo clínico',
    );
  });

  await tryStep('estado final consistente: nenhuma pendência órfã, nenhum inbound solto', async () => {
    assert((await unprocessedInbound(clinic)) === 0, 'todo inbound deveria ter sido consumido');
    const conv = await conversationRow(clinic);
    assert(conv?.status === 'active', `conversa deveria estar ativa; veio ${conv?.status}`);
    assert(await patientExists(clinic), 'o paciente criado na jornada deveria persistir');
  });
}

// --- cleanup --------------------------------------------------------------------
async function cleanup(): Promise<void> {
  for (const clinicId of created) {
    for (const table of ['lancamentos', 'ai_pending_actions', 'ai_handoff_queue', 'outbox']) {
      try {
        await dbAdmin.execute(sql`DELETE FROM ${sql.raw(table)} WHERE clinic_id = ${clinicId}`);
      } catch {
        /* best-effort */
      }
    }
    try {
      await dbAdmin.execute(sql`DELETE FROM clinics WHERE id = ${clinicId}`);
    } catch {
      /* best-effort */
    }
  }
  for (const uid of [doctorId, nightDoctorId].filter(Boolean)) {
    try {
      await supabase.auth.admin.deleteUser(uid);
    } catch {
      /* best-effort */
    }
  }
  globalThis.fetch = realFetch;
}

main()
  .catch((e) => record('main', false, fmtErr(e)))
  .finally(async () => {
    await cleanup();
    const failed = results.filter((r) => !r.ok);
    console.log(
      `\n=== smoke-agent-journeys: ${results.length - failed.length}/${results.length} passed ===`,
    );
    process.exit(failed.length === 0 ? 0 : 1);
  });
