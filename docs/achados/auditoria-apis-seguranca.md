# Auditoria de APIs — Segurança & Arquitetura

> **Escopo:** superfície de API do ClinicaOS_V2 (Qoro) — **route handlers** (`/api/*`,
> webhooks, cron, health, logout, export, PDF) + **server actions** (`"use server"`).
> Não existe API REST versionada nem OpenAPI: a maior superfície de mutação são as
> server actions.
> **Método:** auditoria manual expert, validando implementação contra a documentação
> oficial (`docs/`, ADRs). Pensando como atacante, engenheiro pré-escala e DevSecOps.
> **Natureza:** somente leitura. Nenhum código foi alterado.
> **Data:** 2026-07-12 · **Branch:** `docs/identity-practitioner-model`
>
> **🔧 REMEDIADA em 2026-07-15** — ver §0 (placar) e o bloco **Remediação** dentro de
> cada achado. Rodapé com data/branch/commits/resultado no fim do documento.

---

## 0. Placar da remediação (2026-07-15)

| # | Sev | Status | Essência da correção |
|---|-----|--------|----------------------|
| **A1** | ALTA | ✅ Resolvido | Bearer/super_admin exigido (a doc já mandava); `payload` com `sqlstate` fora do corpo |
| **A2** | ALTA | ✅ Resolvido | Verify-then-act: corpo é notificação, `getPayment()` é a verdade |
| **A3** | ALTA | ⚠️ Parcial (curto prazo ✅) | Filtro `clinic_id` defensivo em todas as mutations; role sem BYPASSRLS → C16 |
| **M1** | MÉDIA | ✅ Resolvido | Já estava; fechados os resíduos (teste do helper + 2ª primitiva removida) |
| **M2** | MÉDIA | ✅ Resolvido | Single-factor assumido formalmente; `assertCronAuth` único; 401 alarmado |
| **M3** | MÉDIA | ✅ Resolvido | Rate limit em convite/resend, MFA e step-save |
| **B1** | BAIXA | ✅ Resolvido | `toErrorResponse` nos 2 handlers (o helper tinha zero consumidores) |
| **B2** | BAIXA | ✅ Resolvido | `requireCachedAnyPermission`; **era bug, não cosmético** (ver bloco) |
| **B3** | BAIXA | ✅ Resolvido | `requireSuperAdmin()` no topo + UUID validado |
| **B4** | BAIXA | ✅ Resolvido | Arch-test por varredura + reconhece factory; 6 actions saíram do ponto cego |
| **B5** | BAIXA | ✅ Resolvido | 200 do webhook vira `{received:true}` |
| **B6** | BAIXA | ✅ Resolvido | Cap de 12 meses (422) + truncagem explícita + rate-limit de PDF |
| **B7** | BAIXA | 🚫 Não aplicável | Dívida consciente e documentada (ADR-022 §11.17) — ver justificativa |
| **Doc** | — | ✅ Resolvido | Escopo de MFA e números de rate-limit corrigidos na VisãoGeral |

**Achados NOVOS encontrados durante a remediação** (não estavam na auditoria):

| # | Onde | Essência |
|---|------|----------|
| **N1** | `health-auth.ts` / `cron-auth.ts` | `CRON_SECRET` é `optional()` no schema → `` `Bearer ${undefined}` `` interpolava para a string **"Bearer undefined"**, que autenticava. As rotas escapavam só porque chamavam `assertCronRuntimeReady()` antes — a segurança dependia da memória de quem chama. Fail-close movido para dentro dos helpers; teste trava a regressão. |
| **N2** | `audit-export.service.tsx` | O export truncava em 5000 linhas **em silêncio** e o `sha256` ia para `super_admin_actions` como se atestasse o período inteiro — atestação enganosa num artefato cujo motivo de existir é prova. |
| **N3** | `financeiro/lancamento-actions.ts` | `messageFrom` devolvia `err.message` de **qualquer** erro à UI: uma negativa de permissão exibia *"Permissão 'manage:financial' negada (cached). Verifique role/overrides."*; um erro de driver vazaria igual. |
| **N4** | UI do financeiro | As actions que já usavam a porta única caíam no genérico *"Tente novamente"* ao negar permissão — mensagem errada **e** enganosa (tentar de novo não resolve). O mapeamento por `err.name` só conhecia um erro que a porta única nunca lançou. |
| **N5** | `smoke-c4.ts` 4.6.25 | O smoke se chamava *"dual-factor … = 401"* e o próprio corpo admitia (`void res1`) que não testava isso — a mentira do M2 propagada para o teste. |
| **N6** | `rate-limit.ts` (docblock) | O burst do fallback na borda é **2×limite − 1** (a janela é ancorada no 1º hit, e ele consome orçamento), não o "~2×" afirmado. Medido em teste. |

**Método da remediação:** cada correção crítica foi **provada** quebrando o código de
propósito e verificando o teste ficar vermelho — não deduzida. As evidências estão em
cada bloco.

---

## 1. Resumo Executivo

### Estado geral

O codebase é **maduro e disciplinado em segurança — acima da média para um MVP**. A
arquitetura de autorização é centralizada, coerente com os ADRs, e defendida por
múltiplas camadas + backstops automatizados (ESLint + arch-tests + CI gates). Os achados
desta auditoria são **pontuais e de refino**, não falhas estruturais. A maioria dos riscos
mais sérios **já está documentada como dívida consciente** para a camada C16 (Observability
& Hardening), ainda pendente.

Pilares bem implementados (detalhados na §4):

- **Porta única de autorização** (`src/lib/auth/tenant-context.ts`): toda action/route
  revalida ali; nada mais em `src/` lê cookie/JWT ou checa role (ESLint enforça).
- **Tenant-id sempre de _claim confiável_**, nunca de input do usuário nos caminhos tenant.
- **Isolamento por RLS via `withTenant`** (`SET LOCAL ROLE authenticated` + GUC
  `app.current_clinic`), com policies dual-context geradas por helper único.
- **Criptografia per-tenant** AES-256-GCM + HKDF, chave-mestra no Google Secret Manager
  em produção; ponto único de descriptografia.
- **Outbox / audit / idempotency transacionais** (enqueue exactly-once, delivery
  at-least-once, handlers idempotentes).
- **Impersonation server-authoritative** (linha autoritativa + cookie HMAC constant-time,
  AAL2/MFA obrigatório, TTL 1h, bind ao super_admin, auditado).
- **Webhook Meta com HMAC verificado antes do parse** + cap de tamanho (defesa DoS).
- **Clients de integração** (Meta/Gemini/Asaas) com timeout via `AbortController`,
  classificação de erro, sem SSRF (hosts fixos), sem vazamento de payload.

### Principais riscos (pontos críticos)

| # | Achado | Severidade | Essência |
|---|--------|-----------|----------|
| **A1** | `/api/health/auth-hook` sem auth vaza erro cru | **ALTA** | Endpoint anônimo executa RPC `SECURITY DEFINER` sobre `dbAdmin` e devolve `e.message` no 500 |
| **A2** | Webhook Asaas confia em token estático (sem HMAC) | **ALTA** | Quem tiver/adivinhar o token forja evento e dirige estado financeiro (reabrir clínica, estorno) |
| **A3** | Isolamento tenant depende de `withTenant`; esquecê-lo **vaza** (não fail-close) | **ALTA** | `db` roda com role BYPASSRLS; um `withTenant` esquecido em código tenant vaza cross-tenant. Agravado por mutations que escopam só por id de linha |

Nenhum achado indica exploração ativa nem falha em produção **hoje**; A1 é o de maior
exposição imediata (não-autenticado). A2 exige aceite explícito de risco. A3 é
arquitetural e já mapeado para C16 — mas é o de maior impacto potencial se um único
descuido de migration/`withTenant` passar pelo CI.

---

## 2. APIs analisadas

### 2.1 Route handlers (endpoints HTTP)

Legenda de status: ✅ sólido · ⚠️ achado registrado · 🔵 informativo.

| Endpoint | Método | Função | Autenticação | Status |
|---|---|---|---|---|
| `/logout` | POST | Sign-out global (revoga refresh token) | Sessão do próprio caller | ✅ |
| `/api/health` | GET | Healthcheck agregado (db/gemini/meta/asaas/outbox) | Bearer `CRON_SECRET` **ou** super_admin AAL2 | ⚠️ M1 |
| `/api/health/auth-hook` | GET | Self-test do `custom_access_token_hook` | **NENHUMA** (intencional) | ⚠️ **A1** |
| `/api/health/outbox` | GET | SLIs de outbox/idempotency/audit | Bearer `CRON_SECRET` **ou** super_admin AAL2 | ⚠️ M1, B1 |
| `/api/webhooks/asaas` | POST | Transições de estado de cobrança (Asaas) | Token estático `asaas-access-token` (constant-time) | ⚠️ **A2**, B5 |
| `/api/webhooks/meta` | GET | Handshake de verificação do webhook | `hub.verify_token` (compare `===`) | ⚠️ M1 |
| `/api/webhooks/meta` | POST | Inbound WhatsApp (mensagens/status) | **HMAC-SHA256** `x-hub-signature-256` (pré-parse) | ✅ |
| `/relatorios/pdf` | GET | Exporta relatórios em PDF | `requireUser()` + `requireClinicId()` | ⚠️ B6 |
| `/admin/clinicas/[id]/audit/export` | POST | Gera PDF de auditoria + signed URL | `guardAdminAccess()` → super_admin AAL2 ou 404 | ⚠️ B1, B6 |
| `/api/cron/outbox` | GET | Drena o worker do outbox | Bearer `CRON_SECRET` | ⚠️ M1, M2 |
| `/api/cron/patient-hard-delete` | GET | **Hard-delete/anonimiza** pacientes | Bearer `CRON_SECRET` | ⚠️ M1, M2 |
| `/api/cron/data-retention` | GET | **Purga** outbox/login_attempts/idempotency | Bearer `CRON_SECRET` | ⚠️ M1, M2 |
| `/api/cron/billing-dunning` | GET | Avança dunning, bloqueia acesso da clínica | Bearer `CRON_SECRET` | ⚠️ M1, M2 |
| `/api/cron/billing-reconcile` | GET | Reconcilia faturas vs Asaas | Bearer `CRON_SECRET` | ⚠️ M1 |
| `/api/cron/financial-reconcile` | GET | Abre pendências de faturamento | Bearer `CRON_SECRET` | ⚠️ M1 |
| `/api/cron/cash-flow-rollup` | GET | Rollup diário de fluxo de caixa | Bearer `CRON_SECRET` | ⚠️ M1 |
| `/api/cron/metrics-rollup` | GET | Rollup diário de métricas | Bearer `CRON_SECRET` | ⚠️ M1 |
| `/api/cron/audit-partitions` | GET | Cria partições mensais de `audit_events` | Bearer `CRON_SECRET` | ⚠️ M1 |
| `/api/cron/invites-cleanup` | GET | Anonimiza convites obsoletos (LGPD) | Bearer `CRON_SECRET` | ⚠️ M1 |
| `/api/cron/proactive-reminders` | GET | Dispara jobs de lembrete | Bearer `CRON_SECRET` | ⚠️ M1 |
| `/api/cron/proactive-dunning` | GET | Dispara jobs de cobrança | Bearer `CRON_SECRET` | ⚠️ M1 |
| `/api/cron/proactive-followup` | GET | Dispara jobs de follow-up | Bearer `CRON_SECRET` | ⚠️ M1 |

