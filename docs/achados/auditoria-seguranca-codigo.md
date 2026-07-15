# Auditoria de Segurança de Código — ClinicaOS_V2 (Qoro)

> **Escopo desta auditoria:** segurança *em si* — resistência a **ataques**, **falhas de
> lógica**, **brechas de autorização**, **exposição de dados** e **erros em cascata / riscos de
> escala**. Complementa (não substitui) as duas auditorias irmãs de 2026-07-12:
> [`auditoria-apis-seguranca.md`](./auditoria-apis-seguranca.md) (APIs/autorização) e
> [`auditoria-banco-dados.md`](./auditoria-banco-dados.md) (banco/schema). Onde um achado
> coincide, ele é **repetido de propósito com a lente de ataque**, citando o relatório onde
> também está documentado.
>
> **Data:** 2026-07-12 · **Branch:** `docs/identity-practitioner-model` · **Metodologia:**
> DOCUMENTAÇÃO → IMPLEMENTAÇÃO → RISCO. Revisão manual especializada + ferramentas obrigatórias
> (`pnpm audit`, Semgrep, CodeQL, security-review). Nenhum arquivo de código foi modificado.

---

## 1. Resumo Executivo

### Nível geral de segurança: **BOM / MADURO** (acima da média para um MVP)

O ClinicaOS_V2 é um SaaS multi-tenant clínico (dados LGPD Art. 11) construído com **disciplina de
segurança acima da média**: RLS `FORCE` em toda tabela tenant, criptografia AES-256-GCM
per-tenant (chave via HKDF(masterKey, clinic_id)), outbox transacional + idempotência, HMAC
constant-time no webhook do Meta, whitelist de tools + Zod duplo no agente de IA, uma **porta
única de autorização** (`tenant-context.ts`) enforçada por ESLint, e um allowlist AST fail-closed
para origens de conexão de banco. As ferramentas confirmaram a maturidade: **Semgrep = 0
verdadeiros-positivos**, **CodeQL = 1 achado real de baixo impacto**, **security-review do diff da
branch = limpo**, e a superfície de dependências de produção é mínima.

**Os riscos encontrados são estruturais/latentes e de refino — não há buraco aberto explorável
hoje.** Nenhuma das três auditorias (esta + as duas irmãs) demonstrou vazamento cross-tenant
ativo, SQL injection, RCE ou bypass de autenticação em produção.

### Principais riscos (a lente de ataque)

| # | Risco | Severidade | Categoria | Cruza com |
|---|-------|-----------|-----------|-----------|
| **V1** | **Isolamento multi-tenant não é fail-closed** — o pool `db` roda com role **BYPASSRLS** (**confirmado ao vivo:** `postgres`/`service_role` têm `rolbypassrls=true`, `authenticated`=false); quem faz a RLS valer é o `SET LOCAL ROLE authenticated` do `withTenant`. Docstrings de `tenant.ts`/`rls.ts` afirmam o **contrário** do `connection-origin-guard.ts` (contradição **empiricamente falsa**). Esquecer `withTenant` **vaza**, não falha fechado. | **ALTA** | Arquitetura | apis A3 · banco A3 |
| **V2** | **Conteúdo clínico em texto claro** — prontuário/prescrição/documentos/`patient_clinical_data` não são cifrados (a PII cadastral é). Vazamento de backup expõe o prontuário inteiro. | **ALTA** | Dados | banco A1 |
| **V3** | **Webhook Asaas confia só em token estático** (sem HMAC de corpo) — quem tiver/adivinhar o token forja evento financeiro (reabrir clínica bloqueada, estorno). | **ALTA** | Segurança | apis A2 |
| **V4** | **Cookie `_healed` forjável** pula o middleware inteiro (auth-presence + drift-heal). Contido só porque cada página/action re-checa. | MÉDIA | Segurança/Auth | — (novo) |
| **V5** | **Cascata/resiliência** — rate-limit fail-open per-instância, breaker/quota de IA soft-cap per-instância, um único `CRON_SECRET` para rotas read-only e destrutivas, replay de access-token ≤15 min pós-logout. | MÉDIA | Segurança/Perf | apis M2/B7 |
| **V6** | **CSP em Report-Only** com `unsafe-inline`/`unsafe-eval` — XSS é reportado, não bloqueado. | MÉDIA | Config | apis (dívida C16) |
| **V7** | `requireFreshPermission` **não revalida `clinic_id`** — janela de drift em reatribuição de clínica, mesmo em ação crítica. | MÉDIA | Auth | — (novo) |
| **V8** | `payment_proofs.file_storage_path` **aceito do cliente** sem validação de prefixo `${clinicId}/` (latente — sem endpoint que assine hoje). | MÉDIA | Dados | — (novo) |
| **V9** | Layout `(shell)` **sem backstop de auth** — não redireciona não-autenticado; depende 100% de cada página chamar `require*`. | MÉDIA | Auth | — (novo) |
| **V10** | `reset-password` **sem rate-limit** + retorna `error.message` cru. | BAIXA | Auth | apis M3 |
| **V11** | `/api/health/auth-hook` **não-auth** devolve `e.message` cru (info-leak). | BAIXA | Segurança | apis A1 (rebaixado) |
| **V12** | Comparações **não-constant-time** de `CRON_SECRET`/verify-token Meta. | BAIXA | Segurança | apis M1 |
| **V13** | **postMessage sem checagem de origem estrita** no connect do WhatsApp (`endsWith('facebook.com')` burlável). | BAIXA | Segurança/Frontend | — (novo, CodeQL) |
| **V14** | **Dependências** — `drizzle-orm` HIGH (SQLi via identifiers, **não alcançável**) + dev-tooling com CVEs (handlebars/vitest/vite, **não sobem p/ produção**). | INFORMATIVO | Manutenção | — (novo, pnpm audit) |
| **V15** | **Funções `SECURITY DEFINER` executáveis por `anon`/`authenticated`** via RPC (ex. `record_login_attempt` → forja de auditoria pré-auth) + `search_path` mutável em 2 funções. | BAIXA | Segurança | banco A15/A16 (scan vivo) |

### Pontos positivos (o que está sólido — não mexer)

