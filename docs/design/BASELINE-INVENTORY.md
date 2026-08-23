# Baseline Inventory — GATE 0

> Artefato obrigatório do GATE 0 do [plano de redesign](../desing_novo.md).
> Escrito **antes** do primeiro commit. Classifica cada arquivo não commitado da
> branch `ui-redesign-controlled` observada em 2026-08-22.

## Por que este arquivo existe

A árvore tinha 362 arquivos não commitados. Presumir que todos pertenciam ao redesign
teria enterrado **três correções de segurança e um fix de incidente de produção** dentro
de um commit de UI. "Não commitado" não é o mesmo que "pertence ao redesign".

## Método

```bash
git diff --name-only --diff-filter=M   # modificados
git ls-files --deleted                 # deletados
git ls-files --others --exclude-standard  # novos
```

Cada arquivo foi classificado por inspeção do diff, não por heurística de caminho.
As classes B foram confirmadas lendo o diff completo de cada arquivo.

## Resumo

| Classe | Significado | Arquivos |
| --- | --- | ---: |
| **A** | Redesign / Design System | 110 |
| **B** | Correção funcional pré-existente | 10 |
| **C** | Teste | 56 |
| **D** | Documentação | 186 |
| **E** | Alteração desconhecida | **0** |
| **F** | Potencialmente não relacionada | **0** |

**Nenhuma classe E ou F.** Nada bloqueia o GATE 0.

### Commits planejados

| Commit | Classe | Arquivos | Natureza |
| --- | --- | ---: | --- |
| `fix/password-recovery` | B + C | 16 | **Segurança** — independente do redesign |
| `fix/ai-slot-timezone` | B + C | 2 | **Incidente de produção** — independente do redesign |
| `baseline/tokens` | A + C | 7 | Preset, fontes, harness visual |
| `baseline/primitivos` | A + C | 33 | `src/components/**` |
| `baseline/paginacao` | A + C | 21 | Queries paginadas — fecha P-12 |
| `baseline/a11y-ux` | A + C | 14 | Loading, foco, ações destrutivas — P-13/P-17 |
| `baseline/telas` | A + C | 83 | Aplicação do DS nas telas |
| `docs/refactor` | D | 186 | Refatoração de documentação, já concluída |

---

## Os três corpos de trabalho encontrados

A árvore continha trabalho de **três sessões independentes**:

1. **Redesign / DS** (`ui-redesign-implementation.md`) — sessão de 2026-08-20 nesta branch.
   Integrou o preset `b5J5Qtmtc` com testes; registrou `Scaffold live do preset = BLOCKED`.
2. **Correções funcionais e de segurança** — não documentadas em relatório próprio;
   descobertas na leitura dos diffs (ver classe B).
3. **Refatoração de documentação** (`organizar_docs.md`) — marcada `CONCLUÍDA`, com a
   instrução explícita de "manter o worktree local e incluir os docs junto da próxima
   alteração de código; não criar branch, commit ou push nesta tarefa".

---

## Classe B — correções funcionais pré-existentes

**Não pertencem ao redesign.** Vão em commits próprios, com mensagem própria, antes do
baseline. São a razão de o GATE 0 existir.

| Arquivo | Classe | Motivo | Commit | Ação | Aprovação |
| --- | --- | --- | --- | --- | --- |
| `src/app/(app)/auth/confirm/confirm-logic.ts` | B | safeNext: blocklist -> allowlist (open-redirect) | `fix/password-recovery` | Commit separado | — |
| `src/app/(app)/login/actions.ts` | B | Ação forgotPassword resistente a enumeração | `fix/password-recovery` | Commit separado | — |
| `src/app/(app)/login/forgot-password-form.tsx` | B | Ação forgotPassword resistente a enumeração | `fix/password-recovery` | Commit separado | — |
| `src/app/(app)/login/mfa/actions.ts` | B | switchAccountAction: signOut local antes do /login | `fix/password-recovery` | Commit separado | — |
| `src/app/(app)/login/mfa/page.tsx` | B | switchAccountAction: signOut local antes do /login | `fix/password-recovery` | Commit separado | — |
| `src/app/(app)/login/page.tsx` | B | Wiring do forgotPassword (misto com ajuste de UI) | `fix/password-recovery` | Commit separado | — |
| `src/app/(app)/reset-password/actions.ts` | B | Passa a consumir o orçamento de conclusão | `fix/password-recovery` | Commit separado | — |
| `src/contexts/ai-agent/tools/list-slots.ts` | B | Fuso da clínica no slot (incidente 2026-08-19) | `fix/ai-slot-timezone` | Commit separado | — |
| `src/lib/auth/rate-limit.ts` | B | Orçamento separado de rate-limit para efetivar senha | `fix/password-recovery` | Commit separado | — |
| `src/lib/http/application-url.ts` | B | Redirect allowlisted de recuperação de senha | `fix/password-recovery` | Commit separado | — |

