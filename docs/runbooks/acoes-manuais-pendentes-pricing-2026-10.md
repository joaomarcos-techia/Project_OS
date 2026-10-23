# Ações humanas pendentes — oferta 2026 (Preview e Sandbox)

Atualizado em 23/10/2026. Este documento contém somente ações que exigem uma pessoa ou acesso ao painel indisponível à automação. **Não altere produção, não use cartão real, não copie chaves, senhas, OTP ou URLs com bypass para o chat.** Os testes de código, migrations DEV, fixtures e readbacks pertencem à engenharia e não devem ser repetidos manualmente. A nova tabela ainda não está pronta para publicação. As variantes de 3–5 médicos foram ativadas só no DEV; isso não autoriza contratar em produção. A compra do terceiro médico pela UI, com simulação oficial de PIX, webhook e cota, passou automaticamente no Preview; a atividade humana abaixo serve exclusivamente para conferir o pagamento na página hospedada do Asaas.

## Obrigatória 1 — Conferir a landing protegida pelo SSO

**Objetivo.** Confirmar que a landing publicada no Preview mostra a mesma proposta em desktop e celular. O app já teve `/oferta-preview` inspecionado automaticamente nas duas larguras, sem overflow; a landing externa ainda redireciona ao SSO da Vercel para este agente. Não repita a inspeção do app como pré-condição da landing.

**Pré-requisitos.** Acesso ao time `clinic-os-v2-s-projects` na Vercel. Confirme que o deployment da landing Preview está `Ready` e corresponde ao PR draft de preços. Se mostrar uma versão anterior, não registre PASS.

