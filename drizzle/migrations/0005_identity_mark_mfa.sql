-- =====================================================================
-- 0005_identity_mark_mfa.sql
-- C3 — Self-service mutation function controlada (D31).
--
-- D31 proíbe broad UPDATE policy em profiles. Mas precisamos permitir que o
-- próprio user marque mfa_enrolled_at após completar enrollment TOTP. Padrão:
-- coluna-a-coluna via SECURITY DEFINER function que usa auth.uid() internamente.
--
-- ADR-010 patterns aplicados: VOLATILE, search_path fixo, schema-qualified refs,
-- sem EXECUTE dinâmico, sem concatenação. GRANT só para authenticated (anon
-- nunca tem session — não há razão para EXECUTE).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.mark_mfa_enrolled(p_enrolled boolean)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'mark_mfa_enrolled requer user autenticado'
      USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles
     SET mfa_enrolled_at = CASE WHEN p_enrolled THEN now() ELSE NULL END
   WHERE id = v_user_id;
END $$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION public.mark_mfa_enrolled(boolean) FROM PUBLIC;--> statement-breakpoint
GRANT  EXECUTE ON FUNCTION public.mark_mfa_enrolled(boolean) TO authenticated;--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('c3-identity-mark-mfa')
ON CONFLICT (version) DO NOTHING;
