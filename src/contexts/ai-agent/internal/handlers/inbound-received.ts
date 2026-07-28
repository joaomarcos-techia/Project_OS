/**
 * Handler principal C11: messaging.inbound.received → turno do AI Agent.
 *
 * SAGA multi-fase (R2 — ADR-022, desvio documentado do ADR-011 §26): o LLM
 * JAMAIS roda dentro de uma transação de escrita. Cada fase abre seu próprio
 * `withTenant` CURTO (RLS aplicada) e commita antes do próximo I/O externo.
 *
 * Re-entrada (at-least-once) coberta por checkpoints idempotentes via eventId:
 *   - inbound.processed_at setado  → turno concluído, return imediato
 *   - ai_messages 'in' por eventId → FASE A pulada
 *   - ai_messages 'out' por eventId→ reusa a resposta persistida (replay
 *     determinístico — NÃO re-chama o LLM)
 *   - envio WhatsApp               → dedup por UNIQUE(clinic_id, idempotency_key)
 *     com idempotencyKey = eventId (re-entrega NUNCA duplica mensagem)
 * Custo LLM duplicado só em crash entre FASE B e FASE D (janela curta; risco
 * aceito e documentado na ADR-022).
 *
 * Fluxo (mandato C11 — nenhuma etapa removida):
 *   1 persiste inbound (ai_messages in)        6 re-chama LLM (1 rodada — G1)
 *   2 identifica conversa                      7 valida semanticamente (G4)
 *   3 constrói contexto (lazy — G3)            8 persiste resposta (+custo G8/R6/G10/R7)
 *   4 chama LLM (breaker, FORA de TX — R2)     9 envia WhatsApp (dedup eventId)
 *   5 executa tools (Zod in/out — G9/R5)      10 emite ai_agent.conversation.completed
 * Pré-filtro clínico (G4) e quota (R4) curto-circuitam ANTES do passo 4.
 */
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import { and, eq, sql } from 'drizzle-orm';

import { aiCircuit } from '@/lib/ai/circuit-breaker';
import { computeCostUsd } from '@/lib/ai/cost';
import { GeminiProvider } from '@/lib/ai/gemini';
import type { GenerateResult, ToolResult } from '@/lib/ai/provider';
import { decryptForTenant, encryptForTenant } from '@/lib/crypto';
import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { resolveAiSnapshotMode } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';
import { getAiAgentMode } from '@/lib/platform-settings';
import { PoisonPillError, serializeError } from '@/lib/outbox/errors';
import { publishEvent } from '@/lib/outbox/publish';
import { registerDetachedHandler } from '@/lib/outbox/registry';
import type { DetachedHandlerCtx } from '@/lib/outbox/types';

/* eslint-disable boundaries/element-types -- evento + API interna são o contrato PÚBLICO do Messaging (mesma exceção do handler financial/appointment-completed). */
import {
  MESSAGING_EVENTS,
  messagingApiV1,
  NumberNotConnectedError,
  SuppressedRecipientError,
  type InboundReceivedPayload,
} from '@/contexts/messaging';
/* eslint-enable boundaries/element-types */

import { agentIdemKey } from '@/lib/agent/actor';
/* eslint-disable boundaries/element-types -- patientApiV1 é a API interna pública (M14), mesma exceção das tools. */
import { patientApiV1 } from '@/contexts/patient';
/* eslint-enable boundaries/element-types */

