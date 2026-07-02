# Architecture Decision Records (ADRs)

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice mestre](../README.md).


> ADRs são append-only. Um ADR aceito nunca é editado — quando a decisão muda,
> escreva um novo ADR que cite o anterior e marque o antigo como `superseded by`.
> ADRs contêm apenas princípios e decisões. Narrativa, runbooks operacionais
> e contexto histórico vivem em `docs/PlanoAção.md`, `docs/runbooks/` e
> `docs/PROGRESS.md`.

## Índice

| # | Título | Status | Camada |
|---|---|---|---|
| [000](000-template.md) | Template | template | — |
| [001](001-bounded-contexts.md) | Bounded contexts isolados via DDD | accepted | C0 |
| [002](002-rls-postgres.md) | RLS Postgres como defesa de isolamento de tenant | accepted | C0 |
| [003](003-outbox-pattern.md) | Outbox transacional para eventos cross-context | accepted | C0 / C4 |
| [004](004-meta-cloud-api.md) | Meta Cloud API como provider primário de WhatsApp | accepted | C0 / C10 |
| [005](005-supabase-vs-firebase.md) | Supabase (Postgres) escolhido sobre Firebase | accepted | C0 / C1 |
| [006](006-drizzle-orm-pinning.md) | Drizzle ORM com pin exato + driver postgres-js | accepted | C1 |
| [007](007-rls-implementation-patterns.md) | RLS implementation patterns (FORCE-principal + dual-context + single helper) | accepted | C2 |
| [008](008-identity-patterns.md) | Identity patterns (super_admin platform-scoped, JWT cache snapshot, RBAC vs RLS) | accepted | C3 |
| [009](009-claims-drift-mitigation.md) | Claims drift mitigation (trigger + Hook + throttled middleware) | accepted | C3 |
| [010](010-security-definer-patterns.md) | SECURITY DEFINER patterns (8 rules + PR checklist) | accepted | C3 |
| [011](011-outbox-audit-idempotency-patterns.md) | Outbox / Audit / Idempotency implementation patterns | accepted | C4 |
| [012](012-encryption-strategy.md) | Encryption strategy (AES-256-GCM per-tenant via HKDF + lookup HMAC + secret provider) | accepted | C5 |
| [013](013-clinical-data-ownership.md) | patient_clinical_data fica em C5, C7 é o futuro owner | accepted | C5 |
| [014](014-scheduling-patterns.md) | Scheduling Core (C6): contratos congelados (R1–R13 + walk-in + lifecycle) | accepted | C6 |
| [015](015-event-versioning.md) | Versionamento de eventos do outbox (event_type é a fronteira de versão) | accepted | C4+ |
| [016](016-clinic-lifecycle.md) | Semântica do ciclo de vida de clínica (base; enforcement em C13) | accepted | C2 / C13 |
| [017](017-clinical-record-retention-vs-lgpd.md) | Retenção de prontuário (CFM) vs hard-delete LGPD | accepted | C7 |
| [018](018-ui-design-foundation.md) | UI / Design Foundation (DS = verdade de design; foundation-first; tokens Tailwind 4) | accepted | Fundação Visual (pré-C8) |
| [019](019-consultorio-chamadas.md) | Consultório (C8): orquestração fina + `chamadas` em Clinical + Realtime com RLS por JWT | accepted | C8 |
| [020](020-messaging-provider-patterns.md) | Messaging Provider Patterns (webhook Meta, inbound/outbound cifrado, dedup, identificação de tenant por número) | accepted | C10 |
| [021](021-lgpd-anonymization-on-clinical-retention.md) | Anonimização LGPD quando o hard-delete é bloqueado por retenção clínica (RESTRICT) | accepted | Remediação forense pós-C10 |
| [022](022-ai-agent-foundation.md) | Fundação do AI Agent (provider Gemini, saga LLM-fora-de-TX, guards anti-SAMD, orçamentos) | accepted | C11 |
| [023](023-ai-agent-intents.md) | AI Agent Intents Core (ator de sistema `ai_agent`, intents executores, memória de coleta) | accepted | C12 |
| [024](024-plan-model.md) | Modelo de planos (só limites, sem overage, sem feature-gating; enforcement em C13) | accepted | base / C13 |
| [025](025-billing-architecture.md) | Arquitetura de Billing (Asaas é adapter, não o centro; Billing context é dono do modelo) | accepted | C13 |
| [026](026-proactive-jobs.md) | Proactive Jobs (proativo determinístico via cron + reativo via IA; lembrete/dunning/followup) | accepted | C14 |
| [027](027-onboarding-magic-invite.md) | Onboarding via convite mágico (admin → /join wizard → checkout Asaas → saga trial + owner auto-login; reusa webhook C13) | accepted | F1 |
| [028](028-white-label-scope-pdf-only.md) | White-label restrito aos PDFs (logo + cor no cabeçalho); sem tema de app (refina ADR-018 §5) | accepted | Fundação Visual |
| [029](029-observability-stack.md) | Observability stack (Sentry + logger in-house + Better Stack + error envelope + health unificado) | accepted | C16 |
| [030](030-security-headers-csp.md) | Security headers + CSP faseada (Report-Only primeiro, bloqueante com nonce depois) | accepted | C16 |
| [031](031-design-system-v2-rebrand.md) | Design System v2: rebrand petrol/clay + governança de UI + estrangulamento do CSS legado (supersede parcial ADR-018) | accepted | Fundação Visual |

## Como propor um novo ADR

1. Copie [000-template.md](000-template.md) para `NNN-<short-kebab-name>.md`
   (próximo número disponível).
2. Preencha as seções: Context, Decision, Consequences, Alternatives, References.
3. Status inicial: `proposed`. Vira `accepted` quando o PR é mergeado.
4. Adicione uma linha no índice acima no mesmo PR.

## Convenções

- Um ADR = uma decisão arquitetural. Decisões pequenas (renomear variável) NÃO precisam de ADR.
- Cite ADRs anteriores que essa decisão estende, refina ou substitui.
- Documente alternativas rejeitadas — futuras releituras dependem disso para entender o "porquê".
- Não escreva sobre código que ainda não existe (a menos que o ADR seja sobre o contrato do que será construído).

---

## Veja também

- [../README.md](../README.md) — índice mestre da documentação.
- [../documentation-authority.md](../documentation-authority.md) — ADRs são a **autoridade máxima** entre as famílias de doc.
- [../engineering/decision-guide.md](../engineering/decision-guide.md) — quando uma mudança exige abrir um ADR.
- [../architecture/context-map.md](../architecture/context-map.md) — o mapa que ADR-001 estabelece.
