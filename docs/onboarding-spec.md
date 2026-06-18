# Spec — Onboarding & Criação de Conta

- Status: **backlog / demand-triggered** (não é camada numerada)
- Gatilho de build: white-glove virou gargalo (~20-30 clientes). Antes disso, modo interino (script).
- Depende de: C13 (planos + Asaas + trial). A jornada guiada **não existe sem C13**.
- Refs: ADR-024 (modelo de planos), ADR-016 (clinic lifecycle), VisãoGeral §5.1, C3 (roles/RBAC)

---

## 0. Princípio

O onboarding tem **dois modos**, e o interino é um stopgap consciente com uma falha
conhecida — não o destino:

| Modo | Quando | Quem cria a clínica | Pagamento |
|---|---|---|---|
| **Interino (script)** | primeiros clientes (white-glove) | você, via `scripts/create-clinic.ts` | link Asaas **manual, fora do sistema** |
| **Final (jornada guiada)** | quando white-glove vira gargalo | o próprio cliente, via convite | **Asaas integrado, dentro do fluxo** |

O modo final existe para matar as falhas do interino (§2). Construa o final quando
a dor do interino aparecer — não antes.

---

## 1. Modo interino — script (existe enquanto só você cria contas)

### 1.1 O que o script faz (e NÃO faz)
`scripts/create-clinic.ts` (a escrever — espelha `seed:super-admin`):

- **Cria**: row em `clinics` (`status='trial'`, slug validado), usuário dono no
  Supabase Auth + `profiles` (role `owner`), senha temporária + link de 1º acesso.
- **NÃO cria**: `subscriptions`/`invoices` (não existem até C13). Em trial, a clínica
  já opera sem assinatura registrada no banco.
- Idempotente (re-rodar com mesmo slug não duplica). Tudo numa transação.

### 1.2 Como rodar em prod
```bash
cross-env SUPABASE_PROJECT_ENV=prod DATABASE_URL="$DATABASE_URL_PROD" \
  pnpm tsx scripts/create-clinic.ts \
    --slug=drsilva --nome="Clínica Dr. Silva" \
    --owner-email=silva@... --owner-nome="Dr. Silva"
```
- `SUPABASE_PROJECT_ENV=prod` é opt-in **obrigatório** (sem ele o script recusa prod).
- Prod usa Session Pooler (porta 5432), mesmo guard do `db:migrate:prod`.
- Toda execução grava em `super_admin_actions` (criação de clínica é ação auditada).

### 1.3 Ordem operacional (white-glove)
1. Ligação → cliente topa.
2. Você envia link Asaas de **setup fee** (R$ 200-500) + cadastra cartão (trial 14d com cartão).
3. **Confere no painel Asaas que o pagamento confirmou** (passo manual de reconciliação).
4. Roda o script → clínica `trial` + dono criados.
5. Envia o link de 1º acesso ao dono.
6. Ligação de config (ai_clinic_config, médicos, procedimentos, WhatsApp).

---

## 2. ⚠️ Falha conhecida do interino (por que o modo final existe)

1. **Pagamento desacoplado da conta.** O link Asaas é externo; nada no banco liga
   "este pagamento" a "esta clínica". Reconciliação é você olhando o painel Asaas
   antes de rodar o script. Com ~5 clientes, tolerável; com 20+, erro humano garantido.
2. **Janela morta.** Entre pagar e você rodar o script, o cliente não tem o que fazer.
   Primeira impressão ruim.
3. **Fluxo não-previsível.** Depende de você lembrar a ordem manual a cada vez.

O modo final resolve os três: pagamento **dentro** do fluxo (Asaas integrado, amarrado
à clínica pelo `invite`), ativação automática na confirmação do webhook, e jornada
guiada que nunca deixa o cliente sem próximo passo.

---

## 3. Modo final — jornada guiada (build pós-C13, demand-triggered)

