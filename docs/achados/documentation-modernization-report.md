# Relatório — Modernização da Documentação (Passos 1 e 2)

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2026-10-01
>
> ↩︎ Volta para o [índice mestre](../README.md).

Relatório da modernização da documentação de **2026-07-01**. Abordagem escolhida: **Preservar + Indexar** (não mover o sistema camada/ADR/runbook existente; adicionar porta de entrada, trilhas e governança). Executada em duas levas: **Passo 1 (Fundação)** e **Passo 2 (fechamento: dívidas + DoD + conformidade de ADR + changelog + retrofit de frescor)**.

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

**Criados (Passo 2):** `engineering/definition-of-done.md`, `adr-conformance.md`, `CHANGELOG.md` (raiz), `.github/workflows/adr-check.yml`.

**Restaurados (Passo 2):** `docs/testesC15.md`, `docs/AUDITORIA_C0_C10_COMPLETA.md` (de `88829ce~1`).

**Alterados (Passo 2, aditivo):** CI para Node 22; cabeçalho de frescor em `CONVENTIONS`, `PROGRESS`, `PlanoAção`, `contracts/*`, `c16/*`, `runbooks/*` e índices.

**Removidos:** nenhum. Princípio da leva: preservar. Docs velhos viram `Histórico`, nunca `rm` — inclusive os 2 restaurados.

---

## 5. Passo 2 — o que foi feito

- **A1 (resolvido):** `testesC15.md` e `AUDITORIA_C0_C10_COMPLETA.md` **restaurados** de `88829ce~1` (deletados por engano num commit de onboarding). `app-shell.tsx` = referência histórica em ADR-018 append-only (correta para a época; não se edita ADR).
- **A3 (resolvido):** CI alinhado para Node 22.
- **DoD completa:** `engineering/definition-of-done.md`.
- **Conformidade de ADR:** `adr-conformance.md` (30/30 com Context/Decision/Consequences; recomendações para os futuros).
- **Changelog:** `CHANGELOG.md` na raiz.
- **Check de CI advisory:** `.github/workflows/adr-check.yml` (aviso não-bloqueante "arch sem ADR").
- **Retrofit de frescor:** cabeçalho aplicado a `CONVENTIONS`, `PROGRESS`, `PlanoAção`, `contracts/*`, `c16/*`, **todos** os `runbooks/*` e os índices — ver [documentation-lifecycle.md](../documentation-lifecycle.md) §5.

## 6. Dívidas restantes (menores)

- **Freshness opcional:** `VisãoGeral.md`, `onboarding-spec.md`, `whatsapp-connection-flow.md`, `secret-rotation.md` (têm cabeçalho próprio) e os arquivos individuais de `audits/`·`remediation/`·`implementation/` — recebem o cabeçalho ao serem tocados.
- **Check de ADR bloqueante:** hoje é advisory; endurecer para falhar o CI é decisão futura.
- **Hub pages** de `product/`/`security/` e migração física para a árvore genérica — **só se** pedido; hoje esses domínios têm dono existente (CONVENTIONS, runbooks, ADRs).

---

## Veja também

- [../documentation-audit.md](../documentation-audit.md) — o inventário que embasou este relatório.
- [../README.md](../README.md) — índice mestre.
- [../documentation-lifecycle.md](../documentation-lifecycle.md) · [../documentation-authority.md](../documentation-authority.md) — a governança instituída.
