# ADR-037 — Sessão server-authoritative por request (auth epoch)

> **Verificação (2026-07-23)** — Decisão: ACTIVE · Implementação: IMPLEMENTED
> _Base: em produção (C0–C16 fechadas); confirmação por domínio na Onda 3._

**Status:** accepted
**Date:** 2026-07-16
**Camada:** C3 (Identidade)
**Supersede parcialmente:** ADR-009 (D12, D22 no sentido de identidade, D28)

## Context

A auditoria de identidade (`docs/achados/auditoria-autenticacao-identidade.md`, 2026-07-12) apontou
como o achado de maior alavanca o **I-4 — replay de access-token ≤15 min**: depois de um logout, de
uma desativação ou de uma troca de role, o JWT já emitido continuava plenamente autorizado até
expirar. O mesmo relatório trouxe o **I-7** (o cookie `_healed` era forjável e pulava o drift-check)
e o **I-11b** (mudança em `role_permissions` não era detectada por ninguém — ADR-008 D27, "débito
aceito, resolver com auth epoch global em C16").

A raiz era uma só: **a revogação não morava em lugar nenhum**. O middleware fazia um "heal" que a
própria ADR-009 D22 declara **não ser enforcement**: comparava `claims_version` do JWT com o banco,
mas com throttle de ~60-75s, pulável por um cookie forjável, e sem qualquer garantia. Enquanto isso a
porta única (`tenant-context.ts`) — que roda em 100% das Server Actions, Server Components e Route
Handlers — confiava no JWT sem nunca perguntar ao banco se aquela sessão ainda valia.

O produto está pré-produção (2 profiles em prod na data desta decisão). É o momento mais barato
possível para trocar a garantia de sessão.

## Decision

**A autoridade da sessão passa a ser verificada a cada request, na porta única.**

`authenticate()` (em `src/lib/auth/tenant-context.ts`) faz **uma** leitura autoritativa de `profiles`
por PK — memoizada por request via `React.cache` — e compara o `claims_version` do JWT com o do banco.
Divergiu, ou `ativo=false`, ou `deleted_at` → **a sessão está morta**. Fail-closed.

O middleware **deixa de fazer qualquer verificação de autorização**. O drift-check, o throttle
`_claim_check_at` e o cookie `_healed` foram **deletados** — não se assina um cookie que não precisa
existir. Ele mantém `getUser()`, que não é decoração: é o que **renova os cookies de sessão** no
`@supabase/ssr` (Server Component não pode escrever cookie).

> **Emenda de 25/07/2026:** esse último papel do middleware foi removido depois que o round-trip ao
> Auth passou a bloquear o Edge. A renovação posterior passou primeiro pelos consumidores browser
> (D126) e, em 14/09, por um Route Handler gravável (emenda abaixo). Autenticação e autorização
> continuam na porta única; o middleware não faz chamada de rede nem decide acesso.

### O invariante que sustenta tudo

> **`claims_version` bate ⟹ as claims do JWT são atuais.**

Isso só é verdade porque **toda** entrada de `effective_permissions_v` bumpa a versão:

| Fonte | Quem bumpa |
|---|---|
| `profiles.role` / `clinic_id` / `ativo` | trigger `BEFORE UPDATE` (in-row) |
| `user_permission_overrides` | trigger → `touch_claims_version(p_user_id)` |
| `role_permissions` (bundle global) | trigger da 0040 → `touch_claims_version(p_role)` ← **fecha o I-11b** |

**Quem adicionar uma nova fonte de permissão SEM bumpar `claims_version` reabre o I-4 em silêncio.**
Ao mexer em permissão, mexa no bump. O ponto único é `public.touch_claims_version()`.

### ⚠️ Invariante: `signOut` NÃO mata o access token

`signOut({scope:'global'})` e `auth.admin.signOut(userId)` revogam **refresh tokens**. O access token
JWT **continua criptograficamente válido até expirar** — o Supabase não tem revocation list, e o
token é self-contained.

Quem encerra a sessão em curso é **o epoch-check por request**, e nada mais.

Esta seção existe porque a conclusão intuitiva ("chamei signOut, matei a sessão") é **falsa** e vai
levar alguém, em algum momento, a remover o check do gate por achá-lo redundante. Não é. Os dois são
necessários e cobrem lados diferentes:

- **epoch-check** → mata o token que já está na mão do atacante.
- **signOut** → impede que o refresh token gere um token novo.

### Semântica sob impersonação (não-óbvia, testada)

O epoch confere o profile de **quem está logado** — o super_admin. Consequência deliberada:

- O **alvo** da impersonação mudar de role/ser desativado **NÃO** derruba a sessão de impersonate. E
  está certo: a sessão está atada a super_admin+clínica, não ao usuário-alvo (o super_admin nunca
  "vira" o alvo — `role`/`isSuperAdmin` permanecem, RLS e auditoria atribuem a ele).
- Desativar o **próprio super_admin** mata tudo no request seguinte.

Travado em `tenant-context.test.ts` ("impersonate sob epoch").

### Motivo estruturado em vez de `null`

`authenticate()` devolve `IdentityResult` = `{ok:true, identity}` | `{ok:false, reason}`.
`AuthDenialReason` é **uma união com dois produtores**, de propósito:

- **Sessão** (`authenticate`): `TOKEN_INVALID`, `NO_PROFILE`, `CLAIMS_OUTDATED`, `USER_DISABLED`, `USER_DELETED`.
- **Política** (`require*`): `MFA_REQUIRED`, `ROLE_DENIED`, `PERMISSION_DENIED`, `CLINIC_CONTEXT_REQUIRED`.

`MFA_REQUIRED` fica do lado da política e **não** no `IdentityResult`: `authenticate()` não sabe o que
a ação exige — quem sabe é `requireSuperAdmin`. Colocá-lo no resultado da autenticação faria a
autenticação conhecer as regras de autorização (inversão de dependência). A união compartilhada dá
taxonomia única para log/Sentry/auditoria sem colapsar as camadas.

`getCurrentUser()` **mantém o contrato** `CurrentUser | null` — nenhum dos 8 chamadores mudou.
`Identity` ganha `validatedAt` (ISO): a decisão passa a dizer de quando ela é.

## Consequences

- **I-4 morre.** Revogação vale no próximo request, não em 15 min.
- **I-11b / ADR-008 D27 morre.** Não foi preciso inventar um "epoch global": `claims_version` **já
  era** o epoch — faltava alguém bumpá-lo quando `role_permissions` mudava. A dívida **D4** do
  PROGRESS fecha aqui.
- **I-7 morre por remoção.** O `_healed` não é assinado: deixou de existir. Um `_healed` forjado hoje
  não tem para onde ir — não há código que o leia. `src/middleware.test.ts` guarda contra reintrodução.
- **I-6 / V7 fica mais forte.** A comparação `clinic_id` (banco × JWT) saiu do `requireFreshPermission`
  e subiu para o `authenticate()`: antes protegia só as `CRITICAL_ACTIONS`, agora vale para **todo
  request**. Repeti-la no fresh seria código inalcançável se fingindo de camada.
- **Custo:** +1 `SELECT` por PK indexado por request, memoizado. O middleware **perdeu** um fetch ao
  PostgREST a cada 60s e ~150 linhas (remontagem de cookie fragmentado, decode manual de JWT, jitter).
  Para as `CRITICAL_ACTIONS` o custo é **zero**: elas já pagavam este SELECT, que agora é compartilhado
  (`readAuthoritativeProfile`) — o fresh caiu de 4 para 3 queries.
- **Fail-closed contra banco fora** não custa nada: sem banco o app já está fora.
- **`requireCachedPermission` mudou de significado.** "Cached" não implica mais janela stale: o JWT só
  chega lá depois do epoch-check. A diferença para `requireFreshPermission` deixou de ser frescor e
  passou a ser defesa em profundidade (D20) — o fresh relê overrides/bundle linha a linha e cobre o
  único furo que o epoch não veria: um **bump perdido** no caminho das permissões.
- **Middleware continua sendo UX** (ADR-009 D22 segue valendo) — agora por escolha, não por limitação.
- **Como sair:** reverter o commit. O trigger e a função da 0040 são aditivos e inofensivos; sem o
  epoch-check, o sistema volta ao comportamento da ADR-009 (e ao I-4).

### Emenda D126 — transporte para consumidores browser (histórico substituído em 14/09/2026)

Naquele checkpoint, o cookie de sessão do `@supabase/ssr` usava explicitamente `httpOnly: false`,
`SameSite=Lax` e `Secure` em produção. `/convite` lia a sessão pelo SDK do browser e o Realtime
precisava do access token. Esse contrato foi uma reprodução necessária do problema e foi
substituído pela emenda server-only abaixo; não descreve o código atual.

Isso altera o transporte, não a autoridade. Server Components, Route Handlers e Server Actions
continuam validando assinatura, profile, `claims_version` e guards no servidor conforme esta ADR.
O Realtime é autorizado pelo JWT sob RLS; o filtro de `clinic_id` do canal serve apenas para
relevância e desempenho. Grants separados de recuperação, impersonação e cadastro anônimo mantêm
cookies próprios HttpOnly.

A regressão local usa o SDK Supabase instalado sobre Auth HTTP e Realtime WebSocket sintéticos:
confirma e submete convite, recusa convite inválido/expirado, autentica o primeiro join, propaga
refresh e não abre canal anônimo sem sessão. Ela não executa Supabase externo nem prova RLS.

O custo residual daquele checkpoint era explícito: JavaScript same-origin podia ler access e
refresh tokens. O risco `supabase-session-browser-readable` permaneceu pendente e sem aceite até a
implementação e a prova da emenda abaixo, quando saiu do registro de riscos abertos.

### Emenda de 14–15/09/2026 — sessão HttpOnly por geração e consumidores server-only

O contrato D126 acima descreve a correção local anterior e sua prova; **foi substituído nesta
retomada** para eliminar a exposição do bearer. Cada autenticação estabelece uma geração de 32
caracteres hexadecimais e armazena a sessão em `sb-<project>-auth-token-v2-<geração>`, incluindo seus
fragmentos quando necessários. O seletor `qoro-auth-session` aponta para a geração ativa. Ambos são
emitidos com `HttpOnly`, `SameSite=Lax` e `Secure` em produção. O SDK Supabase do browser foi removido:
access e refresh tokens são lidos e renovados apenas pelo servidor.

Login, confirmação OTP e login ao concluir `/join` criam uma geração nova; o adapter persiste os
fragmentos e grava o seletor por último. Refresh de uma geração nunca grava ou apaga o seletor,
inclusive em falha: uma resposta atrasada de A só pode regravar o cookie de A, sem substituir o
login B ou reativar uma sessão encerrada. Logout, troca de conta e conclusão de reset removem o
seletor explicitamente. A confirmação OTP desvincula a identidade anterior antes da verificação;
um OTP inválido não conserva a seleção antiga nem seleciona uma nova sessão.

`/convite` valida `getUser()` e o perfil autoritativo no Server Component e envia ao formulário
somente o estado do convite e metadados textuais limitados. A Server Action revalida a sessão, o
perfil e o aceite antes de definir a senha e renovar o token com claims. O Consultório consulta
`getBoard` por Server Action ao montar, ao trocar o médico e a cada **20 s** com aba visível;
falhas usam backoff de **5→10→20→30 s**. Essa troca removeu o canal Postgres Changes do browser.
Ela preserva atualização periódica e leitura autorizada pelo servidor, mas perde a latência de
evento do Realtime — decisão registrada também na ADR-019.

O middleware continua sem Auth ou banco no Edge. Quando uma navegação GET encontra a sessão perto
do vencimento, redireciona para `/auth/session-refresh`; o handler força `refreshSession()`, valida
`getUser()` em contexto gravável, persiste a rotação via `Set-Cookie` e retorna ao caminho interno
validado. Falha retornada pelo Auth encaminha ao `/login` público; exceção na renovação ou validação
retorna 503. Contextos de mutação da sessão Auth exigem escrita de cookies; somente Server Components toleram
o contexto de cookies somente leitura. O middleware expira cookies legados e cookies de gerações
órfãs, sem copiar bearer, reemitir cookies ativos ou alterar o seletor. O cutover exige uma nova
autenticação dos navegadores com a sessão legada; o nome antigo nunca é importado como sessão v2.

Essa mudança fecha a **leitura de access/refresh tokens por JavaScript** nas novas sessões após o
cutover; não elimina XSS. Um script injetado ainda pode acionar operações same-origin com a sessão
do usuário, sujeitas aos guards e controles CSRF. A CSP com `unsafe-inline` continua como risco
separado. Após a prova local, o risco específico saiu do registro de riscos abertos sem registrar
aceite humano fictício. A evidência desta emenda está no [Qoro v2 §35.6](../qorov2.md). O gate
`security:browser-session`, configurado em `playwright.httponly.config.ts`, exercita Chromium real
contra o build Next de produção isolado. Os testes do convite usam o SDK SSR instalado contra Auth
HTTP sintético em loopback; isso não equivale a executar GoTrue/Supabase externo. Rollout, Preview,
produção e revogação pelo provedor permanecem **NOT TESTED** nesta emenda. A geração resolve a
concorrência do seletor no navegador; não prova o encerramento de bearers copiados externamente,
nem altera a ordem epoch → `signOut` do logout.

### Registrado e recusado: enfileirar o `record_login_attempt`

Avaliado durante a revisão do plano. O outbox deste repo é **uma tabela no mesmo Postgres** —
enfileirar não tira o banco do caminho do login, só adia o *processamento*, não a *escrita*. Além
disso o efeito é o inverso do temido: a chamada era `supabase.rpc` (HTTP ao PostgREST) e passou a ser
`dbAdmin` (conexão direta), então o login ficou **mais rápido**. O risco real ("banco lento trava o
login") se resolve com best-effort de verdade — a chamada é `try/catch` e nunca bloqueia o login.

## Alternatives

- **Epoch cacheado no Redis (write-through) + fallback no banco:** rejeitada. Evitaria o SELECT por
  request, mas adiciona um cache para invalidar num caminho de segurança, e conflita com a postura
  **fail-open** do rate-limit atual (ADR-008 F-08) — revogação exige fail-closed. Se o SELECT um dia
  doer, mede-se e cacheia com dado real, não com medo.
- **Manter o débito D4 e só reduzir o TTL do access token:** rejeitada. Mitiga, não resolve: qualquer
  requisito de "revogar já" (resposta a incidente, LGPD) continuaria esbarrando na janela.
- **Assinar o cookie `_healed` (HMAC):** rejeitada. Resolveria o I-7 preservando uma máquina que
  existia só para compensar a falta de enforcement. Com o epoch no gate, o cookie não tem função.
- **Revocation list / `session_version` separado:** rejeitada por redundância. `claims_version` já é
  monotônico, já está no JWT e já tem triggers — criar um segundo contador seria uma segunda fonte de
  verdade para a mesma pergunta.

## Prova por quebra (evidência, não alegação)

O valor não está no teste verde, está aqui:

1. **Epoch (multi-aba):** logar em duas abas; desativar o usuário de outra sessão. Nas duas abas o
   **próximo request** já nega, com `USER_DISABLED` no log. Antes: até 15 min de acesso pleno.
2. **`_healed` forjado:** `curl -H 'Cookie: _healed=1'` não muda nada — não há leitor.
3. **Memoização:** `React.cache` só memoiza dentro do request scope do React. **Não é verificável em
   unit test** (sob vitest ele é passthrough) — `tenant-context.test.ts` diz isso explicitamente em
   vez de fingir cobertura. Verificar no app real.

## References

- Achado I-4/I-7/I-11b — [`docs/achados/auditoria-autenticacao-identidade.md`](../achados/auditoria-autenticacao-identidade.md)
- ADR-008 (P1/P2/D20/D27) · ADR-009 (D12/D22/D28 — parcialmente superseded) · ADR-010 (SECURITY DEFINER)
- Migration [`0040_auth_epoch_and_overrides_lockdown.sql`](../../drizzle/migrations/0040_auth_epoch_and_overrides_lockdown.sql)
- Código: [`src/lib/auth/tenant-context.ts`](../../src/lib/auth/tenant-context.ts) · [`src/middleware.ts`](../../src/middleware.ts)
- Testes: `src/lib/auth/tenant-context.test.ts` · `src/middleware.test.ts`
