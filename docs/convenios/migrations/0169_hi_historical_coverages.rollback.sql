-- Reversão da candidata 0169 (P4.7-b). Só remove o que a 0169 criou; nenhum dado de atendimento, lote ou operadora
-- é tocado. As referências históricas gravadas se perdem: rodar a reversão só antes de haver importação real.
DROP TABLE IF EXISTS public.hi_historical_coverages;
DROP FUNCTION IF EXISTS public.hi_historical_coverage_insert_guard();
DROP FUNCTION IF EXISTS public.hi_historical_coverage_immutable();
DELETE FROM public._schema_version WHERE version = '0169-hi-historical-coverages';
