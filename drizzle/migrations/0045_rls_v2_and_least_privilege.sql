-- =====================================================================
-- 0045 — RLS policy v2 (InitPlan) + least-privilege dos grants do `public`.
--
-- Fecha os achados A14 e A13 da auditoria de banco. Ver ADR-042.
--
-- ── ATOMICIDADE (leia antes de "melhorar" com BEGIN/COMMIT) ──────────
-- Esta migration DROPa e RECRIA 65 policies. A janela em que uma tabela fica
-- sem policy é atômica e invisível: o runner (`drizzle-kit migrate` → migrator
-- do drizzle-orm) executa TODAS as migrations pendentes dentro de UMA
-- transação (`session.transaction(...)`, drizzle-orm/pg-core/dialect.cjs:62).
-- NÃO adicione `BEGIN;`/`COMMIT;` aqui: o `COMMIT` encerraria a transação
-- EXTERNA, e tudo depois dele rodaria em autocommit — uma falha posterior
-- deixaria o banco meio migrado. Nenhuma das 44 migrations anteriores usa
-- BEGIN/COMMIT. Se falhar, nada é aplicado.
--
-- ── A14: por que envolver em (select ...) ────────────────────────────
-- O predicado chamava current_setting()/current_clinic_id()/is_super_admin()
-- direto, então o Postgres os re-avaliava POR LINHA varrida. Envolvidos em
-- subquery escalar, viram InitPlan: 1× por query. As 3 funções são STABLE
-- (0001), que é justamente o que autoriza o hoist. Medido: 65 policies com
-- `auth_rls_initplan` em dev e prod; 0 envolvidas.
-- Semântica intacta: `SET LOCAL` do withTenant roda ANTES da query, então o
-- InitPlan lê o mesmo GUC de sempre.
--
-- ── Como este DDL foi produzido (determinismo) ───────────────────────
-- As 46 policies canônicas são a saída LITERAL de defaultTenantPolicy(v2)
-- (src/lib/db/rls.ts) — o helper continua sendo a fonte única; o fingerprint
-- v1→v2 é o rastro. As 19 manuais foram copiadas de pg_policies preservando
-- cmd/roles/predicado, com os helpers envolvidos. Nada de DO $$ dinâmico.
--
-- 🔴 ADR-041 / I-13: `user_permission_overrides` é tabela de AUTHZ, não de
-- tenant. A 0040 tirou dela o defaultTenantPolicy (FOR ALL) porque era
-- escalonamento de privilégio: qualquer authenticated se auto-concedia
-- permissão via PostgREST. Ela é re-emitida abaixo como FOR SELECT.
-- NUNCA reaplique defaultTenantPolicy nessa tabela.
--
-- ── A13: least-privilege (e por que o REVOKE sozinho não resolvia) ───
-- A auditoria propôs `REVOKE TRUNCATE, REFERENCES, TRIGGER FROM anon,
-- authenticated`. Isso limpa as 87 tabelas de HOJE e não impede a PRÓXIMA
-- tabela de nascer exposta: a origem é o `ALTER DEFAULT PRIVILEGES` do
-- Supabase (pg_default_acl: anon=arwdDxtm). Sem mexer no default ACL, o
-- achado volta na primeira migration nova. Por isso os dois passos.
--
-- Escopo medido, não presumido:
--   • `anon` → REVOKE ALL. O app NÃO usa a Data API para dados: existem 2
--     leituras PostgREST no código todo (login/actions.ts:56 e
--     login/mfa/actions.ts:50), ambas PÓS-signIn (role `authenticated`), e
--     nenhum código assume a role anon. Realtime autentica com o JWT do
--     usuário (setAuth). Todas as policies de catálogo são TO authenticated,
--     então anon já recebia 0 linhas por RLS — isto é defesa-em-profundidade
--     sem mudança de comportamento.
--   • `authenticated` → REVOKE só TRUNCATE/REFERENCES/TRIGGER. O DML É
--     LOAD-BEARING: `qoro_runtime` é MEMBRO de `authenticated` e o withTenant
--     faz `SET LOCAL ROLE authenticated` (tenant.ts:60) — revogar SELECT/
--     INSERT/UPDATE/DELETE derrubaria o app inteiro. RLS não cobre TRUNCATE.
--
-- Rollback: re-executar a 0044 anterior não recupera as policies v1, mas o
-- predicado v2 é semanticamente idêntico ao v1; reverter é reemitir com o
-- helper. Os grants voltam com GRANT explícito (documentado no ADR-042).
-- =====================================================================

