# ClinicaOS — Progresso de Camadas

Status oficial de cada camada do `Documentação/PlanoAção.md`. Atualizado conforme cada camada fecha (gate de critério obrigatório passado).

| Camada | Nome | Status | Data fechamento |
|---|---|---|---|
| **C0** | Fundação do Repositório | ✅ **fechada** | 2026-05-26 |
| **C1** | Banco + Drizzle + Migrations | ✅ **fechada** | 2026-05-26 (validada pós-auditoria mesma data) |
| **C2** | Multi-Tenant Core + RLS Foundation | ✅ **fechada** | 2026-05-28 (4 rounds de auditoria + hardening 0002) |
| C3 | Identity + Auth + Custom Claims + RBAC | ⏳ pendente | — |
| C4 | Outbox + Audit + Idempotency | ⏳ pendente | — |
| C5 | Patient (encryption per-tenant, LGPD) | ⏳ pendente | — |
| C6 | Scheduling Core | ⏳ pendente | — |
| C7 | Clinical (prontuário, prescrição, PDFs) | ⏳ pendente | — |
| C8 | Consultório UI | ⏳ pendente | — |
| C9 | Financial Core | ⏳ pendente | — |
| C10 | MessagingProvider + Webhook Meta | ⏳ pendente | — |
| C11 | AI Agent Base | ⏳ pendente | — |
| C12 | AI Agent Intents Core | ⏳ pendente | — |
| C13 | Tenancy & Billing | ⏳ pendente | — |
| C14 | Proactive Jobs | ⏳ pendente | — |
| C15 | Platform Admin | ⏳ pendente | — |
| C16 | Observabilidade & Hardening | ⏳ pendente | — |

---

## C0 — Fundação do Repositório (✅ fechada em 2026-05-26)

### O que foi entregue

