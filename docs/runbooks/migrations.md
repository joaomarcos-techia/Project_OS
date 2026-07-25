# Runbook — Migrations (Drizzle + Supabase Postgres)

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice de runbooks](./README.md) · [índice mestre](../README.md).


> Solo operator runbook. Imperativo, comando-primeiro. Se você está cansado às
> 3h da manhã: leia em ordem, copie os comandos. Não improvise.

## Quando rodar

- **Dev**: sempre que mudar schema (adicionar tabela/coluna/índice) em qualquer
  arquivo dentro de `src/lib/db/schema/` ou `src/contexts/*/schema.ts` (C2+).
- **Prod**: sempre **ANTES** de fazer deploy de código que assume o novo schema.
  Nunca automatize prod em CI. Janela manual, atenção dedicada.

## Como criar uma nova migration

```bash
# 1. Edite os arquivos de schema (Drizzle .ts).
# 2. Gere o SQL diff (drizzle-kit lê o schema, não conecta no DB):
pnpm db:generate --name <feature_snake_case>

# 3. Inspecione o SQL gerado em drizzle/migrations/NNNN_*.sql.
#    Se algo parecer errado (ex: drop de coluna), abra o arquivo e leia antes
#    de aplicar. Você pode editar o SQL gerado ANTES da primeira aplicação.

# 4. Aplique no dev:
pnpm db:migrate:dev

# 5. Commite os artefatos:
git add drizzle/migrations/NNNN_*.sql drizzle/migrations/meta/
git commit -m "feat(db): add <descrição>"
```

**Naming**: filename deve casar `^\d{4}_[a-z][a-z0-9_]*\.sql$`. `pnpm arch:db-check`
rejeita lixo (`fix.sql`, `tmp.sql`, etc.).

**Imutabilidade**: depois que uma migration foi aplicada em qualquer ambiente
(inclusive seu dev), **NUNCA** edite o SQL. Erro = nova migration corretiva.

## Rodar em dev

```bash
pnpm db:migrate:dev
```

Espera-se output:
```
[migrate:dev] target: postgres://...@aws-1-...pooler.supabase.com:6543/postgres
Reading config file ...
[i] No config path provided, using default 'drizzle.config.ts'
... applied migration: 0000_schema_version
[migrate:dev] done.
```

Verificar:
```bash
psql "$DATABASE_URL" -c "SELECT version, applied_at FROM _schema_version ORDER BY applied_at DESC LIMIT 5"
```

## Rodar em produção (checklist obrigatório)

**Pré-condições antes de começar**:
- [ ] `qoro-prod` Supabase project existe (C16 / quando primeiro cliente entrar)
- [ ] `pg_dump` instalado localmente (`pg_dump --version` funciona)
- [ ] Estou em `main`, branch limpa, em sync com origin

# 1. Sync local.
git checkout main
git pull origin main
pnpm install --frozen-lockfile

# 2. Definir contexto de produção APENAS para esta sessão do PowerShell.
# NUNCA salvar em .env.local em máquinas usadas para desenvolvimento.
$env:SUPABASE_PROJECT_ENV = "prod"
$env:DATABASE_URL_PROD = "postgres://...@<prod-host>...?sslmode=require"

# 3. Smoke test / backup manual antes da migration.
pnpm db:backup:prod

# Esperado:
# backups/manual-<timestamp>.sql
# O arquivo deve existir e ter tamanho > 0.

# 4. APLICAR MIGRATIONS — operação real.
pnpm db:migrate:prod

# O script deve:
# - abortar se MIGRATION_FAILED.md existir;
# - executar pg_dump pré-migration;
# - salvar em:
#   backups/prod-pre-migration-<timestamp>.sql
# - adquirir pg_advisory_lock(4242);
# - aplicar as migrations via drizzle-kit;
# - liberar o advisory lock mesmo em caso de erro;
# - registrar a execução em:
#   backups/migrations.log

# 5. Verificar migrations aplicadas.
psql $env:DATABASE_URL_PROD -c "SELECT version, applied_at FROM _schema_version ORDER BY applied_at DESC LIMIT 5"

# 6. Limpar o contexto da sessão.
Remove-Item Env:SUPABASE_PROJECT_ENV -ErrorAction SilentlyContinue
Remove-Item Env:DATABASE_URL_PROD -ErrorAction SilentlyContinue
## Como reverter (rollback)