### O que cada uma corrige

- **`fix/password-recovery`** — três coisas encadeadas: (a) `assertPasswordResetCompletionAllowed()`
  cria um **orçamento de rate-limit separado** para efetivar a senha, de modo que um anônimo
  esgotando o limite de *envio* de link não consuma o orçamento que a vítima precisa depois de
  apresentar o token; (b) `forgotPasswordAction()` inicia recovery com mensagem idêntica para
  usuário ausente, rate-limit e falha de provedor — resistente a enumeração; (c) `safeNext()`
  troca blocklist por **allowlist** (`/dashboard`, `/convite`, `/reset-password`), fechando
  ambiguidades de parser com controles ASCII, whitespace e barras invertidas.
  Inclui ainda `switchAccountAction()`, que faz `signOut({scope:'local'})` antes de voltar ao
  `/login` — sem isso o cookie permanece e a política de auth devolve o usuário ao desafio MFA.

- **`fix/ai-slot-timezone`** — `slotInstantInTimeZone()` apresenta o slot no relógio da clínica
  com offset UTC explícito. O comentário no código registra o incidente de **2026-08-19**: um
  `14:00Z` cru foi apresentado pelo modelo como o slot local de 14:00, que já estava ocupado.

> `src/app/(app)/login/page.tsx` e `src/app/(app)/login/mfa/page.tsx` são **mistos**: contêm o
> wiring das novas ações e também ajuste visual. Vão com a classe B porque a correção não
> funciona sem eles; o ajuste visual é revisitado na Wave 8.

---

## Classe A e C — redesign e testes

### `baseline/tokens` — 7 arquivos

| Arquivo | Cl. | Estado | Motivo | Ação | Aprovação |
| --- | --- | --- | --- | --- | --- |
| `components.json` | A | novo | Config do preset / harness visual | Base da Wave 1 | — |
| `e2e/README.md` | C | mod. | Harness visual autenticado | Base da Wave 1 | — |
| `e2e/visual/ui-critical-routes.spec.ts` | C | novo | Harness visual autenticado | Base da Wave 1 | — |
| `playwright.visual.config.ts` | A | novo | Config do preset / harness visual | Base da Wave 1 | — |
| `src/app/design-system-preset.test.ts` | C | novo | Tokens do preset e fontes | Base da Wave 1 | — |
| `src/app/globals.css` | A | mod. | Tokens do preset e fontes | Base da Wave 1 | — |
| `src/app/layout.tsx` | A | mod. | Tokens do preset e fontes | Base da Wave 1 | — |

### `baseline/primitivos` — 33 arquivos

| Arquivo | Cl. | Estado | Motivo | Ação | Aprovação |
| --- | --- | --- | --- | --- | --- |
| `src/components/admin/admin-shell.tsx` | A | mod. | Shell do painel/admin | Migrar nas Waves 2–5 | — |
| `src/components/painel/painel-shell.tsx` | A | mod. | Shell do painel/admin | Migrar nas Waves 2–5 | — |
| `src/components/shared/auth-screen-skeleton.test.tsx` | C | novo | Chrome/layout compartilhado | Migrar nas Waves 2–5 | — |
| `src/components/shared/auth-screen-skeleton.tsx` | A | novo | Chrome/layout compartilhado | Migrar nas Waves 2–5 | — |
| `src/components/shared/page-layout.test.ts` | C | novo | Chrome/layout compartilhado | Migrar nas Waves 2–5 | — |
| `src/components/shared/page-layout.ts` | A | novo | Chrome/layout compartilhado | Migrar nas Waves 2–5 | — |
| `src/components/shared/shell-chrome.tsx` | A | mod. | Chrome/layout compartilhado | Migrar nas Waves 2–5 | — |
| `src/components/shared/use-theme.test.tsx` | C | novo | Chrome/layout compartilhado | Migrar nas Waves 2–5 | — |
| `src/components/shared/use-theme.ts` | A | mod. | Chrome/layout compartilhado | Migrar nas Waves 2–5 | — |
| `src/components/ui/badge.tsx` | A | mod. | Primitivo do DS | Migrar nas Waves 2–5 | — |
| `src/components/ui/button.tsx` | A | mod. | Primitivo do DS | Migrar nas Waves 2–5 | — |
| `src/components/ui/checkbox.tsx` | A | mod. | Primitivo do DS | Migrar nas Waves 2–5 | — |
| `src/components/ui/combobox.tsx` | A | mod. | Primitivo do DS | Migrar nas Waves 2–5 | — |
| `src/components/ui/confirm-dialog.tsx` | A | mod. | Primitivo do DS | Migrar nas Waves 2–5 | — |
| `src/components/ui/destructive-action.test.tsx` | C | novo | Primitivo do DS | Migrar nas Waves 2–5 | — |
| `src/components/ui/destructive-action.tsx` | A | novo | Primitivo do DS | Migrar nas Waves 2–5 | — |
| `src/components/ui/dialog.tsx` | A | mod. | Primitivo do DS | Migrar nas Waves 2–5 | — |
| `src/components/ui/drawer.tsx` | A | mod. | Primitivo do DS | Migrar nas Waves 2–5 | — |
| `src/components/ui/empty-state.tsx` | A | mod. | Primitivo do DS | Migrar nas Waves 2–5 | — |
| `src/components/ui/field.test.tsx` | C | novo | Primitivo do DS | Migrar nas Waves 2–5 | — |
| `src/components/ui/field.tsx` | A | mod. | Primitivo do DS | Migrar nas Waves 2–5 | — |
| `src/components/ui/input.tsx` | A | mod. | Primitivo do DS | Migrar nas Waves 2–5 | — |
| `src/components/ui/metric-strip.tsx` | A | novo | Primitivo do DS | Migrar nas Waves 2–5 | — |
| `src/components/ui/nav-tabs.tsx` | A | mod. | Primitivo do DS | Migrar nas Waves 2–5 | — |
| `src/components/ui/navigation-and-focus.test.tsx` | C | novo | Primitivo do DS | Migrar nas Waves 2–5 | — |
| `src/components/ui/page-header.tsx` | A | mod. | Primitivo do DS | Migrar nas Waves 2–5 | — |
| `src/components/ui/segmented.tsx` | A | mod. | Primitivo do DS | Migrar nas Waves 2–5 | — |
| `src/components/ui/separator.test.tsx` | C | novo | Primitivo do DS | Migrar nas Waves 2–5 | — |
| `src/components/ui/separator.tsx` | A | novo | Primitivo do DS | Migrar nas Waves 2–5 | — |
| `src/components/ui/stat-card.tsx` | A | mod. | Primitivo do DS | Migrar nas Waves 2–5 | — |
| `src/components/ui/switch.tsx` | A | mod. | Primitivo do DS | Migrar nas Waves 2–5 | — |
| `src/components/ui/table-pager.tsx` | A | mod. | Primitivo do DS | Migrar nas Waves 2–5 | — |
| `src/components/ui/ui-foundations.test.tsx` | C | novo | Primitivo do DS | Migrar nas Waves 2–5 | — |

