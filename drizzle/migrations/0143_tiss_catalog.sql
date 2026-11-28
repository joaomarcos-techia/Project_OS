-- 0143 — Convênios/TISS, catálogo GLOBAL (P1.2 do QORO_TISS_MASTER_PLAN.md; ADR-067).
--
-- Terminologia TUSS e versões de comunicação TISS são dados públicos da ANS,
-- iguais para todas as clínicas: sem clinic_id. Leitura para `authenticated`;
-- escrita só pelo script de carga, com papel administrativo
-- (scripts/tiss/terminology/load.ts). A carga NÃO está aqui: migration não
-- carrega dado de terminologia (D6).
--
-- Aditiva: só cria tabelas novas. Rollback: migration nova com DROP aprovado.
-- Neste ponto nada depende destas tabelas; os contratos que referenciam termos
-- chegam em migrations posteriores.

CREATE TABLE public.tiss_terminology_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL,
  archive_url text NOT NULL,
  archive_sha256 text NOT NULL,
  manifest_sha256 text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tiss_terminology_versions_version_uniq UNIQUE (version),
  CONSTRAINT tiss_terminology_versions_version_chk CHECK (version ~ '^[0-9]{6}$'),
  CONSTRAINT tiss_terminology_versions_archive_sha_chk CHECK (archive_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tiss_terminology_versions_manifest_sha_chk CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$')
);--> statement-breakpoint

CREATE TABLE public.tiss_terms (
  version_id uuid NOT NULL REFERENCES public.tiss_terminology_versions (id) ON DELETE RESTRICT,
  table_code text NOT NULL,
  code text NOT NULL,
  term text NOT NULL,
  starts_on date,
  ends_on date,
  implantation_ends_on date,
  extra jsonb,
  CONSTRAINT tiss_terms_pk PRIMARY KEY (version_id, table_code, code),
  CONSTRAINT tiss_terms_table_code_chk CHECK (table_code ~ '^[0-9]{2}$'),
  CONSTRAINT tiss_terms_code_chk CHECK (length(code) BETWEEN 1 AND 20),
  CONSTRAINT tiss_terms_term_chk CHECK (length(term) > 0),
  CONSTRAINT tiss_terms_vigencia_chk CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT tiss_terms_extra_chk CHECK (extra IS NULL OR jsonb_typeof(extra) = 'object')
);--> statement-breakpoint
-- Busca por código em qualquer versão (validação de guia) e por texto na tabela
-- 22 (escolha do procedimento no contrato).
CREATE INDEX tiss_terms_lookup_idx ON public.tiss_terms (table_code, code);--> statement-breakpoint
CREATE INDEX tiss_terms_proc_trgm_idx ON public.tiss_terms USING gin (term gin_trgm_ops)
  WHERE table_code = '22';--> statement-breakpoint

CREATE TABLE public.tiss_schema_versions (
  version text PRIMARY KEY,
  manifest_sha256 text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tiss_schema_versions_version_chk CHECK (version ~ '^[0-9]\.[0-9]{2}\.[0-9]{2}$'),
  CONSTRAINT tiss_schema_versions_manifest_sha_chk CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$')
);--> statement-breakpoint

-- RLS: catálogo global só de leitura (padrão de payment_methods/permissions).
ALTER TABLE public.tiss_terminology_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.tiss_terminology_versions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.tiss_terms ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.tiss_terms FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.tiss_schema_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.tiss_schema_versions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tiss_terminology_versions_read_authenticated ON public.tiss_terminology_versions
  FOR SELECT TO authenticated USING (true);--> statement-breakpoint
CREATE POLICY tiss_terms_read_authenticated ON public.tiss_terms
  FOR SELECT TO authenticated USING (true);--> statement-breakpoint
CREATE POLICY tiss_schema_versions_read_authenticated ON public.tiss_schema_versions
  FOR SELECT TO authenticated USING (true);--> statement-breakpoint

-- Privilégios: o default do schema dá DML a `authenticated` (é o papel do
-- runtime; ADR-042). Aqui o runtime só lê: tira tudo e devolve só SELECT.
REVOKE ALL ON public.tiss_terminology_versions, public.tiss_terms, public.tiss_schema_versions
  FROM anon, authenticated;--> statement-breakpoint
GRANT SELECT ON public.tiss_terminology_versions, public.tiss_terms, public.tiss_schema_versions
  TO authenticated, service_role;--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0143-tiss-catalog')
ON CONFLICT (version) DO NOTHING;
