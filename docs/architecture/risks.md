---
title: "Riscos arquiteturais — Camada -1"
description: "Riscos arquiteturais — Camada -1 — responsabilidades, fontes e limites da implementação."
docType: "reference"
---

## Status

Canonical — riscos levantados na **Camada -1** do [plano qorov2](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/qorov2.md), com evidência no código.

## Source of Truth

Código e artefatos gerados (`arch-metrics.json`, `context-map.mmd`). Cada risco abaixo cita como conferir.

## Severidade

`ALTA` = precisa de decisão antes de escrever código da camada que depende dele.
`MÉDIA` = conhecido, contornável, precisa estar visível durante a execução.
`BAIXA` = registro para não ser redescoberto.

---

## R1 · Feature flag por clínica não existe — `RESOLVIDO (2026-08-19)`

**Evidência:** `src/lib/db/schema/infra/platform-settings.ts` — a tabela `platform_settings` é
**global** ("flags/kill-switches GLOBAIS da plataforma (não-tenant)"), sem `clinic_id`, com allowlist
de duas chaves (`proactive_jobs.enabled`, `ai_agent.mode`). Não há nenhum mecanismo de flag por tenant.

**Consequência (achado original):** o `qorov2.md` §0.7 listava "Feature Flags · por clínica" como
arquitetura protegida **existente**, e o §18 previa rollout `1 → 5 → 25% → 100%`. Nenhum dos dois tinha
suporte. O gating por clínica que existe na prática é **coluna booleana em tabela do próprio domínio**.

**Decisão (2026-08-19):** adotado (a) — o gate por clínica é **coluna booleana no schema do próprio
domínio**, default `false` (`clinic_deposit_policy.enabled`, já previsto no ADR-049). O `qorov2.md` §0.7
passou a descrever os dois mecanismos reais (global via `platform_settings`, por clínica via coluna) e o
§18 virou **ondas nominais por clínica**, sem percentual. Rollback = `enabled = false`, sem deploy.

Flag genérica por tenant fica adiada até existir base de clientes que torne rollout percentual
significativo — e exigirá **ADR próprio** (§0.7).

## R2 · `arch:check` roda praticamente cego — `ALTA`

**Evidência:** `pnpm arch:check` é `madge --circular --extensions ts,tsx src`, **sem `--ts-config`**. O
repo importa tudo por alias (`@/lib/db`), e sem os `paths` do tsconfig o madge não resolve os imports:
o grafo sai com **5 arestas** para 839 módulos (medido). Com `tsConfig`, o mesmo grafo tem **264**
arestas entre elementos.

**Consequência:** o gate de ciclos do §11 hoje é quase vazio — ele não teria como encontrar um ciclo
porque quase não enxerga arestas. O `pnpm arch:graphs` (que passa `tsConfig`) confirma **0 ciclos**
de verdade, então o resultado histórico continua correto — mas por sorte, não por cobertura.

**Decisão pendente:** corrigir o `arch:check` para passar o tsconfig. Fora do escopo da Camada -1
(altera gate existente e pode acender CI). Está no [discovery log](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/discovery-log.md).

## R3 · `financial` ↔ `scheduling` é o único par mútuo entre contexts — `MÉDIA`

**Evidência:** `arch-metrics.json` — `context:financial` depende de `context:scheduling` e vice-versa.
É o **único** par context↔context bidirecional (os outros 14 pares mútuos envolvem `lib:db`/`lib:auth`).

**Consequência:** é exatamente a região que a Camada 1 vai tocar (sinal, falta, restante). Acoplamento
mútuo pré-existente + código novo é o cenário clássico de ciclo acidental. O `--check` do
`arch:graphs` é o alarme.

## R4 · Adapter Asaas é single-account — `RESOLVIDO (sub-fase 1.0)`

**Evidência do achado:** `src/contexts/billing/internal/providers/asaas.ts` lia `env.ASAAS_API_KEY` direto.

**Resolução:** o adapter virou `src/lib/payments/asaas` com `createAsaasClient(credential)`. O client do
Qoro (`asaasProvider`) é um singleton de módulo que lê o env por função — leitura tardia idêntica à de
antes. Cada credencial tem **circuit breaker próprio**: a conta A cair não abre o circuito da conta B.
Efeito colateral bom, visível no `arch-metrics.json`: `context:billing` perdeu as arestas para
`lib:auth` e `lib:env`, e `onboarding` deixou de precisar da exceção `boundaries` para o adapter.

## R5 · Não existe handler de `no_show` — `MÉDIA`

**Evidência:** `src/contexts/financial/internal/handlers/` tem só `appointment-completed.ts`. O evento
`scheduling.appointment.no_show` é publicado e **não tem consumidor**.

**Consequência:** a promessa de "cobrar o no-show" não tem lastro no código. É o gap que a Camada 1
fecha (1.5).

## R6 · 43 dos 57 eventos não têm consumidor — `MÉDIA`

