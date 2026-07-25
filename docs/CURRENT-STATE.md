# Estado Atual do Sistema — Qoro

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-23 · **source_of_truth:** código
>
> ↩︎ [README](./README.md) · Detalhe por domínio: `domains/` · Decisões: [adr/](./adr/)

Índice executivo do que **existe hoje**. Não é enciclopédia (R5): cada linha responde *o que existe ·
qual o status · onde está a fonte*. Detalhe fica em `domains/`, `security/`, `operations/`. Status por
[governance/lifecycle.md R3](./governance/lifecycle.md): `IMPLEMENTED · PARTIALLY_IMPLEMENTED · PLANNED ·
NOT_IMPLEMENTED`.

---

## Estado geral

Produto **em produção** (multi-tenant, single deploy). Camadas de construção **C0–C16 fechadas**
(billing verificado em prod 2026-06-18; observabilidade/hardening C16 em prod). 2 projetos Supabase
(dev / prod). O trabalho corrente é pós-MVP (painéis, refinamentos) — não há camada C nova em aberto.

## Stack (o que roda) — `IMPLEMENTED`

| Camada | Tecnologia | Fonte |
|---|---|---|
| App | Next.js (App Router) no Vercel | `architecture/overview.md` |
| Dados | Supabase / Postgres + **RLS** | ADR-002/005/007/042 |
| ORM | Drizzle (pin exato) + `postgres-js` | ADR-006 |
| WhatsApp | **Meta Cloud API** (oficial) | ADR-004 · `domains/messaging.md` |
| IA | Gemini | ADR-022 · `domains/ai-agent.md` |
| Cobrança | **Asaas** (adapter) | ADR-025 · `domains/billing.md` |
| Cache / rate-limit / quota | Upstash Redis | ADR (achado Redis) |
| Observabilidade | Sentry + logger in-house + Better Stack | ADR-029/045 · `operations/observability/` |

## Domínios (11 bounded contexts em `src/contexts/`)

Todos `IMPLEMENTED` (C0–C16 fechadas). Detalhe e nuances → `domains/<nome>.md` (Onda 3 da migração).

| Domínio | O que faz | Decisões |
|---|---|---|
| identity | Auth, sessão server-authoritative, RBAC, convite, offboarding | ADR-008/032/037/038/039/040/041 |
| tenancy | Clínicas, ciclo de vida, white-label (PDF) | ADR-016/028 |
| billing | Planos, mensalidade (Asaas), quota, dunning | ADR-024/025/046 |
| patient | Cadastro, cripto per-tenant, LGPD hard-delete/anonimização | ADR-012/017/021 |
| scheduling | Agenda + state machine; Consultório (kanban/`chamadas`) | ADR-014/019/033 |
| clinical | Prontuário, prescrição, documentos/PDF, cifra de conteúdo | ADR-012/013/044 |
| financial | Núcleo financeiro (fluxo de caixa) | — |
| messaging | Provider WhatsApp (Meta), inbound/outbound, retenção | ADR-004/020/043 |
| onboarding | Onboarding de clínica via convite mágico | ADR-027 |
| ai-agent | Agente (Gemini), intents, memória, jobs proativos, handoff | ADR-022/023/026/047 |
| platform-admin | Painel `/admin`: clínicas, billing, métricas, auditoria, conversas-IA, saúde | ADR-028 |

## Planos (billing) — fonte canônica: `domains/billing.md`

- **3 planos ativos:** `solo`, `clinica`, `pro` (`billing/events.ts:44`). Limite de usuários do maior
  plano = **10** (`rate-limit.ts:413`, `plan_limits`/migration 0039). Sem overage, sem feature-gating (ADR-024).
- ⚠️ **`Pro+`** aparece em docs antigos mas **não existe no código** → `PLANNED` (ou remover). Ver [docs-migration].
- 13 **jobs proativos** (crons) rodando: lembretes, dunning, followup, reconciliações, rollups, retenção (ADR-026).

## Fases de construção C0–C16 — todas fechadas

Referência histórica (o log detalhado vai para `history/execution-log.md`): C0 Fundação · C1 DB/Drizzle ·
C2 Multi-tenant/RLS · C3 Identity/Auth · C4 Outbox/Audit/Idempotency · C5 Patient · C6 Scheduling ·
C7 Clinical · C8 Consultório · C9 Financial · C10 Messaging · C11 AI base · C12 AI intents · C13 Billing ·
C14 Proactive jobs · C15 Platform Admin · C16 Observabilidade/Hardening. **C17/C18 = futuro** (`planning/roadmap.md`).

## Segurança (resumo) — detalhe em `security/`

RLS `FORCE` + dual-context + Policy v2 InitPlan (ADR-007/042); cripto per-tenant AES-256-GCM + lookup HMAC
(ADR-012), estendida ao conteúdo clínico (ADR-044); sessão server-authoritative por request / auth epoch
(ADR-037); MFA/AAL2 (ADR-038); retenção clínica vs LGPD (ADR-017/021); security headers/CSP faseada (ADR-030).
> Verificado (módulo existe): MFA (`login/mfa/actions.ts` + AAL2), cifra de conteúdo clínico
> (`clinical/internal/content-crypto.ts`). **A VERIFICAR na Onda 3** (escopo/enforcement exato): abrangência
> da cifra clínica, CSP bloqueante (sem string CSP em `src/` — checar `next.config`). Ver `docs-migration/CONFLICTS.md`.

## Dívida conhecida (aberta)

- **Observabilidade:** remediação em prod, mas **canal de alerta + teste de disparo pendentes** (go-live #2).
- **CSP bloqueante** (ADR-030): aparenta diferida — nenhuma string CSP em `src/`; confirmar em `next.config` (Onda 3).
- Dívida técnica pós-C16 detalhada (D1–D7 do PROGRESS): será extraída para cá / `planning/` na Onda 4.
> _(A cifra de conteúdo clínico (ADR-044) tem módulo `content-crypto.ts` em prod — **não** é dívida; escopo exato confirmado na Onda 3.)_

## Onde está o resto
- **Como funciona por dentro:** `domains/` · `architecture/overview.md`
- **Por que assim:** [adr/](./adr/) (+ [índice de status](./adr/README.md))
- **Operar/incidentes:** `operations/`
- **O que ainda não existe:** `planning/`
- **O que já foi:** `history/`
