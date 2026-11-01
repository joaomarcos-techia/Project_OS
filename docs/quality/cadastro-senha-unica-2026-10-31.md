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
| Produção do fluxo novo | NOT RUN | Código ainda não publicado |

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
