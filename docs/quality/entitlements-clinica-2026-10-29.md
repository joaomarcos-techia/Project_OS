# Exclusividade dos recursos da Clínica — 29/10/2026

Atualizado em 30/10/2026 após o E2E real.

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
| Exclusividade no navegador, PDF, action direta e banco | Preview + Auth/DB DEV | **PASS 1/1** (quatro estados de plano), 30/10, run sintético `afb8badb`, 2,1 minutos. UI, PDF real, ação direta recusada sem escrita, permissão efetiva e cleanup zero. |
| Build e typecheck globais | CI do SHA candidato | **PASS** no [CI do código `09e78f09`](https://github.com/joaomarcos-techia/Project_OS/actions/runs/40979114882): typecheck, lint, build, segurança, isolamento e **5.723/5.723** testes, 544 arquivos. E2E público **7 PASS + 2 SKIP** por Turnstile ausente no build isolado. Typecheck local permanece limitado por três diagnósticos em módulos intocados de IA/Meta: a junction contém Zod 3 e o lockfile exige Zod 4. A CI usa o lockfile correto; nenhuma dependência do worktree principal foi modificada. |

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

## Prova integrada final

Comando executado no worktree isolado, com credenciais somente em memória, `E2E_BASE_URL` no Preview imutável, `E2E_PAYOUT_REVIEW_MUTATION=dev` e artifacts de sessão desligados:

```powershell
node node_modules/@playwright/test/cli.js test e2e/payout-review-preview.spec.ts --grep '13. nova' --retries=0
```

- App: [Preview `09e78f09`](https://project-6wioqhsmh-clinic-os-v2-s-projects.vercel.app). Runtime assinado comprovou Auth e DB DEV antes de qualquer fixture.
- Matriz: `clinica_2026_2` → `consultorio_2026` → `clinica_2026_5` → `pro`. Trocas feitas exclusivamente na assinatura sintética, sem vínculo com Asaas; isto **não** revalida o lifecycle financeiro de upgrade.
- Clínica nova: formulário de repasses, relatório mensal, consolidado por médico no PDF e edição individual visíveis. Grant salvo pela UI confirmado em `user_permission_overrides` e `effective_permissions_v`.
- Consultório: formulários e link premium ausentes; rota mensal mostra indisponibilidade; PDF geral continua HTTP 200 sem consolidado por médico. Replay da action válida da Clínica retorna negativa de plano, sem aumentar registros de auditoria; grant anterior deixa de ser efetivo.
- Clínica de 5 médicos e Pro legado: acesso permanece. Clínica legada foi coberta também na matriz PostgreSQL local de oito planos.
- Cleanup: **0 clínicas, 0 usuários Auth, 0 linhas financeiras/auditoria/outbox** restantes. Não houve pagamento, chamada Asaas ou WhatsApp.
- Evidência local sanitizada: `dist/quality/feature-entitlements-preview.log` (ignorada pelo Git). Primeira execução foi interrompida sem resultado, deixando fixture `f5d3ce62`; sua remoção específica foi verificada antes da reexecução aprovada. Não contar a execução interrompida como PASS ou FAIL funcional.
- Landing: [Preview `ca12a68`](https://landing-page-9tuiry5ok-clinic-os-v2-s-projects.vercel.app/precos), **4/4** após SSO legítimo: home/preços desktop/mobile, com cada benefício exclusivo no card Clínica. Agent Review foi `NEUTRAL/skipping`, não PASS; Vercel e Semgrep passaram.

Os PRs #42 e #3 continuam draft. Nenhum merge, deploy de produção ou migration em produção foi executado. A nova regra foi comprovada em DEV/Preview; publicação continua sujeita aos gates operacionais de lançamento existentes.
