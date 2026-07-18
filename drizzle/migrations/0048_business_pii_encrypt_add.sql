-- =====================================================================
-- 0048 — Cifra de PII de negócio (A8) · PASSO 1 de 2: ADITIVO.
--
-- clinics.cnpj e billing_customers.document eram PII fiscal (CPF/CNPJ do dono da
-- clínica / cliente Asaas) em claro. Cifra per-tenant (mesmo mecanismo do ADR-012;
-- salt HKDF = id da clínica). Ver ADR-044.
--
-- Reversível: colunas novas NULLABLE ao lado das originais. Backfill:
-- `pnpm db:encrypt-business-pii`. A 0049 (drop) tem guard que aborta se faltar.
--
-- A11 (UNIQUE no CNPJ) fica ADIADO: cnpj_hash é adicionada e POPULADA (não nasce
-- morta), mas SEM constraint — sem normalização de CNPJ (C13) o hash não dedupe
-- formatações diferentes, então a UNIQUE seria proteção falsa. Quando C13
-- normalizar, um migration recomputa o hash sobre o valor normalizado e adiciona
-- a UNIQUE(cnpj_hash) WHERE cnpj_hash IS NOT NULL. Ver ADR-044 / achado A11.
-- =====================================================================

ALTER TABLE "clinics" ADD COLUMN "cnpj_encrypted" text;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "cnpj_hash" text;--> statement-breakpoint
ALTER TABLE "billing_customers" ADD COLUMN "document_encrypted" text;--> statement-breakpoint

-- Schema version snapshot
INSERT INTO _schema_version (version) VALUES ('business-pii-encrypt-add')
ON CONFLICT (version) DO NOTHING;
