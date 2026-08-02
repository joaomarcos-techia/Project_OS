# Auditoria Arquitetural — Acesso ao Banco, Repositórios e Fluxo de Requisições

> Escopo: **arquitetura de acesso a dados**, eficiência de consultas, fluxo de dados,
> escalabilidade, consumo de banco, latência e round-trips. Fora de escopo por decisão
> do briefing: estilo, lint, formatação, nomenclatura, testes, documentação.
>
> Data: 2026-07-26 · Branch: `preview/teste-nova-feature` · Stack: Next.js App Router
> (RSC) + Drizzle + postgres-js + Supabase (Supavisor **Transaction Pooler**, :6543).

---

## 0. TL;DR para quem tem 2 minutos

A base é **madura em segurança e em escrita**. O caminho de **mutação** (`idempotentMutation`)
é exemplar: idempotência + regra de negócio + auditoria + evento, tudo em **uma** transação.
A autenticação é memoizada por request (`React.cache`) e server-authoritative.

O problema **não é o SQL individual** — é o **modelo de acesso na leitura**. Existe **um
antipadrão estrutural único que gera quase todos os sintomas de custo/latência/escala** que
vocês já vêm apagando com aumento de pool e deadlines:

> **"Uma transação `withTenant` por leitura, encadeadas sequencialmente na página."**

Cada helper de leitura (`getClinicTimezone`, `listAppointments`, `getCashFlowToday`, …) abre
sua **própria** transação. Cada transação no Transaction Pooler custa `BEGIN → SET LOCAL ROLE
→ set_config → SELECT → COMMIT` (≈4–5 round-trips). As páginas chamam esses helpers **em
sequência** com `await`. O resultado: uma tela como o **Dashboard** dispara **~12 transações
= ~50 round-trips sequenciais** contra um pooler possivelmente cross-region — exatamente a
latência de "12–27s" que o comentário do `tenant-context.ts` já documenta, e a "starvation"
que os commits recentes (`pool 2→6/8`) atacaram pelo lado errado (dimensionando o pool em vez
de reduzir a demanda).

Somado a isso: **zero cache cross-request** (`unstable_cache` não existe no código). Dados
quase-imutáveis (timezone da clínica, procedimentos, formas de pagamento, `role_permissions`,
limites de plano) são relidos do banco **em todo request**.

Corrigir esses **dois** itens (transação-por-request + cache de referência) reduz round-trips
das telas quentes em **60–85%** sem tocar em nenhuma policy de RLS nem no modelo de segurança.

---

## 1. Visão geral da arquitetura atual

### 1.1 Camadas (o fluxo canônico)

```
Request (RSC page / Server Action / Route Handler)
   │
   ▼
Auth/Tenant gate  ── src/lib/auth/tenant-context.ts
   │  requireUser / requireClinicId / requireCachedPermission / requireFreshPermission
   │  (authenticate() memoizado por request — React.cache)
   ▼
Camada de leitura   ──  src/contexts/<ctx>/queries.ts        (READ)
Camada de escrita   ──  src/contexts/<ctx>/actions.ts        (WRITE via idempotentMutation)
   │
   ▼
withTenant(clinicId, tx => …)  ── src/lib/db/tenant.ts
   │  BEGIN · SET LOCAL ROLE authenticated · set_config('app.current_clinic') · fn(tx) · COMMIT
   ▼
Drizzle (postgres-js)  ── src/lib/db/index.ts   (3 pools: db / dbAdmin / dbWorker)
   │
   ▼
Supabase Supavisor Transaction Pooler (:6543)  →  Postgres (RLS FORCE + role authenticated)
   │
   ▼
Serialização RSC → cliente
```

### 1.2 Pontos fortes (para não mexer no que está certo)

- **Escrita consolidada**: `idempotentMutation` ([mutation.ts:152](src/lib/idempotency/mutation.ts))
  faz idempotência + gate de billing + regra + auditoria + evento **numa transação só**. Modelo correto.
- **Auth memoizada**: `authenticate()` é `React.cache` ([tenant-context.ts:189](src/lib/auth/tenant-context.ts)),
  então os N `require*` de um request compartilham **1** leitura de profile. Sem isso seriam 20+ round-trips.
