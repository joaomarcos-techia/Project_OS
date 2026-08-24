# ADR-049 — Pagamento de paciente e sinal anti-no-show (Camada 1 / P0)

- **Status:** Proposto (aguarda aprovação para iniciar a implementação)
- **Data:** 2026-08-19
- **Contexto do repo:** baseline verde em `d414191` (lint ✅ · typecheck ✅ · 1966 testes ✅ · build ✅)
- **Substitui/relaciona:** reusa ADR-025 (Asaas billing), ADR-007 (RLS), ADR-011 (outbox/idempotência), ADR-012 (cripto), ADR-023 (IA read-only em cobrança)
- **Número provisório:** maior ADR em disco é 048; ajustar se a migração de docs reservar outra faixa.

> ⚠️ Precedência em caso de divergência: **Código > Banco > Testes > Documentação.** Este documento foi escrito lendo o código; se durante a implementação algo divergir, atualizar este ADR **antes** de prosseguir.

---

## 1. Problema (do Gap Analysis)

GAP 1 (Crítico): o sistema **não cobra o no-show de fato**. Hoje `appointment.completed` gera lançamento (`financial/internal/handlers/appointment-completed.ts`), a régua de dunning envia **lembretes** (`routeDunning`), e a IA é read-only em cobrança (ADR-023). Não existe gateway de pagamento do paciente (`financial/schema.ts`: `payment_methods` é só catálogo de rótulos), nem handler de `no_show`. A promessa "a cobrança dispara sozinha / faltas recuperadas" **não tem fiação**.

## 2. Decisões (travadas com o fundador)

| # | Decisão | Escolha |
|---|---|---|
| D1 | Gateway de pagamento do paciente | **Asaas** (reuso do adapter endurecido; §13.15 proíbe multi-gateway — **não** entra Mercado Pago) |
| D2 | Custódia do dinheiro | **Modelo B — conta Asaas própria da clínica** (BYO). Dinheiro vai direto pra clínica; o Qoro **não** custodia. Domínio modelado **agnóstico de topologia** para migrar a subcontas/split (Modelo A) depois sem reescrever. |
| D3 | Onde a clínica informa a chave | **Painel `configuracoes/pagamentos`** (não env). Chave **cifrada em repouso**, **write-only** (indicador `hasApiKey`, nunca devolve), validada no save. |
| D4 | Mecanismo anti-no-show | **Sinal (pré-pagamento) no agendamento** — não cartão-em-arquivo pós-débito. Recuperação **automática por construção**: faltou → sinal já está no caixa. |
| D5 | Percentual do sinal | **50% default, configurável por clínica** (liga/desliga, %, aplicabilidade). |
| D6 | Meios do sinal | **PIX** e **cartão**, escolha do paciente. Ambos cobram os 50%. |
| D7 | Restante (outros 50%) | Cobrado **após o comparecimento**, **por link** (Asaas) ou presencial. **Sem token, sem cartão em arquivo, sem débito automático** (decisão 2026-08-19: tudo por link). |
| D8 | Aplicabilidade | **1ª consulta e retorno** (default; configurável). |
| D9 | Cancelamento | Com antecedência (janela configurável) → sinal **devolvido/creditado**. Tarde ou no-show → clínica **retém** o sinal (é a taxa). |

### Fronteira operacional
A integração é escrita por nós; **quem abre a conta Asaas e insere a chave é a clínica**, pelo painel. Chave de API **nunca** trafega por chat/log — só do formulário para a coluna cifrada.

## 3. Modelo de estados — por que NÃO tocar na máquina congelada

`state-machine.ts` é a fonte única de transições, com tabela **congelada** e regra "nenhum `if (status===)` fora daqui". O gate de sinal entra como **dimensão ortogonal**, não como novo estado:

- O agendamento nasce `agendado` com `deposit_status='pending'` + `hold_expires_at`.
- Sinal pago (webhook) → `deposit_status='paid'` → transição sancionada `agendado → confirmado` (já é válida) via `assertTransition`.
- Hold expirado sem pagar → transição sancionada `agendado → cancelado` (já é válida) por cron.
- `no_show` e `completed` já emitem eventos de outbox (`scheduling.appointment.no_show` / `.completed`) — o context de pagamentos apenas **reage** a eles.

Resultado: **zero alteração na tabela de transições** e nos 201 arquivos de teste que dependem dela.

## 4. Arquitetura

### 4.1 Contexts e camadas

