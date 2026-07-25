# ADR-023 — AI Agent Intents Core (C12): ator de sistema, intents e memória

> **Verificação (2026-07-23)** — Decisão: ACTIVE · Implementação: IMPLEMENTED
> _Base: em produção (C0–C16 fechadas); confirmação por domínio na Onda 3._

- Status: accepted
- Camada: C12 — AI Agent Intents Core
- Refs: PlanoAção §12, ADR-022 (C11, fundação — estendida aqui), ADR-007 (RLS),
  ADR-011 (outbox/idempotência/audit), ADR-012 (encryption), ADR-008 (auth)

## Context

A C11 entregou a fundação (saga, provider, registry, guards, cost). A C12 faz o
agente **agir**: list_slots, schedule/confirm/cancel/reschedule, list_pending_payments,
LGPD e onboarding de paciente novo. É o primeiro ponto onde IA + Scheduling +
Patient + Financial + LGPD operam juntos. O plano passou por **5 rodadas de
review do founder**; este ADR congela os contratos e decisões resultantes.

**Problema técnico central:** toda mutação de Scheduling/Patient é Server Action
(`'use server'`) que chama `requireUser()`/`requireClinicId()`, e o próprio
`idempotentMutation` chamava `requireUser()`. O agente roda no **worker do outbox**
— sem request, sem sessão. C12 dá ao agente um **ator de sistema `ai_agent`**.

## Decision

### 1. Ator `ai_agent` reusa o pipeline (sem bifurcação — R5)
`idempotentMutation` ganhou um `actor?: { clinicId; userId: string | null }`
opcional (default = requireUser/requireClinicId — ZERO churn). Os corpos de
mutação foram extraídos para cores compartilhados
(`scheduling/internal/appointment-core.ts`, `patient/internal/patient-core.ts`)
chamados por AMBOS a Server Action (ator `'user'`) e o agente (ator `'ai_agent'`).
Validação IDÊNTICA; só muda o ator. `created_by`/`transitioned_by`/`user_id` =
null para a IA (colunas nullable); `actorType='ai_agent'` no state-log é a
identidade estável (R6) — **nunca** conversationId como identidade. O ator nunca
é exposto em função `'use server'` chamável pelo cliente (anti-forge).

**Mutation Extraction Gate (Phase 0):** a extração foi feita primeiro, isolada,
behavior-preserving, validada por `typecheck` + 334 testes unit + `smoke:c5` 8/8
+ `smoke:c6` 12/12 (live qoro-dev) — zero diff de comportamento no caminho humano.

### 2. Idempotência por CONTEÚDO (R1)
Chave de mutação do agente = `sha256(conversationId + intent + canonicalArgs)`
(hex). Sobrevive a reentrega de webhook / retry / timeout do Gemini com eventId
diferente. Camadas: (1) replay do out-row por eventId; (2) content-hash; (3)
UNIQUE `appointments_doctor_slot_uniq`.

### 3. MAX_TOOL_ROUNDS = 1 mantido (frozen)
Booking é multi-turn com confirmação humana no loop. "3 tentativas → handoff" =
`MAX_FALLBACKS = 3` ao longo de turnos.

### 4. 13 tools registradas (12 intents de negócio + handoff mecanismo)
3 da C11 + 10 novas: list_slots, schedule_appointment, confirm_appointment,
cancel_appointment, reschedule_appointment, list_pending_payments,
lgpd_export_request, lgpd_delete_request, patient_lookup, **collect_patient_data**.
`request_human_handoff` é mecanismo de fallback, não intent. `register_patient`
NÃO é tool — a criação acontece no handler quando a coleta está completa+confirmada.
Inputs **string-only** (R4) → o conversor Zod→JSON Schema congelado da C11 não foi
tocado.

### 5. Identidade ancorada no telefone (verificado) + matriz
Telefone (Meta) é o anchor; CPF é auto-declarado. Tools sensíveis usam SEMPRE
`ctx.patientId` (casado pelo telefone), nunca um id vindo do LLM. Matriz: telefone
acha X + CPF diverge → handoff (nunca atualiza CPF nem age sobre cadastro alheio);
colisão de CPF na criação (UNIQUE) → `PatientConflictError` → handoff. **Limitação
documentada:** telefone é fator, não prova — intents sensíveis são semi-automados.

