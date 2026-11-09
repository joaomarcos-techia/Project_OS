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

O founder aprovou também a [ADR-070](../../adr/070-abacatepay-cancellation-and-recontract.md): cancelar a renovação AbacatePay, preservar o período pago e permitir nova contratação somente depois dele. Essa aprovação comercial não autoriza a migration 0139 em banco remoto. Os checkpoints abaixo distinguem a implementação local dessa homologação externa ainda pendente.

## Execução rastreável

| ID | Descrição | Arquivos | Dependências | Implementação | Testes | Evidências | Riscos | Rollback | Status | Gate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C00 | Reconstruir baseline e dependências | Este diário, plano mestre, continuidade anterior | Nenhuma | Leitura de Git/CI, docs e consumidores | Baseline financeira afetada | SHA/CI e preflight DEV conferidos | Confundir histórico com ensaio atual | Sem mutação | PASS | G0 |
| C01 | Persistir origem financeira e reserva de trial | `drizzle/migrations/0138_*`, billing schema, `lib/payments/saas/` | C00 | Expand-only, sem repricing ou backfill automático | PostgreSQL real: RLS, privilégios, origem imutável, concorrência, N/N-1 | 38/38 local; DEV 139 migrations, postflight e preservação PASS | Lock DDL; default grants; cadastro duplicado | Manter schema e aplicação anterior; não apagar obrigações | PASS (DEV) | F2 |
| C02 | Provisionar trial gratuito pelo cadastro | `onboarding/internal/signup-*`, rota e formulário de plano | C01 | Reutilizar núcleo e autenticação, prazo Auth e claim transacional | Convite/legado, reload, concorrência, rollback, prazo expirado | 32/32 local e duas jornadas Browser/DEV; Auth confirmado administrativamente | Reutilizar trial; reatribuir perfil | Desligar novas originações; preservar tenants | PASS no recorte confirmado → trial | F1 |
| C03 | Checkout recorrente Sandbox pós-trial | Billing aplicação, adapter AbacatePay, UI assinatura | C01/C02 | Binding antes do POST; preço no servidor; journal durável | Duplo clique, timeout, mudança de plano, origem, permissão | UI → API → checkout externo de R$ 397 PASS; produto de R$ 197 atestado sem pagamento | Resultado desconhecido; recorrência duplicada | Pausar criação, consultar origem, sem failover | PASS para emissão Clínica Sandbox | F3 |
| C04 | Receber e aplicar evento financeiro | Rota AbacatePay, inbox, processor, billing | C01/C03 | Secret+HMAC+readback, efeito de domínio transacional e recuperação | Replay, valor/tenant/ambiente, corrida, falhas, reembolso, cancelado | Pagamento Sandbox integral → webhook real → invoice e liberação PASS; demais eventos pendentes | Ciclo de vida incompleto | Preservar inbox, conciliar, nenhuma exclusão | PASS no primeiro pagamento | F4 |
| C05 | Conciliação e gestão suportada | Billing reconciliation e assinatura; ADR upgrade | C03/C04 | Origem persistida; estados ambíguos em revisão | Renovação, falha, cancelamento, coexistência, assentos | Worker inicial e guard de coexistência; domínio de renovação/gestão pendente | API sem lookup/período; política de upgrade | Bloquear operação não suportada, manter origem | PARTIAL | F5/F9 |
| C06 | Jornada integrada e regressões | E2E/harness existentes e novos testes focados | C01–C05 | Fixture sintética retida até conciliação | Browser→DB→Sandbox→webhook→UI; regressão | Três E2E Browser/DEV PASS; pagamento, webhook e UI paga comprovados | Callback no contexto isolado encontrou SSO; email inicial fora deste recorte | Reter fixture, nunca marcar pagamento sintético como externo | PARTIAL para a jornada completa | F6/F7/F8 |
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

### Preview e CI do código publicado