Cenário: migration aplicou mas quebrou produção. Dump pre-migration existe.

**Estratégia atual (C1)**: drop nossas tabelas + restore do dump. O dump contém
apenas nossos schemas (`public` + `drizzle`) — schemas Supabase-managed (`auth`,
`storage`, `realtime`, etc.) são excluídos via `--exclude-schema` no pg_dump.

⚠️ **Caveat 1 — Supabase-managed event triggers**: Restoring a Supabase dump
against an existing Supabase project produces ~12 errors of the form
`must be owner of event trigger pgrst_*` / `Non-superuser owned event trigger
must execute a non-superuser owned function`. These are about Supabase-owned
global event triggers (`pgrst_ddl_watch`, `pgrst_drop_watch`, `ensure_rls`,
`issue_pg_graphql_access`, etc.) that our connection role cannot
re-create — Supabase auto-manages them on the target side. **These errors
are expected and harmless** for our app-data restore. Run `psql` WITHOUT
`\set ON_ERROR_STOP on` so it continues past them. Validated empirically in
C1 audit 1.6.5 restore test (12 errors observed, application tables 100%
restored).

⚠️ **Caveat 2 — extensions**: `DROP SCHEMA public CASCADE` destrói
`CREATE EXTENSION ...` instaladas em `public` (ex: `pgcrypto`, `vector`).
Antes do nuke, liste:

```bash
psql "$URL_5432" -c "SELECT extname FROM pg_extension WHERE extnamespace = 'public'::regnamespace"
```

E recrie-as **antes** de aplicar o dump.

### Procedimento

```bash
# 0. Use Session Pooler (porta 5432), NÃO Transaction Pooler (6543).
#    psql/pg_dump precisam de sticky session.
URL_5432="${DATABASE_URL_PROD/:6543\//:5432\/}"

# 1. Lista extensions ativas (anote para reaplicar):
psql "$URL_5432" -c "SELECT extname FROM pg_extension WHERE extnamespace = 'public'::regnamespace"

# 2. Drop NOSSAS tabelas (não DROP SCHEMA — quebra Supabase event triggers):
psql "$URL_5432" <<'SQL'
DROP TABLE IF EXISTS public._schema_version CASCADE;
DROP SCHEMA IF EXISTS drizzle CASCADE;
-- Adicione DROPs para tabelas de C2+ quando existirem
SQL

# 3. Restore do dump. NÃO use ON_ERROR_STOP — o DROP FUNCTION rls_auto_enable
#    vai falhar (esperado, Caveat 1) mas o resto restaura limpo:
psql "$URL_5432" -f backups/prod-pre-migration-<timestamp>.sql

# 4. Verifique nossas tabelas:
psql "$URL_5432" -c "\dt public.*"
psql "$URL_5432" -c "\dt drizzle.*"
psql "$URL_5432" -c "SELECT count(*) FROM drizzle.__drizzle_migrations"
```

⚠️ **Caveat 3 — quando tiver clientes**: dados criados ENTRE o dump e o
incidente são perdidos. Por isso a janela de migration é curta + não acumule
mudanças.

**Quando primeiro cliente entrar**, esta seção precisa ser reescrita pra estratégia
de "restore em DB temporário + diff manual + reaplicar inserts críticos". TODO em C13.

## Quando MIGRATION_FAILED.md aparecer

O script `db-migrate-prod.ts` cria este arquivo na raiz se uma migration falha.
Ele **bloqueia** novas tentativas até remoção manual.

Passos:
1. **NÃO DELETE O ARQUIVO ANTES DE INVESTIGAR.** Ele tem o postmortem.
2. Abra `MIGRATION_FAILED.md` — preencha os campos:
   - Root cause
   - Rollback executado?
   - Ação tomada
3. Investigue a falha real: leia o stderr capturado.
4. Se rollback necessário, siga seção "Como reverter".
5. Crie nova migration corretiva (NÃO edite a que falhou).
6. Aplique em dev primeiro — `pnpm db:migrate:dev`.
7. Só DEPOIS, delete `MIGRATION_FAILED.md` e re-rode `pnpm db:migrate:prod`.

## Troubleshooting

