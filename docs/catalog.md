---
title: "Catálogo completo"
description: "Todos os documentos e arquivos de apoio, classificados por função; histórico preservado e separado do manual."
docType: "index"
---

Este catálogo cobre os arquivos de `docs/`, exceto ele próprio e seu manifesto
`catalog.json`. Arquivos ocultos de configuração são verificados separadamente.
Nada do acervo anterior foi excluído. A classificação indica finalidade, **não**
certifica que cada parágrafo histórico foi revalidado.

As páginas do manual abrem no portal local. Registros anteriores apontam para
a revisão-base `af677c00` no GitHub, preservando sua data e contexto.
Ferramentas e templates novos são consultados pelo arquivo no checkout.

O portal não foi publicado e exclusão da navegação não é controle de acesso.

## Manual organizado — páginas da navegação

| Arquivo | Assunto |
| --- | --- |
| [adr/index.md](/adr/index) | Decisões arquiteturais |
| [ai/agent.md](/ai/agent) | Agente de IA no WhatsApp |
| [architecture/c4.md](/architecture/c4) | Arquitetura C4 — visão do sistema |
| [architecture/context-map.md](/architecture/context-map) | Mapa de contextos |
| [architecture/overview.md](/architecture/overview) | Arquitetura do Qoro |
| [architecture/risks.md](/architecture/risks) | Riscos arquiteturais — Camada -1 |
| [backend/http-jobs-outbox.md](/backend/http-jobs-outbox) | Backend, HTTP, crons e outbox |
| [billing/plans-and-seats.md](/billing/plans-and-seats) | Planos, médicos e equipe |
| [billing/subscriptions.md](/billing/subscriptions) | Assinaturas e cobrança do SaaS |
| [database/schema.md](/database/schema) | Banco, migrations e multi-tenancy |
| [development/environment.md](/development/environment) | Variáveis de ambiente |
| [development/onboarding.md](/development/onboarding) | Onboarding de desenvolvimento |
| [development/setup.md](/development/setup) | Setup local |
| [development/testing.md](/development/testing) | Testes e gates |
| [domains/financial-policy.md](/domains/financial-policy) | Pagamentos, taxas e repasses |
| [domains/patient-clinical-lgpd.md](/domains/patient-clinical-lgpd) | Pacientes, dados clínicos e LGPD |
| [domains/scheduling-financial.md](/domains/scheduling-financial) | Agenda e financeiro da clínica |
| [engineering/ai-development.md](/engineering/ai-development) | Desenvolvimento assistido por IA |
| [engineering/decision-guide.md](/engineering/decision-guide) | Guia de decisão para mudanças |
| [engineering/definition-of-done.md](/engineering/definition-of-done) | Definition of Done |
| [engineering/documentation.md](/engineering/documentation) | Como manter a documentação |
| [engineering/git-workflow.md](/engineering/git-workflow) | Workflow Git |
| [frontend/routes-and-access.md](/frontend/routes-and-access) | Frontend, rotas e acesso |
| [index.md](/index) | Documentação técnica do Qoro |
| [integrations/providers.md](/integrations/providers) | Integrações externas |
| [onboarding/invitations.md](/onboarding/invitations) | Convites e compatibilidade |
| [onboarding/signup.md](/onboarding/signup) | Cadastro autônomo e retomada |
| [operations/deployment-observability.md](/operations/deployment-observability) | Deploy, observabilidade e retenção |
| [overview/current-state.md](/overview/current-state) | Estado atual do repositório |
| [overview/reading-paths.md](/overview/reading-paths) | Trilhas de leitura |
| [quality/index.md](/quality/index) | Validação e evidências |
| [roadmap/known-limitations.md](/roadmap/known-limitations) | Limites e validações por ambiente |
| [runbooks/disaster-recovery.md](/runbooks/disaster-recovery) | Recuperação de banco — Qoro |
| [runbooks/index.md](/runbooks/index) | Procedimentos operacionais |
| [runbooks/migrations.md](/runbooks/migrations) | Runbook de migrations |
| [runbooks/production-readiness.md](/runbooks/production-readiness) | Prontidão de produção |
| [security/model.md](/security/model) | Modelo de segurança |
| [specs/index.md](/specs/index) | Especificações e progresso |
| [whatsapp-connection-flow.md](/whatsapp-connection-flow) | Conexão do WhatsApp |

## Decisões registradas — contexto e data originais

