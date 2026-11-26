-- Operator-only catalog/history snapshot. No application rows or external calls.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
SELECT jsonb_build_object(
  'readOnly', current_setting('transaction_read_only'),
  'operational', jsonb_build_object(
    'ssl', (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),
    'statementTimeout', current_setting('statement_timeout'),
    'lockTimeout', current_setting('lock_timeout'),
    'longTransactions', (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()
      AND pid<>pg_backend_pid() AND xact_start IS NOT NULL AND now()-xact_start>interval '30 seconds'),
    'waitingLocks', (SELECT count(*)::int FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
      WHERE a.datname=current_database() AND NOT l.granted)
  ),
  'history', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'hash',hash,
    'created_at',created_at::text) ORDER BY id),'[]'::jsonb) FROM drizzle.__drizzle_migrations),
  'schema', jsonb_build_object(
    'tables', (SELECT coalesce(jsonb_agg(jsonb_build_object('name',n.nspname||'.'||c.relname,
      'secured',c.relrowsecurity AND c.relforcerowsecurity)),'[]'::jsonb)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p')
      AND (n.nspname='billing_gateway' OR (n.nspname='public' AND c.relname IN
        ('subscriptions','invoices','profiles','patient_charges','trial_access_policies','trial_resource_usage')))),
    'billingProviderColumn', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='subscriptions' AND column_name='billing_provider'),
    'futureTables', (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p') AND (n.nspname='billing_gateway' OR (n.nspname='public'
        AND c.relname IN ('trial_access_policies','trial_resource_usage')))),
    'periodColumns', (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='billing_gateway'
      AND table_name='recurring_payment_observations'
      AND column_name IN ('provider_period_start','provider_period_end','source_readback_id')),
    'originTriggers', (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal AND tgenabled IN ('O','A')
      AND tgname IN ('subscription_check_gateway_origin','binding_check_subscription_origin')),
    'periodConstraint', EXISTS(SELECT 1 FROM pg_constraint
      WHERE conrelid=to_regclass('billing_gateway.recurring_payment_observations')
      AND conname='recurring_period_snapshot_required' AND convalidated),
    'invalidGatewayIndexes', (SELECT count(*)::int FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='billing_gateway' AND NOT i.indisvalid)
  )
);
COMMIT;
