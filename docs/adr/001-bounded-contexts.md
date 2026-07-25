# ADR-001 — Bounded Contexts isolados via DDD

> **Verificação (2026-07-23)** — Decisão: ACTIVE · Implementação: IMPLEMENTED
> _Base: em produção (C0–C16 fechadas); confirmação por domínio na Onda 3._

**Status:** accepted
**Date:** 2026-05-25

## Context

ClinicaOS V1 morreu de complexidade que cresceu sem fronteiras. 4 god-modules conversavam direto entre si, com 537 lugares fazendo `where clinicId = X` manual em queries Firestore. Cada bug em uma dessas funções vazava para todos os fluxos que dependiam dela; cada feature nova exigia tocar em todas as quatro. A organização do código não refletia o domínio — refletia o histórico de quem mexeu onde primeiro.

O V2 nasce com a aposta oposta: **organizar o código pelo domínio do negócio (DDD)**, com paredes físicas (pastas) e lógicas (lint) entre contextos. Custo de manutenção compostável e dev novo conseguindo localizar qualquer feature em 1 minuto sabendo só o nome do domínio.

## Decision

O código `src/contexts/` tem **8 bounded contexts** isolados:

- `identity` — autenticação, usuários, roles
- `tenancy` — clínicas, unidades, slugs, status
- `patient` — pacientes, contatos, LGPD
- `scheduling` — agendamentos, slots, state machine
- `clinical` — prontuário, prescrição, exames, PDFs clínicos
- `financial` — lançamentos, caixa, pagamentos da clínica
- `ai-agent` — agent, conversas, intents, custo
- `platform-admin` — super_admin, métricas operacionais

**Regras invioláveis:**

1. Nenhum contexto importa de outro contexto via internals. Importa SÓ via `@/contexts/<X>` (que re-exporta `api.ts` / `events.ts`).
2. Nenhuma query SQL faz `JOIN` cross-context. Cada contexto lê apenas suas tabelas.
3. Comunicação cross-context = outbox (assíncrono, padrão) OU api interna explícita do contexto destino (síncrono, raro).
4. `src/lib/` é infra genérica e NÃO pode importar de `src/contexts/` (lib é refém de ninguém).

Enforcement automatizado via `eslint-plugin-boundaries` (`eslint.config.mjs`).

## Consequences

- Cada contexto evolui no seu próprio ritmo. PR que mexe em patient não toca scheduling.
- Refatoração local é segura: a superfície pública (`api.ts` / `events.ts`) muda devagar, internals mudam à vontade.
- Custo: alguma duplicação inevitável (ex: tipo `Address` em tenancy e patient). **Aceita-se duplicação sobre acoplamento.**
- Onboarding: dev novo entende uma feature lendo só o contexto dela, sem precisar de mapa mental global.
- Saída futura: se um contexto crescer demais, vira service à parte com mínimo refactor (já está isolado).

## Alternatives

- **Monolito flat por técnica (`controllers/`, `services/`, `repositories/`):** rejeitada — foi o V1, gerou god-modules.
- **Microservices desde dia 1:** rejeitada — solo founder, custo operacional inviável (PlanoAção 1.2).
- **Modular monolith via npm workspaces (pacotes separados):** rejeitada — overhead de build/dependency sem ganho real até v2.3+. Volta a entrar em consideração quando 2ª app surgir.

## References

- `Documentação/PlanoAção.md` seções 0.2, 1.3, 2.1
- ADR-002 (RLS), ADR-003 (Outbox) — dependentes desta decisão
- `eslint.config.mjs` (enforcement)
- `docs/CONVENTIONS.md` (regras de import)