| Sintoma | Causa provável | Ação |
|---|---|---|
| `[guard] SUPABASE_PROJECT_ENV must be set to "prod"` | Esqueceu o export | `export SUPABASE_PROJECT_ENV=prod` |
| `[guard] DATABASE_URL must contain "sslmode=require"` | URL sem o param | Adicione `?sslmode=require` ao final |
| `pg_dump: connection failed: SSL required` | URL sem param E driver não força SSL | Adicione param OU use psql com `-o sslmode=require` |
| `MIGRATION_FAILED.md exists` | Falha anterior não resolvida | Leia seção "Quando MIGRATION_FAILED.md aparecer" |
| `[migrate:prod] backup file is 0 bytes` | pg_dump falhou silencioso | Cheque conectividade + permissões. Veja stderr do pg_dump |
| `prepared statement ... does not exist` | Tentando usar Transaction Pooler com `prepare: true` | Confirme `prepare: false` em src/lib/db/index.ts |
| Studio recusa abrir | NODE_ENV=production OU URL prod-like | Mude pra dev; nunca abra Studio em prod |
| Connection count cresce em dev | HMR criando pools | Confirme `globalThis` cache em src/lib/db/index.ts |
| Migrations concorrentes não serializam | URL aponta para Transaction Pooler (6543) | Ver "Pooler ports" abaixo — scripts já swappam automaticamente |

## Pooler ports — quando usar 6543 vs 5432

Supabase expõe três modos de conexão para o mesmo projeto:

| Modo | Porta | Backend sticky? | Quem usa |
|---|---|---|---|
| Transaction Pooler | 6543 | NÃO (libera por transação) | App runtime (`src/lib/db/index.ts`, Next serverless) |
| Session Pooler | 5432 | SIM (sticky por sessão) | **Migrations + backups** (scripts `db:*:prod`) |
| Direct | 5432 (sem `pooler.` no host) | SIM | Tools que precisam superuser (raro) |

**Por quê**: `pg_advisory_lock(N)` é session-scoped. Em Transaction Pooler o backend
muda entre lock e unlock — quebra a serialização. Empiricamente validado em C1
(teste 1.6.11): dois processos rodando contra 6543 obtiveram o lock simultaneamente.
Rodando contra 5432, serializaram corretamente.

**Configuração**: você pode setar `DATABASE_URL_PROD` apontando para qualquer um
dos dois — os scripts `db:migrate:prod` e `db:backup:prod` automaticamente fazem
swap `:6543/` → `:5432/` antes de conectar. App runtime mantém 6543 (Vercel/Next
precisa).

## Configuração de sistemas externos, segredos, seeds e API keys (referência completa)

> Fonte da verdade dos env vars: [src/lib/env.ts](../../src/lib/env.ts). Esta seção é o
> "como obter e configurar CADA coisa". Checklist operacional de go-live:
> [production-readiness.md](./production-readiness.md). **Regra de ouro:** segredos de PROD ≠ DEV;
> gere novos para prod, nunca promova de `qoro-dev`.

### Inventário de todos os sistemas externos

| Sistema | Papel | Camada | Obrigatório no go-live? |
|---|---|---|---|
| **Supabase** | Postgres (dados+RLS) · Auth (login/JWT/MFA) · Storage (PDFs LGPD) | C1/C3/C5 | **Sim** |
| **Vercel** | Hospedagem Next.js + Cron (outbox, hard-delete, audit-partitions) | C0/C4 | **Sim** |
| **Upstash Redis** | Rate-limit de login (sliding window IP+email) | C3 | **Sim** (login depende) |
| **Google Secret Manager** | Master key de cripto + lookup salt em prod (alternativa ao Vercel env) | C5 | Opcional |
| **Monitor de uptime** (UptimeRobot/BetterStack/Cronitor) | Alerta nos health endpoints | C16 | **Sim** (barato/grátis) |
| **Meta WhatsApp Cloud API** | Webhook + envio de mensagens WhatsApp | **C10** | Quando ligar o WhatsApp |
| **Google Gemini API** | LLM do agente (Gemini Flash; OpenAI é placeholder) | C11+ | Futuro (não wired ainda) |
| **Provider de e-mail** (Resend/SES) | E-mail do export LGPD (hoje stub) | Futuro | Não |