| Arquivo | Assunto |
| --- | --- |
| [adr/001-bounded-contexts.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/001-bounded-contexts.md) | ADR-001 — Bounded Contexts isolados via DDD |
| [adr/002-rls-postgres.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/002-rls-postgres.md) | ADR-002 — RLS Postgres como defesa de isolamento de tenant |
| [adr/003-outbox-pattern.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/003-outbox-pattern.md) | ADR-003 — Outbox transacional para eventos cross-context |
| [adr/004-meta-cloud-api.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/004-meta-cloud-api.md) | ADR-004 — Meta Cloud API (WhatsApp) com fallback ZAPI |
| [adr/005-supabase-vs-firebase.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/005-supabase-vs-firebase.md) | ADR-005 — Supabase (Postgres) escolhido sobre Firebase |
| [adr/007-rls-implementation-patterns.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/007-rls-implementation-patterns.md) | ADR-007 — Padrão de RLS |
| [adr/008-identity-patterns.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/008-identity-patterns.md) | ADR-008 — Identidade e RBAC |
| [adr/009-claims-drift-mitigation.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/009-claims-drift-mitigation.md) | ADR-009 — Mitigação de drift de claims |
| [adr/010-security-definer-patterns.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/010-security-definer-patterns.md) | ADR-010 — Funções privilegiadas |
| [adr/011-outbox-audit-idempotency-patterns.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/011-outbox-audit-idempotency-patterns.md) | ADR-011 — Outbox, audit e idempotência |
| [adr/012-encryption-strategy.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/012-encryption-strategy.md) | ADR-012 — Encryption Strategy (per-tenant AES-256-GCM + lookup HMAC) |
| [adr/013-clinical-data-ownership.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/013-clinical-data-ownership.md) | ADR-013 — patient_clinical_data permanece em C5, mas C7 é o futuro owner |
| [adr/014-scheduling-patterns.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/014-scheduling-patterns.md) | ADR-014 — Scheduling Core (C6): contratos congelados |
| [adr/015-event-versioning.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/015-event-versioning.md) | ADR-015 — Versionamento de eventos do outbox |
| [adr/016-clinic-lifecycle.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/016-clinic-lifecycle.md) | ADR-016 — Semântica do ciclo de vida de clínica (base; enforcement em C13) |
| [adr/017-clinical-record-retention-vs-lgpd.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/017-clinical-record-retention-vs-lgpd.md) | ADR-017 — Retenção de prontuário (CFM) vs hard-delete LGPD do paciente |
| [adr/018-ui-design-foundation.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/018-ui-design-foundation.md) | ADR-018 — UI / Design Foundation (quando e como aplicar o Design System) |
| [adr/019-consultorio-chamadas.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/019-consultorio-chamadas.md) | ADR-019 — Consultório (C8): orquestração + tabela chamadas + Realtime |
| [adr/020-messaging-provider-patterns.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/020-messaging-provider-patterns.md) | ADR-020 — Messaging providers |
| [adr/021-lgpd-anonymization-on-clinical-retention.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/021-lgpd-anonymization-on-clinical-retention.md) | ADR-021 — Anonimização LGPD quando o hard-delete é bloqueado por retenção clínica |
| [adr/022-ai-agent-foundation.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/022-ai-agent-foundation.md) | ADR-022 — Fundação do agente de IA |
| [adr/023-ai-agent-intents.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/023-ai-agent-intents.md) | ADR-023 — AI Agent Intents Core (C12): ator de sistema, intents e memória |
| [adr/024-plan-model.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/024-plan-model.md) | ADR-024 — Modelo de planos: só limites, sem overage, sem feature-gating (base; enforcement em C13) |
| [adr/025-billing-architecture.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/025-billing-architecture.md) | ADR-025 — Arquitetura de Billing: Asaas é adapter, não o centro |
| [adr/027-onboarding-magic-invite.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/027-onboarding-magic-invite.md) | ADR-027 — Onboarding de clínicas via convite mágico |
| [adr/028-white-label-scope-pdf-only.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/028-white-label-scope-pdf-only.md) | ADR-028 — White-label: escopo restrito aos PDFs (sem tema de app) |
| [adr/029-observability-stack.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/029-observability-stack.md) | ADR-029 — Observability stack (Sentry + logger in-house + Better Stack + error envelope) |
| [adr/031-design-system-v2-rebrand.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/031-design-system-v2-rebrand.md) | ADR-031 — Design System v2: rebrand petrol/clay + governança de UI + estrangulamento do CSS legado |
| [adr/032-mvp-identity-practitioner-model.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/032-mvp-identity-practitioner-model.md) | ADR-032 — Modelo de identidade do MVP: colapso User=Employee=Practitioner + predicado isPractitioner |
| [adr/033-consultorio-board-scope-practitioner.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/033-consultorio-board-scope-practitioner.md) | ADR-033 — Escopo do board do Consultório: practitioner vê a própria fila |
| [adr/034-invite-resend-copy-link.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/034-invite-resend-copy-link.md) | ADR-034 — Convite versionado por Resend com link recovery copiável |
| [adr/035-palette-rebrand-navy-orchid.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/035-palette-rebrand-navy-orchid.md) | ADR-035 — Rebrand de paleta: petrol/clay → navy/orchid (Qoro) + swap do wordmark |
| [adr/036-asconflict-permanece-no-contexto.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/036-asconflict-permanece-no-contexto.md) | ADR-036 — asConflict permanece em cada contexto (não centralizar em @/lib) |
| [adr/037-server-authoritative-session.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/037-server-authoritative-session.md) | ADR-037 — Sessão server-authoritative por request (auth epoch) |
| [adr/038-mfa-policy.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/038-mfa-policy.md) | ADR-038 — Política de MFA (o "D6" que nunca foi escrito) |
| [adr/039-member-lifecycle.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/039-member-lifecycle.md) | ADR-039 — Ciclo de vida de membro (offboarding, troca de role, overrides) |
| [adr/040-invite-acceptance-gate.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/040-invite-acceptance-gate.md) | ADR-040 — Aceite do convite como gate de sessão |
| [adr/041-authz-tables-are-not-tenant-tables.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/041-authz-tables-are-not-tenant-tables.md) | ADR-041 — Tabela de autorização não é tabela de tenant (I-13) |
| [adr/042-rls-initplan-and-public-least-privilege.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/042-rls-initplan-and-public-least-privilege.md) | ADR-042 — Policy v2 (InitPlan) + least-privilege do schema public |
| [adr/043-messaging-retention-not-partitioning.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/043-messaging-retention-not-partitioning.md) | ADR-043 — Retenção (não particionamento) contém a mensageria raw |
| [adr/044-clinical-content-encryption.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/044-clinical-content-encryption.md) | ADR-044 — Cifra do conteúdo clínico (estende o ADR-012 ao registro médico) |
| [adr/045-observability-execution-boundary.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/045-observability-execution-boundary.md) | ADR-045 — Fronteira de observabilidade: withCron + contexto ambiente + captura de background |
| [adr/046-no-login-gate-clinical-record-access.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/046-no-login-gate-clinical-record-access.md) | ADR-046 — Inadimplência não bloqueia login: acesso de LEITURA ao prontuário é obrigação legal |
| [adr/047-ai-conversations-human-handoff.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/047-ai-conversations-human-handoff.md) | ADR-047 — Painel de Conversas IA e intervenção humana |
| [adr/048-ai-agent-conversational-safety.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/048-ai-agent-conversational-safety.md) | ADR-048 — Segurança conversacional |
| [adr/049-pagamentos-paciente-sinal.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/049-pagamentos-paciente-sinal.md) | ADR-049 — Pagamento de paciente e sinal anti-no-show (Camada 1 / P0) |
| [adr/050-identidade-de-pagamento-do-paciente.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/050-identidade-de-pagamento-do-paciente.md) | ADR-050 — Identidade de pagamento do paciente (customer Asaas por clínica) |
| [adr/051-conciliacao-sinal-e-recebivel.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/051-conciliacao-sinal-e-recebivel.md) | ADR-051 — Conciliação entre cobrança de paciente e recebível (fonte da verdade financeira) |
| [adr/052-risco-e-reversao-de-pagamento-do-paciente.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/052-risco-e-reversao-de-pagamento-do-paciente.md) | ADR-052 — Risco e reversão de pagamento do paciente |
| [adr/053-cadastro-autonomo-seguro.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/053-cadastro-autonomo-seguro.md) | ADR-053 — Cadastro autônomo seguro e atribuição de aquisição |
| [adr/054-documento-de-pagamento-e-recibo-fiscal.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/054-documento-de-pagamento-e-recibo-fiscal.md) | ADR-054 — Documento de pagamento e recibo fiscal da Camada 2 |
| [adr/055-documentos-clinicos-fora-da-consulta.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/055-documentos-clinicos-fora-da-consulta.md) | ADR-055 — Documentos clínicos centrados no paciente, com consulta opcional |
| [adr/056-spike-integracao-memed.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/056-spike-integracao-memed.md) | ADR-056 — Spike 2.2.0 e adiamento da integração Memed |
| [adr/057-recuperacao-falta-retorno.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/057-recuperacao-falta-retorno.md) | ADR-057 — Recuperação após falta e retorno clínico |
| [adr/058-exportacao-financeira-contabilidade.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/058-exportacao-financeira-contabilidade.md) | ADR-058 — Exportação financeira mensal para contabilidade |
| [adr/059-acesso-autenticado-pdfs-clinicos.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/059-acesso-autenticado-pdfs-clinicos.md) | ADR-059 — Acesso autenticado a PDFs clínicos sem bearer URL |
| [adr/060-sessao-anonima-de-cadastro.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/060-sessao-anonima-de-cadastro.md) | ADR-060 — Fatia O-2: sessão anônima de cadastro (bootstrap seguro) |
| [adr/062-identidade-consentimento-cadastro.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/062-identidade-consentimento-cadastro.md) | ADR-062 — Identidade, consentimento e nome da clínica no cadastro |
| [adr/063-saude-de-envio-whatsapp.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/063-saude-de-envio-whatsapp.md) | ADR-063 — Saúde de envio da conta WhatsApp e a C14 com a conta bloqueada |
| [adr/064-c14-reenvio-por-geracao.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/064-c14-reenvio-por-geracao.md) | ADR-064 — C14 reenvia de verdade, com uma chave de envio por geração |
| [adr/065-validade-por-tipo-c14.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/065-validade-por-tipo-c14.md) | ADR-065 — Validade por tipo na fila C14 |
| [adr/066-janela-da-oferta-da-lista-de-espera.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/066-janela-da-oferta-da-lista-de-espera.md) | ADR-066 — A janela de resposta da oferta da lista de espera só corre nas horas de envio |

