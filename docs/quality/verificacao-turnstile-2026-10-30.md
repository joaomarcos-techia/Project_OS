# Verificação real de Turnstile antes da reabertura

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

Uma execução de TypeScript no worktree encontrou três erros existentes causados pela junction compartilhada com **Zod 3**, enquanto manifest/lock exigem **Zod 4.6.6**. Nenhum erro apontou aos arquivos alterados. Foi preparada cópia isolada sem `.env`, com dependências cujo manifest/lock coincidem com o candidato, preservando o worktree principal e a junction anterior. O build/typecheck/CI desse candidato ainda precisam de resultado antes da publicação; os PASS de 5.780 testes do rollout anterior não aprovam código novo.

O primeiro build isolado atingiu o heap padrão de aproximadamente 2 GiB do Node (exit 134), sem diagnóstico de código. A repetição usa `CI=true` no processo de validação para selecionar o heap de 4 GiB já previsto no runner do projeto; nenhuma configuração de CI/CD, dependência ou build do produto foi alterada.

**Production: NOT RUN para a página e o POST novos até deployment aprovado.** O cadastro permanece fechado. Não abrir o link abaixo antes de a engenharia confirmar que esse candidato está READY em `app.qoro.dev`.

## Uma ação humana, depois do deployment

1. No Chrome habitual, abra **https://app.qoro.dev/cadastro/verificacao**. Não use a janela automatizada nem o site de diagnóstico anterior.
2. Aguarde o widget e conclua o desafio se for solicitado. Clique uma vez em **Validar no servidor**; pode levar alguns segundos.
3. Só há PASS se aparecer **“Proteção verificada no servidor: 3 de 3 testes aprovados”**. Informe apenas o **código da verificação** mostrado. Não copie token, chave ou conteúdo do DevTools. Se houver erro, informe apenas a mensagem e o horário.
4. A engenharia correlaciona código/HTTP 200/evento nos logs, confirma ausência de conta/cobrança e registra o gate. Só então pode atualizar `SIGNUP_ENABLED=true`, fazer novo deployment e executar smoke do cadastro real, incluindo proteção moderada. A página desaparece após a reabertura. Não repetir pagamentos ou migrations.

Resultado esperado: prova no widget da Qoro e no backend com secret efetivo, sem retirar a proteção nem antecipar a abertura. O diagnóstico geral do navegador permanece uma evidência auxiliar, não seu substituto.
