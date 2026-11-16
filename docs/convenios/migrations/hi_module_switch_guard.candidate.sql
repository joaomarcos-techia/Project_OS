-- =====================================================================
-- CANDIDATA SEM NÚMERO — Convênios: interruptor do módulo também no banco
-- (defesa em profundidade da classe A; docs/convenios/modulo-desligado.md §7)
--
-- SITUAÇÃO: proposta técnica preparada em 16/11/2026. NÃO está em drizzle/migrations nem
-- no journal. NÃO tem número reservado: o número é decidido só na autorização, depois da
-- 0162 e conforme a coordenação com o #53 (docs/convenios/coordenacao-migrations.md). NÃO
-- foi aplicada no DEV nem em produção. NÃO faz parte da 0162 nem do pacote SaaS do
-- AbacatePay (Gate B 0136–0159). Prova em Postgres descartável, com dados sintéticos:
-- scripts/security/health-insurance-module-switch-triggers-db.ts (job sintético do Actions).
--
-- POR QUE: o serviço já recusa a classe A com o módulo desligado (assertConveniosOperableTx,
-- 15/11). O banco só conferia o D24 (assinatura), não o interruptor. Uma chamada que pule o
-- serviço (script, função do banco chamada direto, caminho novo que esqueça o guard) ainda
-- podia criar ou avançar trabalho TISS numa clínica com o módulo desligado.
--
-- O QUE BARRA (só a classe A, a mesma do serviço; o resto passa):
--   hi_guides            INSERT; ready_for_review → reviewed (conferir); reviewed → approved
--                        (aprovar e emitir); mudança de consulta_overrides (ajustar a Consulta)
--   hi_guide_snapshots   INSERT (emissão)
--   hi_batches           INSERT; status → validated, exported ou sent (montar, exportar, enviar)
--   hi_files             INSERT dos tipos que nascem de operação nova: batch_xml,
--                        authorization_request_xml, authorization_request_pdf
--   hi_authorizations    INSERT (pedido de autorização)
--   hi_sadt_requests     INSERT (solicitação SP/SADT)
--   hi_appointment_coverages INSERT (cobertura no check-in)
--   hi_copayments        status → confirmed (confirmar a coparticipação)
--
-- O QUE CONTINUA PASSANDO (classes B e C e recuperação):
--   - cancelar guia; devolver para correção; reabrir guia aprovada;
--   - guia voltando a "approved" por cancelamento ou reabertura de lote (exported/in_batch →
--     approved): só reviewed → approved é barrado;
--   - protocolo, análise, retorno e demonstrativo do lote (hi_files batch_return), recurso de
--     glosa (gloss_appeal_xml), glosas, pagamentos, alocações e estornos de alocação;
--   - repasse do convênio (hi_payouts, hi_payout_movements);
--   - resposta e vencimento de autorização (UPDATE de hi_authorizations), comprovante;
--   - cancelar ou concluir solicitação SP/SADT;
--   - coparticipação já confirmada indo a "charged" (portão próprio patient_charges);
--   - ligar e desligar o módulo (o D24 continua decidindo o ligar);
--   - carteirinha (hi_memberships) e forma de atendimento (a 0148 já exige o módulo ligado);
--   - guide_pdf (renderização do que já foi emitido; classe B).
--
-- ORDEM: os gatilhos se chamam hi_ab_module_* e disparam DEPOIS dos hi_aa_premium_* (D24) e
-- ANTES das validações de cada tabela (o Postgres ordena por nome). No trial ou com a
-- assinatura parada, a resposta continua sendo a comercial.
--
-- ERRO: SQLSTATE 55000, CONSTRAINT 'hi_module_enabled', mensagem sem dado interno. Hoje o
-- serviço recusa antes, com ConveniosModuleDisabledError; este erro só aparece num caminho
-- que pule o serviço. O app passa a traduzir esse constraint para a mesma mensagem do
-- módulo, no mesmo commit da aplicação (trabalho de código, não desta candidata).
--
-- OPERAÇÕES INTERNAS:
--   - restauração de backup: carregar dados com os gatilhos de usuário desligados
--     (session_replication_role = replica, ou pg_dump/pg_restore --disable-triggers), como
--     já exigem os gatilhos D24 da 0151. A prova sintética cobre o caminho replica;
--   - backfill ou migration futura que precise inserir nessas tabelas para clínica com o
--     módulo desligado: desligar o gatilho NOMINALMENTE dentro da própria migration
--     (ALTER TABLE ... DISABLE TRIGGER hi_ab_module_<tabela> / ENABLE TRIGGER), visível na
--     revisão. Não há variável de sessão de escape: uma sessão autenticada poderia defini-la.
--
-- Sem BEGIN/COMMIT: o migrator do Drizzle roda tudo numa transação (0045). Reaplicável:
-- CREATE OR REPLACE na função e DROP TRIGGER IF EXISTS antes de cada CREATE TRIGGER.
--
-- REVERSÃO (não toca em dado; o serviço continua barrando a classe A):
--   DROP TRIGGER IF EXISTS hi_ab_module_guides ON public.hi_guides;
--   DROP TRIGGER IF EXISTS hi_ab_module_snapshots ON public.hi_guide_snapshots;
--   DROP TRIGGER IF EXISTS hi_ab_module_batches ON public.hi_batches;
--   DROP TRIGGER IF EXISTS hi_ab_module_files ON public.hi_files;
--   DROP TRIGGER IF EXISTS hi_ab_module_authorizations ON public.hi_authorizations;
--   DROP TRIGGER IF EXISTS hi_ab_module_sadt_requests ON public.hi_sadt_requests;
--   DROP TRIGGER IF EXISTS hi_ab_module_coverages ON public.hi_appointment_coverages;
--   DROP TRIGGER IF EXISTS hi_ab_module_copayments ON public.hi_copayments;
--   DROP FUNCTION IF EXISTS public.hi_module_guard();
-- =====================================================================

