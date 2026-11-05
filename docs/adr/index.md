---
title: "Decisões arquiteturais"
description: "Índice completo dos ADRs preservados, com contexto e data próprios."
docType: "index"
---

ADRs registram uma decisão no contexto original. Um status histórico não determina
sozinho o que existe hoje. Para o comportamento atual, consulte o [mapa dos contextos](/architecture/context-map),
[cadastro](/onboarding/signup), [assinaturas](/billing/subscriptions) e
[política financeira](/domains/financial-policy).

## Registro completo

Os originais estão preservados na revisão-base do repositório. A reorganização
não renumera decisões, não altera seu conteúdo e não descarta lacunas.

| ADR | Assunto |
| --- | --- |
| [001](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/001-bounded-contexts.md) | ADR-001 — Bounded Contexts isolados via DDD |
| [002](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/002-rls-postgres.md) | ADR-002 — RLS Postgres como defesa de isolamento de tenant |
| [003](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/003-outbox-pattern.md) | ADR-003 — Outbox transacional para eventos cross-context |
| [004](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/004-meta-cloud-api.md) | ADR-004 — Meta Cloud API (WhatsApp) com fallback ZAPI |
| [005](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/005-supabase-vs-firebase.md) | ADR-005 — Supabase (Postgres) escolhido sobre Firebase |
| [007](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/007-rls-implementation-patterns.md) | ADR-007 — Padrão de RLS |
| [008](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/008-identity-patterns.md) | ADR-008 — Identidade e RBAC |
| [009](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/009-claims-drift-mitigation.md) | ADR-009 — Mitigação de drift de claims |
| [010](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/010-security-definer-patterns.md) | ADR-010 — Funções privilegiadas |
| [011](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/011-outbox-audit-idempotency-patterns.md) | ADR-011 — Outbox, audit e idempotência |
| [012](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/012-encryption-strategy.md) | ADR-012 — Encryption Strategy (per-tenant AES-256-GCM + lookup HMAC) |
| [013](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/013-clinical-data-ownership.md) | ADR-013 — patient_clinical_data permanece em C5, mas C7 é o futuro owner |
| [014](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/014-scheduling-patterns.md) | ADR-014 — Scheduling Core (C6): contratos congelados |
| [015](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/015-event-versioning.md) | ADR-015 — Versionamento de eventos do outbox |
| [016](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/016-clinic-lifecycle.md) | ADR-016 — Semântica do ciclo de vida de clínica (base; enforcement em C13) |
| [017](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/017-clinical-record-retention-vs-lgpd.md) | ADR-017 — Retenção de prontuário (CFM) vs hard-delete LGPD do paciente |
| [018](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/018-ui-design-foundation.md) | ADR-018 — UI / Design Foundation (quando e como aplicar o Design System) |
| [019](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/019-consultorio-chamadas.md) | ADR-019 — Consultório (C8): orquestração + tabela `chamadas` + Realtime |
| [020](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/020-messaging-provider-patterns.md) | ADR-020 — Messaging providers |
| [021](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/021-lgpd-anonymization-on-clinical-retention.md) | ADR-021 — Anonimização LGPD quando o hard-delete é bloqueado por retenção clínica |
| [022](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/022-ai-agent-foundation.md) | ADR-022 — Fundação do agente de IA |
| [023](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/023-ai-agent-intents.md) | ADR-023 — AI Agent Intents Core (C12): ator de sistema, intents e memória |
| [024](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/024-plan-model.md) | ADR-024 — Modelo de planos: só limites, sem overage, sem feature-gating (base; enforcement em C13) |
| [025](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/025-billing-architecture.md) | ADR-025 — Arquitetura de Billing: Asaas é adapter, não o centro |
| [027](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/027-onboarding-magic-invite.md) | ADR-027 — Onboarding de clínicas via convite mágico |
| [028](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/028-white-label-scope-pdf-only.md) | ADR-028 — White-label: escopo restrito aos PDFs (sem tema de app) |
| [029](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/029-observability-stack.md) | ADR-029 — Observability stack (Sentry + logger in-house + Better Stack + error envelope) |
| [031](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/031-design-system-v2-rebrand.md) | ADR-031 — Design System v2: rebrand petrol/clay + governança de UI + estrangulamento do CSS legado |
| [032](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/032-mvp-identity-practitioner-model.md) | ADR-032 — Modelo de identidade do MVP: colapso User=Employee=Practitioner + predicado `isPractitioner` |
| [033](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/033-consultorio-board-scope-practitioner.md) | ADR-033 — Escopo do board do Consultório: practitioner vê a própria fila |
| [034](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/034-invite-resend-copy-link.md) | ADR-034 — Convite versionado por Resend com link `recovery` copiável |
| [035](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/035-palette-rebrand-navy-orchid.md) | ADR-035 — Rebrand de paleta: petrol/clay → navy/orchid (Qoro) + swap do wordmark |
| [036](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/036-asconflict-permanece-no-contexto.md) | ADR-036 — `asConflict` permanece em cada contexto (não centralizar em `@/lib`) |
| [037](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/037-server-authoritative-session.md) | ADR-037 — Sessão server-authoritative por request (auth epoch) |
| [038](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/038-mfa-policy.md) | ADR-038 — Política de MFA (o "D6" que nunca foi escrito) |
| [039](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/039-member-lifecycle.md) | ADR-039 — Ciclo de vida de membro (offboarding, troca de role, overrides) |
| [040](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/040-invite-acceptance-gate.md) | ADR-040 — Aceite do convite como gate de sessão |
| [041](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/041-authz-tables-are-not-tenant-tables.md) | ADR-041 — Tabela de autorização não é tabela de tenant (I-13) |
| [042](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/042-rls-initplan-and-public-least-privilege.md) | ADR-042 — Policy v2 (InitPlan) + least-privilege do schema `public` |
| [043](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/043-messaging-retention-not-partitioning.md) | ADR-043 — Retenção (não particionamento) contém a mensageria raw |
| [044](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/044-clinical-content-encryption.md) | ADR-044 — Cifra do conteúdo clínico (estende o ADR-012 ao registro médico) |
| [045](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/045-observability-execution-boundary.md) | ADR-045 — Fronteira de observabilidade: withCron + contexto ambiente + captura de background |
| [046](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/046-no-login-gate-clinical-record-access.md) | ADR-046 — Inadimplência não bloqueia login: acesso de LEITURA ao prontuário é obrigação legal |
| [047](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/047-ai-conversations-human-handoff.md) | ADR-047 — Painel de Conversas IA e intervenção humana |
| [048](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/048-ai-agent-conversational-safety.md) | ADR-048 — Segurança conversacional |
| [049](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/049-pagamentos-paciente-sinal.md) | ADR-049 — Pagamento de paciente e sinal anti-no-show (Camada 1 / P0) |
| [050](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/050-identidade-de-pagamento-do-paciente.md) | ADR-050 — Identidade de pagamento do paciente (customer Asaas por clínica) |
| [051](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/051-conciliacao-sinal-e-recebivel.md) | ADR-051 — Conciliação entre cobrança de paciente e recebível (fonte da verdade financeira) |
| [052](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/052-risco-e-reversao-de-pagamento-do-paciente.md) | ADR-052 — Risco e reversão de pagamento do paciente |
| [053](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/053-cadastro-autonomo-seguro.md) | ADR-053 — Cadastro autônomo seguro e atribuição de aquisição |
| [054](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/054-documento-de-pagamento-e-recibo-fiscal.md) | ADR-054 — Documento de pagamento e recibo fiscal da Camada 2 |
| [055](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/055-documentos-clinicos-fora-da-consulta.md) | ADR-055 — Documentos clínicos centrados no paciente, com consulta opcional |
| [056](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/056-spike-integracao-memed.md) | ADR-056 — Spike 2.2.0 e adiamento da integração Memed |
| [057](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/057-recuperacao-falta-retorno.md) | ADR-057 — Recuperação após falta e retorno clínico |
| [058](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/058-exportacao-financeira-contabilidade.md) | ADR-058 — Exportação financeira mensal para contabilidade |
| [059](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/059-acesso-autenticado-pdfs-clinicos.md) | ADR-059 — Acesso autenticado a PDFs clínicos sem bearer URL |
| [060](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/060-sessao-anonima-de-cadastro.md) | ADR-060 — Fatia O-2: sessão anônima de cadastro (bootstrap seguro) |
| [062](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/062-identidade-consentimento-cadastro.md) | ADR-062 — Identidade, consentimento e nome da clínica no cadastro |
| [063](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/063-saude-de-envio-whatsapp.md) | ADR-063 — Saúde de envio da conta WhatsApp e a C14 com a conta bloqueada |
| [064](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/064-c14-reenvio-por-geracao.md) | ADR-064 — C14 reenvia de verdade, com uma chave de envio por geração |
| [065](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/065-validade-por-tipo-c14.md) | ADR-065 — Validade por tipo na fila C14 |
| [066](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/066-janela-da-oferta-da-lista-de-espera.md) | ADR-066 — A janela de resposta da oferta da lista de espera só corre nas horas de envio |

## Como registrar uma nova decisão

Explique contexto, alternativas, decisão, consequências e evidência. Atualize a
referência canônica correspondente e este índice. Veja [as convenções](/engineering/documentation).
