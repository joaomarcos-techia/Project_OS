# Troca de App Meta para WhatsApp

Use este roteiro somente se for necessário trocar o **App Meta** que integra o
WhatsApp ao ClinicaOS. Criar um app novo não altera o banco nem os templates,
mas exige uma nova configuração de onboarding, webhook e reconexão do número.

> Não apague o app Meta atual antes de concluir a migração. Ele mantém o número
> atual operando enquanto o novo app é configurado e passa pela revisão.

## O que muda na Vercel

Crie ou substitua estas variáveis no ambiente **Production**. Repita em
**Preview** somente se for testar o novo app em um deployment de preview.

| Variável | Valor após criar o novo app | Origem | Observação |
| --- | --- | --- | --- |
| `META_APP_ID` | `<novo App ID>` | Meta App Dashboard | Muda. É usado pelo SDK do Embedded Signup e no servidor. Não é segredo. |
| `META_APP_SECRET` | `<novo App Secret>` | Meta App Dashboard → Settings → Basic | Muda. É segredo; não registrar em documento, código ou chat. Foi listado duas vezes no pedido, mas é uma única variável. |
| `META_CONFIG_ID` | `<novo Configuration ID do Embedded Signup>` | Configuração do Embedded Signup no novo app | Muda. Não é segredo. |
| `META_WEBHOOK_VERIFY_TOKEN` | `<token atual>` ou `<novo token aleatório>` | Definido pela plataforma | Não é fornecido pela Meta. Pode ser reutilizado. Se for trocado, o mesmo valor deve ser configurado no webhook do novo app Meta. |

Depois de alterar qualquer variável em Vercel, faça um **redeploy**. As
variáveis públicas e de runtime são capturadas pelo deployment; alterar a
variável não atualiza um deployment já existente.

### Variáveis que não mudam

Não altere estas variáveis por causa da troca de app:

| Variável | Motivo |
| --- | --- |
| `META_GRAPH_API_VERSION` | Continua usando a mesma versão da Graph API. |
| `META_HTTP_TIMEOUT_MS` | É apenas o limite de tempo das chamadas HTTP. |
| `DATABASE_URL`, `DATABASE_URL_RUNTIME`, `DATABASE_URL_PROD` | O banco e os dados não mudam. |
| `CRYPTO_MASTER_KEY_V1`, `CRYPTO_LOOKUP_SALT` | Trocar essas chaves pode impedir a leitura de credenciais já cifradas. |
| `GEMINI_API_KEY` e demais variáveis não-Meta | Não pertencem à integração do WhatsApp. |

## Modelos de mensagem no WhatsApp Manager

Os nomes abaixo devem ser usados **exatamente** ao criar os modelos na Meta.
Apesar do sufixo `_ID`, o código envia o **nome do modelo**, não um ID numérico.

| Variável da Vercel | Nome do modelo na Meta | Categoria | Variáveis |
| --- | --- | --- | --- |
| `META_TEMPLATE_CONFIRMATION_REMINDER_ID` | `lembrete_confirmacao` | Utilidade | nome, hora, profissional |
| `META_TEMPLATE_DUNNING_FRIENDLY_ID` | `amigavel_cobranca` | Utilidade | nome, data, valor |
| `META_TEMPLATE_WAITLIST_OFFER_ID` | `lista_espera_oferta` | Utilidade | nome, data, hora, profissional |
| `META_TEMPLATE_FOLLOWUP_RETURN_ID` | `retorno_consulta` | Utilidade | nome, profissional |

> **O texto do corpo NÃO fica neste documento.** Ele vive em
> `src/lib/messaging/proactive-template-catalog.ts`, junto dos exemplos de
> submissão — a copy e a ordem das variáveis precisam concordar, e duplicá-las
> aqui já produziu divergência uma vez. Copie de lá ao cadastrar na Meta.

