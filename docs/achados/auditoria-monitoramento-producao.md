# Auditoria de Monitoramento em Produção

> **Escopo:** Estratégia de observabilidade, monitoramento, logging, métricas, tracing, health checks, alertas e resposta a incidentes do ClinicaOS/Qoro.
> **Perspectiva:** Staff SRE responsável por disponibilidade 24×7 de um SaaS multi-tenant em pré-produção, preparando-se para escalar (milhares de clínicas, milhões de mensagens WhatsApp, integrações críticas).
> **Natureza:** Read-only. Nenhum código ou configuração foi alterado. Este documento apenas audita.
> **Data:** 2026-07-13 · **Método:** DOCUMENTAÇÃO → FLUXO CRÍTICO → IMPLEMENTAÇÃO → OBSERVABILIDADE → RISCO.

> **Nota sobre skills.** Os plugins pedidos (`better-stack`, `sentry`, `opentelemetry` do `claude-plugins-official`) **não estão instalados** neste ambiente. Foi usada a skill `observability-designer` (frameworks SLI/SLO, golden signals, RED/USE, burn-rate, alert-fatigue) para calibrar os critérios. As melhores práticas de Sentry, OpenTelemetry e Better Stack foram aplicadas conceitualmente; onde uma capacidade dedicada dessas ferramentas está ausente, isso consta como achado.

---

## 1. Resumo Executivo

### Nível atual de observabilidade

O ClinicaOS **investiu de verdade em instrumentação** e está muito acima da média de um SaaS em estágio inicial. Existe uma camada "C16 — Observabilidade & Hardening" desenhada em ADR-029, com: captura de exceções (Sentry, com scrub de PII e amostragem), logging estruturado in-house (JSON em stdout, sanitizado), um catálogo de eventos de métrica (`metrics.emit`), health checks (`/api/health`, `/api/health/outbox`, `/api/health/auth-hook`), heartbeats de cron, uma trilha de auditoria fortemente correlacionada (`logAudit` com `clinicId`+`userId`+`requestId`+`correlationId`), SLOs formais (`docs/c16/slo.md`) e uma coleção madura de runbooks.

**Porém, há uma distância grande entre "instrumentado" e "operável".** A instrumentação existe; a **detecção automática e a notificação — a parte que efetivamente acorda o operador — não estão comprovadamente ligadas.** Somando isso a três lacunas estruturais (health check que não enxerga outage externo real, exceções de background que não chegam ao Sentry, e ausência de métricas em tempo real), o sistema hoje é **parcialmente observável mas ainda não operável 24×7 em escala**.

Respondendo diretamente às quatro perguntas do escopo:

| Pergunta | Resposta curta |
|---|---|
| **O sistema é observável?** | **Parcialmente.** Bom em eventos de negócio (IA, messaging, outbox); cego em auth, latência em tempo real e saturação de recursos. |
| **Um incidente é identificado rapidamente?** | **Não com confiança.** A detecção depende de alertas em dashboards externos que o repositório não prova estarem configurados; o item de alerta do go-live continua **aberto**. |
| **É possível descobrir a causa raiz?** | **Difícil em background.** Webhooks/crons/worker não chegam ao Sentry e o stack trace é descartado antes do stdout. Restam `{name, message}` sem stack. |
| **A equipe conseguirá operar em escala?** | **Ainda não.** Operador solo, sem alerta wired, sem tracing distribuído, sem métricas de saturação, e docs operacionais com drift. |

### Maturidade operacional

Numa escala de maturidade de observabilidade de 0 a 5:

- **Instrumentação / captura:** ~3.5 (Sentry + logs estruturados + métricas de evento + auditoria correlacionada).
- **Detecção / alerting:** ~1.0 (política escrita, nada comprovadamente wired; notificação em aberto).
- **Diagnóstico / tracing:** ~1.5 (Sentry traces amostrados; sem correlação end-to-end queryável).
- **Resposta a incidentes / runbooks:** ~3.0 (runbooks concretos, mas alguns com drift e detecção aspiracional).
- **Prontidão para escala:** ~1.5 (fila global única, sem métricas de saturação, custo de logs não modelado).

### Principais riscos (top 5)

1. **Um outage total pode não notificar ninguém** — o alerting não está comprovadamente conectado (C1).
2. **Outage de dependência externa (Gemini/Meta/Asaas) passa despercebido** — `/api/health` só verifica presença de env, não a saúde real (C2).
3. **Falhas de webhook/fila/cron são cegas ao Sentry e sem stack** — diagnóstico de background fica no escuro (C3).
4. **Eventos de segurança (login, MFA, rate-limit) são invisíveis** fora da tabela `login_attempts` (A1).
5. **Sem tracing distribuído nem métricas de tempo real** — degradação (latência, saturação de conexões) só aparece quando o cliente já sentiu (A3, A4).

### Pontos fortes (a preservar)

- **Sanitização de PII unificada e disciplinada** (`sanitize-fields.ts` + `sentry-scrub.ts`): uma única fonte de redação de Bearer/JWT/DSN/dados sensíveis, aplicada a logs, métricas e Sentry. Excelente postura LGPD/clínica.
- **Auditoria correlacionada de ponta a ponta** via `logAudit` (clinicId + userId + requestId + correlationId).
- **Health check da fila (`/api/health/outbox`)** com SLIs reais (`pending_age`, `processing_age`, `failed`) — a melhor peça de observabilidade do sistema.
- **Fluxo de IA (Gemini) muito bem instrumentado**, com dead-letter (`aiAgentFailures`) e correlação por `aiRequestId`/`conversationId`.
- **SLOs formais e runbooks escritos** — a fundação conceitual está pronta; falta ligar os fios.

---

## 2. Inventário de Observabilidade

