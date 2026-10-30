# Exclusividade dos recursos da Clínica — 29/10/2026

## Contrato aprovado e implementação

Na oferta 2026, somente Clínica de 2–5 médicos permite ajustar permissões por pessoa, consolidar o relatório por médico e configurar/calcular repasses por procedimento. Consultório mantém o bundle seguro por função, relatório geral e financeiro. Clínica e Pro legados continuam elegíveis por decisão expressa do titular. Nenhum preço, desconto, limite ou contrato foi modificado.

O gate canônico é `planHasAdvancedFinancialPolicies` em `src/contexts/billing/api.ts`, também usado por `hasGranularPermissions`. Actions de equipe e repasses já verificavam plano e autorização. Foram corrigidos os caminhos de leitura de snapshots, relatório mensal e consolidado PDF; o plano não pode ser escolhido pelo cliente da action. `null` no consolidado significa recurso indisponível; lista vazia significa plano elegível sem movimento. O PDF do Consultório não inclui a seção por médico.

Falha reproduzida: `effective_permissions_v` só reconhecia os códigos legados `clinica`/`pro`, ignorando ajustes da nova Clínica. A 0133 amplia o gate SQL para `clinica_2026_2` a `_5`, conserva `security_invoker` e invalida claims somente da família 2026. Histórico de overrides fica preservado ao fazer downgrade, mas deixa de valer no Consultório; novo upgrade reaplica os ajustes.

## Evidências

| Prova | Ambiente | Resultado |
| --- | --- | --- |
| Actions diretas, autenticação, payout, consultas, relatórios e PDF real | Vitest local, dependências compartilhadas | **PASS 106/106**, 12 arquivos, em 30/10 00:15 UTC (29/10 Brasília). Mocks de fronteira nos unitários; não equivale a integração externa. |
| Baseline defeituosa → 0133, matriz de oito planos, grant/deny SQL, hook, downgrade, claims e legado | PostgreSQL 17 descartável, schema real completo, identidades sintéticas | **PASS 11/11**, incluindo todas as 134 migrations. Não é restore de backup real nem serviço Auth completo. |
| Preflight DEV | Supabase DEV fixado `pqhkirrszzpwezdaqrai` | **PASS**: 133 timestamps anteriores conferidos; apenas 0133 pendente. Runner `db-migrate-dev.ts` terminou 0. **Readback PASS**: 134 entradas, hash 0133 igual ao arquivo, marcador e quatro variantes da Clínica na view. |
| Exclusividade no navegador, PDF, action direta e banco | Preview + Auth/DB DEV | **NOT RUN** no primeiro commit; cenário 13 preparado no runner existente. Atualizar somente após execução funcional. |
| Build e typecheck globais | CI do SHA candidato | **NOT RUN** no primeiro commit. Typecheck local retorna três diagnósticos em módulos intocados de IA/Meta: a junction de dependências contém Zod 3 e o lockfile exige Zod 4. Nenhuma dependência do worktree principal foi alterada para esconder a diferença. |

Comandos reproduzíveis, na raiz do worktree isolado:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/security/offer-feature-entitlements-db.ts
node node_modules/vitest/vitest.mjs run src/contexts/billing/api-financial-policies.test.ts src/contexts/financial/payout-actions.test.ts src/contexts/financial/payout-queries.test.ts src/contexts/financial/internal/professional-payout.test.ts src/lib/auth/tenant-context.test.ts src/lib/pdf/relatorio.test.ts 'src/app/(app)/(shell)/equipe/plan-entitlement.test.ts' 'src/app/(app)/(shell)/relatorios/doctor-report-entitlement.test.ts' 'src/app/(app)/(shell)/relatorios/page.test.tsx' 'src/app/(app)/(shell)/relatorios/repasses/page.test.tsx' 'src/app/(app)/(shell)/configuracoes/pagamentos/data.test.ts' 'src/app/(app)/(shell)/caixa/page.test.tsx'
```

O cenário 13 de `e2e/payout-review-preview.spec.ts` exige `E2E_PAYOUT_REVIEW_MUTATION=dev`, Preview Vercel e prova assinada de Auth/DB DEV antes de escrever. Usa clínicas e usuários sintéticos identificados, sem Asaas, mensagens ou pagamentos, e verifica remoção das fixtures. Rodar com `--grep '13. nova'` evita repetir os cenários financeiros anteriores. Não ativar traces/screenshots de sessão.

## Migração e lançamento

A sequência candidata é agora **0119–0133**, com 134 entradas no journal final. Somente 0119–0132 têm prova na cópia do backup real anterior. A 0133 tem a prova local sintética acima e aplicação DEV; ainda exige preflight/ensaio na cópia protegida atual para produção. Há UPDATE de `profiles` e substituição de view: revisar locks e renovação de claims na janela. Não houve merge, migration de produção ou alteração de contrato real.

Landing: typecheck, lint e build passaram. Probe Chromium local passou **4/4** (`/` e `/precos`, desktop/mobile), incluindo ausência dos três recursos no card Consultório e presença no card Clínica. Isso não substitui validação do app autenticado.

Limpeza opcional: os clusters sintéticos `qoro-scratch-schema-2CL9zk` e `qoro-scratch-schema-rH1KyV` estão parados. A remoção recursiva das duas pastas verificadas em `%TEMP%` foi rejeitada pela revisão automática (`blocked by policy`); não foi tentado contorno. Não contêm dados reais e não bloqueiam este gate.
