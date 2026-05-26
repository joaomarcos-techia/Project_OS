# Runbook — Migrations (Drizzle + Supabase Postgres)

> Solo operator runbook. Imperativo, comando-primeiro. Se você está cansado às
> 3h da manhã: leia em ordem, copie os comandos. Não improvise.

## Quando rodar

- **Dev**: sempre que mudar schema (adicionar tabela/coluna/índice) em qualquer
  arquivo dentro de `src/lib/db/schema/` ou `src/contexts/*/schema.ts` (C2+).
- **Prod**: sempre **ANTES** de fazer deploy de código que assume o novo schema.
  Nunca automatize prod em CI. Janela manual, atenção dedicada.

## Como criar uma nova migration

```bash
# 1. Edite os arquivos de schema (Drizzle .ts).
# 2. Gere o SQL diff (drizzle-kit lê o schema, não conecta no DB):
pnpm db:generate --name <feature_snake_case>

# 3. Inspecione o SQL gerado em drizzle/migrations/NNNN_*.sql.
#    Se algo parecer errado (ex: drop de coluna), abra o arquivo e leia antes
#    de aplicar. Você pode editar o SQL gerado ANTES da primeira aplicação.

# 4. Aplique no dev:
pnpm db:migrate:dev

# 5. Commite os artefatos:
git add drizzle/migrations/NNNN_*.sql drizzle/migrations/meta/
git commit -m "feat(db): add <descrição>"
```

**Naming**: filename deve casar `^\d{4}_[a-z][a-z0-9_]*\.sql$`. `pnpm arch:db-check`
rejeita lixo (`fix.sql`, `tmp.sql`, etc.).

**Imutabilidade**: depois que uma migration foi aplicada em qualquer ambiente
(inclusive seu dev), **NUNCA** edite o SQL. Erro = nova migration corretiva.

## Rodar em dev

```bash
pnpm db:migrate:dev
```

Espera-se output:
```
[migrate:dev] target: postgres://...@aws-1-...pooler.supabase.com:6543/postgres
Reading config file ...
[i] No config path provided, using default 'drizzle.config.ts'
... applied migration: 0000_schema_version
[migrate:dev] done.
```

Verificar:
```bash
psql "$DATABASE_URL" -c "SELECT version, applied_at FROM _schema_version ORDER BY applied_at DESC LIMIT 5"
```

## Rodar em produção (checklist obrigatório)

**Pré-condições antes de começar**:
- [ ] `qoro-prod` Supabase project existe (C16 / quando primeiro cliente entrar)
- [ ] `pg_dump` instalado localmente (`pg_dump --version` funciona)
- [ ] Estou em `main`, branch limpa, em sync com origin

**Checklist linha por linha** (não pule):

```bash
# 1. Sync local.
git checkout main && git pull origin main
pnpm install --frozen-lockfile

# 2. Setar contexto de prod APENAS para este shell (NUNCA salvar em .env.local
#    em máquinas que rodam dev). Use export inline ou shell session só prod.
export SUPABASE_PROJECT_ENV=prod
export DATABASE_URL_PROD="postgres://...@<prod-host>...?sslmode=require"

# 3. Smoke test da chave — backup manual primeiro:
pnpm db:backup:prod
# Espera-se: backups/manual-<timestamp>.sql com tamanho > 0.

# 4. APLICAR — esta é a operação real:
pnpm db:migrate:prod
# O script:
#   - verifica MIGRATION_FAILED.md ausente
#   - faz pg_dump pre-migration -> backups/prod-pre-migration-<ts>.sql
#   - adquire pg_advisory_lock(4242)
#   - aplica via drizzle-kit
#   - libera o lock
#   - registra em backups/migrations.log

# 5. Verificar:
psql "$DATABASE_URL_PROD" -c "SELECT version, applied_at FROM _schema_version ORDER BY applied_at DESC LIMIT 5"

# 6. Limpar o shell (importante!):
unset SUPABASE_PROJECT_ENV
unset DATABASE_URL_PROD
```

## Como reverter (rollback)

Cenário: migration aplicou mas quebrou produção. Dump pre-migration existe.

**Estratégia atual (C1)**: drop nossas tabelas + restore do dump. O dump contém
apenas nossos schemas (`public` + `drizzle`) — schemas Supabase-managed (`auth`,
`storage`, `realtime`, etc.) são excluídos via `--exclude-schema` no pg_dump.

⚠️ **Caveat 1 — Supabase-managed event triggers**: Restoring a Supabase dump
against an existing Supabase project produces ~12 errors of the form
`must be owner of event trigger pgrst_*` / `Non-superuser owned event trigger
must execute a non-superuser owned function`. These are about Supabase-owned
global event triggers (`pgrst_ddl_watch`, `pgrst_drop_watch`, `ensure_rls`,
`issue_pg_graphql_access`, etc.) that our connection role cannot
re-create — Supabase auto-manages them on the target side. **These errors
are expected and harmless** for our app-data restore. Run `psql` WITHOUT
`\set ON_ERROR_STOP on` so it continues past them. Validated empirically in
C1 audit 1.6.5 restore test (12 errors observed, application tables 100%
restored).

⚠️ **Caveat 2 — extensions**: `DROP SCHEMA public CASCADE` destrói
`CREATE EXTENSION ...` instaladas em `public` (ex: `pgcrypto`, `vector`).
Antes do nuke, liste:

```bash
psql "$URL_5432" -c "SELECT extname FROM pg_extension WHERE extnamespace = 'public'::regnamespace"
```

E recrie-as **antes** de aplicar o dump.

### Procedimento