-- ============ 46 policies canônicas (saída do defaultTenantPolicy v2) ============
DROP POLICY IF EXISTS ai_agent_failures_tenant_access ON ai_agent_failures;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE ai_agent_failures ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai_agent_failures FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY ai_agent_failures_tenant_access ON ai_agent_failures FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS ai_clinic_config_tenant_access ON ai_clinic_config;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE ai_clinic_config ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai_clinic_config FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY ai_clinic_config_tenant_access ON ai_clinic_config FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS ai_conversations_tenant_access ON ai_conversations;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai_conversations FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY ai_conversations_tenant_access ON ai_conversations FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS ai_handoff_queue_tenant_access ON ai_handoff_queue;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE ai_handoff_queue ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai_handoff_queue FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY ai_handoff_queue_tenant_access ON ai_handoff_queue FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS ai_messages_tenant_access ON ai_messages;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai_messages FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY ai_messages_tenant_access ON ai_messages FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS annual_prepayments_tenant_access ON annual_prepayments;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE annual_prepayments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE annual_prepayments FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY annual_prepayments_tenant_access ON annual_prepayments FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS appointment_state_log_tenant_access ON appointment_state_log;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE appointment_state_log ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE appointment_state_log FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY appointment_state_log_tenant_access ON appointment_state_log FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS appointments_tenant_access ON appointments;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE appointments FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY appointments_tenant_access ON appointments FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS billing_customers_tenant_access ON billing_customers;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE billing_customers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE billing_customers FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY billing_customers_tenant_access ON billing_customers FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS billing_events_tenant_access ON billing_events;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE billing_events FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY billing_events_tenant_access ON billing_events FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS cash_flow_daily_tenant_access ON cash_flow_daily;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE cash_flow_daily ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE cash_flow_daily FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY cash_flow_daily_tenant_access ON cash_flow_daily FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS clinic_holidays_tenant_access ON clinic_holidays;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE clinic_holidays ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clinic_holidays FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY clinic_holidays_tenant_access ON clinic_holidays FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS clinic_units_tenant_access ON clinic_units;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE clinic_units ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clinic_units FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY clinic_units_tenant_access ON clinic_units FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS clinic_whatsapp_numbers_tenant_access ON clinic_whatsapp_numbers;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE clinic_whatsapp_numbers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clinic_whatsapp_numbers FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY clinic_whatsapp_numbers_tenant_access ON clinic_whatsapp_numbers FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS doctor_availability_tenant_access ON doctor_availability;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE doctor_availability ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE doctor_availability FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY doctor_availability_tenant_access ON doctor_availability FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS faturamento_pendencias_tenant_access ON faturamento_pendencias;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE faturamento_pendencias ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE faturamento_pendencias FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY faturamento_pendencias_tenant_access ON faturamento_pendencias FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS idempotency_keys_tenant_access ON idempotency_keys;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE idempotency_keys FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY idempotency_keys_tenant_access ON idempotency_keys FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS inbound_messages_raw_tenant_access ON inbound_messages_raw;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE inbound_messages_raw ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE inbound_messages_raw FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY inbound_messages_raw_tenant_access ON inbound_messages_raw FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS invoice_items_tenant_access ON invoice_items;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE invoice_items FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY invoice_items_tenant_access ON invoice_items FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS invoices_tenant_access ON invoices;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE invoices FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY invoices_tenant_access ON invoices FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS lancamentos_tenant_access ON lancamentos;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE lancamentos ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE lancamentos FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY lancamentos_tenant_access ON lancamentos FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS lgpd_requests_tenant_access ON lgpd_requests;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE lgpd_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE lgpd_requests FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY lgpd_requests_tenant_access ON lgpd_requests FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS medical_documents_tenant_access ON medical_documents;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE medical_documents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE medical_documents FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY medical_documents_tenant_access ON medical_documents FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS outbound_messages_tenant_access ON outbound_messages;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE outbound_messages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE outbound_messages FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY outbound_messages_tenant_access ON outbound_messages FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS patient_addresses_tenant_access ON patient_addresses;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE patient_addresses ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE patient_addresses FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY patient_addresses_tenant_access ON patient_addresses FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS patient_clinical_data_tenant_access ON patient_clinical_data;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE patient_clinical_data ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE patient_clinical_data FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY patient_clinical_data_tenant_access ON patient_clinical_data FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS patient_consents_tenant_access ON patient_consents;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE patient_consents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE patient_consents FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY patient_consents_tenant_access ON patient_consents FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS patient_emergency_contacts_tenant_access ON patient_emergency_contacts;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE patient_emergency_contacts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE patient_emergency_contacts FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY patient_emergency_contacts_tenant_access ON patient_emergency_contacts FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS patients_tenant_access ON patients;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE patients FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY patients_tenant_access ON patients FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS payment_attempts_tenant_access ON payment_attempts;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE payment_attempts FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY payment_attempts_tenant_access ON payment_attempts FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS payment_proofs_tenant_access ON payment_proofs;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE payment_proofs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE payment_proofs FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY payment_proofs_tenant_access ON payment_proofs FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS prescription_templates_tenant_access ON prescription_templates;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE prescription_templates ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE prescription_templates FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY prescription_templates_tenant_access ON prescription_templates FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS prescriptions_tenant_access ON prescriptions;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE prescriptions FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY prescriptions_tenant_access ON prescriptions FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS procedure_history_tenant_access ON procedure_history;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE procedure_history ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE procedure_history FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY procedure_history_tenant_access ON procedure_history FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS procedures_tenant_access ON procedures;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE procedures ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE procedures FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY procedures_tenant_access ON procedures FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS prontuario_versions_tenant_access ON prontuario_versions;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE prontuario_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE prontuario_versions FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY prontuario_versions_tenant_access ON prontuario_versions FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS prontuarios_tenant_access ON prontuarios;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE prontuarios ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE prontuarios FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY prontuarios_tenant_access ON prontuarios FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS provider_status_events_raw_tenant_access ON provider_status_events_raw;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE provider_status_events_raw ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE provider_status_events_raw FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY provider_status_events_raw_tenant_access ON provider_status_events_raw FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS setup_fees_tenant_access ON setup_fees;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE setup_fees ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE setup_fees FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY setup_fees_tenant_access ON setup_fees FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS subscription_history_tenant_access ON subscription_history;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE subscription_history ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE subscription_history FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY subscription_history_tenant_access ON subscription_history FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS subscriptions_tenant_access ON subscriptions;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE subscriptions FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY subscriptions_tenant_access ON subscriptions FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS suppliers_tenant_access ON suppliers;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE suppliers FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY suppliers_tenant_access ON suppliers FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS suppression_list_tenant_access ON suppression_list;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE suppression_list ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE suppression_list FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY suppression_list_tenant_access ON suppression_list FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS system_metrics_daily_tenant_access ON system_metrics_daily;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE system_metrics_daily ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE system_metrics_daily FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY system_metrics_daily_tenant_access ON system_metrics_daily FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS usage_counter_ledger_tenant_access ON usage_counter_ledger;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE usage_counter_ledger ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE usage_counter_ledger FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY usage_counter_ledger_tenant_access ON usage_counter_ledger FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS usage_metrics_tenant_access ON usage_metrics;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE usage_metrics ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE usage_metrics FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY usage_metrics_tenant_access ON usage_metrics FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