### 1. Supabase (DB + Auth + Storage) — C1/C3/C5

1. Criar projeto (dev: `qoro-dev`; prod: região `sa-east-1`/São Paulo). Plano prod = **Pro** (daily backups).
2. **Connection strings** (Settings → Database): runtime usa **Transaction Pooler :6543**; migrations/backups usam **Session Pooler :5432** (os scripts `db:*:prod` fazem swap automático). Sempre com `?sslmode=require`.
3. **Keys** (Settings → API): `URL`, `publishable`/`anon`, `secret`/`service_role`.
4. **Auth Hook (MANUAL):** Authentication → Hooks → Custom Access Token → função `custom_access_token_hook` (criada pelas migrations 0003/0004/0006). Sem isso o login não injeta claims. Setar Access Token TTL = **900s**.
5. **MFA:** Authentication → habilitar TOTP (super_admin exige AAL2).
6. **Storage:** bucket `lgpd-exports` via `pnpm seed:lgpd-bucket`.
- Env: `DATABASE_URL`, `DATABASE_URL_PROD` (só shell prod), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (ou `_ANON_KEY`), `SUPABASE_SECRET_KEY` (ou `SUPABASE_SERVICE_ROLE_KEY`).

### 2. Vercel (hospedagem + cron) — C0/C4

1. Importar o repo; framework Next.js (já em [vercel.json](../../vercel.json)).
2. **Env vars** (Settings → Environment Variables): todas as deste documento, ambiente Production + Preview.
3. **Crons** ([vercel.json](../../vercel.json)): `patient-hard-delete`, `audit-partitions`, `cash-flow-rollup`, `financial-reconcile`. O **outbox** (`*/1`) NÃO cabe no Hobby (cron 1x/dia) → usar agendador externo (cron-job.org / Upstash QStash) apontando `GET /api/cron/outbox` com `Authorization: Bearer <CRON_SECRET>`. Detalhe em [production-readiness.md §4.1](./production-readiness.md).
- Env: `CRON_SECRET` (≥32 chars, `openssl rand -base64 32`), `NODE_ENV=production`. Tuning opcional: `OUTBOX_BATCH_SIZE`, `OUTBOX_PARALLELISM`, `OUTBOX_MAX_PAYLOAD_BYTES`, `OUTBOX_IDEMPOTENCY_LOCK_TIMEOUT_MS`, `LOG_LEVEL`. O pool do outbox é fixado em 2 no código porque uma conexão sustenta o lock e a outra executa o trabalho.

### 3. Upstash Redis (rate-limit) — C3

1. Criar database Upstash (Global ou região perto). Copiar **REST URL** + **REST Token**.
- Env: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `LOGIN_HASH_PEPPER` (≥32 chars — pepper do hash de e-mail no rate-limit).

### 4. Cripto: env OU Google Secret Manager — C5

Escolha **um** backend (`CRYPTO_SECRET_BACKEND`, default `gcp` em prod / `env` fora):
- **`env` (simples, recomendado no lançamento):** `CRYPTO_MASTER_KEY_V1` (32 bytes b64: `openssl rand -base64 32`) + `CRYPTO_LOOKUP_SALT` (**≥ 16 bytes** b64: `openssl rand -base64 24`) nas env vars da Vercel.
- **`gcp` (robusto):** `GCP_PROJECT_ID` + `GCP_SECRET_MASTER_KEY_NAME` + `GCP_SECRET_LOOKUP_SALT_NAME`; os secrets vivem no Secret Manager e `CRYPTO_MASTER_KEY_*`/`CRYPTO_LOOKUP_SALT` ficam UNSET.
- `MASTER_KEY_VERSION` (default 1) controla a versão usada em writes novos.
> ⚠️ **`CRYPTO_LOOKUP_SALT` < 16 bytes quebra `hashForLookup`** (afeta Patient/Messaging). **`CRYPTO_LOOKUP_SALT` e `CRYPTO_MASTER_KEY_V1` são imutáveis na prática** — trocar invalida lookups/cifrados. Rotação só via V2 aditivo.

### 5. Meta WhatsApp Cloud API — C10

