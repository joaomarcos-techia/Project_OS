# Runbook — conta de pagamento da clínica (Asaas)

## Status

Canonical — operação das sub-fases **1.1 (credencial)**, **1.2 (política)**, **1.3 (cobrança + hold)**, **1.4 (conciliação)** e **1.5a (falta e estorno)** do [qorov2](../qorov2.md) / [ADR-049](../adr/049-pagamentos-paciente-sinal.md) + [ADR-050](../adr/050-identidade-de-pagamento-do-paciente.md).

## Source of Truth

`src/contexts/payments/*` (incl. `internal/charge-closeout.ts`), `src/lib/payments/account-store.ts`, `src/contexts/scheduling/internal/deposit-hold.ts`, migrations `0081`–`0086`.

> O webhook da conta do **Qoro** (assinatura da clínica) é outro, e tem runbook próprio:
> [asaas-webhook-assinatura](asaas-webhook-assinatura.md).

## O que esta conta é

A conta **Asaas da própria clínica** (Modelo B). O dinheiro do paciente cai direto nela; o Qoro nunca
custodia o valor. Não confundir com a conta Asaas **do Qoro**, que cobra a assinatura da clínica
(essa vive em `billing` e usa `ASAAS_API_KEY` do env).

## Regras que valem antes de qualquer diagnóstico

- **Nunca peça a chave por WhatsApp, e-mail ou chat.** O único caminho é a clínica colar em
  `/configuracoes/pagamentos`. Quem pedir a chave por outro canal está criando um vazamento.
- **A chave não é recuperável.** Ela é cifrada por tenant e a coluna está fora do grant de
  `authenticated`. Suporte não lê, admin não lê, ninguém lê pela aplicação. Se a clínica perdeu a
  chave, ela gera outra no painel do Asaas e reconecta.
- Quem conecta precisa de `manage:financial` (é o mesmo gate da página e da Server Action).

## Sintoma: "não consigo conectar a conta"

A tela distingue dois erros, e eles pedem ações opostas:

| Mensagem na tela | Significa | O que fazer |
| --- | --- | --- |
| "O Asaas não aceitou essa chave…" | HTTP 4xx no `GET /myAccount` — chave errada, revogada, ou de outra conta | A clínica confere/gera a chave no painel Asaas e cola de novo |
| "Não deu para confirmar a chave com o Asaas agora…" | timeout, 5xx ou circuit breaker aberto | **Não troque a chave.** Espere e tente de novo; cheque a saúde do Asaas |
| "Confira a chave: ela não pode ficar em branco nem conter espaços" | colagem quebrada (quebra de linha no meio) | Colar novamente, sem quebra |

Nada é gravado em nenhum dos três casos — por desenho: chave não verificada não entra no banco.

## Verificar o estado atual

Pelo app: `/configuracoes/pagamentos` mostra conectada/desconectada, nome da conta e desde quando.

Pelo banco (service_role, **sem** as colunas do segredo — elas não são legíveis pela aplicação):

```sql
SELECT clinic_id, provider, active, key_version, account_name, connected_at, disconnected_at
FROM clinic_payment_accounts
WHERE clinic_id = '<uuid>';
```

`active = true` implica que existe chave: o CHECK `active = false OR api_key_encrypted IS NOT NULL`
torna "ativa sem chave" impossível.

## Trocar a chave (rotação)

A clínica cola a chave nova na mesma tela. Efeito: `key_version` incrementa e a chave anterior é
sobrescrita. Reenviar **exatamente a mesma** chave não faz nada (sem bump, sem evento de auditoria).

> `key_version` é o sinal de que um client Asaas em cache ficou velho. Quando existir cache de client
> por clínica (1.3+), ele precisa reagir a essa coluna — o circuit breaker vive na instância.

## Desconectar

O botão "Desconectar" **apaga** a chave (`NULL`), não apenas marca inativo. Depois disso a clínica
não consegue cobrar o paciente pelo sistema até reconectar.

## Trilha de auditoria

Toda conexão e desconexão grava em `audit_events` na mesma transação da escrita ("no audit, no op"):

```sql
SELECT created_at, user_id, action, resource_id, after
FROM audit_events
WHERE clinic_id = '<uuid>' AND action LIKE 'payments.account.%'
ORDER BY created_at DESC;
```

O `after` traz `provider`, `accountName` e `keyVersion` — nunca a chave nem o hash (a lista
`SENSITIVE_KEYS` também redige as duas formas, como segunda rede).

