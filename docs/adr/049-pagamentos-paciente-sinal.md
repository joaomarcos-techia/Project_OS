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
- **EXECUTADA em 2026-08-24.** Migration **0081** (não 0080 — número já ocupado). O write-only é do
  **Postgres**: `api_key_encrypted`/`api_key_hash` ficam fora do `GRANT SELECT` de `authenticated`,
  então `withTenant` não consegue nem ler nem escrever o segredo — a escrita mora no seam privilegiado
  `src/lib/payments/account-store.ts` (mesmo padrão do `connection-store` da mensageria), que grava e
  audita na MESMA tx. `hasApiKey` é derivado de `active` graças ao CHECK `active = false OR
  api_key_encrypted IS NOT NULL` — o indicador não toca a coluna do segredo. Desconectar **apaga** a
  chave. Validação: `getMyAccount({attempts:1})` antes de gravar; provedor indisponível NÃO grava.
  Permissão: `manage:financial` na página, na action e no item de menu (o `pageGate` do repo é ANY —
  exigir duas permissões criaria 'tela visível, ação recusada').
- **MOVIDO PARA 1.4:** auto-configuração do webhook na conta da clínica. O endpoint
  `/api/webhooks/asaas/patient/[ref]` nasce só na 1.4; registrar a URL antes faria o Asaas bater em 404
  e marcar o webhook como interrompido — estado que não se reverte pelo painel.
- **Runbook:** [payment-account-connect](../runbooks/payment-account-connect.md).

### 1.2 — Política de sinal e cancelamento
- **Escopo:** tabela `clinic_deposit_policy` + tela de configuração; novo `consentPurpose` ('politica_cancelamento'); feature flag por clínica (default off).
- **Migrações:** `clinic_deposit_policy` + enum de consent estendido.
- **Testes:** unit das regras (percentual 1..100, aplicabilidade 1ª/retorno, janela de cancelamento), contract.
- **Aceite:** flag off = comportamento atual idêntico (nenhuma regressão).
- **EXECUTADA em 2026-08-24.** Migration **0082**. `clinic_deposit_policy` tem `clinic_id` como PK (a política é
  do tenant, não histórico) e é ESCRITA PELO CAMINHO TENANT (`auditedMutation` → `withTenant` → RLS) — diferente
  da credencial: sem segredo, quem isola é a RLS, e o seam privilegiado fica reservado a quem guarda chave.
  As regras vivem em `payments/policy.ts`, PURAS e sem I/O: `resolveDepositAmount` (null = não cobra, para todo
  caso duvidoso — cobrança indevida custa mais que não cobrar) e `isRefundableCancellation` (data inválida ⇒
  não estorna; devolver dinheiro é decisão positiva). CHECKs no banco impedem estado MORTO: ligada sem escopo,
  percentual 0, janela absurda.
- **`politica_cancelamento` entrou no enum `consent_purpose`, mas NÃO no `ConsentType`** (patient/types.ts): o
  primeiro é o que pode existir na tabela; o segundo é o que o usuário liga/desliga na ficha. Aceite de fluxo
  não pode virar toggle. O helper interno passou a aceitar `StoredConsentPurpose` (superconjunto).

### 1.3 — Cobrança de paciente + hold no agendamento
- **Escopo:** context `payments` + `patient_charges`; colunas de hold em `appointments`; criação da cobrança do sinal no agendamento (PIX/cartão) via `createAsaasClient(chave da clínica)`; cron de expiração de hold (`agendado→cancelado`, devolve slot à waitlist).
- **Migrações:** `patient_charges`; colunas aditivas em `appointments`; evento outbox.
- **Testes:** unit (cálculo do sinal, TTL do hold), integration (generateInvoice sandbox), contract (eventos), smoke do cron de expiração.
- **Aceite:** hold expira e cancela corretamente; idempotência por `external_reference`.
- **PARCIAL / BLOQUEADA em 2026-08-24.** Entregue: migration **0083** (`patient_charges`), contratos de evento e o resolvedor
  `getClinicAsaasClient` (cache por `key_version` — sem ele o circuit breaker por conta não existiria).