- **Isolamento tenant real**: `SET LOCAL ROLE authenticated` + GUC + RLS FORCE. Segurança sólida.
- **Índices**: cobertura boa nas tabelas quentes (scheduling 38, patient 29, financial 20, clinical 19).

### 1.3 Inconsistência arquitetural de base

Existem **dois** estilos de acesso a dados convivendo:

| Área | Padrão | Onde |
|---|---|---|
| **Tenant** (app) | "context + `queries.ts`", cada função abre `withTenant` | `src/contexts/*/queries.ts` |
| **Platform Admin** | "repository object" sobre `dbAdmin`, agrupado em `Promise.all` | `src/app/(admin)/admin/_lib/repositories/*.repo.ts` |

O lado admin (mais novo, C15) **já** usa o padrão melhor (repos + fan-out paralelo). O lado
tenant nunca foi migrado. Não é só cosmético: os dois lados resolvem o **mesmo** problema
(agrupar leituras) de formas opostas, e só um deles é eficiente.

---

## 2. Mapa dos fluxos de acesso ao banco (custo real por transação)

**Premissa de custo** (a chave de tudo): o pool runtime aponta para o **Transaction Pooler**
(`prepare:false`, :6543). Nesse modo, **cada `withTenant` é uma transação física** cujo custo
mínimo é:

```
BEGIN  +  SET LOCAL ROLE authenticated  +  SELECT set_config('app.current_clinic', …)  +  <query(ies)>  +  COMMIT
└──────────────────────── ~4–5 round-trips, dos quais 3 são "imposto" fixo antes do 1º SELECT ─────────────────────┘
```

O imposto de 3 statements de setup **não escala com o tamanho da query** — é pago inteiro mesmo
para um `SELECT timezone FROM clinics LIMIT 1`. Logo: **o número de `withTenant` por request é a
métrica que importa**, não o número de linhas lidas.

### Contagem de `withTenant` por arquivo de leitura (todos abrem transação própria)

| Contexto | `withTenant` distintos | Arquivo |
|---|---:|---|
| scheduling | 20 | `src/contexts/scheduling/queries.ts` |
| financial | 19 | `src/contexts/financial/queries.ts` |
| patient | 21 | `src/contexts/patient/queries.ts` |
| identity | 4 | `src/contexts/identity/queries.ts` |

Confirmado por amostragem: `getClinicTimezone` ([scheduling/queries.ts:301](src/contexts/scheduling/queries.ts)),
`getProcedure` (:312), `getProfileNames` ([identity/queries.ts:97](src/contexts/identity/queries.ts)) — **cada
um** é `return withTenant(clinicId, tx => tx.select(...))`. Nenhum recebe `tx` de fora.

---

## 3. Número estimado de consultas por funcionalidade crítica

Estimativas em **transações `withTenant`** (T) e **round-trips** (RT ≈ T×4, mais o `getClaims()`
da auth). "Seq" = precisa terminar antes da próxima começar (latência soma); "Par" = `Promise.all`
(latência do maior, mas consome N conexões do pool simultaneamente).

### 3.1 Dashboard tenant — `/dashboard` 🔴 pior caso

Evidência: [dashboard/page.tsx:60-100](src/app/(app)/(shell)/dashboard/page.tsx) + [dashboard/data.ts](src/app/(app)/(shell)/dashboard/data.ts).

| # | Chamada | Tx | Seq/Par |
|---|---|---:|---|
| Shell layout | `getShellIdentity` (withTenant) + `getActiveAnnouncement` (dbAdmin, cache 30s) + `getImpersonationView` + `getCurrentUser` | ~2 | Par |
| `getDashboard` | `getClinicTimezone` + `listAppointments` + `listPatientCards` | 3 | Seq |
| page | `getActivationChecklist` | 1 | Seq |
| page | `getClinicTimezone` **(DUPLICADA — já lida em getDashboard)** | 1 | Seq |
| page | `getCashFlowToday` | 1 | Seq |
| page | `listCashFlowDaily` | 1 | Seq |
| page | `getRecentActivity` | 1 | Seq |
| page | `getProfileNames` | 1 | Seq |
| **Total** | | **~12 T** | **majoritariamente sequencial** |

➡️ **~12 transações · ~48–55 round-trips · quase todos em série.** Com pooler cross-region a
10–25ms/RT isso é **0,5–1,4s só de ida-e-volta**, antes de qualquer trabalho de banco.

