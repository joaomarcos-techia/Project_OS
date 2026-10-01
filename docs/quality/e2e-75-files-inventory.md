# Inventario do checkpoint original de 75 arquivos

## Escopo medido

Este inventario congela os **75 arquivos que ja estavam alterados antes das mudancas de WhatsApp/Meta e Resend desta auditoria**: 70 rastreados e 5 nao rastreados. A reconstrucao parte do working tree atual e exclui somente os caminhos criados ou tornados dirty depois daquele checkpoint. A assercao do gerador exige exatamente 75; divergencia aborta a geracao.

Nenhum arquivo foi removido, movido ou renomeado nesta etapa. Nao ha candidato seguro a remocao por nome. Os dois documentos nao rastreados precisam ser consolidados no relatorio final, mas continuam sendo evidencia ate essa consolidacao ser revisada. Saidas de execucao (`test-results/`, `playwright-report/`, `.tmp/`, logs e coverage) nao fazem parte dos 75 e ja estao cobertas pelo `.gitignore`.

## Resumo por categoria

| Categoria | Quantidade |
| --- | ---: |
| codigo de producao necessario | 5 |
| documentacao / evidencia | 9 |
| documentacao canonica | 1 |
| infraestrutura / documentacao E2E | 1 |
| infraestrutura / runner de seguranca | 2 |
| infraestrutura / runner externo | 2 |
| infraestrutura / runners | 1 |
| infraestrutura E2E | 1 |
| relatorio | 1 |
| relatorio / escopo | 1 |
| teste ativo | 5 |
| teste ativo de regressao | 6 |
| teste ativo production-* | 40 |

## Decisao por arquivo