## Procedimentos específicos — conferir janela e autorização

| Arquivo | Assunto |
| --- | --- |
| [runbooks/aceitacao-humana-cadastro.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/runbooks/aceitacao-humana-cadastro.md) | Runbook — aceitação humana do cadastro autônomo |
| [runbooks/acoes-manuais-pendentes-pricing-2026-10.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/runbooks/acoes-manuais-pendentes-pricing-2026-10.md) | O que você precisa fazer — lançamento mensal do Qoro |
| [runbooks/alerting-setup.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/runbooks/alerting-setup.md) | Configuração de alertas |
| [runbooks/asaas-webhook-assinatura.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/runbooks/asaas-webhook-assinatura.md) | Runbook — webhook de assinatura (conta Asaas do Qoro) |
| [runbooks/backup-independente-sem-custo-2026-10.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/runbooks/backup-independente-sem-custo-2026-10.md) | Backup independente sem compra inicial — 30/10/2026 |
| [runbooks/backup-real-b2-bitwarden.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/runbooks/backup-real-b2-bitwarden.md) | Cópia real no B2 e senha no Bitwarden |
| [runbooks/c14-validation.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/runbooks/c14-validation.md) | Validação C14 — mensagens proativas |
| [runbooks/c2-validation.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/runbooks/c2-validation.md) | Validação C2 — tenancy e RLS |
| [runbooks/c4-validation.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/runbooks/c4-validation.md) | Validação C4 — outbox |
| [runbooks/c5-validation.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/runbooks/c5-validation.md) | Validação C5 — paciente e LGPD |
| [runbooks/c7-validation.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/runbooks/c7-validation.md) | Validação C7 — clínico |
| [runbooks/fechamento-operacional-oferta-2026-10.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/runbooks/fechamento-operacional-oferta-2026-10.md) | Fechamento operacional da oferta mensal — 30/10/2026 |
| [runbooks/incident-response.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/runbooks/incident-response.md) | Resposta a incidentes |
| [runbooks/log-search.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/runbooks/log-search.md) | Busca de logs |
| [runbooks/payment-account-connect.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/runbooks/payment-account-connect.md) | Runbook — conta de pagamento da clínica (Asaas) |
| [runbooks/publicacao-coordenada-oferta-2026-10.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/runbooks/publicacao-coordenada-oferta-2026-10.md) | Publicação coordenada da oferta 2026 — roteiro e registro da janela |
| [runbooks/publicacao-funil-codigo-2026-11.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/runbooks/publicacao-funil-codigo-2026-11.md) | Publicação e recuperação dos leads — cadastro por código |
| [runbooks/README.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/runbooks/README.md) | Runbooks |
| [runbooks/recuperacao-portavel-e-rotina-2026-10.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/runbooks/recuperacao-portavel-e-rotina-2026-10.md) | Recuperação portável e rotina de backup — preparação de 29/10 |
| [runbooks/runtime-role-nobypassrls.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/runbooks/runtime-role-nobypassrls.md) | Role runtime sem BYPASSRLS |
| [runbooks/validacao-nova-oferta-2026-10.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/runbooks/validacao-nova-oferta-2026-10.md) | Fechamento da nova oferta de preços — roteiro de implementação e validação |

