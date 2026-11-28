-- =====================================================================
-- REVERSÃO EXECUTÁVEL da cauda do convênio 0144 → 0158 (ordem inversa, numa transação só).
--
-- Gerada da diferença de catálogo entre o estado da 0143 e o da 0158 (Postgres descartável, ordem
-- do DEV) e PROVADA por `scripts/security/hi-dev-migrator-rehearsal.ts`: depois dela, o dump de
-- estrutura dos schemas public e drizzle é BYTE A BYTE igual ao de antes da cauda, o ledger do
-- Drizzle volta a 144 linhas (última 0143) e os dados existentes não mudam.
--
-- O que a cauda criou e esta reversão remove: 40 tabelas e 6 visões novas (com seus
-- índices, políticas, gatilhos e permissões), 69 funções novas, 5 gatilhos em tabelas
-- compartilhadas, 3 colunas, 3 CHECKs e 1 índice em appointments/lancamentos, as 15 versões e
-- as 15 linhas do ledger. O que a cauda ALTEROU e esta reversão restaura:
-- validate_payment_transaction_insert() (texto da 0073) e lancamentos_auto_origin_chk (da 0108).
-- A cauda não altera nenhuma linha existente nem permissão de objeto antigo (diferença de catálogo).
--
-- SÓ enquanto não existir NENHUM dado de convênio: a primeira instrução recusa se qualquer tabela
-- hi_* tiver linha, se algum atendimento não for particular ou se algum lançamento tiver valor de
-- convênio. Com dado de convênio, a correção é PARA A FRENTE (nova migration), nunca apagar dado
-- financeiro. Decisão de executar: fundador (docs/convenios/aplicacao-0153.md, seção 8).
--
--   psql -v ON_ERROR_STOP=1 -d <URL 5432 do DEV> -f docs/convenios/reversao-cauda-0144-0158.sql
-- =====================================================================
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  r record;
  n bigint;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c
            WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'hi\_%' LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.relname) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'reversão recusada: public.% tem % linha(s); com dado de convênio a correção é para a frente', r.relname, n;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.appointments WHERE billing_mode <> 'particular')
     OR EXISTS (SELECT 1 FROM public.lancamentos WHERE source_hi_guide_id IS NOT NULL OR valor_glosado <> 0) THEN
    RAISE EXCEPTION 'reversão recusada: há atendimento ou lançamento de convênio';
  END IF;
END $$;

-- 1. Gatilhos da cauda nas tabelas compartilhadas (0148, 0151, 0153).
DROP TRIGGER a0_hi_premium_appointment ON public.appointments;
DROP TRIGGER appointments_billing_mode_guard ON public.appointments;
DROP TRIGGER lancamentos_convenio_patient_guard ON public.lancamentos;
DROP TRIGGER lancamentos_insurer_receivable_guard ON public.lancamentos;
DROP TRIGGER payment_transactions_insurer_guard ON public.payment_transactions;

-- 2. Função do livro: de volta ao texto da 0073 (a 0153 acrescentou o ramo de convênio; a 0155, a
--    soma pela clínica). CREATE OR REPLACE mantém dono e permissões.
CREATE OR REPLACE FUNCTION public.validate_payment_transaction_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lancamento_clinic uuid;
  v_lancamento_value numeric(12, 2);
  v_payment_clinic uuid;
  v_payment_lancamento uuid;
  v_payment_kind payment_transaction_kind;
  v_payment_amount numeric(12, 2);
  v_total numeric(12, 2);