### `baseline/paginacao` — 21 arquivos

| Arquivo | Cl. | Estado | Motivo | Ação | Aprovação |
| --- | --- | --- | --- | --- | --- |
| `src/app/(app)/(shell)/agenda/ausencias/pagination.test.ts` | C | novo | Paginação (P-12) | Fecha P-12 | — |
| `src/app/(app)/(shell)/agenda/ausencias/pagination.ts` | A | novo | Paginação (P-12) | Fecha P-12 | — |
| `src/app/(app)/(shell)/caixa/local-pagination.tsx` | A | novo | Paginação (P-12) | Fecha P-12 | — |
| `src/app/(app)/(shell)/documentos/pagination.test.ts` | C | novo | Paginação (P-12) | Fecha P-12 | — |
| `src/app/(app)/(shell)/documentos/pagination.ts` | A | novo | Paginação (P-12) | Fecha P-12 | — |
| `src/app/(app)/(shell)/financeiro/pagination.test.ts` | C | novo | Paginação (P-12) | Fecha P-12 | — |
| `src/app/(app)/(shell)/financeiro/pagination.ts` | A | novo | Paginação (P-12) | Fecha P-12 | — |
| `src/app/(app)/(shell)/pacientes/patient-list-url.test.ts` | C | novo | Paginação (P-12) | Fecha P-12 | — |
| `src/app/(app)/(shell)/pacientes/patient-list-url.ts` | A | novo | Paginação (P-12) | Fecha P-12 | — |
| `src/contexts/clinical/queries-pagination.test.ts` | C | novo | Paginação (P-12) | Fecha P-12 | — |
| `src/contexts/clinical/queries-recent-prontuarios.test.ts` | C | novo | Query paginada aditiva com total (P-12) | Fecha P-12 | — |
| `src/contexts/clinical/queries.ts` | A | mod. | Query paginada aditiva com total (P-12) | Fecha P-12 | — |
| `src/contexts/financial/queries-pagination.test.ts` | C | novo | Paginação (P-12) | Fecha P-12 | — |
| `src/contexts/financial/queries.ts` | A | mod. | Query paginada aditiva com total (P-12) | Fecha P-12 | — |
| `src/contexts/patient/index.ts` | A | mod. | Query paginada aditiva com total (P-12) | Fecha P-12 | — |
| `src/contexts/patient/lgpd-workflow.test.ts` | C | mod. | Query paginada aditiva com total (P-12) | Fecha P-12 | — |
| `src/contexts/patient/queries.test.ts` | C | novo | Query paginada aditiva com total (P-12) | Fecha P-12 | — |
| `src/contexts/patient/queries.ts` | A | mod. | Query paginada aditiva com total (P-12) | Fecha P-12 | — |
| `src/contexts/patient/types.ts` | A | mod. | Query paginada aditiva com total (P-12) | Fecha P-12 | — |
| `src/contexts/scheduling/doctor-absence-pagination.test.ts` | C | novo | Paginação (P-12) | Fecha P-12 | — |
| `src/contexts/scheduling/queries.ts` | A | mod. | Query paginada aditiva com total (P-12) | Fecha P-12 | — |