1. Criar app em developers.facebook.com → produto **WhatsApp**. Pegar `phone_number_id` + `WhatsApp Business Account ID` + **token** (permanente/system-user) + **App Secret** (Settings → Basic).
2. **Configuration → Webhook:** Callback URL = `https://<app>/api/webhooks/meta`, Verify Token = `META_WEBHOOK_VERIFY_TOKEN`. **Subscrever ao campo `messages`.** O GET de verificação ecoa o `hub.challenge`.
3. **Conectar o número à clínica:** dev → `pnpm wa:connect --clinic <uuid> --phone <e164> --meta-phone-id <id> --token <token>`; prod → Server Action `connectWhatsappNumber` (super_admin). O token per-clínica fica **cifrado** em `clinic_whatsapp_numbers.token_encrypted` (não em env).
- Env: `META_APP_SECRET` (valida a assinatura HMAC dos webhooks — app-level), `META_WEBHOOK_VERIFY_TOKEN`, `META_GRAPH_API_VERSION` (default `v21.0`), `META_HTTP_TIMEOUT_MS` (default 10000).

### 6. Google Gemini (LLM do agente) — C11+ (ainda não wired)

Planejado (PlanoAção §C11): `GeminiProvider` default (Gemini Flash), `OpenAIProvider` placeholder. **Nenhum env var de IA existe em `env.ts` ainda** — entram em C11. Quando chegar: `GEMINI_API_KEY` (Google AI Studio / Vertex) + budget/cost-tracking. Documentar aqui quando a camada materializar.

### 7. Monitor de uptime — C16

Monitorar (HTTP, intervalo 5 min, **Custom Header** `Authorization: Bearer <CRON_SECRET>`):
`/api/health/outbox?strict=1` (503 quando degradado) e `/api/health/auth-hook`. Abrir no browser dá 401 (sem Bearer) — é esperado. Ver [production-readiness.md §5](./production-readiness.md).

### 8. Bootstrap / seeds

| Comando | O quê | Env necessária |
|---|---|---|
| `pnpm seed:super-admin` | Cria o super_admin (idempotente; `--reset-mfa` p/ recovery) | `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` (≥12) |
| `pnpm seed:clinic-user` | Cria uma clínica + usuário de teste | — |
| `pnpm seed:lgpd-bucket` | Cria o bucket privado `lgpd-exports` | Supabase keys |
| `pnpm wa:connect …` | (C10) conecta um número WhatsApp a uma clínica (dev) | crypto + DB |

> Não existe um "reseed destrutivo" (wipe clinics/users) pronto. Para zerar dev: apague via Supabase
> SQL Editor (`DELETE FROM clinics CASCADE` + remover users em `auth.users`) e re-rode os seeds acima.

### Resumo: todas as env vars por camada

- **C1:** `DATABASE_URL`, `DATABASE_URL_PROD`, `NEXT_PUBLIC_SUPABASE_URL`, `*_PUBLISHABLE_KEY`/`*_ANON_KEY`.
- **C3:** `SUPABASE_SECRET_KEY`/`SERVICE_ROLE_KEY`, `LOGIN_HASH_PEPPER`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`.
- **C4:** `CRON_SECRET`, `OUTBOX_*`.
- **C5:** `CRYPTO_SECRET_BACKEND`, `CRYPTO_MASTER_KEY_V1`(/`_V2`), `CRYPTO_LOOKUP_SALT`, `MASTER_KEY_VERSION`, `GCP_*`.
- **C10:** `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_GRAPH_API_VERSION`, `META_HTTP_TIMEOUT_MS`.
- **C11+ (futuro):** `GEMINI_API_KEY` (+ OpenAI placeholder) — ainda não em `env.ts`.
- **Runtime/op:** `NODE_ENV`, `LOG_LEVEL`, `SUPABASE_PROJECT_ENV` (só shell prod).

## Quarterly disaster-recovery drill

Uma vez por trimestre (calendário): valide que backup é restaurável.

1. Crie um novo Supabase project temporário (`qoro-dr-test`).
2. `pnpm db:backup:prod` → último dump.
3. `psql "$DR_TEST_URL" < backups/manual-<ts>.sql` → restaura.
4. Compare schema (`\dt`, `\d <table>`) e contagens de rows com prod.
5. Documente resultado em `docs/runbooks/dr-drills.md` (criar quando tiver primeiro cliente).
6. Delete o project temporário.
