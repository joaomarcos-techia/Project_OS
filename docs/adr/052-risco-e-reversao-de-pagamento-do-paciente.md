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
- externo/provider: **PASS em 2026-09-01** — o Asaas disparou os eventos testáveis da fixture global;
  o readback terminou `REFUNDED`, chargeback `DONE` e o classificador real devolveu `lost`;
- externo/webhook tenant: **PASS em 2026-09-01** — a Clínica A convergiu dos quatro eventos antigos
  para os 12 eventos canônicos, incluindo chargeback; o legado pausado foi removido (D67);
- externo/jornada tenant: **PASS em 2026-09-02** — a fixture `remainder` da Clínica A atravessou
  pagamento, webhook e `REFUNDED/DONE`; Payments convergiu para `refunded/lost`. Os três fatos de risco
  foram processados uma vez pelos handlers reais. Financial criou uma compensação `refund` ligada à
  baixa original e uma `chargeback_loss`, reabriu o recebível para R$ 10 e preservou o agendamento
  `atendido`. Replay processou zero, manteve um ajuste e duas transações; nenhum evento alheio foi
  tocado. O cleanup autorizado revalidou o estado, removeu 16 linhas sintéticas em uma transação,
  preservou o audit do webhook, não chamou o provider e terminou com zero resíduo da fixture D62.

## Adendo R54 (2026-11-14) — estorno feito direto no Asaas

**Contexto.** Até aqui o webhook de estorno só confirmava devoluções que o próprio Qoro tinha
pedido (D50/D77: a intenção é persistida antes e o read-back a confirma). Uma devolução feita pela
clínica no painel do Asaas, sem intenção, deixava a baixa inteira no livro (risco R54 do plano TISS).

**Fonte da verdade.** Os estornos `DONE` de `GET /payments/{id}/refunds`, lidos com a chave da
própria clínica, e o `GET /payments/{id}` para status, valor e chargeback. O corpo do webhook só
acorda a leitura (eventos `PAYMENT_REFUNDED`, `PAYMENT_PARTIALLY_REFUNDED`,
`PAYMENT_REFUND_IN_PROGRESS`, `PAYMENT_REFUND_DENIED`, ou qualquer evento cujo pagamento já esteja
`REFUNDED`/`REFUND_REQUESTED`/`REFUND_IN_PROGRESS`). Nada é reconhecido por valor e data, nem porque
alguém afirmou ter devolvido. Estorno `PENDING`/`CANCELLED` não conta.

**Atribuição.** Do total `DONE` sai o que as intenções **confirmadas** do Qoro explicam; o resto é
externo. A intenção captura o baseline antes e só confirma dinheiro novo, então um estorno externo
anterior nunca é contado de novo. Vai para **revisão humana** (pendência, sem compensação): intenção
ainda aberta (atribuição ambígua), disputa aberta, valor do pagamento diferente do da cobrança e
devolução acima do valor. Chargeback perdido continua sendo do caminho do risco (seções 1–2): o
"devolvido" que o Asaas mostra é a própria perda, e o estorno externo não faz nada.

**Idempotência.** O item de estorno do Asaas pode vir sem id. A chave é o **patamar acumulado**
devolvido por fora do Qoro: `patient_external_refunds (clinic_id, patient_charge_id, external_total)`
é UNIQUE e a cobrança fica travada durante o reconhecimento. Reentrega, varredura e instâncias
concorrentes caem no mesmo patamar. Um estorno parcial novo cria o patamar seguinte só com a
diferença. Uma leitura mais antiga que a já reconhecida não muda nada (métrica
`payments.external_refund.stale_reading`). O aviso de revisão tem payload determinístico, então o
mesmo fato entregue de novo responde 200 e não abre um segundo aviso.

**Livro.** O Payments grava a evidência (só status, valor e data dos estornos lidos; só inclusão para
o runtime), marca a cobrança `refunded` quando a devolução cobre o valor, publica
`payments.patient_refund.external_recognized` e audita com ator de sistema. O Financial aplica a
mesma compensação da perda (seção 2): `patient_credit_adjustments(kind=external_refund)`,
`payment_transactions(kind=refund)` ligada à baixa original, `valor_pago` reduzido e a pendência
"Estorno feito direto no Asaas: baixa compensada e saldo reaberto para revisão humana. Não cobrar
novamente sem decisão." A conclusão do atendimento passa a alocar só o que ficou no crédito
(`amount − unallocated_reversed_amount`). Antes desta correção, um estorno parcial ocorrido antes do
atendimento seria baixado como se o dinheiro ainda estivesse na conta.

**Repasse.** O repasse particular com qualquer reversão fica suspenso (`cancelled`) até nova revisão
humana, com o valor anterior na auditoria. Repasse já aprovado (`reviewed`) volta a suspenso, a
versão aprovada fica intacta e a nova revisão mostra a referência recalculada sobre o recebido. A
diferença é o valor a compensar. O Qoro não registra o pagamento do repasse particular nem move
dinheiro. O repasse de convênio é calculado sobre o dinheiro da operadora (`hi_payout_position`), sem
a coparticipação, e não muda.

**Coparticipação.** A função `hi_copay_sync_charge` (0158) põe a coparticipação em "estornada"
quando a soma dos estornos do recebível cobre o recebido. Estorno parcial mantém "paga" e deixa o
recebível parcial.

**Recuperação sem webhook.** A varredura do `financial-reconcile` lê as cobranças pagas a cada 6 h
(até 30 dias) ou 3 dias (de 30 a 180 dias), com cursor `patient_charges.refund_checked_at`. É uma
leitura administrativa só de identificadores; todo o resto roda por clínica, sob RLS.

**Fora do alcance.** Não houve homologação no Asaas Sandbox de um estorno externo real: a única
fixture paga é a coparticipação de R$ 45 homologada, que não foi estornada. Nenhum estorno é pedido
pelo Qoro ao Asaas por este caminho.

**Evidência.** `src/contexts/payments/internal/external-refund.test.ts` (regra);
`scripts/security/payments-external-refund-db.ts` (14 provas: rota real, livro, worker, falha
transacional, retry, varredura, concorrência, RLS, repasse); `health-insurance-copay-charge-db.ts`
§10 (coparticipação).
