# Cancelamento e nova contratação AbacatePay — candidata

Worktree `C:/dev/Qoro_billing_abacatepay_20261107`, branch `feat/billing-abacatepay-20261107`, PR draft #53. Regra aprovada pelo founder em 08/11, horário de Brasília. [ADR-070](../adr/070-abacatepay-cancellation-and-recontract.md).

## Implementação

- Solicitação autenticada com permissão fresca, origem confiável, corpo limitado e identificação de clínica/ator exclusivamente no servidor. O UUID do contrato vigente impede que um clique antigo cancele uma contratação posterior.
- Registro durável antes do comando. Confirmação exige leitura autenticada da loja, assinatura, cliente e checkout corretos. Resposta perdida não autoriza outro POST; a consulta pode reconciliar o resultado confirmado no journal.
- O cancelamento preserva o fim do acesso já pago e não apaga perfis, dados, invoices nem vínculos anteriores. Encerrado esse período, o gate de escrita não aplica tolerância de inadimplência; o cron conclui a projeção local.
- Uma nova contratação depende de cancelamento confirmado e período encerrado. Preço, produto e ciclo são resolvidos no servidor. Uma obrigação privada por assinatura encerrada impede novos checkouts em cliques repetidos. Pagamento integral, conta e produto corretos abrem o novo mês, com invoice atômica e sem novo trial.
- Recontratações preservam o binding inicial imutável. O registro público continua sendo a projeção vigente; o histórico privado mantém a cadeia de contratos e invoices. O novo pagador pode ser informado no novo checkout, sem alterar o pagador do contrato anterior.
- Interface: confirmação explícita, data final em Brasília, impossibilidade de desfazer, estado de verificação sem falso sucesso e “Contratar novamente” apenas após o período. O formulário legado Asaas permanece intacto.
- Migration aditiva **0139**, aplicada exclusivamente no DEV após aprovação específica: duas tabelas privadas com FORCE RLS, FKs compostas, snapshots imutáveis e privilégio operacional sem DELETE. Não altera registros financeiros existentes nem a 0138 já aplicada.

## Validação local e CI

Primeiro ensaio: cancelamento concorrente e resposta perdida passaram; a nova contratação reprovou porque a data retornada como JavaScript Date perdeu microssegundos. Corrigido o snapshot para copiar datas diretamente no PostgreSQL, sem arredondamento. Uma asserção de UI também usava um matcher ausente no Vitest 2; foi trocada por duas asserções equivalentes de contagem e conteúdo, sem remover cobertura.

Reteste local final do banco, registrado em `2026-11-09T03:23:29Z` (09/11 em Brasília): **47/47 verificações PostgreSQL** com todas as **140 migrations reais**, respostas HTTP sintéticas e **zero chamadas externas**. Inclui duas gerações de recontratação, uma aplicada pela rota autenticada de webhook, replay, confirmação integral, rollback, doze chamadas simultâneas, tenant/ator errado, tentativa antes do fim, resposta de cancelamento perdida, fim do acesso sem tolerância adicional, histórico preservado e ausência de novo trial. Na revisão, o guard do valor bruto foi antecipado à deduplicação: replay com valor divergente recebe revisão, mesmo que a invoice já exista; o novo caso comprova que não há efeito adicional.

**71/71 testes em cinco arquivos** de rota, UI, processor, acesso e cron; TypeScript e lint completos, formatação, inventário de segurança e gates de arquitetura/migrations passaram. A suíte local completa repetida com dois workers terminou com **6.558/6.558 PASS**, 604 arquivos, coverage acima dos thresholds. O guard final de valor tem reteste PostgreSQL posterior; a CI abaixo cobre o código final exato.

A primeira suíte integral com coverage terminou com **6.557 PASS e 1 FAIL**, em 604 arquivos, após 1.101 segundos nesta máquina. A falha foi a espera de fechamento do diálogo no teste Asaas `plan-change-form.test.tsx:107`; o diálogo ainda estava pendente quando o `waitFor` expirou. Esse formulário e seu teste não foram alterados. A repetição integral com `--maxWorkers=2 --minWorkers=1` passou, mantendo as mesmas asserções, timeouts e thresholds; os 22 testes desse formulário também passaram.