### 3.2 Caixa — `/caixa` 🟠

Evidência: [caixa/page.tsx:29-72](src/app/(app)/(shell)/caixa/page.tsx).

`getClinicTimezone` (1, seq) → `Promise.all` de **5** leituras (`getCaixaLancamentos`,
`getCaixaPagaveis`, `listPendenciasAbertas`, `listPaymentMethods`, `listOpenCollectionCases`) →
`listPaymentTransactionsForLancamentos` (1, seq) → `listPatientCards` (1, seq). **~8 T**, sendo
**5 transações concorrentes** — a razão real do pool ter ido para `max:6`. O fan-out não é de
queries dentro de 1 conexão; é de **5 conexões** cada uma pagando o imposto de setup.

### 3.3 Financeiro — `/financeiro` 🟠

[financeiro/page.tsx:88-97](src/app/(app)/(shell)/financeiro/page.tsx): `getClinicTimezone` (seq) +
`Promise.all` de 4 (`getFaturamentoPeriodo` derivado, `listLancamentos`, `listSuppliers`,
`listPaymentMethods`). **~6 T**, 4 concorrentes.

### 3.4 Conversas IA — `/conversas` 🔴 N+1

[ai-agent/queries.ts:121-207](src/contexts/ai-agent/queries.ts): dentro de **1** `withTenant`
(bom) roda `Promise.all([lista+leftJoin, count])`, depois **para cada linha** (até `PAGE_SIZE`)
dispara `patientNome` + `lastMessagePreview` + eventual `decryptForTenant`. Isso é **2N+ queries**
por página de conversas. 20 conversas ⇒ ~42 queries. Estão na mesma conexão (pipeline ajuda), mas
é design N+1 clássico — deveria ser JOIN ou `inArray` em lote.

### 3.5 Equipe — `/equipe` 🟡

[equipe/page.tsx:69-77](src/app/(app)/(shell)/equipe/page.tsx): `listEmployees` → `getPlanLimits`
→ `hasGranularPermissions`, **três `await` em série** (não `Promise.all`). ~3 T sequenciais
evitáveis.

### 3.6 Ações críticas (POST) — `requireFreshPermission`

[tenant-context.ts:453-554](src/lib/auth/tenant-context.ts): até **4 queries sequenciais**
(override deny → override grant → role bundle → catálogo), cada uma um round-trip `dbAdmin`
separado, **antes** da mutação. Todas resolvíveis numa única query.

### 3.7 POST típico (mutação) — ✅ referência do que está certo

[mutation.ts:226-340](src/lib/idempotency/mutation.ts): **1** `withTenant` com set_config(lock) +
`assertClinicCanWriteTx` + INSERT idempotência + `fn` + `logAudit` + UPDATE idempotência. Tudo numa
transação. **Este é o alvo para onde as leituras deveriam convergir.**

---

## 4. Principais gargalos (ranqueados)

Para cada item: **Severidade · Impacto · Evidência · Causa raiz · Solução arquitetural**.

---

### 🔴 A1 — Transação `withTenant` por leitura, encadeadas em série (antipadrão-mãe)

- **Severidade:** Crítica
- **Impacto:** Latência · Rede · Conexões · Custo · Escalabilidade
- **Evidência:** `withTenant` ([tenant.ts:55](src/lib/db/tenant.ts)) sempre abre `db.transaction`.
  Cada helper de leitura o chama isolado (ex.: [scheduling/queries.ts:301](src/contexts/scheduling/queries.ts),
  [financial/queries.ts:52](src/contexts/financial/queries.ts)). Páginas encadeiam:
  [dashboard/page.tsx:72-96](src/app/(app)/(shell)/dashboard/page.tsx) (7 awaits sequenciais),
  [equipe/page.tsx:69-77](src/app/(app)/(shell)/equipe/page.tsx).
- **Causa raiz:** A unidade de composição escolhida foi a **função de query**, e a fronteira
  transacional foi colada **dentro** dela ("cada query se auto-escopa"). Isso viola o próprio
  contrato documentado em [tenant.ts:36](src/lib/db/tenant.ts) — *"Open one at the boundary of a
  use-case. Repositories receive `tx`."* — que **não é seguido** pelos `queries.ts`. Como cada
  função é autossuficiente, a página só consegue compô-las **sequencialmente**, e cada composição
  re-paga o imposto de 3 statements de setup do pooler.
