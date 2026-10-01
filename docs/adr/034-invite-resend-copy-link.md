# ADR-034 — Convite versionado por Resend com link `recovery` copiável

> **Revisão (2026-09-30)** — Decisão: ACTIVE · Implementação local: IMPLEMENTED
> _A implementação atual envia o convite inicial e o reenvio pelo Resend; o link
> copiável permanece como fallback operacional._

**Status:** accepted · **Date:** 2026-07-10 (founder aprovou no planejamento da sub-fase 2a)
**Camada:** Identity (C3) · implementa a sub-fase 2a de [convite-e-gestao-de-equipe.md](../implementation/convite-e-gestao-de-equipe.md).
**Refs:** [ADR-032](032-mvp-identity-practitioner-model.md) §3 (canal = e-mail no MVP), ADR-008 (identity patterns),
ADR-010 (SECURITY DEFINER — não usado aqui), ADR-027 (convite mágico do onboarding — outro fluxo).

## Context

A sub-fase 1 criava convites de funcionário via `supabase.auth.admin.inviteUserByEmail`; o Supabase montava o
e-mail e o link antes de redirecionar para `/convite`. A aplicação depois ganhou transporte próprio pelo Resend
para cadastro e recuperação de senha. Em 30/09/2026, um E2E real mostrou que o link produzido pelo template do
Supabase era consumido em `/auth/v1/verify` antes de chegar ao callback do Qoro e terminava em `/login`, sem o
grant necessário para aceitar o convite.

Dois fatos preservados da decisão original continuam relevantes:

1. **`invite` só serve para usuário novo.** `inviteUserByEmail` e `generateLink({type:'invite'})` **erram**
   (`email_exists`) quando o e-mail já pertence a um usuário — e o alvo do reenvio é, por definição, um usuário
   que **já existe** (o convite pendente).
2. **O browser não deve receber credenciais de sessão no link.** O GoTrue fornece apenas o `token_hash`; o
   template versionado monta `/auth/confirm#token_hash=…&type=recovery&next=/convite`, e o callback do Qoro troca
   essa prova one-time no servidor.

## Decision

**Convite inicial e reenvio usam um template versionado no repositório e são entregues pelo Resend.** O Qoro cria
ou localiza o usuário, pede ao GoTrue somente um `token_hash` com `generateLink({ type: 'recovery' })`, monta o
link canônico e envia o e-mail. No reenvio, a UI também copia o mesmo link para o clipboard como fallback.

- **Tipo `recovery`, não `invite` nem `magiclink`.** `recovery` é o primitivo correto para "re-emitir link de
  definição de senha a um usuário existente" — e **já está provado neste projeto** (é o mesmo tipo de link do
  `forgot-password`, em produção). Sua semântica é **"definir senha"**, idêntica ao que a tela `/convite` faz
  (`exchangeCodeForSession` + `updateUser({password})`), então funciona **sem qualquer alteração** na `/convite`.
  `magiclink` foi **rejeitado**: é login sem senha — semântica de autenticação diferente de aceite/onboarding;
  misturar os dois deixaria o fluxo de onboarding refém de mudanças de comportamento do Supabase.
- **Resend é o canal primário e o clipboard é fallback.** O owner recebe confirmação do reenvio e ainda pode
  entregar o link manualmente se o destinatário não localizar a mensagem.
- **Sem fallback entre fluxos.** `invite` para usuário novo (sub-fase 1), `recovery` para usuário existente
  (reenvio). Cada primitivo casa com sua situação; não há "tentar invite e cair em magiclink".

Cancelamento (mesma sub-fase) é ortogonal: hard delete do profile pendente (`profiles.id → auth.users`
`ON DELETE CASCADE`) + `deleteUser` best-effort — libera vaga e e-mail. Não envolve link/e-mail.

## Invariantes

- Reenvio **nunca** cria um segundo profile: mesmo `id`, só o link muda (o modelo já suportava — review #3).
- O convite inicial e o reenvio são enviados pelo Resend; o link retornado ao owner precisa ser exatamente o
  mesmo do corpo recebido.
- `recovery` é usado **exclusivamente** para re-emitir acesso a um convidado existente; não vira canal de login.
- Reenviar rotaciona a prova: o link anterior deixa de funcionar, o novo aceita uma vez e replay é recusado.
- Falha no envio inicial compensa a identidade Auth criada; a aplicação não persiste um profile convidado sem
  ter aceitação do provider de e-mail.

## Consequences

- (+) O corpo, o destino e as variáveis do convite ficam versionados junto ao código, sem depender do template
  manual de cada projeto Supabase.
- (+) O fluxo automatizado consegue provar envio, recebimento, conteúdo, rotação, aceite, tenant e replay.
- (+) Semântica limpa — cada tipo de link (`invite`/`recovery`) casa com novo/existente; sem mistura com login.
- (+) O link copiável preserva a entrega manual quando o inbox estiver indisponível.
- (−) A criação do Auth e o envio são efeitos externos anteriores à transação do profile. Se a transação falhar
  depois do envio, a compensação apaga o usuário e o link recebido fica inválido; o erro é observável e não deixa
  acesso órfão.

## Alternatives

- **Template/auto-send do Supabase:** rejeitado após reprodução — o link foi consumido antes do callback Qoro e
  terminou em `/login`; também recolocaria o template fora do versionamento do repositório.
- **`generateLink({type:'invite'})` + copiar:** rejeitada — erra em usuário existente (`email_exists`).
- **Delete + `inviteUserByEmail` (re-criar):** rejeitada — troca o `id` do usuário, depende de auto-e-mail
  (contra a decisão de copiar link) e é mais pesado (recria profile).
- **Somente copiar, sem enviar e-mail:** substituído — o transporte Resend já existe e o E2E precisa comprovar a
  jornada recebida; o clipboard continua disponível como fallback.
- **`generateLink({type:'magiclink'})`:** rejeitada — semântica de **login**, não de aceite; misturaria dois
  fluxos de autenticação (review #1 do founder).

## References

- Spec: [convite-e-gestao-de-equipe.md](../implementation/convite-e-gestao-de-equipe.md) §Fase 2.
- Implementação: `resendClinicInvite`/`cancelClinicInvite` em
  [identity/internal/members.ts](../../src/contexts/identity/internal/members.ts);
  `resendInviteAction`/`cancelInviteAction` em [equipe/actions.ts](../../src/app/(app)/(shell)/equipe/actions.ts);
  UI em [equipe/invite-row-actions.tsx](../../src/app/(app)/(shell)/equipe/invite-row-actions.tsx).
- Entrega e template: [team-invite-email.ts](../../src/contexts/identity/internal/team-invite-email.ts) e
  [team-invite.ts](../../src/lib/email/templates/team-invite.ts).
- Prova ponta a ponta DEV: [team-invite-inbox-check.ts](../../scripts/team-invite-inbox-check.ts).