## Métricas

`payments.account.connected` e `payments.account.disconnected`, ambas com `clinicId` e `changed`.
`changed: false` = reenvio da mesma chave (connect) ou nada a desconectar.

## Política de sinal (mesma tela)

A regra vive em `clinic_deposit_policy`, uma linha por clínica. **Clínica sem linha = sinal
desligado**, que é o comportamento padrão.

```sql
SELECT enabled, percent, cancellation_window_hours,
       applies_to_first_visit, applies_to_return, updated_at, updated_by
FROM clinic_deposit_policy
WHERE clinic_id = '<uuid>';
```

| Situação | O que significa |
| --- | --- |
| `enabled = false` (ou sem linha) | nenhuma cobrança de sinal é gerada; agendamento segue como sempre |
| `enabled = true` sem conta Asaas conectada | a tela avisa em amarelo — a regra existe mas não cobra ninguém |
| `cancellation_window_hours` | **antecedência mínima** para o cancelamento devolver o sinal. 24 = precisa cancelar 24h antes; 0 = basta cancelar antes do horário |

Trocas de política ficam em `audit_events` com a regra ANTERIOR no `before` — é assim que se
responde "por que esse paciente foi cobrado 50%?" meses depois:

```sql
SELECT created_at, user_id, before, after
FROM audit_events
WHERE clinic_id = '<uuid>' AND action = 'payments.deposit_policy.updated'
ORDER BY created_at DESC;
```

O banco recusa configuração morta: percentual fora de 1..100, janela fora de 0..720h, ou política
ligada sem nenhum caso marcado. Se um `UPDATE` manual falhar por CHECK, é isso.

## Cobrança do sinal (o que roda sozinho)

O cron `/api/cron/payments-deposit` roda **a cada 15 minutos** e faz as duas pontas do ciclo:

1. **cobra** — clínicas com `enabled = true` → agendamentos `agendado` criados nas últimas 24h →
   cria customer (se faltar) e cobrança no Asaas → grava `patient_charges` → evento faz a agenda
   segurar a vaga (`appointments.deposit_status = 'pending'`);
2. **expira** — holds vencidos → cancela o agendamento pela máquina de estados
   (`cancel_reason = 'deposit_expired'`) e devolve a vaga à lista de espera.

As duas metades são independentes: se o Asaas estiver fora do ar, os holds vencidos continuam
expirando. E a varredura é **auto-curável** — não há fila para "recuperar": a próxima passada
recobre a janela inteira.

### "Por que este agendamento não gerou cobrança?"

Percorra nesta ordem — a resposta quase sempre é uma destas, e nenhuma é erro:

| Situação | Como confirmar |
| --- | --- |
| Política desligada | `SELECT enabled FROM clinic_deposit_policy WHERE clinic_id = '<uuid>'` |
| Conta Asaas não conectada | métrica `payments.deposit.skipped_no_account` |
| Paciente sem CPF válido | métrica `payments.deposit.skipped_no_identity` (ADR-050: **não** se pede o CPF ao paciente) |
| Agendamento sem paciente, valor zero, ou tipo fora do escopo | regras em `payments/policy.ts` |
| Agendamento com mais de 24h | fora da janela de varredura (por desenho) |
| **Sinal daria menos de R$ 5,00** | mínimo do Asaas. Métrica `payments.deposit.skipped_below_minimum` — ajuste o percentual ou o valor do procedimento |

```sql
SELECT status, amount, hold_expires_at, provider_payment_id, failure_code
FROM patient_charges WHERE appointment_id = '<uuid>';
```

### "O sistema cancelou a consulta de um paciente que pagou"

Não deveria ser possível: o CHECK `appointments_deposit_hold_chk` só permite `hold_expires_at`
preenchido quando `deposit_status = 'pending'`, e a varredura só olha `pending`. Se acontecer,
é bug — preserve a linha e o `audit_events` do cancelamento antes de mexer.

## Aviso de pagamento (webhook da clínica)

Cada clínica tem **sua própria URL** (`/api/webhooks/asaas/patient/<ref>`) e **seu próprio token**,
porque cada uma tem sua conta Asaas. Ambos são gerados por nós ao conectar e guardados cifrados —
o `ref` e o token **não** são legíveis pela aplicação nem exibidos na tela.