BEGIN
  -- Este lock no lancamento e o serializador de pagamentos/refunds do mesmo
  -- titulo. O papel authenticated tem UPDATE em lancamentos, mas continua sem
  -- UPDATE em payment_transactions (ledger append-only).
  SELECT clinic_id, valor
    INTO v_lancamento_clinic, v_lancamento_value
    FROM public.lancamentos
   WHERE id = NEW.lancamento_id
   FOR UPDATE;

  IF NOT FOUND OR v_lancamento_clinic <> NEW.clinic_id THEN
    RAISE EXCEPTION 'payment transaction must reference a lancamento from the same clinic';
  END IF;

  IF NEW.kind = 'payment' THEN
    SELECT COALESCE(sum(amount), 0)
      INTO v_total
      FROM public.payment_transactions
     WHERE lancamento_id = NEW.lancamento_id
       AND kind = 'payment';
    IF v_total + NEW.amount > v_lancamento_value THEN
      RAISE EXCEPTION 'payment exceeds lancamento value';
    END IF;
    RETURN NEW;
  END IF;

  -- NAO usar FOR UPDATE aqui: ele pede UPDATE em payment_transactions e quebra
  -- o contrato append-only. O lancamento ja esta bloqueado acima na mesma TX.
  SELECT clinic_id, lancamento_id, kind, amount
    INTO v_payment_clinic, v_payment_lancamento, v_payment_kind, v_payment_amount
    FROM public.payment_transactions
   WHERE id = NEW.original_payment_id;

  IF NOT FOUND
     OR v_payment_kind <> 'payment'
     OR v_payment_clinic <> NEW.clinic_id
     OR v_payment_lancamento <> NEW.lancamento_id
  THEN
    RAISE EXCEPTION 'refund must reference a payment from the same clinic and lancamento';
  END IF;

  SELECT COALESCE(sum(amount), 0)
    INTO v_total
    FROM public.payment_transactions
   WHERE original_payment_id = NEW.original_payment_id
     AND kind = 'refund';
  IF v_total + NEW.amount > v_payment_amount THEN
    RAISE EXCEPTION 'refund exceeds original payment available amount';
  END IF;
  RETURN NEW;
END $$;

-- 3. Origem obrigatória do automático: de volta à 0108 (antes da cauda), validada.
ALTER TABLE public.lancamentos DROP CONSTRAINT lancamentos_auto_origin_chk;
ALTER TABLE public.lancamentos ADD CONSTRAINT lancamentos_auto_origin_chk CHECK (
  created_via <> 'auto'
  OR appointment_id IS NOT NULL
  OR (source_patient_charge_id IS NOT NULL AND financial_expense_kind IS NOT NULL)
) NOT VALID;
ALTER TABLE public.lancamentos VALIDATE CONSTRAINT lancamentos_auto_origin_chk;

-- 4. Visões novas (0151–0157), antes das colunas de que dependem.
DROP VIEW
  public.hi_guide_accounts,
  public.hi_insurer_receivables,
  public.hi_ledger_drift,
  public.hi_payment_balances,
  public.hi_payout_positions,
  public.qoro_subscription_period_audit;

-- 5. Colunas, CHECKs e índice da cauda nas tabelas compartilhadas (0148, 0153).
DROP INDEX public.lancamentos_hi_guide_uniq;
ALTER TABLE public.lancamentos
  DROP CONSTRAINT lancamentos_insurer_receivable_chk,
  DROP CONSTRAINT lancamentos_valor_glosado_chk,
  DROP COLUMN valor_glosado,
  DROP COLUMN source_hi_guide_id;
ALTER TABLE public.appointments
  DROP CONSTRAINT appointments_billing_mode_chk,
  DROP COLUMN billing_mode;

-- 6. Tabelas novas (0144–0157). CASCADE só alcança objetos da própria cauda: funções com o tipo de
--    linha de uma tabela nova no parâmetro, gatilhos e políticas das tabelas novas (prova: o dump
--    de estrutura depois desta reversão é igual ao de antes).
DROP TABLE
  public.hi_account_events,
  public.hi_appointment_coverages,
  public.hi_authorization_attachments,
  public.hi_authorization_consumptions,
  public.hi_authorization_events,
  public.hi_authorization_items,
  public.hi_authorizations,
  public.hi_batch_events,
  public.hi_batch_guides,
  public.hi_batch_returns,
  public.hi_batches,
  public.hi_billing_gap_events,
  public.hi_billing_gaps,
  public.hi_clinic_settings,
  public.hi_contract_imports,
  public.hi_copayments,
  public.hi_counters,
  public.hi_credentials,
  public.hi_files,
  public.hi_gloss_appeal_items,
  public.hi_gloss_appeals,
  public.hi_glosses,
  public.hi_guide_events,
  public.hi_guide_items,
  public.hi_guide_snapshots,
  public.hi_guides,
  public.hi_insurer_credentials,
  public.hi_insurers,
  public.hi_ledger_entries,
  public.hi_memberships,
  public.hi_payment_allocations,
  public.hi_payments,
  public.hi_payout_movements,
  public.hi_payouts,
  public.hi_plans,
  public.hi_procedure_contracts,
  public.hi_professional_profiles,
  public.hi_sadt_request_events,
  public.hi_sadt_request_items,
  public.hi_sadt_requests
