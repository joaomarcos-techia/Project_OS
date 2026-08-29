# ADR-051 — Conciliação entre cobrança de paciente e recebível (fonte da verdade financeira)

- **Status:** Aprovado (2026-08-25) — complementar ao [ADR-049](049-pagamentos-paciente-sinal.md) e ao [ADR-050](050-identidade-de-pagamento-do-paciente.md)
- **Data:** 2026-08-25
- **Contexto do repo:** `feat/qorov2-pagamentos`, baseline verde (2498 testes ✅ · build ✅), sub-fase **1.5a** entregue
- **Motivo:** a sub-fase **1.5b** (cobrança do restante) foi **bloqueada** durante a execução — achado **D19** do
  [discovery log](../discovery-log.md). O bloqueio não era "como cobrar os outros 50%": era
  **como representar o mesmo dinheiro em dois bounded contexts** sem que um deles minta.
- **Relaciona:** ADR-049 (sinal) · ADR-050 (identidade) · ADR-011 (outbox/idempotência) · ADR-014 (ownership R3)

> ⚠️ Precedência: **Código > Banco > Testes > Documentação.** Este ADR foi escrito lendo o código;
> as três verificações da §3 mudaram o desenho original em dois pontos.

---

## 1. Problema

Depois da 1.5a existem **duas tabelas de dinheiro apontando para o mesmo agendamento**, e nenhuma
declarada como autoridade:

| Tabela | Context | O que ela sabe |
| --- | --- | --- |
| `patient_charges` | `payments` | que existe um link do Asaas, e se ele foi pago |
| `lancamentos` | `financial` | que o atendimento gerou uma obrigação a receber |

Com um sinal de 50% num procedimento de R$ 200, o estado que o sistema produziria hoje é este:

| Momento | O que o Caixa mostra | O que é verdade |
| --- | --- | --- |
| Paciente paga o sinal | *(nada)* | R$ 100 recebidos |
| Paciente comparece | recebível **R$ 200**, `valorPago = 0` | faltam **R$ 100** |
| Restante cobrado e pago | recebível **R$ 200**, `valorPago = 0` | **quitado** |

O Caixa erra em duas direções ao mesmo tempo: **superestima a dívida** pelo valor do sinal e **nunca
registra** o pagamento do restante. Não há bug a corrigir dentro do `payments` — a correção mora onde
o recebível mora.

## 2. Decisões

### D1 — `financial` é a fonte da verdade financeira

- **`lancamentos` é a obrigação**: quanto é devido, quanto foi pago, qual o saldo.
- **`patient_charges` é o instrumento de cobrança**: *como* estamos tentando receber esse dinheiro
  via Asaas.
- **Pagamento confirmado é o evento que concilia os dois.**

`patient_charges` **não vira um segundo ledger.** Ele descreve tentativas de cobrança, não obrigações.
Um sistema com dois ledgers não tem fonte da verdade — tem duas versões da mesma história e nenhum
árbitro.

### D2 — O recebível nasce pelo valor BRUTO do atendimento

Rejeitado explicitamente: criar o recebível líquido do sinal (`valor = 100`). Isso fecharia o saldo e
**destruiria a informação de que o atendimento faturou R$ 200**. Faturamento, recebimento e saldo têm
de continuar legíveis em separado.

O estado correto depois do atendimento:

```
valor      200
valorPago  100
saldo      100
status     parcial
```

E depois do restante:

```
valor      200
valorPago  200
saldo      0
status     pago
```

### D3 — O sinal existe no `financial` ANTES do atendimento, como crédito

Não se cria o recebível de R$ 200 quando o sinal é pago: isso inventaria uma obrigação por um
atendimento que ainda não aconteceu — e bagunçaria falta e cancelamento, onde ele **nunca deve
existir**.

Cria-se um **crédito do paciente**, tabela do `financial`:

```
patient_credits(
  id, clinic_id, patient_id, appointment_id, patient_charge_id,
  amount,            -- quanto entrou
  allocated_amount,  -- quanto já foi aplicado a um lançamento
  kind,              -- 'deposit' | 'remaining_payment'   (extensível: 'adjustment')
  status,            -- 'available' | 'allocated' | 'refunded' | 'retained'
  granted_at, released_at, created_at, updated_at
)
```

**O nome e o formato são deliberadamente genéricos.** Não é `deposit_credits` nem
`appointment_deposit`: `allocated_amount` separado de `amount` permite alocação **parcial**, e `kind`
já nasce com espaço para o restante e para ajustes. A 1.5b não é a feature de "cobrar os 50%
restantes" — é o modelo de **dinheiro recebido antes da obrigação existir**, que é o que volta a
aparecer em parcelamento, pagamento misto e outros percentuais de sinal.

