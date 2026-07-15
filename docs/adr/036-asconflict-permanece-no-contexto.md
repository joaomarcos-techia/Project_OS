# ADR-036 — `asConflict` permanece em cada contexto (não centralizar em `@/lib`)

**Status:** accepted · **Date:** 2026-07-14 (owner aprovou ao aplicar o S1 da auditoria de simplificação)
**Camada:** Contexts (scheduling / clinical) · Boundaries (`eslint-plugin-boundaries`).
**Refs:** [auditoria-simplificacao-codigo.md](../achados/auditoria-simplificacao-codigo.md) §S1 ·
[ADR-001](001-bounded-contexts.md) (bounded contexts) · [ADR-011](011-outbox-audit-idempotency-patterns.md)
(idempotência) · [CONVENTIONS.md](../CONVENTIONS.md) (anti-padrões, `context → só lib`).

## Context

Ao aplicar o achado **S1** (centralizar helpers de Server Action clonados em `patient`/`clinical`/`scheduling`/
`financial`), quatro helpers **realmente compartilhados** foram movidos para `@/lib/`:
`jsonSafe`, `requestContext`, a lógica de `idemKey` (via `makeIdemKey`) e o TTL (`MUTATION_IDEM_TTL_SECONDS`).

A auditoria mencionou que **"parte de"** `asConflict` também se repete — mas **não** a incluiu na sugestão de
centralização, e ao aplicar ficou claro por quê. `asConflict` existe em dois contextos e **diverge no que
importa**:

- **clinical** ([internal/action-helpers.ts](../../src/contexts/clinical/internal/action-helpers.ts)):
  `if (isUniqueViolation(err)) throw new ProntuarioConflitoError('Conflito ao gravar prontuário …')`.
- **scheduling** ([internal/action-helpers.ts](../../src/contexts/scheduling/internal/action-helpers.ts)):
  `if (isUniqueViolation(err) || isExclusionViolation(err)) throw new SchedulingConflictError('horário ocupado …')`.

Ou seja: **classe de erro diferente**, **mensagem diferente** e **predicado diferente** (scheduling também trata
EXCLUDE `23P01`). A única coisa em comum é a chamada a `isUniqueViolation` — que **já** vive em `@/lib/outbox/errors`
(primitivo compartilhado).

## Decision

**`asConflict` permanece definido em cada contexto; não é movido para `@/lib`.**

Razões (arquiteturais, não só deste refactor):

1. **Boundary `context → só lib` (proibido `lib → context`).** As classes de erro lançadas
   (`ProntuarioConflitoError`, `SchedulingConflictError`) são **erros de domínio** e vivem em `contexts/*/errors.ts`.
   Um `asConflict` em `@/lib` precisaria importá-las — o que **inverte a dependência** e viola a regra enforçada por
   `eslint-plugin-boundaries`. Contornar isso injetando a classe/predicado por parâmetro reproduziria a função
   inteira como configuração: **abstração maior que o problema**.
2. **A parte genuinamente compartilhada já está compartilhada.** `isUniqueViolation`/`isExclusionViolation` já são
   `@/lib/outbox/errors`. O que sobra em `asConflict` é **regra de domínio** (qual erro, qual mensagem, quais
   violações contam como conflito naquele agregado) — que por definição pertence ao contexto.
3. **Legibilidade/auditabilidade > concisão.** Manter o mapeamento erro-de-banco → erro-de-domínio **visível** no
   contexto deixa explícito o contrato de conflito de cada agregado (prontuário por consulta; slot por médico).

## Invariantes

- `@/lib` **nunca** importa de `contexts/*` (inclui classes de erro de domínio).
- Cada contexto é dono do seu mapeamento de conflito (classe + mensagem + predicado).
- Se um 3º contexto precisar de um `asConflict`, ele **redeclara localmente** reusando os predicados de
  `@/lib/outbox/errors` — não se cria um helper genérico em `lib`.

## Consequences

- (+) Boundaries intactos; sem dependência invertida `lib → context`.
- (+) O contrato de conflito de cada agregado fica explícito e greppável no próprio contexto.
- (−) `if (isUniqueViolation(err)) throw new XConflitoError(...)` aparece 2× (clinical, scheduling) — repetição
  **pequena e deliberada** (≤4 linhas), do mesmo tipo que o pipeline congelado de Server Actions (S5): a
  duplicação preserva clareza de domínio.
- Registra a decisão para o futuro: evita que um "DRY zealot" (humano ou IA) tente mover `asConflict` para `lib`
  e quebre o boundary.

## Alternatives

- **`throwOnDbConflict(err, makeError, { exclusion })` em `@/lib`:** rejeitada — injeta classe (factory) + predicado,
  virando a função inteira em parâmetro; ganho marginal (≤4 linhas) por mais superfície e um helper genérico
  (anti-padrão CONVENTIONS).
- **Mover as classes de erro para `@/lib`:** rejeitada — erros de domínio pertencem ao bounded context (ADR-001);
  centralizá-los para viabilizar `asConflict` inverteria a modelagem por conveniência.

## References

- Aplicação do S1: `@/lib/idempotency/{idem-key,ttl,json-safe}.ts`, `@/lib/audit/request-context-from-headers.ts`,
  e as fachadas `contexts/{patient,clinical,scheduling,financial}/internal/action-helpers.ts`.
- Primitivos compartilhados de violação: [outbox/errors.ts](../../src/lib/outbox/errors.ts)
  (`isUniqueViolation`, `isExclusionViolation`).
