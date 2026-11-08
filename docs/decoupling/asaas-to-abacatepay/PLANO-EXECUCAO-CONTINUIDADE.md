# Execução de continuidade — novas assinaturas AbacatePay

Iniciada em 08/11/2026, antes de alterar código. Fonte comercial: prompt de continuidade fornecido pelo founder nesta data e decisões registradas no [plano mestre](PLANO-MESTRE-MIGRACAO-ASAAS-ABACATEPAY.md). Este diário detalha a execução; não cria outro plano comercial.

## Baseline recebida e conferida

- Worktree `C:/dev/Qoro_billing_abacatepay_20261107`, branch `feat/billing-abacatepay-20261107`, HEAD `75dcee1b2f9651c2c16e6d2e3ed8a30e78b01e4b`.
- PR [#53](https://github.com/joaomarcos-techia/Project_OS/pull/53) em draft, base `main`, worktree limpo. CI, Snyk, Semgrep e Vercel aprovados nesse HEAD; revisão automática Vercel NEUTRAL, sem equivaler a revisão humana.
- Histórico: 6.415 testes unitários, 45 verificações PostgreSQL e E2E Preview das cotas. A liberação desse E2E usa invoice sintética; não prova AbacatePay.
- Cotas e bloqueios existentes, migrations 0136/0137 e direitos legados serão preservados. Readback histórico DEV: 138 migrations; confirmação atual somente leitura ainda pendente.
- Adapter V2, journal de operações, inbox, leitor financeiro e política de trial diferido existem. O DDL multigateway continua candidato, fora do journal.
- Cadastro público ainda exige recorrência Asaas antes de provisionar. A política diferida isolada não executa essa jornada.
- Outro agente atua em `C:/dev/Qoro_ui_refactor_20261108`, branch `ui/refactor-qoro-20261108`; nenhuma alteração visual dele será sobrescrita.

## Escopo e autorizações

Implementar e testar localmente com dados sintéticos, preparar integração Sandbox e migrations aditivas. Nenhum deploy, merge, migration ou contrato de produção. Não redirecionar contratos antigos nem pagamentos dos pacientes. Migrations em destino local descartável estão no escopo autorizado; qualquer aplicação remota deve identificar exatamente o destino e a autorização antes de executar. Segredos permanecem exclusivamente servidor e não entram neste registro.

O trial permanece em 14 dias desde Auth.created_at, sem checkout inicial ou trial nativo adicional. Cotas não mudam. Checkout pós-trial não concede direitos por redirect. O founder aprovou a alternativa C da [ADR-068](../../adr/068-abacatepay-upgrade-policy.md): nova cota somente na próxima renovação paga no novo valor, sem proporcional separado. A âncora técnica do primeiro período está na [ADR-069](../../adr/069-abacatepay-trial-origin-and-initial-access.md). Preservar Asaas legado. Novas vendas anuais continuam fechadas.

## Execução rastreável

| ID | Descrição | Arquivos | Dependências | Implementação | Testes | Evidências | Riscos | Rollback | Status | Gate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C00 | Reconstruir baseline e dependências | Este diário, plano mestre, continuidade anterior | Nenhuma | Leitura de Git/CI, docs e consumidores | Baseline financeira afetada | SHA/CI e preflight DEV conferidos | Confundir histórico com ensaio atual | Sem mutação | PASS | G0 |
| C01 | Persistir origem financeira e reserva de trial | `drizzle/migrations/0138_*`, billing schema, `lib/payments/saas/` | C00 | Expand-only, sem repricing ou backfill automático | PostgreSQL real: RLS, privilégios, origem imutável, concorrência, N/N-1 | 38/38 local; DEV 139 migrations, postflight e preservação PASS | Lock DDL; default grants; cadastro duplicado | Manter schema e aplicação anterior; não apagar obrigações | PASS (DEV) | F2 |
| C02 | Provisionar trial gratuito pelo cadastro | `onboarding/internal/signup-*`, rota e formulário de plano | C01 | Reutilizar núcleo e autenticação, prazo Auth e claim transacional | Convite/legado, reload, concorrência, rollback, prazo expirado | 32/32 local; E2E preparado, ainda não executado | Reutilizar trial; reatribuir perfil | Desligar novas originações; preservar tenants | PARTIAL | F1 |
| C03 | Checkout recorrente Sandbox pós-trial | Billing aplicação, adapter AbacatePay, UI assinatura | C01/C02 | Binding antes do POST; preço no servidor; journal durável | Duplo clique, timeout, mudança de plano, origem, permissão | Dois produtos Sandbox atestados e fixture documentada | Resultado desconhecido; recorrência duplicada | Pausar criação, consultar origem, sem failover | PARTIAL | F3 |
| C04 | Receber e aplicar evento financeiro | Rota AbacatePay, inbox, processor, billing | C01/C03 | Secret+HMAC+readback, efeito de domínio transacional e recuperação | Replay, valor/tenant/ambiente, corrida, falhas, reembolso, cancelado | HTTP/DB local PASS; pagamento externo NOT RUN | Período não comprovado; concessão indevida | Preservar inbox, conciliar, nenhuma exclusão | PARTIAL | F4 |
| C05 | Conciliação e gestão suportada | Billing reconciliation e assinatura; ADR upgrade | C03/C04 | Origem persistida; estados ambíguos em revisão | Renovação, falha, cancelamento, coexistência, assentos | Worker inicial e guard de coexistência; domínio de renovação/gestão pendente | API sem lookup/período; política de upgrade | Bloquear operação não suportada, manter origem | PARTIAL | F5/F9 |
| C06 | Jornada integrada e regressões | E2E/harness existentes e novos testes focados | C01–C05 | Fixture sintética retida até conciliação | Browser→DB→Sandbox→webhook→UI; regressão | Unidade/DB local PASS; browser externo pendente | Falta de interação humana no cartão | Reter fixture, nunca marcar pagamento sintético como externo | PARTIAL | F6/F7/F8 |
| C07 | Preparar publicação futura | Plano mestre, matriz, runbook e diário | C00–C06 | Checklist de config, legacy, monitoramento, rollback | Diff, secrets, gates do projeto | Gates locais PASS; Preview autorizado, produção não autorizada | Lifecycle e E2E incompletos | PR draft, produção intacta | PARTIAL | F10 |

## Matriz de edge cases e critérios

Reutilizar [matriz financeira](MATRIZ-CENARIOS-E-TESTES.md), M01–M18 do plano mestre e A01–C07 do plano geral, sem conceder PASS por listagem. Obrigatórios no recorte: Auth não confirmado, convidado/admin/perfil pré-existente, sessão expirada, trial absoluto e consumido, dois cadastros simultâneos, rollback do claim, preço/ciclo adulterados, quotas atômicas, vínculo imutável, dois gateways/contas com IDs iguais, POST com timeout, evento antes do resultado, confirmação sem pagamento, replay e evento fora de ordem, invoice de outro tenant/zero/forjada, cancelamento tardio e cobrança recorrente já existente.

Um gate só recebe PASS após o efeito correspondente ser observado. Unidade, PostgreSQL sintético, Preview, Sandbox e produção são níveis diferentes. A ausência documentada de campo de período ou consulta de mudança pendente não autoriza inventar equivalência. Dependências humanas específicas devem ser apresentadas após preparar implementação revisável e continuar atividades independentes.

## Integração com a refatoração visual

Arquivos de atenção: formulário de plano, assinatura, layout e avisos do trial. Alterar somente pontos funcionais mínimos; manter exports, design system e contratos existentes. O outro agente não implementa cotas, pagamentos, migrations ou direitos de acesso. Registrar arquivo funcional modificado para integração posterior, sem mexer no worktree dele.

## Diário e evidências

- 08/11: prompt recebido; branch/HEAD/PR/CI e isolamento conferidos. Worktree principal possui alterações alheias e foi apenas consultado. Este documento criado antes do código. Regressão focal AbacatePay/política trial iniciada, resultado pendente.
- Readback DEV em 08/11 às 20:58 UTC: projeto conhecido DEV, 138 migrations, hashes anteriores conferidos, 0136/0137 presentes, nenhum privilégio administrativo excedente nas tabelas de cota, zero escritas remotas. Depois disso foi preparada a 0138; ela **não foi aplicada no DEV remoto nem em produção**. O operador anterior que assume última migration 0137 não deve aplicar a nova automaticamente.

### Implementação local desta continuação

- `0138_saas_gateway_bindings.sql` registrada no journal: origem explícita imutável (default Asaas para contratos existentes), sete tabelas privadas, FKs compostas, dedup, lease, claim de trial e snapshot financeiro. Sem repricing, exclusão ou credenciais. O founder autorizou explicitamente a 0138 **somente no DEV**, atualização do PR draft #53 e configuração de Preview exclusivo da branch, condicionados aos gates locais. Essa autorização não alcança produção ou o Preview do agente de UI. Preflight de locks nas duas constraints únicas de tabelas públicas continua obrigatório.
- `signup-free-trial.ts`, saga, draft, rota de checkout e formulário: identidade Auth confirmada e não convidada; trial absoluto; provisionamento atômico sem chamada ao gateway; retry retorna o mesmo tenant; perfil existente não é reatribuído; draft Asaas já iniciado mantém sua jornada.
- `deferred-checkout.ts`, `/api/billing/checkout` e componente de assinatura: permissão fresca, origem confiável, corpo vazio, preço e produto no servidor, snapshot imutável e journal antes do POST. Callback volta à assinatura do próprio ambiente. Nenhuma nova cobrança após pagamento ou durante trial. Resultado desconhecido fica retido, sem POST automático ou fallback.
- `/api/webhooks/abacatepay`, inbox e `abacatepay-processing.ts`: autenticação secret+HMAC, dados minimizados, lease e readback fora da transação; invoice, vínculo externo, período e liberação de cotas na mesma transação. Checkout inicial pago não renova outro período. Eventos de ciclo de vida ainda não implementados ficam em revisão.
- Origem AbacatePay é recusada nos comandos antigos de plano Asaas. Composição Sandbox recusa produção. `webhookSecret` passou a ser redigido pelo sanitizador. As exceções de acesso administrativo são exatas e documentadas na ADR-069, sem desativação dos guards.

### Evidências executadas (não confundidas com Sandbox)

| Verificação | Resultado observado | Ambiente / evidência |
| --- | --- | --- |
| Baseline focal do adapter/política diferida | 164/164 PASS | Vitest local antes das alterações funcionais |
| Adapter, primeiro período, cadastro, formulário, redaction | 236/236 PASS, 11 arquivos | Vitest; chamadas HTTP de teste, não fornecedor |
| Rotas de checkout/webhook, UI assinatura, cron e gate de acesso | 56/56 PASS, 5 arquivos | Vitest; doubles explícitos |
| Trial + aplicação financeira + composição HTTP/DB | 32/32 PASS, 139 migrations reais | `scripts/security/signup-free-trial-db.ts`; `dist/signup-free-trial-db.json`; PostgreSQL 17 loopback, identidades e HTTP sintéticos; zero rede externa e zero escritas de produção |
| Schema privado / journal / inbox | 38/38 PASS, 139 migrations reais | `scripts/security/billing-gateway-schema.ts`; `dist/billing-gateway-schema.json`; zero provider calls e zero escritas remotas; diretório sintético preservado após parar o cluster |
| Regressão focal final | 317/317 PASS, 19 arquivos | `dist/continuation-vitest-focused.log`; antes do último teste de copy |
| Suíte integral padrão | 6.501/6.501 asserções PASS, 602 arquivos | `dist/continuation-vitest-full-final.log`; o shell PowerShell devolveu 1 ao tratar stderr nativo esperado como erro, sem falha Vitest ou erro não tratado; a CI deve confirmar o exit nativo do commit publicado |
| Último componente alterado | 8/8 PASS | `dist/continuation-ui-final.log`; inclui o teste adicional de copy posterior à suíte integral |
| TypeScript final | PASS, exit 0 | `dist/continuation-typecheck-final.log` |
| Arquitetura de acesso ao banco | PASS, 1.716 arquivos, zero achados | `dist/continuation-arch-db.log` |
| Formatação dos arquivos alterados | PASS | `dist/continuation-format.log` |
| Lint final e arquivos adicionais | PASS, zero erros/avisos | `dist/continuation-lint-final.log`, `dist/continuation-lint-added.log` |
| Inventário de segurança | PASS, nenhum guard/env/route test pendente | `dist/continuation-inventory.log`; snapshot gerado em `docs/security/acoes.md` |
| Observabilidade e migrations | PASS | `dist/continuation-migration-safety.log`; 21 crons e 14 eventos de saved-search coerentes |
| Build Next completo | PASS, exit 0 em 08/11 às 23:29 UTC | `dist/security-local/build-result.json`; cópia sem `.env` ou credenciais reais |
| Bundle do navegador | PASS, 197 arquivos, zero achados | `dist/continuation-bundle.log`; inclui canary AbacatePay |
| TypeScript incluindo o novo E2E | PASS, exit 0 | `dist/continuation-typecheck-with-e2e-final.log`; corrigida atribuição opcional do identificador da fixture |
| Últimas alterações de teste | 17/17 PASS, exit 0 | `dist/continuation-last-unit.log`; webhook e copy de assinatura |

As provas PostgreSQL incluem corridas de 12 requisições, rollback antes do commit, proibição de reatribuir identidade, prazo expirado, privilégio/RLS, pagamento parcial/pendente/estornado/cancelado, origem errada, invoice única, replay HTTP e pagamento tardio de contrato cancelado. A última prova passa pela rota real e leitor real, porém usa respostas HTTP sintéticas: **não é E2E externo nem prova de pagamento AbacatePay**.

Falhas intermediárias registradas: fixture usou enum inexistente (`atendente` em vez de `attendant`), Date bruto em binding SQL sem conversão ISO, matcher de texto exato em parágrafo da UI, expectativa HTTP 202 no replay que corretamente retorna 200, reutilização de um contrato para duas obrigações iniciais no ensaio do journal e duas fixtures antigas da página de assinatura sem UUID/mock do novo overview. Corrigidas sem retirar asserções. O lint identificou imports administrativos fora da allowlist; foram adicionados somente os quatro pontos privilegiados necessários, com a justificativa e testes acima. Também foi corrigido um import de tipo no teste do webhook. Gates finais ainda em execução não são considerados aprovados.

### Efeitos externos identificados antes do Preview

Após preparar o [manifesto da fixture](FIXTURE-TRIAL-DIFERIDO-20261108.md), foram criados e consultados dois produtos **Sandbox**, R$ 197 e R$ 397, ciclo mensal BRL, sem trial nativo. `dist/offer-sandbox.log` registra o resultado sanitizado; manifesto e journal durável ficam fora do Git em `%LOCALAPPDATA%/Qoro/SandboxBilling/qoro-trial-deferred-20261108`. Não foram criados checkout, cliente, assinatura ou pagamento para esses produtos. A autenticação Vercel também foi conferida por leitura legítima da API; nenhuma variável da branch tinha sido gravada nesse preflight.

Após todos os gates locais, em 08/11 às 23:36 UTC a **0138 foi aplicada somente no DEV**. Preflight e postflight passaram: 138 → 139 migrations, sete tabelas privadas com FORCE RLS/privilégios mínimos, nenhum contrato reclassificado e comparação de subscriptions/clinics/profiles/policies/usage inalterada. Evidência: `dist/gateway-dev-0138-apply.json`. Às 23:37 UTC foram gravadas as seis variáveis AbacatePay/SaaS **somente** para `target=preview`, `gitBranch=feat/billing-abacatepay-20261107`. O postflight confirmou que as variáveis dos demais ambientes/branches não mudaram. Secret de webhook cifrado por DPAPI e ACL privada fora do repositório; `.env.local` não foi alterado. Evidência: `dist/vercel-abacatepay-preview-config.json`. Nenhuma escrita em produção.

### O que ainda não está comprovado

- Check de dependências circulares: PASS, exit 0, sem ciclos (1 aviso do tooling). Checks remotos do novo commit e deployment: pendentes.
- DEV remoto 0138 e configuração exclusiva da branch: PASS conforme evidências acima; o deployment ainda precisa incorporar o novo commit.
- Cadastro real com Supabase Auth/browser até AbacatePay e retorno à UI: NOT RUN nesta versão. Prova local transacional não o substitui.
- Novo pagamento Sandbox do plano integral, webhook público e readback: NOT RUN. Somente os dois produtos identificados acima foram criados; checkout e pagamento ainda dependem da fixture DEV e do Preview validados.
- Renewed/failure/cancel/refund/dispute, mudanças de plano e médicos adicionais: PARTIAL de adapter, sem aplicação de domínio completa. Nova prova financeira da renovação é dependência para aplicar a ADR-068. `PENDING`, `ACTIVE`, webhook isolado ou a primeira cobrança não bastam. Não habilitar essas ações para usuários da candidata nem declarar paridade.
- Resultado desconhecido do POST e perda integral do webhook: journal evita duplicação, mas discovery/recovery automatizados ainda não estão concluídos. Não limpar a reserva nem tentar outro gateway; tratar por readback com procedimento rastreável.
- O checkout de assinatura do fornecedor é reutilizável para clientes diferentes. O Qoro recusa reapresentar um checkout pago e recusa concessão quando o readback encontra outra assinatura; isso não invalida uma URL já copiada diretamente no provedor. Fechar/desativar o checkout após a primeira contratação, com comando durável e readback, permanece requisito a homologar antes de produção.

`e2e/abacatepay-trial-preview.spec.ts` foi preparado para identidades Auth sintéticas confirmadas administrativamente, draft retido e manifestado antes dos efeitos, login real, seleção/provisionamento, DEV comprovado por assinatura, prazo absoluto, contagem de operações e tela desktop/mobile. A variante com trial vencido pode gerar um único checkout Sandbox pela rota real; o teste não paga cartão nem comprova entregabilidade de e-mail. Credenciais permanecem no processo/cofre local e nenhum artefato de sessão é capturado. A fixture nunca é excluída por timeout.

Os quatro pontos de integração visual (formulário de plano, aviso do trial, página e componente de assinatura) são mudanças funcionais mínimas; nenhum arquivo do worktree de UI foi alterado.

## Estado final e produção

Execução em andamento. Nenhuma ativação de produção autorizada ou realizada. Permanecem requisitos de publicação: aprovação de migrations/destino, secrets exclusivos por ambiente, webhook público validado, método contratado homologado, origens legadas preservadas, upgrade decidido ou explicitamente indisponível, E2E financeiro causal e autorização final de rollout. Supabase e Vercel permanecem.
