-- =====================================================================
-- ADR-060 §1.c.1 — as QUATRO perguntas do cadastro autônomo.
--
-- Escrevem no passo 1 do fluxo (§1.c), que é IMPESSOAL de propósito:
--
--   4 perguntas  →  identidade + consentimento + nome da clínica
--                →  verificação de e-mail  →  Checkout hospedado
--
-- O QUE ESTA MIGRATION NÃO TRAZ, e é decisão: **nenhuma PII**. As respostas são
-- sobre a CLÍNICA (tamanho, volume, ferramenta, canal), nunca sobre a pessoa.
-- Isso preserva a propriedade que a 0096 registrou — enquanto não houver PII
-- aqui, o janitor APAGA a linha e não há nada a anonimizar. As colunas de
-- identidade entram com a fatia que as coleta, não antes.
--
-- ---------------------------------------------------------------------
-- Por que colunas TIPADAS com CHECK, e não um `jsonb answers`
-- ---------------------------------------------------------------------
-- O conjunto é fechado: 4 perguntas, cada uma com opções fechadas. `jsonb`
-- aceitaria qualquer coisa e adiaria a validação para o Zod — que a fatia
-- seguinte pode afrouxar sem ninguém perceber.
--
-- Com CHECK, **o banco recusa** um valor fora da lista. É o mesmo argumento que
-- a 0096 usou para o `status`: o congelamento vira constraint, não comentário
-- pedindo cuidado. E vale especialmente para `discovery_source`, onde a decisão
-- "opções fechadas, sem texto livre" existe para impedir que alguém digite o
-- nome de quem indicou — PII de um terceiro que nunca consentiu, entrando no
-- passo impessoal. Aqui isso é impossível por construção, não por disciplina.
-- =====================================================================

-- 1. Respostas ---------------------------------------------------------
-- Todas NULL até o passo 1 ser enviado: a linha nasce no POST /api/signup/sessions,
-- antes de qualquer pergunta. NULL significa "ainda não respondeu", e é o que
-- distingue abandono no passo 1 de abandono depois.
ALTER TABLE "signup_sessions"
  ADD COLUMN IF NOT EXISTS "professionals_band" text,
  ADD COLUMN IF NOT EXISTS "weekly_appointments_band" text,
  ADD COLUMN IF NOT EXISTS "current_tooling" text,
  ADD COLUMN IF NOT EXISTS "discovery_source" text,
  ADD COLUMN IF NOT EXISTS "answered_at" timestamp with time zone;--> statement-breakpoint

-- 2. CHECKs: uma lista fechada por pergunta ----------------------------
-- Faixas, não números. Ninguém sabe de cabeça quantos atendimentos faz por
-- semana, e um inteiro livre produziria precisão falsa — além de virar quase
-- identificador quando a clínica é pequena.
ALTER TABLE "signup_sessions"
  ADD CONSTRAINT "signup_sessions_professionals_band_check"
  CHECK ("professionals_band" IS NULL
     OR  "professionals_band" IN ('1', '2_5', '6_15', '16_plus'));--> statement-breakpoint

ALTER TABLE "signup_sessions"
  ADD CONSTRAINT "signup_sessions_weekly_appointments_band_check"
  CHECK ("weekly_appointments_band" IS NULL
     OR  "weekly_appointments_band" IN ('ate_20', '21_50', '51_100', '100_plus'));--> statement-breakpoint

-- `outro_sistema` é a resposta que tem consequência: o onboarding oferece o
-- importador de `/agenda/importar`, que já existe.
ALTER TABLE "signup_sessions"
  ADD CONSTRAINT "signup_sessions_current_tooling_check"
  CHECK ("current_tooling" IS NULL
     OR  "current_tooling" IN ('nada_papel', 'agenda_generica', 'outro_sistema'));--> statement-breakpoint

-- Atribuição DECLARADA. Não duplica o `gclid`/UTM do §21.3: aquilo só enxerga o
-- que é pago e etiquetado, e é cego para indicação de colega — que é justamente
-- o canal que se quer medir. `indicacao_colega` guarda o CANAL, nunca quem.
ALTER TABLE "signup_sessions"
  ADD CONSTRAINT "signup_sessions_discovery_source_check"
  CHECK ("discovery_source" IS NULL
     OR  "discovery_source" IN ('busca_google', 'indicacao_colega', 'redes_sociais',
                                'grupo_comunidade', 'evento', 'outro'));--> statement-breakpoint

-- 3. Coerência: respondeu tudo, ou não respondeu nada ------------------
-- Sem isto, um bug de escrita parcial deixaria linhas meio respondidas que
-- nenhuma consulta de funil sabe classificar. A constraint transforma
-- "provavelmente está tudo junto" em garantia.
ALTER TABLE "signup_sessions"
  ADD CONSTRAINT "signup_sessions_answers_all_or_none_check"
  CHECK (
    ("professionals_band" IS NULL AND "weekly_appointments_band" IS NULL
     AND "current_tooling" IS NULL AND "discovery_source" IS NULL
     AND "answered_at" IS NULL)
    OR
    ("professionals_band" IS NOT NULL AND "weekly_appointments_band" IS NOT NULL
     AND "current_tooling" IS NOT NULL AND "discovery_source" IS NOT NULL
     AND "answered_at" IS NOT NULL)
  );--> statement-breakpoint

-- 4. `status` ganha `details_complete` ---------------------------------
-- A 0096 previu isto por escrito: "as fatias seguintes SUBSTITUEM esta
-- constraint acrescentando seus estados". DROP + ADD, sem a armadilha do
-- `ALTER TYPE ... ADD VALUE` (valor novo inutilizável na mesma transação) —
-- que é a razão de `status` ser `text` e não `pgEnum`.
--
-- A ORDEM do funil continua no código (`SIGNUP_FUNNEL_ORDER`). Ordenar por
-- `status` daria ordem alfabética, que não tem relação com progresso.
ALTER TABLE "signup_sessions"
  DROP CONSTRAINT IF EXISTS "signup_sessions_status_check";--> statement-breakpoint

ALTER TABLE "signup_sessions"
  ADD CONSTRAINT "signup_sessions_status_check"
  CHECK ("status" IN ('initiated', 'details_complete', 'expired', 'blocked'));--> statement-breakpoint

-- 5. Índice do funil ---------------------------------------------------
-- Parcial: só as linhas que responderam. É a consulta que o fundador pediu
-- ("boa observação de leads pelo formulário"), e o índice não paga pelas linhas
-- abandonadas no passo 0, que são a maioria.
CREATE INDEX IF NOT EXISTS "signup_sessions_answered_idx"
  ON "signup_sessions" USING btree ("answered_at")
  WHERE "answered_at" IS NOT NULL;--> statement-breakpoint

-- 6. Grants: nada a fazer ----------------------------------------------
-- Coluna nova herda o grant da TABELA, e a 0096 já deu o mínimo a service_role
-- e revogou `anon`/`authenticated`. A 0097 revogou `qoro_runtime`. Registrado
-- para o próximo leitor não procurar o que não existe.

-- 7. SCHEMA VERSION SNAPSHOT -------------------------------------------
INSERT INTO _schema_version (version) VALUES ('signup-session-answers')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
