# Convenções de engenharia

## Status

Canonical — regras atuais para mudanças no repositório.

## Fontes de verdade

- runtime e scripts: `package.json`;
- boundaries/lint: `eslint.config.mjs`;
- schema: `src/contexts/*/schema.ts`, `src/lib/db/schema` e `drizzle/*.sql`;
- ambiente: `src/lib/env.ts`;
- CI: `.github/workflows/ci.yml`;
- jobs: `vercel.json` e `src/app/api/cron`.

## Código

- Use TypeScript estrito; não contorne erro com `any`, `@ts-ignore` ou casts sem prova.
- Reuse tipos, helpers, schemas Zod e APIs públicas existentes.
- Preserve as fronteiras de `src/contexts`; não importe `internal` de outro context.
- Repository que participa de uma unidade de trabalho recebe a `tx`; não abre conexão paralela.
- Entrada externa é validada antes do domínio. Erros não são engolidos.
- Não mantenha transação aberta durante provider, LLM, e-mail ou Storage.
- Mutation nova deve usar os chokepoints de autenticação, permissão, idempotência, acesso de billing e auditoria existentes.
- Side effect atômico com uma mutation deve nascer na outbox; handler precisa ser idempotente por `eventId` ou identidade persistida.
- PII não entra em logs, métricas, eventos ou chaves de idempotência em claro.

## Banco e multi-tenancy

- Toda tabela tenant-scoped tem `clinic_id`, RLS `ENABLE` + `FORCE` e política adequada.
- Runtime tenant usa `withTenant`; admin/worker só para superfícies explicitamente privilegiadas.
- Migration é append-only. Não edite migration aplicada.
- Mudança destrutiva exige procedimento e aprovação explícitos.

## Testes e documentação

- Comportamento novo ou alterado exige teste correspondente.
- Rode os gates de [development/testing.md](development/testing.md) antes de concluir.
- Atualize a fonte canônica do assunto; não crie uma segunda especificação concorrente.
- Código prova implementação, não estado externo. Use `REQUIRES_MANUAL_VALIDATION` quando necessário.
- Decisão transversal duradoura entra em [adr/README.md](adr/README.md); histórico de execução não é ADR.

## Revisão mínima

- diff contém somente o objetivo declarado;
- tipos, erros, nulos, listas vazias e falhas externas foram tratados;
- não há segredo, log de debug, teste desabilitado ou referência documental quebrada;
- typecheck, lint, testes e build passaram, ou a ausência de execução está explícita.
