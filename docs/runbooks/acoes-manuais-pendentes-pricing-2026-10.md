# Ações humanas pendentes — oferta 2026 (Preview e Sandbox)

Atualizado em 26/10/2026. Este documento contém somente ações que exigem uma pessoa ou acesso ao painel indisponível à automação. **Não altere produção, não use cartão real, não copie chaves, senhas, OTP ou URLs com bypass para o chat.** Os testes de código, migrations DEV, fixtures e readbacks pertencem à engenharia e não devem ser repetidos manualmente. A nova tabela ainda não está pronta para contratação no app em produção, embora a landing pública já anuncie os novos preços. A landing publicada promete até **10 profissionais e equipe ilimitada**; o candidato do app limita a **5 médicos e 3 logins de equipe**. Esta divergência já foi medida e deve ser corrigida em código antes da revisão visual final. As variantes de 3–5 médicos foram ativadas só no DEV; isso não autoriza contratar em produção. A compra do terceiro médico pela UI, com simulação oficial de PIX, webhook e cota, passou automaticamente no Preview; a atividade humana abaixo serve exclusivamente para conferir o pagamento na página hospedada do Asaas.

Os limites e o trial de 14 dias foram preparados no [PR draft da landing #3](https://github.com/joaomarcos-techia/landing_page/pull/3), sem mexer em produção. Em 25/10, o deployment imutável `fa8b67c` passou **4/4** verificações em Chromium externo (home/preços, desktop/celular, texto, CTA, cancelamento anual e largura). A proteção da Vercel já foi atravessada pela CLI autenticada para esses testes; ela não exige compra. A inspeção humana abaixo fica para julgamento visual e para a comparação final com o cadastro real depois da publicação coordenada. Não há necessidade de repetir o build local nem de abrir o PR #1 antigo.

## Obrigatória 1 — Conferir a landing corrigida no Preview e repetir após o rollout

**Objetivo.** Confirmar que a landing realmente publicada mostra uma oferta coerente com o checkout e os limites do app em desktop e celular. O conteúdo textual atual já reprovou: a landing anuncia até 10 profissionais/equipe ilimitada, o candidato do app permite 5 médicos/3 logins e a `main` do app ainda oferece a tabela legada. Esta inspeção visual só fecha depois de corrigir a divergência. O app já teve `/oferta-preview` inspecionado automaticamente nas duas larguras, sem overflow.

**Pré-requisitos.** Para a conferência inicial, use o Preview imutável `fa8b67c` do PR #3; se a Vercel pedir login, entre com uma conta autorizada no time `clinic-os-v2-s-projects`. Para a conferência final em produção, a engenharia deve informar os SHAs do app e da landing reconciliados. Não use o PR draft #1 da landing como referência atual.

**Link.** [Landing corrigida — preços no Preview imutável](https://landing-page-o2dehsjhg-clinic-os-v2-s-projects.vercel.app/precos), [home no mesmo Preview](https://landing-page-o2dehsjhg-clinic-os-v2-s-projects.vercel.app/), [landing pública — preços](https://qoro.dev/precos) e [home pública](https://qoro.dev/). [App — oferta no Preview imutável](https://project-lqlrihmtp-clinic-os-v2-s-projects.vercel.app/oferta-preview) serve para comparar os limites do candidato, mas não prova o checkout de produção. O deployment do app corresponde ao código `4c81f71d`; a URL de branch antiga da landing foi observada servindo conteúdo defasado, portanto use as URLs imutáveis para estes SHAs.

**Atenção ao CTA.** O `/comecar` da landing em Preview ainda encaminha para `https://app.qoro.dev/cadastro`, pois `src/lib/comecar.ts` usa esse destino constante. **Não use esse botão para testar pagamento Sandbox:** ele leva ao app de produção. Para examinar a nova oferta sem criar conta, abra o link direto do app Preview acima; testes de Checkout devem usar o roteiro de fixture isolada do app.

**Passo a passo.**

1. Abra a home e `/precos` do **Preview corrigido**. Confira o nome, preço, trial, cota de médicos e de equipe e destino dos CTAs. O Preview já deve apresentar 5 médicos, até 3 usuários de equipe e 14 dias desde a criação da conta. A landing pública ainda mostra 10/equipe ilimitada/7 dias e o CTA de contratação não corresponde ao app; registre isso como FAIL atual, não como falha do Preview.
2. Compare Consultório com 1 médico e Clínica com 2, 3 e 5 médicos. Os valores mensais do candidato são R$ 197, R$ 397, R$ 544 e R$ 838. Quatro logins de equipe e seis médicos não devem ser oferecidos para contratação automática. O anual deve equivaler a dez mensalidades e aceitar cartão primeiro; Pix anual fica para depois. A referência de 500 conversas por médico gera avisos, sem bloqueio automático. Nesta branch da landing, preço e CTA ainda antecipam o checkout atual; não marque coerência final como PASS.
3. No navegador, use F12 → modo celular (largura próxima de 375 px). Repita a conferência, role até o fim, confira ausência de corte lateral, texto legível, foco por Tab e mensagens de erro quando houver entrada numérica.
4. Confira se o contato para clínicas maiores aponta para `wa.me/5588996822198`; não é necessário enviar mensagem. **Depois do rollout coordenado**, repita a inspeção em `qoro.dev` e acesse o cadastro apenas até a seleção de plano, sem criar conta, para conferir que preço e prazo exibidos combinam com a promessa pública.

**Resultado e evidência.** Anote SHAs dos deployments, navegador, largura, página, valores, destinos dos CTAs e qualquer elemento cortado. Screenshot pode mostrar apenas a proposta pública, nunca sessão, cookies, DevTools ou dados de pacientes. Resposta curta ao agente: `Landing SHA … / app SHA …: desktop/mobile coerentes ou divergência …`.

**Problemas comuns.** Se a landing pública mostrar uma versão diferente da branch em revisão, confirme o SHA do deployment antes de concluir. A página `/precos-preview` do PR #1 é histórica e não substitui o conteúdo publicado. Se o cadastro mostrar Solo/Clínica/Pro depois de clicar num CTA que promete Consultório R$ 197, registre FAIL e não crie Checkout.

**Próximo passo.** Entregue o resultado ao agente; ele confrontará com o catálogo e o checkout ativos antes de considerar a oferta pronta.

## Obrigatória 2 — Conferir o pagamento hospedado do adicional quando a fixture estiver pronta

**Objetivo.** A prova automatizada já fechou `UI Qoro → rateio → simulação oficial PIX → webhook → banco → cota → tela`. Falta atravessar **a página hospedada do Asaas Sandbox** como uma pessoa, inclusive a escolha de método e o reCAPTCHA, para não atribuir ao teste de API um comportamento de Checkout que ele não mediu.

**Pré-requisitos.** O agente deve primeiro confirmar por escrito: Preview com SHA novo, Auth e banco do projeto DEV, conta Asaas **Sandbox**, clínica sintética identificada, assinatura ativa de R$ 397, valor proporcional mostrado e plano de limpeza. Sem essa confirmação, **não pague**. Use somente cartão de teste fornecido pela interface/documentação oficial do Sandbox; nunca cartão real.

**Link.** [Assinatura da clínica de teste no Preview](https://project-lqlrihmtp-clinic-os-v2-s-projects.vercel.app/configuracoes/assinatura). O link do Checkout é gerado pelo botão de upgrade e expira; não existe URL fixa a registrar aqui. A fixture sintética usada no E2E de 26/10 foi removida com readback de zero resíduos. As duas contas do probe genérico mostram somente planos legados; a engenharia precisa preparar **outra** fixture da oferta 2026 antes desta ação humana.

**Passo a passo.**

1. Entre no Preview com o titular da clínica sintética indicada pelo agente. Confirme que a tela mostra **Clínica — 2 médicos** e o preço de R$ 397/mês; se mostrar outra clínica, pare.
2. Clique em **Contratar +1 médico**. Confira a diferença proporcional e o novo valor recorrente **R$ 544/mês** antes de abrir o Asaas. Se o valor não aparecer ou divergir, não conclua.
3. No domínio `sandbox.asaas.com`, conclua o reCAPTCHA e pague somente com o meio de teste aprovado para esta fixture.
4. Volte à aba original do Qoro e clique em **Já pagou? Atualizar assinatura**. Isso renova a sessão após a mudança de plano e relê o estado; a página de retorno do Asaas sozinha não comprova pagamento. Se a tela continuar pendente, anote horário e estado, sem repetir a compra.
5. Avise `Checkout do terceiro médico concluído às HH:MM; tela Qoro: …`. Não envie URL de sessão, recibo com PII nem credenciais. O agente fará readback de valor, webhook, assinatura, plano, cota, replay e cleanup.

**Resultado e evidência.** Asaas deve indicar pagamento de teste; Qoro deve mostrar novo plano apenas depois da confirmação. Registre horário, ID do pagamento **somente se não contiver token** e estado textual da tela. O PASS final será dado pelo readback do agente.

**Problemas comuns.** Se o botão não aparecer, confirme que a clínica da fixture está na oferta **2026**, não em Solo/Clínica/Pro legados; os adicionais já estão ativos no DEV, mas não aparecem para contratos da família antiga. Também confira o SHA do Preview; não tente alterar o banco. Se houver `invalid_action` ou reCAPTCHA preso, guarde o código do erro e horário. Se pagar e o Qoro continuar esperando, não pague de novo: a reconciliação é trabalho do agente.

**Próximo passo.** Aguarde a confirmação técnica e a limpeza da fixture antes de qualquer outro Checkout.

## Condicional — Conferir a entrega do webhook de assinatura no Asaas Sandbox

**Objetivo.** A compra anual chegou ao estado correto por readback autenticado, mas não foi comprovado que o webhook da assinatura entregou o evento ao Preview. Os logs de 23/10, 17h–21h UTC, não mostraram chamada a `/api/webhooks/asaas` no Preview. Precisamos distinguir webhook ausente, alvo diferente e entrega não registrada. Não crie outra cobrança para este diagnóstico.

**Pré-requisitos.** Entre na conta **Sandbox** usada pelo Checkout anual; não use a conta real. Tenha acesso a **Integrações → Webhooks** e **Integrações → Logs de Webhooks**. Não copie a URL completa se ela contiver bypass, nem token de autenticação, chave API ou corpo de evento.

**Link.** [Painel Asaas Sandbox](https://sandbox.asaas.com/). A [documentação oficial de Logs de Webhooks](https://docs.asaas.com/docs/webhooks-logs) descreve onde localizar horário, destino e status HTTP.

**Passo a passo.**

1. Em **Integrações → Webhooks**, procure uma configuração de assinatura SaaS que termine no caminho `/api/webhooks/asaas` (sem `/patient/`). Anote apenas se existe, se está ativa, se a fila está interrompida e se o domínio é Preview, produção ou outro; não envie a URL completa.
2. Confira se a configuração inclui `PAYMENT_CREATED`, `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED`. Não revele o `authToken` nem altere eventos agora.
3. Em **Integrações → Logs de Webhooks**, filtre 23/10/2026 entre **14h e 18h de Brasília** para a configuração de assinatura. Anote o tipo do evento, horário, resultado da entrega e código HTTP. Se não houver entrega, registre “nenhuma entrega” sem presumir a causa.
4. Envie somente: `Webhook SaaS Sandbox: [existe/ausente]; alvo: [Preview/produção/outro]; ativo: [sim/não]; fila interrompida: [sim/não]; eventos exigidos: [completos/incompletos]; última entrega: [horário, evento, HTTP ou nenhuma]`. Não faça replay nem crie novo Checkout antes da análise técnica.

**Resultado esperado.** Uma entrega `PAYMENT_CONFIRMED` ou `PAYMENT_RECEIVED` para o endpoint SaaS responde 2xx e aparece também nos logs do deployment destinatário. A configuração por si só não é prova de entrega, e a invoice anual já paga não deve ser usada como substituto da evidência.

**Problemas comuns e próximo passo.** Se o webhook apontar para outro deployment, estiver inativo ou não existir, deixe a configuração intacta e informe o estado; a engenharia preparará um alvo de Preview, token separado e fixture controlada para nova prova. Se houver HTTP não 2xx, informe apenas o código e horário para correlacionar com logs, sem reenviar o payload.

## Condicional — Validar a recusa do Turnstile em Preview separado

**Objetivo.** O Preview atual usa a secret de teste `always-pass`, por isso um token inventado recebeu HTTP 201. É preciso provar a recusa em outro deployment de teste, sem tocar a configuração de produção.

**Pré-requisitos.** Acesso às variáveis de ambiente do projeto `project-os` na Vercel e autorização para criar/editar **somente uma configuração Preview isolada**. O agente deve preparar o runner e identificar a branch/deployment alvo. Se ele obtiver esse acesso e fizer a configuração sozinho, esta ação deixa de ser manual.

**Link.** [Variáveis de ambiente do projeto](https://vercel.com/clinic-os-v2-s-projects/project-os/settings/environment-variables). Use a documentação oficial do [Turnstile para chaves de teste](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) para escolher a secret de teste que sempre rejeita. Não compartilhe seu valor.

**Passo a passo.**

1. Confirme no topo da Vercel o projeto `project-os` e o ambiente **Preview**, nunca Production.
2. Crie ou edite a variável de secret do Turnstile usada pelo app com escopo restrito ao Preview isolado indicado pelo agente. Não substitua a secret de produção nem a configuração do Preview normal, que testa o caminho positivo.
3. Faça redeploy somente desse Preview e informe ao agente a URL sem query de bypass e o SHA. Ele executará o teste `reject-invalid` e registrará o HTTP esperado.
4. Depois da prova, restaure/remova a configuração isolada se ela não for mais usada. Peça ao agente readback de que o Preview normal continua positivo.

**Resultado e evidência.** Token inválido recusado pelo endpoint do Preview isolado; Preview normal continua aceitando o token de teste positivo. Informe apenas URL/branch/SHA/status HTTP, jamais secret.

**Problemas comuns.** Se a variável aparecer também em Production, pare antes do deploy. Se o mesmo Preview continuar respondendo 201, confira se o redeploy carregou a variável da branch correta; não conclua PASS por uma simples mudança de painel.

**Próximo passo.** O agente executa o runner negativo e classifica pelo resultado real.

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
