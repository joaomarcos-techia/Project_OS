# ADR-006 — Drizzle ORM com pin exato + driver postgres-js

> **Verificação (2026-08-11)** — Decisão: ACTIVE · Implementação: IMPLEMENTED
> _Base: em produção (C0–C16 fechadas); confirmação por domínio na Onda 3._

**Status:** accepted
**Date:** 2026-05-26

## Context

C1 (fundação de banco) precisa escolher e travar três bibliotecas que tocam o coração do sistema: o ORM, o cliente do migrador e o driver Postgres. Cada uma delas tem histórico de breaking changes silenciosas entre minor versions (em particular `drizzle-kit`, que mudou formato de migration entre 0.20.x e 0.24.x sem warning explícito). Solo founder precisa de previsibilidade: um `pnpm install` em outra máquina, dois meses depois, deve produzir o mesmo schema diff. Sem pin exato, o risco é "deploy quebra porque drizzle-kit upgradou a 4 da manhã".

A escolha do driver Postgres também é estrutural: `pg` (node-postgres) é mais maduro mas tem overhead alto em serverless; `postgres-js` (porsager/postgres) é mais leve, suporta o Transaction Pooler do Supabase com `prepare: false`, e é o driver recomendado pela própria Drizzle.

## Decision

Pins exatos (sem `^`/`~`) em `package.json`, todas verificadas e estáveis no ecossistema há ≥6 meses:

- `drizzle-orm@0.45.2` (dependencies — runtime)
- `postgres@3.4.5` (dependencies — runtime, driver postgres-js)
- `drizzle-kit@0.28.1` (devDependencies)
- `tsx@4.19.2` (devDependencies — runner de scripts)
- `dotenv@16.4.5` (devDependencies)
- `cross-env@7.0.3` (devDependencies)

Driver escolhido: `postgres-js` (`postgres` no npm) com `prepare: false` para compatibilidade com Supabase Transaction Pooler (porta 6543, que não suporta prepared statements).

Pooler ports — split por uso:
- **App runtime** (`src/lib/db/index.ts`, Next serverless): Transaction Pooler, porta 6543.
- **Migrations e backups** (`scripts/db-*.ts`): Session Pooler, porta 5432. Scripts fazem swap automático da porta. Razão empírica: `pg_advisory_lock` requer backend sticky, que Transaction Pooler não provê (validado em C1 teste 1.6.11).

Upgrade dessas libs requer: ADR explicando o motivo + checklist de validação manual da spec C1.6 reexecutado + commit dedicado.

### Emenda 2026-08-11 — correção de segurança do runtime

O pin de `drizzle-orm` foi elevado de `0.36.4` para `0.45.2`, a primeira versão corrigida
para GHSA-gpj5-g38j-94v9. `drizzle-kit@0.28.1` permanece pinado: esta mudança não gera nem
aplica migration. A compatibilidade foi validada por typecheck, 1.176 testes, checks de
arquitetura/migrations, build de produção e smoke C11/C12 no ambiente DEV. O lockfile mantém
reprodutibilidade; qualquer upgrade futuro continua exigindo decisão explícita e validação
completa.

## Consequences

- `pnpm install --frozen-lockfile` em qualquer máquina produz exatamente o mesmo grafo de dependências. Drift entre dev/CI/prod ⇒ zero.
- Migrations geradas hoje são lidas idêntico daqui a 18 meses por qualquer máquina que faça checkout do repo. Se drizzle-kit mudar formato, isto NÃO afeta o histórico aplicado — só novas migrations.
- O driver `postgres-js` é Node-only — esse código NÃO roda em Edge runtime do Next.js. Limita roteamento para `nodejs` runtime. Aceitável: a UI roda em qualquer runtime; só código que toca DB precisa de Node.
- Para upgrade de Drizzle (esperado a cada ~6 meses), o custo é: criar ADR + rodar todos os testes 1.6.1-1.6.7 da spec C1 + smoke test em qoro-dev. ~30-60min de operação.
- Sair: trocar `postgres-js` por `pg` (node-postgres) requer reescrever `src/lib/db/index.ts` (~50 linhas). Trocar Drizzle por Prisma é refator pesado (~1-2 semanas). Nenhum dos dois está no horizonte.

## Alternatives

- **`drizzle-orm` em range `^0.36.4`:** rejeitado — o mínimo que `^` libera (`0.37.x`) já mudou regras de inferência de tipos em RC anteriores. Em monorepo solo, ganho de "novas features automáticas" é menor que o custo de regressão silenciosa.
- **Prisma:** rejeitado em ADR-005 / VisãoGeral 3.3. Resumo: cold start ruim em serverless, esconde SQL (anti-pedagógico para founder em curva de aprendizado), engine binário pesado.
- **`pg` (node-postgres):** rejeitado pelo overhead em Next.js serverless e por ausência de suporte first-class no Drizzle a algumas otimizações de pool. Documentação Drizzle recomenda `postgres-js` para Supabase explicitamente.
- **Supabase JS SDK direto (PostgREST):** rejeitado para queries de negócio — abstrai SQL, esconde performance, mistura concerns. Será usado APENAS para Auth em C3.

## References

- [docs/PlanoAção.md — Camada 1](../PlanoAção.md) seções 1.2 (o que construir), 1.9 (proibições), 1.10 (riscos).
- [ADR-005 — Supabase vs Firebase](005-supabase-vs-firebase.md) — fixa Supabase Postgres como SoR.
- [Drizzle Supabase guide](https://orm.drizzle.team/docs/get-started-postgresql#supabase) — driver recomendado.
- [Supabase pooler docs](https://supabase.com/docs/guides/database/connecting-to-postgres) — exige `prepare: false`.