- **Solução arquitetural (não é remendo):**
  1. **Inverter a fronteira transacional.** `withTenant` passa a ser aberto **uma vez por request**
     (num helper tipo `withRequestTenant()` que memoiza a `tx` por request, análogo ao `React.cache`
     da auth). Todas as funções de leitura passam a **receber `tx`** em vez de abrir a própria.
     Isso é literalmente o contrato que o header do `tenant.ts` já promete.
  2. Onde as leituras são independentes, agrupá-las em **`Promise.all` dentro da mesma `tx`** —
     1 conexão, 1 role-switch, N queries pipelined. O Dashboard cai de ~12 transações para **1**.
  3. Efeito colateral: o imposto de setup por request cai de "3 × Nº-de-helpers" para **3 fixos**.
- **Ganho estimado:** −60% a −85% de round-trips nas telas quentes; fim estrutural da starvation
  de pool (torna os bumps `max:6/8` desnecessários, liberando `max_connections`).

---

### 🔴 A2 — Ausência total de cache cross-request de dados de referência

- **Severidade:** Crítica
- **Impacto:** Custo (Supabase) · Latência · Banco (CPU/IO) · Escalabilidade
- **Evidência:** Busca por `unstable_cache` em `src/` → **0 ocorrências**. `React.cache` (dedup
  intra-request) existe em **apenas 2** arquivos ([tenant-context.ts:49](src/lib/auth/tenant-context.ts),
  [identity/internal/practitioner.ts:15](src/contexts/identity/internal/practitioner.ts)). O único
  cache com TTL é o `getActiveAnnouncement` (variável de módulo, 30s — [platform-announcements/index.ts:31](src/lib/platform-announcements/index.ts)).
- **Causa raiz:** O modelo assumiu "banco é fonte de verdade" (P1) e nunca introduziu uma camada
  de leitura cacheável para dados **quase-imutáveis**. Resultado: `timezone` da clínica,
  `procedures`, `payment_methods`, `role_permissions`, limites de plano e `clinic settings` são
  relidos **a cada request**, embora mudem raríssimas vezes.
- **Solução arquitetural:**
  - Introduzir `unstable_cache` (Next Data Cache) com **tag por clínica** para reference data:
    `cacheTag('clinic:'+id)` / `cacheTag('clinic:'+id+':procedures')`. As mutações que alteram
    esses dados chamam `revalidateTag(...)` — invalidez precisa, não TTL cego.
  - Para dados verdadeiramente globais e minúsculos (catálogo de `permissions`, `role_permissions`),
    cache de processo com TTL curto + bump por `claims_version` (que vocês já mantêm).
- **Ganho estimado:** elimina 2–4 transações **por request** nas telas tenant; corta a maior fatia
  de queries repetidas que hoje batem no banco pago.

---

### 🟠 A3 — `getClinicTimezone` duplicado (implementação **e** chamada)

- **Severidade:** Alta
- **Impacto:** Custo · Latência · Manutenção (divergência)
- **Evidência:** **Duas** implementações idênticas — [scheduling/queries.ts:301](src/contexts/scheduling/queries.ts)
  e [financial/queries.ts:52](src/contexts/financial/queries.ts) — ambas
  `SELECT timezone FROM clinics WHERE id=$1`. E o Dashboard chama **as duas vezes** no mesmo render:
  dentro de `getDashboard` ([data.ts:79](src/app/(app)/(shell)/dashboard/data.ts)) e de novo na
  página ([dashboard/page.tsx:75](src/app/(app)/(shell)/dashboard/page.tsx), import da versão
  *financial*). Timezone de clínica é praticamente imutável.
- **Causa raiz:** Falta de um "read model" de clínica compartilhado; cada bounded context
  reimplementou o acesso ao mesmo campo cross-context, atravessando a fronteira de dados de
  `tenancy`.
- **Solução arquitetural:** Um único `getClinicSettings(clinicId)` no contexto **tenancy** (dono da
  tabela `clinics`), **cacheado por tag** (A2), devolvendo `{ timezone, nome, … }`. scheduling e
  financial consomem esse read model. Mata a duplicação de código **e** a query repetida.