import { AI_AGENT_EVENTS } from '../../events';
import { COLLECT_STALE_RESET_DAYS, MAX_COLLECT_STAGNATION, MAX_TOOL_ROUNDS } from '../../limits';
import {
  buildPromptMessages,
  buildSystemPrompt,
  CLINICAL_FALLBACK,
  OPERATIONAL_FALLBACK,
  PROMPT_HASH,
  PROMPT_VERSION,
  QUOTA_FALLBACK,
  truncateInbound,
} from '../../prompts/system';
import {
  checkClinicalContent,
  detectPromptInjection,
  isMedicalQuestion,
} from '../../guards/semantic-guard';
import { aiAgentFailures, aiConversations } from '../../schema';
import { listToolDeclarations, validateAndExecute } from '../../tools/registry';
// Side-effect: registram as tools no registry (whitelist G9). 3 da C11 + 10 da C12.
import '../../tools/provide-clinic-info';
import '../../tools/provide-procedure-price';
import '../../tools/request-human-handoff';
import '../../tools/list-slots';
import '../../tools/schedule-appointment';
import '../../tools/confirm-appointment';
import '../../tools/cancel-appointment';
import '../../tools/reschedule-appointment';
import '../../tools/list-pending-payments';
import '../../tools/lgpd-export-request';
import '../../tools/lgpd-delete-request';
import '../../tools/patient-lookup';
import '../../tools/collect-patient-data';
import {
  appendInboundMessage,
  appendOutboundMessage,
  clearCollectedData,
  escalateToHuman,
  findOrCreateConversation,
  findTurnMessages,
  getCollectedData,
  incrementFallback,
  resetFallback,
  setIntent,
} from '../conversation';
import type { ActiveConversation } from '../conversation';
import { buildContext } from '../context-builder';
import { checkQuota } from '../quota';
import { sanitizeAiFailurePayload } from '../sanitize';

// Teto por statement nas fases de DB (mesmo racional do financial handler:
// transaction-safe; não cobre I/O externo — esse tem AbortSignal próprio).
const STATEMENT_TIMEOUT_MS = 5_000;

type TurnOutcome =
  | 'replied'
  | 'fallback'
  | 'handoff'
  | 'suppressed'
  | 'quota_blocked'
  | 'prefiltered';

type FailureStage =
  | 'provider'
  | 'tool_invalid'
  | 'tool_unknown'
  | 'tool_output_invalid'
  | 'guard'
  | 'send';

/** withTenant curto com statement_timeout — todas as fases de DB usam isto. */
async function phase<T>(clinicId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(clinicId, async (tx) => {
    await tx.execute(
      sql`SELECT set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_MS)}, true)`,
    );
    return fn(tx);
  });
}

/** Dead letter de IA (G7) — fase própria (sobrevive ao fallback do turno). */
async function recordFailure(args: {
  clinicId: string;
  conversationId: string | null;
  eventId: string;
  aiRequestId: string;
  stage: FailureStage;
  error: unknown;
  model?: string | undefined;
  toolName?: string | undefined;
  issuePaths?: string[] | undefined;
  httpStatus?: number | undefined;
}): Promise<void> {
  const { message, code } = serializeError(args.error);
  try {
    await phase(args.clinicId, async (tx) => {
      await tx.insert(aiAgentFailures).values({
        clinicId: args.clinicId,
        conversationId: args.conversationId,
        eventId: args.eventId,
        aiRequestId: args.aiRequestId,
        stage: args.stage,
        errorCode: code,
        errorMessage: message,
        model: args.model ?? null,
        toolName: args.toolName ?? null,
        payload: sanitizeAiFailurePayload({
          toolName: args.toolName,
          zodIssuePaths: args.issuePaths,
          errorCode: code,
          model: args.model,
          httpStatus: args.httpStatus,
          stage: args.stage,
        }),
      });
    });
  } catch (e) {
    // Dead letter é best-effort: falhar aqui não pode matar o turno.
    metrics.emit('ai_agent.failure_record_error', { clinicId: args.clinicId, error: e });
  }
}

/**
 * C12 — resolve a coleta de paciente NOVO (handler, NÃO tool — par.12). Quando a
 * coleta está completa E confirmada, cria o paciente (ancorado no telefone
 * verificado). Conflito de criação (CPF de terceiro etc.) → handoff: a IA JAMAIS
 * age sobre cadastro alheio. Estagnação (MAX_COLLECT_STAGNATION) → handoff.
 */
