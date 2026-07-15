# ADR-034 — Reenvio de convite: link copiável via `recovery`, não e-mail automático

**Status:** accepted · **Date:** 2026-07-10 (founder aprovou no planejamento da sub-fase 2a)
**Camada:** Identity (C3) · implementa a sub-fase 2a de [convite-e-gestao-de-equipe.md](../implementation/convite-e-gestao-de-equipe.md).
**Refs:** [ADR-032](032-mvp-identity-practitioner-model.md) §3 (canal = e-mail no MVP), ADR-008 (identity patterns),
ADR-010 (SECURITY DEFINER — não usado aqui), ADR-027 (convite mágico do onboarding — outro fluxo).

## Context

A sub-fase 1 cria convites de funcionário via `supabase.auth.admin.inviteUserByEmail` (o Supabase envia o link
pelo SMTP→Resend; o convidado define a senha em `/convite`). Faltava **reenviar** (o link tem TTL e expira) e
**cancelar**. Ao implementar o *reenvio*, dois fatos forçaram uma decisão que é **arquitetural, não só de
implementação**:

1. **O app não tem transporte de e-mail próprio.** Todo e-mail sai pelo **auto-send do Supabase** (o
   `forgot-password` usa `resetPasswordForEmail`; não há cliente Resend na aplicação). Não há como "reenviar um
   e-mail" a partir do nosso código sem introduzir um novo transporte.
2. **`invite` só serve para usuário NOVO.** `inviteUserByEmail` e `generateLink({type:'invite'})` **erram**
   (`email_exists`) quando o e-mail já pertence a um usuário — e o alvo do reenvio é, por definição, um usuário
   que **já existe** (o convite pendente).

## Decision

**Reenviar convite = gerar um link novo com `generateLink({ type: 'recovery' })` e COPIAR o link na UI; o owner
entrega manualmente (WhatsApp/e-mail).** Não há auto-envio de e-mail no reenvio.

- **Tipo `recovery`, não `invite` nem `magiclink`.** `recovery` é o primitivo correto para "re-emitir link de
  definição de senha a um usuário existente" — e **já está provado neste projeto** (é o mesmo tipo de link do
  `forgot-password`, em produção). Sua semântica é **"definir senha"**, idêntica ao que a tela `/convite` faz
  (`exchangeCodeForSession` + `updateUser({password})`), então funciona **sem qualquer alteração** na `/convite`.
  `magiclink` foi **rejeitado**: é login sem senha — semântica de autenticação diferente de aceite/onboarding;
  misturar os dois deixaria o fluxo de onboarding refém de mudanças de comportamento do Supabase.
- **Copiar link, não auto-e-mail**, porque: (a) não há SMTP na aplicação; (b) **WhatsApp é o canal principal**
  da clínica pequena — o owner cola o link onde já fala com a pessoa; (c) **funciona mesmo se o e-mail falhar**
  (entregabilidade, spam) — o dono sempre consegue entregar; (d) **menos dependências** (nenhum transporte novo).
- **Sem fallback entre fluxos.** `invite` para usuário novo (sub-fase 1), `recovery` para usuário existente
  (reenvio). Cada primitivo casa com sua situação; não há "tentar invite e cair em magiclink".

Cancelamento (mesma sub-fase) é ortogonal: hard delete do profile pendente (`profiles.id → auth.users`
`ON DELETE CASCADE`) + `deleteUser` best-effort — libera vaga e e-mail. Não envolve link/e-mail.

## Invariantes

- Reenvio **nunca** cria um segundo profile: mesmo `id`, só o link muda (o modelo já suportava — review #3).
- O link de reenvio é entregue **pelo owner**; a aplicação não promete auto-envio no reenvio.
- `recovery` é usado **exclusivamente** para re-emitir acesso a um convidado existente; não vira canal de login.

## Consequences

- (+) Zero dependência nova (sem cliente Resend/SMTP no app); funciona em qualquer ambiente.
- (+) Robusto: o dono entrega pelo canal que quiser; imune a falha de e-mail.
- (+) Semântica limpa — cada tipo de link (`invite`/`recovery`) casa com novo/existente; sem mistura com login.
- (−) O reenvio **não** dispara um e-mail automático — o owner precisa colar o link (decisão consciente; é o
  comportamento desejado para clínica pequena com WhatsApp).
- Porta aberta: se um dia quiser auto-e-mail no reenvio, adiciona-se um transporte (Resend) + `NEXT_PUBLIC_SITE_URL`
  canônico — **sem** tocar a semântica de tipos de link aqui fixada.

## Alternatives

- **`generateLink({type:'invite'})` + copiar:** rejeitada — erra em usuário existente (`email_exists`).
- **Delete + `inviteUserByEmail` (re-criar):** rejeitada — troca o `id` do usuário, depende de auto-e-mail
  (contra a decisão de copiar link) e é mais pesado (recria profile).
- **`generateLink({type:'magiclink'})`:** rejeitada — semântica de **login**, não de aceite; misturaria dois
  fluxos de autenticação (review #1 do founder).

## References

- Spec: [convite-e-gestao-de-equipe.md](../implementation/convite-e-gestao-de-equipe.md) §Fase 2.
- Implementação: `resendClinicInvite`/`cancelClinicInvite` em
  [identity/internal/members.ts](../../src/contexts/identity/internal/members.ts);
  `resendInviteAction`/`cancelInviteAction` em [equipe/actions.ts](../../src/app/(app)/(shell)/equipe/actions.ts);
  UI em [equipe/invite-row-actions.tsx](../../src/app/(app)/(shell)/equipe/invite-row-actions.tsx).
- Padrão de link recovery já em uso: [forgot-password/actions.ts](../../src/app/(app)/forgot-password/actions.ts).
