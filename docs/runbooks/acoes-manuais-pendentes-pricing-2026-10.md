# Ações finais — oferta mensal 2026

Atualizado em **29/10/2026**. Primeiro a engenharia, depois as aprovações humanas, por último uma janela autorizada. **Não há autorização para merge, deploy, migrations ou alteração de contratos em Production.** Não enviar chaves, senhas, OTP, payloads clínicos ou URLs com bypass por chat.

Já concluído, sem repetição manual: login administrativo Supabase; inventário e snapshot cifrado de 243 configurações Auth; restore do banco e 14 migrations no clone; restore de 42 arquivos Storage; ensaio Auth sintético real; pagamentos Sandbox de conta nova e médico adicional. O código do pacote portátil e o monitor de saúde estão preparados; o destino independente ainda não foi escolhido. Ver [recuperação portável e rotina](recuperacao-portavel-e-rotina-2026-10.md) e [gates técnicos](../quality/gates-tecnicos-oferta-2026-10-29.md).

A landing pública e o app publicado ainda não receberam o rollout conjunto. A oferta candidata é mensal: Consultório R$197/1 médico, Clínica R$397/2 médicos; adicional R$147 até 5 no total; 3 acessos de equipe e trial de 14 dias desde Auth. Contratos antigos preservados. Nenhuma nova compra anual será oferecida nesta fase.

## Respostas já recebidas do titular em 29/10 — não pedir novamente

- **Custos:** não comprar nem contratar serviços adicionais. Não foi escolhido um destino independente apenas por essa resposta; a cópia/chave fora desta máquina continua pendente, usando um recurso já disponível quando aprovado.
- **Perda entre backups:** o titular informou que entende a perda potencial e a considera aceitável neste momento. Esse aceite fica restrito à perda entre backups diários saudáveis (~24h de planejamento, maior se uma execução falhar). Não equivale a aceitar RTO completo desconhecido, perda da máquina/cofre ou a autorizar o lançamento.
- **Turnstile:** screenshot recebido mostra três widgets, incluindo `app.qoro.dev (Spin)` em modo Managed, com três hostnames. A lista não revela quais hostnames estão autorizados nem o par de chaves usado no deployment. Próxima ação: abrir esse widget → **Settings → Hostname Management** e conferir `app.qoro.dev` (ou domínio pai autorizado), sem copiar chaves. Enviar somente os hostnames ou um recorte dessa área. A prova funcional real continua na engenharia.
- **Gemini:** titular informou pré-pago ativo e **R$ 23 de saldo**. Informação humana registrada; não solicitar nova compra. Falta identificar o projeto não secreto associado à chave de Production e conferir limites/alertas. Saldo relatado não comprova capacidade nem correspondência da chave, e pode mudar com o consumo.
- **Planos:** “médico” designa a vaga de atendimento; “equipe administrativa” designa recepção, gestão e financeiro. Papel Médico ocupa vaga médica mesmo sem CRM preenchido; dono/gestor com CRM entra na cota médica, sem contagem dupla. Não há validação automática do registro junto ao conselho. A revisão da copy não altera essa regra, preços ou contratos.

# Grupo A — Obrigatórias antes do lançamento

## Obrigatória antes do rollout — cofre independente, Auth e aceite de recuperação

**Objetivo.** A cópia e a restauração real de Storage foram autorizadas e concluídas em 29/10: **5 buckets, 42/42 hashes iguais, 38 arquivos privados negados ao anônimo e 4 públicos conferidos**. Não é necessário pagar outro projeto nem repetir a prova. A pasta local cifrada tem ACL restrita e a chave fica protegida pelo Windows em outra pasta. Falta proteção contra perda da máquina/perfil, rotina recorrente, cofre independente das dependências Auth e aceite do risco de operar sem PITR. Ver [runbook de recuperação](disaster-recovery.md).

