# Auditoria da Documentação — ClinicaOS

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice mestre](./README.md).

Inventário classificado de **toda** a documentação do repositório, feito na modernização de 2026-07-01 ([relatório](./achados/documentation-modernization-report.md)). Objetivo: separar o que é **fonte da verdade atual** do que é **contexto histórico**, e expor problemas concretos.

**Classificação** (ver [documentation-lifecycle.md](./documentation-lifecycle.md) §2 para o vocabulário de status):

- **Core** — fonte da verdade viva. Mantido revisado.
- **Histórico** — foi verdade num momento; serve de contexto, não de estado atual. Preservado, não editado.
- **Obsoleto** — não representa mais o sistema. (Nenhum encontrado — nada foi apagado.)
- **Duplicado** — informação repetida sem dono. (Nenhum conflito real — ver §5.)
- **Conflitante** — decisões divergentes entre docs. (Nenhum aberto — ver §5.)

**Veredito geral:** a base é madura e coesa. O problema **não** era desorganização de conteúdo, e sim **falta de porta de entrada e de trilhas** (resolvido nesta leva) + alguns **achados pontuais** (§4).

---

## 1. Núcleo — fonte da verdade (Core)

| Arquivo | Tipo | Objetivo | Classificação |
|---|---|---|---|
| [VisãoGeral.md](./VisãoGeral.md) | Visão/arquitetura | Fonte-da-verdade de produto + arquitetura + estratégia (2.539 linhas) | **Core** |
| [CONVENTIONS.md](./CONVENTIONS.md) | Regras | Lei viva: naming, imports/boundaries, RLS, threat model, templates de PR | **Core** |
| [PlanoAção.md](./PlanoAção.md) | Execução | Plano de implementação camada a camada (C0–C16), 267 KB | **Core** |
| [PROGRESS.md](./PROGRESS.md) | Estado | Status oficial de cada camada (C0–C16) | **Core** |
| [adr/](./adr/) (000–030 + README) | Decisões | 30 ADRs append-only + índice governado | **Core** |
| [runbooks/](./runbooks/) (25+ + README) | Operação | Procedimentos operacionais + índice | **Core** |
| [c16/](./c16/) (README, inventory, slo) | Operação | Observabilidade/hardening — inventário e SLOs | **Core** |
| [contracts/events/billing.md](./contracts/events/billing.md) | Contrato | Contrato de eventos de billing | **Core** |
| [onboarding-spec.md](./onboarding-spec.md) | Spec de produto | Spec da feature de onboarding de clínicas (backlog demand-triggered) | **Core** ⚠️ ver §4 |
| [whatsapp-connection-flow.md](./whatsapp-connection-flow.md) | Handoff/feature | Fluxo self-service de conexão do WhatsApp (Fase 2) | **Core** (reference) |

### Governança da doc (criados nesta leva — Core)

| Arquivo | Objetivo |
|---|---|
| [README.md](./README.md) | Índice mestre — a porta de entrada |
| [documentation-authority.md](./documentation-authority.md) | Ordem da fonte da verdade |
| [documentation-lifecycle.md](./documentation-lifecycle.md) | Padrão de frescor |
| este arquivo | Auditoria/inventário |
| [architecture/context-map.md](./architecture/context-map.md) | Mapa dos bounded contexts |
| [development/setup.md](./development/setup.md), [environment.md](./development/environment.md), [onboarding.md](./development/onboarding.md) | Onboarding de dev |
| [engineering/git-workflow.md](./engineering/git-workflow.md), [ai-development.md](./engineering/ai-development.md), [decision-guide.md](./engineering/decision-guide.md) | Processo de engenharia |

---

## 2. Registro histórico (Histórico — preservar, não editar)