**Evidência:** `event-flow.mmd` (tracejado) e a allowlist `PRODUCER_AHEAD` em
`scripts/check-handler-registry.ts`.

**Consequência:** o worker marca esses eventos como `skipped` — estado terminal **legítimo** para
produtor que chegou antes do consumidor. O risco é o inverso: um evento que **deveria** ter handler
entrar nesse balde e falhar em silêncio. A proteção existe (`pnpm check:registry:strict` falha para
evento fora da allowlist), mas **não está no portão do §0.2**. Ver [discovery log](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/discovery-log.md).

## R7 · Migration `0051` com drift confirmado — `MÉDIA`

**Evidência:** `docs/roadmap/known-limitations.md` e `docs/database/schema.md` — `DRIFT_CONFIRMED`:
o hash aplicado não corresponde ao arquivo. Objetos foram conferidos no banco.

**Consequência:** nunca reescrever a `0051`. Correção, se necessária, é **migration aditiva**.

## R8 · Superfície síncrona real entre contexts são 53 exceções de lint — `MÉDIA`

**Evidência:** 53 `eslint-disable boundaries/element-types` cobrindo 57 imports (46 pelo barrel
público, 10 pelo `schema` do vizinho, 0 para `internal/*`).

**Consequência:** o padrão é disciplinado (justificativa obrigatória, nada de `internal`), mas é a
via por onde o acoplamento cresce sem aparecer em revisão de evento. O context `payments` do ADR-049
vai precisar ler agenda e paciente — deve usar **esta** via, não inventar uma terceira.

## R9 · Código cita 34 ADRs que não estão mais no disco — `MÉDIA`

**Evidência:** comentários em `src/` referenciam **43** ADRs distintos; a pasta `docs/adr/` tem **9**
(mais o README) após a limpeza documental consciente. `ADR-044`, `ADR-016`, `ADR-023`, `ADR-014` e
outros só existem no histórico do git.

**Consequência:** quem ler o comentário não acha o documento. Corrigir 34 referências espalhadas por
`src/` seria mudança grande sem gap associado (§0.5) — vai para o [discovery log](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/discovery-log.md)
com decisão do fundador sobre o destino (reintroduzir os ADRs citados ou limpar as citações).

## R10 · Ferramental de três gates não existe — `MÉDIA`

**Evidência original:** `dependency-cruiser`, `k6`/`autocannon` e `test:simulation` não estavam no
`package.json`. Em 2026-08-27, `test:simulation` foi implementado sem dependência nova e passou a
simulação de 30 dias. Em 2026-08-28, `restore:test` passou contra PostgreSQL local isolado e o alvo foi
removido; o app scratch e o ferramental de carga continuam pendentes. `dependency-cruiser` foi cortado.

**Consequência e encaminhamento (emenda aprovada em 2026-08-19):**

| Gate | Encaminhamento |
| --- | --- |
| §11 Complexidade | `dependency-cruiser` **cortado**; fan-in/out sai do `arch:graphs`. Exigível desde 1.0 |
| §10 Performance/Carga | exigível a partir de **1.4**, com `autocannon`; restore isolado ✅, app scratch + harness ainda pendentes; nunca executar contra Preview, produção ou DEV compartilhado |
| §14 Clinic Simulation | ✅ `pnpm test:simulation`, harness próprio sem dependência nova; 30 dias verdes no **1.H** |

## R11 · O evento é contrato, mas o barrel é que o entrega — `BAIXA`

**Evidência:** `lib/db/schema/index.ts` reexporta `events.ts` de cada context; é isso que popula o
catálogo onde `publishEvent` roda. Gera arestas `lib:db → context:*` no grafo.

**Consequência:** parece inversão de camada e não é. Documentado no [c4.md](/architecture/c4) para ninguém
"consertar" e quebrar o registro de eventos.

---

## ADRs

### Vigentes que governam a Camada 1

| ADR | Papel na Camada 1 |
| --- | --- |
| [049](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/049-pagamentos-paciente-sinal.md) | decisão do P0 — cobrança de paciente + sinal |
| [007](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/007-rls-implementation-patterns.md) | RLS e dual-context: toda tabela nova é tenant-scoped |
| [011](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/011-outbox-audit-idempotency-patterns.md) | outbox, auditoria e idempotência dos handlers |
| [010](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/010-security-definer-patterns.md) | funções `SECURITY DEFINER`, se houver |

### Necessários (ainda não escritos)

| Quando | ADR | Motivo |
| --- | --- | --- |
| Track M (última) | integração Memed | dependência externa com contrato, custo e requisito regulatório; spike 2.2.0 concluído, runtime adiado até Camadas 2–4 e Track O estabilizadas |
| P2 (Camada 3) | conselho genérico (`crm` → `conselho/registro/uf`) | destrava psicólogo; mexe em identidade profissional |
| P2 (Camada 3) | pacote/mensalidade por paciente | cobrança recorrente de paciente — modelo novo de receita |