Commit de implementação `9ffa9174a4d104ca32340d4dd56adf574218c308`, PR #53 draft. [Preview imutável](https://project-22ks65xlf-clinic-os-v2-s-projects.vercel.app), deployment `dpl_9H2a4CYpoj9KRvPXxSTEexmXXd2w`, READY. [CI](https://github.com/joaomarcos-techia/Project_OS/actions/runs/42536173944) PASS: **6.502/6.502 testes, 602 arquivos**, coverage 62,85% linhas/statements, 82,95% branches e 66,62% funções, todos acima dos pisos. Passaram também audit, TypeScript, lint, arquitetura, migrations, registry, inventário, isolamento entre tenants, build/bundle/HTTP e navegador público **8 PASS/2 SKIP**. Os dois SKIP são os desafios Turnstile sem chaves no build isolado; não provam proteção real. Semgrep, Snyk e Vercel SUCCESS; Agent Review NEUTRAL, não revisão humana. A CI confirma o exit nativo da suíte e resolve a ambiguidade do stderr PowerShell local.

Webhook Sandbox identificado `webh_dev_mzCpZeCyLxtQe2HqPga40Xya`, V2, evento `subscription.completed`, apontando somente para a branch de Preview. Prova de ambiente via API e readback da configuração PASS; secret inválido no endpoint público retornou **401**. A URL completa possui credenciais de entrega e não integra documentação/logs. Nenhum webhook anterior foi alterado. A prova inicial era somente configuração/rejeição; a entrega financeira posterior foi comprovada abaixo.

`e2e/abacatepay-trial-preview.spec.ts` passou em duas execuções reais, sem mocks HTTP/DB, contra esse deployment:

- Run `541be174-af71-4691-bd12-b1334acd1cf7`: Consultório, Auth sintético confirmado, login real, um clique para provisionar, trial absoluto, origem, zero operações financeiras/invoices, desktop 1440 e celular 390 sem overflow, contratação durante trial recusada (409), WhatsApp e Asaas bloqueados. Cinco estágios PASS, 2,5 min de teste.
- Run `6a37f97e-8173-4b88-8875-dd8c0f8b7f78`: Clínica, identidade sintética com data Auth controlada **antes** do provisionamento, trial vencido sem reinício, login/um clique/provisionamento, desktop/celular e abertura do checkout hospedado pela rota real. Cinco estágios PASS, 1,4 min de teste. Conta/contrato/binding/journal retidos para conciliação.
- A confirmação Auth foi administrativa e os drafts foram preparados no DEV: não alegar teste de entrega do e-mail/código nem de todas as etapas iniciais do formulário. O tempo foi simulado, não decorreram 14 dias reais.
- Checkout `bill_dKcTZUwUXYK2kgfqDnu6nLnq`, referência ao contrato `72e1b294-534c-4e01-9028-4a565d33c35b`: readback autenticado **devMode=true**, MONTHLY/SUBSCRIPTION, R$ 397, produto correto, PENDING. Uma operação durável, zero invoices, nenhum vínculo de assinatura externa e cotas não liberadas. Pagamento humano/automático ainda **NOT RUN** nessa leitura.

### Pagamento externo e retorno ao Qoro — 09/11 UTC (08/11 em Brasília)

O checkout acima foi pago uma única vez pelo modo de simulação hospedado do provedor. As etapas usaram **Preencher com dados fictícios** e **Simular Pagamento**, com e-mail da identidade sintética; nenhum cartão real, desafio contornado ou novo checkout. Readback autenticado às 00:36:14 UTC confirmou PAID, 39.700/39.700 centavos e exatamente uma assinatura ACTIVE/CARD, `subs_yDzKEeh6ycdXeJk1yLZwZpsh`, criada às 00:31:10.888 UTC, sem trial nativo.

