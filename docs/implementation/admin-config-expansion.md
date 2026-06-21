# Spec de Implementação — Expansão da aba Configurações (Platform Admin)

**Status:** proposta (não implementada) · **Camada:** follow-up de C15 (Platform Admin) ·
**Refs:** ADR-007 (RLS / categorias de tabela §10), ADR-011 (outbox/audit), ADR-016/024/025
(billing/planos), ADR-022/023/026 (AI agent / proactive jobs), `docs/testesC15.md`.

> **Contexto.** Hoje `/admin/config` é **somente leitura** (prompt do sistema + templates Meta).
> O painel inteiro é read-only sobre dados de clínica — a única escrita sancionada vive em
> `actions/impersonation.ts` e no export de auditoria, ambas via `superAdminAction` (auditado)
> e cobertas pelo arch test `admin-read-only.test.ts`. Esta spec adiciona **controles de
> plataforma** (não de clínica) na aba Configurações, mantendo essas invariantes.

> **Princípio que orienta tudo aqui:** o painel não edita dado de clínica. Os módulos abaixo
> escrevem só **estado global da plataforma** (flags/anúncios) — e mesmo isso passa por
> `superAdminAction` + AAL2 + auditoria. Leitura pesada continua isolada em repositórios
> (`_lib/repositories/*`) que tocam `dbAdmin`.

---

## Visão geral dos 5 módulos

| # | Módulo | Tipo | Esforço | Valor |
|---|---|---|---|---|
| 1 | Kill-switches operacionais | **escrita** (flag global) | Médio | **Alto** (resposta a incidente) |
| 2 | Saúde dos jobs internos (crons) | leitura | Médio | Alto (observabilidade) |
| 3 | Status de retenção/partições | leitura | Baixo | Médio (dívida operacional visível) |
| 4 | Broadcast às clínicas | **escrita** (anúncio) | Médio | Médio |
| 5 | Inventário de integrações & segredos | leitura | Baixo | Médio |

Sugestão de ordem: **3 → 5 → 2** (read-only, sem novo modelo de escrita, baixo risco) e depois
**1 → 4** (exigem tabela + superfície de escrita + alguém que *consome* a flag).

---

## Fundações compartilhadas (módulos de escrita 1 e 4)

### Tabela `platform_settings` (global protected — ADR-007 §10 bloco B)

Key-value global, **sem `clinic_id`** (é estado da plataforma, não de tenant). Categoria
"global protected": `ENABLE + FORCE RLS`, **SELECT** liberado a `authenticated` (workers/crons/
agente precisam ler a flag) e **escrita só via `dbAdmin`/service_role** (nunca `withTenant`).
Mesmo padrão semântico de `_reserved_slugs` / `plans`.

```
platform_settings(
  key          text primary key,         -- ex.: 'proactive_jobs.enabled'
  value        jsonb not null,            -- { enabled: bool } | { mode: 'fallback_only' } ...
  updated_by   uuid,                      -- super_admin (sem FK, padrão *_by)
  updated_at   timestamptz not null default now()
)
```

- Migration nova (`00NN_platform_settings.sql`): seguir o **template "global protected"** do
  `CONVENTIONS.md` (bloco B) + GRANT `SELECT` a `authenticated`, sem GRANT de write.
- Leitura quente: cachear em memória por TTL curto (ex.: 30–60s) **dentro de cada worker/cron**
  para não fazer 1 query por mensagem. Helper `getPlatformFlag(key, default)` em
  `src/lib/platform-settings/` (server-only).
- Escrita: Server Action `setPlatformFlagAction` em `admin/actions/platform-settings.ts`
  → `guardAdminAccess()` + `superAdminAction({ action: 'platform_flag_set', payload })` que faz
  o `UPDATE … via dbAdmin`. **Auditado** + AAL2 obrigatório.
- **Arch test:** o novo arquivo de action entra na mesma categoria de
  `actions/impersonation.ts` (escrita de plataforma, não de clínica). Não importa
  `withTenant`/`idempotentMutation`/`auditedMutation` → passa em `admin-read-only.test.ts`.
  O `arch:db-check` precisa allowlistar o `dbAdmin` do novo módulo (igual a `session.ts`).

