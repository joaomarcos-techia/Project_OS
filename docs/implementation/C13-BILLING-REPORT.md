# CAMADA 13 — Billing Context — Relatório de Implementação

Data: 2026-06-17 · Branch: main · Status: **núcleo entregue e verificado**; seams de
onboarding documentados (ver §12/§13). Arquitetura: Asaas é infraestrutura atrás de adapter
(ADR-025); não o centro do billing.

## 1. Readiness Check
Dependências validadas e **estáveis** antes de implementar: C2 (clinics/withTenant/RLS dual-context/
tenantIdRef), C3 (profiles/roles/listEmployees — sem fluxo de convite-escrita), C4 (publishEvent/
catalog/registry/worker/logAudit), C6 (`scheduling.appointment.created`), C11 (`ai_agent.conversation.completed`).
Infra reusada: cron auth, webhook pattern, `metrics.emit`, money `numeric(12,2)`, vitest, smoke harness.

## 2. Dependências encontradas
Todas presentes. Reuso: `withTenant` ([tenant.ts](../../src/lib/db/tenant.ts)), `publishEvent`
([publish.ts](../../src/lib/outbox/publish.ts)), `registerHandler`, `tenantIdRef`, padrão de cron
([financial-reconcile](../../src/app/api/cron/financial-reconcile/route.ts)) e webhook
([meta/route.ts](../../src/app/api/webhooks/meta/route.ts)), classificação de erro 4xx/5xx
([provider.ts](../../src/lib/ai/provider.ts)).

## 3. Dependências ausentes (tratadas sem inventar)
- **Mensageria proativa plataforma→clínica + email** = C14 (não existe). Dunning emite eventos
  (`billing.clinic.dunning_advanced`, `billing.payment.failed`); o transporte é da C14. **Sem mock.**
- **Fluxo de convite de usuário (escrita)** = pós-C13 (Equipe é read-only). A trava dura
  (`assertUserQuota`) está pronta e testável; o call-site de convite chega no onboarding.
- **Criação de auth-user (owner)** = escopo de onboarding (Supabase Auth admin). Billing emite
  `billing.subscription.activated`; o consumidor em Identity é o seam (ADR-025 F2), allowlisted.

## 4. Decisões tomadas
- Novo bounded context `src/contexts/billing/` (supersede §13.2/§13.18 → eventos `billing.*`),
  autorizado pelo usuário ("ajustar ADR/congelar").
- Asaas = **adapter único** (porta `PaymentProvider`), sem multi-gateway (proibição mantida).
- **Source of truth:** Asaas = pagamento; ClinicaOS = acesso (ADR-016/025).
- Money: `numeric(12,2)` + centavos no cálculo, nunca float.
- Transições **monotônicas** (`canTransition`) p/ webhook fora de ordem.
- Quota: contagem via ledger genérico idempotente (consumers); gate síncrono = `checkAndIncrementQuota`
  (decisão, sem incrementar — o incremento é eventual via consumer; evita dupla contagem).
- **Desvio documentado:** contagem de IA deduplicada por `conversationId` (o evento
  `ai_agent.conversation.completed` não traz o telefone/PII para aplicar "1×/24h por número").
- `clinics.status` é write privilegiado (D31) → transição de acesso roda via `dbAdmin`
  (webhook/crons), nunca `withTenant` authenticated (bug pego pelo smoke e corrigido).

## 5. Arquivos criados
Schema/contrato: `contexts/billing/{schema.ts, events.ts, index.ts, api.ts}`.
Domínio (puro): `internal/{money, state-machine, dunning, access, annual-prepay, quota-policy}.ts`
+ teste `internal/billing-logic.test.ts`.
Domínio (DB): `internal/{quota, subscriptions, provisioning, require-active-clinic}.ts`,
`internal/providers/asaas.ts`, `internal/handlers/{appointment-created, conversation-completed}.ts`.
Rotas: `app/api/webhooks/asaas/route.ts`, `app/api/cron/{billing-dunning, billing-reconcile}/route.ts`.
Scripts: `scripts/{seed-plans, asaas-live-check, smoke-c13}.ts`.
Docs: `docs/adr/025-billing-architecture.md`, `docs/contracts/events/billing.md`, este relatório.

