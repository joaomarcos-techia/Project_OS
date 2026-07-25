# MIGRATION-MAP — disposição de cada arquivo (Onda 0)

> Proposta revisada no checkpoint da Onda 0. **Nada é executado até aprovação.** Ações destrutivas
> (DELETE) só depois de extrair a verdade útil e registrar evidência (R7). Onda em que cada ação ocorre
> entre parênteses. `?` = disposição depende de verificação na onda do domínio.

## Resumo por ação

| Ação | Nº aprox. | O que |
|---|---:|---|
| MANTER (verificar) | ~55 | ADRs, CONVENTIONS, runbooks operacionais, engineering, contracts, context-map |
| CARIMBAR | 48 | Todos os ADRs (status duplo) |
| REFAZER | 5 | README, governance/* (authority, lifecycle, doc-audit), adr-conformance |
| CRIAR | ~13 | CURRENT-STATE, domains/* (8), architecture/{overview,flows}, security/* |
| FATIAR → DELETE | 3 | Os 3 monólitos |
| MOVER → planning/ | ~7 | Specs/planos ativos não implementados |
| CONSOLIDAR | ~8 | c16/* + alerting → observability; env; UI |
| DELETAR (após extrair) | ~28 | achados/, audits/, remediation/, relatórios e snapshots encerrados |
| MOVER → history/ | ~2–4 | Só o de valor histórico real (R6) |

---

## MANTER (fica; verificar de passagem)

| Arquivo(s) | Destino | Nota |
|---|---|---|
| `CONVENTIONS.md` | raiz | Lei viva; verificar links/valores |
| `adr/000-047` (48) | `adr/` | **+ carimbo** (Onda 2) |
| `architecture/context-map.md` | `architecture/` | Manter |
| `contracts/README.md`, `contracts/events/billing.md` | `contracts/` | Manter |
| `engineering/{ai-development,decision-guide,definition-of-done,git-workflow}.md` | `engineering/` | Manter + receber princípios do PlanoAção (Onda 4) |
| `development/{setup,onboarding}.md` | `development/` | Manter (onboarding = dev, ≠ produto) |
| `whatsapp-connection-flow.md` | `operations/` ou `domains/` (reference) | Manter como referência |
| `runbooks/` operacionais (21) | `operations/runbooks/` (Onda 5) | disaster-recovery, incident-response, lgpd-breach-72h, migrations, secret-rotation, redis-down, gemini-down, restore-test, production-readiness, production-rehearsal, failure-drills, super-admin-locked, offboarding-desativar-membro, runtime-role-nobypassrls, meta-template-rejected, asaas-webhook-missing, audit-retention, billing-first-charge, log-search, README |

## REFAZER (code-verified)

| Arquivo | Vira | Nota |
|---|---|---|
| `README.md` | `README.md` (entrada) | Mapa por intenção + autoridade + "o que ler p/ tarefa X" |
| `documentation-authority.md` | `governance/authority.md` | Reconciliar modelo de divergência |
| `documentation-lifecycle.md` | `governance/lifecycle.md` | Reconciliar D1 (exclusão) + D2 (ADR) |
| `documentation-audit.md` | `governance/doc-audit.md` | **Refazer** (era aspiracional; refletir a realidade code-verified) |
| `adr-conformance.md` | `adr/STATUS.md` (ou governance) | Índice de status dos **47** ADRs |

## CRIAR

`CURRENT-STATE.md` (<500 L) · `domains/{identity,billing,patient,scheduling,clinical,financial,ai-agent,platform-admin}.md`
· `architecture/{overview,flows}.md` · `security/*.md` (LGPD, cripto, authz, auditoria, DR).

## FATIAR → DELETE (monólitos)

| Arquivo | Fatias | Ação final |
|---|---|---|
| `VisãoGeral.md` | §1–3→`architecture/overview`; §4.x+§6→`domains/*`; §5→`architecture/flows`; §7→`security/`; §8→arch/ops | DELETE (Onda 4) |
| `PlanoAção.md` | Parte 3→`history/construction-plan`; princípios→`engineering/`; C17/18→`planning/roadmap` | DELETE (Onda 4) |
| `PROGRESS.md` | estado→`CURRENT-STATE`; log+remediações→`history/execution-log`; dívida aberta→CURRENT-STATE/planning | DELETE (Onda 4) |

## MOVER → planning/ (planos ativos, não implementados)

| Arquivo | Nota |
|---|---|
| `onboarding-spec.md` | Spec de produto (feature onboarding) |
| `implementation/plano-receituario-e-painel-medico.md` | Fase 3 pendente (Fase 1+2 em prod → parte vira `domains/clinical`) `?` |
| `implementation/prescricao-psiquiatria.md` | Proposta |
| `implementation/admin-config-expansion.md` | Proposta |
| `implementation/convite-e-gestao-de-equipe.md` | `?` se implementado → `domains/identity` + DELETE spec |
| `implementation/onboarding-owner-atende-branch.md` | Refina ADR-027 `?` |
| `implementation/plano-pausa-almoco-e-export-relatorios.md` | `?` verificar se implementado |

## CONSOLIDAR

| De | Para |
|---|---|
| `c16/{README,c16-inventory,slo,go-live-checklist}.md` | `operations/observability/` (fundir) |
| `runbooks/{alerting-setup,alert-tuning}.md` | `operations/observability/alerting.md` |
| `achados/guia-variaveis-de-ambiente.md` + `achados/preview-aponta-para-prod.md` | fundir em `development/environment.md` → DELETE origens |
| `ui-refactor/{ui-inventory,design-system-map}.md` | `architecture/design.md` `?` (verificar estado DS v2) → provável DELETE |

## DELETAR (após extrair verdade útil — R7)

| Arquivo | Extrair antes | Destino do extrato |
|---|---|---|
| `achados/auditoria-apis-seguranca.md` | itens abertos (dívida D1–D7) | CURRENT-STATE / planning |
| `achados/auditoria-autenticacao-identidade.md` | itens abertos | CURRENT-STATE / `domains/identity` |
| `achados/auditoria-banco-dados.md` | itens abertos | CURRENT-STATE / `security` |
| `achados/auditoria-seguranca-codigo.md` | V6(CSP)/V2(cifra) diferidos | planning / `security` |
| `achados/auditoria-redis-arquitetura.md` | R5/R6 abertos | planning |
| `achados/auditoria-simplificacao-codigo.md` | S2 (DomainError) pendente | planning / engineering |
| `achados/auditoria-monitoramento-{producao,artefatos}.md` | canal de alerta (go-live #2) | CURRENT-STATE / `operations/observability` |
| `achados/pendencias-trilha-b.md` | pendências abertas | planning |
| `achados/ui-ux-refactor-report.md` | — | (nada) |
| `achados/documentation-modernization-report.md` | — | 1 linha em history se útil |
| `audits/{C11_IMPLEMENTATION_AUDIT,C11_ADVERSARIAL_50,README}.md` | — | history `?` (gate §11.12) |
| `remediation/{REMEDIACAO_FORENSE_C0_C10,README}.md` | — | history `?` |
| `AUDITORIA_C0_C10_COMPLETA.md` | — | history `?` (forense encerrado) |
| `testesC15.md` | — | DELETE (aceite manual concluído) |
| `implementation/C13-BILLING-REPORT.md` | — | DELETE (relatório de fechamento) |
| `implementation/relatorio-pendencias-painel.md` | pendências abertas | `domains/clinical` / planning |
| `implementation/README.md` | — | DELETE (obsoleto após restruturação) |
| `runbooks/c{0,1,2,3,4,5,7,8,10,11,14}-validation.md` (11) | passos reutilizáveis `?` | provável DELETE (aceite de camada) ou `operations/runbooks/validation` |

## MOVER → history/ (só valor futuro real — R6)

`history/execution-log.md` (condensado do PROGRESS) + `history/construction-plan.md` (do PlanoAção).
Candidatos com `?` acima (C11 audits, remediação forense, AUDITORIA_C0_C10) entram **só se** passarem
no teste R6 ("que conhecimento futuro isto preserva?"); senão DELETE (git guarda o bruto).
