# Spec de Implementação — Convite e gestão de equipe (Identity)

**Status:** sub-fase 1 (Convidar) **IMPLEMENTADA** (2026-07-05) · sub-fase **2a (reenviar/cancelar convite)
IMPLEMENTADA** (2026-07-10, [ADR-034](../adr/034-invite-resend-copy-link.md)) · sub-fases 2b (desativar/reativar +
overrides) e 3 pendentes · **Camada:** follow-up de C3 (Identity) + toque em C13 (Billing) ·
**Refs:** ADR-008 (identity patterns — P6/D20/D27/D31/D33/F-14), ADR-010 (SECURITY DEFINER),
ADR-024 (plano = só limites; `users` é trava dura), ADR-027 (padrão de convite mágico — referência),
ADR-016 (lifecycle: clínica suspensa não convida), ADR-007 (RLS), ADR-011 (outbox/audit),
ADR-034 (reenvio = link copiável via `recovery`).

> **Contexto.** A tela [Equipe & Permissões](../../src/app/(app)/(shell)/equipe/page.tsx) hoje é
> **somente leitura** — o próprio código avisa *"Convites e edição de função chegam em seguida"*
> ([page.tsx:76](../../src/app/(app)/(shell)/equipe/page.tsx#L76)). Não existe fluxo de criação de
> usuário **dentro** da clínica; o único que existe é o convite mágico que cria o **owner** no
> onboarding (ADR-027). Esta spec adiciona o convite de funcionário, **diferenciado por quem convida**,
> sem tocar no modelo de roles.

> **Sub-fase 1 implementada (2026-07-05) — decisões do review do founder:**
> - **[#1]** Estado do convite é FACTUAL: coluna `profiles.invite_accepted_at` (NULL = pendente; setada no
>   aceite em `/convite`). **Nunca** derivar "pendente" de `ativo`/`mfa`/último-login.
> - **[#2]** Convite pendente **OCUPA vaga** — o profile nasce `ativo:true` → conta em `assertUserQuota`.
> - **[#3]** Reenvio (sub-fase 2) reusa o **mesmo profile** (o Supabase gera um link novo). O modelo já suporta.
> - **[#4]** Expiração segue o TTL do Supabase Auth; expirado → reenviar (sub-fase 2). Até lá: "Convite pendente".
> - **[#6]** A compensação (`deleteUser`) é best-effort → **débito**: reconciliação auth↔profile (sub-fase 2).
> - CRM opcional no convite, **normalizado** (`identity/internal/normalize-crm.ts`) + `UNIQUE(clinic_id, crm)`
>   (ADR-032 §5, migração `0037`). Badge **"Médico incompleto"** já aparece na Equipe.

> **Princípio que orienta tudo aqui (decisão do founder — 2026-07-03).** Foco em clínica pequena
> **não** vira redução do `role_enum` (congelado/append-only) nem mudança de `role_permissions`
> (global → logout operacional, D27). A simplificação é de **UX**, não de schema: o modelo continua
> capaz (6 roles), mas o convite **apresenta só o que faz sentido** para quem está convidando. O
> médico-**dono** é `owner`; o médico-**parceiro** é `doctor` (clínico, sem gerir quadro). Quem pode
> convidar não é "quem é médico" — é **quem tem `manage:employees`**.

---

## Visão geral das fases

| # | Fase | Tipo | Esforço | Valor |
|---|---|---|---|---|
| 1 | **Convidar** (criar conta de funcionário) | **escrita** (cria auth user + profile) | **Médio** | **Alto** (destrava a clínica de 2+ pessoas) |
| 2 | **Acessos extras (overrides curados)** + gestão da pessoa (desativar/reenviar) | escrita | Baixo–Médio | **Alto** (dono libera caixa/faturamento pontual — backend já resolve, falta ação+UI) |
| 3 | **Trocar função** (`profiles.role` → re-login) | escrita | Médio–Alto | Baixo–Médio (mais raro na clínica pequena) |

Ordem sugerida: **1 → 2 → 3**. A Fase 1 é o núcleo. **A Fase 2 subiu de prioridade (2026-07-04):** o
"owner libera o médico pro caixa/faturamento" era combinado desde o início (VisãoGeral §4.1) e o backend
**já resolve** overrides — falta só a ação + UI. A Fase 3 (troca de papel) é a de maior risco (mexe em
claims → re-login) e menor urgência.

**O que já existe (é plugar, não construir):**

| Bloco | Onde | Uso aqui |
|---|---|---|
| Trava dura de usuários do plano | `billingApiV1.assertUserQuota(clinicId, activeUsers)` — [billing/api.ts:71](../../src/contexts/billing/api.ts#L71) | Chamar **antes** de criar. É a alavanca de monetização (ADR-024). |
| Primitivo de criação de usuário | `createOwnerUser` — [onboarding/internal/saga.ts:43](../../src/contexts/onboarding/internal/saga.ts#L43) | Padrão a espelhar (aqui via `inviteUserByEmail`, sem senha). |
| Permissão + bundles | `manage:employees` em `owner`/`gestor` — [permissions.ts:42](../../src/lib/auth/permissions.ts#L42) | Gate de quem convida. |
| Listagem da equipe | `listEmployees(clinicId)` | Já popula a tela; contagem de ativos para o `assertUserQuota`. |
| Enum de roles | `roleEnum` (`gestor/doctor/attendant/financial/owner/super_admin`) | Intacto. Nada de migração. |

**Decisão de mecanismo (2026-07-03):** convite via **`supabase.auth.admin.inviteUserByEmail`** —
o Supabase envia o link, o funcionário **define a própria senha**. Sem tabela de token nova, sem rota
pública nova; a senha nunca transita por você nem pelo dono da clínica.

---

## Quem convida quem

**MVP (decisão 2026-07-04): `gestor` fica DORMENTE.** Não é semeado como papel de convite nem oferecido
na UI. Como só `owner`/`gestor` têm `manage:employees`, na prática **só o `owner` (médico-dono) convida** —
ninguém mais tem a permissão. Isso colapsa a matriz e **elimina o risco de escalonamento no MVP**: o único
convidante é o dono, e este fluxo **nunca cria `owner`** (owner é único — decisão 2026-07-03).

| Convidante | Pode criar (MVP) |
|---|---|
| `owner` (médico-dono) | `doctor`, `attendant`, `financial` |
| qualquer outro papel | ninguém (sem `manage:employees`) |

- **Seletor de função no drawer:** **Médico / Atendente / Financeiro**. `gestor` **não** aparece.
- **Por que dormente, não removido:** `owner` e `gestor` têm bundles de permissão **IDÊNTICOS** (seed
  0003 linha 400: *"owner e gestor: tudo (idênticos no MVP)"*; 0013 confirma "owner 21, gestor 21"). A
  diferença é só **estrutural** — `owner` é único, é o responsável por billing (cartão/CPF na subscription)
  e é o único que loga com a clínica `suspended` para regularizar (ADR-016). Ou seja, **clínica pequena não
  precisa de `gestor`**: o owner já é o gerente completo. `gestor` = "modo clínica maior" (delegar admin a
  um não-dono). Fica no enum (append-only — **não** dá pra remover em Postgres; e é decisão congelada
  "nunca remoção"), dormente, até haver demanda real.
- **A guarda fica pronta no código, mesmo dormente:** `assertCanAssignRole(inviterRole, targetRole)`
  (função pura, testável) implementa a regra **completa** — inclusive "só `owner` cria `gestor`; ninguém
  cria `owner`". No MVP só o caminho do owner está ativo; custo zero de manter, e protege no dia que
  `gestor` acordar (é só passar a semear/oferecer o papel).

---

## Fase 1 — Convidar

### Fluxo

```
owner (médico-dono) em /equipe → [Convidar]
  drawer: função (Médico/Atendente/Financeiro) → nome + e-mail → CRM/UF se função = médico
        ↓  inviteMemberAction (Server Action)
  1. requireFreshPermission(MANAGE_EMPLOYEES)      ← ação crítica: lê do banco, não do JWT
  2. requireActiveClinic()                          ← clínica suspended/cancelled não convida (ADR-016)
  3. assertCanAssignRole(inviter.role, targetRole)  ← matriz + anti-escalonamento
  4. billingApiV1.assertUserQuota(clinicId, ativos) ← TRAVA DURA de plano (ADR-024)
  5. Zod: e-mail válido; CRM+UF obrigatórios se targetRole === 'doctor'
  6. idempotencyKey (D14) — dupla-submissão não cria dois
        ↓
  supabase.auth.admin.inviteUserByEmail(email, { data: { nome } })   ← externo à tx; retorna userId
        ↓
  insert profiles { id: userId, clinicId, nome, role, crm?, crmUf?, ativo: true }   (dbAdmin)
        ↓
  audit (outbox / ADR-011): internal.user.created { clinicId, userId, role, invitedBy }
        ↓
  Supabase (SMTP→Resend) envia o e-mail → convidado clica → define SENHA + confirma → 1º login
```

### Página de aceite — o que o convidado vê (decisões 2a/2b, 2026-07-04)

- **A função NÃO é escolhida pelo convidado.** Ela foi definida pelo owner no convite e é **imutável** no
  aceite — exibir só como leitura (*"Você foi convidado como **Atendente**"*). Deixar o convidado escolher
  o próprio papel **fura a matriz `assertCanAssignRole`** (auto-promoção a médico/financeiro). Papel é
  sempre server-side, no momento da criação do convite.
- **O convidado NÃO digita o e-mail.** O e-mail já é o do convite (o link chegou nele). A página pede
  apenas **senha + confirmar senha**. Redigitar e-mail é redundante e vira superfície de erro.
- Resultado do aceite = **função (read-only) + senha + confirmar**. Nada mais.

### Onde vive o código (respeitando bounded contexts)

- **Server Action `inviteMemberAction`** em `src/app/(app)/(shell)/equipe/actions.ts` — **orquestra**:
  guardas + chama Billing (API pública `billingApiV1`) + chama Identity. App-layer pode chamar a API
  pública de outro contexto; **não** faz JOIN cross-context (ADR-001).
- **`createClinicMember`** em `src/contexts/identity/internal/members.ts` (novo, server-only) —
  **dono** da escrita de `profiles` + da chamada `inviteUserByEmail`. Espelha `createOwnerUser`, mas
  sem senha. Identity é quem escreve em `profiles`; a Action nunca insere direto.
- **`assertCanAssignRole`** em `src/contexts/identity/internal/role-matrix.ts` (novo, função pura).
- Registrar `inviteMemberAction` em `CRITICAL_ACTIONS`
  ([src/lib/auth/policies/critical-actions.ts](../../src/lib/auth/policies/critical-actions.ts)) —
  criar credencial é ação sensível (D20/F-14); arch-test AST exige `requireFreshPermission` no topo.

### Compensação (orfão de auth user)

`inviteUserByEmail` é externo à transação (igual ao `createOwnerUser` na saga). Se o `insert profiles`
falhar **depois** do convite criado, o auth user fica órfão (existe no Auth, sem profile → não loga em
lugar nenhum, mas polui). Compensar: `admin.deleteUser(userId)` no `catch` (best-effort). Alternativa
mais barata que rodar saga: como o profile é a única escrita DB, envolver em uma micro-tx e deletar o
auth user se ela falhar. **Não** precisa de tabela de estado — não há passo intermediário persistido.

### Edge cases (a parte que subestimam)

- **E-mail já existe** (mesmo user em outra clínica — invariante *um user = um clinic_id*, ADR-008):
  `inviteUserByEmail` erra → mapear para mensagem clara *"Este e-mail já tem conta no ClinicaOS."* Não
  vazar de qual clínica.
- **CRM do médico — opcional no convite** (decisão 2026-07-03). O campo CRM+UF aparece no drawer quando
  função = médico, mas **não** é obrigatório para convidar (o dono pode não saber o CRM do parceiro). Vira
  obrigatório só **para emitir o 1º documento** (reusa `assertDoctorHasCrm`, já existente). No comercial/
  call, orienta-se o dono de que preencher o CRM na hora é a melhor prática.
- **2FA de gestor/financeiro** (§4.1): o convidado com esses papéis é forçado a enrolar MFA no 1º login
  pela `mfa-policy` existente — **sem trabalho novo aqui**, só confirmar que o gate cobre o novo usuário.
- **Limite do plano estourado:** `assertUserQuota` retorna `{ allowed:false, limit }` → UI mostra estado
  de upgrade (*"Seu plano permite N usuários. Faça upgrade para adicionar mais."*), **nunca** cria calado.
- **Convite pendente (usuário ainda não definiu senha):** aparece na lista como `ativo` porém sem login;
  a Fase 2 adiciona "reenviar" e um selo "convite pendente". Na Fase 1, no mínimo não quebrar a listagem.

### UI e arquitetura de informação do drawer

Virar a [Equipe](../../src/app/(app)/(shell)/equipe/page.tsx) de leitura → ação. Entrada: botão
**Convidar** no `TableToolbar` (mesmo lugar dos outros list pages). Um **Drawer** (não wizard multi-step —
é 1 pessoa, ≤ 4 campos), reusando o padrão do [new-appointment-drawer](../../src/app/(app)/(shell)/agenda/new-appointment-drawer.tsx).
Remover o `Alert` "chegam em seguida".

**Ordem das seções dentro do drawer (progressive disclosure — a função decide o resto):**

1. **Função primeiro** — `Segmented`: Médico / Atendente / Financeiro. É a decisão que reenquadra tudo e
   dispara os campos condicionais; pedir antes de nome/e-mail deixa o mental model claro ("quem é essa
   pessoa na equipe?") e mantém o form curto pra atendente/financeiro.
2. **Identidade** — `Field` + `Input` para **nome** e **e-mail**. O e-mail é o **canal**: rotular
   *"E-mail para o convite"* com helper *"Enviaremos um link para essa pessoa criar a senha."* — o dono
   entende o que vai acontecer.
3. **Credencial (condicional, só se Médico)** — `Field` + `Input` para **CRM + UF**. Helper:
   *"Opcional agora — necessário para emitir o primeiro documento."* Só aparece quando função = Médico
   (não polui o form dos outros papéis).

**Restrição de plano visível ANTES de preencher** (melhoria de fluxo, não só de submit): mostrar os
assentos perto do botão — *"Usuários: 3 de 5"* (dado de `assertUserQuota`/`getPlanLimits`). No limite, o
**Convidar** fica desabilitado com um `Alert` de upgrade inline — **não** deixar preencher tudo e recusar
no submit.

**Pós-envio:** `toast` de sucesso (*"Convite enviado para {nome}"*) + a pessoa entra na tabela com
`Badge` **"Convite pendente"** (distinto de Ativo/Inativo) até definir a senha. Ação "Reenviar" vem na Fase 2.

Componentes: tudo de `src/components/ui/*` (`Drawer`, `Segmented`, `Field`, `Input`, `Alert`, `Badge`,
`Button`, `toast`). **Nenhum componente novo** sem passar pelo DS. Ver §Design.

---

## Fase 2 — Acessos extras (overrides curados) + gestão da pessoa

**⚠️ Backend já resolve overrides — falta SÓ ação + UI.** A tabela `user_permission_overrides` existe e as
permissões efetivas = *bundle do papel* ∪ *grants* ∖ *denies* já são computadas na view
`effective_permissions_v` + injetadas pelo Hook (D26); a Equipe já **exibe** a contagem ("+N ajustes"). O que
**não existe** é o caminho de escrita — grep no código: **zero** action/insert de override. Gate:
`manage:permissions` (owner/gestor já têm no bundle).

### Acessos extras — o caso real: "dar caixa ao médico"

- **Curado, NÃO matriz crua.** Por pessoa, uma **lista curta de "acessos extras"** (grants que cruzam o
  papel), não as 24 permissions. Candidatos: **Operar caixa** (`operate:caixa`), **Ver faturamento**
  (`view:financial`), **Gerenciar financeiro** (`manage:financial`). Só oferecer o que faz sentido como
  extra pro papel da pessoa (não repetir o que o bundle já dá). Honra §1.5.2 (*opinativo > configurável — o
  que matou o v1*).
- **Grant-only no MVP.** "Dar acesso extra" cobre o caso; *remover* um default (deny) é raro/confuso — fica
  para depois. O modelo suporta os dois; a UI expõe só grant.
- **Ação `setMemberAccessAction`** (grant/revoke de UM override curado): `requireFreshPermission(MANAGE_PERMISSIONS)`
  (ação crítica), idempotência (D14), audit `internal.user.permissions_changed`. Escrita do override só via
  Identity (mesma regra da Fase 1), nunca pela Action direto.
- **Efeito:** mudar override dispara `claims_version` (D27 detecta override — ≠ `role_permissions` global) →
  o usuário pega a permissão nova no refresh/re-login (P2 — eventualmente consistente, TTL do JWT).
  Aceitável para GRANT (acesso a mais).
- **UI:** por pessoa (linha da Equipe → drawer "Acessos"), toggles curados com `Switch`/`Field` (DS v2).

### Gestão da pessoa (lifecycle — mesma infra de linha)

- **Desativar** = `profiles.ativo = false` via `mark_*` SECURITY DEFINER (D31 — não reabrir broad UPDATE) +
  `auth.admin.signOut` server-side (P2). Acesso cai no próximo request.
- **Reativar** = `ativo = true` (não recria auth user). **Reenviar/cancelar convite** = para quem ainda não
  definiu senha.

> **✅ Sub-fase 2a implementada (2026-07-10) — reenviar/cancelar convite pendente.** Reenviar:
> `generateLink({type:'recovery'})` gera um link novo (mesmo profile/id) que a UI **copia** para o owner entregar
> (WhatsApp/e-mail) — `invite` erra em user existente e magiclink é login; racional em
> [ADR-034](../adr/034-invite-resend-copy-link.md). Cancelar: hard delete do profile pendente (cascade
> `auth.users`) + `deleteUser` best-effort **logado** (débito #6). Ações na linha da Equipe (menu, só p/
> pendentes). `resendInviteAction`/`cancelInviteAction` são CRITICAL_ACTIONS. **Sem migração.** Falta da 2b:
> desativar/reativar (agenda futura ADR-032 §4) + overrides curados.
- Guardas: não mexer em papel ≥ ao seu; **nunca** desativar o **último** `owner` ativo da clínica.

## Fase 3 — Trocar função (e overrides avançados, se um dia)

- **Trocar `profiles.role`** dispara `claims_version` (D27) → re-login no próximo refresh. Auditar. Guardas
  da matriz (não promover a papel ≥ ao seu; ninguém vira `owner`). Mais raro na clínica pequena → menor urgência.
- **Overrides avançados** (deny, matriz completa das 24 permissions, temporary grants): só se um cliente
  pedir granularidade fina de verdade. **YAGNI até lá** — o recorte curado da Fase 2 cobre o caso comum.

---

## Design (DS v2 do sistema)

> **Autoridade de design = o DS já implementado no sistema, NÃO o `design_system/DSv2.html`.** Aquele
> arquivo é o export do "Claude Design" que serviu de **base** para a migração — é menos preciso que o
> resultado. Construir a partir do que existe:

- **Componentes:** `src/components/ui/*` (`Drawer`, `Segmented`, `Field`, `Input`, `Select`, `Alert`,
  `Badge`, `Button`, `toast`, `confirm-dialog`). Não criar componente novo — compor os existentes.
- **Tokens:** os custom-properties do DS v2 em [`_painel/ds.css`](../../src/app/(app)/(shell)/_painel/ds.css)
  (`--fs-*`, `--fg-*`, `--bg-*`, `bg-primary`/`text-on-primary` etc.), como já faz a
  [Equipe](../../src/app/(app)/(shell)/equipe/page.tsx). Sem cores/tamanhos hard-coded.
- **Padrão de referência:** o [new-appointment-drawer](../../src/app/(app)/(shell)/agenda/new-appointment-drawer.tsx)
  — mesmo esqueleto de Drawer (`DrawerContent/Header/Title/Body/Footer`) + `Field`/`Input`/`Segmented` +
  `toast`. O convite deve parecer nativo, não enxertado.

## O canal (e-mail de convite) e o primeiro acesso do convidado

O e-mail **é o canal** — e é o **primeiro toque** do funcionário com o sistema. Dois pontos de atenção:

- **Transporte já resolvido:** o **SMTP customizado do Supabase → Resend está configurado (prod + dev)**,
  então convite e reset **já saem pelo domínio próprio** (entregabilidade + remetente corretos). A única
  alavanca que resta é o **conteúdo/branding do template** (Auth → Email Templates): identidade petrol/clay,
  dizendo **quem convidou**, **qual clínica**, **qual função** e um CTA claro. Não é transporte, é copy.
- **Primeiro login do convidado:** ao definir a senha e entrar, **não** cair frio no dashboard. Uma tela/
  estado de boas-vindas curto: *"Bem-vindo à {Clínica} — você entrou como {Função}."* Para **Financeiro**,
  o gate de `mfa-policy` já força enrolar 2FA aqui (§4.1) — confirmar que cobre o novo usuário.
- **Estado "pendente" no canal:** enquanto o convidado não define a senha, a Equipe o mostra como
  *"Convite pendente"*; a Fase 2 adiciona **reenviar** (novo `inviteUserByEmail`) e **cancelar** convite.

---

## Lacunas do review (2026-07-04) — políticas operacionais

Endereça o review de gaps. Decisões de modelo vivem em **[ADR-032](../adr/032-mvp-identity-practitioner-model.md)**;
aqui ficam os reflexos de implementação.

- **Pré-requisito de sequência (gap 16):** o predicado `isPractitioner` (ADR-032 §2) e a migração dos
  checks `role === 'doctor'` **precedem** a Fase 1 se o médico-dono/parceiro tiver que ser reconhecido como
  clínico. Não gravar CRM em massa antes do predicado existir.
- **Centralização (gaps 3, 15):** onboarding (`saga.createOwnerUser` + insert owner) e convite
  (`createClinicMember`) **convergem para um único comando de domínio** em `identity` — a criação de
  profile+role+CRM+practitioner mora num lugar só; a UI (drawer/wizard) só coleta e chama. Evita a
  duplicação de conhecimento (CRM/UF/practitioner) entre os dois fluxos.
- **Médico incompleto (gap 5):** CRM opcional no convite **exige** estado visual. Na Equipe e no perfil do
  médico, badge **"Médico incompleto — falta CRM para emitir documentos"** (não deixar a 1ª receita travar
  como se fosse bug). Reusa `assertDoctorHasCrm`; o badge é derivado (`isPractitioner && crm == null`).
- **Duplicidade de CRM (gap 10):** hoje `profiles` **não** tem unique em `crm`. Decidido (ADR-032 §5):
  `UNIQUE(clinic_id, crm)` (migração aditiva) — ao coletar CRM (convite ou onboarding), validar e dar
  mensagem clara se colidir.
- **Ciclo de vida / desligamento (gap 4):** a **Fase 2 (desativar)** NÃO pode ser só `ativo=false` — precisa
  respeitar ADR-032 §4: bloquear a desativação enquanto houver **agenda futura / consulta aberta** do médico,
  exigindo reatribuição/cancelamento explícito. Histórico (documentos emitidos) sobrevive via snapshot.
- **Convite pendente (gap 12):** definir o ciclo — **expira** (o link do Supabase invite tem TTL próprio;
  fixar a política e exibir "expirado"); **reenviar** (novo `inviteUserByEmail`); **cancelar** (remover o
  auth user órfão + o profile pendente); trocar e-mail = cancelar + convidar de novo. Sem "pendente infinito".
- **Drift de permissões (gaps 14, 17):** sem hard cap; **visibilidade + nudge** (ADR-032 §6) — a Equipe já
  mostra "+N ajustes"; torná-lo proeminente e, acima de um limiar, sugerir revisar o papel.

### Matriz de auditoria (gap 13)

Todo evento sensível de identidade **audita** (outbox / ADR-011), não só `user.created`:

| Evento | Emite | Ator registrado |
|---|---|---|
| Convite criado | `internal.user.created` | `invitedBy` |
| Convite reenviado / cancelado | `internal.user.invite_resent` / `_cancelled` | quem operou |
| CRM alterado | `internal.user.credential_changed` (⚠️ jurídico) | quem alterou + valor antigo→novo |
| Função (role) alterada | `internal.user.role_changed` | quem alterou |
| Override concedido / removido | `internal.user.permission_granted` / `_revoked` | `grantedBy` (já na tabela) |
| Desativado / reativado | `internal.user.deactivated` / `_reactivated` | quem operou |

## Segurança (checklist)

- [ ] `requireFreshPermission(MANAGE_EMPLOYEES)` no topo da action (não `requireCachedPermission`) — D20/F-14.
- [ ] `assertCanAssignRole` server-side (não confiar no filtro da UI) + guarda anti-escalonamento.
- [ ] `requireActiveClinic()` antes de qualquer escrita (ADR-016).
- [ ] `assertUserQuota` **antes** de criar (ADR-024) — a monetização depende disto.
- [ ] `idempotencyKey` na action (D14) — dupla-submissão não cria dois usuários.
- [ ] Escrita de `profiles` só via Identity (`createClinicMember`), nunca pela Action direto (boundaries).
- [ ] Compensação do auth user órfão no `catch`.
- [ ] Auditoria da criação (outbox/ADR-011) com `invitedBy`.
- [ ] Erro de e-mail duplicado não vaza tenant.

## Testes

- **Unit** — `assertCanAssignRole`: matriz completa (owner/gestor/doctor × cada alvo) + escalonamento
  bloqueado (gestor→owner, gestor→gestor, doctor→qualquer).
- **Integração** — `assertUserQuota` bloqueia no limite do plano; `requireFreshPermission` barra quem só
  tem a permission no JWT cacheado mas perdeu no banco; e-mail duplicado; CRM exigido para médico.
- **Arch** — AST exige `requireFreshPermission` no topo da nova action (padrão F-14); `eslint-boundaries`
  confirma que a Action não importa schema de outro contexto.
- **RLS** — o novo `profiles` row é visível só dentro do tenant (regressão do isolamento).

---

## Adjacente (fora do escopo desta spec, mas relacionado)

- **`isPractitioner(profile)`** — predicado único (`role === 'doctor' || crm != null`) para o
  **owner médico-dono** ser reconhecido como clínico no scheduling/consultório (hoje há checks
  hard-coded `role='doctor'` em `scheduling/config-actions.ts`, `consultorio/actions.ts`,
  `dashboard/data.ts`). É a outra metade do "foco clínica pequena"; **planejar em spec própria**. Este
  convite já cria o médico-dono como `owner` **com CRM**, então deixa o terreno pronto para o predicado.

## Decisões (resolvidas — 2026-07-03)

1. **CRM opcional no convite**, obrigatório para emitir o 1º documento (§Edge cases). O comercial orienta
   o dono a preencher na hora como melhor prática.
2. **`owner` é único por clínica** — este fluxo **não** cria outro `owner`, nem `owner` promove alguém a
   `owner`. Segundo-dono / transferência de propriedade é operação de super_admin, fora deste escopo.
   Invariante reforçada na Fase 2: nunca desativar/rebaixar o último `owner`.
