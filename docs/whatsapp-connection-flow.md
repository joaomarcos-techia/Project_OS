# Handoff — Página de Conexão do WhatsApp (Fase 2 do onboarding)

> Documento autocontido. Lê isto e você consegue construir o fluxo **sem nenhum
> conhecimento prévio do sistema**. Escrito em 2026-06-23, após a Fase 1 do
> onboarding (convite mágico) e a Fase 2 increment 1 (checklist de ativação).

---

## 1. Objetivo

O **Agente de IA** do ClinicaOS (C10/C11) atende os pacientes **via WhatsApp**. Para
uma clínica usar o agente, ela precisa ter um **número WhatsApp conectado** (Meta Cloud
API). Hoje **não existe UI** para o gestor (owner) conectar o número — só ações de
backend para super_admin. A Fase 2 quer uma página onde o **owner conecta o WhatsApp da
própria clínica**, e isso vira um item da **checklist de ativação** no dashboard.

---

## 2. ⚠️ O problema central (decida ANTES de codar)

A ação que conecta o número — `connectWhatsappNumber` — é **super_admin-only**: ela roda
dentro de `superAdminAction(...)` que exige `requireSuperAdmin` (AAL2/MFA) e usa `dbAdmin`
(cross-tenant). **Um owner de clínica NÃO consegue chamá-la.** Além disso, conectar exige
um **access token do Meta** — um segredo que o owner comum **não tem em mãos** e que não
se deve pedir para ele colar num input.

Existem dois modelos. **Escolha um antes de implementar:**

### Modelo A — Assistido pela plataforma (MVP rápido, baixo risco)
O **super_admin** conecta o número pela clínica (já há backend pronto). A página do owner
só **mostra o status** ("WhatsApp conectado / não conectado") e, se não conectado, instrui
a falar com o suporte/gerente. Constrói-se só uma tela admin + um indicador no tenant.
- ✅ Reusa 100% o backend existente. Pouco código. Sem App Review do Meta.
- ❌ Não é self-service de verdade (a plataforma faz por trás).

### Modelo B — Self-service via Meta Embedded Signup (o "certo", mais trabalho)
O owner clica "Conectar WhatsApp", abre o **popup do Meta Embedded Signup** (SDK JS do
Facebook), faz login no FB, escolhe/cria a conta WhatsApp Business (WABA) + número, e
autoriza o app. O ClinicaOS recebe um `code`, **troca por um token no servidor**, resolve
`phone_number_id` + `waba_id` via Graph API e persiste — **o owner nunca vê o token**.
- ✅ Self-service real, padrão de mercado.
- ❌ Exige: App Meta com **App Review** (`whatsapp_business_management`,
  `whatsapp_business_messaging`), config do Embedded Signup, SDK JS, troca de token
  server-side, e uma ação **tenant-scoped** nova (não a super_admin atual).

**Recomendação:** comece pelo **Modelo A** para destravar a checklist e o produto, e
trate o **Modelo B** como projeto próprio quando o App Review do Meta estiver pronto.

---

## 3. Contexto do sistema atual (tudo que já existe — C10)

### 3.1 Tabela `clinic_whatsapp_numbers`
Arquivo: [src/contexts/messaging/schema.ts](../src/contexts/messaging/schema.ts) (~linha 55).

```
clinic_whatsapp_numbers(
  id              uuid pk
  clinic_id       uuid  (tenantIdRef → FK clinics, RLS por tenant)
  provider        enum messaging_provider  default 'meta'   ('meta' | 'zapi')
  phone_number    text  not null            -- E.164, ex.: +5511990000000
  meta_phone_id   text  not null            -- Meta phone_number_id (roteamento do webhook)
  meta_business_id text                     -- WABA id (nullable)
  token_encrypted text  not null            -- token cifrado (encryptForTenant). GRANT service_role-only NA COLUNA.
  token_version   integer not null default 1 -- bump no rotate; o sender compara após 401
  verified_at     timestamptz
  active          boolean not null default true
  created_at / updated_at
)
```
Índices/constraints **importantes**:
- `clinic_whatsapp_numbers_clinic_active_uniq` — partial UNIQUE `(clinic_id) WHERE active=true`
  → **1 número ativo por clínica**; reconectar = desativar o antigo + inserir novo ativo.
- `..._phone_active_uniq` e `..._meta_phone_active_uniq` — 1 número/phone_id ativo global.
- RLS por tenant; **`token_encrypted` tem grant service_role-only** (column-level) →
  `authenticated` (owner) **nunca lê o token**.