```bash
# 0. Use Session Pooler (porta 5432), NÃO Transaction Pooler (6543).
#    psql/pg_dump precisam de sticky session.
URL_5432="${DATABASE_URL_PROD/:6543\//:5432\/}"

# 1. Lista extensions ativas (anote para reaplicar):
psql "$URL_5432" -c "SELECT extname FROM pg_extension WHERE extnamespace = 'public'::regnamespace"

# 2. Drop NOSSAS tabelas (não DROP SCHEMA — quebra Supabase event triggers):
psql "$URL_5432" <<'SQL'
DROP TABLE IF EXISTS public._schema_version CASCADE;
DROP SCHEMA IF EXISTS drizzle CASCADE;
-- Adicione DROPs para tabelas de C2+ quando existirem
SQL

# 3. Restore do dump. NÃO use ON_ERROR_STOP — o DROP FUNCTION rls_auto_enable
#    vai falhar (esperado, Caveat 1) mas o resto restaura limpo:
psql "$URL_5432" -f backups/prod-pre-migration-<timestamp>.sql

# 4. Verifique nossas tabelas:
psql "$URL_5432" -c "\dt public.*"
psql "$URL_5432" -c "\dt drizzle.*"
psql "$URL_5432" -c "SELECT count(*) FROM drizzle.__drizzle_migrations"
```

⚠️ **Caveat 3 — quando tiver clientes**: dados criados ENTRE o dump e o
incidente são perdidos. Por isso a janela de migration é curta + não acumule
mudanças.

**Quando primeiro cliente entrar**, esta seção precisa ser reescrita pra estratégia
de "restore em DB temporário + diff manual + reaplicar inserts críticos". TODO em C13.

## Quando MIGRATION_FAILED.md aparecer

O script `db-migrate-prod.ts` cria este arquivo na raiz se uma migration falha.
Ele **bloqueia** novas tentativas até remoção manual.

Passos:
1. **NÃO DELETE O ARQUIVO ANTES DE INVESTIGAR.** Ele tem o postmortem.
2. Abra `MIGRATION_FAILED.md` — preencha os campos:
   - Root cause
   - Rollback executado?
   - Ação tomada
3. Investigue a falha real: leia o stderr capturado.
4. Se rollback necessário, siga seção "Como reverter".
5. Crie nova migration corretiva (NÃO edite a que falhou).
6. Aplique em dev primeiro — `pnpm db:migrate:dev`.
7. Só DEPOIS, delete `MIGRATION_FAILED.md` e re-rode `pnpm db:migrate:prod`.

## Troubleshooting

| Sintoma | Causa provável | Ação |
|---|---|---|
| `[guard] SUPABASE_PROJECT_ENV must be set to "prod"` | Esqueceu o export | `export SUPABASE_PROJECT_ENV=prod` |
| `[guard] DATABASE_URL must contain "sslmode=require"` | URL sem o param | Adicione `?sslmode=require` ao final |
| `pg_dump: connection failed: SSL required` | URL sem param E driver não força SSL | Adicione param OU use psql com `-o sslmode=require` |
| `MIGRATION_FAILED.md exists` | Falha anterior não resolvida | Leia seção "Quando MIGRATION_FAILED.md aparecer" |
| `[migrate:prod] backup file is 0 bytes` | pg_dump falhou silencioso | Cheque conectividade + permissões. Veja stderr do pg_dump |
| `prepared statement ... does not exist` | Tentando usar Transaction Pooler com `prepare: true` | Confirme `prepare: false` em src/lib/db/index.ts |
| Studio recusa abrir | NODE_ENV=production OU URL prod-like | Mude pra dev; nunca abra Studio em prod |
| Connection count cresce em dev | HMR criando pools | Confirme `globalThis` cache em src/lib/db/index.ts |
| Migrations concorrentes não serializam | URL aponta para Transaction Pooler (6543) | Ver "Pooler ports" abaixo — scripts já swappam automaticamente |

## Pooler ports — quando usar 6543 vs 5432

Supabase expõe três modos de conexão para o mesmo projeto:

| Modo | Porta | Backend sticky? | Quem usa |
|---|---|---|---|
| Transaction Pooler | 6543 | NÃO (libera por transação) | App runtime (`src/lib/db/index.ts`, Next serverless) |
| Session Pooler | 5432 | SIM (sticky por sessão) | **Migrations + backups** (scripts `db:*:prod`) |
| Direct | 5432 (sem `pooler.` no host) | SIM | Tools que precisam superuser (raro) |

**Por quê**: `pg_advisory_lock(N)` é session-scoped. Em Transaction Pooler o backend
muda entre lock e unlock — quebra a serialização. Empiricamente validado em C1
(teste 1.6.11): dois processos rodando contra 6543 obtiveram o lock simultaneamente.
Rodando contra 5432, serializaram corretamente.

**Configuração**: você pode setar `DATABASE_URL_PROD` apontando para qualquer um
dos dois — os scripts `db:migrate:prod` e `db:backup:prod` automaticamente fazem
swap `:6543/` → `:5432/` antes de conectar. App runtime mantém 6543 (Vercel/Next
precisa).

## Quarterly disaster-recovery drill

Uma vez por trimestre (calendário): valide que backup é restaurável.

1. Crie um novo Supabase project temporário (`qoro-dr-test`).
2. `pnpm db:backup:prod` → último dump.
3. `psql "$DR_TEST_URL" < backups/manual-<ts>.sql` → restaura.
4. Compare schema (`\dt`, `\d <table>`) e contagens de rows com prod.
5. Documente resultado em `docs/runbooks/dr-drills.md` (criar quando tiver primeiro cliente).
6. Delete o project temporário.
