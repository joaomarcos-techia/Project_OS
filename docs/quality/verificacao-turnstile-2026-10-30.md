# Verificação real de Turnstile antes da reabertura

**Reabertura concluída:** deployment `dpl_J1dQNbzxS2GL8yNHfUgYNnai1gmt` READY em `app.qoro.dev` às 22:36:38 UTC. `SIGNUP_ENABLED=true` efetivo, anual novo mantido false; página e POST temporários retornam **404**. Smoke confirmou também risco moderado sem token/com token inválido **401**, sem criar sessão. Não repetir o desafio; [fechamento da janela](publicacao-oferta-2026-10-30.md).

**Gate real concluído em Production em 30/10, às 22:27:25 UTC (19:27:25 de Brasília).** O código `fc831fa4-5c00-4c7d-bb60-8cbae6466ce1` foi correlacionado ao evento `signup.turnstile.probe.passed`, request `w9qxd-1793399245074-e60aa1b2b90f`, HTTP **200**, deployment `dpl_GJcKPw7qg4thBUVA4R1apL68qCZv`, SHA `71cc56431837856806f7d16c9d0e5249c8022a69`. Token real aceito para domínio/action esperados, replay recusado e inválido recusado pelo backend com o secret efetivo. Nenhuma conta ou cobrança foi criada. A primeira tentativa da pessoa ocorreu antes de o widget entregar token; depois passou no mesmo deployment, sem trocar chave, widget ou proteção. Não há defeito permanente de carregamento comprovado por aquela espera.

## Por que este complemento existe

O [rollout autorizado](publicacao-oferta-2026-10-30.md) publicou app/landing e aplicou as migrations, mas manteve o cadastro fechado. O Chrome automatizado retornou 600010 sem token; o diagnóstico fornecido pelo titular no Chrome habitual passou 4/4 e registrou emissão de token em 9,244 s. Essa evidência é do site da Cloudflare, não do widget/chave/backend da Qoro. [Exportação sanitizada](evidencias/turnstile-browser-diagnostic-20261030.json). O sinal de timeout da captura precede o evento de sucesso e foi preservado, sem inventar Siteverify positivo.

O controle nativo não conseguiu determinar a URL com segurança e encerrou a interação anterior. Não foram usados stealth, solver, chaves dummy ou contorno desse bloqueio. Repetir esse mesmo navegador automatizado não fecha a lacuna; a página própria permite interação humana normal e verificação pelo servidor efetivo.

## Superfície temporária e limites

- Página: `/cadastro/verificacao`; POST: `/api/signup/verificacao`. Sem login, conta, cookie de sessão, clínica, pagamento, e-mail ou dados clínicos. O resultado **não concede autorização nem reabre o cadastro**.
- Só existe com `SIGNUP_ENABLED=false` e antes de **02/11/2026 03:00 UTC (00h de Brasília)**. Ao reabrir o cadastro ou expirar, página/endpoint retornam not found; o limite temporal também protege deployments imutáveis antigos. Não há nova variável, dependência, migration ou alteração de CI/CD.
- O POST exige origem confiável por `resolveTrustedApplicationOrigin`, corpo JSON estrito limitado a 16 KiB/token até 2.048 caracteres e o rate limit existente de signup por IP. O fallback do limiter continua por instância; não se apresenta essa degradação como limite global.
- Reutiliza o verificador server-only existente, com secret do deployment. O resultado positivo exige hostname da origem confiável e action `signup-release-check`. O mesmo token precisa ser negado com `timeout-or-duplicate`; um inválido sintético precisa ser negado com `invalid-input-response`. Falha de rede/configuração ou resultado inesperado não contam como recusa válida.
- Tokens só transitam em memória/corpo POST e para Siteverify, nunca em URL, chat, storage, relatório ou logs. Logs contêm somente evento `signup.turnstile.probe.passed` e `run_id` aleatório não secreto. Não capturar trace, vídeo, DevTools ou screenshot com dados de sessão.
- O wrapper utilizado pelo signup existente mantém seus retornos. A leitura de resposta externa ganhou validação estrutural e filtragem de error codes para não registrar conteúdo arbitrário.

## Evidências da implementação

**PASS local: 58/58**, cinco arquivos, cobrindo o verificador anterior, três checagens obrigatórias, origem/domínio/action incorretos, ausência de configuração, falha do provider, corpo/tamanho/tipo, encerramento por flag e prazo, prova parcial, rede e envio concorrente na UI. São testes unitários com doubles, não PASS externo. Lint, inventário de segurança (54 métodos de rota, zero guard pendente/rota sem teste) e gate de observabilidade passaram.

Uma execução de TypeScript no worktree encontrou três erros existentes causados pela junction compartilhada com **Zod 3**, enquanto manifest/lock exigem **Zod 4.6.6**. Nenhum erro apontou aos arquivos alterados. Foi preparada cópia isolada sem `.env`, com dependências cujo manifest/lock coincidem com o candidato, preservando o worktree principal e a junction anterior. A cópia com dependências corretas passou typecheck e build. A CI do head `a1dc0c34` passou **5.828/5.828 testes em 552 arquivos**, build/TypeScript/lint e gates; [run 41136292736](https://github.com/joaomarcos-techia/Project_OS/actions/runs/41136292736). O E2E público manteve **7 PASS + 2 SKIP** por ausência de chaves no build isolado. A revisão automatizada neutral não foi contada como aprovação.

O primeiro build isolado atingiu o heap padrão de aproximadamente 2 GiB do Node (exit 134), sem diagnóstico de código. A repetição usa `CI=true` no processo de validação para selecionar o heap de 4 GiB já previsto no runner do projeto; nenhuma configuração de CI/CD, dependência ou build do produto foi alterada.

**Production: PASS.** O [PR #44](https://github.com/joaomarcos-techia/Project_OS/pull/44) foi mesclado às 22:21:38 UTC; deployment READY e alias `app.qoro.dev` conferidos às 22:24:40 UTC. Smoke **5/5**: cadastro ainda fechado, página 200/noindex, origem incorreta 403, corpo estrito 400 e token inválido recusado. Layout público 1440/375 passou; no Chromium automatizado o widget não entregou token em 25 s, registrado como BLOCKED, sem promover esse teste a PASS. O Chrome habitual forneceu depois a prova real 3/3 acima. O estado final da reabertura está no [registro da janela](publicacao-oferta-2026-10-30.md).

## Roteiro histórico — ação humana já concluída

1. No Chrome habitual, abra **https://app.qoro.dev/cadastro/verificacao**. Não use a janela automatizada nem o site de diagnóstico anterior.
2. Aguarde o widget e conclua o desafio se for solicitado. Clique uma vez em **Validar no servidor**; pode levar alguns segundos.
3. Só há PASS se aparecer **“Proteção verificada no servidor: 3 de 3 testes aprovados”**. Informe apenas o **código da verificação** mostrado. Não copie token, chave ou conteúdo do DevTools. Se houver erro, informe apenas a mensagem e o horário.
4. A engenharia correlaciona código/HTTP 200/evento nos logs, confirma ausência de conta/cobrança e registra o gate. Só então pode atualizar `SIGNUP_ENABLED=true`, fazer novo deployment e executar smoke do cadastro real, incluindo proteção moderada. A página desaparece após a reabertura. Não repetir pagamentos ou migrations.

Resultado esperado: prova no widget da Qoro e no backend com secret efetivo, sem retirar a proteção nem antecipar a abertura. O diagnóstico geral do navegador permanece uma evidência auxiliar, não seu substituto.
