# Runbook — Desativar / reativar membro (offboarding)

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-16 · **Próxima revisão:** 2027-01-16
>
> ↩︎ Volta para o [índice de runbooks](./README.md) · [índice mestre](../README.md).

> C3 (Identidade). SEV2 quando é conta comprometida (contenção); rotina quando é desligamento.

## Sintoma / quando usar

- Um funcionário foi desligado e precisa perder o acesso.
- Uma conta pode estar comprometida e precisa ser contida **agora**.
- Alguém trocou de função e o role/permissões precisam mudar.

## Pré-requisitos

- Você tem `manage:employees` (owner ou gestor) na clínica.
- A ação é feita em **Equipe & Permissões** → menu de ações (⋯) na linha do membro.

## Resolução

### 1. Desativar acesso (o caso comum)

1. Em **Equipe**, na linha do membro (aceito), abra ⋯ → **Desativar acesso**.
2. Confirme. O acesso morre **no próximo request** do usuário — não depende dele fazer logout.
   - Por quê: `ativo=false` incrementa `claims_version`; o gate (ADR-037) compara isso a cada request
     e mata a sessão. Um refresh do token também não ajuda o usuário: o hook passa a negar as claims.
3. O **histórico é preservado** (prontuários/documentos emitidos sobrevivem por snapshot — ADR-032 §4).

### 2. Se aparecer "Este médico ainda tem compromissos"

O médico tem agenda futura ou consulta em aberto (ADR-032 §4). O ideal é **remanejar antes**:

1. Vá à **Agenda**, reatribua ou cancele os agendamentos futuros do médico.
2. Volte e desative.

**Se for urgente (conta comprometida, desligamento imediato):** use **"Desativar mesmo assim"**. A
agenda futura fica sem responsável (você remaneja depois), mas o acesso é cortado na hora. Esse
override fica **registrado na auditoria** (`internal.user.deactivated` com `forcedOverCommitments`).

### 3. Reativar

⋯ → **Reativar acesso**. O usuário volta a logar normalmente no próximo acesso.

### 4. Trocar função

⋯ → **Trocar função** → escolha a nova função → **Salvar**. Vale imediatamente (a sessão é
revalidada no próximo request). Você só vê as funções que seu papel pode atribuir; nunca `owner`
nem `super_admin`.

## Contenção rápida (conta comprometida)

Ordem recomendada:

1. **Desativar acesso** (mesmo assim, se houver agenda) — corta o acesso no próximo request.
2. Force a troca de senha do usuário pelo fluxo de recuperação, OU peça que ele troque — trocar a
   senha revoga as **outras** sessões (ADR-037 / I-8).
3. Registre o incidente (ver [`incident-response.md`](./incident-response.md)).

## Segurança (invariantes que NÃO se afrouxam)

- **Ninguém desativa/rebaixa a si mesmo.** Não contorne isso com SQL para "resolver rápido" — o
  guard existe para o gestor não se trancar para fora e para não haver auto-promoção.
- **Owner e super_admin não são desativáveis pelo canal tenant.** Owner é único (ADR-032); trocar de
  dono é outra operação. Super_admin é plataforma.
- **A desativação NÃO depende de `signOut`.** Quem corta o acesso é o `claims_version` + o hook
  deny-by-default. Se alguém "melhorar" isso adicionando um signOut administrativo, saiba que ele não
  existe por userId no supabase-js e **não é necessário** (ver ADR-039).
- Toda mudança de acesso é auditada (`audit_events`). Não edite `profiles.ativo`/`role` direto no
  banco — isso pula a auditoria e o "no audit, no op".

## Verificação

- O membro desativado aparece com badge **Inativo** em Equipe.
- Ele é redirecionado a `/login?reason=USER_DISABLED` no próximo acesso (o motivo aparece no log).
- Em `audit_events`: uma linha `internal.user.deactivated` / `internal.user.reactivated` /
  `internal.user.role_changed` com o ator e o alvo.