- **LACUNA DESTE ADR (D15):** `POST /payments` do Asaas exige `customer`. Este ADR descreve a cobrança como se ela pudesse ser
  criada só com valor + referência. Na prática são necessários: (a) um mapa paciente → `customerId` na conta DA CLÍNICA e
  (b) envio de PII do paciente (nome, provavelmente CPF) para essa conta. Nenhum dos dois está desenhado aqui, e o
  `patientApiV1` não tem seam que devolva nome/CPF decifrados — `cpfMatchesPatient` apenas VERIFICA, por desenho.
  Retomar a 1.3 exige **ADR complementar** cobrindo o mapa, o mínimo de PII e a base legal do tratamento.
- **CONCLUÍDA em 2026-08-24.** Gatilho: **cron-scan** (`/api/cron/payments-deposit`, 15 min), e não handler de evento —
  `scheduling.appointment.created` já tem dono (metering do Billing) e o registry do outbox aceita 1 handler por evento.
  O mesmo tick cobra e expira. Hold vive em `appointments.deposit_status`/`hold_expires_at` (migration 0085), dimensão
  ORTOGONAL — a máquina de estados segue congelada e a expiração cancela via `applyTransition`, com motivo próprio
  `deposit_expired`. CHECK `pending ⇔ hold_expires_at IS NOT NULL` impede a varredura tocar em quem já pagou.
- **RESOLVIDO por [ADR-050](050-identidade-de-pagamento-do-paciente.md)** (aprovado em 2026-08-24): mapa
  `patient_payment_customers` por clínica · PII mínima (nome + CPF) · seam `patientApiV1.getPaymentIdentity`
  · customer criado preguiçosamente na primeira cobrança · sem CPF válido, **não cobra**. A IA continua
  read-only em cobrança.

### 1.4 — Conciliação (webhook de paciente)
- **Escopo:** rota `/api/webhooks/asaas/patient/[ref]`; resolução clínica→credencial; `getPayment` com a chave da clínica; sinal pago → `assertTransition(agendado→confirmado)`.
- **Migrações:** dedup de webhook de paciente (tabela/coluna).
- **Testes:** integration + contract **espelhando os 23 testes** do webhook de assinatura (token inválido, corpo forjado, dedup, out-of-order, 404, timeout).
- **Aceite:** corpo não confiável nunca decide (só `getPayment`); replay seguro; token da clínica validado constant-time.
- **EXECUTADA em 2026-08-24.** Migration **0086**. Decisões que o ADR não detalhava e ficaram travadas aqui:
  (a) o `ref` da URL é `webhook_ref` (uuid random por conta), **não** o `clinic_id` — id de tenant em URL pública é oráculo de
  enumeração; (b) **404 uniforme** para ref inexistente, conta inativa ou sem token — distinguir daria um oráculo de refs válidos;
  (c) dedup em tabela PRÓPRIA `patient_webhook_events` por `(clinic_id, asaas_event_id)`, e não na `processed_webhooks` do billing,
  porque lá a chave assume emissor único e aqui são N contas Asaas; (d) o token do webhook é **gerado por nós** a cada conexão
  (o Asaas nunca devolve o `authToken`, só um indicador), cifrado por tenant e apagado no disconnect.
- **Auto-configuração do webhook** (que veio da 1.1): best-effort com **falha visível**. Se o registro no Asaas falhar, a conexão
  continua válida (a chave é boa) mas `webhook_configured_at` fica nulo — e a tela avisa que as cobranças serão criadas e nunca
  conciliadas. O estado ruim seria o intermediário invisível.

### 1.5 — Falta, restante e reembolso

> **Esta sub-fase foi DIVIDIDA na execução (25/08).** O ramo do restante violava o orçamento §0.6
> (3 contexts) e acionava a parada por **risco financeiro**; ver **D19** no
> [discovery log](../discovery-log.md). Ramos A e C entraram como **1.5a**; o restante virou **1.5b**,
> bloqueada até haver ADR complementar.