CI do código final `099aa2f8`: [42556591148 — SUCCESS](https://github.com/joaomarcos-techia/Project_OS/actions/runs/42556591148), **6.558/6.558**, 604 arquivos; TypeScript, lint, arquitetura, migrations, observabilidade, registro, inventário, isolamento entre clínicas, build Next, bundle e HTTP aprovados. E2E público **8 PASS/2 SKIP**, por ausência de chaves Turnstile no build isolado; não é prova de desafio real. Semgrep/Snyk/Vercel aprovados; revisão automática NEUTRAL não substitui revisão humana. O Preview imutável `https://project-iyhwvgjdd-clinic-os-v2-s-projects.vercel.app` ficou READY, com Auth e banco DEV provados por assinatura. O E2E da assinatura paga existente passou em 58,6s antes da migration, comprovando a compatibilidade com o schema anterior sem novo pagamento.

## DEV e cancelamento real da fixture

Após autorização expressa, a 0139 foi aplicada às `2026-11-09T03:44:34Z`: **139 → 140**, nenhuma outra migration, postflight PASS. Nove tabelas privadas com FORCE RLS, sem acesso anon/authenticated, operação service_role SELECT/INSERT/UPDATE sem DELETE/TRUNCATE/REFERENCES/TRIGGER. Snapshots de assinaturas, clínicas, perfis, políticas/uso do trial, bindings, operações e invoices permaneceram iguais durante o DDL.

O manifesto de cancelamento foi gravado na pasta protegida da fixture **antes** do comando. O primeiro acesso ao painel da Vercel recebeu 403 por credencial expirada; a CLI oficial autenticada renovou a sessão, sem login ou segredo pedido ao founder. Depois do comando Sandbox, a primeira resposta Qoro foi HTTP 409; a leitura autenticada mostrou CANCELLED no provedor. A verificação subsequente confirmou o estado local, sem uma segunda operação financeira. Uma interrupção de captura no driver foi separada do resultado real e não recebeu PASS; o ensaio final completo passou em `2026-11-09T03:57:10Z`.

- `subs_yDzKEeh6ycdXeJk1yLZwZpsh`: **CANCELLED**, Sandbox, cartão; checkout original permanece **PAID**, R$ 397.
- Qoro mantém `billing_status=active` enquanto o período pago está vigente, com `cancel_at_period_end=true`. É acesso já pago, não recorrência ativa. Fim original preservado: `2026-12-09T00:31:10.888Z` (08/12, 21:31 em Brasília).
- Uma invoice, uma operação confirmada de cancelamento, uma intenção confirmada e zero recontratações. Binding, invoice e política de trial tiveram hashes iguais aos do manifesto anterior; perfil e clínica continuam ativos durante o período pago.
- Repetição autenticada: HTTP 200, sem segunda operação. Nova contratação antes do fim: **HTTP 409**, sem novo checkout. UI em **1440 e 390 px**, sem overflow, com “Renovação cancelada”, sem “Manter assinatura” ou “Contratar novamente”.
- Nenhuma cobrança nova, data artificial em DEV, exclusão, estorno ou mudança em Produção. A prova do término e da nova contratação continua sendo **local/sintética**; não se observou um mês real nem se pagou outra assinatura.
- O cancelamento externo foi comprovado por comando autenticado, readback e UI/banco. Não se comprovou entrega de webhook de cancelamento; o webhook real anterior era de conclusão da contratação inicial.

Resultado sanitizado em [evidência DEV/Sandbox](../decoupling/asaas-to-abacatepay/evidencias/cancellation-0139-20261109.json). Manifesto e resultado completos permanecem em `%LOCALAPPDATA%/Qoro/SandboxBilling/qoro-trial-deferred-20261108/cancellation-0139*.json`, com ACL privada, sem credenciais nesses JSONs.

As evidências locais ficam em `dist/signup-free-trial-db.json`, `dist/cancellation-db-final.log`, `dist/cancellation-unit.log`, `dist/cancellation-typecheck-final.log`, `dist/cancellation-lint-final.log` e `dist/cancellation-inventory-final.log`, ignoradas pelo Git. Não contêm dados reais nem credenciais. São provas sintéticas, não pagamentos ou cancelamentos externos.

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

**0139 aplicada somente no DEV com autorização específica; Produção não alterada.** Sem essas tabelas o recurso de gestão fica indisponível, sem contornar a proteção ou alterar contratos existentes. O Preview já utiliza a gestão autorizada; o cancelamento foi validado somente na fixture identificada.

Preservar período, invoice e histórico da [fixture](../decoupling/asaas-to-abacatepay/FIXTURE-TRIAL-DIFERIDO-20261108.md), agora com recorrência cancelada. Não pagar novamente o checkout antigo nem apagar a fixture por timeout. A prova integrada de recontratação após um mês real não ocorreu; datas artificiais são restritas ao banco local sintético. Não há necessidade de o founder repetir este cancelamento.

Renovação financeira, falhas/estornos/disputas, alteração de plano/médico adicional e recuperação de POST de checkout desconhecido ainda precisam de homologação/implementação própria. Este recorte não declara a migração completa nem autoriza cutover, merge, cobrança real ou publicação em Produção.