### 6. list_pending_payments — sem divulgar valores por padrão
Opt-in por clínica (`ai_clinic_config.can_disclose_payments_via_agent`, default
false) + match de telefone; senão confirma existência + handoff. Somente leitura.

### 7. LGPD = intake + handoff, nunca cumprimento
Os handlers de `lgpd.*_requested` CUMPREM (export gera PDF/URL; delete soft-deleta
+ suppression). Logo o agente **nunca publica esses eventos**: grava linha
`lgpd_requests` pending + audit (sem evento) e escala handoff para verificação
humana.

### 8. Memória de coleta
`ai_conversations.collected_data_encrypted` (JSON cifrado per-tenant; contém CPF).
**Sem `context_drift`** (R2 — intent-flip gera falso-positivo). `COLLECT_STALE_RESET_DAYS=3`
(reset de coleta stale) e `MAX_COLLECT_STAGNATION=5` (estagnação sem progresso →
handoff; conta SÓ turnos sem campo novo).

### 9. Prompt-injection é AUDIT-ONLY (R3)
`detectPromptInjection` emite métrica `ai_agent.injection.detected`; **não bloqueia**.
Defesa real = whitelist de tools (G9) + Zod + RLS + recusa do LLM (gate §11.12).

### 10. Email opcional (unificado — R5)
`patients.email` virou nullable + índice único PARCIAL (`WHERE email IS NOT NULL`);
`CreatePatientSchema.email` opcional. Um core, validação idêntica nos dois caminhos.
Migration `0025`.

## Side-effect classification (Mutation Extraction Gate)
- **Request-only** (ficam no wrapper Server Action): `headers()` (RequestContext).
  Não há `revalidatePath`/`revalidateTag`/`redirect`/`cookies` nas actions de
  scheduling/patient — confirmado por grep.
- **Domínio** (foram para os cores): Zod, normalização, cifra/hash, idempotência,
  audit, state-log, eventos de outbox. O agente usa `buildAgentRequestContext`
  (ip/UA null, requestId=aiRequestId, correlationId=eventId).

## Known Future Refactors (dívida aceita — não bloqueia)
1. **Identity Layer (OTP)** ~90% — telefone é fator, não prova; sensíveis são
   handoff-gated. Provável C15.
2. **Intent Classifier** ~95% — classificador pequeno antes do LLM principal a
   ~500+ clínicas. C13.
3. **Conversation Memory Split** ~80% (prioridade elevada) — `collected_data` em
   `ai_conversations` mistura estado de conversa + onboarding + PII (impacta
   backup/replicação/analytics/replay). Separar `conversation_memory` de
   `patient_collect_state`.
4. **Conversation State Machine** — hoje é memória livre (intent + collected);
   "14h de quê?" depende de contexto. Provável enum `ConversationState`
   (IDLE, COLLECTING_PATIENT, WAITING_SLOT_SELECTION, WAITING_CONFIRMATION,
   WAITING_LGPD_CONFIRMATION, HANDOFF_PENDING). Não construído na C12.
5. **LGPD Workflow Completion** — SLA/status/auditoria/fulfillment é C14/C15.
6. **Financial Identity Verification** ~90% (provável ANTES do LGPD) — OTP/segunda
   verificação para exposição financeira.

Também notado: `MAX_CONVERSATION_AGE` explícito além do TTL 30d (hoje coberto pelo
`COLLECT_STALE_RESET_DAYS`).

## Consequences
- A IA passa pelo MESMO pipeline transacional/auditável dos humanos (não há
  bypass de RLS/idempotência/audit; só o auth de HTTP, que não existe no worker).
- Falha de criação de paciente ou identidade duvidosa SEMPRE vira handoff — os
  intents sensíveis (financeiro/LGPD) são deliberadamente semi-automados.
- Reverter: as Server Actions delegam aos cores; remover os métodos `*AsAgent` e
  as 10 tools desativa o agente-ação sem afetar o caminho humano.
