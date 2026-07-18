-- migration:destructive-approved A8/ADR-044 — dropa clinics.cnpj e billing_customers.document em claro APÓS backfill. Aprovado por João Marcos (founder) 2026-07-17.
-- =====================================================================
-- 0049 — Cifra de PII de negócio (A8) · PASSO 2 de 2: DESTRUTIVO.
--
-- ⚠️ NÃO-RETORNO. Dropa clinics.cnpj e billing_customers.document (em claro).
-- Só rode DEPOIS de: 0048 aplicada + deploy do código + backfill
-- (`pnpm db:encrypt-business-pii`).
--
-- Guard: aborta o LOTE se achar linha com valor original em claro mas sem cifra.
-- clinics.cnpj / billing_customers.document são NULLABLE, então a condição é
-- "original NOT NULL AND encrypted NULL" (linhas legitimamente sem CNPJ passam).
--
-- Isolada de propósito (marcador destructive-approved desliga o gate p/ o arquivo).
-- =====================================================================

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM clinics WHERE cnpj IS NOT NULL AND cnpj_encrypted IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'abort: % clinics com cnpj sem cifra. Rode pnpm db:encrypt-business-pii.', n; END IF;

  SELECT count(*) INTO n FROM billing_customers WHERE document IS NOT NULL AND document_encrypted IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'abort: % billing_customers com document sem cifra.', n; END IF;
END $$;--> statement-breakpoint

ALTER TABLE "clinics" DROP COLUMN "cnpj";--> statement-breakpoint
ALTER TABLE "billing_customers" DROP COLUMN "document";--> statement-breakpoint

-- Schema version snapshot
INSERT INTO _schema_version (version) VALUES ('business-pii-encrypt-drop')
ON CONFLICT (version) DO NOTHING;