| Área | Tecnologia | Cobertura | Risco |
|---|---|---|---|
| **Exceções** | `@sentry/nextjs` v10 (client/server/edge via `instrumentation.ts` + `onRequestError`) | Erros **lançados** em RSC/Server Actions/route handlers + boundaries de UI. Scrub PII, `sendDefaultPii:false`, `tracesSampleRate:0.1`, replay off. | **Alto.** Webhooks/crons/worker fazem `catch → metrics.emit → 500` sem rethrow → **nunca chegam ao Sentry**. |
| **Logging (níveis)** | Logger in-house `src/lib/observability/logger.ts` (JSON stdout, gated por `LOG_LEVEL`) | **Só 2 call sites** no `src/` inteiro (`identity/internal/members.ts`). | **Alto.** Na prática **não há stream de log por severidade**; quase tudo é `metrics.emit`. |
| **Métricas (eventos)** | `metrics.emit` (JSON stdout) — ~150 call sites / 44 arquivos | Boa em IA, messaging, outbox, billing, idempotência. | **Médio.** Sem SDK de métricas; sem histogramas/percentis em tempo real; stack descartado. |
| **Métricas (agregadas)** | `system_metrics_daily` + cron `metrics-rollup` (diário 05:00) | Rollup **diário**. | **Alto.** Nenhuma métrica em **tempo real**; P95, throughput e saturação só no dia seguinte. |
| **Tracing** | Sentry performance (sample 0.1) | Parcial, amostrado. | **Alto.** Sem trace end-to-end frontend→API→DB→Redis→externo; correlação `request_id`↔Sentry não sustentada (scrub apaga headers). |
| **Health checks** | `/api/health` (db, gemini, meta, asaas, outbox), `/api/health/outbox`, `/api/health/auth-hook` | db + outbox = checks reais; externos = presença de env. | **Crítico.** Gemini/Meta/Asaas **caídos com key válida reportam `ok`**. |
| **Alertas** | Sentry / Better Stack / UptimeRobot (dashboard, "operator-side") | Política escrita (`alert-tuning.md`, `slo.md`). | **Crítico.** **Não comprovável no repo; go-live #2 (regra + canal) em aberto**. |
| **Agregação / busca de logs** | Better Stack via Vercel Log Drain | Só em comentários de código e runbooks. | **Alto.** Log drain **não é configurável no repo**; nada prova que exista. |
| **Auditoria** | `logAudit` (`src/lib/audit/log.ts`) | Forte e correlacionada (clinicId+userId+requestId+correlationId). | **Baixo.** Cobre ações, não falhas/erros. |
| **Heartbeat de crons** | `cron_heartbeats` (`src/lib/cron-heartbeat`) | 13 crons registram `last_run_at`. | **Médio.** Sem alerta externo de atraso; falha de escrita do heartbeat é **silenciosa**. |
| **Uptime / SLO** | `docs/c16/slo.md` (6 SLOs, error budget) | Definição escrita, janela 28d. | **Alto.** Burn-rate só política; **sem MTTR/MTTD**; thresholds sem histórico. |
| **RUM / frontend** | Sentry client (`instrumentation-client.ts`) | Erros de cliente + boundaries. | **Baixo/Médio.** Sem web-vitals/RUM aprofundado (replay off por LGPD — decisão correta). |
| **Rate limit** | `@upstash/ratelimit` + Redis | Fail-open por design. | **Médio.** Sem observabilidade de trips; sob outage do Redis, abuso fica invisível. |

---

## 3. Achados

> Cada achado: **Categoria · Severidade · Local · Descrição · Impacto · Cenário de incidente · Tempo de diagnóstico sem correção · Correção recomendada · Prioridade.**
> Severidades: 🔴 CRÍTICA · 🟠 ALTA · 🟡 MÉDIA · 🔵 BAIXA · ⚪ INFORMATIVO.

---

### 🔴 C1 — Alerting não está comprovadamente conectado (a notificação não existe)