---

## Módulo 1 — Kill-switches operacionais

**Objetivo:** botões que você quer às 2h da manhã, sem deploy.

### Flags propostas

| Flag (`key`) | Efeito | Quem consome |
|---|---|---|
| `proactive_jobs.enabled` (default `true`) | `false` → crons proativos não enfileiram/enviam | `app/api/cron/proactive-*` |
| `ai_agent.mode` (`normal` \| `fallback_only`) | `fallback_only` → agente responde só o fallback humano (degrada sem chamar o Gemini) | handler `ai-agent/internal/handlers/inbound-received.ts` |
| `platform.maintenance` (default `false`) | `true` → banner global no app tenant (e, opcionalmente, bloqueio de escrita) | shell tenant `(app)/(shell)/layout.tsx` |

### Pontos de integração (onde checar a flag)

- **Proativo:** no topo de cada rota `app/api/cron/proactive-{reminders,dunning,followup}` (ou
  na função `enqueue*Due`): se `proactive_jobs.enabled === false` → retorna `{ skipped: 'disabled' }`
  sem varrer agenda. Custo: 1 leitura cacheada por tick.
- **Agente:** no handler `inbound.received`, **antes** de montar contexto/chamar o Gemini: se
  `ai_agent.mode === 'fallback_only'` → responde o `CLINICAL_FALLBACK`/handoff (reusa o caminho
  de degradação que já existe no circuit breaker) com **custo zero**. É o mesmo efeito do breaker
  aberto, mas manual.
- **Manutenção:** o shell tenant lê a flag (server component) e renderiza um banner. Bloqueio de
  escrita é opcional e mais invasivo — começar **só com banner** (não travar a operação da clínica
  sem necessidade).

### UI (aba Configurações → subtab "Operação")

3 toggles com estado atual + "alterado por / em". Cada toggle = `setPlatformFlagAction`. Mostrar
um aviso de que a ação é auditada (consistente com o resto do painel).

### Segurança / cuidado

- Flag é **global** (afeta todas as clínicas). O log `platform_flag_set` em `super_admin_actions`
  é o rastro. Considerar `requireRecentAal2` (re-MFA) para `maintenance`/`fallback_only`, como no
  impersonate.
- **Fail-safe:** se a leitura da flag falhar, assumir o default **seguro** (jobs ligados, agente
  normal, sem manutenção) — nunca derrubar operação por erro de leitura de config.

---

## Módulo 2 — Saúde dos jobs internos (crons)

**Objetivo:** "o worker do outbox rodou? o dunning rodou hoje?" sem abrir a Vercel.

**Problema:** hoje não há tabela de "última execução". O outbox emite métricas, mas não persiste
heartbeat. Opções:

- **(Recomendado)** Tabela leve `cron_heartbeats(job text primary key, last_run_at timestamptz,
  last_status text, detail jsonb, updated_at)` — global protected. Cada rota de cron faz um
  `UPSERT` no fim do tick (via `dbAdmin`). Leitura trivial na aba.
- **(Sem nova tabela)** Derivar sinais de tabelas existentes: outbox (último `processed`),
  `invoices` (última gerada), `ai_proactive_jobs` (último `scheduled_for`/`status`). Menos preciso,
  zero migration.

**UI:** lista dos jobs do `vercel.json` (outbox 1min, billing-dunning/reconcile, proactive-*,
data-retention) com cor (verde se rodou dentro do SLA esperado, vermelho se atrasou) + último run.

**Repo:** `_lib/repositories/jobs-health.repo.ts` (read-only, `dbAdmin`).

---

## Módulo 3 — Status de retenção/partições

**Objetivo:** tornar visível a dívida operacional manual do C4/C16 antes de virar incidente.

Read-only sobre catálogo do Postgres + counts:

- **Partições de `audit_events` / `ai_messages`:** quantas partições à frente existem e qual a
  data de cobertura (query em `pg_inherits`/`pg_class`). Alertar quando faltam < N meses
  (o cron mensal de criação de partição é manual — runbook `audit-retention`).
