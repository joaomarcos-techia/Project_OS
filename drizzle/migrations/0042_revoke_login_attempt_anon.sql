-- =====================================================================
-- 0042 — record_login_attempt: REVOKE EXECUTE de anon (I-11a).
--
-- PROBLEMA (auditoria de identidade I-11a): `record_login_attempt(text,inet,
-- boolean)` é SECURITY DEFINER e estava GRANT a `anon`. Via PostgREST, um
-- anônimo podia injetar linhas FORJADAS em `login_attempts` (poluição da
-- auditoria pré-auth). O `email_hash` exige o pepper secreto (LOGIN_HASH_PEPPER),
-- então não se mira uma vítima com precisão — mas o vetor de poluição existe.
--
-- ⚠️ SUPERSEDE A DECISÃO DA 0038, que manteve o grant de anon de propósito,
-- alegando que "o login (login/actions.ts) chama via supabase.rpc no cliente SSR,
-- cujo papel é anon — anon PRECISA de EXECUTE". O motivo não se sustenta:
-- `loginAction` é uma SERVER ACTION (Node), então chamar como `anon` era uma
-- ESCOLHA, não uma necessidade. O call-site foi movido para
-- `src/lib/auth/login-audit.ts`, que chama `record_login_attempt` via `dbAdmin`
-- (service_role — que mantém EXECUTE). A auditoria de login continua funcionando,
-- inclusive no caminho de e-mail inexistente (é a mesma action server-side).
--
-- PRESERVA ADR-008 D9: INSERT em login_attempts continua SÓ pela função SECURITY
-- DEFINER. Só muda QUEM pode executá-la: authenticated/service_role/postgres, não
-- mais anon.
--
-- ⚠️ Se a dívida D1 (DATABASE_URL_RUNTIME — pool role sem BYPASSRLS) for
-- provisionada, esse role precisará de EXECUTE aqui (o login roda por ele). Anotar
-- na provisão do role.
--
-- Advisor: o `anon_security_definer_function_executable` para esta função DEIXA
-- de ser esperado (a 0038 dizia que era) — agora anon não a executa mais.
--
-- Idempotente e não-destrutiva: só um REVOKE.
-- =====================================================================

REVOKE EXECUTE ON FUNCTION public.record_login_attempt(text, inet, boolean) FROM anon;--> statement-breakpoint

-- Schema version snapshot
INSERT INTO _schema_version (version) VALUES ('identity-revoke-login-attempt-anon')
ON CONFLICT (version) DO NOTHING;
