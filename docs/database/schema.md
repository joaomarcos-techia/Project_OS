# Banco, migrations e multi-tenancy

## Status

Canonical — schema versionado e modelo de acesso a dados.

## Source of Truth

1. `drizzle/migrations/*.sql` e `drizzle/migrations/meta` para evolução.
2. `src/contexts/*/schema.ts` e `src/lib/db/schema` para contratos TypeScript.
3. `src/lib/db/index.ts`, `tenant.ts` e `rls.ts` para execução.

O repositório contém 80 migrations SQL (`0000`–`0079`) e 90 tabelas Drizzle. Isso não comprova, sozinho, que um ambiente externo aplicou todas elas.

## Evidência conectada — DEV, 2026-08-18

O localhost está configurado para o Supabase DEV remoto via Transaction Pooler; o PostgreSQL que escuta na máquina em `:5432` não é o banco usado pela aplicação.

- os 80 registros de `drizzle.__drizzle_migrations` têm a mesma ordem e timestamps do journal local;
- 42 diferenças de hash são explicadas somente por LF/CRLF;
- `0051_ai_conversations_panel` possui drift real entre o arquivo atual e o hash aplicado. Coluna, FK, permissions, bundles e `_schema_version` esperados foram confirmados no banco, mas o SQL aplicado original não pode ser reconstruído pelo catálogo;
- 89/89 tabelas lógicas da aplicação, excluindo `_schema_version`, têm RLS habilitado e forçado. As 28 partições físicas usam as policies do pai e não têm `FORCE` próprio;
- `qoro_runtime` conecta pelo pooler como `LOGIN`, `NOBYPASSRLS`, sem superuser/DDL, pode assumir `authenticated` e recebe `statement_timeout=30s`/`lock_timeout=15s`;
- leitura direta ou como `authenticated` sem tenant GUC retornou zero. Com dois tenants distintos, cada transação enxergou somente as linhas do tenant selecionado.

O ambiente PROD não foi usado para validar migrations/grants/RLS nesta rodada.

## Inventário por owner

| Owner | Tabelas | Principais entidades |
| --- | ---: | --- |
| tenancy | 3 | `clinics`, `clinic_units`, `_reserved_slugs` |
| identity | 5 | `profiles`, permissions/overrides, `login_attempts` |
| onboarding | 1 | `clinic_invites` |
| patient | 11 | patients, PII complementar, consents, merges e LGPD |
| scheduling | 14 | appointments, disponibilidade, recursos, import, filas e logs |
| clinical | 5 | prontuários/versões, prescrições, documentos e templates |
| financial | 8 | métodos, fornecedores, lançamentos, pagamentos e caixa |
| messaging | 5 | números, inbound/outbound, status e quarentena |
| ai-agent | 7 | conversas, mensagens, config, actions, handoff, failures e jobs |
| billing | 19 | planos/preços, provisionamento, assinatura, invoices, uso e eventos |
| feedback | 2 | sugestões e histórico |
| infraestrutura | 10 | versão, audit, cron, idempotência, outbox, admin e métricas |

## Pools

| Pool | URL | Máximo atual | Uso |
| --- | --- | ---: | --- |
| `db` | `DATABASE_URL_RUNTIME` ou `DATABASE_URL` | 6 | request tenant-scoped |
| `dbAdmin` | `DATABASE_URL` | 8 | plataforma, provisionamento e operações privilegiadas |
| `dbWorker` | `DATABASE_URL` | 2 | reserva/finalização de jobs e advisory lock |

Todos usam postgres.js com `prepare: false`, SSL requerido e timeouts configurados no papel/ambiente. Não troque um pool por outro por conveniência.

## RLS e contexto

`withTenant(clinicId, fn, actorUserId?)`:

1. abre uma transação no pool runtime;
2. executa `SET LOCAL ROLE authenticated`;
3. define `app.current_clinic` e, quando presente, `app.current_user`;
4. chama `fn(tx)` na mesma conexão;
5. commit/rollback remove os GUCs locais.

Tabelas tenant-scoped usam `ENABLE ROW LEVEL SECURITY` e `FORCE ROW LEVEL SECURITY`. As policies aceitam o contexto controlado do backend e/ou claims JWT conforme o tipo de tabela. Catálogos globais e tabelas de plataforma têm policies específicas; RBAC de tela/ação não é substituído por RLS.

O fallback de `db` para `DATABASE_URL` pode usar um papel com `BYPASSRLS`. Em produção, configure `DATABASE_URL_RUNTIME` com um papel `NOBYPASSRLS`; siga [o runbook](../runbooks/runtime-role-nobypassrls.md).

## Migrations

- São append-only e ordenadas pelo prefixo numérico.
- Um arquivo já aplicado nunca deve ser reescrito. O drift da `0051` deve ser tratado por diagnóstico e, se necessário, nova migration aditiva.
- O gate `pnpm check:migrations` rejeita operações destrutivas não autorizadas.
- Aplicação usa lock e registro de versão; detalhes em [runbooks/migrations.md](../runbooks/migrations.md).
- Schema Drizzle e migration devem mudar juntos.
- Rodar migration, seed produtivo, restore ou exclusão exige autorização e ambiente explicitamente identificado.

## Constraints relevantes

- slots/recursos de agenda têm proteções de unicidade/overlap;
- prontuário assinado tem imutabilidade e caminho auditado de correção;
- outbox e idempotency keys impõem deduplicação persistente;
- eventos de auditoria e mensagens de IA usam particionamento gerenciado por cron;
- valores monetários são `numeric(12,2)` e cálculos de domínio usam centavos.

## Verificação

- estrutura local: `pnpm arch:db-check` e `pnpm check:migrations`;
- banco conectado: consultas read-only do catálogo e testes comportamentais descritos no [runbook do papel runtime](../runbooks/runtime-role-nobypassrls.md), apenas no ambiente autorizado;
- migrations/grants/RLS em produção: `REQUIRES_MANUAL_VALIDATION`.
