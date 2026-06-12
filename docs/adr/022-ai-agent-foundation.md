# ADR-022 — Fundação do AI Agent (C11): provider, saga, guards e orçamentos

- Status: accepted
- Camada: C11 — AI Agent Base (Gemini + Tools + Validação)
- Refs: PlanoAção §11, VisãoGeral §6/§8.2, ADR-003/011 (outbox), ADR-012
  (encryption), ADR-020 (messaging — emendada aqui), ADR-007 (RLS)

## Context

A C10 entregou a fundação WhatsApp: inbound persistido cifrado e
`messaging.inbound.received` publicado no outbox (skipped até existir
consumidor). A C11 implementa esse consumidor: o agente conversacional
operacional (Gemini Flash 2.5) com tool calling validado, guards anti-SAMD,
cost tracking e handoff humano — **sem intents complexos** (C12), sem
RAG/embeddings/memória longa (proibidos no MVP, Kill Criteria §11.15).

O plano passou por **duas rodadas de review do founder** antes da
implementação (20 gaps identificados: G1–G10 e R1–R10). Este ADR congela os
contratos resultantes.

## Decision

### 1. AIProvider — transporte puro em `src/lib/ai/` (CONGELADO)

```ts
interface AIProvider {
  generateWithTools(opts: GenerateOpts): Promise<{ text?; toolCalls?; usage }>;
}
```

- `GeminiProvider` (default, fetch cru — padrão MetaCloudProvider, sem SDK) e
  `OpenAIProvider` **placeholder** (lança `openai_not_implemented`; preserva o
  contrato — multi-LLM runtime é proibido no MVP).
- **Jamais retorna payload cru** do provider; só `{ text, toolCalls, usage }`.
- Erros classificados como no messaging: HTTP de erro → `AIProviderError`
  (definitivo); timeout/abort → `AIProviderUnreachableError` (indeterminado).
- **R10 — generationConfig congelado em código**: `temperature: 0.1`,
  `topP: 0.9`. Não configurável por env/banco/clínica — mudança silenciosa de
  sampling é prompt drift invisível. Mudar exige bump de `PROMPT_VERSION` +
  nota aqui.

### 2. Prompt em código com versionamento duplo (G8/R6 — CONGELADO)

- `src/contexts/ai-agent/prompts/system.ts` — prompt NÃO editável, NÃO
  configurável, NÃO armazenado em banco. Parâmetros operacionais
  (horários/especialidades) entram como DADOS, nunca como template.
- `PROMPT_VERSION` (bump manual) **e** `PROMPT_HASH` (sha256 do template cru,
  computado no module load — detecta drift mesmo sem bump) são persistidos em
  `ai_messages` (rows `out`). Auditoria sempre sabe qual prompt gerou qual
  resposta.
- `CLINICAL_FALLBACK` é a string literal exata do mandato anti-SAMD e a única
  fonte (template, pré-filtro e pós-guard a referenciam).

### 3. Saga multi-fase: LLM FORA de transação (R2 — desvio documentado do ADR-011 §26)

O handler de `messaging.inbound.received` NÃO usa o `ctx.tx` do worker para o
fluxo (só guards read-only). Cada fase abre o próprio `withTenant` CURTO
(statement_timeout 5s) e commita ANTES de qualquer I/O de LLM/provider:

```
GUARD(ctx.tx ro) → FASE A (conversa + msg in) → [pré-filtro/quota/replay]
→ FASE B (LLM, SEM TX) → FASE C (tools em TX curta, re-call SEM TX)
→ FASE D (msg out + custo + snapshot) → FASE E (sendText dedup + processed + evento)
```

- Nenhum lock/write fica seguro durante chamada de Gemini (pool starvation era
  o maior risco sistêmico apontado na 2ª review).
- Re-entrada at-least-once coberta por **checkpoints idempotentes via
  `eventId`**: `processed_at` (turno completo), row `in`/`out` por `event_id`
  (replay determinístico — re-entrega NUNCA re-chama o LLM se a resposta já
  foi persistida), e envio WhatsApp dedupado por
  `UNIQUE(clinic_id, idempotency_key)` com `idempotencyKey = eventId`.
- Risco aceito: custo de LLM duplicado APENAS em crash entre FASE B e D
  (janela curta). A TX externa do worker fica idle/vazia durante a saga
  (inerente ao desenho do worker; sem locks).

### 4. Orçamentos congelados (`limits.ts` — G1/G2/R3)

| Constante | Valor | Efeito |
|---|---|---|
| `MAX_TOOL_ROUNDS` | 1 | exceder → fallback operacional, NUNCA loop |
| `MAX_CONTEXT_MESSAGES` | 10 | janela de memória da conversa |
| `MAX_PROMPT_CHARS` | 10.000 | derruba mensagens antigas primeiro |
| `MAX_INBOUND_CHARS` | 4.000 | truncamento determinístico (anti prompt-bomb) |
| `MAX_FALLBACKS` | 3 | atingiu → `status='handoff'` + fila automática |

### 5. Tools: whitelist + Zod nas DUAS direções (G9/R5 — CONGELADO)

