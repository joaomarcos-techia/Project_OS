/**
 * Smoke C11 — AI Agent Base (Gemini + Tools + Validação).
 *
 * Roda contra qoro-dev (DATABASE_URL do .env.local). Gemini e Meta são
 * stubados via override de globalThis.fetch (sem rede real) — o fluxo
 * percorre o caminho REAL: persistInbound → outbox → worker (runOutboxOnce)
 * → handler saga → tools → guards → ai_messages → sendText → evento.
 *
 * Prova os testes mandatórios 11.6.x:
 *   11.6.1 conversas paralelas isoladas      11.6.5 custo registrado
 *   11.6.2 tool call inválida (smoke-level)  11.6.6 handoff cria entrada
 *   11.6.3 conselho clínico → fallback       11.6.7 RLS em ai_messages
 *   11.6.4 breaker abre após 3 falhas        11.6.8 encryption das mensagens
 * + gaps do review: G1 rounds, G4 pré-filtro, G7 dead letter, G9 tool
 *   desconhecida, R1/G10 snapshot, R2 replay determinístico, R3 fallback→
 *   handoff, R4 quota per-clinic, G8/R6 prompt version/hash.
 */
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import { sql } from 'drizzle-orm';

import { __testing__ as aiCircuitTesting } from '@/lib/ai/circuit-breaker';
import { decryptForTenant, encryptForTenant } from '@/lib/crypto';
import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import type { ParsedInboundMessage } from '@/lib/messaging';
import { runOutboxOnce } from '@/lib/outbox/worker';

// Popula catálogo (schemas) + registry (handlers) — mesma ordem do cron route.
import '@/lib/db/schema';
import '@/app/api/cron/outbox/handlers';

import {
  appendInboundMessage,
  appendOutboundMessage,
  findOrCreateConversation,
} from '@/contexts/ai-agent/internal/conversation';
import {
  CLINICAL_FALLBACK,
  OPERATIONAL_FALLBACK,
  PROMPT_VERSION,
  QUOTA_FALLBACK,
} from '@/contexts/ai-agent/prompts/system';
import { persistInbound } from '@/contexts/messaging/internal/inbound';

assertDevContext();

// --- harness -----------------------------------------------------------------
type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, ok: boolean, detail?: string): void {
  results.push(detail === undefined ? { name, ok } : { name, ok, detail });
  console.log(ok ? `[OK]   ${name}` : `[FAIL] ${name}${detail ? `\n       ${detail}` : ''}`);
}
async function tryStep(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    record(name, true);
  } catch (e) {
    record(name, false, e instanceof Error ? (e.stack ?? e.message) : String(e));
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// --- fetch stub (Gemini + Meta num dispatcher só) -----------------------------
type FetchFn = typeof globalThis.fetch;
const realFetch: FetchFn = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const G_USAGE = { promptTokenCount: 1200, candidatesTokenCount: 150 };
const gText = (t: string): Response =>
  jsonResponse({ candidates: [{ content: { parts: [{ text: t }] } }], usageMetadata: G_USAGE });
const gCall = (name: string, args: object): Response =>
  jsonResponse({
    candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }],
    usageMetadata: G_USAGE,
  });
const g503 = (): Response => jsonResponse({ error: { message: 'overloaded' } }, 503);

interface GeminiSeen {
  body: unknown;
  text: string;
}
const geminiSeen: GeminiSeen[] = [];
let geminiScript: Array<() => Response> = [];

globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const u = String(url);
  if (u.includes('generativelanguage.googleapis.com')) {
    const raw = String(init?.body ?? '');
    geminiSeen.push({ body: JSON.parse(raw), text: raw });
    const next = geminiScript.shift();
    return next ? next() : gText('RESPOSTA-GENERICA');
  }
  // Meta Graph (sendText) — sempre aceita.
  return jsonResponse({ messages: [{ id: `wamid.${randomUUID()}` }] }, 200);
}) as FetchFn;

function setScript(...steps: Array<() => Response>): void {
  geminiScript = steps;
}
function geminiCallCount(): number {
  return geminiSeen.length;
}

