-- =====================================================================
-- 0041 — O aceite do convite vira GATE de sessão (I-3).
--
-- PROBLEMA (auditoria de identidade I-3): o profile convidado nasce
-- `ativo=true` e `invite_accepted_at=null`. Ao clicar o magic-link, o convidado
-- ganha uma sessão AAL1 COMPLETA — pode usar o app ANTES de definir a senha.
-- `invite_accepted_at` era só TRACKING, não um GATE. Como o link é distribuído
-- out-of-band (WhatsApp, ADR-034), um link vazado = tomada do assento com o
-- acesso pleno do papel convidado, sem nunca provar posse do e-mail via senha.
--
-- FIX ARQUITETURAL: o aceite passa a ser condição de DENY-BY-DEFAULT no hook.
-- Enquanto `invite_accepted_at IS NULL`, o custom_access_token_hook devolve o
-- token SEM as claims da app → getCurrentUser retorna null (INVITE_PENDING) → o
-- convidado tem uma sessão que só serve para DEFINIR A SENHA (/convite, fora do
-- matcher do middleware), nada mais. O gate é server-authoritative: o campo de
-- tracking vira gate real, sem estado inválido novo.
--
-- ORTOGONAL a `ativo`: o profile CONTINUA nascendo `ativo=true` (a quota de
-- assentos conta pendente — ADR-024). "Pendente" e "inativo" são coisas
-- diferentes: pendente = ainda não provou o e-mail; inativo = desligado.
--
-- 🔴 QUEM CRIA PROFILE PRECISA SETAR invite_accepted_at, OU É LOCKOUT:
--   - saga de onboarding (owner): JÁ seta now() ("owner nasce ACEITO").
--   - members.ts (convite): seta null DE PROPÓSITO — é o pendente que este gate
--     protege; o aceite (/convite) chama markInviteAccepted.
--   - scripts/seed-super-admin: CORRIGIDO nesta leva para setar now() — senão o
--     super_admin semeado ficaria sem claims (lockout do painel).
--
-- ⚠️ COPIADO DA 0006 (0006_identity_postrest_compat.sql), NUNCA da 0003: o hook
-- injeta 'app_role' (não 'role' — PostgREST reserva 'role' p/ o Postgres role).
-- Recriar a partir da 0003 regrediria o fix e quebraria TODA query supabase-js
-- de super_admin com "role super_admin does not exist".
--
-- Não-destrutiva: CREATE OR REPLACE de view/função + UPDATE de backfill.
-- =====================================================================

-- 1. Backfill DEFENSIVO — a 0037 já backfillou os legados (invite_accepted_at =
--    created_at); isto cobre só profiles criados ENTRE a 0037 e esta migration
--    (ex.: seeds antigos). Idempotente. Roda ANTES de ligar o gate para não
--    deslogar ninguém que já era membro efetivo.
UPDATE public.profiles SET invite_accepted_at = created_at WHERE invite_accepted_at IS NULL;--> statement-breakpoint

-- 1b. DEFAULT now() — "criação confiável = aceito". A FRONTEIRA DE SEGURANÇA do
--     gate é o fluxo de convite (members.ts) setar invite_accepted_at=NULL
--     EXPLICITAMENTE — esse é o único caminho não-confiável (link out-of-band). Todo
--     o resto (seeds, onboarding saga, super_admin, futura criação admin) é criação
--     server-side confiável e deve nascer ACEITO. Sem este default, cada script/
--     saga que esquecesse a coluna criaria um usuário PENDENTE e travado (lockout) —
--     fail-closed no lugar errado. Com ele, o gate continua fail-closed ONDE IMPORTA
--     (a INSERT do convite passa NULL de propósito) e o resto fica robusto.
ALTER TABLE public.profiles ALTER COLUMN invite_accepted_at SET DEFAULT now();--> statement-breakpoint

-- 2. effective_permissions_v — expõe invite_accepted_at (coluna nova ao FINAL,
--    requisito do CREATE OR REPLACE VIEW: colunas existentes na mesma ordem).
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
        WHERE user_id = p.id AND granted = true
        EXCEPT
        SELECT permission_code
        FROM public.user_permission_overrides
        WHERE user_id = p.id AND granted = false
      ) AS eff
    ),
    ARRAY[]::text[]
  ) AS permissions,
  p.invite_accepted_at
FROM public.profiles p;--> statement-breakpoint

-- 3. Hook — mesma lógica da 0006 + a nova condição de deny (invite pendente).
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
  v_claims jsonb;
BEGIN
  v_user_id := (event ->> 'user_id')::uuid;

  SELECT role, clinic_id, ativo, deleted_at, claims_version, permissions, invite_accepted_at
    INTO v_role, v_clinic_id, v_ativo, v_deleted_at, v_claims_version, v_permissions, v_invite_accepted_at
    FROM public.effective_permissions_v
   WHERE user_id = v_user_id;

  IF NOT FOUND
     OR v_ativo IS NOT TRUE
     OR v_deleted_at IS NOT NULL
     OR v_invite_accepted_at IS NULL        -- I-3: convite pendente → sessão só para definir senha
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

  -- 'app_role' (não 'role' — PostgREST reserva 'role' para Postgres role)
  v_claims := COALESCE(event -> 'claims', '{}'::jsonb)
    || jsonb_build_object(
         'clinic_id', CASE WHEN v_clinic_id IS NULL THEN to_jsonb(NULL::text) ELSE to_jsonb(v_clinic_id::text) END,
         'app_role', to_jsonb(v_role),
         'permissions', to_jsonb(v_permissions),
         'claims_version', to_jsonb(v_claims_version),
         'super_admin', to_jsonb(v_role = 'super_admin')
       );

  RETURN jsonb_set(event, '{claims}', v_claims);
END $$;--> statement-breakpoint

-- Schema version snapshot
INSERT INTO _schema_version (version) VALUES ('identity-invite-acceptance-gate')
ON CONFLICT (version) DO NOTHING;
