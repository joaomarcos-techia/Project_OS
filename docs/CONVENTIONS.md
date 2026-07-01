# Convenções ClinicaOS

Este documento é a lei viva do projeto. Edita junto com o PR que muda a convenção. Não decide caso novo aqui — vira ADR primeiro, depois rebaixa o resumo aqui.

## Naming (congelado em C0)

| Camada | Convenção | Exemplo |
|---|---|---|
| Arquivos | `kebab-case` | `tenant-context.ts`, `agent-config.ts` |
| Pastas | `kebab-case` | `src/contexts/ai-agent/` |
| Identificadores TS | `camelCase` | `clinicId`, `createdAt` |
| Tipos / Componentes | `PascalCase` | `CreatePatientRequest`, `PatientCard` |
| Constantes env | `SCREAMING_SNAKE` | `DATABASE_URL`, `LOG_LEVEL` |
| Tabelas DB | `snake_case` plural | `patients`, `appointments`, `outbox_events` (decisão C1) |
| Colunas DB | `snake_case` | `clinic_id`, `created_at`, `deleted_at` |
| Foreign keys | `<entity>_id` | `patient_id`, `clinic_id` |
| Server Actions | verbo no início | `createPatient`, `confirmPayment` |
| DTOs | sufixo `Request`/`Response` | `CreatePatientRequest`, `PatientResponse` |
| Eventos outbox | `<entity>.<verb>` lowercase | `patient.created`, `appointment.completed` |

Drizzle converte `snake_case` ↔ `camelCase` automaticamente entre DB e TS.

## Imports e path aliases

- **Path alias `@/*` → `src/*`** sempre. Proibido `../../../foo` (lint: `import/no-relative-parent-imports` em arquivos `src/contexts/`).
- **Matriz de imports** (enforced por `eslint-plugin-boundaries` em `eslint.config.mjs`):

| FROM \ TO | context | lib | app | component |
|---|---|---|---|---|
| **context** | ❌ | ✅ | ❌ | ❌ |
| **lib** | ❌ | ✅ | ❌ | ❌ |
| **app** | ✅ | ✅ | ✅ | ✅ |
| **component** | ❌ | ✅ | ❌ | ✅ |

- **Cross-context** será permitido SOMENTE via `@/contexts/<X>` (resolvendo no `index.ts` do contexto) e somente para chamadas explícitas em `api.ts` ou tipos de evento em `events.ts`. Estrutura definitiva entra quando o primeiro contexto materializar (C2 com tenancy).
- **`internal/`** (futuro): tudo dentro de `src/contexts/<X>/internal/` é privado ao contexto. Override de boundary precisa de `// eslint-disable-next-line boundaries/element-types -- <razão>` com motivo escrito.

## Estrutura de pasta de um contexto (definida quando o primeiro contexto for materializado em C2)

Placeholder esperado:
```
src/contexts/<name>/
├── README.md          # responsabilidade
├── index.ts           # re-export de api.ts e events.ts (superfície pública)
├── api.ts             # funções tipadas que outros contexts chamam
├── events.ts          # tipos de eventos emitidos (schemas Zod)
├── types.ts           # DTOs públicos
├── schema.ts          # schema Drizzle (re-export central em src/lib/db/schema/)
└── internal/          # tudo privado: services, repos, handlers, use-cases
```

Hoje (C0) só existe `README.md`. Resto entra com a primeira camada do contexto.

## Convenções "a definir" (com camada de origem)

