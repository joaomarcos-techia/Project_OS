# ADR-042 — Policy v2 (InitPlan) + least-privilege do schema `public`

> **Verificação (2026-07-23)** — Decisão: ACTIVE · Implementação: IMPLEMENTED
> _Base: em produção (C0–C16 fechadas); confirmação por domínio na Onda 3._

**Status:** accepted
**Date:** 2026-07-17
**Camada:** C2/C3 (RLS + grants)
**Emenda:** ADR-007 (muda o TEXTO congelado do `defaultTenantPolicy`, não o padrão) · ADR-010 (torna o least-privilege de função um default do banco, não uma convenção) · ADR-002 §38-39 (nota de defasagem)
**Fecha:** achados A13, A14 e o resíduo de A15 da auditoria de banco; achado novo N1 (índices)

## Context

A auditoria de banco (2026-07-12) trouxe dois achados de mecanismo que compartilham a
mesma raiz — **o default do Supabase, aplicado a todo objeto novo**:

- **A14 [MÉDIA, perf]:** o `get_advisors` marcou `auth_rls_initplan` em **57 policies**
  (medi **65** hoje, em dev e prod). O predicado congelado do `defaultTenantPolicy`
  chamava `current_setting('app.current_clinic')`, `current_clinic_id()` e
  `is_super_admin()` **direto**, sem subquery escalar. O Postgres re-avalia as três
  **por linha varrida**, em vez de uma vez por query.
- **A13 [MÉDIA]:** `pg_default_acl` concede `anon=arwdDxtm` e `authenticated=arwdDxtm`
  (ALL, incl. `TRUNCATE`, que o RLS **não** cobre) em toda tabela do `public` —
  medido: **618 privilégios** para `anon`, **88 tabelas** com `TRUNCATE`.

### Por que o `REVOKE` que a auditoria propôs não bastava

A recomendação era `REVOKE TRUNCATE, REFERENCES, TRIGGER FROM anon, authenticated`.
Isso limpa as tabelas **de hoje** e **não impede a próxima tabela de nascer exposta**:
a origem não é um `GRANT` no código do projeto, é o `ALTER DEFAULT PRIVILEGES` do
Supabase. Sem tocar no default ACL, o achado volta na primeira migration que criar
tabela — e a auditoria seguinte o encontra de novo. Tratar o sintoma (as 87 tabelas)
sem a causa (o default) é o que faz um achado renascer.

O mesmo vale para o **A15**: a 0038 revogou `EXECUTE` das funções de trigger **uma a
uma**, mas o default ACL continua expondo **toda função nova** como
`/rest/v1/rpc/<fn>`. A auditoria recomendou "adotar como padrão de migration"; uma
convenção depende de disciplina, um default do banco não.

### O que a medição mostrou (e mudou a decisão)

Escopo de `anon` e `authenticated` **medido, não presumido**:

- **`anon` não precisa de nada.** Existem exatamente **2** leituras via PostgREST em
  todo o código (`login/actions.ts:56`, `login/mfa/actions.ts:50`), ambas **depois** do
  `signInWithPassword` — logo com role `authenticated`. Nenhum código assume a role
  `anon`; o realtime autentica com o JWT do usuário (`setAuth`). Todas as policies de
  catálogo são `TO authenticated`, então `anon` **já** recebia 0 linhas por RLS.
