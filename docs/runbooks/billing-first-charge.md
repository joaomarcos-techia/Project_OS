# Runbook — Primeira cobrança real (fim do trial)

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-20 · **Próxima revisão:** 2026-10-20
>
> ↩︎ Volta para o [índice de runbooks](./README.md) · [índice mestre](../README.md).

> **Por que existe:** o fim do primeiro trial é a estreia do ciclo de cobrança em produção com
> dinheiro de verdade. Até esse momento, o trecho `PAYMENT_RECEIVED → fatura paga → assinatura
> ativa` **nunca rodou** — só o `PAYMENT_CREATED` (verificado em prod 2026-07-20, com resolução
> de clínica correta). Este runbook diz o que esperar, como testar antes, e o que fazer se falhar.

## 0. O que vai acontecer (cadeia verificada no código)

No vencimento, o Asaas cobra o cartão e dispara o webhook. A partir daí:

```
Asaas cobra
  └─ webhook PAYMENT_RECEIVED → POST /api/webhooks/asaas
       ├─ valida token (header asaas-access-token)
       ├─ getPayment() no Asaas ← FONTE DA VERDADE (o corpo é só notificação, ADR-025)
       └─ dbAdmin.transaction:
            ├─ dedup por evt_id (processed_webhooks)
            ├─ ensureInvoiceForPayment → resolve a invoice local
            └─ markInvoicePaid:
                 ├─ payment_attempts ← 'confirmed'
                 ├─ invoices: open → paid  (+ evento INVOICE_PAID)
                 ├─ activateSubscription: billing_status trial → active (+ TRIAL_CONVERTED)
                 └─ setClinicAccess('enabled'): clinics.status → 'active'
```

Transições conferidas em [`state-machine.ts`](../../src/contexts/billing/internal/state-machine.ts):
`open → paid` ✅ e `trial → active` ✅ são permitidas. Tudo num único `transaction` — ou aplica
inteiro, ou nada (o dedup rola junto, então o replay é seguro).

## 1. Estado esperado DEPOIS (a query de aceite)

```sql
SELECT c.status                AS clinic_status,   -- esperado: active
       s.billing_status,                            -- esperado: active
       i.status                AS invoice_status,   -- esperado: paid
       i.paid_at                                    -- esperado: NOT NULL
  FROM clinics c
  JOIN subscriptions s ON s.clinic_id = c.id
  JOIN invoices i      ON i.clinic_id = c.id
 ORDER BY i.created_at DESC LIMIT 1;
```

Se os quatro baterem, o ciclo fechou. Se **algum** divergir, vá para §4.

## 2. Testar ANTES do vencimento (recomendado)

O objetivo é exercitar o `PAYMENT_RECEIVED` sem esperar o dia. No painel do Asaas, pegue a
cobrança em aberto da assinatura e **confirme o recebimento manualmente** (o Asaas oferece
"receber em dinheiro" / confirmar pagamento). Isso dispara o mesmo webhook do fluxo real.

- [ ] Webhook chegou: nova linha em `processed_webhooks` com `event_type = 'PAYMENT_RECEIVED'`
      **e `clinic_id` preenchido** (nulo = não resolveu a clínica → §4.2).
- [ ] A query do §1 devolve os quatro valores esperados.
- [ ] Nenhum `billing.webhook.error` no período (Better Stack:
      `message.event:"billing.webhook.error"`).

> Se preferir não mexer na cobrança real, a alternativa é conferir só o §3 no dia e confiar no
> backstop do §4.1 — que é automático.

## 3. No dia do vencimento

- [ ] Rodar a query do §1.
- [ ] Conferir `message.event:"billing.webhook.verify"` com `outcome:"ok"` — prova que o
      `getPayment()` respondeu (é o passo que valida a cobrança contra o provedor).
- [ ] Se a fatura ficar `open` por mais de algumas horas, não entre em pânico: §4.1.

## 4. Se falhar

### 4.1 O backstop é automático — e roda todo dia

O cron **`billing-reconcile`** (09:00, verificado rodando em prod) varre as faturas
`open`/`overdue` que têm `asaas_payment_id`, consulta o status real no Asaas e, se estiver paga,
chama **o mesmo `markInvoicePaid`**. Ou seja: **um webhook perdido se corrige sozinho em até
24h**, sem intervenção.

Isso significa que a falha só vira incidente se persistir por mais de um ciclo do reconcile.
Para forçar antes:

```
GET /api/cron/billing-reconcile
Authorization: Bearer <CRON_SECRET>
```

### 4.2 `processed_webhooks.clinic_id` veio NULL

O webhook chegou mas não achou a clínica. Quase sempre é assinatura do Asaas sem correspondente
local (`asaas_subscription_id`), ou **sandbox × produção trocados**. Confira
`ASAAS_BASE_URL` = `https://api.asaas.com/v3` (produção **não** leva `/api` — sandbox leva; ver
[runbooks/asaas-webhook-missing.md](./asaas-webhook-missing.md)).

### 4.3 Nenhum webhook chegou

1. Painel do Asaas → webhook → conferir URL `https://app.qoro.dev/api/webhooks/asaas`, versão
   **v3**, e o token igual ao `ASAAS_WEBHOOK_TOKEN` de produção.
2. Conferir que `PAYMENT_RECEIVED` está entre os eventos assinados.
3. Token divergente → a rota devolve 401 e o Asaas re-entrega em backoff (nada se perde, mas
   nada avança até corrigir).

### 4.4 Fatura paga mas a clínica seguiu suspensa

Não deveria acontecer — `markInvoicePaid` faz as três coisas na mesma transação. Se ocorrer, é
bug: capture o `request_id` do log e abra investigação; **não** conserte só o `clinics.status`
à mão, ou o próximo dunning reverte.

## 5. Pós-primeira-cobrança

- [ ] Registrar aqui a data do primeiro ciclo fechado com sucesso.
- [ ] A partir daí, `billing.reconcile.divergence` passa a ser sinal de verdade (webhook perdido
      **ou** forjado) — ver [log-search.md](./log-search.md).

---

## Veja também

- [asaas-webhook-missing.md](./asaas-webhook-missing.md) — webhook perdido / divergência
- [ADR-025](../adr/025-billing-architecture.md) — por que o corpo do webhook não é confiável
- [slo.md §3.1](../c16/slo.md) — SLO do `billing.webhook.verify`
