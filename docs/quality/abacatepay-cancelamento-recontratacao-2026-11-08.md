# Cancelamento e nova contratação AbacatePay — candidata

Worktree `C:/dev/Qoro_billing_abacatepay_20261107`, branch `feat/billing-abacatepay-20261107`, PR draft #53. Regra aprovada pelo founder em 08/11, horário de Brasília. [ADR-070](../adr/070-abacatepay-cancellation-and-recontract.md).

## Implementação

- Solicitação autenticada com permissão fresca, origem confiável, corpo limitado e identificação de clínica/ator exclusivamente no servidor. O UUID do contrato vigente impede que um clique antigo cancele uma contratação posterior.
- Registro durável antes do comando. Confirmação exige leitura autenticada da loja, assinatura, cliente e checkout corretos. Resposta perdida não autoriza outro POST; a consulta pode reconciliar o resultado confirmado no journal.
- O cancelamento preserva o fim do acesso já pago e não apaga perfis, dados, invoices nem vínculos anteriores. Encerrado esse período, o gate de escrita não aplica tolerância de inadimplência; o cron conclui a projeção local.
- Uma nova contratação depende de cancelamento confirmado e período encerrado. Preço, produto e ciclo são resolvidos no servidor. Uma obrigação privada por assinatura encerrada impede novos checkouts em cliques repetidos. Pagamento integral, conta e produto corretos abrem o novo mês, com invoice atômica e sem novo trial.
- Recontratações preservam o binding inicial imutável. O registro público continua sendo a projeção vigente; o histórico privado mantém a cadeia de contratos e invoices. O novo pagador pode ser informado no novo checkout, sem alterar o pagador do contrato anterior.
- Interface: confirmação explícita, data final em Brasília, impossibilidade de desfazer, estado de verificação sem falso sucesso e “Contratar novamente” apenas após o período. O formulário legado Asaas permanece intacto.
- Migration aditiva **0139**, ainda somente local: duas tabelas privadas com FORCE RLS, FKs compostas, snapshots imutáveis e privilégio operacional sem DELETE. Não altera registros financeiros existentes nem a 0138 já aplicada.

## Evidências em andamento

Primeiro ensaio: cancelamento concorrente e resposta perdida passaram; a nova contratação reprovou porque a data retornada como JavaScript Date perdeu microssegundos. Corrigido o snapshot para copiar datas diretamente no PostgreSQL, sem arredondamento. Uma asserção de UI também usava um matcher ausente no Vitest 2; foi trocada por duas asserções equivalentes de contagem e conteúdo, sem remover cobertura.

Reteste local final do banco, registrado em `2026-11-09T02:55:30Z` (08/11 em Brasília): **46/46 verificações PostgreSQL** com todas as **140 migrations reais**, respostas HTTP sintéticas e **zero chamadas externas**. Inclui duas gerações de recontratação, uma aplicada pela rota autenticada de webhook, replay, confirmação integral, rollback, doze chamadas simultâneas, tenant/ator errado, tentativa antes do fim, resposta de cancelamento perdida, fim do acesso sem tolerância adicional, histórico preservado e ausência de novo trial.

**71/71 testes em cinco arquivos** de rota, UI, processor, acesso e cron; TypeScript, lint dos arquivos afetados, inventário de segurança e gates de arquitetura/migrations passaram. A suíte completa/build ainda não recebem PASS neste checkpoint.

A primeira suíte integral com coverage terminou com **6.557 PASS e 1 FAIL**, em 604 arquivos, após 1.101 segundos nesta máquina. A falha foi a espera de fechamento do diálogo no teste Asaas `plan-change-form.test.tsx:107`; o diálogo ainda estava pendente quando o `waitFor` expirou. Esse formulário e seu teste não foram alterados. A suíte está sendo repetida integralmente com `--maxWorkers=2 --minWorkers=1`, mantendo as mesmas asserções, timeouts e thresholds. Não se atribui PASS à regressão antes desse resultado ou da CI correspondente.

As evidências locais ficam em `dist/signup-free-trial-db.json`, `dist/cancellation-db.log`, `dist/cancellation-unit.log`, `dist/cancellation-typecheck.log`, `dist/cancellation-lint.log` e `dist/cancellation-inventory.log`, ignoradas pelo Git. Não contêm dados reais nem credenciais. São provas sintéticas, não pagamentos ou cancelamentos externos.

Reprodução, na pasta deste worktree, sem carregar credenciais remotas:

```powershell
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/signup-free-trial-db.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/tsx/dist/cli.mjs scripts/arch-db-check.ts
node node_modules/tsx/dist/cli.mjs scripts/check-migration-safety.ts
node node_modules/tsx/dist/cli.mjs scripts/security/inventory.ts --check
```

O helper PostgreSQL cria seu próprio cluster descartável em loopback, aplica o schema real e o encerra. Não aponte esses comandos para Produção nem substitua as variáveis sintéticas do harness por valores de cliente.

## Limites e próximo gate

**0139 não foi aplicada no DEV nem em Produção.** Sem essas tabelas o recurso de gestão fica indisponível, sem contornar a proteção ou alterar contratos existentes. A autorização anterior cobre 0138 e o Preview exclusivo; a aplicação remota de 0139 exige aprovação específica conforme as instruções do repositório.

Depois de aprovada e dos gates verdes: conferir histórico DEV, aplicar somente 0139, validar grants/RLS e preservação de dados, publicar a candidata na branch e testar o cancelamento da fixture Sandbox já paga, identificada no [manifesto de ensaio](../decoupling/asaas-to-abacatepay/FIXTURE-TRIAL-DIFERIDO-20261108.md). Preservar seu período, invoice e histórico; não pagar novamente o checkout antigo nem apagar a fixture por timeout. A prova integrada de recontratação após um mês real não ocorreu; datas artificiais são restritas ao banco local sintético.

Renovação financeira, falhas/estornos/disputas, alteração de plano/médico adicional e recuperação de POST de checkout desconhecido ainda precisam de homologação/implementação própria. Este recorte não declara a migração completa nem autoriza cutover, merge, cobrança real ou publicação em Produção.