O registro no Asaas é automático, mas **best-effort**. Se falhar, a conexão continua válida e a tela
mostra um aviso amarelo. Confira:

Em Preview com Vercel Authentication, o auto-registro acrescenta
`x-vercel-protection-bypass` à URL usando `VERCEL_AUTOMATION_BYPASS_SECRET`. Se o segredo estiver
ausente, o sistema **não registra** uma URL condenada a 401: mantém `webhook_configured_at` nulo e
deixa a falha visível na tela. Produção nunca recebe esse query param.

```sql
SELECT active, webhook_configured_at
FROM clinic_payment_accounts WHERE clinic_id = '<uuid>';
```

`webhook_configured_at IS NULL` **com a conta ativa** é o estado ruim: cobranças serão criadas e
**nunca conciliadas** — todo hold vence e o agendamento é cancelado. Correção: reenviar a chave na
tela (o connect tenta configurar de novo). Métricas: `payments.webhook.configured` e
`payments.webhook.configure_failed`.

> Trocar a conta gera token novo e zera `webhook_configured_at` de propósito: um token velho
> apontando para a conta anterior aceitaria webhook de quem não deveria mais mandar.

### Diagnóstico de webhook que não chega

| Sintoma | Causa provável |
| --- | --- |
| 404 nos logs | `ref` errado na URL configurada no Asaas, ou conta desconectada |
| 401 | token divergente — reconecte para regerar e reconfigurar |
| 500 repetido | `getPayment` falhando (Asaas instável). O Asaas re-entrega; o `billing-reconcile` não cobre cobrança de paciente |
| 200 com `outcome: unknown_charge` | o pagamento existe no Asaas mas não há `patient_charges` correspondente — cobrança criada fora do sistema |

```sql
SELECT asaas_event_id, event_type, processed_at
FROM patient_webhook_events WHERE clinic_id = '<uuid>' ORDER BY processed_at DESC LIMIT 20;
```

### "O paciente pagou depois de eu cancelar"

O sistema registra o pagamento (`patient_charges.status = 'paid'`) e **não** ressuscita o horário —
`confirmado` a partir de `cancelado` não é transição válida, e a vaga pode já ter sido dada a outra
pessoa. Fica a métrica `scheduling.deposit.paid_on_inactive_appointment`.

Desde a **1.5a** o cancelamento em si já não deixa link vivo: ao cancelar, o sistema **apaga a
cobrança no Asaas** antes que ela possa ser paga. Este caso sobra apenas na corrida real — o paciente
pagou nos segundos entre a criação do link e o cancelamento. Aí o handler **não apaga nada** (destruir
o registro de um pagamento que entrou seria pior), emite `payments.deposit.void_blocked_paid` e
**volta depois**: quando o webhook conciliar, a cobrança fica `paid` e o caminho de estorno decide.

> Se o evento do outbox esgotar as tentativas nesse estado, quase sempre a causa é
> `webhook_configured_at IS NULL` — sem webhook a cobrança nunca chega a `paid`, e o handler fica
> esperando algo que não vem. Reconecte a conta na tela.

## Falta e estorno (1.5a)

O que acontece sozinho quando um agendamento morre, por ramo:

| Situação | Sinal pago | Sinal ainda pendente |
| --- | --- | --- |
| **Faltou** (`no_show`) | **retido** — é a taxa de no-show. Nada é escrito: o par (`patient_charges.paid`, agendamento `faltou`) **é** o fato | o link é **apagado no Asaas** e a cobrança fecha como `cancelled` |
| **Cancelou dentro da janela** | **estornado** (`refunded`) | link apagado, cobrança `cancelled` |
| **Cancelou fora da janela** | **retido** | link apagado, cobrança `cancelled` |
| **Hold venceu** (`deposit_expired`) | — (não há pago com hold vencido) | link apagado, cobrança `expired` |

**Não existe status `retained`, e é de propósito.** Retenção é derivada; gravá-la passaria a mentir no
dia em que a agenda for reaberta (`faltou → agendado`). Para medir quanto a clínica reteve:

```sql
SELECT sum(c.amount) AS retido
FROM patient_charges c
JOIN appointments a ON a.id = c.appointment_id
WHERE c.clinic_id = '<uuid>' AND c.status = 'paid'
  AND a.status IN ('faltou', 'cancelado');
```

### Motivos que devolvem o sinal SEM olhar a janela

