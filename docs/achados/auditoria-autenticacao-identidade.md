# Auditoria de Autenticação & Identidade — ClinicaOS_V2 (Qoro)

> **Escopo:** a **camada de identidade** ponta a ponta — autenticação, sessão, tokens/claims,
> MFA/AAL, autorização (RBAC), isolamento multi-tenant sob a lente de identidade, impersonation,
> ciclo de vida de usuário e recuperação de conta. **Lente:** identidade em produção e em escala,
> pensando como atacante, engenheiro de identidade e DevSecOps.
>
> **Posicionamento — deep-dive COMPLEMENTAR.** Já existem três auditorias irmãs de 2026-07-12 em
> `docs/achados/` — [`auditoria-seguranca-codigo.md`](./auditoria-seguranca-codigo.md),
> [`auditoria-apis-seguranca.md`](./auditoria-apis-seguranca.md) e
> [`auditoria-banco-dados.md`](./auditoria-banco-dados.md) — que já cobrem auth/authz/multi-tenant
> de forma ampla. Este relatório **não as reduplica**: aprofunda a lente de identidade, marca cada
> achado como **(N) novo** (contribuição desta auditoria) ou **(↔) reenquadrado** (cross-ref às
> irmãs), e nunca as contradiz sem justificativa.
>
> **Data:** 2026-07-12 · **Branch:** `docs/identity-practitioner-model` · **Metodologia:**
> DOCUMENTAÇÃO → FLUXO IDEAL → IMPLEMENTAÇÃO → RISCO · **Natureza:** somente leitura, nenhum código
> foi alterado.
>
> **🔧 REMEDIADA em 2026-07-16** — ver o **Placar** (logo abaixo) e o
> **[§9 Histórico de Implementação](#9-histórico-de-implementação-2026-07-16)**, com evidência por
> achado. O corpo do relatório (§0–§8) é **histórico** e foi preservado como escrito.

---

## Placar da remediação (2026-07-16)

| # | Sev | Status | Essência da correção |
|---|-----|--------|----------------------|
| **I-1** | MÉDIA | ✅ Resolvido | Bypass de super_admin exige AAL2 nos **4** helpers (`assertPlatformStepUp`) — o invariante implícito virou explícito e testado. ADR-037 |
| **I-2** | MÉDIA | ✅ Resolvido | `lifecycle.ts`: desativar/reativar/trocar role/override + guard-rails no domínio + UI + bloqueio de agenda com override auditado. ADR-039 |
| **I-3** | MÉDIA | ✅ Resolvido | Aceite vira **gate**: hook nega claims enquanto `invite_accepted_at IS NULL` (migration 0041). ADR-040 |
| **I-4** | MÉDIA-ALTA | ✅ Resolvido | **Epoch por request** na porta única — o replay de ≤15min morreu. Fecha a dívida **D4**. ADR-037 |
| **I-5** | MÉDIA | ✅ Resolvido | ADR-038 formaliza a política de MFA; o "ADR-008 D6" **nunca existiu**. Doc da VisãoGeral **já** fora corrigida em 2026-07-15 |
| **I-6** | MÉDIA | ✅ Já resolvido (07-14) + reforçado | O fix V7 existia desde 2026-07-14. Agora o check **subiu** do `requireFreshPermission` para o `authenticate()`: valia só p/ CRITICAL_ACTIONS, agora vale p/ **todo request** |
| **I-7** | MÉDIA | ✅ Resolvido **por remoção** | `_healed` deixou de existir junto com o heal do middleware. Não se assina um cookie que não precisa existir |
| **I-8** | BAIXA-MÉDIA | ✅ Resolvido | `signOut({scope:'others'})` em reset-password, aceite de convite e enroll de MFA. Determinístico — não depende de config invisível do GoTrue |
| **I-9** | INFO | ✅ Registrado | Troca de e-mail: não-feito **consciente**, com os requisitos de quando for feito (ADR-039) |
| **I-10** | BAIXA | ✅ Resolvido | Login lê `ativo`/`deleted_at` → `signOut(local)` + mensagem clara |
| **I-11a** | BAIXA | ✅ Resolvido | `REVOKE ... FROM anon` (0042) + call-site via `dbAdmin`. **Supersede a decisão da 0038** |
| **I-11b** | MÉDIA | ✅ Resolvido | Trigger em `role_permissions` (0040) + epoch. O velho **D27** fechou |
| **I-12** | MÉDIA | ✅ Resolvido | Faltava só o aceite (`assertInviteAcceptAllowed`) — o resto saíra no M3 em 2026-07-15 |

**Achado NOVO encontrado durante a remediação** (não estava em NENHUMA das 4 auditorias):

| # | Onde | Essência |
|---|------|----------|
| **I-13** 🔴 | `user_permission_overrides` (RLS + GRANTs) | **Escalonamento de privilégio explorável.** A tabela que define autorização foi classificada como tabela **tenant** e recebeu `defaultTenantPolicy` (`FOR ALL`) — a policy só compara `clinic_id`, nunca QUEM é o ator. Qualquer `authenticated` se auto-concedia qualquer permissão via PostgREST. **Provado em dev** com o JWT de um `attendant`: INSERT aceito → view concede → hook injeta no JWT. Pior: `claims_version` **não bumpava** (o trigger era SECURITY INVOKER e o UPDATE em `profiles` morria na RLS **em silêncio** — o mecanismo de segurança falhava ABERTO). Fechado em 2 camadas (GRANT + policy), cada uma provada isoladamente. **ADR-041** + Passo 0 no checklist de nova tabela. |

### O que a auditoria errou (verificado contra o código/banco, não contra o relatório)

- **I-6 já estava resolvido** desde 2026-07-14 (fix V7). O relatório o listava como aberto.
- **I-12 estava ~90% resolvido** (M3, 2026-07-15). Faltava só o aceite.
- **I-7 estava meio-resolvido**: o early-return já saíra de antes do `getUser()` (V4, 07-14).
- **I-5 (doc)**: a `VisãoGeral` §4.1/§7.9 **já fora corrigida** em 2026-07-15 — o que restava era a
  referência ao "D6" fantasma.
- **I-11a**: a recomendação foi **aceita**, mas contra a decisão da migration 0038, que mantivera o
  grant de propósito. O motivo dela ("o login precisa de anon") não se sustentava: `loginAction` é
  Server Action (Node) — chamar como `anon` era escolha, não necessidade.

---

## 0. Nota de aplicabilidade — OAuth 2.0 / OpenID Connect / .NET

O briefing pediu a skill **Duende** e traz seções específicas de ASP.NET Core / IdentityServer. A
stack real é **Supabase Auth (GoTrue) + Next.js 15 (Server Actions) + Postgres RLS + Drizzle** —
**não** há ASP.NET Core nem Duende IdentityServer no repositório. O **conhecimento de protocolo
OAuth/OIDC foi aplicado** ao que existe; os itens .NET-específicos ficam marcados **N/A** com
justificativa:

| Conceito do briefing | Aplica? | Como foi tratado / porquê N/A |
|---|:---:|---|
| Validação de JWT / assinatura / JWKS | ✅ | `getClaims()` valida assinatura via JWKS (chaves assimétricas) antes de confiar nas claims — [tenant-context.ts:113](../../src/lib/auth/tenant-context.ts#L113). Ver §Fluxo. |
| Anatomia de token / claims | ✅ | Access token JWT do Supabase + **custom claims** injetadas pelo hook (`clinic_id`, `role`→`app_role`, `permissions`, `claims_version`, `super_admin`, `aal`). Ver §3 e Achado I-1. |
| Refresh token rotation / revogação | ✅ | Supabase rota refresh tokens; `signOut({scope:'global'})` revoga server-side. Gap = replay do access token (Achado I-6). |
| PKCE / state / nonce (fluxo interativo) | ⚙️ parcial | Não há login social/OAuth de terceiros configurado (só e-mail+senha e magic link). PKCE/state seriam relevantes se `signInWithOAuth` for adotado — registrado como cuidado futuro. |
| Client credentials / M2M | ✅(análogo) | Cron/webhooks usam Bearer `CRON_SECRET`/token estático (não OAuth CC). Coberto pelas irmãs (apis M1/M2). |
| Introspection / reference tokens | ❌ N/A | Supabase usa **JWT self-contained**, não reference tokens; não há endpoint de introspection. |
| IdentityServer config (clients/scopes/resources) | ❌ N/A | Não há IdentityServer. Config de auth vive no dashboard Supabase + `custom_access_token_hook`. |
| ASP.NET middleware/policies/handlers, DCR, SAML, DPoP/mTLS/PAR/FAPI | ❌ N/A | Nenhum componente .NET/IdentityServer. A "policy layer" equivalente é `src/lib/auth/policies/*` + `tenant-context.ts` (avaliada abaixo). |

---

## 1. Resumo Executivo

### Postura geral de identidade: **MADURA / ACIMA DA MÉDIA** para um MVP

A camada de identidade é **coerente, centralizada e defendida em profundidade**, e adere aos ADRs
que a governam (ADR-008/009/010/032). Os pilares corretos:

- **Claims server-authoritative e não-forjáveis.** `clinic_id`, `role` e `super_admin` são
  injetados pelo `custom_access_token_hook` (Postgres, `SECURITY DEFINER`) — **não** vêm de
  `user_metadata` editável pelo usuário. O hook é **deny-by-default** (D36) e seu `EXECUTE` é
  `REVOKE FROM PUBLIC` + `GRANT` **apenas** a `supabase_auth_admin`
  ([0004:25-26](../../drizzle/migrations/0004_identity_hardening.sql#L25)).
- **Porta única de autorização** (`tenant-context.ts`) enforçada por ESLint: nenhum outro lugar de
  `src/` lê cookie/JWT ou decide role/permission.
- **Impersonation break-glass exemplar** (HMAC + linha autoritativa + AAL2 + TTL 1h + uma sessão
  ativa + auditoria).
- **Anti-enumeração** em login/forgot; **rate-limit dual** (IP + email_hash); **anti-escalonamento**
  no convite (`assertCanAssignRole`).

**Não há bypass de autenticação, forja de tenant, nem escalada de privilégio explorável hoje.** Os
riscos são **estruturais/latentes** (janelas de sessão, invariantes implícitos) e **de completude
do ciclo de vida** (faltam ações de offboarding/edição de identidade).

### Riscos de identidade de topo

| # | Achado | Sev. | Tipo | Essência |
|---|--------|:----:|:----:|----------|
| **I-1** | super_admin bypassa RBAC sem checagem de **AAL2** | MÉDIA | (N) | O early-return `isSuperAdmin` em `require*` não valida `aal`; segurança depende de invariante implícito não testado |
| **I-2** | **Ciclo de vida incompleto**: sem ação de desativar/editar membro ativo | MÉDIA | (N) | Offboarding e troca de role/override só via super_admin/SQL; ex-funcionário depende de canal manual |
| **I-3** | Link de convite/recovery = **credencial bearer** de sessão plena; profile nasce `ativo:true` | MÉDIA | (N) | `inviteAcceptedAt` é tracking, não gate; resend distribuído out-of-band (WhatsApp) |
| **I-4** | **Replay de access-token ≤15 min** após logout/desativação | MÉDIA-ALTA | (↔) | JWT válido até expirar; middleware é heal-layer, não enforcement |
| **I-5** | **MFA mínimo** para SaaS de saúde + doc divergente | MÉDIA | (↔) | Só super_admin obrigado; dado LGPD Art.11 operado com senha-só |
| **I-6** | `requireFreshPermission` **não revalida `clinic_id`** | MÉDIA | (↔) | Ação crítica roda na clínica do JWT durante drift de reatribuição |
| **I-7** | Cookie **`_healed` forjável** pula o middleware inteiro | MÉDIA | (↔) | Anula heal de drift/desativação em requests diretas |
| **I-8** | Reset/troca de senha e enroll de MFA **não revogam outras sessões** | BAIXA-MÉDIA | (N) | Recuperar conta comprometida não expulsa o atacante (depende de config GoTrue) |
| **I-9** | Sem **fluxo de troca de e-mail** | INFO | (N) | E-mail é o canal de identidade (ADR-032) mas não é alterável |
| **I-10** | Login **não checa `ativo`** (deny vem do hook) | BAIXA | (N) | Usuário desativado "loga" e cai em estado inerte; cosmético |
| **I-11** | `record_login_attempt` executável por **`anon`** + drift global de `role_permissions` | BAIXA/MÉDIA | (↔) | Forja de auditoria pré-auth; bundle de role sem heal automático |
| **I-12** | Sem **rate-limit** em invite/resend, MFA-verify, aceite, step-save | MÉDIA | (↔) | Abuso/brute-force do 2º fator via app; spam de recovery-link |

### Pontos fortes de identidade (não mexer)

Hook deny-by-default + grant restrito a `supabase_auth_admin`; claims não-forjáveis; `getClaims()`
com validação de assinatura; porta única `tenant-context`; impersonation server-authoritative;
separação **platform-auth** (`super_admin`, P7 — sem `clinic_id`, sem entry em `role_permissions`)
vs **tenant-auth**; anti-enumeração; rate-limit dual com fallback bounded; drift detection + heal;
matriz anti-escalonamento (owner/super_admin **nunca** atribuíveis por convite).

---

## 2. Área analisada

| Superfície | Arquivo(s) | Resultado |
|---|---|---|
| Injeção de claims / fonte da verdade | `drizzle/migrations/0003_identity_core.sql`, `0004_identity_hardening.sql` | ✅ deny-by-default + grant restrito |
| Porta única de authz | `src/lib/auth/tenant-context.ts` | 🟠 **I-1** (AAL2 no bypass) · 🟠 **I-6** (clinic_id) |
| Sessão / drift / heal | `src/middleware.ts`, `src/lib/auth/supabase-server.ts` | 🟠 **I-7** (`_healed`) · 🟠 **I-4** (replay) |
| Login / recuperação | `login/actions.ts`, `forgot-password/`, `reset-password/`, `login/mfa/` | 🟡 **I-8/I-10/I-12** |
| MFA / AAL | `src/lib/auth/mfa.ts`, `policies/mfa-policy.ts`, `account/security/actions.ts` | 🟠 **I-5** · 🟡 **I-12** |
| Impersonation | `src/lib/impersonation/{index,session,cookie}.ts` | ✅ exemplar |
| Convite / onboarding / aceite | `equipe/actions.ts`, `identity/internal/members.ts`, `role-matrix.ts`, `convite/actions.ts`, `join/[token]/actions.ts` | 🟠 **I-2/I-3** · 🟡 **I-12** |
| Ciclo de vida (edição/desativação) | `identity/queries.ts`, `identity/internal/members.ts` | 🟠 **I-2** (não implementado) |
| RBAC / catálogo | `permissions.ts`, `roles.ts`, `claims.ts`, `effective_permissions_v` | ✅ coerente |

Legenda: 🔴 ALTA · 🟠 MÉDIA · 🟡 BAIXA · ✅ sólido.

---

## 3. Mapa da arquitetura de identidade

```
Usuário
  │  e-mail + senha  (+ TOTP p/ super_admin)
  ▼
Server Action  loginAction  ──►  rate-limit DUAL (IP 10/15m + email_hash 5/15m)  +  anti-enumeração
  │                                record_login_attempt (auditoria best-effort)
  ▼
Supabase Auth (GoTrue)  ──►  signInWithPassword  ──►  emite JWT
  │                                                     ▲
  │   custom_access_token_hook (SECURITY DEFINER) ──────┘  injeta CLAIMS a cada emissão/refresh:
  │      • lê effective_permissions_v (1 query)             clinic_id, role(→app_role), permissions[],
  │      • DENY-BY-DEFAULT: inativo/deletado/inconsistente  claims_version, super_admin, aal
  │        → devolve event SEM claims                       (GRANT só a supabase_auth_admin)
  ▼
JWT (cookie sb-…-auth-token, fragmentado se grande)
  │
  ▼
Server Component / Server Action / Route Handler
  │   getCurrentUser()  = getClaims() [valida assinatura JWKS] + parseClaims (Zod) + overlay impersonate
  ▼
tenant-context.ts  — PORTA ÚNICA (ESLint-enforçada)
     requireUser · requireClinicId · requireRole · requireCachedPermission (JWT)
     requireFreshPermission (DB) · requireSuperAdmin (exige AAL2)
  │
  ▼
Camada de dados
     withTenant(clinicId) → SET LOCAL ROLE authenticated + GUC app.current_clinic → RLS
     (dbAdmin/BYPASSRLS só em seams controlados: hook selftest, impersonation, invite writes)
  ▼
Recurso protegido (profiles, prontuários, financeiro, …)

Middleware (heal-layer, NÃO enforcement — D22)
     valida presença de auth · compara JWT.claims_version × DB (throttle 60-75s)
     drift / ativo=false / deleted_at → signOut(global) + limpa cookies + /login?reason=…
```

**Onde a identidade mora:** `auth.users` (Supabase, gerencia credenciais/e-mail/factors MFA) +
`public.profiles` **1:1** via FK `profiles.id → auth.users.id ON DELETE CASCADE`
([0003:107-111](../../drizzle/migrations/0003_identity_core.sql#L107)). `profiles` **acumula três
conceitos** — User + Employee + Practitioner — num colapso consciente e temporário (ADR-032). Um
CHECK garante `super_admin ⇒ clinic_id NULL` e `demais ⇒ clinic_id NOT NULL`
([0003:40](../../drizzle/migrations/0003_identity_core.sql#L40)). **Um usuário = uma clínica**
(multi-clínica não suportado — ADR-008 frozen surface).

**RBAC:** `role_permissions` (bundles por role) `UNION` overrides concedidos `EXCEPT` overrides
negados, agregados na VIEW `effective_permissions_v`; `super_admin` **não** é populado em
`role_permissions` (shortcut via `is_super_admin()`).

**Impersonation (C15):** super_admin AAL2 assume uma clínica; `getCurrentUser` faz overlay de
`clinicId` efetivo + `ALL_PERMISSIONS`, mas `role`/`isSuperAdmin` permanecem (RLS e auditoria
atribuem ao super_admin). O cookie `qoro_imp` só carrega o `impersonationId` **assinado (HMAC)**; a
linha em `impersonation_sessions` é a autoridade.

---

## 4. Fluxo Atual (observado)

**Login.** `loginAction` valida entrada (Zod), aplica **rate-limit dual** *antes* de tentar a
senha, chama `signInWithPassword`, lê `profiles.role`+`mfa_enrolled_at` via RLS (`profiles_self_select`),
e roteia por `postLoginRedirect`: super_admin sem MFA → `/account/security?force=1`; super_admin com
MFA em AAL1 → `/login/mfa`; super_admin AAL2 → `/admin`; demais → `/dashboard`. Mensagens são
**genéricas** (anti-enumeração). O 2º fator (super_admin) é verificado em `verifyMfaAction`
(promove AAL1→AAL2).

**Sessão.** JWT self-contained em cookie `httpOnly` (fragmentado quando grande). `getCurrentUser`
usa `getClaims()` (valida assinatura), parseia as claims com Zod (deny se ausentes), e é
**memoizado por request** (`React.cache`). O middleware compara `claims_version` do JWT com o DB no
máximo 1×/60-75s e, em drift/desativação, faz `signOut(global)` + limpa cookies. **Logout**
(`POST /logout`) faz `signOut({scope:'global'})` (revoga refresh token).

**Permissões.** Toda Server Action revalida na porta única: `requireCachedPermission` (lê o JWT,
rápido, janela stale ≤15min) para o comum; `requireFreshPermission` (relê `role`/`ativo`/overrides
do banco) para as **CRITICAL_ACTIONS** (delete/sign/invite/estorno etc.), com arch-test de CI. O
`super_admin` faz early-return em todas.

**Acesso a recurso.** Query tenant-scoped via `withTenant` → RLS por `app.current_clinic`; o
`clinic_id` vem **sempre** de `requireClinicId()` (claim/impersonate), nunca de input.

---

## 5. Achados

> Formato por item conforme o briefing. Ordenados por severidade. **(N)** = novo desta auditoria ·
> **(↔)** = reenquadrado das irmãs sob a lente de identidade.

### I-1 (N) — super_admin bypassa RBAC sem checagem de AAL2 (invariante implícito não testado)

- **Severidade:** MÉDIA · **Categoria:** Autorização / Escalada de privilégio
- **Arquivo/local:** [tenant-context.ts:188](../../src/lib/auth/tenant-context.ts#L188) (`requireRole`),
  [:207](../../src/lib/auth/tenant-context.ts#L207) (`requireCachedPermission`),
  [:226](../../src/lib/auth/tenant-context.ts#L226) (`requireFreshPermission`).
- **Descrição:** os três helpers de autorização fazem `if (user.isSuperAdmin) return …` **sem
  checar `user.aal`**. Só `requireSuperAdmin()` exige AAL2 ([:311-323](../../src/lib/auth/tenant-context.ts#L311)).
  A segurança do super_admin em AAL1 (autenticado por senha, **antes** do TOTP) repousa num
  **invariante implícito**: toda ação alcançável por ele também chama `requireClinicId()` (que
  **lança** para super_admin sem impersonate, pois `clinicId=null` e impersonate exige AAL2) **ou**
  `requireSuperAdmin()` (AAL2). Esse invariante **não é enforçado por nenhum arch-test**.
- **Impacto:** uma Server Action futura (ou existente que eu não tenha amostrado) gateada **apenas**
  por `requireRole([...])` ou `requireCachedPermission(...)` — sem `requireClinicId`/`requireSuperAdmin`
  — ficaria acessível a um super_admin em **AAL1**, furando a exigência de MFA da conta mais
  poderosa da plataforma.
- **Cenário de exploração:** super_admin tem a sessão AAL1 logo após a senha (rota `/login/mfa`
  pendente). Se invocar diretamente (fetch à Server Action, sem passar pela UI roteada) uma ação
  cujo único gate seja `requireRole`/`requireCachedPermission`, o early-return `isSuperAdmin`
  concede — **sem** o 2º fator. Requer a conta super_admin já comprometida por senha; o MFA existe
  justamente para conter esse caso.
- **Risco futuro:** cresce a cada nova ação. É um convite a regressão silenciosa: o padrão "super_admin
  bypassa" é copiado sem lembrar que a rede de proteção (AAL2) mora em outro helper.
- **Correção recomendada:** (a) gatear o early-return de `isSuperAdmin` em `aal === 'aal2'` nos três
  helpers (fail-closed), **ou** (b) um arch-test que exija que toda Server Action exportada chame
  `requireSuperAdmin` **ou** `requireClinicId` (nunca só `requireRole`/`requireCachedPermission`),
  tornando o invariante explícito e testado.
- **Prioridade:** Média.

### I-2 (N) — Ciclo de vida de identidade incompleto: sem desativação/edição de membro ativo

- **Severidade:** MÉDIA · **Categoria:** Gestão de usuários / Manutenção
- **Arquivo/local:** [identity/internal/members.ts](../../src/contexts/identity/internal/members.ts)
  (só invite/resend/cancel); [identity/queries.ts:6-9](../../src/contexts/identity/queries.ts#L6)
  ("a EDIÇÃO de role/permissão é deliberadamente fora daqui … próximo passo").
- **Descrição:** o contexto Identity implementa **convidar**, **reenviar** e **cancelar convite
  pendente** — mas **não** implementa: (a) **desativar** (`ativo=false`) um funcionário já aceito;
  (b) **reativar**; (c) **trocar o role**; (d) **conceder/revogar overrides**. O enforcement do
  `ativo=false` **existe** (hook deny-by-default, heal do middleware, `requireFreshPermission` checa
  `ativo`), mas **a ação que o aciona não existe** no app. O ADR-032 §4 declara como **LEI** que
  desativar "bloqueia acesso + `signOut`" e "bloqueia enquanto houver agenda futura/consulta aberta"
  — nada disso está codificado ainda.
- **Impacto:** **offboarding depende de canal manual** (super_admin/SQL direto). Um funcionário
  demitido ou uma conta comprometida **não pode ser desligada pela clínica** através do produto —
  exatamente o cenário "usuário removido ainda acessando" do briefing. Combinado com **I-4** (replay
  de 15 min), a janela de acesso residual aumenta.
- **Cenário de exploração:** atendente é demitido; o owner não tem botão de desativar; até alguém
  rodar SQL, a conta segue plena. Se o ex-funcionário souber a senha, acessa prontuários/financeiro.
- **Risco futuro:** quando alguém implementar a edição às pressas, o risco é abrir uma UPDATE policy
  ampla em `profiles` (a ADR-008 D31 proíbe isso de propósito) ou esquecer o `signOut` do alvo. A
  falta de guard-rails ("último owner", "não rebaixar a si mesmo") já é reconhecida em queries.ts.
- **Correção recomendada:** implementar `deactivateMember`/`reactivateMember` + mutação de role/override
  via função `SECURITY DEFINER` dedicada (padrão D31), acionando `auth.admin.signOut(user_id)` do
  alvo na desativação; respeitar o bloqueio "agenda futura/consulta aberta" do ADR-032 §4; auditar.
- **Prioridade:** Média (é feature pendente com impacto de segurança — priorizar o **desativar**).

### I-3 (N) — Link de convite/recovery é credencial bearer de sessão plena; profile nasce ativo

- **Severidade:** MÉDIA · **Categoria:** Gestão de usuários / Sessão
- **Arquivo/local:** [members.ts:119-132](../../src/contexts/identity/internal/members.ts#L119)
  (profile `ativo:true`, `inviteAcceptedAt:null`); [members.ts:203-258](../../src/contexts/identity/internal/members.ts#L203)
  (`resendClinicInvite` gera link `type:'recovery'`); [convite/actions.ts:22-43](../../src/app/(app)/convite/actions.ts#L22)
  (aceite); ADR-034 (o owner **copia e entrega** o link).
- **Descrição:** o profile convidado é criado **`ativo:true`** com role e permissões plenas; o
  `inviteAcceptedAt` é **estado factual (tracking)**, não um **gate** de acesso. Ao clicar o
  magic-link do convite (ou o link `recovery` do resend), o convidado obtém uma **sessão AAL1
  completa** — pode usar o app **antes** de definir senha, e o `acceptInviteAction` apenas define a
  senha e marca o aceite. Por ADR-034, o resend **não** faz auto-send: a UI mostra o link para o
  **owner copiar e enviar por WhatsApp/e-mail**.
- **Impacto:** o link é uma **credencial bearer** que concede sessão ativa plena àquele assento.
  Distribuído out-of-band (WhatsApp), pode ser encaminhado/vazar/cair em grupo errado → **tomada de
  conta** do assento (com acesso a dado clínico/financeiro conforme o role convidado). Não é
  escalada (o convite é legítimo), mas é uma superfície de **account-takeover por link**.
- **Cenário de exploração:** owner cola o link `recovery` de um médico no grupo errado de WhatsApp;
  qualquer um que abra primeiro vira o médico (define a senha) — inclusive assinando prontuários se
  já houver permissão. Sem 2º fator obrigatório para o role médico (ver **I-5**), não há barreira.
- **Risco futuro:** conforme convites escalam, a taxa de vazamento de link sobe; sem TTL curto e
  sem rate-limit no aceite, o vetor amadurece.
- **Correção recomendada:** (a) **rate-limit** o aceite (`/convite`) como o `/join`; (b) TTL curto no
  link (config Supabase) + confirmar **single-use**; (c) tratar o "primeiro acesso" como gate
  explícito (ex.: exigir definir senha antes de liberar navegação); (d) documentar no runbook o
  risco de distribuição out-of-band e preferir e-mail direto ao usuário quando possível.
- **Prioridade:** Média.

### I-4 (↔) — Replay de access-token ≤15 min após logout/desativação (gap central de sessão)

- **Severidade:** MÉDIA-ALTA (lente de identidade) · **Categoria:** Sessão
- **Arquivo/local:** [logout/route.ts:15-18](../../src/app/(app)/logout/route.ts#L15);
  ADR-009 D12; middleware é heal-layer ([middleware.ts:10-13](../../src/middleware.ts#L10)).
- **Descrição:** `signOut({scope:'global'})` revoga o **refresh token** server-side, mas o
  **access-token JWT** permanece válido até expirar (TTL ≤15min, config Supabase). O middleware
  **não é enforcement** (D22) e ainda é *throttled* (60-75s) — ou seja, mesmo o heal de drift/
  desativação só age na próxima janela. Não há `session_version`/revocation list por-request.
- **Impacto:** após logout, desativação (`ativo=false`) **ou** mudança de role, o usuário/atacante
  de posse do access token continua **plenamente autorizado por até ~15min** (+ atraso do throttle).
  Para um sistema clínico, é a janela em que "usuário removido ainda acessa".
- **Cenário de exploração:** conta comprometida é "deslogada"/desativada pelo admin; o atacante que
  capturou o access token segue lendo/gravando por até 15min. As Server Actions confiam no JWT
  (`requireCachedPermission`) exceto nas críticas — mas mesmo `requireFreshPermission` relê o banco
  e barra por `ativo=false` **só** para não-super_admin (bom), enquanto as ações *cached* seguem
  liberadas na janela.
- **Risco futuro:** é o teto de garantia de sessão do sistema; qualquer requisito de "revogar já"
  (incident response, LGPD) esbarra nele.
- **Correção recomendada:** **auth-epoch global** (claim `session_epoch`/`session_version` comparada
  por request contra um valor por-usuário/global) — mata replay + drift de `role_permissions` (ver
  **I-11**). Curto prazo: reduzir o TTL do access token; adicionar `ativo`/epoch check nas ações
  *cached* mais sensíveis. Já mapeado para C16.
- **Prioridade:** Média-Alta (é o gap de sessão de maior alavanca). **Cruza:** seg-código V5, apis
  risco #3.

### I-5 (↔) — Cobertura de MFA mínima para um SaaS de saúde (+ documentação divergente)

- **Severidade:** MÉDIA · **Categoria:** Autenticação / Postura
- **Arquivo/local:** [mfa-policy.ts:14-29](../../src/lib/auth/policies/mfa-policy.ts#L14)
  (`mustHaveMFA`/`mustEnforceAAL2` = só `super_admin`); ADR-008 D6; **divergência doc:**
  `VisãoGeral.md` §4.1/§7.9 (diz gestor/financial obrigados a 2FA).
- **Descrição:** MFA (TOTP nativo do Supabase) é **obrigatório apenas para super_admin**. owner,
  gestor, financial e doctor — que operam **dado de saúde (LGPD Art. 11)** e **financeiro** —
  autenticam com **senha-só** (MFA é opt-in via banner). Não há **recovery codes** nem **admin
  reset** de MFA (reconhecido para C15). A `VisãoGeral` ainda afirma que gestor/financial são
  obrigados — **o código diverge da doc** (a autoridade é o ADR, mas a doc gera expectativa falsa).
- **Impacto:** o 2º fator não protege as contas que tocam o dado mais sensível; a proteção do assento
  clínico é só a senha (agravado por **I-3**). Além disso, a divergência doc↔código vira "bug report
  fantasma" e decisão de segurança ambígua.
- **Cenário de exploração:** senha de um gestor vaza (phishing/reuso) → acesso pleno a prontuários e
  financeiro, **sem** 2º fator. Nenhuma etapa adicional.
- **Risco futuro:** ao escalar para muitas clínicas, a ausência de MFA obrigatório em roles sensíveis
  é o item que um cliente enterprise/DPO vai cobrar primeiro.
- **Correção recomendada:** planejar MFA obrigatório (ou step-up) para roles que tocam LGPD/financeiro,
  **com recovery codes + admin reset** antes de tornar compulsório; **corrigir a `VisãoGeral`** para
  refletir o D6 atual. Considerar step-up (reautenticação/MFA) para CRITICAL_ACTIONS (ver Plano).
- **Prioridade:** Média (posture + doc; a correção da doc é imediata e barata). **Cruza:** apis §5.

### I-6 (↔) — `requireFreshPermission` não revalida `clinic_id` (drift de reatribuição)

- **Severidade:** MÉDIA · **Categoria:** Autorização / Multi-tenant
- **Arquivo/local:** [tenant-context.ts:224-306](../../src/lib/auth/tenant-context.ts#L224) (relê
  `role`/`ativo`/overrides, **não** `clinic_id`); `requireClinicId` usa o efetivo do JWT/impersonate
  ([:170-181](../../src/lib/auth/tenant-context.ts#L170)).
- **Descrição:** o check "fresh" das ações críticas relê autoridade do banco, mas o `clinic_id`
  efetivo continua vindo do **JWT** (snapshot). "Fresh" sugere revalidação total; o vínculo de
  clínica fica preso ao token.
- **Impacto/Cenário:** usuário movido da clínica A→B pode executar **ação crítica** (deletar paciente,
  assinar prontuário) no contexto **A** durante a janela de drift (throttle ~60-75s + TTL ≤15min),
  até o `claims_version` forçar logout. Operação rara, janela limitada.
- **Risco futuro:** reatribuição de clínica vira mais comum quando houver movimentação de equipe;
  o drift silencioso de tenant em ação crítica é o pior caso.
- **Correção recomendada:** incluir `clinic_id` (e `ativo`) na releitura de `requireFreshPermission`
  e comparar com o efetivo do JWT; divergência → forçar re-auth.
- **Prioridade:** Média. **Cruza:** seg-código V7.

### I-7 (↔) — Cookie `_healed` forjável pula o middleware inteiro

- **Severidade:** MÉDIA · **Categoria:** Sessão / Autenticação
- **Arquivo/local:** [middleware.ts:56-58](../../src/middleware.ts#L56).
- **Descrição:** `if (req.cookies.get('_healed')) return res;` dá early-return sem qualquer checagem.
  O cookie é `httpOnly/secure/strict` quando setado pelo servidor, mas `httpOnly` **não impede** um
  cliente de **enviar** `Cookie: _healed=1` numa request forjada (curl/Postman).
- **Impacto/Cenário:** um atacante em requests diretas anula o middleware por completo — inclusive o
  heal de drift/desativação (que faria `signOut(global)`). Contido **hoje** porque toda página/action
  re-chama `require*` (fail-closed no acesso a dado); mas combinado com um layout sem backstop
  (seg-código V9) e uma página futura descuidada, vira exposição.
- **Risco futuro:** amplia a janela de sessão desatualizada/desativada (piora **I-4**).
- **Correção recomendada:** não confiar em cookie de cliente para pular o middleware — assinar
  `_healed` (HMAC) ou usar sinal server-authoritative/TTL por sessão; no mínimo revalidar
  auth-presence mesmo com `_healed`.
- **Prioridade:** Média. **Cruza:** seg-código V4.

### I-8 (N) — Reset/troca de senha e enroll de MFA não revogam outras sessões

- **Severidade:** BAIXA-MÉDIA · **Categoria:** Sessão / Recuperação de conta
- **Arquivo/local:** [reset-password/actions.ts:20-25](../../src/app/(app)/reset-password/actions.ts#L20),
  [convite/actions.ts:38](../../src/app/(app)/convite/actions.ts#L38),
  [account/security/actions.ts:63](../../src/app/(app)/(shell)/account/security/actions.ts#L63)
  (todos `updateUser({...})` sem `signOut` explícito).
- **Descrição:** trocar senha (reset ou aceite) e enroll de MFA **não** revogam as demais sessões no
  código; a revogação depende de configuração do **GoTrue** (não visível no repositório). Se não
  estiver ativada, mudar a senha **não expulsa** sessões existentes (refresh tokens seguem vivos).
- **Impacto/Cenário:** vítima percebe comprometimento e "recupera" a conta trocando a senha — mas o
  atacante, com refresh token ativo, **continua dentro**. Reset é a principal ferramenta de resposta
  do usuário e pode não cumprir o propósito.
- **Risco futuro:** requisito clássico de segurança (invalidate-on-password-change) que, se ausente,
  aparece num pentest/DPO review.
- **Correção recomendada:** **verificar no dashboard Supabase** as flags de reautenticação/revogação
  em mudança de senha; se necessário, forçar `signOut({scope:'global'})` (menos a sessão atual) após
  `updateUser({password})`. Documentar a decisão.
- **Prioridade:** Baixa-Média (verificação primeiro; fix trivial se confirmado). **Cruza:** V10/apis M3
  (reset também sem rate-limit + erro cru).

### I-9 (N) — Sem fluxo de troca de e-mail

- **Severidade:** INFORMATIVO · **Categoria:** Gestão de usuários
- **Arquivo/local:** grep no repo — **nenhum** `updateUser({ email })`/fluxo de `email_change`.
- **Descrição:** e-mail é o **canal de identidade** (ADR-032 §3 — identidade e convites por e-mail),
  mas **não há** fluxo para o usuário trocar o próprio e-mail (nem admin trocar o de um membro). O
  ciclo de vida de identidade fica incompleto.
- **Impacto:** operacional — usuário que muda de e-mail corporativo fica preso ao antigo ou depende
  de recriação de conta (perdendo vínculo/histórico). Sem risco de segurança direto, mas troca de
  e-mail é superfície sensível (verificação dupla, revogação de sessões) que, quando implementada às
  pressas, costuma introduzir bugs de takeover.
- **Correção recomendada:** registrar como não-feito consciente; quando implementar, exigir
  verificação **do e-mail novo e do antigo**, reautenticação, e revogar sessões — usar o fluxo nativo
  do Supabase (double-confirm) em vez de caseiro.
- **Prioridade:** Baixa (feature futura; registrar a decisão).

### I-10 (N) — Login não checa `ativo`/`deleted_at` (deny real vem do hook)

- **Severidade:** BAIXA (coerência) · **Categoria:** Autenticação
- **Arquivo/local:** [login/actions.ts:54-63](../../src/app/(app)/login/actions.ts#L54) (lê
  `role`+`mfa_enrolled_at`, não `ativo`).
- **Descrição:** o `loginAction` não valida `ativo`/`deleted_at`. O **deny efetivo** vem do
  `custom_access_token_hook` (deny-by-default → token sem claims → `getCurrentUser` retorna null),
  então **não é furo**. Porém, `signInWithPassword` sucede e a action redireciona para `/dashboard`,
  criando o estado "logado mas nada funciona" (toda ação falha em `requireUser`), e uma sessão válida
  (sem claims) passa a existir.
- **Impacto:** UX confusa; log de `record_login_attempt` marca `success=true` para um usuário
  desativado. Cosmético.
- **Correção recomendada:** após o `signInWithPassword`, se o profile estiver `ativo=false`/deletado,
  fazer `signOut({scope:'local'})` e retornar mensagem clara (como já se faz para "profile inválido").
- **Prioridade:** Baixa.

### I-11 (↔) — `record_login_attempt` executável por `anon` + drift global de `role_permissions`

- **Severidade:** BAIXA/MÉDIA · **Categoria:** Segurança / Autorização
- **Arquivo/local:** [0004:35-36](../../drizzle/migrations/0004_identity_hardening.sql#L35) (GRANT a
  `anon`); ADR-009 D27 (drift global não detectado).
- **Descrição:** dois itens de identidade herdados das irmãs: (a) `record_login_attempt(email_hash,
  ip, success)` é `GRANT EXECUTE` a **`anon`** via PostgREST → um anônimo pode **injetar linhas
  forjadas** em `login_attempts` (poluição da auditoria pré-auth); o `email_hash` exige o pepper
  secreto (`LOGIN_HASH_PEPPER`), então não se mira uma vítima com precisão. (b) Mudança em
  `role_permissions` (bundle de um role) **não** dispara o heal automático (só role/clinic/ativo do
  usuário) — exige **logout operacional manual** (D27).
- **Impacto:** (a) auditoria de login inflável por anônimo (o rate-limit primário é Upstash, não lê
  desta tabela — impacto limitado); (b) alteração global de permissão de um role fica **stale** até
  logout manual — usuários seguem com o bundle antigo por toda a janela do token + navegação.
- **Correção recomendada:** (a) `REVOKE EXECUTE … FROM anon` em `record_login_attempt` — o login flow
  server-side pode chamar via role apropriado; ou mover o registro para dentro de um caminho
  autenticado/service. (b) **auth-epoch global** (mesmo fix de **I-4**) resolve o drift de
  `role_permissions`.
- **Prioridade:** Baixa (a); Média (b, junto de I-4). **Cruza:** seg-código V15/V5, banco A15/A16.

### I-12 (↔) — Sem rate-limit em invite/resend, MFA-verify, aceite e step-save

- **Severidade:** MÉDIA · **Categoria:** Autenticação / Abuso
- **Arquivo/local:** [equipe/actions.ts](../../src/app/(app)/(shell)/equipe/actions.ts) (invite/resend/
  cancel — sem RL); [login/mfa/actions.ts:14](../../src/app/(app)/login/mfa/actions.ts#L14) (verify —
  sem RL); [convite/actions.ts](../../src/app/(app)/convite/actions.ts) (aceite — sem RL);
  [join/[token]/actions.ts:53](../../src/app/(app)/join/[token]/actions.ts#L53) (`saveStepAction` — sem RL).
- **Descrição:** o rate-limit dual cobre **login**, **reset** e o **checkout do `/join`**, mas **não**:
  invite/resend (cada resend gera um **recovery link real** do Supabase — custo + e-mail),
  **MFA-verify** (depende só do throttle do GoTrue), o **aceite** de convite, nem o step-save do wizard.
- **Impacto/Cenário:** um gestor autorizado-porém-malicioso (ou conta comprometida) faz **loop de
  resends** → spam de recovery-links com a marca do cliente; MFA-verify sem limite de app amplia o
  brute-force do 2º fator; aceite sem limite amplia o vetor de **I-3**.
- **Correção recomendada:** aplicar `Ratelimit` (o helper e o padrão fail-open já existem) a
  invite/resend (por clínica e por ator), MFA-verify (por usuário/IP), aceite (por IP) e step-save.
- **Prioridade:** Média. **Cruza:** apis M3.

---

## 6. Não-achados verificados (economiza retrabalho de revisão)

Controles **checados e corretos** — para o próximo revisor não reabrir:

- **Claims não-forjáveis.** `clinic_id`/`role`/`super_admin` vêm do `custom_access_token_hook`
  (server-side), **não** de `user_metadata`. O `EXECUTE` do hook é `REVOKE FROM PUBLIC` + `GRANT`
  só a `supabase_auth_admin` ([0004:25-26](../../drizzle/migrations/0004_identity_hardening.sql#L25)).
  Um usuário **não** consegue setar o próprio `clinic_id`/role no token.
- **Deny-by-default do hook (D36):** inativo/deletado/`role NULL`/`permissions NULL`/inconsistência
  `role×clinic_id` → token **sem claims** ([0003:308-318](../../drizzle/migrations/0003_identity_core.sql#L308)).
- **Validação de assinatura:** `getCurrentUser` usa `getClaims()` (JWKS p/ chaves assimétricas),
  não `getSession()` (ESLint bane `getSession`).
- **PostgREST `role` reservado:** o claim é `app_role` (não `role`), evitando "role X does not exist"
  ([claims.ts:5-14](../../src/lib/auth/claims.ts#L5)).
- **Impersonation:** cookie só carrega o `impersonationId` **assinado (HMAC constant-time)**; a linha
  em `impersonation_sessions` manda; `resolveImpersonation` só devolve algo para **super_admin AAL2**
  e faz **bind ao super_admin** (cookie vazado não serve a outro); TTL 1h; uma sessão ativa; auditado.
- **Anti-escalonamento no convite:** `InvitableRole` exclui owner/gestor/super_admin e
  `assertCanAssignRole` nega owner/super_admin server-side ([role-matrix.ts:19-28](../../src/contexts/identity/internal/role-matrix.ts#L19)).
- **Anti-enumeração:** login e forgot retornam mensagem/estado genéricos; forgot sempre `sent:true`.
- **`requireSuperAdmin` exige AAL2** — a base do modelo de break-glass (ver a ressalva **I-1** sobre
  os *outros* helpers).
- **Cap de permissões (D34):** hook `RAISE EXCEPTION` acima de 128; `ClaimsSchema` reforça `.max(128)`.

---

## 7. Matriz de Risco

| Problema | Impacto | Probabilidade | Prioridade |
|---|---|---|---|
| **I-4** Replay de access-token ≤15 min | Alto (acesso residual pós-revogação) | Média (exige token capturado/logout) | **Alta** |
| **I-2** Sem offboarding/edição de membro ativo | Alto (ex-funcionário acessa) | Média (rotatividade real) | **Alta** |
| **I-1** super_admin sem AAL2 no bypass | Alto (se explorado) | Baixa (exige senha super_admin + ação sem `requireClinicId`) | **Média** |
| **I-3** Link de convite = bearer de sessão | Médio (takeover de assento) | Média (distribuição out-of-band) | **Média** |
| **I-5** MFA mínimo + doc divergente | Médio (contas sensíveis só-senha) | Média (phishing/reuso) | **Média** |
| **I-6** `clinic_id` não revalidado no fresh | Médio (ação crítica no tenant errado) | Baixa (janela curta) | **Média** |
| **I-7** `_healed` forjável | Médio (anula heal) | Baixa (contido por `require*`) | **Média** |
| **I-12** Sem rate-limit em invite/MFA-verify/aceite | Médio (spam/brute-force) | Média | **Média** |
| **I-8** Mudança de senha não revoga sessões | Médio (recuperação não expulsa atacante) | Baixa (depende de config) | **Média** |
| **I-11** `record_login_attempt` por anon / drift global | Baixo-Médio | Média (a) / Baixa (b) | **Baixa/Média** |
| **I-10** Login não checa `ativo` | Baixo (UX) | Baixa | **Baixa** |
| **I-9** Sem troca de e-mail | Baixo (operacional) | — | **Baixa** |

---

## 8. Plano de Evolução

### Agora (imediato — dias, alto valor/baixo custo)
1. **I-1** — gatear o early-return `isSuperAdmin` em AAL2 (fail-closed) **ou** arch-test do invariante.
2. **I-5 (doc)** — corrigir `VisãoGeral.md` §4.1/§7.9 para refletir o D6 (só super_admin obrigatório).
3. **I-10** — `signOut(local)` + mensagem clara quando o profile logado está `ativo=false`/deletado.
4. **I-8** — **verificar** a config de revogação-on-password-change no dashboard Supabase (e forçar
   `signOut(global)` pós-`updateUser` se necessário).
5. **I-11a** — `REVOKE EXECUTE … FROM anon` em `record_login_attempt`.

### Curto prazo (semanas)
6. **I-2** — implementar **desativar/reativar membro** (+`signOut` do alvo, bloqueio de agenda futura
   do ADR-032 §4) e a mutação de role/override via `SECURITY DEFINER` com guard-rails.
7. **I-12** — rate-limit em invite/resend, MFA-verify, aceite e step-save (helper já existe).
8. **I-3** — rate-limit + TTL curto/single-use no aceite; gate de "primeiro acesso"; runbook de
   distribuição de link.
9. **I-7** — não confiar no `_healed` do cliente (HMAC/TTL server-side).
10. **I-6** — incluir `clinic_id`/`ativo` na releitura de `requireFreshPermission`.

### Escala futura (mês+ / estratégico — já mapeado p/ C16)
11. **I-4 + I-11b** — **auth-epoch global** (revogação imediata: mata o replay de 15 min **e** o drift
    de `role_permissions`). É a maior alavanca de identidade.
12. **I-5 (posture)** — MFA obrigatório/step-up para roles LGPD/financeiro **com recovery codes +
    admin reset**; considerar step-up (reautenticação/MFA) nas CRITICAL_ACTIONS.
13. **Ciclo de vida de identidade completo** — troca de e-mail (I-9), reset de MFA administrativo,
    fluxo de "esqueci meu 2º fator".
14. **Decomposição `User → Employment → Practitioner`** (ADR-032, colapso 🔓 temporário) e
    **multi-clínica por usuário** — retrabalho conhecido quando aparecer médico terceirizado/
    multi-clínica; hoje o CHECK `super_admin⇔clinic_id` e "um user = um clinic_id" travam o modelo.
15. **Sessão detalhada** (D38 adiado) — tabela `sessions` própria (IP/UA/revogação granular) em vez
    de depender de `auth.sessions`.

---

## Anexo A — Metodologia & limites

- **Auditoria manual especializada** de identidade, correlacionando IMPLEMENTAÇÃO × ADRs × as 3
  auditorias irmãs. Skill **OAuth/OIDC (Duende)** aplicada no nível de protocolo; itens
  IdentityServer/ASP.NET marcados N/A (§0) — decisão registrada com o founder.
- **Cobertura:** 100% da camada de identidade (hook/claims, `tenant-context`, middleware, login/
  logout/reset/forgot, MFA, impersonation, convite/onboarding/aceite, role-matrix, RLS de `profiles`).
  As 3 irmãs já rodaram Semgrep/CodeQL/security-review; **este relatório não re-executa ferramentas**
  — cita os resultados delas onde relevante e adiciona a lente de identidade.
- **Somente leitura.** Nenhum código, migração ou config foi alterado. Referências de linha refletem
  o branch `docs/identity-practitioner-model` na data acima. **Não** substitui pentest dinâmico.

## Anexo B — Cross-reference com as auditorias irmãs

| Este relatório | seguranca-codigo.md | apis-seguranca.md | banco-dados.md |
|---|---|---|---|
| I-4 (replay 15 min) | V5 | risco #3 | — |
| I-5 (MFA + doc) | — | §5 (doc MFA) | — |
| I-6 (clinic_id fresh) | V7 | — | — |
| I-7 (`_healed`) | V4 | — | — |
| I-11 (anon RPC / drift) | V15 / V5 | — | A15/A16 |
| I-12 (rate-limit) | — | M3 | — |
| I-1, I-2, I-3, I-8, I-9, I-10 | — | — | — (novos desta auditoria) |

---

## 9. Histórico de Implementação (2026-07-16)

> Remediação completa. Branch `docs/identity-practitioner-model`. Cada achado abaixo tem **evidência**
> — o que mudou, onde, e como foi provado. Testes: **669 → 756**. Migrations **0040–0042** aplicadas
> em dev e verificadas via MCP. ⏳ **Prod ainda não migrado** (0037–0042 entram juntas no deploy).

### A jogada central: um fix arquitetural fechou quatro achados

**I-4, I-7, I-11b e (parte de) I-2** não foram corrigidos separadamente. A raiz era uma só: **a
revogação não morava em lugar nenhum**. O middleware fazia "heal" que a própria ADR-009 D22 declara
**não ser enforcement** — throttled 60-75s, pulável por um cookie forjável — enquanto a porta única
(que roda em 100% das Server Actions/Components/Handlers) confiava no JWT sem nunca perguntar ao banco.

O enforcement mudou para a porta única: `authenticate()` relê o profile por PK (memoizado) e compara
`claims_version` a cada request. Divergiu → sessão morta, fail-closed.

**Não foi preciso construir um "auth-epoch global"** (a dívida D4, aceita desde a ADR-009): o
`claims_version` **já era** o epoch — monotônico, já no JWT, já com triggers. Faltava (1) alguém
conferir por request e (2) um trigger em `role_permissions`, a única entrada de permissão que ninguém
bumpava (o velho D27). O heal inteiro do middleware foi **deletado**: ~150 linhas de remontagem de
cookie fragmentado, decode manual de JWT e jitter — e o `_healed` sumiu junto (I-7 morreu por
**remoção**, não por assinatura HMAC).

**Custo:** +1 SELECT por PK indexado, memoizado por request. Para as `CRITICAL_ACTIONS` o custo é
**zero** — elas já pagavam esse SELECT, que agora é compartilhado (`readAuthoritativeProfile`): o
fresh-check caiu de 4 para 3 queries. O middleware **perdeu** um fetch ao PostgREST a cada 60s.

### Evidência por achado

| Achado | Onde | Prova |
|---|---|---|
| **I-1** | `assertPlatformStepUp` nos 4 early-returns de `isSuperAdmin` | `tenant-context.test.ts`: AAL1 → 403 `MFA_REQUIRED` nos 4; AAL2 → passa (P7 preservado). O comentário do `critical-actions.ts` que descrevia o invariante implícito foi corrigido |
| **I-2** | `identity/internal/lifecycle.ts` + `equipe/actions.ts` + `member-row-actions.tsx` | 17 testes (guard-rails + auditoria). Em dev: desativar bumpa `claims_version` **e** o hook passa a negar claims |
| **I-3** | migration 0041 (hook + view) | Em dev: pendente → `app_role` NULL; após aceite → `app_role=doctor`. `test:hook` cenário 6 |
| **I-4** | `authenticate()` + epoch-check | `tenant-context.test.ts`: JWT v1 × banco v2 → `CLAIMS_OUTDATED`; teste de refresh concorrente |
| **I-5** | ADR-038 + `mfa-policy.ts` + PROGRESS + VisãoGeral | 3 refs a "ADR-008 D6" → ADR-038; 0 restantes |
| **I-6** | `authenticate()` (subiu do fresh) | `tenant-context.test.ts`: divergência de `clinic_id` barra até uma ação **não-crítica** |
| **I-7** | `middleware.ts` (heal deletado) | `middleware.test.ts`: o módulo só exporta `config`+`middleware`; guard de fonte contra reintrodução de `_healed` |
| **I-8** | reset-password, convite, MFA enroll | Verificado no `.d.ts` do auth-js 2.106.2 que `scope:'others'` existe (não presumido) |
| **I-10** | `login/actions.ts` | Select passa a trazer `ativo`/`deleted_at`; inativo → `signOut(local)` + mensagem |
| **I-11a** | migration 0042 + `lib/auth/login-audit.ts` | Em dev: `anon` → `permission denied`; `service_role` registra (linhas +1). `test:auth-e2e` verde |
| **I-11b** | trigger `role_permissions` (0040) | Em dev: mudar o bundle bumpou `claims_version` de **todos** os profiles da role |
| **I-12** | `assertInviteAcceptAllowed` | `rate-limit.test.ts`: fail-open com `kind: 'accept'` |
| **I-13** 🔴 | migration 0040 (GRANT + policy) | Em dev: attendant → `permission denied` em INSERT/UPDATE/DELETE; **e** a policy segura sozinha mesmo com o GRANT restaurado à força (2 camadas provadas isoladamente); SELECT segue OK (a tela Equipe não quebra) |

### Decisões que se desviaram da recomendação (com motivo)

1. **I-2 — o `signOut` do ADR-032 §4 não existe e não é necessário.** O §4 mandava "ativo=false +
   signOut". Verificado no `.d.ts`: **não há signOut administrativo por userId** no supabase-js
   2.106.2 (`admin.signOut` exige o JWT do próprio alvo). E o ADR-037 o tornou **redundante**:
   `ativo=false` bumpa `claims_version` (o token vivo morre no próximo request) e qualquer refresh cai
   no deny-by-default do hook. Não fingimos a chamada. Registrado no ADR-039.
2. **I-2 — o bloqueio de agenda NÃO mora no Identity.** `scheduling` já importa `identity/schema`; o
   inverso seria ciclo (quebraria `arch:check`). A composição mora na **app-layer**, o único lugar
   autorizado a falar com os dois contextos. Scheduling expõe `doctorActiveCommitments` (é dono da
   regra do que conta como "agenda futura/consulta aberta").
3. **I-11a — supersede a 0038.** Ver §0.
4. **`record_login_attempt` NÃO foi para fila** (avaliado e recusado): o outbox é uma tabela **no
   mesmo Postgres** — enfileirar não tira o banco do caminho do login, só adia o processamento. E o
   efeito foi o inverso do temido: a chamada era `supabase.rpc` (HTTP ao PostgREST) e virou `dbAdmin`
   (conexão direta) → o login ficou **mais rápido**.
5. **Editor de overrides na UI: não-feito consciente.** A capacidade existe (domínio + action +
   testes), é auditada, e é o **único** caminho de escrita desde o I-13. Falta a tela de matriz — que
   o ADR-032 §6 modela como *nudge*. Não é gap de segurança: sem a tela, ninguém escreve override.

### Correções de rota descobertas ao implementar

- **`check:migrations` dava falso positivo** em `REVOKE ... TRUNCATE` (TRUNCATE é comando **e** nome de
  privilégio). A saída fácil seria marcar a migration como `destructive-approved` — o que silenciaria o
  gate para um `DROP TABLE` futuro no mesmo arquivo. O guard passou a resolver por statement, com 10
  testes (incluindo a contraprova de que TRUNCATE-comando **ainda** é pego).
- **`test-hook` e `smoke-login` hardcodavam "21 permissions"** — envelhecido para 24 (C7/C11). Passaram
  a comparar com `role_permissions` (fonte da verdade). Era falha pré-existente, não da remediação.
- **Um teste flaky que eu mesmo introduzi**: comparava `validatedAt` (wall-clock) entre duas chamadas
  concorrentes — sob `React.cache` real elas compartilham o resultado, mas sob vitest (passthrough)
  divergem por milissegundo. Corrigido para comparar a **decisão**, não o timestamp. Suíte estável em
  3 execuções seguidas.

### Limite honesto de cobertura

`React.cache` só memoiza dentro de um request scope do React — **sob vitest é passthrough**. Portanto
`tenant-context.test.ts` **não consegue** provar "1 leitura por request"; contar leituras ali mediria o
ambiente de teste, não a produção. O arquivo diz isso explicitamente em vez de fingir cobertura. A
memoização se verifica no app real (ver "Prova por quebra" no ADR-037). O repo não tem E2E
(CONVENTIONS: "E2E só em C16 se necessário") e **não introduzimos Playwright** por isto — o caso
multi-aba virou verificação manual roteirizada no runbook de offboarding.

### Rastreabilidade

| Fase | Commit | Conteúdo |
|---|---|---|
| 1 | `0e3b6be` | Epoch/`authenticate()` + AAL2 + middleware enxuto + I-13 + ADR-037 |
| 2 | `cba6812` | Ciclo de vida + UI + ADR-039 + runbook de offboarding |
| 3 | `70c2f19` | Aceite como gate + rate-limit + I-8 + ADR-040 |
| 4 | `c4555af` | I-11a (0042) + I-10 + I-8 (reset/MFA) |
| 5 | *(este)* | ADR-038, ADR-041, índice de ADRs (+ADR-034, que faltava), CONVENTIONS, PROGRESS (D4 fechado), este histórico |

**ADRs novos:** 037 (sessão server-authoritative), 038 (política de MFA), 039 (ciclo de vida),
040 (gate do aceite), 041 (tabela de authz não é tabela de tenant).
