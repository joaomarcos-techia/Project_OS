# Relatório — Modernização da Documentação (Passo 1: Fundação)

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2026-10-01
>
> ↩︎ Volta para o [índice mestre](../README.md).

Relatório da leva de modernização da documentação de **2026-07-01**. Abordagem escolhida: **Preservar + Indexar** (não mover o sistema camada/ADR/runbook existente; adicionar porta de entrada, trilhas e governança).

---

## 1. Estado anterior

A `docs/` já era um sistema de conhecimento **maduro** — `VisãoGeral.md` (fonte-da-verdade), `CONVENTIONS.md` (lei viva), `PlanoAção.md` + `PROGRESS.md`, e três subsistemas **já indexados** (`adr/` 30 ADRs, `runbooks/` 25+, `c16/`). O problema **não** era desorganização de conteúdo.

### Problemas encontrados

| # | Problema | Severidade |
|---|---|---|
| P1 | Sem `docs/README.md` — nenhuma porta de entrada; só achava quem já sabia | Alta |
| P2 | Sem onboarding/setup de **desenvolvedor** (o `onboarding-spec.md` é feature de produto) | Alta |
| P3 | Context map só em prosa, não como artefato | Média |
| P4 | Processo de engenharia (branches/commits/PR) implícito, sem doc único | Média |
| P5 | `README.md` raiz era stub ("Project_OS"); `.github/` sem PR/issue templates | Baixa |
| P6 | Pastas `implementation/`, `audits/`, `remediation/`, `contracts/` sem índice | Baixa |
| P7 | Sem padrão de frescor nem regra de fonte-da-verdade explícita | Média |
| A1 | Referência quebrada: `docs/testesC15.md` citado mas inexistente | Média |
| A2 | `.env.example` ausente apesar de `env.ts` referenciá-lo | Média |
| A3 | CI em Node 20, runtime exige 22.x | Baixa |

---

## 2. Mudanças feitas

- **Porta de entrada:** `docs/README.md` (índice mestre por intenção) + `README.md` raiz reescrito.
- **Governança viva:** `documentation-authority.md` (fonte da verdade), `documentation-lifecycle.md` (frescor: Status/Owner/revisão), `documentation-audit.md` (inventário classificado).
- **Onboarding de dev:** `development/setup.md`, `environment.md`, `onboarding.md` (trilha Dia 1/2/3) + **`.env.example` criado** a partir de `src/lib/env.ts` (resolve A2).
- **Arquitetura navegável:** `architecture/context-map.md` (8 contexts + fluxo de eventos, Mermaid).
- **Processo de engenharia:** `engineering/git-workflow.md`, `ai-development.md` (Claude Code + Documentação Automática), `decision-guide.md` (fluxo "precisa de ADR?").
- **GitHub tooling:** `.github/pull_request_template.md` + `ISSUE_TEMPLATE/{bug_report,feature_request}.md`.
- **Índices das pastas soltas:** `implementation/`, `audits/`, `remediation/`, `contracts/` (desambiguam ativo × histórico, sem mover arquivos).
- **Interligação aditiva:** blocos "Veja também" em `VisãoGeral.md`, `CONVENTIONS.md`, `PROGRESS.md`, `adr/README.md`, `runbooks/README.md`.

### Regra permanente instituída
**Documentação Automática** ([engineering/ai-development.md](../engineering/ai-development.md#documentação-automática)): toda mudança documenta a si mesma no lugar certo (ADR / CONVENTIONS / PROGRESS / contrato / comentário WHY / commit). Reforçada por commits `docs:` e pela regra dura **"mudança arquitetural sem ADR = bloqueada"** no [git-workflow](../engineering/git-workflow.md), e refletida no template de PR.

---

## 3. Nova estrutura

```
docs/
├── README.md                     ← porta de entrada (NOVO)
├── documentation-authority.md    ← fonte da verdade (NOVO)
├── documentation-lifecycle.md    ← frescor (NOVO)
├── documentation-audit.md        ← inventário (NOVO)
├── VisãoGeral.md · CONVENTIONS.md · PlanoAção.md · PROGRESS.md   (preservados)
├── architecture/  → context-map.md (NOVO)
├── development/   → setup · environment · onboarding (NOVO)
├── engineering/   → git-workflow · ai-development · decision-guide (NOVO)
├── adr/ · runbooks/ · c16/ · contracts/   (preservados; +README onde faltava)
├── implementation/ · audits/ · remediation/   (preservados; +README de índice)
└── achados/       → este relatório (NOVO)
.github/           → pull_request_template.md + ISSUE_TEMPLATE/ (NOVO)
.env.example       → (NOVO, na raiz)
README.md          → reescrito (raiz)
```

---

## 4. Documentos criados / alterados / removidos

**Criados (17 docs + 3 tooling):** `docs/README.md`, `documentation-authority.md`, `documentation-lifecycle.md`, `documentation-audit.md`, `development/{setup,environment,onboarding}.md`, `architecture/context-map.md`, `engineering/{git-workflow,ai-development,decision-guide}.md`, `implementation/README.md`, `audits/README.md`, `remediation/README.md`, `contracts/README.md`, `achados/documentation-modernization-report.md` · `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/{bug_report,feature_request}.md` · `.env.example`.

**Alterados (aditivo):** `README.md` (raiz), `VisãoGeral.md`, `CONVENTIONS.md`, `PROGRESS.md`, `adr/README.md`, `runbooks/README.md` (só blocos "Veja também" no fim).

**Removidos:** nenhum. Princípio da leva: preservar. Docs velhos viram `Histórico`, nunca `rm`.

---

## 5. Dívidas restantes

- **A1** — recriar `docs/testesC15.md` (aceite de C15) ou remover a referência.
- **A3** — alinhar CI para Node 22 (`.github/workflows/ci.yml`).
- **Freshness backlog** — cabeçalho de Status/revisão ainda não aplicado a `VisãoGeral`, `CONVENTIONS`, `PROGRESS`, `PlanoAção`, `runbooks/*`, `c16/*`, `contracts/*` (entram conforme forem tocados — ver [documentation-lifecycle.md](../documentation-lifecycle.md) §5).

---

## 6. Próximas melhorias (Passo 2)

- `engineering/definition-of-done.md` completa (a parte documental já vale).
- Hub pages de `product/` e `security/` (se o volume justificar).
- Check de CI: "PR tocou `src/contexts`/`drizzle/migrations` sem ADR/CONVENTIONS" → falha (materializa a regra dura).
- Auditoria profunda de interligação entre os 30 ADRs.
- Retrofit do cabeçalho de frescor nos docs canônicos restantes.
- Migração física para a árvore genérica (`product/`, `security/`, `operations/`, `api/`, `database/`) — **só se** pedido; hoje esses domínios têm dono existente (CONVENTIONS, runbooks, ADRs).

---

## Veja também

- [../documentation-audit.md](../documentation-audit.md) — o inventário que embasou este relatório.
- [../README.md](../README.md) — índice mestre.
- [../documentation-lifecycle.md](../documentation-lifecycle.md) · [../documentation-authority.md](../documentation-authority.md) — a governança instituída.