// --- fixtures ------------------------------------------------------------------
const created: string[] = [];

async function createClinic(tag: string): Promise<string> {
  const slug = `c11${tag}${Date.now().toString(36)}`.slice(0, 30).toLowerCase();
  const rows = await dbAdmin.execute<{ id: string }>(
    sql`INSERT INTO clinics (slug, nome, endereco, status) VALUES (${slug}, ${`Smoke C11 ${tag}`}, 'Rua Smoke, 11', 'active') RETURNING id`,
  );
  const id = rows[0]!.id;
  created.push(id);
  return id;
}

async function connectNumber(clinicId: string, metaPhoneId: string, phone: string): Promise<void> {
  const tokenEncrypted = await encryptForTenant(clinicId, 'TEST_TOKEN');
  await dbAdmin.execute(sql`
    INSERT INTO clinic_whatsapp_numbers
      (clinic_id, provider, phone_number, meta_phone_id, token_encrypted, verified_at, active)
    VALUES (${clinicId}, 'meta', ${phone}, ${metaPhoneId}, ${tokenEncrypted}, now(), true)`);
}

async function seedAiConfig(clinicId: string): Promise<void> {
  await dbAdmin.execute(sql`
    INSERT INTO ai_clinic_config (clinic_id, working_hours, especialidades, max_days_ahead)
    VALUES (${clinicId}, ${'{"seg_sex":"08:00-18:00"}'}::jsonb, ARRAY['cardiologia'], 30)`);
}

async function seedProcedure(clinicId: string): Promise<void> {
  await dbAdmin.execute(sql`
    INSERT INTO procedures (clinic_id, codigo, descricao, categoria, valor_padrao, duracao_padrao_min, ativo)
    VALUES (${clinicId}, 'CONS01', 'Consulta cardiológica', 'consulta', 250.00, 30, true)`);
}

