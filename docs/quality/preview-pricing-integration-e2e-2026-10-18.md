# E2E do Preview integrado — 18/10/2026

**Código:** `integration/pricing-plan-sync-20261018`, [Draft PR #42](https://github.com/joaomarcos-techia/Project_OS/pull/42), sobre o
Draft PR #40. **Alvo:** [Preview Vercel](https://project-os-git-integration-prici-c5e6c6-clinic-os-v2-s-projects.vercel.app), Auth e PostgreSQL do projeto
Supabase DEV `pqhkirrszzpwezdaqrai`. O spec
`e2e/payout-review-preview.spec.ts` exige prova assinada do runtime, guardas
do banco DEV e `E2E_PAYOUT_REVIEW_MUTATION=dev` antes de criar fixtures. As
execuções usaram `E2E_ARTIFACTS=0`; não foram guardados cookies, tokens, traces
ou screenshots autenticados.

O comando foi `node node_modules/@playwright/test/cli.js test
e2e/payout-review-preview.spec.ts --project=chromium --workers=1`, lançado por
um wrapper temporário que carregou `.env.local` do worktree principal apenas
no processo e definiu a URL específica do Preview. O wrapper não foi versionado.

| Tentativa | Resultado medido | Causa investigada | Limpeza |
| --- | --- | --- | --- |
| 1 | **FAIL 1; NOT RUN 9**, exit 1 | `/caixa` respondeu 200 e mostrou a cobrança de fixture, mas `waitForLoadState('networkidle')` atingiu 240 s. Rede ociosa não representa prontidão desse shell. | 0 clínicas, 0 usuários, 0 linhas. |
| 2 | **FAIL 1; NOT RUN 9**, exit 1 | Depois de confirmar R$ 150, o helper navegou de novo antes do reembolso. `#refund-value` não apareceu; o comportamento foi compatível com clique antes da hidratação. A execução 3 avançou após remover esse reload e aguardar o componente cliente. | 0/0/0. |
| 3 | **PASS 5; FAIL 1; NOT RUN 4**, exit 1 | Pagamento, estorno, repasse suspenso, revisões e negativas de acesso passaram. O helper de refresh exigiu a fila “A receber” para o médico, cujo resultado correto é “Sem acesso”. | 0/0/0. |
| 4 | **PASS 2; BLOCKED 1; NOT RUN 7**, exit 1 | O login da próxima conta sintética mostrou “Muitas tentativas”. O código impõe 10 tentativas por IP e 5 por e-mail em janela móvel de 15 min; as repetições consumiram o orçamento de IP. Não houve bypass nem alteração no Redis. | 0/0/0. |
| 5, após a janela de 15 min | **PASS 10/10**, exit 0, 6,0 min, concluída em 18/10/2026 às 17:36 UTC | A prova assinada confirmou runtime Preview com Auth e banco DEV. A jornada cobriu pagamento, estorno, repasse suspenso e revisado, negativas por papel/tenant, sessão revogada, preço único, consentimento separado, regras múltiplas, permissões em lote e prévia sem checkout novo. | 0/0/0. |

O spec foi corrigido para aguardar a hidratação do componente cliente sem
depender de `networkidle`, evitar a navegação redundante antes de reembolsar,
afirmar a abertura do painel e tratar a negativa de acesso do médico como
resultado esperado. Nenhuma asserção de pagamento, repasse, autorização ou
isolamento foi removida. TypeScript, ESLint do spec e Prettier passaram após
essas alterações. A quinta execução passou **10/10 no Preview integrado**, com
readback de limpeza sem resíduo. As quatro tentativas anteriores permanecem
registradas porque um `FAIL` ou bloqueio por rate limit não vira `PASS`
retroativamente. A proteção de login não foi alterada.

Este spec valida a prévia da oferta e o fluxo financeiro existente; ele não
valida a troca de plano SaaS ponta a ponta. Esse round trip ainda exige fixture
de assinatura no DEV e Asaas Sandbox, pagamento do rateio, webhook/cron,
readback da recorrência e parcela e confirmação na UI.