Desde o provisionamento automático, a clínica que conecta pelo Embedded Signup
tem os quatro modelos criados por API na própria WABA. Este cadastro manual só
é necessário para uma WABA que já existia antes disso.

Configure na Vercel:

```text
META_TEMPLATE_CONFIRMATION_REMINDER_ID=lembrete_confirmacao
META_TEMPLATE_DUNNING_FRIENDLY_ID=amigavel_cobranca
META_TEMPLATE_WAITLIST_OFFER_ID=lista_espera_oferta
META_TEMPLATE_FOLLOWUP_RETURN_ID=retorno_consulta
META_TEMPLATE_LANG=pt_BR
```

Apagar um modelo bloqueia a reutilização do MESMO nome por 30 dias. Para trocar
a copy de um modelo já submetido, EDITE em vez de apagar: a edição dispara nova
revisão e preserva o nome.

Se a mesma WABA for mantida, os modelos já aprovados pertencem à WABA e não
precisam ser recriados apenas pela troca do app. Confirme no WhatsApp Manager
que permanecem disponíveis antes do corte.

## Configuração necessária no novo App Meta

Antes de mudar a Vercel, deixe o novo app pronto:

1. Crie o novo app e adicione o produto WhatsApp.
2. Crie a configuração do Embedded Signup e copie o novo `Configuration ID`.
3. Configure os domínios e URLs permitidos usados pelo onboarding, incluindo
   `https://app.qoro.dev`.
4. Configure o webhook do app Meta:
   - **Callback URL:** `https://app.qoro.dev/api/webhooks/meta`
   - **Verify token:** exatamente o valor de `META_WEBHOOK_VERIFY_TOKEN`.
   - Assine o campo/evento `messages`.
5. Conclua a verificação exigida pela Meta e solicite somente as permissões
   efetivamente necessárias pelo fluxo atual:
   - `whatsapp_business_management`
   - `whatsapp_business_messaging`

`public_profile` é concedida automaticamente pelo Facebook Login. O sistema
atual não pede nem valida `business_management`. Não solicite
`whatsapp_business_manage_events` sem implementar o respectivo caso de uso de
eventos de marketing/conversão.

## Corte e reconexão do número

`META_APP_SECRET` valida a assinatura HMAC de cada webhook. Portanto, depois de
trocar esse valor, um webhook assinado pelo app antigo deixa de ser aceito. Faça
o corte em uma janela curta e teste logo em seguida.

1. Deixe o app antigo ativo até o novo estar configurado e aprovado.
2. Na tela **Configurações → WhatsApp** do ClinicaOS, desconecte o número atual.
   Isso desativa o vínculo local e tenta remover a assinatura antiga da WABA.
3. Atualize as quatro variáveis da seção **O que muda na Vercel** e faça o
   redeploy de produção.
4. Abra novamente **Configurações → WhatsApp** e conecte o mesmo número pelo
   novo Embedded Signup. Informe o PIN de registro de seis dígitos solicitado
   pela Meta.
5. O sistema troca o código por um novo token, valida os escopos, registra o
   número, assina a WABA no webhook e salva o novo token cifrado no banco.
6. Envie uma mensagem de um WhatsApp pessoal diferente para o número da clínica.
   Confirme que ela aparece em `/conversas` e que a resposta é recebida.

Não copie manualmente tokens para o banco e não altere registros de
`clinic_whatsapp_numbers` diretamente.

## Checklist final

- [ ] Novo app Meta configurado, sem apagar o antigo.
- [ ] `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID` atualizados na Vercel.
- [ ] `META_WEBHOOK_VERIFY_TOKEN` igual na Vercel e no novo webhook Meta.
- [ ] Redeploy concluído após a alteração das variáveis.
- [ ] Número desconectado do app antigo e reconectado no novo Embedded Signup.
- [ ] Webhook `messages` assinado para a WABA no novo app.
- [ ] Uma mensagem inbound aparece em `/conversas` e recebe resposta.
