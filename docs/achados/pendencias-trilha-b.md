# Pendências da Auditoria de Segurança — Trilha B (handoff para sessão dedicada)

> **Propósito.** Este documento é um **handoff auto-suficiente**: assuma que quem vai executar
> **não tem nenhuma memória** do trabalho anterior. Ele contém todo o contexto necessário para
> concluir os 6 itens restantes da auditoria de segurança **sem quebrar nada** e de forma correta.
> Fonte da verdade dos achados: [`auditoria-seguranca-codigo.md`](./auditoria-seguranca-codigo.md)
> (leia a seção "Histórico de Implementação" para o que JÁ foi feito).
>
> **Data do handoff:** 2026-07-14 · **Branch:** `docs/identity-practitioner-model`.

---

## 0. Contexto essencial (leia antes de tudo)

### 0.1 O produto e o risco
Qoro/ClinicaOS_V2 é um **SaaS clínico multi-tenant** (dados de saúde — LGPD Art. 11). Qualquer
mudança que possa (a) derrubar o acesso ao banco, (b) tornar dado clínico ilegível, ou (c) quebrar o
frontend, é **incidente de produção com impacto em paciente**. Por isso os itens abaixo foram
**deliberadamente adiados** da implementação automática: cada um exige verificação em runtime,
browser, ou migração de dados encenada. **Não os faça às cegas.**

### 0.2 Os dois projetos Supabase (Postgres 17)
| Ambiente | Project ref | Nome | Região |
|----------|-------------|------|--------|
| **DEV** | `pqhkirrszzpwezdaqrai` | qoro-dev | us-west-1 |
| **PROD** | `shlcbxawrxuaebazuiue` | qoro-prod | us-east-1 |

**Regra de ouro:** faça e valide **sempre no DEV primeiro**. Só toque no PROD depois de comprovado no
DEV, idealmente em janela de manutenção, com rollback pronto. Ferramentas MCP do Supabase
(`execute_sql`, `apply_migration`, `get_advisors`, `list_tables`) operam **direto no projeto remoto** —
confirme o `project_id` em cada chamada.

### 0.3 Workflow de migração de banco (drizzle-kit)
- Migrações vivem em `drizzle/migrations/NNNN_nome.sql` + índice `drizzle/migrations/meta/_journal.json`
  (entradas `{idx, version:"7", when:<epoch_ms>, tag:"NNNN_nome", breakpoints:true}`).
- Migrações **DDL manuais** (grants, funções): separe statements com `--> statement-breakpoint` e
  finalize com `INSERT INTO _schema_version (version) VALUES ('...') ON CONFLICT DO NOTHING;`.
  Migrações manuais **não** precisam de snapshot em `meta/`.
- Aplicar: `pnpm db:migrate:dev` (guardado por `assertDevContext()` — lê a `DATABASE_URL` do dev) e
  `pnpm db:migrate:prod`. Drizzle registra o aplicado em `drizzle.__drizzle_migrations`.
- **Estado atual (importante):** a última migração no repo é a **0037** (`profiles_invite_and_crm`,
  adiciona `profiles.invite_accepted_at`) — **ainda PENDENTE** no dev e no prod (`__drizzle_migrations`
  tem 37 linhas; `profiles.invite_accepted_at` não existe). A **0038** (hardening V15) foi **aplicada
  via MCP `execute_sql`** direto no dev **e** no prod (DDL idempotente), então **não** está no
  `__drizzle_migrations`. Quando `db:migrate:*` rodar, aplicará 0037 (schema real) **e** 0038 (no-op
  idempotente). **Cuidado:** rodar `db:migrate:*` aplica 0037 também — trate isso como deploy
  consciente, não efeito colateral.

