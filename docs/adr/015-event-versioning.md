# ADR-015 — Versionamento de eventos do outbox

- Status: accepted
- Camada: C4+ (cross-cutting; congela contrato antes de C7/C9/C11)
- Refs: ADR-003 (outbox), ADR-011 (outbox/audit/idempotency), gap 4.3

## Context

Eventos do outbox têm `event_type` (`<context>.<entity>.<action>`) mas NÃO têm
um campo `event_version`. Hoje só C5/C6 produzem e os consumidores são handlers
internos. Quando os payloads evoluírem (C7/C9 reagindo, e principalmente C11/C12
expondo **webhooks externos**), uma mudança de shape feita "no lugar" pode quebrar
silenciosamente consumidores já deployados. O gap não é um bug atual — é a
**ausência de uma regra congelada**, que vira dor de cabeça quando houver consumidor
externo que não dá pra atualizar em lockstep.

Decisão de NÃO adicionar coluna `event_version` agora: seria especulativa
(anti-hidra) e redundante — o `event_type` já carrega a versão (ver abaixo). Há
ainda uma proteção fail-loud existente: o worker faz `schema.parse(payload)` com o
schema ATUAL; um reshape incompatível faz eventos antigos falharem o parse
(retry → `failed`/DLQ), nunca corrompe em silêncio.

## Decision

**1. `event_type` É a fronteira de versão.** O catálogo já garante UM schema por
`event_type` (re-registrar com schema diferente lança erro). Não há `event_version`
separado.

**2. Mudança retrocompatível → no lugar, sem bump.** Adicionar um campo OPCIONAL
(`z.optional()` / com default) ao payload é permitido sem novo `event_type`.
Consumidores ignoram campos ausentes/desconhecidos. Regra de ouro: payload só
carrega **ids + escalares não-sensíveis**; o handler busca o resto via DB pelos
ids — isso minimiza a superfície de breaking change.

**3. Mudança incompatível → NOVO `event_type` com sufixo de versão.** Renomear/
remover/retipar um campo, ou mudar semântica, exige um novo evento:
`scheduling.appointment.completed_v2` (sufixo `_v2` no segmento `action`; a regex
3-segmentos do CHECK do outbox aceita). O `event_type` antigo **mantém** seu schema
+ handler durante a janela de migração; o produtor passa a emitir o `_v2`; os
consumidores do antigo drenam e então o antigo é aposentado (handler removido →
worker marca `skipped`).

**4. Webhooks (C11+) NUNCA reformam um `event_type` publicado.** O `event_type` é o
contrato exposto ao mundo externo; evolução só por novo `event_type` versionado.

**5. Toda mudança de evento exige ADR** (adiciona à regra de processo): criar,
remover ou reformar um `event_type` é mudança de contrato cross-context.

## Consequences
- (+) Regra explícita antes de existir consumidor externo — custo zero hoje.
- (+) Sem coluna especulativa; o `event_type` versionado é auto-descritivo em logs/DLQ.
- (+) Proteção fail-loud já existe (parse no worker) — reshape silencioso é impossível.
- (−) Breaking change custa um novo `event_type` + janela de coexistência (intencional:
  é o preço de não quebrar consumidores).
- (−) Disciplina humana: o catálogo impede re-registro divergente no MESMO type, mas
  não força o uso de `_v2`. Hardening futuro possível (snapshot-test do conjunto de
  event_types em CI) — adiado até haver webhooks externos, quando o risco materializa.

## References
- [src/lib/outbox/catalog.ts](../../src/lib/outbox/catalog.ts) — um schema por event_type
- [src/lib/outbox/publish.ts](../../src/lib/outbox/publish.ts) — valida payload no publish
- ADR-011 — invariantes do outbox