async function resolveCollect(
  clinicId: string,
  conversation: ActiveConversation,
  eventId: string,
  aiRequestId: string,
): Promise<{ patientId?: string; handoff?: boolean }> {
  if (conversation.patientId) return {}; // já identificado pelo telefone
  const collected = await phase(clinicId, (tx) => getCollectedData(tx, clinicId, conversation.id));
  if (!collected) return {};

  const complete = !!(collected.nome && collected.cpf && collected.telefone && collected.motivo);
  if (!complete) {
    if ((collected._stagnation ?? 0) >= MAX_COLLECT_STAGNATION) {
      await phase(clinicId, (tx) => escalateToHuman(tx, clinicId, conversation.id, 'collect_stagnation'));
      return { handoff: true };
    }
    return {};
  }
  if (!collected._confirmed) return {}; // completo mas aguardando confirmação do resumo

  try {
    const patient = await patientApiV1.createPatientAsAgent(
      { clinicId, eventId, aiRequestId },
      { nome: collected.nome!, cpf: collected.cpf!, telefone: collected.telefone! },
      agentIdemKey(conversation.id, 'register_patient', { cpf: collected.cpf }),
    );
    await phase(clinicId, async (tx) => {
      await tx
        .update(aiConversations)
        .set({ patientId: patient.id })
        .where(and(eq(aiConversations.id, conversation.id), eq(aiConversations.clinicId, clinicId)));
      await clearCollectedData(tx, clinicId, conversation.id);
    });
    metrics.emit('ai_agent.patient.created', { clinicId, conversationId: conversation.id, aiRequestId });
    return { patientId: patient.id };
  } catch (err) {
    // CPF/e-mail já cadastrado (terceiro) ou erro → handoff (nunca linka alheio).
    await phase(clinicId, (tx) => escalateToHuman(tx, clinicId, conversation.id, 'patient_create_failed'));
    metrics.emit('ai_agent.patient.create_failed', {
      clinicId,
      conversationId: conversation.id,
      aiRequestId,
      error: err,
    });
    return { handoff: true };
  }
}

/** R1 — gate do snapshot: full grava sempre; sample ~10% determinístico. */
function shouldSnapshot(eventId: string): boolean {
  const mode = resolveAiSnapshotMode();
  if (mode === 'off') return false;
  if (mode === 'full') return true;
  // 'sample': determinístico pelo primeiro byte hex do eventId (~1/16 ≈ 6-12%).
  return eventId[0] === '0';
}

async function buildSnapshot(
  clinicId: string,
  eventId: string,
  systemPrompt: string,
  messages: Array<{ role: string; text: string }>,
  toolResults: ToolResult[],
): Promise<string | null> {
  if (!shouldSnapshot(eventId)) return null;
  const json = JSON.stringify({ systemPrompt, messages, toolResults });
  const gz = gzipSync(Buffer.from(json, 'utf8')).toString('base64');
  return encryptForTenant(clinicId, gz);
}

