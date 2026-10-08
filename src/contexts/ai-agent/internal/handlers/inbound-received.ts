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
import {
  AIProviderError,
  type AIProvider,
  type GenerateOpts,
  type GenerateResult,
  type ToolResult,
} from '@/lib/ai/provider';
import { decryptForTenant, encryptForTenant, phoneLookupHashes } from '@/lib/crypto';
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
import {
  AI_COST_WINDOW_MINUTES,
  COALESCE_MAX_AGE_MS,
  COALESCE_MAX_MESSAGES,
  COLLECT_STALE_RESET_DAYS,
  MAX_AI_COST_USD_PER_CLINIC_WINDOW,
  MAX_COLLECT_STAGNATION,
  MAX_MUTATIONS_PER_TURN,
  MAX_TOOL_ROUNDS,
} from '../../limits';
import {
  buildPromptMessages,
  buildSystemPrompt,
  CLINICAL_FALLBACK,
  EMERGENCY_REPLY,
  OPERATIONAL_FALLBACK,
  OPERATIONAL_NUDGE,
  PROMPT_HASH,
  PROMPT_VERSION,
  truncateInbound,
} from '../../prompts/system';
import {
  checkClinicalContent,
  decideTurnGuard,
  detectHumanHandoffRequest,
  detectPromptInjection,
} from '../../guards/semantic-guard';
import { aiAgentFailures, aiConversations } from '../../schema';
import {
  getTool,
  listToolDeclarations,
  preflightToolCalls,
  validateAndExecute,
  type ToolContext,
} from '../../tools/registry';
// Side-effect: registra as tools no registry (whitelist G9). FONTE ÚNICA da
// whitelist (3 da C11 + 12 da C12) — compartilhada com os scripts de verificação
// (gemini-live-check / ai-adversarial-check) para garantir zero drift.
import '../../tools/register';
import {
  appendInboundMessage,
  appendOutboundMessage,
  clearCollectedData,
  escalateToHuman,
  findOrCreateConversation,
  findTurnMessages,
  getCollectedData,
  incrementFallback,
  isConversationInHandoff,
  mergeCollectedData,
  resetFallback,
  setCollectedData,
  setIntent,
} from '../conversation';
import type { ActiveConversation } from '../conversation';
import { buildContext, patientRegistrationState } from '../context-builder';
import {
  classifyConfirmation,
  executePendingAction,
  findPendingActionSummary,
  isExplicitConfirmation,
  type PendingActionExecutionResult,
} from '../pending-action';
import { appointmentTimeForPatient } from '../relative-datetime';
import { checkQuota, type QuotaCheck } from '../quota';
import { sanitizeAiFailurePayload } from '../sanitize';
import { toToolCallRecords } from '../tool-call-record';
import {
  patientRegistrationMessage,
  registrationFieldFromMessage,
  type RegistrationField,
} from '../../tools/collect-patient-data';
import type { CollectedData, PatientRegistrationState } from '../../types';

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

/**
 * Quantas das tool calls têm efeito de MUTAÇÃO (whitelist). Base do teto de
 * `MAX_MUTATIONS_PER_TURN` contado através das rodadas de tool calling. Tool
 * desconhecida conta como 0 aqui (o preflight já a barra como security event).
 */
export function roundMutationCount(calls: Array<{ name: string }>): number {
  return calls.filter((c) => getTool(c.name)?.effect === 'mutation').length;
}

function patientRegisteredReply(procedureName: string | null): string {
  if (procedureName) {
    return `Cadastro concluído. Para agendar ${procedureName}, informe a data e o horário de preferência.`;
  }
  return 'Cadastro concluído. Para continuar o agendamento, informe a data e o horário de preferência.';
}

const REGISTRATION_FIELDS = [
  'nome',
  'cpf',
  'motivo',
] as const satisfies readonly RegistrationField[];
const MAX_TRANSIENT_ATTEMPTS = 3;
/** Espera curta antes de repetir um 5xx: dá fôlego a um provider sobrecarregado. */
const SERVER_ERROR_BACKOFF_MS = 400;

/**
 * Falhas TRANSITÓRIAS do Gemini repetem até três vezes. A geração não tem efeito
 * externo, então repetir é seguro:
 *   - HTTP 200 sem candidate utilizável (já visto em produção);
 *   - HTTP 5xx — "The service is currently unavailable" (503) apareceu no probe
 *     de 08/10/2026 e virava, sozinho, "um atendente vai te responder".
 * Timeout NÃO repete: o turno inteiro roda dentro do orçamento de 60 s da
 * função, e uma segunda espera longa estouraria esse teto. 4xx também não: a
 * mesma requisição seria recusada de novo.
 */