`doctor_absence` · `patient_deceased` · `patient_deleted` · `reschedule`. Em nenhum deles o paciente
deixou a vaga vazia por escolha: a clínica desmarcou, o paciente morreu, exerceu exclusão de LGPD, ou
remarcou — e remarcar gera agendamento **novo**, que a varredura cobra de novo. Sem devolver o
primeiro, o paciente pagaria **dois sinais pela mesma consulta**.

> Efeito colateral aceito: quem remarca em cima da hora não paga taxa. Entre a clínica perder a taxa
> e o paciente ser cobrado em dobro, a escolha foi o paciente. Transferir o sinal para o agendamento
> novo (em vez de estornar e recobrar) é a melhoria registrada em **D23**.

### "Por que este cancelamento não estornou?"

Cada resposta tem métrica própria — nenhuma é erro silencioso:

| Métrica | Significa |
| --- | --- |
| `payments.deposit.retained` (`reason: cancelamento_fora_da_janela`) | cancelou tarde demais. Funcionou como projetado |
| `payments.deposit.refund_skipped` (`conta_desconectada`) | a clínica desconectou a conta. **A cobrança NÃO é marcada `refunded`** — marcar sem devolver seria o sistema mentindo. Reconecte e trate pelo painel |
| `payments.deposit.refund_skipped` (`provider_nao_confirma_pagamento`) | nosso banco diz `paid`, o Asaas diz que não recebeu. Divergência para olhar à mão |
| `payments.deposit.refund_skipped` (`forma_de_pagamento_nao_estornavel`) | pago por **boleto** ou marcado como recebido **em dinheiro**. O estorno automático do Asaas cobre PIX e cartão; nesses dois a devolução é feita **por uma pessoa, pelo painel**. A cobrança fica `paid` de propósito — marcar `refunded` diria que o paciente já recebeu de volta |
| `payments.deposit.gateway_rejected` | o Asaas recusou (4xx). O evento vira **poison pill**: retentar repetiria a mesma recusa. Precisa de olho humano |
| `payments.deposit.refund_skipped` (`agendamento_nao_encontrado`) | o agendamento sumiu (hard-delete). Sem o horário não há como julgar a janela |
| `payments.deposit.cancel_without_timestamp` | evento antigo, da janela de deploy, sem `cancelledAt`. Caiu para o relógio do worker |
| `payments.deposit.void_orphan_link` | conta desconectada: a cobrança fechou aqui, mas o link segue vivo no Asaas. Só a clínica pode removê-lo |

### O que o estorno NÃO faz

- **Não estorna boleto nem pagamento em dinheiro.** Só PIX e cartão. Nos outros a devolução é
  manual, pelo painel do Asaas — e o sistema deixa a cobrança `paid` para não mentir.
- **Não estorna parcialmente.** O sinal volta inteiro ou não volta.
- **Não devolve a vaga.** Estornar não ressuscita agendamento: a máquina de estados continua
  congelada, e `deposit_status` é dimensão ortogonal.
- **Não estorna duas vezes.** Antes de devolver, o sistema consulta `getPayment`; cobrança já
  `REFUNDED` só é fechada no banco, sem um segundo POST.

## O paciente recebe o link (1.6a)

O link **não** era entregue até a 1.6a: a cobrança nascia, o `invoice_url` ficava guardado em
`patient_charges`, e ninguém o mandava. O hold vencia, a varredura cancelava o agendamento, e o
paciente perdia a consulta sem nunca ter recebido como pagar — anti-no-show que produzia no-show.

O caminho agora:

```
cobrança criada com link  →  payments.patient_charge.link_ready
                          →  fila C14 (ai_proactive_jobs, type = deposit_link)
                          →  cron /api/cron/proactive-deposit-link (15 min, 8-20h local)
                          →  template Meta aprovado
```

**A IA continua read-only em cobrança (ADR-023).** Não há LLM em nenhum ponto: o sistema gera a
cobrança e a fila envia um template aprovado. O agente entrega o que o sistema decidiu.

### Pré-requisito que só a clínica/o fundador resolve

O template precisa estar **aprovado na Meta** e o nome em `META_TEMPLATE_DEPOSIT_LINK_ID`. Sem isso o
job falha com `template_not_configured` — visível, nunca silencioso, e **nunca** cai para texto livre.
A copy canônica está em `src/lib/messaging/proactive-template-catalog.ts` (`deposit_link`).

### "Por que este paciente não recebeu o link?"

A resposta está no `failed_reason` do job ou na métrica de cancelamento:

| Motivo | O que aconteceu |
| --- | --- |
| `charge_not_payable` | a cobrança já foi paga, estornada, cancelada ou expirou **entre** o enfileiramento e o envio. Não enviar é o certo |
| `appointment_inactive` | o agendamento saiu de `agendado` (confirmado por outro caminho, ou cancelado) |
| `no_contact` | paciente sem telefone |
| `suppressed` | opt-out de WhatsApp. **Consequência real:** sem o link, o sinal não é pago e a vaga é cancelada no fim do hold |
| `no_consent` | não se aplica — o link do sinal é transacional e **não** exige opt-in de cobrança |
| `template_not_configured` | falta `META_TEMPLATE_DEPOSIT_LINK_ID`, ou o template não foi aprovado |

```sql
SELECT type, status, failed_reason, scheduled_for, created_at
FROM ai_proactive_jobs
WHERE clinic_id = '<uuid>' AND type = 'deposit_link'
ORDER BY created_at DESC LIMIT 20;
```

> O link **não fica no job**. O payload guarda só o `chargeId`; a URL é resolvida no envio, por
> `paymentsApiV1.getPayableCharge`. Link de pagamento em repouso numa fila que operador e worker leem
> é link de pagamento vazado — e o que estava certo no enfileiramento pode não estar mais na hora do
> envio.

## O que a recepção vê na agenda (1.6b)

| Badge | Significa | Dá para agir? |
| --- | --- | --- |
| *(nenhum)* | sinal desligado, ou agendamento anterior à política | — |
| **Sinal pendente** (âmbar) | vaga SEGURADA aguardando pagamento. O `title` mostra até quando | **Sim** — é o único. Passou o prazo, a varredura cancela sozinha |
| **Sinal pago** (verde) | conciliado; o agendamento já foi confirmado | não precisa |
| **Sinal vencido** (cinza) | o hold expirou e o agendamento foi cancelado | não |
| **Sinal estornado** (azul) | cancelou dentro da janela e o dinheiro voltou | não |

O badge fica **ao lado** do status, não no lugar dele: as duas dimensões são ortogonais e um
agendamento pode estar `agendado` com sinal pago.

## Cobrança do RESTANTE e créditos (1.5b)

Desde a 1.5b o dinheiro do paciente existe nos **dois** lados, e cada um responde uma pergunta
diferente:

| Tabela | Context | Responde |
| --- | --- | --- |
| `patient_charges` | payments | *como* estamos tentando receber (link no gateway) |
| `patient_credits` | financial | dinheiro que **entrou** antes de existir a obrigação |
| `lancamentos` | financial | quanto é **devido**, quanto foi pago, qual o saldo |

**`lancamentos` é a fonte da verdade.** `patient_charges` **não é ledger** — nunca concilie o Caixa
por ele.

### O ciclo completo, com números

```
sinal de 50% num procedimento de R$ 200

paciente paga 100  → patient_charges.paid + patient_credits(100, available)
atendimento ocorre → lancamento(valor 200, valorPago 100, status parcial)
                     patient_credits → allocated + payment_transactions(100)
scan do restante   → pergunta o saldo AO FINANCIAL (100) → cobra 100
paciente paga 100  → patient_credits(100) → lancamento(valorPago 200, pago)
```

O recebível **sempre nasce pelo valor bruto** (200, nunca 100): faturamento e recebimento são coisas
distintas, e um recebível líquido apagaria quanto o atendimento faturou.

### Entrega automática do link do restante (1.6c)

```text
patient_charge(kind=remainder) → payments.patient_charge.link_ready
                               → C14 job remainder_link
                               → paymentsApiV1.getPayableCharge no send-time
                               → template Meta remainder_link
                               → WhatsApp
```

O job guarda somente ids + valor; **não** persiste `invoiceUrl`. Se a cobrança for paga, estornada,
cancelada, expirada ou estiver sem link antes do worker, `getPayableCharge` devolve `null` e o job
termina `charge_not_payable` sem enviar. O template do restante comunica atendimento já realizado e
saldo pendente; nunca fala em garantir/reservar horário. Usa o propósito central de suppression
`billing` e exige consentimento de cobrança.

Pré-requisito externo: template `remainder_link` aprovado e configurado em
`META_TEMPLATE_REMAINDER_LINK_ID`, conexão Meta saudável e destinatário controlado consentido. Sem
template, falha visível como `template_not_configured`; não existe fallback para texto livre. A prova
real permanece P1 no `qorov2.md`; unit/integration/smoke não são classificados como E2E Meta.