---

### 🟠 A4 — N+1 na listagem de Conversas IA

- **Severidade:** Alta
- **Impacto:** Banco (IO) · Latência · Escalabilidade (piora linearmente com page size × tráfego)
- **Evidência:** [ai-agent/queries.ts:169-197](src/contexts/ai-agent/queries.ts) — `rows.map(async r => { patientNome(...); lastMessagePreview(...) })` + `decryptForTenant` por linha.
- **Causa raiz:** Enriquecimento por linha em vez de em lote. Cada campo derivado virou uma
  sub-consulta.
- **Solução arquitetural:** (a) `patientNome` → `LEFT JOIN patients` na query principal (o nome já
  volta na linha). (b) `lastMessagePreview` → `LATERAL` join ou 1 query em lote com
  `inArray(conversationId, ids)` + `DISTINCT ON (conversation_id) … ORDER BY created_at DESC`.
  Passa de 2N+1 para **1–2** queries por página.

---

### 🟠 A5 — `requireFreshPermission`: 4 queries sequenciais por ação crítica

- **Severidade:** Alta
- **Impacto:** Latência (no caminho quente de escrita) · Banco
- **Evidência:** [tenant-context.ts:487-553](src/lib/auth/tenant-context.ts) — override-deny,
  override-grant, role-bundle e catálogo em quatro `await dbAdmin.select()` separados.
- **Causa raiz:** Decisão de permissão modelada como sucessão de checagens imperativas, cada uma
  uma ida ao banco, em vez de uma pergunta única.
- **Solução arquitetural:** Colapsar em **1** query (CTE/`UNION ALL` ou uma função SQL
  `has_permission(user, perm)`) que devolve `{ denied_override, granted_override, has_bundle,
  in_catalog }` numa linha. 4 RT → 1 RT em **todas** as CRITICAL_ACTIONS.

---

### 🟠 A6 — Shell re-lê o profile que a auth já leu (underfetch em `authenticate`)

- **Severidade:** Média-Alta
- **Impacto:** Latência (paga em **toda** navegação de página tenant) · Custo
- **Evidência:** `authenticate()` lê o profile mas **sem** `nome` ([readAuthoritativeProfile,
  tenant-context.ts:163](src/lib/auth/tenant-context.ts)); o shell então abre um `withTenant`
  **novo** só para `SELECT p.nome, c.nome` ([shell-identity.ts:37](src/components/painel/shell-identity.ts)).
- **Causa raiz:** A leitura autoritativa foi minimizada para segurança, mas o shell precisa de 2
  campos extras — e resolveu com uma transação inteira em vez de estender a leitura já feita.
- **Solução arquitetural:** Adicionar `nome` (profile) ao `readAuthoritativeProfile` (memoizado) e
  servir `clinicName` pelo `getClinicSettings` cacheado (A3). Elimina 1 `withTenant` por página.

---

### 🟡 A7 — Overfetch: 80 ocorrências de `SELECT *` (bare `.select()`)

- **Severidade:** Média
- **Impacto:** Rede · Memória (serialização RSC) · Descriptografia desnecessária
- **Evidência:** 80 `.select()` sem projeção em `src/contexts`. Crítico onde a tabela tem colunas
  grandes/encriptadas: `listAppointments` ([scheduling/queries.ts:157](src/contexts/scheduling/queries.ts))
  puxa a linha inteira só para mapear um summary; idem várias em `patient/queries.ts`.
- **Causa raiz:** Conveniência de `.select()` + mapper posterior; a projeção só acontece **depois**
  de o Postgres já ter lido/descriptografado/serializado tudo.
- **Solução arquitetural:** Projeção explícita `select({ … })` nos list/summary; nunca trazer
  colunas encriptadas para telas de listagem. Regra de lint pode barrar `.select()` bare em
  `queries.ts`.

---

### 🟡 A8 — Paginação por OFFSET nas listagens de crescimento ilimitado

- **Severidade:** Média (baixa hoje, alta em 2–3 anos de dados)
- **Impacto:** Escalabilidade · Banco (custo do OFFSET cresce linearmente)
- **Evidência:** `listAppointments` usa `.limit().offset()` ([scheduling/queries.ts:165-169](src/contexts/scheduling/queries.ts));
  conversas IA idem ([ai-agent/queries.ts:153-154](src/contexts/ai-agent/queries.ts)).