**Link.** [Landing — preços](https://landing-page-git-preview-pricing-05406a-clinic-os-v2-s-projects.vercel.app/precos-preview). [App — oferta](https://project-os-git-integration-prici-c5e6c6-clinic-os-v2-s-projects.vercel.app/oferta-preview) fica como comparação opcional, não como teste humano pendente.

**Passo a passo.**

1. Abra o link da landing no navegador em que está logado na Vercel. Se aparecer a porta do SSO, entre pelo time e retorne ao mesmo link.
2. Na landing, compare 1, 2, 3 e 5 médicos com 0 e 3 logins de equipe. Os valores mensais esperados são R$ 197, R$ 397, R$ 544 e R$ 838. Quatro logins de equipe e seis médicos devem ser recusados. O anual deve mostrar dez mensalidades e cartão primeiro, Pix depois; a landing continua sem botão de compra. As 500 conversas são referência com avisos, sem bloqueio automático.
3. No navegador, use F12 → modo celular (largura próxima de 375 px). Repita o passo 2, role até o fim, confira ausência de corte lateral, texto legível, foco por Tab e mensagens de erro ao digitar limites inválidos.
4. Confira o botão de contato para clínicas maiores apontando para `wa.me/5588996822198`; não é necessário enviar mensagem.

**Resultado e evidência.** Anote SHA exibido no deployment, navegador, largura, página, valores e qualquer elemento cortado. Screenshot pode mostrar apenas a proposta pública, nunca sessão, cookies, DevTools ou dados de pacientes. Resposta curta ao agente: `Landing Preview SHA …: desktop/mobile OK ou falha …`.

**Problemas comuns.** Se voltar ao login da Vercel, confirme que você está no time correto. Se a página disser oferta antiga, verifique se o deployment da branch está `Ready` antes de concluir. Se a URL de branch mudou, copie a nova URL **sem** query de bypass, token ou cookie.

**Próximo passo.** Entregue o resultado ao agente; ele confrontará com o teste automatizado e corrigirá qualquer divergência antes de publicar.

## Obrigatória 2 — Conferir o pagamento hospedado do adicional quando a fixture estiver pronta

**Objetivo.** A prova automatizada já fechou `UI Qoro → rateio → simulação oficial PIX → webhook → banco → cota → tela`. Falta atravessar **a página hospedada do Asaas Sandbox** como uma pessoa, inclusive a escolha de método e o reCAPTCHA, para não atribuir ao teste de API um comportamento de Checkout que ele não mediu.

**Pré-requisitos.** O agente deve primeiro confirmar por escrito: Preview com SHA novo, Auth e banco do projeto DEV, conta Asaas **Sandbox**, clínica sintética identificada, assinatura ativa de R$ 397, valor proporcional mostrado e plano de limpeza. Sem essa confirmação, **não pague**. Use somente cartão de teste fornecido pela interface/documentação oficial do Sandbox; nunca cartão real.

**Link.** [Assinatura da clínica de teste no Preview](https://project-os-git-integration-prici-c5e6c6-clinic-os-v2-s-projects.vercel.app/configuracoes/assinatura). O link do Checkout é gerado pelo botão de upgrade e expira; não existe URL fixa a registrar aqui.

**Passo a passo.**

1. Entre no Preview com o titular da clínica sintética indicada pelo agente. Confirme que a tela mostra **Clínica — 2 médicos** e o preço de R$ 397/mês; se mostrar outra clínica, pare.
2. Clique em **Contratar +1 médico**. Confira a diferença proporcional e o novo valor recorrente **R$ 544/mês** antes de abrir o Asaas. Se o valor não aparecer ou divergir, não conclua.
3. No domínio `sandbox.asaas.com`, conclua o reCAPTCHA e pague somente com o meio de teste aprovado para esta fixture.
4. Volte à aba original do Qoro e clique em **Já pagou? Atualizar assinatura**. Isso renova a sessão após a mudança de plano e relê o estado; a página de retorno do Asaas sozinha não comprova pagamento. Se a tela continuar pendente, anote horário e estado, sem repetir a compra.
5. Avise `Checkout do terceiro médico concluído às HH:MM; tela Qoro: …`. Não envie URL de sessão, recibo com PII nem credenciais. O agente fará readback de valor, webhook, assinatura, plano, cota, replay e cleanup.

**Resultado e evidência.** Asaas deve indicar pagamento de teste; Qoro deve mostrar novo plano apenas depois da confirmação. Registre horário, ID do pagamento **somente se não contiver token** e estado textual da tela. O PASS final será dado pelo readback do agente.

**Problemas comuns.** Se o botão não aparecer, confirme que a clínica da fixture está na oferta **2026**, não em Solo/Clínica/Pro legados; os adicionais já estão ativos no DEV, mas não aparecem para contratos da família antiga. Também confira o SHA do Preview; não tente alterar o banco. Se houver `invalid_action` ou reCAPTCHA preso, guarde o código do erro e horário. Se pagar e o Qoro continuar esperando, não pague de novo: a reconciliação é trabalho do agente.

**Próximo passo.** Aguarde a confirmação técnica e a limpeza da fixture antes de qualquer outro Checkout.

## Obrigatória 3 — Pagar o cadastro anual de teste no Checkout Sandbox

**Objetivo.** Provar a cadeia que o teste local não atravessa: escolha anual na UI → Checkout Asaas hospedado → pagamento com cartão → webhook → assinatura e invoice anuais no DEV → dashboard. O cadastro anual da branch precisa estar publicado em **Preview** e a migration 0128 aplicada **somente no DEV** antes desta etapa. A execução da engenharia deve preparar uma conta sintética e confirmar que o trial dela venceu por relógio controlado; assim o pagamento é exigido antes do acesso.

**Pré-requisitos.** O Preview atualizado foi publicado e a prova assinada confirmou Auth/banco DEV, URL Asaas Sandbox e presença da chave; a página hospedada também abriu no Sandbox. Uma fixture sintética de Consultório anual foi preparada em 23/10 às 14h24 de Brasília. O link do Checkout deve começar com `https://sandbox.asaas.com/` e **vence após 60 minutos**; use o link temporário enviado na conversa, não um link guardado neste arquivo. Não use cartão real nem crie um segundo checkout se o primeiro ficar pendente.

**Links.** [Cadastro no Preview](https://project-os-git-integration-prici-c5e6c6-clinic-os-v2-s-projects.vercel.app/cadastro). O link do Checkout é gerado para cada fixture e expira; o agente enviará apenas o endereço Sandbox necessário quando a preparação terminar. [Painel de pagamentos do Asaas Sandbox](https://sandbox.asaas.com/) serve para conferir o resultado, se você já tiver acesso à conta de teste.

**Passo a passo.**

1. Abra somente o link de Checkout **Sandbox** preparado pelo agente. Na página, confira o nome do plano e o valor anual: Consultório R$ 1.970 ou Clínica R$ 3.970. Se aparecer mensalidade, cobrança Pix ou domínio diferente, pare e informe a divergência.
2. Escolha cartão. Use apenas os dados de cartão de teste indicados pelo próprio Sandbox/documentação do Asaas e conclua o reCAPTCHA manualmente. Não envie número, CVV, senha, token ou URL da sessão ao chat.
3. Ao receber a confirmação, clique em **Acompanhar pedido** e aguarde o retorno ao Preview. Se a tela disser que está verificando o Asaas, aguarde e atualize **uma vez** após alguns minutos; não pague outra vez.
4. Informe ao agente plano, horário aproximado em Brasília, estado mostrado pelo Asaas e destino/estado final no Qoro. O agente fará o readback do webhook, assinatura `YEARLY`, valor, primeira invoice paga, período anual, acesso e replay. A conta paga permanecerá identificada como fixture DEV até existir remoção transacional segura de Auth, tenant e assinatura Sandbox; não a apague manualmente por partes.

**Resultado e evidência.** A página do Asaas confirma o pagamento de teste e o Qoro libera o dashboard **somente depois** da confirmação pelo provedor. Guarde screenshot sanitizado do estado final, sem cartão, dados pessoais, query de bypass nem identificador de sessão. Modelo de resposta: `Anual [Consultório/Clínica] pago no Sandbox às HH:MM; Asaas: [estado]; Qoro: [estado]`.

**Problemas comuns.** Se o Checkout pedir Pix, não continue: Pix anual ainda não foi habilitado. Se ficar preso no reCAPTCHA, registre o horário e a mensagem e deixe o checkout pendente para o agente reconciliar ou limpar; não crie outro. Se o Asaas confirmar e a tela do Qoro continuar esperando, informe o horário sem repetir o pagamento. Se o link expirar, peça que o agente verifique primeiro se existe cobrança ou assinatura associada antes de preparar outra fixture.

**Próximo passo.** O agente compara banco, Asaas e UI e só então registra PASS ou FAIL, com a fixture paga identificada e isolada. A renovação após um ano e a troca mensal↔anual de contrato existente exigem provas separadas; este pagamento não as valida.

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

## Decisão contratual e revisão humana antes do lançamento

**Objetivo.** Validar linguagem de preço, trial, anual, aviso de uso de IA, custo Meta/Asaas e contratos existentes. A engenharia não deve inventar condição comercial ou jurídica.

**Pré-requisitos.** Versão final do app/landing e responsável jurídico/contábil da Qoro. Consulte [decisões da oferta](../specs/decisoes-oferta-e-precificacao-2026-10.md) e [roteiro técnico](validacao-nova-oferta-2026-10.md).

**Passos.** Revise a redação dos Termos e das telas contra os valores contratáveis, confirme a permanência integral do desconto vitalício do contrato existente, decida a comunicação para demais contratos legados e aprove ou devolva alterações. Não altere uma assinatura no Asaas para “testar” esta etapa.

**Resultado e evidência.** Documento/versão aprovada e data, sem dados pessoais do cliente de desconto. Resposta ao agente: `Texto comercial/jurídico versão … aprovado` ou `ajustes necessários: …`.

**Próximo passo.** Engenharia confronta aprovação com implementação e evidências de Sandbox antes de discutir publicação conjunta app/landing.
