# Cadastro: senha após confirmação e continuação clara

Pedido: remover a repetição de senha e permitir continuar no aparelho que confirmou o e-mail.
Branch: `fix/signup-single-password-20261031`. Implementação: [ADR-062, seção 12](../adr/062-identidade-consentimento-cadastro.md).

## Diagnóstico observado, sem inferir causa de abandono

O teste informado pelo founder em 31/10 por volta de 20h30 (Brasília) teve confirmação de e-mail
concluída, mas não houve continuação/plano nos logs consultados. A versão anterior coletava uma
senha preliminar, criava o Auth sem senha e exigia novo handoff. A página aberta pelo link apenas
afirmava a confirmação. Isso é fricção comprovada; não prova o motivo individual de abandono dos
visitantes anteriores nem que sete conversões do Ads sejam sete contas criadas.

Leitura somente de produção em 01/11/2026 00:02:34 UTC (31/10, 21:02 em Brasília): uma resposta
completa ainda preservada, vinculada ao teste recente do founder: **1 médico; mais de 100
atendimentos semanais; agenda genérica; grupo/comunidade**. Os drafts anônimos anteriores expiraram;
não há base para reconstruir suas respostas. Nenhum e-mail, identificador pessoal ou segredo é
incluído aqui. Artifact local sanitizado: `dist/quality/signup-retained-answer-summary-20261031.json`.

## Alteração

- Etapa inicial sem senha. Confirmação pelo e-mail seguida de criação de senha e escolha do plano.
- Alternativa pelo código na aba original preservada; não autoriza automaticamente uma aba anônima.
- Rota autenticada com origem, rate limit, ownership, releitura Auth, CAS, política de senha,
  reconciliação e sessão HttpOnly. Sem migration, cobrança ou mudança de contratos.
- Exceção de import privilegiado limitada à nova rota no mesmo inventário das transições de
  cadastro existentes. Não há exceção geral nem desativação de regra/teste.
- Compatibilidade com o corpo antigo de `/sessions/auth`, e-mail atualizado e retorno já pronto.

## Validação desta alteração

| Camada | Estado | Evidência |
| --- | --- | --- |
| Testes focados | PASS | 643/643 em 31 arquivos; ajuste de retomada após refresh: 28/28, incluindo três casos novos |
| TypeScript | PASS | `node node_modules/typescript/bin/tsc --noEmit`, exit 0 |
| Inventário de segurança | PASS | 196 actions, 55 métodos HTTP, zero gaps e testes de rota presentes |
| Lint/formatação | PASS | ESLint dos arquivos afetados e Prettier, exit 0; build também executou lint e tipos |
| Build de produção | PASS | Build local isolado Next 15.5.28 e build remoto do código `ea279cf6`; bundle local: 185 arquivos, zero achados |
| Regressão integral | PASS | Local inicial: 5.869/5.869 em 554 arquivos, exit 0, 241,16 s. Após ajuste: CI `ea279cf6`, **5.872/5.872**, coverage aprovado, lint/tipos/build/gates de segurança aprovados |
| Auth + Resend + DB + UI em Preview/DEV | PASS | **6/6 cenários distintos** concluídos, um worker, sem retry automático; Supabase DEV comprovado por fingerprint assinado antes das fixtures; limpeza Auth/SQL/fixture/lock verificada |
| E2E público de CI | PARTIAL | 7 PASS e 2 SKIP Turnstile por ausência de chaves no build isolado; não são 9 PASS. Não houve mudança de Turnstile nesta correção |
| Produção do fluxo novo | PASS no escopo abaixo | PR #45 publicado no merge `3fba02a3`; jornada sintética real até a escolha do plano, persistência Auth/SQL e limpeza exata verificadas. Entrega em caixa pessoal não foi retestada |

A validação local usa cópia sem `.env` com as dependências exatas do lockfile. O `node_modules`
compartilhado do worktree contém outra versão de Zod e não é substituído. Testes unitários usam
seams de provedores; não são contabilizados como E2E real. No E2E não gerar traces, screenshots ou
vídeos autenticados. Os cenários financeiros antigos não serão repetidos nesta alteração.

## E2E real e limites

