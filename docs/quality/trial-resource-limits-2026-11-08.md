# Validação das restrições de avaliação

Ambiente: worktree `C:/dev/Qoro_billing_abacatepay_20261107`, branch `feat/billing-abacatepay-20261107`. Validação iniciada localmente; depois de autorizações específicas, 0136/0137 aplicadas somente no DEV e Preview publicado/validado. As provas locais e remotas são diferenciadas nos checkpoints abaixo. Nenhuma mensagem, convite real, cobrança, alteração de contrato ou mudança em produção.

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

## Gates do fechamento local, antes da autorização DEV

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

A aplicação remota inicialmente NOT RUN acima corresponde ao fechamento local. Após autorização específica do founder, a **0136 foi aplicada somente no DEV** em `2026-11-08T19:48:18.918Z`. Histórico conferido: 136 migrations na ordem do journal e nenhuma nova divergência, somente as seis diferenças históricas já documentadas. 0033/0037/0071 correspondem ao mesmo SQL com CRLF; a origem dos desvios 0051/0093/0124 continua não comprovada e não foi inventada. O campo/default da 0124 foi reconferido. Nenhum registro antigo de migration foi alterado ou reaplicado.

Aplicação transacional com advisory lock, `lock_timeout=5s` e `statement_timeout=60s`: postflight de 137 migrations, 13 triggers, zero contratos existentes inscritos. Os hashes agregados de todas as clínicas, perfis e assinaturas permaneceram iguais dentro da transação. Não houve escrita em produção nem fixture de cliente real. O [PR #53](https://github.com/joaomarcos-techia/Project_OS/pull/53) permanece draft. O Preview imutável do source `311e5dd0` é `https://project-m9quqazzw-clinic-os-v2-s-projects.vercel.app`.

A geração automática de migration encontrou drift pré-existente do snapshot e não foi concluída; a 0136 é SQL aditivo revisado e testado, com journal correspondente, sem incorporar o rename sugerido.

## Ensaio Preview em continuidade

`e2e/trial-resource-limits-preview.spec.ts` exige autorização explícita por env, origem Preview do projeto conhecido, fingerprint assinado de Auth/banco DEV e credenciais administrativas DEV antes de criar a fixture. Não envia e-mail/WhatsApp, conecta integração nem cria pagamento. O titular é criado por Auth Admin sem envio, seguido de clínica/assinatura sintéticas; isso **não é prova de provisionamento completo pelo cadastro público**. Trace, vídeo e screenshots ficam desativados. A fixture tem manifesto de IDs para cleanup preparado antes da primeira escrita.

Primeira execução: inscrição automática, nove contadores em desktop/mobile sem overflow, bloqueios WhatsApp/Asaas/convite e dez pacientes criados pela UI com o 11º recusado e contagem persistida passaram. O teste parou porque a preparação de procedimentos usava `duracao_min`; o schema real usa `duracao_padrao_min`. A fixture foi corrigida após conferência do schema, sem alterar produto ou asserções; o cleanup dessa execução passou. Não atribuir PASS ao E2E inteiro dessa primeira execução; o reteste completo está registrado a seguir.

**Reteste completo: PASS**, 1 E2E integrado em Chromium, cerca de 3 minutos, concluído em `2026-11-08T19:59:33.505Z`. Run ID `09855457-fcd3-4d96-be61-43869a78b3b0`. Seis estágios concluídos:

1. Nova assinatura sintética inscrita automaticamente pela 0136 no DEV.
2. Nove contadores na UI, desktop 1440 px e celular 390 px, sem overflow horizontal.
3. Bloqueios de WhatsApp/Asaas e ausência do botão de convidar antes da liberação.
4. Dez pacientes criados pela UI; 11º recusado com mensagem legível e dez linhas no banco.
5. Quatorze procedimentos preparados via SQL real; 15º criado pela UI e 16º recusado, com quinze linhas persistidas.
6. Invoice paga exclusivamente sintética e chamada da função privilegiada de liberação: aviso desaparece, convite reaparece e 11º paciente é criado pela UI. Contador histórico continua em dez.

**Cleanup PASS:** a clínica exata e seus dados foram removidos; Auth Admin removeu somente o titular sintético e a consulta posterior confirmou ausência no Auth e no banco. Nenhum checkout, pagamento, mensagem ou integração foi criado. O estágio 6 não é prova de webhook ou pagamento externo, e a assinatura da fixture não foi tratada como contrato real.

A primeira CI do PR falhou no inventário AST desatualizado: `unresolved=[]`, sem superfície sem guard, mas faltavam as três actions e as novas referências/linhas no artefato vivo. Regenerado apenas `docs/security/acoes.md` pelo gerador existente, sem editar snapshot inicial, allowlist ou configuração CI. `--check` passou: 199 actions, 61 métodos HTTP, 19 props, 453 referências de ambiente e zero pendências. [Evidência DEV/Preview sanitizada](trial-resource-limits-preview-2026-11-08.json).

## Privilégios administrativos herdados — correção 0137 aplicada no DEV

O readback adicional do DEV confirmou FORCE RLS, leitura por `authenticated`, nenhuma escrita por `authenticated` e nenhum acesso por `anon` nas duas tabelas. Contudo, `service_role` recebeu DELETE pelo default do Supabase: o GRANT restrito da 0136 não retira privilégios previamente atribuídos por default. Isso não demonstra bypass pelo usuário comum; é um excesso de privilégio administrativo nas tabelas de políticas/contadores, contrário à intenção de concessão mínima.

A 0136 aplicada e seu hash foram preservados. A migration aditiva **0137_trial_service_role_privileges.sql** revoga os privilégios de `service_role` somente nessas duas tabelas e concede novamente SELECT/INSERT/UPDATE. Não altera dados, contratos, RLS ou defaults globais. Após aprovação específica do founder, foi aplicada exclusivamente no DEV em `2026-11-08T20:17:03.202Z`, com advisory lock, lock timeout de 5 segundos e statement timeout de 60 segundos. O histórico passou de 137 para 138 migrations; nenhum arquivo anterior foi reaplicado e os hashes agregados de clínicas, perfis, assinaturas, políticas e contadores foram preservados na transação.

O harness local agora reproduz o default Supabase (`GRANT ALL` para tabelas futuras) antes da 0136. Com a 0137, **45 verificações PASS** em `2026-11-08T20:06:20.672Z`, 138 migrations, zero escrita remota/provider: inclui os 43 casos anteriores, conferência dos privilégios restritos e DELETE real negado para `service_role` com 42501. [Evidência sintética](trial-service-role-2026-11-08.json).

**Readback efetivo DEV: PASS**, `2026-11-08T20:17:09.194Z`: FORCE RLS nas duas tabelas, `authenticated` com leitura e sem escrita, `anon` sem acesso, `service_role` com SELECT/INSERT/UPDATE e sem DELETE/TRUNCATE/REFERENCES/TRIGGER. As três funções de trigger mantêm SECURITY DEFINER, proprietário privilegiado, search_path fixo e nenhuma permissão de EXECUTE para `authenticated`. Nenhum DELETE foi tentado em dados remotos para fabricar essa prova; o teste de recusa real foi somente no banco sintético. [Evidência de aplicação e pós-teste](trial-service-role-dev-2026-11-08.json). Sem alteração em produção.

O Preview imutável atualizado `https://project-n4xaxn7k6-clinic-os-v2-s-projects.vercel.app` passou smoke somente de leitura em `2026-11-08T20:14:10.952Z`: formulário de login hidratado, duas rotas privadas negadas ao anônimo e fingerprint assinado comprovando Auth/banco DEV. O source de runtime em `src` do commit `fb715b7a` é idêntico ao `311e5dd0` do E2E completo; não foi repetida a criação de pacientes/fixtures sem alteração funcional.

## CI integral do código — PASS

[Run 42518605760](https://github.com/joaomarcos-techia/Project_OS/actions/runs/42518605760), SHA `fb715b7ae31583504b008b08c0c138615615afd8`, concluído com `success` em `2026-11-08T20:23:32Z`: **594 arquivos / 6.415 testes aprovados**, coverage gate, TypeScript, lint, auditoria de dependências, arquitetura, segurança das migrations, inventário, isolamento entre clínicas, build, bundle e limites HTTP aprovados. A suíte pública do navegador teve **8 PASS / 2 SKIP**. Os SKIPs são verificações que dependem de `TURNSTILE_SECRET_KEY` e da presença do widget com site key; o build isolado não recebe essas chaves. Não contam como prova de desafio real ou configuração Production.

Esta é uma execução integral real do código, posterior aos lotes locais históricos descritos acima. As atualizações seguintes deste fechamento são somente documentação/evidências: nenhum arquivo em `src`, `scripts` ou `drizzle` mudou depois desse SHA. Não atribuir o resultado automaticamente a uma futura mudança funcional; conferir o diff antes de reutilizar a prova. Produção e a homologação externa AbacatePay continuam fora deste aceite DEV/Preview.