- **Causa raiz:** OFFSET é o default fácil do Drizzle; funciona com pouco dado.
- **Solução arquitetural:** Keyset/cursor pagination (`WHERE (scheduled_at, id) > (cursor)`),
  aproveitando os índices compostos já existentes. Estável sob inserção concorrente e O(1) por página.

---

### 🟡 A9 — Admin `getDashboard`: 3 queries sequenciais dentro do repo

- **Severidade:** Média
- **Impacto:** Latência (contribui para o timeout de 8s que vocês já observaram)
- **Evidência:** [metrics.repo.ts:43-62](src/app/(admin)/admin/_lib/repositories/metrics.repo.ts) —
  `mrrRow`, `clinicRow`, `subRow` em três `await` sequenciais.
- **Causa raiz:** Composição sequencial dentro de um método que já poderia paralelizar.
- **Solução arquitetural:** `Promise.all` das 3 (independentes) ou uma query única com agregações
  condicionais. Reduz o caminho crítico do card que mais estoura o deadline.

---

### 🟡 A10 — `withQueryDeadline`/`Fallback` não cancela a query (band-aid de starvation)

- **Severidade:** Média
- **Impacto:** Escalabilidade (não resolve a causa; mascara-a) · Conexões
- **Evidência:** [query-timeout.ts:36-58](src/lib/db/query-timeout.ts) — `Promise.race` com timer.
  A query perdedora **continua executando e segurando a conexão** até terminar; o `race` só para de
  **esperar**. O próprio header admite ser "defesa em profundidade", não conserto.
- **Causa raiz:** Sintoma (loading infinito) foi tratado onde dói, não na origem (A1: demanda de
  conexão inflada por transação-por-leitura).
- **Solução arquitetural:** Manter como safety-net, mas atacar A1. Com 1 transação/request a pressão
  de pool desaparece e o deadline vira exceção rara, não mecanismo de operação normal. (Opcional:
  para cancelamento real, `statement_timeout` por transação — mas o pooler não propaga; ver nota em
  [db/index.ts:84-99](src/lib/db/index.ts).)

---

### 🟢 A11 — Dois padrões de acesso a dados (repo admin vs. queries tenant)

- **Severidade:** Baixa (dívida arquitetural) · **Impacto:** Manutenção · Coesão
- **Evidência:** Admin usa repos + `Promise.all` sobre `dbAdmin`
  ([metrics.repo.ts](src/app/(admin)/admin/_lib/repositories/metrics.repo.ts),
  [page.tsx:29-52](src/app/(admin)/admin/page.tsx)); tenant usa `queries.ts` + `withTenant`
  isolado. O lado novo já é o padrão bom.
- **Causa raiz:** Evolução histórica; o padrão tenant nunca foi refatorado para receber `tx`.
- **Solução arquitetural:** Convergir o tenant para o mesmo formato de "read model / repository que
  recebe `tx`" (cai naturalmente na execução de A1).

---

### 🟢 A12 — Nota de segurança que também é de custo: pool RLS não provisionado

- **Severidade:** Informativa (já mapeada como dívida) · **Impacto:** Segurança · Arquitetura
- **Evidência:** O pool runtime `db` conecta com role **BYPASSRLS**; o isolamento depende 100% do
  `SET LOCAL ROLE` do `withTenant` ([tenant.ts:20-32](src/lib/db/tenant.ts)). O fail-closed real
  (role dedicada via `DATABASE_URL_RUNTIME`) está **codificado mas não provisionado**
  ([db/index.ts:116-130](src/lib/db/index.ts)).
- **Relação com esta auditoria:** ao executar A1 (1 transação/request), o `SET LOCAL ROLE` passa a
  ser feito **uma vez** por request — reduz custo **e** deixa o caminho pronto para trocar a URL da
  role sem refactor. Sinergia direta.

---

## 5. Top 20 oportunidades (ordenadas por Impacto × Esforço)

Legenda: Impacto (I) e Esforço (E) em 1–5. ROI = I/E (maior = melhor).

