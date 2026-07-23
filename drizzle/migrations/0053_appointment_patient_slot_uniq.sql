-- =====================================================================
-- 0053_appointment_patient_slot_uniq.sql
-- Anti duplo-agendamento DO PACIENTE no mesmo instante.
--
-- Já existe `appointments_doctor_slot_uniq (doctor_id, scheduled_at)` que impede
-- dois pacientes no mesmo médico+instante. Faltava o simétrico: o MESMO paciente
-- marcado no mesmo instante com médicos DIFERENTES (uma pessoa não está em dois
-- lugares). Bug reportado — e crítico porque o agente de IA agenda pelo mesmo
-- core (schedulingApiV1.createAppointment → createAppointmentCore).
--
-- O índice é PARCIAL: só linhas que ocupam o instante (status <> cancelado/faltou,
-- via a coluna gerada slot_occupies_instant) e com paciente identificado
-- (patient_id IS NOT NULL — "Encaixe" walk-in sem paciente não colide).
--
-- Limpeza legada: dados de teste podem já ter a duplicata (o bug permitia). O
-- índice único não seria criável com elas ativas — então cancelamos as
-- excedentes (mantendo a MAIS ANTIGA por paciente+instante). Idempotente: num
-- banco sem duplicatas o UPDATE afeta 0 linhas. O trigger de imutabilidade só
-- protege colunas de snapshot, não `status` — o UPDATE é seguro.
-- =====================================================================

UPDATE appointments SET status = 'cancelado'
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           row_number() OVER (PARTITION BY patient_id, scheduled_at ORDER BY created_at) AS rn
      FROM appointments
     WHERE patient_id IS NOT NULL
       AND status NOT IN ('cancelado', 'faltou')
  ) dup
  WHERE dup.rn > 1
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "appointments_patient_slot_uniq"
  ON "appointments" USING btree ("patient_id", "scheduled_at")
  WHERE slot_occupies_instant AND patient_id IS NOT NULL;--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0053-appointment-patient-slot-uniq')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
