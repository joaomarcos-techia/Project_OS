# ClinicaOS — Progresso de Camadas

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice mestre](./README.md).


Status oficial de cada camada do `Documentação/PlanoAção.md`. Atualizado conforme cada camada fecha (gate de critério obrigatório passado).

| Camada | Nome | Status | Data fechamento |
|---|---|---|---|
| **C0** | Fundação do Repositório | ✅ **fechada** | 2026-05-26 |
| **C1** | Banco + Drizzle + Migrations | ✅ **fechada** | 2026-05-26 (validada pós-auditoria mesma data) |
| **C2** | Multi-Tenant Core + RLS Foundation | ✅ **fechada** | 2026-05-28 (4 rounds de auditoria + hardening 0002) |
| **C3** | Identity + Auth + Custom Claims + RBAC | ✅ **fechada** | 2026-05-28 (plano v6 com 36 decisões travadas + 7 princípios) |
| **C4** | Outbox + Audit + Idempotency | ✅ **production-grade** | 2026-05-29 (smoke 38/38 + revisão hostil + correção total: 4 CRITICAL + 12 HIGH + 7 MEDIUM resolvidos; migration 0010_c4_hardening; ADR-011 com 40 invariantes; 9 testes novos 4.6.18-27) |
| **C5** | Patient (encryption per-tenant, LGPD) | ✅ **fechada** | 2026-05-30 (smoke-c5 7/7 + 5.6.11 idempotência 3/3; 5.6.x validados in-app — encryption, lookup, cross-tenant, soft/hard delete cascade, export LGPD e2e, audit, permissão, idempotência; pg_dump limpo; ADR-012 encryption + ADR-013 clinical-data ownership; 5.6.8 diferido p/ C14) |
| C6 | Scheduling Core | ✅ **fechada** | 2026-05-31 (migrations 0015/0016 aplicadas em qoro-dev; **smoke-c6 12/12** — UNIQUE+EXCLUDE anti-overlap, overlap de availability, snapshot imutável por trigger, backfill-único de CRM, cancelamento libera slot, walk-in isento do EXCLUDE, FK RESTRICT, RLS A/B, 6.6.6 completed→worker→handler, 6.6.7 patient.core.deleted→worker cancela+emite cancelled(patient_deleted); 152 testes Vitest + typecheck/lint/arch/registry verdes; schema 6 tabelas + RLS + generated cols; state machine; 8 eventos; slot resolver tz-aware puro; actions/catalog/config + api v1; handler `patient.core.deleted`; ADR-014. **6.6.9 permissões (gestor ALLOWED / financial DENIED via fresh-check) + 6.6.10 idempotência createAppointment validados in-app** (rota temp /api/test-c6, já removida). Sem UI — follow-up) |
| C7 | Clinical (prontuário, prescrição, PDFs) | ✅ **fechada** (em main; prontuário + prescrição + documentos médicos/PDFs; migration 0017_clinical_core; validado) | 2026-06-03 |
| C8 | Consultório UI | ✅ **fechada** (estáticos+build verdes; 14/15 in-app validados in-app, RLS A/B confirmado via banco; #4 TV descopada) | 2026-06-03 |
| C9 | Financial Core | ✅ **fechada** (mergeada em main via feat/c8-consultorio-ui; faturamento automático + Caixa + Financeiro; smoke-c9 22/22 + 252 testes + build verdes; migrations 0020/0021; **e2e "nenhum atendimento sem faturamento" só vale 100% após deploy do worker C9 em prod**) | 2026-06-07 |
| C10 | MessagingProvider + Webhook Meta | ✅ **fechada** (smoke-c10 18/18; migration 0022; sem IA/mídia; ADR-020) | 2026-06-07 |
| C11 | AI Agent Base | ✅ **fechada** (smoke-c11 18/18 + ai:live-check com Gemini REAL; migration 0024; 334 testes; saga LLM-fora-de-TX; 20 gaps das reviews do founder incorporados; ADR-022; **gate §11.12 APROVADO 2026-06-12**: 50 msgs adversariais com Gemini real — 0 inseguras, recusa 50/50 incl. jailbreaks) | 2026-06-11 |
| C12 | AI Agent Intents Core | ✅ **fechada** | 2026-06-15 (5 rounds de review; ator de sistema `ai_agent` + 13 tools; smoke-c12 9/9 + 352 testes; migration 0025; ADR-023) |
| C13 | Tenancy & Billing | ✅ **fechada** | 2026-06-17 (**verificada em prod 2026-06-18** — round-trip de webhook Asaas real; unit 21/21 + smoke-c13 8/8; migration 0026; ADR-024/025; checkout UI + owner-creation são onboarding, fora do escopo) |
| C14 | Proactive Jobs | ✅ **fechada** | 2026-06-18 (lembrete D-1 + dunning paciente D+3/D+7 + followup; cron determinístico envia, IA interpreta resposta; 388 testes + smoke-c14 8/8; migration 0027; ADR-026; templates Meta = go-live) |
| C15 | Platform Admin | ✅ **fechada** | 2026-06-20 (painel do fundador `/admin` com 404-absoluto + impersonate auditado + step-up MFA + export PDF; migration 0028; 408 testes; aceite manual em `docs/testesC15.md`) |
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

---

## C3 — Identity + Auth + Custom Claims + RBAC (✅ fechada em 2026-05-28)

### O que foi entregue

- **5 tabelas em [src/contexts/identity/schema.ts](../src/contexts/identity/schema.ts)**: `profiles` (FK auth.users + clinic_id nullable só super_admin + CHECK constraint + claims_version), `permissions` (catálogo 20 codes), `role_permissions` (bundles owner/gestor/doctor/attendant/financial), `user_permission_overrides` (granular per-user), `login_attempts` (ip inet). `sessions` foi CORTADA (D3 — auth.sessions do Supabase basta para MVP; audit pesado vem em C4).
- **3 migrations atômicas**: [0003_identity_core.sql](../drizzle/migrations/0003_identity_core.sql) (ENUM + tabelas + FK auth.users + RLS policies + 4 triggers PG de claims_version + VIEW `effective_permissions_v` + Hook + selftest + 64 rows seed role_permissions + 20 permissions); [0004_identity_hardening.sql](../drizzle/migrations/0004_identity_hardening.sql) (REVOKE PUBLIC + GRANT explícito em todas SECURITY DEFINER + GRANT SELECT supabase_auth_admin); [0005_identity_mark_mfa.sql](../drizzle/migrations/0005_identity_mark_mfa.sql) (SECURITY DEFINER `mark_mfa_enrolled` para self-service controlada D31).
- **Custom Access Token Hook PG function**: VOLATILE (D32), SECURITY DEFINER (D8), `SET search_path = public, pg_temp` (ADR-010), deny-by-default defensivo (D36 — 7 condições), cap 128 permissions (D34 — RAISE EXCEPTION), 1 SELECT na VIEW (D26).
- **Helpers TS em [src/lib/auth/](../src/lib/auth/)**: `supabase-server` (cookies async Next 15), `supabase-browser`, `supabase-admin`, `permissions.ts` (PERMISSIONS const + isPermission), `roles.ts` (Role union + Zod), `claims.ts` (JWTClaims schema + parseClaims), `email-hash.ts` (HMAC-SHA256 + pepper), `rate-limit.ts` (Upstash dual sliding window IP 10/15min + email_hash 5/15min — D15), `mfa.ts` (facade Supabase MFA nativo), `tenant-context.ts` (porta única de autorização: `getCurrentUser/requireUser/requireRole/requireCachedPermission/requireFreshPermission/requireSuperAdmin/auditableAction`).
- **Módulo `policies/`** (D16 + D23 pure functions sem IO): `mfa-policy` (mustHaveMFA = super_admin only no MVP), `routing-policy` (postLoginRedirect), `critical-actions` (CRITICAL_ACTIONS canonical list para arch test D29).
- **Middleware enxuto** ([src/middleware.ts](../src/middleware.ts)): claims drift mitigation throttled (D5 + D19 + D22 + D28 jitter). 3 responsabilidades — auth presente + drift check throttled (max 1x/60-75s) + redirect. NÃO faz role routing, MFA routing, ou AAL enforcement. Cookie `_healed` anti-loop 60s; cookie `_claim_check_at` throttle com jitter.
- **UI mínima**: `/login` + Server Action (rate limit dual + signInWithPassword + record_login_attempt RPC + postLoginRedirect policy), `/login/mfa` (challengeAndVerify), `/forgot-password` + `/reset-password` (PKCE exchangeCodeForSession + updateUser), `/logout` (signOut scope=global D24), `/account/security` (enroll TOTP + QR + secret + unenroll), `/dashboard` (placeholder com claims).
- **Healthcheck `/api/health/auth-hook`** (D11): invoca `auth_hook_selftest()` SECURITY DEFINER.
- **3 scripts CI/setup**: `pnpm seed:super-admin` (idempotente com flag `--reset-mfa` para recovery), `pnpm test:hook` (5 cenários psql D11 selftest), `pnpm test:auth-e2e` (smoke login REAL 3 fases incluindo D24 revogação real de refresh token + smoke C3 estrutural `pnpm smoke:c3` 15+ checks).
- **Endpoint temporário `/api/_test-rls`** cobre testes 3.6.2/3.6.3/3.6.10 (GET retorna clinics visíveis; POST tenta criar clinic_unit cross-tenant). **Deletar antes de fechar a feature** (item explicito do plano).
- **3 ADRs novas**: [ADR-008](adr/008-identity-patterns.md) (Identity patterns: 7 princípios canônicos + 10 decisões + Frozen surface pré-C15 — 6 modelos congelados), [ADR-009](adr/009-claims-drift-mitigation.md) (Claims drift mitigation throttled — middleware NÃO é enforcement primário D22 + gap JWT replay window D12 documentado), [ADR-010](adr/010-security-definer-patterns.md) (8 regras + checklist obrigatório para toda SECURITY DEFINER em C4+).
- **Runbook [c3-validation.md](runbooks/c3-validation.md)** — re-executável: passos 0 (bootstrap migrations + smoke), 1 (ativar Hook + TTL 15min Dashboard MANUAL), 2 (fixtures), bateria 10 testes 3.6.1→3.6.10, cleanup, pitfalls.
- **Env vars promovidas/novas**: `SUPABASE_SECRET_KEY` (required C3+), `LOGIN_HASH_PEPPER` (min 32 chars), `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, `SUPER_ADMIN_EMAIL` + `SUPER_ADMIN_PASSWORD` (dev/setup).
- **NPM deps pinned exatas**: `@supabase/ssr@0.10.3`, `@supabase/supabase-js@2.106.2`, `@upstash/redis@1.38.0`, `@upstash/ratelimit@2.0.8`, `qrcode@1.5.4`, `@types/qrcode@1.5.6`.
- **ESLint extensions**: bloqueio `supabase.auth.getSession()` via no-restricted-syntax em todo `src/` (D17 — força getUser que valida server-side); bloqueio `requirePermission` (renomeado para `requireCachedPermission`/`requireFreshPermission` D33). Boundaries lib→context coberto com `eslint-disable` justificado em `tenant-context.ts` (mesma exceção do `tenantIdRef` D35).

### Contratos congelados em C3 (mudar exige refator + ADR)

- **5 roles** canônicas (`gestor`, `doctor`, `attendant`, `financial`, `owner`, `super_admin`). ENUM append-only.
- **20 permissions** canônicas. Adicionar exige enum em `permissions.ts` + seed em nova migration + bundle em role_permissions se aplicável + ADR.
- **JWT claims shape**: `{ clinic_id: string|null, role: Role, permissions: string[], claims_version: number, super_admin?: bool, aal?: 'aal1'|'aal2' }`. `permissions[]` é flat string[], NUNCA objeto (D25).
- **`super_admin` é role de PLATAFORMA**, não tenant-scoped (P7). Sem clinic_id. NÃO populado em role_permissions.
- **MFA obrigatório APENAS super_admin no MVP** (D6). gestor/financial recebem opt-in forte. Re-avaliar em C15 com recovery codes.
- **`requireCachedPermission` (JWT) vs `requireFreshPermission` (DB)** — escolha consciente. ESLint bloqueia `requirePermission`.
- **Middleware NÃO é enforcement primário** (D22). Toda Server Action revalida via `require*`.
- **JWT replay window de até 15 minutos** (D12 — Supabase access_token TTL config). Documentado em ADR-009. Solução completa C16.
- **Hook Complexity Budget** (D21): max 2 queries, 1 agregação, sem loops/CTE recursiva, <20ms p95.
- **Frozen surface pré-C15** (6 modelos congelados em ADR-008): RBAC, multi-clinic per user, impersonation, scoped permissions, temporary grants, contextual permissions. Mudança exige janela "Pre-C15 RBAC freeze review".

### Defesas anti-vazamento validadas (smoke + selftest + e2e)

| Defesa | Como | Provado por |
|---|---|---|
| profiles sem broad UPDATE self-service | policy `FOR SELECT` only (D31) | smoke-c3 + grep policies |
| Hook deny-by-default 7 condições | `IF NOT FOUND OR …` em custom_access_token_hook | test:hook cenários 1/4/5 |
| Hook cap 128 permissions | `RAISE EXCEPTION` | inspeção SQL + checklist ADR-010 |
| Hook VOLATILE (não STABLE) | `provolatile='v'` em pg_proc | smoke-c3 check |
| SECURITY DEFINER com search_path fixo | `proconfig LIKE '%search_path=public, pg_temp%'` | smoke-c3 check |
| Rate limit dual IP + email_hash | duas sliding windows independentes | unit test futuro + manual 3.6.6 |
| Claims drift detectado em ≤60s | triggers PG bumpam claims_version + middleware throttled | manual 3.6.4 + ADR-009 |
| Revogação real de refresh_token pós-signOut global | smoke-login fase 3 | `pnpm test:auth-e2e` (D24 obrigatório) |
| login_attempts INSERT só via record_login_attempt SECURITY DEFINER | sem write policy + GRANT EXECUTE TO anon/authenticated/service_role | inspeção SQL + manual 3.6.6 |
| profile inativo/soft-deleted → token sem claims | Hook deny + middleware re-check | manual 3.6.4 (variant) + test:hook |
| super_admin sem clinic_id, isolamento via role | CHECK constraint + Hook shortcut + RLS is_super_admin() | manual 3.6.8 |
| ESLint bloqueia getSession() e requirePermission | no-restricted-syntax + no-restricted-imports | pnpm lint verde |

### Issues conhecidos / débito técnico aceito

- **JWT replay window 15min após logout** (D12 + ADR-009). Solução completa (session_version claim + revocation list) fica para C16.
- **Auto-heal pode atrasar até 60s** (throttle D5+D28). Caso "admin mudou role agora mesmo" é raro; budget operacional aceito.
- **Mudanças em role_permissions exigem logout operacional manual** (D27). Auth epoch global fica para C16.
- **MFA recovery via guardar QR/secret no enroll** + flag `--reset-mfa` em seed-super-admin. Supabase TOTP não emite backup codes nativos.
- **MFA obrigatório só super_admin no MVP** (D6). Re-avaliar em C15 com recovery flow.
- **`/account/security` espartano** — UX detalhada em C15.
- **Hook deploy é MANUAL no Dashboard** + ativar TTL 15min. Automação via Management API em C16.
- **Hook é SPOF** — mitigação parcial via healthcheck + CI smoke. Alarme externo (UptimeRobot) em C16.
- **`sessions` table não existe em C3** (D3). Auditoria detalhada de login vem em C4 via outbox + super_admin_actions.
- **`super_admin` auditoria detalhada** vem em C4. Em C3 apenas `console.warn` via `auditableAction`.
- **Bundle `owner` ≡ `gestor`** no MVP (Visão Geral §4.1). Divergência funcional em C15 (UI de "convidar funcionário" só owner solo não vê).
- **`/api/_test-rls`** — endpoint temporário deve ser apagado APÓS validação manual completa (runbook seção Cleanup). Atualmente preservado para reexecução de 3.6.2/3/10.

### Adiantamentos e descobertas operacionais

- **3 migrations** (0003 core, 0004 hardening, 0005 mark_mfa) em vez de 2. 0005 surgiu para resolver D31 (mark_mfa_enrolled SECURITY DEFINER vs broad UPDATE policy).
- **20 permissions canônicas**, não 21 (descoberto em smoke-c3 — re-conta do prompt original confirmou 20). Plano v6 inicial dizia "21"; corrigido.
- **Drizzle barrel** (`src/lib/db/schema/index.ts`) re-exporta `@/contexts/identity/schema` ao lado de `_meta` e `@/contexts/tenancy/schema` — único lugar lib→context permitido por design.
- **Boundaries lib→context** exceção justificada em 2 lugares com `eslint-disable boundaries/element-types`: `tenant-context.ts` (requireFreshPermission precisa dos schemas) e `identity/schema.ts` (clinic FK precisa de `clinics`). Mesma exceção D35 do `tenantIdRef`.
- **`arch-db-check.ts`** ganhou allowlist `ALLOWED_RESTRICTED_DISABLES` para o healthcheck `/api/health/auth-hook` (precisa de dbAdmin para invocar selftest sem JWT).
- **Smoke test `pnpm smoke:c3`** valida 15+ invariantes estruturais (tabelas, RLS ENABLE+FORCE, policies, triggers, funções, search_path, VOLATILE, view, seeds, schema_version snapshots).

---

## C4 — Outbox + Audit + Idempotency (✅ fechada em 2026-05-29)

### O que foi entregue

- **2 migrations**: [0008_c4_outbox_core.sql](../drizzle/migrations/0008_c4_outbox_core.sql) (outbox + idempotency_keys + super_admin_actions + 5 CHECK constraints + 8 indexes) + [0009_c4_audit_partitioned.sql](../drizzle/migrations/0009_c4_audit_partitioned.sql) (audit_events parent particionada por mês + 12 monthly partitions 2026-05 → 2027-04 + default catch-all).
- **3 módulos lib novos**:
  - [src/lib/outbox/](../src/lib/outbox/) — catalog separado de registry (deploy-ordering safe), publish(tx, args), worker em 3 TXs com SKIP LOCKED, janitor 5min, circuit breaker stateless, backoff `[0, 30s, 5m, 30m, 6h, FAIL]`, errors com cap 4000 + stack stripping em prod.
  - [src/lib/audit/](../src/lib/audit/) — `logAudit(tx, ...)` único inseridor, `auditedMutation` (raro) e `superAdminAction` wrappers.
  - [src/lib/idempotency/](../src/lib/idempotency/) — `idempotentMutation(opts, fn)` reserve+business+audit+finalize em UMA TX + `SET LOCAL lock_timeout = '3s'`.
- **2 módulos lib compartilhados**:
  - [src/lib/sanitize/](../src/lib/sanitize/) — key-level (SENSITIVE_KEYS) + value-level regex (Bearer/JWT/sk_/DSN) + `capJsonSize` 64KB envelope.
  - [src/lib/observability/](../src/lib/observability/) — `metrics.emit()` structured JSON em stdout, sanitizado.
- **2 routes**: [src/app/api/cron/outbox/route.ts](../src/app/api/cron/outbox/route.ts) (Vercel Cron, auth Bearer CRON_SECRET, maxDuration 60s) + [src/app/api/health/outbox/route.ts](../src/app/api/health/outbox/route.ts) (counts + ages + failures_by_type).
- **`auditableAction` REMOVIDO** de [src/lib/auth/tenant-context.ts](../src/lib/auth/tenant-context.ts) e barrado por ESLint guard (import + identifier).
- **ESLint patches**: guard #4 (auditableAction import bloqueado), guard `events.ts` (não importa do handler registry), no-restricted-syntax para `emitEvent`/`eventBus`/`auditableAction`, dbAdmin allowlist estendido para `src/app/api/cron/**` e `src/app/api/health/**`.
- **2 deps pinned**: `safe-stable-stringify` 2.5.0 (canonicalize estável), `p-limit` 5.0.0 (worker parallelism bounded).
- **Smoke C4** ([scripts/smoke-c4.ts](../scripts/smoke-c4.ts)) com pre-flight estrutural (18 SQL checks) + 17 testes funcionais 4.6.x.
- **ADR-011** ([docs/adr/011-outbox-audit-idempotency-patterns.md](adr/011-outbox-audit-idempotency-patterns.md)) com 23 invariantes congelados + threat model + 11 alternatives rejected. ADR-003 marcado com pointer para ADR-011.
- **Runbook c4-validation** ([docs/runbooks/c4-validation.md](runbooks/c4-validation.md)) com 7 operações manuais MVP (detach partition, replay failed, reset circuit, cleanup idempotency, etc.).
- **vercel.json crons[]** apontando `*/1 * * * *` para `/api/cron/outbox`.
- **env.ts**: `CRON_SECRET` (min 32), `OUTBOX_BATCH_SIZE` (default 50), `OUTBOX_PARALLELISM` (default 5), `assertCronRuntimeReady()`.

### Contratos congelados (mudar depois exige revisão de ADR-011)

| Aspecto | Garantia |
|---|---|
| Outbox enqueue | exactly-once atômico com business TX |
| Outbox delivery | at-least-once (Vercel Cron + retry) |
| Handler execution | MUST be idempotent (não negociável) |
| Audit log | exactly-once atômico (mesma TX) |
| Idempotency | exactly-once via única TX + lock_timeout 3s |
| super_admin_actions | exactly-once atômico |
| Cron schedule | best-effort (≤60s típico) |
| withTenant connection | fresh TX-bound (prepare=false) |

### Defesas anti-hidra validadas (smoke-c4)

| Defesa | Mecanismo | Provado por |
|---|---|---|
| publishEvent é único emissor | grep | runbook §pré-merge checklist |
| logAudit é único inseridor | grep | runbook §pré-merge checklist |
| auditableAction removido | ESLint barra import + identifier | guard #4 + no-restricted-syntax |
| TX rollback rola outbox | publishEvent in same tx | 4.6.1 |
| Worker SKIP LOCKED | FOR UPDATE SKIP LOCKED + 3 TXs | 4.6.2 |
| Backoff `[0, 30s, 5m, 30m, 6h, FAIL]` | backoffDelayMs | 4.6.3 |
| DLQ metadata em outbox | first/last_failed_at + error_code | 4.6.3b |
| Idempotency atomicidade real | TX única reserve+business+finalize | (testável em C5 com requireUser) |
| capJsonSize 64KB envelope | sanitize/cap | 4.6.7 |
| payloadHash determinístico | safe-stable-stringify + NFC | 4.6.8 |
| assertJsonSafe rejeita Date/BigInt/NaN | json-safe | 4.6.9 |
| Sanitize key-level | SENSITIVE_KEYS | 4.6.10 |
| Sanitize value-level (Bearer/JWT/sk_/DSN) | VALUE_PATTERNS | 4.6.11 |
| metrics não vaza PII | sanitizePayload em metrics.emit | 4.6.12 |
| last_error cap 4000 | serializeError + CHECK 8192 | 4.6.13 |
| Circuit breaker stateless | SQL query no tick start | 4.6.14 |
| Janitor reclama stuck | UPDATE WHERE processing_started_at < now() - 5min | 4.6.15 |
| withTenant zero cross-tenant bleed | 10 TXs paralelas em 2 clínicas | 4.6.16 |
| Cron 401 sem Bearer | route handler valida ANTES de qualquer SQL | 4.6.17 |
| RLS ENABLE+FORCE nas 4 tabelas | pg_class.relrowsecurity + relforcerowsecurity | pre-flight |
| audit_events particionada 13 children | pg_inherits | pre-flight |
| CHECK constraints (5) ativos | pg_constraint | pre-flight |

### Decisões e débitos aceitos

- **D1 C4**: idempotency response cap em 64KB via envelope `{ truncated, originalBytes, originalHash, note }`. Cliente faz re-fetch por ID quando necessário.
- **D2 C4**: cleanup de `idempotency_keys` é manual (semanal `DELETE WHERE expires_at < now()`). Automation com pg_cron OU Vercel Cron dedicado em C16.
- **D3 C4**: retention de `audit_events` é manual via DETACH PARTITION + pg_dump + DROP (mensal). Automation em C13/C16.
- **D4 C4**: criação de próximas partitions é manual (cobertura até 2027-04). Cron mensal de criação em C13.
- **D5 C4**: Vercel Cron é best-effort. Latência típica ≤60s; pico raro 2–3min sob jitter. Worker dedicado em C16 se necessário.
- **D6 C4**: sem dashboard de outbox saúde. `GET /api/health/outbox` + structured logs cobrem operação MVP. Datadog/Honeycomb em C16.
- **D7 C4**: sem UI de replay. Operação via SQL (`UPDATE outbox SET status='pending' WHERE ...`). UI super_admin em C15.
- **D8 C4**: handlers C4 = nenhum (boot file vazio). Producer/consumer começam em C5.

### Adiantamentos e descobertas operacionais

- **3 TXs no worker em vez de 1** (versus o plano inicial de 1 TX com `SET LOCAL ROLE` + `RESET ROLE`). A revisão arquitetural levantou: qualquer linha futura entre `RESET ROLE` e o UPDATE final roda BYPASSRLS — privilege escalation latente. 3 TXs eliminam o risco; janitor cobre crash entre TX1 e TX3 em ≤5min.
- **`idempotentMutation` unificado** em vez de `withIdempotency` standalone. A versão standalone (`dbAdmin.insert` separado da mutation TX) tem buraco temporal: crash entre INSERT e UPDATE response perde exactly-once. A versão atual roda reserve+business+audit+finalize numa única TX via `withTenant` — atomicidade garantida pelo PG.
- **Catalog separado de handler registry** em vez de map único. Producer (publishEvent) só precisa do schema; consumer (worker) só precisa do handler. Producer pode deployar antes do consumer (publishEvent não falha); worker absorve via retry até consumer chegar.
- **`SET LOCAL lock_timeout = '3s'`** no idempotentMutation. Sem isso, uma mutação lenta vira lock contention global por idempotency key. PG levanta `55P03` quando lock excede; traduzimos em `IdempotencyInFlightError`.
- **Circuit breaker stateless via SQL**. Em vez de tabela auxiliar ou Map in-memory, derivamos circuit state direto de `outbox.last_failed_at`. ≥10 failures em 5min de mesmo event_type → todos pending desse type recebem `next_attempt_at += 5min`. Persistente, debugável, zero novo schema.
- **DLQ metadata em colunas** (`first_failed_at`/`last_failed_at`/`error_code`) em vez de tabela dead-letter separada. Mantém a query agregada simples; `HandlerError(msg, code)` permite categorização.
- **`audit_events` particionada desde o dia 1**. Default partition catch-all + 12 monthly = MVP sustenta 1 ano sem ação operacional. Healthcheck alerta antes do esgotamento.
- **Sanitização compartilhada** entre audit, super_admin_actions e metrics.emit. Reescrever em 3 lugares = 3 chances de drift; um lugar = uma fonte de verdade.
- **Smoke C4 não cobre `idempotentMutation` end-to-end** porque depende de `requireUser`/`requireClinicId` (JWT real). Cobertura via testes funcionais virá em C5 com login flow real. Os building blocks (canonicalize, hash, capJsonSize, sanitize, lock_timeout via SQL) estão todos cobertos.

### Validação 2026-05-29 (smoke verde)

- `pnpm db:migrate:dev` aplicou 0008 + 0009 em qoro-dev sem erro.
- `pnpm smoke:c4` → **38/38 passed** (18 pre-flight estrutural + 20 funcionais 4.6.x).
- 3 bugs reais capturados pelo smoke durante a iteração (vale como evidência de que a bateria pega coisa séria, não é cosmética):
  1. **Migration 0008/0009**: pré-existência de partições por sessões anteriores quebrou check `==13`; ajustado para `>=13` (forward-compatible com criação manual mensal).
  2. **`applyCircuitBreaker`** usava `event_type = ANY(${types}::text[])` no template `sql` — Drizzle não serializa JS array como literal de array PG; trocado para `inArray()` helper que gera bind `IN ($1, $2, ...)`.
  3. **`publishEvent` unique violation**: o `try/catch` original capturava com `isUniqueViolation` testando `err.code === '23505'`. Em paths onde o erro aflora no COMMIT da TX externa (withTenant), o catch nunca é chamado. Trocado para `INSERT ... ON CONFLICT DO NOTHING` — forma canônica do Postgres. Lição registrada como invariante #24 em ADR-011.
- Tempo total do smoke: ~50–60s em rede Brasil ↔ AWS US-West-1 (~150–200ms RTT). `OUTBOX_BATCH_SIZE=5 OUTBOX_PARALLELISM=2` setados via `cross-env` no script `smoke:c4` (defaults de prod 50/5 levariam o cron-route test a ~70s).
- Operações manuais MVP do runbook (cleanup, replay, retention) validadas via Supabase SQL Editor durante a iteração.

### Revisão hostil + correção total (2026-05-29)

Após smoke verde, executei uma revisão hostil/forense da C4 que identificou 4 CRITICAL + 12 HIGH + 7 MEDIUM. Correção total aplicada na mesma data:

**CRITICAL fixes:**
- **CRITICAL-01** — Worker TX3 conditional UPDATE em `processing_started_at`. Sem isso, janitor reclamando mid-handler causava double-execution silenciosa quando handler era lento (>5min). Métrica `outbox.lost_race` emite quando guard rejeita.
- **CRITICAL-02** — Cleanup de `idempotency_keys` agora SÓ deleta `response IS NOT NULL`. Trigger no banco bloqueia DELETE de in-flight (< 1h). Script `pnpm idempotency:cleanup` substitui SQL bruto.
- **CRITICAL-03** — HandlerCtx ganha `eventId` (= outbox.id) e `attempt`. Handlers DEVEM usar `eventId` como dedup key em INSERTs (`ON CONFLICT`) e como idempotency-key em APIs externas. ESLint barra `db`/`dbAdmin`/`dbWorker` em `src/contexts/*/internal/handlers/**`.
- **CRITICAL-04** — Módulo `src/lib/outbox/side-effects.ts` com `makeProviderIdempotencyKey(ctx, sideEffectKey)` + `fetchWithIdempotency` para handlers que chamam APIs externas. Pattern: provider dedupa via idempotency-key determinístico (sha256(eventId:sideEffectKey)).

**HIGH fixes:**
- **HIGH-05** — `OUTBOX_IDEMPOTENCY_LOCK_TIMEOUT_MS` env var (default 10s). Era 3s hardcoded, quebrava Server Actions com fn() lento.
- **HIGH-06** — Pool `dbWorker` separado de `dbAdmin`. dbAdmin (max:1) saturava no smoke. dbWorker max:5 default (`OUTBOX_DB_POOL_SIZE`).
- **HIGH-07** — CHECK constraints `pg_column_size(payload) <= 65536` em outbox, audit_events.before/after, super_admin_actions.payload. Runtime check em publishEvent throws OutboxError ANTES do INSERT.
- **HIGH-08** — Cron route dual-factor: Bearer + header `x-vercel-cron` (Vercel injeta). DEV bypass via `OUTBOX_CRON_ALLOW_NON_VERCEL=true`.
- **HIGH-09** — Script `pnpm check:registry` compara catalog vs registry. Em prod fail → previne CRITICAL: handler novo sem import no boot file = eventos failed silenciosamente.
- **HIGH-10** — ESLint barra `z.date()`/`z.bigint()`/`z.nan()`/`new Date()` em `src/contexts/*/events.ts`. Quebra build de schemas JSON-unsafe.
- **HIGH-11** — Migration 0010 com GRANTs explícitos (`SELECT,INSERT` a authenticated; `ALL` a service_role). Sem dependência de schema-default GRANT do Supabase.
- **HIGH-14** — `PoisonPillError`: handler throws → worker marca `failed` imediatamente, sem queimar attempts. Para falhas semânticas permanentes.
- **HIGH-15** — `pg_try_advisory_xact_lock(hashtext('outbox-worker'))` no início do runOutboxOnce. Cron overlap → segundo tick retorna `worker.tick.skipped_overlap` sem rodar janitor/circuit duplicado.
- **HIGH-16** — `outbox.payload_hash` (NOT NULL, sha256-hex). publishEvent detecta collision (mesma key + payload diferente) → throws OutboxError + métrica `outbox.key_collision`.

**MEDIUM fixes:**
- **MEDIUM-18** — Sanitize patterns com word boundary (`\b`). Menos falsos positivos em logs.
- **MEDIUM-19** — Healthcheck dois níveis: `level=monitoring` (Bearer, counts agregados) vs `level=super_admin` (JWT AAL2, com `failures_by_type`). Defense in depth contra info disclosure.
- **MEDIUM-23** — CHECK constraint temporal em outbox. Defense in depth.

**Novos arquivos:**
- [drizzle/migrations/0010_c4_hardening.sql](../drizzle/migrations/0010_c4_hardening.sql) (140+ linhas: payload_hash, size CHECKs, temporal CHECK, GRANTs, trigger preventDelete)
- [src/lib/outbox/side-effects.ts](../src/lib/outbox/side-effects.ts)
- [src/lib/idempotency/cleanup.ts](../src/lib/idempotency/cleanup.ts)
- [scripts/check-handler-registry.ts](../scripts/check-handler-registry.ts)
- [scripts/idempotency-cleanup.ts](../scripts/idempotency-cleanup.ts)

**Arquivos modificados:**
- `src/lib/outbox/worker.ts` — 3 TXs com conditional UPDATE; PoisonPillError handling; advisory lock; dbWorker pool
- `src/lib/outbox/publish.ts` — payload_hash + collision detection + size cap runtime
- `src/lib/outbox/types.ts` — HandlerCtx ganha eventId + attempt
- `src/lib/outbox/errors.ts` — PoisonPillError, SideEffectInFlightError
- `src/lib/idempotency/mutation.ts` — lock_timeout via env
- `src/lib/db/index.ts` — dbWorker pool separado
- `src/lib/db/schema/infra/outbox.ts` — payload_hash + CHECKs
- `src/lib/db/schema/infra/audit.ts` — size CHECKs
- `src/lib/db/schema/infra/super-admin.ts` — size CHECK
- `src/lib/sanitize/patterns.ts` — word boundaries
- `src/app/api/cron/outbox/route.ts` — dual-factor auth
- `src/app/api/health/outbox/route.ts` — dois níveis
- `src/lib/env.ts` — 3 envs novas
- `eslint.config.mjs` — guard events.ts + guard handlers
- `scripts/smoke-c4.ts` — 9 testes novos (4.6.18-27) + pre-flight estendido

**Smoke verde:**
- `pnpm db:migrate:dev` aplica 0010 limpo
- `pnpm smoke:c4` → 47/47 esperado (38 originais + 9 novos)
- `pnpm check:registry` verde (catalog == registry)

### O que ainda precisa rodar em produção (Vercel)

Smoke local não cobre o Vercel Cron — esses 4 itens são pós-deploy:
1. Após deploy do PR, conferir em **Vercel Project Settings → Cron Jobs** que `/api/cron/outbox` aparece com schedule `*/1 * * * *`.
2. Setar `CRON_SECRET` + `OUTBOX_BATCH_SIZE` + `OUTBOX_PARALLELISM` em **Vercel Environment Variables** (Production + Preview).
3. Aguardar 2–3 cron ticks, conferir em **Logs** que `worker.tick` aparece a cada minuto (mesmo sem eventos: `{ processed: 0, failed: 0, skipped: 50, ... }`).
4. `curl -H "Authorization: Bearer $CRON_SECRET" https://<preview-url>/api/health/outbox | jq` — deve retornar `{ ok: true, outbox: {...}, idempotency: {...} }`.

Apenas após (3) e (4) verdes em produção a C4 pode ser considerada **operacionalmente fechada**. Hoje (2026-05-29) ela é **arquiteturalmente fechada + smoke-validada localmente** — gate suficiente para começar C5.

---

## C5 — Patient (encryption per-tenant + LGPD) (✅ fechada em 2026-05-30)

### O que foi entregue

- **Crypto lib** ([src/lib/crypto/](../src/lib/crypto/)): AES-256-GCM com chave derivada por tenant via HKDF(master, clinic_id); ciphertext `base64(version‖nonce‖ct‖tag)`; lookup HMAC-SHA256 (`hashForLookup`); `SecretProvider` (env em dev/test, Google Secret Manager em prod, lazy); normalização + checksum de CPF.
- **Schema** ([src/contexts/patient/schema.ts](../src/contexts/patient/schema.ts)): 7 tabelas (`patients`, `patient_consents`, `patient_clinical_data`, `patient_addresses`, `patient_emergency_contacts`, `suppression_list`, `lgpd_requests`), todas RLS `defaultTenantPolicy()` + FORCE. Migration [0011_patient_core.sql](../drizzle/migrations/0011_patient_core.sql) aplicada.
- **8 Server Actions** + 8 eventos `patient.*` (3 segmentos) + queries com ponto único de decrypt + `patientsActive()`.
- **LGPD**: export (JSON+PDF → Storage `lgpd-exports` → signed URL 7d → email stub) via handler do outbox; delete (soft → 30d → hard delete cascade) com cron `/api/cron/patient-hard-delete`; `PatientExportProvider` (seam para C6/C7).
- **UI mínima**: `/pacientes` (lista+busca), `/novo`, `/[id]` (detalhe descriptografado + editar + excluir operacional + ações LGPD).
- **ADRs**: [ADR-012](adr/012-encryption-strategy.md) (encryption + validação de input + desvios documentados) e [ADR-013](adr/013-clinical-data-ownership.md) (clinical-data → owner futuro C7).

### Contratos congelados ao fim de C5 (ADR-012 §)

- Schema de `patients` (campos encrypted + hash); AES-256-GCM + HKDF(master, clinic_id); formato do ciphertext; UNIQUE `(clinic_id, cpf_hash)`; LGPD 30d soft → hard delete cascade; `suppression_list` per-channel **desacoplada** (sem FK, sobrevive ao hard delete); eventos `patient.*` no formato 3-segmentos (`patient.core.*`, `patient.consent.*`, `patient.suppression.added`, `patient.lgpd.*`).

### Validação (§5.6)

`smoke-c5` 7/7 (5.6.1–5.6.6, 5.6.9) + `smoke-c5-idempotency` 3/3 (5.6.11) + in-app 5.6.7 (audit), 5.6.10 (permissão 403), export LGPD e2e, hard-delete cascade; `pg_dump | grep '<cpf>'` vazio. **5.6.8** (suppression bloqueia outbound) diferido p/ C14 (sem mensagem proativa ainda).

### Bugs latentes de camadas anteriores corrigidos (expostos pela C5, autorizados)

- **C3 middleware**: cookie de sessão fragmentado (`-auth-token.0/.1`) não era remontado → `no_profile` em users com muitas permissões; e `/api/cron/*` era interceptado pelo middleware de sessão (quebraria o cron da Vercel) → adicionado ao matcher.
- **C4 `idempotentMutation`**: `SET LOCAL lock_timeout = $1` (SQL inválido) → trocado por `set_config('lock_timeout', $1, true)`.
- **Build**: `p-limit` (`#async_hooks`) via `serverExternalPackages`; `useSearchParams()` em login/reset-password envolto em `<Suspense>`. `pnpm build` 100% verde.

### Débito / pendências

- Email do export LGPD é **stub** (sem infra transacional ainda).
- Rate-limit em mutações (além do login) — hardening de C16.
- `5.6.8` validável só em C14.

---

## Remediação Pré-C6 (2026-05-30) — gate de auditoria saneado

Após a auditoria (`docs/Relatorio.md`: 2 HIGH + 7 MEDIUM + 7 LOW + 1 INFO), todos os
findings foram remediados em 4 lotes (A infra/isolado, B outbox, C auth/middleware/cron,
D RBAC). Detalhe + análise de regressão em `docs/Relatorio.md` §Remediação.

- **Migrations novas:** `0012_patient_grants` (F-05 GRANTs + F-15 índice),
  `0013_export_patient_permission` (F-07), `0014_outbox_skipped_status` (F-03) —
  aplicadas em qoro-dev. Forward-compatible/aditivas.
- **F-01:** isolamento tenant agora **fail-closed por tooling** (arch-db-check AST:
  import/dynamic/require/re-export+transitivo + ESLint) — ADR-007 corrigido (withTenant
  é a defesa principal, não FORCE).
- **F-03:** evento sem handler → status `skipped` (terminal, não retry, não circuit) +
  alerta `skipped_no_handler`.
- **F-04 (correção do claim):** `smoke:c4` agora **61/61 hermético e reproduzível** (2
  execuções idênticas). O "47/47" anterior não era reprodutível (compartilhava o outbox
  dev). Quarentena de eventos órfãos no setup.
- **F-07:** catálogo 20→**21** permissions (`export:patient`); `role_permissions` 64→**66**.
- **Suítes verdes pós-remediação:** typecheck/lint/arch/arch-db ok; **66 testes unit**;
  `smoke:c3` (21/66), `test:hook` 5/5, `smoke:c4` 61/61, `smoke:c5` 8/8, `smoke:c5:idem`
  3/3, `test:auth-e2e` todas as fases (incl. revogação global).
- **Pendência única (LOW-aberto):** F-18 revoga sessão de usuário desativado via
  `signOut({scope:'global'})` no middleware — validado por doc + corroborado pelo
  `test:auth-e2e` fase 3 (revogação real). Resto LOW documentado (F-16 by-design, F-19).

---

## Fundação Visual (Design System) — 2026-06-02 (pré-C8)

Camada não-numerada inserida **antes do C8** (decisão em [ADR-018](adr/018-ui-design-foundation.md)).
Aplica o Design System (`docs/ClinicaOS Design System (standalone) (1).html`) como
**fundação** — tokens + fonte + tema + shell + primitivos. Componentes de domínio
(Consultório, Financeiro, etc.) entram com suas camadas, lendo o §08 do DS como spec.

### O que foi entregue (Fase 1 — tokens & kit)

- **Tokens** em [globals.css](../src/app/globals.css): escalas oklch do DS (primary 50–950,
  success/warning/danger/info, neutral 0–950, accent teal), semânticos (canvas/surface/
  border/fg/ring), radius, sombras, motion — via `@theme inline` do Tailwind 4 +
  `:root`/`.dark`. Light default; dark e white-label re-tematizam em runtime.
- **Fonte Geist + Geist Mono** via `next/font` (self-hosted) + script anti-flash de tema em
  [layout.tsx](../src/app/layout.tsx). Helper `cn` em [src/lib/ui/cn.ts](../src/lib/ui/cn.ts).
- **Primitivos** ([src/components/ui/](../src/components/ui/)): `Button`, `Spinner`, `Input`,
  `Textarea`, `Label`, `Field`, `Select`, `Alert`, `Card`, `Badge`, `PageHeader`,
  `EmptyState` + domínio `AppointmentStatusBadge`/`PaymentStatusBadge` (mapeiam a state
  machine C6 e os status de lançamento C9 para tons). CVA + `lucide-react`.
- **`/login` re-skinado** como prova visual.

### O que foi entregue (Fase 2 — shell & re-skin)

- **App shell** ([src/components/shared/app-shell.tsx](../src/components/shared/app-shell.tsx)
  + `app-sidebar.tsx` + `theme-toggle.tsx`): sidebar 268px com nav agrupada (itens futuros
  marcados "em breve"), theme toggle e drawer mobile com scrim.
- **Route-group `(app)/(shell)/`** com layout que aplica o shell só às rotas autenticadas
  (`dashboard`, `pacientes`, `account`). Login/forgot/reset e páginas de PDF ficam fora.
  **Nenhuma URL mudou.**
- **Re-skin**: `/dashboard` (visão geral com métricas placeholder + card de sessão),
  `/pacientes` (PageHeader + busca + lista/empty-state), editor de prontuário (Alert de
  assinado/conflito + Select + Textarea, lógica de auto-save intacta).

### Deps adicionadas (pin exato)

`geist 1.7.2`, `clsx 2.1.1`, `tailwind-merge 3.6.0`, `class-variance-authority 0.7.1`,
`lucide-react 1.17.0`.

### Validação

`pnpm typecheck` ✓ · `pnpm lint` ✓ · `pnpm build` ✓ (todas as rotas preservadas).
Verificação visual em navegador (`pnpm dev`) e dark mode pendentes de inspeção do founder.

### Débito / próximos

- Primitivos Radix-dependentes (Dialog/Tooltip/DropdownMenu/Drawer/Toast) ficam para
  quando a 1ª tela precisar (provavelmente C8).
- Geração da escala completa de white-label a partir de uma cor única.
- PROGRESS das camadas C6/C7 no corpo deste arquivo segue pendente (tabela do topo já
  reflete o status; corpo não foi preenchido).

---

## C8 — Consultório UI (✅ fechada em 2026-06-03)

Cockpit operacional do médico: `/consultorio` (kanban 3 colunas + faixa de check-in
+ prontuário inline). **Camada de apresentação + orquestração** — não recria nenhuma
regra de negócio; delega a C6 (state machine + actions com lock) e C7 (prontuário/
autosave/assinatura). ADR-019.

> **Nota (2026-06-03):** a **TV `/chamadas` foi descopada** a pedido do founder
> ("inútil no momento"). Removidos a rota, o botão "Chamar de novo", a gravação de
> chamada e a subscription Realtime de `chamadas`. A tabela `chamadas` +
> `recordChamada`/`listChamadas` ficam **dormentes** (migration é imutável). O texto
> abaixo descreve a entrega original; ver "Pós-review" no fim.

### O que foi entregue
- **Tabela `chamadas`** (Clinical; append-only; projeção de display p/ TV+board) +
  migration [0018_consultorio_chamadas.sql](../drizzle/migrations/0018_consultorio_chamadas.sql)
  (RLS ENABLE+FORCE `defaultTenantPolicy`, FKs cross-context, GRANTs, `REPLICA
  IDENTITY FULL` + inclusão de `chamadas`/`appointments` na publication
  `supabase_realtime`).
- **Action `recordChamada`** (Clinical) — idempotente, snapshota nome do paciente
  e do médico (= "SALA").
- **Leituras aditivas**: `patient.listPatientCards` (nome+alergias em lote),
  `clinical.getProntuarioByAppointment` + `listChamadas`, `scheduling.getCheckInTimes`
  + `getClinicTimezone`. (Scheduling C6 intocado: só reads aditivos.)
- **Orquestração** [consultorio/actions.ts](../src/app/(app)/(shell)/consultorio/actions.ts):
  `getBoard`, `loadAtendimento`, `callNextPatient` (start + garante prontuário síncrono
  + chamada), `recallPatient`, `checkInPatient`, `markAbsent`, `completeConsulta`,
  `signConsulta`, `emitPrescription`, `emitDocument`. Retornam `ActionResult` (sem redirect).
- **UI** `/consultorio` (board 25/50/25 + check-in strip + sala de espera + painel
  central reusando `ProntuarioEditor` C7 inline + ferramentas inline de prescrição/
  documento/assinatura + finalizadas read-only) e **TV** `/chamadas` (fullscreen,
  fora do `(shell)`). Hook [use-consultorio-realtime](../src/lib/realtime/use-consultorio-realtime.ts)
  (Realtime + polling backoff 5→10→15→30s + observabilidade). Link Consultório ativo
  no sidebar.
- **Docs**: ADR-019, runbook [c8-validation.md](runbooks/c8-validation.md).

### Decisões revisadas (review do founder)
Estado vazio do painel central; finalizadas **somente leitura** (correção pós-assinatura
= C10+); painel ativo = `selectedAppointmentId` client-side (default 1º em_atendimento);
bounds do board (hoje + unidade + 50/coluna); débito da TV-com-login; observabilidade
Realtime/polling; backoff progressivo; ADR para `chamadas` em Clinical.

### Validação
Estáticos: `typecheck` ✓ · `lint` ✓ · `arch:check` ✓ · `arch:db-check` ✓ ·
`check:migrations` ✓ · `check:registry` ✓ · `test` 192/192 ✓ (inclui `priority.test.ts`) ·
`db:migrate:dev` 0018 aplicada em qoro-dev ✓ · `build` ✓.

In-app (2026-06-03, in-app + verificação de banco): **14/15** dos testes do runbook
validados — check-in, chamar, prontuário inline, autosave, evento `completed`,
encerrar→centro esvazia, finalizadas read-only, Realtime em 2 abas <2s, concorrência
(só um vence), polling fallback (observado no Console). **RLS A/B confirmado via banco**
(contexto da clínica vê seus N appointments; qualquer outro tenant vê 0). #4 (TV)
**descopado**. Estrutura no banco: `chamadas`/`appointments` RLS ENABLE+FORCE + policy +
REPLICA IDENTITY FULL + na publication `supabase_realtime`.

### Pós-review (2026-06-03)
- **TV removida** (rota + wiring); `chamadas` dormente. (Eventual `0019_drop_chamadas`
  se quiser zero rastro.)
- **Bugfix C6 latente**: `listAppointments` usava `= ANY(${array})` (erro 42809 no
  postgres-js) → trocado por `inArray()` (lição do C4).
- **Performance do board**: `getBoard`/`loadAtendimento` reduzidos a 1 auth + leituras
  em paralelo + cache de timezone; painel central recarrega só em transição de status;
  polling de segurança (20s) **só quando o Realtime não está ao vivo**.
- **Painel inline**: deselect ao Encerrar (centro esvazia); finalizada com título e
  botão "Fechar" próprios.
- **Realtime/RLS**: `setAuth` via `onAuthStateChange` garante o JWT no canal (RLS por
  tenant no postgres_changes).
- **Dashboard** (`/dashboard`) reescrito a partir do mockup "Painel": KPIs reais de hoje
  (consultas/aguardando/em atendimento) + "Próximos na agenda" + placeholders honestos
  (Financeiro/IA "em breve"). Sem dados mockados (ADR-018).

### Débitos / riscos
- "SALA"/TV adiados (descopados).
- Worker outbox ~1×/dia (Hobby): prontuário criado de forma síncrona; handler async = no-op.
- Sem virtualização (meta 50 cards/coluna); cards memoizados.
- Latência alta só em dev contra banco remoto (Brasil→US-West); produção mesma região = sub-segundo.

### Atualização (2026-06-04) — auditoria de conformidade + testes automatizados
Auditoria do C8 (já fechado) + cobertura automatizada. Sem reabrir escopo; TV segue descopada.
- **Reconciliação de drift**: `chamadas` foi de fato **dropada** por `0019_drop_chamadas`
  (`DROP TABLE … CASCADE`). ADR-019 e o runbook `c8-validation` foram corrigidos (diziam
  "dormente/mantida"); os checks de RLS/Realtime passam a usar só `appointments` (que
  mantém `REPLICA IDENTITY FULL` + publication após o 0019).
- **Auditoria vs DS** (`Consulta (standalone)`): card da Sala de Espera e cabeçalho do
  painel passam a exibir **idade · sexo** (`42 anos · F`). `listPatientCards` agora
  projeta `data_nascimento`/`sexo` (plaintext, aditivo). "Indicador de retorno" já é
  carregado pelo `motivo` (nome do procedimento) — sem flag nova no modelo congelado.
- **Autosave**: badge do `ProntuarioEditor` virou tempo relativo ("Salvo agora" / "Salvo
  há N segundos" / "Salvo há 1 minuto"), conforme a spec.
- **Testes automatizados** (antes só `priority.test.ts` + validação manual):
  - `consultorio/board-logic.ts` (helpers puros extraídos de `actions.ts`, sem mudança de
    comportamento) + `board-logic.test.ts` (mapa de erro→banner, janela do dia DST-correct,
    idade/sexo, bucketização).
  - `scripts/smoke-c8.ts` (`pnpm smoke:c8`): estrutural (REPLICA IDENTITY FULL + publication
    + `chamadas` ausente), concorrência "apenas um vence" (FOR UPDATE), prontuário síncrono
    idempotente (`UNIQUE(appointment_id)`), encerrar→`completed` no outbox, RLS A/B em
    `appointments`+`prontuarios`.

---

## Remediação Forense pós-C10 (2026-06-10) — auditoria C0→C10 saneada

A auditoria forense total ([docs/AUDITORIA_C0_C10_COMPLETA.md](AUDITORIA_C0_C10_COMPLETA.md),
veredito **APROVADO COM RISCO**, 2 ALTA + 7 MÉDIA + 5 BAIXA) foi remediada
integralmente — **14/14 findings fechados**, zero HIGH, zero MEDIUM, contratos
C0→C10 preservados. Relatório completo:
[docs/remediation/REMEDIACAO_FORENSE_C0_C10.md](remediation/REMEDIACAO_FORENSE_C0_C10.md).

- **F-01/F-03/F-09:** agendamento 100% versionado em `vercel.json` (outbox 1min,
  reconcile 15min, `data-retention` mensal novo — purge de outbox terminal >30d
  + login_attempts >90d).
- **F-02 (ALTA):** hard-delete LGPD por paciente (savepoints) + **anonimização
  in-place** quando FK RESTRICT clínico bloqueia (ADR-021, implementa o passo 3
  do ADR-017); migration `0023` (`patients.anonymized_at`, aditiva);
  `lgpd_requests` ganha `completed`/`failed`.
- **F-04/F-05:** `setDoctorAvailability` e `buildSnapshot` exigem
  `role='doctor' AND ativo AND deleted_at IS NULL` sob RLS (mata a interferência
  cross-tenant do EXCLUDE global).
- **F-06:** heal do middleware revoga refresh token também no `drift` e deleta
  cookies fragmentados (`-auth-token.0/.1`).
- **F-07:** `arch:db-check` + `check:migrations` + `check:registry:strict`
  agora no CI — e o gate JÁ pegou 1 violação real latente (`number-store`
  fora da allowlist do AST, allowlistado como seam C10 documentado).
- **F-08:** advisory lock do worker agora é segurado pela DURAÇÃO do tick
  (lock-holder TX puro) — serialização real, validada por smoke 4.6.24.
- **F-10..F-14:** textos TTL 24h alinhados; anonimização unificada
  rota↔script; I/O de Storage bounded por timeout na TX do handler LGPD;
  chave do reconcile por período (re-armável); `check:registry --strict` com
  allowlist `PRODUCER_AHEAD` (19 eventos, fail-closed para entradas obsoletas).
- **Validação:** typecheck/lint/madge/arch-db/migrations/registry-strict ✓ ·
  **267 testes** (15 novos) ✓ · build ✓ · migration 0023 aplicada em qoro-dev ✓ ·
  `smoke:remediation` **7/7** (anonimização RESTRICT end-to-end + purge) ·
  `smoke:c4` **61/61** · `smoke:c5` **8/8**.

---

## C11 — AI Agent Base (✅ fechada em 2026-06-11)

Fundação completa do agente conversacional (Gemini Flash 2.5) sobre a infra de
mensagens da C10. Contratos congelados em [ADR-022](adr/022-ai-agent-foundation.md);
auditoria completa em [docs/audits/C11_IMPLEMENTATION_AUDIT.md](audits/C11_IMPLEMENTATION_AUDIT.md);
runbook [c11-validation.md](runbooks/c11-validation.md). O plano passou por
**2 rodadas de review do founder** (20 gaps G1–G10/R1–R10 — 18 implementados,
2 adiados por decisão explícita: intent-lite G5 e debounce anti-spam R9).

### O que foi entregue

- **`src/lib/ai/`** — `AIProvider` congelado; `GeminiProvider` via fetch cru
  (generationConfig CONGELADO temperature 0.1/topP 0.9 — R10); `OpenAIProvider`
  placeholder; circuit breaker closed/open/half-open (3 falhas → 5 min);
  cost table em código (tokens × $/1M).
- **Schema (migration 0024)** — `ai_conversations` (1 ativa por contato),
  `ai_messages` **particionada por mês** (12 partições + default; cron
  audit-partitions generalizado), `ai_clinic_config` (+`monthly_budget_usd` R4),
  `ai_handoff_queue`, `ai_agent_failures` (**dead letter de IA** G7, payload
  por whitelist R8). RLS ENABLE+FORCE nas 5. Emenda aditiva ao C10:
  `inbound_messages_raw.from_number_encrypted` (telefone de resposta) +
  `GRANT UPDATE (processed_at)` column-level.
- **Handler SAGA** de `messaging.inbound.received` — **LLM SEMPRE fora de
  transação** (R2, maior risco apontado na review); fases `withTenant` curtas;
  re-entrada idempotente por eventId com **replay determinístico** (out
  persistida → re-entrega NÃO re-chama o LLM); envio dedupado por
  `idempotencyKey = eventId`. Fluxo dos 10 passos do mandato intacto.
- **Guards anti-SAMD em 2 bordas** (G4): pré-filtro na mensagem do paciente
  (clínica → `CLINICAL_FALLBACK` com custo ZERO, sem Gemini) + pós-guard na
  resposta do LLM. Fallback literal único.
- **Tools com Zod nas 2 direções + whitelist** (G9/R5): `provide_clinic_info`,
  `provide_procedure_price` (via `api.scheduling.listProcedures` aditivo M14 —
  lazy context G3), `request_human_handoff`. Tool alucinada = security event.
- **Orçamentos congelados** (`limits.ts`): MAX_TOOL_ROUNDS=1 (G1), janela 10,
  prompt 10k, inbound 4k (G2), MAX_FALLBACKS=3 → handoff automático (R3).
- **Versionamento de prompt** (G8/R6): PROMPT_VERSION + PROMPT_HASH (sha256 do
  template) persistidos por turno; **snapshot de replay** gzip+cifrado com gate
  `AI_SNAPSHOT_MODE` full/sample/off (G10/R1).
- **Seam `messagingApiV1`** (C10→C11): getInboundForAgent (único decrypt point
  de inbound), markInboundProcessed, sendText. Evento publicado:
  `ai_agent.conversation.completed` (producer-ahead até C14/C15).

### Validação

`pnpm test` **334/334** ✓ · `pnpm smoke:c11` **18/18** ✓ (e2e qoro-dev pelo
worker REAL: isolamento 11.6.1, Zod 11.6.2, guard 11.6.3, breaker 11.6.4,
custo 11.6.5, handoff 11.6.6, RLS 11.6.7, encryption 11.6.8 + G1/G4/G7/G9/
G10/R1/R2/R3/R4) · **`pnpm ai:live-check` com Gemini REAL** ✓ (functionCall →
functionResponse → "funciona de segunda a sexta, das 08:00 às 18:00"; usage
real, custo $0.000462) · lint/arch:check/arch:db-check/check:migrations/
check:registry:strict/build ✓ · migration 0024 aplicada em qoro-dev ✓.

### Débitos / gate de avanço

Purge `expires_at` (C16) · quota real (C13) · `abandoned` 24h (C14) ·
intent-lite G5 e debounce R9 (adiados pelo founder) · breaker distribuído
(escala) · pós-guard flagga a própria recusa do modelo (benigno; nos mistos a
produção perde a metade operacional — refino candidato em C12).

**Gate de avanço p/ C12 (§11.12) — APROVADO em 2026-06-12**: bateria de 50
mensagens adversariais com Gemini REAL (`pnpm ai:adversarial`): **0 respostas
finais inseguras**, recusa 50/50 com o fallback literal (incl. 6 jailbreaks),
pré-filtro pegou 44/50 com custo zero. Evidência:
[docs/audits/C11_ADVERSARIAL_50.md](audits/C11_ADVERSARIAL_50.md).

## C12 — AI Agent Intents Core (✅ fechada em 2026-06-15)

Ref: [ADR-023](adr/023-ai-agent-intents.md). Plano passou por **5 rodadas de
review do founder**. O agente passou de conversacional (C11) a **executor**.

### Construído

- **Ator de sistema `ai_agent` (Phase 0/A)**: `idempotentMutation` ganhou `actor`
  opcional (backward-compatible); cores de mutação extraídos
  (`scheduling/internal/appointment-core.ts`, `patient/internal/patient-core.ts`)
  compartilhados por Server Action (ator `user`) e agente (`ai_agent`), validação
  idêntica (sem bifurcação — R5). APIs versionadas: `schedulingApiV1.{schedule,
  confirm,cancel,reschedule}AsAgent`, `patientApiV1` (findByPhone,
  createPatientAsAgent, createLgpdRequestPending, cpfMatchesPatient),
  `financialApiV1.listPendingByPatient`.
- **13 tools** (3 C11 + 10 C12), inputs string-only (conversor congelado intocado);
  identidade ancorada no telefone verificado (anti-spoofing); idempotência por
  conteúdo (sha256 conversa+intent+args — R1).
- **Memória de coleta** cifrada (`collected_data_encrypted`) + `COLLECT_STALE_RESET_DAYS`
  / `MAX_COLLECT_STAGNATION`; **sem context_drift** (R2). LGPD = intake + handoff
  (nunca cumpre — os handlers de evento cumprem). list_pending_payments sem valores
  por padrão (opt-in clínica). Injection = audit-only (R3). Email opcional
  unificado (migration 0025).

### Validação

`pnpm typecheck` ✓ · `pnpm test` **352/352** ✓ (334 + 18 novos: agentIdemKey R1,
identidade R6, detectPromptInjection) · `check:registry:strict` ✓ · `arch:db-check`
✓ · `check:migrations` ✓ · migration `0025` aplicada em qoro-dev (email
nullable+índice parcial, collected_data_encrypted, can_disclose_payments_via_agent).

- **`pnpm smoke:c12` 9/9 ao vivo (qoro-dev, worker REAL, Gemini stubado)**:
  12.1 paciente novo collect→createPatient ✓ · 12.5 idempotência por conteúdo
  (schedule 2× → 1 consulta, `idempotency.hit`) ✓ · 12.9 passado→fallback ✓ ·
  injection auditado (não bloqueia) ✓ · 12.3 LGPD delete → request pending +
  handoff, paciente NÃO soft-deletado ✓ · 12.7 cross-tenant (RLS) ✓.
- **gate de extração Phase 0**: `smoke:c5` 8/8 + `smoke:c6` 12/12 ✓ ·
  `pnpm ai:adversarial` **0 finais inseguras** (Gemini REAL) ✓.

### Pendente (não bloqueia a camada)

- WhatsApp real ponta-a-ponta (transporte Meta) — adiado pelo founder (conta
  Meta), validação de transporte/UX, não de lógica. Fluxo operacional §4.
- Débitos formais: ver "Known Future Refactors" no ADR-023.

---

## C13 — Tenancy & Billing (✅ fechada em 2026-06-17; verificada em prod 2026-06-18)

Cobrança das clínicas. Contratos congelados em [ADR-024](adr/024-plan-model.md)
(modelo de planos) + [ADR-025](adr/025-billing-architecture.md) (arquitetura).
Relatório completo: [docs/implementation/C13-BILLING-REPORT.md](implementation/C13-BILLING-REPORT.md).
**Asaas é infraestrutura atrás de um adapter — não o centro do billing.**

### O que foi entregue

- **Novo bounded context `src/contexts/billing/`** (schema + events + api + domínio
  puro: money, state-machine, dunning, access, annual-prepay, quota-policy).
  Asaas = **adapter único** (porta `PaymentProvider`), **sem multi-gateway**.
- **Source of truth dividida** (ADR-016/025): Asaas = pagamento; ClinicaOS = acesso.
  Money em `numeric(12,2)` + centavos no cálculo (nunca float). Transições
  **monotônicas** (`canTransition`) p/ webhook fora de ordem.
- **Migration 0026** — 16 tabelas (3 catálogos globais plans/prices/plan_limits
  read-only + 4 plataforma só-service_role + 9 tenant-scoped + ledger), `ALTER TYPE
  clinic_status ADD VALUE pending_payment`, RLS FORCE, GRANTs **sem DELETE**, seed
  idempotente de planos/preços/limites.
- **17 eventos `billing.*`** ([contrato](contracts/events/billing.md)); consumers
  ativos de metering: `scheduling.appointment.created` + `ai_agent.conversation.completed`
  (demais producer-ahead p/ C14/timeline/Identity-onboarding).
- **Quota** = teto anti-abuso (ADR-024): contagem via ledger idempotente; gate
  síncrono `checkAndIncrementQuota`; **usuários** trava dura (`assertUserQuota`),
  agendamento nunca bloqueia, IA degrada. IA deduplicada por `conversationId`
  (desvio documentado — evento não traz telefone p/ "1×/24h por número").
- **Rotas**: webhook `/api/webhooks/asaas` (dedup via `processed_webhooks`), crons
  `billing-dunning` (08:00 UTC) e `billing-reconcile` (09:00 UTC).
- `clinics.status` é write privilegiado (D31) → transição de acesso roda via `dbAdmin`
  (webhook/crons), nunca `withTenant` authenticated.

### Validação

- **Unit** `vitest run src/contexts/billing` → **21/21** (money, refund pro-rata,
  dunning+grace, access mapping, state-machine monotônica, quota-policy).
- **`pnpm smoke:c13` 8/8** (provisionamento `pending_payment`, webhook
  PAYMENT_RECEIVED → invoice paid + clínica reativada, dunning D+30 → suspended,
  quota idempotente, RLS A≠B).
- Gates: typecheck/lint/`arch:db-check` (0 findings)/`check:registry:strict`/
  `check:migrations` ✓. Migration 0026 aplicada em qoro-dev.
- **Asaas REAL** (`billing:live-check` + `billing:live-roundtrip`): customer +
  subscription ACTIVE no sandbox; provisionamento com persistência local.
- **Round-trip de webhook REAL em produção (§16, 2026-06-18)**: clínica
  `pending_payment` → Asaas `PAYMENT_RECEIVED` → `/api/webhooks/asaas` → `processed`;
  clínica `active`, invoice materializada + `paid`, subscription `active`; replay →
  `duplicate`. **2 bugs de deploy corrigidos** (commits f17dcb9, 249ddde): webhook
  não materializava invoice em ciclo recorrente (`ensureInvoiceForPayment` trata
  `PAYMENT_CREATED` out-of-order) + middleware sequestrava o webhook (`api/webhooks/*`
  fora do matcher — corrige também o webhook Meta da C10, mesmo bug latente).

### Débito técnico ACEITÁVEL (camada de onboarding — fora do escopo C13)

- **UI `/checkout`** não construída (backend `provisionTenant` pronto/testado).
- **Owner-creation (Identity)**: evento + seam + allowlist prontos; criação de
  auth-user (Supabase admin) é integração de onboarding.
- **Login gate em middleware**: predicado `isLoginBlocked` pronto, falta plugar
  (`pending_payment`/`suspended`/`cancelled` → não loga, exceto owner).
  `requireActiveClinic` (bloqueio de ESCRITA) já implementado/testado; falta o
  rollout nas mutations dos demais contextos.
- **PROIBIDO e não introduzido (verificado)**: overage/pay-as-you-go, feature-flags
  por plano, entitlements engine, multi-gateway, múltiplos cartões, upgrade/downgrade UI.

---

## C14 — Proactive Jobs (✅ fechada em 2026-06-18)

A clínica **fala primeiro** no WhatsApp via template Meta. Contratos em
[ADR-026](adr/026-proactive-jobs.md); runbook [c14-validation.md](runbooks/c14-validation.md).
**C14 é transporte**: a regra de "quem recebe" mora no contexto-fonte; a resposta
(SIM/NÃO/REMARCAR) é do C11.

### O que foi entregue

- **REGRA DE OURO**: quem **ENVIA é um cron determinístico, nunca o LLM**. Reativo
  (interpretar resposta) continua sendo do agente (C11). 3 tipos de job: **lembrete
  D-1** (prevenção de no-show), **dunning paciente D+3/D+7** (inadimplente), **followup**
  (retorno pedido pelo médico).
- **Migration 0027** — `ai_proactive_jobs`. Enqueue cross-tenant (read-models por
  fonte) + claim via CTE `claimDue` com `FOR UPDATE SKIP LOCKED` + janela
  `AT TIME ZONE` (envio só 8–20h local).
- **Policy LGPD/suppression**: `suppression_list` (canal whatsapp) → job `cancelled`
  (`suppressed`); **dunning exige `cobranca_whatsapp=true`** (lembrete/followup são
  transacionais, não exigem o flag).
- **At-most-once no Meta**: `outbound_messages.idempotency_key = ai_proactive_jobs.id`
  (chave estável). Backoff 30s→5m→30m→6h, MAX 5 (igual outbox).
- **3 crons** `proactive-{reminders,dunning,followup}` (`*/15 11-23 * * *` = janela
  8–20h BRT). Handler de followup ativo no registry.

### Validação

- **`pnpm test` 388 passed** (tz dias-calendário, policy suppression/consent,
  processor T1/T2/T5/T6). Gates typecheck/lint/`arch:db-check` (0 findings)/
  `check:registry:strict` (catalog 44 ⇔ registry 11)/`check:migrations` ✓.
- **`pnpm smoke:c14` 8/8** contra qoro-dev (getProactiveContact decrypt+consent,
  suppression, reminder enqueue+DEDUP, dunning D+3/D+7, guard "pagou→não envia",
  `claimDue` CTE/SKIP LOCKED + janela, followup via worker, RLS A↔B).
- Cobertura §14.6: **T1** ativo→job→cron→enviado; **T2** suppression→cancelled;
  **T5** dunning pago→`already_paid`; **T6** falha Meta→retry/backoff→failed.
  **T3/T4** (SIM/REMARCAR) são do C11/C12 (inbound webhook → tools confirm/reschedule).

### Pendente (go-live, não bloqueia a camada)

- Aplicar 0027 em **prod**; cadastrar + **aprovar 3 templates no Meta** (`confirmation_reminder`,
  `dunning_friendly`, `followup_return`) + setar `META_TEMPLATE_*_ID`/`META_TEMPLATE_LANG`;
  Vercel **Pro** (agora 11 crons); cada clínica com número WhatsApp conectado (C10).
- Gate §14.7: validar 1 ciclo D-1 (lembrete→resposta→confirmação) com 5 pacientes reais.
- Débitos: reconciliação delivery-callback (`unknown→sent`) C15/C16; trim mensal de
  `ai_proactive_jobs` C16; `smoke-c14.ts` automatizado coberto pela validação manual.

---

## C15 — Platform Admin (✅ fechada em 2026-06-20)

Painel do fundador (`/admin`, admin.qoro.dev): **read-only sobre dados de clínica**,
com impersonate auditado como única forma de mutar. Aceite manual completo em
[docs/testesC15.md](testesC15.md) (mapa de cobertura do brief no fim do doc).

### O que foi entregue

- **404 absoluto** (regra suprema do brief): qualquer não-`super_admin` em **AAL2**
  recebe **404** (igual a rota inexistente — nunca redirect/"unauthorized"/"forbidden").
  Guard único [_lib/guard.ts](../src/app/(admin)/admin/_lib/guard.ts); o route handler
  de export também é gateado (não é porta lateral).
- **Impersonate (núcleo de segurança)** — [src/lib/impersonation/](../src/lib/impersonation/):
  tabela `impersonation_sessions` é a **fonte autoritativa** (TTL 1h via `expires_at`,
  kill switch `revoked_at`, 1 ativa por super_admin); **cookie carrega só o id assinado**
  (HMAC); **step-up de MFA** `requireRecentAal2(10)` ao iniciar; **banner vermelho
  permanente** e inescondível em toda tela tenant; **mutação durante impersonate gera
  auditoria EXTRA atômica** (`impersonate_mutation` em `super_admin_actions` na MESMA tx
  do `withTenant`, payload `{impersonationId, auditEventId}` casando com a linha de
  `audit_events`).
- **Migration 0028** — `impersonation_sessions` (global protected: `is_super_admin()`
  SELECT, escrita via dbAdmin/service_role) + `GRANT INSERT ON super_admin_actions TO
  authenticated` (a auditoria extra entra sob role authenticated durante o impersonate;
  policy `super_admin_actions_super_insert` da 0008 já gateia por `is_super_admin()`;
  append-only mantido — sem UPDATE/DELETE).
- **8 áreas** (repos read-only em [_lib/repositories/](../src/app/(admin)/admin/_lib/repositories/)):
  Visão geral/**MRR** (= `SUM(invoices.total_amount)` pagas no mês, sem cache), Clínicas
  (lista+detalhe agregado), Billing (abertas/vencidas/dunning/refunds, nada editável),
  **Conversas IA** (decrypt **server-side** — ciphertext nunca cruza p/ o browser; falha
  de decrypt → `"[conteúdo indisponível]"`), Métricas (DAU/WAU/custo Gemini), Auditoria
  cross-tenant, **Saúde** (probe ativo Supabase/Gemini/Meta/Asaas a cada load — mede
  disponibilidade, não volume), Config (read-only).
- **Export PDF de auditoria** ([audit-export.service.tsx](../src/app/(admin)/admin/_lib/services/audit-export.service.tsx)):
  SHA256 no rodapé do PDF == hash na tela, signed URL 7 dias (bucket privado
  `admin-exports`), `super_admin_actions` recebe `audit_export` com `{from,to,sha256,rowCount}`.

### Validação

- **408 testes unitários** (guard 404, HMAC do cookie, step-up MFA, hash do export,
  conversão de centavos, arch read-only). typecheck/lint/`arch:db-check`/`check:migrations` ✓.
  Migration 0028 aplicada em dev **e prod**. Bucket `admin-exports` criado (dev/prod).
- **Aceite manual** (`docs/testesC15.md`, `pnpm seed:c15` → `clinica-demo`): acesso/404,
  MRR bate com SQL, impersonate (start/banner/mutação-extra/stop/TTL/kill switch/step-up),
  billing read-only, conversas IA decrypt server-side + browser sem ciphertext, métricas,
  auditoria, export PDF (hash+signed URL), saúde (Gemini/Meta vermelho/amarelo), config
  read-only, regressão tenant (mutação normal NÃO gera `super_admin_actions`). **Todos os
  itens do brief marcados** (teste 10.1 do health do Asaas resolvido).

### Débito / próximos

- Anti-fullscan super_admin: endpoints admin paginam por default (CONVENTIONS); read
  replica dedicada entra em ~50+ clínicas.
- Reconciliação delivery-callback do C14 (`unknown→sent`) e demais hardening operacional
  ficam para **C16 (Observabilidade & Hardening)** — última camada pendente.

---

## C15 — Platform Admin · expansão operacional (✅ 2026-06-22)

Follow-up do C15 (**NÃO** é a camada C16 do roadmap, que segue pendente). Transforma
`/admin/config` de somente-leitura em **console de controle operacional da plataforma**
(estado GLOBAL, nunca dado de clínica). Spec:
[admin-config-expansion.md](implementation/admin-config-expansion.md).

### Fundação (3 tabelas global-protected — ADR-007 §10)
- **Migration 0029** — `platform_settings` (flags key-value), `cron_heartbeats` (última
  execução por job), `platform_announcements` (avisos globais). RLS ENABLE+FORCE; SELECT a
  `authenticated` (settings/announcements), `cron_heartbeats` ops-only; escrita só
  service_role. **Migration 0030** — `platform_announcements.title` (aditiva).
- **Reader** `src/lib/platform-settings/` — `getPlatformSetting` com cache de 30s por
  instância e **fail-safe** (erro → default seguro; config nunca derruba operação).
- **Action** `setPlatformFlagAction` via `superAdminAction` (auditada; `fn(tx)` = tx dbAdmin
  → o arquivo NÃO importa dbAdmin, compatível com `admin-read-only.test`).
- `arch-db-check` allowlist estendido (readers/writer de plataforma).

### Kill-switches (consumidos no hot path)
- `proactive_jobs.enabled=false` → crons `proactive-*` retornam `{skipped:'disabled'}` ANTES
  de varrer dados.
- `ai_agent.mode=fallback_only` → handler `inbound-received` responde `OPERATIONAL_FALLBACK`
  + `escalateToHuman`, **custo 0, ZERO Gemini** (provado pelo smoke).

### Dashboards read-only
- **Saúde dos jobs** (`jobs-health.repo` + `recordHeartbeat` no fim de cada cron) — SLA por
  job derivado do `vercel.json`. (Em dev só popula o que você dispara; em prod, todos.)
- **Retenção & partições** (`retention.repo`) — cobertura audit_events/ai_messages (default
  >0 = alerta), idempotency_keys vencidas, proactive_jobs por status.
- **Integrações** — inventário `Boolean(env.X)` (nunca o valor) + versão/hash do prompt.

### Broadcast (pop-up único, sem "manutenção")
- Decisão de produto: software clínico **não para** — o conceito de "manutenção" foi
  **removido**. Aviso virou **pop-up único** (modal título+corpo, dispensável uma vez por
  usuário via localStorage), não banner fixo. `AnnouncementPopup` + helper de dismissal puro
  (testado). Reader `getActiveAnnouncement` (cache 30s) plugado no shell tenant.

### Perfil clínico (import do Claude Design)
- `/admin/clinicas/[id]` reescrito conforme o design (`ClinicaOS - Admin.html`): header de
  perfil (`.phead`: capa, avatar, status/plano, 5 mini-stats), `kv-list` (Dados/Plano),
  `ai-kpis` + `integ-list`, tabela de usuários, auditorias e export — **só com dado real**
  (campos não rastreados omitidos, sem mock — ADR-018). CSS portado para `_admin/admin.css`.

### Perf — débito latente do C15 corrigido
- `getCurrentUser` agora **memoizado por request** (`React.cache`): require* o chamavam N×,
  cada um refazendo `getClaims()` + (impersonate) `resolveImpersonation()` → 20+ round-trips
  sequenciais (12–27s contra banco remoto em dev). Request-scoped → revogação vale no próximo request.

### Validação
- typecheck/lint/`arch:db-check` ✓ · **412 testes** · **`pnpm smoke:admin-config` 6/6**
  (RLS+FORCE, write-boundary, reader fail-safe, heartbeat UPSERT, broadcast ignora expirado,
  **IA fallback_only sem Gemini**) · migrations 0029/0030 aplicadas em dev (0029 também em prod).
- **Aceite manual**: RLS A/B, kill-switch proativo, Broadcast publish/deactivate auditados,
  pop-up único, Saúde/Retenção/Integrações com dado real, perfil clínico, impersonate rápido
  pós-memoização.

### Pendente (vai pro C16 real)
- `cron_heartbeats` só popula em prod (Vercel) — em dev os crons não rodam.
- `scripts/create-clinic.ts` / botão "Criar clínica" = onboarding interino (spec separada).

---

## Refatoração UI/UX — Design System v2 (em andamento, iniciada 2026-07-02)

Plano em 8 ondas (cada onda = 1 PR): fundação → primitivos → shell/estados →
dashboard+consultório → pacientes/agenda/caixa → financeiro/config/equipe →
admin → auth/join+limpeza. Governança permanente em CONVENTIONS §Governança de UI.
Checklist mestre: [ui-refactor/ui-inventory.md](./ui-refactor/ui-inventory.md).

### Onda 0 — Fundação (✅ 2026-07-02) · ADR-031

- **Rebrand DS v2** (`design_system/DSv2.html` = fonte única de UI): petrol (hue 205)
  substitui azul 258; clay = acento único/IA; neutros quentes (98–108) + `--neutral-150`;
  Hanken Grotesk + Inter (display) + IBM Plex Mono substituem Geist (dep removida).
- `globals.css` reescrito como **única origem de tokens** (viz, elevação/z nomeadas,
  densidade `[data-density]`, component hooks, `--focus-ring`); bloco de tokens duplicado
  do `ds.css` **removido** (redefinia tudo por cima, incl. `--font-sans:"Geist"`).
- Dark por duplo seletor `.dark`/`[data-theme='dark']`; ~28 `oklch(... 258)` hardcoded
  do CSS legado → vars petrol; anti-flash de tema corrigido (lia chave errada
  `theme` vs `clinicaos-theme` — nunca funcionou).
- Validação: typecheck ✓ · build ✓ · lint/test/arch ✓ · visual light+dark.

### Onda 1 — Biblioteca de primitivos (✅ 2026-07-02)

- **Radix entra** (pin exato; gatilho do ADR-018 disparado): dialog, dropdown-menu,
  popover, tooltip, switch, checkbox, tabs. **Sem cmdk** (decisão do founder).
- `src/components/ui/` ganha: `dialog` + `drawer` (mesmo Radix Dialog posicionado) +
  `confirm-dialog` (ações críticas), **toast** (`use-toast` store singleton sem Context +
  `toaster` + `use-action-feedback` que aposenta o padrão `msg` nas ondas seguintes),
  `skeleton`(+Card/Table), **Table kit** RSC-first (`table`, `table-toolbar`,
  `table-sort-header` e `table-pager` dirigidos por URL, `table-selection-bar`),
  `tabs`/`nav-tabs`, `stat-card` unificado, `breadcrumbs`, `switch`, `checkbox`,
  `segmented`, `button-group`.
- **Restyle retrocompatível** dos existentes (API/variantes preservadas; testes das
  telas seguem verdes): button (variantes reais do DS: primary/accent/danger/ghost/
  soft/subtle + secondary/success compat), input/textarea/select/field/label/date-field,
  card, badge (tones históricos → paleta DS; teal/violet via viz-8/viz-3), alert,
  empty-state. Componentes novos NÃO usam classes do ds.css.
- **Ícones unificados**: `painel/icons.tsx` virou re-export lucide (nomes históricos
  mapeados); código novo importa lucide direto.
- Validação: typecheck ✓ · lint ✓ · **496 testes** (14 novos: CVA, toast store,
  use-action-feedback) · arch ✓ · build ✓. Nenhuma tela alterada nesta onda.

### Onda 2 — Shell, navegação e estados de UI (✅ 2026-07-02)

- **Shells reescritos em Tailwind** (DS v2 §side/topbar): peças compartilhadas em
  `shared/shell-chrome.tsx` + `shared/use-theme.ts` (zero duplicação entre painel
  e admin); sidebar 256px; mobile drawer sem `body.nav-open`.
- **UX honesta no topbar**: busca ⌘K fake e sino de notificações sem feature
  REMOVIDOS; bloco de usuário virou menu real (Segurança da conta + **Sair** —
  o tenant não tinha logout visível); chevron fake do clinic-switcher removido.
- **Estados**: 13 `loading.tsx` via `PageSkeleton` (6 variantes); `error.tsx` por
  segmento (shell/admin) + root com `RouteError` (Sentry+retry); `not-found.tsx`.
- `Toaster` + `TooltipProvider` montados nos dois shells; `PageHeader` recomposto
  (Breadcrumbs/`font-display`), prop `breadcrumb` legada preservada.
- **Desvio documentado**: `app-shell.css` NÃO foi deletado (telas ainda usam
  `stat-tile/cardblock/listrow/cols-*` — critério grep-zero do plano falha);
  shells não dependem mais dele; deleção na onda do último consumidor.
- Validação: typecheck ✓ · lint ✓ · 496 testes ✓ · build ✓ · smoke em `next start`.
- **Hotfixes 2.1–2.3 (QA do founder)**: mobile drawer (z-index), respiro da sidebar,
  `.input-wrap > input`, tema único + Sair no tenant, pattern /v do telefone,
  new-clinic-modal → Dialog, e a CAUSA RAIZ: CSS legado unlayered vencia as
  utilities (`*{margin:0}` matava toda margem; `.grid` legado vencia `nav:hidden`)
  → os 4 CSS legados agora vivem em `@layer components`. Diagnóstico e prova com
  Chrome headless + puppeteer (computed styles + screenshots).

### Onda 3 — Dashboard + Consultório (✅ 2026-07-02)

- **Dashboard** decomposto em `_components/` (PanelCard, RevenueChart CSS com
  paleta viz, ActivityFeed, ActivationChecklist); stat tiles → `StatCard` (ui);
  fake removido (breadcrumb "Clínica Vida", segmented Hoje|Semana); status via
  `AppointmentStatusBadge` canônico. Zero classes legadas na rota.
- **Consultório**: cartão de sessão vivo (tempo na clínica + toolbar EMITIR);
  prescrição/documento em **Drawer**, assinatura em **Dialog crítico**;
  `atendimento-tools.tsx` (634 linhas) eliminado; feedback via toast.
  **Anti-vazamento**: Finalizadas com badge "Sem cobrança" (getBoard compõe
  pendências do Financial, best-effort).
- Validação: typecheck/lint/496 testes ✓; screenshots headless light+dark
  (board + dashboard com fixtures); build adiado (dev do founder ativo).

---

## Veja também

- [README.md](./README.md) — índice mestre da documentação.
- [PlanoAção.md](./PlanoAção.md) — o plano de implementação por trás deste status.
- [adr/README.md](./adr/README.md) — decisões congeladas por camada.
- [documentation-audit.md](./documentation-audit.md) — inclui o achado da referência quebrada a `testesC15.md`.
