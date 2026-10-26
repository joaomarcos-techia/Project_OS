# Oferta 2026 — checkpoint de integração de 26/10/2026

Este checkpoint descreve o candidato da branch `integration/pricing-plan-sync-20261018`. Ele não autoriza a publicação. A landing corrigida permanece no PR draft [#3](https://github.com/joaomarcos-techia/landing_page/pull/3); a landing pública ainda apresenta limites diferentes. Os resultados anteriores em [validação autônoma](validacao-autonoma-2026-10-21.md) continuam históricos e não substituem esta medição.

## O que foi implementado

| Fluxo | Comportamento atual do candidato | Prova e limite |
| --- | --- | --- |
| Troca mensal ↔ anual | Titular com assinatura ativa da oferta 2026 e cartão já cadastrado solicita troca para o vencimento atual; plano e acesso não mudam antes da data. O pedido fica persistido, o Asaas é sincronizado e confirmado por readback, e cron/webhook conciliam a transição. Pix, boleto, contrato legado, parcela divergente ou já paga pelo preço anterior são recusados. | Testes de provider, rota e banco; o runner de Sandbox fez troca mensal→anual e retorno com parcela pendente, sem segunda cobrança. A jornada autenticada inteira no novo Preview ainda não foi executada. |
| Parcela já emitida na troca | A parcela existente mantém o ID e recebe o preço do novo ciclo; `nextDueDate` da assinatura aponta para a **parcela seguinte a emitir**, um ano após a parcela existente no anual. Pagamento antecipado da parcela não antecipa a data de início do ciclo. | Testes de `billing-cycle-provider-sync`, webhook, reconciliação e banco descartável. Renovação transcorrida por um ano no próprio Asaas não foi observada. |
| Médico adicional | Oferta 2026 abre Checkout hospedado `DETACHED` para o rateio proporcional. O Checkout coleta os dados do pagador; o vínculo ao upgrade é feito pela sessão verificada, sem mudar o customer da assinatura recorrente. A cota fica antiga até pagamento autenticado pelo provider, readback, atualização da recorrência e aplicação local. Repetição de clique reutiliza o Checkout; timeout de criação entra em estado incerto e não dispara segundo POST. Contratos legados conservam a cobrança avulsa anterior. | Testes unitários e de banco; o E2E foi separado em criação automática e pagamento humano. O Checkout pago do caminho novo ainda não foi observado no Preview, portanto não recebe PASS externo. |
| Contratação anual inicial | O cadastro anual em Checkout Sandbox, banco DEV e UI foi comprovado no checkpoint anterior; preço anual equivale a dez mensalidades e a primeira cobrança respeita o trial de 14 dias. | Não confundir a contratação inicial já medida com uma renovação ocorrida um ano depois. |

## Validações desta rodada

| Área | Estado | Evidência |
| --- | --- | --- |
| Suíte integral | **PASS** | `npx vitest run`: **5.680/5.680**, 538 arquivos, exit 0 após a correção do Checkout e do tratamento de resposta incerta. Uma execução anterior falhou em uma asserção de texto da UI que ainda esperava “cobrança” depois da troca para Checkout; a asserção foi corrigida, sem ser desativada. |
| Migrations 0129–0131 | **PASS em DEV e Postgres descartável** | Aplicação guardada somente no projeto DEV `pqhkirrszzpwezdaqrai`; readback das três entradas, colunas e enum. `npx tsx --conditions=react-server scripts/security/signup-provision-db.ts`: **17/17**, exit 0, com migrações reais, crash/retry e isolamento. `npx vitest run src/lib/db/migration-journal.test.ts`: **5/5**, exit 0. Produção não foi migrada. |
| Segurança das migrations | **PASS** | `npx tsx scripts/check-migration-safety.ts`: exit 0. `npx tsx scripts/security/inventory.ts --check`: exit 0 após regenerar `docs/security/acoes.md`; 196 actions, 53 métodos de rota, 19 props, 381 variáveis e zero guarda faltante. |
| TypeScript e lint | **PASS** | `npx tsc --noEmit` e `npx eslint .`: exit 0 após as alterações. |
| Formatação global | **PASS** | O primeiro `npx prettier --check .` falhou em sete arquivos alterados e dois arquivos preexistentes; os nove foram formatados sem mudança de comportamento. Reexecução integral: exit 0. `git diff --check`: exit 0. |
| Build Next | **PASS local** | `npx tsx scripts/security/local-build.ts`: Next 15.5.24, compilação otimizada, checagem de tipos e 19 páginas estáticas, exit 0. Não substitui o build do novo SHA na Vercel. |
| E2E Checkout novo no Preview | **PASS na criação; SKIP no pagamento** | No SHA `161dfdfe`, a UI autenticada falhou sem link; log da Vercel e probe confirmaram HTTP 400 `invalid_object` em `POST /checkouts`: com `customer` fixado, o Asaas exigiu telefone e endereço ausentes no customer SaaS. No SHA corrigido `e964bb72`, o probe real criou/cancelou Checkout no Sandbox, exit 0. `node -r dotenv/config node_modules/@playwright/test/cli.js test e2e/extra-doctor-payment-preview.spec.ts --project=chromium --reporter=line` contra o Preview `dpl_3MFQCkErbiVgTqmv9JPseJ9Hg58Y`: **1 PASS, 1 SKIP**, exit 0. A UI criou um único Checkout, manteve 2 médicos antes de pagar e o cleanup removeu Auth, clínica, customer, assinatura e webhook sintéticos sem resíduos. O pagamento hospedado, webhook e cota pós-pagamento ainda não têm PASS. |
| Checks do PR #42 | **PASS no SHA `e964bb72`** | `gh pr checks 42`: Vercel, Vercel Preview Comments, Snyk e Semgrep passaram. `vercel inspect` confirmou o deployment Preview imutável `project-5nq36hff8` pronto e o alias da branch apontando para ele. A landing PR #3 também passou Vercel e Semgrep; o review opcional da Vercel consta como skip, não PASS. |
| Backup real | **BLOCKED** | Antes das migrations DEV, `pg_dump -Fc` gerou arquivo de 1.716.991 bytes fora do repositório, e `pg_restore --list` leu 2.055 entradas, exit 0. Isso prova legibilidade do arquivo, **não restauração**. A tentativa de criar/restaurar um scratch local foi rejeitada automaticamente pela política do executor antes de executar; não foi repetida nem contornada. |

## Integridade e rollout

- O candidato não faz `merge`, deploy Production, mudança de contrato real nem migration Production nesta rodada.
- O backup DEV anterior às migrations está fora do repositório em diretório privado da execução; nenhum dado clínico, token ou URL protegida foi copiado para este documento.
- A landing pública anuncia até **10 profissionais e equipe ilimitada**, enquanto a oferta do app e o PR #3 limitam a **5 médicos e 3 logins de equipe**. A publicação isolada de um lado seria comercialmente incorreta.
- O PR do app continua draft sobre `preview/payment-settings-pricing-20261015`, não diretamente sobre `main`. O `git fetch origin main` seguido de `git rev-list --left-right --count origin/main...HEAD` mediu **0 commits exclusivos da main e 97 da branch** em 26/10. Isso evita conflito de merge neste instante, mas exige revisar e integrar a cadeia de PRs e migrations antes de publicar, sem descartar trabalho concorrente.
- Um Checkout expirado ou de criação incerta bloqueia nova tentativa automática e orienta suporte, evitando cobrança duplicada. Esse comportamento seguro ainda precisa de fluxo operacional de recuperação.

## Gates para publicação conjunta

1. Build, formatação, testes locais e checks **do novo SHA** aprovados.
2. E2E de criação do Checkout no Preview executado; pagamento humano em Sandbox, webhook, banco, recorrência, cota, UI e replay medidos. Não usar o antigo E2E de cobrança avulsa como substituto.
3. Restauração do backup real demonstrada em PostgreSQL local isolado, sem alvo remoto.
4. PR do app reconciliado com a `main`, revisão de segurança concluída e migrations com backup/rollback preparados para Production.
5. PRs do app e da landing publicados de forma coordenada; smoke de cadastro, preço, contrato e limites em Production sem cobrança real de teste.

As instruções que dependem de uma pessoa estão em [ações manuais da oferta](../runbooks/acoes-manuais-pendentes-pricing-2026-10.md). Este documento será atualizado com os resultados do build, Preview e checks quando concluídos.