CASCADE;

-- 7. Funções novas restantes (0144–0158), por nome, em todas as assinaturas.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname = ANY (ARRAY[
                'hi_account_assert_capacity',
                'hi_account_lock_guide',
                'hi_account_log',
                'hi_account_settle',
                'hi_account_totals',
                'hi_apply_authorization_consumption',
                'hi_assert_patient_in_clinic',
                'hi_assert_professional_in_clinic',
                'hi_batch_cancel',
                'hi_batch_create',
                'hi_batch_export',
                'hi_batch_lock',
                'hi_batch_log',
                'hi_batch_mark_processed',
                'hi_batch_mark_sent',
                'hi_batch_mark_under_review',
                'hi_batch_move_guides',
                'hi_batch_record_protocol',
                'hi_batch_record_return',
                'hi_batch_reopen',
                'hi_batch_transition',
                'hi_batch_validate',
                'hi_billing_gap_attempts',
                'hi_billing_gap_record_event',
                'hi_block_contract_update',
                'hi_block_mutation',
                'hi_bump_authorization_version',
                'hi_copay_sync_charge',
                'hi_copay_transition',
                'hi_gloss_appeal_answer',
                'hi_gloss_appeal_cancel',
                'hi_gloss_appeal_create',
                'hi_gloss_appeal_file',
                'hi_gloss_record',
                'hi_gloss_transition',
                'hi_guard_appointment_billing_mode',
                'hi_guard_billing_gap',
                'hi_guard_convenio_patient_receivable',
                'hi_guard_coverage',
                'hi_guard_file',
                'hi_guard_guide_item',
                'hi_guard_guide_snapshot',
                'hi_guard_insurer_payment',
                'hi_guard_insurer_receivable',
                'hi_guard_membership_identity',
                'hi_guide_apply_replacement',
                'hi_guide_reconcile',
                'hi_guide_record_event',
                'hi_guide_refs',
                'hi_guide_transition',
                'hi_ledger_is_bridge',
                'hi_ledger_on_account_change',
                'hi_ledger_on_guide_status',
                'hi_ledger_sync_clinic',
                'hi_ledger_sync_guide',
                'hi_next_counter',
                'hi_payment_allocate',
                'hi_payment_record',
                'hi_payment_reverse',
                'hi_payout_movement_guard',
                'hi_payout_position',
                'hi_premium_guard',
                'hi_premium_guard_appointment',
                'hi_sadt_request_guard',
                'hi_session_actor',
                'hi_session_clinic',
                'qoro_plan_includes',
                'qoro_premium_denial',
                'qoro_premium_denial_for'
              ]) LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END $$;

-- 8. Versões e ledger do Drizzle (só as 15 da cauda; a 0143 e as anteriores ficam).
DELETE FROM public._schema_version WHERE version IN (
  '0144-hi-clinic-setup',
  '0145-hi-memberships',
  '0146-hi-authorizations',
  '0147-hi-guides',
  '0148-hi-coverage-copay',
  '0149-hi-billing-gaps',
  '0150-hi-batches',
  '0151-hi-premium-gate',
  '0152-hi-glosses-payments',
  '0153-hi-ledger-bridge',
  '0154-hi-premium-period-evidence',
  '0155-ledger-payment-sum-by-clinic',
  '0156-hi-sadt-requests',
  '0157-hi-professional-payouts',
  '0158-hi-copay-charge'
);
DELETE FROM drizzle.__drizzle_migrations WHERE created_at IN (
  1794367436665, -- 0144_hi_clinic_setup
  1794391493822, -- 0145_hi_memberships
  1794395869610, -- 0146_hi_authorizations
  1794399173366, -- 0147_hi_guides
  1794405160338, -- 0148_hi_coverage_copay
  1794416643149, -- 0149_hi_billing_gaps
  1794418524711, -- 0150_hi_batches
  1794432173857, -- 0151_hi_premium_gate
  1794518573857, -- 0152_hi_glosses_payments
  1794604973857, -- 0153_hi_ledger_bridge
  1794691373857, -- 0154_hi_premium_period_evidence
  1794777773857, -- 0155_ledger_payment_sum_by_clinic
  1794864173857, -- 0156_hi_sadt_requests
  1794950573857, -- 0157_hi_professional_payouts
  1795036973857 -- 0158_hi_copay_charge
);

COMMIT;
