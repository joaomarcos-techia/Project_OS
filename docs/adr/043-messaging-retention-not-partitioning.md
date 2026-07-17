# ADR-043 — Retenção (não particionamento) contém a mensageria raw

**Status:** accepted
**Date:** 2026-07-17
**Camada:** C10/C11 (messaging) + C16 (retenção)
**Contraria:** a recomendação literal do achado **A2** da auditoria de banco — com motivo medido
**Fecha:** A2, A5, A7 + achado novo N2

## Context

A auditoria de banco elegeu o **A2** como o maior risco de escala:

> "**[ALTA] Tabelas raw de mensageria crescem sem teto** — não particionadas e fora do
> cron de retenção. (…) **Correção recomendada:** particionar por mês (mesmo padrão de
> 0009/0024) **antes** do volume crescer, e adicionar retenção."

`inbound_messages_raw`, `outbound_messages` e `provider_status_events_raw` têm a maior
taxa de inserção do sistema (uma linha por mensagem + uma por callback) e, de fato,
cresciam para sempre. O diagnóstico está certo. **A correção proposta, não.**

### Por que particionar quebra o produto aqui

Em range partitioning, o Postgres exige que **toda constraint UNIQUE contenha a
partition key**. As três UNIQUE dessas tabelas existem para garantir *exactly-once* e são
**deliberadamente independentes de tempo**:

| Tabela | UNIQUE | O que acontece ao incluir a partition key |
|---|---|---|
| `outbound_messages` | `(clinic_id, idempotency_key)` | **Quebra a idempotência do envio.** `sender.ts` reserva a linha com `onConflictDoNothing` — é isso que impede envio duplicado. Com `created_at` na chave, dois retries em instantes diferentes **ambos inserem** → **o paciente recebe a mesma mensagem do WhatsApp duas vezes**. |
| `provider_status_events_raw` | `(provider, payload_hash)` | **Mata o dedup.** `received_at` é `now()` no insert; a Meta reenviando o mesmo callback gera outro `now()` → outra chave → duplicata. |
| `inbound_messages_raw` | `(provider, provider_message_id)` | Sobreviveria — `received_at` vem do timestamp da Meta (`inbound.ts:63`), estável entre reentregas. Mas o fallback `now()` (timestamp ilegível) abre um furo silencioso. |

O `ai_messages` conseguiu ser particionado porque **abriu mão do UNIQUE**: o comentário da
0024 diz explicitamente *"UNIQUE adicional não é possível sem a partition key"* e o dedup
virou SELECT-before-INSERT, coberto pelo single-execution do worker. A mensageria **não
tem esse luxo**: `sender.ts` depende da UNIQUE para não mandar mensagem duplicada.

### A causa-raiz do A2 não é "falta de partição"

