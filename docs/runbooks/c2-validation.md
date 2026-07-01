# C2 — Runbook de Validação

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice de runbooks](./README.md) · [índice mestre](../README.md).


> Re-executável após qualquer mudança em `src/contexts/tenancy/**`,
> `src/lib/db/rls.ts`, `src/lib/db/tenant.ts`,
> `drizzle/migrations/0001_tenancy_foundation.sql`, ou helpers SQL
> (`current_clinic_id`, `current_platform_role`, `is_super_admin`,
> `set_updated_at`, `check_clinic_slug`).

## Pré-requisitos

- [x] C1 fechada (`docs/PROGRESS.md` mostra ✅)
- [x] `qoro-dev` Supabase project acessível via `DATABASE_URL`
- [x] `psql` 17+ no PATH (`psql --version`)
- [x] `.env.local` contém `DATABASE_URL` válido

## Test G — GATE PRÉ-IMPLEMENTAÇÃO

Rodar ANTES de escrever qualquer schema/policy/helper de C2 (ou qualquer
camada futura que estenda esse modelo). Se falhar, a hierarquia D24 não
está sustentada no ambiente — replanejar antes de continuar.

```bash
cd "<repo>"
set -a && source .env.local && set +a
PGCLIENTENCODING=UTF8 psql "$DATABASE_URL" --no-psqlrc -X -c "
BEGIN;
SET LOCAL ROLE authenticated;
SELECT current_role;
COMMIT;
SELECT current_role;
"
```

**Esperado:**
- Dentro da TX: `authenticated`
- Após COMMIT: `postgres` (ou o role original do pool — `postgres.<projectref>`)

**Se falhar** (`permission denied to set role "authenticated"` ou role
errada): hardening D4 indisponível. FORCE RLS + dual-context absorvem
operacionalmente, mas defesa em profundidade está comprometida — abrir
follow-up ADR antes de seguir.

## Seed (idempotente — admin role bypassa RLS)

```sql
INSERT INTO clinics (id, slug, nome, status) VALUES
  ('11111111-1111-1111-1111-111111111111','clinica-a','Clinic A','trial'),
  ('22222222-2222-2222-2222-222222222222','clinica-b','Clinic B','trial')
ON CONFLICT (id) DO NOTHING;
INSERT INTO clinic_units (id, clinic_id, nome) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','Matriz A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222','Matriz B')
ON CONFLICT (id) DO NOTHING;
```

## Bateria de testes (executar em ordem)

Toda transação começa com `SET LOCAL ROLE authenticated` quando o teste
simula um caller pós-pool. `set_config('app.current_clinic', ...)`
simula o GUC injetado por `withTenant` (jobs/workers).
`set_config('request.jwt.claims', ...)` simula o JWT que C3 trará via
Supabase Auth.

### 2.6.1 — authenticated + GUC A lê apenas A

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('app.current_clinic','11111111-1111-1111-1111-111111111111', true);
SELECT slug FROM clinics ORDER BY slug;  -- expect: clinica-a
COMMIT;
```

### 2.6.2 — anon lê zero

```sql
BEGIN;
SET LOCAL ROLE anon;
SELECT count(*) FROM clinics;  -- expect: 0
COMMIT;
```

### 2.6.3 — super_admin JWT lê todas

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"super_admin"}', true);
SELECT count(*) FROM clinics;  -- expect: 2
COMMIT;
```

### 2.6.4 — slug reservado bloqueado

```sql
INSERT INTO clinics (slug, nome, status) VALUES ('app','x','trial');
-- expect ERROR: Slug reservado: app
```

### 2.6.5 — slug format check

```sql
INSERT INTO clinics (slug, nome, status) VALUES ('AB CDE','x','trial');                      -- check fail
INSERT INTO clinics (slug, nome, status) VALUES ('ab','x','trial');                          -- check fail
INSERT INTO clinics (slug, nome, status) VALUES ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','x','trial'); -- check fail (31 chars)
INSERT INTO clinics (slug, nome, status) VALUES ('valido-ok-123','x','trial');               -- aceito
```

### 2.6.6 — UPDATE em clinics por tenant bloqueado (D31)

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('app.current_clinic','11111111-1111-1111-1111-111111111111', true);
UPDATE clinics SET nome='hack-own'   WHERE id='11111111-1111-1111-1111-111111111111';  -- 0 rows
UPDATE clinics SET nome='hack-other' WHERE id='22222222-2222-2222-2222-222222222222';  -- 0 rows
COMMIT;
```

D31: UPDATE em `clinics` é super_admin only em C2. Edição funcional pelo
gestor vem em C3 via Server Action que usa `dbAdmin` + audit (C4).

### 2.6.7 — DELETE em clinics (tenant 0, super_admin 1 + cascade)

```sql
-- 7a: tenant tenta DELETE
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('app.current_clinic','22222222-2222-2222-2222-222222222222', true);
DELETE FROM clinics WHERE id='22222222-2222-2222-2222-222222222222';  -- 0 rows
ROLLBACK;