### "Por que este atendimento não gerou cobrança do restante?"

| Métrica | O que aconteceu |
| --- | --- |
| `payments.remainder.skipped_no_balance` | não há recebível `pendente`/`parcial`. Pode já estar **quitado** — inclusive por pagamento em dinheiro na recepção |
| `payments.remainder.skipped_below_minimum` | saldo abaixo de R$ 5,00 (mínimo do Asaas). A clínica recebe na recepção |
| `payments.remainder.skipped_no_account` | conta Asaas desconectada |
| `payments.remainder.skipped_no_identity` | paciente sem CPF válido |
| *(nada)* | política de sinal desligada, ou já existe cobrança `kind='remainder'` |

> **O saldo vem do Financial, nunca do Payments.** Se fosse calculado como "valor do procedimento
> menos o que o gateway recebeu", um pagamento em dinheiro lançado no Caixa não apareceria e o
> paciente receberia link por algo que já pagou.

```sql
SELECT c.kind, c.status, c.amount, c.invoice_url
FROM patient_charges c WHERE c.appointment_id = '<uuid>';

SELECT status, amount, allocated_amount, allocated_lancamento_id, released_at
FROM patient_credits WHERE appointment_id = '<uuid>';

SELECT valor, valor_pago, status FROM lancamentos WHERE appointment_id = '<uuid>';
```

### Estados do crédito

| Status | Significa |
| --- | --- |
| `available` | dinheiro entrou, ainda não aplicado a um lançamento |
| `allocated` | virou `valorPago` de um lançamento (há `payment_transactions` correspondente) |
| `refunded` | devolvido ao paciente (cancelamento dentro da janela) |
| `retained` | ficou com a clínica **sem atendimento** — falta, ou cancelamento tardio |

`retained` é a taxa de no-show do ponto de vista financeiro. Na `patient_charges` a retenção continua
**derivada** (`paid` + agendamento morto) — os dois não se contradizem: são objetos diferentes.

**Crédito `available` órfão** (atendimento que nunca concluiu nem morreu) é o estado a vigiar:

```sql
SELECT * FROM patient_credits WHERE status = 'available' AND granted_at < now() - interval '30 days';
```

## Verificar a integração de verdade

```bash
pnpm payments:live-check
```

Bate no sandbox do Asaas e exercita o caminho inteiro do paciente: valida credencial, cria
customer só com nome+CPF, gera a cobrança, prova a recuperação por `external_reference` (a defesa
contra cobrar duas vezes) e registra o webhook. Recusa chave que não seja de sandbox.

Desde a **1.5a** também exercita `cancelPayment` (matar o link), a recusa de estorno sobre cobrança
não paga, e — com o dinheiro de fato recebido via `receiveInCash` — a **recusa de estorno por forma
de pagamento**, que é a premissa da guarda `REFUNDABLE_BILLING_TYPES`.

Um passo aparece como **`n/v`** (não verificável) e entra na contagem final: o estorno de um sinal
pago **por PIX ou cartão** exige pagamento real na página do Asaas, e não há afordância de simulação
na API. É de propósito que ele não vira verde — check verde forjado é pior que check vermelho.

> O **D21** dizia que o sandbox recusava simular recebimento. Era engano nosso: `receiveInCash`
> rejeita `paymentDate` no futuro **no fuso do Asaas** (BRT), e o script usava `toISOString()` (UTC).
> Falhava só depois das 21h de Brasília. Erro de provedor que aparece por horário é fuso até prova
> em contrário.

**Rode antes de qualquer release que toque pagamento.** Foi ele que encontrou as regras do Asaas
que a documentação não conta: mínimo de **R$ 5,00** · `email` obrigatório no webhook · formato do
token · **cobrança apagada responde 200 com `deleted: true`**, não 404 · e o estorno **só funciona
para PIX e cartão** (*"Somente é possível estornar cobranças cuja a forma de pagamento seja cartão
de crédito ou Pix"*).

## Ainda não existe (não procure)

- **Transferir o sinal ao remarcar** — hoje devolve-se e cobra-se de novo (**D23**).
- **Sinal em outras telas além da Agenda** (Consultório, ficha do paciente) — a 1.6b cobriu a
  **Agenda**; as demais entram conforme necessidade.