- **`src/lib/payments/asaas`** (novo — infra compartilhada): extrair o `PaymentProvider` + `asaasProvider` de `billing/internal/providers/asaas.ts`, **parametrizando por credencial** (`createAsaasClient(credential)`). Continua single-gateway. Usado por **billing** (assinatura, credencial = env do Qoro) **e** pelo novo context de pagamentos (credencial = chave cifrada da clínica). Justificativa de fronteira: adapter é infra dirigida (driven adapter), pode viver em `lib`; contexts não importam `internal` um do outro.
- **`payments`** (novo bounded context): dono de `patient_charges` e da orquestração cobrança↔agendamento. Fala com `scheduling`/`financial` **por eventos** (outbox), nunca import direto.
- **`tenancy`/`clinics`**: credencial + política (cifra reusa o padrão `cnpj_encrypted`).
- **`patient`**: novo `consentPurpose` para a política de sinal/cancelamento (reusa `patient_consents`).
- **`scheduling`**: colunas de hold no `appointments`; nenhum estado novo.
- **`financial`**: recebível do restante (reusa `lancamentos`/faturamento).

### 4.2 Tabelas novas (todas tenant-scoped, RLS `defaultTenantPolicy`)

```
clinic_payment_accounts        -- credencial + conexão (segredo isolado da política)
  clinic_id (PK/FK)            -- 1:1 com a clínica
  provider            text     -- 'asaas' (fixo hoje)
  api_key_encrypted   text     -- base64(envelope) — MESMO padrão de cnpj_encrypted
  account_ref         text     -- id/wallet Asaas da clínica (não-secreto)
  webhook_token_hash  text     -- token do webhook DESTA clínica (validação constant-time)
  environment         text     -- 'sandbox' | 'production'
  status              enum     -- 'disconnected' | 'connected' | 'invalid'
  connected_at        timestamptz
  ... timestamps
  -- hasApiKey é DERIVADO (api_key_encrypted IS NOT NULL); a chave nunca é devolvida.

clinic_deposit_policy          -- política de negócio (sem segredo)
  clinic_id (PK/FK)
  enabled             boolean  default false   -- feature flag POR CLÍNICA (ship dark)
  deposit_percent     integer  default 50      -- 1..100
  applies_first       boolean  default true
  applies_return      boolean  default true
  cancel_window_hours integer  default 24      -- refund se cancelar com >= X h
  ... timestamps

patient_charges                -- cobrança de paciente (context payments)
  id (PK), clinic_id (FK)
  appointment_id      uuid     -- FK appointments (via migration; SET NULL no LGPD)
  patient_id          uuid
  kind                enum     -- 'deposit' | 'remainder'
  method              enum     -- 'pix' | 'card'
  amount              numeric(12,2)
  status              enum     -- 'pending'|'paid'|'expired'|'refunded'|'failed'
  provider_payment_id text     -- id no Asaas
  external_reference  text     -- UNIQUE — chave de conciliação idempotente (encoda charge id)
  invoice_url         text     -- QR/link PIX ou checkout
  paid_at, refunded_at, expires_at
  ... timestamps
```

Colunas aditivas em `appointments` (nullable, backward-compatible):
```
deposit_required  boolean default false
deposit_status    enum    -- null | 'pending' | 'paid' | 'waived' | 'refunded'
hold_expires_at   timestamptz  -- null = sem hold
```

### 4.3 Sequência de eventos (feliz)

```
1. Recepção/IA cria agendamento  → appointments(status=agendado, deposit_required=true,
                                    deposit_status=pending, hold_expires_at=now()+TTL)
2. payments cria patient_charges(kind=deposit, 50%, pix|card) via createAsaasClient(chave da clínica)
   → Asaas generateInvoice → invoice_url (PIX QR / checkout cartão)
3. messaging envia o link/QR ao paciente no WhatsApp (IA continua read-only — o SISTEMA envia)
4. Paciente paga → Asaas → webhook /api/webhooks/asaas/patient/[ref]
5. webhook: resolve clínica pela ref → carrega chave → getPayment(chave da clínica) [fonte da verdade]
   → marca patient_charges.paid → emite payments.charge.paid
6. handler: assertTransition(agendado→confirmado) → appointments.deposit_status=paid, confirmado
7a. Comparece (atendido): payments cobra o RESTANTE por LINK (Asaas) ou registra recebível presencial → concilia
7b. Falta (no_show): payments marca o sinal como receita retida (taxa de no-show); nada a debitar
7c. Hold expira sem pagar (cron): assertTransition(agendado→cancelado); slot volta à waitlist
7d. Cancelamento com antecedência (>= cancel_window_hours): payments estorna o sinal (refund)
```

### 4.4 Webhook de paciente (novo, separado do de assinatura)

