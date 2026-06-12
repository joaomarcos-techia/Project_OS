# C11 — Auditoria de Implementação (AI Agent Base)

- Data: 2026-06-11
- Escopo: PlanoAção §11 (Gemini + Tools + Validação) + 2 rodadas de review do
  founder (gaps G1–G10 e R1–R10)
- Contratos: [ADR-022](../adr/022-ai-agent-foundation.md)
- Banco: migration `0024_ai_agent_core.sql` aplicada em qoro-dev

## Arquivos criados

**Lib de transporte LLM (`src/lib/ai/`)**
- `provider.ts` — interface `AIProvider` congelada + erros classificados
- `gemini.ts` — GeminiProvider (fetch cru, v1beta, generationConfig congelado R10)
- `openai.ts` — placeholder (preserva contrato; lança `openai_not_implemented`)
- `circuit-breaker.ts` — closed/open/half-open (3 falhas → 5 min)
- `cost.ts` — tabela de preços em código + `computeCostUsd` (tokens × $/1M)
- `circuit-breaker.test.ts`, `gemini.test.ts`, `cost.test.ts`

**Contexto `src/contexts/ai-agent/`**
- `schema.ts` — 5 tabelas (ai_conversations, ai_messages particionada,
  ai_clinic_config, ai_handoff_queue, ai_agent_failures)
- `events.ts` — `ai_agent.conversation.completed` (catalog)
- `limits.ts` — 5 orçamentos congelados (G1/G2/R3)
- `types.ts` — PromptContext e DTOs públicos
- `prompts/system.ts` — prompt em código + PROMPT_VERSION/PROMPT_HASH (G8/R6)
  + 3 fallbacks literais; `prompts/system.test.ts`
- `guards/semantic-guard.ts` — engine anti-SAMD em 2 bordas (G4);
  `guards/semantic-guard.test.ts`
- `tools/registry.ts` — framework Zod in/out + whitelist (G9/R5);
  `tools/registry.test.ts`; `tools/provide-clinic-info.ts`;
  `tools/provide-procedure-price.ts`; `tools/request-human-handoff.ts`
- `internal/conversation.ts` — persistência idempotente + recordCost +
  fallback→handoff (R3)
- `internal/context-builder.ts` — core lazy (G3)
- `internal/quota.ts` — quota placeholder per-clinic (R4)
- `internal/sanitize.ts` — `sanitizeAiFailurePayload` whitelist (R8);
  `internal/sanitize.test.ts`
- `internal/handlers/inbound-received.ts` — handler SAGA (R2)

**Outros**
- `src/contexts/messaging/api.ts` — `messagingApiV1` (seam C10→C11)
- `drizzle/migrations/0024_ai_agent_core.sql` (+ snapshot/journal)
- `scripts/smoke-c11.ts` — smoke e2e (18 passos)
- `scripts/gemini-live-check.ts` — validação com Gemini REAL
- `docs/adr/022-ai-agent-foundation.md`

## Arquivos alterados

- `src/lib/env.ts` — GEMINI_API_KEY, GEMINI_MODEL, AI_HTTP_TIMEOUT_MS,
  AI_MONTHLY_COST_LIMIT_USD, AI_SNAPSHOT_MODE + `assertAiRuntimeReady()` +
  `resolveAiSnapshotMode()`
- `src/contexts/messaging/schema.ts` — coluna aditiva `from_number_encrypted`
  (emenda ADR-020, ver ADR-022 §9)
- `src/contexts/messaging/internal/inbound.ts` — cifra o número do remetente
- `src/contexts/messaging/index.ts` — exporta `messagingApiV1` + erros
- `src/contexts/scheduling/api.ts` — método aditivo `listProcedures` (M14)
- `src/contexts/ai-agent/index.ts` — superfície pública populada
- `src/app/api/cron/outbox/handlers.ts` — registro do handler C11
- `src/app/api/cron/audit-partitions/route.ts` — mantém partições de
  `ai_messages` além de `audit_events`
- `scripts/check-handler-registry.ts` — `messaging.inbound.received` SAI da
  allowlist (ganhou handler); `ai_agent.conversation.completed` ENTRA
- `src/lib/db/schema/index.ts` — barrel += ai-agent
- `src/lib/sanitize/keys.ts` — chaves sensíveis C10/C11 (content/phone/snapshot)
- `vitest.config.ts` — GEMINI_API_KEY fictícia no env de teste
- `package.json` — scripts `smoke:c11` e `ai:live-check`

## Migrations criadas

- **0024_ai_agent_core.sql** — 3 enums; 5 tabelas (ai_messages reescrita à mão
  como `PARTITION BY RANGE (created_at)`, PK composta, 12 partições mensais
  2026-06→2027-05 + default); FKs (incl. da particionada, manuais); índices
  (unique parcial 1-conversa-ativa; dedup handoff aberto); triggers updated_at;
  RLS ENABLE+FORCE + defaultTenantPolicy(v1) nas 5 (mesma migration, ADR-007
  inv. #1); grants mínimos (ai_messages append-only; ai_clinic_config
  read-only p/ authenticated); `ALTER inbound_messages_raw ADD COLUMN
  from_number_encrypted`; `GRANT UPDATE (processed_at)` column-level.
  Aplicada em qoro-dev (`pnpm db:migrate:dev` ✓; `check:migrations` ✓).

