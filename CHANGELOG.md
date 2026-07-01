# Changelog

Todas as mudanças notáveis do ClinicaOS. Formato baseado em
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

Este changelog registra **o que muda de comportamento visível** por entrega. O log
detalhado, camada a camada (contratos congelados, defesas validadas, débitos), vive em
[docs/PROGRESS.md](./docs/PROGRESS.md) — a autoridade sobre o estado de cada camada.

> Convenção: toda mudança de comportamento visível atualiza este arquivo na seção
> `[Unreleased]` (parte da [Definition of Done](./docs/engineering/definition-of-done.md)).
> O projeto ainda não versiona releases (`package.json` = 0.0.0); entradas históricas
> usam a data de fechamento da camada.

## [Unreleased]

### Adicionado
- **Documentação como sistema de conhecimento** (modernização, Passo 1+2): índice mestre
  (`docs/README.md`), governança (`documentation-authority`/`lifecycle`/`audit`), onboarding
  de dev (`development/*` + `.env.example`), `architecture/context-map`, processo de
  engenharia (`engineering/git-workflow`/`ai-development`/`decision-guide`/`definition-of-done`),
  templates de PR/issue, este `CHANGELOG.md` e a auditoria de conformidade dos ADRs.
  Ver [relatório](./docs/achados/documentation-modernization-report.md).

### Corrigido
- `.gitignore` deixava de versionar `.env.example` (template sem segredos) — destravado.
- CI alinhado ao runtime (Node 20 → 22, `package.json engines`).
- Restaurados 2 docs históricos deletados por engano em `88829ce`
  (`docs/testesC15.md`, `docs/AUDITORIA_C0_C10_COMPLETA.md`).

---

## Histórico por camada (fechamentos)

Resumo; detalhe completo em [docs/PROGRESS.md](./docs/PROGRESS.md).

- **2026-06-20 — C15 Platform Admin**: painel `/admin` (404-absoluto, impersonate auditado, step-up MFA, export PDF).
- **2026-06-18 — C14 Proactive Jobs**: lembrete D-1 + dunning + follow-up (cron determinístico + IA interpreta resposta).
- **2026-06-17 — C13 Tenancy & Billing**: planos + Asaas (webhook verificado em prod).
- **2026-06-15 — C12 AI Agent Intents**: ator de sistema `ai_agent` + tools.
- **2026-06-11 — C11 AI Agent Base**: Gemini, saga LLM-fora-de-TX, guards anti-SAMD (gate adversarial 50/50).
- **2026-06-07 — C10 Messaging + Webhook Meta** e **C9 Financial Core** (faturamento automático + Caixa).
- **2026-06-03 — C7 Clinical** (prontuário/prescrição/PDFs) e **C8 Consultório UI**.
- **2026-05-31 — C6 Scheduling Core**: agenda, slots, state machine, anti-overlap.
- **2026-05-30 — C5 Patient**: encryption per-tenant + LGPD export/delete.
- **2026-05-29 — C4 Outbox + Audit + Idempotency** (production-grade).
- **2026-05-28 — C3 Identity/Auth/Claims/RBAC** e **C2 Multi-Tenant + RLS**.
- **2026-05-26 — C1 Banco + Drizzle + Migrations** e **C0 Fundação do Repositório**.
- **Pós-camadas**: receituário de controle especial (Fase 1), UI (agenda/config/documentos/relatórios), onboarding via convite mágico, observabilidade C16 (Ondas 0–4).

[Unreleased]: https://github.com/
