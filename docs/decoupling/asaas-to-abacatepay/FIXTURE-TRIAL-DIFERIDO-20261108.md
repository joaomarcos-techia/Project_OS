# Fixture Sandbox — trial diferido

Run de catálogo: `qoro-trial-deferred-20261108`. Somente a loja Sandbox já atestada pelo produto de prova `prod_yFBfdSA5twXU3hLREy1YkJtW`, confrontada com o hash da loja do ensaio de 07/11. Nenhuma informação de paciente, contrato real ou chave integra esta fixture.

## Preparação antes dos efeitos

O manifesto protegido fica em `%LOCALAPPDATA%/Qoro/SandboxBilling/qoro-trial-deferred-20261108/manifest.json`. Ele registra o run, hash da conta, operação UUID por produto, referência externa, valor em centavos, moeda, ciclo e resultado esperado **antes** de qualquer POST. O journal por operação fica na mesma pasta. Se um comando ficar desconhecido, preservar a reserva e consultar antes de tentar novamente.

| Plano da fixture | Preço mensal esperado | Produto |
| --- | --- | --- |
| `consultorio_2026` | R$ 197 (19.700 centavos) | Nome começa com `[SANDBOX] Qoro`; `MONTHLY`, `BRL`, sem `trialDays` |
| `clinica_2026_2` | R$ 397 (39.700 centavos) | Nome começa com `[SANDBOX] Qoro`; `MONTHLY`, `BRL`, sem `trialDays` |

Esses valores são os da oferta aprovada, não um novo preço comercial. O mapa do Preview só pode usar os IDs após readback autenticado confirmar loja, `devMode=true`, ciclo, moeda, valor e ausência de trial nativo. Presença da chave e loja vazia não atestam Sandbox. Não reutilizar o checkout histórico de R$ 1 como prova de assinatura Qoro integral.

## Separação do pagamento

Criar os dois produtos **não cria checkout, cliente, assinatura ou pagamento**. Antes de um checkout, anexar ao manifesto a identidade Auth sintética, clínica, contrato, preço e binding DEV correspondentes. Somente a rota de contratação, autenticada como titular da fixture, pode emitir esse checkout com journal no DEV. O teste temporal pode ajustar apenas a criação Auth da identidade sintética antes do provisionamento, preservando a relação exata de 14 dias. Não atualizar datas de trials ou contas existentes.

Teste esperado: trial sem operação remota; bloqueio no prazo; contratação mensal; pagamento Sandbox humano quando exigido; secret+HMAC; readback integral; invoice única; origem preservada; cotas temporárias liberadas e limites do plano mantidos; leitura final na UI. Código sintético ou redirect não satisfazem o pagamento externo.

## Retenção e limpeza

Preservar a fixture até conciliar todos os eventos, inclusive pagamento tardio; não apagar por timeout do teste. Após a conclusão, identificar assinaturas pelo manifesto e comprovar o estado no Sandbox antes de cancelar recorrências da fixture. Não tocar em clientes, produtos ou cobranças fora desse run. Não remover produtos em uso nem fazer estorno automático. Preservar journal, inbox, binding e evidências financeiras; dados de teste podem ser desativados por procedimento identificado, sem apagar rastreabilidade ou fabricar titulares.

Se houver falha parcial, registrar somente código sanitizado, etapa e IDs do run. Não registrar chave, secret do webhook, URL com bypass, senha, dados do cartão ou conteúdo clínico. Nunca enviar o link como cobrança real.

Estado atualizado: produtos Sandbox criados e atestados; 0138 aplicada somente no DEV e Preview exclusivo READY. Três E2E reais passaram: trial ativo sem checkout (Consultório), trial vencido com checkout (Clínica) e leitura da assinatura paga com gates liberados. As identidades foram confirmadas administrativamente, sem envio de e-mail. O webhook V2 real foi recebido e aplicado; nenhuma invoice foi inserida manualmente nem evento positivo foi injetado.

Fixture financeira retida: run `6a37f97e-8173-4b88-8875-dd8c0f8b7f78`, clínica `104e59df-fd52-4215-8e78-dfc26fa2e40d`, contrato `72e1b294-534c-4e01-9028-4a565d33c35b`, checkout `bill_dKcTZUwUXYK2kgfqDnu6nLnq`, valor R$ 397. Readback de 09/11 às 00:36 UTC: **PAID**, 39.700/39.700 centavos, uma assinatura `subs_yDzKEeh6ycdXeJk1yLZwZpsh` ACTIVE/CARD, sem trial nativo. Pagamento executado uma vez no modo de simulação hospedado do próprio provedor, usando seu preenchimento fictício, sem cartão real. Uma invoice paga, um receipt, uma tentativa confirmada e evento `subscription.completed` aplicado no DEV. Cotas liberadas às 00:31:19 UTC; acesso Qoro de 09/11 às 00:31:10.888 UTC até 09/12 no mesmo horário. Isso não afirma a próxima data de cobrança do provedor nem renovação temporal observada.

O E2E posterior comprovou UI paga em 1440/390 px, tentativa de novo checkout recusada (409) e remoção dos bloqueios temporários de WhatsApp, Asaas e convite, sem conectar integrações nem convidar alguém. O navegador isolado do checkout retornou à proteção SSO da Vercel: a continuação autenticada nesse mesmo contexto não foi comprovada; o teste final entrou legitimamente na conta da fixture. Credenciais cifradas por DPAPI, sem sessão ou senha no Git. **Não pagar novamente este checkout** nem apagar a fixture antes de concluir os eventos de ciclo de vida. Evidências e limites no [diário](PLANO-EXECUCAO-CONTINUIDADE.md).

## Cancelamento autorizado em 09/11

Após aprovação específica, a 0139 foi aplicada somente no DEV. O manifesto `cancellation-0139.json` foi preparado na mesma pasta protegida antes do comando. Às `2026-11-09T03:57:10Z`, o ensaio confirmou `subs_yDzKEeh6ycdXeJk1yLZwZpsh` **CANCELLED** no Sandbox, uma operação confirmada no Qoro e acesso pago preservado até `2026-12-09T00:31:10.888Z`. A invoice, binding e trial continuam intactos; nenhum novo checkout/pagamento foi emitido. O resultado `cancellation-0139-result.json` fica junto ao manifesto e a [evidência sanitizada](evidencias/cancellation-0139-20261109.json) fica no Git.

A fixture não deve ser reativada ou ter datas deslocadas para forçar recontratação. Antes do prazo, `/api/billing/checkout` recusa HTTP 409. Após o prazo, a nova contratação deverá utilizar outro registro/checkout preservando o histórico; a passagem real ainda não ocorreu. Não apagar a fixture nem pagar o checkout antigo. Retomar renovação financeira e demais eventos com fixtures próprias e manifesto prévio.