### 0.4 Gates de verificação (rode SEMPRE ao final de cada item)
```
pnpm lint            # eslint . — 0 erros
pnpm typecheck       # tsc --noEmit
pnpm test            # vitest run — 526 testes hoje
pnpm build           # next build
pnpm check:migrations# gate anti-DROP (se mexeu em migração)
pnpm arch:db-check   # AST connection-origin guard (se mexeu em db/*)
pnpm audit --prod --audit-level high  # gate de dep de produção
```
CI: `.github/workflows/ci.yml` (roda todos acima) + `.github/workflows/adr-check.yml` (checa
conformidade com ADRs — relevante para o item ③).

### 0.5 Invariantes de arquitetura que você NÃO pode violar
- **Isolamento tenant (ADR-007 + Correction F-01):** o pool `db` conecta com role **BYPASSRLS**; quem
  faz a RLS valer é o `SET LOCAL ROLE authenticated` dentro de `withTenant()`
  ([src/lib/db/tenant.ts](../../src/lib/db/tenant.ts)). **Todo** acesso tenant passa por `withTenant`
  (ou `idempotentMutation`, que envolve `withTenant`). `dbAdmin`/`dbWorker` são BYPASSRLS de propósito
  (admin/worker/cron). O ESLint + `arch:db-check` (AST) impedem importar `db` fora de `tenant.ts`.
- **Cifra per-tenant (ADR-012):** `encryptForTenant(clinicId, plaintext)` /
  `decryptForTenant(clinicId, ciphertext)` / `hashForLookup(plaintext)` em
  [src/lib/crypto/encryption.ts](../../src/lib/crypto/encryption.ts). Envelope
  `base64(version || nonce || ciphertext || tag)`; **o byte de versão suporta rotação e
  retrocompatibilidade** (essencial para o item ⑥). Chave derivada por HKDF(masterKey, clinic_id).
- **Env opt-in já adicionados nesta auditoria** (default = comportamento inalterado; ver
  [src/lib/env.ts](../../src/lib/env.ts)): `CRON_SECRET_DESTRUCTIVE` (item já feito) e
  `DATABASE_URL_RUNTIME` (usado pelo item ④, ver abaixo).
- **Redis (Upstash) já configurado:** `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`; padrão de
  cliente lazy em [src/lib/auth/rate-limit.ts](../../src/lib/auth/rate-limit.ts) (`lazyRedis`).
  Relevante para o item ②.

### 0.6 Processo obrigatório por item (gate)
Para **cada** item: (1) ler o achado; (2) **inventariar todos os pontos afetados** antes de editar;
(3) confirmar impacto; (4) implementar no dev; (5) **verificar** (protocolo do item); (6) rodar os
gates; (7) só então prod/merge. Um item por vez.

---

## 1. Ordem recomendada (menor risco → maior)
1. **③ Upgrade drizzle-orm** — verificável por teste; precisa OK no ADR-006.
2. **① Mover extensões de `public`** — testável no dev; risco sobre constraints/índices.
3. **④ Cutover do role sem BYPASSRLS (V1.3)** — precisa app rodando p/ provar fail-closed.
4. **② Breaker/quota IA em Redis + auth-epoch** — precisa exercitar agente/auth.
5. **⑥ CSP enforce com nonce (V6)** — precisa verificação em browser.
6. **⑤ Cifra de conteúdo clínico (V2)** — maior: feature + migração de dados.
7. **Residual:** propagar 0038 pelo journal do drizzle.

---

## 2. Item ③ — Upgrade `drizzle-orm` (V14, defense-in-depth)

> **Status 2026-08-11: CONCLUÍDO.** `drizzle-orm@0.45.2` substituiu `0.36.4`; a exceção de
> audit foi removida, o ADR-006 foi emendado e o audit de produção retornou zero
> vulnerabilities. A lista abaixo é o plano histórico que levou à correção.

- **Achado (auditoria V14):** `drizzle-orm@0.36.4` tem HIGH `GHSA-gpj5-g38j-94v9` (SQLi via
  identifiers). **NÃO-alcançável neste código** (todos os `orderBy`/identifiers são estáticos;
  `sql.raw` só com constantes). Hoje há gate de CI `pnpm audit --prod --audit-level high` com esse
  GHSA em `pnpm.auditConfig.ignoreGhsas` ([package.json](../../package.json)). O upgrade remove a
  dívida e permite tirar o ignore.
