# Runbook — Role runtime sem BYPASSRLS (fail-close real do `withTenant`)

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-16 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice de runbooks](./README.md) · [índice mestre](../README.md).

> **D1** do [PROGRESS §Dívida técnica pós-C16](../PROGRESS.md). Origem: achado **A3** da
> [auditoria de APIs](../achados/auditoria-apis-seguranca.md) e a Correção **F-01** do
> [ADR-007](../adr/007-rls-implementation-patterns.md).

---

## ✅ D1 ATIVO EM PRODUÇÃO (2026-07-17) — resolvido

`qoro_runtime` conectando em prod (3 conexões ativas); login e navegação OK. **O fail-close está
ligado**: a partir daqui, um `withTenant` esquecido devolve 0 linhas em vez de vazar.

**A causa do incidente foi a connection string — em DOIS erros encadeados, nesta ordem:**

| # | Erro do Postgres/pooler | O que estava errado |
|---|---|---|
| 1 | `(ENOTFOUND) tenant/user qoro_runtime.<ref> not found` | **host do pooler de outra região.** O Supavisor é **regional**: `qoro-dev` é `us-west-1`, `qoro-prod` é **`us-east-1`**. Um pooler só conhece os tenants da própria região — daí "tenant not found" e não "senha errada". |
| 2 | `password authentication failed for user "qoro_runtime"` (28P01) | senha divergente. Resolvida com `ALTER ROLE qoro_runtime PASSWORD '<nova>'` (só alfanumérico — evita URL-encode). |

**A regra que teria evitado tudo, e que o Passo 2 já dizia:** *monte a URL a partir da `DATABASE_URL`
que FUNCIONA, trocando só o usuário.* Não monte a partir de exemplo em documento/chat — a região do
host é invisível a olho nu e é o erro mais silencioso.

> **Diagnóstico por escada** (foi o que fechou o caso): o erro **muda** conforme você acerta as
> camadas. `tenant not found` → host errado. `password failed` → host certo, senha errada.
> `permission denied for table X` → conectou, é grant. `0 linhas` → funcionando (é o fail-close).
> Cada mensagem é um degrau, não um beco.

---

## 🔴 O INCIDENTE (2026-07-17) — histórico, mantido como lição

**Sintoma:** após o deploy do `main`, "Algo deu errado" em **todas** as áreas logadas.
**Rollback disponível:** remover `DATABASE_URL_RUNTIME` da Vercel + redeploy (1 min, sem migração).

**Causa raiz: a connection string do `qoro_runtime` NUNCA foi testada — em nenhum ambiente.**