| Arquivo | Tipo | Objetivo | Classificação |
|---|---|---|---|
| [audits/C11_IMPLEMENTATION_AUDIT.md](./audits/C11_IMPLEMENTATION_AUDIT.md) | Auditoria | Auditoria de implementação do AI Agent (C11) | **Histórico** |
| [audits/C11_ADVERSARIAL_50.md](./audits/C11_ADVERSARIAL_50.md) | Auditoria | 50 mensagens adversariais contra o agente (gate §11.12) | **Histórico** |
| [remediation/REMEDIACAO_FORENSE_C0_C10.md](./remediation/REMEDIACAO_FORENSE_C0_C10.md) | Remediação | Remediação forense pós-C10 | **Histórico** |
| [implementation/C13-BILLING-REPORT.md](./implementation/C13-BILLING-REPORT.md) | Relatório | Relatório de fechamento de billing (C13) | **Histórico** |
| [implementation/relatorio-pendencias-painel.md](./implementation/relatorio-pendencias-painel.md) | Relatório datado | Snapshot de pendências do painel (2026-06-28) | **Histórico** |

---

## 3. Planos/specs de follow-up (Core — ativos, não implementados)

Vivem em `implementation/` mas são **planos ativos**, não histórico. Cabeçalhos declaram o status.

| Arquivo | Status declarado | Classificação |
|---|---|---|
| [implementation/plano-receituario-e-painel-medico.md](./implementation/plano-receituario-e-painel-medico.md) | "plano executável (não implementado)" — Fase 1 já em branch | **Core** (ativo) |
| [implementation/prescricao-psiquiatria.md](./implementation/prescricao-psiquiatria.md) | "proposta (não implementada)" | **Core** (ativo) |
| [implementation/admin-config-expansion.md](./implementation/admin-config-expansion.md) | "proposta (não implementada)" | **Core** (ativo) |

📌 A pasta `implementation/` **mistura** relatórios históricos (§2) com planos ativos (§3). O [README da pasta](./implementation/README.md) desambigua isso sem mover arquivos.

---

## 4. Achados (problemas concretos)

| # | Achado | Onde | Severidade | Ação sugerida |
|---|---|---|---|---|
| A1 | **Referências quebradas** para arquivos inexistentes: `docs/testesC15.md`, `AUDITORIA_C0_C10_COMPLETA.md`, e `../src/components/shared/app-shell.tsx` (movido/renomeado) | [PROGRESS.md](./PROGRESS.md), [implementation/admin-config-expansion.md](./implementation/admin-config-expansion.md) | Média | Recriar/repontar os alvos ou remover as referências (2º passo) |
| A2 | **`.env.example` ausente** apesar de `src/lib/env.ts` mandar "See .env.example" no erro | `src/lib/env.ts:276` | Média | **Resolvido nesta leva** — `.env.example` criado a partir do schema |
| A3 | **CI usa Node 20**, mas `package.json engines` exige `22.x` (commit f17dcb9 migrou p/ 22) | `.github/workflows/ci.yml:27` | Baixa | Alinhar `node-version: 22` no CI (2º passo — fora do escopo doc) |
| A4 | **Sem porta de entrada:** não havia `docs/README.md` nem onboarding de dev | `docs/` | Alta | **Resolvido nesta leva** |
| A5 | **`README.md` raiz era um stub** ("Project_OS") | raiz | Baixa | **Resolvido nesta leva** |
| A6 | **Colisão de nome:** `onboarding-spec.md` (feature de produto) vs. onboarding de **dev** | `docs/` | Baixa | Dev onboarding nomeado `development/onboarding.md` com título explícito |

---

## 5. Ausência de conflitos e duplicação — por quê

- **Sem Obsoletos:** nada foi identificado como "não representa mais o sistema". Docs velhos são `Histórico` datado, não mentira ativa.
- **Sem Conflitantes abertos:** ADRs são append-only e se auto-referenciam; onde a VisãoGeral poderia divergir de uma decisão nova (ex. modelo de planos), ela **já** aponta a autoridade via comentários `<!-- ADR-024 ... -->`. A precedência formal agora vive em [documentation-authority.md](./documentation-authority.md).
- **Sem Duplicados nocivos:** há sobreposição *intencional* (o Threat Model resumido em CONVENTIONS aponta o canônico em ADR-007). Isso é navegação, não duplicação órfã.

---

## Veja também

- [README.md](./README.md) — índice mestre.
- [documentation-authority.md](./documentation-authority.md) — qual doc vence em conflito.
- [documentation-lifecycle.md](./documentation-lifecycle.md) — status/frescor.
- [achados/documentation-modernization-report.md](./achados/documentation-modernization-report.md) — o relatório da modernização.
