# ADR-026 — Proactive Jobs (C14): proativo determinístico + reativo via IA

- Status: accepted
- Camada: C14 — Proactive Jobs (lembrete D-1, dunning paciente, followup)
- Refs: PlanoAção §14, ADR-020 (messaging/Meta), ADR-022/023 (AI Agent C11/C12),
  ADR-011 (outbox/idempotência/audit), ADR-007 (RLS), ADR-012 (encryption)

## Context

C14 faz a clínica **falar primeiro** no WhatsApp: lembrete de consulta (prevenção
de no-show), cobrança amigável de inadimplente e followup de retorno. É a primeira
camada que combina envio proativo (cron) com interpretação reativa (LLM). Durante a
implementação, duas realidades arquiteturais reformataram a spec original, e o
review do founder levantou correções de corretude/escala. Este ADR congela as
decisões.

## Decision

### 1. Proativo = cron determinístico · Reativo = LLM (REGRA DE OURO)
**Quem ENVIA é um cron, nunca o LLM.** Varrer a agenda e disparar lembretes via
Gemini seria caro, lento e bateria em rate limit (20k msg/dia). O LLM só entra
**reativamente**, quando o paciente responde (pipeline C11: webhook → outbox →
handler do agente). Esta separação é a defesa central de escala — nunca colocar o
LLM no caminho de envio.

### 2. Cada contexto-fonte é dono do read-model de "candidatos"
O registry do outbox aceita **1 handler por evento**, e `scheduling.appointment.created`
(billing metering) + `financial.lancamento.created` (scheduling faturamento) já
estavam tomados. Em vez de fan-out (mudança de fundação) ou acoplar C14 ao estado
interno alheio:
- **Reminder** = cron-scan via `schedulingApiV1.listReminderCandidates` (Scheduling
  decide "qual consulta precisa de lembrete D-1"). NÃO consome `appointment.confirmed`.
- **Dunning** = cron-scan via `financialApiV1.listDunningCandidates` (Financial é dono
  de "o que é cobrável e vencido"; `pending ≠ inadimplente`; `due_date` obrigatório).
  Pago some do scan → cobre "pagou→não envia" sem handler de cancelamento.
- **Followup** = único event-driven: handler em `clinical.prontuario.signed` (campo
  ADITIVO `signedDoctorNome` no payload — nome de profissional não é PII).

### 3. `ai_proactive_jobs` é a fila agendada (não o outbox)
Jobs são pré-datados (D-1, D+3/D+7, return−2) → outbox (imediato) não serve. O
job-row é a unidade de retry e **reaproveita o backoff do outbox** (`backoffDelayMs`/
`MAX_ATTEMPTS`). Migration 0027 (RLS force + GRANT). Schema/3-tipos/status congelados
(PlanoAção §14.18).

### 4. Idempotência de ENVIO = `job.id` estável (at-most-once no Meta)
A `idempotencyKey` passada ao `messagingApiV1.sendText` é o **próprio job.id**, nunca
por tentativa — re-tentar dedup no messaging e não duplica no Meta. Idempotência de
CRIAÇÃO via `UNIQUE(clinic_id, dedup_key)`.

### 5. `claimDue`: reserva atômica + janela em SQL (supera advisory-lock)
Um único statement: `FOR UPDATE SKIP LOCKED` (mesmo padrão do outbox TX1) + janela
**8-20h LOCAL** da clínica via `AT TIME ZONE` + bump de `attempts`. Granularidade por
job (paralelismo por clínica de graça) — supera o advisory-lock por tipo cogitado.

### 6. LGPD: opt-in só para dunning
`evaluateProactivePolicy` (função pura) bloqueia DUNNING sem `patient_consents.
cobranca_whatsapp` (ou revogado). Reminder/followup são transacionais (ligados à
consulta) → só suppression. Suppression vale para os três.

### 7. ADRs do review (corretude)
- **Idempotência SEMÂNTICA do reminder** (não só `dedup_key`): o read-model é função
  pura do estado; consulta cancelada/remarcada some dos candidatos + guard de send-time
  → um lembrete por visita real.
- **D±N são dias-CALENDÁRIO no tz da clínica** (não horas UTC) — `infra/tz.ts`.
- **Advisory-lock evolui para `(type,clinic)` antes de escalar** — hoje resolvido pelo
  SKIP LOCKED por linha.

### 8. Templates: aprovados na Meta (obrigatório) · catálogo no nosso DB é evolução
Mensagem proativa (fora da janela de 24h) **só** sai como **template aprovado pela
Meta** — regra anti-spam validada no servidor da Meta, não contornável. Hoje o NOME
aprovado vem de ENV (`META_TEMPLATE_*_ID`), congelado §14.18. **Evolução (multi-WABA,
provável feature do C15):** tabela `whatsapp_templates` (name/lang/var_order/status por
clínica/WABA), porque a **aprovação é por WABA** — env var global não rastreia status
por clínica. O conteúdo continua na Meta; nós gerenciamos só o mapeamento/ciclo de vida.

## Pendência conhecida (NÃO é bug do C14)

O lembrete entrega, mas o **"SIM" do paciente ainda não confirma sozinho**: as tools
`confirm/cancel/reschedule` exigem `appointment_id`, o contexto do agente é lazy e
**não há tool que liste as consultas do paciente**. Fechar o loop (teste §14.6.3/.4)
exige **`list_my_appointments`** (ou fazer as tools assumirem a próxima consulta ativa)
— escopo de AI Agent/intents (C12), aditivo, ~1 arquivo. Registrado para fazer junto
da validação real (quando os templates aprovarem).

## Consequências

- **Positivas:** escala (cron barato + LLM só na resposta); cada domínio dono da sua
  regra; zero quebra de C0-C13 (mudanças aditivas: 1 campo de evento, read-models novos,
  1 remoção de allowlist); retry/idempotência/RLS reusados.
- **Custos/débitos:** `unknown` do Meta não reconciliado por delivery-callback (C15/C16);
  trim mensal de `ai_proactive_jobs` (C16); `list_my_appointments` pendente; catálogo de
  templates pendente (multi-WABA); `enqueue` LIMIT 500/scan (ok até ~200 jobs/clínica/dia).
- **Validação:** 388 testes + `smoke:c14` 8/8 (SQL/RLS reais em qoro-dev) + gates verdes;
  webhook Meta verificado em prod (`app.qoro.dev`). Falta operacional: aprovar 3 templates,
  migration 0027 em prod, conectar número, gate §14.7 (5 pacientes).