#### 1.5a — Falta e estorno (entregue)
- **Escopo:** handler de `scheduling.appointment.no_show` → sinal pago vira receita retida (taxa),
  sem débito; handler de `scheduling.appointment.cancelled` → dentro da janela **estorna**, fora dela
  retém, e **sem pagamento apaga o link no gateway**.
- **Migrações:** nenhuma.
- **Decisões tomadas na execução (não previstas neste ADR):**
  - **Retenção é DERIVADA, não gravada.** Não existe status `retained`: "sinal retido" é
    `patient_charges.paid` + agendamento `faltou`/`cancelado`. Gravá-lo denormalizaria um fato que
    passaria a mentir quando a agenda fosse reaberta (`recovery-policy`: `faltou → agendado`).
  - **Um evento novo, não três.** `payments.patient_charge.closed` carrega `outcome`
    (`refunded` | `cancelled` | `expired`), porque o consumidor e a coluna projetada são os mesmos e o
    registry do outbox é 1 handler por evento.
  - **Handlers DETACHED.** O corpo chama o Asaas; chamada externa dentro da TX do worker prende
    conexão do pool — a mesma razão pela qual a criação da cobrança (1.3) roda fora de transação.
  - **`cancelledAt` no contrato de `cancelled`** (opcional, por causa da janela de deploy). A regra é
    de ANTECEDÊNCIA: julgá-la com o relógio do worker faria o paciente perder o sinal por atraso de
    fila nossa.
  - **Motivos que devolvem sem olhar a janela:** `doctor_absence`, `patient_deceased`,
    `patient_deleted`, `reschedule`. O último porque remarcar cria agendamento novo, que a varredura
    da 1.3 cobra — sem devolver o primeiro, o paciente pagaria **dois sinais pela mesma consulta**
    (**D23**).
  - **Sempre olhar antes de agir.** Todo movimento irreversível no gateway é precedido de
    `getPayment` — mesma doutrina do `findPaymentByExternalReference`. Sem isso, uma reentrega do
    worker estornaria duas vezes.
  - **Estorno tem forma de pagamento.** O Asaas devolve apenas **PIX e cartão** — sinal pago em
    boleto (ou marcado como recebido em dinheiro) não tem estorno automático. A guarda
    `REFUNDABLE_BILLING_TYPES` degrada esse caso para tarefa visível (`refund_skipped`) em vez de
    400 em laço de retentativa, e **não** marca `refunded` — dizer que o paciente recebeu de volta
    sem ter devolvido seria pior que não devolver (**D24**).
  - **Decisão de produto D24 em 2026-08-28:** sinal e restante serão oferecidos somente por **PIX e
    cartão**. `billingType: UNDEFINED` não cumpre essa regra, e `POST /payments` não aceita dois
    tipos simultâneos. O spike sandbox confirmou Checkout `DETACHED` com
    `billingTypes: ["PIX", "CREDIT_CARD"]`, link hospedado e cancelamento. Também confirmou que
    `externalReference` **não é trava de unicidade**: duas chamadas criaram dois IDs; consulta por ID
    e listagem por referência não estão expostas no contrato público testado. O webhook documentado
    identifica `checkout.id`, enquanto o runtime atual depende de `payment.id`. Portanto a execução
    foi separada em D24a intenção/lease, D24b identidade+webhook e D24c troca de sinal/restante. O
    E2E sandbox pago deve provar a correlação Checkout→Payment antes do rollout. Desabilitar boleto
    manualmente na conta não será a trava do produto (D57).
  - **Decisão D58 em 2026-08-29:** o restante preserva sua janela de **7 dias**. Como cada Checkout
    expira em no máximo 24 horas, Payments mantém uma única `patient_charge` e registra gerações de
    Checkout com identidade, lease e estado próprios. Só a geração corrente fornece o link; ao
    expirar, uma nova geração idempotente substitui a anterior e publica outro `link_ready`. Isso não
    cria outra dívida/recebível e não autoriza retry cego de `POST /checkouts`.
