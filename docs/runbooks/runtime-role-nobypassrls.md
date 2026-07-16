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

-- como postgres, sem withTenant:
SELECT count(*) AS pacientes, count(DISTINCT clinic_id) AS clinicas FROM patients;
-- 4 | 2   ← enxerga as DUAS clínicas. É o vazamento.
```

> O `count(DISTINCT clinic_id)` é o que prova o cross-tenant; `count(*)` sozinho não diz
> de quantas clínicas os dados são.

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

> ⚠️ **ONDE validar: no ambiente que TEM dado cross-tenant — hoje só o `qoro-dev`**
> (2 clínicas / 4 pacientes). O `qoro-prod` tem **1 clínica e 0 pacientes**: lá os testes
> A/C/D devolvem `0` por **falta de dado**, não por segurança — e um `0` vazio *parece*
> aprovação. Não há o que vazar num banco sem dado. Em prod, a validação é o **Passo 4**
> (o app continuar funcionando), não estes SELECTs.

Cada bloco é **auto-contido**: escolhe sozinho uma clínica que tenha pacientes e imprime
um **veredito**. Nada de `<placeholder>` — a policy compara **texto**
(`(clinic_id)::text = current_setting(...)`, sem cast p/ uuid), então um placeholder
esquecido **não dá erro**: compara com o literal, não bate, e devolve `0` em silêncio,
que é exatamente o valor de "passou". Foi assim que a 1ª versão deste runbook enganou.

Para testar sem a connection string, `postgres` precisa poder assumir o role:
`GRANT qoro_runtime TO postgres;` (quem criou o role tem ADMIN OPTION).

```sql
-- A) O BUG DE HOJE (role do pool atual). DEVE dizer "VAZA".
--    `count(*)` sozinho não prova nada: o que importa é count(DISTINCT clinic_id) > 1.
SELECT current_user::text AS role_efetivo,
       count(*) AS pacientes_visiveis,
       count(DISTINCT clinic_id) AS clinicas_visiveis,
       CASE
         WHEN count(*) = 0 THEN 'INCONCLUSIVO: sem pacientes neste ambiente'
         WHEN count(DISTINCT clinic_id) > 1 THEN 'VAZA: enxerga ' || count(DISTINCT clinic_id) || ' clinicas sem withTenant'
         ELSE 'INCONCLUSIVO: so 1 clinica com dados — nao da para provar cross-tenant'
       END AS veredito
  FROM patients;
```

```sql
-- B) FAIL-CLOSE: o mesmo esquecimento, no role novo. DEVE ser 0.
BEGIN;
SET LOCAL ROLE qoro_runtime;
SELECT current_user::text AS role_efetivo,
       count(*) AS pacientes_visiveis,
       CASE WHEN count(*) = 0 THEN 'FAIL-CLOSE: 0 linhas, nao vaza' ELSE 'AINDA VAZA' END AS veredito
  FROM patients;
COMMIT;
```

```sql
-- C) O CAMINHO NORMAL não pode quebrar (é o que o withTenant faz). DEVE ser > 0.
--    O set_config roda ANTES do SET ROLE, como postgres — por isso enxerga `clinics`
--    para escolher a clínica sozinho.
BEGIN;
SELECT set_config('app.current_clinic',
                  (SELECT c.id::text FROM clinics c JOIN patients p ON p.clinic_id = c.id
                    GROUP BY c.id ORDER BY count(*) DESC LIMIT 1),
                  true) AS clinica_escolhida;
SET LOCAL ROLE qoro_runtime;
SET LOCAL ROLE authenticated;
SELECT current_user::text AS role_efetivo,
       count(*) AS pacientes_visiveis,
       CASE WHEN count(*) > 0 THEN 'OK: caminho normal (withTenant) funciona'
            ELSE 'FALHOU: withTenant nao devolve nada — grant ou GUC errado' END AS veredito
  FROM patients;