| # | Arquivo | Categoria | Decisao | Evidencia / motivo |
| ---: | --- | --- | --- | --- |
| 1 | `docs/billing/subscriptions.md` | documentacao / evidencia | manter e reconciliar | Documento ativo alterado pelo lote; revisar contra codigo e relatorio final, sem descarte isolado. |
| 2 | `docs/development/setup.md` | documentacao / evidencia | manter e reconciliar | Documento ativo alterado pelo lote; revisar contra codigo e relatorio final, sem descarte isolado. |
| 3 | `docs/development/testing.md` | documentacao / evidencia | manter e reconciliar | Documento ativo alterado pelo lote; revisar contra codigo e relatorio final, sem descarte isolado. |
| 4 | `docs/discovery-log.md` | documentacao / evidencia | manter e reconciliar | Documento ativo alterado pelo lote; revisar contra codigo e relatorio final, sem descarte isolado. |
| 5 | `docs/integrations/providers.md` | documentacao / evidencia | manter e reconciliar | Documento ativo alterado pelo lote; revisar contra codigo e relatorio final, sem descarte isolado. |
| 6 | `docs/prompts/auditoria-integral-testes-e2e-sem-whatsapp.md` | relatorio / escopo | consolidar | Prompt de origem do lote anterior; preservar como evidencia de escopo e apontar no relatorio final. |
| 7 | `docs/qorov2.md` | documentacao canonica | manter | Registro canonico do produto; reconciliar apenas depois de codigo e evidencias. |
| 8 | `docs/quality/auditoria-integral-execucao.md` | relatorio | consolidar | Relatorio corrente da auditoria; atualizar com resultados medidos e manter como fonte da execucao. |
| 9 | `docs/quality/e2e-coverage-audit.md` | documentacao / evidencia | manter e reconciliar | Documento ativo alterado pelo lote; revisar contra codigo e relatorio final, sem descarte isolado. |
| 10 | `docs/quality/e2e-coverage-matrix.md` | documentacao / evidencia | manter e reconciliar | Documento ativo alterado pelo lote; revisar contra codigo e relatorio final, sem descarte isolado. |
| 11 | `docs/roadmap/known-limitations.md` | documentacao / evidencia | manter e reconciliar | Documento ativo alterado pelo lote; revisar contra codigo e relatorio final, sem descarte isolado. |
| 12 | `docs/security/acoes.md` | documentacao / evidencia | manter e reconciliar | Documento ativo alterado pelo lote; revisar contra codigo e relatorio final, sem descarte isolado. |
| 13 | `e2e/README.md` | infraestrutura / documentacao E2E | manter | Contrato operacional da suite e seus guards. |
| 14 | `e2e/admin-boundary-rbac.spec.ts` | teste ativo | manter | Spec descoberto pelo Playwright e ligado a matriz funcional. |
| 15 | `e2e/admin-superadmin-journey.spec.ts` | teste ativo | manter | Spec descoberto pelo Playwright e ligado a matriz funcional. |
| 16 | `e2e/authenticated-readonly-routes.spec.ts` | teste ativo | manter | Spec descoberto pelo Playwright e ligado a matriz funcional. |
| 17 | `e2e/payments-account-lifecycle.spec.ts` | teste ativo | manter | Spec descoberto pelo Playwright e ligado a matriz funcional. |
| 18 | `e2e/production-all-permission-overrides.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 19 | `e2e/production-appointment-concurrency.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 20 | `e2e/production-appointment-import-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 21 | `e2e/production-appointment-recovery-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 22 | `e2e/production-clinic-profile-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 23 | `e2e/production-collection-case-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 24 | `e2e/production-consultorio-attendant-integrity-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 25 | `e2e/production-consultorio-no-show-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 26 | `e2e/production-convenio-payment-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 27 | `e2e/production-conversation-handoff-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 28 | `e2e/production-cross-tenant-clinical-idor.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 29 | `e2e/production-cross-tenant-patients.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 30 | `e2e/production-dashboard-financial-rbac.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 31 | `e2e/production-dashboard-nonzero-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 32 | `e2e/production-dashboard-operational-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 33 | `e2e/production-feedback-privacy-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 34 | `e2e/production-financial-concurrency-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 35 | `e2e/production-financial-lifecycle-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 36 | `e2e/production-founder-price.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 37 | `e2e/production-hours-atomicity-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 38 | `e2e/production-invite-concurrency-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 39 | `e2e/production-lgpd-export-email.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 40 | `e2e/production-lgpd-full-lifecycle-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 41 | `e2e/production-password-recovery-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 42 | `e2e/production-patient-idempotency.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 43 | `e2e/production-patient-lifecycle-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 44 | `e2e/production-permission-lifecycle.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 45 | `e2e/production-prontuario-direct-rbac-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 46 | `e2e/production-recurrence-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 47 | `e2e/production-report-matrix.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 48 | `e2e/production-role-journeys-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 49 | `e2e/production-role-transition-matrix-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 50 | `e2e/production-scheduling-config-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 51 | `e2e/production-session-logout-replay-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 52 | `e2e/production-subscription-cancellation-trial-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 53 | `e2e/production-supplier-lifecycle-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 54 | `e2e/production-team-lifecycle.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 55 | `e2e/production-unauthenticated-boundary.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 56 | `e2e/production-waitlist-a.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 57 | `e2e/production-whatsapp-settings-rbac.spec.ts` | teste ativo production-* | manter | Spec descoberto pelo Playwright; faz parte do conjunto autorizado de 44 e nao e artefato. |
| 58 | `e2e/tenant-settings-screens.spec.ts` | teste ativo | manter | Spec descoberto pelo Playwright e ligado a matriz funcional. |
| 59 | `package.json` | infraestrutura / runners | manter | Registro dos comandos executaveis usados pela auditoria. |
| 60 | `playwright.config.ts` | infraestrutura E2E | manter | Configuracao central de descoberta, projetos e politica de artefatos. |
| 61 | `scripts/asaas-live-check.ts` | infraestrutura / runner externo | manter | Runner ativo de provider/integracao; nao e saida gerada. |
| 62 | `scripts/payments-live-check.ts` | infraestrutura / runner externo | manter | Runner ativo de provider/integracao; nao e saida gerada. |
| 63 | `scripts/security/local-http.ts` | infraestrutura / runner de seguranca | manter | Runner ativo chamado pelos scripts de seguranca do package.json. |
| 64 | `scripts/security/signup-regression.ts` | infraestrutura / runner de seguranca | manter | Runner ativo chamado pelos scripts de seguranca do package.json. |
| 65 | `src/app/(app)/(shell)/agenda/actions-auth-order.test.ts` | teste ativo de regressao | manter | Teste unitario/integracao descoberto pelo Vitest. |
| 66 | `src/app/(app)/(shell)/agenda/actions.ts` | codigo de producao necessario | manter | Mudanca funcional associada a falha reproduzida; precisa permanecer junto dos testes. |
| 67 | `src/app/(app)/(shell)/modelos-receita/templates-manager.tsx` | codigo de producao necessario | manter | Mudanca funcional associada a falha reproduzida; precisa permanecer junto dos testes. |
| 68 | `src/app/(app)/(shell)/pacientes/[id]/prontuarios/actions-auth-order.test.ts` | teste ativo de regressao | manter | Teste unitario/integracao descoberto pelo Vitest. |
| 69 | `src/app/(app)/(shell)/pacientes/[id]/prontuarios/actions.ts` | codigo de producao necessario | manter | Mudanca funcional associada a falha reproduzida; precisa permanecer junto dos testes. |
| 70 | `src/app/api/signup/sessions/route.test.ts` | teste ativo de regressao | manter | Teste unitario/integracao descoberto pelo Vitest. |
| 71 | `src/app/api/signup/sessions/route.ts` | codigo de producao necessario | manter | Mudanca funcional associada a falha reproduzida; precisa permanecer junto dos testes. |
| 72 | `src/lib/payments/asaas/index.test.ts` | teste ativo de regressao | manter | Teste unitario/integracao descoberto pelo Vitest. |
| 73 | `src/lib/payments/asaas/index.ts` | codigo de producao necessario | manter | Mudanca funcional associada a falha reproduzida; precisa permanecer junto dos testes. |
| 74 | `src/lib/security/e2e-artifact-policy.test.ts` | teste ativo de regressao | manter | Teste unitario/integracao descoberto pelo Vitest. |
| 75 | `src/lib/test/asaas-account-provenance.test.ts` | teste ativo de regressao | manter | Teste unitario/integracao descoberto pelo Vitest. |

## Resultado da triagem

- **Permanecem:** codigo de producao, testes ativos, runners, configuracao e documentacao canonica.
- **Consolidar:** os dois documentos de execucao/escopo nao rastreados, preservando o prompt de origem e tornando o relatorio corrente a sintese verificavel.
- **Reorganizar:** nenhuma movimentacao e necessaria antes da regressao; mover specs agora quebraria referencias operacionais e poluiria o diff.
- **Remover com seguranca:** nenhum dos 75 no estado medido.
- **Investigar antes de remover:** qualquer documento historico apos a reconciliacao final; a ausencia de import nao basta para apagar evidencia de auditoria.
