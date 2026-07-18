-- =====================================================================
-- 0046 — Cifra do conteúdo clínico (A1 / ADR-044) · PASSO 1 de 2: ADITIVO.
--
-- Adiciona as colunas `*_encrypted` NULLABLE ao lado das jsonb/text originais.
-- Reversível: se algo der errado no deploy, reverter o código deixa estas
-- colunas órfãs (nullable, ignoradas) — nenhum dado perdido. O passo destrutivo
-- (SET NOT NULL + DROP das originais) é a 0047, separada de propósito.
--
-- SEQUÊNCIA DE DEPLOY (ver runbook / ADR-044):
--   1. 0046 (esta) + deploy do código que ESCREVE cifrado e LÊ cifrado.
--   2. scripts/encrypt-clinical-content.ts  (backfill por clínica, com a chave).
--   3. 0047 (SET NOT NULL + DROP) — só depois do backfill; ela tem um guard
--      `RAISE EXCEPTION` que ABORTA se achar linha não-migrada.
--
-- Por que NULLABLE agora: as linhas existentes ainda têm o dado só nas colunas
-- antigas; o backfill preenche as novas. Entre 0046 e o backfill, escrever uma
-- linha nova SEM a coluna cifrada seria NULL — o código do passo 1 sempre
-- escreve as duas, mas a coluna fica nullable até a 0047 provar que tudo migrou.
--
-- Prod tem 0 linhas clínicas → o backfill é no-op lá e a 0047 passa direto.
-- Dev tem ~12 prontuários → o backfill os cifra.
-- =====================================================================

ALTER TABLE "prontuarios" ADD COLUMN "content_encrypted" text;--> statement-breakpoint
ALTER TABLE "prontuario_versions" ADD COLUMN "content_encrypted" text;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD COLUMN "medicamentos_encrypted" text;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD COLUMN "observacoes_encrypted" text;--> statement-breakpoint
ALTER TABLE "medical_documents" ADD COLUMN "content_encrypted" text;--> statement-breakpoint

-- Durante a janela 0046→0047 o código novo escreve SÓ a coluna cifrada. As
-- colunas antigas com DEFAULT (`content` de prontuarios/medical_documents = '{}',
-- `medicamentos` = '[]') aceitam o INSERT sem elas. Mas `prontuario_versions.content`
-- é NOT NULL SEM default → um INSERT sem ela (editSignedProntuario no período de
-- transição) violaria a constraint. Afrouxa aqui; a 0047 dropa a coluna inteira.
ALTER TABLE "prontuario_versions" ALTER COLUMN "content" DROP NOT NULL;--> statement-breakpoint

-- Schema version snapshot
INSERT INTO _schema_version (version) VALUES ('clinical-content-encrypt-add')
ON CONFLICT (version) DO NOTHING;
