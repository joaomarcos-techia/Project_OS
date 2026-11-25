-- Reversão da candidata 0171 (S5). Remove os gatilhos e devolve UPDATE/DELETE aos papéis que tinham antes.
-- ATENÇÃO: reverter reabre a possibilidade de editar a trilha; só com decisão registrada.
DROP TRIGGER IF EXISTS audit_events_append_only_row ON public.audit_events;
DROP TRIGGER IF EXISTS audit_events_append_only_stmt ON public.audit_events;
DROP TRIGGER IF EXISTS hi_account_events_append_only_row ON public.hi_account_events;
DROP TRIGGER IF EXISTS hi_account_events_append_only_stmt ON public.hi_account_events;
DROP FUNCTION IF EXISTS public.clinic_audit_append_only();
DELETE FROM public._schema_version WHERE version = '0171-audit-trails-append-only';