- **Categoria:** Alerting / Operação
- **Local:** `docs/c16/go-live-checklist.md` (item #2), `docs/c16/slo.md`, `docs/runbooks/alert-tuning.md`, `docs/runbooks/log-search.md`
- **Descrição:** Todo o desenho de alerta — thresholds de SLO, severidades, burn-rate (fast >2%/1h, slow >10%/24h) — existe apenas como **prosa** nos runbooks. As regras que efetivamente disparam vivem em dashboards externos (Sentry Alert Rules, Better Stack saved searches, UptimeRobot), que o repositório **não pode provar estarem configurados**. O próprio go-live checklist marca o item #2 como **aberto**: *"finalizar #2 (salvar a Alert Rule com env=production + garantir o canal de notificação no Uptime)"*. Não há computação de error-budget nem de burn-rate em código; `system_metrics_daily` é rollup diário e o uptime é externo.
- **Impacto:** É a lacuna nº1. Sem canal de notificação confirmado, a instrumentação vira uma "caixa-preta que só é lida se alguém abrir o dashboard". Detecção passa a depender de o operador olhar gráficos ou de um cliente reclamar.
- **Cenário de incidente:** Sexta 23h, o worker de outbox começa a falhar em 100% (ex.: rotação de secret quebrou o acesso ao Meta). Lembretes e respostas de IA param. Tudo responde HTTP 200. Sem alerta wired, ninguém é notificado; o problema só aparece segunda de manhã quando clínicas ligam reclamando que pacientes não receberam confirmação.
- **Tempo de diagnóstico sem correção:** Detecção: **horas a dias** (até alguém reclamar). Diagnóstico após detectar: minutos (a fila tem bons SLIs).
- **Correção recomendada:** Fechar o item #2: (1) criar UptimeRobot/Better Stack monitor batendo em `/api/health?strict=1` e `/api/health/outbox?strict=1` (já retornam 503) com canal de notificação (e-mail + push/WhatsApp/Telegram do operador); (2) Sentry Alert Rule com filtro `environment=production` → mesmo canal; (3) Better Stack saved search para `kind:"metric" event:"*.error"` e `event:"outbox.failed"` com alerta por volume. Registrar no checklist com print de teste real de disparo.
- **Prioridade:** **P0 — bloqueia go-live com cliente pagante.**

---

### 🔴 C2 — `/api/health` não detecta outage real de dependência externa

- **Categoria:** Monitoring / Health checks
- **Local:** `src/app/api/health/route.ts:60-63,107-113`
- **Descrição:** Os checks de Gemini, Meta e Asaas são `checkConfig(Boolean(env.X))` — só validam a **presença da variável de ambiente**, não a saúde do provedor. Um provedor totalmente fora do ar, mas com a key configurada, reporta `ok`. Apenas `db` (SELECT 1) e `outbox` (idade do pending) são checks reais. Os runbooks assumem o contrário — `docs/runbooks/gemini-down.md` lista *"GET /api/health → gemini: degraded"* como sintoma primário, o que **não acontece** numa falha real de provider com key válida (o próprio `failure-drills.md` admite isso na distinção Drill 2a/2b).
- **Impacto:** O health check unificado — a peça central para uptime monitors — dá **falsos negativos** para as três integrações mais críticas. Um monitor batendo em `/api/health` fica verde durante um apagão do WhatsApp ou do Gemini.
- **Cenário de incidente:** Meta Cloud API entra em incidente regional. `env.META_APP_SECRET` continua setado → `meta: ok`. Uptime verde, nenhum alerta. Mensagens de saída acumulam como `failed` na fila; só o SLI de outbox (se o monitor de outbox estiver wired — ver C1) pegaria, indiretamente.
- **Tempo de diagnóstico sem correção:** **30 min – 2h** para desconfiar (via reclamação ou fila crescendo), pois o sinal mais óbvio (health) está mentindo.
- **Correção recomendada:** Transformar os checks externos em verificações leves de **reachability** com timeout curto e cache (ex.: 60s): Gemini `models.list`/ping, Meta debug-token, Asaas endpoint de status/saldo. Classificar `degraded` on timeout/erro. Alternativamente (mais barato), derivar o status desses provedores das **taxas de erro recentes** já emitidas (`ai.provider.error`, `messaging.outbound.failed`, circuit breaker do Asaas) em vez de config-presence. Atualizar `gemini-down.md`/`meta-template-rejected.md` para o mecanismo real.
- **Prioridade:** **P0.**

---

### 🔴 C3 — Exceções de background nunca chegam ao Sentry, e o stack é descartado

- **Categoria:** Tracing / Logging / Observabilidade
- **Local:** `src/app/api/webhooks/asaas/route.ts:128-130`; `src/app/api/webhooks/meta/route.ts` (catch→`messaging.webhook.error`); `src/app/api/cron/*/route.ts` (catch→`*.error`/`worker.error`); `src/lib/outbox/worker.ts`; `src/lib/observability/sanitize-fields.ts:16-29`
- **Descrição:** Sentry server-side só captura erros **lançados** (via `onRequestError = Sentry.captureRequestError`, `src/instrumentation.ts:13`). Mas todos os caminhos de background — webhooks, os 13 crons e o outbox worker — seguem o padrão `catch (err) { metrics.emit('*.error', { error: err }); return 500 }` **sem rethrow**, então nunca chegam ao Sentry. Pior: `sanitizeFields` reduz qualquer `Error` a `{ name, message }` e **descarta o stack** (`sanitize-fields.ts:19-23`). Resultado: para uma falha de webhook/cron/worker, tudo que sobra é uma linha de stdout com nome e mensagem — sem stack, sem agrupamento, sem contexto de request. Além disso, há falhas que não emitem nada (ex.: parse do webhook Asaas `route.ts:61-62` → 400 silencioso).
- **Impacto:** Os fluxos mais assíncronos e mais críticos para um SaaS de WhatsApp (recebimento de pagamento, mensagens, jobs proativos) são exatamente os que **menos** dão para diagnosticar. Sem stack e sem Sentry, o MTTR de qualquer bug de background dispara.
- **Cenário de incidente:** Um `PAYMENT_RECEIVED` do Asaas dispara um `NullPointer` dentro de `ensureInvoiceForPayment` para uma subscription com estado inesperado. O `catch` emite `billing.webhook.error {event, error:{name,message}}` e devolve 500. O Asaas re-tenta e falha igual. Sem stack, o operador não sabe qual linha quebrou; precisa reproduzir localmente com o payload (que foi redigido dos logs).
- **Tempo de diagnóstico sem correção:** **2–6h** por incidente de background (reproduzir sem stack/payload), vs. minutos se houvesse Sentry com stack.
- **Correção recomendada:** (1) Nos catches de background, chamar `Sentry.captureException(err, { tags: { flow, clinicId }, extra: {...} })` **antes** de emitir a métrica/retornar 500 (o `beforeSend`/scrub já protege PII). (2) Preservar o stack no caminho de erro: emitir uma métrica de erro que carregue o stack sanitizado (ou confiar no Sentry para o stack e manter a métrica só como contador). (3) Adicionar métrica no parse-fail do webhook (400 silencioso). (4) Garantir `x-request-id`/`clinicId` como tags do Sentry nesses caminhos para correlação (ver A3).
- **Prioridade:** **P0/P1.**

---

### 🟠 A1 — Fluxo de auth/login/MFA/middleware sem observabilidade estruturada

- **Categoria:** Logging / Segurança / Observabilidade
- **Local:** `src/app/(app)/login/actions.ts` (incl. `:88` swallow do audit RPC), `src/app/(app)/login/mfa/actions.ts:30`, `src/middleware.ts`
- **Descrição:** Login, MFA e o middleware (drift de claims, heal, logout) **não emitem nenhum `logger`/`metrics`**. Falha de login, trip de rate-limit, falha de MFA e drift-logout não geram sinal observável; a única trilha é a RPC `record_login_attempt` (e a falha dessa RPC é engolida silenciosamente em `login/actions.ts:88`). O middleware carimba `x-request-id` mas não loga nada. `mfa/actions.ts:30` e `equipe/actions.ts` mapeiam erros arbitrários para strings de UI sem `logger.error`/Sentry/métrica.
- **Impacto:** Eventos de **segurança** (brute-force, enxame de MFA falho, sessões sendo derrubadas por drift) são invisíveis fora da tabela `login_attempts`. Não dá para alertar sobre pico de falhas de login nem investigar um "não consigo logar" de um tenant.
- **Cenário de incidente:** Após um deploy que mexe em claims, o middleware passa a derrubar (`drift-logout`) sessões de uma clínica inteira. Usuários relatam "fui deslogado". Sem log/métrica de drift-logout, o operador não consegue confirmar a hipótese nem medir o alcance sem inspecionar código e correr atrás de dados.
- **Tempo de diagnóstico sem correção:** **1–4h** (correlacionar reclamações com deploy, sem sinal direto).
- **Correção recomendada:** Emitir `metrics.emit`/`logger.warn` para: `auth.login.failed` (com motivo, sem PII), `auth.ratelimit.tripped`, `auth.mfa.failed`, `auth.claims.drift_logout` (com `clinicId`/`userId`). Trocar o swallow de `:88` por `logger.error`. Alimenta um alerta de "pico de falhas de login" (segurança).
- **Prioridade:** **P1.**

---

### 🟠 A2 — Correlação incompleta no stream de métricas (sem tenant/user/request no caminho quente)

- **Categoria:** Observabilidade / Metrics / Multi-tenancy
- **Local:** `src/lib/idempotency/mutation.ts:177,192,196,200,203,231`; `src/app/api/webhooks/asaas/route.ts:129` (`billing.webhook.error` sem clinicId/request_id); `messaging`/`cron` `*.error` agregados
- **Descrição:** `metrics.emit` transmite `clinicId` em muitos fluxos de domínio, mas o wrapper `idempotentMutation` — que está **por baixo de toda mutação de agenda, prontuário e paciente** — emite `idempotency.*` só com `{ key }` ou `{ key, action }`, **sem `clinicId`/`userId`/`request_id`** (embora a linha da tabela `idempotency_keys` tenha clinicId+userId; só não vai para a métrica). Vários `*.error` de webhook/cron também não carregam `clinicId` nem `request_id`. O `request_id` (carimbado no middleware) flui para a **auditoria** mas **não para o stream de métricas**.
- **Impacto:** Investigar "por que a clínica X teve conflitos/lock-timeouts na agenda" exige **join manual** entre o stdout e a tabela de auditoria pela `key`. A promessa multi-tenant de "isolar o problema de uma única clínica pela busca de logs" não se cumpre no caminho mais usado.
- **Cenário de incidente:** Uma clínica relata que agendamentos "somem" (na verdade, `idempotency.conflict` por hash divergente). O operador filtra `event:"idempotency.conflict"` no Better Stack e vê só `key`s — sem `clinicId`, não consegue confirmar que são da clínica X sem decodificar cada key ou cruzar com auditoria.
- **Tempo de diagnóstico sem correção:** **30–90 min** por investigação de tenant no caminho de idempotência.
- **Correção recomendada:** Incluir `clinicId`, `userId` e `request_id`/`correlationId` em todos os `idempotency.*` e em todos os `*.error`. `idempotentMutation` já tem `clinicId`/`userId` em escopo — é baixo custo. Padronizar um helper que injete os campos de correlação em todo `metrics.emit`.
- **Prioridade:** **P1.**

---

### 🟠 A3 — Sem tracing distribuído; correlação Sentry↔logs não se sustenta

- **Categoria:** Tracing / Observabilidade
- **Local:** `sentry.server.config.ts:19` (`tracesSampleRate:0.1`), `src/lib/observability/sentry-scrub.ts:16-18` (deleta `request.headers`), ADR-029 (promessa de correlação por `trace_id`)
- **Descrição:** O único tracing é o do Sentry, amostrado a 10% e sem propagação de contexto queryável entre frontend → API → Postgres → Redis → provedores externos (não há OpenTelemetry ativo — a decisão do ADR-029 foi adiar). A ADR-029 afirma que `trace_id = request_id` correlaciona *resposta ↔ logs ↔ audit ↔ Sentry*, mas: (a) o `request_id` **não vai** para o stream de métricas (A2); (b) o `sentry-scrub` **deleta todos os headers** do evento, removendo o `x-request-id` do contexto; (c) não há `Sentry.setTag('request_id', ...)` server-side visível. Ou seja, a ponte prometida entre um erro no Sentry e a linha de log correspondente **não existe na prática**.
- **Impacto:** Diante de um erro no Sentry, não há um `trace_id` clicável que leve à linha de log / à requisição / ao registro de auditoria. O "um salto do alerta ao log" prometido no ADR vira uma busca manual.
- **Cenário de incidente:** Sentry mostra um erro 500 numa Server Action de prontuário. O operador quer ver o que aconteceu antes (queries, evento de outbox). Sem `trace_id` no evento e sem tracing distribuído, precisa adivinhar a janela de tempo e caçar no stdout.
- **Tempo de diagnóstico sem correção:** **1–3h** para reconstruir uma requisição multi-serviço.
- **Correção recomendada:** Curto prazo: `Sentry.setTag('request_id', requestId)` no middleware/handlers e incluir `request_id` em todas as métricas (A2), restaurando a correlação de baixo custo prometida no ADR. Médio prazo: avaliar OpenTelemetry (o Sentry v10 já traz OTel embutido) para trace de DB/Redis/HTTP externo com propagação de contexto, elevando o sampling para caminhos de erro (tail-based).
- **Prioridade:** **P1 (correlação) / P2 (OTel).**

---

### 🟠 A4 — Sem métricas em tempo real / golden signals vivos

- **Categoria:** Metrics / Monitoring / Performance
- **Local:** `src/lib/observability/metrics.ts` (stdout, sem SDK), `system_metrics_daily` + cron `metrics-rollup` (diário)
- **Descrição:** As métricas são eventos JSON em stdout e uma **agregação diária** (`system_metrics_daily`, rollup às 05:00). Não existe SDK de métricas (Prometheus/Datadog/OTel metrics) nem dashboard em tempo real. Latência P95/P99 de API, throughput (req/s), taxa de erro instantânea e **saturação** (pool de conexões `postgres.js`, memória, fila) não são observáveis antes do rollup do dia seguinte. Dos golden signals, *errors* e (parte de) *traffic* existem como eventos; *latency* e *saturation* em tempo real estão ausentes. O SLO de latência (`slo.md §2`, P95<500ms) aponta para `system_metrics_daily` e "Sentry se habilitado" — ou seja, **não há alerta de P95 vivo**.
- **Impacto:** Degradação gradual (queries lentas, pool saturando, memória subindo) só é percebida quando vira erro/timeout para o usuário. Impossível "identificar degradação antes do usuário perceber".
- **Cenário de incidente:** Uma nova query sem índice degrada o P95 de 200ms para 1.2s ao longo de uma tarde. Usuários sentem lentidão. Nenhum alerta de latência dispara (só existiria no rollup do dia seguinte). O sinal chega como reclamação, não como métrica.
- **Tempo de diagnóstico sem correção:** Detecção de degradação: **horas** (até virar erro/reclamação).
- **Correção recomendada:** Curto prazo: habilitar Sentry Performance (traces já a 0.1) e criar alerta de P95 lá; expor um endpoint/painel de saturação do pool. Médio prazo: métricas RED (por rota) e USE (por recurso) via OTel metrics ou Better Stack, com dashboard de golden signals e alerta de burn-rate real. Adicionar métricas de saturação do pool `postgres.js` vs. limite do Supabase (ver E4).
- **Prioridade:** **P1/P2.**

---

### 🟡 M1 — `console.*` fora do pipeline sanitizado em caminhos críticos

- **Categoria:** Logging
- **Local:** `src/app/(app)/join/[token]/actions.ts:189` (`console.error` em falha de ativação de checkout); `src/contexts/patient/internal/handlers/lgpd-export-requested.ts:101` (`console.warn`)
- **Descrição:** Alguns pontos usam `console.*` diretamente, contornando o logger estruturado e a sanitização. O mais grave é a **falha de ativação do checkout** logada via `console.error('[checkout] ativação falhou:', e)` — um caminho de onboarding/billing crítico, fora do Sentry e fora da busca do Better Stack, e sem passar pelo scrub de PII.
- **Impacto:** Falhas nesses caminhos ficam em texto livre no stdout, não pesquisáveis com o mesmo shape, não agrupadas, e potencialmente com PII não redigida.
- **Cenário de incidente:** Um cliente paga mas a ativação do checkout falha (`join/[token]/actions.ts:189`). O erro sai como texto solto; não gera evento estruturado nem Sentry. O cliente pagou e não tem acesso; o operador só descobre pelo suporte.
- **Tempo de diagnóstico sem correção:** **30–60 min** (achar a linha solta no stdout entre milhares).
- **Correção recomendada:** Trocar por `logger.error('checkout.activation_failed', { error, clinicId })` + `Sentry.captureException`. Idem para o handler de LGPD. Adicionar regra de lint proibindo `console.*` em `src/` (fora de exceções explícitas já anotadas em client components).
- **Prioridade:** **P1 (checkout) / P2 (LGPD).**

---

### 🟡 M2 — Swallows silenciosos em caminhos de liveness e forense

- **Categoria:** Observabilidade / Operação
- **Local:** `src/lib/cron-heartbeat/index.ts:30` (falha de escrita do heartbeat engolida); `src/lib/audit/impersonation-extra.ts:56` (auditoria extra de impersonate engolida); `src/app/(app)/login/actions.ts:88` (falha do audit de login engolida)
- **Descrição:** Alguns `catch` engolem a falha **sem emitir sinal**. O mais sensível é o do heartbeat: se a escrita em `cron_heartbeats` falha silenciosamente, o SLO nº6 (cron dentro de 2× o intervalo) fica cego — um cron pode estar rodando e ainda assim parecer "morto", ou o contrário. O swallow da auditoria extra de impersonate cria um ponto cego forense (ações de super_admin sobre um tenant).
- **Impacto:** Sinais de liveness e forense podem sumir sem rastro, minando justamente os mecanismos criados para detectar falha silenciosa.
- **Cenário de incidente:** A tabela de heartbeat fica indisponível por um curto período; as escritas falham silenciosamente. O painel "Saúde dos jobs" mostra crons "atrasados" que na verdade rodaram — investigação em falso positivo, ou o inverso (um cron travado passa como ok).
- **Tempo de diagnóstico sem correção:** **1–2h** (perseguir um sinal de liveness que mente).
- **Correção recomendada:** Emitir `metrics.emit('cron.heartbeat.write_failed', {...})` / `logger.warn` nesses catches em vez de engolir. Manter o comportamento não-fatal, mas deixar rastro.
- **Prioridade:** **P2.**

---

### 🟡 M3 — Redis/Upstash fail-open sem runbook nem observabilidade de rate-limit

- **Categoria:** Monitoring / Segurança / Arquitetura
- **Local:** `@upstash/ratelimit` + `@upstash/redis` (rate limiting); ausência de `docs/runbooks/redis-*`
- **Descrição:** O rate limiting é **fail-open** por design (se o Redis cai, a requisição passa). Não há runbook dedicado para outage de Redis (a DR cobre só o banco), nem métrica de trips de rate-limit ou de indisponibilidade do Redis. Sob outage do Upstash, o sistema continua servindo — mas sem proteção de rate limit e sem ninguém saber.
- **Impacto:** Um apagão do Redis remove silenciosamente a proteção contra abuso e brute-force, sem alerta. Combinado com A1 (auth sem observabilidade), um ataque durante um outage de Redis seria totalmente invisível.
- **Cenário de incidente:** Upstash tem um incidente. Rate limit passa a fail-open. Um ator faz brute-force de login. Nenhum sinal: nem trip de rate-limit (não existe), nem falha de login (A1), nem status de Redis.
- **Tempo de diagnóstico sem correção:** **Pode nunca ser detectado** sem os sinais de A1/M3.
- **Correção recomendada:** Emitir métrica em trip de rate-limit e em erro de acesso ao Redis (`ratelimit.tripped`, `redis.unavailable`); adicionar Redis ao `/api/health` como `degraded` on error; escrever `docs/runbooks/redis-down.md`. Considerar fail-closed para rotas sensíveis (login).
- **Prioridade:** **P2.**

---

### 🟡 M4 — Sem MTTR/MTTD; SLOs não validados; DR/restore nunca testado com dados reais

- **Categoria:** Operação / SLO
- **Local:** `docs/c16/slo.md:84`, `docs/runbooks/disaster-recovery.md`, `docs/runbooks/restore-test.md`, `docs/c16/go-live-checklist.md:72`
- **Descrição:** `slo.md` define disponibilidade, latência, error budget e RTO/RPO (≤4h/≤24h), mas **não define MTTR nem MTTD**, e nenhuma ferramenta computa error-budget/burn-rate (é política). O próprio doc admite: *"Estes números são ponto de partida (sem histórico). Reavaliar trimestralmente"*. O restore test rodou contra uma prod **~vazia (0 tenants)**, e o PITR está adiado — ou seja, o RTO nunca foi medido com dados reais.
- **Impacto:** Não há alvo de tempo de resposta a incidente nem validação de que a recuperação funciona no volume real. Em um desastre, o RTO de 4h é uma esperança, não um número testado.
- **Cenário de incidente:** Corrupção de dados exige restore. É a primeira vez que o restore roda com dados reais; o operador descobre em produção que o procedimento leva mais que 4h ou que o PITR não estava ligado.
- **Tempo de diagnóstico sem correção:** N/A (é risco de recuperação, não de detecção) — mas o impacto é indisponibilidade prolongada.
- **Correção recomendada:** Definir MTTD/MTTR alvo no `slo.md`; ligar PITR ao entrar o primeiro cliente pagante; agendar um restore-test trimestral contra um snapshot com dados; implementar (ou explicitar como manual) o cálculo de burn-rate a partir de `system_metrics_daily` + uptime.
- **Prioridade:** **P1 (PITR ao 1º pagante) / P2 (MTTR, restore drill).**

---

### 🟡 M5 — Drift entre documentação operacional e o que foi implementado

- **Categoria:** Operação
- **Local:** `docs/PROGRESS.md` (C16 "pendente", "Pino"), `docs/CONVENTIONS.md:72` ("Pino + correlation"), `docs/c16/c16-inventory.md` (~12 jobs), `docs/runbooks/production-readiness.md` ("6 crons"), vs. `vercel.json` (13 crons); `go-live-checklist.md:74` cita rota `/api/health/sentry-test` já removida
- **Descrição:** Vários documentos operacionais estão dessincronizados do código: PROGRESS/CONVENTIONS ainda dizem que a observabilidade usa Pino e que C16 está pendente (na verdade shipou logger in-house, sem Pino, e Sentry está live); o inventário e o production-readiness citam 6/12 crons quando há **13** no `vercel.json`; um runbook aponta para uma rota de drill (`/api/health/sentry-test`) que não existe mais.
- **Impacto:** Runbook é a fonte de verdade **durante um incidente**. Documentação com drift eleva o MTTR — o operador segue passos que não batem com a realidade, ou procura uma rota que sumiu.
- **Cenário de incidente:** Durante um incidente de cron às 3h, o operador consulta o production-readiness (que fala em 6 crons), não encontra o cron problemático na lista e perde tempo achando que é outro sistema.
- **Tempo de diagnóstico sem correção:** **+15–45 min** de atrito por incidente que depende desses docs.
- **Correção recomendada:** Reconciliar PROGRESS/CONVENTIONS/inventory/production-readiness com o estado real (logger in-house, Sentry live, 13 crons); remover a referência à rota de drill removida. Idealmente um check de CI que valide a contagem de crons do doc contra `vercel.json`.
- **Prioridade:** **P2.**

---

### 🔵 B1 — Sem RUM/web-vitals aprofundado no frontend

- **Categoria:** Monitoring / Performance
- **Local:** `src/instrumentation-client.ts` (Sentry client)
- **Descrição:** O cliente captura erros e boundaries, mas não há coleta aprofundada de web-vitals/RUM (LCP, INP, CLS por rota/tenant). Session Replay está desligado por LGPD — decisão **correta** para telas clínicas.
- **Impacto:** Degradação de experiência no navegador (páginas lentas em clínicas com conexão ruim) não é observável.
- **Cenário de incidente:** Uma clínica reclama de "sistema lento"; sem RUM, não dá para saber se é rede do cliente, bundle, ou backend.
- **Tempo de diagnóstico sem correção:** **30–90 min** sem dados de cliente.
- **Correção recomendada:** Habilitar Web Vitals do Sentry (sem replay), rotulados por rota. Baixo custo.
- **Prioridade:** **P3.**

---

### ⚪ INFO-1 — Thresholds de SLO ainda sem histórico

- **Categoria:** SLO / Observabilidade
- **Local:** `docs/c16/slo.md:84`
- **Descrição:** Os alvos (99.5%, P95<500ms, Gemini<2%, etc.) são pontos de partida sem dados reais, como o próprio doc reconhece. Isso é esperado em pré-produção, mas significa que os primeiros alertas terão falso-positivo/negativo até calibrar.
- **Impacto:** Risco de alert fatigue ou de cegueira nas primeiras semanas.
- **Correção recomendada:** Reavaliar após ~4 semanas de tráfego real; ajustar thresholds e janelas de burn-rate com base em `system_metrics_daily` + uptime.
- **Prioridade:** **P3 (recorrente).**

---

### Lacunas de escala (aparecem primeiro a 5.000 clínicas / 100k usuários)

Não são bugs hoje, mas são os **primeiros problemas operacionais** que a escala revela — listados como achados de escalabilidade.

- **🟠 E1 — Outbox como fila global única.** `src/lib/outbox/worker.ts` + cron `/api/cron/outbox` a cada 1 min. Sem particionamento/fairness por tenant e com teto de throughput ligado ao intervalo do cron + paralelismo. Em pico (milhões de mensagens), a fila global vira gargalo e uma clínica ruidosa afeta todas. A "rede anti-falha-silenciosa" (SLO nº5) depende de um monitor de profundidade que ainda não está wired (C1). **Correção:** particionar por tenant/shard, alertar profundidade/idade, considerar fila dedicada em escala. **Prioridade:** P2 (revisitar antes de escalar).
- **🟡 E2 — Custo e cardinalidade de logs.** `metrics.emit` por `clinicId` em stdout → alto volume e alta cardinalidade no Better Stack. Sem sampling/tiering, o custo de ingestão cresce linear com o tráfego e a cardinalidade de tenant pode estourar índices. **Correção:** definir sampling de métricas de alto volume, tiering de retenção, e cuidado com labels de alta cardinalidade. **Prioridade:** P2.
- **🟡 E3 — `/api/health` faz `count(*) FILTER` na `outbox`** (`route.ts:90-98`) a cada poll (5 min). Barato hoje; com uma `outbox` grande e sem índice adequado, o próprio health check vira carga no banco. **Correção:** índice parcial em `status='pending'` / consulta aproximada. **Prioridade:** P3.
- **🟠 E4 — Sem métricas de saturação do pool `postgres.js` vs. limite de conexões do Supabase.** Este é o gargalo nº1 provável em escala e está ligado ao problema já conhecido de "infinite loading = Supabase stall". Sem observar saturação de conexões, o sintoma chega como travamento, não como métrica. **Correção:** expor métricas do pool (in-use/idle/waiting) e alertar em saturação; revisar pooling (PgBouncer/Supabase pooler). **Prioridade:** P1/P2.
- **🟡 E5 — Rate limits externos (Meta messaging tier, quota Gemini) não monitorados.** Em volume, o throttling do provedor vira falha silenciosa (mensagens `failed`/IA lenta) sem sinal dedicado. **Correção:** métrica por código de throttle do provedor + alerta ao aproximar do tier. **Prioridade:** P2.

---

## 4. Lacunas Operacionais

Consolidando o que **dificulta operar em produção** hoje:

1. **Nenhum caminho de notificação comprovado** — o operador solo não é acordado por um outage (C1).
2. **O health check mente sobre dependências externas** — o sinal mais consultado durante um incidente dá falso "ok" (C2).
3. **Diagnóstico de background é cego** — webhooks/crons/worker sem Sentry e sem stack (C3).
4. **Segurança sem telemetria** — login/MFA/rate-limit invisíveis (A1, M3).
5. **Sem correlação clicável** entre Sentry, logs, auditoria e requisição (A2, A3).
6. **Sem visão em tempo real** de latência/throughput/saturação — só rollup diário (A4, E4).
7. **Recuperação não validada** — RTO nunca medido com dados reais; PITR adiado; sem MTTR (M4).
8. **Runbooks com drift** — a fonte de verdade durante incidente está desatualizada (M5).
9. **Gargalos de escala invisíveis** — fila global, saturação de conexões, custo de logs, throttle de provedores (E1–E5).

---

## 5. Plano de Evolução

### Imediato (antes do 1º cliente pagante — P0)

1. **Fechar o alerting (C1):** UptimeRobot/Better Stack em `/api/health?strict=1` e `/api/health/outbox?strict=1` com canal de notificação real (e testado); Sentry Alert Rule `environment=production`. **É o item que destrava o go-live.**
2. **Corrigir o health check externo (C2):** reachability leve com timeout **ou** derivar status de taxa de erro recente; atualizar runbooks.
3. **Levar background ao Sentry (C3):** `captureException` nos catches de webhook/cron/worker, preservando stack; métrica no parse-fail silencioso.
4. **Ligar PITR** ao entrar o primeiro cliente pagante (M4).

### Curto prazo (primeiras semanas — P1)

5. **Telemetria de auth/segurança (A1):** métricas de login/MFA/rate-limit/drift-logout.
6. **Correlação (A2/A3):** `request_id` + `clinicId`/`userId` em todas as métricas e como tag do Sentry; helper único.
7. **Trocar `console.*` do checkout/LGPD (M1)** e regra de lint.
8. **Saturação de conexões (E4/A4):** expor métricas do pool + Sentry Performance/alerta de P95.
9. **Métrica de trips de rate-limit + Redis no health (M3).**

### Médio prazo (mês 1–3 — P2)

10. **Dashboard de golden signals (RED/USE)** e cálculo de burn-rate real (A4).
11. **Runbooks reconciliados + CI de contagem de crons (M5); MTTR/MTTD no `slo.md` (M4).**
12. **Swallows com sinal (M2); restore-test trimestral com dados (M4).**
13. **Runbook de Redis (M3); web-vitals do frontend (B1).**

### Escala futura (antes de 5.000 clínicas — P2/P3)

14. **Particionar/observar a outbox por tenant + alerta de profundidade (E1).**
15. **Sampling/tiering de logs e controle de cardinalidade (E2).**
16. **Monitorar rate limits de Meta/Gemini (E5); otimizar o health query (E3).**
17. **Avaliar OpenTelemetry** (já embutido no Sentry v10) para tracing distribuído com propagação de contexto (A3).

---

## 6. Roadmap de Observabilidade (ordenado por custo × impacto × prioridade)

| # | Ação | Achado | Impacto | Custo | Prioridade |
|---|---|---|---|---|---|
| 1 | Monitor de uptime em `/api/health*?strict=1` + canal de notificação testado | C1 | 🔴 Altíssimo | Baixo | **P0** |
| 2 | Sentry Alert Rule `environment=production` → canal | C1 | 🔴 Alto | Baixo | **P0** |
| 3 | `captureException` nos catches de webhook/cron/worker (com stack) | C3 | 🔴 Alto | Baixo | **P0** |
| 4 | Health check externo por reachability/taxa de erro | C2 | 🔴 Alto | Médio | **P0** |
| 5 | Ligar PITR no 1º cliente pagante | M4 | 🔴 Alto | Baixo | **P0** |
| 6 | `request_id`+`clinicId`+`userId` em todas as métricas e tag Sentry | A2, A3 | 🟠 Alto | Baixo | **P1** |
| 7 | Telemetria de auth/segurança (login/MFA/rate-limit/drift) | A1 | 🟠 Alto | Baixo | **P1** |
| 8 | Métricas de saturação do pool `postgres.js` + Sentry Performance/P95 | A4, E4 | 🟠 Alto | Médio | **P1** |
| 9 | Trocar `console.*` de checkout/LGPD + lint `no-console` | M1 | 🟡 Médio | Baixo | **P1** |
| 10 | Métrica de rate-limit + Redis no health + runbook Redis | M3 | 🟡 Médio | Baixo | **P2** |
| 11 | Dashboard golden signals (RED/USE) + burn-rate real | A4 | 🟠 Alto | Alto | **P2** |
| 12 | Reconciliar runbooks/PROGRESS + CI de contagem de crons | M5 | 🟡 Médio | Baixo | **P2** |
| 13 | Sinal em swallows de heartbeat/impersonate/login-audit | M2 | 🟡 Médio | Baixo | **P2** |
| 14 | MTTR/MTTD + restore-test trimestral com dados | M4 | 🟡 Médio | Médio | **P2** |
| 15 | Particionar/observar outbox por tenant + alerta de profundidade | E1 | 🟠 Alto (escala) | Alto | **P2** |
| 16 | Sampling/tiering de logs + cardinalidade | E2 | 🟡 Médio (escala) | Médio | **P2** |
| 17 | Monitorar rate limits Meta/Gemini | E5 | 🟡 Médio (escala) | Médio | **P2** |
| 18 | Web-vitals do frontend (sem replay) | B1 | 🔵 Baixo | Baixo | **P3** |
| 19 | Otimizar query do `/api/health` (índice parcial) | E3 | 🔵 Baixo | Baixo | **P3** |
| 20 | Avaliar OpenTelemetry (tracing distribuído) | A3 | 🟠 Alto | Alto | **P3** |
| 21 | Recalibrar thresholds de SLO com dados reais | INFO-1 | ⚪ Info | Baixo | **P3 (recorrente)** |

---

### Conclusão

O ClinicaOS tem a **fundação de observabilidade certa** — sanitização de PII exemplar, auditoria correlacionada, SLIs de fila, um fluxo de IA bem instrumentado e runbooks escritos. O que falta não é reescrever, é **ligar os fios que ficaram para "operator-side"** e fechar três lacunas estruturais de detecção. Em ordem de urgência: **(1) conectar o alerting** (sem isso, nada mais importa — ninguém é avisado), **(2) fazer o health check enxergar outage externo real**, e **(3) levar as exceções de background ao Sentry com stack**. Feitos esses três (todos de baixo/médio custo), o sistema passa de "instrumentado" para "operável"; os demais itens elevam a maturidade para a escala pretendida.

> **Artefatos prontos para aplicar:** os configs de dashboard (uptime/Sentry/Better Stack) e os patches de código para C1/C2/C3/A1/A2 estão em [`auditoria-monitoramento-artefatos.md`](./auditoria-monitoramento-artefatos.md).

> Todas as afirmações deste relatório são verificáveis nos arquivos citados (`arquivo:linha`), sem alterar nada. As mais críticas: `src/app/api/health/route.ts:60-63,107-113` (C2), `src/app/api/webhooks/asaas/route.ts:128-130` + `src/lib/observability/sanitize-fields.ts:19-23` (C3), `docs/c16/go-live-checklist.md` item #2 (C1).