Sem inserir invoice manualmente ou enviar evento positivo artificial, o DEV registrou `subscription.completed` aplicado, um receipt de checkout, uma tentativa confirmada e uma invoice paga. O período Qoro é 09/11 às 00:31:10.888 UTC → 09/12 no mesmo horário; `released_at` ficou em 00:31:19.007 UTC. A evidência de inbox e efeito atômico comprova a entrega autenticada ao handler; **o código HTTP da entrega original não foi observado nos logs do provedor** e não deve ser inventado. O período é a política de acesso da ADR-069, não uma afirmação do vencimento remoto.

O terceiro E2E real usou a mesma fixture, sem novo pagamento, e passou em 1,8 min (nove estágios): login, persistência financeira, tela paga desktop/celular, novo checkout recusado (409) e bloqueios temporários de WhatsApp/Asaas/convite removidos. Não conectou integrações nem enviou convites. O navegador isolado do checkout retornou à proteção SSO da Vercel; a continuação autenticada nesse mesmo contexto não foi demonstrada. A UI final foi validada após login legítimo da fixture.

Falhas intermediárias preservadas: um teste da UI paga expirou em 360s e seu encerramento manual do contexto mascarou o erro. O teste passou a usar as fixtures de contexto/página do Playwright, SQL com timeout e escopo explícito da região, sem retirar asserções; a repetição passou sem nova cobrança. O driver hospedado teve falhas de seletor antes de disparar o pagamento; os registros protegidos distinguem tentativa não enviada da única simulação efetiva.

`approved-card-receipt.ts` acrescenta leitura financeira **sem efeitos de domínio** por `/bank-statement/list`, com filtro oficial APPROVED/CARD_APPROVED, janela, valor bruto, tenant/conta, paginação limitada e rejeição de ambiguidade. Os 28 testes unitários passaram. O leitor também passou na transação real desta fixture com cinco GETs e zero mutações: `tran_ymGe0z3zyPcY4KMzBcdGM1QT`, `card_bXAWBB1WTWL0BMKxgMETKZ3j`, BRL 39.700, timestamp 00:31:10.339 UTC. CARD_APPROVED é confirmação, **não saldo liquidado**. Essa consulta prova o primeiro pagamento; ainda não prova uma renovação futura nem implementa o ledger de renovações. A primeira bateria identificou a rota GET ausente na allowlist; ela foi adicionada de forma exata, sem ampliar comandos ou enfraquecer testes.

Evidências: `dist/abacatepay-provider-payment.json`, `dist/abacatepay-preview-6a37f97e-8173-4b88-8875-dd8c0f8b7f78-paid.json`, `dist/approved-receipt-live.json`. Uma cópia sanitizada consolidada fica em [evidencias/continuation-20261108.json](evidencias/continuation-20261108.json).

### Recuperação de webhook inicial ausente

Foi acrescentado `reconcileMissingAbacatePayInitialPayment`, limitado ao Sandbox e ao binding/conta/intenção persistidos. Ele consulta somente um contrato elegível por chamada e usa GETs com prazo, sem emitir cobrança ou fabricar evento. O cron existente o executa quando não há evento de inbox a processar; timestamps de auditoria alternam os candidatos pendentes. Se o titular voltar a contratar e o checkout já estiver pago, a mesma conciliação é chamada e a UI atualiza a assinatura em vez de reabrir o link. Pagamento pendente/divergente não concede acesso; falha fica auditada. Isso recupera **checkout conhecido** sem webhook, não o ID perdido após um POST de resultado desconhecido.

Validação final desse incremento: **252/252 testes focados, 13 arquivos; TypeScript e lint PASS; arquitetura de banco PASS, 1.718 arquivos e zero achados**. A prova em PostgreSQL com as 139 migrations passou **34/34**, zero rede externa: fixture exclusivamente ativada por webhook preservada; outra fixture sem qualquer evento, ainda restrita enquanto não paga; 12 chamadas simultâneas ao checkout já pago produziram uma única invoice e um único desbloqueio; retries posteriores não duplicaram o efeito. A camada HTTP do provedor nesse ensaio é sintética, portanto não alegar uma perda real de webhook Sandbox. Evidências: `dist/abacatepay-followup-focused-final.log`, `dist/abacatepay-followup-typecheck.log`, `dist/abacatepay-followup-lint.log`, `dist/abacatepay-followup-arch-db.log` e `dist/signup-free-trial-db.json`.

