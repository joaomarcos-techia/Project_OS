-- Supabase default privileges grant ALL to service_role on new tables.
-- Remove inherited-at-creation grants, then restore only the intended writes.
-- No rows, existing migration hashes, prices or contracts are changed.
REVOKE ALL ON public.trial_access_policies, public.trial_resource_usage FROM service_role;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.trial_access_policies, public.trial_resource_usage TO service_role;
