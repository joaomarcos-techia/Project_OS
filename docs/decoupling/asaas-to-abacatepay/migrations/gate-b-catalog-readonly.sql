-- Operator supplement: execute only against an explicitly approved target.
-- Inventory, not an automatic drift approval or a migration. No clinical rows.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

SELECT jsonb_build_object('section','identity','readOnly',current_setting('transaction_read_only'),
  'database',current_database(),'serverVersion',current_setting('server_version'),
  'inRecovery',pg_is_in_recovery()) AS fact;

SELECT jsonb_build_object('section','relations','items',coalesce(jsonb_agg(jsonb_build_object(
  'name',n.nspname||'.'||c.relname,'kind',c.relkind,'rls',c.relrowsecurity,
  'forceRls',c.relforcerowsecurity,'grants',c.relacl::text,
  'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,
    'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
    'defaultHash',md5(coalesce(pg_get_expr(d.adbin,d.adrelid),''))) ORDER BY a.attnum)
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
  'viewHash',CASE WHEN c.relkind IN ('v','m') THEN md5(pg_get_viewdef(c.oid,true)) END
) ORDER BY n.nspname,c.relname),'[]'::jsonb)) AS fact
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','billing_gateway') AND c.relkind IN ('r','p','v','m');

SELECT jsonb_build_object('section','functions','items',coalesce(jsonb_agg(jsonb_build_object(
  'name',n.nspname||'.'||p.proname,'arguments',pg_get_function_identity_arguments(p.oid),
  'securityDefiner',p.prosecdef,'grants',p.proacl::text,
  'definitionHash',md5(pg_get_functiondef(p.oid))) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb)) AS fact
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','billing_gateway') AND p.prokind IN ('f','p');

SELECT jsonb_build_object('section','triggers','items',coalesce(jsonb_agg(jsonb_build_object(
  'table',n.nspname||'.'||c.relname,'name',t.tgname,'enabled',t.tgenabled,
  'definitionHash',md5(pg_get_triggerdef(t.oid,true))) ORDER BY n.nspname,c.relname,t.tgname),'[]'::jsonb)) AS fact
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','billing_gateway') AND NOT t.tgisinternal;

SELECT jsonb_build_object('section','policies','items',coalesce(jsonb_agg(jsonb_build_object(
  'table',schemaname||'.'||tablename,'name',policyname,'command',cmd,
  'permissive',permissive,'roles',roles,'usingHash',md5(coalesce(qual,'')),
  'checkHash',md5(coalesce(with_check,''))) ORDER BY schemaname,tablename,policyname),'[]'::jsonb)) AS fact
FROM pg_policies WHERE schemaname IN ('public','billing_gateway');

SELECT jsonb_build_object('section','indexes','items',coalesce(jsonb_agg(jsonb_build_object(
  'table',n.nspname||'.'||c.relname,'name',ic.relname,'valid',i.indisvalid,
  'ready',i.indisready,'definitionHash',md5(pg_get_indexdef(i.indexrelid)))
  ORDER BY n.nspname,c.relname,ic.relname),'[]'::jsonb)) AS fact
FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
JOIN pg_class ic ON ic.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','billing_gateway');

SELECT jsonb_build_object('section','constraints','items',coalesce(jsonb_agg(jsonb_build_object(
  'table',n.nspname||'.'||c.relname,'name',k.conname,'type',k.contype,
  'validated',k.convalidated,'definitionHash',md5(pg_get_constraintdef(k.oid,true)))
  ORDER BY n.nspname,c.relname,k.conname),'[]'::jsonb)) AS fact
FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','billing_gateway');

SELECT jsonb_build_object('section','dependencies','items',coalesce(jsonb_agg(jsonb_build_object(
  'object',pg_describe_object(d.classid,d.objid,d.objsubid),
  'reference',pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid),'type',d.deptype)
  ORDER BY pg_describe_object(d.classid,d.objid,d.objsubid),
    pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid),d.deptype),'[]'::jsonb)) AS fact
FROM pg_depend d WHERE
  (d.classid='pg_class'::regclass AND d.objid IN (SELECT c.oid FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','billing_gateway')))
  OR (d.classid='pg_proc'::regclass AND d.objid IN (SELECT p.oid FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','billing_gateway')));

SELECT jsonb_build_object('section','locks','longTransactions',
  (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
    AND xact_start IS NOT NULL AND now()-xact_start>interval '30 seconds'),
  'waitingLocks',(SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
    WHERE a.datname=current_database() AND NOT l.granted)) AS fact;
COMMIT;