async function processInbound(ctx: DetachedHandlerCtx<InboundReceivedPayload>): Promise<void> {
  const { clinicId, payload, eventId } = ctx;

  // Defesa: clinicId do payload deve bater com o contexto RLS do worker.
  if (payload.clinicId !== clinicId) {
    throw new PoisonPillError(
      `clinicId divergente: payload=${payload.clinicId} ctx=${clinicId}`,
      'clinic_mismatch',
    );
  }

  // GUARD em transação curta: inbound + dedup final do turno.
  const inbound = await phase(clinicId, (tx) =>
    messagingApiV1.getInboundForAgent(tx, clinicId, payload.inboundMessageId),
  );
  if (!inbound) {
    throw new PoisonPillError(
      `inbound ${payload.inboundMessageId} inexistente para a clínica`,
      'inbound_not_found',
    );
  }
  if (inbound.processedAt !== null) return; // turno já concluído (re-entrega)

  const text = inbound.text.trim();
  if (!payload.hasText || text.length === 0 || inbound.fromNumber === null) {
    // Sem texto (mídia proibida em C10/C11) ou row pré-0024 sem telefone
    // cifrado: nada a responder — marca consumido e encerra.
    await phase(clinicId, (tx) => messagingApiV1.markInboundProcessed(tx, clinicId, inbound.id));
    metrics.emit('ai_agent.turn.skipped', {
      clinicId,
      eventId,
      reason: inbound.fromNumber === null ? 'no_reply_number' : 'no_text',
    });
    return;
  }
  const fromNumber = inbound.fromNumber;
  const aiRequestId = randomUUID(); // R7 — trace do turno

  // FASE A — conversa + mensagem 'in' (checkpoint por eventId).
  const { conversation, replayedOut } = await phase(clinicId, async (tx) => {
    const conv: ActiveConversation = await findOrCreateConversation(
      tx,
      clinicId,
      inbound.fromNumberHash,
      await encryptForTenant(clinicId, fromNumber),
    );
    const turn = await findTurnMessages(tx, clinicId, eventId);
    if (!turn.inRow) {
      await appendInboundMessage(tx, {
        clinicId,
        conversationId: conv.id,
        eventId,
        text: truncateInbound(text),
      });
    }
    return { conversation: conv, replayedOut: turn.outRow };
  });

  // C12 — staleness (COLLECT_STALE_RESET_DAYS): paciente sumiu por dias e voltou
  // → recomeça a coleta limpa em vez de retomar formulário stale. Só fora de
  // replay (replay não reprocessa). Usa o last_message_at ANTES deste turno.
  if (!replayedOut && conversation.lastMessageAt) {
    const ageMs = Date.now() - new Date(conversation.lastMessageAt).getTime();
    if (ageMs > COLLECT_STALE_RESET_DAYS * 86_400_000) {
      await phase(clinicId, (tx) => clearCollectedData(tx, clinicId, conversation.id));
    }
  }

  // Conversa em handoff: humano está atendendo — o agente registra o inbound
  // mas NÃO responde por cima.
  if (conversation.status === 'handoff' && !replayedOut) {
    await finalizeTurn(clinicId, conversation.id, inbound.id, eventId, {
      outcome: 'handoff',
      toolCallCount: 0,
      costUsd: 0,
    });
    return;
  }

  let outcome: TurnOutcome;
  let responseText: string;
  let toolCallCount = 0;
  let costUsd = 0;
  const usageTokens = { input: 0, output: 0 };
  let model: string | null = null;
  let latencyMs: number | undefined;
  let toolCallsRecord: unknown = null;
  let snapshot: string | null = null;
  let alreadyPersisted = false;

  const preFilter = isMedicalQuestion(text);
  // C12 (ADR-023) — injection é AUDIT-ONLY: não bloqueia (RLS + whitelist de
  // tools + recusa do LLM são a defesa real); só dá visibilidade.
  const injection = detectPromptInjection(text);
  if (!injection.safe) {
    metrics.emit('ai_agent.injection.detected', {
      clinicId,
      aiRequestId,
      matched: injection.matched,
    });
  }
  const quota =
    replayedOut || !preFilter.safe
      ? null
      : await phase(clinicId, (tx) => checkQuota(tx, clinicId));

  if (replayedOut) {
    // Re-entrada pós-FASE D: replay determinístico — NÃO re-chama o LLM.
    responseText = await decryptForTenant(clinicId, replayedOut.contentEncrypted);
    outcome = 'replied';
    toolCallCount = Array.isArray(replayedOut.toolCalls)
      ? (replayedOut.toolCalls as unknown[]).length
      : 0;
    costUsd = replayedOut.costUsd ? Number(replayedOut.costUsd) : 0;
    alreadyPersisted = true;
    metrics.emit('ai_agent.turn.replayed', { clinicId, eventId, aiRequestId });
  } else if (!preFilter.safe) {
    // G4 — pré-filtro clínico: custo zero, latência zero, zero LLM.
    responseText = CLINICAL_FALLBACK;
    outcome = 'prefiltered';
    metrics.emit('ai_agent.semantic_guard.prefiltered', {
      clinicId,
      aiRequestId,
      matched: preFilter.matched,
    });
  } else if (quota?.blocked) {
    responseText = QUOTA_FALLBACK;
    outcome = 'quota_blocked';
  } else if ((await getAiAgentMode()) === 'fallback_only') {
    // Kill-switch global (platform_settings): agente em degradação MANUAL.
    // Responde o fallback operacional SEM chamar o Gemini (custo zero) e reusa o
    // MESMO incrementFallback do fallback de falha de provider — escalona p/
    // humano após o limiar (não cria handoff a cada mensagem).
    responseText = OPERATIONAL_FALLBACK;
    const { escalated } = await phase(clinicId, (tx) =>
      incrementFallback(tx, clinicId, conversation.id),
    );
    outcome = escalated ? 'handoff' : 'fallback';
    metrics.emit('ai_agent.mode.fallback_only', { clinicId, aiRequestId });
  } else {
    // FASE B — contexto (TX curta de leitura) e LLM (SEM TX — R2).
    const promptCtx = await phase(clinicId, (tx) =>
      buildContext(tx, {
        clinicId,
        conversationId: conversation.id,
        currentMessage: text,
        patient:
          conversation.patientId && conversation.patientNome
            ? { id: conversation.patientId, nome: conversation.patientNome }
            : null,
        excludeEventId: eventId,
      }),
    );
    const systemPrompt = buildSystemPrompt(promptCtx);
    const messages = buildPromptMessages(promptCtx);
    const declarations = listToolDeclarations();
    const provider = new GeminiProvider();
    const t0 = Date.now();
    const toolResults: ToolResult[] = [];
    let fallback = false;
    let handoffExecuted = false;
    let result: GenerateResult | null = null;

    try {
      result = await aiCircuit.exec(() =>
        provider.generateWithTools({ systemPrompt, messages, tools: declarations }),
      );
      usageTokens.input += result.usage.tokensInput;
      usageTokens.output += result.usage.tokensOutput;
      model = result.usage.model;
    } catch (err) {
      await recordFailure({
        clinicId,
        conversationId: conversation.id,
        eventId,
        aiRequestId,
        stage: 'provider',
        error: err,
        model: model ?? undefined,
        httpStatus: (err as { httpStatus?: number })?.httpStatus ?? undefined,
      });
      fallback = true;
    }

    // FASE C — tools (TX curta por rodada, máx. MAX_TOOL_ROUNDS — G1).
    let rounds = 0;
    while (!fallback && result?.toolCalls && result.toolCalls.length > 0) {
      if (rounds >= MAX_TOOL_ROUNDS) {
        // G1 — NUNCA loop: excedeu o orçamento de rodadas → fallback.
        metrics.emit('ai_agent.tool.rounds_exceeded', { clinicId, aiRequestId, rounds });
        fallback = true;
        break;
      }
      rounds += 1;
      const calls = result.toolCalls;
      toolCallCount += calls.length;
      toolCallsRecord = calls.map((c) => ({ name: c.name }));

      const roundResults = await phase(clinicId, async (tx) => {
        const acc: ToolResult[] = [];
        for (const call of calls) {
          const exec = await validateAndExecute(call, {
            tx,
            clinicId,
            conversationId: conversation.id,
            eventId,
            aiRequestId,
            // C12 — identidade verificada por telefone (anti-spoofing).
            patientId: conversation.patientId,
            patientNome: conversation.patientNome,
            verifiedPhone: fromNumber,
            canDisclosePayments: promptCtx.aiConfig.canDisclosePayments,
          });
          if (!exec.ok) {
            const stage: FailureStage =
              exec.kind === 'unknown_tool'
                ? 'tool_unknown'
                : exec.kind === 'invalid_output'
                  ? 'tool_output_invalid'
                  : 'tool_invalid';
            return { failed: { stage, exec, toolName: call.name } as const, acc };
          }
          // Handoff via tool dedicado OU qualquer tool que sinalize handoff:true
          // (lgpd_*, list_pending_payments sem identidade/disclosure — C12).
          if (
            call.name === 'request_human_handoff' ||
            (exec.response as { handoff?: boolean }).handoff === true
          ) {
            handoffExecuted = true;
          }
          acc.push({ name: call.name, args: call.args, response: exec.response });
        }
        return { failed: null, acc };
      });

      if (roundResults.failed) {
        const f = roundResults.failed;
        await recordFailure({
          clinicId,
          conversationId: conversation.id,
          eventId,
          aiRequestId,
          stage: f.stage,
          error: new Error(f.exec.error),
          toolName: f.toolName,
          issuePaths: f.exec.issuePaths,
          model: model ?? undefined,
        });
        fallback = true;
        break;
      }
      toolResults.push(...roundResults.acc);

      // Re-chamada com toolResults (SEM TX — R2).
      try {
        result = await aiCircuit.exec(() =>
          provider.generateWithTools({ systemPrompt, messages, tools: declarations, toolResults }),
        );
        usageTokens.input += result.usage.tokensInput;
        usageTokens.output += result.usage.tokensOutput;
        model = result.usage.model;
      } catch (err) {
        await recordFailure({
          clinicId,
          conversationId: conversation.id,
          eventId,
          aiRequestId,
          stage: 'provider',
          error: err,
          model: model ?? undefined,
          httpStatus: (err as { httpStatus?: number })?.httpStatus ?? undefined,
        });
        fallback = true;
        break;
      }
    }

    latencyMs = Date.now() - t0;
    costUsd = computeCostUsd({
      tokensInput: usageTokens.input,
      tokensOutput: usageTokens.output,
      model: model ?? 'none',
    });

    // C12 — coleta concluída + confirmada → cria paciente (handler, NÃO tool).
    // Conflito de identidade/criação ou estagnação → handoff.
    let collectHandoff = false;
    if (!fallback) {
      const collect = await resolveCollect(clinicId, conversation, eventId, aiRequestId);
      if (collect.handoff) collectHandoff = true;
      else if (collect.patientId) conversation.patientId = collect.patientId;
    }

    if (collectHandoff) {
      responseText =
        'Recebi seus dados! Vou confirmar sua identidade com um atendente e já te retorno, ok?';
      outcome = 'handoff';
    } else if (fallback || !result?.text || result.text.trim().length === 0) {
      // Falha de provider/tool/rounds OU LLM sem texto → fallback operacional.
      // Se o handoff JÁ executou, o paciente recebe a confirmação do handoff.
      if (!fallback && handoffExecuted) {
        responseText =
          'Já encaminhei sua conversa para um atendente humano — você receberá retorno em breve.';
        outcome = 'handoff';
      } else {
        responseText = OPERATIONAL_FALLBACK;
        const { escalated } = await phase(clinicId, (tx) =>
          incrementFallback(tx, clinicId, conversation.id),
        );
        outcome = escalated ? 'handoff' : 'fallback';
      }
    } else {
      responseText = result.text;
      outcome = handoffExecuted ? 'handoff' : 'replied';
    }

    // C12 — intent canônico do turno (1ª tool) + reset de fallback no sucesso.
    const turnIntent =
      Array.isArray(toolCallsRecord) && toolCallsRecord.length > 0
        ? ((toolCallsRecord as Array<{ name: string }>)[0]?.name ?? null)
        : null;
    await phase(clinicId, async (tx) => {
      await setIntent(tx, clinicId, conversation.id, turnIntent);
      if (outcome === 'replied') await resetFallback(tx, clinicId, conversation.id);
    });

    // Validação semântica PÓS-resposta (G4 — defesa em profundidade).
    const post = checkClinicalContent(responseText);
    if (!post.safe) {
      await recordFailure({
        clinicId,
        conversationId: conversation.id,
        eventId,
        aiRequestId,
        stage: 'guard',
        error: new Error(`semantic guard: ${post.matched}`),
        model: model ?? undefined,
      });
      metrics.emit('ai_agent.semantic_guard.blocked', {
        clinicId,
        aiRequestId,
        matched: post.matched,
      });
      responseText = CLINICAL_FALLBACK;
    }

    snapshot = await buildSnapshot(clinicId, eventId, systemPrompt, messages, toolResults);
  }

  // FASE D — persiste a resposta (checkpoint 'out' por eventId).
  if (!alreadyPersisted) {
    await phase(clinicId, (tx) =>
      appendOutboundMessage(tx, {
        clinicId,
        conversationId: conversation.id,
        eventId,
        aiRequestId,
        text: responseText,
        toolCalls: toolCallsRecord,
        tokensInput: usageTokens.input,
        tokensOutput: usageTokens.output,
        costUsd,
        model,
        latencyMs,
        promptVersion: PROMPT_VERSION,
        promptHash: PROMPT_HASH,
        promptSnapshotEncrypted: snapshot,
      }),
    );
  }

  // FASE E — envia WhatsApp (dedup por idempotencyKey = eventId) + finaliza.
  try {
    await messagingApiV1.sendText({
      clinicId,
      toNumber: fromNumber,
      idempotencyKey: eventId,
      body: { kind: 'text', text: responseText },
    });
  } catch (err) {
    if (err instanceof SuppressedRecipientError) {
      outcome = 'suppressed'; // contato pediu para não receber — não envia
    } else if (err instanceof NumberNotConnectedError) {
      // Clínica sem número ativo: retry não resolve e re-chamaria o LLM —
      // registra na dead letter e conclui o turno sem envio.
      await recordFailure({
        clinicId,
        conversationId: conversation.id,
        eventId,
        aiRequestId,
        stage: 'send',
        error: err,
      });
      outcome = 'fallback';
    } else {
      await recordFailure({
        clinicId,
        conversationId: conversation.id,
        eventId,
        aiRequestId,
        stage: 'send',
        error: err,
      });
      throw err; // indeterminado → worker retenta (out-row já persistida = replay sem custo LLM)
    }
  }

  await finalizeTurn(clinicId, conversation.id, inbound.id, eventId, {
    outcome,
    toolCallCount,
    costUsd,
  });
  metrics.emit('ai_agent.turn.completed', {
    clinicId,
    conversationId: conversation.id,
    aiRequestId,
    outcome,
    toolCallCount,
    costUsd,
    latencyMs: latencyMs ?? 0,
  });
}

/** FASE E (final): marca inbound consumido + emite o evento do turno. */
async function finalizeTurn(
  clinicId: string,
  conversationId: string,
  inboundMessageId: string,
  eventId: string,
  result: { outcome: TurnOutcome; toolCallCount: number; costUsd: number },
): Promise<void> {
  await phase(clinicId, async (tx) => {
    await messagingApiV1.markInboundProcessed(tx, clinicId, inboundMessageId);
    await publishEvent(tx, {
      clinicId,
      eventType: AI_AGENT_EVENTS.CONVERSATION_COMPLETED,
      payload: {
        clinicId,
        conversationId,
        inboundMessageId,
        outcome: result.outcome,
        toolCallCount: result.toolCallCount,
        costUsd: result.costUsd,
      },
      idempotencyKey: `ai-turn:${eventId}`,
      correlationId: eventId,
    });
  });
}

registerDetachedHandler<InboundReceivedPayload>(MESSAGING_EVENTS.INBOUND_RECEIVED, processInbound);

/** Test-only: o smoke invoca o fluxo diretamente (fora do worker). */
export const __testing__ = { processInbound };
