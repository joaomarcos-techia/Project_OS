# Runbook — webhook de assinatura (conta Asaas do Qoro)

## Status

Canonical — cobre o webhook que governa **o acesso ao produto**. Recria parte do que o **D8** do
[discovery log](../discovery-log.md) apagou.

## Source of Truth

`src/app/api/webhooks/asaas/route.ts`, `src/contexts/billing/internal/subscriptions.ts`,
`src/app/api/cron/billing-reconcile/route.ts`.

## Não confundir com o webhook de paciente

| | Assinatura (este) | Paciente |
| --- | --- | --- |
| Conta Asaas | **do Qoro** | da **clínica** |
| Rota | `/api/webhooks/asaas` | `/api/webhooks/asaas/patient/<ref>` |
| Credencial | `ASAAS_API_KEY` (env) | cifrada por tenant, no banco |
| Quem configura | **uma pessoa, no painel** | o sistema, no *connect* |
| O que decide | se a clínica tem acesso | se a vaga é confirmada |

O de paciente está em [payment-account-connect](payment-account-connect.md).

## Eventos que este webhook DEVE assinar

Esta lista é a cópia versionada da configuração — o painel do Asaas é a única outra cópia, e painel
de terceiro não é memória confiável (**D30**).

| Evento | Por quê |
| --- | --- |
| `PAYMENT_CREATED` | materializa a fatura do ciclo em `invoices` |
| `PAYMENT_CONFIRMED` | pago por cartão (confirma antes de liquidar) |
| `PAYMENT_RECEIVED` | pago por PIX/boleto |
| `PAYMENT_OVERDUE` | move a régua de dunning |
| `PAYMENT_REFUNDED` | estorno |
| `PAYMENT_DELETED` | cobrança removida → a fatura é **cancelada** |
| `PAYMENT_RESTORED` | cobrança restaurada → **sem ele, o cancelamento é irreversível** (ver abaixo) |

### Por que `PAYMENT_RESTORED` não é opcional

É uma porta de mão única, e a única das três recomendações que fecha inconsistência **permanente**:

1. alguém apaga a cobrança no painel → `PAYMENT_DELETED` → o `GET` dá 404 → a rota **cancela a
   invoice**;
2. alguém restaura → **nada acontece** se o evento não estiver assinado;
3. o `billing-reconcile` (diário) não salva: ele só revisita `['open','overdue']`. Invoice
   `cancelled` **nunca é revisitada**.

Resultado: fatura cancelada do nosso lado, cobrança viva no Asaas, sem correção automática em nenhum
horizonte.

### Eventos que NÃO devem ser assinados

| Evento | Por quê |
| --- | --- |
| `PAYMENT_AUTHORIZED` | cartão autorizado aguardando captura. `actionFor` devolve `null`; o `PAYMENT_CONFIRMED` vem logo atrás e faz o trabalho |
| `PAYMENT_UPDATED` | **não faz nada hoje**: `ensureInvoiceForPayment` é *insert-only* (`if (existing) return existing`). Assinar não sincroniza valor nem vencimento — falta decidir quem tem autoridade sobre eles (**D29**) |
| `PAYMENT_CHECKOUT_VIEWED`, `PAYMENT_BANK_SLIP_VIEWED`, split, antecipação | telemetria de terceiro. Volume é o que faz o Asaas marcar o webhook como *interrupted* |

> Evento sem handler não deixa o sistema mais correto — só aumenta tráfego. E tráfego é o que
> interrompe webhook.

## `sendType`

Este webhook está em `NON_SEQUENTIALLY`, e tudo bem: a rota não confia na ordem. O `getPayment` é a
fonte da verdade e as transições de invoice são monotônicas. (O de **paciente** usa `SEQUENTIALLY`.)

## URL

Sempre o **alias estável**, nunca a URL imutável por deploy (`project-<hash>-…vercel.app`), que muda
a cada push e quebra o webhook em silêncio.

- Produção: `https://app.qoro.dev/api/webhooks/asaas`
- Preview de branch: `https://project-os-git-<branch-com-hifens>-clinic-os-v2-s-projects.vercel.app/api/webhooks/asaas`

## Diagnóstico

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://app.qoro.dev/api/webhooks/asaas
```

| Resposta | Significado |
| --- | --- |
| **401** | esperado sem token — a rota está no ar e validando |
| 404 | a rota não está neste deploy |
| 401 com HTML da Vercel | **Deployment Protection** ligada: o Asaas nunca chega na rota |

Um webhook marcado **interrupted** pelo Asaas **não se reativa pelo painel** — precisa ser recriado.
E o `authToken` nunca é devolvido pela API: o único indicador é `hasAuthToken`.

```sql
SELECT asaas_event_id, event_type, clinic_id, created_at
FROM processed_webhooks ORDER BY created_at DESC LIMIT 20;
```

Se estiver vazio enquanto o painel mostra entregas, o problema é rede/URL/proteção — não código.

## Direção futura (não é para agora)

Este arquivo é a **especificação canônica** da configuração. O que estava errado no D30 não era faltar
`PAYMENT_RESTORED`: era uma configuração financeira crítica existir **exclusivamente como estado
manual dentro do painel de um terceiro**.

O alvo, numa fase futura:

```
configuração versionada  →  provisionamento/verificação automática  →  painel Asaas
```

Ou seja: a lista acima vira constante no repo, e um check compara o que está no Asaas com o que
deveria estar — do mesmo jeito que `check:observability` compara crons com a documentação. Enquanto
isso não existe, **esta tabela é a fonte da verdade** e a conferência é manual.
