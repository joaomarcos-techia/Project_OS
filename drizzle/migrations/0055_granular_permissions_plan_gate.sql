-- 0055 — Permissões granulares por plano
--
-- Overrides individuais só fazem parte dos planos Clínica e Pro. O bundle
-- padrão por papel continua disponível em todos os planos.

CREATE OR REPLACE VIEW public.effective_permissions_v
WITH (security_invoker=on)
AS
SELECT
  p.id AS user_id,
  p.role,
  p.clinic_id,
  p.ativo,
  p.deleted_at,
  p.claims_version,
  COALESCE(
    (
      SELECT array_agg(DISTINCT perm)
      FROM (
        SELECT permission_code AS perm
          FROM public.role_permissions
         WHERE role = p.role
        UNION
        SELECT permission_code
          FROM public.user_permission_overrides
         WHERE user_id = p.id
           AND granted = true
           AND EXISTS (
             SELECT 1
               FROM public.subscriptions s
               JOIN public.plans pl ON pl.id = s.plan_id
              WHERE s.clinic_id = p.clinic_id
                AND pl.code IN ('clinica', 'pro')
           )
        EXCEPT
        SELECT permission_code
          FROM public.user_permission_overrides
         WHERE user_id = p.id
           AND granted = false
           AND EXISTS (
             SELECT 1
               FROM public.subscriptions s
               JOIN public.plans pl ON pl.id = s.plan_id
              WHERE s.clinic_id = p.clinic_id
                AND pl.code IN ('clinica', 'pro')
           )
      ) AS eff
    ),
    ARRAY[]::text[]
  ) AS permissions,
  p.invite_accepted_at,
  EXISTS (
    SELECT 1
      FROM public.subscriptions s
      JOIN public.plans pl ON pl.id = s.plan_id
     WHERE s.clinic_id = p.clinic_id
       AND pl.code IN ('clinica', 'pro')
  ) AS granular_permissions_enabled
FROM public.profiles p;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_role text;
  v_clinic_id uuid;
  v_ativo boolean;
  v_deleted_at timestamptz;
  v_claims_version integer;
  v_permissions text[];
  v_invite_accepted_at timestamptz;
  v_granular_permissions_enabled boolean;
  v_claims jsonb;
BEGIN
  v_user_id := (event ->> 'user_id')::uuid;

  SELECT role, clinic_id, ativo, deleted_at, claims_version, permissions,
         invite_accepted_at, granular_permissions_enabled
    INTO v_role, v_clinic_id, v_ativo, v_deleted_at, v_claims_version, v_permissions,
         v_invite_accepted_at, v_granular_permissions_enabled
    FROM public.effective_permissions_v
   WHERE user_id = v_user_id;

  IF NOT FOUND
     OR v_ativo IS NOT TRUE
     OR v_deleted_at IS NOT NULL
     OR v_invite_accepted_at IS NULL
     OR v_role IS NULL
     OR v_permissions IS NULL
     OR (v_role <> 'super_admin' AND v_clinic_id IS NULL)
     OR (v_role = 'super_admin' AND v_clinic_id IS NOT NULL)
  THEN
    RETURN event;
  END IF;

  IF array_length(v_permissions, 1) > 128 THEN
    RAISE EXCEPTION 'custom_access_token_hook: user % has % permissions, exceeds cap of 128',
      v_user_id, array_length(v_permissions, 1);
  END IF;

  v_claims := COALESCE(event -> 'claims', '{}'::jsonb)
    || jsonb_build_object(
         'clinic_id', CASE WHEN v_clinic_id IS NULL THEN to_jsonb(NULL::text) ELSE to_jsonb(v_clinic_id::text) END,
         'app_role', to_jsonb(v_role),
         'permissions', to_jsonb(v_permissions),
         'claims_version', to_jsonb(v_claims_version),
         'super_admin', to_jsonb(v_role = 'super_admin'),
         'granular_permissions_enabled', to_jsonb(COALESCE(v_granular_permissions_enabled, false))
       );

  RETURN jsonb_set(event, '{claims}', v_claims);
END $$;
--> statement-breakpoint

-- Plano alterado → próximo request deve renovar as claims, inclusive quando a
-- alteração é um downgrade e há overrides antigos gravados.
CREATE OR REPLACE FUNCTION public.bump_plan_claims_version() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.profiles
     SET claims_version = claims_version + 1
   WHERE clinic_id = COALESCE(NEW.clinic_id, OLD.clinic_id);
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_subscriptions_bump_plan_claims ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_bump_plan_claims
AFTER INSERT OR UPDATE OF plan_id OR DELETE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.bump_plan_claims_version();
--> statement-breakpoint

-- Força renovação do JWT atual para que o claim novo seja aplicado também aos
-- usuários já logados no momento do deploy.
UPDATE public.profiles
   SET claims_version = claims_version + 1;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0055-granular-permissions-plan-gate')
ON CONFLICT (version) DO NOTHING;
