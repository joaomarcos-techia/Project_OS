# Cadastro: entrega e correção de e-mail — 09/11/2026

## Diagnóstico e escopo

A consulta de Produção anterior, somente de leitura, encontrou dez contas autônomas desde 30/10: duas confirmadas e oito pendentes, incluindo um teste conhecido do founder. Cinco envios pendentes tinham confirmação de entrega SMTP; três tinham bounce. Um endereço possuía erro de domínio. Entrega SMTP não prova caixa de entrada, leitura nem abandono; não há relato confirmado de falha por aparelho. Não atribuir todos os casos a spam ou à confirmação.

SPF e DKIM estavam verificados, DMARC em monitoramento, tracking desligado e webhook Resend habilitado. Nenhuma mudança de DNS, contratação ou envio aos leads foi realizada nesta correção. A causa reproduzida na interface era a ausência de feedback para a falha de entrega já registrada, somada à repetição dos nomes após recarregar um cadastro salvo.

Baseline: `main` em `534995b0a41d3b856fa0310e9e4359245a44589a`. Worktree exclusivo `Qoro_signup_email_fix_20261109`, branch `fix/signup-delivery-recovery-20261109`. Não altera a branch financeira, o worktree da UI nem Produção.

## Alteração entregue

- Sugestão explícita para erros conhecidos em domínios comuns. O usuário escolhe usar a sugestão ou manter o endereço; domínios próprios continuam aceitos. Sem correção silenciosa ou validação DNS bloqueante.
- A tela de código mostra entrega atrasada ou recusada, sem expor payload, recibo, identificador de usuário ou detalhe SMTP. Reutiliza o polling existente; não aumenta frequência nem faz reenvio automático.
- Uma nova rota privada ao cookie anônimo permite corrigir apenas o endereço de um draft vivo, não verificado, sem confirmação/envio em andamento. Origin, limite de identidade, corpo estrito/capado, endereço atual e versão devem coincidir. Uma operação atômica invalida código/recibo anteriores e preserva respostas, nomes, consentimento, risco, tentativas de proteção e datas originais.
- Correção não renomeia, adota ou exclui usuário Auth existente. O novo endereço passa novamente pela criação/validação normal. A senha não é copiada entre identidades; nesse caso específico é necessário informá-la para o endereço corrigido. Isso é explicado na tela. A confirmação normal continua sem pedir a senha duas vezes.
- Cadastro com dados já salvos retoma com e-mail/senha, sem exigir novamente nome, clínica ou respostas. Alterar nome/clínica é uma ação explícita.
- Retomada em outro navegador usa a recuperação segura já existente. O código não ganha autoridade fora da sessão em que foi emitido.

## Evidências locais

| Verificação | Resultado e limite |
|---|---|
| Testes focados | 141/141, sete arquivos. Hints, DTO, rotas/CSRF/rate limit, feedback, correção, erros, conflito e retomada da interface. Mocks são explícitos. |
| PostgreSQL descartável | 7/7, 136 migrations reais, zero rede externa e zero escrita em Produção. CAS entre abas; preservação de staging/risco/consentimento/TTL; invalidação do código/recibo; recusa de sessão expirada, outro cookie/endereço, confirmação reservada, envio incerto e fluxo legado. |
| TypeScript final | PASS, exit 0. |
| Lint, inventário e CI | Registrar resultado final abaixo; não herdar PASS do baseline. |
| Interface desktop/mobile | Spec preparada em 1440/390 px, com respostas HTTP sintéticas. Não prova entrega no provedor, Auth ou banco remoto. Resultado de execução no registro final. |

Comandos específicos: `node node_modules/vitest/vitest.mjs run` com os sete arquivos afetados; `node --conditions=react-server node_modules/tsx/dist/cli.mjs scripts/security/signup-email-correction-db.ts`; `node node_modules/typescript/bin/tsc --noEmit`. Logs/JSON locais ficam em `dist`, ignorado pelo Git.

Um teste antigo de UI exigia repetir os nomes salvos; foi ajustado para exigir a preservação e a edição explícita, sem remover a cobertura. O ensaio de banco inicialmente reutilizava o mesmo e-mail entre fixtures e sofreu interferência entre casos; passou após usar identidades únicas, mantendo as asserções. O inventário inicialmente sinalizou a nova rota para revisão; o guard foi cadastrado explicitamente após os testes, sem relaxar o checker.

## Limites e publicação

Sem migration, dependência, alteração de CI/deploy, preço ou contrato. Não enviar novos e-mails pelo Resend nesta prova: o webhook compartilhado observa envios e gravaria eventos em Produção. Os novos testes de browser são deliberadamente limitados à interface; as provas reais anteriores de código/Auth/entrega continuam com o seu recorte.

Ainda depende do novo Preview/CI e de autorização específica para publicar em Produção. Os leads não recebem recuperação automaticamente. O estado pendente pode refletir entrega recusada, desinteresse ou ausência de interação; esta correção não inventa uma causa individual nem garante a caixa de entrada.

## Gates locais e encaminhamento

Lint integral, TypeScript final, Prettier dos arquivos executáveis alterados, `git diff --check` e inventário de segurança passaram. O inventário contém 196 ações, 62 métodos HTTP, zero guard sem revisão, zero drift de env pública e zero teste de rota ausente/regredido. Não houve alteração do checker para aceitar a rota: o registro descreve o guard testado.

O Preview e a CI serão registrados após executar o novo SHA. Nenhum resultado remoto é herdado do código anterior. Sem novas escritas remotas de dados ou envios de e-mail.
