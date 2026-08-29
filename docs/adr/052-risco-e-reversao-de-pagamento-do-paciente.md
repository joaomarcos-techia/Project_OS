# ADR-052 — Risco e reversão de pagamento do paciente

**Status:** Aceita
**Data:** 2026-08-29
**Decisão:** D27
**Contexts:** Payments + Financial

## Contexto

Um pagamento confirmado pode sofrer chargeback ou ter um recebimento em dinheiro desfeito. Isso
altera a disponibilidade do dinheiro, mas não apaga o atendimento, o prontuário nem a agenda. Antes
desta decisão, o webhook do paciente só reconhecia pagamento; eventos de disputa e reversão não
tinham projeção financeira.

O Asaas expõe o estado autoritativo em `payment.chargeback.status` e documenta os estados
`REQUESTED`, `IN_DISPUTE`, `DISPUTE_LOST`, `REVERSED` e `DONE`. O fluxo ganho passa por
`PAYMENT_AWAITING_CHARGEBACK_REVERSAL` antes de um novo `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED`; o
fluxo perdido termina em `PAYMENT_REFUNDED`. `PAYMENT_RECEIVED_IN_CASH_UNDONE` é uma reversão
efetiva, não uma disputa. Referências: [chargeback](https://docs.asaas.com/docs/chargeback) e
[eventos de cobrança](https://docs.asaas.com/docs/webhook-para-cobrancas).

## Decisão

### 1. O Payments observa o provider

O corpo do webhook continua sendo apenas uma notificação. A rota usa somente ids, consulta
`GET /payments/{id}` com a credencial da própria clínica e então normaliza:

| Estado local | Evidência autoritativa |
| --- | --- |
| `requested` | `chargeback.status = REQUESTED` |
| `in_dispute` | `chargeback.status = IN_DISPUTE` |
| `awaiting_reversal` | evento de disputa ganha aguardando repasse; ainda não recompõe dinheiro |
| `reversed` | `REVERSED`/`DONE` e cobrança novamente `CONFIRMED`, `RECEIVED` ou `RECEIVED_IN_CASH` |
| `lost` | `DISPUTE_LOST` ou cobrança `REFUNDED` com objeto de chargeback |
| `cash_undone` | evento específico e cobrança autoritativamente fora de estado pago |

`patient_charges.dispute_status` é uma projeção operacional monotônica. Estados terminais não
regridem por webhook fora de ordem. A deduplicação permanece em
`patient_webhook_events (clinic_id, asaas_event_id)`.

O Payments publica `payments.patient_payment.risk_changed`; o payload contém ids, valor, estado e
motivo sanitizado. Não contém cartão, documento, prontuário nem corpo bruto do provider.

### 2. O Financial preserva o histórico e projeta a perda

`patient_credits.dispute_status` impede alocação enquanto a disputa está aberta. A disputa ganha
remove o bloqueio uma única vez e não cria outro pagamento.

Uma perda efetiva é append-only:

1. `patient_credit_adjustments` registra `chargeback_loss` ou `cash_undone`, idempotente pelo evento;
2. a parte ainda não alocada aumenta `unallocated_reversed_amount`;
3. a parte já alocada aumenta `allocated_reversed_amount`;
4. para a parte alocada, nasce uma `payment_transactions(kind=refund)` ligada por
   `original_payment_id` à baixa original;
5. `lancamentos.valor_pago` é reduzido somente pelo valor perdido e o saldo volta a
   `pendente`/`parcial` conforme o valor restante;
6. uma pendência financeira é aberta para revisão humana.

O pagamento original não é apagado ou sobrescrito. A recomposição do recebível é uma correção do
saldo financeiro, não uma transição clínica nem um estorno do valor faturado.

### 3. Não cobrar automaticamente durante ou após a disputa

Durante a disputa, o recebível ainda não é reduzido e o crédito não pode ser realocado. Depois de uma
perda, o saldo financeiro é reaberto, mas a cobrança local original continua única por
`(appointment_id, kind)` e terminal no Payments. Assim, o scan não cria automaticamente outro link.
A clínica decide a cobrança posterior depois de revisar o caso.

### 4. Linhagem histórica segura

Créditos novos persistem `allocated_payment_transaction_id` no mesmo commit da baixa. A migration
0092 tenta preencher créditos antigos somente quando existe correspondência 1:1 inequívoca entre
crédito e transação. Linha ambígua permanece nula; se houver perda, abre conciliação manual e não
inventa um vínculo contábil.

### 5. Evidências de disputa são humanas

O sistema não envia prontuário ou documentos clínicos automaticamente ao Asaas. A contestação exige
seleção e revisão humana do mínimo necessário. Upload de evidências não faz parte desta decisão.

## Idempotência e concorrência

- webhook: unique por clínica + evento Asaas;
- transição no Payments: cobrança travada e estado monotônico;
- outbox: chave por cobrança + estado;
- Financial: `patient_credit_adjustments` unique por clínica + evento de origem;
- refund financeiro: referência obrigatória à baixa original;
- toda projeção financeira ocorre na transação do handler e sob RLS do tenant.

## Consequências

- agenda e prontuário permanecem imutáveis;
- caixa mostra o pagamento original e sua compensação;
- dinheiro contestado não pode ser usado de novo;
- disputa ganha não duplica receita;
- perda reabre apenas o saldo econômico afetado;
- casos históricos ambíguos ficam observáveis para decisão humana;
- nenhuma IA/LLM decide estado, valor ou elegibilidade financeira.

## Evidência exigida

- unit: normalização, monotonicidade, replay, bloqueio/liberação e compensação;
- integração DB: RLS, concorrência, D50, disputa, perda alocada, replay e cross-tenant;
- contrato: nomes de eventos e objeto `chargeback` do Asaas;
- externo: um chargeback sandbox real permanece dependente de fixture/provider controlados.