- **Criptografia AEAD correta**: `decryptForTenant` chama `setAuthTag` com a tag completa de 16 B
  ([encryption.ts:94](../../src/lib/crypto/encryption.ts#L94)); isolamento cross-tenant por
  construção (a tag GCM falha sob a chave de outra clínica). O único achado do Semgrep aqui foi
  **falso-positivo** (ver §3, triagem).
- **Fluxo de convite (branch) blindado**: matriz anti-escalonamento (`assertCanAssignRole`),
  `requireFreshPermission` (crítica), `clinic_id` explícito nos paths `dbAdmin`, idempotência,
  compensação de órfão logada, auditoria na mesma transação. **security-review = 0 achados.**
- **Webhook Meta**: HMAC-SHA256 constant-time *antes* de parsear + cap de corpo por streaming.
- **Agente de IA**: whitelist de tools + Zod nos dois sentidos + identidade por telefone
  verificado + checagem de ownership por-registro; string-injection filter é só telemetria.
- **PDFs**: `@react-pdf` (component-based, **sem HTML→PDF**) → sem XSS→PDF; buckets privados com
  path tenant-prefixado + signed URL curto.
- **Anti-enumeração** em login/forgot; impersonation break-glass bem-controlado (HMAC, AAL2, TTL
  1 h, log append-only).
- **Sem `eval`/`new Function`/`child_process`**; `sql.raw` só com constantes; **1 único**
  `dangerouslySetInnerHTML` (script estático de tema, sem dado do usuário); **segredos não
  commitados** (só `.env.example` é versionado).

---

## 2. Área analisada

| Arquivo / Superfície | Área | Resultado |
|----------------------|------|-----------|
| `src/lib/db/{index,tenant,rls,connection-origin-guard}.ts` | Isolamento multi-tenant | 🔴 **V1** (não fail-closed + docs contraditórias) |
| `src/contexts/{patient,financial,clinical}/actions.ts` | Mutações tenant (WHERE por PK) | 🟠 **V1** corolário (sem filtro `clinic_id`) |
| `src/lib/crypto/encryption.ts` | Cripto per-tenant | ✅ AEAD íntegro (Semgrep FP) |
| `src/contexts/{clinical,patient}` (conteúdo clínico) | Dados sensíveis LGPD | 🔴 **V2** (texto claro) |
| `src/app/api/webhooks/asaas/route.ts` | Webhook financeiro | 🔴 **V3** (token estático, sem HMAC) |
| `src/app/api/webhooks/meta/route.ts` | Webhook WhatsApp | ✅ HMAC-before-parse |
| `src/middleware.ts` | Auth/heal layer | 🟠 **V4** (`_healed` forjável) · 🟡 **V12** |
| `src/lib/auth/tenant-context.ts` | Porta única de authz | 🟠 **V7** (`clinic_id` não revalidado) |
| `src/lib/auth/rate-limit.ts` + crons | Resiliência/cascata | 🟠 **V5** (fail-open, blast radius) |
| `next.config.ts` | Headers/CSP | 🟠 **V6** (CSP Report-Only) |
| `src/contexts/financial/{actions,types}.ts` | Prova de pagamento | 🟠 **V8** (path do cliente) |
| `src/app/(app)/(shell)/layout.tsx` | Backstop de layout | 🟠 **V9** (sem guarda) |
| `src/app/(app)/reset-password/actions.ts` | Auth flow | 🟡 **V10** (sem rate-limit) |
| `src/app/api/health/auth-hook/route.ts` | Health não-auth | 🟡 **V11** (erro cru) |
| `.../whatsapp/whatsapp-connect.tsx` | Frontend / postMessage | 🟡 **V13** (origem fraca — CodeQL) |
| `src/app/(app)/(shell)/equipe/*`, `contexts/identity/internal/members.ts` | Convite/RBAC (branch) | ✅ **CLEAN** (security-review) |
| `src/contexts/ai-agent/*`, `src/lib/ai/*` | Agente IA / prompt-injection | ✅ defesa em camadas |
| `src/lib/pdf/*`, `src/lib/storage/*` | PDF/arquivos | ✅ sem XSS→PDF, sem IDOR |
| `src/app/**` (React/TSX) | XSS/frontend | ✅ 1 sink estático; React auto-escape |
| `package.json` / lockfile | Dependências | 🟡 **V14** (prod mínimo; dev-tooling) |
| **Semgrep** (573 arq., 691 regras) | SAST | ✅ 0 TP (1 FP triado) |
| **CodeQL** (security-extended, taint) | SAST cross-file | 🟡 **V13** (1 real, baixo impacto) |

Legenda: 🔴 ALTA · 🟠 MÉDIA · 🟡 BAIXA · ✅ sem problema explorável.

---

## 3. Vulnerabilidades Encontradas

### V1 — Isolamento multi-tenant não é fail-closed (+ documentação contraditória)

- **Severidade:** ALTA · **Categoria:** Arquitetura / Segurança
- **Arquivo:** `src/lib/db/index.ts`, `src/lib/db/tenant.ts`, `src/lib/db/rls.ts`,
  `src/lib/db/connection-origin-guard.ts`
- **Local:** [index.ts:86,92-94](../../src/lib/db/index.ts#L86) · [tenant.ts:16-19,44-48](../../src/lib/db/tenant.ts#L16) · [connection-origin-guard.ts:5-9](../../src/lib/db/connection-origin-guard.ts#L5)
- **Descrição:** O pool `db` (user-facing) e o `dbAdmin` conectam pela **mesma** `DATABASE_URL`,
  cujo role (pooler `postgres.<ref>`) tem **BYPASSRLS** — o próprio comentário admite *"Mesma URL
  (service_role bypassa RLS)"* (index.ts:92). Como `FORCE ROW LEVEL SECURITY` **não** se aplica a
  um role BYPASSRLS, a única coisa que faz a RLS valer no pool `db` é o `SET LOCAL ROLE
  authenticated` dentro de `withTenant()` (tenant.ts:45). Porém, as docstrings de `tenant.ts:16-19`
  e `rls.ts` afirmam o **oposto**: *"FORCE … is the PRINCIPAL defense … SET ROLE here is hardening.
  If a future Supabase change revokes the pool role's privilege to switch to authenticated,
  isolation continues to work via FORCE + dual-context."* Isso **contradiz diretamente** o
  `connection-origin-guard.ts:5-9` (e o `scripts/arch-db-check.ts`), que dizem o correto: *"the
  runtime `db` pool connects with a BYPASSRLS role, so `withTenant` … is the principal isolation
  defense — FORCE RLS does NOT stop a BYPASSRLS role."*
- **Impacto:** Um mantenedor que confie na docstring de `tenant.ts` pode acreditar que esquecer
  `withTenant` (ou emitir um `db.query()` cru) falha **fechado** — quando na verdade **vaza
  cross-tenant** (lê/escreve dados de qualquer clínica). A barreira real hoje é **um lint de CI**
  (`arch-db-check.ts` + `connection-origin-guard.ts`), não o banco recusando por padrão.
- **Cenário de exploração:** Não é diretamente explorável por um atacante externo hoje; é uma
  **bomba-relógio de manutenção**. Se um PR futuro (a) adicionar um novo path tenant que esqueça
  `withTenant`, (b) o CI for pulado/afrouxado, ou (c) o allowlist crescer sem cuidado → qualquer
  request daquele path retorna linhas de **todas as clínicas**. Agravante: as mutações escopam a
  linha **só por PK, sem `clinic_id` no WHERE** — ex. `updatePatient`
  ([patient/actions.ts:226](../../src/contexts/patient/actions.ts#L226)), `confirmPayment`
  ([financial/actions.ts:161](../../src/contexts/financial/actions.ts#L161)), `signProntuario`
  ([clinical/actions.ts:221](../../src/contexts/clinical/actions.ts#L221)) — então não há
  defesa-em-profundidade: uma tabela futura sem `FORCE RLS` ou um path sem `withTenant` vira IDOR
  cross-tenant imediato.
- **Risco:** Vazamento total cross-tenant de prontuários/PII/financeiro (LGPD Art. 11) — o pior
  cenário do produto — a um único deslize de código, não a um ataque.
- **Correção recomendada:**
  1. **Curto prazo (barato):** corrigir as docstrings de `tenant.ts`/`rls.ts` para casar com
     `connection-origin-guard.ts` (a fonte da verdade). A contradição, por si só, é o maior risco.
  2. **Curto prazo:** adicionar um predicado defensivo `eq(table.clinicId, clinicId)` nas
     mutações/leituras que hoje escopam só por PK (belt-and-suspenders — torna a garantia local,
     não global).
  3. **Médio prazo (fix estrutural, já previsto p/ C16):** dar ao pool `db` um role dedicado
     **sem BYPASSRLS** (authenticator não-privilegiado) → aí sim fail-closed por construção.
- **✅ Confirmação empírica (qoro-dev, live query em 2026-07-12):**

  | role | `rolbypassrls` | papel |
  |------|:--------------:|-------|
  | `postgres` (pooler conecta como este) | **true** | pool `db` |
  | `service_role` | **true** | pool `dbAdmin` |
  | `supabase_admin` | true (super) | — |
  | `authenticated` | **false** | alvo do `SET LOCAL ROLE` do `withTenant` |
  | `anon` | false | — |
  | `authenticator` | false | — |

  Ou seja: o pool `db` **de fato bypassa RLS**, e `authenticated` **não** — provando que
  `withTenant` (SET LOCAL ROLE) é a defesa real e que a docstring de `tenant.ts` ("se o SET ROLE
  for revogado, o isolamento continua via FORCE") é **empiricamente falsa** (sem o SET ROLE, a
  conexão roda como `postgres`/BYPASSRLS e lê/escreve **todas** as clínicas).
- **Prioridade:** Alta (docstring: imediata; predicado defensivo: curto; role dedicado: médio).
- **Cruza com:** `auditoria-apis-seguranca.md` A3, `auditoria-banco-dados.md` A3.

---

### V2 — Conteúdo clínico persistido em texto claro (inversão de proteção)

- **Severidade:** ALTA · **Categoria:** Dados (LGPD Art. 11 — dado sensível de saúde)
- **Arquivo/Local:** ver [`auditoria-banco-dados.md`](./auditoria-banco-dados.md) A1 (linhas 243-283) —
  `prontuarios.content`, `prescriptions.medicamentos`, `medical_documents`, `patient_clinical_data`
  (jsonb/text, sem cifra).
- **Descrição:** A PII cadastral (CPF, telefone, endereço) é cifrada per-tenant (AES-256-GCM), mas
  o **conteúdo clínico** — a categoria mais sensível — é armazenado **em claro**. Inversão da
  prioridade de proteção.
- **Impacto / Cenário:** Um vazamento de backup, um dump acidental, ou o cenário de bypass de RLS
  do **V1** expõe o **prontuário médico inteiro** em texto legível. Sob LGPD, dado de saúde é
  categoria especial (Art. 11) — o incidente vira notificação ANPD + titulares em 72 h.
- **Risco:** Exposição máxima de dado sensível; risco regulatório e reputacional.
- **Correção recomendada:** estender o mesmo envelope `encryptForTenant`/`decryptForTenant` (já
  existente e correto) aos campos clínicos, com ponto único de decifra nas queries de leitura;
  índices de busca continuam via `hashForLookup`. Migração de re-cifra em lote versionada (o byte
  de versão já suporta rotação).
- **Prioridade:** Alta (curto/médio prazo — exige migração de dados).
- **Cruza com:** `auditoria-banco-dados.md` A1.

---

### V3 — Webhook Asaas confia em token estático, sem HMAC do corpo

- **Severidade:** ALTA · **Categoria:** Segurança / Integridade de dados
- **Arquivo/Local:** `src/app/api/webhooks/asaas/route.ts`; verificação do token em
  `src/contexts/billing/.../asaas.ts` (compare constant-time). Ver `auditoria-apis-seguranca.md` A2.
- **Descrição:** Diferente do webhook do Meta (HMAC-SHA256 do corpo), o webhook do Asaas autentica
  apenas por um **token estático compartilhado** (`asaas-access-token`). Não há assinatura do
  corpo, então o **conteúdo** do evento não é criptograficamente atrelado ao remetente.
- **Impacto / Cenário de exploração:** Quem obtiver/adivinhar/vazar o token (log, proxy, header
  em trânsito mal protegido) pode **forjar eventos financeiros**: `markInvoicePaid` reabre uma
  clínica bloqueada por dunning, dispara estorno, ou marca vencido. O `eventId` de dedup é
  sintetizável pelo atacante.
- **Risco:** Manipulação de estado financeiro/acesso de tenant (fraude de assinatura).
- **Mitigações existentes (reduzem, não eliminam):** compare **constant-time** do token, transições
  de estado **monotônicas** (`canTransition`), e **reconciliação diária** como fonte de verdade
  (o webhook é sinal rápido não-autoritativo). Isso limita o dano a uma janela até a reconciliação.
- **Correção recomendada:** o Asaas não oferece HMAC nativo — então (a) tratar o token como
  secret de alto valor com rotação (runbook já existe), (b) restringir por IP de origem do Asaas
  se disponível, (c) manter a reconciliação diária como autoridade (já é o caso) e alarmar em
  divergência webhook↔reconciliação.
- **Prioridade:** Alta (aceite de risco documentado; endurecer rotação + alarme de divergência).
- **Cruza com:** `auditoria-apis-seguranca.md` A2.

---

### V4 — Cookie `_healed` forjável pelo cliente pula o middleware inteiro

- **Severidade:** MÉDIA · **Categoria:** Segurança / Autenticação
- **Arquivo/Local:** [src/middleware.ts:56-58](../../src/middleware.ts#L56)
- **Descrição:** `if (req.cookies.get(HEALED_COOKIE)) return res;` — o middleware dá early-return
  (sem nenhuma checagem de auth nem de drift) sempre que o cookie `_healed` está presente. O cookie
  é setado pelo servidor como `httpOnly/secure/strict`, mas **httpOnly não impede um cliente de
  enviar** `Cookie: _healed=1` numa request forjada (curl/Postman).
- **Impacto / Cenário:** Um atacante que faça requests diretas pode **anular o middleware por
  completo** — inclusive o heal de drift (que faz signOut global quando `claims_version` muda ou o
  profile é desativado). Combinado com **V9** (layout sem backstop), qualquer página `(shell)` que
  dependesse só da identidade do layout ficaria exposta.
- **Risco:** Bypass da camada de heal/drift; janela estendida para sessão desatualizada/desativada.
  Contido hoje porque toda página/action re-chama `requireUser`/`requireClinicId` (fail-closed no
  acesso a dado).
- **Correção recomendada:** não confiar num cookie de cliente para pular o middleware — atrelar o
  anti-loop a um sinal server-authoritative (ex. assinar o `_healed` com HMAC, ou usar um curto
  TTL server-side por sessão), ou ao menos revalidar auth-presence mesmo com `_healed`.
- **Prioridade:** Média.

---

### V5 — Erros em cascata / resiliência (fail-open + blast radius + replay)

- **Severidade:** MÉDIA (agregado) · **Categoria:** Segurança / Performance / Resiliência
- **Locais:**
  - **Rate-limit fail-open per-instância:** [rate-limit.ts:105-121](../../src/lib/auth/rate-limit.ts#L105) —
    numa queda do Upstash, cai para limiter em memória **por instância serverless** → limite
    efetivo ≈ N×config (N = nº de lambdas). `getClientIp` confia em `x-forwarded-for[0]` — seguro
    só atrás da Vercel; spoofável se a app for alcançável diretamente.
  - **Breaker/quota de IA soft-cap per-instância:** o circuit-breaker e a quota de custo do agente
    são estado **em memória por instância** (não distribuídos) → sob fan-out, o teto real é N×.
  - **Blast radius do `CRON_SECRET`:** um único segredo protege rotas read-only **e** destrutivas
    (`patient-hard-delete`, `data-retention`, `billing-dunning`). Vazou um → cai tudo.
  - **Replay de access-token:** logout revoga o refresh token, mas o access-token JWT continua
    válido até expirar (≤15 min) — janela de replay pós-logout/revogação (ADR-009 D12).
  - **Drift de `role_permissions` global:** mudanças no bundle de permissões de um role **não**
    disparam o heal automático (só role/clinic/ativo do usuário) — exige logout operacional manual.
- **Impacto / Cenário:** Sob incidente (Upstash fora, pico de tráfego, segredo vazado), as
  proteções **degradam em cascata**: brute-force de login mais viável, custo de IA estoura o teto,
  ou uma rota destrutiva fica exposta. O replay de 15 min permite continuar operando com um token
  cujo dono já foi desativado.
- **Risco:** Degradação de controles de segurança sob estresse; abuso de custo; janela de sessão
  fantasma.
- **Correção recomendada (médio prazo, já mapeado p/ C16):** breaker/quota de IA em Redis
  (distribuído); segredos de cron **separados** por classe de rota (read-only vs destrutiva);
  reduzir TTL do access-token ou adotar um *auth-epoch* global para revogação imediata; documentar
  o fail-open como decisão consciente com alarme (`auth.ratelimit.degraded` já é emitido).
- **Prioridade:** Média.
- **Cruza com:** `auditoria-apis-seguranca.md` M2/B7.

---

### V6 — Content-Security-Policy em modo Report-Only com `unsafe-inline`/`unsafe-eval`

- **Severidade:** MÉDIA · **Categoria:** Segurança / Misconfiguration
- **Arquivo/Local:** [next.config.ts:44-84](../../next.config.ts#L44) — header
  `Content-Security-Policy-Report-Only` com `script-src 'self' 'unsafe-inline' 'unsafe-eval'`.
- **Descrição:** A CSP **não bloqueia** — só reporta violações. `unsafe-inline`/`unsafe-eval`
  desarmam a principal mitigação de XSS. É decisão consciente (evitar quebrar hydration/Sentry
  antes de observar), mas continua sendo uma proteção **não ativa**.
- **Impacto / Cenário:** Se um XSS for introduzido no futuro (ex. um novo `dangerouslySetInnerHTML`
  com dado do usuário — hoje só há **1** sink, estático), a CSP não o conteria. HSTS,
  X-Frame-Options: DENY, nosniff, Referrer-Policy e Permissions-Policy **estão** ativos e corretos.
- **Risco:** Defesa-em-profundidade de XSS ausente; superfície de sink hoje é mínima (baixa
  probabilidade), mas o custo de um XSS num app clínico é alto.
- **Correção recomendada:** promover a CSP a **bloqueante** com `nonce` por request (via
  middleware) para eliminar `unsafe-inline`; manter `frame-ancestors 'none'`/`object-src 'none'`.
- **Prioridade:** Média (dívida C16 já reconhecida).
- **Cruza com:** `auditoria-apis-seguranca.md` (dívida C16).

---

### V7 — `requireFreshPermission` não revalida `clinic_id` (drift de reatribuição)

- **Severidade:** MÉDIA · **Categoria:** Autenticação / Autorização
- **Arquivo/Local:** [tenant-context.ts:224-306](../../src/lib/auth/tenant-context.ts#L224)
- **Descrição:** `requireFreshPermission` re-lê do banco `role`, `ativo` e overrides (autoridade
  fresca para ações críticas), mas o `clinic_id` efetivo continua vindo do **JWT** via
  `requireClinicId()` — não é re-lido. "Fresh" implica revalidação total, mas o vínculo de clínica
  fica preso ao snapshot do token.
- **Impacto / Cenário:** Se um usuário for movido da clínica A para a B, ele pode continuar
  operando como **A** durante a janela de drift (~60-75 s de throttle + até 15 min de TTL do
  token), inclusive em ações críticas (deletar paciente, assinar prontuário), até o
  `claims_version` bump forçar logout. Operação rara, janela limitada.
- **Risco:** Ação crítica executada no contexto de tenant errado por uma janela curta.
- **Correção recomendada:** incluir `clinic_id` (e `ativo`) na re-leitura de `requireFreshPermission`
  e comparar com o JWT; divergência → forçar re-auth.
- **Prioridade:** Média.

---

### V8 — Caminho de prova de pagamento aceito do cliente sem validação de tenant (latente)

- **Severidade:** MÉDIA (latente) · **Categoria:** Dados / Segurança
- **Arquivo/Local:** [financial/types.ts:104-116](../../src/contexts/financial/types.ts#L104) ·
  [financial/actions.ts:188-196](../../src/contexts/financial/actions.ts#L188)
- **Descrição:** `ConfirmPaymentSchema.comprovante.fileStoragePath` é validado só como
  `z.string().min(1).max(512)` e persistido **verbatim** em `payment_proofs.file_storage_path`.
  Não há enforcement de que o path esteja sob o prefixo `${clinicId}/` do chamador.
- **Impacto / Cenário:** **Hoje não é explorável** — não há endpoint que assine/sirva esse path
  armazenado. Mas as signed URLs são geradas pelo client service-role (que **ignora** limites de
  bucket/RLS). Se um recurso futuro assinar o path da prova diretamente, um operador da clínica A
  poderia persistir `clinicB-uuid/prescriptions/…​.pdf` e depois **baixar o arquivo da clínica B**
  (leak cross-tenant).
- **Risco:** IDOR cross-tenant de arquivos — condicionado a um recurso futuro de download.
- **Correção recomendada:** validar o prefixo do path contra o `clinicId` do request, **ou** (melhor)
  derivar o path server-side em vez de confiar no cliente. Corrigir **antes** de shipar qualquer
  feature de download de comprovante.
- **Prioridade:** Média (corrigir antes do recurso de serving).

---

### V9 — Layout `(shell)` não provê backstop de autenticação

- **Severidade:** MÉDIA (defense-in-depth) · **Categoria:** Autenticação
- **Arquivo/Local:** [src/app/(app)/(shell)/layout.tsx:26-52](../../src/app/(app)/(shell)/layout.tsx#L26)
- **Descrição:** `ShellLayout` busca `getCurrentUser()` mas só redireciona `super_admin` sem
  impersonation para `/admin` — **não** redireciona usuário nulo/não-autenticado. Depende
  inteiramente do middleware + `requireUser` por página (comentário na linha 21 confirma que é
  intencional).
- **Impacto / Cenário:** É seguro **enquanto** toda página `(shell)` chamar `require*` (as que
  tracei chamam). Mas não há rede de segurança de camada: combinado com **V4** (`_healed` fura o
  middleware), uma página futura que leia só a identidade do layout ficaria exposta.
- **Risco:** Ausência de defesa-em-profundidade; exposição condicionada a uma página futura
  descuidada.
- **Correção recomendada:** adicionar `if (!user) redirect('/login')` no layout como backstop, e/ou
  um arch-test que exija `require*` em toda página sob `(shell)`.
- **Prioridade:** Média.

---

### V10 — `reset-password` sem rate-limit e com erro cru

- **Severidade:** BAIXA · **Categoria:** Autenticação
- **Arquivo/Local:** [reset-password/actions.ts:12-26](../../src/app/(app)/reset-password/actions.ts#L12)
- **Descrição:** `resetPasswordAction` valida a senha (min 8) e chama
  `supabase.auth.updateUser({ password })` **sem rate-limit** e sem validação explícita da recovery
  session (confia no cookie de recovery). Retorna `error.message` cru (linha 23). Contrasta com
  login/forgot, que são rate-limited (a infra `lazyResetLimiters` até existe em `rate-limit.ts`,
  mas não é chamada aqui).
- **Impacto / Cenário:** Requer uma recovery session válida (obtida pelo link emailado), então o
  risco é baixo; mas é a única ação de auth sem throttle, e o erro cru pode vazar detalhe interno.
- **Risco:** Baixo — endurecimento.
- **Correção recomendada:** aplicar `lazyResetLimiters` (já existe) na action; retornar mensagem
  genérica e logar o detalhe.
- **Prioridade:** Baixa.
- **Cruza com:** `auditoria-apis-seguranca.md` M3.

---

### V11 — `/api/health/auth-hook` não autenticado devolve `e.message` cru

- **Severidade:** BAIXA · **Categoria:** Segurança (info-leak)
- **Arquivo/Local:** [auth-hook/route.ts:38-45](../../src/app/api/health/auth-hook/route.ts#L38)
- **Descrição:** Endpoint **intencionalmente não autenticado** (para monitoramento externo) que usa
  `dbAdmin` (BYPASSRLS) para rodar `auth_hook_selftest()`. **Adjudicação desta auditoria:** o RPC
  não recebe input do usuário e retorna só `{ok, error?, sqlstate?}` — **sem dado tenant/paciente**.
  O único problema real é o `e.message` **cru** no corpo do 500 (linha 42), que pode vazar detalhe
  interno (schema/role em mensagens de erro do Postgres).
- **Impacto:** Info-leak leve num endpoint anônimo. **Não** há exposição de dado sensível nem
  bypass de RLS (o RPC é fixo).
- **Nota de discordância (justificada):** a `auditoria-apis-seguranca.md` classifica isto como
  **A1/ALTA**. Esta auditoria **rebaixa para BAIXA**: não há exposição de dado tenant, o RPC não
  recebe input, e o vetor de DoS é o esperado de um health endpoint. A correção (mensagem genérica)
  é barata e recomendada, mas o risco concreto é baixo.
- **Correção recomendada:** retornar corpo genérico no 500; logar o detalhe no observability.
- **Prioridade:** Baixa.
- **Cruza com:** `auditoria-apis-seguranca.md` A1 (rebaixado aqui com justificativa).

---

### V12 — Comparações não-constant-time de `CRON_SECRET` / verify-token do Meta

- **Severidade:** BAIXA · **Categoria:** Segurança
- **Arquivo/Local:** handlers de cron/health (`!==` de `CRON_SECRET`, ex.
  [cron/outbox/route.ts:37](../../src/app/api/cron/outbox/route.ts#L37)) e
  [webhooks/meta/route.ts:88](../../src/app/api/webhooks/meta/route.ts#L88) (GET verify-token, `===`).
- **Descrição:** ~15 handlers comparam segredos com `===`/`!==` (string), não com
  `timingSafeEqual` — inconsistente com o resto do codebase (webhook Asaas/Meta POST usam
  constant-time).
- **Impacto / Cenário:** Timing side-channel teórico; **impraticável** sobre jitter de rede com um
  segredo de alta entropia. Baixa exploitabilidade real.
- **Correção recomendada:** padronizar `timingSafeEqual` (já usado no codebase) nesses handlers.
- **Prioridade:** Baixa.
- **Cruza com:** `auditoria-apis-seguranca.md` M1.

---

### V13 — postMessage sem checagem de origem estrita no connect do WhatsApp (CodeQL)

- **Severidade:** BAIXA · **Categoria:** Segurança / Frontend (CWE-346/CWE-20)
- **Arquivo/Local:** [whatsapp-connect.tsx:60-61](../../src/app/(app)/(shell)/configuracoes/whatsapp/whatsapp-connect.tsx#L60)
- **Descrição:** O handler do Embedded Signup do Meta filtra a origem com
  `event.origin.endsWith('facebook.com')`. Essa checagem é **burlável**: uma origem como
  `https://evil-facebook.com` ou `https://xfacebook.com` (domínios que um atacante pode registrar)
  satisfaz `endsWith('facebook.com')` — falta a fronteira de subdomínio (`.facebook.com` ou match
  exato). Detectado pelo CodeQL: `js/missing-origin-check` (linha 60) + `js/incomplete-url-substring-sanitization`
  (linha 61, sec-severity 7.8).
- **Impacto / Cenário:** **Baixo na prática.** O handler só captura `waba_id`/`phone_number_id`
  como **hints**, que o **servidor revalida contra o token OAuth** (anti-sequestro —
  `meta-onboarding.ts` exige que os hints sejam alcançáveis pelo token; comentário linhas 57-58
  confirma *"o servidor revalida … isto é só sugestão"*). Além disso, o ataque exige uma referência
  cross-window para postMessage na janela da vítima. Então o dano máximo é influenciar um hint
  descartável.
- **Risco:** Baixo — mas é uma checagem de origem genuinamente fraca (má-prática concreta), do tipo
  que vira grave se algum dia o handler passar a confiar no dado recebido.
- **Correção recomendada:** trocar por match **exato** de origem (allowlist:
  `event.origin === 'https://www.facebook.com'` e variantes oficiais), como manda a prática de
  postMessage.
- **Prioridade:** Baixa (correção barata).
- **Origem:** CodeQL `security-extended` (achado que Semgrep OSS e as auditorias anteriores não
  pegaram — dimensão frontend).

---

### V14 — Dependências vulneráveis (produção mínima; dev-tooling com CVEs)

- **Severidade:** INFORMATIVO / BAIXA · **Categoria:** Manutenção / Segurança (OWASP A06)
- **Local:** `package.json` / `pnpm-lock.yaml`. `pnpm audit` = 18 vulns (2 critical, 6 high, 9
  moderate, 1 low), **mas a leitura correta separa produção de dev**:
- **Produção (`pnpm audit --prod`) — o que sobe (2):**
  - **`drizzle-orm@0.36.4` — HIGH** — SQLi via identifiers mal-escapados (GHSA-gpj5-g38j-94v9,
    corrigido ≥0.45.2). **Vetor NÃO alcançável neste código:** todos os `.orderBy()` usam
    col-refs **estáticas** (`desc(patients.updatedAt)`), `sql.raw` só com constantes — nenhum
    identifier vem de input do usuário. Recomendar upgrade como defense-in-depth.
  - **`esbuild` ≤0.24.2 — MODERATE** — via `@sentry/nextjs` (webpack plugin) — **build-time**, não
    runtime de produção.
- **Dev-only (não sobem):** `handlebars` (critical, via eslint-plugin-boundaries), `vitest`
  (critical — file read do UI server), `vite`/`js-yaml`/`launch-editor` (dev/test).
- **Impacto:** "18 vulns" assusta, mas a superfície **real de produção** é 1 HIGH não-alcançável +
  1 MODERATE build-time. Os critical/high são todos dev-tooling.
- **Correção recomendada:** `pnpm up drizzle-orm@latest` (respeitando ADR-006 de pinning);
  atualizar vitest/vite/eslint-plugin-boundaries; **gate de `pnpm audit --prod` por severidade no
  CI** (falhar só em prod-deps, para não travar em ruído de dev).
- **Prioridade:** Baixa (curto prazo: drizzle-orm; contínuo: gate no CI).

---

### V15 — Superfície RPC: funções `SECURITY DEFINER` executáveis por `anon`/`authenticated` (scan vivo)

- **Severidade:** MÉDIA-BAIXA · **Categoria:** Segurança / Least-privilege
- **Origem:** `get_advisors(security)` ao vivo no `qoro-dev` (2026-07-12) — dimensão que os scanners
  estáticos e as auditorias anteriores só cobriram parcialmente.
- **Descrição:** 4 funções `SECURITY DEFINER` retêm `EXECUTE` para `anon`/`authenticated` via
  PostgREST (`/rest/v1/rpc/`): `record_login_attempt(email_hash, ip, success)`, `rls_auto_enable()`,
  e duas funções de **trigger** — `block_lancamento_immutable_cols()` e
  `block_signed_prontuario_update()` (não deveriam ser chamáveis fora do trigger). Some-se: 2
  funções com **`search_path` mutável** (`appt_tstzrange`, `enforce_appointment_snapshot_immutable`
  — viola a regra do ADR-010 "`SET search_path = public, pg_temp`"); extensões `btree_gist`/`pg_trgm`
  no schema `public`.
- **Impacto / Cenário:** o item mais relevante é **`record_login_attempt`** — chamável por `anon`
  com `(email_hash, ip, success)` arbitrários → permite **injetar linhas forjadas em
  `login_attempts`** (poluição da auditoria pré-auth). **Impacto limitado:** o rate-limit primário
  é Upstash (não lê desta função) e o `email_hash` exige o pepper secreto (`LOGIN_HASH_PEPPER`),
  então o atacante **não mira** o bucket de uma vítima com precisão — pode poluir/inflar a tabela.
  `search_path` mutável em `SECURITY DEFINER` é vetor clássico de hijack se um atacante criar objeto
  num schema anterior no path.
- **Risco:** Baixo-médio — least-privilege/hardening; poluição de auditoria; conformidade ADR-010.
- **Correção recomendada:** `REVOKE EXECUTE ON FUNCTION ... FROM anon, authenticated` para as 4
  (é exatamente o padrão da migração `0002` de C2-hardening, que não foi aplicado a estas funções
  posteriores); adicionar `SET search_path = public, pg_temp` às 2 funções; mover as extensões para
  um schema dedicado.
- **Nota (NÃO é vazamento — evitar falso-alarme):** o advisor também lista **~37 tabelas com "RLS
  enabled, no policy"** (partições `ai_messages_*`/`audit_events_*` + `billing_reconciliation_runs`,
  `checkout_sessions`, `clinic_invites`, `cron_heartbeats`, `processed_webhooks`,
  `tenant_provisioning`). Isso **não é leak**: (a) partições **herdam** a policy do pai
  particionado; (b) tabelas operacionais com RLS sem policy = **deny-all por padrão** (fail-closed)
  para roles não-BYPASSRLS, acessadas só via `dbAdmin`. É o comportamento **seguro** esperado.
- **Prioridade:** Baixa-Média.
- **Cruza com:** `auditoria-banco-dados.md` A15/A16 (funções executáveis por `anon`) e A13 (grants
  amplos default a `anon`).

---

## 4. Possíveis Ataques (modelagem por perfil)

### 4.1 Atacante externo (não autenticado)
- **Webhook Asaas forjado (V3):** com o token, dispara evento financeiro → reabre clínica
  bloqueada / estorno. Mitigado por transições monotônicas + reconciliação diária.
- **Info-leak / oráculo em `/api/health/auth-hook` (V11):** raspa `e.message` cru; sem dado
  sensível, mas confirma internals.
- **Bypass do middleware via `_healed=1` (V4):** anula o heal de drift em requests diretas; contido
  pelo `require*` por página.
- **Brute-force de login sob queda do Upstash (V5):** rate-limit fail-open per-instância eleva o
  teto efetivo ~N×.
- **Barrado:** SQLi (Drizzle parametrizado; `sql.raw` só constantes), XSS→PDF (react-pdf), SSRF
  (hosts fixos), enumeração de conta (mensagens genéricas), forja de `clinic_id` no JWT (claim
  injetado server-side pelo hook, não de `user_metadata`).

### 4.2 Usuário malicioso (autenticado, tenant comum)
- **IDOR cross-tenant por ID manipulado:** **barrado hoje** pela RLS (`withTenant` + FORCE +
  role authenticated) — o ID de outra clínica filtra para zero linhas. **Mas** o isolamento é de
  **camada única** (V1/V2 corolário): sem filtro `clinic_id` no WHERE, um único deslize futuro
  (tabela sem FORCE / path sem `withTenant`) vira IDOR imediato.
- **Prova de pagamento com path de outra clínica (V8):** planta `clinicB-uuid/...`; latente até
  existir um endpoint que sirva o path.
- **Ação crítica na clínica errada durante drift de reatribuição (V7):** janela de ≤15 min.

### 4.3 Tenant malicioso (clínica adversária)
- **Objetivo:** ler prontuários/financeiro de outra clínica. **Vetor primário = V1** — não há
  exploit direto hoje; o risco é o modelo não ser fail-closed. Se conseguir induzir (via bug/PR
  futuro) um path sem `withTenant`, lê tudo. **Recomendação central: role dedicado sem BYPASSRLS.**
- **Escalonamento de papel via convite:** **barrado** — `InvitableRole` exclui owner/gestor/
  super_admin e `assertCanAssignRole` nega no servidor (security-review confirmou CLEAN).

### 4.4 Usuário autenticado abusando de permissões legítimas
- **Owner/gestor convidando/gerindo equipe:** o link de recovery gerado no resend é sensível, mas
  entregue a quem já tem `MANAGE_EMPLOYEES` e nunca é logado. Sem escalonamento.
- **Impersonation (super_admin):** concede poder total no tenant-alvo — é break-glass **intencional**
  e bem-controlado (HMAC, AAL2, TTL 1 h, sessão única, log append-only). Sem abuso silencioso.
- **Financeiro:** ações de dinheiro exigem `OPERATE_CAIXA`/`MANAGE_FINANCIAL`, com `FOR UPDATE` +
  state-machine + idempotência; estorno é compensação append-only. Sem double-charge / estado
  impossível.

---

## 5. Melhorias Recomendadas

### Imediato (barato, alto valor — dias)
1. **Corrigir as docstrings contraditórias** de `tenant.ts`/`rls.ts` para casar com
   `connection-origin-guard.ts` (**V1** — a contradição é o maior risco isolado, e o fix é texto).
2. ✅ **`rolbypassrls` confirmado ao vivo** (V1 provado). Ação restante: **corrigir a docstring** e,
   antes do go-live, repetir a query no `qoro-prod`.
3. **`REVOKE EXECUTE`** de `anon`/`authenticated` nas 4 funções `SECURITY DEFINER` do **V15** (padrão
   da migração `0002`) + `SET search_path` nas 2 funções sinalizadas.
4. **Match exato de origem** no postMessage do WhatsApp (**V13**).
5. **Mensagem genérica** nos 500 de `auth-hook` e `reset-password` (**V11/V10**).
6. **Aplicar `lazyResetLimiters`** (já existe) na action de reset (**V10**).

### Curto prazo (semanas)
6. **Predicado defensivo `clinic_id`** nas mutações/leituras que hoje escopam só por PK (**V1/V2
   corolário** — defense-in-depth).
7. **Validar prefixo tenant** do `fileStoragePath` de prova de pagamento **antes** de qualquer
   feature de download (**V8**).
8. **Backstop `if (!user) redirect('/login')`** no layout `(shell)` + arch-test de `require*` por
   página (**V9**).
9. **Não confiar no cookie `_healed`** do cliente para pular o middleware (**V4**).
10. **`timingSafeEqual`** nos handlers de cron/verify-token (**V12**).
11. **Upgrade `drizzle-orm`** + gate de `pnpm audit --prod` no CI (**V14**).

### Médio prazo (mês+, já mapeado p/ C16)
12. **Role dedicado sem BYPASSRLS** para o pool `db` → isolamento fail-closed por construção
    (**V1**, o fix estrutural).
13. **Cifrar conteúdo clínico** (estender `encryptForTenant` + migração de re-cifra) (**V2**).
14. **`requireFreshPermission` revalidando `clinic_id`** (**V7**).
15. **Promover CSP a bloqueante** com nonce (**V6**).
16. **Breaker/quota de IA em Redis** + **segredos de cron separados** por classe de rota (**V5**).

### Longo prazo (estratégico)
17. **Auth-epoch global** para revogação imediata (mata replay de 15 min + drift de
    `role_permissions`) (**V5**).
18. **Endurecer o webhook Asaas** (rotação agressiva de token + restrição por IP + alarme de
    divergência webhook↔reconciliação) (**V3**).
19. **Particionamento/retenção** das tabelas raw de mensageria e enforcement da retenção de IA
    (ver `auditoria-banco-dados.md` A2/A5).

---

## Anexo A — Cobertura das ferramentas obrigatórias

| Ferramenta | Status | Resultado |
|-----------|--------|-----------|
| **`pnpm audit`** | ✅ Executado | 18 vulns (prod real: 1 HIGH não-alcançável + 1 MODERATE build-time). Ver **V14**. |
| **Semgrep** 1.157.0 (OSS) | ✅ Executado | 573 arquivos, 691 regras (p/typescript,javascript,react,nextjs,nodejs,owasp-top-ten,cwe-top-25,secrets,jwt,sql-injection,trailofbits), 100% parse. **1 finding → falso-positivo** (`gcm-no-tag-length` @ encryption.ts:93; `setAuthTag` presente na linha 94). SARIF em `static_analysis_semgrep_1/results/results.sarif`. |
| **CodeQL** 2.26.0 (`security-extended`, taint cross-file) | ✅ Executado | DB TS de 573 arquivos. **2 findings** (ambos em `whatsapp-connect.tsx`) → 1 real de baixo impacto (**V13**), 1 correlato (missing-origin-check, mesma raiz). SARIF em `scratchpad/codeql-results.sarif`. |
| **`/security-review`** (Claude, diff da branch) | ✅ Executado | **CLEAN** — 0 achados ≥8 de confiança no fluxo de convite/practitioner/CRM/migração 0037/PDF/middleware. |
| **`/coderabbit:code-review`** | ⚠️ **Não executado** | CLI não instalado e o serviço exige **autenticação interativa** (login no CodeRabbit SaaS), inviável nesta sessão não-interativa. **Cobertura compensada** por Semgrep + CodeQL + security-review + revisão manual do mesmo diff. |
| **Supabase `get_advisors(security)`** (scan vivo) | ✅ Executado | qoro-dev, 2026-07-12. Confirmou **V1** (`rolbypassrls`) e revelou **V15** (funções `SECURITY DEFINER` anon-executáveis + `search_path` mutável). ~37 avisos `rls_enabled_no_policy` triados como **fail-closed-by-design** (não-leaks). |

## Anexo B — Limitações desta auditoria
- **Verificação empírica de `rolbypassrls` (V1): ✅ RESOLVIDA.** Após conectar o Supabase, a query
  ao vivo no `qoro-dev` confirmou que `postgres`/`service_role` têm `rolbypassrls=true` e
  `authenticated` `=false` (ver §3 · V1). A prova está fechada. (Recomenda-se repetir no `qoro-prod`
  antes do go-live — os roles são idênticos por convenção Supabase, mas vale confirmar.)
- **CodeQL** cobriu `src/` + `middleware.ts` + `next.config.ts` + `drizzle/` (node_modules
  excluído de propósito, por performance). **Semgrep** cobriu `src/`.
- Auditoria **estática/manual** — nenhum teste dinâmico/pentest ativo foi executado contra um
  ambiente vivo; nenhum código foi modificado.

## Anexo C — Achado de code-review (não-segurança, registro)

Fora do escopo de *segurança*, o code-review de bugs+convenções da branch encontrou **1 item**
(bugs/lógica = 0 achados de alta confiança):

- **Violação de convenção CI-quebrando — ADR-032 §2 (`role === 'doctor'`):**
  [equipe/actions.ts:80-81](../../src/app/(app)/(shell)/equipe/actions.ts#L80) e
  [equipe/invite-drawer.tsx:70,171](../../src/app/(app)/(shell)/equipe/invite-drawer.tsx#L70)
  reintroduzem o gate literal `role === 'doctor'`, banido pela CONVENTIONS.md (linha 98) e pelo
  arch-test `src/lib/auth/no-doctor-capability-check.arch.test.ts`. **Confirmado ao vivo:** o teste
  **falha RED** listando esses 2 arquivos como ofensores (working tree, ainda não commitado/gated).
  *Nuance:* aqui o `=== 'doctor'` é gate de **campo de credencial** (capturar CRM), não de
  capacidade clínica — mas o arch-test é um ban textual/AST cego. **Resolução (decisão do founder):**
  (a) estender o allowlist do arch-test para os arquivos de convite, ou (b) refatorar para não usar
  o literal. **Status: registrado, correção adiada por decisão do founder (2026-07-12).**
  > **✅ RESOLVIDO em 2026-07-14** (opção (b), refatorado) — ver
  > [§ Histórico de Implementação](#histórico-de-implementação-2026-07-14) abaixo.

---

## Histórico de Implementação (2026-07-14)

> **Autor:** implementação das correções desta auditoria. **Branch:**
> `docs/identity-practitioner-model`. **Metodologia:** um achado por vez, com *gate* obrigatório
> por achado (analisar → **inventariar todos os locais** → confirmar impacto → editar →
> `typecheck`). **Princípios:** menor diff possível, sem alterar comportamento funcional, sem
> quebrar contrato público, sem migração nova. Esta seção é **aditiva** — não substitui nada acima.

### Escopo executado

- **Trilha A (correções de código seguras):** implementadas agora — V1.1, V1.2, V4, V7, V9, V10,
  V11, V12, V13, e a resolução do **Anexo C**.
- **Trilha B (estrutural / migração / infra / mudança de comportamento):** **documentada como
  diferida/risco-aceito** — V1.3, V2, V3, V5, V6, V8, V14, V15 (justificativa por item abaixo). A
  MCP do Supabase não estava autenticada nesta sessão; migrações de banco (V15) e queries ao vivo
  não foram executadas.

### Status por achado

| # | Severidade | Status | Nota |
|---|-----------|--------|------|
| **V1.1** (docstrings contraditórias) | ALTA (subitem) | ✅ **Resolvido** | Docstrings alinhadas à Correction F-01 do ADR-007. |
| **V1.2** (predicado `clinic_id` defensivo) | ALTA (subitem) | ✅ **Resolvido** | Defesa-em-profundidade em todas as mutações/leituras de request escopadas só por PK. |
| **V1.3** (role dedicado sem BYPASSRLS) | ALTA (subitem) | ⏸️ **Não resolvido — diferido (C16)** | Fix estrutural de infra; já previsto no ADR-007 F-01. |
| **V2** (cifra de conteúdo clínico) | ALTA | ⏸️ **Não resolvido — diferido** | Exige migração de dados + ponto único de decifra. |
| **V3** (webhook Asaas sem HMAC) | ALTA | ⏸️ **Risco-aceito documentado** | Asaas não oferece HMAC; mitigações existentes mantidas. |
| **V4** (`_healed` forjável) | MÉDIA | ✅ **Resolvido** | `_healed` só é honrado após validar presença de sessão. |
| **V5** (cascata/resiliência) | MÉDIA | ⏸️ **Não resolvido — diferido (C16)** | Redis distribuído + segredos de cron separados + auth-epoch. |
| **V6** (CSP Report-Only) | MÉDIA | ⏸️ **Não resolvido — diferido (C16)** | Promover a bloqueante com nonce; decisão consciente atual. |
| **V7** (`requireFreshPermission` não revalida `clinic_id`) | MÉDIA | ✅ **Resolvido** | `clinic_id` do banco comparado com o do JWT; divergência → 403. |
| **V8** (path de comprovante do cliente) | MÉDIA (latente) | 🟡 **Parcialmente — guardrail** | Campo é texto livre hoje; comentário-guarda no ponto de persistência. |
| **V9** (layout sem backstop) | MÉDIA | ✅ **Resolvido** | `if (!user) redirect('/login')` no `ShellLayout`. |
| **V10** (reset-password sem rate-limit) | BAIXA | ✅ **Resolvido** | Rate-limit + validação de recovery session + erro genérico. |
| **V11** (`auth-hook` erro cru) | BAIXA | ✅ **Resolvido** | 500 genérico; detalhe no observability. |
| **V12** (comparações não-constant-time) | BAIXA | ✅ **Resolvido** | Helper `safeEqual` (never-throw) em 16 handlers + verify-token Meta. |
| **V13** (postMessage origem fraca) | BAIXA | ✅ **Resolvido** | Allowlist exata de origem. |
| **V14** (dependências) | INFO/BAIXA | ⏸️ **Não resolvido — diferido** | Upgrade `drizzle-orm` (pin ADR-006) + gate `pnpm audit --prod` no CI. |
| **V15** (RPC `SECURITY DEFINER` p/ anon) | MÉDIA-BAIXA | ⏸️ **Não resolvido — diferido** | Migração DB (`REVOKE EXECUTE` + `search_path`); MCP não autenticada nesta sessão. |
| **Anexo C** (`role === 'doctor'` arch-test RED) | — (não-segurança) | ✅ **Resolvido** | `isPractitionerRole` como fonte única; arch-test RED→GREEN. |

### Trilha A — alterações realizadas

**V1.1 — Docstrings contraditórias.** Arquivos: [`src/lib/db/tenant.ts`](../../src/lib/db/tenant.ts),
[`src/lib/db/rls.ts`](../../src/lib/db/rls.ts). *Motivo:* as docstrings afirmavam "FORCE é a defesa
PRINCIPAL / isolamento sobrevive sem o SET ROLE" — **empiricamente falso** (pool roda BYPASSRLS) e
já **corrigido pela própria "Correction F-01" do ADR-007** (linhas 139-183). *Abordagem:* reescrita
do texto para casar com a F-01 e com `connection-origin-guard.ts` (o `SET LOCAL ROLE authenticated`
do `withTenant` é a defesa PRINCIPAL de runtime; FORCE é defesa-em-profundidade). *Impacto:* apenas
comentários — **zero comportamento, zero tipo**.

**V1.2 — Predicado defensivo `clinic_id`.** Arquivos:
[`clinical/actions.ts`](../../src/contexts/clinical/actions.ts),
[`financial/actions.ts`](../../src/contexts/financial/actions.ts),
[`patient/actions.ts`](../../src/contexts/patient/actions.ts),
[`scheduling/internal/appointment-core.ts`](../../src/contexts/scheduling/internal/appointment-core.ts),
[`scheduling/catalog-actions.ts`](../../src/contexts/scheduling/catalog-actions.ts). *Abordagem:*
adicionado `eq(<tabela>.clinicId, clinicId)` ao `WHERE` de **todas** as mutações/leituras `FOR UPDATE`
e leituras-de-mutação que escopavam só por PK/FK, no grafo **request-driven** dos 4 contextos
sinalizados (prontuarios×6, lancamentos×6, patients/patientAddresses/patientConsents×8, appointments×4,
procedures×1, suppliers×2). O `clinicId` já estava em escopo (`requireClinicId()` / `idempotentMutation`
→ `withTenant`). *Comportamento:* **preservado** — sob RLS (`withTenant` ativo em todos os caminhos,
confirmado em `idempotency/mutation.ts:144`), uma linha de outra clínica já é invisível; o predicado
só muda o resultado no cenário de bypass — exatamente o endurecimento pretendido. *Inventário
completo:* fechado via varredura de `.update(`/`.delete(`/`.for('update')` **e** `.where(eq(<tabela>…))`
— duas leituras-de-mutação (consent-versão, contato de supressão) que a 1ª varredura não pegou foram
incluídas. *Exclusões conscientes (documentadas):* `queries.ts` (helpers read-only), handlers de
outbox/worker/cron (`hard-delete`, `pdf-pipeline`, `sender`, event-handlers) e `billing`/`provisioning`
(cross-tenant/pré-tenant por design) — todos já sob `withTenant` e fora da superfície de IDOR por
manipulação de id do request.

**V4 — Cookie `_healed`.** Arquivo: [`src/middleware.ts`](../../src/middleware.ts). *Abordagem:* o
early-return por `_healed` foi **movido para depois** do `supabase.auth.getUser()`. Assim `_healed`
só pula o **DB drift-check** (o passo caro + o único que dispara `forceHealAndLogout`) — preservando
o anti-loop / anti-revocation-storm — mas **não anula mais a checagem de presença de auth**: um
`_healed=1` forjado sem sessão válida cai no `redirectToLogin`. *Comportamento:* ciclo de heal
legítimo inalterado (cookies `sb-` apagados → `getUser` nulo → redirect). Teste de regressão do
middleware (`middleware.test.ts`) continua verde.

**V7 — `requireFreshPermission` revalida `clinic_id`.** Arquivo:
[`src/lib/auth/tenant-context.ts`](../../src/lib/auth/tenant-context.ts). *Abordagem:* incluído
`clinicId` na re-leitura de `profiles` e comparado com `user.clinicId` (JWT); divergência → `AuthError
403`. *Comportamento:* preservado quando JWT e DB concordam (caso normal); o novo throw só ocorre na
janela de drift de reatribuição — a vulnerabilidade descrita. `super_admin`/impersonation continuam
com early-return antes da checagem.

**V9 — Backstop de auth no layout `(shell)`.** Arquivo:
[`src/app/(app)/(shell)/layout.tsx`](../../src/app/(app)/(shell)/layout.tsx). *Abordagem:*
`if (!user) redirect('/login')` após o `Promise.all`. Defesa-em-profundidade; usuário
não-autenticado já era barrado pelo middleware + `require*` por página.

**V10 — `reset-password`.** Arquivo:
[`reset-password/actions.ts`](../../src/app/(app)/reset-password/actions.ts). *Abordagem:* valida a
recovery session via `getUser()`; aplica `assertPasswordResetAllowed(ip, hashEmail(email))` (helpers
já existentes; fail-open F-08); troca `error.message` cru por mensagem genérica + `logger.warn`.

**V11 — `/api/health/auth-hook`.** Arquivo:
[`auth-hook/route.ts`](../../src/app/api/health/auth-hook/route.ts). *Abordagem:* 500 devolve corpo
genérico (`internal_error`); o detalhe vai só para `logger.error`. Shape `{ok}` preservado (o
monitor externo só lê `ok`).

**V12 — Constant-time.** Novo helper
[`src/lib/auth/secret-compare.ts`](../../src/lib/auth/secret-compare.ts) — `safeEqual(a, b)` que
**nunca lança** e retorna `false` para `null`/`undefined`/tamanhos diferentes, só chamando
`crypto.timingSafeEqual` após normalizar para `Buffer` de mesmo comprimento. Aplicado em **16
handlers** (13 crons + `health` + `health/outbox` + verify-token GET do Meta em
[`webhooks/meta/route.ts`](../../src/app/api/webhooks/meta/route.ts)). *Comportamento:* veredito
allow/deny idêntico; só remove o micro side-channel de timing.

**V13 — postMessage.** Arquivo:
[`whatsapp-connect.tsx`](../../src/app/(app)/(shell)/configuracoes/whatsapp/whatsapp-connect.tsx).
*Abordagem:* `event.origin.endsWith('facebook.com')` → allowlist **exata**
(`ALLOWED_FB_ORIGINS` = `https://www.facebook.com`, `https://web.facebook.com`). O servidor já
revalida os hints contra o token — baixo impacto.

**Anexo C — `role === 'doctor'` (arch-test RED).** Arquivos:
[`practitioner.ts`](../../src/lib/auth/practitioner.ts),
[`identity/index.ts`](../../src/contexts/identity/index.ts),
[`equipe/actions.ts`](../../src/app/(app)/(shell)/equipe/actions.ts),
[`equipe/invite-drawer.tsx`](../../src/app/(app)/(shell)/equipe/invite-drawer.tsx). *Abordagem
(opção (b), refatorar):* introduzido `isPractitionerRole(role)` no módulo canônico (já no allowlist
do arch-test) e **`isPractitioner` passou a ser DERIVADO dele** — sem terceira codificação divergente;
`practitionerSql` inalterado; o teste de equivalência TS×SQL continua verde. Os literais banidos em
`equipe/actions.ts` e `invite-drawer.tsx` viraram `isPractitionerRole(...)`. **Nuance de segurança:**
o gate do convite é **anti-escalonamento** (só o papel `doctor` recebe CRM; `crm != null ⇒
practitioner`). Refatorar para `isPractitioner({role, crm})` seria **regressão** (um `attendant` com
CRM avulso viraria practitioner); por isso o predicado é **role-only** e o comportamento é idêntico.
Arch-test `no-doctor-capability-check` passou de **RED → GREEN**.

### Trilha B — diferido / risco-aceito (documentação)

- **V1.3 — Role dedicado sem BYPASSRLS.** *Não resolvido — diferido (C16).* É o fix estrutural do
  V1, já registrado como "Residual/deferred (C16)" na Correction F-01 do ADR-007. Mitigado hoje pelo
  `withTenant` + allowlist AST (`connection-origin-guard`) + V1.2 (predicado local). *Recomendação:*
  conectar o pool `db` como role `authenticator` não-privilegiado → fail-closed por construção.
- **V2 — Cifrar conteúdo clínico.** *Não resolvido — diferido.* Exige migração de dados em lote +
  ponto único de decifra nas leituras; muda o caminho de dados (fora de "menor diff / sem migração").
  Cruza com `auditoria-banco-dados.md` A1. *Recomendação:* estender `encryptForTenant`/
  `decryptForTenant` aos campos clínicos + índices via `hashForLookup`.
- **V3 — Webhook Asaas.** *Risco-aceito documentado.* O Asaas não oferece HMAC de corpo. Mitigações
  **já presentes** e mantidas: compare constant-time do token, transições monotônicas, reconciliação
  diária autoritativa. *Recomendação:* rotação agressiva do token + alarme de divergência
  webhook↔reconciliação (observability).
- **V5 — Resiliência/cascata.** *Não resolvido — diferido (C16).* Breaker/quota de IA em Redis,
  segredos de cron separados por classe de rota, redução de TTL / auth-epoch global.
- **V6 — CSP bloqueante.** *Não resolvido — diferido (C16).* Report-Only é decisão consciente (não
  quebrar hydration/Sentry antes de observar). *Recomendação:* nonce por request via middleware.
- **V8 — Path de comprovante.** *Parcialmente — guardrail.* Hoje `comprovante` é **campo de texto
  livre** no Caixa (sem upload nem endpoint que assine o path), então impor prefixo `${clinicId}/`
  quebraria a UX atual. Foi adicionado um **comentário-guarda** no ponto de persistência
  ([`financial/actions.ts`](../../src/contexts/financial/actions.ts), insert de `paymentProofs`)
  exigindo derivar o path server-side **ou** validar o prefixo **antes** de qualquer feature de
  download/assinatura. Sem mudança de comportamento.
- **V14 — Dependências.** *Não resolvido — diferido.* `drizzle-orm` HIGH **não-alcançável** neste
  código. *Recomendação:* `pnpm up drizzle-orm@latest` (respeitando pin ADR-006) + gate de
  `pnpm audit --prod` por severidade no CI. Bump de dep pinado exige suíte completa → fora do escopo
  "menor diff / sem alterar comportamento" desta rodada.
- **V15 — RPC `SECURITY DEFINER`.** *Não resolvido — diferido.* Requer **migração de banco**
  (`REVOKE EXECUTE ... FROM anon, authenticated` nas 4 funções + `SET search_path = public, pg_temp`
  em 2) seguindo o padrão da migração `0002`. Não aplicável nesta sessão (plan/execução sem MCP
  Supabase autenticada; nenhuma migração nova foi criada por decisão de escopo). *Recomendação:*
  criar a migração e aplicar via `db:migrate:dev`/`prod`.

### Decisões técnicas

1. **V1.1 fundamentado no próprio ADR-007.** A "Correction F-01" (2026-05-30) já declara a moldura
   "FORCE-principal" tecnicamente errada; a correção das docstrings apenas propaga essa decisão já
   existente — não introduz nova política.
2. **V1.2 é behavior-preserving por construção.** Confirmado que `idempotentMutation` roda tudo em
   `withTenant(clinicId, …)` (RLS ativo). O predicado é no-op no caminho normal e barreira no
   cenário de bypass. Fronteira do inventário definida e documentada para evitar tanto omissão
   ("o 4º caso") quanto scope-creep em caminhos já protegidos.
3. **V4 — reposicionar em vez de assinar.** Optou-se por honrar `_healed` só após a presença de auth
   (recomendação explícita da própria auditoria) em vez de HMAC no cookie: menor diff, sem novo
   segredo no Edge, preserva anti-loop/anti-storm.
4. **V12 — contrato never-throw explícito.** O helper aceita `string | null | undefined` e nunca
   lança (guard de tamanho antes do `timingSafeEqual`), blindando contra `env.CRON_SECRET` ausente e
   contra uso incorreto do `timingSafeEqual` cru.
5. **Anexo C — `isPractitioner` derivado de `isPractitionerRole`.** Elimina duplicação **sem** criar
   ponto de drift e **sem** regressão de autorização (role-only preserva anti-escalonamento). Fonte
   única para a cláusula de papel.

### Validação

Todos os gates executados na raiz do projeto (`pnpm`), 2026-07-14:

| Comando | Resultado |
|---------|-----------|
| `pnpm lint` (`eslint .`) | ✅ **0 erros / 0 warnings** |
| `pnpm typecheck` (`tsc --noEmit`) | ✅ **limpo** (executado após cada achado — gate) |
| `pnpm test` (`vitest run`) | ✅ **59 arquivos, 526 testes, 526 passando** — inclui `no-doctor-capability-check` (**RED→GREEN**), `middleware`, `critical-actions`, `practitioner` (equivalência TS×SQL), `connection-origin-guard`, `rate-limit` |
| `pnpm build` (`next build`) | ✅ **sucesso** — bundle client de `/configuracoes/whatsapp` (2.76 kB) e `/equipe` sem regressão (tree-shaking manteve `drizzle` fora do client após o import de `isPractitionerRole`) |

*Testes E2E:* não há suíte E2E dedicada no repositório (validação via unit/integration Vitest +
build). Smokes (`scripts/smoke-*.ts`) exigem ambiente/DB vivo e não foram executados nesta sessão.

### Compatibilidade

- **Nenhuma API pública alterada** — assinaturas de `require*`, Server Actions, tipos exportados e a
  superfície de `@/contexts/identity` inalteradas (apenas **adição** de `isPractitionerRole`).
- **Nenhum contrato entre contexts quebrado**; nenhum boundary violado; nenhuma dependência circular
  introduzida (o novo `secret-compare.ts` só depende de `node:crypto`).
- **Nenhuma migração nova criada** (Trilha A é 100% código de aplicação; V15 permanece diferido).
- **RLS não enfraquecida** — V1.2/V4/V7 só **acrescentam** verificação (defesa-em-profundidade /
  fail-closed); nenhuma política foi relaxada.
- **Nenhuma mudança funcional** nos caminhos felizes; os únicos novos throws/redirects (V7, V9)
  disparam apenas em estados de drift/não-autenticado que já eram inválidos.

### Pendências

- **Trilha B** (V1.3, V2, V3, V5, V6, V8-enforcement, V14, V15) permanece conforme detalhado acima —
  cada item com motivo, risco residual e recomendação.
- **V15** especificamente aguarda uma **migração de banco** + acesso autenticado ao Supabase, ainda
  não disponível nesta sessão.
- Recomenda-se repetir a query de `rolbypassrls` no `qoro-prod` antes do go-live (Anexo B).

---

## Histórico de Implementação — Trilha B (2026-07-14, sessão 2)

> Após a Trilha A, a MCP do Supabase foi conectada e o usuário pediu para **executar a Trilha B até o
> fim, documentando tudo**. Esta seção registra o que foi **implementado e verificado**, o que foi
> **parcialmente entregue** (parte segura agora + parte diferida com plano) e o que foi **diferido**
> por exigir verificação em runtime/browser ou migração de dados que **não pode ser feita às cegas**
> num app clínico (LGPD Art. 11). Princípio mantido: **não quebrar o app** vale mais que "marcar
> concluído". Esta seção **supersede** a linha "Trilha B" da tabela anterior.

### Status por achado (Trilha B)

| # | Status | Entregue nesta sessão | Diferido (com plano abaixo) |
|---|--------|-----------------------|------------------------------|
| **V15** | ✅ **Resolvido** | Migração `0038` + **aplicada no qoro-dev via MCP** + verificada (ACL/advisor). | Mover extensões `btree_gist`/`pg_trgm` de `public` (risco sobre constraints/índices). |
| **V3** | ✅ **Resolvido** | Alarme `billing.reconcile.divergence` quando o reconcile acha pagamento que o webhook perdeu. | Restrição por IP do Asaas (sem IP estável publicado). |
| **V5** | 🟡 **Parcial** | `CRON_SECRET_DESTRUCTIVE` (opt-in) nas 3 rotas destrutivas → reduz blast radius. | Breaker/quota de IA distribuído (Redis) + auth-epoch — decisão MVP documentada (ADR-022). |
| **V14** | 🟡 **Parcial** | Gate `pnpm audit --prod --audit-level high` no CI + ignore documentado do GHSA não-alcançável. | Upgrade coordenado `drizzle-orm`+`drizzle-kit` (ADR-006 pin; vetor não-alcançável). |
| **V1.3** | 🟡 **Parcial** | Plumbing **opt-in** `DATABASE_URL_RUNTIME` no pool `db` (default = comportamento atual). | Criar o role sem BYPASSRLS + cutover (runbook abaixo) — deploy supervisionado. |
| **V6** | ⏸️ **Diferido** | — | Flip CSP → bloqueante com nonce: exige **verificação em browser** (staged). Plano abaixo. |
| **V2** | ⏸️ **Diferido** | — | Cifra de conteúdo clínico: feature dedicada + **migração de re-cifra de dados**. Plano abaixo. |

### Implementado e verificado

**V15 — `SECURITY DEFINER` least-privilege (RESOLVIDO — dev + prod).** Migração
[`drizzle/migrations/0038_security_definer_hardening.sql`](../../drizzle/migrations/0038_security_definer_hardening.sql)
(+ entrada no `_journal.json`). **Aplicada ao `qoro-dev` E ao `qoro-prod` via MCP** (2026-07-14) e
verificada nos dois por query ao `pg_proc` (ACLs idênticas pós-fix). Nota: aplicada via
`execute_sql` (DDL idempotente), então o `__drizzle_migrations` não a registra — quando
`db:migrate:*` rodar o `0038`, será **no-op idempotente**. Detalhe por objeto:
- `REVOKE EXECUTE ... FROM anon, authenticated` em `block_lancamento_immutable_cols()` e
  `block_signed_prontuario_update()` (funções de **trigger** — o disparo não depende do EXECUTE do
  chamador, então só fecha a superfície `/rest/v1/rpc/`). ACL após: `{postgres, service_role}`.
- `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` em `rls_auto_enable()` (função de manutenção,
  **sem call-site no app**). ACL após: `{postgres, service_role}`.
- `SET search_path = public, pg_temp` em `appt_tstzrange(timestamptz, integer)` e
  `enforce_appointment_snapshot_immutable()` (as 2 com `search_path` mutável; `pg_catalog` continua
  implícito, built-ins resolvem).
- **Adaptação (achado exigiu):** `record_login_attempt(text, inet, boolean)` **NÃO** foi revogada. A
  auditoria sugeria revogar de `anon/authenticated`, mas o login
  ([login/actions.ts:83](../../src/app/(app)/login/actions.ts#L83)) chama-a via `supabase.rpc` no
  cliente SSR cujo papel é `anon` (auditoria **pré-auth**). Revogar quebraria silenciosamente a
  trilha de auditoria pré-auth. O risco (poluição de `login_attempts`) é limitado pelo pepper
  secreto `LOGIN_HASH_PEPPER` e não é mirável por vítima. Mantido por design (o advisor para essa
  função é esperado). Migração é **idempotente** (REVOKE/ALTER repetíveis) → segura quando
  `db:migrate:prod` a aplicar ao `qoro-prod`.
- **Diferido:** mover `btree_gist`/`pg_trgm` para schema dedicado — `ALTER EXTENSION ... SET SCHEMA`
  tem risco sobre a exclusão GiST de agendamentos e índices trigram; fica como hardening próprio.
- **Não-leaks (reconfirmado ao vivo):** os ~37 `rls_enabled_no_policy` (partições `ai_messages_*`/
  `audit_events_*` + tabelas operacionais) permanecem **fail-closed-by-design** (partição herda a
  policy do pai; RLS sem policy = deny-all p/ não-BYPASSRLS). Nada a fazer.

**V3 — Alarme de divergência webhook↔reconciliação (RESOLVIDO).**
[`cron/billing-reconcile/route.ts`](../../src/app/api/cron/billing-reconcile/route.ts): emite
`billing.reconcile.divergence` quando `found > 0` (o Asaas confirma um pagamento que o webhook não
refletiu → evento perdido/forjado). O monitoramento (C16) passa a poder alarmar; a reconciliação
diária segue como fonte da verdade. Rotação do token já tem runbook
([secret-rotation.md](../runbooks/secret-rotation.md)); IP-allowlist do Asaas não é viável (sem IP
estável publicado) — recomendação documentada.

**V5 (parte segura) — segredo de cron separado.** Novo env **opt-in**
`CRON_SECRET_DESTRUCTIVE` (em [env.ts](../../src/lib/env.ts)); as 3 rotas destrutivas
(`patient-hard-delete`, `data-retention`, `billing-dunning`) passam a exigir esse segredo **quando
definido**, caindo no `CRON_SECRET` quando ausente (retrocompat — zero mudança por default). Reduz o
blast radius de um vazamento do `CRON_SECRET` (que guarda também rotas read-only). Ativação = ops
define o segredo dedicado + configura o agendador dessas rotas.

**V14 (parte segura) — gate de dependências no CI.**
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml): step `pnpm audit --prod --audit-level
high` (só deps de produção; dev-tooling não conta). O advisory `GHSA-gpj5-g38j-94v9` (drizzle-orm)
está em `pnpm.auditConfig.ignoreGhsas` ([package.json](../../package.json)) — **não-alcançável**
neste código (identifiers/`orderBy` estáticos; `sql.raw` só com constantes), aceite documentado até
o upgrade. Verificado local: `pnpm audit --prod --audit-level high` → exit 0 (`1 high (1 ignored)`).

**V1.3 (parte segura) — plumbing fail-closed opt-in.** [env.ts](../../src/lib/env.ts) +
[db/index.ts](../../src/lib/db/index.ts): o pool **runtime** (`db`) passa a conectar por
`DATABASE_URL_RUNTIME` **quando definido** (default → `DATABASE_URL`, inalterado). `dbAdmin`/`dbWorker`
seguem no `DATABASE_URL` (BYPASSRLS, necessário). Assim o cutover fail-closed vira **mudança de env**,
sem novo deploy de código.

### Diferidos — planos concretos (documente tudo)

**V1.3 — cutover do role dedicado (runbook).** Ativar o fail-closed exige, em deploy supervisionado:
1. Criar role de login **sem BYPASSRLS** no Supabase, com membership em `authenticated` (para o
   `SET LOCAL ROLE authenticated` do `withTenant` funcionar) e SEM privilégios diretos amplos nas
   tabelas tenant:
   `CREATE ROLE qoro_runtime LOGIN PASSWORD '<secret>'; GRANT authenticated TO qoro_runtime;`
   (o password vive só no secret manager, nunca no git).
2. `DATABASE_URL_RUNTIME` = string do pooler autenticando como `qoro_runtime.<projectref>`.
3. **Verificar** (staging/dev): (a) toda tela/action tenant funciona; (b) um `db.select()` cru SEM
   `withTenant` retorna **0 linhas** (prova do fail-closed); (c) `withTenant` continua isolando. Só
   então promover a prod. Motivo de não aplicar agora: um role mal-configurado = **outage total** do
   acesso tenant; precisa de verificação em runtime que esta sessão não tem.

**V6 — CSP bloqueante com nonce (plano staged).** Não foi flipado às cegas: o CSP hoje é
Report-Only **sem report-sink** (só console), então "observar antes de bloquear" ainda não coleta
dado agregado. Plano:
1. Wire de **report-to/report-uri** (endpoint Sentry CSP) para coletar violações reais.
2. Mover o header CSP para o **middleware** (per-request) gerando um **nonce**; `script-src 'self'
   'nonce-<x>' 'strict-dynamic'` (dropar `unsafe-inline`/`unsafe-eval` de script); **manter**
   `style-src 'unsafe-inline'` (o app usa `style={}` do React em massa). Garantir que o **script de
   tema** (único `dangerouslySetInnerHTML`) e os scripts de hydration do Next recebam o nonce.
3. Rodar em Report-Only-com-nonce, observar violações no browser, corrigir, e **só então** flipar
   para `Content-Security-Policy` (enforce), atrás de um flag. Motivo de não aplicar agora: a
   corretude do nonce (Next scripts + Sentry + tema) **só se verifica em browser**; flip cego quebra
   o frontend clínico — exatamente o que a decisão Report-Only evita.

**V2 — cifra de conteúdo clínico (plano).** Feature dedicada (não cabe em sessão de patch cega —
risco de tornar prontuários existentes ilegíveis = risco a paciente/LGPD). Plano:
1. Campos: `prontuarios.content`, `prescriptions.medicamentos`, `medical_documents.*`,
   `patient_clinical_data.*`. Reusar o envelope `encryptForTenant`/`decryptForTenant`
   ([crypto/encryption.ts](../../src/lib/crypto/encryption.ts)) — cifra na escrita, decifra em ponto
   único na leitura.
2. **Retrocompat obrigatória:** `decrypt` tolerante a texto claro (byte de versão já suporta) para
   ler linhas ainda-não-migradas; **migração de re-cifra em lote** (por tenant, `withTenant`) das
   linhas existentes; só então tornar a cifra obrigatória.
3. Tratar leituras que **inspecionam** o conteúdo (ex.: `isContentEmpty(row.content)` em
   `signProntuario`, render `@react-pdf`, export LGPD, agente de IA) — todas precisam decifrar antes.
   Índices de busca continuam via `hashForLookup`.
4. Testar exaustivamente (unit + e2e clínico) + validar a migração em dev antes de prod. Cruza com
   `auditoria-banco-dados.md` A1.

### Validação (Trilha B)

| Comando | Resultado |
|---------|-----------|
| `pnpm lint` | ✅ 0 erros |
| `pnpm typecheck` | ✅ limpo (após cada achado) |
| `pnpm test` | ✅ **526/526** (59 arquivos) |
| `pnpm build` | ✅ sucesso |
| `pnpm check:migrations` | ✅ `0038` não é destrutiva (passa o gate anti-DROP) |
| `pnpm audit --prod --audit-level high` | ✅ exit 0 (`1 high (1 ignored)`) |
| MCP `execute_sql` (qoro-dev) | ✅ ACL das 5 funções confirmada pós-`0038`; `record_login_attempt` intacta |

### Compatibilidade (Trilha B)

- **Nenhuma mudança de comportamento por default:** `CRON_SECRET_DESTRUCTIVE` e `DATABASE_URL_RUNTIME`
  são **opt-in** (ausentes → comportamento idêntico). O alarme V3 é aditivo. O gate de CI só falha em
  HIGH+ **novo** de prod.
- **Migração `0038` é idempotente** e não-destrutiva; aplicada só ao **dev** nesta sessão (prod via
  `db:migrate:prod` no deploy). Não altera schema (só grants/`search_path`).
- **`record_login_attempt` preservada** — login pré-auth intacto.
- Nenhuma API pública alterada; nenhum boundary quebrado.

### Pendências (Trilha B)

- **V15:** ✅ aplicado no `qoro-dev` E `qoro-prod` (via MCP, 2026-07-14). Resta apenas propagar o
  `0038` pelo `db:migrate:*` (no-op idempotente, só p/ registro no journal) e mover extensões de
  `public` (hardening separado — risco sobre constraints/índices, ver melhor-forma abaixo).
- **V5:** breaker/quota de IA distribuído (Redis) + auth-epoch — C16/ADR-022.
- **V14:** upgrade coordenado `drizzle-orm`+`drizzle-kit` em PR próprio + emenda ao ADR-006.
- **V1.3:** cutover do role (runbook acima) — deploy supervisionado.
- **V6:** CSP enforce — rollout staged com verificação em browser (plano acima).
- **V2:** cifra clínica — feature dedicada + migração de dados (plano acima).