### `baseline/a11y-ux` — 14 arquivos

| Arquivo | Cl. | Estado | Motivo | Ação | Aprovação |
| --- | --- | --- | --- | --- | --- |
| `src/app/(app)/(shell)/agenda/importar/loading.tsx` | A | novo | Estados de rota e a11y (P-13/P-17) | Fecha P-13/P-17 | — |
| `src/app/(app)/(shell)/configuracoes/assinatura/loading.tsx` | A | novo | Estados de rota e a11y (P-13/P-17) | Fecha P-13/P-17 | — |
| `src/app/(app)/(shell)/configuracoes/procedimentos/loading.tsx` | A | novo | Estados de rota e a11y (P-13/P-17) | Fecha P-13/P-17 | — |
| `src/app/(app)/(shell)/configuracoes/recursos/loading.tsx` | A | novo | Estados de rota e a11y (P-13/P-17) | Fecha P-13/P-17 | — |
| `src/app/(app)/(shell)/configuracoes/sugestoes/loading.tsx` | A | novo | Estados de rota e a11y (P-13/P-17) | Fecha P-13/P-17 | — |
| `src/app/(app)/(shell)/financeiro/fornecedores/loading.tsx` | A | novo | Estados de rota e a11y (P-13/P-17) | Fecha P-13/P-17 | — |
| `src/app/(app)/(shell)/modelos-receita/loading.tsx` | A | novo | Estados de rota e a11y (P-13/P-17) | Fecha P-13/P-17 | — |
| `src/app/auth-suspense-fallback.test.ts` | C | novo | Estados de rota e a11y (P-13/P-17) | Fecha P-13/P-17 | — |
| `src/app/destructive-actions-migration.test.ts` | C | novo | Estados de rota e a11y (P-13/P-17) | Fecha P-13/P-17 | — |
| `src/app/field-accessibility.test.ts` | C | novo | Estados de rota e a11y (P-13/P-17) | Fecha P-13/P-17 | — |
| `src/app/motion-and-hit-targets.test.ts` | C | novo | Estados de rota e a11y (P-13/P-17) | Fecha P-13/P-17 | — |
| `src/app/pdf-return-navigation.test.ts` | C | novo | Estados de rota e a11y (P-13/P-17) | Fecha P-13/P-17 | — |
| `src/app/route-loading-coverage.test.tsx` | C | novo | Estados de rota e a11y (P-13/P-17) | Fecha P-13/P-17 | — |
| `src/app/ui-content-consistency.test.ts` | C | novo | Estados de rota e a11y (P-13/P-17) | Fecha P-13/P-17 | — |

### `baseline/telas` — 83 arquivos

