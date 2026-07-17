# Runbook — Role runtime sem BYPASSRLS (fail-close real do `withTenant`)

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-16 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice de runbooks](./README.md) · [índice mestre](../README.md).

> **D1** do [PROGRESS §Dívida técnica pós-C16](../PROGRESS.md). Origem: achado **A3** da
> [auditoria de APIs](../achados/auditoria-apis-seguranca.md) e a Correção **F-01** do
> [ADR-007](../adr/007-rls-implementation-patterns.md).

---

## ⚡ Situação (2026-07-16) — leia antes de executar qualquer passo

**Os Passos 1 e 2 já foram feitos nos DOIS ambientes.** Não refaça. Verificado no banco e
na Vercel — ver [§Estado](#estado) e [§Como conferir sem adivinhar](#como-conferir-o-estado-sem-adivinhar).

**Falta uma coisa só: o deploy da branch `docs/identity-practitioner-model` → `main`.**

O D1 está **provisionado mas INERTE em produção**: o `main` **não lê**
`DATABASE_URL_RUNTIME` (nem `db/index.ts`, nem `env.ts`) — o código que consome a env vive
na branch. Prod tem a env configurada e a ignora; o pool segue no `DATABASE_URL`, com
BYPASSRLS. **No deploy o fail-close liga sozinho**, sem passo manual — e só então o
[Passo 4](#passo-4--validação-em-produção-é-outra-coisa) faz sentido.

> Este runbook foi escrito com os passos na ordem de execução, o que faz uma leitura
> top-down **parecer** que nada está feito. É a armadilha que a memória deste repo chama
> de "doc afirma o que não existe" — aqui, ao contrário: a doc esconde o que **já** existe.
> Daí este bloco no topo.

---

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

## Como conferir o estado (sem adivinhar)

**Rode isto ANTES de executar qualquer passo.** Um `SELECT` responde se o Passo 1 está
feito — não precisa lembrar, nem perguntar, nem presumir:

```sql
SELECT
  (SELECT count(*) FROM pg_roles  WHERE rolname='qoro_runtime')                 AS role_existe,
  (SELECT rolbypassrls FROM pg_roles WHERE rolname='qoro_runtime')              AS tem_bypassrls,   -- DEVE ser false
  (SELECT rolpassword IS NOT NULL FROM pg_authid WHERE rolname='qoro_runtime')  AS tem_senha,
  pg_has_role('qoro_runtime','authenticated','MEMBER')                          AS pode_set_role_authenticated,
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE grantee='qoro_runtime' AND table_schema='public')                     AS tabelas_com_grant,
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE')                    AS tabelas_no_schema;

-- Tabelas FUTURAS herdam grant? (o ALTER DEFAULT PRIVILEGES — o passo esquecível)
SELECT pg_get_userbyid(defaclrole) AS criado_por, defaclobjtype AS tipo, defaclacl::text AS privs
  FROM pg_default_acl
 WHERE defaclnamespace = 'public'::regnamespace
   AND array_to_string(defaclacl, ',') ILIKE '%qoro_runtime%';
```

**Resultado em prod (2026-07-16) — tudo verde:**

```
role_existe: 1 · tem_bypassrls: false · tem_senha: true
pode_set_role_authenticated: true · tabelas_com_grant: 396 · tabelas_no_schema: 98
default_acl: qoro_runtime=arwd (tabelas 'r') · qoro_runtime=rU (sequences 'S')
```

`396 = 98 tabelas × 4 ops` (SELECT/INSERT/UPDATE/DELETE). Se esse número for **menor que
4× as tabelas**, algum grant faltou.

E a env, sem abrir o dashboard:

```powershell
pnpm dlx vercel env ls        # DATABASE_URL_RUNTIME → Production, Preview (desde 2026-07-15)
```

> **Por que esta seção existe:** eu (Claude) repeti "falta o D1 em prod" por várias
> mensagens **sem nunca ter rodado estas queries**. Estava tudo feito havia um dia. É a
> mesma falha que este repo cataloga — afirmar sem verificar — só que ao contrário:
> cobrando trabalho já entregue. Um `SELECT` teria evitado.

## Passo 1 — criar o role (por ambiente) · ✅ FEITO em dev e prod

> ✅ **Já aplicado em `qoro-dev` e `qoro-prod`** (2026-07-15/16). Confira com a query
> acima antes de rodar de novo. O SQL fica aqui para o **próximo ambiente** (preview
> dedicado, restore-test) e para auditoria do que foi feito.

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

## Passo 2 — senha + connection string · ✅ FEITO em dev e prod

> ✅ **Senha definida e `DATABASE_URL_RUNTIME` na Vercel** (Production + Preview, desde
> 2026-07-15). Confira com `pnpm dlx vercel env ls`. Instruções mantidas para o próximo
> ambiente.

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

## Passo 4 — validação em produção (é outra coisa) · ⬜ **o único que falta**

Com prod sem dado cross-tenant, o que se valida lá **não é o vazamento** (não há o que
vazar) — é se os **grants** estão certos e o app não quebrou. **Não é configuração; é
observação.**

1. ~~Env `DATABASE_URL_RUNTIME` setada~~ ✅ feito. **O gatilho é o deploy da branch →
   `main`**: até lá o `main` não lê a env e o D1 fica inerte (ver o bloco no topo).
2. `pnpm smoke:c5` (paciente) + abrir o painel e navegar (agenda, caixa, prontuário).

> 🪤 **Pegadinha (acontece toda vez).** Se você rodou um script de prod antes
> (`db:backup:prod`), a `SUPABASE_PROJECT_ENV=prod` **fica grudada na sessão do shell** e
> qualquer comando de dev seguinte morre com *"DATABASE_URL looks like prod"* — mesmo com
> o `.env.local` intacto e a URL de dev. O guard ([db/index.ts](../../src/lib/db/index.ts))
> trata a env var como sinal explícito de "estou mexendo com prod". **Correção:**
> `Remove-Item Env:SUPABASE_PROJECT_ENV; Remove-Item Env:DATABASE_URL_PROD` (ou abra um
> terminal novo). **Nunca** use `NODE_ENV=production` para silenciar — aí você escreve em
> prod de verdade.
3. **Qualquer `permission denied for table X` = grant faltando no Passo 1**, não erro de
   RLS. É o modo de falha esperado se algo der errado — e o rollback é imediato.
4. Quando prod tiver ≥ 2 clínicas com dado, rodar A/B/C/D lá também.

## Rollback

**Remover a env `DATABASE_URL_RUNTIME` e redeploy.** O pool volta ao `DATABASE_URL` na
hora ([db/index.ts](../../src/lib/db/index.ts) faz `env.DATABASE_URL_RUNTIME ?? env.DATABASE_URL`).
Não precisa dropar o role nem mexer em schema. É o motivo de o desenho ser opt-in.

## Estado

**Provisionamento: ✅ COMPLETO nos dois ambientes (2026-07-16).** Verificado no banco, não
presumido: role sem BYPASSRLS, com senha, membro de `authenticated`, 396 grants (98
tabelas × 4 ops) e `ALTER DEFAULT PRIVILEGES` ativo (`qoro_runtime=arwd` em tabelas
futuras, `rU` em sequences) — este último é o passo esquecível: sem ele, a próxima
migration cria tabela inacessível ao runtime e o app quebra só naquele caminho.

| Ambiente | Dados | Role + senha + grants | `DATABASE_URL_RUNTIME` | Validado |
|---|---|---|---|---|
| **qoro-dev** (`pqhkirrszzpwezdaqrai`) | 2 clínicas / 4 pacientes | ✅ | ✅ Vercel | ✅ **A/B/C/D provados** (Passo 3) · ⬜ Passo 4 (smoke:c5 + painel) |
| **qoro-prod** (`shlcbxawrxuaebazuiue`) | 1 clínica / **0 pacientes** | ✅ | ✅ Vercel | ⬜ Passo 4 (smoke após o deploy) — A/C/D são **inconclusivos** sem dado cross-tenant |

> **Não falta SQL nem env.** `DATABASE_URL_RUNTIME` está na Vercel (Production + Preview)
> desde 2026-07-15. O que resta é observar o app rodando (Passo 4).
>
> ⚠️ **O D1 está INERTE em produção até o deploy desta branch.** O `main` **não lê**
> `DATABASE_URL_RUNTIME` (nem em `db/index.ts`, nem em `env.ts`) — o código que a
> consome vive na branch `docs/identity-practitioner-model`. Prod está com a env
> configurada e **ignorando-a**: o pool segue no `DATABASE_URL` (BYPASSRLS). Efeito
> colateral bom: no deploy, o fail-close **liga sozinho**, sem passo manual. Efeito
> colateral a lembrar: **o Passo 4 só faz sentido depois do deploy**.

**O que falta, em ordem:**

1. **Deploy da branch `docs/identity-practitioner-model` → `main`.** É o que ativa o D1
   (e leva a remediação inteira da auditoria de APIs). Nada mais é necessário: infra e
   env já estão prontas nos dois ambientes.
2. **Passo 4** — `pnpm smoke:c5` + navegar no painel, com olho em `permission denied for
   table X` (= grant faltando, não RLS). Rollback = remover a env + redeploy.
3. **Quando prod tiver ≥ 2 clínicas com dado**, rodar A/B/C/D lá — só então eles são
   conclusivos.

O gatilho continua sendo **antes do 1º cliente pagante**: depois, um `withTenant`
esquecido custa dado de cliente real — e é justamente quando prod passa a ter dado
cross-tenant de verdade.
