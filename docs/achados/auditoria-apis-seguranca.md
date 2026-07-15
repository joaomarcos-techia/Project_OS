# Auditoria de APIs — Segurança & Arquitetura

> **Escopo:** superfície de API do ClinicaOS_V2 (Qoro) — **route handlers** (`/api/*`,
> webhooks, cron, health, logout, export, PDF) + **server actions** (`"use server"`).
> Não existe API REST versionada nem OpenAPI: a maior superfície de mutação são as
> server actions.
> **Método:** auditoria manual expert, validando implementação contra a documentação
> oficial (`docs/`, ADRs). Pensando como atacante, engenheiro pré-escala e DevSecOps.
> **Natureza:** somente leitura. Nenhum código foi alterado.
> **Data:** 2026-07-12 · **Branch:** `docs/identity-practitioner-model`

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