### 3.2 Ações de backend (super_admin-only)
Arquivo: [src/contexts/messaging/actions.ts](../src/contexts/messaging/actions.ts).
- `connectWhatsappNumber(input)` — desativa o ativo anterior + insere o novo ativo.
  Cifra o token com `encryptForTenant(clinicId, token)` ANTES da tx. Auditado em
  `super_admin_actions` (`messaging.number.connected`).
- `disconnectWhatsappNumber(clinicId)` — `active=false` (histórico preservado).
- `rotateWhatsappToken(clinicId, newToken)` — re-cifra + `token_version + 1`.

Input (`ConnectNumberSchema`, [types.ts](../src/contexts/messaging/types.ts)):
```ts
{ clinicId: uuid, provider: 'meta'|'zapi'='meta', phoneNumber: string(min5),
  metaPhoneId: string, metaBusinessId?: string, token: string }
```

### 3.3 number-store — o seam privilegiado (NÃO duplicar)
Arquivo: [src/lib/messaging/number-store.ts](../src/lib/messaging/number-store.ts).
Superfície CONGELADA, **exatamente 3 funções** (usa `dbAdmin` + SQL cru, vive em `lib`
porque o webhook não tem tenant resolvido):
- `resolveClinicByPhoneId(metaPhoneId)` → clinicId (roteamento do tenant no webhook inbound).
- `loadActiveNumberForSend(clinicId)` → credencial ativa (decifra o token p/ enviar).
- `quarantineOrphan(...)` → não perder mensagem de número não provisionado.
> Qualquer operação NOVA de número vai para o **contexto messaging** (`withTenant`),
> não para o number-store.

### 3.4 Webhook inbound + outbox sender
- Webhook: `src/app/api/webhooks/meta/route.ts` — `GET` valida `META_WEBHOOK_VERIFY_TOKEN`
  (handshake do Meta); `POST` valida HMAC com `META_APP_SECRET`, normaliza, resolve a
  clínica por `meta_phone_id` (`resolveClinicByPhoneId`) e enfileira para o agente.
- Envio: o worker do outbox usa `loadActiveNumberForSend` → decifra o token →
  `src/lib/messaging/meta-cloud.ts` chama a Graph API. Resiliência (timeout/circuit) já
  pronta. **Você não precisa mexer no inbound/outbound — só na CONEXÃO do número.**

### 3.5 Criptografia do token
`encryptForTenant(clinicId, plaintext)` / `decryptForTenant` em
[src/lib/crypto](../src/lib/crypto). HKDF por tenant (ADR-012). O token **só existe em
claro** em memória no momento de cifrar (na ação) e de enviar (no sender). **Nunca**
trafega para o cliente nem aparece em log.

### 3.6 Variáveis de ambiente (Meta) — [src/lib/env.ts](../src/lib/env.ts)
- `META_APP_SECRET` — secret do app Meta (valida o HMAC do webhook). **Já existe.**
- `META_WEBHOOK_VERIFY_TOKEN` — token do handshake GET do webhook.
- `META_GRAPH_API_VERSION` (default ~`v21.0`), `META_HTTP_TIMEOUT_MS`.
- `META_TEMPLATE_*_ID` + `META_TEMPLATE_LANG` — templates aprovados (lembrete/dunning/followup).
- Para o **Embedded Signup (Modelo B)** faltará: `META_APP_ID` (público) e um
  `META_CONFIG_ID` (config do Embedded Signup) + o `META_APP_SECRET` (já tem) para a troca
  do `code` por token.

### 3.7 ADRs relevantes
- [ADR-004](adr/004-meta-cloud-api.md) — escolha do Meta Cloud API.
- [ADR-020](adr/020-messaging-provider-patterns.md) — padrões de provider (PaymentProvider-like;
  `Platform Encryption Scope` p/ órfãos; superfície do number-store).

---

## 4. Como o Meta WhatsApp Cloud API conecta um número

Para enviar/receber por um número, o ClinicaOS precisa de **3 coisas**:
1. **`phone_number_id`** — id do número na conta WhatsApp Business (não é o telefone; é um id Meta).
2. **`waba_id`** (WhatsApp Business Account id) — opcional no schema, útil p/ gerenciar.
3. **access token** — credencial para chamar a Graph API por aquele número.

