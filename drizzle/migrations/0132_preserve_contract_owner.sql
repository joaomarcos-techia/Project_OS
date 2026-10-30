-- auth.users -> profiles usa ON DELETE CASCADE (0003), mas a clínica e a
-- assinatura sobrevivem. Não permitir que um contrato vigente perca seu último
-- titular aceito e ativo por hard-delete, soft-delete ou troca de papel.
CREATE OR REPLACE FUNCTION public.preserve_contract_owner() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.role <> 'owner' OR OLD.ativo IS NOT TRUE
    OR OLD.deleted_at IS NOT NULL OR OLD.invite_accepted_at IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.role = 'owner' AND NEW.ativo IS TRUE
    AND NEW.deleted_at IS NULL AND NEW.invite_accepted_at IS NOT NULL
    AND NEW.clinic_id = OLD.clinic_id THEN
    RETURN NEW;
  END IF;

  -- A exclusão da própria clínica remove os perfis por cascade. Nesse caso a
  -- linha da clínica já não é visível; a proteção cobre somente contrato vivo.
  PERFORM 1 FROM public.clinics WHERE id = OLD.clinic_id FOR UPDATE;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE clinic_id = OLD.clinic_id AND billing_status <> 'cancelled'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE clinic_id = OLD.clinic_id AND id <> OLD.id
      AND role = 'owner' AND ativo IS TRUE AND deleted_at IS NULL
      AND invite_accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'O último titular de uma assinatura vigente não pode ser removido'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'contract_last_owner';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.preserve_contract_owner() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER profiles_preserve_contract_owner
  BEFORE DELETE OR UPDATE OF clinic_id, role, ativo, deleted_at, invite_accepted_at
  ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.preserve_contract_owner();
--> statement-breakpoint
INSERT INTO public._schema_version (version) VALUES ('0132-preserve-contract-owner')
ON CONFLICT (version) DO NOTHING;