**A tabela é nova porque o primitivo existente não serve, e isso foi verificado (§3.2), não presumido.**

### D4 — Eventos voltados ao CRÉDITO, não à cobrança

O `payments` publica, para o `financial`, dois eventos próprios:

| Evento | Quando | O que o `financial` faz |
| --- | --- | --- |
| `payments.patient_credit.granted` | dinheiro entrou (sinal **ou** restante) | grava o crédito `available`, ou aplica no recebível se ele já existir |
| `payments.patient_credit.released` | o crédito saiu de `available` | aplica a **`disposition`** que vem no payload |

**Por que eventos novos e não os que já existem:** `payments.patient_charge.paid` e
`payments.patient_charge.closed` **já têm dono** — o `scheduling` —, e o registry do outbox é
estritamente 1 handler por evento (§3.1). Mas a razão de fundo é melhor que a restrição técnica: os
dois pares dizem coisas diferentes a domínios diferentes. Para a agenda, "o sinal foi pago" significa
*confirme a vaga*. Para o financeiro, significa *entrou dinheiro que precisa ser alocado*. Nomear o
evento pelo fato do consumidor é o que mantém o contrato honesto.

**O `released` carrega `disposition` explícita — não implícita no nome do evento:**

```
payments.patient_credit.released
{ creditId, appointmentId, amount, disposition: 'refunded' | 'retained' }
```

Os dois desfechos são **economicamente opostos**: em `refunded` o dinheiro **saiu** da conta da
clínica; em `retained` ele **continua sendo receita**, só que sem atendimento associado. Deixar isso
implícito obrigaria o `financial` a inferir o fato econômico a partir do nome de um evento de outro
context — que é exatamente o acoplamento que o D1 existe para impedir. O nome do evento pode ser
genérico; o fato econômico, não.

`cancelled` e `expired` não aparecem aqui de propósito: cobrança que nunca foi paga nunca virou
crédito, então não há o que liberar.

Ambos os pares são publicados **na mesma transação**, por quem já grava a cobrança.

### D5 — O handler de `appointment.completed` continua sendo um só

Isto resolve a Parede 1 do D19 **sem** cron-scan e sem disputar o evento:
`financial/internal/handlers/appointment-completed.ts` segue o **único** dono de
`scheduling.appointment.completed`. Só o corpo muda:

```
credits   = créditos `available` do agendamento     (tabela do PRÓPRIO financial)
valor     = payload.valor                            (bruto, D2)
valorPago = min(sum(credits), valor)
status    = valorPago >= valor ? 'pago' : valorPago > 0 ? 'parcial' : 'pendente'
```

e os créditos consumidos passam de `available` para `allocated`.

**Ele lê a própria tabela** — não `patient_charges`. É isso que mantém o `financial` independente do
modelo interno do `payments`, e é por isso que o crédito mora no `financial` e não no `payments`.

### D6 — A cobrança do restante é do `payments`, por scan idempotente

> **CORRIGIDO NA EXECUÇÃO (25/08).** O texto original dizia `remainingAmount = valor − créditos
> válidos`, calculado pelo Payments — e isso está **errado**. Créditos são do Financial, e o saldo
> real também depende de pagamentos que nunca passaram pelo gateway: o paciente que paga **em
> dinheiro na recepção** quita o lançamento sem que o Payments saiba. Cobrar por cima disso mandaria
> um link por algo já pago.
>
> O saldo passou a vir de `financialApiV1.getAppointmentBalance` (seam novo, 1.5b.3a). Isso levaria a
> sub-fase a **3 contexts**, então ela foi dividida em **1.5b.3a** (`financial`) e **1.5b.3b**
> (`payments` + `scheduling`), ambas dentro do §0.6.

Como o evento `completed` continua com um único dono, o gatilho do restante é uma varredura — o mesmo
padrão já aceito no **D16** (e que trouxe a auto-cura de brinde):

```
appointment.status = 'atendido'
AND existe sinal pago
AND não existe cobrança kind='remainder'
  ⇒ remainingAmount = valor − créditos válidos ⇒ cria patient_charge(kind='remainder')
```

Toca `payments` + `scheduling`: **2 contexts**, dentro do §0.6.

### D7 — O `payments` nunca escreve `lancamentos`

Nada de `UPDATE lancamentos.valor_pago` a partir do `payments`. A baixa acontece pelo D4: o
`financial` consome `patient_credit.granted` e aplica. Mesma regra R3 que já governa
`payments → scheduling`.