- **`idempotency_keys`:** count de `expires_at < now()` (lixo a limpar) — cleanup é manual/cron.
- **`ai_proactive_jobs`:** count por status (trim mensal é débito C16).
- **Partição default de `audit_events`:** count > 0 = alerta (algo caiu no catch-all).

**UI:** cards simples com número + status + link pro runbook correspondente. Nada editável.

**Repo:** `_lib/repositories/retention.repo.ts`.

---

## Módulo 4 — Broadcast às clínicas

**Objetivo:** um aviso global (ex.: "manutenção sábado 22h") exibido no app tenant.

### Tabela `platform_announcements` (global protected)

```
platform_announcements(
  id          uuid pk,
  message     text not null,
  level       text not null default 'info',   -- info | warning
  active      boolean not null default true,
  starts_at   timestamptz,
  ends_at     timestamptz,
  created_by  uuid,
  created_at  timestamptz not null default now()
)
```

- **Leitura (tenant):** shell `(app)/(shell)/layout.tsx` busca o anúncio ativo vigente (1 query
  cacheada) e renderiza um banner. SELECT liberado a `authenticated`.
- **Escrita (admin):** Server Action `publishAnnouncementAction` → `superAdminAction` (auditado).
- **Cuidado de conteúdo:** texto é exibido a usuários de **todas** as clínicas — sanitizar/escapar
  (sem HTML), limite de tamanho, e janela `starts_at/ends_at` para expirar sozinho.
- **LGPD/escopo:** anúncio é operacional da plataforma, não comunicação de marketing — não passa
  por suppression list (é in-app, não WhatsApp).

---

## Módulo 5 — Inventário de integrações & segredos

**Objetivo:** "quais chaves estão configuradas?" sem vazar valor.

Read-only, **presença booleana** (nunca o valor):

- Gemini (`GEMINI_API_KEY`), Meta (`META_*` + templates), Asaas (`ASAAS_API_KEY`),
  `IMPERSONATION_SECRET`, `CRYPTO_MASTER_KEY_V1`, `CRON_SECRET`, Upstash, etc. → "Configurado /
  Pendente" (igual aos templates já exibidos).
- Versão + hash do prompt (já existe).
- Lista dos crons do `vercel.json` (schedule + finalidade) — visão operacional.
- Link pro runbook `secret-rotation` + "última rotação" (se você registrar manualmente numa flag
  `platform_settings`).

**Segurança:** **NUNCA** renderizar valor de segredo — só `Boolean(env.X)`. O componente roda
server-side; o cliente recebe só `{ configured: true|false }`.

---

## Checklist transversal (vale para qualquer módulo novo)

- [ ] Toda página/route/action chama `guardAdminAccess()` (super_admin + AAL2 → senão 404).
- [ ] Escrita só via `superAdminAction` (auditado) — nunca `withTenant`/`idempotentMutation` no painel.
- [ ] Tabela nova = categoria ADR-007 §10 declarada no PR (global protected, bloco B do `CONVENTIONS`).
- [ ] `dbAdmin` de módulo novo entra na allowlist do `arch:db-check`.
- [ ] `admin-read-only.test.ts` continua verde (nenhum import dos funis de mutação tenant).
- [ ] Flags têm **default seguro** em caso de erro de leitura (fail-safe).
- [ ] Migration segue `^\d{4}_[a-z][a-z0-9_]*\.sql$` + RLS na MESMA migration do CREATE TABLE.

## Questões em aberto (decidir antes de implementar)

1. `cron_heartbeats` (tabela nova) **ou** derivar de tabelas existentes? (precisão vs. zero-migration)
2. Manutenção = só banner, ou também bloqueio de escrita tenant? (começar com banner)
3. Re-MFA (`requireRecentAal2`) obrigatório para flags críticas? (recomendado p/ maintenance/fallback)
4. Cache de flags: TTL em memória por instância (simples) vs. invalidação ativa (mais complexo)?
