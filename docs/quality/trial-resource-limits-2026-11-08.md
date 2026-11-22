# Validação das restrições de avaliação

Ambiente: worktree local `C:/dev/Qoro_billing_abacatepay_20261107`, branch `feat/billing-abacatepay-20261107`. Nenhuma migration remota, deploy, mensagem, convite real, cobrança ou alteração de contrato executada nesta frente.

Regras: [spec de avaliação](../specs/trial-interface-e-cotas-2026-11.md). Decisão de arquitetura: [ADR-067](../adr/067-cotas-temporarias-de-avaliacao.md).

## Evidência já obtida

- Ensaio PostgreSQL descartável, todas as migrations reais até 0136, identidades sintéticas: primeira execução funcional passou 32 verificações em `2026-11-08T18:10:42.054Z`. Inclui 12 tentativas concorrentes para uma vaga de paciente, documentos/receitas somados, todas as nove cotas, bloqueios de integração/equipe, isolamento entre clínicas, restrição de escrita das políticas, não liberação por `active`, invoice cruzada/aberta/zero, expiração e liberação idempotente após invoice paga sintética.
- Os contratos existentes antes da 0136 e planos legados novos não receberam coorte. Todas as nove categorias aceitaram novas criações depois da liberação privilegiada. Os contadores antigos permaneceram intactos.
- Uma primeira tentativa do ensaio falhou por slug sintético longo demais, antes de exercitar as cotas. Fixture corrigida para o formato real; nenhum CHECK foi desativado. Faltas iniciais de variáveis fictícias foram supridas com URLs/chave pública sintéticas locais, sem carregar `.env.local` real.
- Uma primeira bateria unitária teve 304 PASS e 39 FAIL: três fixtures antigas não simulavam a nova dependência e tentaram conectar ao PostgreSQL fictício ou consumiram a fila SQL na ordem antiga. Corrigida a composição dos testes, mantendo asserções anteriores e acrescentando provas de bloqueio antes dos efeitos externos. Não usar essa execução como PASS.
- As tentativas de suíte integral em um processo foram interrompidas por pressão de memória durante a validação. Não equivalem a falha funcional nem a suíte aprovada. A reexecução em lotes usa o mesmo Vitest/config, confere o conjunto exato de arquivos e a estabilidade do hash do source e não exclui testes.
- TypeScript completo `tsc --noEmit`: exit 0 na execução serial, sem relaxar tipos ou configuração.

Os resultados finais abaixo substituem somente os estados em andamento. As execuções que falharam continuam registradas; não foram convertidas em PASS retroativamente.

## Retestes incrementais

- PostgreSQL final: **43 verificações PASS**, observado em `2026-11-08T19:03:05.588Z`, 137 migrations incluindo a 0136, zero escrita remota e zero chamadas a provedores. Acrescenta rollback de importação acima da cota, repetição sem novo consumo, criação como `authenticated`, definer sem privilégios falhando fechado, refund após expiração, criação paga sem espera no lock da cota, preservação do teto administrativo do plano, cascade de uma clínica sintética paga e reagendamento bloqueado preservando a consulta original na mesma transação.
- Regressão integral inicial, em 17 lotes e com conjunto exato de **591 arquivos**: **6.402 PASS / 1 FAIL / 0 SKIP**. O único FAIL restante era a fixture administrativa WhatsApp, que não simulava a nova dependência de coorte e tentou o PostgreSQL fictício. Ela foi corrigida sem remover as asserções de permissão; acrescentada negativa de integração em trial mesmo pelo caminho administrativo.
- Reteste focal final depois dessa correção e dos adapters de feedback: **190/190 em 18 arquivos, zero skips**, incluindo o arquivo anteriormente reprovado. A composição do resultado mais recente de cada arquivo contém **594 arquivos e 6.415 asserções aprovadas**. Isso combina os lotes iniciais com os retestes afetados; **não é uma execução integral única no snapshot final**. Não repetir a bateria inteira apenas para alterar essa descrição.

## Gates finais

| Verificação | Resultado e evidência local |
| --- | --- |
| TypeScript completo | PASS, exit 0; `dist/trial-limits-final-typecheck.log` |
| ESLint completo | PASS, exit 0, sem avisos; `dist/trial-limits-final-lint.log` |
| Build Next real isolado | PASS, exit 0 em `2026-11-08T19:17:38.002Z`; `dist/security-local/build-result.json` |
| Correspondência com o build | Todos os arquivos de `src` comparados byte a byte com a cópia compilada: iguais |
| Bundle cliente | PASS, 195 arquivos examinados, nenhum achado; `dist/trial-limits-bundle.json` |
| Arquitetura de acesso ao banco | PASS, 1.698 arquivos, zero achados; `dist/trial-limits-arch.log` |
| Segurança das migrations | PASS, nenhuma operação destrutiva não aprovada; `dist/trial-limits-migration-safety.log` |
| Regressão DB multigateway candidato | PASS, 38 verificações com as 137 migrations atuais; `dist/billing-gateway-schema.json` |
| Migration remota / Preview / pagamento externo liberando trial | NOT RUN; não há ativação remota nesta entrega |

[Evidência sanitizada e hashes do source/SQL](trial-resource-limits-2026-11-08.json). Os logs brutos ficam em `dist` ignorado; nenhum payload clínico, chave ou sessão entra no relatório. O ensaio multigateway inicialmente reprovou a regra de nova conexão do guard arquitetural. O harness passou a compilar o SQL sobre a conexão loopback já existente, sem alterar allowlist ou abrir pool. Um reteste identificou dupla serialização JSON nesse adapter de teste; o binding explícito de texto corrigiu a equivalência com o driver Drizzle. A reexecução das 38 verificações passou, sem mudar o repositório de produção para acomodar a fixture.

## Comandos reproduzíveis

Na raiz do worktree, usar os binários já instalados, sem reinstalar o junction compartilhado:

```powershell
$env:NODE_ENV = 'test'
$env:DATABASE_URL = 'postgres://postgres@127.0.0.1:55491/postgres?sslmode=require'
$env:NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55492'
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_synthetic_trial_fixture'
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/trial-resource-limits.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
node node_modules/vitest/vitest.mjs run --maxWorkers=1 --minWorkers=1
node node_modules/tsx/dist/cli.mjs scripts/check-migration-safety.ts
node node_modules/tsx/dist/cli.mjs scripts/arch-db-check.ts
```

O PostgreSQL é iniciado/parado pelo harness numa pasta sintética própria; o script recusa origem remota. A fixture contém somente dados fictícios. Os comandos acima não usam `.env.local`, não chamam provedores e não aplicam migrations em DEV/produção. Rodar checks pesados em sequência nesta máquina de 8 GB. O build isolado usa `scripts/security/local-build.ts` com ambiente sintético, em vez de herdar credenciais.

## Limite da conclusão

Pagamento externo AbacatePay → worker → liberação não foi executado por esta frente. O ensaio prova a regra e a persistência locais; o gateway candidato permanece desligado. O fluxo Asaas existente recebe o hook após `markInvoicePaid`; sua origem continua autoritativa no webhook/reconcile. Não considerar o retorno do checkout, estado `ACTIVE` ou invoice sintética como homologação financeira externa.

A migration 0136 e o Preview ainda exigem a autorização específica aplicável. Não existe mudança em produção e não foi usada uma clínica real para ensaio. A geração automática de migration encontrou drift pré-existente do snapshot e não foi concluída; a proposta é SQL aditivo revisado e testado, com journal correspondente, sem incorporar o rename sugerido.
