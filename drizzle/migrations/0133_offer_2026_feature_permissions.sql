-- 0133 — Entitlements da nova Clínica na resolução de permissões.
-- Não altera preços, limites, contratos, dados financeiros ou a família legada.
-- Consultório/Solo continuam com o bundle seguro por função, sem overrides.
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
                AND pl.code IN ('clinica', 'pro', 'clinica_2026_2', 'clinica_2026_3', 'clinica_2026_4', 'clinica_2026_5')
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
                AND pl.code IN ('clinica', 'pro', 'clinica_2026_2', 'clinica_2026_3', 'clinica_2026_4', 'clinica_2026_5')
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
       AND pl.code IN ('clinica', 'pro', 'clinica_2026_2', 'clinica_2026_3', 'clinica_2026_4', 'clinica_2026_5')
  ) AS granular_permissions_enabled
FROM public.profiles p;
--> statement-breakpoint
-- Invalida somente claims da família nova; o hook existente lê a view corrigida.
UPDATE public.profiles p
   SET claims_version = p.claims_version + 1
 WHERE EXISTS (
   SELECT 1 FROM public.subscriptions s
   JOIN public.plans pl ON pl.id = s.plan_id
   WHERE s.clinic_id = p.clinic_id
     AND pl.code IN ('consultorio_2026', 'clinica_2026_2', 'clinica_2026_3', 'clinica_2026_4', 'clinica_2026_5')
 );
--> statement-breakpoint
INSERT INTO _schema_version (version) VALUES ('0133-offer-2026-feature-permissions')
ON CONFLICT (version) DO NOTHING;