- **Estado atual:** `drizzle-orm` `0.36.4` + `drizzle-kit` `0.28.1` (pinados em package.json). ADR-006
  **pina drizzle de propósito** — há `adr-check.yml` no CI. Journal está em `version: "7"`.
- **Pré-requisito:** decisão de emendar o **ADR-006** (é uma mudança consciente de pin). Sem isso, o
  `adr-check` pode falhar / a mudança é indevida.
- **Passos:**
  1. `pnpm up drizzle-orm@latest drizzle-kit@latest` (bump **coordenado** — os dois têm de casar).
  2. Rodar `pnpm typecheck` (a API de tipos do drizzle muda entre majors — corrigir usos quebrados,
     ex. mudanças em `.$type`, `sql`, tipos de `where`).
  3. `pnpm test` + `pnpm build`.
  4. **Migração:** rodar `pnpm db:generate` num branch descartável e conferir que o formato de
     snapshot/journal (`version`) **não** mudou de forma incompatível; se mudou, seguir o guia de
     upgrade do drizzle-kit (pode exigir `drizzle-kit up`). **Não** regenerar snapshots das migrações
     históricas sem necessidade.
  5. Remover `GHSA-gpj5-g38j-94v9` de `pnpm.auditConfig.ignoreGhsas` e confirmar
     `pnpm audit --prod --audit-level high` = exit 0.
  6. **Emendar ADR-006** documentando o novo pin + razão.
- **Verificação:** todos os gates verdes + `db:generate` não produz diff inesperado.
- **Rollback:** `git checkout package.json pnpm-lock.yaml` + `pnpm install`.
- **Aceite:** deps de prod sem HIGH; suíte verde; ADR-006 atualizado.
- **Risco:** major bump de ORM pode ter mudanças de comportamento não cobertas por unit test — faça
  QA manual dos fluxos de query mais críticos (pacientes, caixa, agenda, prontuário) em dev.

---

## 3. Item ① — Mover extensões de `public` para schema dedicado (V15 resto)

- **Achado (auditoria V15 / advisor `extension_in_public`):** `btree_gist` e `pg_trgm` estão no schema
  `public`. Recomendação Supabase: schema dedicado `extensions`. É **WARN, não vazamento** → baixo
  valor, risco não-trivial.
- **Dependentes EXATOS (verificados no dev 2026-07-14 — re-verifique antes de mexer):**
  - `btree_gist` → constraints de exclusão:
    - `appointments.appointments_no_overlap`: `EXCLUDE USING gist (doctor_id WITH =,
      appt_tstzrange(scheduled_at, duration_min) WITH &&) WHERE (slot_blocks_overlap)`
    - `doctor_availability.doctor_availability_no_overlap`: `EXCLUDE USING gist (doctor_id WITH =,
      weekday WITH =, tsrange(...) WITH &&)`
  - `pg_trgm` → índice `patients.patients_nome_trgm_idx`.
- **⚠️ Gotcha crítico:** a função `public.appt_tstzrange(timestamptz, integer)` recebeu
  `SET search_path = public, pg_temp` na migração 0038. Se as extensões forem para o schema
  `extensions`, **confirme** que a resolução dos operadores gist (`WITH =`, `WITH &&`) das constraints
  continua funcionando — o `search_path` das sessões que validam a constraint precisa incluir
  `extensions`, OU o opclass deve resolver por dependência. `ALTER EXTENSION ... SET SCHEMA` reescreve
  as dependências automaticamente, mas **teste inserção real** (ver verificação).
