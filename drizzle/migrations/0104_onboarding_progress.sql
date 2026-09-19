-- 0104 - onboarding_progress: o estado do onboarding OPERACIONAL (O-7).
--
-- POR QUE UMA TABELA, e nao derivacao: o checklist de ativacao ja existe e e
-- DERIVADO de presenca de dado (dashboard/data.ts, GAP 8) — "cadastre um
-- medico" esta feito se, e somente se, existe medico. Derivacao e mais forte
-- que estado marcado: nao ha o que falsificar, nao ha id vindo do browser, nao
-- ha o que concluir para outro tenant. Essa parte NAO ganha tabela.
--
-- O que NAO e derivavel de dado nenhum: se a pessoa ja VIU o tour, em que passo
-- parou, se pulou, se ja abriu a central de documentacao, se dispensou o
-- checklist. Isso e estado de quem usa, nao fato da clinica — e e exatamente o
-- que precisa sobreviver a refresh, logout/login, segunda aba e navegador novo.
-- localStorage nao serve: ele morre no navegador novo e nao existe no servidor,
-- entao o tour reapareceria para quem ja o completou em outra maquina.
--
-- ESCOPO DUPLO (clinic_id, user_id) e a PK. Estado de tour e de UMA pessoa: a
-- recepcionista nao herda o tour da dona da clinica. Por isso as policies abaixo
-- exigem as DUAS condicoes — `app.current_clinic` E `app.current_user`, o par
-- que `withTenant(clinicId, fn, actorUserId)` ja estabelece. O mesmo desenho de
-- `feedback_suggestions` (0072).
--
-- SEM DELETE para `authenticated`: zerar o onboarding e mudar estado, nao apagar
-- linha. Apagar seria o unico jeito de a pessoa reabrir um tour ja concluido
-- sem deixar rastro de quando concluiu.
--
-- row_version: CAS. Duas abas avancando o tour ao mesmo tempo sao o caso comum,
-- nao o exotico, e sem versao a segunda escrita sobrescreveria a primeira em
-- silencio (last-write-wins). Com CAS a perdedora volta `stale` e releitura.

CREATE TABLE IF NOT EXISTS onboarding_progress (
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Maquina de estados do tour. Texto + CHECK em vez de ENUM: o conjunto e
  -- fechado mas provavelmente crescera ('postponed'), e ALTER TYPE ... ADD VALUE
  -- nao roda dentro de transacao no Postgres — CHECK e trocavel por ALTER.
  tour_state text NOT NULL DEFAULT 'not_started',
  -- Indice do passo atual, 0-based. Limitado no banco para que uma escrita
  -- adulterada nao consiga guardar um passo que a UI nunca conseguiria mostrar.
  tour_step smallint NOT NULL DEFAULT 0,
  tour_started_at timestamptz,
  tour_finished_at timestamptz,
  docs_visited_at timestamptz,
  checklist_dismissed_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_progress_pkey PRIMARY KEY (clinic_id, user_id),
  CONSTRAINT onboarding_progress_tour_state_chk
    CHECK (tour_state IN ('not_started','in_progress','completed','skipped')),
  CONSTRAINT onboarding_progress_tour_step_chk
    CHECK (tour_step >= 0 AND tour_step <= 32),
  -- Terminal <=> tem data de termino. Impede "concluido sem quando" e o seu
  -- inverso, "tem data de termino mas segue em andamento".
  CONSTRAINT onboarding_progress_finished_chk
    CHECK ((tour_state IN ('completed','skipped')) = (tour_finished_at IS NOT NULL)),
  -- Comecou <=> tem data de inicio. `not_started` e o unico estado sem inicio.
  CONSTRAINT onboarding_progress_started_chk
    CHECK ((tour_state <> 'not_started') = (tour_started_at IS NOT NULL)),
  -- Quem nao comecou esta no passo zero. Sem isto, `not_started` com passo 7
  -- seria um estado impossivel gravavel.
  CONSTRAINT onboarding_progress_not_started_step_chk
    CHECK (tour_state <> 'not_started' OR tour_step = 0),
  CONSTRAINT onboarding_progress_row_version_chk CHECK (row_version >= 1)
);
--> statement-breakpoint

-- O dashboard le por (clinic_id, user_id) — ja e a PK. Este indice serve a
-- pergunta operacional inversa: "quem nesta clinica ainda nao terminou?".
CREATE INDEX IF NOT EXISTS onboarding_progress_clinic_state_idx
  ON public.onboarding_progress (clinic_id, tour_state);
--> statement-breakpoint

ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.onboarding_progress FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- As tres policies exigem clinica E usuario. Um colega da MESMA clinica nao le
-- nem escreve o progresso de outro: o par e a chave, nao so o tenant.
CREATE POLICY onboarding_progress_read ON public.onboarding_progress FOR SELECT
  USING (
    (
      clinic_id::text = (select current_setting('app.current_clinic', true))
      AND user_id::text = (select current_setting('app.current_user', true))
    )
    OR (
      clinic_id::text = (select current_clinic_id())
      AND user_id = (select auth.uid())
    )
    OR (select is_super_admin())
  );
--> statement-breakpoint
CREATE POLICY onboarding_progress_write ON public.onboarding_progress FOR INSERT
  WITH CHECK (
    (
      clinic_id::text = (select current_setting('app.current_clinic', true))
      AND user_id::text = (select current_setting('app.current_user', true))
    )
    OR (
      clinic_id::text = (select current_clinic_id())
      AND user_id = (select auth.uid())
    )
    OR (select is_super_admin())
  );
--> statement-breakpoint
CREATE POLICY onboarding_progress_update ON public.onboarding_progress FOR UPDATE
  USING (
    (
      clinic_id::text = (select current_setting('app.current_clinic', true))
      AND user_id::text = (select current_setting('app.current_user', true))
    )
    OR (
      clinic_id::text = (select current_clinic_id())
      AND user_id = (select auth.uid())
    )
    OR (select is_super_admin())
  )
  WITH CHECK (
    (
      clinic_id::text = (select current_setting('app.current_clinic', true))
      AND user_id::text = (select current_setting('app.current_user', true))
    )
    OR (
      clinic_id::text = (select current_clinic_id())
      AND user_id = (select auth.uid())
    )
    OR (select is_super_admin())
  );
--> statement-breakpoint

REVOKE ALL ON public.onboarding_progress FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.onboarding_progress TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.onboarding_progress TO service_role;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0104-onboarding-progress')
ON CONFLICT (version) DO NOTHING;