## 2.1 Invariantes (o que qualquer implementação futura NÃO pode violar)

Escritas antes de existir código, e de propósito: se estas quatro regras estiverem de pé, a 1.5b
deixa de ser "a feature que cobra os 50% restantes" e passa a ser o **modelo financeiro de qualquer
pagamento antecipado** — o que evita revisitar este mesmo problema quando entrarem parcelamento,
pagamento misto ou outro percentual de sinal.

1. **`patient_charges` nunca é ledger financeiro.** Ele registra tentativas de cobrança num gateway,
   não obrigações nem saldos.
2. **Todo dinheiro confirmado antes de existir um lançamento existe como `patient_credit`.** Não há
   dinheiro recebido "flutuando" sem representação no `financial`.
3. **Um lançamento de atendimento sempre representa o valor BRUTO do atendimento.** Nunca líquido de
   sinal, desconto embutido ou crédito.
4. **`valorPago` só cresce por dinheiro comprovadamente recebido e alocado.** Nunca por estimativa,
   projeção ou efeito colateral de outro context.

A invariante 4 é a que tem dente no banco: o CHECK `valor_pago >= 0 AND valor_pago <= valor` já
existe em `lancamentos`, e a alocação de crédito tem de respeitá-lo — daí `allocated_amount` ser
coluna separada de `amount` no crédito.

## 3. Verificações no código que MUDARAM o desenho

Escritas aqui porque duas delas invalidariam a implementação se descobertas durante a execução.

### 3.1 — `patient_charge.paid` e `.closed` já têm dono ⇒ D4 existe

O desenho inicial previa o `financial` consumindo `payments.patient_charge.paid`. Não é possível:
`scheduling/internal/handlers/patient-charge-paid.ts` e `patient-charge-closed.ts` já os registram, e
`assertUnregistered` lança na segunda tentativa. É a **Parede 1 do D19 reaparecendo no meio da
solução** — daí os eventos próprios do D4.

### 3.2 — `payment_transactions.lancamento_id` é NOT NULL ⇒ D3 precisa de tabela nova

O `financial` já tem um primitivo de baixa (`payment_transactions`, com `kind: payment | refund`), e a
pergunta legítima era se ele bastaria. **Não basta:** `lancamento_id` é `NOT NULL` com
`ON DELETE restrict`. Uma baixa não pode existir sem um lançamento — e o sinal é pago **antes** de o
lançamento existir. O crédito antecipado não é preferência de modelagem: é a única forma de
representar dinheiro que chegou antes da obrigação.

### 3.3 — `financial` já suporta pagamento parcial ⇒ D2 não custa migração

`lancamento_status` **já tem `'parcial'`**, e `lancamentos.valorPago` já existe com o CHECK
`valor_pago >= 0 AND valor_pago <= valor`. O estado que o D2 descreve é representável hoje; a única
migração da 1.5b é a tabela de créditos.

## 4. Alternativas rejeitadas

| Alternativa | Por que não |
| --- | --- |
| **Recebível líquido do sinal** (`valor = 100`) | fecha o saldo e apaga o faturamento: o atendimento passou a valer R$ 100 no relatório. Faturamento ≠ recebimento |
| **`patient_charges` como ledger** | dois ledgers, nenhuma autoridade. E amarra o financeiro ao modelo de um gateway específico, contra o §13.15 |
| **`financial` lê `patient_charges` direto** | acopla o financeiro ao modelo interno do `payments`; qualquer mudança lá vira mudança no Caixa. O crédito é a fronteira |
| **`payments` escreve `lancamentos.valor_pago`** | viola R3, a mesma regra que já impede o `payments` de escrever `appointments` |
| **Criar o recebível de R$ 200 quando o sinal é pago** | inventa obrigação por atendimento que não aconteceu; e em falta/cancelamento ela teria de ser desfeita |

## 5. Consequências

**Positivas:** a regra continua válida para 30% de sinal, múltiplas parcelas, PIX + cartão, pagamento
presencial, estorno parcial, ou mais de uma cobrança para o mesmo atendimento — porque nada nela
assume "50/50" nem "uma cobrança". Falta e cancelamento ficam triviais: o crédito vira `retained` ou
`refunded`, sem falsificar um recebível de atendimento que nunca ocorreu.

**Custo aceito:** uma tabela nova e dois eventos novos; e o `financial` passa a ter um estado
intermediário (crédito não alocado) que hoje não existe.