-- 7b: super_admin DELETE de B + cascade em clinic_units
SELECT count(*) FROM clinic_units WHERE clinic_id='22222222-2222-2222-2222-222222222222';  -- 1
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"super_admin"}', true);
DELETE FROM clinics WHERE id='22222222-2222-2222-2222-222222222222';  -- 1 row
COMMIT;
SELECT count(*) FROM clinic_units WHERE clinic_id='22222222-2222-2222-2222-222222222222';  -- 0

-- Restore B for downstream tests
INSERT INTO clinics (id, slug, nome, status) VALUES ('22222222-2222-2222-2222-222222222222','clinica-b','Clinic B','trial');
INSERT INTO clinic_units (id, clinic_id, nome) VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222','Matriz B');
```

### 2.6.8 — clinic_units same-tenant via dual-context

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('app.current_clinic','11111111-1111-1111-1111-111111111111', true);
SELECT nome FROM clinic_units;  -- expect: Matriz A
COMMIT;
```

### 2.6.9 — current_role dentro de withTenant (PIVÔ D21)

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('app.current_clinic','11111111-1111-1111-1111-111111111111', true);
SELECT current_role;  -- expect: authenticated
COMMIT;
SELECT current_role;  -- expect: postgres (ou o role do pool)
```

**Se `current_role` for diferente de `authenticated` dentro da TX:**
hardening está quebrado. Investigar privilégio do role do pool antes
de qualquer release de C2.

### 2.6.10 — write em _reserved_slugs como authenticated bloqueado

```sql
BEGIN;
SET LOCAL ROLE authenticated;
INSERT INTO _reserved_slugs (slug, reason) VALUES ('test-write','should-fail');
-- expect ERROR: new row violates row-level security policy for table "_reserved_slugs"
ROLLBACK;
```

D34: `_reserved_slugs` tem apenas SELECT policy. FORCE RLS bloqueia
INSERT/UPDATE/DELETE por default. Mutations apenas via `dbAdmin`.

### 2.6.11 — pool reuse safety (RESET ROLE após COMMIT)

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT current_role;  -- expect: authenticated
COMMIT;
SELECT current_role;  -- expect: postgres
```

`SET LOCAL` morre com COMMIT. Conexões reaproveitadas pelo pool NÃO
herdam o role/GUC do request anterior. Validado em conjunto com Test G
no PASSO 0.

### Bonus 1 — UPDATE clinic_units same-tenant via GUC sem JWT (D22)

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('app.current_clinic','11111111-1111-1111-1111-111111111111', true);
UPDATE clinic_units SET nome='matriz-a-upd' WHERE id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';  -- 1 row
ROLLBACK;
```

Comprova que workers/jobs (sem JWT) podem editar via `withTenant`.

### Bonus 2 — UPDATE clinic_units cross-tenant via GUC bloqueado

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('app.current_clinic','11111111-1111-1111-1111-111111111111', true);
UPDATE clinic_units SET nome='hack-cross' WHERE clinic_id='22222222-2222-2222-2222-222222222222';  -- 0 rows
ROLLBACK;
```

## Checklist anti-vazamento PRE-MERGE

- [ ] `\d+ clinics` mostra `Row security: enabled` E `Force row security: enabled`.
- [ ] Mesmo para `clinic_units` e `_reserved_slugs`.
- [ ] `_schema_version` está em estado admin-only — aceitar EITHER `rls=f, force=f` (estrito D20) OR `rls=t, force=f, sem policies` (Supabase auto-enabled, equivalente; ver ADR-007 §10 cat 3). Validar:
      `SELECT relname, relrowsecurity AS rls, relforcerowsecurity AS force_rls FROM pg_class WHERE relname='_schema_version';`