> **Perímetro:** o `src/middleware.ts` **exclui** `api/health`, `api/cron`, `api/webhooks`,
> os fluxos de auth, `account/security` e `join` do matcher — cada uma dessas rotas
> **se auto-autentica**. O middleware é camada de UX/heal (drift de claims), **não** de
> enforcement (ADR-009 D22).

### 2.2 Server actions (por contexto)

| Grupo | Arquivo | Padrão de enforcement | Status |
|---|---|---|---|
| Auth público | `login/`, `forgot-password/`, `reset-password/`, `login/mfa/` | Session-less + rate-limit (login/reset) | ⚠️ M3 (MFA-verify) |
| Onboarding | `join/[token]/`, `convite/` | Token 256-bit + rate-limit (`assertJoinAllowed`) | ✅ (⚠️ M3 step-save) |
| Patient | `contexts/patient/actions.ts` | `requireUser → requireFreshPermission → Zod → idempotentMutation` | ✅ exemplar |
| Clinical | `contexts/clinical/actions.ts` | fresh p/ assinar; cached p/ update de alta frequência | ✅ (⚠️ A3) |
| Scheduling | `contexts/scheduling/actions.ts` | `requireFreshPermission(EDIT_AGENDA)` | ✅ |
| Financial | `contexts/financial/actions.ts` | checks à mão + `idempotentMutation` | ⚠️ A3, B2 |
| Fornecedores | `financeiro/fornecedores/actions.ts` | `requireCachedPermission` + RLS-only scope | ⚠️ A3 |
| Tenancy | `contexts/tenancy/actions.ts` | `requireFreshPermission(MANAGE_SETTINGS)` | ✅ |
| Equipe | `equipe/actions.ts` + `identity/internal/members.ts` | fresh + `assertCanAssignRole` anti-escalation | ⚠️ M3 (sem rate-limit) |
| Messaging (super_admin) | `contexts/messaging/actions.ts` | `superAdminAction → requireSuperAdmin` (clinicId de input) | ⚠️ B3 |
| Account/Security (MFA) | `account/security/actions.ts` | AAL2 p/ unenroll | ⚠️ M3 |
| Impersonation | `lib/impersonation/` | server-authoritative + AAL2 + HMAC | ✅ exemplar |

---

## 3. Achados

> Ordenados por severidade. Cada bloco correlaciona o achado com a documentação, como
> pedido. Referências de linha conforme o estado do branch auditado.

---

### A1 — Endpoint de health não autenticado que vaza mensagem de erro interna

- **Severidade:** ALTA
- **Categoria:** Segurança
- **Arquivo:** `src/app/api/health/auth-hook/route.ts`
- **Local:** `route.ts:26-47` (sem auth); `route.ts:38-45` (retorno de `e.message`); usa
  `dbAdmin` em `route.ts:21,28`.
- **Descrição:** o endpoint `GET /api/health/auth-hook` é **intencionalmente
  não-autenticado** (docblock `:10-13`) e executa a RPC `auth_hook_selftest()`
  (`SECURITY DEFINER`) através da conexão `dbAdmin` (BYPASSRLS). No caminho de erro, ele
  devolve `e instanceof Error ? e.message : String(e)` no corpo do 500 — texto cru de
  erro do driver/Postgres para qualquer chamador anônimo.
- **Impacto:** (1) **vazamento de informação** — a `e.message` pode expor detalhes de
  conexão, nome de função/objeto, estado do banco; (2) **oráculo de liveness / DoS leve**
  — cada hit anônimo dispara um round-trip de banco sobre a conexão privilegiada, sem
  rate-limit; (3) contradiz o próprio docblock ("não vaza dados sensíveis").
- **Como pode acontecer:** qualquer pessoa na internet faz `GET` na rota; se a RPC ou o
  banco falharem (saturação, migração, permissão), a resposta carrega o erro cru.
- **Cenário de exemplo:** durante um incidente de banco, um atacante fazendo polling
  recebe `error: "permission denied for function auth_hook_selftest"` ou detalhes de
  timeout — mapeando estrutura interna e confirmando degradação.
- **Correção recomendada:** (a) nunca retornar `e.message` — devolver envelope genérico
  (`toErrorResponse` já existe em `src/lib/http/error-response.ts`) e mandar o erro real
  só para logs/Sentry; (b) considerar exigir o Bearer `CRON_SECRET` (como os outros health)
  ou pelo menos um rate-limit por IP; (c) alinhar o docblock à realidade.
- **Prioridade:** Alta (fix pequeno, exposição não-autenticada).
- **Doc relacionada:** ADR-010 (SECURITY DEFINER), C16 §error-envelope; contradiz o
  princípio de "sem leak" de `error-response.ts:11-14`.

#### 🔧 Remediação — ✅ Resolvido (commit `aede5dd`)

**Estado ao remediar (divergência da auditoria):** o eco de `e.message` no `catch` já
tinha sido sanado pela remediação V11. Sobrava o pior: o path de **falha** devolvia o
`payload` cru da RPC (`{ok:false, error, sqlstate}`) a qualquer anônimo.

**Implementação:**
- `src/app/api/health/auth-hook/route.ts` — falha para de devolver `payload` (log +
  envelope genérico); rota passa a exigir Bearer `CRON_SECRET` **ou** super_admin AAL2.
- `src/lib/http/health-auth.ts` (novo) — `healthAuthLevel()` extraído. `authLevel`
  estava **duplicado** em `health/route.ts` e `health/outbox/route.ts`; o auth-hook
  seria a 3ª cópia. Módulo separado do `cron-auth` de propósito: aqui a resolução de
  super_admin lê cookie, e o caminho de cron precisa continuar puro sobre `Request`.
- Docblock alinhado (afirmava "não vaza dados sensíveis"); runbooks c3-validation e
  production-readiness atualizados.