Rota `POST /api/webhooks/asaas/patient/[clinicRef]`, espelhando a ordem inviolável do webhook de assinatura (`/api/webhooks/asaas/route.ts`):
0. size guard → 1. resolve clínica pela `clinicRef` (opaca) → carrega `clinic_payment_accounts` → 2. valida `asaas-access-token` contra `webhook_token_hash` **da clínica** (constant-time) → 3. `parseWebhook` (só ids) → 4. `getPayment(paymentId)` com a **chave da clínica** (fonte da verdade, fora da tx) → 5. dedup (`processed_webhooks` estendido ou tabela própria) + reconcilia `patient_charges` + transição idempotente → 200 sempre que aceito.
O webhook de **assinatura** (conta do Qoro) permanece **intocado**.

## 5. Aderência (checklist obrigatório)

- **Multi-tenant/RLS:** todas as tabelas novas com `clinic_id` + `defaultTenantPolicy`; webhook usa `dbAdmin` cross-tenant (allowlist) resolvendo a clínica pela ref, como o de assinatura.
- **Outbox:** eventos `payments.charge.created/paid/expired/refunded` no catálogo; handlers idempotentes por `external_reference`/eventId (padrão ADR-011).
- **Auditoria:** conectar/desconectar conta e mudanças de política em `audit_events`.
- **LGPD:** chave da clínica cifrada; consentimento da política de sinal em `patient_consents`; `patient_id`/`appointment_id` seguem o hard-delete (SET NULL). Cartão nunca é armazenado (checkout hospedado do Asaas).
- **Billing (Qoro):** isolado — outra conta, outra rota de webhook, credencial via env (não muda). Sem risco de misturar o dinheiro do Qoro com o do paciente.
- **Segurança do adapter:** o `createAsaasClient` mantém circuit breaker, sanitização de erro (não vaza PAN/CPF), sem auto-retry em POST.

---

## 6. Plano de execução — Camada 1 (sub-fases com portão de validação)

> Regra: cada sub-fase só começa com a anterior **verde**. Nenhuma deixa o sistema inconsistente. Feature flag por clínica (`clinic_deposit_policy.enabled=false` default) → **ship dark**, zero impacto em clínicas existentes até ligar.

### 1.0 — Fundação do adapter (refactor seguro, sem comportamento novo)
- **Escopo:** extrair `PaymentProvider`+`asaasProvider` para `src/lib/payments/asaas`; introduzir `createAsaasClient(credential)`; `billing` injeta a credencial do env. Circuit breaker por credencial/instância.
- **Migrações:** nenhuma.
- **Testes:** contract tests do adapter; **rodar baseline inteiro** — os 1966 testes (inclui os 23 do webhook de assinatura) e o build **têm que continuar verdes**.
- **Aceite:** zero mudança de comportamento; baseline 100% verde; `pnpm arch:check`/`arch:db-check` verdes.
- **EXECUTADA em 2026-08-24.** `src/lib/payments/asaas` (`index.ts`) expõe `createAsaasClient(credential)`;
  `asaasProvider` continua exportado como singleton do client do Qoro, com as credenciais lidas **por função**
  (leitura tardia de env preservada — `assertBillingRuntimeReady()` segue rodando a cada request).
  Circuit breaker é **por instância de credencial**. `credential.baseUrl` omitido cai em `env.ASAAS_BASE_URL`;
  `credential.webhookToken` omitido faz `validateWebhookToken` retornar sempre `false`. O timeout continua
  vindo do env (política do Qoro, não da conta). 11 call-sites repontados; `onboarding` deixou de precisar da
  exceção `boundaries` para o adapter. Gates: 257 arquivos / 2295 testes ✅, build ✅, arch:* ✅.
  **Não feito de propósito (fica para 1.1):** validação de `apiKey` vazia — ver D10 no discovery log.

### 1.1 — Credencial da clínica (Modelo B)
- **Escopo:** tabela `clinic_payment_accounts`; painel `configuracoes/pagamentos` (papel financeiro/dono); validação no save (`getMyAccount` do Asaas); **auto-configuração do webhook** na conta da clínica via API Asaas; indicador `hasApiKey` (write-only).
- **Migrações:** `clinic_payment_accounts` + RLS + índices `clinic_id`.
- **Testes:** unit (cripto/mascaramento/`hasApiKey`), integration (validação Asaas — sandbox), contract (schema Zod do form), e2e (conectar/desconectar conta), audit.
- **Aceite:** chave nunca retorna; conexão inválida rejeitada no save; auditoria registra.

### 1.2 — Política de sinal e cancelamento
- **Escopo:** tabela `clinic_deposit_policy` + tela de configuração; novo `consentPurpose` ('politica_cancelamento'); feature flag por clínica (default off).
- **Migrações:** `clinic_deposit_policy` + enum de consent estendido.
- **Testes:** unit das regras (percentual 1..100, aplicabilidade 1ª/retorno, janela de cancelamento), contract.
- **Aceite:** flag off = comportamento atual idêntico (nenhuma regressão).