**Pré-requisitos e links.** Tenha um destino local criptografado ou cofre de backup aprovado, com espaço, controle de acesso, retenção e cópia fora da máquina. Acesse o [Supabase Dashboard](https://supabase.com/dashboard/projects) com permissão administrativa somente para conferir Storage/Auth; não clique em Restore no projeto ativo. Consulte a [documentação oficial de backups](https://supabase.com/docs/guides/platform/backups) e de [Storage](https://supabase.com/docs/guides/storage).

**Passo a passo.**

1. Abra `Win+E` e cole `%LOCALAPPDATA%\Qoro\Recovery\storage-20261029`. A cópia está em `qoro-storage-S0upJf`. Não abra os arquivos como documentos nem os envie por chat. A chave está em `%LOCALAPPDATA%\Qoro\RecoveryKeys\storage-20261029.dpapi`; ela depende do perfil Windows atual e **não basta copiar esse arquivo para outro computador**.
2. Informe qual cofre/destino independente já aprovado pela Qoro pode guardar a chave recuperável e a cópia cifrada, com responsáveis, retenção e controle de acesso. Não faça upload para Drive pessoal, Git ou CI por conta própria. A engenharia prepara a exportação protegida da chave para esse cofre; a senha existente de backup não foi reutilizada porque não atende ao requisito de comprimento do novo envelope. Nenhuma credencial foi alterada. Até existir uma cópia/chave independente, uma perda da máquina continua sendo risco relevante.
3. O login administrativo **já funcionou**: a engenharia conferiu **243 configurações Auth** e guardou snapshot cifrado pelo Windows em `%LOCALAPPDATA%\Qoro\Recovery\auth-20261029\auth-config.dpapi`. **Não repita o login nem o inventário.** Confirme no cofre independente as dependências externas: chaves de assinatura/JWT e API do projeto, chaves de criptografia da aplicação, salts/peppers e credenciais de e-mail/provedores. Informe somente os grupos disponíveis ou faltantes. A engenharia já executou o ensaio do Auth real com identidades sintéticas, SMTP local, hook/parser/RLS do Qoro e sete configurações seguras recuperadas. Isso não comprova a custódia externa de todas as chaves nem o RTO do serviço completo.
4. A perda potencial entre backups foi considerada aceitável pelo titular em 29/10, conforme o escopo acima; não precisa repetir esse aceite. Ainda falta definir a contingência operacional para falha da rotina, perda desta máquina e o RTO completo, que não foi medido. A prova local não mede a reconstrução de todo o serviço.
5. Envie somente: `Cofre/destino independente [nome/localização geral]; cofre Auth [disponível/faltantes por grupo]; RTO/contingência [definido/preciso discutir]; responsável [função]`. Não envie chaves, senha, conteúdo de pacientes ou URLs assinadas.

**Resultado esperado.** Cópia e chave recuperáveis fora do domínio de falha desta máquina, inventário Auth completo e risco residual explicitamente tratado. O restore local do banco e do Storage já passou; o gate remanescente é operacional, não instalação ou novo pagamento.


## Obrigatória antes de reabrir o cadastro — Conferir Turnstile de Production

**Objetivo.** Os dois testes com chaves de teste passaram em Preview, mas os dois E2E da CI isolada foram SKIP e não provam a configuração de Production. O backend verifica tokens via Cloudflare somente quando o risco da sessão é moderado; nesse caminho, chave ausente ou inválida fecha o desafio. Sessões de risco baixo não passam por Turnstile, por desenho atual. Não registrar as chaves em screenshots ou chat.

**Evidência humana de 29/10.** O screenshot confirma a existência do widget `app.qoro.dev (Spin)`, Managed, com três hostnames; não mostra os domínios autorizados. Não precisa reenviar a lista inteira nem criar outro widget.

**Já feito em 29/10.** A CLI autenticada confirmou `NEXT_PUBLIC_TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` no ambiente Production, sem leitura/exposição dos valores. A leitura do cadastro publicado e de 20 bundles encontrou chave pública com formato real e nenhuma chave dummy conhecida. Não precisa repetir essa presença. Ainda faltam a correspondência do widget/domínio e o teste funcional do desafio real antes da reabertura.

**Pré-requisitos e links.** Acesso de administrador ao [projeto `project-os` na Vercel](https://vercel.com/clinic-os-v2-s-projects/project-os/settings/environment-variables) e ao [Cloudflare Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile). Confira apenas **nomes, ambiente e domínio**: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` precisam existir para Production e pertencer ao mesmo widget real. Não use as chaves públicas de teste `always-pass` ou `always-fail` no deployment de Production.

**Passos.** 1. Na tela enviada, selecione `app.qoro.dev (Spin)`, abra **Settings → Hostname Management** e confira os hostnames. `app.qoro.dev` deve estar autorizado; o domínio pai `qoro.dev` também autoriza subdomínios. O nome do widget, sozinho, não autoriza esse domínio. Não altere configurações nem revele chaves. 2. Informe somente widget/domínio correto ou o item faltante. 3. A engenharia executará o Siteverify real positivo, replay e negativo na janela autorizada, mantendo cadastro fechado. O POST do cadastro fechado responde 503 e não serve para provar um 201 de Turnstile; o roteiro técnico já separa essas provas. 4. Se configuração estiver ausente/incorreta, manter NO-GO. Uma futura correção de variável exige novo deployment; não fazer essa alteração nesta rodada.

**Evidência e resposta.** Envie `Turnstile Production: variáveis [presentes/ausentes], widget [ativo/inativo], domínio [correto/incorreto], novo deployment [sim/não]`, sem chaves. O resultado esperado é configuração coerente e rejeição server-side de token inválido no teste de risco moderado.


## Obrigatória antes de tráfego clínico — Conferir o tier Gemini do projeto de produção

**Objetivo.** A landing afirma que as mensagens são processadas pela API paga do Gemini, cujo tratamento de dados difere do tier gratuito. Uma chave presente na Vercel não comprova billing ativo, tier ou saldo. Esta conferência exige o titular da conta Google e não autoriza compra automática.

**Pré-requisitos.** Acesso administrativo ao Google AI Studio e identificação, no painel da Vercel, de qual **projeto** emite a chave `GEMINI_API_KEY` de Production; não abra nem copie o valor da chave. Se houver vários projetos, confirme o projeto pelo identificador não secreto e pela administração da chave.

**Links oficiais.** [AI Studio — projetos](https://aistudio.google.com/projects), [AI Studio — cobrança](https://aistudio.google.com/billing) e [documentação de cobrança](https://ai.google.dev/gemini-api/docs/billing).

**Passo a passo.**

1. O titular já informou pré-pago ativo e R$ 23 de saldo em 29/10; não precisa repetir o pagamento nem comprar crédito para esta conferência. Em **Projects**, localize o projeto que fornece a chave de Production ao Qoro e informe apenas o ID não secreto e o tier mostrado. Nunca envie a chave.
2. No projeto correto, confira limites de uso e alertas de crédito baixo. O relato de saldo não foi consultado automaticamente e não garante capacidade para tráfego real. Se o estado mudar para **No credits**, informe a mudança sem autorizar recarga automática.
3. Se o projeto encontrado divergir da conta pré-paga informada, pare e informe a divergência; não crie outro projeto pago, não compre créditos nem altere a chave para resolver a dúvida.
4. Envie ao agente apenas `Gemini Production: projeto [ID não secreto], tier [Free/Paid], plano [Prepay/Postpay], estado [ativo/sem créditos], limite mensal [valor ou ausente]`. Não envie fatura com dados pessoais, senha nem API key.

**Resultado esperado e evidência.** Projeto correto, Paid ativo e, se Prepay, saldo positivo. Um print recortado da linha de tier/estado, sem credenciais, é suficiente. Se a UI divergir, use o procedimento da [documentação oficial](https://ai.google.dev/gemini-api/docs/billing) e informe os rótulos encontrados. O agente confrontará esse estado com a configuração efetiva da Vercel sem copiar segredo DEV para Production.


## Decisão contratual e revisão humana antes do lançamento

**Objetivo.** Validar linguagem de preço, trial, anual, aviso de uso de IA, custo Meta/Asaas e contratos existentes. A engenharia não deve inventar condição comercial ou jurídica.

**Pré-requisitos.** Versão final do app/landing e responsável jurídico/contábil da Qoro. Consulte [decisões da oferta](../specs/decisoes-oferta-e-precificacao-2026-10.md) e [roteiro técnico](validacao-nova-oferta-2026-10.md).

**Passos.** Revise a redação dos Termos e das telas contra os valores contratáveis, confirme a permanência integral do desconto vitalício do contrato existente, decida a comunicação para demais contratos legados e aprove ou devolva alterações. Não altere uma assinatura no Asaas para “testar” esta etapa.

**Resultado e evidência.** Documento/versão aprovada e data, sem dados pessoais do cliente de desconto. Resposta ao agente: `Texto comercial/jurídico versão … aprovado` ou `ajustes necessários: …`.

**Próximo passo.** Engenharia confronta aprovação com implementação e evidências de Sandbox antes de discutir publicação conjunta app/landing.


## Autorização da janela — somente depois dos gates

**Objetivo.** Autorizar a operação futura conjunta, sem confundir aprovação de texto com permissão para executar produção.

**Pré-requisito.** Cofre/cópia/chave independente verificados, risco residual sem PITR tratado, widget e Gemini conferidos, texto aprovado e checks finais verdes dos dois PRs.

**Passos.** A engenharia entrega SHAs finais, preflight, backup e plano de recuperação; você confirma responsável e horário da janela e autoriza explicitamente fechamento do cadastro, migrations 0119–0132 e publicação coordenada. Se um gate crítico falhar, a autorização não supera o critério de interrupção.

**Resposta.** `Janela [data/horário Brasília] autorizada para SHAs [app/landing], conforme runbook; ou gate pendente [...]`. Nenhuma autorização está presumida agora.

# Grupo B — Opcionais

## Opcional — Revisão visual humana da landing candidata

**Objetivo.** Confirmar que a landing realmente publicada mostra uma oferta coerente com o checkout e os limites do app em desktop e celular. O conteúdo textual atual já reprovou: a landing anuncia até 10 profissionais/equipe ilimitada, o candidato do app permite 5 médicos/3 logins e a `main` do app ainda oferece a tabela legada. Esta inspeção visual só fecha depois de corrigir a divergência. O app já teve `/oferta-preview` inspecionado automaticamente nas duas larguras, sem overflow.

**Pré-requisitos.** A inspeção automatizada de `/` e `/precos`, desktop e celular, passou 4/4 no Preview da landing `81341c4` em 29/10. Não precisa repetir para liberar a engenharia; esta etapa fica para julgamento visual/comercial. Se a Vercel pedir login, entre com uma conta autorizada no time `clinic-os-v2-s-projects`. Para a conferência final em produção, a engenharia deve informar os SHAs reconciliados. Não use o PR draft #1 da landing como referência atual.

**Link.** [Landing mensal — preços no Preview imutável](https://landing-page-8kg1zwlm9-clinic-os-v2-s-projects.vercel.app/precos), [home no mesmo Preview](https://landing-page-8kg1zwlm9-clinic-os-v2-s-projects.vercel.app/), [landing pública — preços](https://qoro.dev/precos) e [home pública](https://qoro.dev/). O [PR #42 do app](https://github.com/joaomarcos-techia/Project_OS/pull/42) contém o link de deployment atualizado; ele não prova o checkout de produção. Não usar o link antigo `6088143c` para validar o código mensal atual.

**CTA corrigido no candidato.** `/comecar` diferencia hosts públicos de Preview: a landing Preview usa somente o app Preview fixo revisado; `qoro.dev/www` conserva o app público. Hosts desconhecidos ficam bloqueados e UTM não decide destino. O fallback sem JavaScript volta à home. Não usar links de versões antigas para testar pagamentos. A nova navegação precisa dos checks do SHA final; testes de Checkout continuam exigindo fixture isolada.

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


## Limpeza local opcional — scratch sintético do gate de restore

Em 26/10, a engenharia iniciou e **parou** um Postgres 17 local descartável para testar o `restore:test` com dumps sintéticos. A política do executor bloqueou a exclusão recursiva, apesar de o caminho ter sido verificado. Não há dados de produção nessa pasta e ela não é usada pelo Qoro.

No Explorador de Arquivos do Windows, cole `C:\Users\joaom\AppData\Local\Temp\qoro-restore-probe-1792989843298` na barra de endereço. Confira que o nome da pasta é exatamente `qoro-restore-probe-1792989843298` e exclua **somente essa pasta**. Antes da exclusão, a engenharia confirmou `pg_ctl: no server running` para o `pgdata` dela. Se a pasta não existir, a limpeza já foi feita; não procure nem exclua outra instalação do PostgreSQL. Esta limpeza não comprova recuperação de backup de produção.


## Limpeza local opcional — dois scratches sintéticos dos testes de migrations

**Objetivo.** A pasta anterior `qoro-scratch-schema-JBdqPE`, com restore parcial da cópia Production, **já foi excluída pelo usuário**; `Test-Path` confirmou que ela não existe. Não a procure novamente. Em 27/10, dois testes de migrations criaram outros clusters descartáveis com **somente dados sintéticos** e saíram 0, mas a limpeza interna deixou as pastas `qoro-scratch-schema-JL9r9p` e `qoro-scratch-schema-vcDI5M`. A revisão automática rejeitou a remoção recursiva com `blocked by policy`. Foi confirmada a ausência de processos PostgreSQL associados às duas pastas. Não use esses clusters para a prova de restore.

**Passos no Explorador do Windows.** Pressione `Win+E` e abra `C:\Users\joaom\AppData\Local\Temp`. Localize os nomes **exatos** `qoro-scratch-schema-JL9r9p` e `qoro-scratch-schema-vcDI5M`. Selecione somente essas duas pastas e use `Shift+Delete`. Não toque nos outros diretórios `qoro-scratch-schema-*`, no artifact cifrado `qoro-prod-backup-verify-*`, no PostgreSQL instalado ou no projeto. Se um nome não existir, essa pasta já foi limpa. Se o Windows disser que está em uso, pare e informe a mensagem.

**Evidência e próximo passo.** Responda apenas `Scratches sintéticos removidos` ou `Não consegui: [mensagem sem dados sensíveis]`. Não envie arquivos do banco nem screenshot do conteúdo. A recuperação lógica já foi comprovada em outros contêineres isolados; essas pastas não bloqueiam o lançamento.


# Grupo C — Engenharia na janela de publicação

Estas atividades **não foram transferidas ao usuário** e não devem ser executadas agora. Após as aprovações do Grupo A, a engenharia:

1. Confirma checks/SHAs, backup recuperável recente, cópia independente, chaves e baseline de contratos.
2. Configura cadastro fechado e gera novo deployment da versão vigente; comprova 503 da entrada e preserva login existente.
3. Faz gate real Turnstile sem abrir cadastro; reconcilia os resultados da configuração Auth/Google.
4. Executa preflight de journal/locks/digests e aplica somente as migrations autorizadas, interrompendo no primeiro erro.
5. Verifica integridade/owners/cotas/legados e ativa apenas o catálogo mensal previsto.
6. Publica app e landing de forma coordenada, verifica destinos públicos e ausência de anual novo.
7. Gera deployment para reabrir cadastro, executa smoke com fixtures isoladas e monitora filas, webhooks e cobrança pós-trial.
8. Mantém plano de recuperação; não restaura banco ativo nem cria cobrança real sem autorização específica.

Procedimento exato e critérios de interrupção em [publicação coordenada](publicacao-coordenada-oferta-2026-10.md). O teste funcional completo do produto após recuperação, o agendamento real de Storage/Auth e alertas no cofre serão concluídos pela engenharia quando o destino aprovado estiver disponível.
