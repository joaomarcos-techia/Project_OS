# Ações humanas pendentes — oferta 2026 (Preview e Sandbox)

Atualizado em 21/10/2026. Este documento contém somente ações que exigem uma pessoa ou acesso ao painel indisponível à automação. **Não altere produção, não use cartão real, não copie chaves, senhas, OTP ou URLs com bypass para o chat.** Os testes de código, migrations DEV, fixtures e readbacks pertencem à engenharia e não devem ser repetidos manualmente. A nova tabela ainda não está pronta para publicação.

## Obrigatória 1 — Conferir visualmente as duas prévias após o próximo deploy

**Objetivo.** Confirmar que a versão publicada da branch mostra a mesma proposta em desktop e celular. Build local não prova a tela protegida por SSO da Vercel.

**Pré-requisitos.** Acesso ao time `clinic-os-v2-s-projects` na Vercel; no app, uma conta de teste do DEV. Espere o agente informar o novo SHA como `Ready`. Se o Preview mostrar um SHA anterior, não registre PASS.

**Links.** [App — oferta](https://project-os-git-integration-prici-c5e6c6-clinic-os-v2-s-projects.vercel.app/oferta-preview) e [landing — preços](https://landing-page-git-preview-pricing-05406a-clinic-os-v2-s-projects.vercel.app/precos-preview).

**Passo a passo.**

1. Abra cada link no navegador em que está logado na Vercel. Se aparecer a porta do SSO, entre pelo time e retorne ao mesmo link.
2. Na landing, compare 1, 2, 3 e 5 médicos com 0 e 3 logins de equipe. Os valores mensais esperados são R$ 197, R$ 397, R$ 544 e R$ 838. Quatro logins de equipe e seis médicos devem ser recusados. O anual (dez mensalidades) e as 500 conversas devem estar marcados como proposta, sem botão de compra anual.
3. No app, entre com conta **DEV** e repita 1, 2, 3 e 5 médicos. Confirme que a simulação não abre Checkout.
4. No navegador, use F12 → modo celular (largura próxima de 375 px). Repita os passos 2 e 3, role até o fim, confira ausência de corte lateral, texto legível, foco por Tab e mensagens de erro ao digitar limites inválidos.
5. Na landing, confira o botão de contato para clínicas maiores apontando para `wa.me/5588996822198`; não é necessário enviar mensagem.

**Resultado e evidência.** Anote SHA exibido no deployment, navegador, largura, página, valores e qualquer elemento cortado. Screenshot pode mostrar apenas a proposta pública, nunca sessão, cookies, DevTools ou dados de pacientes. Resposta curta ao agente: `Preview app SHA …: desktop/mobile OK ou falha …; landing SHA …: desktop/mobile OK ou falha …`.

**Problemas comuns.** Se voltar ao login da Vercel, confirme que você está no time correto. Se a página disser oferta antiga, verifique se o deployment da branch está `Ready` antes de concluir. Se a URL de branch mudou, copie a nova URL **sem** query de bypass, token ou cookie.

**Próximo passo.** Entregue o resultado ao agente; ele confrontará com o teste automatizado e corrigirá qualquer divergência antes de publicar.

## Obrigatória 2 — Concluir o Checkout adicional somente quando a fixture estiver pronta

**Objetivo.** O reCAPTCHA/cartão do Asaas Sandbox pode exigir uma pessoa. A ação fecha a prova de `upgrade → pagamento → webhook → banco → cota → tela` para o terceiro médico.

**Pré-requisitos.** O agente deve primeiro confirmar por escrito: Preview com SHA novo, Auth e banco do projeto DEV, conta Asaas **Sandbox**, clínica sintética identificada, assinatura ativa de R$ 397, valor proporcional mostrado e plano de limpeza. Sem essa confirmação, **não pague**. Use somente cartão de teste fornecido pela interface/documentação oficial do Sandbox; nunca cartão real.

**Link.** [Assinatura da clínica de teste no Preview](https://project-os-git-integration-prici-c5e6c6-clinic-os-v2-s-projects.vercel.app/configuracoes/assinatura). O link do Checkout é gerado pelo botão de upgrade e expira; não existe URL fixa a registrar aqui.

**Passo a passo.**

1. Entre no Preview com o titular da clínica sintética indicada pelo agente. Confirme que a tela mostra **Clínica — 2 médicos** e o preço de R$ 397/mês; se mostrar outra clínica, pare.
2. Clique em **Contratar +1 médico**. Confira a diferença proporcional e o novo valor recorrente **R$ 544/mês** antes de abrir o Asaas. Se o valor não aparecer ou divergir, não conclua.
3. No domínio `sandbox.asaas.com`, conclua o reCAPTCHA e pague somente com o meio de teste aprovado para esta fixture.
4. Volte ao Qoro pelo botão do Checkout. Aguarde a confirmação do servidor; a página de retorno sozinha não comprova pagamento. Se a tela ficar em espera, anote horário e estado, sem repetir a compra.
5. Avise `Checkout do terceiro médico concluído às HH:MM; tela Qoro: …`. Não envie URL de sessão, recibo com PII nem credenciais. O agente fará readback de valor, webhook, assinatura, plano, cota, replay e cleanup.

**Resultado e evidência.** Asaas deve indicar pagamento de teste; Qoro deve mostrar novo plano apenas depois da confirmação. Registre horário, ID do pagamento **somente se não contiver token** e estado textual da tela. O PASS final será dado pelo readback do agente.

**Problemas comuns.** Se o botão não aparecer, os planos adicionais ainda não estão ativados no DEV ou o Preview está antigo; não tente alterar o banco. Se houver `invalid_action` ou reCAPTCHA preso, guarde o código do erro e horário. Se pagar e o Qoro continuar esperando, não pague de novo: a reconciliação é trabalho do agente.

**Próximo passo.** Aguarde a confirmação técnica e a limpeza da fixture antes de qualquer outro Checkout.

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
