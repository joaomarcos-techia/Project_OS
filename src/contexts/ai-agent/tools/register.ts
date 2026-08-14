/**
 * Registro CANÔNICO das tools do agente (C12) — FONTE ÚNICA da whitelist (G9).
 *
 * Importar este módulo registra, por efeito colateral, EXATAMENTE o conjunto de
 * tools que a produção expõe ao modelo. Tanto o handler da saga
 * (inbound-received) quanto os scripts de verificação (gemini-live-check,
 * ai-adversarial-check) devem importar SÓ daqui — assim as declarações enviadas
 * ao Gemini são idênticas em produção e nos checks (sem drift de whitelist).
 *
 * `PRODUCTION_TOOL_NAMES` é a lista de nomes esperada, verificada por teste
 * (register.test.ts) contra `listTools()` do registry — qualquer tool a mais ou
 * a menos quebra o teste antes de chegar ao modelo.
 */
import './provide-clinic-info';
import './provide-procedure-price';
import './request-human-handoff';
import './list-slots';
import './prepare-appointment';
import './confirm-appointment';
import './list-my-appointments';
import './cancel-appointment';
import './reschedule-appointment';
import './confirm-pending-action';
import './list-pending-payments';
import './lgpd-export-request';
import './lgpd-delete-request';
import './patient-lookup';
import './collect-patient-data';

/**
 * Nomes das 15 tools de produção (3 da C11 + 12 da C12).
 *
 * F-12 (auditoria 2026-08-14): `schedule_appointment` saiu do catálogo. Ela
 * aceitava doctor_id/procedure_id arbitrários do modelo, NÃO checava
 * disponibilidade e resumia como "Agendar consulta para <ISO cru>" — o paciente
 * confirmava um texto ilegível e o erro só aparecia na execução.
 * `prepare_appointment` resolve serviço, profissional e horário server-side e é
 * o único caminho de marcação,
 * na ordem de registro. Contrato: mudou aqui → mude o import acima E confirme em
 * register.test.ts.
 */
export const PRODUCTION_TOOL_NAMES = [
  'provide_clinic_info',
  'provide_procedure_price',
  'request_human_handoff',
  'list_slots',
  'prepare_appointment',
  'confirm_appointment',
  'list_my_appointments',
  'cancel_appointment',
  'reschedule_appointment',
  'confirm_pending_action',
  'list_pending_payments',
  'lgpd_export_request',
  'lgpd_delete_request',
  'patient_lookup',
  'collect_patient_data',
] as const;