| # | Oportunidade | Ref | I | E | ROI |
|---|---|---|---:|---:|---:|
| 1 | Cache `unstable_cache` por-tag de `getClinicSettings` (timezone/nome) | A2,A3 | 5 | 1 | 🟢 5.0 |
| 2 | Deduplicar `getClinicTimezone` (2 impls + chamada dupla no dashboard) | A3 | 4 | 1 | 🟢 4.0 |
| 3 | `Promise.all` nas leituras já independentes de cada página (dashboard/equipe/admin.getDashboard) | A1,A9 | 4 | 1 | 🟢 4.0 |
| 4 | Colapsar `requireFreshPermission` em 1 query (CTE/função SQL) | A5 | 4 | 2 | 🟢 2.0 |
| 5 | N+1 de Conversas IA → JOIN + `DISTINCT ON` em lote | A4 | 4 | 2 | 🟢 2.0 |
| 6 | Estender `readAuthoritativeProfile` com `nome`; matar `withTenant` do shell | A6 | 3 | 1 | 🟢 3.0 |
| 7 | Cache por-tag de `role_permissions` + catálogo `permissions` | A2 | 4 | 2 | 🟢 2.0 |
| 8 | Projeção explícita nos `list*` quentes (appointments/patients/lançamentos) | A7 | 3 | 2 | 🟡 1.5 |
| 9 | **`withRequestTenant()`**: 1 transação/request, helpers recebem `tx` | A1 | 5 | 4 | 🟡 1.25 |
| 10 | Cache por-tag de `procedures` e `payment_methods` | A2 | 3 | 2 | 🟡 1.5 |
| 11 | Cache de `getPlanLimits`/`hasGranularPermissions` (billing) por clínica | A2,A12? | 3 | 2 | 🟡 1.5 |
| 12 | Keyset pagination em `listAppointments` | A8 | 3 | 3 | 🟡 1.0 |
| 13 | Keyset pagination em conversas IA | A8 | 2 | 2 | 🟡 1.0 |
| 14 | Read model de clínica em `tenancy` (fim do cross-context em `clinics`) | A3,A11 | 3 | 3 | 🟡 1.0 |
| 15 | Converter tenant `queries.ts` p/ "repos que recebem `tx`" | A11 | 3 | 4 | 🟠 0.75 |
| 16 | Reduzir pools `max` após A9 (devolver `max_connections`) | A1,A10 | 2 | 1 | 🟢 2.0 |
| 17 | Lint: barrar `.select()` bare e `withTenant` dentro de `queries.ts` | A1,A7 | 2 | 2 | 🟡 1.0 |
| 18 | Provisionar role `qoro_runtime` (fail-closed RLS) via `DATABASE_URL_RUNTIME` | A12 | 4 | 3 | 🟡 1.3 |
| 19 | `DISTINCT ON`/materialização de `lastMessagePreview` (view/coluna denormalizada) | A4 | 2 | 3 | 🟠 0.7 |
| 20 | Consolidar `getActivationChecklist` num read model cacheado (muda pouco) | A2 | 2 | 2 | 🟡 1.0 |

> Os itens 1–8 são **quick wins** (E≤2) que sozinhos derrubam a maior parte dos round-trips sem
> tocar na fronteira transacional. O item **9** é a refatoração estrutural que sela o ganho.

---

## 6. Riscos para crescimento

O gargalo dominante é **round-trips sequenciais × conexões por request**, não CPU de query. O
Transaction Pooler (Supavisor) multiplexa, o que **adia** o colapso — mas a **latência sequencial**
por request não melhora com pooler nenhum; ela é intrínseca ao A1.