CREATE OR REPLACE FUNCTION public.hi_module_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_advance boolean := true;
BEGIN
  IF TG_TABLE_NAME = 'hi_guides' THEN
    v_advance := TG_OP = 'INSERT'
      OR (NEW.status IS DISTINCT FROM OLD.status AND (
            (OLD.status = 'ready_for_review' AND NEW.status = 'reviewed')
         OR (OLD.status = 'reviewed' AND NEW.status = 'approved')))
      OR NEW.consulta_overrides IS DISTINCT FROM OLD.consulta_overrides;
  ELSIF TG_TABLE_NAME = 'hi_files' THEN
    -- Lista FECHADA dos tipos de operação nova: um tipo novo não é barrado sem decisão
    -- (a prova sintética reprova se algum tipo do CHECK ficar sem classificação).
    v_advance := NEW.kind IN ('batch_xml', 'authorization_request_xml', 'authorization_request_pdf');
  ELSIF TG_TABLE_NAME = 'hi_batches' THEN
    v_advance := TG_OP = 'INSERT'
      OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('validated', 'exported', 'sent'));
  ELSIF TG_TABLE_NAME = 'hi_copayments' THEN
    v_advance := NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'confirmed';
  END IF;
  IF NOT v_advance THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.hi_clinic_settings s WHERE s.clinic_id = NEW.clinic_id AND s.enabled
  ) THEN
    RAISE EXCEPTION 'Convênios está desligado nesta clínica.'
      USING ERRCODE = '55000', CONSTRAINT = 'hi_module_enabled';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_module_guard() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

DROP TRIGGER IF EXISTS hi_ab_module_guides ON public.hi_guides;
--> statement-breakpoint
CREATE TRIGGER hi_ab_module_guides BEFORE INSERT OR UPDATE OF status, consulta_overrides ON public.hi_guides
  FOR EACH ROW EXECUTE FUNCTION public.hi_module_guard();
--> statement-breakpoint
DROP TRIGGER IF EXISTS hi_ab_module_snapshots ON public.hi_guide_snapshots;
--> statement-breakpoint
CREATE TRIGGER hi_ab_module_snapshots BEFORE INSERT ON public.hi_guide_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.hi_module_guard();
--> statement-breakpoint
DROP TRIGGER IF EXISTS hi_ab_module_batches ON public.hi_batches;
--> statement-breakpoint
CREATE TRIGGER hi_ab_module_batches BEFORE INSERT OR UPDATE OF status ON public.hi_batches
  FOR EACH ROW EXECUTE FUNCTION public.hi_module_guard();
--> statement-breakpoint
DROP TRIGGER IF EXISTS hi_ab_module_files ON public.hi_files;
--> statement-breakpoint
CREATE TRIGGER hi_ab_module_files BEFORE INSERT ON public.hi_files
  FOR EACH ROW EXECUTE FUNCTION public.hi_module_guard();
--> statement-breakpoint
DROP TRIGGER IF EXISTS hi_ab_module_authorizations ON public.hi_authorizations;
--> statement-breakpoint
CREATE TRIGGER hi_ab_module_authorizations BEFORE INSERT ON public.hi_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.hi_module_guard();
--> statement-breakpoint
DROP TRIGGER IF EXISTS hi_ab_module_sadt_requests ON public.hi_sadt_requests;
--> statement-breakpoint
CREATE TRIGGER hi_ab_module_sadt_requests BEFORE INSERT ON public.hi_sadt_requests
  FOR EACH ROW EXECUTE FUNCTION public.hi_module_guard();
--> statement-breakpoint
DROP TRIGGER IF EXISTS hi_ab_module_coverages ON public.hi_appointment_coverages;
--> statement-breakpoint
CREATE TRIGGER hi_ab_module_coverages BEFORE INSERT ON public.hi_appointment_coverages
  FOR EACH ROW EXECUTE FUNCTION public.hi_module_guard();
--> statement-breakpoint
DROP TRIGGER IF EXISTS hi_ab_module_copayments ON public.hi_copayments;
--> statement-breakpoint
CREATE TRIGGER hi_ab_module_copayments BEFORE UPDATE OF status ON public.hi_copayments
  FOR EACH ROW EXECUTE FUNCTION public.hi_module_guard();