`Tool = { name, description, inputSchema, outputSchema, handler }`. Pipeline
obrigatório: whitelist → Zod input → handler → Zod output. Tool fora do
registry é **security event** (`ai_agent.tool.unknown` + dead letter), não
erro comum. Output inválido nunca chega ao LLM. **Somente 3 tools em C11**:
`provide_clinic_info`, `provide_procedure_price` (via
`api.scheduling.listProcedures` — aditivo M14 ao contrato C6),
`request_human_handoff`.

### 6. Lazy context (G3)

`buildContext` produz APENAS o core (clínica, config, paciente por hash,
janela de mensagens decifradas). **Não consulta scheduling** — cada tool busca
os próprios dados sob demanda. `listSlots` saiu da C11 e volta na C12 com a
tool `list_slots`. (Desvio consciente do §11.2 a favor de custo/escala,
decidido na 1ª review.)

### 7. Semantic guard em DUAS bordas (G4)

Engine única regex/keyword pt-BR (acento-insensível; falso positivo aceitável,
falso negativo não): **pré-filtro** na mensagem do paciente (clínica → responde
`CLINICAL_FALLBACK` com custo/latência ZERO, sem LLM) e **pós-guard** na
resposta do LLM (substitui + dead letter `stage='guard'`).

### 8. Schema (5 tabelas, ADR-012/007 reusados)

`ai_conversations` (1 ativa por `(clinic, phone_hash)` — unique parcial),
`ai_messages` (**particionada por mês**, padrão audit_events; PK
`(id, created_at)`), `ai_clinic_config` (PK = clinic_id;
`monthly_budget_usd` — R4), `ai_handoff_queue` (dedup de handoff aberto),
`ai_agent_failures` (**dead letter de IA** — G7; payload SÓ via
`sanitizeAiFailurePayload`, whitelist R8: toolName/zodIssuePaths/errorCode/
model/httpStatus/stage — NUNCA telefone/nome/conteúdo/prompt).

Colunas além do §11.2, todas autorizadas nas reviews: `clinic_id` em
ai_messages (multi-tenant inegociável), `patient_phone_encrypted`
(VisãoGeral §6 — telefone de resposta), `event_id`/`prompt_version`/
`prompt_hash`/`prompt_snapshot_encrypted`/`ai_request_id` (R2/G8/R6/G10/R7).

### 9. Emenda aditiva ao ADR-020 (C10): `inbound_messages_raw.from_number_encrypted`

O C10 persistia só o HASH do remetente — irreversível, logo **impossível
responder**. Coluna aditiva nullable cifrada per-tenant (precedente ADR-021),
populada por `persistInbound`. O payload do evento segue sem plaintext. O C10
também ganhou `GRANT UPDATE (processed_at)` column-level (o marcador é
preenchido pelo consumidor C11, como previsto no schema da 0022) e a API
interna versionada `messagingApiV1` (`getInboundForAgent` — único decrypt
point de inbound do contexto —, `markInboundProcessed`, `sendText`).

### 10. Snapshot de replay com gate (G10/R1)

`prompt_snapshot_encrypted` = `encryptForTenant(gzip(JSON{systemPrompt,
messages, toolResults}))`. Gate `AI_SNAPSHOT_MODE`: `full` fora de produção,
`sample` (~1/16, determinístico por eventId) em produção, `off` disponível —
replay determinístico sem bomba de armazenamento.

### 11. Cost tracking + quota (CONGELADO: tokens × $/1M)

Tabela de preços EM CÓDIGO (`src/lib/ai/cost.ts`); modelo fora da tabela → 0 +
métrica. Persistido por turno em ai_messages. Quota placeholder (C13):
`SUM(cost_usd)` do mês vs `monthly_budget_usd ?? AI_MONTHLY_COST_LIMIT_USD` —
estourou → bloqueia ANTES do LLM.

### 12. Circuit breaker (parâmetros ainda mutáveis)

`src/lib/ai/circuit-breaker.ts`: 3 falhas consecutivas → aberto 5 min →
half-open (1 sonda). Aberto NÃO chama Gemini. Estado EM MEMÓRIA por instância
— improviso aceito (§11.17/G6); em multi-instance real, migrar para
Redis-based. Distinto do breaker do outbox (`lib/outbox/circuit.ts`).

### 13. Evento e trace

Único evento publicado: `ai_agent.conversation.completed` (por turno; payload
ids + outcome + contadores, sem plaintext; producer-ahead até C14/C15).
`correlationId = eventId` liga outbox→evento; `ai_request_id` (R7) correlaciona
métricas/failures/out-row do mesmo turno.

## Adiados por decisão explícita do founder

- **G5 intent-lite** (atalho sem LLM p/ perguntas óbvias) — "não é necessário
  agora"; revisitar após custos reais (C12/C13).
- **R9 debounce anti-spam** ("oi"×6 em segundos = 6 chamadas) — "baixa agora,
  alta quando entrar produção real" (C13/C14).

## Consequences

- (+) Gemini nunca roda dentro de transação; turnos idempotentes e replay
  determinístico; custo bounded por 5 tetos congelados; anti-SAMD em duas
  bordas com evidência (dead letter + métricas); auditoria completa de prompt.
- (−) Saga multi-TX é mais código que o handler single-tx canônico (ADR-011
  §26) — desvio documentado e testado (smoke 18/18).
- (−) Janela B→D pode duplicar custo de LLM em crash (aceito).
- Débitos rastreados: purge de `expires_at` (retention C16), re-encrypt
  v1→v2 (C16), breaker distribuído (escala), G5/R9 (acima).
