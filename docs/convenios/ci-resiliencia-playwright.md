# CI: falha na instalação do Playwright (11/11/2026) — diagnóstico e proposta

**Status: proposta. Nada foi alterado no workflow.** O `.github/workflows/ci.yml` é compartilhado com o PR #53 e com a
`main`, então qualquer mudança depende de coordenação com o outro agente e da aprovação do fundador. Nenhum gate é
enfraquecido e nenhum E2E é removido em nenhuma das opções.

## O que aconteceu (evidência dos logs)

| Item | Evidência |
| --- | --- |
| Job | `Lint + Typecheck + Test + Build`, `timeout-minutes: 20` |
| Runner | `ubuntu-26.04`, imagem `20261101.186.1`, provisionador `20261028.624` |
| Etapa | `pnpm exec playwright install --with-deps chromium`. O `--with-deps` roda `apt-get` para as bibliotecas do sistema |
| Dependência | o índice do apt do Ubuntu (`resolute`, `resolute-updates`, `resolute-backports`, `resolute-security`) |
| Erro | `Temporary failure resolving 'azure.archive.ubuntu.com'`, `'archive.ubuntu.com'` e `'security.ubuntu.com'`: falha de **DNS** do runner para os três domínios do Ubuntu, a cada 20 s, enquanto `packages.microsoft.com` respondia no mesmo passo |
| Desfecho | `##[error]The operation was canceled.` ao estourar os 20 min do job |
| Etapas anteriores | todas verdes nas tentativas 1 e 2 do `3edb4532`: typecheck, lint, madge, `arch:db-check`, migrations, observability, registry, testes com cobertura (336 s), inventory, isolamento entre clínicas, build (194 s), segredos no bundle |
| Frequência | em 11/11, entre ~12:00 e ~14:35 UTC: runs do #55 e do #53 cancelados ou falhos no mesmo passo (#53: 43036700032, 43033198873; #55: 43039493578 tentativas 1 e 2) |
| Recuperação | o #53 passou inteiro às 17:31 UTC; o `3edb4532` foi reexecutado depois disso (resultado no plano) |
| Reprodutível? | não localmente: é a resolução de nomes no runner hospedado. O código não muda o resultado |

Conclusão sustentada pela evidência: indisponibilidade **externa** de resolução de nomes dos repositórios do Ubuntu no
runner, não um defeito do código. Não é possível afirmar a causa raiz no lado do GitHub ou da Azure, só o sintoma.

## Opções (para decidir com o #53)

1. **Cache dos navegadores do Playwright** (`actions/cache` em `~/.cache/ms-playwright`, chave = versão do
   `@playwright/test`). Reduz o download do Chromium, mas **não** resolve o `apt`: as bibliotecas do sistema continuam
   vindo do `--with-deps`.
2. **Imagem oficial do Playwright para o job de E2E** (`mcr.microsoft.com/playwright:v<versão>-noble`): as bibliotecas já
   vêm na imagem, e o passo deixa de depender do apt do Ubuntu. Exige separar o E2E num job próprio, porque o job atual
   roda também os gates em Node puro.
3. **Separar o E2E num job próprio com timeout próprio.** Os gates de código (que hoje passam antes do Playwright)
   terminariam e reportariam sozinhos, e uma queda do apt marcaria só o job de E2E. O E2E continua **obrigatório** para o
   merge (required check), então nada fica mais fraco; só fica claro qual parte caiu.
4. **Retentativa do apt** (`Acquire::Retries=5` e timeout por pedido) no passo de instalação. Ajuda em instabilidade curta,
   não em queda de DNS longa.

Recomendação: **3 + 2**: job de E2E separado, rodando na imagem oficial do Playwright, como check obrigatório. Isso tira o
apt do caminho e mantém o rigor. A 1 é um complemento barato.

## Como fica registrado até lá

O plano diferencia, por commit: testes locais aprovados; etapas de CI aprovadas; etapas bloqueadas por infraestrutura;
CI completa aprovada. Um commit só conta como "CI completa aprovada" quando todos os passos obrigatórios terminam verdes.