export async function generateWithTransientRetry(
  provider: Pick<AIProvider, 'generateWithTools'>,
  opts: GenerateOpts,
): Promise<GenerateResult> {
  for (let attempt = 1; attempt <= MAX_TRANSIENT_ATTEMPTS; attempt += 1) {
    try {
      return await provider.generateWithTools(opts);
    } catch (err) {
      const code = err instanceof AIProviderError ? err.code : null;
      const transient = code === 'gemini_empty_response' || code === 'gemini_server_error';
      if (!transient || attempt >= MAX_TRANSIENT_ATTEMPTS) throw err;
      if (code === 'gemini_server_error') {
        metrics.emit('ai_agent.provider.server_error_retry', { attempt });
        await new Promise((resolve) => setTimeout(resolve, SERVER_ERROR_BACKOFF_MS * attempt));
      } else {
        metrics.emit('ai_agent.provider.empty_response_retry', { attempt });
      }
    }
  }
  throw new Error('unreachable transient retry state');
}

function nextRegistrationField(data: CollectedData): RegistrationField | null {
  return REGISTRATION_FIELDS.find((field) => !data[field]) ?? null;
}

/** Inicia a coleta somente depois de a tool de agenda a exigir. */
async function startPatientRegistration(
  clinicId: string,
  conversationId: string,
  verifiedPhone: string,
  procedureName: string | null,
): Promise<void> {
  await phase(clinicId, async (tx) => {
    const merged = await mergeCollectedData(tx, clinicId, conversationId, {
      telefone: verifiedPhone,
    });
    if (procedureName) {
      await setCollectedData(tx, clinicId, conversationId, {
        ...merged.data,
        _pendingProcedureName: procedureName,
      });
    }
  });
}

/**
 * Resultado de um turno de coleta conduzido pelo SERVIDOR (F-02).
 * `null` = não é turno de coleta; segue o fluxo normal com o LLM.
 */
type RegistrationTurn =
  | { kind: 'reply'; text: string }
  | { kind: 'handoff'; reason: 'collect_human_requested' | 'collect_stagnation' }
  | null;

/**
 * Uma vez iniciado o cadastro, o próximo campo é conhecido pelo servidor. A
 * validação do CPF e a gravação não dependem de o modelo selecionar ou preencher
 * collect_patient_data corretamente.
 *
 * F-02 (auditoria 2026-08-14) — este era um estado MODAL SEM SAÍDA. Duas
 * correções, ambas sobre o mesmo sintoma (o paciente preso repetindo um campo):
 *
 *   1. Uma resposta REJEITADA retornava antes de `mergeCollectedData`, então
 *      `_stagnation` nunca subia e `MAX_COLLECT_STAGNATION` nunca disparava.
 *      Agora a rejeição registra o não-avanço com um merge vazio.
 *   2. Não havia como pedir um humano: "quero falar com um atendente" era lido
 *      como nome inválido. Agora escala.
 *
 * Sem as duas, o turno ainda terminava como `replied` — que chama
 * `resetFallback` — e as DUAS válvulas de escape ficavam desarmadas ao mesmo
 * tempo.
 */
async function runRegistrationTurnServerSide(args: {
  clinicId: string;
  conversationId: string;
  verifiedPhone: string;
  text: string;
  state: PatientRegistrationState;
}): Promise<RegistrationTurn> {
  if (args.state.status !== 'collecting' || !args.state.nextRequiredField) return null;

  if (detectHumanHandoffRequest(args.text)) {
    return { kind: 'handoff', reason: 'collect_human_requested' };
  }

  const parsed = registrationFieldFromMessage(args.state.nextRequiredField, args.text);
  if (!parsed.accepted) {
    // Merge VAZIO: nada entra, mas o turno é contabilizado como sem progresso.
    const stalled = await phase(args.clinicId, (tx) =>
      mergeCollectedData(tx, args.clinicId, args.conversationId, {}),
    );
    if (stalled.stagnation >= MAX_COLLECT_STAGNATION) {
      return { kind: 'handoff', reason: 'collect_stagnation' };
    }
    return { kind: 'reply', text: parsed.patientMessage };
  }

  const partial: CollectedData = { ...parsed.partial, telefone: args.verifiedPhone };
  const merged = await phase(args.clinicId, (tx) =>
    mergeCollectedData(tx, args.clinicId, args.conversationId, partial),
  );
  return {
    kind: 'reply',
    text: patientRegistrationMessage({
      nextRequiredField: nextRegistrationField(merged.data),
      complete: merged.complete,
      confirmed: false,
    }),
  };
}

/**
 * Resposta do SERVIDOR para uma ação preparada que o paciente confirmou
 * (08/10/2026). Data e hora no fuso da clínica, como no resumo que ele leu.
 */