- **`authenticated` NÃO pode perder DML.** `qoro_runtime` é **membro** de
  `authenticated` e o `withTenant` faz `SET LOCAL ROLE authenticated`
  ([tenant.ts:60](../../src/lib/db/tenant.ts#L60)). Os 364 grants de DML dessa role são
  **load-bearing para o app inteiro** — não são "sobra do PostgREST". Revogá-los, que
  seria a leitura ingênua de "least-privilege", derrubaria o produto.

Essa assimetria é o ponto não-óbvio deste ADR: no Supabase, `anon`/`authenticated`
parecem "roles da Data API", mas aqui `authenticated` é **também** a role de execução
do nosso próprio pool.

## Decision

### 1. `defaultTenantPolicy` v2 — os helpers de auth vão para subquery escalar

```sql
clinic_id::text = (select current_setting('app.current_clinic', true))
OR clinic_id::text = (select current_clinic_id())
OR (select is_super_admin())
```

O `(select ...)` faz o planner hoistar a chamada para um **InitPlan**: 1× por query em
vez de 1× por linha. É seguro porque as três funções são `LANGUAGE sql STABLE`
(migration 0001) — `STABLE` garante valor fixo durante o statement, que é exatamente a
premissa do hoist. **Nunca** aplicar o mesmo wrap a função `VOLATILE`.

Semântica **inalterada**: o `SET LOCAL` do `withTenant` roda antes da query, então o
InitPlan lê o mesmo GUC de sempre. O fingerprint `defaultTenantPolicy(v1)` → `(v2)` é o
rastro exigido pelo ADR-007 D28.

**O helper gera texto congelado nas migrations — mudar `rls.ts` não muda nenhuma policy
já materializada.** Por isso a 0045 faz `DROP POLICY` + `CREATE POLICY` explícito nas
65 policies afetadas.

### 2. Least-privilege do `public`, atacando a causa

```sql
-- tabelas de HOJE
REVOKE ALL ON ALL TABLES/SEQUENCES IN SCHEMA public FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;

-- tabelas/funções FUTURAS (a causa)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
```

`FOR ROLE postgres` porque é a role que cria os objetos nas migrations. O revoke de
`EXECUTE` **não** afeta funções existentes — `mark_mfa_enrolled` mantém o grant dela; o
que muda é que **função nova nasce fail-closed** e expor uma RPC passa a exigir `GRANT`
explícito. Ou seja: o que o ADR-010 pedia por convenção agora é o default do banco.

### 3. Índices de FK — a regra que os ordena (A6 + N1)

O Postgres não cria índice para coluna de FK, e a checagem de integridade ao apagar o
**pai** é `SELECT 1 FROM filha WHERE <fkcol> = $1` — **sem** `clinic_id`. Logo os
compostos que o projeto já tem (`(clinic_id, patient_id)`) **não a servem**: lideram
por `clinic_id`.

> **Regra:** toda FK cujo pai é apagado numa operação real de produto precisa de índice
> **liderado pela coluna da FK**. Índice sem necessidade também é dívida — catálogos que
> o produto nunca apaga (`plans`, `prices`, `permissions`, `payment_methods`) e filhas de
> tamanho limitado (`doctor_availability`, `clinic_holidays`, `tenant_provisioning`)
> ficam **deliberadamente** sem índice.

**N1 (não estava em auditoria alguma):** `appointment_state_log` e `procedure_history`
são tenant-scoped, têm policy de RLS e **não tinham índice algum em `clinic_id`** — o
predicado do RLS varria a tabela inteira em toda query tenant. Contradiz o "ponto forte"
§7 da auditoria de banco ("disciplina de índices `clinic_id`") e a convenção D9.

## Consequences

### Positivas
- **A14:** provado pelo planner, não por lint — o `EXPLAIN` de `SELECT ... FROM patients`
  passou a mostrar `(InitPlan 1).col1 / (InitPlan 2).col1 / (InitPlan 3).col1` no Filter.
  Uma mudança no helper acelera **todas** as queries tenant em escala.
- **`anon` deixa de alcançar a tabela**, em vez de ser filtrado por ela. Antes:
  `200 []` (RLS zerava as linhas). Agora: `401 / 42501 permission denied`. Duas camadas
  independentes em vez de uma.
- **A13/A15 não voltam** na próxima tabela/função — a causa foi fechada, não o sintoma.

### Negativas / riscos aceitos
- **`authenticated` continua com `MAINTAIN` (`m`) no default ACL.** Não revogado: não há
  vetor alcançável (PostgREST só emite DML; o único role-switch é o nosso `withTenant`;
  autovacuum roda como superuser) e o custo de uma migration a mais não compra redução
  de risco. Registrado aqui para a próxima auditoria saber que foi **considerado**, não
  esquecido.
- **Rollback dos grants não é automático.** Reverter exige `GRANT` explícito; o predicado
  v2 é semanticamente idêntico ao v1, então reverter a policy é reemitir com o helper.
- Se algum dia o produto passar a usar a Data API como `anon` (ex.: página pública lendo
  `plans`), será preciso `GRANT SELECT` explícito **e** uma policy `TO anon`. Isso é
  desejável: passa a ser uma decisão, não um default herdado.

### Delimitação (o que este ADR NÃO faz)
- Não muda o padrão do ADR-007 — só o texto do predicado e o fingerprint.
- **Não toca em `user_permission_overrides`.** O ADR-041 tirou aquela tabela do
  `defaultTenantPolicy` porque `FOR ALL` ali era escalonamento de privilégio (I-13). A
  0045 a re-emite como `FOR SELECT`. **Nunca** reaplicar o default nela.
- ADR-002 §38-39 ("o pool `db` conecta com role BYPASSRLS") está **defasado** desde o D1
  (2026-07-17): em prod o runtime é `qoro_runtime`, NOBYPASSRLS. Em **dev** ainda não há
  `DATABASE_URL_RUNTIME`, então lá o pool segue como `postgres` e é o `SET LOCAL ROLE`
  do `withTenant` que faz o RLS valer.

## Evidência (dev, 2026-07-17 — migrations 0044+0045)

| Prova | Antes | Depois |
|---|---|---|
| Assinatura de shape das 75 policies (`cmd`\|`roles`\|`permissive`) | `7adb4e84…` | **`7adb4e84…` idêntica** |
| Policies com helper de auth sem wrap | 65 | **0** |
| Policies com InitPlan | 0 | **65** |
| Privilégios de tabela de `anon` | 618 | **0** |
| `authenticated` com TRUNCATE/REFERENCES/TRIGGER | 88 | **0** |
| DML de `authenticated` (withTenant depende) | 364 | **364 (intacto)** |
| Default ACL de tabela futura | `anon=arwdDxtm` | **sem `anon`**; `authenticated=arwdm` |
| Login real (GoTrue + hook + PostgREST) | ok | **ok** — claims `app_role: doctor`, `clinic_id` emitidas |
| `anon` lendo `profiles` via PostgREST | `200 []` | **`401` `42501`** |
| Isolamento cross-tenant (conexão real, `withTenant`) | — | A vê 2 pacientes, **0 da B** |

A assinatura de shape idêntica é a prova de que a re-emissão mudou **só o predicado**:
nenhum `cmd`, `roles` ou `permissive` das 75 policies foi alterado.
