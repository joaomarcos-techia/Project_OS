# Snyk: reteste e reconciliação de 27/11/2026

## Escopo e fontes

- Histórico: relatório local `Relatório de Vulnerabilidades Snyk — Project_OS.md`, referente a `5620a0987ec53db7d7358728eb7d457d9d373df3`. Ele registra **424 abertos**: 15 Open Source e 409 Code; mais 12 Code ignorados.
- Reexecução: Snyk CLI oficial 1.1309.0, organização `joaomarcos-techia`, `--remote-repo-url=https://github.com/joaomarcos-techia/Project_OS`. O binário foi conferido com o SHA256 do manifesto oficial antes do uso. Nenhuma credencial foi incluída nos arquivos do repositório.
- Candidato composto inicial: PR #64 `74823d649d8a9aa6f8842bf6cbfb9f953d0470f2` + hotfix de retenção `079754d8` + correções de código do PR #67. O reteste inicial de Code foi feito antes do endurecimento HTTPS e da atualização de `autocannon` deste ciclo. Os resultados de validação do SHA final devem ser registrados abaixo, sem herdar os checks de outro SHA.

## Resultado reproduzido

| Análise | Evidência | Resultado |
| --- | --- | --- |
| Snyk Open Source no candidato | CLI `snyk test --dev --file=package.json`, saída JSON local fora do repositório | 0 vulnerabilidades, incluindo dependências de desenvolvimento, exit 0 no código composto |
| Snyk Code no candidato | CLI `snyk code test`, SARIF local fora do repositório | 614 resultados: 606 abertos (47 altos, 340 médios, 219 baixos) e 8 ignorados; exit 1 |
| Snyk Code no snapshot histórico | Mesmo CLI e organização, worktree isolado em `5620a098` | 421 resultados, reproduzindo as 409 ocorrências abertas e 12 ignoradas do relatório antigo |
| Snyk Open Source no PR #67 `f74e1a37` | CLI `snyk test --dev --file=package.json` no worktree do PR | 0 vulnerabilidades, incluindo dependências de desenvolvimento, exit 0 |
| Snyk Code no PR #67 `f74e1a37` | CLI `snyk code test` no worktree do PR | 414 resultados: 406 abertos (14 altos, 250 médios, 142 baixos) e 8 ignorados; exit 1 |
| Comparação por `fingerprints.identity` | SARIF histórico versus candidato | 408 identidades persistem, 13 não reaparecem; 206 identidades são novas no candidato, que tem código comercial adicional |
| `pnpm audit --prod --audit-level moderate` | Lockfile do candidato inicial | Nenhuma vulnerabilidade conhecida em dependência de produção |
| `pnpm audit --audit-level moderate` | Após atualizar `autocannon` 8→9 | Nenhuma vulnerabilidade conhecida no lockfile completo |
| Snyk Secrets | CLI `snyk secrets test` | `BLOCKED`: organização retornou 403 `SNYK-CLI-0016`, recurso não habilitado; não foi ligado automaticamente |

O inventário **individual** de todos os 436 registros históricos, incluindo os 12 ignorados, está em [snyk-historical-reconciliation-20261127.csv](snyk-historical-reconciliation-20261127.csv). A lista distingue presença do mesmo fingerprint no reteste e conclusão técnica. `FIXED_VERIFIED` significa que o achado deixou de ser detectado no reteste; `FALSE_POSITIVE_REPORTED` e `NOT_APPLICABLE_REPORTED` continuam aparecendo no Snyk, sem exceção em massa. Os 15 advisories Open Source têm identificadores A1–A15 do relatório original, pois ele não contém os IDs Snyk individuais.

Dos **424 historicamente abertos**, a tabela individual resulta em 18 `FIXED_VERIFIED`, 6 `NOT_REPRODUCED`, 252 `FALSE_POSITIVE_REPORTED`, 147 `NOT_APPLICABLE_REPORTED` e 1 `REVIEW_REQUIRED`. Entre os 12 historicamente ignorados, quatro desapareceram e oito persistem. Os seis SQLi que não reaparecem mudaram de fingerprint; isso não é prova de correção de uma falha explorável.

### Revisão técnica dos alertas altos

- Os 7 fluxos SQLi altos do candidato terminam em Drizzle `sql` parametrizado, inclusive `set_config` em `tenant.ts`, `UPDATE` em `abacatepay-management.ts` e `connection-store.ts`. O scan atual contém 324 fluxos SQLi até 130 sinks distintos. Uma inspeção automatizada de contexto identificou 127 sinks com SQL tagged/query builder nas linhas próximas; os três casos remanescentes foram revisados manualmente: um executor aceita o tipo `SQL`, e dois templates `sql` aparecem após tipos genéricos. Não há `sql.raw`, `sql.identifier` nem `unsafe` nos módulos de runtime afetados. A avaliação por grupo não substitui teste de segurança de toda rota.
- Os 37 `HardcodedNonCryptoSecret` altos são literals em scripts sintéticos/operacionais ou chaves de `sessionStorage`/`localStorage`; estas chaves não são credenciais. Os 5 `HardcodedSecret` altos incluem quatro fixtures e a chave HMAC **pública** documentada da AbacatePay; a autenticação do webhook usa segredo separado. Nenhum desses 42 pontos deve ser tratado como segredo de Production com base apenas no nome da regra.
- As 2 altas `reDOS` do histórico não reaparecem após a correção do PR #67. Senhas fixas de seed/smoke e stack trace na resposta da fixture também não reaparecem.