- **Passos (no DEV primeiro, via MCP `apply_migration` ou migração 0039):**
  1. `CREATE SCHEMA IF NOT EXISTS extensions;`
  2. `GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;`
  3. `ALTER EXTENSION btree_gist SET SCHEMA extensions;`
  4. `ALTER EXTENSION pg_trgm SET SCHEMA extensions;`
  5. Ajustar `search_path` para incluir `extensions` onde necessário (avaliar Supabase role default
     `search_path` e as funções tocadas; possivelmente
     `ALTER DATABASE postgres SET search_path = "$user", public, extensions;` — confirmar impacto).
- **Verificação (no DEV):**
  - `get_advisors(security)` não lista mais `extension_in_public`.
  - As 2 constraints de exclusão continuam válidas: tente **inserir 2 agendamentos sobrepostos** para
    o mesmo doctor → o 2º deve **falhar** (constraint ainda ativa).
  - Busca por nome de paciente (que usa `patients_nome_trgm_idx`) continua retornando resultados.
  - App sobe e agenda/pacientes funcionam.
- **Rollback:** `ALTER EXTENSION btree_gist SET SCHEMA public;` idem `pg_trgm;` (e reverter search_path).
- **Aceite:** advisor limpo + constraints e índice trigram funcionando em dev; depois repetir em prod
  em janela.
- **Risco:** se um objeto dependente não migrar corretamente, a exclusão de agenda ou a busca quebram.
  Por isso: **dev + teste de inserção sobreposta antes de prod.**

---

## 4. Item ④ — Cutover do pool runtime para role SEM BYPASSRLS (V1.3, fail-closed)

- **Achado (auditoria V1):** hoje o pool `db` conecta como role **BYPASSRLS**; esquecer `withTenant`
  **vaza** cross-tenant em vez de falhar fechado. O fix estrutural é o pool runtime conectar como um
  role **sem BYPASSRLS**.
- **Estado atual (plumbing JÁ pronto):** [src/lib/db/index.ts](../../src/lib/db/index.ts) já usa
  `env.DATABASE_URL_RUNTIME ?? env.DATABASE_URL` para o `runtimeClient`; `dbAdmin`/`dbWorker` seguem no
  `DATABASE_URL`. `DATABASE_URL_RUNTIME` está no schema de env (opt-in, hoje ausente → comportamento
  inalterado). **Falta:** criar o role + preencher `DATABASE_URL_RUNTIME` + provar fail-closed.
- **⚠️ Por que é perigoso:** role mal-configurado = **outage total do acesso tenant**. A validação
  exige a **app rodando** para provar que tudo funciona E que o vazamento fecha. Faça em dev primeiro.
- **Passos (DEV):**
  1. Criar role de login SEM BYPASSRLS, com membership em `authenticated` (necessário p/ o
     `SET LOCAL ROLE authenticated` do `withTenant`):
     ```sql
     CREATE ROLE qoro_runtime LOGIN PASSWORD '<escolha-um-secret-forte>' NOBYPASSRLS;
     GRANT authenticated TO qoro_runtime;
     -- NÃO conceder BYPASSRLS. NÃO conceder privilégios diretos amplos nas tabelas tenant:
     -- o acesso legítimo acontece via SET ROLE authenticated dentro de withTenant.
     ```
     (Password vive só no secret manager / env — **nunca** no git/migração.)
  2. Descobrir o host do pooler (Transaction Pooler, porta 6543) — mesmo host do `DATABASE_URL` atual.
     Montar `DATABASE_URL_RUNTIME` autenticando como `qoro_runtime` (formato Supabase Supavisor:
     usuário `qoro_runtime.<project_ref>`), ex.:
     `postgres://qoro_runtime.pqhkirrszzpwezdaqrai:<secret>@<pooler-host>:6543/postgres?sslmode=require`
  3. Setar `DATABASE_URL_RUNTIME` no `.env.local` do dev e **reiniciar** o `pnpm dev` (o pool é
     cacheado em globalThis — mudança de URL exige restart).