| Arquivo | Cl. | Estado | Motivo | Ação | Aprovação |
| --- | --- | --- | --- | --- | --- |
| `src/app/(admin)/admin/clinicas/[id]/page.test.tsx` | C | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(admin)/admin/clinicas/[id]/page.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(admin)/admin/clinicas/invites-table.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(admin)/admin/clinicas/new-clinic-modal.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(admin)/admin/config/page.test.tsx` | C | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(admin)/admin/config/page.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(admin)/admin/metricas/page.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(admin)/admin/page.test.tsx` | C | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(admin)/admin/page.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/_painel/app-shell.css` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/_painel/ds.css` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/agenda/agenda-calendar.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/agenda/agenda-page-actions.tsx` | A | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/agenda/ausencias/doctor-absence-form.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/agenda/ausencias/page.test.tsx` | C | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/agenda/ausencias/page.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/agenda/importar/actions.ts` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/agenda/importar/history-importer.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/agenda/importar/page.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/agenda/new-appointment-drawer.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/agenda/page.test.tsx` | C | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/agenda/page.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/caixa/caixa-money.ts` | A | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/caixa/caixa-view.test.tsx` | C | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/caixa/caixa-view.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/caixa/cash-action-panels.tsx` | A | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/caixa/cash-queue.tsx` | A | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/configuracoes/layout.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/configuracoes/lgpd/lgpd-work-queue.tsx` | A | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/configuracoes/lgpd/page.test.tsx` | C | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/configuracoes/lgpd/page.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/configuracoes/page.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/configuracoes/procedimentos/procedures-manager.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/configuracoes/settings-nav.test.tsx` | C | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/configuracoes/settings-nav.tsx` | A | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/configuracoes/settings-navigation.test.ts` | C | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/configuracoes/settings-navigation.ts` | A | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/configuracoes/sugestoes/page.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/configuracoes/whatsapp/whatsapp-connect.test.tsx` | C | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/configuracoes/whatsapp/whatsapp-connect.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/consultorio/prescription-drawer.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/consultorio/sign-dialog.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/conversas/[id]/_components/conversa-actions.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/conversas/[id]/page.test.tsx` | C | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/conversas/[id]/page.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/dashboard/page.test.tsx` | C | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/dashboard/page.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/documentos/page.test.tsx` | C | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/documentos/page.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/equipe/invite-drawer.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/financeiro/fornecedores/fornecedores-view.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/financeiro/page.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/modelos-receita/templates-manager.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/pacientes/[id]/consent-card.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/pacientes/[id]/delete-form.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/pacientes/[id]/lgpd-actions.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/pacientes/[id]/page.test.tsx` | C | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/pacientes/[id]/page.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/pacientes/[id]/patient-clinical-activity.test.tsx` | C | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/pacientes/[id]/patient-clinical-activity.tsx` | A | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/pacientes/[id]/patient-crm-controls.test.tsx` | C | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/pacientes/[id]/patient-crm-layout.test.ts` | C | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/pacientes/[id]/patient-death-form.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/pacientes/[id]/patient-profile-card.test.tsx` | C | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/pacientes/[id]/patient-profile-card.tsx` | A | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/pacientes/[id]/patient-relationships-card.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/pacientes/[id]/prontuarios/[pid]/sign-prontuario-dialog.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/pacientes/[id]/prontuarios/novo-prontuario-button.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/pacientes/actions.ts` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/pacientes/new-patient-drawer.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/pacientes/page.test.tsx` | C | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/pacientes/page.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/pacientes/patient-form.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/relatorios/page.test.tsx` | C | novo | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/(shell)/relatorios/page.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/auth/auth-error/page.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/convite/page.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/documentos/[id]/pdf/page.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/documentos/[id]/pdf/regenerate-button.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/join/[token]/onboarding-flow.css` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/prescricoes/[id]/pdf/page.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/prescricoes/[id]/pdf/regenerate-button.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |
| `src/app/(app)/reset-password/page.tsx` | A | mod. | Aplicação do DS na tela | Reaplicar DS nas Waves 3–8 | — |

---

## Classe D — refatoração de documentação

186 arquivos. Trabalho independente e concluído (`organizar_docs.md`), sem relação com o
redesign. Motivo, commit, ação e aprovação são idênticos para todos, então a listagem é
compacta em vez de tabular: **motivo** = refatoração de documentação; **commit** =
`docs/refactor`; **ação** = commit separado; **aprovação** = —.

| Estado | Arquivos |
| --- | ---: |
| deletados | 109 |
| modificados | 50 |
| novos | 27 |

<details><summary>Lista completa dos 186 arquivos</summary>

- `"docs/PlanoA\303\247\303\243o.md"` (D)
- `"docs/Vis\303\243oGeral.md"` (M)
- `.prettierignore` (M)
- `docs-migration/CONFLICTS.md` (D)
- `docs-migration/INVENTORY.md` (D)
- `docs-migration/MIGRATION-MAP.md` (D)
- `docs-migration/QUESTIONS.md` (D)
- `docs-migration/evidence/billing.md` (D)
- `docs-migration/evidence/messaging.md` (D)
- `docs/AUDITORIA_C0_C10_COMPLETA.md` (M)
- `docs/CONVENTIONS.md` (M)
- `docs/CURRENT-STATE.md` (M)
- `docs/PROGRESS.md` (M)
- `docs/README.md` (M)
- `docs/achados/Auditoria_logica_gpt.md` (D)
- `docs/achados/auditoria-apis-seguranca.md` (D)
- `docs/achados/auditoria-arquitetura-acesso-banco.md` (D)
- `docs/achados/auditoria-autenticacao-identidade.md` (D)
- `docs/achados/auditoria-banco-dados.md` (D)
- `docs/achados/auditoria-monitoramento-artefatos.md` (D)
- `docs/achados/auditoria-monitoramento-producao.md` (M)
- `docs/achados/auditoria-prontidao-producao-2026-08-04.md` (D)
- `docs/achados/auditoria-redis-arquitetura.md` (D)
- `docs/achados/auditoria-seguranca-codigo.md` (M)
- `docs/achados/auditoria-simplificacao-codigo.md` (D)
- `docs/achados/documentation-modernization-report.md` (M)
- `docs/achados/guia-variaveis-de-ambiente.md` (D)
- `docs/achados/pendencias-agente-ia.md` (D)
- `docs/achados/pendencias-trilha-b.md` (D)
- `docs/achados/preview-aponta-para-prod.md` (D)
- `docs/achados/ui-ux-refactor-report.md` (D)
- `docs/adr/000-template.md` (D)
- `docs/adr/001-bounded-contexts.md` (D)
- `docs/adr/002-rls-postgres.md` (D)
- `docs/adr/003-outbox-pattern.md` (D)
- `docs/adr/004-meta-cloud-api.md` (D)
- `docs/adr/005-supabase-vs-firebase.md` (D)
- `docs/adr/006-drizzle-orm-pinning.md` (D)
- `docs/adr/007-rls-implementation-patterns.md` (M)
- `docs/adr/008-identity-patterns.md` (M)
- `docs/adr/009-claims-drift-mitigation.md` (M)
- `docs/adr/010-security-definer-patterns.md` (M)
- `docs/adr/011-outbox-audit-idempotency-patterns.md` (M)
- `docs/adr/012-encryption-strategy.md` (D)
- `docs/adr/013-clinical-data-ownership.md` (D)
- `docs/adr/014-scheduling-patterns.md` (D)
- `docs/adr/015-event-versioning.md` (D)
- `docs/adr/016-clinic-lifecycle.md` (D)
- `docs/adr/017-clinical-record-retention-vs-lgpd.md` (D)
- `docs/adr/018-ui-design-foundation.md` (D)
- `docs/adr/019-consultorio-chamadas.md` (D)
- `docs/adr/020-messaging-provider-patterns.md` (M)
- `docs/adr/021-lgpd-anonymization-on-clinical-retention.md` (D)
- `docs/adr/022-ai-agent-foundation.md` (M)
- `docs/adr/023-ai-agent-intents.md` (D)
- `docs/adr/024-plan-model.md` (D)
- `docs/adr/025-billing-architecture.md` (D)
- `docs/adr/026-proactive-jobs.md` (D)
- `docs/adr/027-onboarding-magic-invite.md` (D)
- `docs/adr/028-white-label-scope-pdf-only.md` (D)
- `docs/adr/029-observability-stack.md` (D)
- `docs/adr/030-security-headers-csp.md` (D)
- `docs/adr/031-design-system-v2-rebrand.md` (D)
- `docs/adr/032-mvp-identity-practitioner-model.md` (D)
- `docs/adr/033-consultorio-board-scope-practitioner.md` (D)
- `docs/adr/034-invite-resend-copy-link.md` (D)
- `docs/adr/035-palette-rebrand-navy-orchid.md` (D)
- `docs/adr/036-asconflict-permanece-no-contexto.md` (D)
- `docs/adr/037-server-authoritative-session.md` (D)
- `docs/adr/038-mfa-policy.md` (D)
- `docs/adr/039-member-lifecycle.md` (D)
- `docs/adr/040-invite-acceptance-gate.md` (D)
- `docs/adr/041-authz-tables-are-not-tenant-tables.md` (D)
- `docs/adr/042-rls-initplan-and-public-least-privilege.md` (D)
- `docs/adr/043-messaging-retention-not-partitioning.md` (D)
- `docs/adr/044-clinical-content-encryption.md` (D)
- `docs/adr/045-observability-execution-boundary.md` (D)
- `docs/adr/046-no-login-gate-clinical-record-access.md` (D)
- `docs/adr/047-ai-conversations-human-handoff.md` (D)
- `docs/adr/048-ai-agent-conversational-safety.md` (M)
- `docs/adr/049-pagamentos-paciente-sinal.md` (N)
- `docs/adr/README.md` (M)
- `docs/ai/agent.md` (N)
- `docs/architecture/arch-metrics.json` (N)
- `docs/architecture/c4.md` (N)
- `docs/architecture/context-map.md` (M)
- `docs/architecture/context-map.mmd` (N)
- `docs/architecture/dependency-graph.mmd` (N)
- `docs/architecture/event-flow.mmd` (N)
- `docs/architecture/risks.md` (N)
- `docs/archive/evidence-snapshots.md` (N)
- `docs/audits/C11_ADVERSARIAL_50.md` (M)
- `docs/audits/C11_IMPLEMENTATION_AUDIT.md` (D)
- `docs/audits/C12_AI_AGENT_AUDIT_2026-08-14.md` (M)
- `docs/audits/README.md` (D)
- `docs/backend/http-jobs-outbox.md` (N)
- `docs/billing/subscriptions.md` (N)
- `docs/c16/README.md` (D)
- `docs/c16/c16-inventory.md` (M)
- `docs/c16/go-live-checklist.md` (D)
- `docs/c16/slo.md` (M)
- `docs/contracts/README.md` (M)
- `docs/contracts/events/billing.md` (M)
- `docs/database/schema.md` (N)
- `docs/desing_novo.md` (N)
- `docs/development/environment.md` (M)
- `docs/development/onboarding.md` (M)
- `docs/development/setup.md` (M)
- `docs/development/testing.md` (N)
- `docs/discovery-log.md` (N)
- `docs/domains/patient-clinical-lgpd.md` (N)
- `docs/domains/scheduling-financial.md` (N)
- `docs/engineering/ai-development.md` (M)
- `docs/engineering/decision-guide.md` (M)
- `docs/engineering/definition-of-done.md` (M)
- `docs/engineering/git-workflow.md` (M)
- `docs/frontend/routes-and-access.md` (N)
- `docs/governance/authority.md` (D)
- `docs/governance/doc-audit.md` (D)
- `docs/governance/lifecycle.md` (D)
- `docs/implementation/C13-BILLING-REPORT.md` (D)
- `docs/implementation/README.md` (D)
- `docs/implementation/admin-config-expansion.md` (D)
- `docs/implementation/convite-e-gestao-de-equipe.md` (D)
- `docs/implementation/onboarding-owner-atende-branch.md` (D)
- `docs/implementation/plano-pausa-almoco-e-export-relatorios.md` (D)
- `docs/implementation/plano-receituario-e-painel-medico.md` (D)
- `docs/implementation/planos-feedback-asaas.md` (D)
- `docs/implementation/prescricao-psiquiatria.md` (D)
- `docs/implementation/relatorio-pendencias-painel.md` (D)
- `docs/integrations/providers.md` (N)
- `docs/onboarding-spec.md` (M)
- `docs/operations/deployment-observability.md` (N)
- `docs/qorov2.md` (N)
- `docs/remediation/README.md` (D)
- `docs/remediation/REMEDIACAO_FORENSE_C0_C10.md` (D)
- `docs/roadmap/known-limitations.md` (N)
- `docs/runbooks/README.md` (M)
- `docs/runbooks/alert-tuning.md` (D)
- `docs/runbooks/alerting-setup.md` (M)
- `docs/runbooks/asaas-webhook-missing.md` (D)
- `docs/runbooks/audit-retention.md` (D)
- `docs/runbooks/billing-first-charge.md` (D)
- `docs/runbooks/c0-validation.md` (D)
- `docs/runbooks/c1-validation.md` (D)
- `docs/runbooks/c10-validation.md` (D)
- `docs/runbooks/c11-validation.md` (D)
- `docs/runbooks/c14-validation.md` (M)
- `docs/runbooks/c2-validation.md` (M)
- `docs/runbooks/c3-validation.md` (D)
- `docs/runbooks/c4-validation.md` (M)
- `docs/runbooks/c5-validation.md` (M)
- `docs/runbooks/c7-validation.md` (M)
- `docs/runbooks/c8-validation.md` (D)
- `docs/runbooks/disaster-recovery.md` (M)
- `docs/runbooks/failure-drills.md` (D)
- `docs/runbooks/gemini-down.md` (D)
- `docs/runbooks/go-live-2026-08-11.md` (D)
- `docs/runbooks/incident-response.md` (M)
- `docs/runbooks/lgpd-breach-72h.md` (D)
- `docs/runbooks/log-search.md` (M)
- `docs/runbooks/meta-template-rejected.md` (D)
- `docs/runbooks/migrations.md` (M)
- `docs/runbooks/offboarding-desativar-membro.md` (D)
- `docs/runbooks/prod-database-reset.md` (D)
- `docs/runbooks/prod-test-clinic-cleanup.md` (D)
- `docs/runbooks/production-readiness.md` (M)
- `docs/runbooks/production-rehearsal.md` (D)
- `docs/runbooks/reconectar-whatsapp-teste.md` (D)
- `docs/runbooks/redis-down.md` (D)
- `docs/runbooks/restore-test.md` (D)
- `docs/runbooks/runtime-role-nobypassrls.md` (M)
- `docs/runbooks/secret-rotation.md` (D)
- `docs/runbooks/super-admin-locked.md` (D)
- `docs/security/model.md` (N)
- `docs/testesC15.md` (M)
- `docs/troca-app-meta-whatsapp.md` (D)
- `docs/ui-refactor/design-system-map.md` (D)
- `docs/ui-refactor/ui-inventory.md` (D)
- `docs/whatsapp-connection-flow.md` (M)
- `organizar_docs.md` (N)
- `package.json` (M)
- `scripts/arch-graphs.ts` (N)
- `scripts/madge.d.ts` (N)
- `teste2e2.md` (D)
- `ui-redesign-implementation.md` (N)

</details>

---

## Saída do gate

- [x] Todo arquivo classificado
- [x] Zero classe E / F — nada bloqueia
- [x] Classe B isolada em commits próprios, fora do baseline do redesign
- [x] Branch `redesign/qoro-ds-v3` criada a partir de `ui-redesign-controlled`
- [x] 10 commits temáticos aplicados; árvore limpa
- [x] Suíte verde e baseline registrado

### Baseline registrado (2026-08-22)

| Verificação | Resultado |
| --- | --- |
| `pnpm lint` | limpo |
| `pnpm typecheck` | limpo |
| `pnpm test` | **2.213 testes / 249 arquivos**, todos verdes |
| `pnpm build` | sucesso — 190 kB de JS compartilhado |

### Ordem dos commits

Os `baseline/*` vêm **antes** dos `fix/*`, invertendo a ordem sugerida no plano. Os
primitivos precisam existir antes das telas e das correções que os consomem — `login/page.tsx`
e `mfa/page.tsx` importam do DS. A separação por assunto, que é o objetivo do gate, fica
intacta: cada correção continua num commit próprio e identificável.

### Uma correção necessária durante o gate

`slot-floor.test.ts` falhava: o teste de apresentação no fuso fixava `2026-08-20` na janela e
`normalizeSlotWindow` passou a rejeitá-la como inteiramente passada a partir de 2026-08-21. O
código estava certo — o comportamento tem cobertura própria no teste vizinho. O relógio do
teste foi fixado, como os outros testes datados do arquivo já faziam.

Não é regressão do redesign: é um teste que apodrecia por data.


---

## Waves executadas (2026-08-23)

| Wave | Entrega | Testes ao fim |
| --- | --- | ---: |
| 0 | Baseline, gates 1–3, referências commitadas | 2.213 |
| 1 | Tokens, tipografia, matriz de campos, status | 2.219 |
| 2 | Shell — sidebar, PageHeader, menu de usuário | 2.226 |
| 3 | Camada de dados — FilterBar, DataTable, EntityCell, StatsInline, Avatar | 2.240 |
| 4 | Métricas e visualização — StatCard, BarChart, StackedBar, BreakdownList, SummaryList | 2.251 |
| 5 | Formulários — FormSection, OptionCardGroup | 2.259 |
| 6 e 7 | Consultório, Conversas IA (orchid), Relatórios | 2.259 |
| 8 | Varredura de consistência + gate mecânico do contrato | 2.266 |
| 9 | `/configuracoes` como Settings Hub — fim da sidebar interna | 2.278 |

O gate mecânico vive em `src/app/design-contract.test.ts` e roda junto da suíte.

## Wave 9 — `/configuracoes` (2026-08-23)

A rota era um `redirect` para a primeira configuração acessível, com a navegação numa **barra
lateral própria** ao lado da global. Duas hierarquias permanentes para responder uma pergunta só.

A primeira tentativa trocou isso por um hub em linhas na própria `/configuracoes`. O founder
revisou o preview e cortou: quem abre Configurações quer editar a clínica, não ler um índice.
**A barra virou o hub.**

| O que saiu | O que entrou |
| --- | --- |
| `settings-nav.tsx` antigo — `<aside>` em grade `13.5rem` | `settings-nav.tsx` — barra horizontal de dois níveis, no `layout.tsx` |
| Hub em linhas + visão geral (`settings-item.tsx`) | `page.tsx` volta a redirecionar, agora para o Perfil da clínica |
| `settings-status.ts`, `settings-data.ts` | — (os status viviam nas linhas; sem linhas, sem casa) |
| Modo de página `form` (960px) | Todas as rotas na mesma régua que `/dashboard` |
| `enroll-flow.tsx` | `security-dialog.tsx` — ativação do TOTP em diálogo |

**Nível 1** são as seis categorias; clicar leva à primeira configuração de cada uma. **Nível 2** só
aparece quando a categoria tem mais de um destino. Juntos alcançam os treze destinos sem rolagem
horizontal — a barra quebra linha em vez de rolar. Abaixo de `sm`, um menu.

### Larguras

`/configuracoes`, `/equipe` e `/modelos-receita` rodavam em `--page-maxw: 960px` (modo `form`)
enquanto o resto do app roda em 1440px. O efeito medido no preview: o `h1` de Configurações
começava em **x=400**, o de Pacientes em **x=288** — 112px de recuo a mais, na mesma sidebar.
O modo `form` foi removido; os formulários de dentro já se limitam sozinhos.

### Achado fora do redesign

`assinatura/page.tsx` tinha 10 sequências de UTF-8 relido como Latin-1 (`seguranÃ§a`,
`Assinatura em configuraÃ§Ã£o`) — texto corrompido visível na tela de assinatura não provisionada.
A mesma varredura achou `ProntuÃ¡rio` num regex de `e2e/production-permission-lifecycle.spec.ts`,
que por isso nunca casava com o heading real. Ambos corrigidos; nenhum outro arquivo do repo tem
o padrão.

### Pendência conhecida na aba

`procedimentos/procedures-manager.tsx` e `recursos/resources-manager.tsx` ainda montam a lista com
`.listrows`/`.listrow` do `app-shell.css` e um `<select>` cru em vez do `Select` do DS. Não é a
mesma classe de problema que o resto da wave: `.cardblock` e o `Card` do DS renderizam idênticos
(mesmo `--r-lg`, mesma borda, mesmo fundo — só 24px contra 20px de padding), mas as linhas de
lista não têm equivalente e trocá-las mexe na estrutura, não no estilo. Fica para uma passada
própria.
