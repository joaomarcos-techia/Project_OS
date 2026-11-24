-- =====================================================================
-- Reversão da 0167 (CANDIDATA) — itens executados adicionais (P8.4).
--
-- Só com o código que conhece os itens fora do ar (ou com a política P8.4-r em "sem decisão",
-- que não fatura nada: a guia não depende da tabela).
--
-- RECUSA se houver qualquer item registrado. O registro clínico legítimo não pode se perder por
-- uma reversão de schema: com linhas, a decisão é humana (exportar, decidir e só então reverter
-- por um procedimento próprio). Sem linhas, a reversão devolve o catálogo exatamente ao estado
-- anterior à 0167 (prova: scripts/security/hi-0167-apply-rehearsal.ts).
--
-- A linha do ledger do Drizzle sai à parte, no mesmo procedimento (o `when` só é fixado no GO):
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <when da 0167>;
--
-- Uma transação; o que falhar desfaz tudo.
-- =====================================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.hi_appointment_extra_items') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.hi_appointment_extra_items) THEN
      RAISE EXCEPTION 'reversão da 0167 recusada: há itens executados registrados (exporte e decida antes de reverter)'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
END $$;

-- A tabela leva junto os índices, os gatilhos e a política de RLS dela.
DROP TABLE IF EXISTS public.hi_appointment_extra_items;
DROP FUNCTION IF EXISTS public.hi_extra_item_update_guard();
DROP FUNCTION IF EXISTS public.hi_extra_item_insert_guard();
DROP FUNCTION IF EXISTS public.hi_extra_item_guide_closed(uuid, uuid);
DELETE FROM public._schema_version WHERE version = '0167-hi-appointment-extra-items';

COMMIT;