- [ ] `\d clinic_units` lista `clinic_units_clinic_id_idx`.
- [ ] `SELECT polname FROM pg_policy WHERE polrelid = 'clinics'::regclass` retorna 4 (SELECT/INSERT/UPDATE/DELETE).
- [ ] `SELECT polname FROM pg_policy WHERE polrelid = 'clinic_units'::regclass` retorna 1 (FOR ALL).
- [ ] `SELECT polname FROM pg_policy WHERE polrelid = '_reserved_slugs'::regclass` retorna 1 (SELECT).
- [ ] Funções SQL existem: `\df current_clinic_id | current_platform_role | is_super_admin | set_updated_at | check_clinic_slug` — 5 funções, todas `SECURITY INVOKER`, helpers SQL são `STABLE`.
- [ ] **Migration 0002 aplicada** — função grants têm PUBLIC removido. Validar:
      `SELECT routine_name, grantee FROM information_schema.routine_privileges WHERE specific_schema='public' AND routine_name='is_super_admin' ORDER BY grantee;`
      Esperado: 4 linhas (`anon, authenticated, postgres, service_role`); **nenhuma com `PUBLIC`**.
- [ ] Todos os 11 testes 2.6.x passam + 2 bonus.
- [ ] Test G executado novamente como confirmação final.

## Pitfalls — operando psql

### `BEGIN` aninhado e claim residual (verificado empiricamente, round 5)

Em psql, `BEGIN` dentro de uma transação ativa **NÃO** cria sub-transação — gera apenas `WARNING: there is already a transaction in progress` e segue na mesma TX. Sub-transações exigem `SAVEPOINT`.

Consequência prática: `SELECT set_config('request.jwt.claims', '{...}', true)` aplicado dentro do que parece ser uma "nova" transação **persiste** até o `COMMIT` da transação outermost. Se você fizer red team via psql e ver vazamento aparente, **investigue primeiro se está num único TX**.

**Reprodução do gotcha (que confunde para "vazamento"):**
```sql
BEGIN;                                                                         -- T1
BEGIN;                                                                         -- WARNING, ainda T1
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"super_admin"}', true);        -- claim aplicado a T1
SELECT * FROM clinics;                                                          -- vê todas (super_admin OK)
BEGIN;                                                                         -- WARNING, ainda T1
SET LOCAL ROLE authenticated;
SELECT set_config('app.current_clinic','11111111-...', true);                   -- GUC adicionado a T1
SELECT (SELECT nome FROM clinics WHERE id='22222222-...');                      -- ⚠️ retorna 'Clinic B' — claim super_admin ainda ativo!
COMMIT;                                                                         -- T1 finalmente termina
```

**Como testar corretamente:** uma TX por tentativa. Cada bloco com `BEGIN ... COMMIT;` independente, ou use `SAVEPOINT s; ... ROLLBACK TO SAVEPOINT s;` para isolar dentro da mesma sessão (que limpa set_config — ver abaixo).

### `SAVEPOINT` rollback restaura `set_config(..., is_local=true)` (verificado round 5)

```sql
BEGIN;
SELECT set_config('app.current_clinic','A',true);
SAVEPOINT sp;
SELECT set_config('app.current_clinic','B',true);  -- sobrescreve GUC
SELECT current_setting('app.current_clinic');      -- 'B'
ROLLBACK TO SAVEPOINT sp;
SELECT current_setting('app.current_clinic');      -- volta para 'A'
COMMIT;
```

Útil para testes adversariais — permite reset rápido dentro de uma sessão psql longa.

### Pool reuse safety (2.6.11, verificado round 5)

`SET LOCAL` (role e GUC) é transaction-scoped. Após `COMMIT`, conexão volta ao estado padrão. Em produção isso garante que requests HTTP reaproveitando conexão do pool NÃO herdam contexto do request anterior. Validado em PASSO 0.

## Troubleshooting

| Sintoma | Causa provável | Ação |
|---|---|---|
| Test G falha com `permission denied to set role "authenticated"` | Privilégio do role do pool revogado | Pool role já não tem `GRANT authenticated`. FORCE + dual-context absorvem operacionalmente; abrir follow-up ADR |
| 2.6.1 retorna 0 rows mesmo com GUC setado | GUC não persistiu (SET LOCAL fora de TX) | Confirmar `BEGIN` antes de `set_config` |
| 2.6.6 retorna 1 row (UPDATE funcionou) | Policy `clinics_superadmin_update` está ausente ou tem `USING (true)` | `\d+ clinics`; recriar policy |
| 2.6.9 retorna role errado dentro da TX | `SET LOCAL ROLE authenticated` falhou silenciosamente | Test G falhou; ver primeira linha desta tabela |
| `_reserved_slugs.reason` retorna NULL inesperadamente | Seed não rodou ou foi sobrescrito | `SELECT count(*) FROM _reserved_slugs` deve ser ≥ 22 |
| 2.6.4 não bloqueia | Trigger `trg_check_clinic_slug` ausente | `\d clinics` deve listar o trigger |
| Migration falha com `extension "pgcrypto" already exists` | NOTICE, não erro | OK, ignorar |