## 6. Arquivos modificados
`src/lib/env.ts` (ASAAS_* + asserts), `contexts/tenancy/schema.ts` (+`pending_payment`),
`lib/db/schema/index.ts` (barrel), `app/api/cron/outbox/handlers.ts` (registra 2 consumers),
`vercel.json` (2 crons), `eslint.config.mjs` + `scripts/arch-db-check.ts` (allowlist dbAdmin do
webhook + crons billing), `scripts/check-handler-registry.ts` (producer-ahead billing.*),
`package.json` (3 scripts), `docs/adr/{024,016}.md` (emendas).

## 7. Migrations criadas
`drizzle/migrations/0026_square_blazing_skull.sql` — **aplicada no dev DB**. 16 tabelas (3 globais,
4 plataforma, 9 tenant-scoped + ledger) + `ALTER TYPE clinic_status ADD VALUE pending_payment` +
RLS (FORCE) + triggers + GRANTs (sem DELETE) + seed idempotente (planos/preços/limites).

## 8. Eventos adicionados
17 `billing.*` (ver [contrato](../contracts/events/billing.md)). Emitidos só via `publishEvent`.
Consumers ativos: `scheduling.appointment.created` e `ai_agent.conversation.completed` (metering).
Demais `billing.*` são producer-ahead (timeline/UI/C14/Identity-onboarding).

## 9. RLS adicionadas
9 tabelas tenant-scoped com `defaultTenantPolicy(v1)` (ENABLE+FORCE). 3 catálogos globais
(plans/prices/plan_limits) read-only authenticated. 4 plataforma (checkout_sessions,
tenant_provisioning, processed_webhooks, billing_reconciliation_runs) FORCE sem policy
authenticated (só service_role). Validado por `arch:db-check` (0 findings) + smoke RLS A≠B.

## 10. Testes executados (evidências)
- **Unit:** `vitest run src/contexts/billing` → **21/21 passam** (money, refund pro-rata, dunning
  +grace, access mapping, state-machine monotônica, quota-policy).
- **Integration:** `pnpm smoke:c13` → **8/8 passam**: provisionamento (pending_payment), webhook
  PAYMENT_RECEIVED → invoice paid + clínica reativada, dunning D+30 → suspended, quota idempotente
  (contador=1 em 2 chamadas), RLS A≠B.
- **Gates de arquitetura:** `typecheck` ✅ · `lint` ✅ · `arch:db-check` (370 files, 0 findings) ✅ ·
  `check:registry:strict` (catalog 44 ⇔ registry 10) ✅ · `check:migrations` ✅.
- **Asaas REAL (13.6.1) — EXECUTADO ✅:** `pnpm billing:live-check` criou customer + subscription
  ACTIVE no sandbox real; `pnpm billing:live-roundtrip` provisionou clínica + subscription com
  persistência local (`cus_000008201215` / `sub_apblrkrulzyo9mhw`).
- **Round-trip de webhook REAL em produção (13.6.1/13.6.2) — VERIFICADO ✅:** ver §16.

## 11. Mapa §13.6 (manuais) e §13.5
- 13.6.1 sandbox Asaas → **VERIFICADO em produção** (live-check + round-trip do webhook real, §16).
  13.6.2 overdue→dunning → smoke + cron (dunning diário 08:00 UTC).
- 13.6.3 D+15/D+30 → status muda + escrita bloqueada → smoke (D+30) + `requireActiveClinic`.
- 13.6.4 agendamento no limite NÃO bloqueia → `enforce('agendamento')` (unit). 13.6.5 user acima
  do limite bloqueia → `assertUserQuota` (unit/api; call-site de convite = onboarding).
  13.6.5b IA estoura → degrada (teto via ai-agent quota + count). 13.6.6 refund pro-rata → unit.
  13.6.7 RLS A≠B → smoke. **§13.5:** trial/cobrança/transições/webhooks/quota/suspensão/refund cobertos.