| Convenção | Camada que define | O que será |
|---|---|---|
| Schema DB (tipos, defaults, índices) | C1 | Drizzle schema, helpers de RLS, `withTenant` |
| RLS policies | C2 ✅ | Helper `defaultTenantPolicy()` em [src/lib/db/rls.ts](../src/lib/db/rls.ts); SQL helpers `current_clinic_id()` / `is_super_admin()` instalados pela migration `0001_tenancy_foundation.sql`; ADR-007 fixa os padrões |
| Custom claims JWT, Roles | C3 | Auth hook Supabase, `requireClinicId()` |
| Outbox eventos cross-context | C4 | `emitEvent(tx, ...)`, schemas Zod por evento |
| Audit log | C4 | `auditLog(tx, ...)` síncrono na mesma TX |
| Idempotency keys | C4 | Header `idempotency-key`, tabela `idempotency_keys` |
| Encryption per-tenant (dados de paciente) | C5 | KMS key por clínica |
| Server Actions error handling | C5+ | Padrão `Result<T> = {ok,data} \| {ok:false,code,message}` |
| Erros tipados (AppError hierarchy) | quando 2º consumidor real aparecer (PlanoAção 1.4) | Hierarquia de classes |
| Logger estruturado (Pino + correlation) | C16 | Structured JSON logs com `req_id`, `clinic_id`, `user_id` |

## Comentários e documentação no código

- Default: **NÃO escreva comentários.** Bom naming substitui.
- Escreva quando: WHY não-óbvio (invariante escondida, workaround de bug específico, restrição externa).
- Nunca: explicar O QUE (já está no código), referenciar PR/issue (vive no git), declarar "TODO: refatorar depois" (PlanoAção 1.5: 3 TODOs na semana = pare e refatore).

## Testes

- Vitest unit, co-localizado: `foo.ts` + `foo.test.ts` lado a lado.
- Integration tests **não mockam DB** (PlanoAção). Rodam contra `qoro-dev`.
- E2E: só em C16, se necessário. MVP solo founder não justifica antes.

## Anti-padrões proibidos (sinais de hidra)

- 🚫 `src/lib/utils.ts` genérico — vira lixeira inevitavelmente. Use `src/lib/<topic>/`.
- 🚫 `src/types/index.ts` central — tipos vivem perto do código que os usa.
- 🚫 `JOIN` SQL cross-context.
- 🚫 `console.log` em código de produção (lint: `no-console` exceto `warn`/`error`).
- 🚫 `import { X } from '@/contexts/other/internal/...'` — lint barra.
- 🚫 Versão `^` em libs críticas (Next, React, Drizzle, Supabase) — fixar exato.
- 🚫 Comentário "TODO refatorar" sem data ou contexto. Se for premissa pra camada futura, escreva `TODO[Cn]: ...`.
- 🚫 Tabela tenant-scoped sem RLS — ver template abaixo.
- 🚫 Policy `USING (true)` ou `FOR ALL TO public` — catastrófico, vaza tudo.
- 🚫 Role check (`gestor`, `owner`, etc.) dentro de RLS policy — ADR-007 D27: RLS isola tenants, RBAC mora em Server Actions via `requireRole(...)`.
- 🚫 `ENABLE ROW LEVEL SECURITY` sem `FORCE` em tabela tenant-scoped — owner bypassa policies.

## Checklist nova tabela (PR template — colar no corpo do PR)

ADR-007 §10 define três categorias. Marque exatamente uma e cumpra o bloco correspondente.

