-- =====================================================================
-- 0071_runtime_role_timeouts.sql
-- Fail-fast REAL para o pool runtime: statement_timeout=30s / lock_timeout=15s
-- a nível de ROLE, não de conexão.
--
-- ── O bug que isto conserta ──────────────────────────────────────────
-- `sharedOpts.connection = { statement_timeout, lock_timeout }` em
-- src/lib/db/index.ts é passado no startup da conexão postgres.js. Contra o
-- Supabase **Transaction Pooler (Supavisor, porta 6543)** esses parâmetros de
-- sessão NÃO são propagados ao backend — comprovado empiricamente:
--   SHOW statement_timeout  -> 2min   (não 30s)
--   SHOW lock_timeout       -> 0      (não 15s)
-- Ou seja: a proteção "fail-fast em 30s / lock 15s" que o código documenta
-- simplesmente NÃO existe no runtime pooled. Uma query travada roda até o
-- limite da plataforma (o "loading infinito" que o comentário em index.ts diz
-- evitar). O caminho correto no Supavisor é fixar o GUC a nível de ROLE
-- (`ALTER ROLE ... SET`), que o Postgres aplica no login do backend.
--
-- ── Por que SÓ `qoro_runtime` (e NÃO `postgres`) ─────────────────────
-- Mapa role↔pool (ver src/lib/db/index.ts + docs/runbooks/runtime-role-nobypassrls.md):
--   • `db` runtime (prod/preview) → login `qoro_runtime` (NOBYPASSRLS, DEDICADA
--     ao runtime user-facing). É AQUI que o "loading infinito" dói.
--   • `db` runtime (dev local), `dbAdmin`, `dbWorker` → login `postgres`.
--   • `postgres` é TAMBÉM a role de `drizzle-kit migrate` (db:migrate:{dev,prod})
--     e de TODO cron (patient-hard-delete, audit-partition-maintenance,
--     metrics-rollup). Um cap de 30s/15s em `postgres` mataria migrations com
--     backfill/CREATE INDEX/lock (padrão das 0046–0049) e scans de cron
--     legítimos. Backups via pg_dump são imunes (pg_dump emite
--     `SET statement_timeout=0` na própria conexão), mas migrations/cron não.
-- Por isso o timeout entra SÓ na role dedicada. `qoro_runtime` não é usada por
-- nenhum caminho de migration/backup/cron — alterá-la é seguro por construção.
--
-- Isto NÃO cobre dbAdmin/dbWorker/dev-runtime (role `postgres`), de propósito.
-- Se algum dia quisermos fail-fast lá, é per-transação (`SET LOCAL
-- statement_timeout`) nos wrappers, nunca a nível da role `postgres`.
--
-- ── Persiste sob `SET LOCAL ROLE authenticated`? Sim ────────────────
-- O `withTenant` faz `SET LOCAL ROLE authenticated` (tenant.ts:60). Config de
-- role via `ALTER ROLE ... SET` é carregada no LOGIN da role autenticada
-- (`qoro_runtime`); `SET ROLE` NÃO recarrega GUCs — logo o 30s/15s do login
-- sobrevive à troca de role dentro da transação. (E `authenticated` não recebe
-- cap aqui, então não há sobreposição.)
--
-- ── Guard `pg_roles` (portabilidade) ─────────────────────────────────
-- `qoro_runtime` é provisionada FORA das migrations (runbook, senha é segredo,
-- env-específica). Existe em qoro-dev e qoro-prod, mas NÃO num self-host novo /
-- CI efêmero / DB de preview novo. Sem o guard, `ALTER ROLE qoro_runtime` quebra
-- a migration nesses ambientes. Com o guard, vira no-op silencioso (com NOTICE).
-- `EXECUTE` dinâmico evita qualquer ambiguidade de utility-command em PL/pgSQL.
--
-- ── Validação pós-migration (via pooler, não presumir) ───────────────
-- Conectar como qoro_runtime.<ref> no :6543 e:  SHOW statement_timeout; -> 30s
--                                                SHOW lock_timeout;      -> 15s
-- Conexões já abertas mantêm o valor antigo até reciclar (max_lifetime 30min /
-- idle_timeout 20s em sharedOpts) — abra uma sessão nova para validar.
-- =====================================================================

DO $mig$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qoro_runtime') THEN
    EXECUTE $q$ALTER ROLE qoro_runtime SET statement_timeout = '30s'$q$;
    EXECUTE $q$ALTER ROLE qoro_runtime SET lock_timeout = '15s'$q$;
    RAISE NOTICE '[0071] qoro_runtime: statement_timeout=30s, lock_timeout=15s aplicados';
  ELSE
    RAISE NOTICE '[0071] role qoro_runtime ausente — pulando (dev/CI/self-host sem runtime role). O runtime cai em DATABASE_URL/postgres, que NÃO recebe cap aqui de propósito.';
  END IF;
END
$mig$;--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0071-runtime-role-timeouts')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
