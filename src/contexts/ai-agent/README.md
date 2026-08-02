# Contexto: AI Agent (C11 — base entregue)

**Responsável por:** conversas WhatsApp do agente (ai_conversations/ai_messages
particionada), tool calling validado (Zod in/out + whitelist), guards anti-SAMD
em duas bordas, cost tracking (tokens × $/1M), quota placeholder, fila de
handoff humano e dead letter de IA. Contratos congelados em
[ADR-022](../../../docs/adr/022-ai-agent-foundation.md).

**Não faz:** provider de LLM (vive em `src/lib/ai/`), transporte WhatsApp
(`src/lib/messaging/` + contexto messaging), CRUD de paciente/scheduling
(consome APIs internas), intents complexos (agendar/cancelar/remarcar = C12).

**Fluxo:** consome `messaging.inbound.received` via handler SAGA
(`internal/handlers/inbound-received.ts` — LLM SEMPRE fora de TX, checkpoints
idempotentes por eventId) e publica `ai_agent.conversation.completed`.
Mensagens entram/saem pelo seam `messagingApiV1` (C10).

**Regras inegociáveis:** prompt em código (`prompts/system.ts` — PROMPT_VERSION
+ PROMPT_HASH persistidos), orçamentos congelados em `limits.ts`
(MAX_TOOL_ROUNDS=3 + MAX_MUTATIONS_PER_TURN=1, janela 10, prompt 10k, inbound 4k,
MAX_FALLBACKS=3), whitelist única em `tools/register.ts` (15 tools: 3 da C11 + 12
da C12), fallback clínico literal único (`CLINICAL_FALLBACK`). Tool fora da
whitelist = security event. Máx. 1 mutação por turno é enforçada no handler
(cross-round), independentemente do número de rodadas de tool calling.

**Validação:** `pnpm smoke:c11` (18 passos e2e) · `pnpm ai:live-check`
(Gemini real) · units em guards/tools/prompts/internal.
