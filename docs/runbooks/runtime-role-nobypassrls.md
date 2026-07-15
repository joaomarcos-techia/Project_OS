# Runbook — Role runtime sem BYPASSRLS (fail-close real do `withTenant`)

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-15 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice de runbooks](./README.md) · [índice mestre](../README.md).

> **D1** do [PROGRESS §Dívida técnica pós-C16](../PROGRESS.md). Origem: achado **A3** da
> [auditoria de APIs](../achados/auditoria-apis-seguranca.md) e a Correção **F-01** do
> [ADR-007](../adr/007-rls-implementation-patterns.md).

## O problema, em uma frase

O pool `db` conecta como `postgres`, que tem **`rolbypassrls = true`**. Se um caminho
tenant esquecer o `withTenant`, a query roda com BYPASSRLS e **vaza cross-tenant** — não
falha fechado. Hoje o único obstáculo é *tooling* (`arch-db-check` AST no CI + ESLint),
não o banco.

**Confirmado empiricamente no qoro-dev (2026-07-15):**

```sql
SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = 'postgres';
-- postgres | true
SELECT count(*) FROM patients;   -- como postgres, sem withTenant → 4 (as DUAS clínicas)
```

## A correção

Um role de login **sem BYPASSRLS** para o pool runtime. Sem BYPASSRLS, uma query que
escape do `withTenant` roda sem o GUC `app.current_clinic` e sem claims → a policy
dual-context resolve falso → **0 linhas**. O código já suporta: `DATABASE_URL_RUNTIME`
([db/index.ts](../../src/lib/db/index.ts)) é **opt-in** — ausente, nada muda.

`dbAdmin` e `dbWorker` **continuam** no `DATABASE_URL` (precisam de BYPASSRLS por design).

### Por que não é uma migration

O role tem **senha** (não pode ir para um `.sql` versionado) e é **por ambiente**. É
provisionamento de infra, não schema. Por isso vive aqui.

## Passo 1 — criar o role (por ambiente)

Já aplicado em **qoro-dev** (2026-07-15), **sem senha** de propósito. Para prod, o mesmo:

```sql
CREATE ROLE qoro_runtime LOGIN NOBYPASSRLS;

-- Habilita o `SET LOCAL ROLE authenticated` que o withTenant faz. Sem isto o app
-- quebra inteiro — é o passo que não pode faltar.
GRANT authenticated TO qoro_runtime;

GRANT USAGE ON SCHEMA public TO qoro_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO qoro_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO qoro_runtime;

-- Tabelas/sequences FUTURAS (migrations novas) — sem isto, a próxima tabela nasce
-- inacessível ao runtime e o app quebra só naquele caminho.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO qoro_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO qoro_runtime;
```

⚠️ **`ALTER DEFAULT PRIVILEGES` só vale para objetos criados pelo role que rodou o
comando.** As migrations rodam como `postgres`, então rode os dois `ALTER` **como
`postgres`** — que é o caso ao usar o SQL Editor do dashboard ou o MCP.

## Passo 2 — senha + connection string

1. Supabase Dashboard → SQL Editor: `ALTER ROLE qoro_runtime PASSWORD '<senha forte>';`
   (gere no gerenciador de senhas; **não** cole em chat/PR/issue).
2. Monte a URL no mesmo formato do `DATABASE_URL`, trocando só o usuário:
   `postgresql://qoro_runtime.<project-ref>:<senha>@<host-do-pooler>:6543/postgres?sslmode=require`
3. Vercel → Environment Variables → `DATABASE_URL_RUNTIME` (por ambiente) → redeploy.

## Passo 3 — validação (**obrigatória**)

Sem estes 4 cenários provados, o D1 está **configurado, não feito**. Rode contra o
ambiente-alvo. Para testar sem a connection string, `postgres` precisa poder assumir o
role: `GRANT qoro_runtime TO postgres;` (o `postgres` criou o role, então tem ADMIN OPTION).

```sql
-- A) o bug de hoje (role do pool atual): DEVE vazar
SELECT count(*) FROM patients;                       -- > 0, e de mais de uma clínica

-- B) fail-close: o mesmo esquecimento no role novo
BEGIN;
  SET LOCAL ROLE qoro_runtime;
  SELECT count(*) FROM patients;                     -- DEVE ser 0
COMMIT;

-- C) o caminho normal NÃO pode quebrar (é o que o withTenant faz)
BEGIN;
  SET LOCAL ROLE qoro_runtime;
  SET LOCAL ROLE authenticated;
  SELECT set_config('app.current_clinic', '<uuid-de-uma-clinica>', true);
  SELECT count(*) FROM patients;                     -- DEVE ser > 0
COMMIT;

-- D) isolamento cross-tenant preservado
BEGIN;
  SET LOCAL ROLE qoro_runtime;
  SET LOCAL ROLE authenticated;
  SELECT set_config('app.current_clinic', '<uuid-clinica-A>', true);
  SELECT count(*) FILTER (WHERE clinic_id <> '<uuid-clinica-A>') FROM patients;  -- DEVE ser 0
COMMIT;
```

**Resultado no qoro-dev (2026-07-15):** A = 4 (vazou, as 2 clínicas) · B = **0**
(fail-close) · C = 2 (caminho normal intacto) · D = 0 de outra clínica (isolado).

Depois do deploy com a env: rodar `pnpm smoke:c5` (paciente) e abrir o painel — qualquer
`permission denied for table X` significa **grant faltando** no passo 1, não erro de RLS.

## Rollback

**Remover a env `DATABASE_URL_RUNTIME` e redeploy.** O pool volta ao `DATABASE_URL` na
hora ([db/index.ts](../../src/lib/db/index.ts) faz `env.DATABASE_URL_RUNTIME ?? env.DATABASE_URL`).
Não precisa dropar o role nem mexer em schema. É o motivo de o desenho ser opt-in.

## Estado

| Ambiente | Role criado | Senha | `DATABASE_URL_RUNTIME` | Validado |
|---|---|---|---|---|
| **qoro-dev** (`pqhkirrszzpwezdaqrai`) | ✅ 2026-07-15 (sem senha) | ⬜ pendente (founder) | ⬜ pendente | ✅ A/B/C/D provados via `SET ROLE` |
| **qoro-prod** (`shlcbxawrxuaebazuiue`) | ⬜ | ⬜ | ⬜ | ⬜ |

**Ordem recomendada:** fechar dev (senha + env + smoke) → observar → repetir em prod.
Não há pressa de agenda, mas o gatilho é **antes do 1º cliente pagante**: depois, um
`withTenant` esquecido custa dado de cliente real.