| Escala (usuários simultâneos / clínicas) | Comportamento previsto |
|---|---|
| **100 usr / 100 clínicas** | OK hoje. Latência de dashboard 0,8–1,5s é "aceitável e feio". Pools `6/8` folgam. |
| **500 usr** | Telas de fan-out (caixa/financeiro) começam a competir por conexão em picos; `query.timeout` (fallback) aparece esporádico. Custo Supabase sobe **linear** com requests por falta de cache (A2). |
| **1.000 usr** | Cada dashboard = ~12 transações; com 1k requests concorrentes o Supavisor enfileira backends. Sintoma: latência p95 dispara, `admin.dash.timeout`/`query.timeout` viram rotina. **A2 vira urgente** (banco pagando leitura repetida de dado imutável). |
| **5.000 usr** | Sem A1+A2: starvation estrutural. Aumentar `max` **piora** (`max_connections=60` no Postgres é o teto real atrás do pooler). N+1 de conversas (A4) e OFFSET (A8) passam a dominar IO. Provável necessidade de read replica só para adiar o inevitável. |
| **10.000 usr** | Inviável no modelo atual sem A1+A2. O imposto de setup (3 statements × 12 helpers × 10k req) sozinho satura o pooler. Com A1+A2 executados, o mesmo hardware atende a carga porque round-trips/req caem ~70% e a maioria das leituras de referência nem chega ao banco. |
| **1.000 clínicas** | Cache por-**tag** (A2) escala bem (invalidez isolada por clínica). Sem tags, um cache global TTL causaria thundering herd; com tags, não. |

**Conclusão de escala:** a plataforma **não** está pronta para 5k–10k no modelo de leitura atual,
mas as duas mudanças de maior ROI (A1, A2) mudam o patamar sem reescrever domínio nem RLS.

---

## 7. Plano de evolução arquitetural em fases

Priorizado por **retorno alto / risco baixo** primeiro. Cada fase é entregável e reversível.

### Fase 0 — Instrumentação (pré-requisito, ~0,5 dia)
- Emitir contador de **transações `withTenant` por request** e round-trips por rota (vocês já têm
  `metrics.emit`). Sem baseline, nenhum ganho é comprovável — e o próprio comentário do
  `db/index.ts` prega "tune com dado, não especulação".

### Fase 1 — Quick wins sem mexer na fronteira transacional (risco baixíssimo, ~2–4 dias)
Itens **1, 2, 3, 6, 9(admin), 16** do Top 20.
- `getClinicSettings` cacheado + dedupe de timezone.
- `Promise.all` nas leituras independentes já existentes (dashboard, equipe, admin.getDashboard).
- `nome` no `readAuthoritativeProfile` → shell perde 1 transação.
- **Meta:** dashboard de ~12 → ~5 transações; caixa/financeiro sem regressão. Nenhuma policy tocada.

### Fase 2 — Cache de referência por-tag (risco baixo, ~3–5 dias)
Itens **7, 10, 11, 20**.
- `unstable_cache` + `revalidateTag` para `role_permissions`, `permissions`, `procedures`,
  `payment_methods`, plano/limites. Mutações correspondentes chamam `revalidateTag`.
- **Meta:** −2 a −4 transações/request nas telas tenant; queda mensurável de queries pagas no Supabase.

### Fase 3 — Consultas caras pontuais (risco médio, ~3–5 dias)
Itens **4, 5, 8**.
- `requireFreshPermission` → 1 query.
- N+1 de conversas → JOIN/lote.
- Keyset pagination em appointments e conversas.

### Fase 4 — Refatoração estrutural da fronteira (risco médio, maior esforço, ~1–2 semanas)
Itens **9, 15, 14, 17**.
- Introduzir `withRequestTenant()` (memoiza `tx` por request) e migrar `queries.ts` para
  **receber `tx`** — cumprindo o contrato que o `tenant.ts` já documenta.
- Converter tenant para o mesmo formato de repositório do admin (coesão).
- Lint barrando `withTenant`/`.select()` bare dentro de `queries.ts` para impedir regressão.
- **Meta:** 1 transação/request na maioria das telas; imposto de setup fixo em 3 statements.

### Fase 5 — Segurança + devolução de recursos (risco controlado, ~2–3 dias)
Itens **18, 16**.
- Provisionar a role `qoro_runtime` (fail-closed RLS) — com A1 feito, o `SET LOCAL ROLE` é 1×/request.
- Reduzir pools `max` de volta a valores conservadores (a pressão que motivou `6/8` desaparece),
  devolvendo `max_connections` ao Postgres.

---

### Encerramento

Nada aqui é micro-otimização: são **duas decisões de arquitetura de acesso** (onde abrir a
transação; o que vale cachear) que explicam praticamente todo o custo, latência e risco de escala
observados — inclusive os sintomas que os últimos commits já tentavam conter (pool sizing,
deadlines). O domínio, a segurança e a escrita **não precisam mudar**. O caminho de leitura, sim.

*Fim do relatório.*