É **crescimento sem teto**. Partição é *um mecanismo* de contenção, não o objetivo. A
retenção em lote — o padrão que o próprio projeto já provou em `outbox`,
`login_attempts` e `idempotency_keys`, e que a auditoria elogia (§4: *"exatamente o
padrão a replicar para a mensageria raw"*) — resolve a causa mantendo a tabela em estado
estacionário, com **zero risco semântico**.

Com 90d de janela, mesmo o cenário do briefing (1.000 clínicas ativas) estaciona na casa
dos milhões de linhas — território confortável para o Postgres com os índices que já
existem. O ganho marginal da partição (DROP em vez de DELETE, índice menor, vacuum mais
barato) não paga o risco de mandar mensagem duplicada para paciente.

## Decision

### 1. As 3 raw entram na retenção; **não** são particionadas

`inbound_messages_raw` 90d · `provider_status_events_raw` 90d · `outbound_messages` **180d**.

O outbound retém o dobro porque é a **prova de que a clínica enviou** — em disputa de
entrega, 90d é curto. As janelas viram uma linha em `RETENTION_POLICIES`.

### 2. Registro declarativo único: `src/lib/db/retention-policy.ts`

A política existia só em **comentário de schema**: `ai_conversations.expires_at` dizia
"purge por retention job (C16)" e **nada purgava** (A5). Em paralelo, a lista de pais
particionados vivia **duplicada** entre o cron e o painel admin. Duas fontes de verdade e
nenhum enforcement geram a mesma classe de bug: a intenção documentada diverge do banco e
não há lugar onde as duas se encontrem.

Agora `RETENTION_POLICIES` + `PARTITIONED_PARENTS` são consumidos pelo cron
`data-retention`, pelo cron `audit-partitions`, pelo painel admin e pelos testes. Mudar
uma janela é uma linha; acrescentar tabela é uma linha.

**Ordem importa e está codificada:** `ai_conversations` vem antes de `ai_messages` porque
a FK é CASCADE — apagar a conversa leva as mensagens junto (barato agora que existe o
índice `ai_messages_conversation_id_idx` do ADR-042; sem ele o job seria O(n²)). O purge
de `ai_messages` logo depois cata as vencidas de conversa **ainda ativa**, que o CASCADE
não alcança.

### 3. A7 + N2 — o monitor de partições passa a medir CONTIGUIDADE

`pg_cron`/`pg_partman` **não estão instalados**: o provisionamento é 100% dependente do
cron da Vercel. O modo de falha "cron para em silêncio → tudo cai na `_default`" **já
aconteceu** em dev (9 linhas presas em `audit_events_default` de um mês cuja partição foi
dropada).

A defesa era o painel admin — que dependia de alguém olhar **e estava quebrado**:

> **N2 (novo, nenhuma auditoria viu):** `monthsAhead` era `max(partição) − mês atual`, o
> que é **cego a lacunas**. O dev tem partições até 2027-05, um buraco de 2027-06 a
> 2028-04 e uma solta em 2028-05 → o painel reportava **"22 meses de cobertura,
> saudável"** enquanto o próximo mês sem partição estava a **11**. O alerta que o A7 pede
> (`monthsAhead < 1`) seria enganado **exatamente pelo modo de falha que existe para
> detectar**.

`contiguousMonthsAhead()` conta meses **consecutivos** a partir do mês atual e para na
primeira lacuna. `0` = o mês corrente já não tem partição (as escritas estão caindo na
default **agora**).

### 4. Alerta ativo pelo pipeline existente, não pelo Sentry

Cada run do cron mede `defaultCount` e a cobertura contígua de cada pai e, quando estão
ruins, emite `cron.audit_partitions.degraded` via `metrics.emit` + `logger.error` — o
**mesmo pipeline stdout** do resto (ADR-029 mantém log fora do Sentry; `cron-auth.ts`
registra o mesmo raciocínio: um cron degradado é evento operacional, não exceção).
Introduzir Sentry aqui criaria uma 2ª fonte da verdade.

O alerta é uma saved-search no Better Stack — **atenção: as buscas exigem o prefixo
`message.`**, ex.: `message.event:"cron.audit_partitions.degraded"`. Sem o prefixo a busca
volta vazia e parece que o sinal não existe. Ver `runbooks/audit-retention.md`.

## Consequences

### Positivas
- A causa do A2 (crescimento sem teto) fecha **sem** tocar em dedup ou idempotência.
- A5 deixa de ser ficção: a retenção de 30d da IA passa a ser aplicada de verdade.
- A7 ganha detecção real, e o N2 (que teria neutralizado o alerta) some junto.
- Uma tabela nova que cresce sem teto agora tem um lugar óbvio — e um teste que cobra.

### Negativas / riscos aceitos
- **DELETE gera bloat**; a partição daria `DROP` grátis. Aceito: com janela de 90d e
  insert/delete em equilíbrio, é o padrão de fila que o autovacuum resolve. É o preço de
  manter as garantias de exactly-once.
- `outbound_messages` guarda 180d de `content_encrypted` — mais PII conversacional em
  repouso do que o inbound. Cifrado (ADR-012) e justificado pela prova de envio.

### Gatilho para revisitar
Se `pg_stat_user_tables` mostrar bloat ou tempo de vacuum incômodo nessas tabelas **com
volume real**, o caminho **não** é forçar a partition key nas UNIQUE. É mover o dedup e a
idempotência para uma tabela própria com TTL (o padrão de `idempotency_keys` já existe) e
**só então** particionar. Redesenho deliberado, com o `sender.ts` no escopo — nunca um
efeito colateral de uma migration de performance.

## Evidência (dev, 2026-07-17)
- `contiguousMonthsAhead` com a lacuna REAL do dev → **11**, não os 22 que o cálculo
  antigo reportava (teste unitário fixa o cenário).
- As 9 órfãs de `audit_events_default` remediadas pelo procedimento do runbook (mover →
  criar partição → devolver, atômico): default **9 → 0**, `audit_events_2026_05` recriada
  com as 9, total preservado (123).
- A partição recriada nasceu já com o ACL do ADR-042 (`authenticated=arwdm`, **sem
  `anon`**) — prova de que o `ALTER DEFAULT PRIVILEGES` governa tabela nova.
- Partição lida DIRETO por `authenticated` → **0 linhas** (RLS on + 0 policies =
  deny-all): o `rls_enabled_no_policy` do advisor é fail-closed by design, como a
  auditoria já dizia.