```markdown
### Checklist nova tabela — anti-vazamento

**Passo 1 — Categorizar (ADR-007 §10):** marque UMA opção.
- [ ] **Tenant-scoped** — possui `clinic_id` FK. Use bloco A.
- [ ] **Global protected** — sem `clinic_id`, mas não public (ex.: feature_flags, ai_prompts, billing_catalog). Use bloco B.
- [ ] **Operational metadata** — sem dado sensível (ex.: `_schema_version`). Use bloco C. **EXIGE justificativa por escrito.**

**Bloco A — tenant-scoped:**
- [ ] Schema usa `tenantIdRef()` de `@/contexts/tenancy` (FK + ON DELETE CASCADE)
- [ ] Coluna `clinic_id` declarada como `NOT NULL`
- [ ] Índice B-tree em `clinic_id` via `index(...)` no Drizzle (D9 — Postgres não cria auto)
- [ ] Helper `defaultTenantPolicy('<table>')` invocado; SQL contém fingerprint `GENERATED_BY: defaultTenantPolicy(v1)`
- [ ] `ENABLE` + `FORCE` ROW LEVEL SECURITY na MESMA migration do `CREATE TABLE`
- [ ] Trigger `set_updated_at` vinculado (se tabela tem `updated_at`)
- [ ] **NÃO** há check de role funcional na policy (D27 — RBAC mora no app)
- [ ] Autorização funcional implementada em Server Action via `requireRole(...)` (se aplicável)
- [ ] Teste manual: `SET ROLE authenticated; SET LOCAL app.current_clinic = '<A>'; SELECT count(*) FROM <table> WHERE clinic_id = '<B>'` retorna 0
- [ ] Teste manual: `SET ROLE anon; SELECT * FROM <table>` retorna 0 rows
- [ ] `\d <table>` mostra Force row security: enabled
- [ ] `EXPLAIN ANALYZE` de query típica usa index scan, não seq scan
- [ ] ADR ou referência a ADR-007 se policy customizada (não default)

**Bloco B — global protected:**
- [ ] `ENABLE + FORCE ROW LEVEL SECURITY`
- [ ] Policy super_admin-only OU padrão semântico tipo `_reserved_slugs` (read-authenticated/write-via-dbAdmin)
- [ ] Comentário SQL inline explica POR QUÊ não é tenant-scoped
- [ ] Teste manual: `SET ROLE anon; SELECT * FROM <table>` → 0 rows OU acesso esperado (documentar)
- [ ] Teste manual: como `authenticated` sem claim super_admin, tentativa de write é rejeitada

**Bloco C — operational metadata (RARO):**
- [ ] Justificativa por escrito no PR explicando por que NÃO é categoria A nem B
- [ ] Comentário SQL inline marcando a exceção
- [ ] Referência a ADR ou linha em ADR-007 documentando o caso
```

## Anti-fullscan super_admin (ADR-007 + planejamento C15)

Policies super_admin (`is_super_admin()`) avaliam `true` antes do filtro `clinic_id`, fazendo o planner descartar o predicado de seletividade — queries sem `WHERE clinic_id = ...` viram seq scan. Em C15:

- Endpoints admin paginate por default (`LIMIT 100 OFFSET ...` ou cursor)
- Dashboards globais (MRR, churn) usam agregados materializados, não `SELECT count(*) FROM appointments` cross-tenant
- Nunca expor endpoint admin sem `LIMIT`
- Read replica dedicada para super_admin entra quando queries começarem a competir com runtime (~50+ clínicas)

---

## Threat Model resumido (canônico em ADR-007 — esta seção é o atalho)

### ABSOLUTAMENTE PROIBIDO em código de aplicação