- **Verificação (DEV, com app rodando):**
  1. **Funcional:** logar, abrir pacientes/agenda/caixa/prontuário → tudo funciona (o `withTenant`
     faz `SET LOCAL ROLE authenticated` a partir de `qoro_runtime`, RLS aplica).
  2. **Prova de fail-closed:** rode uma query tenant **SEM** `withTenant` a partir do pool `db` (ex.
     um script temporário que faça `db.select().from(patients)`); deve retornar **0 linhas** (RLS
     nega para role sem BYPASSRLS), **não** vazar. Compare com o comportamento antigo (que vazaria).
  3. `withTenant(clinicA)` só vê dados da clínica A.
- **Rollback:** remover `DATABASE_URL_RUNTIME` (volta ao `DATABASE_URL`/BYPASSRLS) + restart. Reverte
  instantâneo.
- **Prod:** só após dev comprovado; criar o role no prod, setar `DATABASE_URL_RUNTIME` no Vercel, em
  janela, com monitor de erro de conexão pronto.
- **Aceite:** app 100% funcional com o role restrito + prova de fail-closed (query crua = 0 linhas).
  Atualiza a Correction F-01 do ADR-007 ("Residual/deferred C16" → resolvido).

---

## 5. Item ② — Breaker/quota de IA distribuído (Redis) + auth-epoch (V5 resto)

### 5a. Circuit-breaker + quota de custo de IA em Redis
- **Achado (auditoria V5):** o circuit-breaker
  ([src/lib/ai/circuit-breaker.ts](../../src/lib/ai/circuit-breaker.ts)) e a quota de custo
  ([src/contexts/ai-agent/internal/quota.ts](../../src/contexts/ai-agent/internal/quota.ts)) são
  **estado em memória por instância** → sob fan-out serverless, o teto real é N×.
- **Estado atual / decisão MVP:** a docstring do `circuit-breaker.ts` e o **ADR-022** documentam isso
  como **tradeoff MVP consciente** ("Redis-based quando escalar"; o worker do outbox roda 1 instância).
  **Ganho hoje é baixo, risco não-trivial** (latência + modo de falha novo no hot-path do agente).
- **Passos:** reescrever `AICircuitBreaker` e o acumulador de quota para estado no **Upstash Redis**
  (cliente lazy como em `rate-limit.ts`): contadores atômicos (INCR/EXPIRE), e para o half-open uma
  operação **CAS** (SET NX) para admitir uma única sonda distribuída. **Fail-open** se o Redis cair
  (não derrubar o agente) + métrica `ai.breaker.degraded`.
- **Verificação:** testes de concorrência (2 "instâncias" lógicas compartilhando o Redis abrem/fecham
  coerentemente) + exercitar o agente de IA end-to-end em staging (não só unit). Emitir métrica quando
  abrir/quota estourar.
- **Aceite:** breaker/quota coerentes entre instâncias; fail-open verificado; agente funciona.
- **Risco:** Redis no caminho de cada turno do agente — medir latência; garantir timeout curto + fallback.

### 5b. Auth-epoch global (revogação imediata)
- **Achado (auditoria V5):** replay de access-token ≤15 min pós-logout/revogação + drift de
  `role_permissions` global que não dispara heal automático.
- **Escopo:** mudança **arquitetural** (não é patch). Introduz um "epoch" global (ou por-tenant) nas
  claims; o middleware/`tenant-context` invalidam tokens com epoch antigo. Toca o
  `custom_access_token_hook` (migração 0003), o [middleware.ts](../../src/middleware.ts) e
  [tenant-context.ts](../../src/lib/auth/tenant-context.ts). Ver **ADR-009** (claims drift).
- **Passos (alto nível):** adicionar `auth_epoch` no profile/claims; bump em eventos de revogação
  global; comparar epoch do JWT vs DB no heal (como já se faz com `claims_version`); documentar em ADR.
- **Verificação:** revogar → token velho é rejeitado no próximo request (não espera 15 min).
- **Risco:** mexe no coração da auth; PR dedicado com testes de auth (login, logout, drift, revogação).

