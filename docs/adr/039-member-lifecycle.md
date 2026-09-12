# ADR-039 — Ciclo de vida de membro (offboarding, troca de role, overrides)

> **Verificação (2026-07-23)** — Decisão: ACTIVE · Implementação: IMPLEMENTED
> _Base: em produção (C0–C16 fechadas); confirmação por domínio na Onda 3._

**Status:** accepted
**Date:** 2026-07-16
**Camada:** C3 (Identidade)
**Emenda:** ADR-032 §4 (bloqueio de desativação)

## Context

A auditoria de identidade (I-2) apontou que o contexto Identity só implementava
convidar/reenviar/cancelar convite. **Desativar** um funcionário aceito, **reativar**, **trocar o
role** e **conceder/revogar overrides** só existiam via SQL manual. O enforcement de `ativo=false`
existia (hook deny-by-default, `requireFreshPermission`), mas **a ação que o aciona não existia no
produto** — offboarding dependia de canal manual. Combinado com o replay de token (I-4, fechado no
ADR-037), um ex-funcionário mantinha acesso.

O ADR-032 §4 já declarava como LEI: desativar "bloqueia acesso + signOut" e é "bloqueado enquanto
houver agenda futura ou consulta aberta". Nada disso estava codificado.

## Decision

Implementamos o ciclo de vida em `src/contexts/identity/internal/lifecycle.ts`: `setMemberActive`
(desativar/reativar), `setMemberRole` (trocar função) e `setMemberOverride` (conceder/negar/remover
override granular). As Server Actions em `equipe/actions.ts` orquestram; a UI ganhou ações de linha
para membros aceitos (`member-row-actions.tsx`).

### Escrita via `dbAdmin`, não SECURITY DEFINER

ADR-008 **D31** ("self-service via função column-level") é sobre o usuário editando o **próprio**
profile (ex.: `mark_mfa_enrolled`). Isto é operação **administrativa**: a autorização já aconteceu no
gate (`requireFreshPermission(MANAGE_EMPLOYEES)` + `requireClinicId`) **antes** de chegar ao domínio.
O padrão do repo para escrita administrativa em `profiles` é `dbAdmin` (BYPASSRLS) com escopo
defensivo por `clinic_id` (padrão V1.2), na allowlist de `eslint.config.mjs` + `arch-db-check.ts` —
o mesmo de `members.ts`. Seguimos esse padrão; não criamos uma SECURITY DEFINER nova para cada campo.

### Guard-rails no DOMÍNIO, não na action

- **Sem self-mutation** (`SelfMutationError`): ninguém se desativa, se rebaixa nem se auto-concede
  override. Fecha "gestor se tranca para fora" e "auto-promoção".
- **Papéis protegidos** (`ProtectedRoleError`): `owner` (único por clínica — ADR-032) e `super_admin`
  (plataforma — P7) não são desativáveis/editáveis pelo canal tenant. Protege contra "clínica sem dono".
- **Anti-escalonamento**: `setMemberRole` reusa `assertCanAssignRole` — ninguém promove a
  owner/super_admin, e o ator só atribui o que seu papel permite.

### ⚠️ Enforcement da desativação: correção ao ADR-032 §4

O §4 dizia "ativo=false + **signOut**". Duas descobertas ao implementar:

1. **O signOut administrativo de outro usuário não existe** no supabase-js 2.106.2 — `admin.signOut`
   exige o JWT do próprio alvo (verificado no `.d.ts`), e não há "signOut por userId".
2. **O ADR-037 tornou o signOut redundante.** `ativo=false` bumpa `claims_version` (trigger) → o
   access token vivo morre no próximo request (epoch-check). E qualquer refresh cai no
   deny-by-default do hook (`ativo IS NOT TRUE`) → emite token **sem claims**. O usuário fica trancado
   para fora **sem** depender de revogar o refresh token.

   Provado em dev (2026-07-16): desativar bumpou `claims_version` (+1) **e** o hook passou a devolver
   `app_role = NULL`. Enforcement completo por dois mecanismos que já existem, nenhum signOut fingido.

Portanto: **a desativação enforça acesso via epoch + hook deny-by-default, não via signOut.**

### Bloqueio de agenda futura/consulta aberta — composto na app-layer