-- ============ 19 policies manuais (wrap preservando cmd/roles) ============
DROP POLICY IF EXISTS ai_proactive_jobs_tenant_select ON ai_proactive_jobs;--> statement-breakpoint
CREATE POLICY ai_proactive_jobs_tenant_select ON ai_proactive_jobs FOR SELECT
  USING (
      (clinic_id)::text = (select current_setting('app.current_clinic', true))
      OR (clinic_id)::text = (select current_clinic_id())
      OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS ai_proactive_jobs_tenant_insert ON ai_proactive_jobs;--> statement-breakpoint
CREATE POLICY ai_proactive_jobs_tenant_insert ON ai_proactive_jobs FOR INSERT
  WITH CHECK (
      (clinic_id)::text = (select current_setting('app.current_clinic', true))
      OR (clinic_id)::text = (select current_clinic_id())
      OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS ai_proactive_jobs_tenant_update ON ai_proactive_jobs;--> statement-breakpoint
CREATE POLICY ai_proactive_jobs_tenant_update ON ai_proactive_jobs FOR UPDATE
  USING (
      (clinic_id)::text = (select current_setting('app.current_clinic', true))
      OR (clinic_id)::text = (select current_clinic_id())
      OR (select is_super_admin())
  )
  WITH CHECK (
      (clinic_id)::text = (select current_setting('app.current_clinic', true))
      OR (clinic_id)::text = (select current_clinic_id())
      OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS audit_events_tenant_select ON audit_events;--> statement-breakpoint
CREATE POLICY audit_events_tenant_select ON audit_events FOR SELECT
  USING (
      (clinic_id)::text = (select current_setting('app.current_clinic', true))
      OR (clinic_id)::text = (select current_clinic_id())
      OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS audit_events_tenant_insert ON audit_events;--> statement-breakpoint
CREATE POLICY audit_events_tenant_insert ON audit_events FOR INSERT
  WITH CHECK (
      (clinic_id)::text = (select current_setting('app.current_clinic', true))
      OR (clinic_id)::text = (select current_clinic_id())
      OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS clinics_tenant_select ON clinics;--> statement-breakpoint
CREATE POLICY clinics_tenant_select ON clinics FOR SELECT
  USING (
      (id)::text = (select current_setting('app.current_clinic', true))
      OR (id)::text = (select current_clinic_id())
      OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS clinics_superadmin_insert ON clinics;--> statement-breakpoint
CREATE POLICY clinics_superadmin_insert ON clinics FOR INSERT
  WITH CHECK (
      (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS clinics_superadmin_update ON clinics;--> statement-breakpoint
CREATE POLICY clinics_superadmin_update ON clinics FOR UPDATE
  USING (
      (select is_super_admin())
  )
  WITH CHECK (
      (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS clinics_superadmin_delete ON clinics;--> statement-breakpoint
CREATE POLICY clinics_superadmin_delete ON clinics FOR DELETE
  USING (
      (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS impersonation_sessions_super_select ON impersonation_sessions;--> statement-breakpoint
CREATE POLICY impersonation_sessions_super_select ON impersonation_sessions FOR SELECT
  USING (
      (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS inbound_messages_orphaned_super_admin_only ON inbound_messages_orphaned;--> statement-breakpoint
CREATE POLICY inbound_messages_orphaned_super_admin_only ON inbound_messages_orphaned FOR ALL
  USING (
      (select is_super_admin())
  )
  WITH CHECK (
      (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS login_attempts_superadmin_select ON login_attempts;--> statement-breakpoint
CREATE POLICY login_attempts_superadmin_select ON login_attempts FOR SELECT
  USING (
      (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS outbox_tenant_select ON outbox;--> statement-breakpoint
CREATE POLICY outbox_tenant_select ON outbox FOR SELECT
  USING (
      (clinic_id)::text = (select current_setting('app.current_clinic', true))
      OR (clinic_id)::text = (select current_clinic_id())
      OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS outbox_tenant_insert ON outbox;--> statement-breakpoint
CREATE POLICY outbox_tenant_insert ON outbox FOR INSERT
  WITH CHECK (
      (clinic_id)::text = (select current_setting('app.current_clinic', true))
      OR (clinic_id)::text = (select current_clinic_id())
      OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS profiles_tenant_select ON profiles;--> statement-breakpoint
CREATE POLICY profiles_tenant_select ON profiles FOR SELECT
  USING (
      (clinic_id)::text = (select current_setting('app.current_clinic', true))
      OR (clinic_id)::text = (select current_clinic_id())
      OR (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS profiles_superadmin_all ON profiles;--> statement-breakpoint
CREATE POLICY profiles_superadmin_all ON profiles FOR ALL
  USING (
      (select is_super_admin())
  )
  WITH CHECK (
      (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS super_admin_actions_super_select ON super_admin_actions;--> statement-breakpoint
CREATE POLICY super_admin_actions_super_select ON super_admin_actions FOR SELECT
  USING (
      (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS super_admin_actions_super_insert ON super_admin_actions;--> statement-breakpoint
CREATE POLICY super_admin_actions_super_insert ON super_admin_actions FOR INSERT
  WITH CHECK (
      (select is_super_admin())
  );--> statement-breakpoint

DROP POLICY IF EXISTS user_permission_overrides_tenant_select ON user_permission_overrides;--> statement-breakpoint
CREATE POLICY user_permission_overrides_tenant_select ON user_permission_overrides FOR SELECT
  USING (
      (clinic_id)::text = (select current_setting('app.current_clinic', true))
      OR (clinic_id)::text = (select current_clinic_id())
      OR (select is_super_admin())
  );--> statement-breakpoint

-- ============ A13 — least-privilege dos grants do schema `public` ============

-- (1) Tabelas que JÁ existem. `anon` não precisa de nada (ver cabeçalho).
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;--> statement-breakpoint

-- `authenticated` MANTÉM o DML (withTenant faz SET LOCAL ROLE authenticated).
-- Some só o que a app nunca usa — e que o RLS não cobre (TRUNCATE) ou que é
-- privilégio de DDL (REFERENCES/TRIGGER).
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;--> statement-breakpoint

-- (2) CAUSA-RAIZ: tabelas FUTURAS. Sem isto, o default ACL do Supabase reconcede
--     tudo na próxima migration que criar tabela — e o achado A13 renasce.
--     `FOR ROLE postgres` porque é a role que cria os objetos nas migrations.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated;--> statement-breakpoint

-- (3) Mesma causa-raiz, face de FUNÇÃO (A15). A 0038 revogou EXECUTE das funções
--     de trigger/event UMA A UMA; o default ACL continua expondo toda função
--     NOVA como /rest/v1/rpc/<fn>. Isto torna o fail-closed o padrão: função
--     nova nasce sem EXECUTE para anon/authenticated, e quem quiser expor uma
--     RPC de propósito (ex.: mark_mfa_enrolled) dá GRANT explícito — que é o que
--     o ADR-010 já exige por convenção, agora garantido pelo mecanismo.
--     Não afeta as funções existentes (mark_mfa_enrolled mantém o grant dela).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;--> statement-breakpoint

-- ============ A15 (resíduo) — record_login_attempt ============
-- A 0042 revogou de `anon` e moveu o call-site para dbAdmin (I-11a), mas
-- `authenticated` continuou com EXECUTE — o advisor de prod ainda a lista como
-- RPC exposta. Nenhum caminho da app a chama via PostgREST (grep: zero
-- `supabase.rpc('record_login_attempt')`); o login usa dbAdmin.
REVOKE EXECUTE ON FUNCTION public.record_login_attempt(text, inet, boolean) FROM authenticated;--> statement-breakpoint

-- Schema version snapshot
INSERT INTO _schema_version (version) VALUES ('db-audit-rls-v2-least-privilege')
ON CONFLICT (version) DO NOTHING;