---

## 6. Item ⑥ — CSP bloqueante com nonce (V6)

- **Achado (auditoria V6 / ADR-030):** CSP hoje é `Content-Security-Policy-Report-Only` com
  `script-src 'unsafe-inline' 'unsafe-eval'` — XSS é reportado, não bloqueado. E **não há report-sink**
  (só console do browser), então "observar antes de bloquear" não coleta dado agregado.
- **Estado atual:** header estático em [next.config.ts](../../next.config.ts) (função `headers()`,
  ~linha 49). Existe **1 script inline** que PRECISA de nonce quando enforce:
  [src/app/layout.tsx:35,45](../../src/app/layout.tsx#L35) — `THEME_INIT` (anti-flash de tema, chave
  `clinicaos-theme`), injetado via `dangerouslySetInnerHTML`. Sentry usa tunnel same-origin
  (`/monitoring`). O app usa `style={{...}}` do React em massa → **manter** `style-src 'unsafe-inline'`.
- **⚠️ Por que precisa de browser:** a corretude (nonce nos scripts do Next + no `THEME_INIT` + Sentry,
  sem bloquear inline legítimo) **só se verifica abrindo o app e olhando o console** por violações.
  Flip cego quebra o frontend clínico.
- **Passos (staged):**
  1. **Report-sink:** wire `report-to`/`report-uri` para o endpoint de CSP do Sentry (coletar
     violações reais).
  2. **Nonce:** mover o header CSP do `next.config.ts` para o **middleware** (per-request), gerando um
     nonce (`crypto.randomUUID()`/base64) e setando no header. No App Router, o Next lê o nonce do
     header CSP e o injeta nos próprios `<script>`. Passar o nonce para o `THEME_INIT`
     (`<script nonce={nonce} ...>`). Política:
     `script-src 'self' 'nonce-<x>' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; object-src
     'none'; base-uri 'self'; frame-ancestors 'none'` (+ img/connect/font como hoje).
  3. Rodar em **Report-Only-com-nonce**, abrir o app no browser, corrigir toda violação (tema, Sentry,
     hydration do Next), e **só então** flipar para `Content-Security-Policy` (enforce), idealmente
     atrás de um flag de env para rollback rápido.
- **Verificação:** console do browser **sem** violações de CSP em todas as telas principais + login +
  MFA + PDFs; tema não pisca; Sentry reporta.
- **Rollback:** flag de env volta para Report-Only (ou reverter o header).
- **Aceite:** CSP enforce sem `unsafe-inline`/`unsafe-eval` em `script-src`, com nonce, sem violação.

---

## 7. Item ⑤ — Cifra de conteúdo clínico (V2) — o maior

- **Achado (auditoria V2 / banco A1):** a PII cadastral é cifrada, mas o **conteúdo clínico** (o dado
  mais sensível) está **em texto claro**. Vazamento de backup expõe o prontuário inteiro.
- **Campos a cifrar (verificados em [clinical/schema.ts](../../src/contexts/clinical/schema.ts) +
  [patient/schema.ts](../../src/contexts/patient/schema.ts)):**
  - `prontuarios.content` (jsonb) e `prontuario_versions.content` (jsonb)
  - `prescriptions.medicamentos` (jsonb) + `prescriptions.observacoes` (text)
  - `prescription_templates.medicamentos` (jsonb) + `.observacoes` (text)
  - `medical_documents.content` (jsonb)
  - `patient_clinical_data.{alergias, medicamentosEmUso, doencasCronicas, ...}` (jsonb)
- **⚠️ Por que é feature dedicada, não patch:** um bug torna **prontuários existentes ilegíveis**
  (risco a paciente/LGPD). Toca todo o read/write clínico + exige **migração de re-cifra dos dados
  existentes**. Não fazer em sessão de patch.
