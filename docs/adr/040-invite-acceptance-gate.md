# ADR-040 — Aceite do convite como gate de sessão

**Status:** accepted
**Date:** 2026-07-16
**Camada:** C3 (Identidade)
**Relaciona:** ADR-032 (identidade) · ADR-034 (resend copia link) · ADR-037 (epoch)

## Context

A auditoria de identidade (I-3) apontou que o link de convite é uma **credencial bearer de sessão
plena**. O profile convidado nascia `ativo=true` e `invite_accepted_at=null`; ao clicar o magic-link,
o convidado obtinha uma sessão AAL1 **completa** — podia usar o app **antes** de definir a senha. O
`invite_accepted_at` era **tracking**, não **gate**.

Como o resend, por ADR-034, **não faz auto-send** — mostra o link para o owner copiar e entregar por
WhatsApp/e-mail — o link é distribuído out-of-band. Encaminhado/vazado/no grupo errado, quem abrir
primeiro **vira** o titular do assento (define a senha), com todo o acesso do papel convidado. Não é
escalonamento (o convite é legítimo), é **account-takeover por link**.

## Decision

**O aceite vira condição de deny-by-default no hook** (migration 0041): enquanto
`invite_accepted_at IS NULL`, o `custom_access_token_hook` devolve o token **sem as claims da app**.
`getCurrentUser` retorna null com motivo `INVITE_PENDING`. A sessão do link só serve para **definir a
senha** em `/convite` (fora do matcher do middleware) — navegar no app é impossível até o aceite. O
campo de tracking virou gate **server-authoritative**, sem introduzir estado inválido novo.

Camadas complementares:

1. **Rate-limit no aceite** (I-12): `assertInviteAcceptAllowed(ip)` — 20/15min por IP, fail-open
   (F-08). O aceite é anônimo por natureza (a sessão vem do magic-link), então a chave é o IP.
2. **`signOut({scope:'others'})` ao definir a senha** (I-8): se o link vazou e alguém abriu antes,
   aquela sessão morre no momento do aceite legítimo.
3. **`refreshSession()` após o aceite**: o JWT em mãos foi emitido **pendente** (sem claims); troca-se
   por um com claims antes de ir ao `/dashboard`. Se o refresh falhar (rede), o convidado **não fica
   preso**: `redirect('/login?reason=invite_accepted')` — a senha já existe, o login é garantido, sem
   loop de retry.

### `DEFAULT now()` na coluna — fail-closed onde importa

A **fronteira de segurança do gate** é o fluxo de convite (`members.ts`) setar `invite_accepted_at =
NULL` **explicitamente** — esse é o único caminho não-confiável. Todo o resto (seeds, onboarding saga,
super_admin, futura criação admin) é criação **server-side confiável** e deve nascer **aceito**.
Portanto a coluna ganhou `DEFAULT now()`: sem ele, cada script/saga que esquecesse a coluna criaria um
usuário pendente e travado (fail-closed no lugar errado — lockout). Com ele, o gate segue fail-closed
**onde importa** (a INSERT do convite passa NULL de propósito), e o resto fica robusto.

O `scripts/seed-super-admin` foi corrigido para setar `now()` explicitamente (cinto-e-suspensório) —
um super_admin pendente seria lockout do painel.

### Ortogonal a `ativo`

O profile **continua** nascendo `ativo=true` (a quota de assentos conta pendente — ADR-024).
"Pendente" (ainda não provou o e-mail) e "inativo" (desligado) são estados diferentes e independentes.

## Consequences

- Um link vazado dá, no máximo, uma sessão que só define a senha — e ao definir, revoga as outras
  (I-8). O vetor de takeover por link fecha.
- O motivo `INVITE_PENDING` melhora telemetria/UX: quem clica o link e ainda não definiu a senha vê
  "Defina sua senha para concluir o convite", não "sessão inválida".
- **`⚠️` a recriação do hook copiou a 0006 (não a 0003)** — preservando `app_role`. Um teste do hook
  (`scripts/test-hook.ts`, cenário 6) prova o deny do convite pendente; o cenário 3 deixou de
  hardcodar "21 permissions" e passou a comparar com a fonte da verdade (`role_permissions`).
- Como sair: reverter a 0041 (CREATE OR REPLACE do hook/view sem a condição) + remover o rate-limit.
  A coluna e o DEFAULT são aditivos e inofensivos.

### A verificar no dashboard Supabase (config, não código)

O TTL e o single-use do link de recovery/convite são **configuração do GoTrue**, não versionáveis no
repo. **Pendência operacional:** confirmar no dashboard (Auth → Email → *Email OTP Expiration* /
*Mailer* / *Secure email change*) que o link tem TTL curto e é single-use. Registrar o valor achado
aqui quando verificado. Não presumimos o valor.

## Alternatives

- **Só rate-limit + TTL/single-use (sem gate no hook):** rejeitada — o link continuaria concedendo
  sessão plena ao ser aberto. O gate no hook é o que transforma o aceite em prova de posse do e-mail.
- **Gate de "primeiro acesso" na app (middleware/layout):** rejeitada — seria enforcement fora da
  fonte da verdade (a app poderia esquecer uma rota). O hook é server-authoritative e cobre 100%.
- **NÃO usar `DEFAULT now()` (exigir explícito em todo lugar):** rejeitada — espalharia fragilidade
  fail-closed (lockout) por ~10 scripts + saga + futura criação. A fronteira real de segurança é uma
  linha (`members.ts` seta NULL), não a ausência de default.

## References

- Achado I-3/I-12/I-8 — [`docs/achados/auditoria-autenticacao-identidade.md`](../achados/auditoria-autenticacao-identidade.md)
- Migration [`0041_invite_acceptance_gate.sql`](../../drizzle/migrations/0041_invite_acceptance_gate.sql)
- Código: [`convite/actions.ts`](../../src/app/(app)/convite/actions.ts) · [`rate-limit.ts`](../../src/lib/auth/rate-limit.ts) · [`tenant-context.ts`](../../src/lib/auth/tenant-context.ts) (INVITE_PENDING)
- ADR-034 (o resend copia o link — a razão do risco out-of-band) · ADR-037 (epoch)