### Achados médios e baixos

- O `DOMXSS` do link de exportação permanece reportado apesar de usar `new URL` e validar protocolo antes do `href`. O código foi endurecido neste ciclo para aceitar **somente HTTPS**; há regressão para `http:`, `javascript:` e `data:`.
- O carregamento do script dinâmico do Turnstile continua marcado como falta de SRI. A CSP restringe a origem da Cloudflare; não foi criada uma exceção automática nem declarado risco aceito.
- `InsecureHash` refere-se ao SHA-1 exigido pelo protocolo k-anonymity da HIBP e ao checksum do B2; não é hash de armazenamento de senha. `HttpToHttps` e `PT` do snapshot antigo apontam para fixtures locais ou comandos controlados pelo operador. Os 25 `PT` atuais estão em scripts, não em rotas web; revisar os comandos antes de executá-los com dados reais continua necessário.
- Os 206 achados novos incluem 86 SQLi, 58 fixtures de segredos, 26 literals em scripts/chaves locais, 22 PT de scripts e 14 de outras regras. Eles não fazem parte dos 424 abertos históricos. Estão preservados no SARIF atual para triagem por fingerprint; a contagem maior **não** pode ser chamada de 206 novas vulnerabilidades exploráveis.

## Correções desta composição

1. Preservado o hotfix publicado de retenção de **186 dias**, que faltava no PR #64.
2. Incorporadas as correções de código do PR #67: senhas de teste/seed sem literal fixo, SQL de backfill parametrizado, fixture sem stack trace de resposta e regex de cookie substituída. O override de `glob` do PR #67 foi incorporado sem sobrescrever Next 16 ou React do PR #64.
3. Atualizado somente o `autocannon` de desenvolvimento para 9.0.0. Ele usa `hyperid@4`, removendo a cadeia vulnerável `hyperid@3 → uuid@8`. O audit completo agora retorna zero advisories conhecidos. O ensaio de carga protegido não foi disparado contra serviços reais.
4. Exportação de auditoria só oferece link assinado HTTPS; teste de regressão dirigido passou (11/11).

## Limites e próximos gates

- O repositório GitHub foi conferido como `PUBLIC`, e os scans CLI com URL pública executaram. O check de PR do Snyk ainda retornou **“You have used your limit of private tests”** no PR de composição #68; a associação/classificação do check do GitHub continua incorreta ou desatualizada. O scan CLI não comprova que o painel atualizou o projeto monitorado, o SHA exibido ou que não houve faturamento. Não foi usado `snyk monitor` para criar projeto duplicado.
- O Snyk Code ainda tem resultados abertos. Não foram escondidos diretórios, desativadas regras nem adicionadas exceções em massa. A classificação técnica do CSV não altera o painel.
- Hidratação autenticada e E2E financeiro sem mutações reais ainda precisam de evidência própria antes de declarar o PR #64 pronto. Build completo, testes completos e CI já passaram no checkpoint `e39f6482`; um commit documental posterior exige seus próprios checks. Nenhuma implantação ou merge em Production é autorizada por este documento.
- O PR #55 (TISS) e suas migrations não foram incorporados à composição comercial.

## Validação da composição

- No Codespace isolado, Node 22/pnpm 11.17: `pnpm install --frozen-lockfile`, `pnpm typecheck` e `pnpm lint` passaram.
- `pnpm test`: **690 arquivos, 7.853 testes aprovados**, sem falha.
- Build direto do Next 16.4.6 sobre a composição completa: **PASS** com variáveis sintéticas de CI e sem conexão a banco ou gateway; o primeiro comando sem variáveis falhou na validação de ambiente, depois foi repetido corretamente. Há warnings de deprecação do import Sentry e da convenção `middleware`, sem falha de compilação.
- Testes dirigidos: formulário de exportação 11/11 e guards de carga 4/4. Nenhum teste de carga contra serviço real foi iniciado.
- A [CI oficial 46002485158](https://github.com/joaomarcos-techia/Project_OS/actions/runs/46002485158) terminou `SUCCESS` no SHA `e39f64822660b405604836d011112622dcf79282`: 690 arquivos e 7.853 testes, 28 E2E públicos, typecheck, lint, build, inventário, isolamento PostgreSQL e limites de segurança passaram. O Semgrep e o Preview também passaram nesse SHA. O check integrado do Snyk falhou antes da análise por "You have used your limit of private tests"; o resultado CLI acima é uma execução separada, não um check verde no PR.
- No Preview do SHA `e39f6482`, 12 recargas reais da página pública de login em desktop e 12 em móvel não geraram React #418, erro de hidratação nem `pageerror`. O E2E autenticado da assinatura não foi executado: este worktree isolado não possui credenciais sintéticas de teste. Portanto, hidratação do Qoro completo permanece `PARTIAL`.
- O novo commit documental que registrar este checkpoint precisa de CI própria antes de ser tratado como HEAD validado; não transferir os checks do SHA anterior automaticamente.