Formas de obter:
- **Manual (Modelo A):** alguém com acesso ao Meta Business Manager pega o `phone_number_id`
  e gera um **System User token** (permanente) no painel do Meta. A plataforma cola isso na
  ação `connectWhatsappNumber`. Bom para poucos clientes / bootstrap.
- **Embedded Signup (Modelo B):** o SDK JS do Facebook abre o fluxo guiado; ao final o app
  recebe um `code`; o servidor troca por token (`GET /oauth/access_token` com app_id +
  app_secret + code) e descobre `phone_number_id`/`waba_id` via Graph
  (`GET /{waba_id}/phone_numbers`). Requer permissões aprovadas em App Review.
> **Importante:** após conectar, é preciso **registrar/assinar o webhook** da WABA no app
> (campo `messages`) e garantir que o número esteja com o webhook apontando para
> `/api/webhooks/meta`. No Embedded Signup isso pode ser automatizado via Graph
> (`POST /{waba_id}/subscribed_apps`).

---

## 5. Plano de implementação

### 5.1 Modelo A (recomendado p/ começar) — passos
1. **UI admin** em `/admin/clinicas/[id]` (página de detalhe da clínica já existe): um
   bloco "WhatsApp" com um modal/form (client) que chama a ação `connectWhatsappNumber`
   via uma **admin action** (padrão de `src/app/(admin)/admin/actions/*`, com
   `guardAdminAccess`). Campos: `phoneNumber`, `metaPhoneId`, `metaBusinessId?`, `token`.
   Mostrar status atual (conectado/ativo) + botão desconectar (`disconnectWhatsappNumber`).
   - O backend já existe; é só a tela + a action fina que repassa para `connectWhatsappNumber`.
2. **Indicador no tenant (dashboard):** adicionar o item à checklist de ativação (§6),
   mostrando "WhatsApp conectado ✓" ou, se não, um texto tipo "Conecte com seu gerente".
3. Pronto. Sem App Review, sem SDK.

### 5.2 Modelo B (self-service) — passos
1. **Meta App:** configurar **Embedded Signup** (Configuration ID) + App Review para
   `whatsapp_business_management` e `whatsapp_business_messaging`. Adicionar `META_APP_ID`
   e `META_CONFIG_ID` ao env.
2. **Página tenant** `/equipe/whatsapp` (ou `/configuracoes/whatsapp`): client component que
   carrega o **Facebook JS SDK** e dispara `FB.login` com o config do Embedded Signup;
   captura o `code` retornado.
3. **Server Action tenant-scoped NOVA** (NÃO a super_admin): `connectMyClinicWhatsapp(code)`:
   - `requireUser()` + `requireClinicId()` (o owner conecta a PRÓPRIA clínica).
   - Troca `code` → token (server-side, `META_APP_SECRET`).
   - Descobre `phone_number_id` + `waba_id` via Graph.
   - Assina o webhook (`POST /{waba_id}/subscribed_apps`).
   - Persiste com **a mesma lógica** de `connectWhatsappNumber` (desativa antigo + insere
     ativo + cifra token), mas como **escrita tenant** — provavelmente um novo método no
     contexto messaging usando `withTenant`/`dbAdmin` com auditoria em `audit_events`
     (não `super_admin_actions`, pois o ator é o owner). Reusar `encryptForTenant`.
   - **Segurança:** validar que o `phone_number_id` pertence à WABA autorizada pelo `code`
     (evita um tenant sequestrar o número de outro); respeitar os unique parciais.
4. Item da checklist (§6) aponta para essa página.

> Onde colocar a nova ação tenant: criar `connectWhatsappForOwner` no contexto messaging
> (server action ou função chamada por uma action em `(shell)`), espelhando a estrutura de
> `connectWhatsappNumber` mas com `targetClinicId = requireClinicId()` e auditoria de tenant.
> O `token_encrypted` continua service_role-only — a escrita roda via `dbAdmin`/seam
> privilegiado, nunca expondo o token.

---

## 6. Plugar na checklist de ativação (já existe)

Arquivo: [src/app/(app)/(shell)/dashboard/data.ts](../src/app/(app)/(shell)/dashboard/data.ts)
→ função `getActivationChecklist(clinicId)`. Hoje tem 3 itens (médico/horários/paciente),
derivados por presença de dado via `withTenant` + `EXISTS`. **Adicionar o 4º item:**