## Eventos utilizados

- **Consumido:** `messaging.inbound.received` (handler registrado no boot file;
  removido de PRODUCER_AHEAD no mesmo PR — F-14)
- **Publicado:** `ai_agent.conversation.completed` (por turno; outcome ∈
  replied/fallback/handoff/suppressed/quota_blocked/prefiltered;
  `idempotencyKey = ai-turn:{eventId}`, `correlationId = eventId`;
  producer-ahead allowlisted até C14/C15)

## APIs utilizadas

- `messagingApiV1.getInboundForAgent` / `markInboundProcessed` (tx-aware) /
  `sendText` (3-fase própria) — criadas nesta camada como o seam C10→C11
- `schedulingApiV1.listProcedures` — aditivo M14, consumido SÓ pela tool de
  preço (lazy G3); `listSlots` NÃO usado em C11 (volta na C12)
- Leituras pela superfície pública (sem JOIN cross-context): `patients` por
  `telefone_hash` (precedente suppressionList no sender C10); `clinics`
  single-table read (precedente financial handler)
- Reuso integral de `src/lib/crypto` (encryptForTenant/decryptForTenant/
  hashForLookup — ADR-012), `publishEvent`, `registerHandler`, `withTenant`,
  `metrics`, `serializeError`

## Contratos congelados respeitados

- ADR-011: publishEvent único emissor; handler idempotente (checkpoints por
  eventId); payloads JSON-safe sem plaintext; PoisonPill p/ clinic_mismatch;
  cron auth intocada. *Desvio R2 (saga multi-TX vs ctx.tx único) documentado
  em ADR-022 §3 e exigido pela review do founder.*
- ADR-012: wire format de cifra intocado; chave per-tenant; hash HMAC global;
  decrypt points únicos (messaging: `getInboundForAgent`; ai-agent:
  janela/replay/snapshot internos)
- ADR-020: interface MessagingProvider intocada; dedups intocados; emenda
  ADITIVA documentada (coluna + grant + api.ts)
- ADR-007: RLS ENABLE+FORCE + dual-context na mesma migration; 5 tabelas
  tenant-scoped com clinic_id FK CASCADE
- §11.18: AIProvider, prompt em código, estrutura de tools, 3 tools, encryption
  per-tenant, schemas, cost model tokens×$/1M — todos congelados em ADR-022

## Violações encontradas

1. **C10 não persistia o telefone de resposta** (só hash) — o agente não tinha
   como responder a contatos não cadastrados. Encontrada no planejamento.
2. **inbound_messages_raw era append-only** (0022 revogou UPDATE) mas o schema
   declarava `processed_at` "preenchida pelo consumidor C11" — grant faltava.
3. **Plano original tinha LLM dentro da TX do worker** (1ª versão) — apontada
   pela 2ª review do founder como risco sistêmico (pool starvation).
4. **Duplicação da mensagem corrente no prompt** — `getRecentMessages` incluía
   a própria mensagem do turno (persistida na FASE A) na janela de histórico.

## Violações corrigidas

1. Coluna aditiva `from_number_encrypted` cifrada per-tenant (decisão do
   founder; documentada em ADR-022 §9; rows antigas = NULL → turno marca
   processed sem resposta, métrica `no_reply_number`).
2. `GRANT UPDATE (processed_at)` **column-level** na 0024 (outras colunas
   seguem negadas — provado no smoke passo 0).
3. Handler redesenhado como **saga multi-fase** com LLM fora de qualquer TX e
   checkpoints idempotentes (provado nos smokes 16 e 19).
4. `excludeEventId` na janela de memória.

## Riscos remanescentes

- **TX externa do worker idle** durante a saga (sem locks/writes) — inerente ao
  desenho do worker; teto = AI_HTTP_TIMEOUT_MS×2 + fases curtas; janitor 5min.
- **Custo LLM duplicado** em crash entre FASE B e D (janela curta; aceito).
- **Breaker em memória por instância** (G6) — multi-instance real exige
  Redis-based; hoje o worker roda em 1 cron.
- **Semantic guard regex/keyword** — falso negativo possível em fraseado
  inédito; mitigado por pré-filtro + pós-guard + prompt rigoroso; critério de
  avanço p/ C12 inclui a bateria de 50 mensagens adversariais com LLM real.
- **Partições de ai_messages pós-2027-05** dependem do cron audit-partitions
  (generalizado nesta camada); `ai_messages_default` é a rede de segurança.

## Débitos técnicos aceitáveis

- Purge por `expires_at` (ai_conversations/ai_messages 30d hot) — retention
  C16 (cron data-retention existente é o lugar natural).
- Quota real com usage_metrics/billing — C13 (placeholder funcional entregue).
- Handoff por "3 falhas de ENTENDIMENTO consecutivas" — C12 (C11 entrega o
  análogo R3: 3 fallbacks operacionais → handoff automático).
