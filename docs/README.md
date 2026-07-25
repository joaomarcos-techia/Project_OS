# Documentação do Qoro — porta de entrada

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-23
>
> 🎯 Teste de sucesso: *"uma pessoa nova entende o sistema e acha o que ler para uma tarefa, sem abrir os 100+ arquivos."*

> ⚙️ **Reestruturação em andamento (2026-07-23).** A base está sendo reorganizada em ondas. Alguns links
> para `domains/`, `security/` e `operations/` só resolvem conforme as ondas avançam. Fonte da verdade
> sobre o estado atual: **[CURRENT-STATE.md](./CURRENT-STATE.md)**.

---

## O que é o Qoro

SaaS multi-tenant para clínicas pequenas (psicologia, nutrição, estética, consultórios): agenda,
prontuário, consultório (kanban), financeiro, cobrança (você cobra as clínicas via Asaas) e um agente de
IA que atende no WhatsApp. Arquitetura: **bounded contexts isolados** sobre Postgres/Supabase com **RLS**,
single deploy no Vercel. Detalhe em [architecture/overview.md](./architecture/overview.md).

## Como esta documentação funciona

| Você quer saber… | Vá para |
|---|---|
| **O que existe hoje** (estado atual) | [CURRENT-STATE.md](./CURRENT-STATE.md) |
| **Por que foi decidido assim** (decisões) | [adr/](./adr/) + [adr/README.md](./adr/README.md) (índice de status) |
| **Regras de código** (naming, imports, RLS, threat model) | [CONVENTIONS.md](./CONVENTIONS.md) |
| **Qual doc vence num conflito** | [governance/authority.md](./governance/authority.md) |

### Hierarquia de autoridade (resumo)

```
Código/Banco/Testes  →  ADRs  →  CONVENTIONS  →  CURRENT-STATE/architecture/domains/security/operations  →  planning/  →  history/
   (o que existe)     (decisão)   (regras)                (estado atual descrito)                          (futuro)   (passado)
```
Código diz **o que existe**; ADR diz **o que foi decidido**. Divergência entre eles se **classifica**,
não se resolve automaticamente — ver [governance/authority.md](./governance/authority.md).

## Mapa por intenção — "o que ler para a tarefa X"

| Vou mexer em… | Leia (nesta ordem) |
|---|---|
| 🏛️ Arquitetura geral | [architecture/overview.md](./architecture/overview.md) · [architecture/context-map.md](./architecture/context-map.md) |
| 🔐 Auth / identidade / sessão | `domains/identity.md` · ADR-008/032/037/038/039/040/041 |
| 🏢 Multi-tenant / RLS | ADR-002/007/042/041 · [CONVENTIONS.md](./CONVENTIONS.md) (Threat Model) |
| 💳 Billing / planos / cobrança | `domains/billing.md` · ADR-024/025 · [contracts/events/billing.md](./contracts/events/billing.md) |
| 🗓️ Agenda / scheduling | `domains/scheduling.md` · ADR-014 |
| 🩺 Prontuário / clínico / receituário | `domains/clinical.md` · ADR-012/013/017/021/044 |
| 💬 WhatsApp / mensageria | `domains/messaging.md` · ADR-004/020/043 · [whatsapp-connection-flow.md](./whatsapp-connection-flow.md) |
| 🤖 Agente de IA | `domains/ai-agent.md` · ADR-022/023/026/047 |
| 🛠️ Platform Admin (`/admin`) | `domains/platform-admin.md` · ADR-028 |
| 🔒 Segurança / LGPD / cripto | `security/` · ADR-012/030/044 |
| 🚨 Operação / incidentes / observabilidade | `operations/` (runbooks + observability) |
| 🧑‍💻 Rodar o projeto | [development/setup.md](./development/setup.md) · [development/environment.md](./development/environment.md) · [development/onboarding.md](./development/onboarding.md) |
| 🌱 O que ainda **não** existe (planos) | `planning/` |

## Processo de engenharia

[engineering/git-workflow.md](./engineering/git-workflow.md) · [decision-guide.md](./engineering/decision-guide.md)
("isto precisa de ADR/migration/evento?") · [definition-of-done.md](./engineering/definition-of-done.md) ·
[ai-development.md](./engineering/ai-development.md) (trabalhar com Claude Code + Documentação Automática).

## Governança da doc
[governance/authority.md](./governance/authority.md) (quem vence) · [governance/lifecycle.md](./governance/lifecycle.md)
(status, exclusão, fontes) · [governance/doc-audit.md](./governance/doc-audit.md) (inventário code-verified).

## Convenção de ícones
🔒 decisão permanente · 🔓 temporária · ⚠️ armadilha conhecida · 💡 insight de experiência · 📌 onde "o eu do futuro" tende a se ferrar.