**Gate de compatibilidade (executado ANTES de mexer):** consumidores levantados —
nenhum no código, nenhum em `vercel.json`, nenhum no CI; só o monitor externo. A doc
**já descrevia a rota como autenticada** (`production-readiness.md` §5: "Todos os
health endpoints exigem `Authorization: Bearer <CRON_SECRET>`"; §5.2: "mesmo header
Bearer") — era o código que divergia. A rota irmã `/api/health/outbox` já exige Bearer
e é monitorada "no mesmo padrão", o que prova que a ferramenta envia header. Ação
operacional registrada no runbook §5.2: conferir o header no monitor antes do deploy.

**Validação:** `health-auth.test.ts` (10 casos). Evidência do N1: removendo o guard
`secret &&`, o caso *"Bearer undefined"* falha com `expected 'monitoring' to be
'denied'` — a autenticação acontecia de fato. typecheck, lint, arch:db-check, test.

**Impacto:** *segurança* — fecha vazamento de `sqlstate`/estado interno a anônimo e
elimina o oráculo de liveness sobre a conexão privilegiada; fecha o N1, que afetava
**todas** as rotas de health. *Consistência* — a rota deixa de ser a única anônima de
`/api/health/**`; auth das três num ponto só. *Manutenção* — 3ª cópia de `authLevel`
evitada. *Contrato* — a rota passa a exigir auth (mudança deliberada, alinhada à doc).

---

### A2 — Webhook Asaas confia em token estático compartilhado, sem assinatura do corpo

- **Severidade:** ALTA
- **Categoria:** Segurança / Lógica de negócio
- **Arquivo:** `src/app/api/webhooks/asaas/route.ts`, `src/contexts/billing/internal/providers/asaas.ts`
- **Local:** validação do token em `route.ts:52` + `asaas.ts:404-407`; síntese da chave de
  dedup em `asaas.ts:388-389`; transições financeiras em `route.ts:96-116`.
- **Descrição:** a confiança no webhook do Asaas repousa **inteiramente** num token
  estático (`ASAAS_WEBHOOK_TOKEN`) enviado no header `asaas-access-token`, comparado em
  tempo constante. **Não há assinatura HMAC do corpo** — diferente do caminho Meta
  (`x-hub-signature-256`). Ou seja, não existe prova criptográfica de que o payload
  originou-se do Asaas; qualquer um que possua/adivinhe o token pode postar um evento
  forjado. Agravante: quando o Asaas omite `body.id`, a chave de deduplicação é sintetizada
  como `${event}:${paymentId}:${status}` (`asaas.ts:388-389`) — **controlável por quem tem
  o token**.
- **Impacto:** um evento forjado pode dirigir o estado financeiro/acesso: `markInvoicePaid`
  (reabre uma clínica bloqueada por inadimplência), `markInvoiceOverdue`, `markInvoiceRefunded`.
  A chave de dedup influenciável permite descartar silenciosamente eventos reais distintos
  que compartilhem `(event, paymentId, status)`, ou pré-ocupar/reproduzir um slot.
- **Como pode acontecer:** vazamento do token (log, config, painel Asaas comprometido) →
  POST direto ao endpoint. Compare constant-time + dedup + **transições monotônicas**
  (`canTransition`) mitigam, mas o vetor "reabrir clínica bloqueada marcando fatura paga"
  é plausível.
- **Cenário de exemplo:** clínica inadimplente (acesso bloqueado por `billing-dunning`);
  o operador da clínica, de posse do token (ou um atacante que o vazou), posta
  `PAYMENT_CONFIRMED` para a própria `paymentId` e reativa o acesso sem pagar.
- **Correção recomendada:** (a) documentar **aceite de risco explícito** já que o Asaas não
  oferece HMAC nativo em todos os planos — OU habilitar/validar a assinatura do Asaas se
  disponível na conta; (b) tornar a **reconciliação diária a fonte de verdade** para
  transições sensíveis (reabertura de acesso), tratando o webhook como sinal rápido não
  autoritativo (já é o desenho documentado — reforçar que a reabertura de `clinics.status`
  só se confirme na reconciliação); (c) **nunca** aceitar chave de dedup sintética
  influenciável — exigir `body.id` do provider ou derivar de campos assinados; (d) rotacionar
  o token e restringir o IP de origem (allowlist Asaas) se o Vercel permitir.
- **Prioridade:** Alta (impacto financeiro/acesso; requer decisão de produto/risco).
- **Doc relacionada:** ADR-025 (billing: "Asaas = fonte do pagamento; ClinicaOS = fonte do
  acesso"; reconciliação diária é a verdade), `docs/contracts/events/billing.md`,
  `docs/runbooks/asaas-webhook-missing.md`.

#### 🔧 Remediação — ✅ Resolvido (commit `0eac706`)

**Solução DIFERENTE da recomendada, com motivo.** A auditoria sugeria (b) "tratar o
webhook como sinal não autoritativo, reabertura de acesso só na reconciliação". Ao
implementar, isso se mostrou uma **regressão de produto**: o `billing-reconcile` roda
1×/dia e só varre invoices `open`/`overdue` — uma clínica que pagasse ficaria bloqueada
por até 24h. O founder aprovou a alternativa que dá a mesma garantia sem o lockout:

**Verify-then-act.** O corpo do webhook é **notificação, não dado**: dele saem apenas
`body.id` e `payment.id`. Status, valor, vencimento e o vínculo com a subscription vêm
de `getPayment()` — quem tem o token não consegue fazer a **API do Asaas** mentir.

**Implementação:**
- `ParsedWebhook` **reduzido** a `{eventId, event, paymentId}`. Os campos forjáveis não
  existem mais no tipo — para ninguém voltar a persistí-los sem perceber. O `event`
  vira rótulo; quem decide é `actionFor(payment.status)`, com a **mesma tabela de
  status do `billing-reconcile`** (webhook e reconciliação precisam concordar).
- **`body.id` obrigatório** → 400 + `billing.webhook.unparseable`. Mata a chave
  sintética, que era escolhível pelo atacante **e** causava bug real: dois eventos
  legítimos distintos com a mesma tripla `(event, paymentId, status)` colapsavam e o
  2º sumia como "duplicate".
- **`subscriptionId` passa a vir do provider** — era o vetor de parear um `paymentId`
  real com a subscription de **outra** clínica.
- **`getPayment()` roda FORA da transação.** HTTP dentro da tx prenderia conexão +
  lock de `processed_webhooks` por até 30s; um Asaas lento esgotaria o pool.
- **Orçamento explícito (`attempts: 1`).** O default de 3 tentativas × 10s
  (`ASAAS_HTTP_TIMEOUT_MS`) + backoff = **30,6s**, contra o `maxDuration = 30` da rota
  — a versão ingênua estouraria a invocação. Retentar aqui é redundante: o Asaas
  re-entrega em ≠2xx e o reconcile é backstop.
- **Aceite de risco registrado** (ADR-025 addendum): o token estático segue sendo a
  autenticação (o Asaas não oferece HMAC de corpo), mas deixou de ser suficiente para
  *dirigir estado* — no máximo permite disparar uma consulta ao Asaas.

**Validação:** `route.test.ts` (16 casos). **Evidência:** com a decisão dirigida pelo
corpo (comportamento antigo), o teste do payload forjado falha com *"expected spy to
not be called at all, but actually been called 1 times"* — o `PAYMENT_CONFIRMED`
forjado **marcava a fatura como paga de fato**, e `markInvoicePaid` →
`setClinicAccess('enabled')` reabria a clínica. Não era risco teórico. Cobertos também:
`getPayment` falhando → 500 sem persistir; concorrência (2 POSTs simultâneos → 1
transição); `outcome` correto nos 3 caminhos.

**Impacto:** *segurança* — elimina a classe "evento forjado dirige estado
financeiro/acesso". *Correção* — conserta o dedup que descartava eventos legítimos em
silêncio. *Performance* — **+1 chamada externa por evento de billing** (volume baixo) e
+até ~10s no pior caso; o webhook passa a depender da disponibilidade do Asaas
(indisponível → 500 → re-entrega → reconcile). Trade-off aceito e documentado.
*Observabilidade* — `billing.webhook.verify {duration_ms, outcome}`; alerta p95 > 5s/5min
em `c16/slo.md` §3.1. ⚠️ **Threshold definido, disparo não wired** (go-live #2 aberto).

**Observação:** a auditoria recomendava também "(d) restringir IP de origem
(allowlist Asaas)". Não implementado: a Vercel não oferece allowlist de IP por rota no
plano atual, e o verify-then-act torna o vetor irrelevante — um POST forjado de
qualquer IP não muda estado.

---

### A3 — Isolamento tenant depende de `withTenant`; um esquecimento **vaza** em vez de fail-close

- **Severidade:** ALTA
- **Categoria:** Arquitetura / Segurança
- **Arquivo:** `src/lib/db/index.ts`, `src/lib/db/tenant.ts`, `src/lib/db/rls.ts`; mutations
  em `src/contexts/financial/actions.ts`, `src/contexts/clinical/actions.ts`
- **Local:** pool `db` (`index.ts:85-114`); `withTenant` (`tenant.ts:40-49`); mutations
  que escopam só por id: `financial/actions.ts:161,251,311`, `clinical/actions.ts:168,221`,
  suppliers `financial/actions.ts:437,465`.
- **Descrição:** o próprio ADR-007 (correção "F-01") admite que **`FORCE ROW LEVEL SECURITY`
  não é a defesa runtime principal**: o role do pooler (`postgres.<ref>`) possui `BYPASSRLS`,
  então `FORCE` não o sujeita às policies. A defesa real é o `SET LOCAL ROLE authenticated`
  dentro de `withTenant`, que rebaixa a conexão para um role sem BYPASSRLS. **Consequência:
  um caminho tenant que esqueça `withTenant` (ou faça um `db.query()` cru) vaza cross-tenant
  — não falha fechado.** Hoje isso é barrado apenas por _tooling_ (`scripts/arch-db-check.ts`
  AST fail-closed + ESLint `no-restricted-imports` + `connection-origin-guard.ts`), não pelo
  banco. O ADR marca como dívida de C16 dar ao pool `db` um role dedicado sem BYPASSRLS
  (aí sim fail-close real).
  **Agravante independente:** muitas mutations privilegiadas escopam **só pelo id da linha**
  e confiam 100% em RLS, sem um filtro `clinic_id` defensivo em profundidade
  (`confirmPayment`/`cancelLancamento`/`createEstorno`, `updateProntuario`/`signProntuario`,
  `updateSupplier`/`setSupplierAtivo`). Uma única tabela tenant que perca sua policy
  `defaultTenantPolicy()` numa migration → mutação cross-tenant via UUID conhecido.
- **Impacto:** vazamento/alteração de dados entre clínicas caso (a) um `withTenant` seja
  esquecido em código novo e o guard AST não pegue, ou (b) uma tabela tenant fique sem
  policy. Ambos são "single point of failure" com detecção só em CI/lint.
- **Como pode acontecer:** dev novo adiciona uma query num contexto sem `withTenant` numa
  forma que o AST não reconhece; ou uma migration cria tabela tenant sem colar
  `defaultTenantPolicy()` e o checklist de PR não é seguido.
- **Cenário de exemplo:** operador da clínica A descobre o UUID de um `lancamento` da
  clínica B (ex.: vazou num link/relatório) e chama `confirmPayment({lancamentoId})`; se a
  tabela `lancamentos` estiver com policy intacta, RLS bloqueia — mas não há segunda barreira
  no código da action.
- **Correção recomendada:** (curto) manter os guards e **adicionar filtro `clinic_id`
  defensivo** nas mutations críticas (`AND clinic_id = :clinicId` no `where`), transformando
  RLS numa segunda camada, não na única; (médio/longo, C16) **provisionar um role dedicado
  não-BYPASSRLS** para o pool `db`, tornando o esquecimento de `withTenant` fail-close;
  garantir que o `arch-db-check` cubra formas de arrow-function/factory (ver B4).
- **Prioridade:** Alta (arquitetural; já roadmapped para C16, mas o filtro defensivo é curto prazo).
- **Doc relacionada:** ADR-007 §"Correction — Remediation F-01" (linhas ~139-183),
  `docs/CONVENTIONS.md` (threat model + checklist de nova tabela), `docs/runbooks/c2-validation.md`.

#### 🔧 Remediação — ⚠️ Parcialmente resolvido (curto prazo ✅ · commit `5bbbd23`)

**Estado ao remediar (divergência da auditoria):** o filtro defensivo **já existia na
árvore de trabalho**, mas **não estava commitado** — junto de outros 85 arquivos. Um
`git checkout` o teria apagado, e **nada no CI perceberia**: o `arch-db-check` verifica
de onde os pools podem ser importados, não se uma query filtra por tenant. Por isso a
primeira ação da remediação foi commitá-lo, antes de qualquer código novo.

**Implementação (curto prazo — ✅):** `AND clinic_id = :clinicId` no `where` das 7
mutations auditadas (`confirmPayment`, `cancelLancamento`, `createEstorno`,
`updateSupplier`, `setSupplierAtivo`, `updateProntuario`, `signProntuario`). A
verificação foi além da amostra da auditoria: **todos** os 26 arquivos
`contexts/**/actions*.ts` + `app/**/actions*.ts` foram varridos — **zero** escopos
só-por-id restantes. RLS deixa de ser a única barreira nesses caminhos.

**Implementação (longo prazo — ⚠️ diferido a C16):** existe o opt-in
`DATABASE_URL_RUNTIME` (`db/index.ts`) — quando definido, o pool runtime conecta por um
role **sem BYPASSRLS**, e um `withTenant` esquecido retorna 0 linhas em vez de vazar
(fail-close real). É `.optional()`: **por default o pool segue com BYPASSRLS**. Falta
provisionar o role no Postgres e apontar a env — infra, não código. Segue como dívida
de C16, agora com o caminho pronto.

**Residual conhecido (aceito, documentado):** caminhos `internal/`/cron escapam da
varredura de `actions.ts` e escopam por id em pools **BYPASSRLS** —
`billing/internal/subscriptions.ts`, `billing/internal/provisioning.ts`,
`patient/internal/hard-delete.ts`, handlers de outbox, `cron/billing-dunning`. Risco
menor por construção: o id vem de varredura server-side confiável, não de input do
cliente. Fica registrado para a próxima auditoria não reabrir como novidade.

**Validação:** `arch:db-check` (601 arquivos, 0 findings), typecheck, lint, test, build
verdes no commit de preservação.

**Impacto:** *segurança* — mutação cross-tenant por UUID conhecido passa a exigir
**duas** falhas simultâneas (RLS + filtro), não uma. *Escalabilidade* — inalterada (o
filtro casa com o índice de `clinic_id`). *Observação de processo:* o achado mais
valioso aqui não foi técnico — foi que a correção existia e estava a um comando de
sumir sem deixar rastro.

---

### M1 — Comparação timing-unsafe de `CRON_SECRET` / `verify_token` (sistêmico)

- **Severidade:** MÉDIA
- **Categoria:** Segurança
- **Arquivo:** 15 handlers em `src/app/api/cron/**` e `src/app/api/health/**` + `webhooks/meta`
- **Local (confirmado):** `cron/outbox:37`, `cron/audit-partitions:32`, `cron/billing-dunning:28`,
  `cron/billing-reconcile:28`, `cron/cash-flow-rollup:30`, `cron/data-retention:39`,
  `cron/financial-reconcile:39`, `cron/invites-cleanup:31`, `cron/metrics-rollup:29`,
  `cron/patient-hard-delete:50`, `cron/proactive-dunning:21`, `cron/proactive-followup:19`,
  `cron/proactive-reminders:21`, `health/route.ts:46`, `health/outbox/route.ts:74`; verify
  token do Meta em `webhooks/meta/route.ts:88`.
- **Descrição:** todos comparam o Bearer com `===`/`!==` de string, ao passo que o **próprio
  codebase** já usa comparação em tempo constante (`constantTimeEqual` no Asaas, `timingSafeEqual`
  no HMAC do Meta). É uma inconsistência interna.
- **Impacto:** teoricamente, um oráculo de timing sobre o segredo. Na prática a
  explorabilidade é **baixa** (jitter de rede ≫ delta por caractere; o segredo tem ≥32 chars
  de alta entropia — `env.ts:64`). É mais dívida de consistência/hardening do que risco real.
- **Como pode acontecer:** ataque de timing remoto — inviável na prática com jitter de rede,
  mas trivial de eliminar.
- **Cenário de exemplo:** n/a realista; o valor aqui é padronizar para não deixar o padrão
  inseguro se espalhar por copy-paste.
- **Correção recomendada:** extrair um helper `timingSafeBearer(req, secret)` usando
  `crypto.timingSafeEqual` (com checagem de tamanho) e usá-lo em todos os handlers cron/health
  e no verify_token do Meta.
- **Prioridade:** Média (fix mecânico, remove um anti-padrão sistêmico).
- **Doc relacionada:** ADR-011 (invariante 28 — auth de cron), padrão constant-time já usado em
  `meta-cloud.ts:184-194` e `asaas.ts`.

#### 🔧 Remediação — ✅ Resolvido (commits `5bbbd23`, `b3ad3b3`)

**Estado ao remediar (divergência da auditoria):** já estava feito. `safeEqual`
(`node:crypto` `timingSafeEqual`) guardava os **17** checks (15 cron/health + verify
token do Meta + token do Asaas); zero `===` sobre segredo. Bônus além do pedido:
`CRON_SECRET_DESTRUCTIVE` separando os 3 crons destrutivos.

**Resíduos fechados:**
1. **O helper não tinha um teste.** Ele guarda todos os checks de auth do sistema. O
   contrato que importa é *"NUNCA lança"*: `crypto.timingSafeEqual` cru **lança** com
   buffers de tamanhos diferentes — se escapasse, um header `Authorization` de tamanho
   errado viraria 500 em vez de 401 (oráculo de tamanho de segredo + cron derrubado).
   `secret-compare.test.ts`: 18 casos, incluindo o utf8 (`'é'` vs `'e'`: 1 char, 2 vs 1
   **byte**) — exatamente o que faz o `timingSafeEqual` cru lançar.
2. **Segunda implementação de cripto removida.** O Asaas tinha um `constantTimeEqual`
   à mão (`charCodeAt` XOR, comparando **code units UTF-16** em vez de bytes). Trocado
   por `safeEqual` → ponto único em `src/`. Comportamento preservado: o schema
   (`emptyToUndefined` + `min(1)`) garante que `ASAAS_WEBHOOK_TOKEN` nunca é `''`, e a
   rota segue exigindo o token via `assertBillingWebhookReady()`.

**Validação:** 18 casos novos; typecheck, lint, arch:db-check.

**Impacto:** *segurança* — o helper que decide toda autenticação de máquina passa a ter
rede. *Manutenção* — duas primitivas de cripto para o mesmo fim era uma para revisar,
testar e acertar duas vezes.

**Observação — mudança de classificação:** M1 chegou como MÉDIA/aberto e estava
**resolvido**. O trabalho real foi o oposto do pedido: não aplicar o helper, mas
**testá-lo** e eliminar seu concorrente.

---

### M2 — "Dual-factor" de cron é single-factor na prática + blast radius de um segredo só

- **Severidade:** MÉDIA
- **Categoria:** Segurança / Arquitetura
- **Arquivo:** todos os `src/app/api/cron/**/route.ts` (padrão `isAuthorized()`)
- **Local:** ex. `cron/outbox/route.ts:45-54` (header apenas `metrics.emit` + `return true`);
  docblock `cron/outbox/route.ts:7-12` afirma rejeição que o código não faz.
- **Descrição:** a doc descreve auth de cron como "dual-factor" (Bearer `CRON_SECRET` +
  presença do header `x-vercel-cron`). No código, a presença do header é apenas **logada**
  (`metrics.emit`) e a função **sempre retorna `true`** — ou seja, o único gate real é o
  segredo compartilhado. Além disso, `OUTBOX_CRON_ALLOW_NON_VERCEL=true` ou qualquer
  `NODE_ENV` não-produção silencia até o log. Como **o mesmo `CRON_SECRET`** guarda desde
  health read-only até endpoints **destrutivos** (`data-retention` faz DELETEs em lote;
  `patient-hard-delete` apaga PII; `billing-dunning` bloqueia acesso da clínica), o blast
  radius de um vazamento do segredo é máximo.
- **Impacto:** vazamento de um único segredo → capacidade de disparar destruição de dados e
  mudança de estado de acesso em todos os tenants. E a doc superestima o controle existente
  (falsa sensação de defesa em profundidade).
- **Como pode acontecer:** o segredo aparece em log, config, screenshot, ou é reusado; sem
  segundo fator efetivo, quem o tem chama qualquer cron.
- **Cenário de exemplo:** o `CRON_SECRET` vaza em um log de erro; um atacante chama
  `GET /api/cron/patient-hard-delete?limit=1000` fora da janela agendada.
- **Correção recomendada:** (a) **enforçar** de fato a origem Vercel (rejeitar se o header
  faltar em produção) OU aceitar formalmente que é single-factor e ajustar os docblocks para
  não mentir; (b) considerar **segredos por classe de rota** (um para crons destrutivos,
  outro para monitoring) para reduzir blast radius; (c) alertar (Sentry) em qualquer 401 de
  cron.
- **Prioridade:** Média.
- **Doc relacionada:** ADR-011 invariante 28; `docs/runbooks/production-readiness.md`.

#### 🔧 Remediação — ✅ Resolvido (commit `37a1b6d`)

**Decisão do founder: assumir o single-factor**, não implementar o dual. A opção (a) da
auditoria ("enforçar de fato a origem Vercel") foi **recusada com motivo**: a Vercel
documenta hoje `x-vercel-cron-schedule`, **não** `x-vercel-cron`; um 401 dependendo de
header não-documentado pararia **todos** os crons em silêncio numa renomeação da
plataforma — e outbox parado é falha de integridade de eventos. O modo de falha do
"hardening" seria pior que o risco mitigado. O item (b) (segredo por classe de rota) **já
estava feito** (`CRON_SECRET_DESTRUCTIVE`, V5) — que é segregação real, não presença de
header.

**Implementação:**
- `src/lib/http/cron-auth.ts` (novo) — `assertCronAuth(req, {route, destructive})`
  substitui **13 cópias** quase idênticas (**−279/+55 linhas**). Recebe `Request` puro,
  **nunca `NextRequest`**, para seguir testável com `new Request(url, {headers})` sem
  runtime do Next.
- **Fail-close embutido** — fecha o N1 também aqui (ver §0).
- **401 passa a alarmar:** `cron.unauthorized` (métrica) + `logger.warn`.
- `OUTBOX_CRON_ALLOW_NON_VERCEL` **declarado no schema** (`env.ts` + `.env.example`):
  era lido por `process.env` cru nas 13 rotas, **fora da validação** — um typo era
  silencioso. `CRON_SECRET_DESTRUCTIVE` também faltava no `.env.example` (gap do V5).
- **A mentira vivia em 4 lugares**, todos corrigidos: ADR-011 §28, `PROGRESS.md`
  (HIGH-08), `c4-validation.md` e os docblocks de outbox/patient-hard-delete. Addendum
  no ADR-011 registra a decisão.
- **N5:** o smoke `4.6.25` se chamava *"dual-factor … = 401"* e o próprio corpo admitia
  (`void res1`) que não testava isso. Reescrito para a realidade.

**Validação:** `cron-auth.test.ts` (17 casos), incluindo o negativo do V5 — o segredo de
monitoring **não** abre a rota que apaga PII. typecheck, lint, arch:check, test, build.

**Impacto:** *segurança* — inalterada em runtime (o gate efetivo já era só o Bearer); o
que muda é a doc parar de mentir e o 401 virar sinal. *Manutenção* — 224 linhas de auth
duplicada eliminadas; o gate tem dono. *Observabilidade* — 401 de cron alarmável.

**Observação — desvio da recomendação (c):** a auditoria pedia "alertar (**Sentry**) em
qualquer 401 de cron". Implementado como **métrica + `logger.warn`**, não Sentry: o
ADR-029 mantém logs fora do Sentry e o próprio codebase já registra essa decisão em
`rate-limit.ts` (*"SEM captureException… o ADR-029 mantém logs fora do Sentry"*). Um 401
é evento de autorização, não exceção. Mesmo pipeline stdout → Better Stack, sem 2ª fonte
da verdade. Seguimos a arquitetura da casa em vez da letra da recomendação.

---

### M3 — Faltam rate limits em operações caras/sensíveis (invite/resend, MFA-verify)

- **Severidade:** MÉDIA
- **Categoria:** Segurança / Abuso
- **Arquivo:** `src/app/(app)/(shell)/equipe/actions.ts`, `src/app/(app)/login/mfa/actions.ts`,
  `src/app/(app)/(shell)/account/security/actions.ts`, `src/app/(app)/join/[token]/actions.ts`
- **Local:** `resendInviteAction`/`inviteMemberAction` (equipe) — sem rate-limit;
  `login/mfa/actions.ts:14` — sem rate-limit; `saveStepAction` (join) — sem rate-limit.
- **Descrição:** o rate-limit dual (Upstash IP + email_hash, com fallback in-memory) cobre
  **login**, **password-reset** e o **checkout do /join** (`assertLoginAllowed`,
  `assertPasswordResetAllowed`, `assertJoinAllowed`). Não cobre: (a) **convite/resend** —
  cada `resendInviteAction` gera um **link de recuperação real do Supabase** (custo + e-mail);
  gated só por `requireFreshPermission(MANAGE_EMPLOYEES)` + quota de billing; (b) **MFA-verify**
  no login — depende só do throttle do GoTrue; (c) MFA enroll/unenroll; (d) `saveStepAction`
  do wizard de onboarding.
- **Impacto:** um gestor autorizado-porém-malicioso (ou conta comprometida) pode fazer
  **loop de convites/resends**, gerando spam de e-mail/recovery links e custo. MFA-verify sem
  limite de app amplia a superfície de brute-force do segundo fator (mitigado pelo GoTrue,
  mas sem defesa própria).
- **Como pode acontecer:** automação simples chamando a server action repetidamente dentro
  da sessão autenticada.
- **Cenário de exemplo:** conta de gestor comprometida dispara centenas de `resendInvite`
  para endereços de terceiros → a marca do cliente vira fonte de spam/recovery-mails.
- **Correção recomendada:** aplicar `Ratelimit` (o helper já existe) a invite/resend (por
  clínica e por ator), a MFA-verify (por usuário/IP) e ao step-save do wizard; reutilizar o
  padrão fail-open documentado.
- **Prioridade:** Média.
- **Doc relacionada:** ADR-008 addendum F-08 (rate-limit dual + fallback), `src/lib/auth/rate-limit.ts`.

#### 🔧 Remediação — ✅ Resolvido (commit `b621d4d`)

**Implementação** — no padrão dos 5 limiters existentes (lazy memoizado + `redisKey` +
fail-open via `degraded()`), sem abstração nova:
- **`assertInviteAllowed(clinicId, actorUserId)`** — dual: **20/1h por clínica**, **10/1h
  por ator**. Por ator pega a conta comprometida; por clínica impede N gestores somando
  para o mesmo efeito. Chamado **antes** do trabalho caro (quota + recovery link +
  e-mail). Aplicado a `inviteMemberAction` e `resendInviteAction`.
- **`assertMfaAllowed(userId, ip)`** — **10/15min por usuário** (folga para quem erra o
  código: o TOTP roda a cada 30s, e 10⁶ códigos seguem inviáveis), **20/15min por IP**
  (frouxo de propósito: clínica atrás de NAT compartilha IP). Aplicado ao verify do login
  e ao enroll/unenroll.
- **`saveStepAction`** → **reusa `assertJoinAllowed`**. Mesmo fluxo, mesmo abuso; um
  limiter novo só fragmentaria o orçamento.
- Sem extração para `src/lib/redis/`: segue rate-limit, não um 2º consumidor de Redis
  (CONVENTIONS linha 100). Exceção de chave registrada lá (o Upstash monta
  `[prefix, identifier]` com prefix **estático**, então `t:{clinicId}` não cabe primeiro;
  a regra protege **dado** de tenant, e um contador cujo identifier **é** o clinicId não
  tem o que vazar).

**Validação (8 casos novos):**
- **Fail-open REAL, sem mockar o Upstash:** o vitest não configura `UPSTASH_*`, então
  `lazyRedis()` lança e o `assert*` cai no fallback — é literalmente o cenário "Redis
  offline". Verificado: continua funcionando → loga → emite métrica.
- **Fail-open não é barra-livre:** o fallback ainda barra acima do teto (ator e clínica).
- **IPv6 /64:** dois endereços do mesmo bloco somam no mesmo balde.
- **Janela deslizante × contador:** o fallback é fixed-window com a janela ancorada no
  **1º hit**. Medido: o burst na borda é **2×limite − 1** (5 hits em ~1s com teto de
  3/60s), não o "~2×" que o módulo afirmava (**N6** — doc corrigida para o valor medido).

**Impacto:** *segurança/custo* — fecha o loop de convites (gestor malicioso ou conta
comprometida gerando spam de recovery-mails na marca do cliente) e dá defesa **própria**
ao 2º fator, que dependia só do throttle do GoTrue. *Performance* — +1 round-trip ao
Redis nessas ações (irrelevante no volume delas). *Escalabilidade* — durante outage do
Upstash o limite efetivo é ~N× (per-instância), degradação já aceita em ADR-008/F-08.

**Observação — cancelInviteAction ficou de fora** (o plano previa incluí-la): é um
`DELETE`, sem custo externo, e um teto ali atrapalharia limpeza legítima em lote sem
mitigar abuso real. A auditoria pedia "convite/resend" — foi o que se fez.

---

### B1 — Mensagens de erro cruas em outros 500 (atrás de auth)

- **Severidade:** BAIXA
- **Categoria:** Segurança
- **Arquivo:** `src/app/api/health/outbox/route.ts`, `src/app/(admin)/admin/clinicas/[id]/audit/export/route.ts`
- **Local:** `health/outbox/route.ts:197`; `audit/export/route.ts:68`.
- **Descrição:** ambos ecoam `err.message`/`e.message` no 500. Diferente de A1, estão **atrás
  de auth privilegiada** (monitoring/super_admin), então a exposição é limitada — mas ainda
  vazam internals para quem tiver acesso.
- **Impacto:** vazamento menor de detalhes internos para operadores autenticados.
- **Correção recomendada:** usar `toErrorResponse()` (envelope genérico + `trace_id`), mandar o
  detalhe só a logs/Sentry — consistente com os webhooks/crons que já retornam `'internal'`.
- **Prioridade:** Baixa.
- **Doc relacionada:** `src/lib/http/error-response.ts`.

#### 🔧 Remediação — ✅ Resolvido (commit `471b8e3`)

**Implementação:** `toErrorResponse()` nos dois handlers; detalhe só no observability
(`logger.error`). O helper existia, estava testado e tinha **zero consumidores** — dívida
pura. Domain errors mantêm a própria mensagem (UI-safe) e o próprio status via
duck-typing `code` + `httpStatus`.

**Validação:** teste assere que um erro contendo `postgres://user:pw@host` produz corpo
`{error:true, code:'internal', message:'Erro interno.'}` — sem `postgres://`, sem
`SECRET`.

**Impacto:** *segurança* — para de expor internals de driver/Postgres a operadores.
*Consistência* — o envelope C16 (`trace_id` correlacionando resposta ↔ log ↔ Sentry) deixa
de ser teoria e passa a ter consumidores reais.

---

### B2 — Actions financeiras fazem check de permissão à mão, fora da porta única

- **Severidade:** BAIXA
- **Categoria:** Arquitetura / Manutenção
- **Arquivo:** `src/contexts/financial/actions.ts`
- **Local:** `:134-137` (`confirmPayment`), `:224-227` (`cancelLancamento`).
- **Descrição:** em vez de `requireCachedPermission`, essas actions montam
  `user.permissions.includes(OPERATE_CAIXA) || …MANAGE_FINANCIAL` na mão. Funcionalmente
  correto hoje (super_admin recebe `ALL_PERMISSIONS` durante impersonate; super_admin sem
  clínica cai em `requireClinicId`), mas **duplica lógica de authz fora do único ponto de
  enforcement** — invisível a invariantes/arch-tests que assumem os helpers.
- **Impacto:** risco de drift/regressão silenciosa se a semântica de permissão mudar num lugar
  e não no outro; erode a garantia "toda authz passa por `tenant-context`".
- **Correção recomendada:** trocar por `requireCachedPermission(perm)` (ou uma variante que
  aceite "qualquer uma de N permissões", se necessário); manter todos os checks na porta única.
- **Prioridade:** Baixa.
- **Doc relacionada:** ADR-008 (P-series, porta única), `src/lib/auth/tenant-context.ts:205`.

#### 🔧 Remediação — ✅ Resolvido (commit `acde773`)

**⚠️ MUDANÇA DE CLASSIFICAÇÃO — BAIXA → deveria ser MÉDIA.** A auditoria tratou o B2 como
higiene ("duplica lógica de authz… risco de drift"). **Não era hipotético: já era bug.**
O OR à mão lia `user.permissions` direto e **não tinha o branch `isSuperAdmin`** que
`requireCachedPermission` tem (P7). Efeito: um super_admin **fora de impersonação** era
**negado** em `confirmPayment`/`cancelLancamento` e **aceito** em todas as outras actions
financeiras. O drift que a auditoria temia para o futuro já estava em produção.

**Evidência:** removendo o bypass do novo helper, os dois testes de super_admin ficam
vermelhos com `AuthError: Permissão negada` — comportamento idêntico ao do check à mão.

**Implementação:**
- `requireCachedAnyPermission(perms)` em `tenant-context.ts` — a variante OR que faltava.
  `CAIXA_PERMISSIONS` numa constante só, para os dois call-sites não divergirem.
- **`FinancialForbiddenError` removido:** sem os checks à mão, ninguém mais o lança. Um
  erro de permissão próprio do contexto só existia para servi-los; mantê-lo convidaria a
  recriá-los.

**Compatibilidade (o que a troca revelou):** a UI mapeia erro por `err.name`, e a porta
única lança `AuthError`. Trocar cegamente teria regredido a mensagem. Ao corrigir,
apareceram **N4** (as actions que **já** usavam a porta única caíam no genérico *"Tente
novamente"* ao negar permissão — errado **e** enganoso, porque tentar de novo não
resolve) e **N3** (`lancamento-actions.ts` devolvia `err.message` de **qualquer** erro à
UI: uma negativa exibia *"Permissão 'manage:financial' negada (cached). Verifique
role/overrides."*, e um erro de driver vazaria igual). Os três mapeadores agora entendem
`AuthError` e distinguem 403 de sessão expirada pelo `code`.

**Validação (14 casos):** exercitam a porta única **real** — mockar `tenant-context` não
serviria, porque o helper chama o `requireUser` **local do módulo**; o seam correto são as
dependências de `getCurrentUser` (supabase + impersonação), com `resetModules` por teste
para escapar do `cache()`. Cobrem o bypass, os 403/401 e a **não-regressão**:
`gestor`/`owner`/`financial`/`attendant` com permissão de caixa continuam passando.

**Impacto:** *segurança/correção* — elimina divergência de authz silenciosa entre actions
irmãs. *UX* — negativa de permissão passa a dizer a verdade em todo o financeiro.
*Manutenção* — authz volta 100% para a porta única; invariantes e arch-tests que a
assumem voltam a valer.

**Observação:** não existe `tenant_admin` neste projeto (roles reais: `gestor`, `doctor`,
`attendant`, `financial`, `owner`, `super_admin` — `roles.ts:12`).

---

### B3 — Ordem/validação frouxa em actions super_admin de messaging

- **Severidade:** BAIXA
- **Categoria:** Arquitetura
- **Arquivo:** `src/contexts/messaging/actions.ts`
- **Local:** `connectWhatsappNumber:55-96` (parse + `encryptForTenant` antes do gate);
  `disconnectWhatsappNumber:100`, `rotateWhatsappToken:125` (clinicId sem validação UUID).
- **Descrição:** essas actions são cross-tenant por design (super_admin, gated por
  `superAdminAction → requireSuperAdmin` AAL2), recebendo `clinicId` do input. Dois nits:
  (a) o `ConnectNumberSchema.parse` e o `encryptForTenant(data.clinicId, …)` rodam **antes**
  do gate de auth (o `requireSuperAdmin` está dentro do wrapper); (b) `disconnect`/`rotate`
  não validam `clinicId` como UUID antes de usar. Sem injeção (parametrizado) e sem bypass de
  privilégio, mas a ordem/validação é mais frouxa que no caminho tenant.
- **Impacto:** trabalho (parse/cripto) executado antes da checagem de identidade; input
  cross-tenant sem validação de formato. Baixo — protegido por AAL2 + parametrização.
- **Correção recomendada:** chamar `requireSuperAdmin()` no topo (antes de parse/cripto) e
  validar `clinicId` com `z.string().uuid()` nas três actions.
- **Prioridade:** Baixa.
- **Doc relacionada:** ADR-020 (number-store seam), `src/lib/audit/super-admin.ts`.

#### 🔧 Remediação — ✅ Resolvido (commit `2c44398`)

**Implementação:** `requireSuperAdmin()` no topo das três (antes de parse/cripto) +
`ClinicIdSchema` (`z.string().uuid()`) em `disconnect`/`rotate` — o `connect` já validava
via `ConnectNumberSchema`. O gate duplicado (topo + dentro de `superAdminAction`) é
barato: `getCurrentUser` é `cache()`-ado por request, e manter o de dentro preserva a
garantia para qualquer outro caller. A cripto continua **fora** da tx (CPU puro antes de
abrir transação — decisão original preservada), só que agora **depois** do gate.

**Validação (9 casos):** para o não-autorizado, **nada** acontece além do 403 — nem
`encryptForTenant`, nem `superAdminAction`. Inclui o caso "input inválido **de**
não-autorizado → `AuthError`, **não** `ZodError`" (sem oráculo de schema antes do 403).

**Impacto:** *segurança* — some a CPU de derivação de chave (HKDF por tenant) alcançável
por não-autorizado (amplificação de DoS) e o oráculo de formato de input. *Consistência*
— a borda cross-tenant fica tão dura quanto a tenant, onde `clinicId` vem de
`requireClinicId()` e nunca de input.

---

### B4 — Arch-test de critical-actions tem escopo estreito (blind spot latente)

- **Severidade:** BAIXA (potencial MÉDIA se explorado por regressão futura)
- **Categoria:** Test-coverage / Arquitetura
- **Arquivo:** `src/lib/auth/policies/critical-actions.test.ts`
- **Local:** `:18-23` (lista fixa de 4 arquivos; varre só declarações de função).
- **Descrição:** o arch-test que garante `requireFreshPermission` no topo das
  `CRITICAL_ACTIONS` varre **apenas 4 arquivos hard-coded** e só reconhece **declarações de
  função**. Uma critical action escrita como arrow-function/factory export (padrão que já
  existe em `scheduling/actions.ts:46`) ou adicionada num arquivo fora da lista **escaparia
  silenciosamente** do gate de CI. Nenhuma escapa hoje — mas o backstop tem furo.
- **Impacto:** regressão futura pode introduzir uma ação destrutiva sem o fresh-check sem
  quebrar o CI.
- **Correção recomendada:** generalizar o arch-test para (a) descobrir arquivos por glob de
  contextos/app, e (b) reconhecer arrow-functions/factory exports (visitar
  `VariableDeclaration` + `ArrowFunctionExpression`, não só `FunctionDeclaration`).
- **Prioridade:** Baixa (fortalece o CI antes de virar problema).
- **Doc relacionada:** ADR-008 (D20 fresh-permission), `docs/engineering/definition-of-done.md`.

#### 🔧 Remediação — ✅ Resolvido (commit `2c44398`)

**O furo não era latente — já estava aberto.** As **6** transitions de
`scheduling/actions.ts` (`confirmAppointment`, `checkInAppointment`, `startAppointment`,
`completeAppointment`, `cancelAppointment`, `markNoShow`) chamam
`requireFreshPermission(EDIT_AGENDA)` e são críticas por comportamento, mas eram
**invisíveis ao gate**: duplamente, por virem de uma factory **e** por viverem num arquivo
fora da lista. Estavam certas **por acidente** — nada impedia alguém de remover o check
sem quebrar o CI.

**Implementação (escopo contido, e a contenção é regra):**
- Descoberta por **varredura** de `actions*.ts` sob `contexts/` e `app/` (era lista fixa
  de 4).
- Reconhece as **três formas que existem hoje**: declaração; arrow/function expression;
  `const X = factory(...)` com a factory no **mesmo arquivo** — **um hop, sem recursão,
  sem cross-file**. Não é analisador genérico e o docblock diz que não deve virar um: se
  o diff do teste começar a crescer, o certo é simplificar o código de produção.
- **Forma desconhecida agora FALHA ALTO**, com mensagem distinta de "não encontrada".
  Antes as duas viravam o mesmo erro — o que empurra o mantenedor a **remover o nome da
  lista** (cegando o gate) em vez de consertar o visitor. A mensagem nova pede
  explicitamente o oposto.
- `CRITICAL_ACTIONS`: **10 → 16** nomes.

**Validação (18 casos):** **evidência** — removendo o `requireFreshPermission` da factory,
as 6 transitions ficam vermelhas com *"'cancelAppointment' (factory transitionAction() em
…/scheduling/actions.ts) não chama requireFreshPermission no nível superior"*. O gate
agora enxerga o que antes passava batido. Inclui sanity-check da varredura (se ela
quebrar, os testes passariam vazios) e o controle negativo de código morto.

**Impacto:** *test-coverage/segurança* — 6 ações destrutivas de agenda saem do ponto cego
do CI. *Manutenção* — action crítica nova em qualquer `actions*.ts` já nasce coberta.

---

### B5 — UUID interno (`clinicId`) exposto no corpo 200 do webhook Asaas

- **Severidade:** BAIXA
- **Categoria:** Segurança
- **Arquivo:** `src/app/api/webhooks/asaas/route.ts`
- **Local:** `:123,127` (retorna `{status, event, clinicId}`).
- **Descrição:** a resposta 200 ao chamador do webhook inclui o `clinicId` (UUID interno). O
  chamador já detém o token, então a severidade é mínima, mas é um identificador interno
  desnecessário na resposta.
- **Impacto:** vazamento menor de identificador interno.
- **Correção recomendada:** retornar apenas `{received: true}` (ou o event id do provider),
  sem o UUID interno.
- **Prioridade:** Baixa.
- **Doc relacionada:** ADR-025.

#### 🔧 Remediação — ✅ Resolvido (commit `0eac706`, junto do A2)

**Implementação:** a resposta 200 vira `{received: true}`. O detalhe (`event`,
`provider_status`, `status` da transição, `clinicId`) foi para a **métrica**, que é
interna — sem perder observabilidade. Teste assere que o corpo não contém o UUID.

**Impacto:** *segurança* — identificador interno fora da resposta a um chamador externo.
Mínimo, como a auditoria disse; feito porque era de graça junto do A2.

---

### B6 — Rotas de PDF/export sem rate-limit e com trabalho potencialmente ilimitado

- **Severidade:** BAIXA (potencial MÉDIA sob carga)
- **Categoria:** Performance / Abuso
- **Arquivo:** `src/app/(app)/(shell)/relatorios/pdf/route.ts`,
  `src/app/(admin)/admin/clinicas/[id]/audit/export/route.ts`
- **Local:** `audit/export/route.ts:41-51` (valida formato/ordem de `from/to` mas **não o
  tamanho do range**); `relatorios/pdf` renderiza via `@react-pdf/renderer` (WASM/yoga).
- **Descrição:** as rotas de geração de PDF são caras (render server-side WASM) e não têm
  rate-limit. O export de auditoria aceita um intervalo `from/to` **sem limite de span** —
  um range de anos força uma varredura/render enorme.
- **Impacto:** consumo desproporcional de CPU/memória por request; um usuário autenticado
  pode degradar a instância pedindo PDFs grandes em sequência.
- **Como pode acontecer:** loop de requests de export com range amplo.
- **Correção recomendada:** limitar o span de `from/to` (ex.: máx 12 meses por export),
  adicionar rate-limit por usuário/clínica nessas rotas, e/ou empurrar exports grandes para
  um job assíncrono (outbox) com entrega por signed URL.
- **Prioridade:** Baixa.
- **Doc relacionada:** ADR-028 (white-label PDF), `docs/CONVENTIONS.md` (anti-fullscan super_admin).

#### 🔧 Remediação — ✅ Resolvido (commit `471b8e3`)

**Implementação:**
- **Cap de 12 meses** no span `from`/`to` (antes só formato e ordem eram validados).
  **422, não 400** — e a distinção passa a ser aplicada de propósito na rota: **400 =
  malformado** (data fora de `YYYY-MM-DD`, período invertido — seguem 400); **422 =
  bem-formado, não processável**.
- **Rate-limit nas duas rotas de PDF** — `assertPdfExportAllowed(clinicId, userId)`,
  10/15min por usuário + 30/15min por clínica; **429** em ambas.
- **N2 (achado novo) — truncagem silenciosa:** o repo corta em `AUDIT_EXPORT_MAX_ROWS`
  (5000); o PDF saía com as primeiras N linhas e o `sha256` ia para `super_admin_actions`
  **como se atestasse o período inteiro**. Um artefato de auditoria incompleto que se
  apresenta como completo é pior que a ausência dele. Agora `AuditExportTooLargeError`
  (domain error, 422), lançado **no serviço, antes do render/upload** — barrar depois
  deixaria um PDF órfão no storage a cada tentativa. Como `toErrorResponse` já mapeia
  domain errors 1:1 pelo `httpStatus`, a rota não precisou saber do caso.

**Validação (11 casos):** fronteira exata do span (11m29d passa, 12m barra), truncagem
**não gera atestação** (`superAdminAction` não é chamado), o 500 não vaza connection
string, e o 429 não paga o render.

**Impacto:** *performance/abuso* — some o trabalho ilimitado por request; teto por usuário
**e** por clínica. *Integridade* — a atestação do export deixa de poder mentir.
*UX* — o operador recebe instrução acionável ("reduza o intervalo") em vez de um PDF
silenciosamente errado.

**Observação:** a auditoria sugeria também "empurrar exports grandes para job assíncrono
(outbox) com entrega por signed URL". **Não implementado** — seria arquitetura nova
(job + estado + notificação) para um caso que o cap de 12 meses já resolve no uso real
(export fiscal/LGPD por exercício). Se aparecer demanda real de export plurianual, o job
assíncrono é o caminho; hoje seria abstração prematura.

---

### B7 — Guards de custo/resiliência de IA são "soft caps" per-instância

- **Severidade:** BAIXA
- **Categoria:** Performance / Abuso
- **Arquivo:** `src/contexts/ai-agent/internal/quota.ts`, `src/lib/ai/circuit-breaker.ts`
- **Local:** `quota.ts:23-51` (soma custo já gravado); `circuit-breaker.ts:10-16,109-110`
  (estado em memória por instância).
- **Descrição:** o `checkQuota` bloqueia o turno quando o **gasto já gravado** do mês passa
  do orçamento — é pós-fato: turnos concorrentes podem passar o check simultaneamente e
  ultrapassar o teto. O circuit breaker e o cost-guard vivem **em memória por instância**;
  em multi-instância (Vercel), o limite efetivo vira ~N×. Ambos já estão **documentados como
  dívida** (ADR-022, migrar para Redis ao escalar).
- **Impacto:** overshoot moderado do orçamento de IA sob concorrência/multi-instância — custo,
  não segurança.
- **Correção recomendada:** (ao escalar) mover breaker + contador de gasto para Redis/atomic;
  considerar reserva otimista de orçamento antes da chamada ao LLM.
- **Prioridade:** Baixa (aceitável no MVP single-worker).
- **Doc relacionada:** ADR-022 §11.17 (aposta documentada), `src/lib/ai/cost.ts`.

#### 🔧 Remediação — 🚫 Não aplicável / não implementado (decisão consciente)

**Não implementado, com justificativa técnica.** Critério de escopo do trabalho: BAIXAs
entram só se fizerem sentido arquitetural, reduzirem dívida e **não** introduzirem
abstração desnecessária. O B7 falha nos três:

1. **Não é bug — é aposta documentada.** O ADR-022 §11.17 já registra que breaker e quota
   são per-instância e migram para Redis **ao escalar**. A auditoria confirma ("já estão
   documentados como dívida"). Remediar aqui seria antecipar uma decisão cujo gatilho é
   escala, não a auditoria.
2. **O impacto é custo, não segurança.** A própria auditoria classifica: "overshoot
   moderado do orçamento de IA sob concorrência — custo, não segurança". Não há vetor de
   tenant, dado ou acesso.
3. **A correção é infra, não código.** Exige contador atômico distribuído + estado do
   breaker no Redis (reserva otimista antes da chamada ao LLM). Hoje o único consumidor
   de Redis é o rate-limit; CONVENTIONS (linha 100) manda extrair `src/lib/redis/`
   **quando** surgir o 2º consumidor. Fazer isso agora, para um problema de custo que não
   está doendo, é exatamente a abstração prematura que o projeto evita.

**Gatilho para reabrir:** primeira instância a mais em produção (multi-worker/Vercel
escalando), **ou** o gasto real de IA se aproximar do orçamento — o que vier antes. Aí a
extração para `src/lib/redis/` deixa de ser prematura e o B7 vira a 2ª motivação dela.

**Impacto de não implementar:** teto de IA pode ser ultrapassado em ~N× sob
multi-instância. Aceito e já aceito antes desta auditoria (ADR-022).

---

## 4. O que está bem implementado (registro dos acertos)

O founder pediu para registrar também o que está sólido — e há bastante:

- **Porta única de autorização** (`src/lib/auth/tenant-context.ts`): `requireUser`,
  `requireClinicId`, `requireRole`, `requireCachedPermission`, `requireFreshPermission`,
  `requireSuperAdmin` (exige AAL2). ESLint impede qualquer outro lugar de ler cookie/JWT.
- **Tenant-id de claim confiável** — injetado pelo `custom_access_token_hook`, validado por
  `ClaimsSchema` (deny-by-default), nunca lido do input nos caminhos tenant.
- **Isolamento RLS via `withTenant`** — `SET LOCAL ROLE authenticated` + GUC
  `app.current_clinic`; policies dual-context geradas por `defaultTenantPolicy()` (helper
  único, com fingerprint `GENERATED_BY` e sanitização de identificador). Confirmado: 213
  usos das helpers `current_clinic_id()`/`is_super_admin()` nas migrations (a forma literal
  `auth.jwt()` do ADR-002 foi superada pelo ADR-007).
- **Criptografia per-tenant** AES-256-GCM + HKDF(salt=clinic_id); wire format versionado;
  chave-mestra no Google Secret Manager em produção; ponto único de descriptografia;
  isolamento cross-tenant por construção (auth tag GCM falha com clinic errado).
- **Outbox / audit / idempotency** transacionais: `publishEvent`/`logAudit`/
  `idempotentMutation` na mesma tx da mutação; worker em 3 transações separadas (nunca
  troca de role numa tx); `FOR UPDATE SKIP LOCKED`, backoff, circuit SQL, janitor.
- **Impersonation** (C15): linha autoritativa em `impersonation_sessions` + cookie que só
  carrega o id assinado (HMAC-SHA256 constant-time), AAL2 obrigatório, TTL 1h, bind ao
  super_admin, cada mutação gera entrada extra em `super_admin_actions`.
- **Webhook Meta**: HMAC-SHA256 verificado **antes** do parse e de qualquer I/O de banco;
  leitura do corpo com cap de bytes por streaming (defende contra `Content-Length` mentiroso).
- **Clients de integração** (Meta/Gemini/Asaas): timeout via `AbortSignal.timeout`,
  classificação de erro (definitivo vs indeterminado), hosts fixos (sem SSRF), sem eco de
  payload cru do provider.
- **Validação de entrada uniforme com Zod** em toda action; **SQL injection inviável por
  construção** (Drizzle parametrizado; os 2 únicos `sql.raw` usam allowlist/constantes +
  `normalizeAndAssertIdent`).
- **Envelope de erro sanitizado** (`toErrorResponse`: 500 genérico + `trace_id`, sem leak) —
  usado corretamente em webhooks e crons.
- **Security headers** aplicados a `/(.*)`: HSTS (2 anos, preload), `X-Frame-Options: DENY`,
  `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- **Rate-limit dual** (IP + email_hash) com fallback in-memory bounded e fail-open documentado.
- **Backstops de CI**: ESLint (`db`/`dbAdmin` fora da allowlist barrado; `getSession()` banido;
  handlers de outbox não podem importar `db`), arch-tests (`arch-db-check`, critical-actions),
  `check:migrations` (anti-DROP), `check:registry`.
- **IA**: prompt como código (não em DB), tool whitelist + Zod nas duas direções, guardas
  anti-SAMD (aconselhamento clínico bloqueado nos dois lados), LLM **nunca** envia proativo
  (envio proativo é cron determinístico), quota checada antes da chamada, ator `ai_agent`
  reusa o mesmo pipeline transacional/auditável dos humanos.

---

## 5. Riscos futuros (não quebram hoje, mas geram retrabalho)

Itens em sua maioria **já reconhecidos** na doc como dívida de C16 — listados para
priorização:

1. **Role `db` dedicado sem BYPASSRLS** — hoje o esquecimento de `withTenant` vaza em vez de
   fail-close (ver A3). É o item de maior valor de hardening.
2. **Auth-epoch para drift de `role_permissions`** — mudanças globais de bundle de permissão
   não são auto-detectadas; exigem logout operacional manual (ADR-009 D27).
3. **Janela de replay de JWT de 15 min** após logout/revogação (ADR-009 D12) — sem
   `session_version`/revogação imediata.
4. **Circuit breaker + quota de IA distribuídos** (Redis) — hoje per-instância (ver B7).
5. **CSP bloqueante com nonce** — hoje `Content-Security-Policy-Report-Only`
   (`next.config.ts:80`), confirmado. XSS não é bloqueado, só reportado.
6. **Fallback de rate-limit per-instância** — durante outage do Upstash, o limite efetivo é
   ~N× (ADR-008 F-08, aceito).
7. **Consistência de migrations/journal** — os SQL 0000-0037 são contíguos, mas os snapshots
   `meta/*.json` têm lacunas (faltam 0002, 0004-0011, 0022); `db:generate` é inseguro e
   migrations foram aplicadas manualmente (ADR-020). Risco de drift schema↔snapshot em
   evoluções futuras.
8. **`patient_clinical_data` ainda no contexto Patient (C5)**, não Clinical (C7) — dívida de
   ownership documentada (ADR-013); migração futura terá custo.

### Inconsistências de documentação (não são bugs de código)

- **Escopo de MFA:** o código (`mfa-policy.ts`: `mustHaveMFA`/`mustEnforceAAL2` = só
  super_admin) segue o **ADR-008 D6** (MVP). A **`docs/VisãoGeral.md` §4.1/§7.9** ainda diz
  que gestor/financial são obrigados a 2FA. O código está correto pela ordem de autoridade
  (ADR > VisãoGeral); **atualizar a VisãoGeral** para evitar expectativa errada e futuro
  "bug report" fantasma.

  #### 🔧 Remediação — ✅ Resolvido (commit do Marco 4)

  A afirmação vivia em **3** lugares, não 2: linhas **728** (§4.1), **2258** (§11.1) e
  **2487**. Todas corrigidas para "2FA obrigatório só pro `super_admin`; gestor/financial =
  opt-in forte (banner não-bloqueante)", com o **porquê** que faltava: sem recovery codes +
  reset por admin, forçar 2FA tranca o cliente fora da própria clínica (ADR-008 D6).
  §7.9 ("2FA obrigatório no seu super_admin") já estava correta — não foi tocada.

  **Corrigido junto (fora do escopo da auditoria):** a linha **731** afirmava *"rate limit
  5 tentativas/15min via Upstash. Após 5, bloqueia 1h"*. O código é **dual** (IP 10/15min +
  email_hash 5/15min, sliding window) e **não existe bloqueio de 1h** — a janela desliza.
  Ambos os números e o comportamento estavam errados; a doc agora aponta para
  `rate-limit.ts` e menciona o fail-open (F-08).

---

## 6. Melhorias recomendadas

### Curto prazo (baixo custo, alto valor)
- **A1** — remover o eco de `e.message` no `auth-hook` (usar envelope genérico) e/ou exigir
  Bearer + rate-limit.
- **M1** — helper `timingSafeBearer` e aplicá-lo em todos os crons/health + verify_token Meta.
- **M3** — rate-limit em invite/resend, MFA-verify e step-save do wizard.
- **A3 (parcial)** — adicionar filtro `clinic_id` defensivo nas mutations financeiras/clinical
  que hoje escopam só por id.
- **B5** — remover `clinicId` do corpo 200 do webhook Asaas.
- **B1** — envelope genérico nos 500 de `health/outbox` e admin export.

### Médio prazo
- **A2** — decisão formal de risco sobre o webhook Asaas (assinatura se disponível; reconciliação
  como fonte autoritativa para reabertura de acesso; recusar chave de dedup sintética).
- **M2** — enforçar origem Vercel de fato (ou corrigir docblocks) e segregar segredos por
  classe de rota (destrutivo vs monitoring); alertar em 401 de cron.
- **B2/B3** — trazer os checks financeiros para a porta única; ordenar auth antes de parse/cripto
  e validar UUID nas actions super_admin de messaging.
- **B4** — generalizar o arch-test de critical-actions (glob + arrow-functions).
- **Doc** — corrigir o escopo de MFA na VisãoGeral.

### Longo prazo (C16 / escala)
- **A3 (completo)** — provisionar role dedicado não-BYPASSRLS para o pool `db` (fail-close real).
- **Riscos 2-4** — auth-epoch, revogação imediata de sessão, breaker/quota distribuídos.
- **CSP bloqueante com nonce**; **exports pesados assíncronos** (B6).
- **Sanear journal de migrations** para reabilitar `db:generate` com segurança.

---

## 7. Não-achados verificados (economiza retrabalho de revisão)

Itens explicitamente checados e considerados **corretos** — para o próximo revisor não
reabrir:

- **Sem SSRF**: `billing-reconcile` usa `asaasPaymentId` do banco local contra
  `ASAAS_BASE_URL` fixo; Meta e Gemini postam para hosts fixos (`graph.facebook.com`,
  `generativelanguage.googleapis.com`).
- **Sem SQL injection**: os únicos `sql.raw` são `audit-partitions` (nome de tabela/datas de
  allowlist `PARENTS` + aritmética de `Date`) e `financial-reconcile` (`sql.raw(GRACE)` =
  constante). Todo `days`/`limit` é `Number()`-clampado e parametrizado.
  `normalizeAndAssertIdent` sanitiza identificadores em `rls.ts`.
- **Sem IDOR** em `/relatorios/pdf`: `clinicId` vem de `requireClinicId()` (sessão/impersonação),
  nunca da query; colunas financeiras gated por `VIEW_FINANCIAL`.
- **AuthZ do admin export é sólida**: `guardAdminAccess()` → `requireSuperAdmin()`
  (`isSuperAdmin && aal==='aal2'`), falha → `notFound()` 404 (sem leak de existência);
  `id` validado como UUID; path de storage montado só a partir do UUID validado + `Date.now()`
  + slice de sha → sem path traversal.
- **Meta receive** verifica HMAC **antes** de parsear e antes de qualquer trabalho de banco;
  lê o corpo com cap de bytes por streaming.
- **Impersonation** não vira "role lógico" nem flags soltas; cookie forjado/ausente é tratado
  como ausente (constant-time); expiração/revogação voltam o super_admin a exigir contexto.
- **`dbAdmin` runtime** (`requireFreshPermission`, `members.ts`) é sempre auto-escopado ao
  `userId` do JWT verificado ou a um `clinicId` de `requireClinicId()` com re-check —
  nenhuma exposição cross-tenant nas amostras.
- **RLS usa helpers dual-context** (`current_clinic_id()`/GUC/`is_super_admin()`), não
  `auth.jwt()` literal — implementação conforme ADR-007 (supera ADR-002).

---

### Metodologia & limites desta auditoria

- Auditoria **manual expert** por revisão de código + correlação com ADRs; **sem** execução de
  ferramenta dinâmica (as skills 42crunch/IdentityServer não se aplicam a Next.js+Supabase
  server-actions sem OpenAPI/.NET — decisão registrada com o founder).
- Cobertura: 100% dos route handlers e da camada de auth/tenancy; **amostragem** das server
  actions (contextos representativos). Não substitui um pentest dinâmico nem revisão de todas
  as migrations linha a linha.
- Achados com referência de linha refletem o estado do branch `docs/identity-practitioner-model`
  na data acima.

---

## Remediação — registro de fechamento

| Campo | Valor |
|---|---|
| **Data** | 2026-07-15 |
| **Branch** | `docs/identity-practitioner-model` |
| **Responsável** | João Marcos (founder) · execução: Claude Opus 4.8 |
| **Commits** | `5bbbd23` (preservação) → `2c44398`. Um por tema, revertíveis isolados. |
| **Volume** | 118 arquivos, +8.904 / −1.496 |
| **Resultado** | **Aprovado.** 3/3 ALTA, 3/3 MÉDIA, 6/6 BAIXA implementadas; 1 BAIXA (B7) justificada. 6 achados novos encontrados e corrigidos. |

### Commits

| Commit | Achados | Tema |
|---|---|---|
| `5bbbd23` | A3, M1 | **Preservação.** 86 arquivos não-commitados na árvore — a correção do A3 estava a um `git checkout` de sumir sem rastro. |
| `aede5dd` | A1 | auth-hook exige Bearer; fim do vazamento de `sqlstate`; **N1** |
| `0eac706` | A2, B5 | webhook Asaas verify-then-act |
| `b3ad3b3` | M1 | teste do `safeEqual`; 2ª primitiva de cripto removida |
| `37a1b6d` | M2 | `assertCronAuth`; single-factor assumido; **N5** |
| `b621d4d` | M3 | rate limits (convite, MFA, step-save); **N6** |
| `471b8e3` | B1, B6 | envelope de erro; cap do export; **N2** |
| `acde773` | B2 | check do caixa na porta única; **N3**, **N4** |
| `2c44398` | B3, B4 | auth antes do trabalho; arch-test enxerga factory |

### Gates (todos verdes no HEAD)

`typecheck` · `lint` · `arch:check` · `arch:db-check` · `check:migrations` ·
`check:registry:strict` · `test` · `build` — os mesmos do CI (DoD §1).
**Testes: 540 → 650 (+110).** Nenhum teste existente foi alterado para passar.

### Cobertura nova

| Área | Antes | Depois |
|---|---|---|
| Route handlers | **0 testes** no repo | 27 (auth-hook/health, webhook Asaas, export de auditoria) |
| `safeEqual` | 0 | 18 |
| `assertCronAuth` | — | 17 |
| Rate limit (novos) | 0 | 8 (fail-open real, /64, janela) |
| `requireCachedAnyPermission` | — | 14 |
| Messaging admin (ordem) | 0 | 9 |
| `CRITICAL_ACTIONS` | 10 nomes | 16 nomes |

### Mudanças de contrato (deliberadas)

| Rota | Antes | Depois | Justificativa |
|---|---|---|---|
| `GET /api/health/auth-hook` | anônima | Bearer `CRON_SECRET` ou super_admin AAL2 | A doc já mandava (`production-readiness` §5/§5.2); consumidores levantados antes; ação de conferência do monitor registrada no runbook |
| `POST /api/webhooks/asaas` | aceitava corpo sem `body.id` | 400 sem `body.id`; 200 = `{received:true}` | O Asaas sempre envia `evt_…`; a síntese era defesa morta que causava bug de dedup |
| `POST /admin/.../audit/export` | qualquer intervalo | 422 acima de 12 meses ou se truncaria; 429 sob rate-limit | Trabalho ilimitado por request; atestação enganosa |

### Documentação atualizada

ADR-011 (§28 + addendum M2) · ADR-025 (addendum A2) · `VisãoGeral.md` (§4.1 2FA + números
de rate-limit, §11.1, +1) · `CONVENTIONS.md` (exceção de chave Redis) · `c16/slo.md` (§3.1)
· `PROGRESS.md` (HIGH-08) · runbooks `asaas-webhook-missing`, `c3-validation`,
`c4-validation`, `production-readiness` · `c16-inventory` · `.env.example`.

### Pendências operacionais (fora do código)

1. **Conferir o header `Authorization` no monitor do auth-hook** (Better Stack/UptimeRobot)
   antes do próximo deploy — a rota era anônima e passa a devolver 401 sem ele.
   Registrado em `production-readiness.md` §5.2.
2. **Alerta p95 do `billing.webhook.verify`** (> 5s por 5min) — threshold definido em
   `c16/slo.md` §3.1, **disparo não wired**: depende do go-live #2 (canal de alerta), que
   segue aberto. Vale para todo o alerting do C16, não é dívida desta remediação.
3. **A3 longo prazo:** provisionar o role sem BYPASSRLS e apontar `DATABASE_URL_RUNTIME`
   → fail-close real. Código pronto; falta infra. C16.
