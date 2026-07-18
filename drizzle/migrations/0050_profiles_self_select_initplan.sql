-- =====================================================================
-- 0050 — A14 (resíduo): envolve auth.uid() em InitPlan na policy
-- `profiles_self_select`.
--
-- A 0045 envolveu as 65 policies que chamam os helpers de TENANT
-- (current_clinic_id/is_super_admin/app.current_clinic). Esta policy escapou
-- porque usa `auth.uid()` direto — o advisor `auth_rls_initplan` a pegou
-- separadamente. `auth.uid()` é STABLE, então o wrap `(select auth.uid())` é
-- seguro e dá o mesmo hoist (1× por query, não por linha).
--
-- profiles_self_select (0006): cada usuário lê o PRÓPRIO profile (auth.uid()=id),
-- independente de clínica — é o self-read que o hook de claims e a rota de perfil
-- usam. Semântica inalterada; só o plano de execução muda.
-- =====================================================================

DROP POLICY IF EXISTS profiles_self_select ON profiles;--> statement-breakpoint
CREATE POLICY profiles_self_select ON profiles FOR SELECT
  USING ((select auth.uid()) = id);--> statement-breakpoint

-- Schema version snapshot
INSERT INTO _schema_version (version) VALUES ('profiles-self-select-initplan')
ON CONFLICT (version) DO NOTHING;