### 3.1 Tabela nova (única)
```
invites (
  id              uuid pk,
  kind            text  -- 'clinic_signup' | 'team_member'
  token_hash      text  -- HMAC do token; link carrega o token cru (nunca persistido)
  clinic_id       uuid null  -- null em clinic_signup até a clínica ser criada
  target_role     role_enum null  -- team_member: role pré-definida pelo dono
  email_hash      text null
  telefone        text null
  status          text  -- 'pending' | 'accepted' | 'expired' | 'revoked'
  step_state      jsonb -- progresso da jornada (retomável)
  expires_at      timestamptz
  created_by      uuid  -- super_admin (clinic_signup) ou owner/gestor (team_member)
  accepted_at     timestamptz null
)
```
- **Uma tabela serve aos dois momentos** (convite inicial da clínica + "Monte sua
  equipe"). Não criar duas.
- RLS: `clinic_signup` é global protected (só super_admin lê/cria); `team_member` é
  tenant-scoped por `clinic_id`. Token sempre hasheado (padrão do `email_hash` do C3).
- Single-use, expira (default 7d), revogável.

### 3.2 Máquina de estados da jornada (clinic_signup)
```
[admin cria invite] → link enviado
   │
   ▼
1. dados da clínica (nome, telefone, WhatsApp, endereço, CNPJ/CNES)
   ▼
2. dados do dono (vira usuário owner)        ──► cria auth user; cliente já LOGADO
   ▼
3. perguntas rápidas (nº profissionais, especialidade) ──► grava em ai_clinic_config
   ▼
4. escolha de plano (recomendado em destaque)
   ▼
5. pagamento Asaas IN-APP (cartão, trial 14d)  ──► clinic.status='trial'
   ▼
6. ATIVA + redireciona ao app (sem novo login)
   ▼
7. "Monte sua equipe" (convites team_member, puláveis)
   ▼
8. checklist de ativação
```
Cada passo persiste em `step_state` → fechar a aba **retoma de onde parou**.

### 3.3 Pagamento e ativação (corrige a falha §2)
- Asaas é chamado **dentro do passo 5**, com o `invite.id` / `clinic.id` como
  external reference → pagamento amarrado à clínica.
- Trial 14d **com cartão** ⇒ a clínica entra em `trial` e o cliente **entra na hora**
  (não espera webhook). O webhook `PAYMENT_RECEIVED` (1ª cobrança no fim do trial)
  só confirma; não bloqueia a entrada. **Não inventar `pending_payment`** — usar o
  `trial` que já existe (ADR-016).
- Idempotência: criação de clínica/usuário e processamento de webhook usam a infra C4
  (idempotency key = `invite.id` / `asaas_payment_id`).

### 3.4 "Monte sua equipe" (team_member)
- Dono gera convites individuais → link por WhatsApp/e-mail.
- Colaborador abre → cria senha → entra. Clínica **já configurada**, sem reedição de
  dados da empresa.
- **Puláveis**: se a clínica está fechada no dia, dono envia depois (acessível em
  Configurações > Equipe; é a tela [equipe/page.tsx] que hoje é só-leitura).
- **Nível de acesso = perfis prontos mapeados às roles que já existem** (zero RBAC novo):

  | Perfil na UI | Role (C3) |
  |---|---|
  | Administrador | `gestor` |
  | Profissional | `doctor` |
  | Recepcionista | `attendant` |
  | Financeiro | `financial` |
  | Dono | `owner` |

  Ajuste fino posterior via `user_permission_overrides` (já existe).

### 3.5 Checklist de ativação (zero tabela)
- **Derivado de presença de dado**: tem médico? tem `doctor_availability`? tem
  paciente importado? tem 1ª automação? Cada item resolve com uma query.
- Persistir só "dispensei este item" — `onboarding_dismissed jsonb` em `clinics` se
  necessário. **Não criar tabela de checklist.**

---

## 4. Requisitos de teste (anti-hidra — obrigatório por passo)

- **Token**: single-use (2º uso falha), expira, revogado não aceita, hash nunca
  reversível.
- **Retomada**: fechar no passo N retoma no passo N (step_state).
- **Pagamento**: trial entra sem webhook; webhook duplicado é idempotente; pagamento
  amarrado ao `clinic_id` correto.
- **RLS**: convite team_member da clínica A invisível para B; clinic_signup só
  super_admin.
- **Roles**: cada perfil de UI cria a role correta; downgrade de acesso exige novo
  login (claims_version — ADR-009).
- **Idempotência**: criar clínica 2x com mesmo invite não duplica.

---

## 5. Resumo de decisões congeladas
1. Dois modos; interino (script) é stopgap com falha documentada (§2).
2. Uma tabela `invites` para os dois fluxos.
3. Jornada retomável via `step_state`.
4. Pagamento Asaas **in-app**, amarrado à clínica; trial entra sem esperar webhook.
5. Perfis de acesso = roles existentes; zero RBAC novo.
6. Checklist derivado de dados; sem tabela.
7. Build do modo final é **demand-triggered** (não pós-C16 fixo), depende de C13.