1. 🚫 `SELECT set_config('request.jwt.claims', ...)` — GUC pertence a PostgREST/Auth. Empíricamente comprovado: setá-lo com `{"role":"super_admin"}` em sessão `authenticated` bypassa todo isolamento. Workers/scripts usam `withTenant()` (NÃO toca esse GUC).
2. 🚫 `db.<query>()` direto em código tenant-scoped — o pool roda como role com BYPASSRLS. Use `withTenant()`.
3. 🚫 `dbAdmin.<query>()` fora dos paths allowlisted (`src/app/(admin)/`, `src/app/api/admin/`, `scripts/`) — ESLint enforça.
4. 🚫 `SET ROLE` para qualquer role com BYPASSRLS dentro de Server Actions / handlers tenant-scoped.
5. 🚫 Tabelas tenant-scoped sem `FORCE ROW LEVEL SECURITY`.
6. 🚫 Policies sem `defaultTenantPolicy()` sem justificativa SQL + ADR.
7. 🚫 `CREATE FUNCTION` sem `REVOKE EXECUTE ... FROM PUBLIC` + `GRANT EXECUTE ... TO anon, authenticated, service_role` (invariante #11 ADR-007).
8. 🚫 `auth.jwt() ->> 'X'` literal em policy — use helpers `current_clinic_id()` / `current_platform_role()` / `is_super_admin()`.

### GARANTIAS estruturais

1. JWT claims em runtime HTTP vêm SOMENTE de PostgREST após validação de assinatura.
2. `withTenant(clinicId, fn)` é o único setter aprovado de `app.current_clinic`. Não toca `request.jwt.claims`.
3. `app.current_clinic` é confiável APENAS dentro da transação em que foi setado. SAVEPOINT rollback restaura valor anterior.
4. FORCE RLS garante isolamento mesmo se SET LOCAL ROLE quebrar em ambientes futuros.
5. `pg_policy` é a única fonte da verdade de regras de acesso — código de aplicação NUNCA reimplementa lógica de isolamento.

---

## Templates (copy/paste em PRs C3+)

### Template — nova tabela tenant-scoped (Drizzle)

`src/contexts/<context>/schema.ts`:

```typescript
import { sql } from 'drizzle-orm';
import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { tenantIdRef } from '@/contexts/tenancy';
import { timestampsPattern, uuidPk } from '@/lib/db/types';

export const myTable = pgTable(
  'my_table',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),                          // FK + ON DELETE CASCADE
    // ... colunas de negócio ...
    ...timestampsPattern(),
  },
  (t) => ({
    clinicIdx: index('my_table_clinic_id_idx').on(t.clinicId),   // D9 obrigatório
  }),
);
```

### Template — migration tenant-scoped (SQL custom append à migration gerada por drizzle-kit)

```sql
-- Append AO arquivo gerado pelo `pnpm db:generate`, depois do CREATE TABLE.
-- Mantém a migration atômica (tabela + RLS + trigger nascem juntas).

-- Trigger updated_at
CREATE TRIGGER trg_my_table_updated_at
  BEFORE UPDATE ON my_table
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- RLS via helper
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE my_table FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY my_table_tenant_access ON my_table FOR ALL
  USING (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  )
  WITH CHECK (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  );
```

### Template — migration de função custom (invariante #11)

```sql
CREATE OR REPLACE FUNCTION public.my_helper(...) RETURNS ... AS $$ ... $$ LANGUAGE sql STABLE;
--> statement-breakpoint

-- OBRIGATÓRIO: revogar PUBLIC + grant explícito
REVOKE EXECUTE ON FUNCTION public.my_helper(...) FROM PUBLIC;--> statement-breakpoint
GRANT  EXECUTE ON FUNCTION public.my_helper(...) TO anon, authenticated, service_role;
```

### Template — query segura (C3+ Server Action / Worker)

```typescript
import { requireClinicId } from '@/lib/auth/tenant-context';  // C3 — JWT-backed
import { withTenant } from '@/lib/db/tenant';
import { myTable } from '@/contexts/<context>/schema';

// HTTP Server Action (C3+)
export async function listMyThings() {
  const clinicId = await requireClinicId();                    // valida JWT
  return withTenant(clinicId, async (tx) => {
    return tx.select().from(myTable);                          // RLS já aplica
  });
}

// Worker / Job (sem JWT)
export async function processJob(job: { clinicId: string }) {
  // Caller é responsável por verificar autorização do job
  return withTenant(job.clinicId, async (tx) => {
    return tx.select().from(myTable);
  });
}
```

### Template — query INCORRETA (rejeitar em PR)

```typescript
// ❌ Direct query — bypassa RLS pelo role do pool
const all = await db.select().from(myTable);

// ❌ dbAdmin em código tenant-scoped — ESLint barra
import { dbAdmin } from '@/lib/db';

// ❌ Forjar claim
await db.execute(sql`SELECT set_config('request.jwt.claims','{"role":"super_admin"}',true)`);

// ❌ Re-implementar isolamento manual em vez de confiar na RLS
const all = await db.select().from(myTable).where(eq(myTable.clinicId, X));  // bypassa pool
```

---

## Veja também

- [README.md](./README.md) — índice mestre da documentação.
- [engineering/decision-guide.md](./engineering/decision-guide.md) — fluxo "isto precisa de ADR/migration/evento?" que usa o checklist acima.
- [adr/007-rls-implementation-patterns.md](./adr/007-rls-implementation-patterns.md) — o Threat Model canônico (esta doc é o atalho).
- [documentation-authority.md](./documentation-authority.md) — precedência quando docs discordam.