- **Corrigido no caminho:** a varredura de expiração (1.3) cancelava o agendamento mas **nunca fechava
  `patient_charges`** — a linha ficava `pending` para sempre e o link seguia pagável (**D22**). E
  `tryConfigureWebhook` montava a URL por template string: `APP_BASE_URL` com barra no fim gerava
  `https://host//api/webhooks/...`, ou seja, conexão "bem-sucedida" e **nenhuma** conciliação
  (**D26**).
- **Testes:** +62 (2436 → **2498**): unit das regras de dinheiro, fiação dos handlers, projeção
  monotônica, e o adapter. `payments:live-check` **11/11**, com o estorno de sinal pago por
  PIX/cartão marcado `n/v` — exige pagamento real na página do Asaas, e o resumo final reporta o
  não-verificado ao lado do verde, para cobertura imaginária não passar por cobertura.
- **Aceite:** faltou → sinal retido, link morto se não pago; cancelou a tempo → estornado; cancelou
  tarde → retido.

#### 1.5b — Restante (DESENHADA E EXECUTADA — ver ADR-051)

- **Por que parou (D19):** (a) `scheduling.appointment.completed` **já tem dono** — o handler de
  faturamento do Financial — e o registry é 1:1; (b) esse handler cria `lancamentos` com o **valor
  CHEIO** e `valorPago: '0'`, então cobrar o restante por fora **duplica receita** no Caixa da
  clínica; (c) conciliar isso exigia o context `financial`, levando a sub-fase a **3 contexts** e
  estourando o §0.6.
- **Destravada por [ADR-051](051-conciliacao-sinal-e-recebivel.md) (25/08).** O problema real não era
  "como cobrar os outros 50%", e sim **como representar o mesmo dinheiro em dois bounded contexts**.
  A decisão: `financial` é a fonte da verdade (`lancamentos` = obrigação), `patient_charges` é
  **instrumento de cobrança**, e o sinal pago vira **crédito antecipado do agendamento** — o recebível
  nasce pelo valor **bruto** e o crédito entra como `valorPago`, deixando `status = 'parcial'`.
- **A Parede 1 caiu sem cron-scan:** o handler de `completed` continua sendo **um só**; ele apenas
  passa a consultar créditos da **própria** tabela do Financial. Por isso a 1.5b.2 é de **1 context**.
- **Escopo real:** 1.5b.0 (este ADR) → 1.5b.1 (crédito + evento) → 1.5b.2 (faturamento consciente do
  crédito) → 1.5b.3 (scan do restante) → 1.5b.5 (falta/cancelamento liberando o crédito). Nenhuma
  passa de 2 contexts.

### 1.6 — Notificação e UI

> **DIVIDIDA na execução (25/08).** Juntas, notificação e agenda dariam **3 contexts**
> (`payments` + `ai-agent` + `scheduling`), estourando o §0.6.

#### 1.6a — Link no WhatsApp (entregue)

- **Escopo:** entrega do link do sinal ao paciente. `payments` + `ai-agent` = 2 contexts.
- **Migração:** **0087** — valor `deposit_link` no enum `proactive_job_type` (aditivo; mesma
  compatibilidade transacional documentada na 0014).
- **O que estava quebrado:** desde a 1.3 a cobrança nascia e o `invoice_url` ficava guardado em
  `patient_charges` sem que nada o entregasse. O hold vencia, a varredura cancelava o agendamento, e
  o paciente perdia a consulta **sem nunca ter recebido como pagar**. Anti-no-show que produzia
  no-show.
