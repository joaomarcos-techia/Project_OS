-- =====================================================================
-- 0044 — Índices de FK e de tenant (auditoria de banco: A6 + achado novo N1).
--
-- POR QUÊ (a regra que ordena a lista): o Postgres NÃO cria índice para coluna
-- de FK, e a checagem de integridade referencial que ele roda ao apagar o PAI é
-- `SELECT 1 FROM filha WHERE <fkcol> = $1` — SEM clinic_id. Por isso os índices
-- compostos que o projeto já tem (`(clinic_id, patient_id)`) NÃO servem a essa
-- checagem: eles lideram por clinic_id. Sem um índice LIDERADO pela coluna da
-- FK, apagar um paciente (hard-delete LGPD), um membro, um procedimento ou um
-- fornecedor faz seq scan das filhas.
--
-- N1 (novo, não estava na auditoria): `appointment_state_log` e
-- `procedure_history` são tenant-scoped, TÊM policy de RLS e não tinham índice
-- ALGUM em clinic_id — ou seja, o predicado do RLS varria a tabela inteira em
-- toda query tenant. Contradiz o "ponto forte" §7 da auditoria e a convenção D9.
--
-- CRITÉRIO (índice sem necessidade também é dívida — só entram os justificados):
--   ENTRAM: FKs cujo pai é apagado numa operação REAL de produto (offboarding de
--     clínica, hard-delete LGPD, offboarding de membro, exclusão de procedimento/
--     fornecedor/unidade, purga de retenção da IA) OU cuja filha cresce sem teto.
--   FICAM DE FORA (deliberado): FKs para catálogos que o produto nunca apaga
--     (plans, prices, permissions, payment_methods) e filhas de tamanho limitado
--     (doctor_availability/clinic_holidays ~dezenas de linhas por clínica;
--     tenant_provisioning ~1 linha por clínica). Seq scan lá é de milissegundos.
--
-- SEGURO AGORA: prod tem 0 linhas nas tabelas de negócio → CREATE INDEX é
-- instantâneo e não precisa de CONCURRENTLY (que nem rodaria: migration é
-- transacional). Esta janela não se repete.
--
-- ⚠️ O `SET DEFAULT now()` abaixo NÃO é mudança nova: a 0041 (linha 51) já o
-- aplicou e o banco já está assim. Ele reaparece aqui porque a 0041 foi escrita
-- à mão e não gerou snapshot — o `db:generate` diffou contra o snapshot 0037.
-- É a dívida D6 se manifestando; o statement é idempotente e correto, e o
-- snapshot 0044 fecha a lacuna (daqui pra frente a cadeia é contígua).
-- =====================================================================
ALTER TABLE "profiles" ALTER COLUMN "invite_accepted_at" SET DEFAULT now();--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_state_log_clinic_id_idx" ON "appointment_state_log" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_patient_id_idx" ON "appointments" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_procedure_id_idx" ON "appointments" USING btree ("procedure_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_unit_id_idx" ON "appointments" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_rescheduled_from_idx" ON "appointments" USING btree ("rescheduled_from_appointment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procedure_history_clinic_id_idx" ON "procedure_history" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "medical_documents_patient_id_idx" ON "medical_documents" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "medical_documents_doctor_id_idx" ON "medical_documents" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prescriptions_patient_id_idx" ON "prescriptions" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prescriptions_doctor_id_idx" ON "prescriptions" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prontuarios_patient_id_idx" ON "prontuarios" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prontuarios_doctor_id_idx" ON "prontuarios" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prontuarios_signed_by_idx" ON "prontuarios" USING btree ("signed_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lancamentos_supplier_id_idx" ON "lancamentos" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lancamentos_patient_id_idx" ON "lancamentos" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lancamentos_unit_id_idx" ON "lancamentos" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_messages_conversation_id_idx" ON "ai_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "checkout_sessions_clinic_id_idx" ON "checkout_sessions" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "processed_webhooks_clinic_id_idx" ON "processed_webhooks" USING btree ("clinic_id");