export function pendingConfirmationReply(
  result: Pick<PendingActionExecutionResult, 'action' | 'scheduledAt'>,
  timeZone: string,
): string {
  const when = result.scheduledAt ? appointmentTimeForPatient(result.scheduledAt, timeZone) : null;
  const at = when ? ` de ${when}` : '';
  switch (result.action) {
    case 'schedule_appointment':
      return when ? `Pronto! Consulta agendada para ${when}.` : 'Pronto! Consulta agendada.';
    case 'reschedule_appointment':
      return when ? `Pronto! Consulta reagendada para ${when}.` : 'Pronto! Consulta reagendada.';
    case 'confirm_appointment':
      return `Pronto! Presença confirmada na consulta${at}.`;
    case 'cancel_appointment':
      return `Pronto! A consulta${at} foi cancelada.`;
  }
}

/**
 * Por que a execução de uma ação confirmada falhou, na língua do paciente.
 * `null` = falha sem explicação útil: segue o fallback operacional.
 */
export function pendingConfirmationFailureReply(err: unknown): string | null {
  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : '';
  if (message.includes('expirou')) {
    return 'O resumo expirou antes da confirmação. Me diga de novo o que deseja e preparo outro para você confirmar.';
  }
  if (name === 'SchedulingConflictError') {
    return 'Esse horário acabou de ser ocupado. Me diga outro dia ou horário que eu verifico a agenda.';
  }
  if (message.includes('identidade do contato mudou') || message.includes('cadastre/identifique')) {
    return 'Não consegui confirmar com os dados atuais do seu cadastro. Me diga de novo o que deseja e preparo um novo resumo.';
  }
  return null;
}

function registrationWasRequired(toolResults: ToolResult[]): boolean {
  return toolResults.some(
    (result) =>
      result.name === 'prepare_appointment' &&
      (result.response as { status?: unknown }).status === 'patient_registration_required',
  );
}

/**
 * Serviço pedido antes do cadastro, preservado para retomar a agenda depois.
 *
 * F-01 (auditoria 2026-08-14) — o valor vem do TEXTO DO PACIENTE via args do
 * modelo, e é reapresentado a ele em "Cadastro concluído. Para agendar X...".
 * Se X carregar um termo clínico ("dor no joelho"), o pós-guard substitui a
 * resposta inteira pelo fallback clínico e o cadastro recém-concluído parece ter
 * falhado. Guardar `null` é melhor que guardar algo que envenena a própria
 * resposta — o paciente apenas reinforma o serviço.
 */
function requestedProcedureName(toolResults: ToolResult[]): string | null {
  const result = toolResults.find((item) => item.name === 'prepare_appointment');
  const value = (result?.args as { procedure_name?: unknown } | undefined)?.procedure_name;
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (name.length === 0 || name.length > 200) return null;
  return checkClinicalContent(name).safe ? name : null;
}

/**
 * A ferramenta de coleta devolve uma resposta operacional já validada. Não
 * deixamos o LLM reescrevê-la, pois isso gerava mensagens de erro inventadas
 * mesmo depois de o dado ter sido salvo.
 */
export function registrationReplyFromToolResults(toolResults: ToolResult[]): string | null {
  for (let i = toolResults.length - 1; i >= 0; i -= 1) {
    const result = toolResults[i]!;
    const response = result.response as {
      patient_message?: unknown;
      status?: unknown;
    };
    if (result.name === 'collect_patient_data' && typeof response.patient_message === 'string') {
      return response.patient_message;
    }
    if (
      result.name === 'prepare_appointment' &&
      response.status === 'patient_registration_required'
    ) {
      return patientRegistrationMessage({
        nextRequiredField: 'nome',
        complete: false,
        confirmed: false,
      });
    }
  }
  return null;
}

/**
 * Resultado de agenda vem do servidor e não pode ser reinterpretado pelo
 * modelo. Isso preserva o serviço e evita que uma marcação preparada vire um
 * encaminhamento genérico para atendimento humano.
 */
export function appointmentReplyFromToolResults(toolResults: ToolResult[]): string | null {
  for (let i = toolResults.length - 1; i >= 0; i -= 1) {
    const result = toolResults[i]!;
    // Reagendar segue o mesmo contrato desde 08/10/2026: o horário conferido
    // na agenda volta ao paciente exatamente como o servidor o escreveu.
    if (result.name !== 'prepare_appointment' && result.name !== 'reschedule_appointment') {
      continue;
    }

    const response = result.response as {
      patient_message?: unknown;
      status?: unknown;
      summary?: unknown;
    };
    if (response.status === 'appointment_prepared' && typeof response.summary === 'string') {
      return `${response.summary}\nResponda SIM para confirmar.`;
    }
    if (
      (response.status === 'appointment_information_required' ||
        response.status === 'appointment_unavailable') &&
      typeof response.patient_message === 'string'
    ) {
      return response.patient_message;
    }
  }
  return null;
}

