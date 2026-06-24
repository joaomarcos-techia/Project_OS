# ADR-027 — Onboarding de clínicas via convite mágico

Status: Accepted · 2026-06-23
Relacionados: [016 (clinic lifecycle)](016-clinic-lifecycle.md), [024 (plan model)](024-plan-model.md), [025 (billing architecture)](025-billing-architecture.md), [007 (RLS)](007-rls-implementation-patterns.md)

## Contexto

O super_admin precisa colocar clínicas no ar, mas **criar tenant direto pelo painel**
gera clínicas órfãs/incompletas e mistura responsabilidades. A decisão: o admin gera
uma **intenção** (convite mágico) → link → **onboarding guiado público** → **checkout
in-app** → **provisionamento** → clínica ativa. Zero tenant incompleto; preço sempre do
backend; nenhuma senha por link; nenhum cartão salvo.

### Decisões congeladas
1. **Trial-imediato** (alinha ADR-016; NÃO usar `pending_payment` como estado de clínica):
   checkout → Asaas cria assinatura (cartão, `nextDueDate = hoje+7d`) → clínica nasce
   **`trial`** → owner entra **na hora** (auto-login) → no D+7 o webhook C13 confirma
   (trial→active) ou a cobrança falha → dunning → suspende. **Billing controla pagamento;
   Tenant controla acesso.** Datas de trial vivem na **subscription** (`trial_ends_at`),
   nunca no tenant.
2. **Checkout in-app.** O Asaas NÃO tem tokenização client-side com chave pública (≠ Stripe);
   o cartão vai do browser → `submitCheckoutAction` (HTTPS) → backend chama o Asaas com a
   chave secreta e guarda **só o token/subscription**. O cartão **nunca é persistido nem
   logado** (transita só em memória na request — PCI SAQ A-EP).
3. **Trial de 7 dias.**

## Decisão

Novo bounded context `src/contexts/onboarding`, dono de `clinic_invites` (global-protected,
ADR-007 §10 bloco B) + do estado do onboarding + da **orquestração do provisionamento**
(chama Billing + Identity + Tenancy).

### Fluxo
```
Admin (/admin/clinicas)        → createClinicInviteAction (superAdminAction, auditado)
  → link /join/{rawToken}         token = randomBytes(32); token_hash = HMAC-SHA256(token, MAGIC_TOKEN_SECRET)
/join/{token} (público, sem sessão)
  → rate-limit + resolveOpenInvite (lookup por token_hash) → marca `started`
  → wizard: clínica → gestor(senha só no cliente) → plano → checkout
  → submitCheckoutAction:
       valida token/step_state · resolve preço NO SERVIDOR · Asaas createCustomer +
       createSubscriptionWithCard · createOwnerUser (Supabase admin) · SAGA (tx atômica:
       clínica trial + owner profile + ai_config + billing_customer + subscription trial +
       convite `completed` guarded por version + eventos billing) · auto-login do owner
  → processing → done → /dashboard (já logado)
D+7: Asaas cobra → webhook C13 (reusado): PAYMENT_RECEIVED → trial→active;
       falha → PAYMENT_OVERDUE → dunning/suspende.
```

### 10 refinamentos (GAPs) endereçados
1. **Saga com compensação**, não mega-tx: Asaas roda fora da tx; se o tenant falha após a
   assinatura criada, `cancelSubscription` no Asaas (zero cobrança órfã). Validado em produção.
2. **Trial no billing** (datas na subscription).
3. `provisioned_clinic_id` (não `clinic_id`).
4. `step_state` com **contrato Zod** — nunca senha/cartão.
5. **`version`** (optimistic lock) — 2ª aba/dupla-submissão perde.
6. Preço/plano resolvidos **server-side** no checkout.
7. **Webhook**: ver "Reuso do C13" abaixo.
8. **Meta** vai p/ checklist de ativação pós-login (Fase 2), não no wizard.
9. **Cancelar convite** no admin (override por id, qualquer estado menos `completed`).
10. **Purge LGPD** dos convites incompletos (cron `invites-cleanup`).

### Reuso do webhook C13 (em vez de refatorar — GAP 7)
A clínica de onboarding é uma **subscription padrão** (com `asaas_subscription_id`), então o
webhook C13 já a trata: `markInvoicePaid` → `activateSubscription` (trial→active) +
`setClinicAccess` + emite eventos no outbox; `PAYMENT_OVERDUE` → dunning. **O ciclo pós-trial
já funciona** sem código novo.

**GAP 7 reconsiderado — o acesso síncrono é INTENCIONAL.** O plano original previa
"access-resolver puro" (billing só emite evento; um consumer na tenancy escreve
`clinics.status`). Ao implementar, ficou claro o trade-off real: hoje a decisão de acesso é
**síncrona e atômica** com a mudança de billing (o webhook escreve `clinics.status` na hora).
O decouple via evento tornaria o acesso **eventualmente consistente** (lag do outbox ~1 min) —
o que para *enforcement* (suspender inadimplente) é **pior**: abriria uma janela de graça.
Para controle de acesso, **imediato > eventual**. Mantemos o `setClinicAccess` síncrono; o
decouple fica como anti-padrão explicitamente rejeitado para esse caso.

## Segurança
Token com hash HMAC (nunca cru no banco/log) · expiração 24h · rate-limit · validação
server-side · preço sempre do backend · `clinic_invites` RLS ENABLE+FORCE sem policy + REVOKE
de anon/authenticated (migração 0032) · `/join` valida por token (não vaza outro convite) ·
nenhuma senha por link · nenhum cartão persistido/logado · `guardAdminAccess` em toda action
admin · webhook idempotente (`processed_webhooks`).

## Consequências
- ✅ Fluxo completo validado em produção (sandbox Asaas): convite → wizard → checkout real →
  clínica trial + owner auto-logado + compensação.
- ⏳ **Refinamentos pendentes**: auto-sufixo no slug (hoje colisão de nome → saga falha e
  compensa); idempotência por `checkout_sessions.idempotency_key` (hoje a idempotência é o
  convite `completed` + version); checklist de ativação Meta (Fase 2); funil de métricas (Fase 3).
- ✅ Webhook (GAP 7): mantido síncrono por decisão (acesso imediato > eventual). Não refatorar.