[PR #45](https://github.com/joaomarcos-techia/Project_OS/pull/45), código validado `ea279cf6`,
[CI aprovada](https://github.com/joaomarcos-techia/Project_OS/actions/runs/41257072125).
Coverage global: 61,56% statements/lines, 82,51% branches e 65,64% functions; gates aprovados.
O último commit de registro altera documentação, comentários e adaptação do runner ao fluxo novo;
os checks desse SHA devem ser conferidos no PR antes de publicar.

- Preview `defb4ceb`: [deployment imutável](https://project-d97owqivr-clinic-os-v2-s-projects.vercel.app/cadastro).
  PASS da rejeição de confirmação sem sessão e da alternativa por código após confirmar no celular.
- Preview `ea279cf6`: [deployment imutável](https://project-k0zlxtt3a-clinic-os-v2-s-projects.vercel.app/cadastro).
  PASS da continuação direta no celular; conta legada sem mutação pré-OTP; adoção segura de segundo
  draft com prova do e-mail; reenvio com invalidação do link/código anteriores. As duas provas do
  primeiro Preview permanecem aplicáveis: o ajuste posterior só acrescentou retomada de finalização
  interrompida e não alterou sua lógica de autorização.
- A continuação direta também provou: senha indisponível antes da escolha; aba anônima recebe
  `401` da rota nova; tentativa de substituir uma senha já instalada é recusada e a senha original
  continua válida; página pronta não pede criar senha novamente; acesso ao plano exige prontidão.
- Retomada após refresh: injeção de falha **somente na fixture sintética**, colocando seu estado SQL
  em `uncertain` depois de instalar a senha no Auth. O formulário pediu a mesma senha, reconciliou
  e abriu o plano. Isso testa recuperação de estado parcial, sem afirmar que houve uma falha real
  de rede do provedor. Os estados `reserved` e `uncertain` também têm testes unitários.
- Os endereços são sintéticos `delivered+…@resend.dev`. O teste lê a mensagem efetivamente emitida
  pelo Resend e usa seu link/código no navegador; não prova entrega numa caixa Gmail humana.
- Não foi criado nem pago Checkout, provisionada clínica ou alterado contrato nesta rodada. Todos
  os usuários/drafts temporários foram removidos por identidade exata e readback; fixture/lock
  terminaram ausentes. Nenhum segredo ou token de confirmação faz parte deste relatório.

Spec: `e2e/signup-confirmation.spec.ts`. Runner canônico com configuração DEV/Preview e opt-in de
escrita: `node node_modules/tsx/dist/cli.mjs scripts/run-signup-confirmation-e2e.ts`. Nesta rodada,
o guard exportado `assertSignupConfirmationE2EEnvironment` foi executado por um wrapper local,
seguido de Playwright com `--project=chromium --workers=1 --retries=0 --reporter=list` e seleção dos
seis casos acima. O wrapper não copiou `.env`; passou somente a configuração necessária em memória.
O spec comprova o runtime DEV antes de escrever e recusa origens `qoro.dev`.

### Falhas encontradas nos runners e retestes

1. Leitor do código do e-mail ainda exigia o texto “digite este código”. A versão nova diz “use
   este código”. Primeiro resultado: 1 PASS/1 FAIL. O parser agora reconhece ambas as versões,
   mantendo a exigência de **exatamente um** código de oito dígitos no HTML e no texto. O cenário
   inicialmente reprovado passou na repetição; fixture/lock foram removidos mesmo na falha.
2. Dois casos ainda presumiam a senha preparada na etapa inicial. O caso de segundo draft parou
   na validação local de senha vazia; o reenvio seguinte ficou NOT RUN por execução serial. Foram
   adaptados para preencher a senha **depois** da confirmação. Os dois passaram na repetição
   (3,2 min), preservando as asserções de ownership, senha antiga e código inválido.

Nenhuma falha foi transformada em PASS por skip, retirada de asserção ou mock de integração.
Os resultados anteriores ficam registrados como falhas dos runners, corrigidas e reexecutadas.

## Publicação

Sem migration nem ajuste de variáveis. A compatibilidade do corpo antigo de `/sessions/auth`
permite rollout do app em um deployment. Não mesclar/publicar enquanto os checks do SHA final
estiverem pendentes. Depois da autorização e publicação, conferir o SHA servido, ausência do campo
de senha na etapa inicial e uma jornada controlada até a escolha de plano. Reverter o deployment
para a versão anterior se o fluxo de confirmação ou as sessões regredirem; não apagar usuários,
drafts, clínicas ou contratos para fazer o smoke passar. A campanha/medição Ads não foi alterada.

### Publicação autorizada e verificação posterior — 31/10 em Brasília

O founder autorizou expressamente **“Publicar o PR #45”**, com cabeça `d43d70c5`. Todos os checks
exigidos desse SHA estavam aprovados antes do merge, incluindo a
[CI final do PR](https://github.com/joaomarcos-techia/Project_OS/actions/runs/41258280733), com
**5.872/5.872 testes**, tipos, lint, build e gates de segurança. O PR foi mesclado em
01/11/2026 **01:03:48 UTC** (31/10, **22:03:48 em Brasília**), commit
`3fba02a3ca6c8b6e03353f354fd0e6f1d7812c53`.

A Vercel confirmou `READY`, alvo Production e alias `app.qoro.dev` no deployment
`dpl_8kdUb7FKUkgHwqG5G99RcJkz6Auh`. Não houve migration, alteração de variável, contrato, preço,
campanha Ads ou cobrança. O deployment anterior `dpl_J1dQNbzxS2GL8yNHfUgYNnai1gmt`, SHA
`71cc56431837856806f7d16c9d0e5249c8022a69`, permanece identificado para rollback.

Smoke em **01/11, 01:11–01:13 UTC** (31/10, 22:11–22:13 em Brasília), executado uma vez com uma
identidade sintética rastreável e plano de limpeza preparado antes da criação:

| Prova em `https://app.qoro.dev` | Resultado |
| --- | --- |
| Alias aponta para o merge aprovado, Production `READY` | PASS |
| `/login` renderiza e o cadastro avança pelas quatro perguntas | PASS |
| Identidade inicial sem campo de senha, CTA de confirmação por e-mail; larguras 1440 e 390 px sem overflow | PASS |
| JSON inválido e corpo válido sem autenticação na nova rota | PASS: ambos HTTP 401 genérico, `no-store`, sem estrutura de schema |
| Origem não confiável na nova rota | PASS: HTTP 403 genérico, `no-store` |
| UI envia a solicitação de confirmação; identidade e draft exatos correspondem ao DB/Auth de Production | PASS: tentativa concluída e senha ainda pendente |
| Callback real com o token efetivamente emitido pelo Auth para essa identidade | PASS: sessão estabelecida e formulário somente de senha |
| Definir senha uma vez e abrir “Escolha seu plano” | PASS: POST `/api/signup/password` HTTP 200, opções Consultório/Clínica visíveis |
| Voltar à confirmação depois de definir a senha | PASS: link “Escolher plano”, sem pedir novamente a criação da senha |
| Persistência Auth/SQL e fronteira financeira | PASS: e-mail confirmado, marker `set`, vínculo exato; nenhum profile, plano salvo ou recurso de billing |
| Remoção da identidade e do draft sintéticos | PASS: escopo exato, ausência de ambos comprovada por readback |

**Limite da prova:** o token já emitido foi lido apenas em memória no registro Auth da identidade
sintética e utilizado pelo callback real. Não foi gerado um token substituto nem simulado um
provider. Esta prova não leu a mensagem no Resend nem uma caixa de entrada pessoal em Production;
portanto não equivale a um E2E de entrega externa de e-mail. As seis jornadas Preview/DEV com
leitura real da mensagem do Resend continuam sendo a evidência dessa camada. Nenhum Checkout foi
aberto, clínica provisionada, sessão exportada, trace, vídeo ou screenshot autenticado gravado.

**Ocorrência do runner e correção da verificação:** o primeiro probe concluiu a navegação mas
falhou ao exigir `consumed_at = null`, recusando a limpeza com segurança. O código canônico já
preenche esse campo na confirmação de e-mail; isso não significa provisionamento de clínica.
Não foi necessário alterar o produto. Um finalizador da **mesma fixture**, sem repetir o cadastro,
confirmou `email_verified`, marker `set`, vínculo exato e ausência de profile/billing. Só então
removeu os dois registros sintéticos e verificou suas ausências. A falha original do runner foi
preservada separadamente, sem conversão silenciosa para PASS.

Logs consultados às **01:13:27 UTC**, apenas do novo deployment desde o início do smoke:
quatro requisições à nova rota (**200 × 1, 401 × 2, 403 × 1**), zero HTTP 5xx e zero entradas
runtime `level:error` na janela consultada, sem paginação pendente. Isso descreve a amostra,
não garante ausência futura de erros.

Artifacts locais sanitizados: `dist/quality/signup-production-smoke-fixture-20261101.json`,
`signup-production-smoke-20261101.json` (inclui o erro do probe),
`signup-production-smoke-final-20261101.json` e `signup-production-logs-20261101.json`.
A [CI do merge na main](https://github.com/joaomarcos-techia/Project_OS/actions/runs/41259463271)
terminou **PASS**: **5.872/5.872 testes em 554 arquivos**, coverage aprovado, tipos, lint, build,
auditoria de dependências, inventário, isolamento e segurança do bundle/HTTP aprovados. E2E
público: **7 PASS e 2 SKIP Turnstile**, por ausência de chaves no build isolado; não são nove PASS.
Não houve mudança do Turnstile e o skip não substitui a evidência real de Production anterior.