function registrationReplyFromState(status: PatientRegistrationState['status']): string | null {
  if (status === 'awaiting_confirmation') {
    return patientRegistrationMessage({
      nextRequiredField: null,
      complete: true,
      confirmed: false,
    });
  }
  return null;
}

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
): Promise<{ patientId?: string; handoff?: boolean; pendingProcedureName?: string }> {
  if (conversation.patientId) return {}; // já identificado pelo telefone
  const collected = await phase(clinicId, (tx) => getCollectedData(tx, clinicId, conversation.id));
  if (!collected) return {};

  // F-02: a checagem de estagnação vinha DEPOIS de `!complete`, então o estado
  // "completo, aguardando SIM" não tinha escape nenhum — quem não conseguisse
  // produzir uma confirmação reconhecível ficava preso no resumo para sempre.
  if ((collected._stagnation ?? 0) >= MAX_COLLECT_STAGNATION) {
    await phase(clinicId, (tx) =>
      escalateToHuman(tx, clinicId, conversation.id, 'collect_stagnation'),
    );
    return { handoff: true };
  }
  const complete = !!(collected.nome && collected.cpf && collected.telefone && collected.motivo);
  if (!complete) return {};
  if (!collected._confirmed) return {}; // completo mas aguardando confirmação do resumo

  try {
    const patient = await patientApiV1.createPatientAsAgent(
      { clinicId, eventId, aiRequestId },
      { nome: collected.nome!, cpf: collected.cpf!, telefone: collected.telefone! },
      agentIdemKey(conversation.id, 'register_patient', { cpf: collected.cpf }),
    );
    const pendingProcedureName = collected._pendingProcedureName ?? null;
    await phase(clinicId, async (tx) => {
      await tx
        .update(aiConversations)
        .set({ patientId: patient.id })
        .where(
          and(eq(aiConversations.id, conversation.id), eq(aiConversations.clinicId, clinicId)),
        );
      // Remove PII do cadastro concluído, mas mantém o serviço escolhido para
      // que o próximo turno possa retomar o agendamento corretamente.
      await setCollectedData(
        tx,
        clinicId,
        conversation.id,
        pendingProcedureName ? { _pendingProcedureName: pendingProcedureName } : null,
      );
    });
    metrics.emit('ai_agent.patient.created', {
      clinicId,
      conversationId: conversation.id,
      aiRequestId,
    });
    return pendingProcedureName
      ? { patientId: patient.id, pendingProcedureName }
      : { patientId: patient.id };
  } catch (err) {
    // CPF/e-mail já cadastrado (terceiro) ou erro → handoff (nunca linka alheio).
    await phase(clinicId, (tx) =>
      escalateToHuman(tx, clinicId, conversation.id, 'patient_create_failed'),
    );
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
  // Cifra e hashes são CPU puro: calculados fora da transação.
  const fromNumberEncrypted = await encryptForTenant(clinicId, fromNumber);
  const identityHashes = await phoneLookupHashes(fromNumber);

  // FASE A — conversa + mensagem 'in' (checkpoint por eventId) + coalescing.
  const { conversation, replayedOut, turnText, coalesced } = await phase(clinicId, async (tx) => {
    const conv: ActiveConversation = await findOrCreateConversation(
      tx,
      clinicId,
      inbound.fromNumberHash,
      fromNumberEncrypted,
      identityHashes,
      inbound.contactNameEncrypted,
    );
    const turn = await findTurnMessages(tx, clinicId, eventId);
    if (turn.inRow) {
      // F-08 — a row 'in' É o checkpoint do coalescing: ela guarda o texto do
      // turno JÁ costurado. Um retry precisa reproduzir exatamente o mesmo
      // turno; reler `inbound.text` aqui descartaria em silêncio tudo que foi
      // absorvido na primeira tentativa.
      return {
        conversation: conv,
        replayedOut: turn.outRow,
        turnText: await decryptForTenant(clinicId, turn.inRow.contentEncrypted),
        coalesced: 0,
      };
    }

    // F-08 — absorve as mensagens que o paciente mandou na sequência e ainda
    // não foram consumidas. A reivindicação é atômica (ver claimPendingSiblings),
    // então o evento de outbox de cada irmã vira no-op no guard de
    // `processed_at` em vez de virar um turno concorrente.
    const siblings = await messagingApiV1.claimPendingSiblings(tx, clinicId, {
      fromNumberHash: inbound.fromNumberHash,
      excludeId: inbound.id,
      notBefore: new Date(Date.now() - COALESCE_MAX_AGE_MS),
      limit: COALESCE_MAX_MESSAGES - 1,
    });
    const joined = [text, ...siblings.map((s) => s.text.trim()).filter((t) => t.length > 0)].join(
      '\n',
    );
    const turnText = truncateInbound(joined);
    await appendInboundMessage(tx, {
      clinicId,
      conversationId: conv.id,
      eventId,
      text: turnText,
    });
    return {
      conversation: conv,
      replayedOut: turn.outRow,
      turnText,
      coalesced: siblings.length,
    };
  });

  if (coalesced > 0) {
    metrics.emit('ai_agent.turn.coalesced', {
      clinicId,
      conversationId: conversation.id,
      eventId,
      absorbed: coalesced,
    });
  }

  // C12 — staleness (COLLECT_STALE_RESET_DAYS): paciente sumiu por dias e voltou
  // → recomeça a coleta limpa em vez de retomar formulário stale. Só fora de
  // replay (replay não reprocessa). Usa o last_message_at ANTES deste turno.
  if (!replayedOut && conversation.lastMessageAt) {
    const ageMs = Date.now() - new Date(conversation.lastMessageAt).getTime();
    if (ageMs > COLLECT_STALE_RESET_DAYS * 86_400_000) {
      await phase(clinicId, (tx) => clearCollectedData(tx, clinicId, conversation.id));
    }
  }

  if (conversation.identityAmbiguous && !replayedOut) {
    const responseText =
      'Encontrei mais de um cadastro associado a este telefone. Para proteger os dados dos pacientes, encaminhei a conversa para um atendente confirmar sobre quem você deseja falar.';
    await phase(clinicId, async (tx) => {
      await escalateToHuman(tx, clinicId, conversation.id, 'shared_phone_identity_ambiguous');
      await appendOutboundMessage(tx, {
        clinicId,
        conversationId: conversation.id,
        eventId,
        aiRequestId,
        text: responseText,
        toolCalls: [],
        tokensInput: 0,
        tokensOutput: 0,
        costUsd: 0,
        model: null,
        promptVersion: PROMPT_VERSION,
        promptHash: PROMPT_HASH,
      });
    });
    let ambiguousOutcome: TurnOutcome = 'handoff';
    try {
      await messagingApiV1.sendText({
        clinicId,
        toNumber: fromNumber,
        idempotencyKey: eventId,
        body: { kind: 'text', text: responseText },
      });
    } catch (err) {
      if (err instanceof SuppressedRecipientError) ambiguousOutcome = 'suppressed';
      else throw err;
    }
    await finalizeTurn(clinicId, conversation.id, inbound.id, eventId, {
      outcome: ambiguousOutcome,
      toolCallCount: 0,
      costUsd: 0,
    });
    return;
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

  // R4 — teto de custo. A consulta só roda se a cadeia de ramos chegar até ela
  // (replay, pré-filtro clínico e kill-switch já responderam sem provider e sem
  // gastar uma query). `quotaExceeded` guarda o resultado para a métrica do ramo.
  let quotaCheck: QuotaCheck = {
    blocked: false,
    spendUsd: 0,
    limitUsd: MAX_AI_COST_USD_PER_CLINIC_WINDOW,
    windowMinutes: AI_COST_WINDOW_MINUTES,
  };
  const quotaExceeded = async (): Promise<boolean> => {
    quotaCheck = await phase(clinicId, (tx) => checkQuota(tx, clinicId));
    return quotaCheck.blocked;
  };

  // G4 + F-01 — o pré-filtro precisa saber se este é um turno de CADASTRO, que é
  // conduzido pelo servidor sem LLM (e portanto não pode ser barrado por conter
  // um sintoma no campo `motivo`). Uma leitura curta e indexada por conversa.
  const collectedForGuard = conversation.patientId
    ? null
    : await phase(clinicId, (tx) => getCollectedData(tx, clinicId, conversation.id));
  const guard = decideTurnGuard({
    text: turnText,
    registrationStatus: patientRegistrationState(
      conversation.patientId && conversation.patientNome
        ? { id: conversation.patientId, nome: conversation.patientNome }
        : null,
      collectedForGuard,
    ).status,
  });
  // C12 (ADR-023) — injection é AUDIT-ONLY: não bloqueia (RLS + whitelist de
  // tools + recusa do LLM são a defesa real); só dá visibilidade.
  const injection = detectPromptInjection(turnText);
  if (!injection.safe) {
    metrics.emit('ai_agent.injection.detected', {
      clinicId,
      aiRequestId,
      matched: injection.matched,
    });
  }
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
  } else if (guard.kind === 'emergency') {
    // Sinal de urgência (08/10/2026): orientação de emergência FIXA e um humano
    // da clínica na conversa — antes, o fallback clínico oferecia "marcar para
    // conversar com o médico" a quem talvez precisasse do SAMU. Sem LLM, sem
    // custo, e antes do cadastro: o relato nunca vira o campo `motivo`.
    responseText = EMERGENCY_REPLY;
    await phase(clinicId, (tx) =>
      escalateToHuman(tx, clinicId, conversation.id, 'clinical_emergency'),
    );
    outcome = 'handoff';
    metrics.emit('ai_agent.semantic_guard.emergency', {
      clinicId,
      aiRequestId,
      matched: guard.matched,
    });
  } else if (guard.kind === 'clinical_block' || guard.kind === 'clinical_with_operational') {
    // G4 — pré-filtro clínico: custo zero, latência zero, zero LLM.
    //
    // F-01: duas mudanças em relação à versão original, nenhuma delas afrouxando
    // a blacklist. (a) quando a mensagem também traz pedido operacional, a
    // recusa clínica vem ACOMPANHADA da retomada da jornada — antes o "quero
    // marcar" morria junto com o sintoma; (b) o turno passa a alimentar o
    // contador de fallback, então N mensagens clínicas seguidas acabam num
    // humano. Sem (b) o paciente repetia a mesma pergunta para sempre: este
    // ramo não incrementava nada e nunca escalava.
    responseText =
      guard.kind === 'clinical_with_operational'
        ? `${CLINICAL_FALLBACK}\n${OPERATIONAL_NUDGE}`
        : CLINICAL_FALLBACK;
    const { escalated } = await phase(clinicId, (tx) =>
      incrementFallback(tx, clinicId, conversation.id, 'clinical'),
    );
    outcome = escalated ? 'handoff' : 'prefiltered';
    metrics.emit('ai_agent.semantic_guard.prefiltered', {
      clinicId,
      aiRequestId,
      matched: guard.matched,
      mode: guard.kind,
      escalated,
    });
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
  } else if (await quotaExceeded()) {
    // R4 — teto de custo por clínica na janela (item 11 da auditoria
    // 2026-09-10). Vem DEPOIS do kill-switch e ANTES da FASE B: o objetivo é
    // não chamar o provider, então nada de contexto, prompt ou tool roda.
    // Mesmo tratamento do kill-switch: fallback operacional, custo zero, e o
    // contador de fallback escalona para humano em vez de deixar o paciente
    // num loop de "atendente responde em breve".
    responseText = OPERATIONAL_FALLBACK;
    const { escalated } = await phase(clinicId, (tx) =>
      incrementFallback(tx, clinicId, conversation.id),
    );
    // `quota_blocked` já existia no contrato do evento e o Billing já o ignora
    // na contagem de conversas — o outcome só nunca tinha sido gerado.
    outcome = escalated ? 'handoff' : 'quota_blocked';
    metrics.emit('ai_agent.quota.blocked', {
      clinicId,
      aiRequestId,
      spendUsd: quotaCheck.spendUsd,
      limitUsd: quotaCheck.limitUsd,
      windowMinutes: quotaCheck.windowMinutes,
      escalated,
    });
  } else {
    // FASE B — contexto (TX curta de leitura) e LLM (SEM TX — R2).
    const promptCtx = await phase(clinicId, (tx) =>
      buildContext(tx, {
        clinicId,
        conversationId: conversation.id,
        currentMessage: turnText,
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
    const registrationTurn = await runRegistrationTurnServerSide({
      clinicId,
      conversationId: conversation.id,
      verifiedPhone: fromNumber,
      text: turnText,
      state: promptCtx.patientRegistration,
    });
    // F-02 — as duas saídas do cadastro. Sem elas o paciente ficava preso: nem
    // o contador de estagnação subia (a rejeição retornava antes do merge), nem
    // um pedido de humano era reconhecido (virava "nome inválido").
    if (registrationTurn?.kind === 'handoff') {
      await phase(clinicId, (tx) =>
        escalateToHuman(tx, clinicId, conversation.id, registrationTurn.reason),
      );
      metrics.emit('ai_agent.registration.handoff', {
        clinicId,
        conversationId: conversation.id,
        aiRequestId,
        reason: registrationTurn.reason,
      });
    }
    const serverRegistrationReply =
      registrationTurn?.kind === 'reply' ? registrationTurn.text : null;
    const registrationHandoff = registrationTurn?.kind === 'handoff';
    // A confirmação do cadastro é um gate de consentimento do servidor, como
    // a confirmação de agenda. Assim, uma resposta "SIM" não depende do LLM
    // voltar a chamar a tool apenas para marcar o estado já completo.
    const confirmedRegistrationServerSide =
      promptCtx.patientRegistration.status === 'awaiting_confirmation' &&
      isExplicitConfirmation(turnText) &&
      (await phase(clinicId, async (tx) => {
        const collected = await getCollectedData(tx, clinicId, conversation.id);
        if (!collected) return false;
        await setCollectedData(tx, clinicId, conversation.id, {
          ...collected,
          _confirmed: true,
        });
        return true;
      }));
    if (confirmedRegistrationServerSide) {
      metrics.emit('ai_agent.patient.registration_confirmed', {
        clinicId,
        conversationId: conversation.id,
        aiRequestId,
        source: 'server',
      });
    }

    // Contexto autoritativo das tools — uma definição para o loop do LLM e
    // para a confirmação conduzida pelo servidor.
    const toolContext = (tx: Tx): ToolContext => ({
      tx,
      clinicId,
      conversationId: conversation.id,
      eventId,
      aiRequestId,
      // C12 — identidade verificada por telefone (anti-spoofing).
      patientId: conversation.patientId,
      patientNome: conversation.patientNome,
      identityAmbiguous: conversation.identityAmbiguous,
      verifiedPhone: fromNumber,
      currentMessage: turnText,
      canScheduleAnonymous: promptCtx.aiConfig.canScheduleAnonymous,
      maxDaysAhead: promptCtx.aiConfig.maxDaysAhead,
      clinicTimeZone: promptCtx.clinic.timezone,
      pendingAppointmentProcedureName: promptCtx.pendingAppointmentProcedureName,
      canDisclosePayments: promptCtx.aiConfig.canDisclosePayments,
    });

    // 08/10/2026 — o "SIM" a uma ação PREPARADA é um gate do servidor, como a
    // confirmação do cadastro. Ao vivo, o modelo respondeu a um "SIM" chamando
    // confirm_appointment em vez de confirm_pending_action, com scheduled_at
    // inválido: a tool falhou e o paciente recebeu "um atendente vai te
    // responder" depois de confirmar. A pendência e a confirmação explícita
    // (classifyConfirmation, pela AÇÃO preparada) bastam; o modelo não decide.
    let serverConfirmationReply: string | null = null;
    if (!serverRegistrationReply && !confirmedRegistrationServerSide && !registrationHandoff) {
      const pending = await phase(clinicId, (tx) =>
        findPendingActionSummary(tx, clinicId, conversation.id),
      );
      if (pending && classifyConfirmation(turnText, pending.actionName).confirmed) {
        toolCallCount += 1;
        toolCallsRecord = toToolCallRecords([{ name: 'confirm_pending_action', args: {} }]);
        try {
          const executed = await phase(clinicId, (tx) => executePendingAction(toolContext(tx)));
          serverConfirmationReply = pendingConfirmationReply(executed, promptCtx.clinic.timezone);
          metrics.emit('ai_agent.pending_action.confirmed_server_side', {
            clinicId,
            conversationId: conversation.id,
            aiRequestId,
            action: executed.action,
          });
        } catch (err) {
          await recordFailure({
            clinicId,
            conversationId: conversation.id,
            eventId,
            aiRequestId,
            stage: 'tool_invalid',
            error: err,
            toolName: 'confirm_pending_action',
          });
          serverConfirmationReply = pendingConfirmationFailureReply(err);
          if (!serverConfirmationReply) fallback = true;
        }
      }
    }

    if (
      !serverRegistrationReply &&
      !confirmedRegistrationServerSide &&
      !registrationHandoff &&
      !serverConfirmationReply &&
      !fallback
    ) {
      try {
        result = await aiCircuit.exec(() =>
          generateWithTransientRetry(provider, { systemPrompt, messages, tools: declarations }),
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
      // Mutações executadas neste TURNO, contadas ATRAVÉS das rodadas (G1). Com
      // MAX_TOOL_ROUNDS > 1, o teto de "1 mutação por turno" precisa ser explícito
      // aqui: o preflight só barra >1 mutação DENTRO de uma rodada.
      let mutationsThisTurn = 0;
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
        // F-16: além do nome, ids e instantes (whitelist) — `tool_calls` é jsonb
        // SEM cifra, então texto do paciente jamais entra aqui.
        toolCallsRecord = toToolCallRecords(calls);

        const preflight = preflightToolCalls(calls, {
          clinicId,
          aiRequestId,
        });
        if (!preflight.ok) {
          await recordFailure({
            clinicId,
            conversationId: conversation.id,
            eventId,
            aiRequestId,
            stage: preflight.kind === 'unknown_tool' ? 'tool_unknown' : 'tool_invalid',
            error: new Error(preflight.error),
            toolName: preflight.toolName,
            issuePaths: preflight.issuePaths,
            model: model ?? undefined,
          });
          fallback = true;
          break;
        }

        // Teto DURO de mutações por turno (MAX_MUTATIONS_PER_TURN), atravessando
        // rodadas: o preflight garante ≤1 mutação NESTA rodada, mas com >1 rodada
        // o modelo poderia mutar em rodadas distintas. Barra a 2ª antes de executá-la.
        const roundMutations = roundMutationCount(calls);
        if (mutationsThisTurn + roundMutations > MAX_MUTATIONS_PER_TURN) {
          metrics.emit('ai_agent.tool.multiple_mutations_rejected', {
            clinicId,
            aiRequestId,
            toolNames: calls.map((c) => c.name),
            reason: 'cross_round',
          });
          await recordFailure({
            clinicId,
            conversationId: conversation.id,
            eventId,
            aiRequestId,
            stage: 'tool_invalid',
            error: new Error('mais de uma mutação no mesmo turno (cross-round)'),
            model: model ?? undefined,
          });
          fallback = true;
          break;
        }

        const roundResults = await phase(clinicId, async (tx) => {
          const acc: ToolResult[] = [];
          for (const call of calls) {
            const exec = await validateAndExecute(call, toolContext(tx));
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
            // A assinatura opaca do provider volta com o resultado: sem ela, a
            // re-chamada a um modelo Gemini 3 responde 400 e o turno cai no fallback.
            acc.push({
              name: call.name,
              args: call.args,
              response: exec.response,
              ...(call.signature ? { signature: call.signature } : {}),
            });
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
        mutationsThisTurn += roundMutations;

        // Re-chamada com toolResults (SEM TX — R2).
        try {
          result = await aiCircuit.exec(() =>
            generateWithTransientRetry(provider, {
              systemPrompt,
              messages,
              tools: declarations,
              toolResults,
            }),
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
    }

    if (registrationWasRequired(toolResults)) {
      await startPatientRegistration(
        clinicId,
        conversation.id,
        fromNumber,
        requestedProcedureName(toolResults),
      );
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
    let patientCreated = false;
    let patientCreatedProcedureName: string | null = null;
    if (!fallback || confirmedRegistrationServerSide || toolResults.length > 0) {
      const collect = await resolveCollect(clinicId, conversation, eventId, aiRequestId);
      if (collect.handoff) collectHandoff = true;
      else if (collect.patientId) {
        conversation.patientId = collect.patientId;
        patientCreated = true;
        patientCreatedProcedureName = collect.pendingProcedureName ?? null;
      }
    }

    const operationalReply =
      serverConfirmationReply ??
      appointmentReplyFromToolResults(toolResults) ??
      serverRegistrationReply ??
      registrationReplyFromToolResults(toolResults) ??
      registrationReplyFromState(promptCtx.patientRegistration.status);

    if (registrationHandoff) {
      // F-02 — o cadastro travou (estagnação) ou o paciente pediu um humano.
      responseText =
        'Sem problema — encaminhei você para um atendente concluir o cadastro. Já te retornamos por aqui.';
      outcome = 'handoff';
    } else if (collectHandoff) {
      responseText =
        'Recebi seus dados! Vou confirmar sua identidade com um atendente e já te retorno, ok?';
      outcome = 'handoff';
    } else if (patientCreated) {
      responseText = patientRegisteredReply(patientCreatedProcedureName);
      outcome = 'replied';
    } else if (operationalReply) {
      responseText = operationalReply;
      outcome = 'replied';
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
      // Os turnos de coleta são conduzidos pelo servidor e não têm tool call.
      // Preserve prepare_appointment como intenção para retomar a agenda após o
      // cadastro, em vez de apagá-la por um intent null.
      if (!serverRegistrationReply) {
        await setIntent(tx, clinicId, conversation.id, turnIntent);
      }
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

  // F-09 — um humano pode ter assumido a conversa DURANTE este turno (a chamada
  // ao LLM leva segundos). Nesse caso o agente cala: não persiste 'out' nem
  // envia. A checagem fica ANTES da FASE D de propósito — uma linha 'out'
  // gravada e não entregue apareceria no painel como mensagem que o paciente
  // nunca recebeu. Turnos que ESCALARAM sozinhos precisam entregar seu aviso,
  // por isso `outcome === 'handoff'` é isento.
  if (!alreadyPersisted && outcome !== 'handoff') {
    const takenOver = await phase(clinicId, (tx) =>
      isConversationInHandoff(tx, clinicId, conversation.id),
    );
    if (takenOver) {
      metrics.emit('ai_agent.turn.handoff_race_dropped', {
        clinicId,
        conversationId: conversation.id,
        aiRequestId,
      });
      await finalizeTurn(clinicId, conversation.id, inbound.id, eventId, {
        outcome: 'handoff',
        toolCallCount,
        costUsd,
      });
      return;
    }
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