## Especificações e planos — confrontar implementação

| Arquivo | Assunto |
| --- | --- |
| [specs/cadastro-codigo-e-retomada-2026-11.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/specs/cadastro-codigo-e-retomada-2026-11.md) | Cadastro por código e retomada — contrato de execução |
| [specs/decisoes-oferta-e-precificacao-2026-10.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/specs/decisoes-oferta-e-precificacao-2026-10.md) | Decisões de oferta, preço ao paciente e repasse — outubro de 2026 |
| [specs/politica-financeira-camadas.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/specs/politica-financeira-camadas.md) | Política financeira de cobranças de pacientes e repasse profissional |
| [specs/precos-2026-preview.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/specs/precos-2026-preview.md) | Prévia da oferta por médico — outubro de 2026 |

## Evidências datadas — não representam saúde atual

| Arquivo | Assunto |
| --- | --- |
| [achados/auditoria-monitoramento-producao.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/achados/auditoria-monitoramento-producao.md) | Auditoria de monitoramento |
| [achados/auditoria-seguranca-codigo.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/achados/auditoria-seguranca-codigo.md) | Auditoria de segurança do código |
| [achados/documentation-modernization-report.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/achados/documentation-modernization-report.md) | Modernização da documentação |
| [audits/C11_ADVERSARIAL_1_25.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/audits/C11_ADVERSARIAL_1_25.md) | C11 — Bateria adversarial (50 mensagens, Gemini REAL) |
| [audits/C11_ADVERSARIAL_17_17.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/audits/C11_ADVERSARIAL_17_17.md) | C11 — Bateria adversarial (50 mensagens, Gemini REAL) |
| [audits/C11_ADVERSARIAL_21_21.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/audits/C11_ADVERSARIAL_21_21.md) | C11 — Bateria adversarial (50 mensagens, Gemini REAL) |
| [audits/C11_ADVERSARIAL_22_22.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/audits/C11_ADVERSARIAL_22_22.md) | C11 — Bateria adversarial (50 mensagens, Gemini REAL) |
| [audits/C11_ADVERSARIAL_26_50.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/audits/C11_ADVERSARIAL_26_50.md) | C11 — Bateria adversarial (50 mensagens, Gemini REAL) |
| [audits/C11_ADVERSARIAL_28_28.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/audits/C11_ADVERSARIAL_28_28.md) | C11 — Bateria adversarial (50 mensagens, Gemini REAL) |
| [audits/C11_ADVERSARIAL_3_12.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/audits/C11_ADVERSARIAL_3_12.md) | C11 — Bateria adversarial (50 mensagens, Gemini REAL) |
| [audits/C11_ADVERSARIAL_3_29.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/audits/C11_ADVERSARIAL_3_29.md) | C11 — Bateria adversarial (50 mensagens, Gemini REAL) |
| [audits/C11_ADVERSARIAL_3_50.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/audits/C11_ADVERSARIAL_3_50.md) | C11 — Bateria adversarial (50 mensagens, Gemini REAL) |
| [audits/C11_ADVERSARIAL_30_30.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/audits/C11_ADVERSARIAL_30_30.md) | C11 — Bateria adversarial (50 mensagens, Gemini REAL) |
| [audits/C11_ADVERSARIAL_31_50.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/audits/C11_ADVERSARIAL_31_50.md) | C11 — Bateria adversarial (50 mensagens, Gemini REAL) |
| [audits/C11_ADVERSARIAL_50.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/audits/C11_ADVERSARIAL_50.md) | Gate adversarial C11 |
| [audits/C12_AI_AGENT_AUDIT_2026-08-14.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/audits/C12_AI_AGENT_AUDIT_2026-08-14.md) | Auditoria C12 — 2026-08-14 |
| [c16/c16-inventory.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/c16/c16-inventory.md) | Inventário operacional C16 |
| [c16/slo.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/c16/slo.md) | SLOs e indicadores |
| [evidence/track-o-revalidacao-2026-09-21.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/evidence/track-o-revalidacao-2026-09-21.md) | Track O — revalidação independente e correções de 21/09/2026 |
| [evidence/track-o.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/evidence/track-o.md) | Track O — matriz de evidência |
| [quality/aceite-risco-backup-2026-10-30.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/aceite-risco-backup-2026-10-30.md) | Aceite do founder — backup independente adiado |
| [quality/admin-cadastros-e-trial-2026-11-03.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/admin-cadastros-e-trial-2026-11-03.md) | Admin: contas autônomas, trial e regressão — 03/11/2026 |
| [quality/agendamento-continuidade-2026-11-04.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/agendamento-continuidade-2026-11-04.md) | Continuidade do atendimento e prontidão de cobrança |
| [quality/asaas-plan-change-2026-10-17.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/asaas-plan-change-2026-10-17.md) | Troca de plano SaaS e cobrança recorrente — 17/10/2026 |
| [quality/auditoria-compatibilidade-oferta-2026-10-27.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/auditoria-compatibilidade-oferta-2026-10-27.md) | Oferta 2026 — auditoria de compatibilidade e proteção dos contratos antigos |
| [quality/auditoria-funil-cadastro-2026-11-03.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/auditoria-funil-cadastro-2026-11-03.md) | Auditoria do funil de cadastro — 03/11/2026 |
| [quality/auditoria-integral-execucao.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/auditoria-integral-execucao.md) | Auditoria integral — execução de 28/09/2026 |
| [quality/cadastro-senha-post-2026-11-04.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/cadastro-senha-post-2026-11-04.md) | Proteção do formulário de primeira senha — 04/11/2026 |
| [quality/cadastro-senha-unica-2026-10-31.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/cadastro-senha-unica-2026-10-31.md) | Cadastro: senha após confirmação e continuação clara |
| [quality/checkout-clique-unico-2026-11-04.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/checkout-clique-unico-2026-11-04.md) | Cadastro: continuar para o checkout com um clique |
| `quality/confirmacao-email-logo-2026-11-05.md` | Logo no e-mail de confirmação — 05/11/2026 |
| [quality/contas-novas-e-legadas-2026-10-26.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/contas-novas-e-legadas-2026-10-26.md) | Oferta 2026 — conta nova versus contratos legados |
| [quality/e2e-75-files-inventory.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/e2e-75-files-inventory.md) | Inventario do checkpoint original de 75 arquivos |
| [quality/e2e-coverage-audit.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/e2e-coverage-audit.md) | Auditoria de cobertura E2E |
| [quality/e2e-coverage-matrix.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/e2e-coverage-matrix.md) | Matriz de cobertura E2E |
| [quality/entitlements-clinica-2026-10-29.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/entitlements-clinica-2026-10-29.md) | Exclusividade dos recursos da Clínica — 29/10/2026 |
| [quality/fechamento-definitivo-oferta-2026-10-30.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/fechamento-definitivo-oferta-2026-10-30.md) | Fechamento da engenharia da oferta — 30/10/2026 |
| [quality/fechamento-oferta-2026-10-28.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/fechamento-oferta-2026-10-28.md) | Fechamento técnico da oferta — 28/10/2026 |
| [quality/finalizacao-oferta-2026-10-26.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/finalizacao-oferta-2026-10-26.md) | Oferta 2026 — checkpoint de integração de 26/10/2026 |
| [quality/gates-tecnicos-oferta-2026-10-29.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/gates-tecnicos-oferta-2026-10-29.md) | Gates finais da oferta mensal — 29/10/2026 |
| [quality/integracao-2026-10-09.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/integracao-2026-10-09.md) | Integração isolada de 09/10/2026 |
| `quality/organizacao-mintlify-2026-11-05.md` | Organização técnica da documentação com Mintlify — 05/11/2026 |
| [quality/preview-pricing-integration-e2e-2026-10-18.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/preview-pricing-integration-e2e-2026-10-18.md) | E2E do Preview integrado — 18/10/2026 |
| [quality/production-44-execution.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/production-44-execution.md) | Execução das 44 suítes production-* — 29/09–01/10/2026 |
| [quality/prontidao-oferta-2026-10-25.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/prontidao-oferta-2026-10-25.md) | Prontidão da oferta 2026 — medição de 25–26/10/2026 |
| [quality/publicacao-oferta-2026-10-30.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/publicacao-oferta-2026-10-30.md) | Janela autorizada da oferta mensal — 30/10/2026 |
| [quality/validacao-autonoma-2026-10-21.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/validacao-autonoma-2026-10-21.md) | Validação autônoma do candidato da nova oferta — 21/10/2026 |
| [quality/verificacao-turnstile-2026-10-30.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/verificacao-turnstile-2026-10-30.md) | Verificação real de Turnstile antes da reabertura |
| [quality/waba-readback-2026-10-10.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/waba-readback-2026-10-10.md) | WABA de teste após cadastrar pagamento — leitura de 10/10/2026 |
| [quality/whatsapp-ai-hardening-2026-10-08.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/whatsapp-ai-hardening-2026-10-08.md) | Hardening do agente de IA do WhatsApp — 08/10/2026 |