- **Estratégia (retrocompat obrigatória):**
  1. **Colunas:** cifra é `text` (o envelope é base64). Para colunas `jsonb`, ou (a) adicionar colunas
     `*_encrypted text` e migrar, ou (b) trocar o tipo para `text` guardando o JSON cifrado. Preferir
     (a) para migração incremental segura. Índices de busca continuam via `hashForLookup`.
  2. **Escrita:** `encryptForTenant(clinicId, JSON.stringify(value))` nos pontos de INSERT/UPDATE
     clínicos ([clinical/actions.ts](../../src/contexts/clinical/actions.ts),
     `clinical/actions-templates.ts`, e `patient_clinical_data`).
  3. **Leitura (ponto único):** `decryptForTenant` **tolerante a texto claro** — se o valor não for um
     envelope válido (linhas ainda-não-migradas), retornar o texto como está. O byte de versão do
     envelope permite distinguir. Isso torna o deploy **incremental** (código novo lê dado velho).
  4. **Migração de re-cifra:** script/migração por tenant (`withTenant`) que lê cada linha, cifra e
     regrava. Rodar no dev, validar, depois prod em janela. Só **depois** de tudo migrado, tornar a
     cifra obrigatória (remover o fallback de texto claro).
  5. **Leituras que INSPECIONAM o conteúdo** (precisam decifrar antes):
     - `isContentEmpty(row.content)` em `signProntuario`
       ([clinical/actions.ts](../../src/contexts/clinical/actions.ts)) — hoje inspeciona o jsonb.
     - Render `@react-pdf` (receituário/documentos) — lê `medicamentos`/`content`.
     - Export LGPD ([patient/internal/export](../../src/contexts/patient/internal/)).
     - Agente de IA (se lê conteúdo clínico).
     Inventarie **todos** com grep por `.content`/`.medicamentos` nos contexts antes de mexer.
- **Verificação:** unit + e2e clínico (criar/editar/assinar prontuário, gerar PDF, export); validar a
  migração de re-cifra no dev (dado antigo continua legível durante e depois); confirmar que um dump
  do banco mostra ciphertext, não texto claro.
- **Rollback:** enquanto o fallback de texto-claro existir, reverter o código é seguro (dado cifrado
  fica ilegível pelo código antigo — então **não** reverter DEPOIS de tornar obrigatório sem plano).
- **Aceite:** conteúdo clínico cifrado em repouso; leitura decifra em ponto único; migração completa
  validada; PDFs/telas/export funcionam. Cruza com `auditoria-banco-dados.md` A1.
- **Risco:** o maior de todos. PR próprio, revisão cuidadosa, teste exaustivo, backup antes da migração.

---

## 8. Residual — propagar 0038 pelo journal do drizzle
A migração `0038_security_definer_hardening.sql` já está no repo + `_journal.json`, e o DDL já foi
aplicado ao dev e prod via MCP (idempotente). Para o `drizzle.__drizzle_migrations` registrar:
rodar `pnpm db:migrate:dev` / `db:migrate:prod` num deploy consciente (aplica também a **0037**
pendente — schema real). O 0038 será **no-op idempotente**. Não é urgente (segurança já está aplicada),
mas fecha a consistência repo↔journal.

---

## 9. Checklist final de conclusão da Trilha B
- [ ] ③ drizzle atualizado + ADR-006 emendado + ignore do GHSA removido + gates verdes
- [ ] ① extensões em `extensions` (dev→prod) + constraints/trigram verificados
- [ ] ④ role sem BYPASSRLS + `DATABASE_URL_RUNTIME` + prova de fail-closed (dev→prod)
- [ ] ② breaker/quota IA em Redis + auth-epoch (PRs dedicados, testados em staging)
- [ ] ⑥ CSP enforce com nonce (report-sink → report-only-nonce → enforce, verificado em browser)
- [ ] ⑤ conteúdo clínico cifrado + migração de re-cifra validada
- [ ] 0037/0038 propagadas via `db:migrate:*`
- [ ] Atualizar `auditoria-seguranca-codigo.md` (Histórico) + memória a cada item concluído