- **Decisões da execução:**
  - **Fila C14, não caminho paralelo.** Lease, backoff, janela 8-20h local, supressão, consentimento,
    dedup e at-most-once no Meta já estavam resolvidos lá. Reimplementar isso pior, num caminho que
    manda **link de pagamento** para paciente, seria a pior troca possível.
  - **Evento próprio (`payments.patient_charge.link_ready`).** O `created` já é do Scheduling — mas a
    razão não é só a restrição 1:1: `invoiceUrl` é nullable, então "a cobrança existe" e "existe um
    link que o paciente consegue abrir" são fatos diferentes, e só o segundo justifica uma mensagem.
  - **O link não viaja.** Nem no evento, nem no job. Resolvido no send-time por
    `paymentsApiV1.getPayableCharge`, que devolve `null` se a cobrança já foi paga, estornada,
    cancelada ou expirou. **A guarda mora no seam, não no chamador**: quem entrega a mensagem não pode
    ser o responsável por lembrar de perguntar se ela ainda faz sentido.
  - **Propósito de supressão unificado.** O mapeamento tipo → propósito estava **duplicado** entre a
    política (que bloqueia) e o envio (que registra). Virou `suppressionPurposeFor`: divergir faria
    bloquear por um propósito e gravar outro, e o opt-out registrado depois nunca casaria com o que
    foi enviado antes. `deposit_link` reusa `reminder` — é **transacional** (o paciente marcou e perde
    a vaga se não pagar), não é dívida; e propósito novo nasceria sem os opt-outs já registrados.
  - **A IA continua read-only em cobrança (ADR-023).** Não há LLM em nenhum ponto do caminho.
- **Dependência externa declarada:** o template precisa ser aprovado na Meta
  (`META_TEMPLATE_DEPOSIT_LINK_ID`). Sem ele o job falha com `template_not_configured` — visível, e
  **nunca** cai para texto livre ou link fora de template aprovado.
- **Aceite:** paciente com telefone e sem opt-out recebe o link dentro da janela; cobrança já paga
  não gera mensagem.

#### 1.6b — Status na agenda (entregue)

- **Escopo:** `deposit_status` e `hold_expires_at` sobem para o `AppointmentSummary` e aparecem na
  agenda. `scheduling` (+ app) = 1 context.
- **Migração:** nenhuma. As colunas existem desde a **0085** — o que faltava era o mapeamento.
- **O que estava quebrado:** `toAppointmentSummary` simplesmente não lia as duas colunas. Mesmo
  formato do **D32**: a camada de baixo correta, o produto inexistente, o dado parando no meio do
  caminho. O mapeamento é manual, campo a campo, e nada avisa quando um campo novo é esquecido — daí
  o teste de projeção nascer junto.
- **Decisões da execução:**
  - **Badge ao lado do status, não no lugar dele.** O sinal é dimensão ORTOGONAL (a 0085 é explícita),
    e um agendamento pode estar `agendado` com sinal pago. Fundir os dois apagaria uma das duas
    informações.
  - **`none` não renderiza nada.** Sinal desligado é o caso da maioria das clínicas (default `false`
    desde a 1.2); um rótulo "sem sinal" em toda consulta treinaria o operador a ignorar aquela região
    da tela — e aí ele também ignora quando importa.
  - **`pending` é âmbar e carrega o prazo.** É o único estado em que a recepção ainda pode agir: a
    vaga vira cancelamento sozinha quando o hold vence. Os demais já são desfecho.
- **Aceite:** recepção vê o estado do sinal e, quando pendente, até quando a vaga está segurada.

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

**Estado em 2026-08-29:** Build · Lint · Typecheck · Unit · Integration · Contract e arquitetura estão
verdes; 2.790 testes passam sem regressão. D24/D58, D50 e D27 estão implementados no worktree. A
Camada 1 **ainda não está aprovada**: a migration 0092/smoke DB aguardam autorização; faltam E2E Meta
real, prova sandbox D54/D55 com `PAYMENT_RESTORED`, pagamento/estorno real PIX+cartão, chargeback
controlado, carga, Product Acceptance e estabilização. A fila executável e a evidência atual estão em
`docs/qorov2.md` P0–P10. Proibido concluir com código sem teste, migration sem volume, endpoint/fluxo
sem E2E, warning ignorado ou evidência externa presumida.

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