- Next.js 15.5.18 + React 19.2.6 + TypeScript 5.9 strict (4 flags: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`)
- Tailwind 4 + Pino-ready logging path (sem implementação ainda — C16)
- 8 bounded contexts em `src/contexts/` com `index.ts` placeholder + README — isolamento físico estabelecido
- 7 subpastas em `src/lib/` (db, auth, outbox, audit, messaging, ai, pdf) com README explicando qual camada preenche
- Validação de env via Zod ([src/lib/env.ts](../src/lib/env.ts)) importada em [next.config.ts](../next.config.ts) — build falha cedo se env inválido; suporta naming legacy E nova do Supabase (anon/service_role ↔ publishable/secret)
- ESLint flat config com `eslint-plugin-boundaries` — matriz `context|lib|app|component` enforça anti-acoplamento (provado em testes manuais 2, 5)
- `pnpm arch:check` via madge — detecta circular deps (provado em teste manual 4)
- 5 ADRs em [docs/adr/](adr/) congelando decisões raiz (bounded contexts, RLS, outbox, Meta Cloud API, Supabase)
- [docs/CONVENTIONS.md](CONVENTIONS.md) — lei viva (naming, imports, anti-padrões, convenções future-pinned)
- [.github/workflows/ci.yml](../.github/workflows/ci.yml) — typecheck + lint + arch:check + test + build em todo PR
- [vercel.json](../vercel.json) — framework explícito (não depende de auto-detect)
- 7 testes Vitest unit em [src/lib/env.test.ts](../src/lib/env.test.ts) — incluindo regressões para naming legacy e string-vazia
- [docs/runbooks/c0-validation.md](runbooks/c0-validation.md) — runbook completo de validação

### Contratos congelados (mudar depois exige refator pesado)

- Estrutura `src/contexts/{8 nomes}`, `src/lib/`, `src/app/(app)/`, `src/app/(admin)/`
- Path alias `@/*` → `src/*`
- Naming: kebab-case files, camelCase TS, snake_case DB
- Matriz de imports boundaries (ver [eslint.config.mjs](../eslint.config.mjs))
- ADRs em `docs/adr/` (add-only, nunca edit histórico)

### Defesas anti-hidra validadas

| Defesa | Como | Provado por |
|---|---|---|
| Cross-context import bloqueado | `eslint-plugin-boundaries` | Teste manual 2 |
| Lib → context bloqueado | mesma regra | Teste manual 5 |
| Circular dependency bloqueada | `madge --circular` | Teste manual 4 |
| `console.log` proibido em produção | rule `no-console` | Teste manual 3 |
| Env inválido bloqueia build | Zod no `next.config.ts` | Teste manual 6 |
| TS strict máximo | tsconfig 4 flags | typecheck passa |

### Adiantamentos além do escopo C0 (não bloqueiam, mas anote)

- Repo GitHub criado + push (era opcional na C0)
- **Deploy Vercel ATIVO**: https://project-os-ten.vercel.app/ servindo placeholder via HTTPS (era escopo C16)
  - `NODE_ENV=production` satisfeito por default da plataforma Vercel
  - Wildcard SSL automático em `*.vercel.app` (custom domain `*.qoro.dev` será configurado em C2+ quando multi-tenant routing entrar)

### Issues conhecidos / débito técnico aceito

- `.env.local` da máquina dev preenchido manualmente — não há automação ainda
- Sem testes E2E (Vitest unit basta no MVP — E2E vem em C16 se necessário)
- Sem Sentry / observability (C16)
- Sem branch protection rules no GitHub além do CI (manual review por solo founder)

---

## C1 — Banco + Drizzle + Migrations (✅ fechada em 2026-05-26)

### O que foi entregue

- Drizzle ORM 0.36.4 + drizzle-kit 0.28.1 + postgres-js 3.4.5 + tsx 4.19.2 + dotenv 16.4.5 + cross-env 7.0.3 (todas pinned exato — ADR-006)
- [drizzle.config.ts](../drizzle.config.ts) apontando para `src/lib/db/schema/*` com `ssl: 'require'`
- [src/lib/db/index.ts](../src/lib/db/index.ts) — **dois pools Postgres fisicamente separados** (`db` runtime, `dbAdmin` admin) com singleton-safe globalThis cache contra HMR + boot-time guard contra prod-like URL em dev
- [src/lib/db/tenant.ts](../src/lib/db/tenant.ts) — `withTenant(clinicId, fn)` usando `set_config('app.current_clinic', $1, true)` dentro de transação
- [src/lib/db/types.ts](../src/lib/db/types.ts) — helpers `uuidPk`, `tenantId`, `timestampsPattern`, `deletedAt`
- [src/lib/db/schema/_meta.ts](../src/lib/db/schema/_meta.ts) — única tabela criada em C1: `_schema_version`
- [drizzle/migrations/0000_schema_version.sql](../drizzle/migrations/0000_schema_version.sql) — primeira migration aplicada em `qoro-dev`
- 6 scripts em [scripts/](../scripts/): `_env.ts`, `db-migrate-dev.ts`, `db-migrate-prod.ts` (com `pg_advisory_lock(4242)` + auto-swap 6543→5432 para Session Pooler), `db-backup-prod.ts`, `db-studio.ts`, `arch-db-check.ts`
- 6 scripts npm: `db:generate`, `db:migrate:dev`, `db:migrate:prod`, `db:backup:prod`, `db:studio`, `arch:db-check`
- [src/lib/env.ts](../src/lib/env.ts) tightened — `DATABASE_URL` + `NEXT_PUBLIC_SUPABASE_URL` agora required; superRefine garante uma de publishable/anon
- 13 testes Vitest em [src/lib/env.test.ts](../src/lib/env.test.ts) cobrindo novo contrato + opt-in `SUPABASE_PROJECT_ENV`
- ESLint flat-config: `no-restricted-imports` bloqueia `postgres` driver fora de `src/lib/db/index.ts` e `scripts/db-migrate-prod.ts`; bloqueia `dbAdmin` em `src/contexts/**`, `src/app/(app)/**`, `src/components/**`
- [docs/adr/006-drizzle-orm-pinning.md](adr/006-drizzle-orm-pinning.md) — ADR de pin exato + driver postgres-js + split de pooler ports (6543 app / 5432 migrate)
- [docs/runbooks/migrations.md](runbooks/migrations.md) — procedimento dev + prod + rollback com caveat de extensions
- [docs/runbooks/c1-validation.md](runbooks/c1-validation.md) — runbook re-executável de validação C1
- `.env.example` restaurado refletindo contrato C1

### Contratos congelados em C1 (mudar exige refator + ADR)

- **Drizzle é a única fonte da verdade do schema**. SQL manual permitido apenas para `CREATE EXTENSION`, índices especiais (partial/GIN/BRIN), RLS policies, triggers, migrations excepcionais zero-downtime.
- **`db` e `dbAdmin` são pools fisicamente distintos** em `src/lib/db/index.ts`. Não são alias. Em C1 mesma URL; em C2 service-role separa.
- **`postgres` driver só pode ser importado** em `src/lib/db/index.ts` e `scripts/db-migrate-prod.ts`. ESLint enforça.
- **Transaction policy**: apenas application/use-case layer abre transação via `db.transaction(...)` ou `withTenant(...)`. Repositories recebem `tx` por parâmetro.
- **`withTenant` é a única forma de injetar tenant scope** no Postgres. Usa `set_config(app.current_clinic, $1, true)`.
- **Migration files são imutáveis após aplicação**. Erro = nova migration corretiva.
- **Migration naming**: `^\d{4}_[a-z][a-z0-9_]*\.sql$`. `arch:db-check` bloqueia lixo (`fix.sql`, etc.).
- **Toda migration prod adquire `pg_advisory_lock(4242)`** antes de aplicar.
- **Scripts prod (`db:migrate:prod`, `db:backup:prod`)** usam Session Pooler (porta 5432) — auto-swap da Transaction Pooler (6543). Validado empiricamente em teste 1.6.11.
- **Backup obrigatório antes de migration prod**, com restore validado trimestralmente quando tiver clientes.
- **`dbAdmin` é alvo de ESLint guard** — importável apenas de `src/app/(admin)/`, `src/app/api/admin/`, `scripts/`.
- **`SUPABASE_PROJECT_ENV=prod` é opt-in explícito obrigatório** para qualquer script prod.

### Defesas anti-desastre validadas (12 guards / 17 testes)

12 testes da spec + 5 testes pós-auditoria (H1-H5) — ver [docs/runbooks/c1-validation.md](runbooks/c1-validation.md).

| Guard | Teste | Status |
|---|---|---|
| Migration ida e volta dev (`db:migrate:dev` + psql verify) | 1.6.1 | ✅ |
| Conexão app→db (`db` via route handler) | 1.6.2 | ✅ |
| `db` e `dbAdmin` exportados separados; grep limpo no resto do código | 1.6.3 | ✅ |
| `withTenant` SET `app.current_clinic` GUC dentro de tx, evapora fora | 1.6.4 (H2) | ✅ runtime real |
| Migration prod simulada FULL (pg_dump + advisory_lock + migrations.log) | 1.6.5 | ✅ |
| Dev script recusa `SUPABASE_PROJECT_ENV=prod` | 1.6.6 | ✅ |
| Studio recusa opt-in prod + zero scripts `db:studio:prod` | 1.6.7 | ✅ |
| Boot-time guard em `src/lib/db/index.ts` (NODE_ENV=dev + prod-like URL) | 1.6.8 | ✅ |
| ESLint bloqueia `import postgres` fora do allowlist | 1.6.9 | ✅ |
| `arch:db-check` passa limpo + bloqueia filename inválido (`fix.sql`) | 1.6.10 | ✅ |
| `pg_advisory_lock(4242)` serializa migrations concorrentes (Session Pooler) | 1.6.11 | ✅ |
| HMR singleton: conn count estável após 5 hot reloads | 1.6.12 | ✅ |
| `MIGRATION_FAILED.md` sentinel bloqueia re-run prod | parte de 1.6.5 | ✅ |
| **`dbAdmin` ESLint guard cobre `src/app/api/**` (exceto `api/admin/**`)** | H1 | ✅ |
| **Backup restore REAL — app tables 100% restauradas, 12 errors esperados** | H3 | ✅ |
| **Failure path `db-migrate-prod.ts` — MIGRATION_FAILED.md template renderiza completo** | H4 | ✅ |
| **Migrations idempotentes — 2x consecutivas mantêm estado estável** | H5 | ✅ |

### Adiantamentos e descobertas operacionais

- **1.6.11**: Transaction Pooler (6543) não serializa `pg_advisory_lock` — Session Pooler (5432) sim. Scripts prod auto-swappam a porta.
- **H3 (audit)**: `pg_dump` de Supabase project sem filtro inclui ~13 schemas managed (auth/storage/realtime/etc.) + event triggers globais que falham no restore por ownership. Strategy: `--exclude-schema` lista explícita de 13 schemas + tolerância de ~12 errors esperados durante restore (documentados no runbook).
- **H1 (audit)**: gap original do ESLint guard — `src/app/api/**` não estava coberto. Corrigido.
- **H2 (audit)**: spec original usava `SET LOCAL app.current_clinic = ?` que não aceita bind parameters seguros — versão final usa `set_config('app.current_clinic', $1, true)`. Validado runtime real.
- **H4 (audit)**: MIGRATION_FAILED.md template renderiza com 7 campos preenchidos automaticamente. `migrations.log` recebe linha FAIL com erro completo. Re-run bloqueado pelo sentinel.
- **H5 (audit)**: drizzle-kit verifica `drizzle.__drizzle_migrations` antes de aplicar — migrations são naturalmente idempotentes.
- Pool sizes baixos (runtime=5, admin=1) com timeouts defensivos (idle 20s, connect 10s, max_lifetime 30min) para serverless.

### Issues conhecidos / débito técnico aceito

- `qoro-prod` Supabase project ainda não criado — pré-requisito de C16 (primeiro cliente). DATABASE_URL_PROD ausente do `.env.local` é estado correto em dev.
- `pg_dump` precisa estar instalado **e no PATH** localmente antes de rodar migration prod real. Postgres 17 instalado em `C:\Program Files\PostgreSQL\17\bin\` — adicione ao PATH do sistema antes da primeira migration prod real.
- Restore de backup quarterly drill ainda não documentado em detalhe (item de C13/C16 quando clientes existirem).
- Sem zero-downtime migration patterns (founder solo anuncia janela de manutenção).

---

## C2 — Multi-Tenant Core + RLS Foundation (✅ fechada em 2026-05-28)

### O que foi entregue

- 3 tabelas em [src/contexts/tenancy/schema.ts](../src/contexts/tenancy/schema.ts): `clinics`, `clinic_units`, `_reserved_slugs` — todas com `ENABLE + FORCE ROW LEVEL SECURITY`. Helper `tenantIdRef()` exportado para C3+ (FK + `ON DELETE CASCADE`). Índice B-tree explícito em `clinic_units.clinic_id` (D9 — Postgres não cria auto para FK).
- Helper RLS [src/lib/db/rls.ts](../src/lib/db/rls.ts): `defaultTenantPolicy()` gera SQL dual-context (`current_setting('app.current_clinic')` OR `current_clinic_id()` OR `is_super_admin()`) com fingerprint `GENERATED_BY: defaultTenantPolicy(v1)` + sanitização `trim().toLowerCase()` + regex `/^[a-z_][a-z0-9_]*$/` contra injection. 24 testes Vitest cobrem D2/D5/D22/D23/D25/D27/D28/D30/D33.
- `withTenant()` em [src/lib/db/tenant.ts](../src/lib/db/tenant.ts) atualizado: `SET LOCAL ROLE authenticated` antes do `set_config('app.current_clinic', ...)` (hardening D24).
- Placeholders C3 em [src/lib/auth/tenant-context.ts](../src/lib/auth/tenant-context.ts): `requireClinicId`/`requireRole`/`requireSuperAdmin` lançam `Error` até C3 implementar.
- 5 funções SQL instaladas: `current_clinic_id()`, `current_platform_role()`, `is_super_admin()` (`SQL STABLE`) + `set_updated_at()`, `check_clinic_slug()` (`plpgsql VOLATILE`). Todas `SECURITY INVOKER`. Migration 0002 aplica `REVOKE EXECUTE FROM PUBLIC` + `GRANT EXECUTE TO anon, authenticated, service_role` (least-privilege, ADR-007 invariante #11).
- 2 migrations atômicas: [0001_tenancy_foundation.sql](../drizzle/migrations/0001_tenancy_foundation.sql) (extension + functions + tables + FK + index + triggers + 6 policies + seed 22 slugs + snapshot) e [0002_tenancy_hardening.sql](../drizzle/migrations/0002_tenancy_hardening.sql) (grants).
- [ADR-007](adr/007-rls-implementation-patterns.md): 11 invariantes congeladas (FORCE-principal, dual-context, RLS≠RBAC, 3 categorias de tabela, function grants), Threat Model formal com 8 PROIBIDOS + 5 GARANTIAS.
- [Runbook c2-validation.md](runbooks/c2-validation.md) re-executável: 11 testes psql + 2 bonus + seção Pitfalls (psql BEGIN-aninhado, SAVEPOINT, pool reuse).
- [CONVENTIONS.md](CONVENTIONS.md): Threat Model summary + 5 PR templates (tenant table, migration tenant, custom function, safe query, anti-pattern catalog).
- CI workflow ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) atualizada: env vars fake no step Build (mesma estratégia do vitest config) — desbloqueia `pnpm build` em GitHub Actions com env.ts C1+ rigoroso.

### Contratos congelados em C2 (mudar exige refator + ADR)

- Toda tabela tenant-scoped C3+ usa `tenantIdRef()` (FK + cascade), `index()` em `clinic_id`, e `ENABLE + FORCE RLS` na mesma migration do `CREATE TABLE`.
- Toda nova `CREATE FUNCTION` em C3+ aplica `REVOKE EXECUTE FROM PUBLIC` + `GRANT` explícito na mesma migration (invariante #11).
- Policies usam helpers SQL (`current_clinic_id`, `is_super_admin`), NUNCA `auth.jwt() ->> 'x'` literal.
- RLS responde apenas "pode tocar neste tenant?". Autorização funcional (gestor edita, doctor não) mora em Server Actions via `requireRole(...)` em C3+.
- `set_config('request.jwt.claims', ...)` é PROIBIDO em código de aplicação — esse GUC pertence a PostgREST/Supabase Auth.
- `withTenant()` é o único setter aprovado de `app.current_clinic` em jobs/workers.
- Mutações em `clinics` (UPDATE/INSERT/DELETE) são super_admin only em C2. Edição funcional pelo gestor entra em C3 via Server Action que usa `dbAdmin` + audit em C4.

### Defesas anti-vazamento validadas

| Defesa | Como | Provado por |
|---|---|---|
| FORCE RLS em toda tabela tenant-scoped | `ALTER TABLE x FORCE ROW LEVEL SECURITY` | Inspect `pg_class.relforcerowsecurity` |
| Dual-context (GUC OR JWT) em toda policy | `defaultTenantPolicy()` helper | Snapshot SQL em `rls.test.ts` |
| SET LOCAL ROLE authenticated funciona | Test G pré-implementação + 2.6.9 | psql empírico contra qoro-dev |
| Pool reuse safety (SET LOCAL morre com COMMIT) | Teste 2.6.11 | psql empírico |
| anon retorna 0 rows (não permission_denied) | Grants explícitos pós-hardening | Teste 4/8 pós-hardening |
| Cross-tenant UPDATE/SELECT bloqueado | RLS policy | Testes 2.6.1, 2.6.6, bonus 2 |
| Slug reservado bloqueia INSERT/UPDATE | Trigger `check_clinic_slug` | Teste 2.6.4 + 7/8 pós-hardening |
| `clinics` mutations super_admin only (D31) | 4 policies separadas | Teste 2.6.6 |
| `_reserved_slugs` write bloqueado | Sem write policy + FORCE RLS | Teste 2.6.10 |
| Authenticated não consegue ALTER/DROP policy | Postgres ownership | ADV-2 em audit |
| Authenticated não consegue forjar role no banco | `must be owner` | ADV-2 em audit |
| Custom functions sem PUBLIC EXECUTE | Migration 0002 | Verificação pós-hardening |

### Issues conhecidos / débito técnico aceito

- `tenantIdRef()` mora em `@/contexts/tenancy/schema.ts` (não em `lib/db/primitives/`) por restrição de boundaries — dívida arquitetural D35 anotada, refator estrutural em C3+ se sentir necessidade.
- Lint rule custom para barrar `db.<query>()` fora de `withTenant()` em código tenant-scoped — vem em C3.
- `_schema_version` aceito em `rls=t, force=f, sem policies` (Supabase auto-enabled equivalente a "sem RLS" para roles BYPASSRLS) — ADR-007 §10 cat 3 documenta.
- Integration tests de RLS automatizados em CI — vem em C16.
- Audit trail de `dbAdmin` (`super_admin_actions`) — vem em C4.
- Pré-impl gate (Test G): SET LOCAL ROLE authenticated funciona no Supabase Transaction Pooler (validado em qoro-dev). Se quebrar em ambiente futuro: FORCE + dual-context absorvem; sistema fica isolado, só perde defesa em profundidade.

### Forward-look: V-1 (caráter do modelo)

Verificado empiricamente que código backend pode forjar `request.jwt.claims` via `set_config(...)` para escalar até super_admin via conexão direta postgres-js. NÃO é vulnerabilidade externa — PostgREST valida JWT antes de injetar claim em HTTP. Documentado como ABSOLUTAMENTE PROIBIDO em ADR-007 Threat Model. Lint rule futura (C3+) deve detectar uso literal de `set_config('request.jwt.claims', ...)` em `src/`.

---

## Próximo passo — C3 (Identity + Auth + Custom Claims + RBAC)

### Pré-requisitos para começar C3

- [x] C2 fechada com 11 testes psql + 9 adversariais + 8 pós-hardening passando
- [x] Threat Model + 11 invariantes em ADR-007 congelados
- [x] Templates em CONVENTIONS prontos (5 templates)
- [x] Helpers SQL (`current_clinic_id`, `current_platform_role`, `is_super_admin`) em vigor — Auth Hook do Supabase em C3 vai popular claims que esses helpers leem
- [x] Placeholders `requireClinicId`/`requireRole`/`requireSuperAdmin` em vigor — C3 troca os `throw` por implementação real
- [x] `tenantIdRef()` exportado — `profiles`/`sessions`/`login_attempts` usam direto
