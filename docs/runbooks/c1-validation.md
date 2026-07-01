# C1 — Runbook de Validação

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice de runbooks](./README.md) · [índice mestre](../README.md).


> Mantido como runbook re-executável — rode após qualquer mudança em
> `src/lib/db/**`, `scripts/db-*.ts`, `drizzle.config.ts`, `eslint.config.mjs`,
> ou `package.json` (deps db).

## Pré-requisitos

- [x] C0 fechada (`docs/PROGRESS.md` mostra ✅)
- [x] `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` em `.env.local`
- [x] `DATABASE_URL` contém `?sslmode=require`
- [x] `pg_dump` instalado (`pg_dump --version` retorna versão)

## 1.1 — Supabase setup

- [x] `qoro-dev` Supabase project acessível via `psql "$DATABASE_URL" -c "SELECT 1"`
- [ ] `qoro-prod` Supabase project — **não obrigatório em C1**, pré-req de C16
- [x] `.env.example` atualizada refletindo o contrato C1

## 1.2 — Drizzle setup

- [x] `package.json` tem pins exatos: `drizzle-orm@0.36.4`, `drizzle-kit@0.28.1`, `postgres@3.4.5`, `tsx@4.19.2`, `dotenv@16.4.5`, `cross-env@7.0.3`
- [x] `drizzle.config.ts` na raiz aponta `schema: './src/lib/db/schema/*'`, `out: './drizzle/migrations'`, `ssl: 'require'`
- [x] `src/lib/db/schema/_meta.ts` contém apenas `_schema_version`
- [x] `src/lib/db/schema/index.ts` re-exporta `_meta`
- [x] `src/lib/db/types.ts` define `uuidPk`, `tenantId`, `timestampsPattern`, `deletedAt`
- [x] `pnpm db:generate` gera `drizzle/migrations/0000_schema_version.sql` válido
- [x] SQL gerado contém apenas `CREATE TABLE "_schema_version"`

## 1.3 — Connection layer

- [x] `src/lib/db/index.ts` exporta `db` e `dbAdmin` como pools FISICAMENTE distintos
- [x] Pool sizes: runtime=5, admin=1
- [x] Timeouts: idle 20s, connect 10s, max_lifetime 30min
- [x] `globalThis` singleton ativo em NODE_ENV != production
- [x] Boot-time guard: NODE_ENV=dev + prod-like URL → throws antes do pool
- [x] `src/lib/db/tenant.ts` exporta `withTenant(clinicId, fn)` usando `set_config('app.current_clinic', $1, true)`
- [x] `eslint.config.mjs` tem `no-restricted-imports` bloqueando `postgres` fora de `src/lib/db/index.ts` + `scripts/db-migrate-prod.ts`
- [x] `eslint.config.mjs` tem `no-restricted-imports` bloqueando `dbAdmin` em `src/contexts/**`, `src/app/(app)/**`, `src/components/**`

## 1.4 — Migration system

- [x] `scripts/_env.ts` carrega `.env.local` via dotenv + helpers `assertProdContext`, `assertDevContext`, `redact`
- [x] `scripts/db-migrate-dev.ts` rejeita prod URL e exige sslmode
- [x] `scripts/db-migrate-prod.ts` exige `SUPABASE_PROJECT_ENV=prod`, dump pre-migration, advisory lock 4242, MIGRATION_FAILED.md sentinel
- [x] `scripts/db-backup-prod.ts` espelha guards de prod
- [x] `scripts/db-studio.ts` rejeita prod
- [x] `scripts/arch-db-check.ts` valida 4 padrões + migration filename
- [x] `package.json` expõe `db:generate`, `db:migrate:dev`, `db:migrate:prod`, `db:backup:prod`, `db:studio`, `arch:db-check`

## 1.5 — Backup + rollback

- [x] `backups/` em `.gitignore`
- [x] `MIGRATION_FAILED.md` em `.gitignore`
- [x] `drizzle/migrations/meta/` versionado (necessário pro diff drizzle-kit)
- [x] Runbook documenta extension caveat no rollback

## 1.6 — Safety guards (12 testes)

| # | Teste | Status |
|---|---|---|
| 1.6.1 | Migration ida e volta dev | [x] |
| 1.6.2 | Conexão app→db | [x] |
| 1.6.3 | db vs dbAdmin separados | [x] |
| 1.6.4 | withTenant runtime — `set_config('app.current_clinic', $1, true)` persiste in-tx, evapora out-tx | [x] (audit pós-C1) |
| 1.6.5 | Migration prod simulada (dump+log+advisory) | [x] |
| 1.6.6 | Env separadas (negative test) | [x] |
| 1.6.7 | Studio prod block | [x] |
| 1.6.8 | Boot-time prod check | [x] |
| 1.6.9 | ESLint postgres-driver lockdown | [x] |
| 1.6.10a | arch:db-check positivo | [x] |
| 1.6.10b | arch:db-check negativo (fix.sql) | [x] |
| 1.6.11 | pg_advisory_lock concorrência (Session Pooler 5432) | [x] |
| 1.6.12 | HMR singleton (connection count estável) | [x] |

