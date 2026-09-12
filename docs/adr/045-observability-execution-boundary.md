# ADR-045 — Fronteira de observabilidade: withCron + contexto ambiente + captura de background

> **Verificação (2026-07-23)** — Decisão: ACTIVE · Implementação: IMPLEMENTED
> _Base: em produção (C0–C16 fechadas); confirmação por domínio na Onda 3._

**Status:** accepted
**Date:** 2026-07-18
**Estende:** [ADR-029](./029-observability-stack.md) (stack de observabilidade)

## Context

A [auditoria de monitoramento](../achados/auditoria-monitoramento-producao.md)
concluiu que o sistema estava **instrumentado mas não operável**. Três dos
achados críticos tinham a mesma raiz, e é essa raiz que este ADR ataca:

**Não existia uma fronteira de execução de background.** As 13 rotas de
`/api/cron/**`, os 2 webhooks e o worker repetiam à mão o mesmo esqueleto:

```
assertCronRuntimeReady → assertCronAuth → try { … } catch { metrics.emit('<x>.error'); return 500 }
```

Treze cópias significam treze lugares para esquecer algo — e **todas esqueciam a
mesma coisa**: o Sentry server-side só captura o que é **lançado**
(`onRequestError`), e esses catches devolvem 500 **sem rethrow**. Somado ao fato
de o `sanitizeFields` reduzir `Error` a `{name, message}` (descartando o stack
por design, para o stream de métricas), o resultado era: uma falha de webhook ou
cron deixava **uma linha de stdout com nome e mensagem, sem stack**. Diagnosticar
um `PAYMENT_RECEIVED` quebrado exigia reproduzir localmente com um payload que os
logs haviam redigido.

Em paralelo, `metrics.emit`/`logger` não tinham correlação: o `request_id`
carimbado no middleware chegava à auditoria, mas **não ao stream de métricas**. O
`idempotentMutation` — que está por baixo de toda mutação de agenda, prontuário e
paciente — emitia `idempotency.*` só com `{ key }`, embora tivesse `clinicId` e
`userId` em escopo. A promessa do ADR-029 de "um salto do alerta ao log" não se
sustentava.

Um cron novo herdava o buraco **por imitação**: copiava-se a rota vizinha.

## Decision

Criar **três primitivas** e adotá-las nas fronteiras.

### 1. `src/lib/observability/context.ts` — correlação ambiente

`AsyncLocalStorage` com `runWithContext(ctx, fn)` / `getContext()`.
`metrics.emit` e `logger.*` fazem `{ ...contextFields(), ...fields }`.

Aditivo: **sem escopo, a linha emitida é idêntica à de hoje** — nenhuma saved
search quebra. Resolve a correlação nos ~150 call-sites sem tocar em nenhum.

- ⚠️ **Invariante — só runtime Node.** `AsyncLocalStorage` só garante propagação
  no Node; o **Edge não oferece equivalente**. Quem abre escopo é sempre um
  handler `runtime='nodejs'`. O middleware roda no Edge e **não** abre contexto —
  ele apenas carimba `x-request-id` no header, que a fronteira Node lê.

### 2. `src/lib/observability/capture.ts` — `captureBackgroundError`

Manda o `Error` **cru** ao Sentry (stack preservado) com tags de correlação.

Isto **não conflita com o ADR-029**, que mantém *LOGS* fora do Sentry: exceção
não é log — é para isso que o Sentry existe. Eventos de controle de fluxo
esperado (401 de cron, trip de rate-limit) seguem só como métrica.

- ⚠️ **Invariante — nunca faz throw.** Retorna `void` e engole falha do próprio
  Sentry. Telemetria não pode alterar o fluxo de quem a chama: um Sentry fora do
  ar derrubando um webhook seria o oposto do objetivo.

### 3. `src/lib/http/cron.ts` — `withCron`

Assume auth, escopo de correlação, captura no Sentry, heartbeat de erro e o 500.
O handler mantém **todo o caminho de sucesso** — inclusive o heartbeat
`success`/`skipped` com o `detail` próprio de cada job.

```
Cron ──▶ withCron ──▶ runWithContext ──▶ handler
                                            │  (throw)
                                            ▼
                                   captureBackgroundError ──▶ Sentry (stack + tags)
                                            │
                                            ├──▶ metrics.emit(errorEvent)  ──▶ stdout → Better Stack
                                            └──▶ recordHeartbeat(job,'error')
```

## Consequences

- Um cron novo herda Sentry + correlação + heartbeat **de graça**. A recorrência
  do C3 fica estruturalmente impedida, não dependente de disciplina.
- **`errorEvent` é passado verbatim.** Os nomes atuais são inconsistentes
  (`worker.error`, `invites_cleanup.error`), mas a saved search `event:"*.error"`
  pega todos. Uniformizar seria mudança visível em dashboard sem ganho
  operacional — **nome de evento é contrato**.
- **Segurança (pós-A1):** `ObsContext` e o `ctx` do `capture` são **allowlists
  tipadas fechadas**. A sanitização do repo é *denylist* de nomes credenciais e
  **não cobre prosa clínica** — foi assim que 32 `audit_events` guardaram SOAP em
  claro ([ADR-044](./044-clinical-content-encryption.md)). Um contexto **ambiente**
  seria a versão de maior alavancagem desse vazamento: um campo clínico ali iria
  para *toda* linha de log e para um **terceiro** (Sentry), cujas `tags` não
  passam por scrub nenhum. Guard congelado por `@ts-expect-error` nos testes:
  afrouxar o tipo **quebra o typecheck no CI**.
- Custo: uma indireção a mais por request de background. Irrelevante frente ao
  MTTR que ela evita.

## Alternatives

- **Aplicar `captureException` em cada catch, sem wrapper.** Rejeitado: mantém as
  13 cópias e o próximo cron volta a esquecer. Trata o sintoma.
- **Contexto por parâmetro explícito.** Rejeitado: exigiria tocar ~150 call-sites
  e um novo emit continuaria podendo esquecer.
- **`ctx` aberto (`& Record<string, unknown>`)**, como no rascunho da auditoria.
  Rejeitado por segurança — ver Consequences.
- **Uniformizar os nomes de evento de erro.** Rejeitado: quebraria saved searches
  em troca de estética.
- **OpenTelemetry agora.** Adiado (mantém a decisão do ADR-029) — desproporcional
  ao estágio; as primitivas aqui não impedem adotá-lo depois.

## References

- Auditorias: [monitoramento-producao](../achados/auditoria-monitoramento-producao.md) (C3, A2, A3, M2) e [monitoramento-artefatos](../achados/auditoria-monitoramento-artefatos.md)
- [ADR-029](./029-observability-stack.md) — stack (este ADR corrige a promessa de correlação)
- [ADR-043 §4](./043-messaging-retention-not-partitioning.md) — por que `cron.audit_partitions.degraded` **não** vai ao Sentry
- [ADR-044](./044-clinical-content-encryption.md) — o seam `project` e o vazamento que motivou a allowlist fechada