## Histórico e checkpoints preservados

| Arquivo | Assunto |
| --- | --- |
| [archive/evidence-snapshots.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/archive/evidence-snapshots.md) | Evidências históricas preservadas |
| [desing_novo.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/desing_novo.md) | Novo Design System / UI UX — Qoro (ClinicaOS) |
| [discovery-log.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/discovery-log.md) | Discovery Log |
| [handoff-meta-embedded-signup.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/handoff-meta-embedded-signup.md) | Handoff — D78 / Meta WhatsApp Embedded Signup |
| [handoff-qorov2.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/handoff-qorov2.md) | Handoff histórico — execução do Qoro v2 até 06/09/2026 |
| [handoff-track-o-2026-09-18.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/handoff-track-o-2026-09-18.md) | Track O — handoff de execução de 18/09/2026 |
| [handoff-track-o-final.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/handoff-track-o-final.md) | Track O — handoff final (reconciliado em 25/09/2026) |
| [qorov2.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/qorov2.md) | Qoro v2 — Plano de Execução em Camadas (staff/principal, produção paga) |

## Referências complementares do repositório

| Arquivo | Assunto |
| --- | --- |
| [contracts/events/billing.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/contracts/events/billing.md) | Eventos de billing |
| [design/BASELINE-INVENTORY.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/design/BASELINE-INVENTORY.md) | Baseline Inventory — GATE 0 |
| [design/COMPONENT-DECISIONS.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/design/COMPONENT-DECISIONS.md) | Component Decisions |
| [design/CONTRACT.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/design/CONTRACT.md) | Design System Contract |
| [design/PREVIEW-SAFETY.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/design/PREVIEW-SAFETY.md) | Preview Safety Gate — GATE 1 |
| [design/TENANT-HTML-2026-09.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/design/TENANT-HTML-2026-09.md) | UI tenant — referências HTML de setembro de 2026 |
| [security/endurecimento-local.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/security/endurecimento-local.md) | Endurecimento local — 2026-09-10 |
| [security/ia-privacidade.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/security/ia-privacidade.md) | ia-privacidade.md |
| [security/revisao-intermediaria-2026-09-14.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/security/revisao-intermediaria-2026-09-14.md) | Revisão intermediária do Qoro v2 — 14/09/2026 |
| [security/riscos.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/security/riscos.md) | Registro de risco — endurecimento local |
| [security/SECURITY-DELTA.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/security/SECURITY-DELTA.md) | SECURITY-DELTA — auditoria adversarial × código real |
| [security/webhooks.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/security/webhooks.md) | Entradas externas: evidência local e correção |

