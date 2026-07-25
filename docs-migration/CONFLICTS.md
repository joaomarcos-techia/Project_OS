# CONFLICTS — divergências doc↔código (Onda 0)

> Escopo Onda 0: **priorizar divergências MATERIAIS** (auth/RLS/tenancy/cripto/billing/clínico/WhatsApp/
> segurança/migrações). Não é auditoria exaustiva de cada frase — o resto é verificado na onda do domínio.
> Legenda: `VERIFICADO` = checado contra código nesta onda · `A VERIFICAR` = mapeado p/ onda do domínio.

## Já reconciliadas (NÃO são divergência atual — memória estava desatualizada)

| Tema | Memória/histórico dizia | Realidade no doc hoje | Status |
|---|---|---|---|
| Seats do maior plano | "VisãoGeral diz 15" | VisãoGeral §4.2 (l.776-820) já diz **10**; código = 10 (`rate-limit.ts:413`, `plan_limits`/0039) | ✅ RESOLVIDO |
| `admin.qoro.dev` | "doc cita subdomínio que não resolve" | VisãoGeral tem nota de correção (l.195): "nunca provisionado; vive em app.qoro.dev/admin" | ✅ RESOLVIDO (resta ref solta em `src/app/(admin)/README.md:3` — fora do escopo /docs) |

## Divergências materiais VERIFICADAS nesta onda

| # | Divergência | Doc | Código | Categoria | Ação proposta |
|---|---|---|---|---|---|
| C-1 | **Plano `Pro+` não existe** | `VisãoGeral.md:779` (tabela lista Pro+) | `billing/events.ts:44` enum só `solo/clinica/pro` | Billing (R4) | Marcar Pro+ como `PLANNED` ou remover da tabela de planos ATUAIS → **QUESTION Q-1** |
| C-2 | **Fallback Z-API sem adapter** | `VisãoGeral.md:275+`, **ADR-004** ("fallback ZAPI") | `messaging/` só Meta; sem adapter Z-API | WhatsApp (R4) | Classificar `NOT_IMPLEMENTED` (abstração existe) → **QUESTION Q-2** |
| C-3 | **Solo = 1 vs 2 usuários** (inconsistência interna) | `VisãoGeral.md:776` ("1 usuário") vs `:808` ("até 2") | seed `plan_limits` (verificar Onda 3) | Billing | Resolver p/ o valor do seed na Onda 3 |

## Divergências/riscos MAPEADOS p/ a onda do domínio (A VERIFICAR)

| # | Afirmação a verificar | Fonte | Onda |
|---|---|---|---|
| C-4 | MFA/AAL2 — "opcional" (VisãoGeral l.205) vs política ADR-038; onde é enforced? | VisãoGeral §2.5/§4.1, ADR-038 | 3 (identity/security) |
| C-5 | "Sem overage / sem feature-gating" (ADR-024) realmente no código? | VisãoGeral §4.2/§4.7, ADR-024 | 3 (billing) |
| C-6 | Cifra de conteúdo clínico (ADR-044) — implementada ou diferida? (memória: V2 diferido) | ADR-012/044, VisãoGeral §7.2 | 3 (clinical/security) |
| C-7 | RLS FORCE + dual-context + Policy v2 InitPlan (ADR-007/042) conferem no schema? | ADR-007/042, VisãoGeral §2.1 | 3 (security) |
| C-8 | Status de observabilidade: auditorias `achados/auditoria-monitoramento-*` dizem "pendente"; memória diz em prod (PR #7), falta só canal de alerta | achados/*, c16/*, PROGRESS | 5 (operations) — extrair item aberto (canal de alerta), deletar audit |
| C-9 | Receituário/painel: Fase 1+2 em prod, Fase 3 pendente (memória) — o que o código confirma? | implementation/plano-receituario, relatorio-pendencias-painel | 3 (clinical) |
| C-10 | Refatoração DS v2 "em andamento" (PROGRESS l.1068) — qual o estado real? | PROGRESS, ui-refactor/*, ADR-031/035 | 3/5 |

## Nota de método
Nenhuma das divergences VERIFICADAS é de segurança/auth (essas são C-4/C-6/C-7, ainda A VERIFICAR).
As verificadas (C-1/C-2) são de **prontidão exagerada** (doc vende como pronto o que é abstração/plano),
não de comportamento inseguro. Serão confirmadas com o usuário antes de escrever `domains/*` (R4).
