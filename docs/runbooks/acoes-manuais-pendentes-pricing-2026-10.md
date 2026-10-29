# Ações humanas pendentes — oferta 2026 (Preview e Sandbox)

Atualizado em 28/10/2026. Este documento contém somente ações que exigem uma pessoa ou acesso ao painel indisponível à automação. **Não altere produção, não use cartão real, não copie chaves, senhas, OTP ou URLs com bypass para o chat.** Os testes de código, migrations DEV, fixtures e readbacks pertencem à engenharia e não devem ser repetidos manualmente. A nova tabela ainda não está pronta para contratação no app em produção, embora a landing pública já anuncie os novos preços. A landing publicada promete até **10 profissionais e equipe ilimitada**; o candidato do app limita a **5 médicos e 3 logins de equipe**. O [PR draft da landing #3](https://github.com/joaomarcos-techia/landing_page/pull/3) corrige a promessa no Preview; falta publicação coordenada. As variantes de 3–5 médicos foram ativadas só no DEV; isso não autoriza contratar em produção. O Checkout de médico adicional e o de uma **conta completamente nova** foram pagos e validados no Asaas Sandbox/Preview; não há nova ação humana de pagamento para esses gates. Evidências em [contas novas e legadas](../quality/contas-novas-e-legadas-2026-10-26.md).

Os limites e o trial de 14 dias foram preparados no [PR draft da landing #3](https://github.com/joaomarcos-techia/landing_page/pull/3), sem mexer em produção. Em 25/10, o deployment imutável `fa8b67c` passou **4/4** verificações em Chromium externo (home/preços, desktop/celular, texto, CTA, cancelamento anual e largura). A proteção da Vercel já foi atravessada pela CLI autenticada para esses testes; ela não exige compra. O Turnstile positivo/negativo passou automaticamente em Previews separados em 26/10; a configuração temporária de teste foi removida. A configuração efetiva de **Production** ainda exige conferência antes de reabrir o cadastro. A inspeção humana abaixo fica para julgamento visual e para a comparação final com o cadastro real depois da publicação coordenada. Não há necessidade de repetir o build local nem de abrir o PR #1 antigo.

## Opcional — Revisão visual humana da landing candidata

**Objetivo.** Confirmar que a landing realmente publicada mostra uma oferta coerente com o checkout e os limites do app em desktop e celular. O conteúdo textual atual já reprovou: a landing anuncia até 10 profissionais/equipe ilimitada, o candidato do app permite 5 médicos/3 logins e a `main` do app ainda oferece a tabela legada. Esta inspeção visual só fecha depois de corrigir a divergência. O app já teve `/oferta-preview` inspecionado automaticamente nas duas larguras, sem overflow.

**Pré-requisitos.** A inspeção automatizada de `/` e `/precos`, desktop e celular, passou 4/4 no Preview da landing `81341c4` em 29/10. Não precisa repetir para liberar a engenharia; esta etapa fica para julgamento visual/comercial. Se a Vercel pedir login, entre com uma conta autorizada no time `clinic-os-v2-s-projects`. Para a conferência final em produção, a engenharia deve informar os SHAs reconciliados. Não use o PR draft #1 da landing como referência atual.

**Link.** [Landing mensal — preços no Preview imutável](https://landing-page-8kg1zwlm9-clinic-os-v2-s-projects.vercel.app/precos), [home no mesmo Preview](https://landing-page-8kg1zwlm9-clinic-os-v2-s-projects.vercel.app/), [landing pública — preços](https://qoro.dev/precos) e [home pública](https://qoro.dev/). O [PR #42 do app](https://github.com/joaomarcos-techia/Project_OS/pull/42) contém o link de deployment atualizado; ele não prova o checkout de produção. Não usar o link antigo `6088143c` para validar o código mensal atual.

**Atenção ao CTA.** O `/comecar` da landing em Preview ainda encaminha para `https://app.qoro.dev/cadastro`, pois `src/lib/comecar.ts` usa esse destino constante. **Não use esse botão para testar pagamento Sandbox:** ele leva ao app de produção. Para examinar a nova oferta sem criar conta, abra o link direto do app Preview acima; testes de Checkout devem usar o roteiro de fixture isolada do app.

**Passo a passo.**

1. Abra a home e `/precos` do **Preview corrigido**. Confira o nome, preço, trial, cota de médicos e de equipe e destino dos CTAs. O Preview já deve apresentar 5 médicos, até 3 usuários de equipe e 14 dias desde a criação da conta. A landing pública ainda mostra 10/equipe ilimitada/7 dias e o CTA de contratação não corresponde ao app; registre isso como FAIL atual, não como falha do Preview.
2. Compare Consultório com 1 médico e Clínica com 2, 3 e 5 médicos. Os valores mensais do candidato são R$ 197, R$ 397, R$ 544 e R$ 838. Quatro logins de equipe e seis médicos não devem ser oferecidos para contratação automática. **Nenhuma nova contratação anual deve ser oferecida nesta fase**; o código anual fica preservado para contratos existentes e futura liberação. A referência de 500 conversas por médico gera avisos, sem bloqueio automático. Nesta branch da landing, preço e CTA ainda antecipam o checkout atual; não marque coerência final como PASS.
3. No navegador, use F12 → modo celular (largura próxima de 375 px). Repita a conferência, role até o fim, confira ausência de corte lateral, texto legível, foco por Tab e mensagens de erro quando houver entrada numérica.
4. Confira se o contato para clínicas maiores aponta para `wa.me/5588996822198`; não é necessário enviar mensagem. **Depois do rollout coordenado**, repita a inspeção em `qoro.dev` e acesse o cadastro apenas até a seleção de plano, sem criar conta, para conferir que preço e prazo exibidos combinam com a promessa pública.

**Resultado e evidência.** Anote SHAs dos deployments, navegador, largura, página, valores, destinos dos CTAs e qualquer elemento cortado. Screenshot pode mostrar apenas a proposta pública, nunca sessão, cookies, DevTools ou dados de pacientes. Resposta curta ao agente: `Landing SHA … / app SHA …: desktop/mobile coerentes ou divergência …`.

**Problemas comuns.** Se a landing pública mostrar uma versão diferente da branch em revisão, confirme o SHA do deployment antes de concluir. A página `/precos-preview` do PR #1 é histórica e não substitui o conteúdo publicado. Se o cadastro mostrar Solo/Clínica/Pro depois de clicar num CTA que promete Consultório R$ 197, registre FAIL e não crie Checkout.

**Próximo passo.** Entregue o resultado ao agente; ele confrontará com o catálogo e o checkout ativos antes de considerar a oferta pronta.

## Opcional — Investigar a entrega histórica do Checkout anual no Asaas Sandbox

**Objetivo.** Uma **nova** mensalidade pós-trial já teve entrega real `Asaas → Preview` e estado final comprovados em 26/10, com fixture removida. A compra **anual de 23/10** chegou ao estado correto por readback autenticado, mas não foi comprovado que seu webhook entregou o evento. Os logs de 23/10, 17h–21h UTC, não mostraram chamada a `/api/webhooks/asaas` no Preview. Em 26/10, a API do Asaas Sandbox mostrou a configuração SaaS permanente desativada e apontando para um Preview antigo; não se sabe desde quando. Esta conferência é investigação histórica, não requisito para repetir a prova causal nova. Não crie outra cobrança para este diagnóstico.

**Pré-requisitos.** Entre na conta **Sandbox** usada pelo Checkout anual; não use a conta real. Tenha acesso a **Integrações → Logs de Webhooks**. Não copie a URL completa se ela contiver bypass, nem token de autenticação, chave API ou corpo de evento. A configuração atual já foi medida automaticamente; não a reative.

**Link.** [Painel Asaas Sandbox](https://sandbox.asaas.com/). A [documentação oficial de Logs de Webhooks](https://docs.asaas.com/docs/webhooks-logs) descreve onde localizar horário, destino e status HTTP.

**Passo a passo.**

1. Em **Integrações → Logs de Webhooks**, filtre 23/10/2026 entre **14h e 18h de Brasília** para a configuração de assinatura SaaS, cujo destino termina em `/api/webhooks/asaas` (sem `/patient/`). Não confunda com os dois webhooks de cobrança de paciente.
2. Anote apenas tipo do evento, horário, resultado da entrega e código HTTP. Se não houver registro, escreva “nenhuma entrega localizada”; isso não prova sozinho o estado histórico da configuração.
3. Envie somente: `Webhook SaaS Sandbox em 23/10: [evento, horário e HTTP / nenhuma entrega localizada]`. Não envie payload, URL, token ou e-mail do painel; não faça replay nem reative a configuração antiga.

**Resultado esperado.** Uma entrega `PAYMENT_CONFIRMED` ou `PAYMENT_RECEIVED` para o endpoint SaaS responde **HTTP 200** e aparece também nos logs do deployment destinatário. A configuração por si só não é prova de entrega, e a invoice anual já paga não deve ser usada como substituto da evidência. O [Asaas disponibiliza os logs de entrega somente pela interface](https://docs.asaas.com/docs/webhooks-logs).

**Problemas comuns e próximo passo.** A configuração permanente atual já aponta para outro deployment e está inativa; deixe-a intacta. A prova causal nova foi concluída com webhook temporário identificado e cleanup. Se não houver registro da entrega de 23/10, mantenha o estado histórico como não comprovado; se houver HTTP diferente de 200, informe só o código e horário para correlacionar, sem reenviar o payload.

## Obrigatória antes de reabrir o cadastro — Conferir Turnstile de Production

**Objetivo.** Os dois testes com chaves de teste passaram em Preview, mas os dois E2E da CI isolada foram SKIP e não provam a configuração de Production. O backend verifica tokens via Cloudflare somente quando o risco da sessão é moderado; nesse caminho, chave ausente ou inválida fecha o desafio. Sessões de risco baixo não passam por Turnstile, por desenho atual. Não registrar as chaves em screenshots ou chat.

**Já feito em 29/10.** A CLI autenticada confirmou `NEXT_PUBLIC_TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` no ambiente Production, sem leitura/exposição dos valores. A leitura do cadastro publicado e de 20 bundles encontrou chave pública com formato real e nenhuma chave dummy conhecida. Não precisa repetir essa presença. Ainda faltam a correspondência do widget/domínio e o teste funcional do desafio real antes da reabertura.

**Pré-requisitos e links.** Acesso de administrador ao [projeto `project-os` na Vercel](https://vercel.com/clinic-os-v2-s-projects/project-os/settings/environment-variables) e ao [Cloudflare Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile). Confira apenas **nomes, ambiente e domínio**: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` precisam existir para Production e pertencer ao mesmo widget real. Não use as chaves públicas de teste `always-pass` ou `always-fail` no deployment de Production.

**Passos.** 1. Na Vercel, filtre **Production** e confirme a presença das duas variáveis; não revele nem copie seus valores. 2. No Cloudflare, confirme que o widget correspondente aceita o domínio `app.qoro.dev` e está ativo. 3. Após o deployment candidato, com cadastro ainda fechado, peça à engenharia um teste sintético do desafio real positivo e negativo; só reabra após esse PASS. 4. Se faltar variável, widget ou domínio, mantenha cadastro fechado e informe apenas qual item falta. Alterar variáveis exige **novo deployment** para atingir a aplicação.

**Evidência e resposta.** Envie `Turnstile Production: variáveis [presentes/ausentes], widget [ativo/inativo], domínio [correto/incorreto], novo deployment [sim/não]`, sem chaves. O resultado esperado é configuração coerente e rejeição server-side de token inválido no teste de risco moderado.

## Obrigatória antes de tráfego clínico — Conferir o tier Gemini do projeto de produção

**Objetivo.** A landing afirma que as mensagens são processadas pela API paga do Gemini, cujo tratamento de dados difere do tier gratuito. Uma chave presente na Vercel não comprova billing ativo, tier ou saldo. Esta conferência exige o titular da conta Google e não autoriza compra automática.

**Pré-requisitos.** Acesso administrativo ao Google AI Studio e identificação, no painel da Vercel, de qual **projeto** emite a chave `GEMINI_API_KEY` de Production; não abra nem copie o valor da chave. Se houver vários projetos, confirme o projeto pelo identificador não secreto e pela administração da chave.

**Links oficiais.** [AI Studio — projetos](https://aistudio.google.com/projects), [AI Studio — cobrança](https://aistudio.google.com/billing) e [documentação de cobrança](https://ai.google.dev/gemini-api/docs/billing).

**Passo a passo.**

1. Entre em **Projects** e selecione o projeto que fornece a chave de Production ao Qoro. Na coluna **Billing Tier**, confira se está em um tier pago; registre só o nome do tier, nunca a chave.
2. Entre em **Billing**. Confira se o plano é Prepay ou Postpay e se o estado está ativo. Se for Prepay, confira saldo positivo e alertas de crédito baixo. Se aparecer **No credits**, chamadas podem parar com HTTP 402.
3. Se o projeto estiver no Free e você quiser habilitar o Paid, pare e autorize o custo: o Google informa que a ativação pode exigir pelo menos **US$ 5** de crédito pré-pago, além do consumo por tokens. Não clique em **Set up billing** ou **Buy credits** até decidir o orçamento.
4. Envie ao agente apenas `Gemini Production: projeto [ID não secreto], tier [Free/Paid], plano [Prepay/Postpay], estado [ativo/sem créditos], limite mensal [valor ou ausente]`. Não envie fatura com dados pessoais, senha nem API key.

**Resultado esperado e evidência.** Projeto correto, Paid ativo e, se Prepay, saldo positivo. Um print recortado da linha de tier/estado, sem credenciais, é suficiente. Se a UI divergir, use o procedimento da [documentação oficial](https://ai.google.dev/gemini-api/docs/billing) e informe os rótulos encontrados. O agente confrontará esse estado com a configuração efetiva da Vercel sem copiar segredo DEV para Production.

## Decisão contratual e revisão humana antes do lançamento

**Objetivo.** Validar linguagem de preço, trial, anual, aviso de uso de IA, custo Meta/Asaas e contratos existentes. A engenharia não deve inventar condição comercial ou jurídica.

**Pré-requisitos.** Versão final do app/landing e responsável jurídico/contábil da Qoro. Consulte [decisões da oferta](../specs/decisoes-oferta-e-precificacao-2026-10.md) e [roteiro técnico](validacao-nova-oferta-2026-10.md).

**Passos.** Revise a redação dos Termos e das telas contra os valores contratáveis, confirme a permanência integral do desconto vitalício do contrato existente, decida a comunicação para demais contratos legados e aprove ou devolva alterações. Não altere uma assinatura no Asaas para “testar” esta etapa.

**Resultado e evidência.** Documento/versão aprovada e data, sem dados pessoais do cliente de desconto. Resposta ao agente: `Texto comercial/jurídico versão … aprovado` ou `ajustes necessários: …`.

**Próximo passo.** Engenharia confronta aprovação com implementação e evidências de Sandbox antes de discutir publicação conjunta app/landing.

## Limpeza local opcional — scratch sintético do gate de restore

Em 26/10, a engenharia iniciou e **parou** um Postgres 17 local descartável para testar o `restore:test` com dumps sintéticos. A política do executor bloqueou a exclusão recursiva, apesar de o caminho ter sido verificado. Não há dados de produção nessa pasta e ela não é usada pelo Qoro.

No Explorador de Arquivos do Windows, cole `C:\Users\joaom\AppData\Local\Temp\qoro-restore-probe-1792989843298` na barra de endereço. Confira que o nome da pasta é exatamente `qoro-restore-probe-1792989843298` e exclua **somente essa pasta**. Antes da exclusão, a engenharia confirmou `pg_ctl: no server running` para o `pgdata` dela. Se a pasta não existir, a limpeza já foi feita; não procure nem exclua outra instalação do PostgreSQL. Esta limpeza não comprova recuperação de backup de produção.

## Limpeza local opcional — dois scratches sintéticos dos testes de migrations

**Objetivo.** A pasta anterior `qoro-scratch-schema-JBdqPE`, com restore parcial da cópia Production, **já foi excluída pelo usuário**; `Test-Path` confirmou que ela não existe. Não a procure novamente. Em 27/10, dois testes de migrations criaram outros clusters descartáveis com **somente dados sintéticos** e saíram 0, mas a limpeza interna deixou as pastas `qoro-scratch-schema-JL9r9p` e `qoro-scratch-schema-vcDI5M`. A revisão automática rejeitou a remoção recursiva com `blocked by policy`. Foi confirmada a ausência de processos PostgreSQL associados às duas pastas. Não use esses clusters para a prova de restore.

**Passos no Explorador do Windows.** Pressione `Win+E` e abra `C:\Users\joaom\AppData\Local\Temp`. Localize os nomes **exatos** `qoro-scratch-schema-JL9r9p` e `qoro-scratch-schema-vcDI5M`. Selecione somente essas duas pastas e use `Shift+Delete`. Não toque nos outros diretórios `qoro-scratch-schema-*`, no artifact cifrado `qoro-prod-backup-verify-*`, no PostgreSQL instalado ou no projeto. Se um nome não existir, essa pasta já foi limpa. Se o Windows disser que está em uso, pare e informe a mensagem.

**Evidência e próximo passo.** Responda apenas `Scratches sintéticos removidos` ou `Não consegui: [mensagem sem dados sensíveis]`. Não envie arquivos do banco nem screenshot do conteúdo. A recuperação lógica já foi comprovada em outros contêineres isolados; essas pastas não bloqueiam o lançamento.

## Obrigatória antes do rollout — cofre independente, Auth e aceite de recuperação

**Objetivo.** A cópia e a restauração real de Storage foram autorizadas e concluídas em 29/10: **5 buckets, 42/42 hashes iguais, 38 arquivos privados negados ao anônimo e 4 públicos conferidos**. Não é necessário pagar outro projeto nem repetir a prova. A pasta local cifrada tem ACL restrita e a chave fica protegida pelo Windows em outra pasta. Falta proteção contra perda da máquina/perfil, rotina recorrente, inventário Auth e aceite do risco de operar sem PITR. Ver [runbook de recuperação](disaster-recovery.md).

**Pré-requisitos e links.** Tenha um destino local criptografado ou cofre de backup aprovado, com espaço, controle de acesso, retenção e cópia fora da máquina. Acesse o [Supabase Dashboard](https://supabase.com/dashboard/projects) com permissão administrativa somente para conferir Storage/Auth; não clique em Restore no projeto ativo. Consulte a [documentação oficial de backups](https://supabase.com/docs/guides/platform/backups) e de [Storage](https://supabase.com/docs/guides/storage).

**Passo a passo.**

1. Abra `Win+E` e cole `%LOCALAPPDATA%\Qoro\Recovery\storage-20261029`. A cópia está em `qoro-storage-S0upJf`. Não abra os arquivos como documentos nem os envie por chat. A chave está em `%LOCALAPPDATA%\Qoro\RecoveryKeys\storage-20261029.dpapi`; ela depende do perfil Windows atual e **não basta copiar esse arquivo para outro computador**.
2. Informe qual cofre/destino independente já aprovado pela Qoro pode guardar a chave recuperável e a cópia cifrada, com responsáveis, retenção e controle de acesso. Não faça upload para Drive pessoal, Git ou CI por conta própria. A engenharia prepara a exportação protegida da chave para esse cofre; a senha existente de backup não foi reutilizada porque não atende ao requisito de comprimento do novo envelope. Nenhuma credencial foi alterada. Até existir uma cópia/chave independente, uma perda da máquina continua sendo risco relevante.
3. Entre no projeto `qoro-prod` no [Supabase](https://supabase.com/dashboard/project/shlcbxawrxuaebazuiue/auth/url-configuration). Em **Authentication**, registre no cofre: URL/redirects; métodos e provedores habilitados; SMTP/remetente; templates; sessões/refresh; MFA; CAPTCHA/rate limits; hooks e localização das chaves/JWT/variáveis Vercel. A leitura pública comprovou apenas e-mail habilitado e confirmação obrigatória; o token administrativo disponível retornou 401. Não envie um novo token pelo chat. Se preferir liberar a automação, execute `npx --yes supabase@2.122.0 login` no terminal e conclua a autenticação legítima, depois avise; não cole o token como mensagem.
4. Avalie formalmente o **RPO de planejamento ~24h entre backups saudáveis**, maior se uma execução falhar, e o RTO completo ainda não medido. A prova local de arquivos não mede a reconstrução de todo o serviço. Confirme a contingência operacional para registros criados após o último backup; a decisão de não contratar PITR não equivale ao aceite automático da perda potencial.
5. Envie somente: `Cofre/destino independente [nome/localização geral]; Auth inventário [completo/faltantes por grupo] ou CLI autenticada; RPO/RTO [aceito/preciso discutir]; responsável [função]`. Não envie chaves, senha, conteúdo de pacientes ou URLs assinadas.

**Resultado esperado.** Cópia e chave recuperáveis fora do domínio de falha desta máquina, inventário Auth completo e risco residual explicitamente tratado. O restore local do banco e do Storage já passou; o gate remanescente é operacional, não instalação ou novo pagamento.
