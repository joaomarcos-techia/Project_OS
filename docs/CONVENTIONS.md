# Convenções de engenharia

## Status

Canonical — regras atuais para mudanças no repositório.

## Fontes de verdade

- runtime e scripts: `package.json`;
- boundaries/lint: `eslint.config.mjs`;
- schema: `src/contexts/*/schema.ts`, `src/lib/db/schema` e `drizzle/migrations/*.sql`;
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

## Uma sessão por vez no checkout

**Decisão do fundador, 12/09/2026 (D11/D12).** Só uma sessão de trabalho ativa por checkout. Duas
sessões no mesmo diretório e na mesma branch já custaram caro três vezes:

- duas migrations nasceram com o número `0080` no mesmo dia; a colisão foi pega por acaso, antes de
  rodar. Duas migrations com o mesmo número teriam ido para produção (D12);
- um commit varreu 8 arquivos que a outra sessão tinha deletado e deixado staged — `git add` seguido
  de `git commit` commita o **índice inteiro**, não só o que você adicionou;
- um arquivo editado pelas duas frentes (`clinical/queries.ts`) foi classificado como pertencendo a
  uma só, e o build publicado quebrou.

Enquanto isso valer, não há paralelismo a proteger. Se em algum momento houver, o mínimo é:

- `git commit -- <caminhos>` em vez de `git add` + `git commit`, para não commitar o índice alheio;
- conferir `ls drizzle/migrations` e `meta/_journal.json` **antes** de numerar migration;
- não confiar em classificação por caminho sem verificar: arquivo pode conter mudança de duas frentes.

## Revisão mínima

- diff contém somente o objetivo declarado;
- tipos, erros, nulos, listas vazias e falhas externas foram tratados;
- não há segredo, log de debug, teste desabilitado ou referência documental quebrada;
- typecheck, lint, testes e build passaram, ou a ausência de execução está explícita.