O §4 bloqueia desativar um médico com "agenda futura ou consulta aberta". Essa regra precisa do
**Scheduling**, e Identity é fundacional (`scheduling` importa `identity/schema` — o inverso seria
ciclo, quebraria `arch:check`). Então a composição mora em `equipe/actions.ts` (app-layer, o único
lugar que pode falar com Identity **e** Scheduling). Scheduling expõe
`schedulingApiV1.doctorActiveCommitments(clinicId, doctorId)` — dono da regra do que conta:

- agenda futura = `agendado/confirmado` com `scheduled_at >= now`
- consulta aberta = `chegou/em_atendimento`

Um não-médico nunca é `doctorId` de appointment → a query devolve zero, sem special-casing.

**Default: bloqueia** (retorna `blocked` com os números para a UI oferecer remanejamento).
**Override auditado:** a action aceita `force: true` → desativa mesmo assim, e o `forcedOverCommitments`
entra no `after` da auditoria. Segurança (offboarding urgente possível) sem silenciar a integridade
da agenda.

### `mapIdentityError()`

O TODO em `equipe/actions.ts` pedia extração "quando a lista passar de ~5 tipos". Passamos de 5 (com
`SelfMutationError`/`ProtectedRoleError`/`MemberHasActiveCommitmentsError`). Extraído para
`identity/internal/map-error.ts` — no **contexto**, não em `@/lib` (ADR-036: `@/lib` nunca importa de
`contexts/*`).

## Consequences

- Offboarding, reativação e troca de role viram operação de produto, auditada, com efeito imediato
  (epoch). Fecha o I-2 no que é de segurança.
- As 3 actions entram em `CRITICAL_ACTIONS` (arch-test garante `requireFreshPermission`).
- `setMemberOverride` é agora o **único** caminho de escrita em `user_permission_overrides` (o I-13
  trancou o acesso direto por RLS) — guardado, com o ator provado e auditado.
- **Escopo desta ADR / não-feito consciente:** o **editor de overrides na UI** (matriz de permissões)
  fica como follow-up. A capacidade existe (domínio + action + testes), é alcançável e auditada; o
  que falta é a tela de matriz — que o ADR-032 §6 modela como *nudge* ("aviso, não trava"), uma UX
  distinta. Não é um gap de segurança: sem a tela, ninguém escreve override algum (nem pelo furo do
  I-13, agora fechado).
- **I-9 (troca de e-mail) — não-feito consciente registrado aqui:** e-mail é o canal de identidade
  (ADR-032 §3) mas não há fluxo de troca. Quando implementado, exigir: verificação do e-mail **novo E
  do antigo**, reautenticação, revogação de sessões, via o fluxo nativo do Supabase (double-confirm) —
  nunca caseiro. É a superfície clássica de account-takeover quando feita às pressas.
- Como sair: as funções são aditivas; reverter o commit remove as ações e a UI sem migração.

## Alternatives

- **SECURITY DEFINER por operação:** rejeitada. D31 é para self-service; para escrita administrativa
  já-autorizada no gate, o padrão do repo é `dbAdmin`+allowlist. Criar N funções DEFINER seria
  cerimônia sem ganho de segurança (a autorização não mora no banco, mora no gate).
- **Bloqueio de agenda dentro do Identity:** impossível sem inverter a dependência
  Identity↔Scheduling (ciclo). App-layer é o lugar arquitetural correto.
- **Desativação sempre permitida (só avisa):** rejeitada — contraria o §4, que prioriza integridade
  da agenda. O `force` auditado dá a válvula de escape sem abrir mão do default seguro.

## References

- Achado I-2/I-9 — [`docs/achados/auditoria-autenticacao-identidade.md`](../achados/auditoria-autenticacao-identidade.md)
- ADR-032 §4 (emendado) · ADR-037 (epoch — o que torna o signOut redundante) · ADR-036 (asConflict/erros no contexto) · ADR-008 D31
- Código: [`lifecycle.ts`](../../src/contexts/identity/internal/lifecycle.ts) · [`equipe/actions.ts`](../../src/app/(app)/(shell)/equipe/actions.ts) · [`member-row-actions.tsx`](../../src/app/(app)/(shell)/equipe/member-row-actions.tsx)
- Runbook: [`offboarding-desativar-membro.md`](../runbooks/offboarding-desativar-membro.md)