## 1.6 — Hardening pós-auditoria (5 novas validações)

Cobrem gaps identificados na auditoria do plano e bloqueavam fechamento real.

| # | Teste | Status | Evidência operacional |
|---|---|---|---|
| H1 | `dbAdmin` ESLint guard cobre `src/app/api/**` (exceto `api/admin/**`) | [x] | `src/app/api/patients/route.ts` com `import { dbAdmin }` → lint FAIL com mensagem "RLS bypass"; `src/app/api/admin/stats/route.ts` mesmo import → lint PASS |
| H2 | `withTenant` runtime real | [x] | Script temp executou `withTenant('00000000-0000-0000-0000-000000000000', tx => tx.execute("SELECT current_setting('app.current_clinic', true)"))` → retornou `[{"clinic":"00000000-0000-0000-0000-000000000000"}]`. Mesmo `SELECT` fora da tx → `[{"clinic":""}]`. `is_local=true` confirmado. |
| H3 | Backup restore REAL contra mesma instância Supabase | [x] | `psql -f manual-*.sql`: 12 errors esperados (event triggers Supabase-owned: `pgrst_*`, `issue_pg_*`, `ensure_rls`). **App tables 100% restauradas**: `drizzle.__drizzle_migrations` (1 row) + `public._schema_version` (0 rows). |
| H4 | Failure path do `db-migrate-prod.ts` | [x] | Migration deliberadamente broken (`CREATE TABL`) com journal entry. Script: dump pre-migration OK, advisory_lock acquired+released, drizzle-kit falhou (code 42601), MIGRATION_FAILED.md gerado com 7 campos, `migrations.log` recebeu linha `FAIL:`, re-run bloqueado pelo sentinel. |
| H5 | Idempotência explícita | [x] | `pnpm db:migrate:dev` rodado 2x consecutivas. Estado final: `drizzle.__drizzle_migrations` com 1 row (não 2), `information_schema.tables` com 1 entry pública (não duplicado). |

### Descoberta operacional crítica (incorporada à C1)

**`pg_dump` strategy para Supabase**: dump sem filtro inclui schemas Supabase-managed
(`auth`, `storage`, `realtime`, `pgsodium`, etc.) + event triggers globais (`pgrst_*`,
`ensure_rls`). Esses falham no restore por ownership permissions. Strategy atual
em `scripts/db-*.ts`: 13 schemas Supabase explicitamente excluídos via `--exclude-schema`.
Event triggers globais permanecem no dump mas falham com erros esperados — runbook
documenta os ~12 errors normais. App data restaura limpa.

## 1.7 — Runbooks + ADR

- [x] `docs/runbooks/migrations.md` ≤250 linhas, comando-primeiro
- [x] `docs/runbooks/c1-validation.md` (este arquivo)
- [x] `docs/adr/006-drizzle-orm-pinning.md`
- [x] `docs/runbooks/README.md` indexa os dois novos arquivos

## 1.8 — Validation + env tighten

- [x] `src/lib/env.ts`: `DATABASE_URL` sem `.optional()`
- [x] `src/lib/env.ts`: `NEXT_PUBLIC_SUPABASE_URL` sem `.optional()`
- [x] `src/lib/env.ts`: superRefine garante `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` OU legacy `_ANON_KEY` presente
- [x] `src/lib/env.ts`: superRefine exige `DATABASE_URL_PROD` quando `NODE_ENV=production`
- [x] `src/lib/env.test.ts` atualizado para novos required
- [x] `.env.example` restaurado refletindo contrato C1
- [x] `src/lib/db/README.md` substitui placeholder
- [x] `docs/PROGRESS.md` marca C1 ✅

## Gate final — pode avançar para C2?

Avança SE:
- [x] Todos os 12 testes 1.6.x passaram (1.6.4 deferido para C2)
- [x] `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm arch:check && pnpm arch:db-check && pnpm test && pnpm build` roda do zero sem erro
- [x] Você consegue, em 10 min, mostrar para alguém: scripts db:*, migration ciclo, dbAdmin guard, advisory lock concept

NÃO avança se:
- [x] Nenhum guard testado deixou passar erro que deveria bloquear
- [x] `dbAdmin` não aparece em `src/contexts/**` ou `src/app/(app)/**` ou `src/components/**` (verificado via grep)
- [x] Backup gerado em 1.6.5 foi inspecionado — contém `CREATE TABLE public._schema_version`, é restaurável
- [x] Sem ânsia de "adicionar tabelinha só pra testar" antes de C2 — C1 fechou limpa
