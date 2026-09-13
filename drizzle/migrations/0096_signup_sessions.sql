CREATE TABLE IF NOT EXISTS "signup_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'initiated' NOT NULL,
	"risk_level" integer DEFAULT 0 NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signup_sessions_token_hash_unique" UNIQUE("token_hash")
);--> statement-breakpoint

-- =====================================================================
-- hand-edit — ADR-060 (fatia O-2a): sessão anônima do cadastro autônomo.
--
-- Categoria (ADR-007 §10): GLOBAL PROTECTED, como `clinic_invites`. Sem
-- `clinic_id` porque a linha nasce ANTES de existir clínica. `withTenant` não
-- protege esta tabela — o que a protege é RLS sem policy + grant mínimo.
--
-- O QUE ELA NÃO GUARDA, e é decisão (ADR-060 §3): nome, e-mail, telefone,
-- senha, cartão ou atribuição. As colunas do §21.5 que guardariam isso entram
-- nas fatias que as escrevem. Enquanto for assim, o janitor APAGA a linha e não
-- há nada a anonimizar.
-- =====================================================================

-- 1. CHECK de status: SÓ os estados que a fatia O-2a pode produzir ------
-- `text` + CHECK, não `pgEnum`, de propósito:
--   (a) o CHECK lista só o escopo desta fatia, então o BANCO recusa uma
--       transição fora dela — o congelamento vira constraint, não comentário;
--   (b) estender depois é DROP/ADD CONSTRAINT, sem a armadilha do
--       `ALTER TYPE ... ADD VALUE` (valor novo inutilizável na mesma transação).
-- As fatias seguintes SUBSTITUEM esta constraint acrescentando seus estados.
ALTER TABLE "signup_sessions"
  ADD CONSTRAINT "signup_sessions_status_check"
  CHECK ("status" IN ('initiated', 'expired', 'blocked'));--> statement-breakpoint

-- 2. Índices ------------------------------------------------------------
-- `token_hash` já tem índice pelo UNIQUE. Este aqui serve aos dois caminhos
-- quentes da fatia: o janitor (varre vencidas) e o teto (conta as vivas).
CREATE INDEX IF NOT EXISTS "signup_sessions_status_idle_idx"
  ON "signup_sessions" USING btree ("status", "idle_expires_at");--> statement-breakpoint

-- 3. Trigger de updated_at (set_updated_at() instalada em 0001) ---------
CREATE TRIGGER trg_signup_sessions_updated_at
  BEFORE UPDATE ON signup_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- 4. RLS: ENABLE + FORCE, SEM NENHUMA POLICY ---------------------------
-- Sem policy, RLS nega por padrão para qualquer role não-BYPASSRLS. É o mesmo
-- desenho ops-only de `cron_heartbeats` (0029): quem lê/escreve é o
-- service_role, via os endpoints de onboarding — o navegador nunca toca a
-- tabela direto.
ALTER TABLE "signup_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "signup_sessions" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint

-- 5. Grants: mínimo, e com REVOKE EXPLÍCITO ----------------------------
-- O REVOKE não é cerimônia. A 0045 consertou a causa-raiz do default ACL do
-- Supabase SÓ para `anon` (REVOKE ALL ON TABLES); para `authenticated` ela
-- revogou apenas TRUNCATE/REFERENCES/TRIGGER. Logo, tabela NOVA ainda nasce
-- com SELECT/INSERT/UPDATE/DELETE para `authenticated`, e hoje só a RLS a
-- segura. Aqui a RLS seguraria — mas privilégio que não deveria existir não
-- deve depender de uma segunda camada para ser inofensivo.
REVOKE ALL ON signup_sessions FROM anon;--> statement-breakpoint
REVOKE ALL ON signup_sessions FROM authenticated;--> statement-breakpoint
-- DELETE é do janitor: a retenção desta tabela é apagar, não arquivar.
GRANT SELECT, INSERT, UPDATE, DELETE ON signup_sessions TO service_role;--> statement-breakpoint

-- 6. SCHEMA VERSION SNAPSHOT -------------------------------------------
INSERT INTO _schema_version (version) VALUES ('signup-sessions-o2a')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
