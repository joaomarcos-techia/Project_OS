import { z } from 'zod';

/* eslint-disable boundaries/element-types -- schedulingApiV1 é a API pública entre contextos. */
import { schedulingApiV1 } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { appointmentTimeForPatient } from '../internal/relative-datetime';
import { registerTool } from './registry';

const InputSchema = z.object({});
const AppointmentSchema = z.object({
  appointment_id: z.string().uuid(),
  scheduled_at: z.string(),
  /** O que o paciente lê: data e hora no fuso da clínica (scheduled_at é UTC). */
  scheduled_at_local: z.string(),
  status: z.string(),
  doctor_name: z.string(),
  procedure_name: z.string(),
});
const OutputSchema = z.object({ appointments: z.array(AppointmentSchema) });

registerTool({
  name: 'list_my_appointments',
  description:
    'Lista as consultas futuras do paciente identificado. Use antes de confirmar quando não houver uma consulta inequívoca no contexto. Ao paciente, mostre scheduled_at_local (fuso da clínica); scheduled_at é UTC e serve só para outras ferramentas.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (_input, ctx) => {
    if (!ctx.patientId || ctx.identityAmbiguous) {
      throw new Error('paciente não identificado de forma inequívoca');
    }
    const appointments = await schedulingApiV1.listPatientAppointments(
      ctx.clinicId,
      ctx.patientId,
      10,
    );
    return {
      appointments: appointments.map((appointment) => ({
        appointment_id: appointment.id,
        scheduled_at: appointment.scheduledAt,
        scheduled_at_local: appointmentTimeForPatient(appointment.scheduledAt, ctx.clinicTimeZone),
        status: appointment.status,
        // DATA-001 — o profissional ATUAL; o snapshot só cobre o fallback.
        doctor_name: appointment.currentDoctorNome ?? appointment.snapshotDoctorNome,
        procedure_name: appointment.snapshotProcedureName,
      })),
    };
  },
});