COMMIT;
```

```sql
-- D) ISOLAMENTO cross-tenant. Só é conclusivo se HAVIA dado de outra clínica para vazar
--    — senão o "0" é vacuidade, não isolamento.
BEGIN;
SELECT set_config('app.current_clinic',
                  (SELECT c.id::text FROM clinics c JOIN patients p ON p.clinic_id = c.id
                    GROUP BY c.id ORDER BY count(*) DESC LIMIT 1),
                  true);
SELECT set_config('app.total_outras', (SELECT count(*)::text FROM patients
   WHERE clinic_id::text <> current_setting('app.current_clinic', true)), true) AS existiam_para_vazar;
SET LOCAL ROLE qoro_runtime;
SET LOCAL ROLE authenticated;
SELECT current_setting('app.total_outras', true)::int AS pacientes_de_outra_clinica_no_banco,
       count(*) FILTER (WHERE clinic_id::text <> current_setting('app.current_clinic', true)) AS vazaram,
       CASE
         WHEN current_setting('app.total_outras', true)::int = 0 THEN 'INCONCLUSIVO: nao havia dado de outra clinica'
         WHEN count(*) FILTER (WHERE clinic_id::text <> current_setting('app.current_clinic', true)) = 0
              THEN 'OK: isolado (havia ' || current_setting('app.total_outras', true) || ' para vazar e nao vazou)'
         ELSE 'VAZOU CROSS-TENANT' END AS veredito
  FROM patients;
COMMIT;
```

**Resultado no qoro-dev (2026-07-15) — 2 clínicas / 4 pacientes:**

| | Veredito |
|---|---|
| **A** | `VAZA: enxerga 2 clinicas sem withTenant` (4 pacientes) — o A3 reproduzido |
| **B** | `FAIL-CLOSE: 0 linhas, nao vaza` — o mesmo esquecimento, contido |
| **C** | `OK: caminho normal (withTenant) funciona` (2 pacientes) |
| **D** | `OK: isolado (havia 2 para vazar e nao vazou)` |

## Passo 4 — validação em produção (é outra coisa)

Com prod sem dado cross-tenant, o que se valida lá **não é o vazamento** (não há o que
vazar) — é se os **grants** estão certos e o app não quebrou:

1. Env `DATABASE_URL_RUNTIME` setada → redeploy.
2. `pnpm smoke:c5` (paciente) + abrir o painel e navegar (agenda, caixa, prontuário).
3. **Qualquer `permission denied for table X` = grant faltando no Passo 1**, não erro de
   RLS. É o modo de falha esperado se algo der errado — e o rollback é imediato.
4. Quando prod tiver ≥ 2 clínicas com dado, rodar A/B/C/D lá também.

## Rollback

**Remover a env `DATABASE_URL_RUNTIME` e redeploy.** O pool volta ao `DATABASE_URL` na
hora ([db/index.ts](../../src/lib/db/index.ts) faz `env.DATABASE_URL_RUNTIME ?? env.DATABASE_URL`).
Não precisa dropar o role nem mexer em schema. É o motivo de o desenho ser opt-in.

## Estado

| Ambiente | Dados | Role criado | Senha | `DATABASE_URL_RUNTIME` | Validado |
|---|---|---|---|---|---|
| **qoro-dev** (`pqhkirrszzpwezdaqrai`) | 2 clínicas / 4 pacientes | ✅ 2026-07-15 (sem senha) | ⬜ founder | ⬜ | ✅ **A/B/C/D provados** (Passo 3) |
| **qoro-prod** (`shlcbxawrxuaebazuiue`) | 1 clínica / **0 pacientes** | ✅ 2026-07-15 | ⬜ founder | ⬜ | ⬜ Passo 4 (smoke) — A/C/D são **inconclusivos** sem dado cross-tenant |

**Ordem recomendada:** fechar dev (senha + env + smoke) → observar → repetir em prod.
Não há pressa de agenda, mas o gatilho é **antes do 1º cliente pagante**: depois, um
`withTenant` esquecido custa dado de cliente real — e é justamente quando prod passa a
ter dado cross-tenant de verdade, tornando o A/B/C/D conclusivo lá.