## Índices anteriores e pontes de compatibilidade

| Arquivo | Assunto |
| --- | --- |
| [adr/README.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/README.md) | Decisões arquiteturais |
| [AUDITORIA_C0_C10_COMPLETA.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/AUDITORIA_C0_C10_COMPLETA.md) | Auditoria C0–C10 |
| [contracts/README.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/contracts/README.md) | Contratos |
| [CONVENTIONS.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/CONVENTIONS.md) | Convenções de engenharia |
| [CURRENT-STATE.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/CURRENT-STATE.md) | Estado da implementação |
| [design/refs/README.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/design/refs/README.md) | Referências visuais |
| [onboarding-spec.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/onboarding-spec.md) | Cadastro e convites |
| [PROGRESS.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/PROGRESS.md) | Progresso do sistema |
| [README.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/README.md) | Documentação técnica do Qoro |
| [security/README.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/security/README.md) | Segurança do Qoro — o que foi feito, como, e o que falta |
| [testesC15.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/testesC15.md) | Evidência C15 — plataforma admin |
| [VisãoGeral.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/Vis%C3%A3oGeral.md) | Arquitetura do Qoro |

## Inventário gerado — não editar manualmente

| Arquivo | Assunto |
| --- | --- |
| [security/acoes.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/security/acoes.md) | Inventário vivo de Server Actions, handlers e ambiente |