**Risco residual:** crédito `available` órfão — sinal pago cujo agendamento nunca chega a `atendido`
nem a `faltou`/`cancelado`. A detecção faz parte da conciliação; o destino econômico não pode ser
inferido sem o estado autoritativo do pagamento e uma regra aprovada.

**Estado em 2026-08-27 — D52/P7 detectado:** `ca94839` integrou ao `financial-reconcile` um scan
cross-tenant somente leitura. Ele considera crédito com 30+ dias somente quando a consulta já venceu
ou o vínculo está ausente, agrega por clínica/status e emite
`financial.reconcile.orphan_credit_detected` + contagens no heartbeat. Não aloca, libera, retém nem
estorna. Unit 3/3 e `smoke:payments-journey` 13/13 provaram terminal, agenda vencida, consulta futura
excluída, replay idêntico, dois tenants e zero mutação/fixture. A resposta operacional está no runbook;
automatizar o desfecho ainda exigiria regra/ADR complementar.

**Decisão em 2026-08-28 — D50:** quando um pagamento de restante exceder o saldo atual, aplicar
somente até o saldo e **estornar exatamente o excedente**. A guarda atual já preserva o valor em
`unappliedAmount`. A implementação D50 persiste `patient_refund_intents` antes do POST, envia somente
o `value` excedente e nunca repete cegamente uma submissão de resultado incerto. A confirmação usa
`GET /payments/{id}/refunds`, por webhook ou reconcile; somente então publica
`payments.patient_refund.confirmed`. O Financial registra `excess_refund` em
`patient_credit_adjustments`, aumenta apenas `unallocated_reversed_amount` e resolve a pendência. Um
4xx termina em `failed`; timeout após o POST fica `confirmation_pending` para leitura autoritativa.
Migration e smoke: `0092_patient_money_adjustments.sql` e `smoke:payments-money-db`. Estado dos gates
e pendências externas: `docs/qorov2.md` §§20.3 e 20.7.

## 6. Plano de execução (contexts verificados)

**EXECUTADA em 2026-08-25**, depois da 1.6. As invariantes da §2.1 valem e estão cobertas por teste.

| Sub-fase | Contexts | Objetivo |
| --- | --- | --- |
| **1.5b.0** | — | este ADR ✅ |
| **1.5b.1** ✅ | `payments` + `financial` | `patient_credits` (migration 0088); eventos `granted`/`released`; idempotência por `UNIQUE (clinic_id, patient_charge_id)` |
| **1.5b.2** ✅ | **`financial`** | `appointment.completed` cria o lançamento **bruto** e aloca os créditos. Achado **D33**: o handler não tinha nenhum teste |
| **1.5b.3a** ✅ | `financial` | seam `getAppointmentBalance` — o saldo é do Financial, não conta do Payments (**D34**) |
| **1.5b.3b** ✅ | `payments` + `scheduling` | read-model de concluídos + `createRemainderCharge` + varredura no cron `payments-deposit` |
| **1.5b.4** | — | **absorvida pela 1.5b.1**: o crédito do restante é alocado direto ao lançamento já existente — mesmo mecanismo, estado diferente do recebível |
| **E2E financeiro** ✅ | `payments` + `financial` + `scheduling` por eventos | `smoke:payments-journey` 13/13: ramos A/B/C, concorrência, timeout/retry, isolamento e detector D52; `test:simulation` validou 30 dias. A borda Meta real permanece fora desta evidência |

Nenhuma sub-fase passa de **2 contexts**, e a 1.5b.2 é de **1** — o §0.6 volta a ser respeitado, que
era metade do bloqueio do D19.

**Ordem executada:** `1.6 → 1.5b.1 → 1.5b.2 → 1.5b.3 → E2E financeiro`. O fechamento da Camada 1
agora segue P0–P10 em `docs/qorov2.md`, incluindo D52, carga, Product Acceptance e externos.

## 7. O que este ADR NÃO decide

- **Autoridade sobre valor/vencimento de cobrança de ASSINATURA** (`PAYMENT_UPDATED`) — questão
  separada, registrada como **D29**. `invoices` é insert-only hoje, e sincronizar antes de decidir
  quem manda seria escolher por omissão.
- **Chargeback e "recebido em dinheiro" desfeito** (D27) — decidido na
  [ADR-052](052-risco-e-reversao-de-pagamento-do-paciente.md): mantém o fato clínico imutável,
  bloqueia dinheiro em disputa e usa movimentos compensatórios append-only no Financial.
- **Cobrança presencial** (o paciente paga na recepção): representável pelo mesmo crédito, mas a
  entrada pela UI é escopo da 2.x.
