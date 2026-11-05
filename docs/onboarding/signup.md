---
title: "Cadastro autônomo e retomada"
description: "Estados do funil, senha única, confirmação por código, escolha do plano e provisionamento."
docType: "reference"
reviewedAt: "2026-11-05"
---

## Responsabilidade e fontes

O contexto `onboarding` mantém a intenção de cadastro antes de existir uma clínica.
`identity` valida a identidade; `billing` resolve catálogo e assinatura; `tenancy`
recebe a clínica provisionada. As rotas ficam em `src/app/api/signup` e a UI em
`src/app/(app)/cadastro`.

Fontes principais: `onboarding/internal/signup-session.ts`,
`signup-auth-binding.ts`, `signup-recovery.ts`, `signup-draft.ts`,
`signup-trial.ts`, `signup-checkout.ts` e `signup-provision.ts`.

## Caminho normal

1. O visitante entra em `/cadastro` e responde às perguntas da clínica. Uma sessão
   anônima com cookie HttpOnly preserva o progresso permitido pelo contrato.
2. Informa os dados de identidade, aceita as condições e define a senha inicial.
   A senha é tratada pelo Supabase Auth; não é colocada no draft, URL ou log.
3. Recebe um código temporário por e-mail e o informa na mesma jornada. Tentativas,
   expiração, reenvio e reserva de envio são controlados no servidor.
4. A prova do e-mail libera a continuação. O caminho atual preserva a senha inicial
   já comprovada; não pede que seja criada novamente.
5. Em `/cadastro/plano`, escolhe um plano. **Continuar para o checkout** salva a
   escolha e, depois de conferir a resposta, inicia o checkout hospedado no Asaas.
6. O servidor reconcilia o resultado autoritativo antes de provisionar a clínica.
   Só então o usuário segue pela renovação da sessão até o dashboard.

## Estados não são páginas visitadas

| Fato | Representação e interpretação |
| --- | --- |
| Sessão anônima | `signup_sessions`; não é usuário Auth, clínica ou assinatura |
| Identidade em andamento | Reserva da tentativa e identidade pendente; envio de e-mail pode ter falhado |
| E-mail pendente | A mensagem foi solicitada; isso não comprova entrega ou leitura |
| E-mail comprovado | Identidade vinculada ao draft e credencial com proveniência validada |
| Senha pendente | Caminho de compatibilidade/recuperação para quem ainda não possui uma senha confiável |
| Plano selecionado | Seleção persistida; ainda não comprova checkout ou pagamento |
| Checkout em andamento | Identificador e estado da tentativa; um redirecionamento não ativa uma clínica |
| Assinatura reconciliada | Fato do provedor aplicado conforme o contrato, inclusive exigência pós-trial |
| Clínica provisionada | Dados e perfil criados pela saga; conta pronta para a continuação autenticada |

Esses fatos são distribuídos entre draft, binding de Auth, tentativa de billing e
provisionamento. Não invente um único enum para representar todos eles.

## Salvar e continuar é uma ação

`plan-selection-form.tsx` usa as APIs existentes em sequência: `PUT /api/signup/plan`
e `POST /api/signup/checkout`. O navegador envia plano/ciclo/versão, não o preço.
Se a seleção já está persistida, a continuação não repete sua escrita.

Cliques concorrentes são bloqueados enquanto a operação está em andamento. Falha,
conflito ou confirmação incompatível no salvamento não inicia checkout. Falha
posterior preserva a seleção para retomada. Reservas e reconciliação no servidor
continuam sendo a proteção financeira contra duplicidade.

## Recuperação e compatibilidade

`/cadastro/retomar` utiliza uma autorização individual, temporária e de uso único.
A leitura inicial do link não consome a autorização: a continuação exige ação
explícita. A prova converge para a mesma lógica central, identidade e draft.

Quando a senha confiável já existe, ela é preservada. Quando não existe, a pessoa
vai para sua definição segura. Links e códigos legados continuam tratados pelos
contratos de compatibilidade; eles não são um segundo cadastro independente.

Recarregar, abrir outra aba, trocar de dispositivo ou repetir a requisição não
autoriza duplicar conta, substituir senha ou criar nova assinatura sem reconciliação.

## Trial e disponibilidade

Para códigos da oferta 2026, o prazo é `auth.users.created_at + 14 dias`.
Reenviar mensagem, restaurar draft ou provisionar depois não reinicia esse prazo.
O Asaas recebe data sem horário: o primeiro vencimento fica no dia UTC seguinte
ao fim exato; se o checkout já acontece após o trial, o vencimento é a data corrente
e a liberação exige pagamento confirmado.

`SIGNUP_ENABLED`, `SIGNUP_AUTH_ENABLED`, `SIGNUP_IDENTITY_ENABLED` e a configuração
de risco/provedores controlam fronteiras diferentes. A presença de `/cadastro`
não prova que todas as etapas estão liberadas. Variáveis de deploy devem ser
conferidas no ambiente correto e precisam de novo deployment quando aplicável.

## Evidência e diagnóstico

Correlacione intenção, envio/entrega, prova de e-mail, seleção, tentativa de
checkout, resultado do provedor e provisionamento. Não deduza abandono de uma
conversão de anúncio, nem leitura humana de um evento de entrega.

Use os [testes](/development/testing), as [evidências](/quality/index)
e o fluxo separado de [convites](/onboarding/invitations). Não faça disparo a lead real
nem mutação financeira para diagnosticar sem autorização específica.