## 12. Riscos remanescentes
- Webhook Asaas duplicado em deploy → mitigado por `processed_webhooks` (dedup) + transições
  monotônicas + idempotency de outbox.
- Asaas fora de ordem → `canTransition` (paid não regride).
- Circuit breaker em memória por instância (aceitável MVP; Redis ao escalar — mesmo de C11).
- `billing-reconcile` faz N chamadas Asaas (1/invoice em aberto) — limitado a 200/run; tune futuro.

## 13. Débito técnico ACEITÁVEL (documentado)
- **UI `/checkout`** não construída: backend de provisioning (`provisionTenant`) pronto e testado;
  falta o entrypoint allowlisted (rota/admin) + página. Onboarding guiado é spec separada.
- **Owner-creation (Identity)**: evento + seam + allowlist prontos; criação de auth-user (Supabase
  admin) é integração de onboarding.
- **Login gate em middleware**: predicado `isLoginBlocked` pronto; falta plugar no middleware
  (`pending_payment`/`suspended`/`cancelled` → não loga, exceto owner). `requireActiveClinic`
  (bloqueio de ESCRITA) já implementado e testado.
- **Rollout de `requireActiveClinic`** nas mutations dos demais contextos (wired em billing).
- **IA quota** deduplicada por `conversationId` (não telefone+24h) — limitação do payload do evento.

## 14. Débito técnico PROIBIDO (não introduzido — verificado)
Sem overage/pay-as-you-go, sem feature-flags por plano, sem entitlements engine, sem multi-gateway,
sem múltiplos cartões, sem upgrade/downgrade UI, sem flag booleana em `plan_limits`. Busca por
código semelhante: nenhum encontrado para remover.

## 15. Critério de pronto
Motor de billing **PRONTO e VERIFICADO em produção** (unit 21/21, smoke 8/8, gates verdes, migration
aplicada, **round-trip de webhook real fechado** — §16). Os 23 gaps das revisões endereçados
(G1–G11, F1–F8 + 8 finais — ver plano). **Fora do escopo C13 (camada de onboarding, débito §13):**
checkout UI + owner-creation + login-gate de suspensão no middleware. Não bloqueiam o motor.

## 16. Verificação em produção (2026-06-18, deploy app.qoro.dev / banco qoro-dev)
Round-trip real do ciclo de pagamento, ponta a ponta:
- `billing:live-roundtrip` → Asaas real (customer+subscription) + provisiona clínica
  `3c68f3a6-…` em `pending_payment`.
- Asaas dispara `PAYMENT_RECEIVED` → `/api/webhooks/asaas` → **`{status: processed}`**.
- Efeito confirmado no banco: clínica → **`active`**, invoice **materializada + `paid`**,
  subscription → **`active`**, `payment_attempt` confirmed, `billing_events` (invoice.generated+paid),
  `processed_webhooks` registrado.
- Replay do mesmo evento → **`duplicate`** (idempotência/replay protection confirmada).

**Dois bugs encontrados no deploy e corrigidos (commits f17dcb9, 249ddde):**
1. **Webhook não materializava a invoice** — só atualizava invoice pré-existente; ciclo recorrente
   nunca fechava. Fix: `ensureInvoiceForPayment` trata `PAYMENT_CREATED` e cria a invoice resolvendo
   a subscription por `asaas_subscription_id` (out-of-order safe). [subscriptions.ts]
2. **Middleware sequestrava o webhook** — `config.matcher` excluía `api/cron`/`api/health` mas não
   `api/webhooks` → Asaas recebia `307 → /login` e penalizava a fila. Fix: excluir `api/webhooks`
   do matcher (auth do webhook é por token do provider, não sessão). [middleware.ts] — corrige
   também o webhook Meta (C10), que tinha o mesmo bug latente.

**Operação:** crons `billing-dunning` (08:00 UTC) e `billing-reconcile` (09:00 UTC) registrados no
`vercel.json` (diários — `CRON_SECRET` validado pelos crons existentes que retornam 200).
