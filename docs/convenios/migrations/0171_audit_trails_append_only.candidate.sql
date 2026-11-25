-- 0171 (CANDIDATA, fora do journal; ENTREGUE à frente da ADR-075 / PR #59) — S5: trilha da CLÍNICA append-only
-- (requisitos 58 e 85 do componente de segurança da ANS: 180 dias sem alterar nem remover).
--
-- Não é um segundo sistema de auditoria: aplica às trilhas da clínica (`audit_events`, particionada por mês, e
-- `hi_account_events`, histórico da conta da guia) o MESMO mecanismo que a ADR-075 aplica à `super_admin_actions`:
--   - REVOKE de UPDATE/DELETE/TRUNCATE dos papéis de aplicação (INSERT e SELECT continuam como estão); o pool
--     administrativo mantém UPDATE em audit_events só para a anonimização LGPD, que o gatilho restringe;
--   - gatilho que recusa UPDATE/DELETE em toda linha e TRUNCATE no comando, com `ENABLE ALWAYS` (vale também com
--     `session_replication_role = replica`, que desligaria um gatilho comum);
--   - em tabela particionada o gatilho de linha do pai vale para todas as partições, inclusive as futuras.
--
-- O que ISTO NÃO resolve (honesto, igual à ADR-075): o dono do banco ainda pode DESABILITAR/REMOVER o gatilho por
-- DDL ou fazer DETACH de uma partição. Contra privilégio total:
--   (1) detecção: checagem do catálogo (gatilho presente, habilitado ALWAYS, função íntegra) no /api/health,
--       parte 2 da ADR-075;
--   (2) DETACH < 180 dias: o único caminho do app é o cron de partições; ele passa a recusar partição com menos de
--       180 dias (guarda no código, ver contrato);
--   (3) evidência externa: resumo diário (SHA-256 encadeado das linhas do dia) enviado a um destino fora do banco
--       (log externo) — o risco `auditoria-sem-hash-chain` do registro de riscos. Proposta no contrato, não feita.
--
-- Número: depois da 0169 (P4.7-b) e da 0170 (S4); a 0168 é a Pix do #64. Coordenar com a numeração do #59 (a
-- candidata dele ainda se chama 0165 e precisa ir para depois destas).

DO $$
BEGIN
  -- UPDATE fica com o pool administrativo só para a anonimização LGPD (o gatilho recusa o resto).
  REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_events FROM PUBLIC, anon, authenticated;
  REVOKE DELETE, TRUNCATE ON public.audit_events FROM service_role;
  REVOKE UPDATE, DELETE, TRUNCATE ON public.hi_account_events FROM PUBLIC, anon, authenticated, service_role;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qoro_runtime') THEN
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_events FROM qoro_runtime';
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON public.hi_account_events FROM qoro_runtime';
  END IF;
END $$;
--> statement-breakpoint

-- Única alteração aceita: a ANONIMIZAÇÃO LGPD do expurgo de paciente (`anonymizePatientAuditTrail`), que só RETIRA
-- chaves de dado pessoal de `before`/`after`. Quem, quando, o quê, operação, finalidade e demais colunas ficam
-- idênticos; qualquer outra mudança (ou chave fora da lista) é recusada. Concilia o requisito 85 da ANS (não
-- alterar o registro) com a minimização da LGPD (art. 6º, III; art. 18, IV).
CREATE OR REPLACE FUNCTION public.clinic_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  pii text[] := ARRAY['nome', 'email', 'dataNascimento', 'sexo', 'obitoEm'];
BEGIN
  -- IF aninhado: NEW.before/NEW.after só existem em audit_events (o PL/pgSQL resolve o campo ao planejar).
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME LIKE 'audit_events%' THEN
    IF (to_jsonb(NEW) - 'before' - 'after') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'before' - 'after')
       AND (NEW.before IS NOT DISTINCT FROM OLD.before OR NEW.before IS NOT DISTINCT FROM (OLD.before - pii))
       AND (NEW.after IS NOT DISTINCT FROM OLD.after OR NEW.after IS NOT DISTINCT FROM (OLD.after - pii)) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION '% é append-only (requisitos 58/85 da ANS): % recusado', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '42501';
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.clinic_audit_append_only() FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint

CREATE TRIGGER audit_events_append_only_row BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.clinic_audit_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only_stmt BEFORE TRUNCATE ON public.audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.clinic_audit_append_only();
--> statement-breakpoint
ALTER TABLE public.audit_events ENABLE ALWAYS TRIGGER audit_events_append_only_row;
--> statement-breakpoint
ALTER TABLE public.audit_events ENABLE ALWAYS TRIGGER audit_events_append_only_stmt;
--> statement-breakpoint

CREATE TRIGGER hi_account_events_append_only_row BEFORE UPDATE OR DELETE ON public.hi_account_events
  FOR EACH ROW EXECUTE FUNCTION public.clinic_audit_append_only();
--> statement-breakpoint
CREATE TRIGGER hi_account_events_append_only_stmt BEFORE TRUNCATE ON public.hi_account_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.clinic_audit_append_only();
--> statement-breakpoint
ALTER TABLE public.hi_account_events ENABLE ALWAYS TRIGGER hi_account_events_append_only_row;
--> statement-breakpoint
ALTER TABLE public.hi_account_events ENABLE ALWAYS TRIGGER hi_account_events_append_only_stmt;
--> statement-breakpoint

INSERT INTO public._schema_version (version) VALUES ('0171-audit-trails-append-only')
  ON CONFLICT DO NOTHING;
