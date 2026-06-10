-- migration:destructive-approved TV /chamadas descopada (ADR-019) — founder aprovou; tabela dormente, sem dados de produção.
-- C8: TV `/chamadas` descopada (ADR-019, 2026-06-03). Remove a tabela criada em
-- 0018 (estava dormente após a remoção da TV). CASCADE remove policy/FKs/índices e
-- a tira da publication supabase_realtime automaticamente. Destrutivo INTENCIONAL.
DROP TABLE "chamadas" CASCADE;--> statement-breakpoint
DROP TYPE "public"."chamada_tipo";