```ts
// dentro do SELECT EXISTS:
EXISTS(SELECT 1 FROM clinic_whatsapp_numbers WHERE active = true) AS has_whatsapp
// e no array items:
{ key: 'whatsapp', label: 'Conecte o WhatsApp',
  desc: 'Ative o atendimento por IA no WhatsApp da clínica.',
  href: '/equipe/whatsapp' /* Modelo B */ , done: r.has_whatsapp }
```
A checklist some sozinha quando todos os itens estão `done`. O painel é renderizado em
[dashboard/page.tsx](../src/app/(app)/(shell)/dashboard/page.tsx) (componente
`ActivationChecklist`). **Só descomente/adicione o item quando a página de destino existir**
(senão vira link quebrado — foi por isso que o item ficou de fora no increment 1).

---

## 7. Segurança (checklist obrigatório)
- Token **nunca** vai ao cliente nem a log; só cifrado (`encryptForTenant`) e em memória no
  envio. Coluna `token_encrypted` é **service_role-only**.
- Modelo B: a troca `code`→token é **server-side** (app_secret nunca no browser). Validar
  que o número autorizado pertence ao `code` daquele owner (anti-sequestro de número).
- Respeitar os **unique parciais** (`WHERE active=true`) — reconectar desativa o anterior.
- Escrita do número só por caminho privilegiado (super_admin hoje; no Modelo B, uma ação
  tenant que roda a escrita via seam/`dbAdmin`, com `requireClinicId`).
- Webhook continua validando HMAC (`META_APP_SECRET`) — não relaxar.
- Auditar (super_admin_actions OU audit_events conforme o ator).

---

## 8. Mapa de arquivos (onde mexer / onde NÃO mexer)

| Arquivo | Papel | Mexe? |
|---|---|---|
| `src/contexts/messaging/schema.ts` | tabela `clinic_whatsapp_numbers` | só se mudar colunas (não precisa) |
| `src/contexts/messaging/actions.ts` | connect/disconnect/rotate (super_admin) | reusa (A) ou espelha p/ tenant (B) |
| `src/contexts/messaging/types.ts` | `ConnectNumberSchema` | reusa/estende |
| `src/lib/messaging/number-store.ts` | seam privilegiado (3 funções) | **NÃO duplicar** |
| `src/lib/messaging/meta-cloud.ts` | chamadas Graph API (envio) | referência p/ as chamadas Graph do Modelo B |
| `src/lib/crypto` | `encryptForTenant` | reusa |
| `src/app/api/webhooks/meta/route.ts` | inbound | **não mexer** (já roteia por meta_phone_id) |
| `src/app/(admin)/admin/clinicas/[id]/` | detalhe da clínica | **Modelo A**: add bloco WhatsApp |
| `src/app/(app)/(shell)/dashboard/data.ts` | `getActivationChecklist` | add item whatsapp |
| `src/app/(app)/(shell)/equipe/` (ou nova rota) | **Modelo B**: página de conexão | criar |
| `src/lib/env.ts` | vars Meta | add `META_APP_ID`/`META_CONFIG_ID` (Modelo B) |

---

## 9. Decisões em aberto (responda antes de codar)
1. **Modelo A ou B?** (assistido vs self-service Embedded Signup). Recomendo A primeiro.
2. **Rota da página tenant** (`/equipe/whatsapp`? `/configuracoes/whatsapp`? nova entrada no menu?).
3. **App Review do Meta** está aprovado para `whatsapp_business_*`? (bloqueia o Modelo B).
4. **Quem é o dono do número** no Embedded Signup — a clínica cria a própria WABA, ou usam
   uma WABA-mãe da plataforma com números filhos? (muda o fluxo de tokens/permissões).
5. **Design** da tela (peça um, como foi feito no checkout — saiu ótimo) ou seguir o DS de
   painel (`.panel`/`.field`/`.btn`).

---

## 10. Estado atual (o que JÁ está pronto e funciona)
- Backend de mensageria C10 completo: tabela, conexão (super_admin), criptografia, webhook
  inbound (roteamento por número), envio via outbox, templates, resiliência.
- Checklist de ativação no dashboard (3 itens), pronta para receber o 4º (WhatsApp).
- Fase 1 do onboarding inteira (convite → wizard → checkout → saga trial → owner). Ver
  [ADR-027](adr/027-onboarding-magic-invite.md).
- **Falta só:** a UI de conexão (Modelo A ou B) + o 4º item da checklist apontando p/ ela.
