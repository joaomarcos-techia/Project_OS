-- Reversão da candidata 0171 (S5). Remove os gatilhos (do pai, das partições e de hi_account_events) e as duas
-- funções. NÃO devolve os privilégios revogados (UPDATE/DELETE/TRUNCATE): o app não os usa, e devolvê-los exige
-- GRANT explícito com decisão registrada.
-- ATENÇÃO: reverter reabre a possibilidade de editar a trilha; só com decisão registrada.
DO $$
DECLARE part regclass;
BEGIN
  FOR part IN SELECT i.inhrelid::regclass FROM pg_inherits i WHERE i.inhparent = 'public.audit_events'::regclass LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_events_append_only_stmt ON %s', part);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS audit_events_append_only_row ON public.audit_events;
DROP TRIGGER IF EXISTS audit_events_append_only_stmt ON public.audit_events;
DROP TRIGGER IF EXISTS hi_account_events_append_only_row ON public.hi_account_events;
DROP TRIGGER IF EXISTS hi_account_events_append_only_stmt ON public.hi_account_events;
DROP FUNCTION IF EXISTS public.clinic_audit_seal_partitions();
DROP FUNCTION IF EXISTS public.clinic_audit_append_only();
DELETE FROM public._schema_version WHERE version = '0171-audit-trails-append-only';
