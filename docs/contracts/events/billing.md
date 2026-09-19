# Eventos de billing

## Status

Reference — espelho resumido de `src/contexts/billing/events.ts`.

## Regras

- nome `billing.<entity>.<action>`;
- todo payload tem `clinicId` UUID;
- timestamps são ISO strings, dinheiro é número não negativo em reais;
- payload contém ids/escalares não sensíveis;
- schema Zod no código vence esta tabela.

| Evento | Campos além de `clinicId` |
| --- | --- |
| `billing.customer.created` | `billingCustomerId`, `asaasCustomerId?` |
| `billing.customer.portal_requested` | `requestedBy` |
| `billing.subscription.created` | `subscriptionId`, `planCode`, `priceAmount`, `billingCycle` |
| `billing.subscription.activated` | `subscriptionId`, `planCode` |
| `billing.subscription.changed` | `subscriptionId`, planos e estados anterior/novo |
| `billing.subscription.cancelled` | `subscriptionId`, `reason?`, `cancelAtPeriodEnd` |
| `billing.invoice.generated` | `invoiceId`, `subscriptionId?`, `totalAmount`, `dueDate` |
| `billing.invoice.paid` | `invoiceId`, `totalAmount`, `paidAt`, `paymentMethod?` |
| `billing.invoice.overdue` | `invoiceId`, `daysOverdue` |
| `billing.invoice.refunded` | `invoiceId`, `amount` |
| `billing.invoice.cancelled` | `invoiceId`, `reason` |
| `billing.payment.failed` | `invoiceId`, `attemptId`, `reason?` |
| `billing.trial.started` | `subscriptionId`, `trialEndsAt` |
| `billing.trial.expired` | `subscriptionId` |
| `billing.trial.converted` | `subscriptionId` |
| `billing.clinic.suspended` | `mode: readonly|blocked`, `reason` |
| `billing.clinic.reactivated` | nenhum |
| `billing.clinic.dunning_advanced` | `subscriptionId`, `stage`, `channel` |

Checkout pré-clínica não publica outbox tenant-scoped; usa status/métricas de provisionamento. `billing_events` é timeline interna, não este stream.
