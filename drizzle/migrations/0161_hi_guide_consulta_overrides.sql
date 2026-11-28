-- =====================================================================
-- 0161 — Convênios: ajustes da Guia de Consulta antes da aprovação (D11, P4.6).
-- CANDIDATA: provada em Postgres descartável
-- (scripts/security/health-insurance-consulta-overrides-db.ts); aplicação no DEV só com
-- autorização específica, depois da 0160.
--
-- A D11 fixa os padrões da Consulta (regime 01, acidente 9, tipo de consulta 1, ou 2 em
-- retorno dentro do prazo do contrato) e diz que eles podem ser ajustados antes da
-- aprovação. O montador já aceitava `overrides`, mas não havia onde guardar o ajuste de
-- cada guia: a emissão usava sempre o padrão.
--
-- O que muda:
--   1. `hi_guides.consulta_overrides` (jsonb; nulo = só os padrões). Só na Consulta, só as
--      seis chaves do montador, cada código no formato do XSD 4.03.00 e a observação com
--      1 a 500 caracteres. Chave ausente = padrão (ou "sem cobertura especial" / "sem saúde
--      ocupacional"). O domínio (o código existir na tabela da ANS) é conferido na
--      terminologia da guia, na edição e de novo na emissão;
--   2. gatilho `hi_guides_ab_consulta_overrides`: o ajuste só muda com a guia em edição
--      (pendências ou pronta para conferência), como o resto do conteúdo (0147). Depois da
--      conferência, só devolvendo para correção; depois da aprovação, só reabrindo (nova
--      revisão). O nome ordena o gatilho logo depois de `hi_guides_a_transition`;
--   3. UPDATE da coluna para o runtime (a 0147 concede UPDATE coluna a coluna).
--
-- Só aditiva. O histórico (`hi_guide_record_event`) já grava o nome de qualquer coluna
-- alterada, então o ajuste aparece em `changed_fields` sem mudar a função. RLS da tabela
-- vale para a coluna nova.
--
-- Reversão (sem dado de produção ainda):
--   DROP TRIGGER IF EXISTS hi_guides_ab_consulta_overrides ON public.hi_guides;
--   DROP FUNCTION IF EXISTS public.hi_guide_guard_consulta_overrides();
--   ALTER TABLE public.hi_guides DROP COLUMN IF EXISTS consulta_overrides;
--   DELETE FROM public._schema_version WHERE version = '0161-hi-guide-consulta-overrides';
-- =====================================================================

ALTER TABLE public.hi_guides ADD COLUMN consulta_overrides jsonb;
--> statement-breakpoint

ALTER TABLE public.hi_guides ADD CONSTRAINT hi_guides_consulta_overrides_chk CHECK (
  consulta_overrides IS NULL OR (
    guide_type = 'consulta'
    AND jsonb_typeof(consulta_overrides) = 'object'
    AND consulta_overrides <> '{}'::jsonb
    AND (consulta_overrides - ARRAY['regimeAtendimento', 'indicacaoAcidente', 'tipoConsulta',
                                    'coberturaEspecial', 'saudeOcupacional', 'observacao']) = '{}'::jsonb
    AND (NOT consulta_overrides ? 'regimeAtendimento'
         OR (jsonb_typeof(consulta_overrides -> 'regimeAtendimento') = 'string'
             AND consulta_overrides ->> 'regimeAtendimento' ~ '^[0-9]{2}$'))
    AND (NOT consulta_overrides ? 'indicacaoAcidente'
         OR (jsonb_typeof(consulta_overrides -> 'indicacaoAcidente') = 'string'
             AND consulta_overrides ->> 'indicacaoAcidente' ~ '^[0-9]$'))
    AND (NOT consulta_overrides ? 'tipoConsulta'
         OR (jsonb_typeof(consulta_overrides -> 'tipoConsulta') = 'string'
             AND consulta_overrides ->> 'tipoConsulta' ~ '^[0-9]$'))
    AND (NOT consulta_overrides ? 'coberturaEspecial'
         OR (jsonb_typeof(consulta_overrides -> 'coberturaEspecial') = 'string'
             AND consulta_overrides ->> 'coberturaEspecial' ~ '^[0-9]{2}$'))
    AND (NOT consulta_overrides ? 'saudeOcupacional'
         OR (jsonb_typeof(consulta_overrides -> 'saudeOcupacional') = 'string'
             AND consulta_overrides ->> 'saudeOcupacional' ~ '^[0-9]{2}$'))
    AND (NOT consulta_overrides ? 'observacao'
         OR (jsonb_typeof(consulta_overrides -> 'observacao') = 'string'
             AND char_length(btrim(consulta_overrides ->> 'observacao')) BETWEEN 1 AND 500
             AND char_length(consulta_overrides ->> 'observacao') <= 500))
  )
);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.hi_guide_guard_consulta_overrides() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.consulta_overrides IS DISTINCT FROM OLD.consulta_overrides
     AND OLD.status NOT IN ('pending_data', 'ready_for_review') THEN
    RAISE EXCEPTION 'Guia conferida não se edita: devolva para correção (ou reabra a aprovada) antes de ajustar os dados da consulta.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_guide_guard_consulta_overrides() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
-- Em todo UPDATE (não só `UPDATE OF consulta_overrides`): nenhum caminho muda a coluna sem passar aqui.
CREATE TRIGGER hi_guides_ab_consulta_overrides BEFORE UPDATE ON public.hi_guides
  FOR EACH ROW EXECUTE FUNCTION public.hi_guide_guard_consulta_overrides();
--> statement-breakpoint

GRANT UPDATE (consulta_overrides) ON public.hi_guides TO authenticated, service_role;
--> statement-breakpoint

INSERT INTO public._schema_version (version) VALUES ('0161-hi-guide-consulta-overrides')
  ON CONFLICT DO NOTHING;
