# INVENTORY — reconhecimento da doc (Onda 0)

> Artefato de trabalho **fora de `/docs`** (deletado na Onda 5). Read-only sobre `/docs`.
> Gerado 2026-07-23. Métricas: `L` = linhas, `lk` = links `.md` internos.

**Total:** 138 arquivos `.md` · 14 pastas · ~776 KB. Monólitos = 60% do peso.

## Monólitos (raiz)

| Arquivo | L | lk | Nota |
|---|---:|---:|---|
| PlanoAção.md | 5510 | 6 | Plano de construção C0–C18 + filosofia. ~90% histórico. |
| VisãoGeral.md | 2549 | 6 | Visão+arquitetura+módulos+fluxos+segurança. Fonte a fatiar. **Já corrigiu 15→10 seats e admin.qoro.dev**. |
| PROGRESS.md | 1477 | 48 | Log cronológico C0–C16 + remediações + dívida. Estado atual soterrado. |
| CONVENTIONS.md | 416 | 7 | Lei viva. Enxuto e atual. **Manter**. |
| README.md | 139 | 47 | Índice mestre. Reconstruir como entrada. |
| AUDITORIA_C0_C10_COMPLETA.md | 525 | 1 | Auditoria forense encerrada. Histórico. |
| testesC15.md | 323 | 1 | Aceite manual C15. Histórico. |
| onboarding-spec.md | 178 | 0 | Spec de produto (feature). Ativo? → planning. |
| whatsapp-connection-flow.md | 264 | 3 | Fluxo self-service WhatsApp. Reference. |

## Governança da doc (raiz) — refazer/verificar

| Arquivo | L | lk | Nota |
|---|---:|---:|---|
| documentation-authority.md | 64 | 11 | Hierarquia. Reconciliar (modelo de divergência). |
| documentation-lifecycle.md | 90 | 10 | Frescor. Reconciliar (D1 exclusão, D2 ADR). |
| documentation-audit.md | 106 | 41 | **Aspiracional/desatualizado** ("nenhum conflito"; cobre só 30 ADRs). Refazer code-verified. |
| adr-conformance.md | 65 | 7 | Cobre só 30 ADRs (há 47). Refazer → índice de status. |

## ADRs (`adr/`, 49 arquivos: 000 template + 001–047)

Todos `accepted` exceto **047 `proposed`**; **018** parcialmente superseded por 031. Curtos (39–243 L).
Disposição uniforme: **permanecem + carimbo de status duplo** (Onda 2). Cadeia de supersessão a mapear.

## Pastas

| Pasta | # | Disposição-alvo |
|---|---:|---|
| `achados/` | 13 | Auditorias/relatórios de IA. Extrair abertos → deletar (R6). |
| `runbooks/` | 33 | Operacionais → `operations/runbooks/` (podar validações cN). |
| `implementation/` | 9 | Mistura planos ativos (→`planning/`) e relatórios (→history/delete). |
| `c16/` | 4 | → `operations/observability/`. |
| `engineering/` | 4 | Manter + receber princípios extraídos do PlanoAção. |
| `development/` | 3 | Manter; consolidar env. |
| `audits/` | 3 | C11 histórico + README. Extrair → history/delete. |
| `contracts/` | 2 | Manter. |
| `ui-refactor/` | 2 | DS v2 em andamento → architecture/design + verificar status. |
| `remediation/` | 2 | Histórico encerrado → extrair/delete. |
| `architecture/` | 1 | context-map → manter. |

## Flags iniciais (a confirmar na verificação)

- **Duplicação de env vars:** `development/environment.md` + `achados/guia-variaveis-de-ambiente.md` + `achados/preview-aponta-para-prod.md`.
- **Duplicação observabilidade:** `c16/*` + `achados/auditoria-monitoramento-{producao,artefatos}.md` + `runbooks/alerting-setup`+`alert-tuning` + ADR-029/045.
- **Fantasma potencial:** `Pro+` (VisãoGeral) — código só `solo/clinica/pro`. Z-API fallback — sem adapter.
- **Já reconciliado (não é divergência atual):** 15→10 seats e `admin.qoro.dev` (VisãoGeral §1.3/§4.2).