### 1.3 — Cobrança de paciente + hold no agendamento
- **Escopo:** context `payments` + `patient_charges`; colunas de hold em `appointments`; criação da cobrança do sinal no agendamento (PIX/cartão) via `createAsaasClient(chave da clínica)`; cron de expiração de hold (`agendado→cancelado`, devolve slot à waitlist).
- **Migrações:** `patient_charges`; colunas aditivas em `appointments`; evento outbox.
- **Testes:** unit (cálculo do sinal, TTL do hold), integration (generateInvoice sandbox), contract (eventos), smoke do cron de expiração.
- **Aceite:** hold expira e cancela corretamente; idempotência por `external_reference`.

### 1.4 — Conciliação (webhook de paciente)
- **Escopo:** rota `/api/webhooks/asaas/patient/[ref]`; resolução clínica→credencial; `getPayment` com a chave da clínica; sinal pago → `assertTransition(agendado→confirmado)`.
- **Migrações:** dedup de webhook de paciente (tabela/coluna).
- **Testes:** integration + contract **espelhando os 23 testes** do webhook de assinatura (token inválido, corpo forjado, dedup, out-of-order, 404, timeout).
- **Aceite:** corpo não confiável nunca decide (só `getPayment`); replay seguro; token da clínica validado constant-time.

### 1.5 — Falta, restante e reembolso
- **Escopo:** handler de `scheduling.appointment.no_show` → sinal vira receita retida (taxa), sem débito; handler de `appointment.completed` → cobrança do restante **por link** (Asaas) ou recebível presencial; handler de cancelamento com antecedência → refund do sinal.
- **Migrações:** nenhuma (ou índice de apoio).
- **Testes:** unit (retido vs restante vs refund conforme a janela), integration (refund/geração do link do restante em sandbox), **E2E completo (abaixo)**.
- **Aceite:** faltou → sinal retido e recebível do restante NÃO criado; comparece → restante cobrado e conciliado; cancelou a tempo → sinal estornado.

### 1.6 — Notificação e UI
- **Escopo:** envio do link/QR do sinal no WhatsApp (sistema, não IA); status de pagamento na agenda/consultório.
- **Testes:** unit (template), e2e da jornada, smoke `smoke:conversas`.
- **Aceite:** paciente recebe o link; status visível pra recepção.

### E2E de aceite da Camada 1 (cenário exigido)
```
Paciente agenda (com política ligada)
 → aceita a política (consent gravado)
 → recebe o link do sinal (50%)
 → paga (PIX ou cartão)
 → webhook concilia → agendamento CONFIRMADO
Ramo A (falta): status faltou → sinal RETIDO (taxa); restante não é criado
Ramo B (comparece): atendido → RESTANTE cobrado → conciliado → recebível baixado
Ramo C (cancela a tempo): sinal ESTORNADO
```

## 7. Critérios de aprovação da Camada 1 (portão)
Build ✅ · Lint ✅ · Typecheck ✅ · Unit ✅ · Integration ✅ · Contract ✅ · Smoke ✅ · E2E ✅ · `arch:check`/`arch:db-check` ✅ · **nenhum** dos 1966 testes de baseline regrediu. Proibido concluir com: código sem teste, migration sem validação, endpoint sem teste, fluxo sem E2E, feature flag sem cobertura, warning ignorado, ou TODO sem justificativa.

## 8. Riscos e mitigação
- **Refactor do adapter quebrar billing** → 1.0 isolada com baseline inteiro como rede; feature nova só em cima disso.
- **Fricção do sinal (1ª vez)** → flag + % configuráveis por clínica; default calibrável.
- **Vazamento de credencial de terceiro** → cifra em repouso + write-only + acesso por papel + auditoria.
- **Reembolso/estorno errado** → janela de cancelamento explícita + testes de cada ramo.
- **Webhook forjado** → mesma postura A2 do de assinatura (corpo é notificação; `getPayment` é a verdade).

## 9. Rollback
Cada sub-fase é reversível: flag por clínica desliga o fluxo; migrações são aditivas (colunas nullable / tabelas novas), sem alterar dados existentes. Reverter = desligar flag + reverter migração aditiva.

## 10. Fora de escopo (P0)
Recibo/NFS-e, notificação de receita azul/amarela, Memed, template psiquiátrico, CRP/psicologia, convênio/TISS, pacote/mensalidade, CRM/UTM, repasse, NPS — todos em P1/P2/P3 conforme o Gap Analysis.
