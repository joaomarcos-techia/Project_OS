# ADR-041 — Tabela de autorização não é tabela de tenant (I-13)

**Status:** accepted
**Date:** 2026-07-16
**Camada:** C2/C3 (RLS + Identidade)
**Emenda:** ADR-007 D27 ("RLS ≠ RBAC") — delimita onde a premissa vale

## Context

Durante a remediação da auditoria de identidade (2026-07-16) encontrei um **escalonamento de
privilégio explorável** que **nenhuma das quatro auditorias** (segurança de código, APIs, banco,
identidade) tinha visto.

`user_permission_overrides` — a tabela que concede/nega permissões por usuário — foi classificada como
uma tabela **tenant** comum e recebeu a `defaultTenantPolicy` (`FOR ALL`, predicado só de `clinic_id`).
Ver `AUDITORIA_C0_C10_COMPLETA.md:127`: *"user_permission_overrides | tenant | ✅ | ✅ |
defaultTenantPolicy"*. Além disso o Supabase concede, por DEFAULT PRIVILEGES, INSERT/UPDATE/DELETE a
`anon`/`authenticated` em toda tabela nova do schema `public`.

Resultado: **qualquer usuário autenticado podia escrever direto na tabela que define a própria
autorização**, via PostgREST:

```
POST /rest/v1/user_permission_overrides
{ user_id: <ele mesmo>, clinic_id: <a clínica dele>,
  permission_code: 'manage:employees', granted: true }
```

A policy só comparava `clinic_id` — nunca **quem** é o ator, nem **se** ele pode conceder. O
`WITH CHECK` passava, porque a clínica era mesmo a dele.

**Provado em dev** (transação + ROLLBACK) com o JWT de um `attendant` real:

| Passo | Resultado |
|---|---|
| INSERT do override | **ACEITO** |
| `effective_permissions_v` concede | **true** |
| `custom_access_token_hook` injeta no JWT | **true** |
| `claims_version` bumpou? | **NÃO** (1 → 1) |

Contraprova no mesmo teste: `role_permissions` INSERT → negado (RLS); `profiles` UPDATE role → negado
(0 linhas). **O furo era só esta tabela.**

O bump não disparar era um **segundo** defeito, e agravava o primeiro: o trigger
`bump_overrides_claims_version` era `SECURITY INVOKER` e fazia `UPDATE public.profiles`. Sob RLS,
`profiles` não tem policy de UPDATE para `authenticated` (ADR-008 D31) → o UPDATE casava **0 linhas e
não levantava erro**. O mecanismo de segurança **falhava aberto, em silêncio** — por isso o
escalonamento era furtivo (nem o middleware nem o novo epoch-check perceberiam).

## Decision

**Uma tabela de AUTORIZAÇÃO não é uma tabela de tenant. Nela, "estar no tenant" NUNCA é autorização
suficiente para escrever.**

O princípio **ADR-007 D27 ("RLS ≠ RBAC")** — a RLS responde *"o caller pode tocar neste tenant?"*, e a
autorização funcional mora na app (Server Action chama `require*`) — **está correto para tabelas de
DOMÍNIO** (patients, appointments, lançamentos): toda escrita passa por uma Server Action, então "a
app guarda a porta" é verdade.

**Essa premissa é FALSA para a tabela de autorização**, porque o PostgREST expõe um caminho de escrita
direto que **não passa pela app**. Para dado de domínio, escrever direto no próprio tenant é, no pior
caso, um dado errado. Para dado de authz, é **escalada de privilégio**.

### Regra

Toda tabela cujo conteúdo **decide autorização** (`user_permission_overrides`, `role_permissions`,
`permissions`, `profiles.role/ativo`) é **read-only para `authenticated`**:

1. **GRANTs:** `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ... FROM anon, authenticated`.
   SELECT permanece quando a app precisa ler (a tela Equipe lê `overridesCount` via `withTenant`).
2. **Policy:** `FOR SELECT`, nunca `FOR ALL`.

**Defesa em profundidade — as duas camadas, não uma.** O Supabase re-concede GRANTs por default
privileges (já mordeu em 0006/0007): se o GRANT voltar, a policy segura. Cada camada foi **provada
isoladamente** (a policy bloqueia mesmo com o GRANT restaurado à força).

A escrita passa a existir **só** via `dbAdmin` atrás do gate (`setMemberOverride` —
[ADR-039](./039-member-lifecycle.md)), onde `assertCanAssignRole` e os guard-rails vivem, e onde há
auditoria.

### Corolário: bump de claims_version é invariante, falha ALTO

`touch_claims_version()` (migration 0040) é **SECURITY DEFINER**. O bump é um invariante de segurança
— ou acontece, ou a transação inteira falha. Nunca "quase". Um mecanismo de segurança que falha aberto
e em silêncio é pior que nenhum: dá a sensação de proteção sem a proteção.

## Consequences

- O escalonamento fecha nas duas camadas (verificado em dev: attendant → `permission denied` em
  INSERT/UPDATE/DELETE; SELECT segue funcionando, a tela Equipe não quebra).
- `setMemberOverride` (ADR-039) vira o **único** caminho de escrita — guardado, com ator provado e
  auditado.
- **Perda deliberada:** a policy antiga deixava `super_admin` gravar via PostgREST
  (`is_super_admin()` no WITH CHECK). Nada no código usava esse caminho, e o canal admin correto é
  `dbAdmin` atrás de `requireSuperAdmin` (AAL2, auditado). Reabrir escrita por RLS reabriria o furo
  para todo o tenant.
- **Checklist de nova tabela (CONVENTIONS):** ganha uma 4ª pergunta — *"o conteúdo desta tabela decide
  autorização? Então é read-only para `authenticated`, mesmo sendo tenant-scoped."*
- Como sair: reverter a 0040 restaura a policy `FOR ALL` — e o furo. Não faça.

## Alternatives

- **Só revogar os GRANTs (sem mexer na policy):** rejeitada — o Supabase re-concede por default
  privileges; a policy é a camada que sobrevive a isso.
- **Só trocar a policy (sem revogar GRANTs):** rejeitada — funcionaria, mas deixa o privilégio
  concedido "por acidente" de pé, contra least-privilege.
- **Manter `FOR ALL` e confiar que a app é o único caminho:** rejeitada — é literalmente a premissa
  que este ADR mostra ser falsa. O PostgREST é um caminho de escrita de primeira classe.
- **Trigger `SECURITY INVOKER` + garantir que só BYPASSRLS escreva:** rejeitada — foi o que havia, e
  falhava aberto em silêncio para qualquer outro writer.

## References

- Achado I-13 (novo, 2026-07-16) — sem correspondente nas 4 auditorias anteriores.
- Migration [`0040_auth_epoch_and_overrides_lockdown.sql`](../../drizzle/migrations/0040_auth_epoch_and_overrides_lockdown.sql) (a prova e o fix estão no cabeçalho).
- ADR-007 D27/D36 (o princípio delimitado aqui) · ADR-008 D31 · ADR-039 (o caminho de escrita legítimo) · ADR-037 (epoch)
- `AUDITORIA_C0_C10_COMPLETA.md:127` — onde a classificação errada foi registrada e aprovada.
