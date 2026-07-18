# Variáveis de Ambiente

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2026-10-01
>
> ↩︎ Volta para o [índice mestre](../README.md) · complementa o [setup](./setup.md).

**Fonte da verdade:** [`src/lib/env.ts`](../../src/lib/env.ts) — todas as variáveis são declaradas e validadas ali (Zod, no boot). Template preenchível: [`.env.example`](../../.env.example). Este doc explica **o racional** e **quando** cada variável é exigida.

---

## Princípios

1. **Nunca `process.env.X` espalhado.** Sempre importe de `src/lib/env.ts`. O ESLint/convenção guarda contra isso ([CONVENTIONS.md](../CONVENTIONS.md)).
2. **Validação no boot, exigência em runtime.** O `env.ts` valida o *shape* no carregamento (build/dev falham cedo). Segredos de feature (Gemini, Asaas, Meta, crypto) são exigidos só quando a feature roda, via guards `assert*RuntimeReady()` — assim o `next build` fica verde antes dos segredos existirem.
3. **String vazia = não setado.** `FOO=` vira `undefined` (`emptyToUndefined`), então `.optional()` significa mesmo "ausente".
4. **Cada variável carrega a camada (Cn) onde passou a ser exigida.**

---

## Grupos (por camada)

| Grupo | Variáveis | Exigência |
|---|---|---|
| **Database (C1)** | `DATABASE_URL`, `DATABASE_URL_PROD` | `DATABASE_URL` no boot; `_PROD` só em scripts prod |
| **Supabase** | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (ou `_ANON_KEY` legado), `SUPABASE_SECRET_KEY` (ou `_SERVICE_ROLE_KEY` legado) | URL + 1 publishable no boot; secret a partir de C3 |
| **Runtime** | `NODE_ENV`, `LOG_LEVEL`, `VERCEL_ENV` | Têm default; `VERCEL_ENV` é auto-injetado pela Vercel |
| **Operacional** | `SUPABASE_PROJECT_ENV` | Opt-in explícito p/ scripts prod |
| **C3 — Auth** | `LOGIN_HASH_PEPPER` (≥32), `UPSTASH_REDIS_REST_URL/TOKEN`, `SUPER_ADMIN_EMAIL/PASSWORD` | runtime (login) / setup (seed) |
| **C4 — Outbox** | `CRON_SECRET` (≥32), `OUTBOX_*` | runtime (cron) / tuning |
| **C5 — Crypto** | `CRYPTO_SECRET_BACKEND`, `CRYPTO_MASTER_KEY_V1/V2`, `MASTER_KEY_VERSION`, `CRYPTO_LOOKUP_SALT`, `GCP_*` | runtime (patient) |
| **C10 — WhatsApp** | `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_GRAPH_API_VERSION`, `META_HTTP_TIMEOUT_MS`, `META_APP_ID`, `META_CONFIG_ID` | runtime (webhook/connect) |
| **C11 — AI** | `GEMINI_API_KEY`, `GEMINI_MODEL`, `AI_HTTP_TIMEOUT_MS`, `AI_MONTHLY_COST_LIMIT_USD`, `AI_SNAPSHOT_MODE` | runtime (agent) |
| **C13 — Billing** | `ASAAS_API_KEY`, `ASAAS_BASE_URL`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_HTTP_TIMEOUT_MS` | runtime (billing/webhook) |
| **C14 — Proactive** | `META_TEMPLATE_*_ID`, `META_TEMPLATE_LANG` | por job (template ausente = job falha retentável) |
| **C15 — Admin/Onboarding** | `IMPERSONATION_SECRET` (≥32), `MAGIC_TOKEN_SECRET` (≥32) | runtime (impersonate / /join) |
| **C16 — Sentry** | `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | DSN publishable; token build-time |

---

## Dev vs Produção

- **Dev:** segredos vivem no `.env.local` (gitignored). `CRYPTO_SECRET_BACKEND=env`. `DATABASE_URL_PROD`, `GCP_*`, `SUPABASE_PROJECT_ENV` ficam **vazios**.
- **Upstash (rate-limit) — DBs distintas por ambiente (auditoria Redis R3):** dev, preview e prod **devem** apontar para Upstash DBs **separadas** (esta é a defesa primária contra contadores de rate-limit colidindo entre ambientes). Como cinto-e-suspensório, as chaves Redis já carregam um discriminador de ambiente (`VERCEL_ENV ?? NODE_ENV`, montado por `redisKey.*` em [rate-limit.ts](../../src/lib/auth/rate-limit.ts)): `VERCEL_ENV` separa Preview de Production (o `NODE_ENV` não separa — ambos são `production` na Vercel). Ao apontar dois ambientes para a mesma DB por engano, o prefixo evita colisão silenciosa; ainda assim, mantenha as DBs separadas.
- **Produção (real, verificado em 2026-07-18):** as chaves de crypto vivem nas **env vars da Vercel**, com **`CRYPTO_SECRET_BACKEND=env`** setado explicitamente em Production — `CRYPTO_MASTER_KEY_V1` e `CRYPTO_LOOKUP_SALT` lá. **Google Secret Manager NÃO é usado.** `SENTRY_AUTH_TOKEN` em `.env.sentry-build-plugin`; scripts prod exigem `SUPABASE_PROJECT_ENV=prod` explícito.

  > ⚠️ **Por que o `CRYPTO_SECRET_BACKEND=env` é obrigatório e não opcional:** o
  > seletor é `env.CRYPTO_SECRET_BACKEND ?? (NODE_ENV === 'production' ? 'gcp' : 'env')`
  > ([env.ts:345](../../src/lib/env.ts#L345)). Na Vercel `NODE_ENV=production`, então
  > **sem essa variável o default vira `gcp`** e o app ignora a chave da Vercel,
  > estourando no primeiro cadastro que cifra (paciente/prontuário). Esta doc
  > afirmava "Produção usa Google Secret Manager" até 2026-07-18 — era ponteiro
  > para infra que nunca existiu (mesma classe do "validation only in C13").
  >
  > 🔑 **BACKUP DA CHAVE:** a env var da Vercel é hoje a **única cópia** do
  > `CRYPTO_MASTER_KEY_V1`. Desde o ADR-044 ela protege o **prontuário**, não só o
  > CPF — perder essa chave é perder o registro médico de forma irreversível
  > (nenhum backup do Postgres recupera, o dado está cifrado). Guarde o valor fora
  > da Vercel (cofre de senhas), e trate rotação como operação planejada
  > (`CRYPTO_MASTER_KEY_V2` + `MASTER_KEY_VERSION=2`; o byte de versão no envelope
  > mantém o dado antigo legível).
- **CI:** injeta valores fake para satisfazer o Zod no `build`/`check:registry` sem conectar a serviços (ver `.github/workflows/ci.yml`).

## Segredos — onde vivem e rotação

Inventário, ordem e impacto de rotação: [runbooks/secret-rotation.md](../runbooks/secret-rotation.md). Regra de ouro: **nenhuma chave real no git** — nem em `.env.example`, nem em ADRs, nem em runbooks.

---

## Veja também

- [`.env.example`](../../.env.example) — template preenchível.
- [`src/lib/env.ts`](../../src/lib/env.ts) — a fonte da verdade (Zod).
- [setup.md](./setup.md) — passo a passo de instalação.
- [runbooks/secret-rotation.md](../runbooks/secret-rotation.md) — rotação de segredos.
