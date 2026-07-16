-- =====================================================================
-- 0040 — Autoridade sobre as claims: fecha o escalonamento por override (I-13)
--        e o drift global de role_permissions (I-11b / ADR-008 D27).
--
-- Três problemas com a MESMA raiz: "quem pode mudar a autorização de alguém?"
--
-- ---------------------------------------------------------------------
-- (A) 🔴 I-13 — ESCALONAMENTO DE PRIVILÉGIO (achado NOVO da remediação,
--     2026-07-16). NÃO estava em nenhuma das 4 auditorias.
--
--     `user_permission_overrides` foi classificada como tabela TENANT comum e
--     recebeu `defaultTenantPolicy` (FOR ALL) — ver AUDITORIA_C0_C10_COMPLETA
--     linha 127 ("user_permission_overrides | tenant | defaultTenantPolicy").
--     Além disso o Supabase concede por DEFAULT PRIVILEGES INSERT/UPDATE/DELETE
--     a `anon`/`authenticated` em toda tabela nova do schema public.
--
--     Resultado: QUALQUER usuário autenticado podia, via PostgREST, gravar
--     direto na tabela que define a própria autorização:
--
--       POST /rest/v1/user_permission_overrides
--       { user_id: <ele mesmo>, clinic_id: <a clínica dele>,
--         permission_code: 'manage:employees', granted: true }
--
--     A policy só compara `clinic_id` — nunca QUEM é o ator nem SE ele pode
--     conceder. O WITH CHECK passa, porque a clínica é mesmo a dele.
--
--     PROVADO em dev (2026-07-16, transação + ROLLBACK), com o JWT de um
--     `attendant` real:
--       - INSERT do override .................. ACEITO
--       - effective_permissions_v concede ..... true
--       - custom_access_token_hook injeta ..... true  (entra no próximo JWT)
--       - claims_version ...................... 1 → 1  (NÃO bumpou! ver (B))
--       - requireFreshPermission ............... concede na hora (lê override do banco)
--     Contraprova no mesmo teste: `role_permissions` INSERT → negado (RLS) e
--     `profiles` UPDATE role → negado (0 linhas). O furo era SÓ esta tabela.
--
--     CAUSA RAIZ (arquitetural, não pontual): o princípio "RLS ≠ RBAC"
--     (ADR-007 D27) diz que a RLS responde "o caller pode tocar neste tenant?"
--     e que a autorização funcional mora na app (Server Action chama
--     `require*`). Isso está CORRETO para tabelas de DOMÍNIO (patients,
--     appointments): toda escrita passa por uma Server Action. Mas a premissa
--     "a app guarda a porta" é FALSA para a tabela de AUTORIZAÇÃO, porque o
--     PostgREST expõe um caminho de escrita direto que não passa pela app.
--     Tabela de authz não é tabela de tenant: nela, "estar no tenant" NÃO pode
--     ser autorização suficiente para escrever.
--
--     FIX (defesa em profundidade — as duas camadas, não uma):
--       1. GRANTs: revoga escrita de anon/authenticated (least privilege).
--          SELECT permanece — `identity/queries.ts` (listEmployees) lê a tabela
--          via `withTenant`, que faz SET LOCAL ROLE authenticated.
--       2. Policy: FOR ALL → FOR SELECT. Mesmo que um GRANT volte (Supabase
--          re-concede por default privileges), a policy nega a escrita.
--     Escrita passa a existir só via `dbAdmin` (BYPASSRLS), sempre atrás do
--     gate — que é onde `assertCanAssignRole` e os guard-rails vivem (Fase 2).
--
-- ---------------------------------------------------------------------
-- (B) 🔴 O bump de claims_version FALHAVA EM SILÊNCIO (corolário de I-13)
--
--     `bump_overrides_claims_version` era SECURITY INVOKER e fazia
--     `UPDATE public.profiles SET claims_version = ...`. Sob RLS, `profiles`
--     não tem policy de UPDATE para `authenticated` (ADR-008 D31) → o UPDATE
--     casava 0 linhas e NÃO levantava erro. O mecanismo de segurança falhava
--     ABERTO: era exatamente por isso que o escalonamento acima era furtivo
--     (claims_version ficou em 1, então nem o middleware nem o novo epoch-check
--     do gate perceberiam a mudança).
--
--     FIX: `touch_claims_version` é SECURITY DEFINER. O bump é invariante de
--     segurança — ou acontece, ou a transação inteira falha ALTO. Nunca "quase".
--
-- ---------------------------------------------------------------------
-- (C) I-11b / ADR-008 D27 — mudança em `role_permissions` (bundle global de uma
--     role) não bumpava claims_version de ninguém → todo mundo daquela role
--     seguia com o bundle antigo até logout manual ("débito aceito, resolver com
--     auth epoch global em C16").
--
--     FIX: trigger que bumpa todos os profiles da role afetada. Com o
--     epoch-check por request do ADR-037, isso vira revogação imediata — sem
--     precisar de "epoch global" nenhum: `claims_version` JÁ é o epoch, faltava
--     só alguém bumpá-lo aqui.
--
-- Não-destrutiva: nenhum DROP TABLE/COLUMN, nenhum TRUNCATE. DROP POLICY é
-- recriada na mesma migration (o guard de check:migrations não a bloqueia).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. touch_claims_version — ponto único do bump statement-level
-- ---------------------------------------------------------------------
-- HONESTIDADE SOBRE O ESCOPO (não afirmar o que não é): existem TRÊS pontos de
-- bump; esta função unifica DOIS.
--   ✔ overrides        → bump por user_id  (statement-level, via UPDATE)
--   ✔ role_permissions → bump por role     (statement-level, via UPDATE)
--   ✘ profiles         → NÃO passa por aqui, e está certo: o trigger é BEFORE
--     UPDATE e escreve `NEW.claims_version` NA PRÓPRIA LINHA que já está sendo
--     gravada. Roteá-lo por uma função que faz UPDATE causaria recursão do
--     trigger e um write a mais. In-row é a forma correta e mais barata.
-- Se um dia entrarem permission groups / hierarquia / roles compostos, o lugar
-- de mexer é aqui — não espalhado por N triggers.
CREATE OR REPLACE FUNCTION public.touch_claims_version(
  p_user_id uuid DEFAULT NULL,
  p_role public.role_enum DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER              -- (B): o bump NUNCA pode ser engolido pela RLS de profiles
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Contrato explícito: exatamente UM critério. Chamar com os dois (ou nenhum)
  -- é erro de programação e deve explodir, não adivinhar.
  IF (p_user_id IS NULL) = (p_role IS NULL) THEN
    RAISE EXCEPTION 'touch_claims_version: informe EXATAMENTE um de (p_user_id, p_role)'
      USING ERRCODE = '22023';
  END IF;

  IF p_user_id IS NOT NULL THEN
    UPDATE public.profiles SET claims_version = claims_version + 1 WHERE id = p_user_id;
  ELSE
    UPDATE public.profiles SET claims_version = claims_version + 1 WHERE role = p_role;
  END IF;
END $$;--> statement-breakpoint

-- ADR-010 #2/#3. O REVOKE de anon/authenticated é EXPLÍCITO de propósito: o
-- Supabase aplica DEFAULT PRIVILEGES que re-concedem EXECUTE em funções novas do
-- schema public, e REVOKE FROM PUBLIC não cobre isso (lição da 0007 e da 0006).
--
-- Por que NÃO conceder a `authenticated`: a função bumpa por ROLE. Exposta via
-- PostgREST, `touch_claims_version(p_role => 'owner')` deslogaria todos os owners
-- da plataforma — DoS trivial. Só service_role/postgres (donos dos triggers).
REVOKE EXECUTE ON FUNCTION public.touch_claims_version(uuid, public.role_enum) FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.touch_claims_version(uuid, public.role_enum) FROM anon, authenticated;--> statement-breakpoint
GRANT  EXECUTE ON FUNCTION public.touch_claims_version(uuid, public.role_enum) TO service_role;--> statement-breakpoint

-- ---------------------------------------------------------------------
-- 2. (B) overrides: bump vira SECURITY DEFINER e passa pelo ponto único
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bump_overrides_claims_version() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER              -- ver (B): antes era INVOKER e o UPDATE morria na RLS
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.touch_claims_version(p_user_id => COALESCE(NEW.user_id, OLD.user_id));
  RETURN COALESCE(NEW, OLD);
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------
-- 3. (C) role_permissions: bundle global passa a bumpar quem usa a role
-- ---------------------------------------------------------------------
-- Sem duplo bump: o trigger BEFORE UPDATE de profiles
-- (bump_profile_claims_version) só incrementa quando role/clinic_id/ativo mudam,
-- e aqui só mexemos em claims_version.
-- super_admin não tem linha em role_permissions (P7 — bypassa RBAC via
-- is_super_admin()), então nunca é atingido por este trigger.
CREATE OR REPLACE FUNCTION public.bump_role_permissions_claims_version() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.touch_claims_version(p_role => COALESCE(NEW.role, OLD.role));
  RETURN COALESCE(NEW, OLD);
END $$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION public.bump_role_permissions_claims_version() FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.bump_role_permissions_claims_version() FROM anon, authenticated;--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_role_permissions_bump_claims_version ON public.role_permissions;--> statement-breakpoint
CREATE TRIGGER trg_role_permissions_bump_claims_version
  AFTER INSERT OR UPDATE OR DELETE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.bump_role_permissions_claims_version();--> statement-breakpoint

-- ---------------------------------------------------------------------
-- 4. (A) I-13 — trancar a escrita em user_permission_overrides
-- ---------------------------------------------------------------------
-- Camada 1 — GRANTs (least privilege). SELECT PERMANECE: identity/queries.ts
-- (listEmployees → overridesCount) lê via withTenant, que roda como
-- `authenticated`. Tirar o SELECT quebraria a tela Equipe.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES
  ON public.user_permission_overrides FROM anon, authenticated;--> statement-breakpoint

-- Camada 2 — policy. FOR ALL (defaultTenantPolicy) era o erro de classificação:
-- numa tabela de AUTHZ, "estar no tenant" não é autorização para escrever.
DROP POLICY IF EXISTS user_permission_overrides_tenant_access ON public.user_permission_overrides;--> statement-breakpoint
CREATE POLICY user_permission_overrides_tenant_select ON public.user_permission_overrides FOR SELECT
  USING (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  );--> statement-breakpoint

-- Nota deliberada sobre super_admin: a policy antiga deixava super_admin gravar
-- via PostgREST (is_super_admin() no WITH CHECK). Isso NÃO é uma perda de
-- funcionalidade — nada no código usa esse caminho (a tabela nunca teve escrita
-- em src/), e o canal admin correto é dbAdmin atrás de requireSuperAdmin (AAL2),
-- que é auditado. Reabrir escrita por RLS reabriria o furo para todo o tenant.

-- Schema version snapshot
INSERT INTO _schema_version (version) VALUES ('identity-auth-epoch-overrides-lockdown')
ON CONFLICT (version) DO NOTHING;
