# Contrato de eventos — Billing (C13)

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice mestre](../../README.md).


Congelado (ADR-025 F7). A **fonte da verdade** são os Zod schemas em
[src/contexts/billing/events.ts](../../../src/contexts/billing/events.ts), registrados no
catálogo do outbox. Regras: nomes 3-segmentos `billing.<entity>.<action>`; payload JSON-safe
(`z.string().datetime()` p/ timestamps, `z.number()` p/ dinheiro em reais, só ids + escalares
não-sensíveis). Todo evento carrega `clinicId` (outbox é tenant-scoped).

> O ciclo de **checkout** pré-clínica (`started`/`completed`) NÃO é evento de outbox (não há
> `clinicId` ainda): vive em `checkout_sessions.status` + métricas. Os eventos abaixo só são
> emitidos após o tenant existir.

| event | payload | quem emite | consumidor |
|---|---|---|---|
| `billing.customer.created` | `clinicId, billingCustomerId, asaasCustomerId\|null` | provisioning | (timeline) |
| `billing.customer.portal_requested` | `clinicId, requestedBy` | (reservado C-futuro) | portal |
| `billing.subscription.created` | `clinicId, subscriptionId, planCode, priceAmount, billingCycle` | provisioning | (timeline) |
| `billing.subscription.activated` | `clinicId, subscriptionId, planCode` | webhook/reconcile | **Identity** (cria owner — seam) |
| `billing.subscription.changed` | `clinicId, subscriptionId, oldPlanCode\|null, newPlanCode\|null, oldStatus, newStatus` | subscriptions.ts | (timeline) |
| `billing.subscription.cancelled` | `clinicId, subscriptionId, reason\|null, cancelAtPeriodEnd` | cancelamento | (timeline) |
| `billing.invoice.generated` | `clinicId, invoiceId, subscriptionId\|null, totalAmount, dueDate` | geração | (timeline) |
| `billing.invoice.paid` | `clinicId, invoiceId, totalAmount, paidAt, paymentMethod\|null` | webhook/reconcile | (timeline/NF) |
| `billing.invoice.overdue` | `clinicId, invoiceId, daysOverdue` | webhook | dunning |
| `billing.invoice.refunded` | `clinicId, invoiceId, amount` | webhook | (timeline) |
| `billing.payment.failed` | `clinicId, invoiceId, attemptId, reason\|null` | webhook | **C14** (notificação) |
| `billing.trial.started` | `clinicId, subscriptionId, trialEndsAt` | provisioning | marketing/C14 |
| `billing.trial.expired` | `clinicId, subscriptionId` | cron trial | C14 |
| `billing.trial.converted` | `clinicId, subscriptionId` | webhook (1º pagamento) | marketing |
| `billing.clinic.suspended` | `clinicId, mode(readonly\|blocked), reason` | dunning | C14 / UI banner |
| `billing.clinic.reactivated` | `clinicId` | webhook (pagamento) | C14 / UI |
| `billing.clinic.dunning_advanced` | `clinicId, subscriptionId, stage, channel(whatsapp\|email)` | dunning cron | **C14** (transporte) |

**Source of truth (ADR-025):** Asaas = fonte do pagamento; ClinicaOS = fonte do acesso. Os
eventos `clinic.*` refletem decisões de ACESSO tomadas por ClinicaOS, nunca cópia do status Asaas.

**billing_events ≠ outbox** (ADR-025 G1): `billing_events` é a timeline legível da conta
(sem consumidores); o outbox é o barramento técnico (consumidores reagem aos `billing.*`).
