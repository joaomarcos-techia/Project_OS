-- =====================================================================
-- CANDIDATA 0163 — super_admin_actions append-only no banco.
-- Fora de drizzle/migrations e do journal (mesmo modelo da 0159 do #53 e da 0162 do #55).
-- NÃO APLICADA em nenhum banco persistente. Prova: scripts/security/super-admin-actions-append-only-db.ts
-- (Postgres descartável, dados sintéticos).
--
-- ── O problema (diagnóstico de 15/11/2026) ───────────────────────────
-- `super_admin_actions` é a trilha forense da plataforma: sessão de suporte, exports e, desde o
-- PR #57, cada abertura do texto de conversa no console (`ai_conversation.content_viewed`).
-- A RLS (FORCE, sem política de UPDATE/DELETE) só protege quem a RLS alcança:
--   • `service_role` tem UPDATE/DELETE explícito (0010:81) e é BYPASSRLS no Supabase. Pelo default
--     ACL do Supabase na criação da tabela, provavelmente também tem TRUNCATE/REFERENCES/TRIGGER
--     (a 0045 tirou isso só de anon e authenticated);
--   • `postgres` (DATABASE_URL: dbAdmin, dbWorker, scripts, migrador) é o DONO e é BYPASSRLS:
--     altera, apaga e esvazia a tabela;
--   • `authenticated` tem SELECT/INSERT (0010/0028) e a política de INSERT só pede
--     `is_super_admin()`, que lê `app_role` do JWT. Pela Data API, um token de super_admin
--     (sem AAL2, sem epoch) grava linha com qualquer ator, clínica, payload e `created_at`.
--     Nenhum código grava por esse caminho: todos os escritores usam dbAdmin
--     (superAdminAction, recordImpersonationAudit; no #57, superAdminAuditedRead);
--   • nenhum gatilho impede UPDATE/DELETE.
--
-- ── O que esta candidata faz ─────────────────────────────────────────
-- 1. Privilégio: nenhum papel além do dono fica com privilégio na tabela (PUBLIC, anon,
--    authenticated, service_role, qoro_runtime). As políticas de RLS ficam como estão.
-- 2. Gatilhos BEFORE: de linha para UPDATE/DELETE e de comando para o esvaziamento da tabela.
--    Disparam para QUALQUER papel, inclusive o dono, superuser e BYPASSRLS.
-- 3. ENABLE ALWAYS: `session_replication_role = replica` (o modo de restauração/importação) não
--    desliga a barreira.
-- 4. Sem válvula por GUC (como a `app.allow_signed_edit` da 0017): qualquer sessão consegue setar
--    um GUC. A única saída é DDL do dono (DISABLE/DROP TRIGGER, CREATE OR REPLACE da função), que
--    fica no histórico de migrations e no log do banco.
--
-- ── O que continua possível (fora do alcance de qualquer gatilho) ────
--   • DDL do dono: desligar/apagar o gatilho, trocar o corpo da função, ALTER COLUMN ... USING.
--     Detecção proposta: checagem do catálogo no /api/health (Fase 2). Ancoragem externa (hash
--     encadeado ou cópia WORM) é o risco `auditoria-sem-hash-chain` do registro de riscos;
--   • INSERT pelo dono com `created_at` retroativo (o app não faz; forçar `now()` num gatilho
--     quebraria a restauração por COPY);
--   • MAINTAIN (PG17) do dono: LOCK/VACUUM/REINDEX. Os outros papéis perdem com o REVOKE ALL.
--
-- ── Quem é afetado ───────────────────────────────────────────────────
--   • Escritores do app: nenhum (só INSERT pelo dono).
--   • `scripts/reset-prod-data.ts` (reset de pré-lançamento) faz `DELETE FROM super_admin_actions`
--     dentro da transação: com esta candidata o reset ABORTA INTEIRO (nada é apagado). A mesma
--     mudança que numerar esta candidata tira a tabela de TRANSIENT_TABLES.
--   • Backup e restauração: `pg_dump --clean` recria por DROP + COPY (INSERT); o gatilho e o
--     ENABLE ALWAYS vão no dump de schema, inclusive com `--no-acl`.
--
-- ── Número, `when` e composição ──────────────────────────────────────
-- 0163 é o próximo número livre em 15/11/2026 em todas as branches remotas: main 0135; #53
-- 0136–0142 + 0159 candidata (aplicada no DEV); #55 0143–0158, 0160, 0161 + 0162 candidata;
-- candidatas sem número do #55 ainda disputam a próxima posição. Número e `when` definitivos são
-- fixados NA AUTORIZAÇÃO (regra de docs/convenios/coordenacao-migrations.md §22): `when` maior que
-- o da última migration aplicada no DEV (0161 = 1795209773857) e maior que o da 0162 se ela entrar
-- antes. Em produção, entra DEPOIS da cauda #53 → #55 (o migrador do Drizzle pula em silêncio uma
-- entrada com `when` menor que a última aplicada).
-- Lock: CREATE TRIGGER e ENABLE ALWAYS pegam SHARE ROW EXCLUSIVE na trilha até o COMMIT do
-- migrador, e o INSERT da trilha espera. Aplicar como última entrada da publicação, com lock_timeout.
--
-- ── Gate check:migrations ────────────────────────────────────────────
-- O gate trata a palavra do esvaziamento como comando fora de GRANT/REVOKE. Esta candidata só a usa
-- no CREATE TRIGGER (o evento que o gatilho escuta) e depende da exceção preparada junto em
-- scripts/check-migration-safety.ts (teste em src/lib/db/migration-safety.test.ts). A função não
-- escreve a palavra: a mensagem usa TG_OP.
--
-- ── Reversão (provada no harness; restaura o estado das migrations 0010/0028) ──
-- reversão: DROP TRIGGER IF EXISTS super_admin_actions_append_only_stmt ON public.super_admin_actions;
-- reversão: DROP TRIGGER IF EXISTS super_admin_actions_append_only_row ON public.super_admin_actions;
-- reversão: DROP FUNCTION IF EXISTS public.super_admin_actions_append_only();
-- reversão: GRANT SELECT, INSERT ON public.super_admin_actions TO authenticated;
-- reversão: GRANT SELECT, INSERT, UPDATE, DELETE ON public.super_admin_actions TO service_role;
-- reversão: DELETE FROM _schema_version WHERE version = 'super-admin-actions-append-only';
-- O ACL herdado do Supabase (fora das migrations) não volta pela reversão: o pré-voo só leitura
-- guarda o `relacl` real para isso.
-- =====================================================================

-- 1. Privilégios ---------------------------------------------------------
-- Só o dono lê e grava. PUBLIC e anon nunca precisaram (a 0045 já tirou tudo de anon);
-- authenticated e service_role não têm leitor nem escritor no código; repetir é no-op.
REVOKE ALL ON public.super_admin_actions FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint

-- qoro_runtime é provisionada fora das migrations (runbook runtime-role-nobypassrls.md) e não existe
-- em CI/self-host. Tira só o privilégio DIRETO; o que ela herdaria de authenticated já saiu acima.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qoro_runtime') THEN
    EXECUTE 'REVOKE ALL ON public.super_admin_actions FROM qoro_runtime';
  END IF;
END
$$;--> statement-breakpoint

-- 2. Função do gatilho ---------------------------------------------------
-- SECURITY INVOKER, sem referência a objeto nenhum. ERRCODE 42501, o mesmo do privilégio negado:
-- todo caminho de alteração devolve o mesmo código, e a mensagem diz que foi a barreira.
CREATE OR REPLACE FUNCTION public.super_admin_actions_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'super_admin_actions é append-only: % recusado', TG_OP
    USING ERRCODE = '42501',
          HINT = 'A trilha da plataforma só aceita INSERT pelo dono da tabela.';
END
$$;--> statement-breakpoint

-- Função de gatilho não é RPC: fecha a superfície /rest/v1/rpc/ (padrão da 0038). O disparo não
-- depende de EXECUTE de quem altera.
REVOKE EXECUTE ON FUNCTION public.super_admin_actions_append_only() FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint

-- 3. Gatilhos ----------------------------------------------------------
DROP TRIGGER IF EXISTS super_admin_actions_append_only_row ON public.super_admin_actions;--> statement-breakpoint
CREATE TRIGGER super_admin_actions_append_only_row
  BEFORE UPDATE OR DELETE ON public.super_admin_actions
  FOR EACH ROW EXECUTE FUNCTION public.super_admin_actions_append_only();--> statement-breakpoint

DROP TRIGGER IF EXISTS super_admin_actions_append_only_stmt ON public.super_admin_actions;--> statement-breakpoint
CREATE TRIGGER super_admin_actions_append_only_stmt
  BEFORE TRUNCATE ON public.super_admin_actions
  FOR EACH STATEMENT EXECUTE FUNCTION public.super_admin_actions_append_only();--> statement-breakpoint

-- 4. ENABLE ALWAYS: dispara também com session_replication_role = replica ----
ALTER TABLE public.super_admin_actions ENABLE ALWAYS TRIGGER super_admin_actions_append_only_row;--> statement-breakpoint
ALTER TABLE public.super_admin_actions ENABLE ALWAYS TRIGGER super_admin_actions_append_only_stmt;--> statement-breakpoint

COMMENT ON TRIGGER super_admin_actions_append_only_row ON public.super_admin_actions IS
  'Trilha da plataforma append-only: recusa UPDATE e DELETE de qualquer papel, inclusive o dono e o modo replica.';--> statement-breakpoint
COMMENT ON TRIGGER super_admin_actions_append_only_stmt ON public.super_admin_actions IS
  'Trilha da plataforma append-only: recusa esvaziar a tabela, inclusive pelo dono e no modo replica.';--> statement-breakpoint

-- 5. Schema version snapshot ----------------------------------------------
INSERT INTO _schema_version (version) VALUES ('super-admin-actions-append-only')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
