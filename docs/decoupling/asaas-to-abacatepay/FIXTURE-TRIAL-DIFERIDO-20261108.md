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

Estado inicial: manifesto/produtos em preparação; pagamento externo **NOT RUN**. Evidência atualizada no [diário](PLANO-EXECUCAO-CONTINUIDADE.md).