- Re-encrypt de ciphertext v1→v2 — C16 (igual ao débito do Patient).
- **G5 intent-lite** e **R9 debounce anti-spam** — adiados por decisão
  explícita do founder nas reviews (revisitar em C12/C13 e pré-produção real).
- Conversas `abandoned` após 24h sem resposta — enum já existe; job em C14.

## Débitos técnicos proibidos encontrados

Nenhum. Verificado contra a lista do mandato: sem schedule/cancel/reschedule,
sem memória longa/embeddings/vector DB, sem langchain/crewai/autogen, sem
multiagente, sem prompt customizado por clínica, sem multi-LLM runtime, sem
sentiment, sem áudio/STT/TTS. `OpenAIProvider` existe APENAS como contrato e
lança erro se invocado.

## Resultado dos testes 11.6.x (evidência)

Comandos: `pnpm test` (334/334 ✓), `pnpm smoke:c11` (**18/18 ✓** contra
qoro-dev, worker real + Gemini/Meta stubados), `pnpm ai:live-check` (Gemini
REAL ✓), `pnpm lint` ✓, `pnpm arch:check` ✓, `pnpm arch:db-check` (326 files,
0 findings) ✓, `pnpm check:migrations` ✓, `pnpm check:registry:strict`
(catalog 27 ⇔ registry 8, 19 producer-ahead) ✓, `pnpm build` ✓.

| Teste | Prova | Resultado |
|---|---|---|
| 11.6.1 conversa stateless (2 paralelas isoladas) | smoke 1–4: prompt de A1 contém SÓ a própria história; `ISOLATION-A2`/`ISOLATION-B` ausentes; 2 conversas distintas em A | ✓ |
| 11.6.2 tool call validado (Zod rejeita payload malformado) | unit registry.test (6 payloads malformados, handler 0 execuções) + smoke 8 (fallback + dead letter `tool_invalid`) | ✓ |
| 11.6.3 conselho clínico interceptado + fallback | unit semantic-guard (8 outputs clínicos bloqueados, 7 operacionais passam) + smoke 11 (pré-filtro, 0 chamadas Gemini, custo 0) + smoke 12 (pós-guard substitui por CLINICAL_FALLBACK) | ✓ |
| 11.6.4 circuit breaker: 3× Gemini 503 → abre | unit circuit-breaker (5 cenários, fake clock, half-open) + smoke 13 (3×503 reais no fluxo → 4º turno com 0 chamadas) | ✓ |
| 11.6.5 custo registrado | smoke 5: cost_usd = 0.00147 (2 calls × 1200/150 tokens), tokens agregados, model, latency + ai:live-check com usage REAL ($0.000462) | ✓ |
| 11.6.6 handoff cria entrada | smoke 7: fila criada + outcome handoff + turnos seguintes silenciados (humano atendendo) + smoke 13 (handoff automático por fallback_threshold — R3) | ✓ |
| 11.6.7 RLS em ai_messages | smoke 14: withTenant(B) lê 0 rows de A (dbAdmin vê >0); INSERT cross-tenant rejeitado por WITH CHECK; smoke 0: FORCE RLS nas 5 + particionada | ✓ |
| 11.6.8 encryption das mensagens | smoke 15: ciphertext sem plaintext; chave de A decifra; chave de B FALHA no GCM auth tag (padrão 5.6.3) | ✓ |

**Gaps do founder (evidência adicional):** G1 smoke 10 (corta em 2 chamadas) ·
G2 unit prompts (50k→4k; prompt ≤10k) · G4 smoke 11 · G7 smokes 8/9/12/13
(dead letter por estágio) · G8/R6 smoke 5 + unit · G9 smoke 9 + unit ·
G10/R1 smoke 6 (decrypt+gunzip reconstrói prompt) · R2 smokes 16 (replay sem
re-chamar LLM) e 19 (re-tick zero duplicação) · R3 smoke 13 · R4 smoke 17 ·
R5 unit (invalid_output) · R8 unit + smoke 9 (payload whitelisted) ·
R10 unit gemini (generationConfig congelado).

**Critério "pronto quando" (11.5) com LLM REAL:** `ai:live-check` provou
"qual o horário de funcionamento?" → functionCall `provide_clinic_info` →
functionResponse → "A Clínica Live Check funciona de segunda a sexta, das
08:00 às 18:00." com usageMetadata real.

**Gate de AVANÇO p/ C12 (§11.12) — APROVADO em 2026-06-12:** bateria de 50
mensagens adversariais com Gemini REAL (`pnpm ai:adversarial`, 53 chamadas,
$0.012): **0 respostas finais inseguras**; o modelo recusou **50/50** com o
fallback literal (incl. 6 jailbreaks); pré-filtro pegou 44/50 com custo zero.
Evidência completa: [C11_ADVERSARIAL_50.md](C11_ADVERSARIAL_50.md). Débito
aceitável adicional registrado: o pós-guard flagga a própria recusa do modelo
(contém "sintomas") — benigno, mas nos mistos a produção perde a metade
operacional da resposta; refino candidato em C12 (reconhecer o fallback
literal como já-seguro). Re-rodar a bateria a cada mudança de PROMPT_VERSION
ou de modelo.
