-- migration:destructive-approved A1/ADR-044 — dropa colunas clínicas em claro APÓS backfill. Aprovado por João Marcos (founder) 2026-07-17.
-- =====================================================================
-- 0047 — Cifra do conteúdo clínico (A1 / ADR-044) · PASSO 2 de 2: DESTRUTIVO.
--
-- ⚠️ NÃO-RETORNO. Dropa as colunas em claro (content/medicamentos/observacoes).
-- Só rode DEPOIS de:
--   1. 0046 aplicada
--   2. deploy do código que escreve/lê cifrado
--   3. scripts/encrypt-clinical-content.ts rodado (pnpm db:encrypt-clinical)
--
-- O guard abaixo é a REDE: um RAISE EXCEPTION aborta o LOTE inteiro (a migration
-- roda dentro da transação única do runner) se achar QUALQUER linha não migrada.
-- Fail-closed: "não migrou" nunca "migrou pela metade". Prod tem 0 linhas → passa
-- direto; dev foi backfillado → passa.
--
-- Isolada de propósito: só o guard + SET NOT NULL + DROP. O marcador
-- `destructive-approved` (linha 1) DESLIGA o gate check:migrations para o ARQUIVO
-- INTEIRO — então nada mais pode entrar aqui, senão um DROP futuro passaria cego.
-- =====================================================================

-- GUARD — aborta se o backfill não cobriu todas as linhas. Por coluna, respeitando
-- nullability: origem NOT NULL → destino tem que existir; origem nullable
-- (observacoes) → destino só quando a origem existe.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM prontuarios WHERE content_encrypted IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'abort: % prontuarios sem content_encrypted. Rode pnpm db:encrypt-clinical.', n; END IF;

  SELECT count(*) INTO n FROM prontuario_versions WHERE content_encrypted IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'abort: % prontuario_versions sem content_encrypted.', n; END IF;

  SELECT count(*) INTO n FROM prescriptions WHERE medicamentos_encrypted IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'abort: % prescriptions sem medicamentos_encrypted.', n; END IF;

  SELECT count(*) INTO n FROM prescriptions WHERE observacoes IS NOT NULL AND observacoes_encrypted IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'abort: % prescriptions com observacoes sem cifra.', n; END IF;

  SELECT count(*) INTO n FROM medical_documents WHERE content_encrypted IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'abort: % medical_documents sem content_encrypted.', n; END IF;
END $$;--> statement-breakpoint

-- Torna obrigatório o que o schema.ts já declara NOT NULL (observacoes_encrypted
-- fica nullable — o original também era).
ALTER TABLE "prontuarios" ALTER COLUMN "content_encrypted" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "prontuario_versions" ALTER COLUMN "content_encrypted" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "prescriptions" ALTER COLUMN "medicamentos_encrypted" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "medical_documents" ALTER COLUMN "content_encrypted" SET NOT NULL;--> statement-breakpoint

-- Dropa as colunas em claro — o registro médico deixa de existir legível no banco.
ALTER TABLE "prontuarios" DROP COLUMN "content";--> statement-breakpoint
ALTER TABLE "prontuario_versions" DROP COLUMN "content";--> statement-breakpoint
ALTER TABLE "prescriptions" DROP COLUMN "medicamentos";--> statement-breakpoint
ALTER TABLE "prescriptions" DROP COLUMN "observacoes";--> statement-breakpoint
ALTER TABLE "medical_documents" DROP COLUMN "content";--> statement-breakpoint

-- Schema version snapshot
INSERT INTO _schema_version (version) VALUES ('clinical-content-encrypt-drop')
ON CONFLICT (version) DO NOTHING;
