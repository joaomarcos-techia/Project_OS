# Ações humanas pendentes — oferta 2026 (Preview e Sandbox)

Atualizado em 28/10/2026. Este documento contém somente ações que exigem uma pessoa ou acesso ao painel indisponível à automação. **Não altere produção, não use cartão real, não copie chaves, senhas, OTP ou URLs com bypass para o chat.** Os testes de código, migrations DEV, fixtures e readbacks pertencem à engenharia e não devem ser repetidos manualmente. A nova tabela ainda não está pronta para contratação no app em produção, embora a landing pública já anuncie os novos preços. A landing publicada promete até **10 profissionais e equipe ilimitada**; o candidato do app limita a **5 médicos e 3 logins de equipe**. O [PR draft da landing #3](https://github.com/joaomarcos-techia/landing_page/pull/3) corrige a promessa no Preview; falta publicação coordenada. As variantes de 3–5 médicos foram ativadas só no DEV; isso não autoriza contratar em produção. O Checkout de médico adicional e o de uma **conta completamente nova** foram pagos e validados no Asaas Sandbox/Preview; não há nova ação humana de pagamento para esses gates. Evidências em [contas novas e legadas](../quality/contas-novas-e-legadas-2026-10-26.md).

Os limites e o trial de 14 dias foram preparados no [PR draft da landing #3](https://github.com/joaomarcos-techia/landing_page/pull/3), sem mexer em produção. Em 25/10, o deployment imutável `fa8b67c` passou **4/4** verificações em Chromium externo (home/preços, desktop/celular, texto, CTA, cancelamento anual e largura). A proteção da Vercel já foi atravessada pela CLI autenticada para esses testes; ela não exige compra. O Turnstile positivo/negativo passou automaticamente em Previews separados em 26/10; a configuração temporária de teste foi removida, portanto não há ação humana para esse gate. A inspeção humana abaixo fica para julgamento visual e para a comparação final com o cadastro real depois da publicação coordenada. Não há necessidade de repetir o build local nem de abrir o PR #1 antigo.

## Obrigatória 1 — Conferir a landing corrigida no Preview e repetir após o rollout

**Objetivo.** Confirmar que a landing realmente publicada mostra uma oferta coerente com o checkout e os limites do app em desktop e celular. O conteúdo textual atual já reprovou: a landing anuncia até 10 profissionais/equipe ilimitada, o candidato do app permite 5 médicos/3 logins e a `main` do app ainda oferece a tabela legada. Esta inspeção visual só fecha depois de corrigir a divergência. O app já teve `/oferta-preview` inspecionado automaticamente nas duas larguras, sem overflow.

**Pré-requisitos.** Para a conferência inicial, use os Previews imutáveis do app `6088143c` (PR #42) e da landing `88edf7b` (PR #3); se a Vercel pedir login, entre com uma conta autorizada no time `clinic-os-v2-s-projects`. Para a conferência final em produção, a engenharia deve informar os SHAs reconciliados. Não use o PR draft #1 da landing como referência atual.

**Link.** [Landing corrigida — preços no Preview imutável](https://landing-page-pms8dob28-clinic-os-v2-s-projects.vercel.app/precos), [home no mesmo Preview](https://landing-page-pms8dob28-clinic-os-v2-s-projects.vercel.app/), [landing pública — preços](https://qoro.dev/precos) e [home pública](https://qoro.dev/). [App — oferta no Preview imutável](https://project-h8j4bkb3d-clinic-os-v2-s-projects.vercel.app/oferta-preview) serve para comparar os limites do candidato, mas não prova o checkout de produção. Os deployments foram conferidos como `Ready/preview` nos projetos corretos. Uma atualização posterior dos PRs exige novos links de deployment antes da conferência final.

**Atenção ao CTA.** O `/comecar` da landing em Preview ainda encaminha para `https://app.qoro.dev/cadastro`, pois `src/lib/comecar.ts` usa esse destino constante. **Não use esse botão para testar pagamento Sandbox:** ele leva ao app de produção. Para examinar a nova oferta sem criar conta, abra o link direto do app Preview acima; testes de Checkout devem usar o roteiro de fixture isolada do app.

**Passo a passo.**

1. Abra a home e `/precos` do **Preview corrigido**. Confira o nome, preço, trial, cota de médicos e de equipe e destino dos CTAs. O Preview já deve apresentar 5 médicos, até 3 usuários de equipe e 14 dias desde a criação da conta. A landing pública ainda mostra 10/equipe ilimitada/7 dias e o CTA de contratação não corresponde ao app; registre isso como FAIL atual, não como falha do Preview.
2. Compare Consultório com 1 médico e Clínica com 2, 3 e 5 médicos. Os valores mensais do candidato são R$ 197, R$ 397, R$ 544 e R$ 838. Quatro logins de equipe e seis médicos não devem ser oferecidos para contratação automática. O anual deve equivaler a dez mensalidades e aceitar cartão primeiro; Pix anual fica para depois. A referência de 500 conversas por médico gera avisos, sem bloqueio automático. Nesta branch da landing, preço e CTA ainda antecipam o checkout atual; não marque coerência final como PASS.
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

## Obrigatória antes do rollout — confirmar a recuperação complementar do Supabase

**Objetivo.** O backup lógico de `public` + `auth` de 28/10 foi restaurado integralmente em banco local isolado; não repita a instalação do Docker nem esse teste. Falta confirmar a recuperação de objetos do Storage e das configurações gerenciadas do projeto, que o SQL não inclui. A prova e seus limites estão no [relatório de fechamento](../quality/fechamento-oferta-2026-10-28.md) e no [runbook de recuperação](disaster-recovery.md).

**Pré-requisitos e links.** Acesse como administrador o [Supabase Dashboard](https://supabase.com/dashboard/projects), escolha o projeto **Production** do Qoro pelo identificador já conhecido internamente (não escolha DEV) e abra **Database → Backups**. Consulte a [documentação oficial de backups](https://supabase.com/docs/guides/platform/backups) e a [documentação de Storage](https://supabase.com/docs/guides/storage).

**Passo a passo.**

1. Confirme a data/hora do backup gerenciado mais recente, a retenção e se PITR está habilitado. Não clique em Restore, Delete ou qualquer comando de recuperação no projeto ativo.
2. Em Storage, identifique os buckets que contêm arquivos de clínicas e confirme o procedimento de cópia/recuperação dos **objetos**, não apenas dos metadados do banco. Se houver backup externo desses objetos, registre a data e onde a cópia cifrada está guardada, sem abrir arquivos clínicos.
3. Confirme que as configurações de Auth, provedores, chaves e variáveis necessárias a uma reconstrução estão registradas em cofre. Não copie os valores para o chat ou documento.
4. Envie somente: `Supabase Production: backup em [data/hora], retenção [prazo], PITR [sim/não], Storage [procedimento e cópia confirmados/pendente], configurações no cofre [sim/não]`.

**Resultado esperado.** Existe um caminho documentado para recuperar banco, arquivos e configuração do serviço. Se Storage não tiver cópia independente, mantenha esse gate aberto; o restore lógico que passou não comprova recuperação completa. A próxima ação da engenharia será confrontar a resposta com o roteiro de rollout, sem executar restore em Production.
