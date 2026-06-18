# ADR-025 — Arquitetura de Billing: Asaas é adapter, não o centro

- Status: accepted
- Camada: C13 (Billing Context)
- Refs: ADR-001 (bounded contexts), ADR-003/011 (outbox/audit/idempotência), ADR-007 (RLS),
  ADR-016 (ciclo de vida / access-status), ADR-024 (modelo de planos), PlanoAção §13

## Context

A C13 cobra as clínicas. O risco é colocar o **Asaas no centro** do billing (domínio acoplado ao
provedor, status do gateway = status de acesso, sem histórico, sem reconciliação, webhook como
única verdade). Isso quebra em mudança de preço, dispute, webhook perdido/fora de ordem e troca
de gateway. Congela-se a arquitetura: **Asaas é infraestrutura de pagamento atrás de um adapter**;
o domínio Billing é dono do modelo.

```
Checkout Qoro → Billing Context → {BillingCustomer, Subscription, Invoice, Usage} → Asaas Adapter (seam)
```

## Decision

1. **Contexto dedicado `billing` (supersede PlanoAção §13.2/§13.18).** Tabelas e eventos vivem em
   `src/contexts/billing/`, não em `tenancy`. tenancy (C2) permanece a fundação (clinics/units/RLS);
   billing referencia `clinic_id` via `tenantIdRef()` (FK cross-context, padrão financial/identity).
   Eventos passam a ser `billing.*` (supersede os `tenancy.*` antes congelados).

2. **Asaas atrás de um adapter (seam), não abstração multi-gateway.** Uma porta tipada fina
   `PaymentProvider` (`createCustomer`, `createSubscription`, `generateInvoice`, `getSubscription`,
   `getPayment`, `parseWebhook`) com **uma** implementação Asaas em
   `billing/internal/providers/asaas.ts`. O domínio chama "criar cobrança"; o adapter sabe "como
   falar com Asaas". **Não** se constrói hierarquia de múltiplos provedores (continua vetado por
   ADR-024/§13.15 — trocar gateway no futuro = reescrever 1 módulo). Toda chamada externa:
   timeout (`AbortSignal.timeout`), retry com backoff (5xx/timeout), circuit breaker, logs
   estruturados (`metrics.emit`), classificação de erro 4xx (definitivo) vs 5xx/timeout (retryável).

3. **Fontes de verdade (congelado).** **Asaas = fonte do pagamento** (`subscriptions.billing_status`,
   `invoices.status` refletem o gateway). **ClinicaOS = fonte do acesso** (`clinics.status`).
   Webhook/reconcile atualizam billing → ClinicaOS **decide** acesso (mapeamento explícito no
   dunning). **NUNCA** `asaas_status = access_status` direto. (Ver ADR-016 Amendment.)

4. **Checkout próprio provisiona o tenant.** `checkout_sessions` guarda o **lead**
   (email/document/clinic_name/plan_id) — abandono = lead, não lixo. Ao commitar, a saga
   `tenant_provisioning` (estados `pending`/`provisioning`/`ready`/`failed`, **retomável**)
   provisiona a clínica em `pending_payment` **com expiração**, cria `billing_customer` → customer
   Asaas → subscription. O preço é SEMPRE resolvido no backend (frontend só manda `plan_id`).

5. **Billing NÃO cria usuário.** Billing emite `billing.subscription.activated`; o **Identity**
   consome e cria owner+membership. Billing não conhece usuários (ADR-001).

6. **Idempotência completa.** `idempotency_key` da sessão de checkout é gravado **antes** de
   qualquer chamada externa. Webhooks: dedup por `asaas_event_id` em `processed_webhooks` +
   assinatura + timestamp (anti-replay). Eventos via outbox já são dedup'd por
   `(event_type, idempotency_key)`.

7. **Transições monotônicas.** Invoice/subscription mudam de estado via `canTransition(current, next)`
   (`billing/internal/state-machine.ts`). Trata webhook **fora de ordem**: `paid` não regride para
   `overdue`; `cancelled` é terminal. A ordem de chegada do Asaas não corrompe o estado local.

8. **Money policy.** Dinheiro = `numeric(12,2)` no banco; nos cálculos, **inteiro de centavos**
   (`Money` em `billing/internal/money.ts`); **nunca float**. Arredondamento round-half-up
   documentado (refund pro-rata, totais de invoice).

9. **Reconciliação com histórico (webhook = rápido, reconcile = verdade).** Cron diário compara o
   estado no Asaas com o local e corrige divergências; cada execução grava
   `billing_reconciliation_runs` (auditoria). Webhook nunca é a única verdade.

10. **Dois "barramentos" distintos — não confundir.** `outbox` = **integração técnica**
    (consumidores reagem a `billing.*`); `billing_events` = **timeline da conta** (legível, append-only:
    "plano alterado", "pagamento recebido") para suporte/dispute/reconcile. **Nenhum consumidor
    depende de `billing_events`** — senão vira segundo barramento.

11. **Contrato de eventos congelado.** Os Zod schemas registrados no catálogo do outbox são a
    fonte; documentados em `docs/contracts/events/billing.md`.

## Consequences
- (+) Domínio independe do provedor; troca de gateway é local; preço/histórico/reconciliação
  suportados; webhook fora de ordem e perdas não corrompem estado.
- (+) Suporta primeiros clientes e centenas de clínicas sem reescrever billing.
- (−) Mais tabelas e uma saga de provisioning — custo aceito pela robustez financeira.
- (−) Supersede os contratos `tenancy.*` antes congelados em §13.18 (decisão explícita do owner).