## Prompts e instruções de tarefas anteriores

| Arquivo | Assunto |
| --- | --- |
| [prompts/auditoria-integral-testes-e2e-sem-whatsapp.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/prompts/auditoria-integral-testes-e2e-sem-whatsapp.md) | Prompt — auditoria integral, execução e ampliação dos testes do Qoro |
| [prompts/retomada-politica-financeira-2026-10-07.md](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/prompts/retomada-politica-financeira-2026-10-07.md) | Retomada QoroV2 — política financeira e validação 2e2 |

## Ferramentas locais da documentação

| Arquivo | Assunto |
| --- | --- |
| `tooling/catalog.mjs` | catalog.mjs |
| `tooling/catalog.test.mjs` | catalog.test.mjs |

## Diagramas, configurações e arquivos de apoio

| Arquivo | Assunto |
| --- | --- |
| [architecture/arch-metrics.json](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/architecture/arch-metrics.json) | arch-metrics.json |
| [architecture/context-map.mmd](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/architecture/context-map.mmd) | context-map.mmd |
| [architecture/dependency-graph.mmd](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/architecture/dependency-graph.mmd) | dependency-graph.mmd |
| [architecture/event-flow.mmd](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/architecture/event-flow.mmd) | event-flow.mmd |
| `assets/qoro-icon.svg` | qoro-icon.svg |
| `assets/qoro-logo-dark.svg` | qoro-logo-dark.svg |
| `assets/qoro-logo.svg` | qoro-logo.svg |
| [design/refs/agenda.jpg](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/design/refs/agenda.jpg) | agenda.jpg |
| [design/refs/caixa.jpg](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/design/refs/caixa.jpg) | caixa.jpg |
| [design/refs/consultorio.jpg](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/design/refs/consultorio.jpg) | consultorio.jpg |
| [design/refs/conversas-ia.jpg](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/design/refs/conversas-ia.jpg) | conversas-ia.jpg |
| [design/refs/dashboard.jpg](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/design/refs/dashboard.jpg) | dashboard.jpg |
| [design/refs/documentos.jpg](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/design/refs/documentos.jpg) | documentos.jpg |
| [design/refs/financeiro.jpg](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/design/refs/financeiro.jpg) | financeiro.jpg |
| [design/refs/pacientes.jpg](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/design/refs/pacientes.jpg) | pacientes.jpg |
| `docs.json` | docs.json |
| [quality/evidencias/b2-pilot-preflight-20261030.json](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/evidencias/b2-pilot-preflight-20261030.json) | b2-pilot-preflight-20261030.json |
| [quality/evidencias/b2-pilot-roundtrip-20261030.json](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/evidencias/b2-pilot-roundtrip-20261030.json) | b2-pilot-roundtrip-20261030.json |
| [quality/evidencias/offer-release-readback-20261030.json](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/evidencias/offer-release-readback-20261030.json) | offer-release-readback-20261030.json |
| [quality/evidencias/offer-restored-backup-20261030.json](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/evidencias/offer-restored-backup-20261030.json) | offer-restored-backup-20261030.json |
| [quality/evidencias/offer-schema-diff-20261030.json](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/evidencias/offer-schema-diff-20261030.json) | offer-schema-diff-20261030.json |
| [quality/evidencias/publicacao-oferta-20261030.json](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/evidencias/publicacao-oferta-20261030.json) | publicacao-oferta-20261030.json |
| [quality/evidencias/recovery-capacity-20261030.json](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/evidencias/recovery-capacity-20261030.json) | recovery-capacity-20261030.json |
| [quality/evidencias/signup-code-dev-migration-20261104.json](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/evidencias/signup-code-dev-migration-20261104.json) | signup-code-dev-migration-20261104.json |
| [quality/evidencias/signup-preview-funnel-20261104.json](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/evidencias/signup-preview-funnel-20261104.json) | signup-preview-funnel-20261104.json |
| [quality/evidencias/turnstile-browser-diagnostic-20261030.json](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/quality/evidencias/turnstile-browser-diagnostic-20261030.json) | turnstile-browser-diagnostic-20261030.json |
| [security/ia-privacidade-tests.json](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/security/ia-privacidade-tests.json) | ia-privacidade-tests.json |
| [security/inventory-before.json](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/security/inventory-before.json) | inventory-before.json |