let wamidSeq = 0;
function makeMsg(phoneId: string, from: string, text: string): ParsedInboundMessage {
  wamidSeq += 1;
  return {
    providerMessageId: `wamid.c11.${Date.now().toString(36)}.${wamidSeq}`,
    fromNumber: from,
    toPhoneId: phoneId,
    toNumber: '551140000000',
    text,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
}

/** Entrega o inbound e roda 1 tick do worker. Retorna o eventId do turno. */
async function deliverTurn(
  clinicId: string,
  phoneId: string,
  from: string,
  text: string,
): Promise<string> {
  const msg = makeMsg(phoneId, from, text);
  await persistInbound(clinicId, 'meta', msg);
  const ev = await dbAdmin.execute<{ id: string }>(
    sql`SELECT id FROM outbox WHERE event_type = 'messaging.inbound.received'
        AND idempotency_key = ${`inbound:meta:${msg.providerMessageId}`}`,
  );
  const eventId = ev[0]!.id;
  await runOutboxOnce({ batchSize: 10, parallelism: 1 });
  return eventId;
}

// --- leitura de resultados --------------------------------------------------------
// type (não interface): aliases ganham index-signature implícita e satisfazem
// o constraint Record<string, unknown> do dbAdmin.execute<T>.
type OutRow = {
  conversation_id: string;
  content_encrypted: string;
  tokens_input: number | null;
  tokens_output: number | null;
  cost_usd: string | null;
  model: string | null;
  prompt_version: string | null;
  prompt_hash: string | null;
  prompt_snapshot_encrypted: string | null;
  ai_request_id: string | null;
  latency_ms: number | null;
};

async function getOutRow(eventId: string): Promise<OutRow | null> {
  const r = await dbAdmin.execute<OutRow>(
    sql`SELECT conversation_id, content_encrypted, tokens_input, tokens_output, cost_usd, model,
               prompt_version, prompt_hash, prompt_snapshot_encrypted, ai_request_id, latency_ms
        FROM ai_messages WHERE event_id = ${eventId} AND direction = 'out' LIMIT 1`,
  );
  return r[0] ?? null;
}

async function getSentText(clinicId: string, eventId: string): Promise<string | null> {
  const r = await dbAdmin.execute<{ content_encrypted: string }>(
    sql`SELECT content_encrypted FROM outbound_messages
        WHERE clinic_id = ${clinicId} AND idempotency_key = ${eventId} LIMIT 1`,
  );
  return r[0] ? decryptForTenant(clinicId, r[0].content_encrypted) : null;
}

async function getTurnOutcome(eventId: string): Promise<string | null> {
  const r = await dbAdmin.execute<{ payload: { outcome?: string } }>(
    sql`SELECT payload FROM outbox WHERE event_type = 'ai_agent.conversation.completed'
        AND idempotency_key = ${`ai-turn:${eventId}`} LIMIT 1`,
  );
  return r[0]?.payload?.outcome ?? null;
}

async function getProcessedAt(clinicId: string, eventId: string): Promise<boolean> {
  const r = await dbAdmin.execute<{ p: string | null }>(
    sql`SELECT i.processed_at AS p FROM inbound_messages_raw i
        JOIN outbox o ON o.payload->>'inboundMessageId' = i.id::text
        WHERE o.id = ${eventId} AND i.clinic_id = ${clinicId}`,
  );
  return r[0]?.p !== null && r[0]?.p !== undefined;
}

async function getFailures(clinicId: string, stage: string): Promise<number> {
  const r = await dbAdmin.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM ai_agent_failures WHERE clinic_id = ${clinicId} AND stage = ${stage}`,
  );
  return Number(r[0]?.n ?? 0);
}

// --- contatos -----------------------------------------------------------------
const A1 = '5511999990001';
const A2 = '5511999990002';
const A3 = '5511999990003';
const A4 = '5511999990004';
const A5 = '5511999990005';
const A6 = '5511999990006';
const A7 = '5511999990007';
const A8 = '5511999990008';
const A9 = '5511999990009';
const A10 = '5511999990010';
const A11 = '5511999990011';
const B1 = '5511888880001';

// --- main -----------------------------------------------------------------------
async function main(): Promise<void> {
  aiCircuitTesting.reset();
  const clinicA = await createClinic('a');
  const clinicB = await createClinic('b');
  const phoneIdA = `PA11_${Date.now().toString(36)}`;
  const phoneIdB = `PB11_${Date.now().toString(36)}`;
  await connectNumber(clinicA, phoneIdA, '551140000021');
  await connectNumber(clinicB, phoneIdB, '551140000022');
  await seedAiConfig(clinicA);
  await seedAiConfig(clinicB);
  await seedProcedure(clinicA);

  // 0. pré-flight estrutural
  await tryStep('0 pré-flight: RLS FORCE nas 5 tabelas + ai_messages particionada + grants', async () => {
    for (const t of [
      'ai_conversations',
      'ai_messages',
      'ai_clinic_config',
      'ai_handoff_queue',
      'ai_agent_failures',
    ]) {
      const r = await dbAdmin.execute<{ rls: boolean; force: boolean }>(
        sql`SELECT relrowsecurity AS rls, relforcerowsecurity AS force FROM pg_class WHERE relname = ${t}`,
      );
      assert(r[0]?.rls === true && r[0]?.force === true, `${t} deveria ter ENABLE+FORCE RLS`);
    }
    const part = await dbAdmin.execute<{ kind: string; children: number }>(sql`
      SELECT c.relkind AS kind,
             (SELECT count(*)::int FROM pg_inherits WHERE inhparent = c.oid) AS children
      FROM pg_class c WHERE c.relname = 'ai_messages'`);
    assert(part[0]?.kind === 'p', 'ai_messages deveria ser particionada (relkind=p)');
    assert(Number(part[0]?.children) >= 13, `ai_messages deveria ter ≥13 partições (12 meses + default), tem ${part[0]?.children}`);
    const grants = await dbAdmin.execute<{ msg_upd: boolean; inb_upd: boolean; inb_upd_other: boolean }>(sql`
      SELECT has_table_privilege('authenticated', 'ai_messages', 'UPDATE') AS msg_upd,
             has_column_privilege('authenticated', 'inbound_messages_raw', 'processed_at', 'UPDATE') AS inb_upd,
             has_column_privilege('authenticated', 'inbound_messages_raw', 'content_encrypted', 'UPDATE') AS inb_upd_other`);
    assert(grants[0]?.msg_upd === false, 'ai_messages deveria ser append-only p/ authenticated');
    assert(grants[0]?.inb_upd === true, 'authenticated deveria poder UPDATE processed_at (C11)');
    assert(grants[0]?.inb_upd_other === false, 'UPDATE de outras colunas do inbound deveria seguir negado');
  });

  // 1. turno feliz com tool provide_clinic_info (clinic A, contato 1)
  let evA1t1 = '';
  await tryStep('1 turno A1: tool provide_clinic_info → resposta enviada', async () => {
    setScript(
      () => gCall('provide_clinic_info', {}),
      () => gText('ISOLATION-A1-RESPOSTA Funcionamos de segunda a sexta, das 8h às 18h.'),
    );
    evA1t1 = await deliverTurn(clinicA, phoneIdA, A1, 'ISOLATION-A1 qual o funcionamento de voces?');
    assert((await getTurnOutcome(evA1t1)) === 'replied', 'outcome deveria ser replied');
    const sent = await getSentText(clinicA, evA1t1);
    assert(sent === 'ISOLATION-A1-RESPOSTA Funcionamos de segunda a sexta, das 8h às 18h.', `resposta enviada inesperada: ${sent}`);
    assert(await getProcessedAt(clinicA, evA1t1), 'inbound deveria estar processed');
    // a re-chamada recebeu o functionResponse com os dados reais da clínica
    const lastReq = geminiSeen.at(-1)!.text;
    assert(lastReq.includes('functionResponse'), 're-chamada deveria conter functionResponse');
    assert(lastReq.includes('Smoke C11 a'), 'tool deveria ter devolvido o nome real da clínica');
  });

  // 2. turno com tool provide_procedure_price (clinic A, contato 2)
  await tryStep('2 turno A2: tool provide_procedure_price devolve preço do catálogo', async () => {
    setScript(
      () => gCall('provide_procedure_price', { procedure_name: 'consulta' }),
      () => gText('A consulta cardiológica custa R$ 250.'),
    );
    const ev = await deliverTurn(clinicA, phoneIdA, A2, 'ISOLATION-A2 qual o valor da consulta?');
    assert((await getTurnOutcome(ev)) === 'replied', 'outcome deveria ser replied');
    const lastReq = geminiSeen.at(-1)!.text;
    assert(lastReq.includes('Consulta cardiol') && lastReq.includes('250'), 'functionResponse deveria conter o procedimento e preço');
  });

  // 3. turno clinic B (texto direto, sem tools)
  await tryStep('3 turno B1: resposta direta sem tools', async () => {
    setScript(() => gText('Olá! Como posso ajudar?'));
    const ev = await deliverTurn(clinicB, phoneIdB, B1, 'ISOLATION-B bom dia');
    assert((await getTurnOutcome(ev)) === 'replied', 'outcome deveria ser replied');
    assert((await getSentText(clinicB, ev)) === 'Olá! Como posso ajudar?', 'resposta de B inesperada');
  });

  // 4. 11.6.1 — isolamento: 2º turno de A1 vê SÓ a própria história
  await tryStep('4 (11.6.1) isolamento: prompt de A1 não contém A2 nem B', async () => {
    setScript(() => gText('Nosso endereço é Rua Smoke, 11.'));
    const before = geminiCallCount();
    const ev = await deliverTurn(clinicA, phoneIdA, A1, 'e qual o endereco?');
    assert(geminiCallCount() === before + 1, 'deveria ter exatamente 1 chamada Gemini');
    const req = geminiSeen.at(-1)!.text;
    assert(req.includes('ISOLATION-A1 qual o funcionamento'), 'história da PRÓPRIA conversa deveria estar no prompt');
    assert(req.includes('ISOLATION-A1-RESPOSTA'), 'resposta anterior da própria conversa deveria estar no prompt');
    assert(!req.includes('ISOLATION-A2'), 'mensagem do contato A2 NÃO pode vazar no prompt de A1');
    assert(!req.includes('ISOLATION-B'), 'mensagem da clínica B NÃO pode vazar no prompt de A1');
    assert((await getTurnOutcome(ev)) === 'replied', 'outcome deveria ser replied');
    // 2 conversas em A + 1 em B
    const convs = await dbAdmin.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM ai_conversations WHERE clinic_id = ${clinicA}`,
    );
    assert(Number(convs[0]?.n) === 2, `clinic A deveria ter 2 conversas, tem ${convs[0]?.n}`);
  });

  // 5. 11.6.5 + G8/R6 — custo, tokens, versão e hash do prompt
  await tryStep('5 (11.6.5) custo registrado + prompt_version/hash (G8/R6)', async () => {
    const out = await getOutRow(evA1t1);
    assert(out !== null, 'out row do turno A1-t1 deveria existir');
    // 2 chamadas Gemini × (1200 in + 150 out) → (2400×0.30 + 300×2.50)/1M
    assert(Number(out!.cost_usd) === 0.00147, `cost_usd deveria ser 0.001470, foi ${out!.cost_usd}`);
    assert(out!.tokens_input === 2400 && out!.tokens_output === 300, 'tokens agregados das 2 chamadas');
    assert(out!.model === 'gemini-2.5-flash', 'model registrado');
    assert(out!.prompt_version === PROMPT_VERSION, 'prompt_version (G8)');
    assert(/^[a-f0-9]{64}$/.test(out!.prompt_hash ?? ''), 'prompt_hash sha256 (R6)');
    assert(out!.ai_request_id !== null, 'ai_request_id (R7)');
    assert((out!.latency_ms ?? -1) >= 0, 'latency_ms registrado');
  });

  // 6. R1/G10 — snapshot: decrypt + gunzip reconstrói o prompt
  await tryStep('6 (G10/R1) snapshot reconstrói prompt (gzip→cifra, modo full)', async () => {
    const out = await getOutRow(evA1t1);
    assert(out!.prompt_snapshot_encrypted !== null, 'snapshot deveria existir (AI_SNAPSHOT_MODE=full)');
    const b64 = await decryptForTenant(clinicA, out!.prompt_snapshot_encrypted!);
    const json = JSON.parse(gunzipSync(Buffer.from(b64, 'base64')).toString('utf8')) as {
      systemPrompt: string;
      messages: unknown[];
      toolResults: unknown[];
    };
    assert(json.systemPrompt.includes('assistente operacional'), 'snapshot.systemPrompt');
    assert(json.toolResults.length === 1, 'snapshot.toolResults da rodada de tools');
  });

  // 7. 11.6.6 — handoff: tool cria entrada + conversa não responde depois
  await tryStep('7 (11.6.6) request_human_handoff cria fila + silencia turnos seguintes', async () => {
    setScript(
      () => gCall('request_human_handoff', { reason: 'quer falar com humano' }),
      () => gText('Encaminhei você para um atendente humano!'),
    );
    const ev = await deliverTurn(clinicA, phoneIdA, A3, 'quero falar com uma pessoa');
    assert((await getTurnOutcome(ev)) === 'handoff', 'outcome deveria ser handoff');
    const q = await dbAdmin.execute<{ n: number; reason: string }>(
      sql`SELECT count(*)::int AS n, max(reason) AS reason FROM ai_handoff_queue h
          JOIN ai_conversations c ON c.id = h.conversation_id
          WHERE h.clinic_id = ${clinicA} AND c.patient_phone_hash =
            (SELECT patient_phone_hash FROM ai_conversations WHERE id = h.conversation_id)
          AND h.reason = 'quer falar com humano'`,
    );
    assert(Number(q[0]?.n) === 1, 'deveria ter 1 entrada na fila de handoff');
    // turno seguinte do MESMO contato → humano atendendo, agente NÃO responde
    const before = geminiCallCount();
    const ev2 = await deliverTurn(clinicA, phoneIdA, A3, 'oi, alguém aí?');
    assert(geminiCallCount() === before, 'conversa em handoff NÃO chama o LLM');
    assert((await getSentText(clinicA, ev2)) === null, 'conversa em handoff NÃO envia resposta automática');
    assert((await getTurnOutcome(ev2)) === 'handoff', 'outcome do turno silencioso = handoff');
  });

  // 8. 11.6.2 (smoke) — tool args malformados → fallback + dead letter
  await tryStep('8 (11.6.2/G7) tool args inválidos → fallback + ai_agent_failures', async () => {
    setScript(() => gCall('provide_procedure_price', { procedure_name: 12345 }));
    const ev = await deliverTurn(clinicA, phoneIdA, A4, 'preço?');
    assert((await getSentText(clinicA, ev)) === OPERATIONAL_FALLBACK, 'deveria responder fallback operacional');
    assert((await getTurnOutcome(ev)) === 'fallback', 'outcome fallback');
    assert((await getFailures(clinicA, 'tool_invalid')) >= 1, 'failures stage=tool_invalid');
  });

  // 9. G9 — tool desconhecida (alucinada) → security event + fallback
  await tryStep('9 (G9) tool alucinada delete_patient → tool_unknown + nunca executa', async () => {
    setScript(() => gCall('delete_patient', { patient_id: randomUUID() }));
    const ev = await deliverTurn(clinicA, phoneIdA, A5, 'me cadastra?');
    assert((await getSentText(clinicA, ev)) === OPERATIONAL_FALLBACK, 'fallback operacional');
    assert((await getFailures(clinicA, 'tool_unknown')) >= 1, 'failures stage=tool_unknown (security event)');
  });

  // 10. G1 — LLM insiste em tools após MAX_TOOL_ROUNDS → corta, nunca loopa
  await tryStep('10 (G1) rounds excedidos → fallback com exatamente 2 chamadas', async () => {
    setScript(
      () => gCall('provide_clinic_info', {}),
      () => gCall('provide_clinic_info', {}),
      () => gCall('provide_clinic_info', {}), // não deveria nunca ser consumida
    );
    const before = geminiCallCount();
    const ev = await deliverTurn(clinicA, phoneIdA, A6, 'horários?');
    assert(geminiCallCount() === before + 2, `deveria parar em 2 chamadas (1 + 1 re-call), fez ${geminiCallCount() - before}`);
    assert((await getSentText(clinicA, ev)) === OPERATIONAL_FALLBACK, 'fallback operacional');
  });

  // 11. 11.6.3/G4 — pré-filtro clínico: zero chamadas, fallback seguro
  await tryStep('11 (11.6.3/G4) "estou com dor no peito" → CLINICAL_FALLBACK sem Gemini', async () => {
    const before = geminiCallCount();
    const ev = await deliverTurn(clinicA, phoneIdA, A7, 'estou com dor no peito');
    assert(geminiCallCount() === before, 'pré-filtro NÃO pode chamar o Gemini (custo zero)');
    assert((await getSentText(clinicA, ev)) === CLINICAL_FALLBACK, 'resposta deveria ser o fallback clínico literal');
    assert((await getTurnOutcome(ev)) === 'prefiltered', 'outcome prefiltered');
    const out = await getOutRow(ev);
    assert(Number(out?.cost_usd ?? -1) === 0, 'custo do turno pré-filtrado = 0');
  });

  // 12. 11.6.3 — pós-guard: LLM tenta dar conselho clínico → interceptado
  await tryStep('12 (11.6.3) LLM responde conselho clínico → guard substitui', async () => {
    setScript(() => gText('Você está com sintomas de virose, tome dipirona 500mg.'));
    const ev = await deliverTurn(clinicA, phoneIdA, A8, 'obrigado pela ajuda de antes!');
    assert((await getSentText(clinicA, ev)) === CLINICAL_FALLBACK, 'guard pós-resposta deveria substituir pelo fallback');
    assert((await getFailures(clinicA, 'guard')) >= 1, 'failures stage=guard');
  });

  // 13. 11.6.4 + R3 — 3 falhas Gemini → breaker abre + conversa escala p/ handoff
  await tryStep('13 (11.6.4/R3) 3×503 → breaker aberto + fallback_threshold → handoff', async () => {
    aiCircuitTesting.reset();
    for (let i = 0; i < 3; i++) {
      setScript(() => g503());
      const ev = await deliverTurn(clinicA, phoneIdA, A9, `tentativa ${i + 1}`);
      assert((await getSentText(clinicA, ev)) === OPERATIONAL_FALLBACK, `turno ${i + 1} deveria ser fallback`);
    }
    // R3: 3 fallbacks consecutivos do contato → handoff automático
    const conv = await dbAdmin.execute<{ status: string; fb: number }>(
      sql`SELECT c.status, c.fallback_count AS fb FROM ai_conversations c
          WHERE c.clinic_id = ${clinicA}
          ORDER BY c.last_message_at DESC LIMIT 1`,
    );
    assert(conv[0]?.status === 'handoff' && Number(conv[0]?.fb) === 3, `3 fallbacks → status handoff (status=${conv[0]?.status}, fb=${conv[0]?.fb})`);
    const q = await dbAdmin.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM ai_handoff_queue WHERE clinic_id = ${clinicA} AND reason = 'fallback_threshold'`,
    );
    assert(Number(q[0]?.n) === 1, 'fila deveria ter a entrada fallback_threshold');
    // 11.6.4: breaker ABERTO → novo contato não gera chamada Gemini
    const before = geminiCallCount();
    const ev4 = await deliverTurn(clinicA, phoneIdA, A10, 'oi, tem horário amanhã?');
    assert(geminiCallCount() === before, 'breaker aberto NÃO pode chamar o Gemini');
    assert((await getSentText(clinicA, ev4)) === OPERATIONAL_FALLBACK, 'fallback durante circuito aberto');
    assert((await getFailures(clinicA, 'provider')) >= 4, 'failures stage=provider (3×503 + circuito aberto)');
    aiCircuitTesting.reset();
  });

  // 14. 11.6.7 — RLS em ai_messages
  await tryStep('14 (11.6.7) RLS: withTenant(B) não lê nem escreve ai_messages de A', async () => {
    const seen = await withTenant(clinicB, async (tx) => {
      const rows = await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM ai_messages WHERE clinic_id = ${clinicA}`,
      );
      return Number(rows[0]?.n ?? 0);
    });
    assert(seen === 0, `clínica B não deveria ver ai_messages de A (viu ${seen})`);
    const total = await dbAdmin.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM ai_messages WHERE clinic_id = ${clinicA}`,
    );
    assert(Number(total[0]?.n) > 0, 'sanidade: A TEM mensagens (dbAdmin vê)');
    // cross-write: B tenta inserir com clinic_id de A → RLS WITH CHECK rejeita
    let blocked = false;
    try {
      await withTenant(clinicB, async (tx) => {
        const convA = await dbAdmin.execute<{ id: string }>(
          sql`SELECT id FROM ai_conversations WHERE clinic_id = ${clinicA} LIMIT 1`,
        );
        await tx.execute(
          sql`INSERT INTO ai_messages (clinic_id, conversation_id, direction, content_encrypted, expires_at)
              VALUES (${clinicA}, ${convA[0]!.id}, 'in', 'hack', now() + interval '30 days')`,
        );
      });
    } catch {
      blocked = true;
    }
    assert(blocked, 'cross-write de B em A deveria ser rejeitado pela RLS');
  });

  // 15. 11.6.8 — encryption das mensagens
  await tryStep('15 (11.6.8) ciphertext sem plaintext + chave de B não decifra A', async () => {
    const rows = await dbAdmin.execute<{ ct: string }>(
      sql`SELECT content_encrypted AS ct FROM ai_messages WHERE clinic_id = ${clinicA} AND direction = 'in' LIMIT 5`,
    );
    assert(rows.length > 0, 'deveria haver mensagens cifradas');
    for (const { ct } of rows) {
      assert(!ct.includes('ISOLATION') && !ct.includes('dor no peito'), 'ciphertext não pode conter plaintext');
    }
    const sample = rows[0]!.ct;
    assert((await decryptForTenant(clinicA, sample)).length > 0, 'chave de A decifra A');
    let rejected = false;
    try {
      await decryptForTenant(clinicB, sample);
    } catch {
      rejected = true;
    }
    assert(rejected, 'chave de B deveria FALHAR no auth tag do ciphertext de A');
  });

  // 16. R2 — replay determinístico: out já persistida → zero chamada LLM
  await tryStep('16 (R2) re-entrada pós-FASE D reusa resposta sem re-chamar o LLM', async () => {
    const msg = makeMsg(phoneIdA, A11, 'replay?');
    await persistInbound(clinicA, 'meta', msg);
    const ev = await dbAdmin.execute<{ id: string }>(
      sql`SELECT id FROM outbox WHERE idempotency_key = ${`inbound:meta:${msg.providerMessageId}`}`,
    );
    const eventId = ev[0]!.id;
    // Simula crash entre FASE D e FASE E: conversa + in + out já commitadas.
    await withTenant(clinicA, async (tx) => {
      const conv = await findOrCreateConversation(
        tx,
        clinicA,
        (await dbAdmin.execute<{ h: string }>(
          sql`SELECT from_number_hash AS h FROM inbound_messages_raw WHERE provider_message_id = ${msg.providerMessageId}`,
        ))[0]!.h,
        await encryptForTenant(clinicA, A11),
      );
      await appendInboundMessage(tx, { clinicId: clinicA, conversationId: conv.id, eventId, text: 'replay?' });
      await appendOutboundMessage(tx, {
        clinicId: clinicA,
        conversationId: conv.id,
        eventId,
        aiRequestId: randomUUID(),
        text: 'RESPOSTA-REPLAY-DETERMINISTICA',
        costUsd: 0.000735,
      });
    });
    const before = geminiCallCount();
    await runOutboxOnce({ batchSize: 10, parallelism: 1 });
    assert(geminiCallCount() === before, 'replay NÃO pode re-chamar o LLM');
    assert((await getSentText(clinicA, eventId)) === 'RESPOSTA-REPLAY-DETERMINISTICA', 'envio reusa a resposta persistida');
    assert(await getProcessedAt(clinicA, eventId), 'turno replay concluído');
  });

  // 17. R4 — quota per-clinic bloqueia antes do LLM
  await tryStep('17 (R4) monthly_budget_usd estourado → QUOTA_FALLBACK sem Gemini', async () => {
    await dbAdmin.execute(
      sql`UPDATE ai_clinic_config SET monthly_budget_usd = 0.000001 WHERE clinic_id = ${clinicA}`,
    );
    const before = geminiCallCount();
    const ev = await deliverTurn(clinicA, phoneIdA, A2, 'mais uma pergunta de preço');
    assert(geminiCallCount() === before, 'quota bloqueada NÃO chama o Gemini');
    assert((await getSentText(clinicA, ev)) === QUOTA_FALLBACK, 'resposta deveria ser o fallback de quota');
    assert((await getTurnOutcome(ev)) === 'quota_blocked', 'outcome quota_blocked');
    await dbAdmin.execute(
      sql`UPDATE ai_clinic_config SET monthly_budget_usd = NULL WHERE clinic_id = ${clinicA}`,
    );
  });
}

// --- cleanup ---------------------------------------------------------------------
async function cleanup(): Promise<void> {
  globalThis.fetch = realFetch;
  for (const clinicId of created) {
    try {
      await dbAdmin.execute(sql`DELETE FROM clinics WHERE id = ${clinicId}`);
    } catch {
      /* best-effort */
    }
  }
}

main()
  .catch((e) => record('main', false, e instanceof Error ? (e.stack ?? e.message) : String(e)))
  .finally(async () => {
    await cleanup();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n=== smoke-c11: ${results.length - failed.length}/${results.length} passed ===`);
    process.exit(failed.length === 0 ? 0 : 1);
  });