Uma primeira execução do novo teste da UI falhou porque o double substituía o objeto `window` inteiro, removendo o `document` usado pelo Testing Library. O teste foi corrigido para observar apenas `location.reload/assign`; passou com as mesmas asserções. A chamada `pnpm exec` também recusou uma reinstalação automática no diretório de dependências compartilhado; nenhuma instalação/limpeza foi autorizada ou realizada. Os comandos de validação usaram diretamente os executáveis já instalados das mesmas ferramentas do projeto.

O deployment `8025fb48`, `dpl_A6gXbXmaYJ685swcc3aE8Mgv7qtP`, ficou READY em [Preview exclusivo](https://project-p28qkbi43-clinic-os-v2-s-projects.vercel.app). O E2E pago foi repetido nesse código em 43,8s e passou sem outro checkout/pagamento. A CI [42547027487](https://github.com/joaomarcos-techia/Project_OS/actions/runs/42547027487) aprovou **6.537/6.537 testes, 603 arquivos**, cobertura 62,90% linhas/statements, 82,99% branches e 66,69% funções; reprovou depois no inventário documental desatualizado. Os guards, envs públicas e testes de rotas estavam sem pendências; atualizar o snapshot gerado e repetir a CI é obrigatório. Não classificar essa execução como CI integral aprovada: isolamento/build/browser posteriores foram ignorados por dependência do gate reprovado. O build de Preview passou, mas não substitui os demais gates.

`inventory.ts --write --check` passou localmente após corrigir **somente duas referências de linha** em `docs/security/acoes.md`: GET do cron e leitura de env do harness. Permanecem 199 actions, 63 métodos HTTP, zero guards sem revisão, zero drift de env pública e zero testes de rota ausentes/regredidos. Nenhum guard, checker ou configuração de CI foi afrouxado. A próxima execução remota deve terminar todos os gates; a suíte aprovada acima continua como evidência aplicável ao mesmo código funcional.

Evidências sanitizadas locais: `dist/abacatepay-preview-<run>.json`, `dist/abacatepay-fixture-*-readback.json`, `dist/abacatepay-webhook-setup.json`, `dist/abacatepay-checkout-handoff.json` e `dist/ci-9ffa9174.log`. Credenciais/manifestos ficam no diretório protegido da fixture, fora do Git. Nunca limpar essas contas por timeout ou antes de conciliar um pagamento tardio.

### O que ainda não está comprovado

- Check de dependências circulares: PASS, exit 0, sem ciclos (1 aviso do tooling). Checks remotos do código e deployment PASS conforme acima.
- DEV remoto 0138 e configuração exclusiva da branch: PASS, incorporados ao Preview do commit informado.
- Identidade confirmada → trial → checkout e pagamento → webhook → DB → UI paga: PASS nos recortes acima. E-mail/código inicial e callback no mesmo contexto autenticado não estão comprovados por esses testes.
- Novo pagamento Sandbox integral, entrega pública financeira e desbloqueio: PASS; não repetir a cobrança nem alegar renovação a partir desse resultado.
- Renewed/failure/cancel/refund/dispute, mudanças de plano e médicos adicionais: PARTIAL de adapter, sem aplicação de domínio completa. Nova prova financeira da renovação é dependência para aplicar a ADR-068. `PENDING`, `ACTIVE`, webhook isolado ou a primeira cobrança não bastam. Não habilitar essas ações para usuários da candidata nem declarar paridade.
- Perda integral do webhook com checkout conhecido: recuperação implementada e PASS em PostgreSQL real com HTTP sintético; não houve indução de perda no Sandbox pago. Resultado desconhecido do POST com ID perdido: journal evita duplicação, mas discovery automatizado ainda pendente. Não limpar a reserva nem tentar outro gateway; tratar por readback com procedimento rastreável.
- O checkout de assinatura do fornecedor é reutilizável para clientes diferentes. O Qoro recusa reapresentar um checkout pago e recusa concessão quando o readback encontra outra assinatura; isso não invalida uma URL já copiada diretamente no provedor. Fechar/desativar o checkout após a primeira contratação, com comando durável e readback, permanece requisito a homologar antes de produção.

A conferência atual da documentação oficial localizou dois caminhos concretos para as pendências, ainda **não implementados nem executados**: [GET do checkout por `externalId`](https://docs.abacatepay.com/pages/subscriptions/checkouts-get), para recuperar um ID perdido sem repetir POST, e [exclusão do checkout de assinatura](https://docs.abacatepay.com/pages/subscriptions/checkouts-delete), que preserva as assinaturas já geradas. O segundo endpoint usa `POST /subscriptions/checkouts/delete?id=…`; não existe fundamento para inventar `/close`. Antes de ativá-lo, preservar a evidência financeira local e comprovar o efeito da exclusão, a assinatura sobrevivente, o tratamento de timeout e a deduplicação. O journal 0138 ainda não tem uma categoria de comando própria para esse efeito; não alterar a migration já aplicada para acrescentá-la. A preparação de nova migration deverá receber autorização específica antes de qualquer aplicação remota.

`e2e/abacatepay-trial-preview.spec.ts` foi preparado para identidades Auth sintéticas confirmadas administrativamente, draft retido e manifestado antes dos efeitos, login real, seleção/provisionamento, DEV comprovado por assinatura, prazo absoluto, contagem de operações e tela desktop/mobile. A variante com trial vencido pode gerar um único checkout Sandbox pela rota real; o teste não paga cartão nem comprova entregabilidade de e-mail. Credenciais permanecem no processo/cofre local e nenhum artefato de sessão é capturado. A fixture nunca é excluída por timeout.

Os quatro pontos de integração visual (formulário de plano, aviso do trial, página e componente de assinatura) são mudanças funcionais mínimas; nenhum arquivo do worktree de UI foi alterado.

## Estado final e produção

Execução em andamento. Nenhuma ativação de produção autorizada ou realizada. Permanecem requisitos de publicação: aprovação de migrations/destino, secrets exclusivos por ambiente, webhook público validado, método contratado homologado, origens legadas preservadas, upgrade decidido ou explicitamente indisponível, E2E financeiro causal e autorização final de rollout. Supabase e Vercel permanecem.

## Cancelamento e nova contratação — continuidade após aprovação da ADR-070

Implementados localmente os intents de cancelamento, reconciliação por leitura, acesso até o fim pago e novo checkout após o término, com histórico separado e sem novo trial. A **0139 continua não aplicada remotamente**. O código preserva o comportamento Asaas e não oferece a nova gestão se as duas tabelas ainda não existem.

Em `2026-11-09T02:55:30Z` (08/11 em Brasília), passaram **46/46 verificações PostgreSQL**, 140 migrations reais, zero rede externa. Incluem concorrência, resposta perdida, microssegundos preservados no snapshot, bloqueio antes/depois do prazo, rollback e duas gerações de contratação; a segunda passa pelo receptor autenticado de webhook, com HTTP sintético. Também passaram 71 testes focados de rota/UI/processor/cron/acesso. A suíte integral e o build ainda estavam em execução no checkpoint. [Relatório e limites](../../quality/abacatepay-cancelamento-recontratacao-2026-11-08.md).

O cancelamento real da fixture Sandbox e sua recontratação temporal ainda **não foram executados**. Não usar os 46 PASS locais como prova externa, não pagar novamente a fixture já conciliada e não sobrescrever IDs antigos. Renovação, mudanças de plano/assentos, falhas/estornos/disputas e descoberta de checkout cujo POST ficou desconhecido continuam gates próprios, não cobertos por este cancelamento.