Toda a validação do [Passo 3](#passo-3--validação-obrigatória) usa `SET LOCAL ROLE qoro_runtime`,
sob o título literal *"Para testar **sem a connection string**"*. Isso prova os **grants** (e eles
estão certos), mas **nunca prova que dá para LOGAR como aquele role**. São duas coisas diferentes:

| O que o A/B/C/D provou | O que ele NÃO provou |
|---|---|
| O role tem os grants certos | A senha está correta |
| A RLS resolve fail-close sem `withTenant` | O formato do usuário no pooler está certo |
| O `SET LOCAL ROLE authenticated` funciona | O Supavisor **aceita** este role |

A env ficou **2 dias na Vercel sendo ignorada** (o `main` não lia `DATABASE_URL_RUNTIME`), então o
deploy foi a **primeira vez na vida** que alguém tentou usar aquela string. Ela falha.

**Evidência de onde falha (2026-07-17):**
- `pg_stat_activity`: **zero** conexões de `qoro_runtime` (só `postgres`, `authenticator`).
- `pg_roles`: o role está íntegro — `rolcanlogin=true`, sem expiração, sem limite, com senha.
- Logs do Postgres: **nenhum** `password authentication failed`, nenhum `permission denied`.

Nenhum erro de autenticação no Postgres + zero conexões = **a conexão não chega ao Postgres**. Ela
morre antes, no **pooler (Supavisor)**.

### ✅ Diagnóstico FECHADO por experimento (2026-07-17, em dev)

Senha de teste posta no `qoro_runtime` de dev, três strings testadas por **conexão real**:

| Caso | Resultado |
|---|---|
| `qoro_runtime.<ref>` @ pooler **:6543** (transaction) | ✅ **conecta** — `current_user=qoro_runtime` |
| `qoro_runtime` **sem** `.<ref>` @ :6543 | ❌ `(ENOIDENTIFIER) no tenant identifier provided (external_id or sni_hostname required)` |
| `qoro_runtime.<ref>` @ pooler **:5432** (session) | ✅ conecta |

**Conclusões, todas medidas:**

1. **O Supavisor ACEITA role customizado em transaction mode.** A hipótese 3 está morta — não
   precisa de session pooler, não precisa de ADR, não precisa mudar nada no desenho.
2. **A causa é o FORMATO DO USUÁRIO.** Sem o `.<project-ref>` o pooler não identifica o tenant e
   recusa **antes** do Postgres — que é exatamente a assinatura vista em prod (zero conexões, zero
   erro de auth no PG). Sobra a senha como 2º suspeito (typo / falta de URL-encode).
3. **O D1 FUNCIONA.** Provado pela conexão real, não por `SET ROLE`:
   - **sem `withTenant`** → `pacientes=0` ✅ **fail-close, não vaza**
   - **com `withTenant`** → `visíveis=2, de_outra_clínica=0` ✅ **app funciona E isolado**
     (havia 2 pacientes de outra clínica ali para vazar — e não vazaram)

**O desenho está certo; a string estava errada.** Para reativar: corrigir a string de prod para
`qoro_runtime.shlcbxawrxuaebazuiue:<senha>@<host-pooler>:6543/postgres?sslmode=require`, provar com o
[Passo 2b](#passo-2b--provar-a-connection-string-obrigatório), e só então pôr na Vercel.

---

## O problema, em uma frase

> ✅ **RESOLVIDO em 2026-07-17** — o texto abaixo descreve o problema que ESTE runbook fechou.
> Mantido porque explica *por que* o `qoro_runtime` existe.

O pool `db` conectava como `postgres`, que tem **`rolbypassrls = true`**. Se um caminho tenant
esquecesse o `withTenant`, a query rodava com BYPASSRLS e **vazava cross-tenant** — não falhava
fechado. O único obstáculo era *tooling* (`arch-db-check` AST no CI + ESLint), não o banco.

**Nota de precisão (a pergunta certa do founder, 2026-07-17):** o `withTenant` **é** acoplado às
queries — o `db` só pode ser importado por `src/lib/db/tenant.ts` (allowlist do `arch-db-check`),
então não dá para "esquecer" sem quebrar o CI. O ganho do D1 não é substituir isso: é ser a camada
**atrás** dele. Uma varredura de AST pega os padrões que conhece, nos arquivos que varre, quando o CI
roda; o banco vale sempre. E **`dbAdmin` continua com BYPASSRLS por design** — lá a defesa é o filtro
`eq(clinicId)` explícito (V1.2), não o D1.

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

## Passo 2b — PROVAR a connection string (obrigatório) · ✅ feito em dev e prod (2026-07-17)

> 🔴 **Este passo nasceu do incidente de 2026-07-17.** Sem ele, o Passo 3 dá a impressão de
> validação completa e não é: ele testa o role por `SET ROLE`, jamais por **login**. A string ficou
> 2 dias configurada e só falhou quando o deploy a usou pela primeira vez — em produção.
>
> **Ao criar o próximo ambiente, este passo NÃO é opcional.** Ele custa 30 segundos e teria evitado
> o outage inteiro.

**Regra: a string só está validada quando algo CONECTOU com ela.** `SET ROLE` não vale.

Em **dev primeiro** (`.env.local`), sem tocar na Vercel:

```powershell
# Cole a string do qoro_runtime de DEV e prove que ela conecta e enxerga o schema.
$env:DATABASE_URL_RUNTIME = 'postgresql://qoro_runtime.pqhkirrszzpwezdaqrai:<senha>@<host-pooler>:6543/postgres?sslmode=require'
pnpm tsx -e "import postgres from 'postgres'; const sql = postgres(process.env.DATABASE_URL_RUNTIME, { ssl: 'require', prepare: false, max: 1 }); const r = await sql\`select current_user, (select count(*) from public.clinics) as clinics\`; console.log('CONECTOU:', r[0]); await sql.end();"
Remove-Item Env:DATABASE_URL_RUNTIME
```

| Saída | Significado |
|---|---|
| `CONECTOU: { current_user: 'qoro_runtime', clinics: N }` | ✅ a string presta — pode ir para a Vercel |
| `password authentication failed` | senha errada, ou caractere especial precisa de URL-encode |
| `Tenant or user not found` / timeout no handshake | ⚠️ **formato do usuário** — falta o `.<project-ref>` |
| `permission denied for table clinics` | conectou! é grant faltando (Passo 1), não a string |

Depois, o mesmo com a string de **prod**, antes de pôr na Vercel. Conectar de fora contra prod para
um `select 1` é seguro e é a única prova que vale.

> **Por que dev primeiro:** se a string de dev conecta e a de prod não, o problema é a string; se
> nenhuma conecta, o problema é o formato/pooler — e você descobre isso sem derrubar produção.

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

## Passo 4 — validação em produção (é outra coisa) · ✅ FEITO (2026-07-17)

Com prod sem dado cross-tenant, o que se valida lá **não é o vazamento** (não há o que
vazar) — é se os **grants** estão certos e o app não quebrou. **Não é configuração; é
observação.**

> ⚠️ **`pnpm smoke:c5` NÃO valida prod — não rode contra prod.** A 1ª versão deste passo
> mandava rodá-lo aqui; está errado por dois motivos:
> 1. O próprio script proíbe: *"Roda via tsx contra qoro-dev (DATABASE_URL do .env.local).
>    **NUNCA contra prod**"* ([smoke-c5.ts:15](../../scripts/smoke-c5.ts#L15)) — ele cria e
>    apaga paciente de teste; em prod isso é dado real.
> 2. Ainda que rodasse, **não provaria nada**: um script no seu laptop usa o pool do
>    `.env.local`. Quem lê `DATABASE_URL_RUNTIME` é o **deploy na Vercel**. O D1 é uma env
>    da Vercel — só o app implantado o exercita.
>
> **A validação de prod é USAR O APP implantado.** Não há atalho de terminal.

1. ~~Env `DATABASE_URL_RUNTIME` setada~~ ✅ feito. **O gatilho é o deploy da branch →
   `main`**: até lá o `main` não lê a env e o D1 fica inerte (ver o bloco no topo).
2. **Logue como o `owner`, não como super_admin.**

   | Perfil em prod | E-mail | Serve? |
   |---|---|---|
   | **owner** — "Owner Teste" (Clínica Teste) | `teste@gmail.com` | ✅ **é este** |
   | super_admin | `joaomarcosrodduarte@gmail.com` | ❌ |

   **Por quê:** o super_admin tem `clinic_id = null` e só alcança o `/admin`, que roda em
   **`dbAdmin`** — pool com BYPASSRLS, que o D1 **não toca**. Logar como super_admin
   passaria **mesmo com o D1 quebrado** — é um teste que não pode falhar, logo não é teste.
   Quem exercita o `withTenant` (o que o D1 muda) é o owner.

3. Navegue os caminhos tenant: **agenda, pacientes, caixa, prontuário**. É isso — cada tela
   dessas é uma query via `withTenant` com o role novo.

4. **O que procurar, e onde.** O modo de falha esperado é **`permission denied for table X`**
   = **grant faltando no Passo 1**, NÃO erro de RLS. (RLS mal configurado devolve *0 linhas*;
   grant faltando devolve *erro*. Sintomas opostos — não confunda.)

   | Onde | O quê |
   |---|---|
   | **A própria tela** | Grant faltando vira 500 na navegação. Você vê na hora — é o sinal mais rápido. |
   | **Sentry** | A exceção com `trace_id` (ADR-029). |
   | **Better Stack** | `message.level:"error"` — ⚠️ **com o prefixo `message.`**. Sem ele a busca volta vazia e *parece* que não há erro. Ver [log-search.md](./log-search.md). |

5. **Quando prod tiver ≥ 2 clínicas com dado**, rodar A/B/C/D lá também — só então eles são
   conclusivos (hoje, sem dado cross-tenant, o `0` deles é vacuidade, não isolamento).

**Rollback (se aparecer `permission denied`):** remova a env `DATABASE_URL_RUNTIME` da Vercel
e redeploy — o pool volta ao `DATABASE_URL` na hora. Depois conserte o grant que faltou e
tente de novo.

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
| **qoro-dev** (`pqhkirrszzpwezdaqrai`, **us-west-1**) | 2 clínicas / 4 pacientes | ✅ grants · ✅ string provada (Passo 2b) | ✅ Vercel | ✅ **A/B/C/D por conexão REAL**: sem `withTenant` → 0; com → 2 visíveis, 0 de outra clínica |
| **qoro-prod** (`shlcbxawrxuaebazuiue`, **us-east-1**) | 1 clínica / **0 pacientes** | ✅ grants · ✅ **string provada** | ✅ **ATIVA** (2026-07-17) | ✅ Passo 4 — logou e navegou OK; `qoro_runtime` com 3 conexões |

> **Não falta SQL nem env.** `DATABASE_URL_RUNTIME` está na Vercel (Production + Preview)
> desde 2026-07-15. O que resta é observar o app rodando (Passo 4).
>
> ⚠️ **O D1 está INERTE em produção até o deploy desta branch.** O `main` **não lê**
> `DATABASE_URL_RUNTIME` (nem em `db/index.ts`, nem em `env.ts`) — o código que a
> consome vive na branch `docs/identity-practitioner-model`. Prod está com a env
> configurada e **ignorando-a**: o pool segue no `DATABASE_URL` (BYPASSRLS). Efeito
> colateral bom: no deploy, o fail-close **liga sozinho**, sem passo manual. Efeito
> colateral a lembrar: **o Passo 4 só faz sentido depois do deploy**.

**O que falta:**

1. ~~Passos 1, 2, 2b, 3, 4~~ ✅ **TODOS FEITOS** (2026-07-17). O D1 está ativo em produção.
2. **Quando prod tiver ≥ 2 clínicas com dado**, rodar A/B/C/D lá — só então eles são
   conclusivos *em prod* (hoje o `0` de prod é falta de dado, não isolamento; o isolamento
   está provado em **dev**, que tem dado cross-tenant de verdade).
3. **Ao criar o próximo ambiente** (preview dedicado — ver [D8](../achados/preview-aponta-para-prod.md)),
   repetir Passos 1 → 2 → **2b** → 3. O 2b não é opcional.

O gatilho continua sendo **antes do 1º cliente pagante**: depois, um `withTenant`
esquecido custa dado de cliente real — e é justamente quando prod passa a ter dado
cross-tenant de verdade.
