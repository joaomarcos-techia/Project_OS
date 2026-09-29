# Setup local

## Status

Canonical — ambiente de desenvolvimento.

## Requisitos

- Node.js 22.x (`package.json` e CI são autoridade; `.nvmrc` ainda diverge em 20)
- pnpm 11.17
- acesso a um projeto Supabase/Postgres de desenvolvimento

## Instalação

```bash
pnpm install --frozen-lockfile
```

Copie a estrutura de `.env.example` para `.env.local` e preencha somente credenciais DEV. O contrato real está em [environment.md](environment.md).

## Executar

```bash
pnpm dev
```

O app não possui landing pública; `/` conduz ao login. Não aponte variáveis locais para produção.

## Banco

Para preparar um banco de desenvolvimento autorizado:

```bash
pnpm db:migrate:dev
pnpm seed:dev
```

Migrations/seeds alteram dados e não fazem parte do setup automático. Confirme o ambiente antes. Veja [runbooks/migrations.md](../runbooks/migrations.md).

## Primeiro diagnóstico

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Para mudança completa, use todos os gates de [testing.md](testing.md).
